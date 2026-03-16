import { Injectable, Logger, Inject } from '@nestjs/common';
import { GatewayAnalyticsService } from '../../gateway/services/gateway-analytics.service';
import { CacheService } from '../../../common/cache/cache.service';

interface LatencyMetrics {
  provider: string;
  model: string;
  totalRequests: number;
  successfulRequests: number;
  totalLatency: number;
  averageLatency: number;
  lastUpdated: Date;
  recentLatencies: number[];
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

/**
 * Latency-based model routing service.
 * Routes to models based on latency performance and implements circuit breaker pattern.
 */
@Injectable()
export class LatencyRouterService {
  private readonly logger = new Logger(LatencyRouterService.name);
  private circuitBreakers = new Map<string, CircuitBreakerState>();

  // Circuit breaker configuration
  private readonly MAX_FAILURES = 5;
  private readonly CIRCUIT_BREAKER_RESET_TIME = 5 * 60 * 1000; // 5 minutes
  private readonly LATENCY_THRESHOLD_MULTIPLIER = 2; // 2x average latency = circuit open

  constructor(
    @Inject(GatewayAnalyticsService)
    private readonly analyticsService: GatewayAnalyticsService,
    private readonly cacheService: CacheService,
  ) {}

  /**
   * Select the best model based on latency requirements
   */
  async selectModelByLatency(
    maxProcessingTime?: number,
    modelOptions?: Array<{
      model: string;
      provider?: string;
      [key: string]: unknown;
    }>,
  ): Promise<{
    selectedModel: string;
    reasoning: string;
    confidence: number;
    latencyP95?: number;
  } | null> {
    try {
      if (!modelOptions || modelOptions.length === 0) {
        return null;
      }

      this.logger.debug('Selecting model by latency', {
        maxProcessingTime,
        modelCount: modelOptions.length,
        models: modelOptions.map((m) => m.model),
      });

      // Get latency metrics for each model option
      const modelMetrics = await Promise.all(
        modelOptions.map(async (option) => {
          const provider =
            option.provider || this.inferProviderFromModel(option.model);
          const key = `provider_latency:${provider}:${option.model}`;
          const metrics = await this.getCachedLatencyMetrics(key);

          return {
            model: option.model,
            provider,
            metrics,
            circuitBreakerState: this.getCircuitBreakerState(
              provider,
              option.model,
            ),
          };
        }),
      );

      // Filter out models with open circuit breakers
      const availableModels = modelMetrics.filter(
        (m) => m.circuitBreakerState !== 'OPEN',
      );

      if (availableModels.length === 0) {
        this.logger.warn(
          'No models available - all have open circuit breakers',
          {
            requestedModels: modelOptions.map((m) => m.model),
          },
        );
        return null;
      }

      // Sort by latency performance (lowest average latency first)
      const sortedModels = availableModels
        .filter((m) => m.metrics && m.metrics.averageLatency > 0)
        .sort((a, b) => {
          const aLatency = a.metrics!.averageLatency;
          const bLatency = b.metrics!.averageLatency;
          return aLatency - bLatency;
        });

      // If we have models with latency data, select the best one within time constraints
      if (sortedModels.length > 0) {
        const bestModel = sortedModels[0];

        // Check if the best model's latency meets the requirement
        if (
          maxProcessingTime &&
          bestModel.metrics!.averageLatency > maxProcessingTime
        ) {
          // Find the fastest model that meets the time requirement
          const acceptableModel = sortedModels.find(
            (m) => m.metrics!.averageLatency <= maxProcessingTime,
          );

          if (acceptableModel) {
            const p95Latency = this.calculateP95Latency(
              acceptableModel.metrics!.recentLatencies,
            );
            return {
              selectedModel: acceptableModel.model,
              reasoning: `Selected ${acceptableModel.model} (${acceptableModel.provider}) - meets ${maxProcessingTime}ms requirement with ${Math.round(acceptableModel.metrics!.averageLatency)}ms average latency`,
              confidence: this.calculateConfidence(acceptableModel.metrics!),
              latencyP95: p95Latency,
            };
          } else {
            // No model meets the time requirement, but return the fastest anyway
            this.logger.warn(
              'No model meets latency requirement, selecting fastest available',
              {
                maxProcessingTime,
                fastestLatency: Math.round(bestModel.metrics!.averageLatency),
              },
            );
          }
        }

        const p95Latency = this.calculateP95Latency(
          bestModel.metrics!.recentLatencies,
        );
        return {
          selectedModel: bestModel.model,
          reasoning: `Selected ${bestModel.model} (${bestModel.provider}) - fastest available with ${Math.round(bestModel.metrics!.averageLatency)}ms average latency`,
          confidence: this.calculateConfidence(bestModel.metrics!),
          latencyP95: p95Latency,
        };
      }

      // Fallback: select first available model if no latency data
      const fallbackModel = availableModels[0];
      return {
        selectedModel: fallbackModel.model,
        reasoning: `Selected ${fallbackModel.model} (${fallbackModel.provider}) - no latency data available, using fallback`,
        confidence: 0.3,
      };
    } catch (error) {
      this.logger.error('Failed to select model by latency', {
        error: error instanceof Error ? error.message : 'Unknown error',
        maxProcessingTime,
        modelCount: modelOptions?.length,
      });
      return null;
    }
  }

  /**
   * Get circuit breaker state for a provider/model combination
   */
  getCircuitBreakerState(
    provider: string,
    model?: string,
  ): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    const key = model ? `${provider}:${model}` : provider;
    const breaker = this.circuitBreakers.get(key);

    if (!breaker) {
      return 'CLOSED';
    }

    const now = Date.now();

    // Check if circuit breaker should reset
    if (
      breaker.state === 'OPEN' &&
      now - breaker.lastFailure > this.CIRCUIT_BREAKER_RESET_TIME
    ) {
      breaker.state = 'HALF_OPEN';
      breaker.failures = 0;
      this.circuitBreakers.set(key, breaker);
      return 'HALF_OPEN';
    }

    return breaker.state;
  }

  /**
   * Update circuit breaker state based on request outcome
   */
  updateCircuitBreaker(
    provider: string,
    model: string | undefined,
    success: boolean,
  ): void {
    const key = model ? `${provider}:${model}` : provider;
    const breaker = this.circuitBreakers.get(key) || {
      failures: 0,
      lastFailure: 0,
      state: 'CLOSED' as const,
    };

    if (success) {
      // Reset on success
      if (breaker.state === 'HALF_OPEN') {
        breaker.state = 'CLOSED';
      }
      breaker.failures = Math.max(0, breaker.failures - 1);
    } else {
      // Increment failures
      breaker.failures++;
      breaker.lastFailure = Date.now();

      if (breaker.failures >= this.MAX_FAILURES) {
        breaker.state = 'OPEN';
      }
    }

    this.circuitBreakers.set(key, breaker);

    this.logger.debug('Updated circuit breaker state', {
      provider,
      model,
      success,
      newState: breaker.state,
      failures: breaker.failures,
    });
  }

  /**
   * Get cached latency metrics for a provider/model
   */
  private async getCachedLatencyMetrics(
    cacheKey: string,
  ): Promise<LatencyMetrics | null> {
    try {
      return await this.cacheService.get(cacheKey);
    } catch (error) {
      this.logger.debug('Failed to get cached latency metrics', {
        cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Infer provider from model name
   */
  private inferProviderFromModel(model: string): string {
    const modelLower = model.toLowerCase();

    if (modelLower.includes('gpt') || modelLower.includes('openai')) {
      return 'openai';
    }
    if (modelLower.includes('claude') || modelLower.includes('anthropic')) {
      return 'anthropic';
    }
    if (modelLower.includes('gemini') || modelLower.includes('palm')) {
      return 'google-ai';
    }
    if (modelLower.includes('llama') || modelLower.includes('bedrock')) {
      return 'aws-bedrock';
    }
    if (modelLower.includes('deepseek')) {
      return 'deepseek';
    }
    if (modelLower.includes('groq')) {
      return 'groq';
    }

    return 'unknown';
  }

  /**
   * Calculate P95 latency from recent measurements
   */
  private calculateP95Latency(latencies: number[]): number {
    if (!latencies || latencies.length === 0) return 0;

    const sorted = [...latencies].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * 0.95);
    return sorted[Math.min(index, sorted.length - 1)];
  }

  /**
   * Calculate confidence score based on metrics
   */
  private calculateConfidence(metrics: LatencyMetrics): number {
    // Base confidence on sample size and success rate
    const sampleSize = metrics.totalRequests;
    const successRate = metrics.successfulRequests / metrics.totalRequests;

    // More samples = higher confidence
    const sampleConfidence = Math.min(1, sampleSize / 10);

    // Higher success rate = higher confidence
    const successConfidence = successRate;

    // Combine factors
    return (
      Math.round((sampleConfidence * 0.6 + successConfidence * 0.4) * 100) / 100
    );
  }
}
