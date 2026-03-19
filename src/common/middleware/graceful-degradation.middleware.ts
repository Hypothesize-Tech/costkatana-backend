import { Injectable, NestMiddleware, Logger, Optional } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import Redis from 'ioredis';
import { getCacheService } from '../cache/cache.service';

/**
 * Graceful Degradation Middleware
 * Provides fallback responses when services are unavailable or degraded.
 * When used with DI (AppModule), inject Connection and Redis.
 * When used standalone (e.g. main.ts), only ConfigService is required; DB/Redis checks are skipped.
 */
@Injectable()
export class GracefulDegradationMiddleware implements NestMiddleware {
  private readonly logger = new Logger(GracefulDegradationMiddleware.name);
  private systemHealth = {
    database: true,
    redis: true,
    aiServices: true,
    email: true,
    lastChecked: Date.now(),
  };

  private degradationMode = false;
  private readonly healthCheckInterval = 30000; // 30 seconds
  private healthCheckTimer: NodeJS.Timeout | null = null;

  constructor(
    private configService: ConfigService,
    @Optional()
    @InjectConnection()
    private readonly mongoConnection?: Connection,
    @Optional() private readonly redis?: Redis,
  ) {
    this.startHealthChecks();
  }

  /**
   * Start periodic health monitoring
   */
  private startHealthChecks() {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.healthCheckInterval);

    // Perform initial health check
    this.performHealthChecks();
  }

  /**
   * Stop health checks (cleanup)
   */
  public stopHealthChecks() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  async use(req: Request, res: Response, next: NextFunction) {
    // Defensive: if `this` was lost (e.g. middleware not bound), pass through without throwing
    if (this == null || typeof (this as any).degradationMode === 'undefined') {
      return next();
    }
    // Quick health check
    if (this.degradationMode || !this.isSystemHealthy()) {
      const fallbackResponse = await this.getFallbackResponse(req);
      if (fallbackResponse) {
        this.logger.warn(
          'Serving fallback response due to system degradation',
          {
            endpoint: req.path,
            method: req.method,
            fallbackType: fallbackResponse.type,
          },
        );

        return res.status(fallbackResponse.status).json(fallbackResponse.body);
      }
    }

    // Add degradation headers to normal responses
    res.setHeader('X-System-Health', this.getHealthStatus());

    try {
      next();
    } catch (error) {
      // Handle unexpected errors with graceful degradation
      const errorResponse = this.handleErrorGracefully(error, req);
      if (errorResponse) {
        return res.status(errorResponse.status).json(errorResponse.body);
      }

      // Re-throw if we can't handle gracefully
      throw error;
    }
  }

  /**
   * Perform periodic health checks of critical services with real implementations
   */
  private async performHealthChecks() {
    try {
      const startTime = Date.now();

      // Check database connectivity
      try {
        if (this.mongoConnection && this.mongoConnection.readyState === 1) {
          const db = this.mongoConnection.db;
          if (db) {
            await db.admin().ping();
          }
          this.systemHealth.database = true;
        } else {
          this.systemHealth.database = !this.mongoConnection; // no connection = assume ok when optional
          if (this.mongoConnection) {
            this.logger.warn('MongoDB connection not ready', {
              readyState: this.mongoConnection?.readyState,
            });
          }
        }
      } catch (error) {
        this.systemHealth.database = false;
        this.logger.error('Database health check failed', error);
      }

      // Check Redis connectivity
      try {
        if (this.redis && this.redis.status === 'ready') {
          await this.redis.ping();
          this.systemHealth.redis = true;
        } else {
          this.systemHealth.redis = false;
          this.logger.warn('Redis connection not ready', {
            status: this.redis?.status,
          });
        }
      } catch (error) {
        this.systemHealth.redis = false;
        this.logger.error('Redis health check failed', error);
      }

      // Check AI services availability
      try {
        // Check if AI provider endpoints are configured
        const openaiKey = this.configService.get('OPENAI_API_KEY');
        const anthropicKey = this.configService.get('ANTHROPIC_API_KEY');
        const awsRegion = this.configService.get('AWS_REGION');

        // If at least one provider is configured, consider AI services available
        this.systemHealth.aiServices = !!(
          openaiKey ||
          anthropicKey ||
          awsRegion
        );

        if (!this.systemHealth.aiServices) {
          this.logger.warn('No AI service providers configured');
        }
      } catch (error) {
        this.systemHealth.aiServices = false;
        this.logger.error('AI services health check failed', error);
      }

      // Check email service availability
      try {
        // Check if email service is configured
        const smtpHost = this.configService.get('SMTP_HOST');
        const sendgridKey = this.configService.get('SENDGRID_API_KEY');

        // If email provider is configured, consider it available
        this.systemHealth.email = !!(smtpHost || sendgridKey);

        if (!this.systemHealth.email) {
          this.logger.warn('No email service provider configured');
        }
      } catch (error) {
        this.systemHealth.email = false;
        this.logger.error('Email service health check failed', error);
      }

      this.systemHealth.lastChecked = Date.now();

      // Determine if we should enter degradation mode
      const criticalServicesDown =
        !this.systemHealth.database || !this.systemHealth.aiServices;
      this.degradationMode = criticalServicesDown;

      if (this.degradationMode) {
        this.logger.warn('System entered degradation mode', {
          health: this.systemHealth,
          checkDuration: Date.now() - startTime,
        });
      } else if (
        this.systemHealth.database &&
        this.systemHealth.redis &&
        this.systemHealth.aiServices
      ) {
        this.logger.debug('System health check passed', {
          health: this.systemHealth,
          checkDuration: Date.now() - startTime,
        });
      }
    } catch (error) {
      this.logger.error('Health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if system is healthy enough for normal operation
   */
  private isSystemHealthy(): boolean {
    // Require database and at least one AI service
    return this.systemHealth.database && this.systemHealth.aiServices;
  }

  /**
   * Get health status string for headers
   */
  private getHealthStatus(): string {
    const healthyServices = Object.entries(this.systemHealth)
      .filter(([key, healthy]) => key !== 'lastChecked' && healthy)
      .map(([key]) => key);

    if (healthyServices.length === 4) return 'healthy';
    if (healthyServices.length >= 2) return 'degraded';
    return 'critical';
  }

  /**
   * Get fallback response for degraded endpoints
   */
  private async getFallbackResponse(
    req: Request,
  ): { status: number; body: any; type: string } | null {
    const endpoint = req.path;

    // Chat endpoints - return helpful message
    if (endpoint.startsWith('/api/chat')) {
      return {
        status: 503,
        body: {
          error: 'Service Temporarily Unavailable',
          message:
            'Chat services are currently experiencing high load. Please try again in a few minutes.',
          retryAfter: 60,
          fallback: true,
        },
        type: 'chat_fallback',
      };
    }

    // Gateway endpoints - return cached response if available
    if (endpoint.startsWith('/api/gateway')) {
      return {
        status: 503,
        body: {
          error: 'AI Service Unavailable',
          message:
            'AI models are temporarily unavailable. Please try again shortly.',
          retryAfter: 30,
          fallback: true,
        },
        type: 'gateway_fallback',
      };
    }

    // Analytics endpoints - return cached data if available
    if (endpoint.includes('analytics') || endpoint.includes('usage')) {
      const cachedData = await this.getCachedAnalyticsData(endpoint);
      return {
        status: 503,
        body: {
          error: 'Analytics Service Degraded',
          message: cachedData?.cached
            ? 'Analytics data may be delayed. Using cached information.'
            : 'Analytics data temporarily unavailable. No cached data.',
          data: cachedData,
          fallback: true,
        },
        type: 'analytics_fallback',
      };
    }

    // For critical endpoints, don't provide fallback
    if (endpoint.includes('health') || endpoint.includes('status')) {
      return null; // Let these fail normally
    }

    // Default fallback for other endpoints
    return {
      status: 503,
      body: {
        error: 'Service Temporarily Unavailable',
        message:
          'The service is currently experiencing issues. Please try again later.',
        retryAfter: 30,
        fallback: true,
      },
      type: 'general_fallback',
    };
  }

  /**
   * Handle errors gracefully when possible
   */
  private handleErrorGracefully(
    error: any,
    req: Request,
  ): { status: number; body: any } | null {
    // Handle specific error types gracefully
    if (
      error.name === 'MongoNetworkError' ||
      error.name === 'MongoTimeoutError'
    ) {
      return {
        status: 503,
        body: {
          error: 'Database Temporarily Unavailable',
          message: 'Database connectivity issues. Please try again.',
          retryAfter: 10,
        },
      };
    }

    if (error.message?.includes('rate limit') || error.status === 429) {
      return {
        status: 429,
        body: {
          error: 'Rate Limit Exceeded',
          message: 'Too many requests. Please slow down and try again.',
          retryAfter: 60,
        },
      };
    }

    // Don't handle other errors gracefully
    return null;
  }

  /**
   * Get cached analytics data for fallback responses.
   * Reads from CacheService when available; returns cached: false when no real data exists.
   */
  private async getCachedAnalyticsData(endpoint: string): Promise<{
    totalRequests?: number;
    totalCost?: number;
    avgResponseTime?: number;
    successRate?: number;
    message?: string;
    cached: boolean;
    lastUpdated?: string;
  }> {
    try {
      const cache = getCacheService();
      const usageKey = 'graceful-deg:analytics:usage';
      const perfKey = 'graceful-deg:analytics:performance';

      if (endpoint.includes('usage')) {
        const data = await cache.get<{
          totalRequests?: number;
          totalCost?: number;
          lastUpdated?: string;
        }>(usageKey);
        if (data && (data.totalRequests != null || data.totalCost != null)) {
          return {
            ...data,
            cached: true,
            lastUpdated: data.lastUpdated ?? new Date().toISOString(),
          };
        }
        return { cached: false, message: 'No cached usage data available' };
      }

      if (endpoint.includes('performance')) {
        const data = await cache.get<{
          avgResponseTime?: number;
          successRate?: number;
          lastUpdated?: string;
        }>(perfKey);
        if (
          data &&
          (data.avgResponseTime != null || data.successRate != null)
        ) {
          return {
            ...data,
            cached: true,
            lastUpdated: data.lastUpdated ?? new Date().toISOString(),
          };
        }
        return {
          cached: false,
          message: 'No cached performance data available',
        };
      }

      return { cached: false, message: 'Data temporarily unavailable' };
    } catch {
      return { cached: false, message: 'Cache unavailable' };
    }
  }
}
