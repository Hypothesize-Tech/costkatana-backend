/**
 * Intelligent Router Service for NestJS
 *
 * Advanced routing service that uses ModelRegistry and PricingRegistry
 * for intelligent, cost-aware, capability-aware model selection.
 */

import { Injectable, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  ModelRegistryService,
  ModelRequirements,
  AIProviderType,
} from './model-registry.service';
import { ModelCapabilityRegistryService } from './model-capability-registry.service';

export type RoutingStrategy =
  | 'cost_optimized'
  | 'quality_optimized'
  | 'balanced'
  | 'latency_optimized'
  | 'custom';

export interface RoutingRequest {
  /** Strategy to use */
  strategy: RoutingStrategy;

  /** Model requirements */
  requirements?: ModelRequirements;

  /** Estimated input tokens */
  estimatedInputTokens?: number;

  /** Estimated output tokens */
  estimatedOutputTokens?: number;

  /** User/workspace constraints */
  constraints?: {
    maxCostPerRequest?: number;
    maxLatencyMs?: number;
    allowedProviders?: AIProviderType[];
    forbiddenModels?: string[];
  };

  /** Custom scoring weights (for 'custom' strategy) */
  customWeights?: {
    cost: number;
    quality: number;
    latency: number;
    reliability: number;
  };

  /** Force specific model (bypass routing) */
  forceModel?: string;
}

export interface RoutingResult {
  /** Selected model ID */
  modelId: string;

  /** Model display name */
  modelName: string;

  /** Provider */
  provider: AIProviderType;

  /** Selection score */
  score: number;

  /** Estimated cost for request */
  estimatedCost: number;

  /** Expected latency */
  estimatedLatencyMs: number;

  /** Selection reasoning */
  reasoning: string[];

  /** Alternative models considered */
  alternatives?: Array<{
    modelId: string;
    score: number;
    estimatedCost: number;
  }>;

  /** Warnings or notes */
  warnings?: string[];
}

@Injectable()
export class IntelligentRouterService implements OnModuleInit {
  private readonly logger = new Logger(IntelligentRouterService.name);

  private static readonly ROUTER_STATE_CACHE_KEY = 'intelligent_router:state';
  private static readonly ROUTER_STATE_TTL_MS = 86400 * 7 * 1000; // 7 days

  // Performance history for dynamic threshold adjustment (persisted to cache)
  private performanceHistory = new Map<
    string,
    {
      latencies: number[];
      costs: number[];
      successRates: number[];
      lastUpdated: number;
    }
  >();

  // Strategy usage counts for getRoutingStats (persisted to cache)
  private strategyUsage = new Map<RoutingStrategy, number>();

  private readonly HISTORY_WINDOW = 100;
  private readonly ADJUSTMENT_INTERVAL = 300000; // 5 minutes
  private readonly PERSIST_DEBOUNCE_MS = 5000;

  private lastAdjustment: number = Date.now();
  private persistTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly modelRegistry: ModelRegistryService,
    private readonly modelCapabilityRegistry: ModelCapabilityRegistryService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    setInterval(() => {
      this.adjustThresholdsBasedOnTelemetry().catch((err) => {
        this.logger.error('Failed to adjust routing thresholds', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.ADJUSTMENT_INTERVAL);
  }

  async onModuleInit(): Promise<void> {
    try {
      const raw = await this.cacheManager.get(
        IntelligentRouterService.ROUTER_STATE_CACHE_KEY,
      );
      if (raw) {
        const state =
          typeof raw === 'string'
            ? JSON.parse(raw)
            : (raw as Record<string, unknown>);
        if (
          state.performanceHistory &&
          typeof state.performanceHistory === 'object'
        ) {
          this.performanceHistory = new Map(
            Object.entries(
              state.performanceHistory as Record<
                string,
                {
                  latencies: number[];
                  costs: number[];
                  successRates: number[];
                  lastUpdated: number;
                }
              >,
            ),
          );
        }
        if (state.strategyUsage && typeof state.strategyUsage === 'object') {
          this.strategyUsage = new Map(
            Object.entries(state.strategyUsage as Record<string, number>).map(
              ([k, v]) => [k as RoutingStrategy, typeof v === 'number' ? v : 0],
            ),
          );
        }
        this.logger.log('Intelligent router state restored from cache', {
          performanceModels: this.performanceHistory.size,
          strategyKeys: this.strategyUsage.size,
        });
      }
    } catch (error) {
      this.logger.warn('Failed to restore intelligent router state', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Persist performance history and strategy usage to cache so stats survive restarts.
   */
  private async persistState(): Promise<void> {
    try {
      const state = {
        performanceHistory: Object.fromEntries(this.performanceHistory),
        strategyUsage: Object.fromEntries(this.strategyUsage),
      };
      await this.cacheManager.set(
        IntelligentRouterService.ROUTER_STATE_CACHE_KEY,
        JSON.stringify(state),
        IntelligentRouterService.ROUTER_STATE_TTL_MS,
      );
    } catch (error) {
      this.logger.warn('Failed to persist intelligent router state', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private schedulePersist(): void {
    if (this.persistTimeout) clearTimeout(this.persistTimeout);
    this.persistTimeout = setTimeout(() => {
      this.persistTimeout = null;
      this.persistState().catch(() => {});
    }, this.PERSIST_DEBOUNCE_MS);
  }

  /**
   * Record model performance for dynamic threshold adjustment
   */
  recordModelPerformance(
    modelId: string,
    latency: number,
    cost: number,
    success: boolean,
  ): void {
    if (!this.performanceHistory.has(modelId)) {
      this.performanceHistory.set(modelId, {
        latencies: [],
        costs: [],
        successRates: [],
        lastUpdated: Date.now(),
      });
    }

    const history = this.performanceHistory.get(modelId)!;

    // Add new data points
    history.latencies.push(latency);
    history.costs.push(cost);
    history.successRates.push(success ? 1 : 0);
    history.lastUpdated = Date.now();

    // Keep only recent history
    if (history.latencies.length > this.HISTORY_WINDOW) {
      history.latencies.shift();
      history.costs.shift();
      history.successRates.shift();
    }

    this.schedulePersist();
  }

  /**
   * Adjust routing thresholds based on real telemetry data
   */
  private async adjustThresholdsBasedOnTelemetry(): Promise<void> {
    try {
      this.logger.log('🔄 Adjusting routing thresholds based on telemetry');

      for (const [modelId, history] of this.performanceHistory.entries()) {
        if (history.latencies.length < 10) continue; // Need at least 10 samples

        // Calculate performance metrics
        const avgLatency =
          history.latencies.reduce((a, b) => a + b, 0) /
          history.latencies.length;
        const avgCost =
          history.costs.reduce((a, b) => a + b, 0) / history.costs.length;
        const successRate =
          history.successRates.reduce((a, b) => a + b, 0) /
          history.successRates.length;

        // Calculate percentiles for better threshold setting
        const sortedLatencies = [...history.latencies].sort((a, b) => a - b);
        const p50Latency =
          sortedLatencies[Math.floor(sortedLatencies.length * 0.5)];
        const p95Latency =
          sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];

        this.logger.debug('Model performance metrics', {
          modelId,
          avgLatency: avgLatency.toFixed(0) + 'ms',
          p50Latency: p50Latency.toFixed(0) + 'ms',
          p95Latency: p95Latency.toFixed(0) + 'ms',
          avgCost: avgCost.toFixed(6),
          successRate: (successRate * 100).toFixed(1) + '%',
          samples: history.latencies.length,
        });

        // Update model metadata with real performance data
        await this.updateModelPerformanceMetadata(modelId, {
          observedLatency: avgLatency,
          p50Latency,
          p95Latency,
          observedCost: avgCost,
          successRate,
          lastUpdated: Date.now(),
          confidence: Math.min(
            history.latencies.length / this.HISTORY_WINDOW,
            1.0,
          ),
        });
      }

      await this.persistState();
      this.lastAdjustment = Date.now();
    } catch (error) {
      this.logger.error('Failed to adjust routing thresholds', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Update model metadata with observed performance
   */
  private async updateModelPerformanceMetadata(
    modelId: string,
    metrics: {
      observedLatency: number;
      p50Latency: number;
      p95Latency: number;
      observedCost: number;
      successRate: number;
      lastUpdated: number;
      confidence: number;
    },
  ): Promise<void> {
    // Store in cache for use in routing decisions
    const cacheKey = `model_performance:${modelId}`;
    await this.cacheManager.set(cacheKey, metrics, 3600000); // 1 hour TTL

    this.logger.debug('Updated model performance metadata', {
      modelId,
      metrics,
    });
  }

  /**
   * Get dynamic performance threshold for a model
   */
  getDynamicThreshold(
    modelId: string,
    metric: 'latency' | 'cost',
  ): number | null {
    const history = this.performanceHistory.get(modelId);
    if (!history || history.latencies.length < 10) return null;

    if (metric === 'latency') {
      // Use P95 as threshold
      const sorted = [...history.latencies].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * 0.95)];
    } else {
      // Use average + 1 std dev as threshold
      const avg =
        history.costs.reduce((a, b) => a + b, 0) / history.costs.length;
      const variance =
        history.costs.reduce((sum, cost) => sum + Math.pow(cost - avg, 2), 0) /
        history.costs.length;
      const stdDev = Math.sqrt(variance);
      return avg + stdDev;
    }
  }

  /**
   * Route request to optimal model
   */
  async route(request: RoutingRequest): Promise<RoutingResult | null> {
    const startTime = Date.now();

    // Handle forced model
    if (request.forceModel) {
      return this.handleForcedModel(request.forceModel, request);
    }

    // Build requirements from strategy and constraints
    const requirements = this.buildRequirements(request);

    // Find matching models using model registry
    const modelMatch = this.modelRegistry.findBestMatch(requirements);
    if (!modelMatch) {
      this.logger.warn('No models match requirements', { request });
      return null;
    }

    // Get model details
    const model = modelMatch.model;

    // Estimate costs
    const estimatedCost = this.estimateCost(
      model.id,
      request.estimatedInputTokens || 1000,
      request.estimatedOutputTokens || 500,
    );

    // Apply constraints
    if (
      !this.checkConstraints(
        model.id,
        estimatedCost,
        model.averageLatencyMs,
        request.constraints,
      )
    ) {
      this.logger.warn('Selected model violates constraints', {
        modelId: model.id,
        constraints: request.constraints,
      });
      return null;
    }

    // Get alternatives
    const alternatives = await this.getAlternatives(model.id, request);

    const routingTime = Date.now() - startTime;

    const result: RoutingResult = {
      modelId: model.id,
      modelName: model.displayName,
      provider: model.provider,
      score: modelMatch.score,
      estimatedCost,
      estimatedLatencyMs: model.averageLatencyMs,
      reasoning: modelMatch.reasons,
      alternatives,
      warnings: this.generateWarnings(model.id, request),
    };

    const strategyCount = this.strategyUsage.get(request.strategy) ?? 0;
    this.strategyUsage.set(request.strategy, strategyCount + 1);
    this.schedulePersist();

    this.logger.log('Intelligent routing completed', {
      modelId: model.id,
      strategy: request.strategy,
      score: modelMatch.score.toFixed(3),
      estimatedCost: estimatedCost.toFixed(6),
      routingTimeMs: routingTime,
    });

    return result;
  }

  /**
   * Handle forced model selection
   */
  private async handleForcedModel(
    forceModel: string,
    request: RoutingRequest,
  ): Promise<RoutingResult> {
    const model = this.modelRegistry.getModel(forceModel);
    if (!model) {
      throw new Error(`Forced model ${forceModel} not found in registry`);
    }

    const estimatedCost = this.estimateCost(
      model.id,
      request.estimatedInputTokens || 1000,
      request.estimatedOutputTokens || 500,
    );

    return {
      modelId: model.id,
      modelName: model.displayName,
      provider: model.provider,
      score: 1.0, // Forced selection gets perfect score
      estimatedCost,
      estimatedLatencyMs: model.averageLatencyMs,
      reasoning: ['Model forcibly selected by request'],
      warnings: [
        'Model selection was forced, may not be optimal for this use case',
      ],
    };
  }

  /**
   * Build model requirements from routing request
   */
  private buildRequirements(request: RoutingRequest): ModelRequirements {
    const requirements: ModelRequirements = {
      ...request.requirements,
    };

    // Add strategy-based requirements
    switch (request.strategy) {
      case 'cost_optimized':
        requirements.maxCostPerToken = 0.001; // Very cheap
        break;

      case 'quality_optimized':
        requirements.minQualityScore = 0.9; // High quality
        break;

      case 'latency_optimized':
        requirements.maxLatency = 2000; // Fast response
        break;

      case 'balanced':
        // Balanced doesn't add specific constraints
        break;
    }

    // Add constraints
    if (request.constraints) {
      if (request.constraints.maxCostPerRequest) {
        // Convert per-request to per-token (rough approximation)
        const estimatedTokens =
          (request.estimatedInputTokens || 1000) +
          (request.estimatedOutputTokens || 500);
        requirements.maxCostPerToken =
          request.constraints.maxCostPerRequest / estimatedTokens;
      }

      if (request.constraints.maxLatencyMs) {
        requirements.maxLatency = request.constraints.maxLatencyMs;
      }

      if (request.constraints.allowedProviders) {
        requirements.preferredProviders = request.constraints.allowedProviders;
      }
    }

    return requirements;
  }

  /**
   * Estimate cost for a request
   */
  private estimateCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const model = this.modelRegistry.getModel(modelId);
    if (!model || !model.pricing) {
      return 0; // Unknown cost
    }

    const inputCost = (inputTokens / 1_000_000) * model.pricing.input;
    const outputCost = (outputTokens / 1_000_000) * model.pricing.output;

    return inputCost + outputCost;
  }

  /**
   * Check if model meets constraints
   */
  private checkConstraints(
    modelId: string,
    estimatedCost: number,
    latency: number,
    constraints?: RoutingRequest['constraints'],
  ): boolean {
    if (!constraints) return true;

    if (
      constraints.maxCostPerRequest &&
      estimatedCost > constraints.maxCostPerRequest
    ) {
      return false;
    }

    if (constraints.maxLatencyMs && latency > constraints.maxLatencyMs) {
      return false;
    }

    if (
      constraints.forbiddenModels &&
      constraints.forbiddenModels.includes(modelId)
    ) {
      return false;
    }

    const model = this.modelRegistry.getModel(modelId);
    if (
      constraints.allowedProviders &&
      model &&
      !constraints.allowedProviders.includes(model.provider)
    ) {
      return false;
    }

    return true;
  }

  /**
   * Get alternative models for comparison
   */
  private async getAlternatives(
    selectedModelId: string,
    request: RoutingRequest,
  ): Promise<
    Array<{
      modelId: string;
      score: number;
      estimatedCost: number;
    }>
  > {
    const requirements = this.buildRequirements(request);
    const allModels = this.modelRegistry.getModels();

    const alternatives = allModels
      .filter(
        (model) => model.id !== selectedModelId && model.status === 'active',
      )
      .map((model) => {
        const match = this.modelRegistry.findBestMatch({
          ...requirements,
          // Allow this specific model by removing provider constraints temporarily
          preferredProviders: undefined,
          excludedProviders: undefined,
        });

        if (!match || match.model.id !== model.id) return null;

        const estimatedCost = this.estimateCost(
          model.id,
          request.estimatedInputTokens || 1000,
          request.estimatedOutputTokens || 500,
        );

        return {
          modelId: model.id,
          score: match.score,
          estimatedCost,
        };
      })
      .filter(
        (alt): alt is NonNullable<typeof alt> => alt !== null && alt.score > 0,
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 3); // Top 3 alternatives

    return alternatives as Array<{
      modelId: string;
      score: number;
      estimatedCost: number;
    }>;
  }

  /**
   * Generate warnings for the routing decision
   */
  private generateWarnings(modelId: string, request: RoutingRequest): string[] {
    const warnings: string[] = [];

    // Check for potential issues
    const model = this.modelRegistry.getModel(modelId);
    if (!model) return warnings;

    // High latency warning
    if (model.averageLatencyMs > 5000) {
      warnings.push(
        `Selected model has high latency (${model.averageLatencyMs}ms)`,
      );
    }

    // High cost warning
    const estimatedCost = this.estimateCost(
      modelId,
      request.estimatedInputTokens || 1000,
      request.estimatedOutputTokens || 500,
    );
    if (estimatedCost > 0.1) {
      warnings.push(
        `Selected model has high estimated cost ($${estimatedCost.toFixed(4)})`,
      );
    }

    // Context window warning
    if (
      request.requirements?.minContextWindow &&
      model.contextWindow < request.requirements.minContextWindow + 1000
    ) {
      warnings.push(
        'Selected model has limited context window for this request',
      );
    }

    return warnings;
  }

  /**
   * Get routing statistics (from persisted performance history and strategy usage).
   */
  async getRoutingStats(): Promise<{
    totalRoutes: number;
    averageLatency: number;
    averageCost: number;
    strategyUsage: Record<RoutingStrategy, number>;
    providerDistribution: Record<AIProviderType, number>;
  }> {
    const allLatencies: number[] = [];
    const allCosts: number[] = [];

    for (const history of this.performanceHistory.values()) {
      allLatencies.push(...history.latencies);
      allCosts.push(...history.costs);
    }

    const providerDistribution = {} as Record<AIProviderType, number>;
    Object.values(AIProviderType).forEach((provider) => {
      providerDistribution[provider] = 0;
    });

    for (const model of this.modelRegistry.getModels()) {
      if (
        Object.prototype.hasOwnProperty.call(
          providerDistribution,
          model.provider,
        )
      ) {
        providerDistribution[model.provider]++;
      }
    }

    const strategies: RoutingStrategy[] = [
      'cost_optimized',
      'quality_optimized',
      'balanced',
      'latency_optimized',
      'custom',
    ];
    const strategyUsage = {} as Record<RoutingStrategy, number>;
    for (const s of strategies) {
      strategyUsage[s] = this.strategyUsage.get(s) ?? 0;
    }

    return {
      totalRoutes: allLatencies.length,
      averageLatency:
        allLatencies.length > 0
          ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length
          : 0,
      averageCost:
        allCosts.length > 0
          ? allCosts.reduce((a, b) => a + b, 0) / allCosts.length
          : 0,
      strategyUsage,
      providerDistribution,
    };
  }
}
