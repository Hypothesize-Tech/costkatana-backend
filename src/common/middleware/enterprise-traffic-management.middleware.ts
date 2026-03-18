import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import type { TrafficPredictionService } from '../../modules/analytics/services/traffic-prediction.service';

/**
 * Enterprise Traffic Management Middleware
 * Advanced traffic management for enterprise deployments
 * Handles load balancing, request prioritization, and enterprise-specific routing
 */
@Injectable()
export class EnterpriseTrafficManagementMiddleware implements NestMiddleware {
  private readonly logger = new Logger(
    EnterpriseTrafficManagementMiddleware.name,
  );
  private requestQueue: Array<{
    req: Request;
    res: Response;
    next: NextFunction;
    priority: number;
    timestamp: number;
  }> = [];
  private isProcessing = false;
  private maxConcurrentRequests: number;
  private activeRequests = 0;

  constructor(
    private configService: ConfigService,
    private trafficPredictionService?: TrafficPredictionService,
  ) {
    this.maxConcurrentRequests = parseInt(
      this.configService.get('ENTERPRISE_MAX_CONCURRENT_REQUESTS', '10'),
    );
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const user = (req as any).user;
    const isEnterpriseUser = user?.subscription?.plan === 'enterprise';

    if (!isEnterpriseUser) {
      return next();
    }

    const priority = this.calculateRequestPriority(req, user);

    if (this.activeRequests >= this.maxConcurrentRequests) {
      // Queue the request for enterprise users
      this.requestQueue.push({
        req,
        res,
        next,
        priority,
        timestamp: Date.now(),
      });

      // Sort queue by priority (higher priority first)
      this.requestQueue.sort((a, b) => b.priority - a.priority);

      this.logger.log('Enterprise request queued', {
        userId: user.id,
        endpoint: req.path,
        priority,
        queueLength: this.requestQueue.length,
      });

      return;
    }

    // Process request immediately
    this.activeRequests++;
    this.attachCleanupHandler(res, req);
    next();
  }

  /**
   * Process queued requests when capacity becomes available
   */
  private async processQueuedRequests() {
    if (this.isProcessing || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (
      this.requestQueue.length > 0 &&
      this.activeRequests < this.maxConcurrentRequests
    ) {
      const queuedRequest = this.requestQueue.shift();
      if (!queuedRequest) break;

      // Check if request has timed out (5 minute queue timeout)
      const queueTime = Date.now() - queuedRequest.timestamp;
      if (queueTime > 300000) {
        // 5 minutes
        this.logger.warn('Enterprise request timed out in queue', {
          userId: (queuedRequest.req as any).user?.id,
          endpoint: queuedRequest.req.path,
          queueTime,
        });
        queuedRequest.res.status(408).json({
          error: 'Request Timeout',
          message: 'Request queued too long, please try again',
        });
        continue;
      }

      this.activeRequests++;
      this.attachCleanupHandler(queuedRequest.res, queuedRequest.req);

      this.logger.log('Processing queued enterprise request', {
        userId: (queuedRequest.req as any).user?.id,
        endpoint: queuedRequest.req.path,
        priority: queuedRequest.priority,
        queueTime,
      });

      queuedRequest.next();
    }

    this.isProcessing = false;
  }

  /**
   * Calculate request priority based on user, endpoint, and other factors
   */
  private calculateRequestPriority(req: Request, user: any): number {
    let priority = 5; // Base priority

    // Higher priority for admin users
    if (user.role === 'admin') {
      priority += 10;
    }

    // Higher priority for critical endpoints
    const criticalEndpoints = ['/api/gateway', '/api/agent', '/api/chat'];
    if (criticalEndpoints.some((endpoint) => req.path.startsWith(endpoint))) {
      priority += 5;
    }

    // Higher priority for POST/PUT requests (state-changing operations)
    if (req.method === 'POST' || req.method === 'PUT') {
      priority += 3;
    }

    // Lower priority for bulk operations or long-running tasks
    if (req.path.includes('bulk') || req.path.includes('batch')) {
      priority -= 2;
    }

    // User-specific priority adjustments
    const userPriority = user.subscription?.metadata?.priority || 0;
    priority += userPriority;

    return Math.max(1, Math.min(20, priority)); // Clamp between 1-20
  }

  /**
   * Attach cleanup handler to track when request completes
   */
  private attachCleanupHandler(res: Response, req?: Request) {
    const startTime = Date.now();
    res.on('finish', () => {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      if (this.trafficPredictionService && req) {
        this.recordTrafficData(req, startTime, res.statusCode).catch(() => {});
      }
      setImmediate(() => this.processQueuedRequests());
    });

    res.on('close', () => {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
      if (this.trafficPredictionService && req) {
        this.recordTrafficData(req, startTime, res.statusCode).catch(() => {});
      }
      setImmediate(() => this.processQueuedRequests());
    });
  }

  private async recordTrafficData(
    req: Request,
    startTime: number,
    statusCode: number,
  ): Promise<void> {
    if (!this.trafficPredictionService) return;
    const responseTime = Date.now() - startTime;
    await this.trafficPredictionService.recordTrafficData({
      requestsPerSecond: 1,
      uniqueUsers: 1,
      responseTime,
      errorRate: statusCode >= 400 ? 1 : 0,
      cpuUsage: 0,
      memoryUsage: 0,
      endpointDistribution: { [req.path]: 1 },
      userTierDistribution: {
        [(req as any).user?.subscription?.plan || 'free']: 1,
      },
      geographicDistribution: {
        [(req.headers['x-forwarded-for'] as string) || 'unknown']: 1,
      },
    });
  }
}
