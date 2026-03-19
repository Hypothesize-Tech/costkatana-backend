/**
 * Distributed Chat Events Service (Redis)
 * Redis-based implementation for horizontal scaling across multiple server instances
 * Uses Redis pub/sub for event distribution
 * Implements IChatEventsService for consistency
 *
 * In local development without Redis, skips connection and remains uninitialized.
 * ChatEventsFactoryService falls back to in-process emitter when Redis is unavailable.
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { isRedisEnabled, resolveRedisUrl } from '../../../config/redis';
import { ChatEventData, IChatEventsService } from './chat-events.interface';
import { generateSecureId } from '../../../common/utils/secure-id.util';

@Injectable()
export class ChatEventsRedisService
  implements IChatEventsService, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ChatEventsRedisService.name);
  private publisher: Redis | null = null;
  private subscriber: Redis | null = null;
  private readonly instanceId: string;
  private readonly listeners: Map<string, Set<(event: ChatEventData) => void>> =
    new Map();
  private isInitialized = false;

  constructor(private configService: ConfigService) {
    this.instanceId = generateSecureId('instance');
  }

  async onModuleInit() {
    // Skip Redis in local development when Redis is not configured
    if (!isRedisEnabled()) {
      this.logger.log(
        'Redis disabled - ChatEventsRedisService skipped (using in-process emitter fallback)',
      );
      return;
    }

    try {
      const redisUrl = resolveRedisUrl();
      const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

      // Create separate publisher and subscriber connections
      const publisher = new Redis(redisUrl, {
        password: redisPassword,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });

      const subscriber = new Redis(redisUrl, {
        password: redisPassword,
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });

      // Suppress unhandled error events (connection refused in local dev)
      publisher.on('error', (err) => {
        this.logger.warn('Redis publisher error (non-fatal)', {
          error: err.message,
        });
      });
      subscriber.on('error', (err) => {
        this.logger.warn('Redis subscriber error (non-fatal)', {
          error: err.message,
        });
      });

      // Connect both clients
      await Promise.all([publisher.connect(), subscriber.connect()]);

      this.publisher = publisher;
      this.subscriber = subscriber;

      // Set up subscription handlers
      this.subscriber.on('message', (channel, message) => {
        this.handleRedisMessage(channel, message);
      });

      this.isInitialized = true;
      this.logger.log(
        `Chat events Redis service initialized (instance: ${this.instanceId})`,
      );
    } catch (error) {
      // Graceful degradation: don't throw - allow emitter fallback
      this.logger.warn(
        'Failed to initialize Redis chat events service - falling back to in-process emitter',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }

  async onModuleDestroy() {
    await this.cleanup();
  }

  /**
   * Emit a chat event via Redis pub/sub
   */
  async emit(event: ChatEventData): Promise<void> {
    if (!this.isInitialized || !this.publisher) {
      throw new Error('Redis chat events service not initialized');
    }

    try {
      // Add instance ID to event for tracking
      const eventWithInstance = { ...event, instanceId: this.instanceId };

      // Publish to specific chat channel
      const chatChannel = `chat:${event.chatId}`;
      await this.publisher.publish(
        chatChannel,
        JSON.stringify(eventWithInstance),
      );

      // Publish to wildcard channels
      await Promise.all([
        this.publisher.publish(
          `chat:${event.chatId}:*`,
          JSON.stringify(eventWithInstance),
        ),
        this.publisher.publish('chat:*', JSON.stringify(eventWithInstance)),
      ]);

      this.logger.debug(`Published chat event to Redis: ${chatChannel}`, {
        chatId: event.chatId,
        userId: event.userId,
        type: event.type,
        instanceId: this.instanceId,
      });
    } catch (error) {
      this.logger.error('Failed to emit chat event via Redis', {
        error: error instanceof Error ? error.message : String(error),
        chatId: event.chatId,
      });
      throw error;
    }
  }

  /**
   * Listen for chat events by subscribing to Redis channels
   */
  on(eventPattern: string, listener: (event: ChatEventData) => void): void {
    // Store listener locally
    if (!this.listeners.has(eventPattern)) {
      this.listeners.set(eventPattern, new Set());
    }
    this.listeners.get(eventPattern)?.add(listener);

    // Subscribe to Redis channel if not already subscribed
    if (this.isInitialized && this.subscriber) {
      this.subscriber.subscribe(eventPattern).catch((error) => {
        this.logger.error('Failed to subscribe to Redis channel', {
          channel: eventPattern,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  /**
   * Remove event listener
   */
  off(eventPattern: string, listener?: (event: ChatEventData) => void): void {
    const listeners = this.listeners.get(eventPattern);
    if (!listeners) return;

    if (listener) {
      listeners.delete(listener);
    } else {
      listeners.clear();
    }

    // Unsubscribe from Redis if no more listeners
    if (listeners.size === 0 && this.isInitialized && this.subscriber) {
      this.subscriber.unsubscribe(eventPattern).catch((error) => {
        this.logger.warn('Failed to unsubscribe from Redis channel', {
          channel: eventPattern,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  /**
   * Get listener count for debugging
   */
  getListenerCount(eventPattern?: string): number {
    if (eventPattern) {
      return this.listeners.get(eventPattern)?.size || 0;
    }
    return Array.from(this.listeners.values()).reduce(
      (total, set) => total + set.size,
      0,
    );
  }

  /**
   * Handle incoming Redis messages and dispatch to local listeners
   */
  private handleRedisMessage(channel: string, message: string): void {
    try {
      const event: ChatEventData = JSON.parse(message);

      // Skip events from this instance to prevent echo
      if (event.instanceId === this.instanceId) {
        return;
      }

      // Dispatch to local listeners
      const listeners = this.listeners.get(channel);
      if (listeners) {
        listeners.forEach((listener) => {
          try {
            listener(event);
          } catch (error) {
            this.logger.error('Error in chat event listener', {
              error: error instanceof Error ? error.message : String(error),
              channel,
              chatId: event.chatId,
            });
          }
        });
      }
    } catch (error) {
      this.logger.error('Failed to handle Redis message', {
        error: error instanceof Error ? error.message : String(error),
        channel,
        message: message.substring(0, 200), // Truncate for logging
      });
    }
  }

  /**
   * Emit message event
   */
  async emitMessage(
    chatId: string,
    userId: string,
    message: any,
  ): Promise<void> {
    await this.emit({
      chatId,
      userId,
      type: 'message',
      data: message,
      timestamp: new Date(),
    });
  }

  /**
   * Emit typing event
   */
  async emitTyping(
    chatId: string,
    userId: string,
    isTyping: boolean,
  ): Promise<void> {
    await this.emit({
      chatId,
      userId,
      type: 'typing',
      data: { isTyping, userId },
      timestamp: new Date(),
    });
  }

  /**
   * Emit status update event
   */
  async emitStatus(
    chatId: string,
    userId: string,
    status: string,
    metadata?: any,
  ): Promise<void> {
    await this.emit({
      chatId,
      userId,
      type: 'status',
      data: { status, metadata },
      timestamp: new Date(),
    });
  }

  /**
   * Emit error event
   */
  async emitError(
    chatId: string,
    userId: string,
    error: string,
    details?: any,
  ): Promise<void> {
    await this.emit({
      chatId,
      userId,
      type: 'error',
      data: { error, details },
      timestamp: new Date(),
    });
  }

  /**
   * Sync check if Redis is connected and usable (for factory fallback decision)
   */
  get isUsable(): boolean {
    return (
      this.isInitialized && this.publisher != null && this.subscriber != null
    );
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    if (!this.isInitialized || !this.publisher || !this.subscriber)
      return false;

    try {
      await this.publisher.ping();
      await this.subscriber.ping();
      return true;
    } catch (error) {
      this.logger.warn('Redis health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get service type
   */
  getServiceType(): 'in-process' | 'redis' | 'bullmq' {
    return 'redis';
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    this.listeners.clear();

    if (this.publisher) {
      try {
        await this.publisher.quit();
      } catch (err) {
        this.logger.debug('Error closing Redis publisher', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.publisher = null;
    }

    if (this.subscriber) {
      try {
        await this.subscriber.quit();
      } catch (err) {
        this.logger.debug('Error closing Redis subscriber', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      this.subscriber = null;
    }

    this.isInitialized = false;
    this.logger.log('Chat events Redis service cleaned up');
  }
}
