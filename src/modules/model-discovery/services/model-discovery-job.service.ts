import { Injectable, Logger } from '@nestjs/common';
import { ModelDiscoveryService } from './model-discovery.service';
import { ModelDiscoveryFallbackService } from './model-discovery-fallback.service';

@Injectable()
export class ModelDiscoveryJobService {
  private readonly logger = new Logger(ModelDiscoveryJobService.name);

  private isRunning = false;
  private lastRun: Date | null = null;

  // All supported providers
  private readonly PROVIDERS = [
    'openai',
    'anthropic',
    'google-ai',
    'aws-bedrock',
    'cohere',
    'mistral',
    'xai',
  ];

  constructor(
    private readonly modelDiscoveryService: ModelDiscoveryService,
    private readonly modelDiscoveryFallbackService: ModelDiscoveryFallbackService,
  ) {}

  /**
   * Manually trigger discovery (for testing or immediate updates)
   */
  async trigger(): Promise<{
    success: boolean;
    message?: string;
    lastRun?: Date | null;
    results?: any[];
    timestamp?: Date;
  }> {
    if (this.isRunning) {
      const message = 'Model discovery job is already running';
      this.logger.warn(message);
      return {
        success: false,
        message,
        lastRun: this.lastRun,
      };
    }

    const results = await this.runDiscovery();
    return {
      success: true,
      results,
      timestamp: new Date(),
    };
  }

  /**
   * Run the discovery process for all providers
   */
  private async runDiscovery(): Promise<any[]> {
    if (this.isRunning) {
      this.logger.warn('Discovery job already running, skipping');
      return [];
    }

    this.isRunning = true;
    const startTime = Date.now();
    const results: any[] = [];

    this.logger.log('==== Starting monthly model discovery job ====');

    try {
      for (const provider of this.PROVIDERS) {
        try {
          this.logger.log(`Processing provider: ${provider}`);

          const result =
            await this.modelDiscoveryService.discoverModelsForProvider(
              provider,
            );
          results.push({
            ...result,
            success: true,
          });

          // If discovery failed, try fallback
          if (result.modelsValidated === 0 && result.errors.length > 0) {
            this.logger.warn(
              `Discovery failed for ${provider}, attempting fallback`,
            );

            const fallbackSuccess =
              await this.modelDiscoveryFallbackService.executeFullFallback(
                provider,
                result.errors.join('; '),
              );

            results[results.length - 1].fallbackExecuted = true;
            results[results.length - 1].fallbackSuccess = fallbackSuccess;
          }

          // Add delay between providers to avoid rate limiting
          await this.delay(2000);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(`Error discovering models for ${provider}`, {
            provider,
            error: errorMessage,
          });

          results.push({
            provider,
            success: false,
            error: errorMessage,
            modelsDiscovered: 0,
            modelsValidated: 0,
            modelsFailed: 0,
          });

          // Try fallback on error
          await this.modelDiscoveryFallbackService.executeFullFallback(
            provider,
            errorMessage,
          );
        }
      }

      const duration = Date.now() - startTime;
      const totalDiscovered = results.reduce(
        (sum, r) => sum + (r.modelsDiscovered || 0),
        0,
      );
      const totalValidated = results.reduce(
        (sum, r) => sum + (r.modelsValidated || 0),
        0,
      );
      const totalFailed = results.reduce(
        (sum, r) => sum + (r.modelsFailed || 0),
        0,
      );

      this.logger.log('==== Model discovery job completed ====', {
        duration,
        totalDiscovered,
        totalValidated,
        totalFailed,
        results: results.length,
      });

      this.lastRun = new Date();
    } catch (error) {
      this.logger.error('Fatal error in model discovery job', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.isRunning = false;
    }

    return results;
  }

  /**
   * Get job status
   */
  getStatus(): {
    isRunning: boolean;
    lastRun: Date | null;
    nextRun: Date | null;
    schedule: string | null;
    enabled: boolean;
  } {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      nextRun: null,
      schedule: null,
      enabled: false,
    };
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
