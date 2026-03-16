/**
 * Normalization Service for NestJS
 *
 * Converts between provider-specific formats and normalized formats,
 * ensuring consistent handling across all providers.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PricingRegistryService } from '../../modules/pricing/services/pricing-registry.service';

export interface NormalizedMessage {
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  name?: string;
  function_call?: any;
}

export interface NormalizedParameters {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  frequencyPenalty?: number;
  presencePenalty?: number;
  logitBias?: Record<string, number>;
  user?: string;
  suffix?: string;
  logprobs?: number;
  echo?: boolean;
  bestOf?: number;
  stream?: boolean;
}

export interface NormalizedRequest {
  prompt: string;
  model: string;
  messages: NormalizedMessage[];
  systemMessage?: string;
  parameters: NormalizedParameters;
  metadata: {
    requestId?: string;
    userId?: string;
    organizationId?: string;
    timestamp: Date;
    source: string;
    provider?: string;
    costTracking?: {
      estimatedInputTokens?: number;
      estimatedOutputTokens?: number;
      estimatedCost?: number;
    };
  };
}

export interface NormalizedFinishReason {
  type:
    | 'stop'
    | 'length'
    | 'content_filter'
    | 'function_call'
    | 'cancelled'
    | 'error';
  reason?: string;
  details?: any;
}

export interface NormalizedUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost?: {
    inputCost: number;
    outputCost: number;
    totalCost: number;
    currency: string;
  };
}

export interface NormalizedResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: NormalizedMessage;
    finish_reason: NormalizedFinishReason;
    logprobs?: any;
  }>;
  usage: NormalizedUsage;
  metadata: {
    provider: string;
    latencyMs: number;
    requestId?: string;
    normalized: true;
  };
}

export interface NormalizedError {
  type: NormalizedErrorType;
  code: string;
  message: string;
  details?: any;
  retryable: boolean;
  providerError?: any;
}

export enum NormalizedErrorType {
  INVALID_REQUEST = 'invalid_request',
  AUTHENTICATION = 'authentication',
  PERMISSION_DENIED = 'permission_denied',
  NOT_FOUND = 'not_found',
  RATE_LIMIT = 'rate_limit',
  QUOTA_EXCEEDED = 'quota_exceeded',
  SERVER_ERROR = 'server_error',
  NETWORK_ERROR = 'network_error',
  TIMEOUT = 'timeout',
  CONTENT_FILTER = 'content_filter',
  UNKNOWN = 'unknown',
}

@Injectable()
export class NormalizationService {
  private readonly logger = new Logger(NormalizationService.name);

  constructor(
    private readonly pricingRegistryService: PricingRegistryService,
  ) {}

  /**
   * Normalize a request from various input formats
   */
  async normalizeRequest(
    prompt: string,
    model: string,
    options?: {
      systemMessage?: string;
      recentMessages?: Array<{ role: string; content: string }>;
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      topK?: number;
      stopSequences?: string[];
      frequencyPenalty?: number;
      presencePenalty?: number;
      logitBias?: Record<string, number>;
      user?: string;
      suffix?: string;
      logprobs?: number;
      echo?: boolean;
      bestOf?: number;
      stream?: boolean;
    },
    metadata?: {
      userId?: string;
      requestId?: string;
      organizationId?: string;
      source?: string;
      provider?: string;
    },
  ): Promise<NormalizedRequest> {
    const messages: NormalizedMessage[] = [];

    // Add system message if provided
    if (options?.systemMessage) {
      messages.push({
        role: 'system',
        content: options.systemMessage,
      });
    }

    // Add recent messages if provided
    if (options?.recentMessages && options.recentMessages.length > 0) {
      messages.push(
        ...options.recentMessages.map((msg) => ({
          role: msg.role as NormalizedMessage['role'],
          content: msg.content,
        })),
      );
    }

    // Add current prompt
    messages.push({
      role: 'user',
      content: prompt,
    });

    const normalizedParams = this.normalizeParameters(options);

    return {
      prompt,
      model,
      messages,
      systemMessage: options?.systemMessage,
      parameters: normalizedParams,
      metadata: {
        requestId: metadata?.requestId,
        userId: metadata?.userId,
        organizationId: metadata?.organizationId,
        timestamp: new Date(),
        source: metadata?.source || 'api',
        provider: metadata?.provider,
        costTracking: await this.estimateCost(model, normalizedParams),
      },
    };
  }

  /**
   * Normalize generation parameters
   */
  private normalizeParameters(options?: any): NormalizedParameters {
    if (!options) return {};

    return {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      topP: options.topP,
      topK: options.topK,
      stopSequences: options.stopSequences,
      frequencyPenalty: options.frequencyPenalty,
      presencePenalty: options.presencePenalty,
      logitBias: options.logitBias,
      user: options.user,
      suffix: options.suffix,
      logprobs: options.logprobs,
      echo: options.echo,
      bestOf: options.bestOf,
      stream: options.stream,
    };
  }

  /**
   * Estimate cost for a request
   */
  private async estimateCost(
    model: string,
    params: NormalizedParameters,
  ): Promise<
    | {
        estimatedInputTokens?: number;
        estimatedOutputTokens?: number;
        estimatedCost?: number;
      }
    | undefined
  > {
    try {
      // Rough token estimation based on model and parameters
      const estimatedInputTokens = this.estimateTokens(model, 'input');
      const estimatedOutputTokens =
        params.maxTokens || this.estimateTokens(model, 'output');

      // Sophisticated cost estimation using real-time pricing service
      const [costPerInputToken, costPerOutputToken] = await Promise.all([
        this.getCostPerToken(model, 'input'),
        this.getCostPerToken(model, 'output'),
      ]);

      const estimatedCost =
        (estimatedInputTokens * costPerInputToken +
          estimatedOutputTokens * costPerOutputToken) /
        1000000; // Convert to dollars

      return {
        estimatedInputTokens,
        estimatedOutputTokens,
        estimatedCost,
      };
    } catch (error) {
      this.logger.warn('Failed to estimate cost', {
        model,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  /**
   * Estimate token count for a model and type
   */
  private estimateTokens(model: string, type: 'input' | 'output'): number {
    // Rough estimates based on common model sizes
    const modelEstimates: Record<string, { input: number; output: number }> = {
      'gpt-4': { input: 4000, output: 2000 },
      'gpt-4-turbo': { input: 4000, output: 2000 },
      'gpt-3.5-turbo': { input: 2000, output: 1000 },
      'claude-3-opus': { input: 3000, output: 1500 },
      'claude-3-sonnet': { input: 3000, output: 1500 },
      'claude-3-haiku': { input: 2500, output: 1250 },
      'gemini-pro': { input: 2000, output: 1000 },
      'llama-2-70b': { input: 3000, output: 1500 },
    };

    const modelKey = Object.keys(modelEstimates).find((key) =>
      model.includes(key),
    );
    const estimate = modelEstimates[modelKey || 'gpt-3.5-turbo'];

    return estimate[type];
  }

  /**
   * Get cost per token for a model
   */
  private async getCostPerToken(
    model: string,
    type: 'input' | 'output',
  ): Promise<number> {
    try {
      // Use the pricing registry service for accurate, up-to-date pricing
      const pricing = this.pricingRegistryService.getPricing(model);
      if (!pricing) {
        this.logger.warn(`No pricing found for model ${model}, using fallback`);
        return 0.001; // $0.001 per token as fallback
      }

      // inputPricePerK/outputPricePerK are per 1000 tokens
      const costPerToken =
        type === 'input'
          ? pricing.inputPricePerK / 1000
          : pricing.outputPricePerK / 1000;
      return costPerToken;
    } catch (error) {
      this.logger.error(`Failed to get pricing for model ${model}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0.001; // Fallback pricing
    }
  }

  /**
   * Normalize a provider response to standard format
   */
  async normalizeResponse(
    providerResponse: any,
    latencyMs: number,
    options?: {
      requestId?: string;
      provider: string;
      model: string;
    },
  ): Promise<NormalizedResponse> {
    try {
      const provider = options?.provider || 'unknown';
      const model = options?.model || providerResponse.model || 'unknown';

      // Normalize choices/messages
      const choices = this.normalizeChoices(providerResponse, provider);

      // Normalize usage statistics
      const usage = await this.normalizeUsage(
        providerResponse,
        provider,
        model,
      );

      return {
        id: providerResponse.id || this.generateId(),
        object: providerResponse.object || 'text_completion',
        created: providerResponse.created || Math.floor(Date.now() / 1000),
        model,
        choices,
        usage,
        metadata: {
          provider,
          latencyMs,
          requestId: options?.requestId,
          normalized: true,
        },
      };
    } catch (error) {
      this.logger.error('Failed to normalize response', {
        provider: options?.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Normalize response choices/messages
   */
  private normalizeChoices(
    providerResponse: any,
    provider: string,
  ): NormalizedResponse['choices'] {
    const choices: NormalizedResponse['choices'] = [];

    // Handle different provider response formats
    if (providerResponse.choices) {
      // OpenAI-style
      for (const choice of providerResponse.choices) {
        choices.push({
          index: choice.index || 0,
          message: this.normalizeMessage(
            choice.message || choice.text,
            provider,
          ),
          finish_reason: this.normalizeFinishReason(
            choice.finish_reason,
            provider,
          ),
          logprobs: choice.logprobs,
        });
      }
    } else if (providerResponse.content || providerResponse.text) {
      // Simple text response
      choices.push({
        index: 0,
        message: this.normalizeMessage(
          providerResponse.content || providerResponse.text,
          provider,
        ),
        finish_reason: { type: 'stop' },
      });
    } else if (providerResponse.candidates) {
      // Google-style
      for (const candidate of providerResponse.candidates) {
        choices.push({
          index: candidate.index || 0,
          message: this.normalizeMessage(candidate.content, provider),
          finish_reason: this.normalizeFinishReason(
            candidate.finishReason,
            provider,
          ),
        });
      }
    } else {
      // Fallback
      choices.push({
        index: 0,
        message: {
          role: 'assistant',
          content: String(providerResponse),
        },
        finish_reason: { type: 'stop' },
      });
    }

    return choices;
  }

  /**
   * Normalize a message from provider format
   */
  private normalizeMessage(message: any, provider: string): NormalizedMessage {
    if (typeof message === 'string') {
      return {
        role: 'assistant',
        content: message,
      };
    }

    if (!message) {
      return {
        role: 'assistant',
        content: '',
      };
    }

    // Handle different provider message formats
    switch (provider.toLowerCase()) {
      case 'openai':
      case 'azure':
        return {
          role: message.role || 'assistant',
          content: message.content || '',
          name: message.name,
          function_call: message.function_call,
        };

      case 'anthropic':
        return {
          role: 'assistant',
          content: message.content || '',
        };

      case 'google':
        return {
          role: 'assistant',
          content: message.parts?.map((p: any) => p.text).join('') || '',
        };

      case 'cohere':
      case 'mistral':
        return {
          role: message.role || 'assistant',
          content:
            typeof message.content === 'string'
              ? message.content
              : message.text || '',
        };

      default:
        return {
          role: message.role || 'assistant',
          content: message.content || String(message),
        };
    }
  }

  /**
   * Normalize finish reason
   */
  private normalizeFinishReason(
    reason: any,
    provider: string,
  ): NormalizedFinishReason {
    if (!reason) {
      return { type: 'stop' };
    }

    if (typeof reason === 'string') {
      switch (reason.toLowerCase()) {
        case 'stop':
        case 'end_turn':
          return { type: 'stop' };
        case 'length':
        case 'max_tokens':
          return { type: 'length' };
        case 'content_filter':
        case 'safety':
          return { type: 'content_filter' };
        case 'function_call':
          return { type: 'function_call' };
        default:
          return { type: 'stop', reason };
      }
    }

    return { type: reason.type || 'stop', reason: reason.reason };
  }

  /**
   * Normalize usage statistics
   */
  private async normalizeUsage(
    providerResponse: any,
    provider: string,
    model: string,
  ): Promise<NormalizedUsage> {
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    // Extract usage from different provider formats
    switch (provider.toLowerCase()) {
      case 'openai':
      case 'azure':
        promptTokens = providerResponse.usage?.prompt_tokens || 0;
        completionTokens = providerResponse.usage?.completion_tokens || 0;
        totalTokens =
          providerResponse.usage?.total_tokens ||
          promptTokens + completionTokens;
        break;

      case 'anthropic':
        promptTokens = providerResponse.usage?.input_tokens || 0;
        completionTokens = providerResponse.usage?.output_tokens || 0;
        totalTokens = promptTokens + completionTokens;
        break;

      case 'google':
        promptTokens = providerResponse.usageMetadata?.promptTokenCount || 0;
        completionTokens =
          providerResponse.usageMetadata?.candidatesTokenCount || 0;
        totalTokens =
          providerResponse.usageMetadata?.totalTokenCount ||
          promptTokens + completionTokens;
        break;

      case 'cohere':
        promptTokens = providerResponse.meta?.billed_units?.input_tokens || 0;
        completionTokens =
          providerResponse.meta?.billed_units?.output_tokens || 0;
        totalTokens = promptTokens + completionTokens;
        break;

      case 'mistral':
        promptTokens = providerResponse.usage?.prompt_tokens || 0;
        completionTokens = providerResponse.usage?.completion_tokens || 0;
        totalTokens =
          providerResponse.usage?.total_tokens ||
          promptTokens + completionTokens;
        break;

      default:
        // Estimate based on content length
        const content = this.extractContent(providerResponse);
        promptTokens = Math.ceil(content.length / 4); // Rough estimate
        completionTokens = Math.ceil(
          (providerResponse.choices?.[0]?.message?.content?.length || 0) / 4,
        );
        totalTokens = promptTokens + completionTokens;
        break;
    }

    const usage: NormalizedUsage = {
      promptTokens,
      completionTokens,
      totalTokens,
    };

    // Add cost calculation if possible
    try {
      const cost = await this.calculateActualCost(model, usage);
      if (cost) {
        usage.estimatedCost = cost;
      }
    } catch (error) {
      this.logger.debug('Failed to calculate cost', {
        model,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return usage;
  }

  /**
   * Extract content from provider response for estimation
   */
  private extractContent(response: any): string {
    if (response.choices?.[0]?.message?.content) {
      return response.choices[0].message.content;
    }
    if (response.content) {
      return response.content;
    }
    if (response.text) {
      return response.text;
    }
    return '';
  }

  /**
   * Calculate actual cost based on usage
   */
  private async calculateActualCost(
    model: string,
    usage: NormalizedUsage,
  ): Promise<NormalizedUsage['estimatedCost']> {
    const inputCost =
      (usage.promptTokens * (await this.getCostPerToken(model, 'input'))) /
      1000000;
    const outputCost =
      (usage.completionTokens * (await this.getCostPerToken(model, 'output'))) /
      1000000;
    const totalCost = inputCost + outputCost;

    return {
      inputCost,
      outputCost,
      totalCost,
      currency: 'USD',
    };
  }

  /**
   * Normalize an error from provider format
   */
  normalizeError(providerError: any, provider: string): NormalizedError {
    const errorType = this.classifyError(providerError, provider);
    const retryable = this.isRetryableError(errorType);

    return {
      type: errorType,
      code: providerError.code || providerError.status?.toString() || 'UNKNOWN',
      message:
        providerError.message ||
        providerError.error?.message ||
        'Unknown error',
      details: providerError.details || providerError.error,
      retryable,
      providerError,
    };
  }

  /**
   * Classify error type
   */
  private classifyError(error: any, provider: string): NormalizedErrorType {
    const message = (error.message || error.error?.message || '').toLowerCase();
    const code = (error.code || error.status)?.toString().toLowerCase();

    // Authentication errors
    if (
      code === '401' ||
      code === '403' ||
      message.includes('auth') ||
      message.includes('token')
    ) {
      return NormalizedErrorType.AUTHENTICATION;
    }

    // Permission errors
    if (
      code === '403' ||
      message.includes('permission') ||
      message.includes('forbidden')
    ) {
      return NormalizedErrorType.PERMISSION_DENIED;
    }

    // Not found errors
    if (code === '404' || message.includes('not found')) {
      return NormalizedErrorType.NOT_FOUND;
    }

    // Rate limit errors
    if (
      code === '429' ||
      message.includes('rate limit') ||
      message.includes('quota')
    ) {
      return NormalizedErrorType.RATE_LIMIT;
    }

    // Quota exceeded
    if (message.includes('quota') || message.includes('limit exceeded')) {
      return NormalizedErrorType.QUOTA_EXCEEDED;
    }

    // Server errors
    if (
      code?.startsWith('5') ||
      message.includes('server error') ||
      message.includes('internal error')
    ) {
      return NormalizedErrorType.SERVER_ERROR;
    }

    // Network/timeout errors
    if (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('connection')
    ) {
      return NormalizedErrorType.TIMEOUT;
    }

    // Content filter
    if (
      message.includes('content filter') ||
      message.includes('safety') ||
      message.includes('moderation')
    ) {
      return NormalizedErrorType.CONTENT_FILTER;
    }

    // Invalid request
    if (
      code === '400' ||
      message.includes('invalid') ||
      message.includes('bad request')
    ) {
      return NormalizedErrorType.INVALID_REQUEST;
    }

    return NormalizedErrorType.UNKNOWN;
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(errorType: NormalizedErrorType): boolean {
    switch (errorType) {
      case NormalizedErrorType.SERVER_ERROR:
      case NormalizedErrorType.NETWORK_ERROR:
      case NormalizedErrorType.TIMEOUT:
      case NormalizedErrorType.RATE_LIMIT:
        return true;
      default:
        return false;
    }
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `norm_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
