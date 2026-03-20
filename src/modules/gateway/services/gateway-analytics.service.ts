import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CacheService } from '../../../common/cache/cache.service';
import { Usage } from '../../../schemas/core/usage.schema';
import {
  GatewayProviderMetrics,
  GatewayProviderMetricsDocument,
} from '../../../schemas/gateway/gateway-provider-metrics.schema';
import { CostSimulatorService } from '../../cost-simulator/cost-simulator.service';
import { estimateTokens } from '../../../utils/tokenCounter';

function stringifyGatewayMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        'text' in block &&
        typeof (block as { text: unknown }).text === 'string'
      ) {
        parts.push((block as { text: string }).text);
      }
    }
    return parts.join('');
  }
  if (typeof content === 'object') {
    try {
      return JSON.stringify(content);
    } catch {
      return '';
    }
  }
  if (typeof content === 'number' || typeof content === 'boolean') {
    return String(content);
  }
  return '';
}

/**
 * Persist the current user turn for Usage / dashboards — not the full thread.
 * Joining every message's `content` mixes prior assistant replies into "Request".
 */
function extractUsagePromptFromGatewayBody(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const b = body as Record<string, unknown>;
  if (typeof b.prompt === 'string' && b.prompt.trim()) return b.prompt;
  const messages = b.messages;
  if (!Array.isArray(messages) || messages.length === 0) return '';
  const userMessages = messages.filter((m): m is Record<string, unknown> => {
    if (m === null || typeof m !== 'object') return false;
    const rec = m as Record<string, unknown>;
    return rec.role === 'user';
  });
  const lastUser = userMessages[userMessages.length - 1];
  if (!lastUser) return '';
  return stringifyGatewayMessageContent(lastUser.content);
}

/** True when the OpenAI/Anthropic-style body carries more than one chat message. */
function requestBodyHasMultipleChatMessages(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const m = (body as Record<string, unknown>).messages;
  return Array.isArray(m) && m.length > 1;
}

/** Map gateway context.provider to estimateTokens() provider hints (Claude-on-Bedrock → anthropic). */
function mapProviderForTokenEstimate(
  provider: string | undefined,
  model: string,
): string | undefined {
  const p = (provider || '').toLowerCase();
  const m = (model || '').toLowerCase();
  if (p.includes('bedrock')) {
    return m.includes('claude') ? 'anthropic' : undefined;
  }
  if (p.includes('anthropic')) return 'anthropic';
  if (p.includes('openai')) return 'openai';
  if (p.includes('google')) return 'google';
  if (p.includes('cohere')) return 'cohere';
  return undefined;
}

/**
 * Gateway Analytics Service - Handles usage tracking and analytics for gateway operations.
 * Uses Redis (CacheService) for hot path and MongoDB for durable persistence (production scalability).
 */
@Injectable()
export class GatewayAnalyticsService {
  private readonly logger = new Logger(GatewayAnalyticsService.name);

  /** Values allowed on Usage.service (Mongoose enum); must never persist `unknown` or ad-hoc provider names. */
  private static readonly USAGE_SCHEMA_SERVICES = new Set<string>([
    'openai',
    'aws-bedrock',
    'google-ai',
    'google',
    'anthropic',
    'huggingface',
    'cohere',
    'dashboard-analytics',
    'other',
  ]);

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<Usage>,
    @InjectModel(GatewayProviderMetrics.name)
    private gatewayProviderMetricsModel: Model<GatewayProviderMetricsDocument>,
    private cacheService: CacheService,
    private readonly costSimulatorService: CostSimulatorService,
  ) {}

  /**
   * Log request start for analytics
   */
  async logRequestStart(request: any): Promise<void> {
    try {
      const context = request.gatewayContext;
      const requestId =
        (request.headers['x-request-id'] as string) || 'unknown';

      this.logger.log('Gateway request started', {
        component: 'GatewayAnalyticsService',
        operation: 'logRequestStart',
        type: 'request_start',
        requestId,
        userId: context.userId,
        projectId: context.projectId,
        method: request.method,
        url: request.originalUrl,
        model: request.body?.model,
        provider: context.provider,
        timestamp: new Date().toISOString(),
      });

      // Store request start metrics in database (only Usage schema fields)
      try {
        const usageRecord = new this.usageModel({
          userId: context.userId,
          projectId: context.projectId,
          service: this.getEffectiveGatewayUsageService(request),
          model: request.body?.model || 'unknown',
          prompt: extractUsagePromptFromGatewayBody(request.body as unknown),
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          cost: 0,
          responseTime: 0,
          ipAddress: request.ip,
          userAgent: request.headers?.['user-agent'] as string | undefined,
          metadata: {
            requestId,
            method: request.method,
            url: request.originalUrl,
            gatewayContext: {
              provider: context.provider,
              model: request.body?.model,
              cacheEnabled: context.cacheEnabled,
              retryEnabled: context.retryEnabled,
            },
          },
          requestTracking: this.mergeGatewayRequestTracking(
            request,
            undefined,
            0,
          ) as any,
        });

        await usageRecord.save();

        // Store the usage record ID in context for later updates
        context.usageRecordId = usageRecord._id;

        this.logger.debug('Request start logged to database', {
          component: 'GatewayAnalyticsService',
          operation: 'logRequestStart',
          type: 'request_start_logged',
          requestId,
          usageRecordId: usageRecord._id.toString(),
        });
      } catch (dbError) {
        this.logger.warn('Failed to log request start to database', {
          component: 'GatewayAnalyticsService',
          operation: 'logRequestStart',
          type: 'request_start_log_error',
          requestId,
          error: dbError instanceof Error ? dbError.message : 'Unknown error',
        });
        // Don't fail the request if analytics logging fails
      }
    } catch (error: any) {
      this.logger.error('Failed to log request start', {
        component: 'GatewayAnalyticsService',
        operation: 'logRequestStart',
        type: 'request_start_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Adds `cost` (USD) to the provider JSON body when usage is present so clients can show spend.
   * Skips if `cost` is already set and positive.
   */
  async attachEstimatedCostToResponseBody(
    model: string,
    body: unknown,
  ): Promise<unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return body;
    }
    const rec = body as Record<string, unknown>;
    if (typeof rec.cost === 'number' && rec.cost > 0) {
      return body;
    }
    const extracted = this.extractTokensFromResponseBody(body);
    if (!extracted) {
      return body;
    }
    const cost = await this.calculateCostFromTokens(
      model || 'unknown',
      extracted.input,
      extracted.output,
    );
    return { ...rec, cost };
  }

  /**
   * Track usage after request completion
   */
  async trackUsage(
    request: any,
    response: any,
    retryAttempts: number = 0,
  ): Promise<void> {
    try {
      const context = request.gatewayContext;
      const requestId =
        (request.headers['x-request-id'] as string) || 'unknown';
      const processingTime = Date.now() - context.startTime;

      let inputTokens = context.inputTokens ?? 0;
      let outputTokens = context.outputTokens ?? 0;
      if (inputTokens === 0 && outputTokens === 0 && response) {
        const extracted = this.extractTokensFromResponseBody(response);
        if (extracted) {
          inputTokens = extracted.input;
          outputTokens = extracted.output;
        }
      }

      // Usage rows are always "this request as one turn": when the client sends multiple
      // chat messages (conversation memory), we still persist prompt + input token estimate
      // for the LAST user message only; output tokens stay provider-reported for this reply.
      let usageInputFromLastUserOnly = false;
      if (requestBodyHasMultipleChatMessages(request.body)) {
        const lastUserPrompt = extractUsagePromptFromGatewayBody(
          request.body as unknown,
        );
        if (lastUserPrompt.trim()) {
          const modelName = String(request.body?.model ?? 'unknown');
          const providerGuess = mapProviderForTokenEstimate(
            String(context.provider ?? ''),
            modelName,
          );
          inputTokens = estimateTokens(
            lastUserPrompt,
            providerGuess,
            modelName,
          );
          usageInputFromLastUserOnly = true;
        }
      }

      const totalTokens = inputTokens + outputTokens;

      let cost = context.cost ?? 0;
      if (usageInputFromLastUserOnly && (inputTokens > 0 || outputTokens > 0)) {
        cost = await this.calculateCostFromTokens(
          request.body?.model || 'unknown',
          inputTokens,
          outputTokens,
        );
      } else if (cost === 0 && (inputTokens > 0 || outputTokens > 0)) {
        cost = await this.calculateCostFromTokens(
          request.body?.model || 'unknown',
          inputTokens,
          outputTokens,
        );
      }

      const completionText =
        this.extractCompletionTextFromProviderResponse(response);

      this.logger.log('Tracking gateway usage', {
        component: 'GatewayAnalyticsService',
        operation: 'trackUsage',
        type: 'usage_tracking',
        requestId,
        userId: context.userId,
        projectId: context.projectId,
        model: request.body?.model,
        provider: context.provider,
        inputTokens,
        outputTokens,
        totalTokens,
        cost,
        retryAttempts,
        processingTime,
        timestamp: new Date().toISOString(),
      });

      const requestTrackingMerged = this.mergeGatewayRequestTracking(
        request,
        response,
        processingTime,
      ) as any;

      const metadataExtras: Record<string, unknown> = {
        gatewayProcessingTime: processingTime,
        retryAttempts,
        gatewayMetrics: {
          cacheHit: context.cacheHit || false,
          failoverUsed: context.failoverEnabled || false,
          cortexEnabled: context.cortexEnabled || false,
        },
      };

      // Store usage metrics in database (Usage schema fields only)
      try {
        if (context.usageRecordId) {
          const doc = await this.usageModel.findById(context.usageRecordId);
          if (doc) {
            doc.promptTokens = inputTokens;
            doc.completionTokens = outputTokens;
            doc.totalTokens = totalTokens;
            doc.cost = cost;
            doc.responseTime = processingTime;
            doc.completion = completionText || doc.completion;
            doc.requestTracking = requestTrackingMerged;
            doc.recordedAt = new Date();
            const prevMeta = (doc.metadata as Record<string, unknown>) || {};
            doc.metadata = {
              ...prevMeta,
              ...metadataExtras,
            } as any;
            await doc.save();

            this.logger.debug('Usage record updated in database', {
              component: 'GatewayAnalyticsService',
              operation: 'trackUsage',
              type: 'usage_updated',
              requestId,
              usageRecordId: context.usageRecordId.toString(),
            });
          }
        } else {
          const metadata: Record<string, unknown> = {
            requestId,
            method: request.method,
            url: request.originalUrl,
            ...metadataExtras,
          };
          if (context.proxyKeyId) {
            metadata.proxyKeyId = context.proxyKeyId;
          }
          if (context.apiKeyId) {
            metadata.apiKeyId = context.apiKeyId;
          }
          const usageRecord = new this.usageModel({
            userId: context.userId,
            projectId: context.projectId,
            service: this.getEffectiveGatewayUsageService(request),
            model: request.body?.model || 'unknown',
            prompt: extractUsagePromptFromGatewayBody(request.body as unknown),
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens,
            cost,
            responseTime: processingTime,
            completion: completionText,
            ipAddress: request.ip,
            userAgent: request.headers?.['user-agent'] as string | undefined,
            metadata,
            requestTracking: requestTrackingMerged,
            recordedAt: new Date(),
          });

          await usageRecord.save();

          this.logger.debug('New usage record created in database', {
            component: 'GatewayAnalyticsService',
            operation: 'trackUsage',
            type: 'usage_created',
            requestId,
            usageRecordId: usageRecord._id.toString(),
          });
        }
      } catch (dbError) {
        this.logger.warn('Failed to store usage metrics in database', {
          component: 'GatewayAnalyticsService',
          operation: 'trackUsage',
          type: 'usage_storage_error',
          requestId,
          error: dbError instanceof Error ? dbError.message : 'Unknown error',
        });
        // Don't fail the request if analytics storage fails
      }
    } catch (error: any) {
      this.logger.error('Failed to track usage', {
        component: 'GatewayAnalyticsService',
        operation: 'trackUsage',
        type: 'usage_tracking_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Track latency for provider/model combinations
   */
  async trackLatency(
    provider: string,
    model: string,
    latency: number,
    success: boolean,
  ): Promise<void> {
    try {
      this.logger.log('Tracking latency', {
        component: 'GatewayAnalyticsService',
        operation: 'trackLatency',
        type: 'latency_tracking',
        provider,
        model,
        latency,
        success,
        timestamp: new Date().toISOString(),
      });

      // Store latency metrics for provider routing decisions
      try {
        const cacheKey = `provider_latency:${provider}:${model}`;
        const existingMetrics = await this.getProviderMetrics(provider, model);

        const updatedMetrics = {
          provider,
          model,
          totalRequests: (existingMetrics?.totalRequests || 0) + 1,
          successfulRequests:
            (existingMetrics?.successfulRequests || 0) + (success ? 1 : 0),
          totalLatency: (existingMetrics?.totalLatency || 0) + latency,
          averageLatency: 0,
          lastUpdated: new Date(),
          recentLatencies: [
            ...(existingMetrics?.recentLatencies || []).slice(-9),
            latency,
          ],
        };

        updatedMetrics.averageLatency =
          updatedMetrics.totalLatency / updatedMetrics.totalRequests;

        await this.cacheProviderMetrics(cacheKey, updatedMetrics, 3600);
        await this.persistProviderMetricsToMongo(updatedMetrics);

        this.logger.debug('Latency metrics updated for provider routing', {
          component: 'GatewayAnalyticsService',
          operation: 'trackLatency',
          type: 'latency_stored',
          provider,
          model,
          newAverageLatency: Math.round(updatedMetrics.averageLatency),
          totalRequests: updatedMetrics.totalRequests,
          successRate: Math.round(
            (updatedMetrics.successfulRequests / updatedMetrics.totalRequests) *
              100,
          ),
        });
      } catch (dbError) {
        this.logger.warn('Failed to store latency metrics', {
          component: 'GatewayAnalyticsService',
          operation: 'trackLatency',
          type: 'latency_storage_error',
          provider,
          model,
          error: dbError instanceof Error ? dbError.message : 'Unknown error',
        });
      }
    } catch (error: any) {
      this.logger.error('Failed to track latency', {
        component: 'GatewayAnalyticsService',
        operation: 'trackLatency',
        type: 'latency_tracking_error',
        provider,
        model,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Record model performance metrics
   */
  async recordModelPerformance(
    request: any,
    response: any,
    context: any,
  ): Promise<void> {
    try {
      const requestId =
        (request.headers['x-request-id'] as string) || 'unknown';

      const responseStatus = response?.statusCode ?? response?.status ?? null;
      const responseBody = response?.body ?? undefined;

      const processingTime = Date.now() - (context.startTime || Date.now());

      let inputTokens = context.inputTokens ?? 0;
      let outputTokens = context.outputTokens ?? 0;
      if (inputTokens === 0 && outputTokens === 0 && responseBody) {
        const extracted = this.extractTokensFromResponseBody(responseBody);
        if (extracted) {
          inputTokens = extracted.input;
          outputTokens = extracted.output;
        }
      }

      // Compute cost if not present on context, optionally extract from response if needed
      const cost = context.cost || 0;

      const effectiveProvider = this.getEffectiveGatewayUsageService(request);

      // Basic fields for performance log
      const baseLog = {
        component: 'GatewayAnalyticsService',
        operation: 'recordModelPerformance',
        requestId,
        userId: context.userId,
        model: request.body?.model || 'unknown',
        provider: effectiveProvider,
        processingTime,
        inputTokens,
        outputTokens,
        cost,
      };

      this.logger.log('Recording model performance', {
        ...baseLog,
        type: 'model_performance',
        responseStatus,
        success:
          responseStatus && responseStatus >= 200 && responseStatus < 400,
      });

      // Store model performance metrics
      try {
        const performanceMetrics = {
          model: request.body?.model || 'unknown',
          provider: effectiveProvider,
          userId: context.userId,
          processingTime,
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
          cost,
          success:
            responseStatus && responseStatus >= 200 && responseStatus < 400,
          timestamp: new Date(),
          responseStatus,
          responseBody,
          requestMetadata: {
            requestId,
            cacheHit: context.cacheHit || false,
            retryAttempts: context.retryAttempts || 0,
            cortexEnabled: context.cortexEnabled || false,
          },
        };

        // Store in cache for quick access by routing decisions
        const cacheKey = `model_performance:${effectiveProvider}:${request.body?.model}`;
        await this.cacheModelPerformanceMetrics(cacheKey, performanceMetrics);

        this.logger.debug('Model performance metrics recorded', {
          ...baseLog,
          type: 'performance_recorded',
          processingTime,
          tokensPerSecond:
            processingTime > 0
              ? Math.round(
                  (inputTokens + outputTokens) / (processingTime / 1000),
                )
              : null,
          responseStatus,
        });
      } catch (dbError) {
        this.logger.warn('Failed to record model performance metrics', {
          ...baseLog,
          type: 'performance_recording_error',
          requestId,
          error: dbError instanceof Error ? dbError.message : 'Unknown error',
          responseStatus,
        });
      }
    } catch (error: any) {
      this.logger.error('Failed to record model performance', {
        component: 'GatewayAnalyticsService',
        operation: 'recordModelPerformance',
        type: 'model_performance_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Estimate request cost for budget checking
   */
  async estimateRequestCost(request: any, context: any): Promise<number> {
    try {
      const inputTokens =
        context.inputTokens || this.estimateTokens(request.body, 'input');
      const outputTokens =
        context.outputTokens || this.estimateTokens(request.body, 'output');

      const estimatedCost = await this.calculateCostFromTokens(
        request.body?.model || 'unknown',
        inputTokens,
        outputTokens,
      );

      this.logger.debug('Estimated request cost', {
        component: 'GatewayAnalyticsService',
        operation: 'estimateRequestCost',
        type: 'cost_estimation',
        inputTokens,
        outputTokens,
        estimatedCost,
        model: request.body?.model,
      });

      return estimatedCost;
    } catch (error: any) {
      this.logger.error('Failed to estimate request cost', {
        component: 'GatewayAnalyticsService',
        operation: 'estimateRequestCost',
        type: 'cost_estimation_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return 0;
    }
  }

  /**
   * Resolves Usage.service for gateway requests. Uses Bedrock flag, validated provider,
   * proxy target hostname, then gateway path heuristics. Always returns a Usage schema enum value.
   */
  getEffectiveGatewayUsageService(request: any): string {
    const context = request?.gatewayContext ?? {};
    if (context.useBedrockAnthropicFallback === true) {
      return 'aws-bedrock';
    }
    const p = context.provider;
    if (
      typeof p === 'string' &&
      GatewayAnalyticsService.USAGE_SCHEMA_SERVICES.has(p)
    ) {
      return p;
    }
    const target =
      typeof context.targetUrl === 'string' ? context.targetUrl.trim() : '';
    if (/^https?:\/\//i.test(target)) {
      const fromHost = this.inferServiceFromUrl(target);
      return this.mapInferredHostnameToUsageService(fromHost);
    }
    return this.inferUsageServiceFromGatewayPath(
      String(request?.originalUrl || request?.url || ''),
    );
  }

  /**
   * Map inferServiceFromUrl() output to a Usage.service enum value.
   */
  private mapInferredHostnameToUsageService(inferred: string): string {
    if (GatewayAnalyticsService.USAGE_SCHEMA_SERVICES.has(inferred)) {
      return inferred;
    }
    return 'other';
  }

  /**
   * When targetUrl is not yet set, infer from the gateway mount path (originalUrl is often relative).
   */
  private inferUsageServiceFromGatewayPath(originalUrl: string): string {
    const path = originalUrl.split('?')[0].toLowerCase();
    if (path.includes('/v1/messages')) return 'anthropic';
    if (
      path.includes('/v1/chat/completions') ||
      path.includes('/v1/embeddings') ||
      path.includes('/v1/images') ||
      path.includes('/v1/audio') ||
      path.includes('/v1/responses')
    ) {
      return 'openai';
    }
    if (
      path.includes('generativelanguage') ||
      path.includes('/models/') ||
      path.includes('google')
    ) {
      return 'google-ai';
    }
    if (path.includes('cohere')) return 'cohere';
    if (path.includes('bedrock') || path.includes('amazonaws.com'))
      return 'aws-bedrock';
    if (path.includes('huggingface')) return 'huggingface';
    return 'other';
  }

  /**
   * Infer service name from URL
   */
  inferServiceFromUrl(url: string): string {
    try {
      const hostname = new URL(url).hostname.toLowerCase();

      if (hostname.includes('openai.com')) return 'openai';
      if (hostname.includes('anthropic.com')) return 'anthropic';
      if (hostname.includes('googleapis.com')) return 'google-ai';
      if (hostname.includes('cohere.ai')) return 'cohere';
      if (hostname.includes('amazonaws.com')) return 'aws-bedrock';
      if (hostname.includes('azure.com')) return 'azure';
      if (hostname.includes('deepseek.com')) return 'deepseek';
      if (hostname.includes('groq.com')) return 'groq';
      if (hostname.includes('huggingface.co')) return 'huggingface';

      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Log failover request start
   */
  async logFailoverRequest(context: any, requestId: string): Promise<void> {
    try {
      this.logger.log('Failover request started', {
        component: 'GatewayAnalyticsService',
        operation: 'logFailoverRequest',
        type: 'failover_start',
        requestId,
        userId: context.userId,
        failoverPolicy: context.failoverPolicy,
        providers: context.failoverPolicy?.providers?.length || 0,
      });
    } catch (error: any) {
      this.logger.error('Failed to log failover request', {
        component: 'GatewayAnalyticsService',
        operation: 'logFailoverRequest',
        type: 'failover_log_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Log failover success
   */
  async logFailoverSuccess(
    context: any,
    failoverResult: any,
    requestId: string,
  ): Promise<void> {
    try {
      this.logger.log('Failover request succeeded', {
        component: 'GatewayAnalyticsService',
        operation: 'logFailoverSuccess',
        type: 'failover_success',
        requestId,
        userId: context.userId,
        successfulProvider: failoverResult.successfulProviderIndex,
        providersAttempted: failoverResult.providersAttempted,
        totalLatency: failoverResult.totalLatency,
      });
    } catch (error: any) {
      this.logger.error('Failed to log failover success', {
        component: 'GatewayAnalyticsService',
        operation: 'logFailoverSuccess',
        type: 'failover_success_log_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Log failover error
   */
  async logFailoverError(
    context: any,
    error: any,
    requestId: string,
  ): Promise<void> {
    try {
      this.logger.error('Failover request failed', {
        component: 'GatewayAnalyticsService',
        operation: 'logFailoverError',
        type: 'failover_error',
        requestId,
        userId: context.userId,
        error: error instanceof Error ? error.message : String(error),
        providersAttempted: error.providersAttempted || 0,
      });
    } catch (logError: any) {
      this.logger.error('Failed to log failover error', {
        component: 'GatewayAnalyticsService',
        operation: 'logFailoverError',
        type: 'failover_error_log_error',
        error: logError instanceof Error ? logError.message : 'Unknown error',
      });
    }
  }

  /**
   * Record simulation accuracy for cost estimation validation
   */
  async recordSimulationAccuracy(
    simulationId: string,
    actualCost: number,
    estimatedCost: number,
  ): Promise<void> {
    try {
      this.costSimulatorService.recordActualCost(
        simulationId,
        actualCost,
        estimatedCost,
      );

      const accuracy =
        estimatedCost > 0
          ? (
              (1 - Math.abs(actualCost - estimatedCost) / estimatedCost) *
              100
            ).toFixed(2) + '%'
          : 'N/A';

      const accuracyPercentage =
        estimatedCost > 0
          ? (1 - Math.abs(actualCost - estimatedCost) / estimatedCost) * 100
          : 0;

      this.logger.log('Recording simulation accuracy', {
        component: 'GatewayAnalyticsService',
        operation: 'recordSimulationAccuracy',
        type: 'simulation_accuracy',
        simulationId,
        actualCost,
        estimatedCost,
        accuracy,
      });

      // Store simulation accuracy metrics
      try {
        const simulationMetrics = {
          simulationId,
          actualCost,
          estimatedCost,
          accuracy,
          accuracyPercentage,
          timestamp: new Date(),
          costDifference: actualCost - estimatedCost,
          overUnderEstimate: actualCost > estimatedCost ? 'over' : 'under',
        };

        // Store in cache for quick access
        const cacheKey = `simulation_accuracy:${simulationId}`;
        await this.cacheSimulationMetrics(cacheKey, simulationMetrics, 86400); // 24 hours TTL

        // Could also store in a dedicated analytics collection for long-term tracking
        this.logger.debug('Simulation accuracy metrics recorded', {
          component: 'GatewayAnalyticsService',
          operation: 'recordSimulationAccuracy',
          type: 'simulation_accuracy_recorded',
          simulationId,
          accuracy: accuracyPercentage.toFixed(2) + '%',
          overUnderEstimate: simulationMetrics.overUnderEstimate,
          costDifference: simulationMetrics.costDifference.toFixed(6),
        });
      } catch (dbError) {
        this.logger.warn('Failed to record simulation accuracy metrics', {
          component: 'GatewayAnalyticsService',
          operation: 'recordSimulationAccuracy',
          type: 'simulation_accuracy_error',
          simulationId,
          error: dbError instanceof Error ? dbError.message : 'Unknown error',
        });
      }
    } catch (error: any) {
      this.logger.error('Failed to record simulation accuracy', {
        component: 'GatewayAnalyticsService',
        operation: 'recordSimulationAccuracy',
        type: 'simulation_accuracy_error',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Dollar cost from token counts using PricingService (per-1K token rates).
   */
  private async calculateCostFromTokens(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<number> {
    let inputPrice = 0.000001;
    let outputPrice = 0.000002;
    try {
      const { PricingService } =
        await import('../../utils/services/pricing.service');
      const pricingService = new PricingService();
      const pricing = pricingService.getModelPricing(model || 'unknown');
      if (pricing) {
        inputPrice = pricing.inputCostPerToken / 1000;
        outputPrice = pricing.outputCostPerToken / 1000;
      }
    } catch {
      // keep defaults
    }
    return inputTokens * inputPrice + outputTokens * outputPrice;
  }

  /**
   * Merge comprehensive middleware tracking with gateway request/response bodies for Usage.requestTracking.
   */
  private mergeGatewayRequestTracking(
    request: any,
    responseBody: unknown | undefined,
    processingTimeMs: number,
  ): Record<string, unknown> {
    const existing = request.requestTracking as
      | Record<string, unknown>
      | undefined;
    const payloadBase =
      (existing?.payload as Record<string, unknown> | undefined) || {};
    const payload: Record<string, unknown> = {
      ...payloadBase,
      requestBody: request.body,
    };
    if (responseBody !== undefined) {
      payload.responseBody = responseBody;
    }
    const perfBase = (existing?.performance as Record<string, unknown>) || {
      networkTime: 0,
      serverProcessingTime: 0,
      totalRoundTripTime: 0,
      dataTransferEfficiency: 0,
    };
    const performance = {
      ...perfBase,
      serverProcessingTime:
        processingTimeMs ||
        (perfBase.serverProcessingTime as number) ||
        0,
      totalRoundTripTime:
        processingTimeMs ||
        (perfBase.totalRoundTripTime as number) ||
        0,
    };
    if (existing) {
      return { ...existing, payload, performance };
    }
    const h = request.headers || {};
    return {
      clientInfo: {
        ip: request.ip || '',
        forwardedIPs: [] as string[],
        userAgent: (h['user-agent'] as string) || '',
      },
      headers: { request: {}, response: {} },
      networking: {
        serverEndpoint: String(request.originalUrl || request.path || ''),
        serverFullUrl: '',
        serverIP: '',
        serverPort: 0,
        routePattern: String(request.path || ''),
        protocol: 'http',
        secure: false,
      },
      payload: {
        ...payload,
        requestSize: 0,
        responseSize: 0,
        contentType: (h['content-type'] as string) || 'application/json',
      },
      performance,
    };
  }

  /**
   * Assistant text from OpenAI or Anthropic-shaped JSON bodies.
   */
  private extractCompletionTextFromProviderResponse(body: unknown): string {
    if (!body || typeof body !== 'object') {
      return '';
    }
    const r = body as Record<string, unknown>;
    if (Array.isArray(r.choices)) {
      return (r.choices as Record<string, unknown>[])
        .map(
          (c) =>
            String(
              (c.message as Record<string, unknown>)?.content ??
                c.text ??
                '',
            ),
        )
        .join('\n');
    }
    if (Array.isArray(r.content)) {
      return (r.content as Record<string, unknown>[])
        .map((block) =>
          typeof block === 'object' && block && 'text' in block
            ? String((block as Record<string, unknown>).text)
            : '',
        )
        .join('');
    }
    if (typeof r.output_text === 'string') {
      return r.output_text;
    }
    if (typeof r.completion === 'string') {
      return r.completion;
    }
    return '';
  }

  /**
   * Extract token counts from provider response body (OpenAI usage, Anthropic usage, etc.)
   */
  private extractTokensFromResponseBody(
    body: unknown,
  ): { input: number; output: number } | null {
    try {
      const obj =
        typeof body === 'string'
          ? (JSON.parse(body) as Record<string, unknown>)
          : body;
      if (!obj || typeof obj !== 'object') return null;
      const usage = (obj as Record<string, unknown>).usage;
      if (!usage || typeof usage !== 'object') return null;
      const u = usage as Record<string, unknown>;
      const input =
        (u.prompt_tokens as number) ??
        (u.input_tokens as number) ??
        (u.inputTokens as number) ??
        0;
      const output =
        (u.completion_tokens as number) ??
        (u.output_tokens as number) ??
        (u.outputTokens as number) ??
        0;
      if (
        typeof input === 'number' &&
        typeof output === 'number' &&
        (input > 0 || output > 0)
      ) {
        return { input, output };
      }
    } catch {
      // Ignore parse errors
    }
    return null;
  }

  /**
   * Estimate tokens for a request
   */
  private estimateTokens(
    requestBody: any,
    type: 'input' | 'output' = 'input',
  ): number {
    try {
      if (type === 'output') {
        // Conservative estimate for output tokens
        return 300;
      }

      // Estimate input tokens
      let content = '';

      if (requestBody?.messages && Array.isArray(requestBody.messages)) {
        content = requestBody.messages
          .map((msg: any) => msg.content || '')
          .join(' ');
      } else if (requestBody?.prompt) {
        content = requestBody.prompt;
      } else if (requestBody?.input) {
        content = requestBody.input;
      }

      // Rough estimation: ~4 characters per token
      return Math.ceil(content.length / 4);
    } catch (error) {
      this.logger.warn('Failed to estimate tokens', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return type === 'output' ? 300 : 1000;
    }
  }

  /**
   * Get provider metrics from Redis cache, fallback to MongoDB for durability.
   */
  private async getProviderMetrics(
    provider: string,
    model: string,
  ): Promise<{
    totalRequests?: number;
    successfulRequests?: number;
    totalLatency?: number;
    recentLatencies?: number[];
  } | null> {
    const cacheKey = `provider_latency:${provider}:${model}`;
    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) return cached;
    } catch (error) {
      this.logger.debug(
        'Cache miss for provider metrics, falling back to MongoDB',
        { provider, model },
      );
    }

    try {
      const doc = await this.gatewayProviderMetricsModel
        .findOne({ provider, model })
        .lean()
        .exec();
      return doc;
    } catch (error) {
      this.logger.debug('Failed to get provider metrics from MongoDB', {
        provider,
        model,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Persist provider metrics to MongoDB for production durability.
   */
  private async persistProviderMetricsToMongo(metrics: {
    provider: string;
    model: string;
    totalRequests: number;
    successfulRequests: number;
    totalLatency: number;
    averageLatency: number;
    lastUpdated: Date;
    recentLatencies: number[];
  }): Promise<void> {
    try {
      await this.gatewayProviderMetricsModel
        .findOneAndUpdate(
          { provider: metrics.provider, model: metrics.model },
          {
            $set: {
              totalRequests: metrics.totalRequests,
              successfulRequests: metrics.successfulRequests,
              totalLatency: metrics.totalLatency,
              averageLatency: metrics.averageLatency,
              lastUpdated: metrics.lastUpdated,
              recentLatencies: metrics.recentLatencies,
            },
          },
          { upsert: true, new: true },
        )
        .exec();
    } catch (error) {
      this.logger.warn('Failed to persist provider metrics to MongoDB', {
        provider: metrics.provider,
        model: metrics.model,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Cache provider metrics
   */
  private async cacheProviderMetrics(
    cacheKey: string,
    metrics: any,
    ttl: number,
  ): Promise<void> {
    try {
      await this.cacheService.set(cacheKey, metrics, ttl);
    } catch (error) {
      this.logger.debug('Failed to cache provider metrics', {
        cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Cache model performance metrics
   */
  private async cacheModelPerformanceMetrics(
    cacheKey: string,
    metrics: any,
  ): Promise<void> {
    try {
      const defaultMetrics = {
        totalRequests: 0,
        averageProcessingTime: 0,
        averageTokensPerSecond: 0,
        successRate: 1.0,
        totalCost: 0,
      };
      type CachedMetrics = typeof defaultMetrics;
      const existing: CachedMetrics =
        (await this.cacheService.get<CachedMetrics>(cacheKey)) ??
        defaultMetrics;

      const totalRequests = existing.totalRequests + 1;
      const averageProcessingTime =
        (existing.averageProcessingTime * existing.totalRequests +
          metrics.processingTime) /
        totalRequests;
      const tokensPerSecond =
        metrics.totalTokens / (metrics.processingTime / 1000);
      const averageTokensPerSecond =
        (existing.averageTokensPerSecond * existing.totalRequests +
          tokensPerSecond) /
        totalRequests;
      const successRate =
        (existing.successRate * existing.totalRequests +
          (metrics.success ? 1 : 0)) /
        totalRequests;
      const totalCost = existing.totalCost + metrics.cost;

      const updatedMetrics = {
        ...existing,
        totalRequests,
        averageProcessingTime: Math.round(averageProcessingTime),
        averageTokensPerSecond: Math.round(averageTokensPerSecond),
        successRate: Math.round(successRate * 100) / 100,
        totalCost: Math.round(totalCost * 1000000) / 1000000, // Round to 6 decimal places
        lastUpdated: new Date(),
      };

      await this.cacheService.set(cacheKey, updatedMetrics, 3600); // 1 hour TTL
    } catch (error) {
      this.logger.debug('Failed to cache model performance metrics', {
        cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Cache simulation metrics
   */
  private async cacheSimulationMetrics(
    cacheKey: string,
    metrics: any,
    ttl: number,
  ): Promise<void> {
    try {
      await this.cacheService.set(cacheKey, metrics, ttl);
    } catch (error) {
      this.logger.debug('Failed to cache simulation metrics', {
        cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
