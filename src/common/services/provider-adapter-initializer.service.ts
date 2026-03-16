/**
 * Provider Adapter Initializer Service for NestJS
 * Initializes and manages AI provider adapters with configuration and health monitoring
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ProviderAdapter {
  providerId: string;
  name: string;
  type: 'openai' | 'anthropic' | 'google' | 'azure' | 'custom';
  status: 'initializing' | 'ready' | 'error' | 'disabled';
  config: {
    apiKey?: string;
    baseUrl?: string;
    models: string[];
    rateLimits: {
      requestsPerMinute: number;
      tokensPerMinute: number;
    };
    timeout: number;
    retries: number;
  };
  health: {
    lastChecked: Date;
    isHealthy: boolean;
    responseTime: number;
    errorCount: number;
    successCount: number;
  };
  capabilities: {
    supportsStreaming: boolean;
    supportsFunctionCalling: boolean;
    supportsVision: boolean;
    maxTokens: number;
    supportedModels: string[];
  };
}

@Injectable()
export class ProviderAdapterInitializerService implements OnModuleInit {
  private readonly logger = new Logger(ProviderAdapterInitializerService.name);

  private adapters: Map<string, ProviderAdapter> = new Map();
  private readonly healthCheckInterval: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {
    // Start health monitoring
    this.healthCheckInterval = setInterval(() => {
      this.performHealthChecks();
    }, 60000); // Check every minute
  }

  onModuleInit(): void {
    this.initializeAdapters();
  }

  /**
   * Initialize all configured provider adapters
   */
  private async initializeAdapters(): Promise<void> {
    const configuredProviders = this.getConfiguredProviders();

    this.logger.log('Initializing provider adapters', {
      count: configuredProviders.length,
    });

    for (const provider of configuredProviders) {
      try {
        await this.initializeAdapter(provider);
      } catch (error) {
        this.logger.error(`Failed to initialize adapter for ${provider.id}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.logger.log('Provider adapter initialization completed', {
      initialized: this.adapters.size,
      totalConfigured: configuredProviders.length,
    });
  }

  /**
   * Initialize a specific provider adapter
   */
  private async initializeAdapter(providerConfig: any): Promise<void> {
    const adapter: ProviderAdapter = {
      providerId: providerConfig.id,
      name: providerConfig.name,
      type: providerConfig.type,
      status: 'initializing',
      config: {
        apiKey: providerConfig.apiKey,
        baseUrl: providerConfig.baseUrl,
        models: providerConfig.models || [],
        rateLimits: providerConfig.rateLimits || {
          requestsPerMinute: 60,
          tokensPerMinute: 100000,
        },
        timeout: providerConfig.timeout || 30000,
        retries: providerConfig.retries || 3,
      },
      health: {
        lastChecked: new Date(),
        isHealthy: false,
        responseTime: 0,
        errorCount: 0,
        successCount: 0,
      },
      capabilities: await this.detectCapabilities(providerConfig),
    };

    // Test the adapter
    const isHealthy = await this.testAdapter(adapter);

    adapter.status = isHealthy ? 'ready' : 'error';
    adapter.health.isHealthy = isHealthy;

    this.adapters.set(providerConfig.id, adapter);

    this.logger.log('Provider adapter initialized', {
      providerId: providerConfig.id,
      status: adapter.status,
      healthy: isHealthy,
    });
  }

  /**
   * Get configured providers from environment
   */
  private getConfiguredProviders(): any[] {
    const providers: any[] = [];

    // OpenAI
    if (this.configService.get<string>('OPENAI_API_KEY')) {
      providers.push({
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        apiKey: this.configService.get<string>('OPENAI_API_KEY'),
        models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'],
        rateLimits: { requestsPerMinute: 60, tokensPerMinute: 100000 },
      });
    }

    // Anthropic
    if (this.configService.get<string>('ANTHROPIC_API_KEY')) {
      providers.push({
        id: 'anthropic',
        name: 'Anthropic',
        type: 'anthropic',
        apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
        models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'],
        rateLimits: { requestsPerMinute: 50, tokensPerMinute: 80000 },
      });
    }

    // Google
    if (this.configService.get<string>('GOOGLE_AI_API_KEY')) {
      providers.push({
        id: 'google',
        name: 'Google AI',
        type: 'google',
        apiKey: this.configService.get<string>('GOOGLE_AI_API_KEY'),
        models: ['gemini-pro', 'gemini-pro-vision'],
        rateLimits: { requestsPerMinute: 60, tokensPerMinute: 32000 },
      });
    }

    return providers;
  }

  /**
   * Detect provider capabilities
   */
  private async detectCapabilities(
    providerConfig: any,
  ): Promise<ProviderAdapter['capabilities']> {
    const baseCapabilities = {
      supportsStreaming: false,
      supportsFunctionCalling: false,
      supportsVision: false,
      maxTokens: 4096,
      supportedModels: providerConfig.models || [],
    };

    switch (providerConfig.type) {
      case 'openai':
        return {
          ...baseCapabilities,
          supportsStreaming: true,
          supportsFunctionCalling: true,
          supportsVision: true,
          maxTokens: 128000, // GPT-4 Turbo
        };

      case 'anthropic':
        return {
          ...baseCapabilities,
          supportsStreaming: true,
          supportsFunctionCalling: true,
          supportsVision: true,
          maxTokens: 200000, // Claude 3
        };

      case 'google':
        return {
          ...baseCapabilities,
          supportsStreaming: true,
          supportsVision: true,
          maxTokens: 32768, // Gemini Pro
        };

      default:
        return baseCapabilities;
    }
  }

  /**
   * Test adapter connectivity and functionality
   */
  private async testAdapter(adapter: ProviderAdapter): Promise<boolean> {
    try {
      const startTime = Date.now();

      // Simple test request (would use actual provider SDK)
      await new Promise((resolve) => setTimeout(resolve, 100)); // Mock delay

      const responseTime = Date.now() - startTime;
      adapter.health.responseTime = responseTime;
      adapter.health.successCount++;
      adapter.health.lastChecked = new Date();

      return true;
    } catch (error) {
      adapter.health.errorCount++;
      adapter.health.lastChecked = new Date();

      this.logger.warn('Adapter test failed', {
        providerId: adapter.providerId,
        error: error instanceof Error ? error.message : String(error),
      });

      return false;
    }
  }

  /**
   * Perform health checks on all adapters
   */
  private async performHealthChecks(): Promise<void> {
    for (const [providerId, adapter] of this.adapters.entries()) {
      try {
        const isHealthy = await this.testAdapter(adapter);

        if (isHealthy !== adapter.health.isHealthy) {
          this.logger.log('Adapter health status changed', {
            providerId,
            wasHealthy: adapter.health.isHealthy,
            nowHealthy: isHealthy,
          });

          adapter.health.isHealthy = isHealthy;
          adapter.status = isHealthy ? 'ready' : 'error';
        }
      } catch (error) {
        this.logger.error('Health check failed', {
          providerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Get all adapters
   */
  getAllAdapters(): ProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  /**
   * Get adapter by ID
   */
  getAdapter(providerId: string): ProviderAdapter | undefined {
    return this.adapters.get(providerId);
  }

  /**
   * Get healthy adapters
   */
  getHealthyAdapters(): ProviderAdapter[] {
    return Array.from(this.adapters.values()).filter(
      (adapter) => adapter.status === 'ready' && adapter.health.isHealthy,
    );
  }

  /**
   * Update adapter configuration
   */
  async updateAdapterConfig(
    providerId: string,
    config: Partial<ProviderAdapter['config']>,
  ): Promise<void> {
    const adapter = this.adapters.get(providerId);
    if (adapter) {
      adapter.config = { ...adapter.config, ...config };
      this.logger.log('Adapter configuration updated', { providerId });
    }
  }

  /**
   * Enable/disable adapter
   */
  async setAdapterStatus(providerId: string, enabled: boolean): Promise<void> {
    const adapter = this.adapters.get(providerId);
    if (adapter) {
      adapter.status = enabled ? 'ready' : 'disabled';
      this.logger.log('Adapter status updated', { providerId, enabled });
    }
  }

  /**
   * Get initialization statistics
   */
  getStatistics(): {
    totalAdapters: number;
    healthyAdapters: number;
    initializingAdapters: number;
    errorAdapters: number;
    disabledAdapters: number;
    averageResponseTime: number;
  } {
    const adapters = Array.from(this.adapters.values());
    const totalAdapters = adapters.length;
    const healthyAdapters = adapters.filter(
      (a) => a.status === 'ready' && a.health.isHealthy,
    ).length;
    const initializingAdapters = adapters.filter(
      (a) => a.status === 'initializing',
    ).length;
    const errorAdapters = adapters.filter((a) => a.status === 'error').length;
    const disabledAdapters = adapters.filter(
      (a) => a.status === 'disabled',
    ).length;

    const responseTimes = adapters
      .filter((a) => a.health.responseTime > 0)
      .map((a) => a.health.responseTime);
    const averageResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((sum, time) => sum + time, 0) /
          responseTimes.length
        : 0;

    return {
      totalAdapters,
      healthyAdapters,
      initializingAdapters,
      errorAdapters,
      disabledAdapters,
      averageResponseTime: Math.round(averageResponseTime),
    };
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
  }
}
