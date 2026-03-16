/**
 * Capability Router Service (NestJS)
 *
 * Port from Express capabilityRouter.service.ts.
 * Provider-agnostic capability-based routing for AI model selection using
 * PricingService as the model/capability registry. Selects optimal model by
 * strategy (cost, latency, quality, balanced) and constraints.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  PricingService,
  ModelPricing,
} from '../../utils/services/pricing.service';

export type ModelCapability = string;
export type ModelSelectionStrategy =
  | 'cost_optimized'
  | 'latency_optimized'
  | 'quality_optimized'
  | 'balanced';

export interface CapabilityRoutingRequest {
  requiredCapabilities: ModelCapability[];
  optionalCapabilities?: ModelCapability[];
  strategy: ModelSelectionStrategy;
  maxCostPerRequest?: number;
  maxLatencyMs?: number;
  minReliability?: number;
  excludeProviders?: string[];
  preferredProviders?: string[];
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  userId?: string;
  agentId?: string;
  decisionContext?: string;
}

export interface CapabilityRoutingResult {
  selectedModel: {
    modelId: string;
    provider: string;
    capabilities: ModelCapability[];
    displayName?: string;
    estimatedCostPerRequest?: number;
  };
  providerAdapter: unknown;
  decisionAuditId?: string;
  reasoning?: string;
  alternativeModels?: Array<{
    modelId: string;
    provider: string;
    score: number;
    reason: string;
  }>;
}

/** Tier order for latency (budget = faster, enterprise = slower) */
const LATENCY_TIER_ORDER: Record<string, number> = {
  budget: 1,
  standard: 2,
  premium: 3,
  enterprise: 4,
};

/** Tier order for quality (enterprise = highest) */
const QUALITY_TIER_ORDER: Record<string, number> = {
  budget: 1,
  standard: 2,
  premium: 3,
  enterprise: 4,
};

/** Provider-level baseline latency estimates (ms) */
const PROVIDER_BASE_LATENCY_MS: Record<string, number> = {
  openai: 650,
  anthropic: 900,
  google: 800,
  meta: 850,
  cohere: 900,
};

/** Provider-level baseline reliability estimates */
const PROVIDER_RELIABILITY: Record<string, number> = {
  openai: 0.99,
  anthropic: 0.985,
  google: 0.975,
  meta: 0.97,
  cohere: 0.97,
};

@Injectable()
export class CapabilityRouterService {
  private readonly logger = new Logger(CapabilityRouterService.name);

  constructor(private readonly pricingService: PricingService) {}

  /**
   * Route request to optimal model based on capabilities, strategy, and constraints.
   */
  async routeRequest(
    request: CapabilityRoutingRequest,
  ): Promise<CapabilityRoutingResult> {
    const {
      requiredCapabilities,
      optionalCapabilities = [],
      strategy,
      maxCostPerRequest,
      maxLatencyMs,
      minReliability,
      excludeProviders = [],
      preferredProviders = [],
      estimatedInputTokens = 1000,
      estimatedOutputTokens = 500,
    } = request;

    const allModels = this.pricingService.getAllModelPricing();
    const candidates = allModels.filter((m) => {
      const hasRequired = requiredCapabilities.every((cap) =>
        m.capabilities.includes(cap),
      );
      if (!hasRequired) return false;
      if (excludeProviders.length && excludeProviders.includes(m.provider)) {
        return false;
      }
      const estimatedLatency = this.estimateLatencyMs(m);
      if (
        maxLatencyMs != null &&
        typeof maxLatencyMs === 'number' &&
        estimatedLatency > maxLatencyMs
      ) {
        return false;
      }
      const reliability = this.estimateReliability(m);
      if (
        minReliability != null &&
        typeof minReliability === 'number' &&
        reliability < minReliability
      ) {
        return false;
      }
      const estCost = this.estimateCost(
        m,
        estimatedInputTokens,
        estimatedOutputTokens,
      );
      if (
        maxCostPerRequest != null &&
        typeof maxCostPerRequest === 'number' &&
        estCost > maxCostPerRequest
      ) {
        return false;
      }
      return true;
    });

    if (candidates.length === 0) {
      const fallback = this.selectFallbackModel(request, allModels);
      return {
        selectedModel: {
          modelId: fallback.model,
          provider: fallback.provider,
          capabilities: fallback.capabilities,
          displayName: fallback.model,
          estimatedCostPerRequest: this.estimateCost(
            fallback,
            estimatedInputTokens,
            estimatedOutputTokens,
          ),
        },
        providerAdapter: this.buildProviderAdapter(fallback),
        reasoning:
          'No model matched required capabilities and constraints; selected fallback.',
      };
    }

    const optionalSet = new Set(optionalCapabilities);
    const scored = candidates.map((m) => ({
      model: m,
      score: this.computeScore(m, strategy, optionalSet, preferredProviders),
      cost: this.estimateCost(m, estimatedInputTokens, estimatedOutputTokens),
      latency: this.estimateLatencyMs(m),
      reliability: this.estimateReliability(m),
    }));

    scored.sort((a, b) => b.score - a.score);
    const selected = scored[0];
    const alternatives = scored.slice(1, 4).map((s) => ({
      modelId: s.model.model,
      provider: s.model.provider,
      score: s.score,
      reason: this.reasonForAlternative(selected.model, s.model, strategy),
    }));

    const displayName =
      selected.model.model.split('.').pop() || selected.model.model;

    return {
      selectedModel: {
        modelId: selected.model.model,
        provider: selected.model.provider,
        capabilities: selected.model.capabilities,
        displayName,
        estimatedCostPerRequest: selected.cost,
      },
      providerAdapter: this.buildProviderAdapter(selected.model),
      reasoning: this.buildReasoning(
        selected.model,
        strategy,
        selected.cost,
        request,
      ),
      alternativeModels: alternatives,
    };
  }

  /**
   * Estimate cost per request for a model (USD).
   */
  estimateCostForRequest(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const pricing = this.pricingService.getModelPricing(modelId);
    if (!pricing) return 0;
    return this.estimateCost(pricing, inputTokens, outputTokens);
  }

  private estimateCost(
    p: ModelPricing,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const inputCost = (inputTokens / 1000) * p.inputCostPerToken;
    const outputCost = (outputTokens / 1000) * p.outputCostPerToken;
    return inputCost + outputCost;
  }

  private computeScore(
    m: ModelPricing,
    strategy: ModelSelectionStrategy,
    optionalCapabilities: Set<string>,
    preferredProviders: string[],
  ): number {
    const costScore =
      1 / (1 + (m.inputCostPerToken + m.outputCostPerToken) * 1000);
    const latencyScore =
      1 / (1 + this.estimateLatencyMs(m) / 1000) +
      1 / (LATENCY_TIER_ORDER[m.tier] ?? 2);
    const qualityScore = (QUALITY_TIER_ORDER[m.tier] ?? 2) / 4;
    const reliabilityScore = this.estimateReliability(m);
    const optionalMatch =
      optionalCapabilities.size > 0
        ? [...optionalCapabilities].filter((c) => m.capabilities.includes(c))
            .length / Math.max(1, optionalCapabilities.size)
        : 1;
    const providerBonus = preferredProviders.includes(m.provider) ? 1.2 : 1;

    switch (strategy) {
      case 'cost_optimized':
        return (
          (costScore * 0.6 + reliabilityScore * 0.4) *
          optionalMatch *
          providerBonus
        );
      case 'latency_optimized':
        return (
          (latencyScore * 0.7 + reliabilityScore * 0.3) *
          optionalMatch *
          providerBonus
        );
      case 'quality_optimized':
        return (
          (qualityScore * 0.5 + reliabilityScore * 0.5) *
          optionalMatch *
          providerBonus
        );
      case 'balanced':
      default:
        return (
          (costScore * 0.3 +
            latencyScore * 0.25 +
            qualityScore * 0.25 +
            reliabilityScore * 0.2) *
          optionalMatch *
          providerBonus
        );
    }
  }

  private selectFallbackModel(
    request: CapabilityRoutingRequest,
    allModels: ModelPricing[],
  ): ModelPricing {
    const preferred = request.preferredProviders?.length
      ? allModels.filter((m) =>
          request.preferredProviders!.includes(m.provider),
        )
      : allModels;
    const excluded = new Set(request.excludeProviders || []);
    const available = preferred.filter((m) => !excluded.has(m.provider));
    if (available.length === 0) {
      const gptMini = allModels.find(
        (m) =>
          m.model.includes('gpt-4o-mini') || m.model.includes('gemini-flash'),
      );
      return gptMini || allModels[0];
    }
    const byCost = [...available].sort(
      (a, b) =>
        a.inputCostPerToken +
        a.outputCostPerToken -
        (b.inputCostPerToken + b.outputCostPerToken),
    );
    return byCost[0];
  }

  private reasonForAlternative(
    selected: ModelPricing,
    alternative: ModelPricing,
    strategy: ModelSelectionStrategy,
  ): string {
    const selectedCost =
      selected.inputCostPerToken + selected.outputCostPerToken;
    const altCost =
      alternative.inputCostPerToken + alternative.outputCostPerToken;
    if (strategy === 'cost_optimized' && altCost < selectedCost) {
      return 'Lower cost alternative';
    }
    if (
      strategy === 'quality_optimized' &&
      (QUALITY_TIER_ORDER[alternative.tier] ?? 0) >
        (QUALITY_TIER_ORDER[selected.tier] ?? 0)
    ) {
      return 'Higher quality tier';
    }
    return 'Alternative option';
  }

  private buildReasoning(
    model: ModelPricing,
    strategy: ModelSelectionStrategy,
    estimatedCost: number,
    request: CapabilityRoutingRequest,
  ): string {
    const estimatedLatency = this.estimateLatencyMs(model);
    const estimatedReliability = this.estimateReliability(model);
    const parts: string[] = [];
    parts.push(`Selected ${model.model} (${model.provider})`);
    parts.push(`Strategy: ${strategy}`);
    parts.push(`Estimated cost per request: $${estimatedCost.toFixed(6)}`);
    parts.push(`Estimated latency: ${estimatedLatency.toFixed(0)}ms`);
    parts.push(
      `Estimated reliability: ${(estimatedReliability * 100).toFixed(1)}%`,
    );
    if (request.preferredProviders?.length) {
      parts.push(
        `Preferred providers applied: ${request.preferredProviders.join(', ')}`,
      );
    }
    return parts.join('. ');
  }

  private estimateLatencyMs(model: ModelPricing): number {
    const providerBase = PROVIDER_BASE_LATENCY_MS[model.provider] ?? 900;
    const tierMultiplier = (LATENCY_TIER_ORDER[model.tier] ?? 2) * 0.15 + 0.7;
    return providerBase * tierMultiplier;
  }

  private estimateReliability(model: ModelPricing): number {
    const providerReliability = PROVIDER_RELIABILITY[model.provider] ?? 0.96;
    const tierBonus = ((QUALITY_TIER_ORDER[model.tier] ?? 2) - 2) * 0.005;
    return Math.max(0.9, Math.min(0.999, providerReliability + tierBonus));
  }

  private buildProviderAdapter(model: ModelPricing): {
    provider: string;
    modelId: string;
    estimatedLatencyMs: number;
    estimatedReliability: number;
  } {
    return {
      provider: model.provider,
      modelId: model.model,
      estimatedLatencyMs: this.estimateLatencyMs(model),
      estimatedReliability: this.estimateReliability(model),
    };
  }
}
