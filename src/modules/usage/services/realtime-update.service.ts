import {
  Injectable,
  Logger,
  OnModuleDestroy,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Subject } from 'rxjs';
import { Response } from 'express';
import type { UsageService } from './usage.service';
import { CacheService } from '../../../common/cache/cache.service';
import { BudgetService } from '../../budget/budget.service';
import Redis from 'ioredis';
import { isRedisEnabled } from '../../../config/redis';

interface SSEConnection {
  response: Response;
  subject: Subject<any>;
  userId: string;
  connectedAt: Date;
  lastHeartbeat: Date;
}

interface UsageUpdate {
  type:
    | 'usage_tracked'
    | 'budget_warning'
    | 'budget_exceeded'
    | 'optimization_suggestion'
    | 'anomaly_detected';
  data: any;
  timestamp: Date;
  userId: string;
}

interface BudgetWarning {
  projectId?: string;
  currentSpend: number;
  budgetLimit: number;
  percentageUsed: number;
  remainingBudget?: number;
  timeRemaining?: number;
}

interface ProactiveSuggestion {
  type: 'cost_optimization' | 'performance_improvement' | 'efficiency_gain';
  title: string;
  description: string;
  potentialSavings?: number;
  confidence: number;
  actionRequired: boolean;
}

let realtimeUpdateServiceInstance: RealtimeUpdateService | null = null;

export function getRealtimeUpdateService(): RealtimeUpdateService {
  if (!realtimeUpdateServiceInstance) {
    throw new Error(
      'RealtimeUpdateService not initialized. Ensure UsageModule is imported.',
    );
  }
  return realtimeUpdateServiceInstance;
}

@Injectable()
export class RealtimeUpdateService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeUpdateService.name);
  private redisPublisher: Redis;
  private redisSubscriber: Redis;
  private connections = new Map<string, SSEConnection>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly SSE_CHANNEL_PREFIX = 'sse:';
  private readonly CONNECTION_TRACKING_PREFIX = 'sse_conn:';

  constructor(
    @Inject(forwardRef(() => require('./usage.service').UsageService))
    private usageService: UsageService,
    @Inject(CacheService) private cacheService: CacheService,
    private budgetService: BudgetService,
  ) {
    realtimeUpdateServiceInstance = this;
    this.initializeRedis();
    this.startHeartbeat();
    this.startCleanup();
    this.setupRedisSubscriptions();
  }

  /**
   * Initialize Redis clients for pub/sub. On failure, use no-op clients so app (and MongoDB) can start without Redis.
   */
  private initializeRedis(): void {
    if (!isRedisEnabled()) {
      this.logger.log(
        'Redis disabled - using no-op pub/sub (SSE will work in single-instance only)',
      );
      this.redisPublisher = this.createNoOpRedis();
      this.redisSubscriber = this.createNoOpRedis();
      return;
    }

    try {
      // Use the same Redis configuration as the cache service
      const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

      this.redisPublisher = new Redis(redisUrl, {
        lazyConnect: true,
        enableReadyCheck: false,
        maxRetriesPerRequest: 3,
      });

      this.redisSubscriber = new Redis(redisUrl, {
        lazyConnect: true,
        enableReadyCheck: false,
        maxRetriesPerRequest: 3,
      });

      this.redisSubscriber.on('error', (err) => {
        this.logger.warn(
          `Redis subscriber error (SSE may work in single-instance only): ${err?.message ?? err}`,
        );
      });
      this.redisPublisher.on('error', (err) => {
        this.logger.warn(
          `Redis publisher error (SSE may work in single-instance only): ${err?.message ?? err}`,
        );
      });

      this.logger.log('Redis pub/sub clients initialized for SSE');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Redis unavailable for SSE (using no-op; app will run without cross-instance SSE): ${msg}`,
      );
      this.redisPublisher = this.createNoOpRedis();
      this.redisSubscriber = this.createNoOpRedis();
    }
  }

  /** No-op Redis client when Redis is unavailable (publish/subscribe do nothing). */
  private createNoOpRedis(): Redis {
    return {
      publish: () => Promise.resolve(0),
      subscribe: () => Promise.resolve(),
      unsubscribe: () => Promise.resolve(),
      on: () => ({}) as Redis,
      quit: () => Promise.resolve(),
      status: 'ready',
    } as unknown as Redis;
  }

  /**
   * Setup Redis subscriptions for cross-instance communication
   */
  private setupRedisSubscriptions(): void {
    this.redisSubscriber.on('message', (channel, message) => {
      try {
        if (channel.startsWith(this.SSE_CHANNEL_PREFIX)) {
          const userId = channel.replace(this.SSE_CHANNEL_PREFIX, '');
          const eventData = JSON.parse(message);
          this.handleRedisMessage(userId, eventData);
        }
      } catch (error) {
        this.logger.error('Failed to handle Redis message', {
          channel,
          message,
          error,
        });
      }
    });

    this.redisSubscriber.on('error', (error) => {
      this.logger.error('Redis subscriber error', error);
    });
  }

  /**
   * Handle incoming Redis messages for SSE events
   */
  private handleRedisMessage(userId: string, eventData: any): void {
    const connection = this.connections.get(userId);
    if (!connection) {
      return; // No local connection for this user
    }

    try {
      const eventString = `data: ${JSON.stringify(eventData)}\n\n`;
      connection.response.write(eventString);
      connection.lastHeartbeat = new Date();
    } catch (error) {
      this.logger.warn(
        `Failed to send Redis event to user ${userId}, removing connection`,
        error,
      );
      this.removeConnection(userId);
    }
  }

  /**
   * Initialize SSE connection for a user
   */
  async initializeSSEConnection(
    userId: string,
    response: Response,
  ): Promise<void> {
    try {
      // Set SSE headers
      response.setHeader('Content-Type', 'text/event-stream');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('Connection', 'keep-alive');
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

      // Create subject for this connection
      const subject = new Subject();

      const connection: SSEConnection = {
        response,
        subject,
        userId,
        connectedAt: new Date(),
        lastHeartbeat: new Date(),
      };

      // Store connection locally
      this.connections.set(userId, connection);

      // Subscribe to Redis channel for this user
      const channel = this.SSE_CHANNEL_PREFIX + userId;
      await this.redisSubscriber.subscribe(channel);

      // Track connection in Redis for cross-instance awareness
      await this.cacheService.set(
        this.CONNECTION_TRACKING_PREFIX + userId,
        {
          connectedAt: connection.connectedAt.toISOString(),
          instanceId: process.env.NODE_APP_INSTANCE || 'default',
        },
        300, // 5 minutes TTL
      );

      // Handle connection close
      response.on('close', () => {
        this.logger.log(`SSE connection closed for user ${userId}`);
        this.removeConnection(userId);
      });

      // Send initial connection event
      await this.sendEvent(userId, {
        type: 'connection_established',
        data: { message: 'Real-time connection established' },
        timestamp: new Date(),
      });

      this.logger.log(`SSE connection initialized for user ${userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to initialize SSE connection for user ${userId}`,
        error,
      );
      response.status(500).end();
    }
  }

  /**
   * Emit usage tracking event
   */
  async emitUsageUpdate(userId: string, usageData: any): Promise<void> {
    try {
      const update: UsageUpdate = {
        type: 'usage_tracked',
        data: {
          usageId: usageData._id,
          cost: usageData.cost,
          tokens: usageData.totalTokens,
          service: usageData.service,
          model: usageData.model,
          responseTime: usageData.responseTime,
          optimizationApplied: usageData.optimizationApplied,
        },
        timestamp: new Date(),
        userId,
      };

      await this.sendEvent(userId, update);

      // Check for budget warnings
      await this.checkAndEmitBudgetWarnings(userId);

      // Send proactive suggestions when cost is significant (condition-based, not random)
      const costThreshold = 0.1; // $0.10
      const shouldSuggest =
        (usageData.cost ?? 0) >= costThreshold &&
        (await this.shouldEmitProactiveSuggestion(userId));
      if (shouldSuggest) {
        await this.emitProactiveSuggestion(userId);
      }
    } catch (error) {
      this.logger.error(
        `Failed to emit usage update for user ${userId}`,
        error,
      );
    }
  }

  /**
   * Emit budget warning
   */
  async emitBudgetWarning(
    userId: string,
    warning: BudgetWarning,
  ): Promise<void> {
    try {
      const update: UsageUpdate = {
        type: 'budget_warning',
        data: warning,
        timestamp: new Date(),
        userId,
      };

      await this.sendEvent(userId, update);
      this.logger.log(`Budget warning emitted for user ${userId}`, warning);
    } catch (error) {
      this.logger.error(
        `Failed to emit budget warning for user ${userId}`,
        error,
      );
    }
  }

  /**
   * Emit budget exceeded alert
   */
  async emitBudgetExceeded(
    userId: string,
    data: {
      projectId?: string;
      currentSpend: number;
      budgetLimit: number;
      exceededBy: number;
      percentageUsed?: number;
    },
  ): Promise<void> {
    try {
      const update: UsageUpdate = {
        type: 'budget_exceeded',
        data,
        timestamp: new Date(),
        userId,
      };

      await this.sendEvent(userId, update);
      this.logger.warn(
        `Budget exceeded alert emitted for user ${userId}`,
        data,
      );
    } catch (error) {
      this.logger.error(
        `Failed to emit budget exceeded alert for user ${userId}`,
        error,
      );
    }
  }

  /**
   * Rate limit: at most one proactive suggestion per user per hour
   */
  private async shouldEmitProactiveSuggestion(
    userId: string,
  ): Promise<boolean> {
    const key = `proactive_suggestion:${userId}`;
    try {
      const lastEmitted = await this.cacheService.get<string>(key);
      return !lastEmitted;
    } catch {
      return false;
    }
  }

  /**
   * Emit proactive optimization suggestion
   */
  async emitProactiveSuggestion(userId: string): Promise<void> {
    try {
      // Get recent usage data to generate relevant suggestions
      const recentUsage = await this.usageService.getRecentUsageForUser(
        userId,
        10,
      );

      if (recentUsage.length === 0) return;

      // Analyze patterns and generate suggestion
      const suggestion = this.generateProactiveSuggestion(recentUsage);

      if (suggestion) {
        const update: UsageUpdate = {
          type: 'optimization_suggestion',
          data: suggestion,
          timestamp: new Date(),
          userId,
        };

        await this.sendEvent(userId, update);
        await this.cacheService.set(
          `proactive_suggestion:${userId}`,
          Date.now().toString(),
          3600,
        ); // 1 hour rate limit
        this.logger.log(
          `Proactive suggestion emitted for user ${userId}`,
          suggestion,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to emit proactive suggestion for user ${userId}`,
        error,
      );
    }
  }

  /**
   * Emit approval request notification
   */
  async emitApprovalRequest(
    userId: string,
    data: {
      requestId: string;
      type: string;
      description: string;
      requiresAction: boolean;
    },
  ): Promise<void> {
    try {
      const update: UsageUpdate = {
        type: 'usage_tracked',
        data,
        timestamp: new Date(),
        userId,
      };

      await this.sendEvent(userId, update);
      this.logger.log(`Approval request emitted for user ${userId}`, data);
    } catch (error) {
      this.logger.error(
        `Failed to emit approval request for user ${userId}`,
        error,
      );
    }
  }

  /**
   * Broadcast to specific user
   */
  async broadcastToUser(
    userId: string,
    eventType: string,
    data: any,
  ): Promise<void> {
    try {
      const update: UsageUpdate = {
        type: eventType as any,
        data,
        timestamp: new Date(),
        userId,
      };

      await this.sendEvent(userId, update);
    } catch (error) {
      this.logger.error(`Failed to broadcast to user ${userId}`, error);
    }
  }

  /**
   * Send a raw message object to user (e.g. cost_saving_suggestions, proactive_suggestion).
   * Use this when the client expects the exact payload shape (Express-compatible).
   */
  async broadcastMessageToUser(
    userId: string,
    message: Record<string, any>,
  ): Promise<void> {
    try {
      const event = {
        ...message,
        timestamp: message.timestamp ?? new Date().toISOString(),
      };
      await this.sendEvent(userId, event);
    } catch (error) {
      this.logger.error(`Failed to broadcast message to user ${userId}`, error);
    }
  }

  /**
   * Send event to specific user via Redis pub/sub
   */
  private async sendEvent(userId: string, event: any): Promise<void> {
    try {
      // Publish to Redis channel for cross-instance communication
      const channel = this.SSE_CHANNEL_PREFIX + userId;
      await this.redisPublisher.publish(channel, JSON.stringify(event));

      // Also send to local connection if it exists (for immediate delivery)
      const connection = this.connections.get(userId);
      if (connection) {
        try {
          const eventData = `data: ${JSON.stringify(event)}\n\n`;
          connection.response.write(eventData);
          connection.lastHeartbeat = new Date();
        } catch (error) {
          this.logger.warn(
            `Failed to send local event to user ${userId}, removing connection`,
            error,
          );
          this.removeConnection(userId);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to send event to user ${userId}`, error);
    }
  }

  /**
   * Check budget status and emit warnings if needed
   */
  private async checkAndEmitBudgetWarnings(userId: string): Promise<void> {
    try {
      // Get actual budget status from budget service
      const budgetStatus = await this.budgetService.getBudgetStatus(userId);

      // Check overall budget
      const overallBudget = budgetStatus.overall;
      const currentSpend = overallBudget.cost;
      const budgetLimit = overallBudget.budget;

      if (budgetLimit > 0) {
        const percentageUsed = currentSpend / budgetLimit;

        // Define warning thresholds based on budget alerts
        const warningThreshold = 0.8; // 80%
        const criticalThreshold = 0.95; // 95%

        if (percentageUsed >= criticalThreshold) {
          await this.emitBudgetExceeded(userId, {
            currentSpend,
            budgetLimit,
            exceededBy: currentSpend - budgetLimit,
            percentageUsed: percentageUsed * 100,
          });
        } else if (percentageUsed >= warningThreshold) {
          await this.emitBudgetWarning(userId, {
            currentSpend,
            budgetLimit,
            percentageUsed: percentageUsed * 100,
            remainingBudget: budgetLimit - currentSpend,
          });
        }

        // Check project-specific budgets
        for (const project of budgetStatus.projects) {
          if (project.budget > 0) {
            const projectPercentageUsed = project.cost / project.budget;

            if (projectPercentageUsed >= criticalThreshold) {
              await this.emitBudgetExceeded(userId, {
                projectId: project.projectId || project.name,
                currentSpend: project.cost,
                budgetLimit: project.budget,
                exceededBy: project.cost - project.budget,
                percentageUsed: projectPercentageUsed * 100,
              });
            } else if (projectPercentageUsed >= warningThreshold) {
              await this.emitBudgetWarning(userId, {
                projectId: project.projectId || project.name,
                currentSpend: project.cost,
                budgetLimit: project.budget,
                percentageUsed: projectPercentageUsed * 100,
                remainingBudget: project.budget - project.cost,
              });
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to check budget warnings for user ${userId}`,
        error,
      );
    }
  }

  /**
   * Generate proactive optimization suggestion based on usage patterns
   */
  private generateProactiveSuggestion(
    recentUsage: any[],
  ): ProactiveSuggestion | null {
    if (recentUsage.length === 0) return null;

    // Analyze usage patterns
    const avgCost =
      recentUsage.reduce((sum, u) => sum + u.cost, 0) / recentUsage.length;
    const highCostUsage = recentUsage.filter((u) => u.cost > avgCost * 1.5);
    const slowResponses = recentUsage.filter((u) => u.responseTime > 5000);

    if (highCostUsage.length > recentUsage.length * 0.3) {
      return {
        type: 'cost_optimization',
        title: 'Consider Model Optimization',
        description: `${highCostUsage.length} of your recent requests exceed average cost. Consider using more cost-effective models.`,
        potentialSavings: highCostUsage.reduce(
          (sum, u) => sum + (u.cost - avgCost),
          0,
        ),
        confidence: 0.8,
        actionRequired: false,
      };
    }

    if (slowResponses.length > recentUsage.length * 0.2) {
      return {
        type: 'performance_improvement',
        title: 'Performance Optimization Available',
        description: `${slowResponses.length} of your recent requests are slower than usual. Consider optimizing prompts or switching models.`,
        confidence: 0.7,
        actionRequired: false,
      };
    }

    return null;
  }

  /**
   * Start heartbeat mechanism
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = new Date();

      for (const [userId, connection] of this.connections) {
        try {
          // Send heartbeat every 30 seconds
          if (now.getTime() - connection.lastHeartbeat.getTime() > 30000) {
            this.sendEvent(userId, {
              type: 'heartbeat',
              data: { timestamp: now },
              timestamp: now,
            });
          }
        } catch (error) {
          this.logger.warn(
            `Heartbeat failed for user ${userId}, removing connection`,
            error,
          );
          this.removeConnection(userId);
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Start cleanup mechanism for inactive connections
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = new Date();
      const timeoutMs = 5 * 60 * 1000; // 5 minutes

      for (const [userId, connection] of this.connections) {
        if (now.getTime() - connection.lastHeartbeat.getTime() > timeoutMs) {
          this.logger.log(
            `Cleaning up inactive SSE connection for user ${userId}`,
          );
          this.removeConnection(userId);
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Remove connection for user
   */
  private async removeConnection(userId: string): Promise<void> {
    const connection = this.connections.get(userId);
    if (connection) {
      try {
        connection.subject.complete();
        connection.response.end();
      } catch (error) {
        this.logger.warn(`Error closing connection for user ${userId}`, error);
      }
      this.connections.delete(userId);
      this.logger.log(`SSE connection removed for user ${userId}`);
    }

    // Clean up Redis subscription and tracking
    try {
      const channel = this.SSE_CHANNEL_PREFIX + userId;
      await this.redisSubscriber.unsubscribe(channel);
      await this.cacheService.delete(this.CONNECTION_TRACKING_PREFIX + userId);
    } catch (error) {
      this.logger.warn(`Error cleaning up Redis for user ${userId}`, error);
    }
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): {
    totalConnections: number;
    connectionsByUser: Record<string, Date>;
  } {
    const connectionsByUser: Record<string, Date> = {};

    for (const [userId, connection] of this.connections) {
      connectionsByUser[userId] = connection.connectedAt;
    }

    return {
      totalConnections: this.connections.size,
      connectionsByUser,
    };
  }

  /**
   * Clean up all connections (for graceful shutdown)
   */
  async cleanup(): Promise<void> {
    this.logger.log('Cleaning up all SSE connections');

    const cleanupPromises: Promise<void>[] = [];
    for (const [userId] of this.connections) {
      cleanupPromises.push(this.removeConnection(userId));
    }

    await Promise.all(cleanupPromises);

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Clean up Redis connections (ignore if already closed or no-op)
    if (this.redisPublisher) {
      try {
        const p = this.redisPublisher as Redis & { status?: string };
        if (
          p.status === 'ready' ||
          p.status === 'connecting' ||
          p.status === 'reconnecting'
        ) {
          await this.redisPublisher.quit();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== 'Connection is closed.')
          this.logger.warn('Redis publisher quit:', msg);
      }
    }
    if (this.redisSubscriber) {
      try {
        const s = this.redisSubscriber as Redis & { status?: string };
        if (
          s.status === 'ready' ||
          s.status === 'connecting' ||
          s.status === 'reconnecting'
        ) {
          await this.redisSubscriber.quit();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg !== 'Connection is closed.')
          this.logger.warn('Redis subscriber quit:', msg);
      }
    }
  }

  /**
   * Module destroy hook for graceful shutdown
   */
  async onModuleDestroy(): Promise<void> {
    await this.cleanup();
  }
}
