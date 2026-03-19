/**
 * BedrockService - AWS Bedrock LLM integration
 * Ported from Express backend, adapted for NestJS
 * Provides invokeModel, invokeWithImage, extractJson, and model discovery helpers.
 */

import {
  InvokeModelCommand,
  ConverseCommand,
  ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { bedrockClient, s3Client, AWS_CONFIG } from '../../config/aws';
import { ServiceHelper } from '../../utils/serviceHelper';
import { recordGenAIUsage } from '../../utils/genaiTelemetry';
import { calculateCost } from '../../utils/pricing';
import { estimateTokens } from '../../utils/tokenCounter';
import { TokenEstimator } from '../../utils/tokenEstimator';
import { loggingService } from '../../common/services/logging.service';
import { decodeFromTOON } from '../../utils/toon.utils';
import type {
  RawPricingData,
  LLMExtractionResult,
} from '../../types/modelDiscovery.types';
import sharp from 'sharp';

export interface PromptOptimizationRequest {
  prompt: string;
  model: string;
  service: string;
  context?: string;
  targetReduction?: number;
  preserveIntent?: boolean;
}

export interface PromptOptimizationResponse {
  optimizedPrompt: string;
  techniques: string[];
  estimatedTokenReduction: number;
  suggestions: string[];
  alternatives?: string[];
}

export interface UsageAnalysisRequest {
  usageData: Array<{
    prompt: string;
    tokens: number;
    cost: number;
    timestamp: Date;
  }>;
  timeframe: 'daily' | 'weekly' | 'monthly';
}

export interface UsageAnalysisResponse {
  patterns: string[];
  recommendations: string[];
  potentialSavings: number;
  optimizationOpportunities: Array<{
    prompt: string;
    reason: string;
    estimatedSaving: number;
  }>;
}

const BEDROCK_PROVIDER = 'aws-bedrock';

function s3UrlToKey(s3Url: string): string {
  const match = s3Url.match(/^s3:\/\/[^/]+\/(.+)$/);
  if (match) return match[1];
  return s3Url;
}

async function generatePresignedUrl(
  s3Key: string,
  expiresIn = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: AWS_CONFIG.s3.bucketName,
    Key: s3Key,
  });
  return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * BedrockService - static methods for AWS Bedrock LLM operations
 */
export class BedrockService {
  private static shouldUseConverseAPI(model: string): boolean {
    if (model.startsWith('global.')) return true;
    const converseModels = [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-sonnet-4-5',
      'claude-opus-4-5',
      'claude-haiku-4-5',
      'claude-opus-4',
    ];
    return converseModels.some((name) => model.includes(name));
  }

  private static async invokeWithConverseAPI(
    model: string,
    prompt: string,
    context?: {
      recentMessages?: Array<{
        role: string;
        content: string;
        metadata?: Record<string, unknown>;
      }>;
      useSystemPrompt?: boolean;
    },
  ): Promise<{ result: string; inputTokens: number; outputTokens: number }> {
    const messages: Array<{
      role: 'user' | 'assistant';
      content: Array<{ text: string }>;
    }> = [];

    if (context?.recentMessages && context.recentMessages.length > 0) {
      const msgArray = this.buildMessagesArray(context.recentMessages, prompt);
      msgArray.forEach((msg) => {
        messages.push({ role: msg.role, content: [{ text: msg.content }] });
      });
    } else {
      messages.push({ role: 'user', content: [{ text: prompt }] });
    }

    const systemPrompts: Array<{ text: string }> = [];
    if (context?.useSystemPrompt !== false) {
      systemPrompts.push({
        text: 'You are a helpful AI assistant specializing in AI cost optimization and cloud infrastructure. Remember context from previous messages and provide actionable, cost-effective recommendations.',
      });
    }

    const command = new ConverseCommand({
      modelId: model,
      messages,
      system: systemPrompts.length > 0 ? systemPrompts : undefined,
      inferenceConfig: {
        maxTokens: this.getMaxTokensForModel(model),
        temperature: 0.7,
      },
    });

    const response = await ServiceHelper.withRetry(
      () => bedrockClient.send(command),
      { maxRetries: 4, delayMs: 2000, backoffMultiplier: 2 },
    );

    const result = response.output?.message?.content?.[0]?.text || '';
    const inputTokens =
      response.usage?.inputTokens || TokenEstimator.estimate(prompt);
    const outputTokens =
      response.usage?.outputTokens || Math.ceil(result.length / 4);

    return { result, inputTokens, outputTokens };
  }

  private static buildMessagesArray(
    recentMessages: Array<{
      role: string;
      content: string;
      metadata?: Record<string, unknown>;
    }>,
    newMessage: string,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const chronological = [...recentMessages].reverse();

    chronological.forEach((msg) => {
      if ((msg.role === 'user' || msg.role === 'assistant') && msg.content) {
        let messageContent = msg.content;
        const isDocumentQuery =
          newMessage.toLowerCase().includes('document') ||
          newMessage.toLowerCase().includes('file') ||
          newMessage.toLowerCase().includes('pdf') ||
          newMessage.toLowerCase().includes('what does it say') ||
          newMessage.toLowerCase().includes('what did') ||
          newMessage.toLowerCase().includes('analyze');

        if (
          msg.role === 'assistant' &&
          msg.metadata?.type === 'document_content' &&
          msg.metadata?.content &&
          isDocumentQuery
        ) {
          const maxContentLength = 10000;
          const docContent =
            (msg.metadata.content as string).length > maxContentLength
              ? (msg.metadata.content as string).substring(
                  0,
                  maxContentLength,
                ) + '... [content truncated]'
              : (msg.metadata.content as string);
          messageContent = `${msg.content}\n\n[Document Content Retrieved]:\n${docContent}`;
        }

        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: messageContent,
        });
      }
    });

    messages.push({ role: 'user', content: newMessage });
    return messages;
  }

  private static getMaxTokensForModel(modelId: string): number {
    if (modelId.includes('claude-opus-4-6')) return 65536;
    if (modelId.includes('claude-sonnet-4-6')) return 65536;
    if (
      modelId.includes('claude-sonnet-4-5') ||
      modelId.includes('claude-opus-4-5')
    )
      return 32768;
    if (modelId.includes('claude-opus-4')) return 16384;
    if (
      modelId.includes('claude-haiku-4-5') ||
      modelId.includes('claude-haiku-4')
    )
      return 16384;
    if (modelId.includes('claude-3-5-sonnet')) return 8192;
    if (modelId.includes('claude-3-5-haiku')) return 8192;
    if (modelId.includes('nova-pro')) return 5000;
    if (modelId.includes('nova')) return 5000;
    return AWS_CONFIG.bedrock.maxTokens;
  }

  private static convertToInferenceProfile(modelId: string): string {
    const region = process.env.AWS_BEDROCK_REGION || 'us-east-1';
    const regionPrefix = region.split('-')[0];
    const modelMappings: Record<string, string> = {
      'global.anthropic.claude-haiku-4-5-20251001-v1:0': `${regionPrefix}.global.anthropic.claude-haiku-4-5-20251001-v1:0`,
      'anthropic.claude-3-5-sonnet-20240620-v1:0': `${regionPrefix}.anthropic.claude-3-5-sonnet-20240620-v1:0`,
      'anthropic.claude-3-5-sonnet-20241022-v2:0': `${regionPrefix}.anthropic.claude-3-5-sonnet-20241022-v2:0`,
      'anthropic.claude-3-haiku-20240307-v1:0': `${regionPrefix}.anthropic.claude-3-haiku-20240307-v1:0`,
      'anthropic.claude-opus-4-6-v1': `${regionPrefix}.anthropic.claude-opus-4-6-v1`,
      'anthropic.claude-sonnet-4-6-v1:0': `${regionPrefix}.anthropic.claude-sonnet-4-6-v1:0`,
      'anthropic.claude-opus-4-1-20250805-v1:0': `${regionPrefix}.anthropic.claude-opus-4-1-20250805-v1:0`,
      'amazon.nova-pro-v1:0': 'amazon.nova-pro-v1:0',
    };
    return modelMappings[modelId] || modelId;
  }

  public static async extractJson(text: string): Promise<string> {
    if (!text || typeof text !== 'string' || text.trim().length === 0)
      return '';
    const MAX_EXTRACT_SIZE = 5 * 1024 * 1024;
    if (text.length > MAX_EXTRACT_SIZE) {
      loggingService.warn('Text too large for extraction, truncating', {
        size: text.length,
        maxSize: MAX_EXTRACT_SIZE,
      });
      text = text.substring(0, MAX_EXTRACT_SIZE);
    }

    const toonPatterns = [
      /(\w+\[\d+\]\{[^}]+\}:[\s\S]*?)(?=\n\n|\n\w+\[|$)/,
      /(\w+\s*\[\s*\d+\s*\]\s*\{[^}]+\}\s*:[\s\S]*?)(?=\n\n|\n\w+\s*\[|$)/,
    ];

    for (const pattern of toonPatterns) {
      const toonMatch = text.match(pattern);
      if (toonMatch?.[1]) {
        try {
          const decodePromise = decodeFromTOON(toonMatch[1]);
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error('TOON validation timeout')),
              2000,
            ),
          );
          await Promise.race([decodePromise, timeoutPromise]);
          return toonMatch[1];
        } catch {
          // Continue to next pattern
        }
      }
    }

    const jsonBlockRegex = /```(?:json|toon)?\s*([\s\S]*?)\s*```/;
    const jsonBlockMatch = text.match(jsonBlockRegex);
    if (jsonBlockMatch?.[1]) {
      const extracted = jsonBlockMatch[1].trim();
      try {
        await decodeFromTOON(extracted);
        return extracted;
      } catch {
        try {
          JSON.parse(extracted);
          return extracted;
        } catch {
          // Continue
        }
      }
    }

    const jsonObjectRegex = /\{[\s\S]*\}/;
    const jsonObjectMatch = text.match(jsonObjectRegex);
    if (jsonObjectMatch) {
      try {
        JSON.parse(jsonObjectMatch[0]);
        return jsonObjectMatch[0];
      } catch {
        // Continue
      }
    }

    const jsonArrayRegex = /\[[\s\S]*\]/;
    const jsonArrayMatch = text.match(jsonArrayRegex);
    if (jsonArrayMatch) {
      try {
        JSON.parse(jsonArrayMatch[0]);
        return jsonArrayMatch[0];
      } catch {
        // Continue
      }
    }

    const cleanedText = text.trim();
    const withoutPrefix = cleanedText.replace(
      /^(Here's the|The|Here is the|JSON:?|Response:?|Answer:?)\s*/i,
      '',
    );
    return withoutPrefix.replace(/\s*(\.|$)/, '');
  }

  public static async invokeModel(
    prompt: string,
    model: string,
    context?: {
      recentMessages?: Array<{ role: string; content: string }>;
      useSystemPrompt?: boolean;
    },
  ): Promise<string> {
    const startTime = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;

    if (this.shouldUseConverseAPI(model)) {
      try {
        loggingService.info(`Using Converse API for model: ${model}`);
        const converseResult = await this.invokeWithConverseAPI(
          model,
          prompt,
          context,
        );
        inputTokens = converseResult.inputTokens;
        outputTokens = converseResult.outputTokens;
        const costUSD = calculateCost(
          inputTokens,
          outputTokens,
          BEDROCK_PROVIDER,
          model,
        );
        await recordGenAIUsage({
          provider: BEDROCK_PROVIDER,
          operationName: 'converse',
          model,
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          cost: costUSD,
          latencyMs: Date.now() - startTime,
        });
        return converseResult.result;
      } catch (error) {
        loggingService.error('Converse API failed', {
          error: error instanceof Error ? error.message : String(error),
          model,
        });
        throw error;
      }
    }

    const useMessagesFormat =
      !!context?.recentMessages &&
      context.recentMessages.length > 0 &&
      (model.includes('claude-3') ||
        model.includes('claude-4') ||
        model.includes('nova'));

    let payload: Record<string, unknown>;
    let responsePath: string;

    if (
      model.includes('claude-3') ||
      model.includes('claude-4') ||
      model.includes('claude-opus-4')
    ) {
      if (useMessagesFormat && context?.recentMessages) {
        const messages = this.buildMessagesArray(
          context.recentMessages,
          prompt,
        );
        payload = {
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: this.getMaxTokensForModel(model),
          temperature: 0.7,
          messages: messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        };
        if (context?.useSystemPrompt !== false) {
          (payload as Record<string, unknown>).system =
            'You are a helpful AI assistant specializing in AI cost optimization and cloud infrastructure.';
        }
      } else {
        payload = {
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: this.getMaxTokensForModel(model),
          temperature: AWS_CONFIG.bedrock.temperature,
          messages: [{ role: 'user', content: prompt }],
        };
      }
      responsePath = 'content';
    } else if (model.includes('nova')) {
      if (useMessagesFormat && context?.recentMessages) {
        const messages = this.buildMessagesArray(
          context.recentMessages,
          prompt,
        );
        payload = {
          messages: messages.map((msg) => ({
            role: msg.role,
            content: [{ text: msg.content }],
          })),
          inferenceConfig: {
            max_new_tokens: this.getMaxTokensForModel(model),
            temperature: 0.7,
            top_p: 0.9,
          },
        };
      } else {
        payload = {
          messages: [{ role: 'user', content: [{ text: prompt }] }],
          inferenceConfig: {
            max_new_tokens: this.getMaxTokensForModel(model),
            temperature: AWS_CONFIG.bedrock.temperature,
            top_p: 0.9,
          },
        };
      }
      responsePath = 'nova';
    } else if (model.includes('amazon.titan')) {
      payload = {
        inputText: prompt,
        textGenerationConfig: {
          maxTokenCount: AWS_CONFIG.bedrock.maxTokens,
          temperature: AWS_CONFIG.bedrock.temperature,
        },
      };
      responsePath = 'titan';
    } else if (model.includes('meta.llama')) {
      payload = {
        prompt,
        max_gen_len: AWS_CONFIG.bedrock.maxTokens,
        temperature: AWS_CONFIG.bedrock.temperature,
        top_p: 0.9,
      };
      responsePath = 'llama';
    } else if (model.includes('mistral')) {
      payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: this.getMaxTokensForModel(model),
        temperature: AWS_CONFIG.bedrock.temperature,
        messages: [{ role: 'user', content: prompt }],
      };
      responsePath = 'content';
    } else if (model.includes('cohere.command')) {
      payload = {
        message: prompt,
        max_tokens: AWS_CONFIG.bedrock.maxTokens,
        temperature: AWS_CONFIG.bedrock.temperature,
        p: 0.9,
        k: 0,
        stop_sequences: [],
        return_likelihoods: 'NONE',
      };
      responsePath = 'cohere';
    } else if (model.includes('ai21')) {
      payload = {
        prompt,
        maxTokens: AWS_CONFIG.bedrock.maxTokens,
        temperature: AWS_CONFIG.bedrock.temperature,
        topP: 1,
        stopSequences: [],
        countPenalty: { scale: 0 },
        presencePenalty: { scale: 0 },
        frequencyPenalty: { scale: 0 },
      };
      responsePath = 'ai21';
    } else {
      payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: this.getMaxTokensForModel(model),
        temperature: AWS_CONFIG.bedrock.temperature,
        messages: [{ role: 'user', content: prompt }],
      };
      responsePath = 'content';
    }

    const actualModelId = this.convertToInferenceProfile(model);
    if (actualModelId !== model) {
      loggingService.info(`Converting model ID: ${model} -> ${actualModelId}`);
    }

    try {
      inputTokens =
        estimateTokens(prompt, BEDROCK_PROVIDER) ||
        Math.ceil(prompt.length / 4);
      const command = new InvokeModelCommand({
        modelId: actualModelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      });

      const response = await ServiceHelper.withRetry(
        () => bedrockClient.send(command),
        {
          maxRetries: 4,
          delayMs: 2000,
          backoffMultiplier: 2,
        },
      );

      const responseBody = JSON.parse(
        new TextDecoder().decode(response.body),
      ) as Record<string, unknown>;
      let result = '';

      if (responsePath === 'content') {
        result =
          (responseBody.content as Array<{ text: string }>)?.[0]?.text ?? '';
      } else if (responsePath === 'nova') {
        const output = responseBody.output as
          | { message?: { content?: Array<{ text: string }> } }
          | undefined;
        const msg = responseBody.message as
          | { content?: Array<{ text: string }> }
          | undefined;
        result =
          output?.message?.content?.[0]?.text ?? msg?.content?.[0]?.text ?? '';
      } else if (responsePath === 'titan') {
        result =
          (responseBody.results as Array<{ outputText: string }>)?.[0]
            ?.outputText ?? '';
      } else if (responsePath === 'llama') {
        result =
          (responseBody.generation as string) ??
          (responseBody.outputs as Array<{ text: string }>)?.[0]?.text ??
          '';
      } else if (responsePath === 'cohere') {
        result =
          (responseBody.text as string) ??
          (responseBody.generations as Array<{ text: string }>)?.[0]?.text ??
          '';
      } else if (responsePath === 'ai21') {
        const completions = responseBody.completions as
          | Array<{
              data?: { text: string };
              outputs?: Array<{ text: string }>;
            }>
          | undefined;
        result =
          completions?.[0]?.data?.text ??
          completions?.[0]?.outputs?.[0]?.text ??
          '';
      } else {
        result =
          (responseBody.completion as string) ??
          (responseBody.text as string) ??
          '';
      }

      outputTokens =
        estimateTokens(result, BEDROCK_PROVIDER) ||
        Math.ceil(result.length / 4);
      const usage = responseBody.usage as
        | { input_tokens?: number; output_tokens?: number }
        | undefined;
      const metrics = responseBody.amazon_bedrock_invocationMetrics as
        | { inputTokenCount?: number; outputTokenCount?: number }
        | undefined;
      if (usage) {
        inputTokens = usage.input_tokens ?? inputTokens;
        outputTokens = usage.output_tokens ?? outputTokens;
      } else if (metrics) {
        inputTokens = metrics.inputTokenCount ?? inputTokens;
        outputTokens = metrics.outputTokenCount ?? outputTokens;
      }

      const costUSD = calculateCost(
        inputTokens,
        outputTokens,
        BEDROCK_PROVIDER,
        model,
      );
      await recordGenAIUsage({
        provider: BEDROCK_PROVIDER,
        operationName: 'chat.completions',
        model: actualModelId,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        cost: costUSD,
        latencyMs: Date.now() - startTime,
      });

      return result;
    } catch (error) {
      loggingService.error('Error invoking Bedrock model:', {
        originalModel: model,
        actualModelId,
        error,
      });
      await recordGenAIUsage({
        provider: BEDROCK_PROVIDER,
        operationName: 'chat.completions',
        model: actualModelId,
        promptTokens: inputTokens,
        completionTokens: 0,
        cost: 0,
        error: error instanceof Error ? error : new Error(String(error)),
        latencyMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Invoke model with raw payload (for prompt firewall, visual compliance, etc.)
   */
  public static async invokeModelDirectly(
    modelId: string,
    requestBody: Record<string, unknown>,
  ): Promise<{ response: string; inputTokens: number; outputTokens: number }> {
    const actualModelId = this.convertToInferenceProfile(modelId);
    const command = new InvokeModelCommand({
      modelId: actualModelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(requestBody),
    });

    const response = await ServiceHelper.withRetry(
      () => bedrockClient.send(command),
      {
        maxRetries: 3,
        delayMs: 1000,
        backoffMultiplier: 1.5,
      },
    );

    const responseBody = JSON.parse(
      new TextDecoder().decode(response.body),
    ) as Record<string, unknown>;
    let responseText = '';

    const content = responseBody.content as
      | Array<{ text?: string; type?: string }>
      | undefined;
    if (content?.length) {
      const textBlock = content.find((c) => c.type === 'text' || 'text' in c);
      responseText = (textBlock?.text as string) ?? '';
      if (!responseText && content[0]) {
        responseText = (content[0] as { text?: string }).text ?? '';
      }
    }

    const output = responseBody.output as
      | { message?: { content?: Array<{ text: string }> } }
      | undefined;
    if (!responseText && output?.message?.content?.length) {
      responseText = output.message.content[0]?.text ?? '';
    }

    const usage = responseBody.usage as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;
    const inputTokens =
      usage?.input_tokens ?? Math.ceil(JSON.stringify(requestBody).length / 4);
    const outputTokens =
      usage?.output_tokens ?? Math.ceil(responseText.length / 4);

    return { response: responseText, inputTokens, outputTokens };
  }

  /**
   * Stream model response with token-level updates.
   * Uses ConverseStreamCommand for supported models, falls back to invokeModel for others.
   */
  public static async streamModelResponse(
    messages: Array<{ role: string; content: string }>,
    modelId: string,
    options: {
      maxTokens?: number;
      temperature?: number;
      onChunk: (chunk: string, done: boolean) => void | Promise<void>;
    },
  ): Promise<{
    fullResponse: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }> {
    const startTime = Date.now();
    let fullResponse = '';
    const prompt =
      messages.filter((m) => m.role === 'user').pop()?.content ?? '';

    if (this.shouldUseConverseAPI(modelId)) {
      try {
        const streamCommand = new ConverseStreamCommand({
          modelId: this.convertToInferenceProfile(modelId),
          messages: messages.map((m) => ({
            role: (m.role === 'assistant' ? 'assistant' : 'user') as
              | 'user'
              | 'assistant',
            content: [{ text: m.content }],
          })),
          inferenceConfig: {
            maxTokens: options.maxTokens ?? this.getMaxTokensForModel(modelId),
            temperature: options.temperature ?? 0.7,
          },
        });

        const response = await bedrockClient.send(streamCommand);
        const stream = response.stream;

        if (stream) {
          for await (const event of stream) {
            const ev = event as {
              contentBlockDelta?: { delta?: { text?: string } };
            };
            const chunk = ev.contentBlockDelta?.delta?.text;
            if (chunk) {
              fullResponse += chunk;
              await options.onChunk(chunk, false);
            }
          }
        }
        await options.onChunk('', true);

        const inputTokens = Math.ceil(prompt.length / 4);
        const outputTokens = Math.ceil(fullResponse.length / 4);
        const cost = calculateCost(
          inputTokens,
          outputTokens,
          BEDROCK_PROVIDER,
          modelId,
        );

        await recordGenAIUsage({
          provider: BEDROCK_PROVIDER,
          operationName: 'converse_stream',
          model: modelId,
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          cost,
          latencyMs: Date.now() - startTime,
        });

        return {
          fullResponse,
          inputTokens,
          outputTokens,
          cost,
        };
      } catch (error) {
        loggingService.warn(
          'ConverseStream failed, falling back to invokeModel',
          {
            model: modelId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    // Degraded mode: ConverseStream unavailable - use blocking invokeModel and deliver full response once.
    // Do NOT simulate streaming by chunking - callers receive the complete response in a single onChunk.
    const result = await this.invokeModel(
      prompt,
      modelId,
      messages.length > 1
        ? {
            recentMessages: messages.slice(0, -1).map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }
        : undefined,
    );
    fullResponse = result;
    await options.onChunk(result, true);

    const inputTokens = Math.ceil(prompt.length / 4);
    const outputTokens = Math.ceil(result.length / 4);
    const cost = calculateCost(
      inputTokens,
      outputTokens,
      BEDROCK_PROVIDER,
      modelId,
    );

    return {
      fullResponse,
      inputTokens,
      outputTokens,
      cost,
    };
  }

  public static async invokeWithImage(
    prompt: string,
    imageUrl: string,
    userId: string,
    modelId = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
  ): Promise<{
    response: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }> {
    if (imageUrl.startsWith('data:image')) {
      const maxBase64Size = 5 * 1024 * 1024;
      if (imageUrl.length > maxBase64Size) {
        throw new Error(
          `Image too large. AWS Bedrock limit is ${(maxBase64Size / (1024 * 1024)).toFixed(2)}MB.`,
        );
      }
    }

    let imageBuffer: Buffer;
    let imageType: string;
    let imageBase64 = '';

    if (imageUrl.startsWith('data:image')) {
      const matches = imageUrl.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/s);
      if (!matches) throw new Error('Invalid base64 data URL format');
      const [, format, base64Data] = matches;
      imageBase64 = base64Data.replace(/[^A-Za-z0-9+/=]/g, '');
      if (!imageBase64) throw new Error('Empty base64 data after cleaning');
      imageBuffer = Buffer.from(imageBase64, 'base64');
      imageType = `image/${format}`;
    } else if (
      imageUrl.startsWith('http://') ||
      imageUrl.startsWith('https://')
    ) {
      const response = await fetch(imageUrl);
      if (!response.ok)
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      imageBuffer = Buffer.from(await response.arrayBuffer());
      imageType = response.headers.get('content-type') || 'image/jpeg';
      imageBase64 = imageBuffer.toString('base64');
    } else if (imageUrl.startsWith('s3://')) {
      const s3Key = s3UrlToKey(imageUrl);
      const presignedUrl = await generatePresignedUrl(s3Key, 3600);
      const response = await fetch(presignedUrl);
      if (!response.ok)
        throw new Error(
          `Failed to fetch image from S3: ${response.statusText}`,
        );
      imageBuffer = Buffer.from(await response.arrayBuffer());
      imageType = response.headers.get('content-type') || 'image/jpeg';
    } else {
      throw new Error('Invalid image URL format');
    }

    let mediaType = 'image/jpeg';
    if (imageType.includes('png')) mediaType = 'image/png';
    else if (imageType.includes('webp')) mediaType = 'image/webp';
    else if (imageType.includes('gif')) mediaType = 'image/gif';

    let processedBuffer: Buffer;
    try {
      processedBuffer = await sharp(imageBuffer)
        .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
      mediaType = 'image/jpeg';
    } catch {
      processedBuffer = imageBuffer;
    }

    const finalBase64 = imageBase64 || processedBuffer.toString('base64');
    const cleanedBase64 = finalBase64.replace(/[\r\n\s\t]/g, '');
    const base64WithoutPadding = cleanedBase64.replace(/=+$/, '');
    const paddingNeeded = (4 - (base64WithoutPadding.length % 4)) % 4;
    const properlyPaddedBase64 =
      base64WithoutPadding + '='.repeat(paddingNeeded);

    const maxBase64Size = 4.5 * 1024 * 1024;
    if (properlyPaddedBase64.length > maxBase64Size) {
      throw new Error(
        `Processed image too large. AWS Bedrock safe limit is ${(maxBase64Size / (1024 * 1024)).toFixed(2)}MB.`,
      );
    }

    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: this.getMaxTokensForModel(modelId),
      temperature: 0.7,
      messages: [
        {
          role: 'user' as const,
          content: [
            {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: mediaType,
                data: properlyPaddedBase64,
              },
            },
            { type: 'text' as const, text: prompt },
          ],
        },
      ],
    };

    const actualModelId = this.convertToInferenceProfile(modelId);
    const command = new InvokeModelCommand({
      modelId: actualModelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    });

    const response = await ServiceHelper.withRetry(
      () => bedrockClient.send(command),
      {
        maxRetries: 3,
        delayMs: 1000,
      },
    );

    const responseBody = JSON.parse(
      new TextDecoder().decode(response.body),
    ) as Record<string, unknown>;
    const content = responseBody.content as
      | Array<{ type: string; text?: string }>
      | undefined;
    let responseText = '';
    if (content?.length) {
      const textContent = content.find((c) => c.type === 'text');
      responseText = textContent?.text ?? '';
    }

    const inputTokens =
      (responseBody.usage as { input_tokens?: number })?.input_tokens ?? 0;
    const outputTokens =
      (responseBody.usage as { output_tokens?: number })?.output_tokens ?? 0;
    const cost = calculateCost(
      inputTokens,
      outputTokens,
      BEDROCK_PROVIDER,
      modelId,
    );

    await recordGenAIUsage({
      provider: BEDROCK_PROVIDER,
      operationName: 'vision-analysis',
      model: modelId,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      cost,
      userId,
      requestId: `vision-${Date.now()}`,
    });

    return { response: responseText, inputTokens, outputTokens, cost };
  }

  static async optimizePrompt(
    request: PromptOptimizationRequest,
  ): Promise<PromptOptimizationResponse> {
    const systemPrompt = `You are an AI prompt optimization expert. Optimize the prompt for '${request.service}' / '${request.model}'.

Original: ${request.prompt}
${request.context ? `Context: ${request.context}` : ''}
${request.targetReduction ? `Target reduction: ${request.targetReduction}%` : ''}
${request.preserveIntent ? 'Preserve exact intent and output format' : ''}

Return JSON: { "optimizedPrompt": "...", "techniques": [...], "estimatedTokenReduction": N, "suggestions": [...], "alternatives": [...] }`;

    const response = await this.invokeModel(
      systemPrompt,
      AWS_CONFIG.bedrock.modelId,
    );
    const cleaned = await this.extractJson(response);
    return JSON.parse(cleaned) as PromptOptimizationResponse;
  }

  static async analyzeUsagePatterns(
    request: UsageAnalysisRequest,
  ): Promise<UsageAnalysisResponse> {
    const totalTokens = request.usageData.reduce((s, d) => s + d.tokens, 0);
    const totalCost = request.usageData.reduce((s, d) => s + d.cost, 0);
    const top = request.usageData
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10)
      .map(
        (d, i) =>
          `${i + 1}. Cost: $${d.cost.toFixed(4)}, Tokens: ${d.tokens}, Prompt: "${d.prompt.substring(0, 100)}..."`,
      )
      .join('\n');

    const systemPrompt = `You are an AI usage analyst. Analyze usage and provide cost optimization insights.

Summary: ${request.usageData.length} prompts, ${request.timeframe}, $${totalCost.toFixed(2)} total, ${totalTokens} tokens.
Top prompts:\n${top}

Return JSON: { "patterns": [...], "recommendations": [...], "potentialSavings": N, "optimizationOpportunities": [{ "prompt": "...", "reason": "...", "estimatedSaving": N }] }`;

    const response = await this.invokeModel(
      systemPrompt,
      AWS_CONFIG.bedrock.modelId,
    );
    const cleaned = await this.extractJson(response);
    return JSON.parse(cleaned) as UsageAnalysisResponse;
  }

  static async suggestModelAlternatives(
    currentModel: string,
    useCase: string,
    requirements: string[],
  ): Promise<{
    recommendations: Array<{
      model: string;
      provider: string;
      estimatedCostReduction: number;
      tradeoffs: string[];
    }>;
  }> {
    const systemPrompt = `Suggest alternative models for cost reduction.
Current: ${currentModel}, Use case: ${useCase}, Requirements: ${requirements.join(', ')}

Return JSON: { "recommendations": [{ "model": "...", "provider": "...", "estimatedCostReduction": N, "tradeoffs": [...] }] }`;

    const response = await this.invokeModel(
      systemPrompt,
      AWS_CONFIG.bedrock.modelId,
    );
    const cleaned = await this.extractJson(response);
    return JSON.parse(cleaned);
  }

  static async generatePromptTemplate(
    objective: string,
    examples: string[],
    constraints?: string[],
  ): Promise<{
    template: string;
    variables: string[];
    estimatedTokens: number;
    bestPractices: string[];
  }> {
    const systemPrompt = `Create an optimized prompt template.
Objective: ${objective}, Examples: ${examples.join(', ')}
${constraints ? `Constraints: ${constraints.join(', ')}` : ''}

Return JSON: { "template": "...", "variables": [...], "estimatedTokens": N, "bestPractices": [...] }`;

    const response = await this.invokeModel(
      systemPrompt,
      AWS_CONFIG.bedrock.modelId,
    );
    const cleaned = await this.extractJson(response);
    return JSON.parse(cleaned);
  }

  static async detectAnomalies(
    recentUsage: Array<{ timestamp: Date; cost: number; tokens: number }>,
    historicalAverage: { cost: number; tokens: number },
  ): Promise<{
    anomalies: Array<{
      timestamp: Date;
      type: string;
      severity: string;
      description: string;
    }>;
    recommendations: string[];
  }> {
    const entries = recentUsage
      .slice(-7)
      .map(
        (u) =>
          `- ${u.timestamp.toISOString()}: Cost: $${u.cost.toFixed(2)}, Tokens: ${u.tokens}`,
      )
      .join('\n');

    const systemPrompt = `Analyze for anomalies.
Historical avg: Cost $${historicalAverage.cost.toFixed(2)}, Tokens ${historicalAverage.tokens}
Recent:\n${entries}

Return JSON: { "anomalies": [{ "timestamp": "ISO8601", "type": "cost_spike", "severity": "high", "description": "..." }], "recommendations": [...] }`;

    const response = await this.invokeModel(
      systemPrompt,
      AWS_CONFIG.bedrock.modelId,
    );
    const cleaned = await this.extractJson(response);
    const parsed = JSON.parse(cleaned) as {
      anomalies: Array<{
        timestamp: string;
        type: string;
        severity: string;
        description: string;
      }>;
      recommendations: string[];
    };
    return {
      anomalies: parsed.anomalies.map((a) => ({
        ...a,
        timestamp: new Date(a.timestamp),
      })),
      recommendations: parsed.recommendations,
    };
  }

  static async extractModelsFromText(
    provider: string,
    searchText: string,
  ): Promise<LLMExtractionResult> {
    const prompt = `Extract model names from ${provider} search results. Return ONLY a JSON array of strings.

Content:\n${searchText}

Example: ["gpt-4o", "claude-3-5-sonnet"]`;

    try {
      const result = await this.invokeModel(prompt, 'us.amazon.nova-pro-v1:0');
      const cleanResponse = result
        .trim()
        .replace(/^```json\n?/, '')
        .replace(/\n?```$/, '')
        .trim();
      const models = JSON.parse(cleanResponse) as string[];
      return { success: true, data: models, prompt, response: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        prompt: '',
        response: '',
      };
    }
  }

  static async extractPricingFromText(
    provider: string,
    modelName: string,
    searchText: string,
  ): Promise<LLMExtractionResult> {
    const prompt = `Extract pricing for ${provider}'s ${modelName} from the text below. Return JSON:
{ "modelId": "...", "modelName": "...", "inputPricePerMToken": N, "outputPricePerMToken": N, "contextWindow": N, "capabilities": [...], "category": "text", "isLatest": true }
Prices in dollars per MILLION tokens.

Content:
${searchText}
`;

    try {
      const result = await this.invokeModel(
        prompt,
        'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      );
      const cleanResponse = result
        .trim()
        .replace(/^```json\n?/, '')
        .replace(/\n?```$/, '')
        .trim();
      const pricingData = JSON.parse(cleanResponse) as RawPricingData;
      return { success: true, data: pricingData, prompt, response: result };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        prompt: '',
        response: '',
      };
    }
  }
}
