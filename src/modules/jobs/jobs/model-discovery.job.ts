import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

interface ModelDiscoveryResult {
  provider: string;
  modelsDiscovered: number;
  modelsValidated: number;
  modelsFailed: number;
  modelsSkipped: number;
  errors: string[];
  discoveryDate: Date;
  duration: number;
}

interface ProviderDiscoveryConfig {
  provider: string;
  apiEndpoint?: string;
  apiKey?: string;
  modelListEndpoint?: string;
  expectedModelPatterns: RegExp[];
  pricingEndpoint?: string;
  headers?: Record<string, string>;
}

interface DiscoveredModel {
  name: string;
  provider: string;
  modelId: string;
  capabilities?: string[];
  contextWindow?: number;
  pricing?: {
    inputCost: number;
    outputCost: number;
    currency: string;
  };
  status: 'active' | 'beta' | 'deprecated';
  discoveredAt: Date;
  lastValidated: Date;
}

@Injectable()
export class ModelDiscoveryJob {
  private readonly logger = new Logger(ModelDiscoveryJob.name);
  private isRunning = false;

  // Provider discovery configurations
  private readonly PROVIDER_CONFIGS: Record<string, ProviderDiscoveryConfig> = {
    openai: {
      provider: 'openai',
      apiEndpoint: 'https://api.openai.com/v1/models',
      expectedModelPatterns: [/gpt-\d+/, /dall-e/, /whisper/, /tts/, /o\d+/],
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY || ''}`,
        'Content-Type': 'application/json',
      },
    },
    anthropic: {
      provider: 'anthropic',
      apiEndpoint: 'https://api.anthropic.com/v1/messages',
      expectedModelPatterns: [/claude-/, /opus/, /sonnet/, /haiku/],
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
    },
    google: {
      provider: 'google',
      apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
      expectedModelPatterns: [/gemini-/, /palm-/],
      headers: {
        'x-goog-api-key': process.env.GOOGLE_AI_API_KEY || '',
      },
    },
    groq: {
      provider: 'groq',
      apiEndpoint: 'https://api.groq.com/openai/v1/models',
      expectedModelPatterns: [/llama/, /mixtral/, /gemma/],
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY || ''}`,
        'Content-Type': 'application/json',
      },
    },
    together: {
      provider: 'together',
      apiEndpoint: 'https://api.together.xyz/v1/models',
      expectedModelPatterns: [/llama/, /codellama/, /mistral/, /qwen/],
      headers: {
        Authorization: `Bearer ${process.env.TOGETHER_API_KEY || ''}`,
        'Content-Type': 'application/json',
      },
    },
  };

  constructor(
    private readonly httpService: HttpService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /**
   * Run the model discovery job
   */
  async run(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'Model discovery job already running, skipping this cycle',
      );
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      this.logger.log('🔍 Starting model discovery job...');

      const providers = Object.keys(this.PROVIDER_CONFIGS);
      const results: ModelDiscoveryResult[] = [];

      for (const provider of providers) {
        try {
          this.logger.log(`🔍 Discovering models for ${provider}...`);
          const result = await this.discoverModelsForProvider(provider);
          results.push(result);

          this.logger.log(`✅ ${provider} discovery completed`, {
            discovered: result.modelsDiscovered,
            validated: result.modelsValidated,
            failed: result.modelsFailed,
            skipped: result.modelsSkipped,
          });
        } catch (error) {
          this.logger.error(
            `❌ Failed to discover models for ${provider}`,
            error,
          );
          results.push({
            provider,
            modelsDiscovered: 0,
            modelsValidated: 0,
            modelsFailed: 0,
            modelsSkipped: 0,
            errors: [error instanceof Error ? error.message : String(error)],
            discoveryDate: new Date(),
            duration: Date.now() - startTime,
          });
        }

        // Rate limiting between providers
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const totalDiscovered = results.reduce(
        (sum, r) => sum + r.modelsDiscovered,
        0,
      );
      const totalValidated = results.reduce(
        (sum, r) => sum + r.modelsValidated,
        0,
      );
      const totalFailed = results.reduce((sum, r) => sum + r.modelsFailed, 0);

      const duration = Date.now() - startTime;
      this.logger.log('✅ Model discovery job completed', {
        totalProviders: providers.length,
        totalDiscovered,
        totalValidated,
        totalFailed,
        durationMs: duration,
      });
    } catch (error) {
      this.logger.error('❌ Model discovery job failed', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Discover models for a specific provider
   */
  private async discoverModelsForProvider(
    provider: string,
  ): Promise<ModelDiscoveryResult> {
    const startTime = Date.now();
    const config = this.PROVIDER_CONFIGS[provider];

    if (!config) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    const result: ModelDiscoveryResult = {
      provider,
      modelsDiscovered: 0,
      modelsValidated: 0,
      modelsFailed: 0,
      modelsSkipped: 0,
      errors: [],
      discoveryDate: new Date(),
      duration: 0,
    };

    try {
      // Get existing models to avoid duplicates
      const existingModels = await this.getExistingModels(provider);
      const existingModelIds = new Set(existingModels.map((m) => m.modelId));

      // Discover new models from provider API
      const discoveredModels = await this.fetchModelsFromProvider(config);

      // Filter to new models only
      const newModels = discoveredModels.filter(
        (model) => !existingModelIds.has(this.normalizeModelId(model.name)),
      );

      result.modelsSkipped = discoveredModels.length - newModels.length;
      result.modelsDiscovered = newModels.length;

      this.logger.log(`Found ${newModels.length} new models for ${provider}`);

      // Validate and save new models
      for (const model of newModels) {
        try {
          const validated = await this.validateModel(model, config);
          if (validated) {
            await this.saveModel(validated);
            result.modelsValidated++;
          } else {
            result.modelsFailed++;
          }
        } catch (error) {
          this.logger.warn(`Failed to validate model ${model.name}`, error);
          result.modelsFailed++;
          result.errors.push(
            `Validation failed for ${model.name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : String(error),
      );
      this.logger.error(`Model discovery failed for ${provider}`, error);
    }

    result.duration = Date.now() - startTime;
    return result;
  }

  /**
   * Fetch models from provider API
   */
  private async fetchModelsFromProvider(
    config: ProviderDiscoveryConfig,
  ): Promise<DiscoveredModel[]> {
    const discoveredModels: DiscoveredModel[] = [];

    try {
      if (!config.apiEndpoint) {
        throw new Error('No API endpoint configured for provider');
      }

      // Make API request to get model list
      const response = await firstValueFrom(
        this.httpService.get(config.apiEndpoint, {
          headers: config.headers,
          timeout: 30000, // 30 second timeout
        }),
      );

      const models = this.parseProviderResponse(config.provider, response.data);

      // Filter models based on expected patterns
      const validModels = models.filter((model) =>
        config.expectedModelPatterns.some((pattern) =>
          pattern.test(model.name),
        ),
      );

      // Convert to DiscoveredModel format
      for (const model of validModels) {
        discoveredModels.push({
          name: model.name,
          provider: config.provider,
          modelId: this.normalizeModelId(model.name),
          capabilities: model.capabilities || [],
          contextWindow: model.contextWindow,
          pricing: model.pricing,
          status: model.status || 'active',
          discoveredAt: new Date(),
          lastValidated: new Date(),
        });
      }
    } catch (error) {
      this.logger.warn(
        `Failed to fetch models from ${config.provider} API`,
        error,
      );
      // Continue with empty results - some providers might not have APIs
    }

    return discoveredModels;
  }

  /**
   * Parse provider-specific API response
   */
  private parseProviderResponse(provider: string, data: any): any[] {
    switch (provider) {
      case 'openai':
        return (
          data.data?.map((model: any) => ({
            name: model.id,
            capabilities: model.capabilities || [],
            status: model.status || 'active',
          })) || []
        );

      case 'anthropic':
        // Anthropic doesn't have a models endpoint, return known models
        return [
          { name: 'claude-3-opus-20240229', status: 'active' },
          { name: 'claude-3-sonnet-20240229', status: 'active' },
          { name: 'claude-3-haiku-20240307', status: 'active' },
          { name: 'claude-3-5-sonnet-20240620', status: 'active' },
        ];

      case 'google':
        return (
          data.models?.map((model: any) => ({
            name: model.name.replace('models/', ''),
            capabilities: model.capabilities || [],
            status: 'active',
          })) || []
        );

      case 'groq':
      case 'together':
        return (
          data.data?.map((model: any) => ({
            name: model.id,
            capabilities: model.capabilities || [],
            contextWindow: model.context_window,
            status: 'active',
          })) || []
        );

      default:
        return [];
    }
  }

  /**
   * Validate a discovered model
   */
  private async validateModel(
    model: DiscoveredModel,
    config: ProviderDiscoveryConfig,
  ): Promise<DiscoveredModel | null> {
    try {
      // Basic validation
      if (!model.name || !model.provider) {
        throw new Error('Missing required model fields');
      }

      // Check if model name matches expected patterns
      const matchesPattern = config.expectedModelPatterns.some((pattern) =>
        pattern.test(model.name),
      );
      if (!matchesPattern) {
        throw new Error('Model name does not match expected patterns');
      }

      // Additional validation: Test basic API connectivity
      try {
        const connectivityTest = await this.testModelConnectivity(
          model,
          config,
        );
        if (!connectivityTest.available) {
          throw new Error(`Model not available: ${connectivityTest.reason}`);
        }
      } catch (connectivityError) {
        this.logger.warn(
          `Connectivity test failed for ${model.name}`,
          connectivityError,
        );
        // Don't fail validation for connectivity issues - model might be temporarily unavailable
      }

      // Validate pricing information if available
      if (model.pricing) {
        if (model.pricing.inputCost < 0 || model.pricing.outputCost < 0) {
          throw new Error('Invalid pricing: negative costs not allowed');
        }
        if (!['USD', 'EUR', 'GBP'].includes(model.pricing.currency)) {
          throw new Error(`Unsupported currency: ${model.pricing.currency}`);
        }
      }

      // Validate capabilities array
      if (model.capabilities && Array.isArray(model.capabilities)) {
        const validCapabilities = [
          'chat',
          'completion',
          'embedding',
          'image',
          'audio',
          'vision',
        ];
        const invalidCapabilities = model.capabilities.filter(
          (cap) => !validCapabilities.includes(cap.toLowerCase()),
        );
        if (invalidCapabilities.length > 0) {
          this.logger.warn(
            `Unknown capabilities for ${model.name}: ${invalidCapabilities.join(', ')}`,
          );
        }
      }

      // Validate context window if provided
      if (
        model.contextWindow &&
        (model.contextWindow < 100 || model.contextWindow > 1000000)
      ) {
        throw new Error(
          `Invalid context window: ${model.contextWindow} tokens`,
        );
      }

      return {
        ...model,
        lastValidated: new Date(),
        capabilities: model.capabilities || [],
        pricing: model.pricing || undefined,
        contextWindow: model.contextWindow || undefined,
      };
    } catch (error) {
      this.logger.warn(`Model validation failed for ${model.name}`, error);
      return null;
    }
  }

  /**
   * Save validated model to database
   */
  private async saveModel(model: DiscoveredModel): Promise<void> {
    try {
      // Create model registry entry
      const modelRegistryEntry = {
        modelId: model.modelId,
        name: model.name,
        provider: model.provider,
        capabilities: model.capabilities || [],
        contextWindow: model.contextWindow,
        pricing: model.pricing,
        status: model.status,
        discoveredAt: model.discoveredAt,
        lastValidated: model.lastValidated,
        metadata: {
          discoveredBy: 'model-discovery-job',
          discoverySource: 'api',
          version: '1.0',
          supportedFeatures: model.capabilities,
          performanceMetrics: {},
          usageStats: {
            totalRequests: 0,
            totalTokens: 0,
            avgLatency: 0,
            errorRate: 0,
          },
        },
      };

      // Use MongoDB collection for model registry
      const collection = this.getModelRegistryCollection();
      if (!collection) {
        throw new Error('Model registry collection not available');
      }

      // Upsert the model (insert if doesn't exist, update if exists)
      await collection.updateOne(
        { modelId: model.modelId },
        {
          $set: modelRegistryEntry,
          $setOnInsert: { createdAt: new Date() },
          $currentDate: { updatedAt: true },
        },
        { upsert: true },
      );

      this.logger.log(`💾 Saved discovered model: ${model.name}`, {
        provider: model.provider,
        modelId: model.modelId,
        capabilities: model.capabilities,
        status: model.status,
      });
    } catch (error) {
      this.logger.error(`Failed to save model ${model.name}`, error);
      throw error;
    }
  }

  /**
   * Get MongoDB collection for model registry
   */
  private getModelRegistryCollection() {
    return this.connection?.db?.collection('model_registry');
  }

  /**
   * Get existing models for a provider
   */
  private async getExistingModels(provider: string): Promise<any[]> {
    try {
      const collection = this.getModelRegistryCollection();
      if (!collection) {
        return [];
      }

      const existingModels = await collection
        .find(
          {
            provider,
            status: { $in: ['active', 'beta'] },
          },
          {
            projection: {
              modelId: 1,
              name: 1,
              provider: 1,
              status: 1,
              lastValidated: 1,
            },
          },
        )
        .toArray();

      this.logger.debug(
        `Found ${existingModels.length} existing models for ${provider}`,
      );

      return existingModels;
    } catch (error) {
      this.logger.warn(`Failed to get existing models for ${provider}`, error);
      return [];
    }
  }

  /**
   * Test model connectivity and availability
   */
  private async testModelConnectivity(
    model: DiscoveredModel,
    config: ProviderDiscoveryConfig,
  ): Promise<{ available: boolean; reason?: string }> {
    try {
      // For OpenAI models, we can test with a minimal request
      if (config.provider === 'openai' && process.env.OPENAI_API_KEY) {
        const testResponse = await firstValueFrom(
          this.httpService.post(
            'https://api.openai.com/v1/chat/completions',
            {
              model: model.name,
              messages: [{ role: 'user', content: 'test' }],
              max_tokens: 1,
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
              },
              timeout: 5000, // 5 second timeout for connectivity test
            },
          ),
        );

        if (testResponse.data?.choices?.[0]) {
          return { available: true };
        }
      }

      // For Anthropic models
      if (config.provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
        const testResponse = await firstValueFrom(
          this.httpService.post(
            'https://api.anthropic.com/v1/messages',
            {
              model: model.name,
              max_tokens: 1,
              messages: [{ role: 'user', content: 'test' }],
            },
            {
              headers: {
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json',
              },
              timeout: 5000,
            },
          ),
        );

        if (testResponse.data?.content?.[0]) {
          return { available: true };
        }
      }

      // For other providers, assume available if we can reach their API
      // This is a basic connectivity test
      if (config.apiEndpoint) {
        try {
          await firstValueFrom(
            this.httpService.get(config.apiEndpoint, {
              headers: config.headers,
              timeout: 3000,
            }),
          );
          return { available: true };
        } catch (apiError) {
          return { available: false, reason: 'API endpoint unreachable' };
        }
      }

      // If no specific test available, assume available
      return { available: true };
    } catch (error) {
      return {
        available: false,
        reason:
          error instanceof Error ? error.message : 'Connectivity test failed',
      };
    }
  }

  /**
   * Normalize model ID for comparison
   */
  private normalizeModelId(modelName: string): string {
    return modelName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }

  /**
   * Run once (for manual trigger or testing)
   */
  async runOnce(): Promise<void> {
    await this.run();
  }
}
