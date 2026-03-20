import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import axios, { AxiosResponse } from 'axios';

// Import all gateway services
import { GatewayCacheService } from './gateway-cache.service';
import { GatewayRetryService } from './gateway-retry.service';
import { GatewayFirewallService } from './gateway-firewall.service';
import { BudgetEnforcementService } from './budget-enforcement.service';
import { GatewayAnalyticsService } from './gateway-analytics.service';
import { RequestProcessingService } from './request-processing.service';
import { ResponseHandlingService } from './response-handling.service';
import { GatewayAnthropicBedrockService } from './gateway-anthropic-bedrock.service';
import { FailoverService } from './failover.service';
import { PriorityQueueService } from './priority-queue.service';
import { PromptFirewallService } from '../../security/prompt-firewall.service';

// Import interfaces
import {
  GatewayContext,
  BudgetCheckResult,
  FirewallCheckResult,
  ModerationResult,
} from '../interfaces/gateway.interfaces';

/**
 * Gateway Service - Main orchestrator for all gateway operations
 * Coordinates the complete request processing pipeline
 */
@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);

  /** Express rejects non-integer status codes; align with HttpExceptionFilter. */
  private static normalizeOutboundStatus(code: unknown): number {
    if (
      typeof code === 'number' &&
      Number.isInteger(code) &&
      code >= 100 &&
      code <= 599
    ) {
      return code;
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  constructor(
    private cacheService: GatewayCacheService,
    private retryService: GatewayRetryService,
    private firewallService: GatewayFirewallService,
    private budgetService: BudgetEnforcementService,
    private analyticsService: GatewayAnalyticsService,
    private requestProcessingService: RequestProcessingService,
    private responseHandlingService: ResponseHandlingService,
    private gatewayAnthropicBedrockService: GatewayAnthropicBedrockService,
    private failoverService: FailoverService,
    private priorityQueueService: PriorityQueueService,
    private promptFirewallService: PromptFirewallService,
  ) {}

  /**
   * Process gateway request through complete pipeline
   */
  async processGatewayRequest(
    request: Request,
    response: Response,
  ): Promise<void> {
    const context = (request as any).gatewayContext as GatewayContext;
    const requestId = context.requestId || 'unknown';
    const startTime = Date.now();

    this.logger.log('=== GATEWAY REQUEST PROCESSING STARTED ===', {
      component: 'GatewayService',
      operation: 'processGatewayRequest',
      type: 'gateway_request_processing',
      requestId,
      method: request.method,
      url: request.originalUrl,
      userId: context.userId,
    });

    try {
      // Step 1: Check cache first (if enabled)
      if (context.cacheEnabled) {
        this.logger.debug('Step 1: Checking cache', { requestId });
        const cachedResponse = await this.cacheService.checkCache(request);
        if (cachedResponse) {
          this.logger.log('Cache hit - returning cached response', {
            requestId,
          });
          await this.analyticsService.logRequestStart(request);
          const moderationResult =
            await this.responseHandlingService.moderateOutput(
              request,
              cachedResponse.response,
            );
          this.responseHandlingService.sendCacheHitResponse(
            request,
            response,
            cachedResponse,
          );
          await this.analyticsService.trackUsage(
            request,
            cachedResponse.response,
            0,
          );
          return;
        }
      }

      // Step 2: Budget enforcement check
      this.logger.debug('Step 2: Checking budget constraints', { requestId });
      let budgetCheck: BudgetCheckResult = { allowed: true };
      if (context.budgetId) {
        budgetCheck = await this.budgetService.checkBudgetConstraints(request);
        if (!budgetCheck.allowed) {
          this.logger.warn('Budget check failed - blocking request', {
            requestId,
            budgetId: context.budgetId,
            reason: budgetCheck.message,
          });
          this.responseHandlingService.sendBudgetExceededResponse(
            request,
            response,
            budgetCheck,
          );
          return;
        }
      }

      // Step 3: Firewall check (if enabled)
      this.logger.debug('Step 3: Checking firewall rules', { requestId });
      let firewallResult: FirewallCheckResult = { isBlocked: false };
      if (context.firewallEnabled || context.firewallAdvanced) {
        firewallResult = await this.firewallService.checkFirewallRules(request);
        if (firewallResult.isBlocked) {
          this.logger.warn('Firewall blocked request', {
            requestId,
            threatCategory: firewallResult.threatCategory,
            reason: firewallResult.reason,
          });
          this.responseHandlingService.sendFirewallBlockedResponse(
            request,
            response,
            firewallResult,
          );
          return;
        }
      }

      // Step 4: Log request start for analytics
      this.logger.debug('Step 4: Logging request start', { requestId });
      await this.analyticsService.logRequestStart(request);

      // Step 5: Prepare proxy request with all optimizations
      this.logger.debug('Step 5: Preparing proxy request', { requestId });
      let proxyRequest =
        await this.requestProcessingService.prepareProxyRequest(request);

      // Apply request processing optimizations
      proxyRequest = await this.requestProcessingService.applyLazySummarization(
        request,
        proxyRequest,
      );
      proxyRequest = await this.requestProcessingService.applyPromptCompiler(
        request,
        proxyRequest,
      );
      proxyRequest = await this.requestProcessingService.applyCortexProcessing(
        request,
        proxyRequest,
      );

      // Step 6: Execute request (single provider or failover)
      this.logger.debug('Step 6: Executing request', { requestId });
      let axiosResponse: AxiosResponse;
      let retryAttempts = 0;

      if (
        context.failoverEnabled &&
        context.failoverPolicy &&
        !proxyRequest.internalBedrockAnthropic
      ) {
        // Handle failover request (failoverPolicy may be string or object with providers)
        const policy = context.failoverPolicy as
          | { providers?: unknown[] }
          | string;
        const providerCount =
          typeof policy === 'object' && policy && 'providers' in policy
            ? (policy.providers?.length ?? 0)
            : 0;
        this.logger.log('Executing failover request', {
          requestId,
          providerCount,
        });

        await this.analyticsService.logFailoverRequest(context, requestId);

        try {
          const failoverPolicy = this.failoverService.parseFailoverPolicy(
            context.failoverPolicy,
          );
          const failoverResult = await this.failoverService.executeFailover(
            proxyRequest,
            failoverPolicy,
            requestId,
          );

          if (failoverResult.success) {
            axiosResponse = {
              data: failoverResult.response,
              status: failoverResult.statusCode || 200,
              statusText: 'OK',
              headers: failoverResult.responseHeaders || {},
              config: proxyRequest as any,
            };

            await this.analyticsService.logFailoverSuccess(
              context,
              failoverResult,
              requestId,
            );
          } else {
            throw new Error(
              `All ${failoverResult.providersAttempted} providers failed: ${failoverResult.finalError?.message || 'Unknown error'}`,
            );
          }
        } catch (error: any) {
          await this.analyticsService.logFailoverError(
            context,
            error,
            requestId,
          );
          throw error;
        }
      } else {
        // Handle single provider request with retry logic
        this.logger.debug('Executing single provider request', { requestId });

        if (proxyRequest.internalBedrockAnthropic) {
          axiosResponse =
            await this.gatewayAnthropicBedrockService.execute(
              request,
              proxyRequest,
            );
          retryAttempts = 0;
        } else if (context.retryEnabled) {
          const retryResult = await this.retryService.executeWithRetry(
            proxyRequest,
            {
              retryCount: context.retryCount,
              retryFactor: context.retryFactor,
              retryMinTimeout: context.retryMinTimeout,
              retryMaxTimeout: context.retryMaxTimeout,
            },
          );
          axiosResponse = retryResult.response;
          retryAttempts = retryResult.retryAttempts;
        } else {
          const axios = (await import('axios')).default;
          axiosResponse = await axios(proxyRequest);
        }
      }

      // Step 7: Process response
      this.logger.debug('Step 7: Processing response', { requestId });
      const processedResponse =
        await this.responseHandlingService.processResponse(
          request,
          axiosResponse,
        );
      const moderatedResponse: ModerationResult =
        await this.responseHandlingService.moderateOutput(
          request,
          processedResponse,
        );

      // Step 8: Confirm budget and cache response
      this.logger.debug('Step 8: Finalizing request', { requestId });

      // Confirm budget reservation
      if (budgetCheck.reservationId) {
        const cost = context.cost || 0;
        await this.budgetService.trackRequestCost(request, axiosResponse, cost);
      }

      // Cache response (non-blocking)
      if (context.cacheEnabled) {
        setImmediate(async () => {
          try {
            await this.cacheService.cacheResponse(
              request,
              moderatedResponse.response,
            );
          } catch (error) {
            this.logger.warn('Failed to cache response', {
              requestId,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          }
        });
      }

      // Track usage and performance (non-blocking)
      setImmediate(async () => {
        try {
          await this.analyticsService.trackUsage(
            request,
            moderatedResponse.response,
            retryAttempts,
          );

          if (!context.failoverEnabled) {
            const provider = this.requestProcessingService.inferServiceFromUrl(
              context.targetUrl!,
            );
            const latency = Date.now() - startTime;
            const model =
              request.body?.model || context.modelOverride || 'unknown';

            await this.analyticsService.trackLatency(
              provider,
              model,
              latency,
              true,
            );
            await this.analyticsService.recordModelPerformance(
              request,
              moderatedResponse.response,
              context,
            );
          }
        } catch (error) {
          this.logger.warn('Failed to track analytics', {
            requestId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });

      // Step 9: Send response
      this.logger.debug('Step 9: Sending response', { requestId });
      this.responseHandlingService.addResponseHeaders(
        request,
        response,
        axiosResponse,
        moderatedResponse,
        context.failoverEnabled ? 0 : -1, // failoverProviderIndex
      );

      response.send(moderatedResponse.response);

      this.logger.log('=== GATEWAY REQUEST PROCESSING COMPLETED ===', {
        component: 'GatewayService',
        operation: 'processGatewayRequest',
        type: 'gateway_request_completed',
        requestId,
        processingTime: `${Date.now() - startTime}ms`,
        status: axiosResponse.status,
        retryAttempts,
      });
    } catch (error: any) {
      this.logger.error('=== GATEWAY REQUEST PROCESSING FAILED ===', {
        component: 'GatewayService',
        operation: 'processGatewayRequest',
        type: 'gateway_request_error',
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error.stack,
        processingTime: `${Date.now() - startTime}ms`,
      });

      // Release budget reservation on error
      if ((request as any).gatewayContext?.budgetReservationId) {
        setImmediate(async () => {
          try {
            await this.budgetService.releaseBudgetReservation(
              (request as any).gatewayContext.budgetReservationId,
            );
          } catch (budgetError) {
            this.logger.warn('Failed to release budget reservation on error', {
              requestId,
              error:
                budgetError instanceof Error
                  ? budgetError.message
                  : 'Unknown error',
            });
          }
        });
      }

      // Track failed request analytics
      setImmediate(async () => {
        try {
          if (!(request as any).gatewayContext?.failoverEnabled) {
            const provider = this.requestProcessingService.inferServiceFromUrl(
              (request as any).gatewayContext?.targetUrl || '',
            );
            const latency = Date.now() - startTime;
            const model =
              request.body?.model ||
              (request as any).gatewayContext?.modelOverride ||
              'unknown';

            await this.analyticsService.trackLatency(
              provider,
              model,
              latency,
              false,
            );
          }
        } catch (analyticsError) {
          this.logger.warn('Failed to track error analytics', {
            requestId,
            error:
              analyticsError instanceof Error
                ? analyticsError.message
                : 'Unknown error',
          });
        }
      });

      if (response.headersSent) {
        this.logger.warn('Gateway error after headers sent, skipping body', {
          requestId,
        });
        return;
      }

      // Prefer Nest HttpException (Bedrock, validation, etc.) — do not treat as Axios.
      if (error instanceof HttpException) {
        const status = GatewayService.normalizeOutboundStatus(error.getStatus());
        const body = error.getResponse();
        if (typeof body === 'string') {
          response.status(status).json({
            success: false,
            message: body,
            error: body,
          });
        } else if (body && typeof body === 'object') {
          response.status(status).json(body);
        } else {
          response.status(status).json({
            success: false,
            message: 'Gateway error',
          });
        }
        return;
      }

      if (axios.isAxiosError(error) && error.response) {
        const rx = error.response;
        const safeResponse: AxiosResponse = {
          ...rx,
          status:
            typeof rx.status === 'number' && Number.isInteger(rx.status)
              ? rx.status
              : 502,
          headers: rx.headers ?? {},
          data: rx.data ?? { error: 'Upstream error', message: 'Empty body' },
        };
        this.responseHandlingService.addResponseHeaders(
          request,
          response,
          safeResponse,
          {
            response: safeResponse.data,
            moderationApplied: false,
            action: 'allow',
            violationCategories: [],
            isBlocked: false,
          },
          -1,
        );
        response.status(safeResponse.status).json(safeResponse.data);
        return;
      }

      response.status(500).json({
        success: false,
        error: 'Gateway error',
        message: 'Internal server error in gateway',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Get gateway health status
   */
  async getHealthStatus(): Promise<{
    status: string;
    service: string;
    timestamp: string;
    version: string;
    cache: string;
  }> {
    // Check cache service health
    let cacheStatus = 'unknown';
    try {
      const cacheStats = await this.cacheService.getCacheStats();
      cacheStatus = cacheStats ? 'Redis' : 'in-memory';
    } catch (error) {
      cacheStatus = 'error';
    }

    return {
      status: 'healthy',
      service: 'CostKATANA Gateway',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      cache: cacheStatus,
    };
  }

  /**
   * Get gateway statistics
   */
  async getGatewayStats(): Promise<any> {
    try {
      const cacheStats = await this.cacheService.getCacheStats();
      const failoverMetrics = this.failoverService.getMetrics();

      return {
        cache: cacheStats,
        failover: failoverMetrics,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to get gateway stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        error: 'Failed to retrieve statistics',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Get cache statistics (for /gateway/cache/stats)
   */
  async getCacheStats(): Promise<{
    redis: Record<string, unknown>;
    config: { defaultTTL: number; defaultTTLHours: number };
  }> {
    try {
      const redisStats = await this.cacheService.getCacheStats();
      const stats = redisStats || {};
      return {
        redis: {
          hits: stats.hits ?? 0,
          misses: stats.misses ?? 0,
          totalRequests: stats.totalRequests ?? 0,
          hitRate: stats.hitRate ?? 0,
          avgResponseTime: stats.avgResponseTime ?? 0,
          costSaved: stats.costSaved ?? 0,
          tokensSaved: stats.tokensSaved ?? 0,
          deduplicationCount: stats.deduplicationCount ?? 0,
          semanticMatches: stats.semanticMatches ?? 0,
          cacheSize: stats.cacheSize ?? 0,
          topModels: stats.topModels ?? [],
          topUsers: stats.topUsers ?? [],
        },
        config: {
          defaultTTL: 3600,
          defaultTTLHours: 1,
        },
      };
    } catch (error) {
      this.logger.error('Failed to get cache stats', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        redis: {
          hits: 0,
          misses: 0,
          totalRequests: 0,
          hitRate: 0,
          avgResponseTime: 0,
          costSaved: 0,
          tokensSaved: 0,
          deduplicationCount: 0,
          semanticMatches: 0,
          cacheSize: 0,
          topModels: [],
          topUsers: [],
        },
        config: { defaultTTL: 3600, defaultTTLHours: 1 },
      };
    }
  }

  /**
   * Clear gateway cache
   */
  async clearCache(filters?: {
    userId?: string;
    model?: string;
    provider?: string;
  }): Promise<{ success: boolean; clearedEntries: number; message: string }> {
    try {
      const clearedCount = await this.cacheService.invalidateCache(
        filters || {},
      );

      return {
        success: true,
        clearedEntries: clearedCount,
        message: `Gateway cache cleared successfully`,
      };
    } catch (error) {
      this.logger.error('Failed to clear gateway cache', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        clearedEntries: 0,
        message: 'Failed to clear gateway cache',
      };
    }
  }

  /**
   * Get failover analytics
   */
  async getFailoverAnalytics(): Promise<{
    success: boolean;
    data: {
      metrics: any;
      healthStatus: any;
      timestamp: string;
    };
  }> {
    try {
      const metrics = this.failoverService.getMetrics();
      const healthStatus = this.failoverService.getProviderHealthStatus();

      return {
        success: true,
        data: {
          metrics,
          healthStatus,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      this.logger.error('Failed to get failover analytics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        data: {
          metrics: {},
          healthStatus: {},
          timestamp: new Date().toISOString(),
        },
      };
    }
  }

  /**
   * Get firewall analytics from ThreatLog collection
   */
  async getFirewallAnalytics(
    userId?: string,
    dateRange?: { start: Date; end: Date },
  ): Promise<{
    success: boolean;
    data: any;
  }> {
    try {
      const analytics = await this.promptFirewallService.getFirewallAnalytics(
        userId,
        dateRange,
      );

      return {
        success: true,
        data: analytics,
      };
    } catch (error) {
      this.logger.error('Failed to get firewall analytics', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        data: {
          totalRequests: 0,
          blockedRequests: 0,
          costSaved: 0,
          threatsByCategory: {},
          savingsByThreatType: {},
        },
      };
    }
  }

  /**
   * Get priority queue status
   */
  async getQueueStatus(): Promise<{
    success: boolean;
    data: any;
  }> {
    try {
      return await this.priorityQueueService.getQueueStatus();
    } catch (error) {
      this.logger.error('Failed to get queue status', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        success: false,
        data: {
          queueDepth: 0,
          activeWorkers: 0,
          maxWaitTime: 0,
          averageProcessingTime: 0,
          priorityDistribution: { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0 },
          isOverCapacity: false,
          wouldExceedMaxWait: false,
          timestamp: new Date().toISOString(),
        },
      };
    }
  }
}
