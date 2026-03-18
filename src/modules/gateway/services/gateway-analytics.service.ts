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

/**
 * Gateway Analytics Service - Handles usage tracking and analytics for gateway operations.
 * Uses Redis (CacheService) for hot path and MongoDB for durable persistence (production scalability).
 */
@Injectable()
export class GatewayAnalyticsService {
  private readonly logger = new Logger(GatewayAnalyticsService.name);

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

      // Store request start metrics in database
      try {
        const usageRecord = new this.usageModel({
          userId: context.userId,
          projectId: context.projectId,
          service: this.inferServiceFromUrl(request.originalUrl),
          model: request.body?.model || 'unknown',
          prompt: request.body?.messages
            ? request.body.messages.map((m: any) => m.content || '').join('\n')
            : request.body?.prompt || '',
          promptTokens: 0, // Will be updated when response is received
          completionTokens: 0, // Will be updated when response is received
          totalTokens: 0, // Will be updated when response is received
          cost: 0, // Will be updated when response is received
          requestMetadata: {
            requestId,
            method: request.method,
            url: request.originalUrl,
            userAgent: request.headers['user-agent'],
            ip: request.ip,
            gatewayContext: {
              provider: context.provider,
              model: request.body?.model,
              cacheEnabled: context.cacheEnabled,
              retryEnabled: context.retryEnabled,
            },
          },
          status: 'in_progress',
          requestTimestamp: new Date(),
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

      // Calculate metrics
      const inputTokens = context.inputTokens || 0;
      const outputTokens = context.outputTokens || 0;
      const totalTokens = inputTokens + outputTokens;
      const cost = context.cost || 0;

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

      // Store usage metrics in database
      try {
        const updateData: any = {
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          totalTokens,
          cost,
          responseMetadata: {
            processingTime,
            retryAttempts,
            statusCode: response?.status || 200,
            responseTimestamp: new Date(),
            gatewayMetrics: {
              cacheHit: context.cacheHit || false,
              failoverUsed: context.failoverEnabled || false,
              cortexEnabled: context.cortexEnabled || false,
            },
          },
          status: 'completed',
          completionTimestamp: new Date(),
        };

        // If we have a usage record ID from request start, update it
        if (context.usageRecordId) {
          await this.usageModel.findByIdAndUpdate(
            context.usageRecordId,
            updateData,
          );

          this.logger.debug('Usage record updated in database', {
            component: 'GatewayAnalyticsService',
            operation: 'trackUsage',
            type: 'usage_updated',
            requestId,
            usageRecordId: context.usageRecordId.toString(),
          });
        } else {
          // Create new usage record if we don't have an existing one
          const metadata: Record<string, unknown> = {
            requestId,
            method: request.method,
            url: request.originalUrl,
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
            service:
              context.provider || this.inferServiceFromUrl(request.originalUrl),
            model: request.body?.model || 'unknown',
            prompt: request.body?.messages
              ? request.body.messages
                  .map((m: any) => m.content || '')
                  .join('\n')
              : request.body?.prompt || '',
            ...updateData,
            metadata,
            requestTimestamp: new Date(context.startTime),
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

      // Compute input/output tokens if not present on context, optionally extract from response if needed
      // For now, only using context as original
      const inputTokens = context.inputTokens || 0;
      const outputTokens = context.outputTokens || 0;

      // Compute cost if not present on context, optionally extract from response if needed
      const cost = context.cost || 0;

      // Basic fields for performance log
      const baseLog = {
        component: 'GatewayAnalyticsService',
        operation: 'recordModelPerformance',
        requestId,
        userId: context.userId,
        model: request.body?.model || 'unknown',
        provider: context.provider || 'unknown',
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
          provider: context.provider || 'unknown',
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
        const cacheKey = `model_performance:${context.provider}:${request.body?.model}`;
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
      // Basic cost estimation based on tokens
      const inputTokens =
        context.inputTokens || this.estimateTokens(request.body, 'input');
      const outputTokens =
        context.outputTokens || this.estimateTokens(request.body, 'output');

      // Get actual pricing from pricing service
      let inputPrice = 0.000001; // Default fallback
      let outputPrice = 0.000002; // Default fallback

      try {
        // Import pricing service dynamically - path from gateway/services
        const { PricingService } =
          await import('../../utils/services/pricing.service');
        const pricingService = new PricingService();

        const pricing = pricingService.getModelPricing(
          request.body?.model || 'unknown',
        );

        if (pricing) {
          // ModelPricing uses inputCostPerToken/outputCostPerToken per 1K tokens
          inputPrice = pricing.inputCostPerToken / 1000;
          outputPrice = pricing.outputCostPerToken / 1000;

          this.logger.debug('Retrieved pricing from service', {
            component: 'GatewayAnalyticsService',
            operation: 'estimateRequestCost',
            model: request.body?.model,
            provider: context.provider,
            inputPrice,
            outputPrice,
          });
        }
      } catch (pricingError) {
        this.logger.warn('Failed to get pricing from service, using defaults', {
          component: 'GatewayAnalyticsService',
          operation: 'estimateRequestCost',
          error:
            pricingError instanceof Error
              ? pricingError.message
              : 'Unknown error',
          model: request.body?.model,
          provider: context.provider,
        });
        // Continue with default pricing
      }

      const estimatedCost =
        inputTokens * inputPrice + outputTokens * outputPrice;

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
