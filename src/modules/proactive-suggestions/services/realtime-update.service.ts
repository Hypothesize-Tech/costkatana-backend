/**
 * Realtime Update Service
 *
 * Handles real-time communication with clients:
 * - Server-sent events (SSE) for proactive suggestions
 * - WebSocket connections for real-time updates
 * - User-specific broadcasting
 * - Connection management
 */

import { Injectable, Logger, OnModuleDestroy, Inject } from '@nestjs/common';
import { CacheService } from '../../../common/cache/cache.service';
import Redis from 'ioredis';
import { isRedisEnabled } from '../../../config/redis';

export interface ProactiveSuggestion {
  id: string;
  type: string;
  message: string;
  potentialSavings: number;
  details?: Record<string, any>;
  timestamp: Date;
  status: 'pending' | 'accepted' | 'rejected';
  userId: string;
}

@Injectable()
export class RealtimeUpdateService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeUpdateService.name);
  private redisPublisher: Redis;
  private redisSubscriber: Redis;
  private userConnections = new Map<
    string,
    {
      response: any;
      lastActivity: Date;
    }
  >();

  // Suggestion history
  private suggestionHistory = new Map<string, ProactiveSuggestion>();

  private readonly SSE_CHANNEL_PREFIX = 'sse_proactive:';
  private readonly CONNECTION_TRACKING_PREFIX = 'sse_conn_proactive:';

  constructor(@Inject(CacheService) private cacheService: CacheService) {
    this.initializeRedis();
    this.setupRedisSubscriptions();
  }

  /**
   * Initialize Redis clients for pub/sub. On failure, use no-op clients so app (and MongoDB) can start without Redis.
   */
  private initializeRedis(): void {
    if (!isRedisEnabled()) {
      this.logger.log(
        'Redis disabled - using no-op pub/sub (proactive SSE will work in single-instance only)',
      );
      this.redisPublisher = this.createNoOpRedis();
      this.redisSubscriber = this.createNoOpRedis();
      return;
    }

    try {
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
          `Redis proactive subscriber error: ${err?.message ?? err}`,
        );
      });

      this.logger.log('Redis pub/sub clients initialized for proactive SSE');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Redis unavailable for proactive SSE (using no-op; app will run without cross-instance proactive SSE): ${msg}`,
      );
      this.redisPublisher = this.createNoOpRedis();
      this.redisSubscriber = this.createNoOpRedis();
    }
  }

  /** No-op Redis client when Redis is unavailable. */
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
        this.logger.error('Failed to handle proactive Redis message', {
          channel,
          message,
          error,
        });
      }
    });

    this.redisSubscriber.on('error', (error) => {
      this.logger.error('Redis proactive subscriber error', error);
    });
  }

  /**
   * Handle incoming Redis messages for SSE events
   */
  private handleRedisMessage(userId: string, eventData: any): void {
    const connection = this.userConnections.get(userId);
    if (!connection) {
      return; // No local connection for this user
    }

    try {
      const eventString = `data: ${JSON.stringify(eventData)}\n\n`;
      connection.response.write(eventString);
      connection.lastActivity = new Date();
    } catch (error) {
      this.logger.warn(
        `Failed to send proactive Redis event to user ${userId}, removing connection`,
        error,
      );
      this.removeConnection(userId);
    }
  }

  /**
   * Remove connection for user (delegates to unregisterConnection)
   */
  private removeConnection(userId: string): void {
    this.unregisterConnection(userId);
  }

  /**
   * Register SSE connection for user
   */
  async registerConnection(userId: string, response: any): Promise<void> {
    this.userConnections.set(userId, {
      response,
      lastActivity: new Date(),
    });

    // Set SSE headers
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    });

    // Subscribe to Redis channel for this user
    const channel = this.SSE_CHANNEL_PREFIX + userId;
    await this.redisSubscriber.subscribe(channel);

    // Track connection in Redis for cross-instance awareness
    await this.cacheService.set(
      this.CONNECTION_TRACKING_PREFIX + userId,
      {
        connectedAt: new Date().toISOString(),
        instanceId: process.env.NODE_APP_INSTANCE || 'default',
      },
      300, // 5 minutes TTL
    );

    // Send initial connection event
    await this.broadcastToUser(userId, {
      type: 'connection_established',
      message: 'Real-time connection established',
      timestamp: new Date().toISOString(),
    });

    this.logger.log('SSE connection registered', { userId });
  }

  /**
   * Unregister SSE connection for user
   */
  async unregisterConnection(userId: string): Promise<void> {
    this.userConnections.delete(userId);

    // Clean up Redis subscription and tracking
    try {
      const channel = this.SSE_CHANNEL_PREFIX + userId;
      await this.redisSubscriber.unsubscribe(channel);
      await this.cacheService.delete(this.CONNECTION_TRACKING_PREFIX + userId);
    } catch (error) {
      this.logger.warn(
        `Error cleaning up proactive Redis for user ${userId}`,
        error,
      );
    }

    this.logger.log('SSE connection unregistered', { userId });
  }

  /**
   * Broadcast message to specific user via Redis pub/sub
   */
  async broadcastToUser(userId: string, data: any): Promise<void> {
    try {
      const eventData = {
        ...data,
        userId,
        timestamp: new Date().toISOString(),
      };

      // Publish to Redis channel for cross-instance communication
      const channel = this.SSE_CHANNEL_PREFIX + userId;
      await this.redisPublisher.publish(channel, JSON.stringify(eventData));

      // Also send to local connection if it exists (for immediate delivery)
      const connection = this.userConnections.get(userId);
      if (connection) {
        try {
          connection.response.write(`data: ${JSON.stringify(eventData)}\n\n`);
          connection.lastActivity = new Date();
        } catch (error) {
          this.logger.warn(
            `Failed to send local proactive event to user ${userId}, removing connection`,
            error,
          );
          this.removeConnection(userId);
        }
      }

      this.logger.debug('Message broadcasted to user', {
        userId,
        eventType: data.type,
        message: data.message?.substring(0, 50),
      });
    } catch (error) {
      this.logger.error('Failed to broadcast to user', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
    }
  }

  /**
   * Emit proactive suggestion to user
   */
  emitProactiveSuggestion(
    userId: string,
    suggestion: ProactiveSuggestion,
  ): void {
    // Store in history
    this.suggestionHistory.set(suggestion.id, suggestion);

    // Broadcast to user
    this.broadcastToUser(userId, {
      type: 'proactive_suggestion',
      suggestion: {
        id: suggestion.id,
        type: suggestion.type,
        message: suggestion.message,
        potentialSavings: suggestion.potentialSavings,
        details: suggestion.details,
        timestamp: suggestion.timestamp,
        status: suggestion.status,
      },
    });

    this.logger.log('Proactive suggestion emitted', {
      userId,
      suggestionId: suggestion.id,
      type: suggestion.type,
      potentialSavings: suggestion.potentialSavings,
    });
  }

  /**
   * Send cost saving suggestions to user
   */
  sendCostSavingSuggestions(
    userId: string,
    suggestions: Array<{
      id: string;
      type: string;
      title: string;
      description: string;
      estimatedSavings: number;
      savingsPercentage: number;
      priority: string;
      actions: Array<{
        type: string;
        label: string;
        params?: Record<string, any>;
      }>;
    }>,
  ): void {
    this.broadcastToUser(userId, {
      type: 'cost_saving_suggestions',
      message: `${suggestions.length} new cost-saving opportunities available`,
      totalPotentialSavings: suggestions.reduce(
        (sum, s) => sum + s.estimatedSavings,
        0,
      ),
      suggestions,
    });

    this.logger.log('Cost saving suggestions sent', {
      userId,
      suggestionCount: suggestions.length,
      totalSavings: suggestions.reduce((sum, s) => sum + s.estimatedSavings, 0),
    });
  }

  /**
   * Send notification to user
   */
  sendNotification(
    userId: string,
    notification: {
      type: string;
      title: string;
      message: string;
      severity?: 'low' | 'medium' | 'high' | 'critical';
      data?: Record<string, any>;
    },
  ): void {
    this.broadcastToUser(userId, {
      ...notification,
      type: notification.type ?? 'notification',
    });

    this.logger.log('Notification sent', {
      userId,
      notificationType: notification.type,
      severity: notification.severity,
    });
  }

  /**
   * Track suggestion acceptance
   */
  trackSuggestionAcceptance(suggestionId: string, userId: string): void {
    const suggestion = this.suggestionHistory.get(suggestionId);
    if (suggestion && suggestion.userId === userId) {
      suggestion.status = 'accepted';

      // Broadcast acceptance confirmation
      this.broadcastToUser(userId, {
        type: 'suggestion_accepted',
        suggestionId,
        message: `Suggestion "${suggestion.type}" accepted`,
      });

      this.logger.log('Suggestion accepted', {
        suggestionId,
        userId,
        type: suggestion.type,
      });
    } else {
      this.logger.warn(
        'Suggestion not found or unauthorized acceptance attempt',
        {
          suggestionId,
          userId,
        },
      );
    }
  }

  /**
   * Track suggestion rejection
   */
  trackSuggestionRejection(
    suggestionId: string,
    userId: string,
    reason?: string,
  ): void {
    const suggestion = this.suggestionHistory.get(suggestionId);
    if (suggestion && suggestion.userId === userId) {
      suggestion.status = 'rejected';

      // Broadcast rejection confirmation
      this.broadcastToUser(userId, {
        type: 'suggestion_rejected',
        suggestionId,
        reason,
        message: `Suggestion "${suggestion.type}" rejected`,
      });

      this.logger.log('Suggestion rejected', {
        suggestionId,
        userId,
        type: suggestion.type,
        reason,
      });
    } else {
      this.logger.warn(
        'Suggestion not found or unauthorized rejection attempt',
        {
          suggestionId,
          userId,
        },
      );
    }
  }

  /**
   * Get active connections count
   */
  getActiveConnectionsCount(): number {
    return this.userConnections.size;
  }

  /**
   * Clean up inactive connections
   */
  async cleanupInactiveConnections(maxAgeMinutes: number = 30): Promise<void> {
    const now = new Date();
    const maxAge = maxAgeMinutes * 60 * 1000; // Convert to milliseconds

    const cleanupPromises: Promise<void>[] = [];
    for (const [userId, connection] of this.userConnections.entries()) {
      const age = now.getTime() - connection.lastActivity.getTime();
      if (age > maxAge) {
        cleanupPromises.push(this.unregisterConnection(userId));
        this.logger.log('Cleaned up inactive connection', {
          userId,
          ageMinutes: age / (60 * 1000),
        });
      }
    }

    await Promise.all(cleanupPromises);
  }

  /**
   * Send heartbeat to all connections
   */
  sendHeartbeat(): void {
    const message = {
      type: 'heartbeat',
      timestamp: new Date().toISOString(),
      activeConnections: this.getActiveConnectionsCount(),
    };

    for (const userId of this.userConnections.keys()) {
      this.broadcastToUser(userId, message);
    }

    this.logger.debug('Heartbeat sent to all connections', {
      connectionCount: this.userConnections.size,
    });
  }

  /**
   * Get connection status for user
   */
  isUserConnected(userId: string): boolean {
    return this.userConnections.has(userId);
  }

  /**
   * Module destroy hook for graceful shutdown
   */
  async onModuleDestroy(): Promise<void> {
    // Clean up all connections
    const cleanupPromises: Promise<void>[] = [];
    for (const userId of this.userConnections.keys()) {
      cleanupPromises.push(this.unregisterConnection(userId));
    }
    await Promise.all(cleanupPromises);

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
}
