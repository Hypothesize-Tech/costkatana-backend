/**
 * BedrockService - AWS Bedrock LLM integration
 * Ported from Express backend, adapted for NestJS
 * Provides invokeModel, invokeWithImage, extractJson, and model discovery helpers.
 */

import {
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
  ConverseCommand,
  ConverseStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { bedrockClient, s3Client, AWS_CONFIG } from '../../config/aws';
import { ServiceHelper } from '../../utils/serviceHelper';
import { recordGenAIUsage } from '../../utils/genaiTelemetry';
import { calculateCost, MODEL_PRICING } from '../../utils/pricing';
import { estimateTokens } from '../../utils/tokenCounter';
import { TokenEstimator } from '../../utils/tokenEstimator';
import { loggingService } from '../../common/services/logging.service';
import { decodeFromTOON } from '../../utils/toon.utils';
import type {
  RawPricingData,
  LLMExtractionResult,
} from '../../types/modelDiscovery.types';
import sharp from 'sharp';
import {
  getThinkingCapability,
  computeDynamicBudget,
  type ThinkingOptions,
} from './thinking-capability';
import type { ChatTool, ToolResult } from '../chat/tools/tool.types';
import {
  toBedrockToolConfig,
  ToolUseAccumulator,
} from '../chat/tools/bedrock-tool-adapter';

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

/** Default Claude / Converse system instruction (Cost Katana product voice). */
export const BEDROCK_DEFAULT_CLAUDE_SYSTEM_PROMPT =
  'You are a helpful AI assistant specializing in AI cost optimization and cloud infrastructure. Remember context from previous messages and provide actionable, cost-effective recommendations.';

/** Context for {@link BedrockService.invokeModel} (chat, handlers, stream fallback). */
export type BedrockInvokeModelContext = {
  recentMessages?: Array<{
    role: string;
    content: string;
    metadata?: Record<string, unknown>;
  }>;
  useSystemPrompt?: boolean;
  /**
   * Optional system instruction. When omitted and `useSystemPrompt !== false`,
   * {@link BEDROCK_DEFAULT_CLAUDE_SYSTEM_PROMPT} is used for Claude / Converse paths.
   */
  system?: string;
  /** 0–1; forwarded to Bedrock inference when provided. */
  temperature?: number;
  /** Capped per model via {@link BedrockService.getMaxTokensForModel}. */
  maxTokens?: number;
};

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

  private static clampBedrockTemperature(
    value: number | undefined,
    fallback: number,
  ): number {
    if (value === undefined || value === null || Number.isNaN(value)) {
      return fallback;
    }
    return Math.min(1, Math.max(0, value));
  }

  private static resolveMaxTokensForModel(
    modelId: string,
    requested: number | undefined,
  ): number {
    const cap = this.getMaxTokensForModel(modelId);
    if (
      requested === undefined ||
      requested === null ||
      Number.isNaN(requested)
    ) {
      return cap;
    }
    const n = Math.floor(requested);
    return Math.max(1, Math.min(n, cap));
  }

  /**
   * Resolve the Bedrock output price ($/1M output tokens) for a model id.
   * Tries exact match, then a normalized substring match against MODEL_PRICING.
   */
  public static getBedrockOutputPricePer1M(
    modelId: string,
  ): number | undefined {
    if (!modelId) return undefined;
    const id = modelId.toLowerCase();
    const isBedrock = (p: { provider: string }) =>
      /aws\s*bedrock|bedrock/i.test(p.provider);
    const exact = MODEL_PRICING.find(
      (p) => isBedrock(p) && p.modelId.toLowerCase() === id,
    );
    if (exact) return exact.outputPrice;
    // Loose substring match — handles `us.` / `global.` prefixed inference profiles.
    const stripped = id.replace(/^(us|eu|ap|ca|global)\./, '');
    const loose = MODEL_PRICING.find((p) => {
      if (!isBedrock(p)) return false;
      const pid = p.modelId.toLowerCase();
      return pid.includes(stripped) || stripped.includes(pid);
    });
    return loose?.outputPrice;
  }

  /**
   * Build the `thinking` payload for Claude extended reasoning on Bedrock and
   * return the `max_tokens` the caller should send with the request.
   *
   * Claude requires `max_tokens > thinking.budget_tokens`, so when a caller
   * passes a small `requestedMaxTokens` (e.g. 1000) we both (a) clamp the
   * reasoning budget against it and (b) bump max_tokens up just enough to
   * satisfy the invariant while staying under the model's hard cap.
   *
   * Adaptive models return { thinking:{type:'adaptive',effort} }; enabled-mode
   * models return { thinking:{type:'enabled',budget_tokens} }. Returns
   * undefined when the model doesn't support thinking or when `enabled` is false.
   */
  private static buildThinkingFields(
    modelId: string,
    thinking?: ThinkingOptions,
    prompt?: string,
    requestedMaxTokens?: number,
  ):
    | {
        thinking: Record<string, unknown>;
        effectiveMaxTokens: number;
      }
    | undefined {
    if (!thinking?.enabled) return undefined;
    const cap = getThinkingCapability(modelId);
    const modelMax = this.getMaxTokensForModel(modelId);
    const requested =
      requestedMaxTokens && requestedMaxTokens > 0
        ? Math.min(requestedMaxTokens, modelMax)
        : modelMax;

    if (cap === 'adaptive') {
      // Adaptive — Claude manages the budget itself. Default to 'high' unless
      // the caller explicitly chose an effort level.
      return {
        thinking: {
          type: 'adaptive',
          effort: thinking.effort ?? 'high',
        },
        effectiveMaxTokens: requested,
      };
    }
    if (cap === 'enabled') {
      // Dynamic budget: if the caller didn't pin one, compute from prompt
      // length and the model's output price (thinking bills as output).
      const outputPrice = this.getBedrockOutputPricePer1M(modelId);
      const rawBudget =
        thinking.budgetTokens ??
        computeDynamicBudget(modelId, prompt ?? '', modelMax, outputPrice);

      // Claude invariant: max_tokens > budget_tokens. Reserve at least 1024
      // tokens for the actual answer.
      const answerReserve = 1024;
      // Hard-clamp budget by model cap minus answer reserve.
      const budget = Math.max(
        1024,
        Math.min(rawBudget, modelMax - answerReserve),
      );
      // Bump effective max_tokens if the caller's requested value is too low
      // to fit budget + answer. Never exceed the model cap.
      const effectiveMaxTokens = Math.min(
        modelMax,
        Math.max(requested, budget + answerReserve),
      );
      return {
        thinking: {
          type: 'enabled',
          budget_tokens: budget,
        },
        effectiveMaxTokens,
      };
    }
    return undefined;
  }

  /** Converse API `system` blocks; omit when `useSystemPrompt === false`. */
  private static buildConverseSystemBlocks(
    context?: Pick<BedrockInvokeModelContext, 'useSystemPrompt' | 'system'>,
  ): Array<{ text: string }> | undefined {
    if (context?.useSystemPrompt === false) {
      return undefined;
    }
    const text =
      (context?.system && context.system.trim()) ||
      BEDROCK_DEFAULT_CLAUDE_SYSTEM_PROMPT;
    return [{ text }];
  }

  /** Anthropic Messages `system` string for InvokeModel / streaming payloads. */
  private static resolveAnthropicInvokeSystemString(
    context?: Pick<BedrockInvokeModelContext, 'useSystemPrompt' | 'system'>,
  ): string | undefined {
    if (context?.useSystemPrompt === false) {
      return undefined;
    }
    const custom = context?.system?.trim();
    if (custom) {
      return custom;
    }
    return BEDROCK_DEFAULT_CLAUDE_SYSTEM_PROMPT;
  }

  private static async invokeWithConverseAPI(
    model: string,
    prompt: string,
    context?: BedrockInvokeModelContext,
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

    const systemBlocks = this.buildConverseSystemBlocks(context);

    const command = new ConverseCommand({
      modelId: model,
      messages,
      system: systemBlocks,
      inferenceConfig: {
        maxTokens: this.resolveMaxTokensForModel(model, context?.maxTokens),
        temperature: this.clampBedrockTemperature(context?.temperature, 0.7),
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

  public static getMaxTokensForModel(modelId: string): number {
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

  /**
   * Bedrock InvokeModel often requires a cross-region inference profile ID
   * (e.g. `us.anthropic.claude-sonnet-4-20250514-v1:0`) instead of the bare
   * foundation model ID; unmapped Claude IDs were failing with on-demand errors.
   */
  private static convertToInferenceProfile(modelId: string): string {
    const region =
      process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1';
    const regionPrefix = region.split('-')[0];

    if (/^(us|eu|ap|ca)\./.test(modelId)) {
      return modelId;
    }

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

    if (modelMappings[modelId] !== undefined) {
      return modelMappings[modelId];
    }

    if (modelId.startsWith('global.anthropic.')) {
      return `${regionPrefix}.${modelId}`;
    }

    if (modelId.startsWith('anthropic.claude')) {
      return `${regionPrefix}.${modelId}`;
    }

    // Meta Llama models from 3.2+ (including llama3-2, llama3-3, llama4) are
    // only served via cross-region inference profiles on Bedrock — a bare
    // `meta.llama3-2-*` id returns "on-demand throughput isn't supported".
    if (
      /^meta\.(llama3-[23]|llama-3-[23]|llama4)/.test(modelId)
    ) {
      return `${regionPrefix}.${modelId}`;
    }

    return modelId;
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
    context?: BedrockInvokeModelContext,
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
          max_tokens: this.resolveMaxTokensForModel(model, context?.maxTokens),
          temperature: this.clampBedrockTemperature(context?.temperature, 0.7),
          messages: messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        };
        const sys = this.resolveAnthropicInvokeSystemString(context);
        if (sys) {
          (payload as Record<string, unknown>).system = sys;
        }
      } else {
        payload = {
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: this.resolveMaxTokensForModel(model, context?.maxTokens),
          temperature: this.clampBedrockTemperature(
            context?.temperature,
            AWS_CONFIG.bedrock.temperature,
          ),
          messages: [{ role: 'user', content: prompt }],
        };
        const sysSingle = this.resolveAnthropicInvokeSystemString(context);
        if (sysSingle) {
          (payload as Record<string, unknown>).system = sysSingle;
        }
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
            max_new_tokens: this.resolveMaxTokensForModel(
              model,
              context?.maxTokens,
            ),
            temperature: this.clampBedrockTemperature(
              context?.temperature,
              0.7,
            ),
            top_p: 0.9,
          },
        };
      } else {
        payload = {
          messages: [{ role: 'user', content: [{ text: prompt }] }],
          inferenceConfig: {
            max_new_tokens: this.resolveMaxTokensForModel(
              model,
              context?.maxTokens,
            ),
            temperature: this.clampBedrockTemperature(
              context?.temperature,
              AWS_CONFIG.bedrock.temperature,
            ),
            top_p: 0.9,
          },
        };
      }
      responsePath = 'nova';
    } else if (model.includes('amazon.titan')) {
      const maxTok =
        context?.maxTokens != null
          ? Math.max(
              1,
              Math.min(
                Math.floor(context.maxTokens),
                AWS_CONFIG.bedrock.maxTokens,
              ),
            )
          : AWS_CONFIG.bedrock.maxTokens;
      payload = {
        inputText: prompt,
        textGenerationConfig: {
          maxTokenCount: maxTok,
          temperature: this.clampBedrockTemperature(
            context?.temperature,
            AWS_CONFIG.bedrock.temperature,
          ),
        },
      };
      responsePath = 'titan';
    } else if (model.includes('meta.llama')) {
      const maxTok =
        context?.maxTokens != null
          ? Math.max(
              1,
              Math.min(
                Math.floor(context.maxTokens),
                AWS_CONFIG.bedrock.maxTokens,
              ),
            )
          : AWS_CONFIG.bedrock.maxTokens;
      payload = {
        prompt,
        max_gen_len: maxTok,
        temperature: this.clampBedrockTemperature(
          context?.temperature,
          AWS_CONFIG.bedrock.temperature,
        ),
        top_p: 0.9,
      };
      responsePath = 'llama';
    } else if (model.includes('mistral')) {
      payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: this.resolveMaxTokensForModel(model, context?.maxTokens),
        temperature: this.clampBedrockTemperature(
          context?.temperature,
          AWS_CONFIG.bedrock.temperature,
        ),
        messages: [{ role: 'user', content: prompt }],
      };
      responsePath = 'content';
    } else if (model.includes('cohere.command')) {
      const maxTok =
        context?.maxTokens != null
          ? Math.max(
              1,
              Math.min(
                Math.floor(context.maxTokens),
                AWS_CONFIG.bedrock.maxTokens,
              ),
            )
          : AWS_CONFIG.bedrock.maxTokens;
      payload = {
        message: prompt,
        max_tokens: maxTok,
        temperature: this.clampBedrockTemperature(
          context?.temperature,
          AWS_CONFIG.bedrock.temperature,
        ),
        p: 0.9,
        k: 0,
        stop_sequences: [],
        return_likelihoods: 'NONE',
      };
      responsePath = 'cohere';
    } else if (model.includes('ai21')) {
      const maxTok =
        context?.maxTokens != null
          ? Math.max(
              1,
              Math.min(
                Math.floor(context.maxTokens),
                AWS_CONFIG.bedrock.maxTokens,
              ),
            )
          : AWS_CONFIG.bedrock.maxTokens;
      payload = {
        prompt,
        maxTokens: maxTok,
        temperature: this.clampBedrockTemperature(
          context?.temperature,
          AWS_CONFIG.bedrock.temperature,
        ),
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
        max_tokens: this.resolveMaxTokensForModel(model, context?.maxTokens),
        temperature: this.clampBedrockTemperature(
          context?.temperature,
          AWS_CONFIG.bedrock.temperature,
        ),
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
  /**
   * One-shot text Converse invocation — works uniformly across Claude, Nova,
   * Llama 3+/4, Mistral, etc. Use this when you need a quick classification or
   * short-answer call and don't want to hand-roll provider-specific payloads.
   */
  public static async invokeConverseText(
    modelId: string,
    userMessage: string,
    opts?: { maxTokens?: number; temperature?: number; system?: string },
  ): Promise<{ response: string; inputTokens: number; outputTokens: number }> {
    const actualModelId = this.convertToInferenceProfile(modelId);
    const command = new ConverseCommand({
      modelId: actualModelId,
      messages: [
        {
          role: 'user',
          content: [{ text: userMessage }],
        },
      ],
      ...(opts?.system ? { system: [{ text: opts.system }] } : {}),
      inferenceConfig: {
        maxTokens: opts?.maxTokens ?? 64,
        temperature: opts?.temperature ?? 0,
      },
    });

    const response = await ServiceHelper.withRetry(
      () => bedrockClient.send(command),
      { maxRetries: 2, delayMs: 500, backoffMultiplier: 1.5 },
    );

    const text = response.output?.message?.content?.[0]?.text ?? '';
    const inputTokens =
      response.usage?.inputTokens ?? Math.ceil(userMessage.length / 4);
    const outputTokens =
      response.usage?.outputTokens ?? Math.ceil(text.length / 4);
    return { response: text, inputTokens, outputTokens };
  }

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
   * Invoke Claude on Bedrock using an Anthropic Messages–shaped JSON body (plus
   * `anthropic_version`). Used by the AI Gateway when no Anthropic API key is configured.
   */
  public static async invokeClaudeMessagesOnBedrock(
    bedrockModelId: string,
    requestBody: Record<string, unknown>,
  ): Promise<{
    status: number;
    body: Record<string, unknown>;
    resolvedModelId: string;
  }> {
    const startTime = Date.now();
    const actualModelId = this.convertToInferenceProfile(bedrockModelId);
    let inputTokens = 0;
    let outputTokens = 0;

    try {
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

      const data = JSON.parse(
        new TextDecoder().decode(response.body),
      ) as Record<string, unknown>;

      const usage = data.usage as
        | { input_tokens?: number; output_tokens?: number }
        | undefined;
      inputTokens =
        usage?.input_tokens ??
        Math.ceil(JSON.stringify(requestBody).length / 4);
      outputTokens =
        usage?.output_tokens ?? Math.ceil(JSON.stringify(data).length / 4);

      const costUSD = calculateCost(
        inputTokens,
        outputTokens,
        BEDROCK_PROVIDER,
        actualModelId,
      );
      await recordGenAIUsage({
        provider: BEDROCK_PROVIDER,
        operationName: 'gateway.anthropic.messages',
        model: actualModelId,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        cost: costUSD,
        latencyMs: Date.now() - startTime,
      });

      return { status: 200, body: data, resolvedModelId: actualModelId };
    } catch (error) {
      await recordGenAIUsage({
        provider: BEDROCK_PROVIDER,
        operationName: 'gateway.anthropic.messages',
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
   * Extract incremental text from a Bedrock InvokeModelWithResponseStream JSON chunk (Claude).
   */
  private static extractClaudeBedrockStreamTextDelta(
    parsed: Record<string, unknown>,
  ): string {
    if (parsed.type === 'content_block_delta') {
      const delta = parsed.delta as Record<string, unknown> | undefined;
      if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
        return delta.text;
      }
      // Do not treat thinking_delta as text; it is handled separately.
      if (delta?.type === 'thinking_delta') return '';
      if (typeof delta?.text === 'string') {
        return delta.text;
      }
    }
    return '';
  }

  /**
   * Extract incremental thinking/reasoning text from a Claude InvokeModel stream chunk.
   */
  private static extractClaudeBedrockStreamThinkingDelta(
    parsed: Record<string, unknown>,
  ): string {
    if (parsed.type === 'content_block_delta') {
      const delta = parsed.delta as Record<string, unknown> | undefined;
      if (
        delta?.type === 'thinking_delta' &&
        typeof delta.thinking === 'string'
      ) {
        return delta.thinking;
      }
    }
    return '';
  }

  /**
   * Consume Claude Messages-shaped InvokeModelWithResponseStream from Bedrock.
   * Optionally forwards each parsed event as an SSE `data:` line (gateway) and/or text deltas (chat).
   */
  private static async consumeClaudeInvokeModelResponseStream(
    actualModelId: string,
    requestBody: Record<string, unknown>,
    handlers: {
      onRawSseLine?: (line: string) => void;
      onTextDelta?: (text: string) => void | Promise<void>;
      onReasoningDelta?: (text: string) => void | Promise<void>;
      onCitation?: (
        citation: Record<string, unknown>,
        textBlockIndex: number,
      ) => void | Promise<void>;
    },
  ): Promise<{
    fullText: string;
    fullThinking: string;
    inputTokens: number;
    outputTokens: number;
    /** Raw Anthropic citations per text block, indexed by content_block index. */
    citationsByBlock: Array<Array<Record<string, unknown>>>;
  }> {
    let fullText = '';
    let fullThinking = '';
    let inputTokens = 0;
    let outputTokens = 0;
    const citationsByBlock: Array<Array<Record<string, unknown>>> = [];

    const command = new InvokeModelWithResponseStreamCommand({
      modelId: actualModelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(JSON.stringify(requestBody)),
    });

    const streamResponse = await ServiceHelper.withRetry(
      () => bedrockClient.send(command),
      {
        maxRetries: 3,
        delayMs: 1000,
        backoffMultiplier: 1.5,
      },
    );

    if (!streamResponse.body) {
      throw new Error('No response body from Bedrock stream');
    }

    for await (const event of streamResponse.body) {
      if ('chunk' in event && event.chunk?.bytes) {
        const json = new TextDecoder().decode(event.chunk.bytes);
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(json) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (handlers.onRawSseLine) {
          handlers.onRawSseLine(`data: ${JSON.stringify(parsed)}\n\n`);
        }
        const thinkingDelta =
          this.extractClaudeBedrockStreamThinkingDelta(parsed);
        if (thinkingDelta) {
          fullThinking += thinkingDelta;
          await handlers.onReasoningDelta?.(thinkingDelta);
        }
        const delta = this.extractClaudeBedrockStreamTextDelta(parsed);
        if (delta) {
          fullText += delta;
          await handlers.onTextDelta?.(delta);
        }
        // Citation events: either attached on content_block_start or streamed
        // as content_block_delta with type "citations_delta".
        if (
          parsed.type === 'content_block_start' &&
          typeof parsed.index === 'number'
        ) {
          const block = parsed.content_block as Record<string, unknown> | undefined;
          if (block?.type === 'text') {
            const initial = Array.isArray(block.citations)
              ? (block.citations as Array<Record<string, unknown>>)
              : [];
            citationsByBlock[parsed.index] = initial.slice();
            for (const c of initial) {
              await handlers.onCitation?.(c, parsed.index);
            }
          }
        }
        if (parsed.type === 'content_block_delta' && typeof parsed.index === 'number') {
          const d = parsed.delta as Record<string, unknown> | undefined;
          if (d?.type === 'citations_delta') {
            const c =
              (d.citation as Record<string, unknown> | undefined) ??
              (d.citations as Record<string, unknown> | undefined);
            if (c) {
              const arr = (citationsByBlock[parsed.index] ??= []);
              arr.push(c);
              await handlers.onCitation?.(c, parsed.index);
            }
          }
        }
        if (
          parsed.type === 'message_delta' &&
          parsed.usage &&
          typeof parsed.usage === 'object'
        ) {
          const u = parsed.usage as {
            input_tokens?: number;
            output_tokens?: number;
          };
          if (typeof u.input_tokens === 'number') inputTokens = u.input_tokens;
          if (typeof u.output_tokens === 'number')
            outputTokens = u.output_tokens;
        }
      }
      if (
        'modelStreamErrorException' in event &&
        event.modelStreamErrorException
      ) {
        throw new Error(
          event.modelStreamErrorException.message ||
            'Bedrock model stream error',
        );
      }
    }

    if (inputTokens === 0) {
      inputTokens = Math.ceil(JSON.stringify(requestBody).length / 4);
    }
    if (outputTokens === 0) {
      outputTokens = Math.ceil(fullText.length / 4);
    }

    return { fullText, fullThinking, inputTokens, outputTokens, citationsByBlock };
  }

  /**
   * Stream Anthropic Messages API-compatible responses via Bedrock (SSE lines per chunk).
   * Used by the gateway when clients send `stream: true` and there is no Anthropic API key.
   */
  public static async invokeClaudeMessagesOnBedrockSse(
    bedrockModelId: string,
    requestBody: Record<string, unknown>,
    writeSse: (line: string) => void,
    onCitation?: (
      citation: Record<string, unknown>,
      textBlockIndex: number,
    ) => void | Promise<void>,
  ): Promise<{
    fullText: string;
    inputTokens: number;
    outputTokens: number;
    resolvedModelId: string;
    citationsByBlock: Array<Array<Record<string, unknown>>>;
  }> {
    const startTime = Date.now();
    const resolvedModelId = this.convertToInferenceProfile(bedrockModelId);
    try {
      const { fullText, inputTokens, outputTokens, citationsByBlock } =
        await this.consumeClaudeInvokeModelResponseStream(
          resolvedModelId,
          requestBody,
          { onRawSseLine: writeSse, onCitation },
        );

      const costUSD = calculateCost(
        inputTokens,
        outputTokens,
        BEDROCK_PROVIDER,
        resolvedModelId,
      );
      await recordGenAIUsage({
        provider: BEDROCK_PROVIDER,
        operationName: 'gateway.anthropic.messages.stream',
        model: resolvedModelId,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        cost: costUSD,
        latencyMs: Date.now() - startTime,
      });

      return {
        fullText,
        inputTokens,
        outputTokens,
        resolvedModelId,
        citationsByBlock,
      };
    } catch (error) {
      await recordGenAIUsage({
        provider: BEDROCK_PROVIDER,
        operationName: 'gateway.anthropic.messages.stream',
        model: resolvedModelId,
        promptTokens: 0,
        completionTokens: 0,
        cost: 0,
        error: error instanceof Error ? error : new Error(String(error)),
        latencyMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Multi-round Converse stream with tool use. Called from streamModelResponse
   * when `options.tools` is non-empty and the model supports Converse.
   *
   * Each iteration:
   *  1. ConverseStream with the current messages + toolConfig.
   *  2. Accumulate text/reasoning deltas and any toolUse blocks.
   *  3. If the stream stops with `tool_use`, execute each tool via
   *     `options.executeTool`, append `{assistant: [text?, toolUse]}` and
   *     `{user: [toolResult]}` content blocks to the message list, and loop.
   *  4. On `end_turn` (or after maxRounds), emit the trailing `done` callbacks
   *     and return the accumulated response.
   */
  private static async streamConverseWithTools(
    originalMessages: Array<{ role: string; content: string }>,
    modelId: string,
    options: Parameters<typeof BedrockService.streamModelResponse>[2],
    init: {
      thinkingFields: ReturnType<typeof BedrockService.buildThinkingFields>;
      startTime: number;
    },
  ): Promise<{
    fullResponse: string;
    fullReasoning: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    toolCalls?: Array<{
      id: string;
      name: string;
      input: unknown;
      output?: ToolResult;
      status: 'success' | 'error';
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
    }>;
  }> {
    const { thinkingFields, startTime } = init;
    const thinkingActive = Boolean(thinkingFields);
    const MAX_ROUNDS = 5;

    let fullResponse = '';
    let fullReasoning = '';
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const recordedToolCalls: Array<{
      id: string;
      name: string;
      input: unknown;
      output?: ToolResult;
      status: 'success' | 'error';
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
    }> = [];

    const systemBlocks = this.buildConverseSystemBlocks({
      useSystemPrompt: options.useSystemPrompt,
      system: options.system,
    });
    const toolConfig = toBedrockToolConfig(options.tools ?? []);

    // Build initial Converse messages from plain text. Each turn, we append
    // richer content blocks (toolUse, toolResult) as the loop progresses.
    type ConverseContent =
      | { text: string }
      | { toolUse: { toolUseId: string; name: string; input: unknown } }
      | {
          toolResult: {
            toolUseId: string;
            content: Array<{ text: string }>;
            status?: 'success' | 'error';
          };
        };
    type ConverseMessage = {
      role: 'user' | 'assistant';
      content: ConverseContent[];
    };
    const conversation: ConverseMessage[] = originalMessages.map((m) => ({
      role: (m.role === 'assistant' ? 'assistant' : 'user') as
        | 'user'
        | 'assistant',
      content: [{ text: m.content }],
    }));

    let finalStop: string | undefined;
    let round = 0;
    for (round = 0; round < MAX_ROUNDS; round++) {
      const accumulator = new ToolUseAccumulator();
      // Content blocks this round — we assemble to feed back to the model
      // next iteration (mirroring what the assistant produced).
      const roundAssistantContent: ConverseContent[] = [];
      let roundText = '';

      const streamCommand = new ConverseStreamCommand({
        modelId: this.convertToInferenceProfile(modelId),
        messages: conversation as Array<{
          role: 'user' | 'assistant';
          content: ConverseContent[];
        }>,
        system: systemBlocks,
        inferenceConfig: {
          maxTokens:
            thinkingFields?.effectiveMaxTokens ??
            options.maxTokens ??
            this.getMaxTokensForModel(modelId),
          temperature: thinkingActive ? 1 : (options.temperature ?? 0.7),
        },
        ...(toolConfig
          ? {
              toolConfig:
                round >= MAX_ROUNDS - 1
                  ? // Final round: force a text answer, no more tool calls.
                    { ...toolConfig, toolChoice: { auto: {} } }
                  : toolConfig,
            }
          : {}),
        ...(thinkingFields
          ? {
              additionalModelRequestFields: {
                thinking: thinkingFields.thinking,
              },
            }
          : {}),
      });

      if (round === 0) {
        loggingService.debug('Bedrock tool-use stream starting', {
          model: modelId,
          toolCount: options.tools?.length,
          thinkingActive,
        });
      }

      const response = await bedrockClient.send(streamCommand);
      if (!response.stream) {
        throw new Error('No stream returned from ConverseStream');
      }

      let roundStopReason: string | undefined;
      for await (const event of response.stream) {
        const ev = event as {
          messageStart?: { role?: string };
          contentBlockStart?: {
            contentBlockIndex?: number;
            start?: {
              toolUse?: { toolUseId?: string; name?: string };
            };
          };
          contentBlockDelta?: {
            contentBlockIndex?: number;
            delta?: {
              text?: string;
              reasoningContent?: { text?: string; signature?: string };
              toolUse?: { input?: string };
            };
          };
          contentBlockStop?: { contentBlockIndex?: number };
          messageStop?: { stopReason?: string };
          metadata?: {
            usage?: { inputTokens?: number; outputTokens?: number };
          };
        };

        // Tool-use start — register an accumulator for this block index.
        const toolStart = ev.contentBlockStart?.start?.toolUse;
        if (
          ev.contentBlockStart &&
          toolStart?.toolUseId &&
          toolStart.name &&
          typeof ev.contentBlockStart.contentBlockIndex === 'number'
        ) {
          accumulator.start(
            ev.contentBlockStart.contentBlockIndex,
            toolStart.toolUseId,
            toolStart.name,
          );
          continue;
        }

        if (ev.contentBlockDelta) {
          const idx = ev.contentBlockDelta.contentBlockIndex;
          const d = ev.contentBlockDelta.delta ?? {};
          if (
            typeof idx === 'number' &&
            accumulator.has(idx) &&
            typeof d.toolUse?.input === 'string'
          ) {
            accumulator.appendInput(idx, d.toolUse.input);
            continue;
          }
          if (d.reasoningContent?.text) {
            fullReasoning += d.reasoningContent.text;
            await options.onReasoningChunk?.(d.reasoningContent.text, false);
            continue;
          }
          if (typeof d.text === 'string' && d.text.length > 0) {
            fullResponse += d.text;
            roundText += d.text;
            await options.onChunk(d.text, false);
          }
          continue;
        }

        if (ev.contentBlockStop && typeof ev.contentBlockStop.contentBlockIndex === 'number') {
          const parsed = accumulator.finalize(ev.contentBlockStop.contentBlockIndex);
          if (parsed) {
            roundAssistantContent.push({
              toolUse: {
                toolUseId: parsed.id,
                name: parsed.name,
                input: parsed.input,
              },
            });
          }
          continue;
        }

        if (ev.messageStop?.stopReason) {
          roundStopReason = ev.messageStop.stopReason;
        }

        const usage = ev.metadata?.usage;
        if (usage) {
          totalInputTokens += usage.inputTokens ?? 0;
          totalOutputTokens += usage.outputTokens ?? 0;
        }
      }

      finalStop = roundStopReason;

      // Prepend any accumulated text to the assistant turn's content blocks.
      if (roundText) {
        roundAssistantContent.unshift({ text: roundText });
      }

      const toolUseBlocks = roundAssistantContent.filter(
        (c): c is { toolUse: { toolUseId: string; name: string; input: unknown } } =>
          'toolUse' in c,
      );

      // If no tools were called, we're done after this round.
      if (toolUseBlocks.length === 0) {
        break;
      }

      // Append the assistant turn (with toolUse blocks) to the conversation.
      conversation.push({
        role: 'assistant',
        content: roundAssistantContent.length
          ? roundAssistantContent
          : [{ text: '' }],
      });

      // Execute every tool call sequentially; gather results for the next turn.
      const userToolResults: ConverseContent[] = [];
      for (const block of toolUseBlocks) {
        const { toolUseId, name, input } = block.toolUse;
        await options.onToolCall?.({ id: toolUseId, name, input });
        const startedAt = new Date();
        let output: ToolResult;
        let status: 'success' | 'error' = 'success';
        try {
          if (!options.executeTool) {
            throw new Error('executeTool callback missing');
          }
          output = await options.executeTool(name, input);
        } catch (err) {
          status = 'error';
          output = {
            content:
              'Error executing tool: ' +
              (err instanceof Error ? err.message : String(err)),
          };
        }
        const finishedAt = new Date();
        const durationMs = finishedAt.getTime() - startedAt.getTime();
        await options.onToolResult?.({
          id: toolUseId,
          name,
          output,
          status,
          durationMs,
        });
        recordedToolCalls.push({
          id: toolUseId,
          name,
          input,
          output,
          status,
          startedAt,
          finishedAt,
          durationMs,
        });
        userToolResults.push({
          toolResult: {
            toolUseId,
            content: [{ text: output.content }],
            status,
          },
        });
      }

      conversation.push({ role: 'user', content: userToolResults });
      // Continue the loop for the follow-up model turn.
    }

    if (thinkingActive) {
      await options.onReasoningChunk?.('', true);
    }
    await options.onChunk('', true);

    const inputTokens =
      totalInputTokens || Math.ceil((originalMessages[0]?.content ?? '').length / 4);
    const outputTokens = totalOutputTokens || Math.ceil(fullResponse.length / 4);
    const cost = calculateCost(
      inputTokens,
      outputTokens,
      BEDROCK_PROVIDER,
      modelId,
    );

    await recordGenAIUsage({
      provider: BEDROCK_PROVIDER,
      operationName: 'converse_stream_tools',
      model: modelId,
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      cost,
      latencyMs: Date.now() - startTime,
    });

    loggingService.debug('Bedrock tool-use stream completed', {
      model: modelId,
      rounds: round + 1,
      stopReason: finalStop,
      toolCallCount: recordedToolCalls.length,
    });

    return {
      fullResponse,
      fullReasoning,
      inputTokens,
      outputTokens,
      cost,
      toolCalls: recordedToolCalls,
    };
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
      useSystemPrompt?: boolean;
      system?: string;
      onChunk: (chunk: string, done: boolean) => void | Promise<void>;
      thinking?: ThinkingOptions;
      onReasoningChunk?: (
        chunk: string,
        done: boolean,
      ) => void | Promise<void>;
      /** When provided, advertise these tools via Converse toolConfig. */
      tools?: ChatTool[];
      /** Called with each tool call the LLM emits (before execution). */
      onToolCall?: (call: {
        id: string;
        name: string;
        input: unknown;
      }) => void | Promise<void>;
      /** Called after each tool executes, with the resolved result. */
      onToolResult?: (result: {
        id: string;
        name: string;
        output: ToolResult;
        status: 'success' | 'error';
        durationMs: number;
      }) => void | Promise<void>;
      /**
       * Resolves a tool call to a ToolResult. Injected by callers so BedrockService
       * stays decoupled from the ToolRegistry.
       */
      executeTool?: (
        name: string,
        input: unknown,
      ) => Promise<ToolResult>;
    },
  ): Promise<{
    fullResponse: string;
    fullReasoning: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    toolCalls?: Array<{
      id: string;
      name: string;
      input: unknown;
      output?: ToolResult;
      status: 'success' | 'error';
      startedAt: Date;
      finishedAt: Date;
      durationMs: number;
    }>;
  }> {
    const startTime = Date.now();
    let fullResponse = '';
    let fullReasoning = '';
    const prompt =
      messages.filter((m) => m.role === 'user').pop()?.content ?? '';
    const thinkingFields = this.buildThinkingFields(
      modelId,
      options.thinking,
      prompt,
      options.maxTokens,
    );
    const thinkingActive = Boolean(thinkingFields);
    const toolsActive = Boolean(options.tools?.length);

    // Multi-round tool loop — only runs when tools are provided AND the
    // model supports Converse. Other paths fall through to the non-tool flow.
    if (toolsActive && this.shouldUseConverseAPI(modelId)) {
      return this.streamConverseWithTools(messages, modelId, options, {
        thinkingFields,
        startTime,
      });
    }

    if (this.shouldUseConverseAPI(modelId)) {
      try {
        const systemBlocks = this.buildConverseSystemBlocks({
          useSystemPrompt: options.useSystemPrompt,
          system: options.system,
        });
        const streamCommand = new ConverseStreamCommand({
          modelId: this.convertToInferenceProfile(modelId),
          messages: messages.map((m) => ({
            role: (m.role === 'assistant' ? 'assistant' : 'user') as
              | 'user'
              | 'assistant',
            content: [{ text: m.content }],
          })),
          system: systemBlocks,
          inferenceConfig: {
            maxTokens:
              thinkingFields?.effectiveMaxTokens ??
              options.maxTokens ??
              this.getMaxTokensForModel(modelId),
            // Extended thinking requires temperature=1 per Claude docs; otherwise honor caller.
            temperature: thinkingActive ? 1 : (options.temperature ?? 0.7),
          },
          ...(thinkingFields
            ? {
                additionalModelRequestFields: { thinking: thinkingFields.thinking },
              }
            : {}),
        });

        if (thinkingActive) {
          loggingService.debug(
            'Bedrock extended thinking enabled (Converse stream)',
            {
              model: modelId,
              thinkingFields,
            },
          );
        }

        const response = await bedrockClient.send(streamCommand);
        const stream = response.stream;

        if (stream) {
          for await (const event of stream) {
            const ev = event as {
              contentBlockDelta?: {
                delta?: {
                  text?: string;
                  reasoningContent?: { text?: string; signature?: string };
                };
              };
            };
            const reasoning = ev.contentBlockDelta?.delta?.reasoningContent?.text;
            if (reasoning) {
              fullReasoning += reasoning;
              await options.onReasoningChunk?.(reasoning, false);
              continue;
            }
            const chunk = ev.contentBlockDelta?.delta?.text;
            if (chunk) {
              fullResponse += chunk;
              await options.onChunk(chunk, false);
            }
          }
        }
        if (thinkingActive) {
          await options.onReasoningChunk?.('', true);
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
          fullReasoning,
          inputTokens,
          outputTokens,
          cost,
        };
      } catch (error) {
        loggingService.warn(
          'ConverseStream failed, trying InvokeModel stream or blocking fallback',
          {
            model: modelId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    const canClaudeInvokeModelStream =
      modelId.includes('anthropic.claude') ||
      modelId.includes('claude-3') ||
      modelId.includes('claude-4') ||
      modelId.includes('claude-opus');

    if (canClaudeInvokeModelStream) {
      try {
        const actualModelId = this.convertToInferenceProfile(modelId);
        const payload: Record<string, unknown> = {
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens:
            thinkingFields?.effectiveMaxTokens ??
            this.resolveMaxTokensForModel(modelId, options.maxTokens),
          temperature: thinkingActive
            ? 1
            : this.clampBedrockTemperature(options.temperature, 0.7),
          messages: messages.map((m) => ({
            role: (m.role === 'assistant' ? 'assistant' : 'user') as
              | 'user'
              | 'assistant',
            content: m.content,
          })),
        };
        if (thinkingFields) {
          payload.thinking = thinkingFields.thinking;
        }
        const streamSys = this.resolveAnthropicInvokeSystemString({
          useSystemPrompt: options.useSystemPrompt,
          system: options.system,
        });
        if (streamSys) {
          payload.system = streamSys;
        }

        const { fullText, fullThinking, inputTokens, outputTokens } =
          await this.consumeClaudeInvokeModelResponseStream(
            actualModelId,
            payload,
            {
              onTextDelta: async (t) => {
                await options.onChunk(t, false);
              },
              onReasoningDelta: async (t) => {
                await options.onReasoningChunk?.(t, false);
              },
            },
          );
        fullResponse = fullText;
        fullReasoning = fullThinking;
        if (thinkingActive) {
          await options.onReasoningChunk?.('', true);
        }
        await options.onChunk('', true);

        const cost = calculateCost(
          inputTokens,
          outputTokens,
          BEDROCK_PROVIDER,
          modelId,
        );
        await recordGenAIUsage({
          provider: BEDROCK_PROVIDER,
          operationName: 'bedrock.invoke_model_stream',
          model: modelId,
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          cost,
          latencyMs: Date.now() - startTime,
        });

        return {
          fullResponse,
          fullReasoning,
          inputTokens,
          outputTokens,
          cost,
        };
      } catch (err) {
        loggingService.warn(
          'Claude InvokeModel stream failed, falling back to blocking invokeModel',
          {
            model: modelId,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }

    // Degraded mode: use blocking invokeModel and deliver full response in a single onChunk.
    const streamContext: BedrockInvokeModelContext = {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      useSystemPrompt: options.useSystemPrompt,
      system: options.system,
    };
    const result = await this.invokeModel(
      prompt,
      modelId,
      messages.length > 1
        ? {
            ...streamContext,
            recentMessages: messages.slice(0, -1).map((m) => ({
              role: m.role,
              content: m.content,
            })),
          }
        : streamContext,
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
      fullReasoning,
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
