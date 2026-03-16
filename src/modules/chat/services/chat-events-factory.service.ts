/**
 * Chat Events Service Factory
 * Provides the appropriate chat events service implementation based on configuration
 * Supports switching between in-process (EventEmitter2) and distributed (Redis) implementations
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isRedisEnabled } from '../../../config/redis';
import { IChatEventsService } from './chat-events.interface';
import { ChatEventsEmitterService } from './chat-events-emitter.service';
import { ChatEventsRedisService } from './chat-events-redis.service';

export type ChatEventsProvider = 'emitter' | 'redis' | 'auto';

@Injectable()
export class ChatEventsFactoryService {
  private readonly logger = new Logger(ChatEventsFactoryService.name);
  private currentService: IChatEventsService | null = null;

  constructor(
    private configService: ConfigService,
    private emitterService: ChatEventsEmitterService,
    private redisService: ChatEventsRedisService,
  ) {}

  /**
   * Get the appropriate chat events service based on configuration
   */
  getService(): IChatEventsService {
    if (this.currentService) {
      return this.currentService;
    }

    const provider = this.getConfiguredProvider();
    this.currentService = this.createService(provider);

    this.logger.log(
      `Chat events service initialized with provider: ${provider}`,
      {
        serviceType: this.currentService.getServiceType(),
      },
    );

    return this.currentService;
  }

  /**
   * Switch to a different provider (for runtime reconfiguration)
   */
  async switchProvider(
    provider: ChatEventsProvider,
  ): Promise<IChatEventsService> {
    if (this.currentService) {
      await this.currentService.cleanup();
    }

    this.currentService = this.createService(provider);

    this.logger.log(`Switched chat events service to provider: ${provider}`, {
      serviceType: this.currentService.getServiceType(),
    });

    return this.currentService;
  }

  /**
   * Get current service health status
   */
  async getHealthStatus(): Promise<{
    provider: ChatEventsProvider;
    serviceType: 'in-process' | 'redis' | 'bullmq';
    healthy: boolean;
    listeners: number;
  }> {
    const provider = this.getConfiguredProvider();
    const service = this.getService();

    return {
      provider,
      serviceType: service.getServiceType(),
      healthy: await service.isHealthy(),
      listeners: service.getListenerCount(),
    };
  }

  /**
   * Get configured provider from environment
   */
  private getConfiguredProvider(): ChatEventsProvider {
    const configured = this.configService.get<string>(
      'CHAT_EVENTS_PROVIDER',
      'auto',
    );

    // Validate configuration
    if (!['emitter', 'redis', 'auto'].includes(configured)) {
      this.logger.warn(
        `Invalid CHAT_EVENTS_PROVIDER: ${configured}, falling back to 'auto'`,
      );
      return 'auto';
    }

    if (configured === 'auto') {
      // Auto-detect: use Redis if enabled (e.g. production), otherwise emitter (local dev)
      return isRedisEnabled() ? 'redis' : 'emitter';
    }

    return configured as ChatEventsProvider;
  }

  /**
   * Create the appropriate service instance
   */
  private createService(provider: ChatEventsProvider): IChatEventsService {
    switch (provider) {
      case 'emitter':
        return this.emitterService;

      case 'redis':
        // Fall back to emitter if Redis failed to initialize (e.g. local dev)
        if (!this.redisService.isUsable) {
          this.logger.warn(
            'Redis chat events not available - using in-process emitter fallback',
          );
          return this.emitterService;
        }
        return this.redisService;

      default:
        throw new Error(`Unsupported chat events provider: ${provider}`);
    }
  }
}
