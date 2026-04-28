/**
 * Traced AI Service for NestJS
 * Wraps AI router service with tracing capabilities for all AI provider calls
 */

import { Injectable, Logger, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { trace } from '@opentelemetry/api';
import * as crypto from 'crypto';
import { LangSmithService } from './langsmith.service';

export interface TracedAIContext {
  recentMessages?: Array<{ role: string; content: string }>;
  useSystemPrompt?: boolean;
  traceContext?: {
    traceId?: string;
    sessionId?: string;
    userId?: string;
    requestId?: string;
  };
  executionContext?: ExecutionContext;
}

export interface TracedAIResponse {
  response: AIModelResponse | null;
  traceId?: string;
  latency: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    /** Anthropic prompt-cache hits (billed at ~0.1x input rate). */
    cacheReadInputTokens?: number;
    /** Anthropic prompt-cache writes (billed at ~1.25x input rate). */
    cacheCreationInputTokens?: number;
    /** OpenAI o1/o3 reasoning tokens (subset of completionTokens). */
    reasoningTokens?: number;
  };
  cost?: number;
  error?: string;
}

/** Normalized response shape from AI model execution */
export interface AIModelResponse {
  content?: string;
  model: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  finish_reason?: string;
}

interface InvocationRecord {
  timestamp: number;
  sessionId?: string;
  model: string;
  latency: number;
  success: boolean;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
}

const TRACER = trace.getTracer('cost-katana-nest', '1.0');
const MAX_INVOCATION_RECORDS = 10_000;

@Injectable()
export class TracedAIService {
  private readonly logger = new Logger(TracedAIService.name);
  private readonly invocationHistory: InvocationRecord[] = [];

  constructor(
    private readonly configService: ConfigService,
    private readonly langSmithService: LangSmithService,
  ) {}

  /**
   * Wrapped invokeModel that adds tracing to all AI calls
   */
  async invokeModel(
    prompt: string,
    model: string,
    context?: TracedAIContext,
  ): Promise<TracedAIResponse> {
    const startTime = Date.now();
    const traceContext = context?.traceContext;
    const sessionId = traceContext?.sessionId;
    const userId = traceContext?.userId;
    const requestId = traceContext?.requestId;

    const span = TRACER.startSpan(`AI: ${model}`, {
      attributes: {
        'ai.model': model,
        'ai.prompt.length': prompt.length,
        'ai.prompt.preview': prompt.substring(0, 200),
        'ai.provider': this.detectProvider(model),
        ...(userId && { 'user.id': userId }),
        ...(requestId && { 'request.id': requestId }),
        ...(sessionId && { 'session.id': sessionId }),
      },
    });

    let langSmithRunId: string | null = null;

    try {
      if (sessionId) {
        langSmithRunId = await this.langSmithService.createRun(
          `AI: ${model}`,
          'llm',
          {
            prompt: prompt.substring(0, 500),
            model,
            provider: this.detectProvider(model),
          },
          {
            sessionId,
            userId,
            requestId,
            promptLength: prompt.length,
          },
        );
      }

      const aiParams = {
        prompt,
        model,
        messages: context?.recentMessages || [],
        useSystemPrompt: context?.useSystemPrompt,
        traceContext,
      };

      const response = await this.executeAIModel(aiParams);

      const latency = Date.now() - startTime;

      span.setAttribute('ai.response.length', response?.content?.length ?? 0);
      span.setAttribute('ai.latency', latency);
      span.setAttribute('ai.success', true);
      span.end();

      if (langSmithRunId) {
        await this.langSmithService.endRun(langSmithRunId, {
          response: response?.content
            ? { content: response.content.substring(0, 500) }
            : {},
          latency,
          success: true,
          usage: response?.usage,
        });
      }

      const tokenUsage = this.extractTokenUsage(response);
      const cost = this.calculateCost(model, tokenUsage);

      this.recordInvocation({
        timestamp: startTime,
        sessionId: sessionId ?? undefined,
        model,
        latency,
        success: true,
        promptTokens: tokenUsage?.promptTokens ?? 0,
        completionTokens: tokenUsage?.completionTokens ?? 0,
        totalTokens: tokenUsage?.totalTokens ?? 0,
        cost,
      });

      this.logger.log('AI model invocation completed', {
        model,
        latency,
        success: true,
        tokenUsage,
        cost,
        sessionId,
        userId,
      });

      return {
        response,
        traceId: span.spanContext().traceId,
        latency,
        tokenUsage,
        cost,
      };
    } catch (error) {
      const latency = Date.now() - startTime;

      span.setAttribute('ai.latency', latency);
      span.setAttribute('ai.success', false);
      span.setAttribute(
        'ai.error',
        error instanceof Error ? error.message : String(error),
      );
      span.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      span.end();

      if (langSmithRunId) {
        await this.langSmithService.endRun(
          langSmithRunId,
          { latency, success: false },
          error instanceof Error ? error.message : String(error),
        );
      }

      this.recordInvocation({
        timestamp: startTime,
        sessionId: sessionId ?? undefined,
        model,
        latency,
        success: false,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: 0,
      });

      this.logger.error('AI model invocation failed', {
        model,
        latency,
        error: error instanceof Error ? error.message : String(error),
        sessionId,
        userId,
      });

      return {
        response: null,
        traceId: span.spanContext().traceId,
        latency,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Batch invoke multiple AI models with tracing
   */
  async invokeModelsBatch(
    requests: Array<{
      prompt: string;
      model: string;
      context?: TracedAIContext;
    }>,
  ): Promise<TracedAIResponse[]> {
    const batchTraceId = this.generateBatchTraceId();
    const startTime = Date.now();

    const batchSpan = TRACER.startSpan('AI Batch Invocation', {
      attributes: {
        'ai.batch.size': requests.length,
        'ai.batch.trace_id': batchTraceId,
      },
    });

    try {
      const promises = requests.map((request, index) => {
        const requestContext = {
          ...request.context,
          traceContext: {
            ...request.context?.traceContext,
            batchTraceId,
            batchIndex: index,
          },
        };
        return this.invokeModel(request.prompt, request.model, requestContext);
      });

      const results = await Promise.allSettled(promises);

      const successful = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;
      const latency = Date.now() - startTime;

      batchSpan.setAttribute('ai.batch.successful', successful);
      batchSpan.setAttribute('ai.batch.failed', failed);
      batchSpan.setAttribute('ai.batch.latency', latency);
      batchSpan.end();

      this.logger.log('AI batch invocation completed', {
        batchSize: requests.length,
        successful,
        failed,
        latency,
        batchTraceId,
      });

      return results.map((result) =>
        result.status === 'fulfilled'
          ? result.value
          : {
              response: null,
              latency: Date.now() - startTime,
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            },
      );
    } catch (error) {
      batchSpan.recordException(
        error instanceof Error ? error : new Error(String(error)),
      );
      batchSpan.end();
      this.logger.error('AI batch invocation failed', {
        batchSize: requests.length,
        error: error instanceof Error ? error.message : String(error),
        batchTraceId,
      });
      throw error;
    }
  }

  /**
   * Get tracing statistics from in-memory invocation history
   */
  async getTracingStats(
    sessionId?: string,
    timeRange?: { start: Date; end: Date },
  ): Promise<{
    totalCalls: number;
    averageLatency: number;
    successRate: number;
    totalTokens: number;
    totalCost: number;
    modelUsage: Record<string, number>;
    errorRate: number;
  }> {
    await Promise.resolve(); // allow async integration later (e.g. DB)
    const start = timeRange?.start?.getTime() ?? 0;
    const end = timeRange?.end?.getTime() ?? Date.now();

    const filtered = this.invocationHistory.filter((r) => {
      if (r.timestamp < start || r.timestamp > end) return false;
      if (sessionId != null && r.sessionId !== sessionId) return false;
      return true;
    });

    if (filtered.length === 0) {
      return {
        totalCalls: 0,
        averageLatency: 0,
        successRate: 1.0,
        totalTokens: 0,
        totalCost: 0,
        modelUsage: {},
        errorRate: 0,
      };
    }

    const successful = filtered.filter((r) => r.success);
    const totalCalls = filtered.length;
    const totalLatency = filtered.reduce((s, r) => s + r.latency, 0);
    const totalTokens = filtered.reduce((s, r) => s + r.totalTokens, 0);
    const totalCost = filtered.reduce((s, r) => s + r.cost, 0);
    const modelUsage: Record<string, number> = {};
    for (const r of filtered) {
      modelUsage[r.model] = (modelUsage[r.model] ?? 0) + 1;
    }

    return {
      totalCalls,
      averageLatency: totalLatency / totalCalls,
      successRate: successful.length / totalCalls,
      totalTokens,
      totalCost,
      modelUsage,
      errorRate: 1 - successful.length / totalCalls,
    };
  }

  private recordInvocation(record: InvocationRecord): void {
    this.invocationHistory.push(record);
    if (this.invocationHistory.length > MAX_INVOCATION_RECORDS) {
      this.invocationHistory.shift();
    }
  }

  /**
   * Execute AI model call - requires external router to be properly configured
   */
  private async executeAIModel(params: {
    prompt: string;
    model: string;
    messages?: Array<{ role: string; content: string }>;
  }): Promise<AIModelResponse> {
    // Check if external router is available
    const routerUrl = this.configService.get<string>('AI_ROUTER_URL');
    const apiKey = this.configService.get<string>('AI_ROUTER_API_KEY');

    if (!routerUrl || !apiKey) {
      throw new Error(
        'AI router not configured. Please set AI_ROUTER_URL and AI_ROUTER_API_KEY environment variables. ' +
          'Mock responses are not available in production.',
      );
    }

    // Make actual API call to external router
    try {
      const response = await fetch(routerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: params.model,
          prompt: params.prompt,
          messages: params.messages,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `AI router returned ${response.status}: ${response.statusText}`,
        );
      }

      const result = await response.json();

      // Normalize response format
      return {
        content: result.content || result.response || result.text,
        model: params.model,
        usage: {
          prompt_tokens: result.usage?.prompt_tokens || 0,
          completion_tokens: result.usage?.completion_tokens || 0,
          total_tokens: result.usage?.total_tokens || 0,
        },
        finish_reason: result.finish_reason || 'stop',
      };
    } catch (error) {
      this.logger.error('AI router call failed', {
        component: 'TracedAIService',
        operation: 'executeAIModel',
        error: error instanceof Error ? error.message : String(error),
        model: params.model,
      });
      throw error;
    }
  }

  /**
   * Detect AI provider from model name
   */
  private detectProvider(model: string): string {
    if (model.includes('gpt') || model.includes('azure')) return 'openai';
    if (model.includes('claude')) return 'anthropic';
    if (model.includes('gemini')) return 'google';
    if (model.includes('llama') || model.includes('mistral')) return 'meta';
    return 'unknown';
  }

  /**
   * Extract token usage from response (OpenAI and Anthropic shapes).
   * Captures Anthropic prompt-cache fields and OpenAI reasoning tokens so
   * downstream cost calculation can apply the right per-token rates.
   */
  private extractTokenUsage(
    response: AIModelResponse | null,
  ): TracedAIResponse['tokenUsage'] {
    if (!response?.usage) return undefined;

    const u = response.usage;
    const promptTokens = u.prompt_tokens ?? u.input_tokens ?? 0;
    const completionTokens = u.completion_tokens ?? u.output_tokens ?? 0;
    const totalTokens = u.total_tokens ?? promptTokens + completionTokens;

    const out: NonNullable<TracedAIResponse['tokenUsage']> = {
      promptTokens,
      completionTokens,
      totalTokens,
    };

    if (typeof u.cache_read_input_tokens === 'number') {
      out.cacheReadInputTokens = u.cache_read_input_tokens;
    }
    if (typeof u.cache_creation_input_tokens === 'number') {
      out.cacheCreationInputTokens = u.cache_creation_input_tokens;
    }
    if (typeof u.completion_tokens_details?.reasoning_tokens === 'number') {
      out.reasoningTokens = u.completion_tokens_details.reasoning_tokens;
    }

    return out;
  }

  /**
   * Calculate cost from token usage and model (per-million rates for common providers)
   */
  private calculateCost(
    model: string,
    tokenUsage?: TracedAIResponse['tokenUsage'],
  ): number {
    if (!tokenUsage) return 0;

    const provider = this.detectProvider(model);
    const inputPerM = this.getInputCostPerMillion(provider, model);
    const outputPerM = this.getOutputCostPerMillion(provider, model);

    const inputCost = (tokenUsage.promptTokens * inputPerM) / 1_000_000;
    const outputCost = (tokenUsage.completionTokens * outputPerM) / 1_000_000;
    return inputCost + outputCost;
  }

  private getInputCostPerMillion(provider: string, model: string): number {
    if (provider === 'openai') {
      if (model.includes('gpt-4o') || model.includes('gpt-4-turbo')) return 2.5;
      if (model.includes('gpt-4')) return 30;
      return 0.5;
    }
    if (provider === 'anthropic') {
      if (model.includes('opus')) return 15;
      if (model.includes('sonnet')) return 3;
      return 0.25;
    }
    if (provider === 'google') return 0.5;
    if (provider === 'meta') return 0.7;
    return 0.5;
  }

  private getOutputCostPerMillion(provider: string, model: string): number {
    if (provider === 'openai') {
      if (model.includes('gpt-4o') || model.includes('gpt-4-turbo')) return 10;
      if (model.includes('gpt-4')) return 60;
      return 1.5;
    }
    if (provider === 'anthropic') {
      if (model.includes('opus')) return 75;
      if (model.includes('sonnet')) return 15;
      return 1.25;
    }
    if (provider === 'google') return 1.5;
    if (provider === 'meta') return 0.9;
    return 1.0;
  }

  private generateBatchTraceId(): string {
    return `batch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }
}
