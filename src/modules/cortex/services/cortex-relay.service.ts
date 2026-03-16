/**
 * Cortex Relay Service for NestJS
 * Orchestrates the complete Cortex processing pipeline using AWS Bedrock
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BedrockService } from '../../../services/bedrock.service';
import { CortexModelRouterService } from './cortex-model-router.service';
import { CortexEncoderService } from './cortex-encoder.service';
import { CortexDecoderService } from './cortex-decoder.service';

export interface CortexQuery {
  input: string;
  context?: any;
  options?: {
    modelId?: string;
    temperature?: number;
    maxTokens?: number;
    [key: string]: any;
  };
}

export interface CortexResponse {
  output: string;
  modelUsed: string;
  tokensUsed: number;
  cost: number;
  processingTime: number;
  metadata?: any;
}

@Injectable()
export class CortexRelayService {
  private readonly logger = new Logger(CortexRelayService.name);
  private readonly coreModelId: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly bedrockService: BedrockService,
    private readonly modelRouter: CortexModelRouterService,
    private readonly encoder: CortexEncoderService,
    private readonly decoder: CortexDecoderService,
  ) {
    this.coreModelId = this.configService.get<string>(
      'CORTEX_CORE_MODEL',
      'anthropic.claude-3-5-sonnet-20240620-v1:0',
    );
  }

  /**
   * Execute the complete Cortex relay pipeline
   */
  async execute(query: CortexQuery): Promise<CortexResponse> {
    const startTime = Date.now();

    try {
      this.logger.log('Starting Cortex relay execution', {
        inputLength: query.input.length,
        hasContext: !!query.context,
        modelOverride: query.options?.modelId,
      });

      // Select appropriate model for the query
      const selectedModel = await this.selectModel(query);

      // Encode the query for processing
      const encodedQuery = await this.encodeQuery(query, selectedModel);

      // Execute the query using Bedrock
      const bedrockResponse = await this.executeOnBedrock(
        encodedQuery,
        selectedModel,
      );

      // Decode and format the response
      const decodedResponse = await this.decodeResponse(bedrockResponse, query);

      // Calculate metrics
      const processingTime = Date.now() - startTime;
      const tokensUsed = this.estimateTokens(
        query.input,
        decodedResponse.output,
      );
      const cost = this.calculateCost(selectedModel, tokensUsed);

      const response: CortexResponse = {
        output: decodedResponse.output,
        modelUsed: selectedModel,
        tokensUsed,
        cost,
        processingTime,
        metadata: {
          selectedModel,
          encodedQuery: encodedQuery !== query.input,
          decodingApplied: true,
          relayUsed: true,
        },
      };

      this.logger.log('Cortex relay execution completed', {
        processingTime,
        tokensUsed,
        cost: cost.toFixed(6),
        modelUsed: selectedModel,
      });

      return response;
    } catch (error) {
      this.logger.error('Cortex relay execution failed', {
        error: error instanceof Error ? error.message : String(error),
        processingTime: Date.now() - startTime,
        inputLength: query.input.length,
      });
      throw error;
    }
  }

  /**
   * Select appropriate model for the query
   */
  private async selectModel(query: CortexQuery): Promise<string> {
    if (query.options?.modelId) {
      return query.options.modelId;
    }

    // Use model router to select optimal model
    try {
      const complexity = this.modelRouter.analyzePromptComplexity(query.input);
      const routingDecision =
        await this.modelRouter.makeRoutingDecisionWithLatency(complexity, {
          maxCostPerRequest: query.options?.maxTokens
            ? query.options.maxTokens * 0.0001
            : undefined,
          maxProcessingTime: 30000,
          preferredModels: query.options?.modelId
            ? { core: query.options.modelId }
            : undefined,
        });
      return routingDecision.selectedTier.models.core;
    } catch (error) {
      this.logger.warn('Model routing failed, using default model', {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.coreModelId;
    }
  }

  /**
   * Encode query for processing with proper formatting and context enrichment
   */
  private async encodeQuery(
    query: CortexQuery,
    modelId: string,
  ): Promise<string> {
    try {
      // Build comprehensive context
      const contextParts = [];

      // Add system context if available
      if (query.context?.systemPrompt) {
        contextParts.push(`System: ${query.context.systemPrompt}`);
      }

      // Add conversation history if available
      if (
        query.context?.conversationHistory &&
        query.context.conversationHistory.length > 0
      ) {
        const recentHistory = query.context.conversationHistory.slice(-5); // Last 5 exchanges
        contextParts.push('Recent Conversation:');
        recentHistory.forEach(
          (exchange: { user?: string; assistant?: string }, index: number) => {
            contextParts.push(`  ${index + 1}. User: ${exchange.user}`);
            contextParts.push(`     Assistant: ${exchange.assistant}`);
          },
        );
      }

      // Add relevant documents/knowledge if available
      if (
        query.context?.relevantDocuments &&
        query.context.relevantDocuments.length > 0
      ) {
        contextParts.push('Relevant Information:');
        query.context.relevantDocuments
          .slice(0, 3)
          .forEach(
            (doc: { content?: string; text?: string }, index: number) => {
              const content = doc.content || doc.text || '';
              const truncated =
                content.length > 500
                  ? content.substring(0, 500) + '...'
                  : content;
              contextParts.push(`  [${index + 1}] ${truncated}`);
            },
          );
      }

      // Add query metadata
      if (
        query.options?.temperature !== undefined ||
        query.options?.maxTokens
      ) {
        contextParts.push(
          `Query Parameters: temperature=${query.options.temperature || 0.7}, maxTokens=${query.options.maxTokens || 1000}`,
        );
      }

      // Format the final prompt
      let finalPrompt = query.input;

      if (contextParts.length > 0) {
        finalPrompt = `${contextParts.join('\n\n')}\n\nCurrent Query: ${query.input}`;
      }

      // Apply model-specific formatting
      if (modelId.includes('claude')) {
        finalPrompt = `\n\nHuman: ${finalPrompt}\n\nAssistant:`;
      } else if (modelId.includes('gpt')) {
        // GPT models work well with plain text
      }

      this.logger.debug('Query encoded successfully', {
        originalLength: query.input.length,
        encodedLength: finalPrompt.length,
        contextParts: contextParts.length,
        modelId,
      });

      return finalPrompt;
    } catch (error) {
      this.logger.error('Query encoding failed', {
        error: error instanceof Error ? error.message : String(error),
        modelId,
        queryLength: query.input.length,
      });
      // Return original query as fallback
      return query.input;
    }
  }

  /**
   * Execute query on Bedrock
   */
  private async executeOnBedrock(
    encodedQuery: string,
    modelId: string,
  ): Promise<any> {
    const temperature = 0.7;
    const maxTokens = 2000;

    return await this.bedrockService.invokeModelDirectly(modelId, {
      prompt: encodedQuery,
      max_tokens: maxTokens,
      temperature,
      stop_sequences: [],
    });
  }

  /**
   * Decode and format response with validation and post-processing
   */
  private async decodeResponse(
    bedrockResponse: any,
    originalQuery: CortexQuery,
  ): Promise<{ output: string }> {
    try {
      // Extract raw output from various possible response formats
      let rawOutput = '';

      if (typeof bedrockResponse === 'string') {
        rawOutput = bedrockResponse;
      } else if (bedrockResponse?.content) {
        // Handle Anthropic/Bedrock content format
        if (Array.isArray(bedrockResponse.content)) {
          rawOutput = bedrockResponse.content
            .map((c: any) => c.text || c)
            .join('');
        } else {
          rawOutput = bedrockResponse.content;
        }
      } else if (bedrockResponse?.response) {
        rawOutput = bedrockResponse.response;
      } else if (bedrockResponse?.output) {
        rawOutput = bedrockResponse.output;
      } else if (bedrockResponse?.text) {
        rawOutput = bedrockResponse.text;
      } else if (bedrockResponse?.completion) {
        rawOutput = bedrockResponse.completion;
      }

      // Clean and validate the output
      if (!rawOutput || typeof rawOutput !== 'string') {
        throw new Error('Invalid or empty response from model');
      }

      // Remove model-specific artifacts
      let cleanedOutput = rawOutput.trim();

      // Remove Anthropic assistant prefixes if present
      if (cleanedOutput.startsWith('Assistant:')) {
        cleanedOutput = cleanedOutput.substring(10).trim();
      }

      // Validate output quality
      if (cleanedOutput.length === 0) {
        throw new Error('Model returned empty response');
      }

      // Check for common error indicators
      const errorPatterns = [
        /^I'm sorry,/i,
        /^I apologize,/i,
        /^I cannot assist/i,
        /^I'm unable to/i,
        /error|failed|unable/i,
      ];

      const hasErrors = errorPatterns.some((pattern) =>
        pattern.test(cleanedOutput),
      );
      if (hasErrors && cleanedOutput.length < 100) {
        this.logger.warn('Model response appears to contain errors', {
          response: cleanedOutput.substring(0, 200),
        });
      }

      // Apply post-processing based on query type
      if (originalQuery.options?.responseFormat === 'json') {
        try {
          // Validate JSON if requested
          JSON.parse(cleanedOutput);
        } catch (jsonError) {
          this.logger.warn(
            'Response requested JSON format but parsing failed',
            {
              error:
                jsonError instanceof Error
                  ? jsonError.message
                  : String(jsonError),
            },
          );
        }
      }

      this.logger.debug('Response decoded successfully', {
        originalLength: rawOutput.length,
        cleanedLength: cleanedOutput.length,
        hasErrors,
        modelId: bedrockResponse?.modelId,
      });

      return { output: cleanedOutput };
    } catch (error) {
      this.logger.error('Response decoding failed', {
        error: error instanceof Error ? error.message : String(error),
        responseType: typeof bedrockResponse,
        hasContent: !!bedrockResponse?.content,
        hasResponse: !!bedrockResponse?.response,
      });

      // Provide meaningful fallback
      const fallbackOutput =
        bedrockResponse?.error?.message ||
        bedrockResponse?.message ||
        'Error: Unable to process model response';

      return { output: fallbackOutput };
    }
  }

  /**
   * Estimate tokens used (simplified calculation)
   */
  private estimateTokens(input: string, output: string): number {
    // Rough estimation: ~4 characters per token for English text
    const totalChars = input.length + output.length;
    return Math.ceil(totalChars / 4);
  }

  /**
   * Calculate cost (simplified calculation)
   */
  /**
   * Calculate cost based on modelId and tokens used.
   * If modelId is recognized, use its specific pricing; otherwise use default.
   */
  private calculateCost(modelId: string, tokensUsed: number): number {
    // Example per-1K-token pricing by model; extend as needed.
    const modelPricing: Record<string, number> = {
      'anthropic.claude-v2': 0.008,
      'anthropic.claude-instant-v1': 0.002,
      'ai21.j2-mid': 0.005,
      'ai21.j2-ultra': 0.009,
      // Add more modelIds and prices as desired
    };
    // Default price if model not listed
    const defaultCostPerThousandTokens = 0.001; // $0.001 per 1K tokens

    const costPerThousandTokens =
      modelPricing[modelId] ?? defaultCostPerThousandTokens;
    return (tokensUsed / 1000) * costPerThousandTokens;
  }
}
