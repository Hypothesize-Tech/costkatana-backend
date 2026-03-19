import { Injectable, Logger } from '@nestjs/common';
import { AIRouterService } from '../../cortex/services/ai-router.service';
import { PricingService } from '../../utils/services/pricing.service';

export interface ModelComparisonResult {
  id: string;
  provider: string;
  model: string;
  response: string;
  metrics: {
    cost: number;
    latency: number;
    tokenCount: number;
    qualityScore: number;
    errorRate: number;
  };
  timestamp: Date;
}

export interface RealTimeComparisonResult {
  modelId: string;
  modelName: string;
  provider: string;
  response: string;
  cost: number;
  latency: number;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  qualityScore?: number;
  error?: string;
  timestamp: Date;
}

export interface ComparisonAnalysis {
  summary: string;
  recommendations: string[];
  costAnalysis: {
    totalModels?: number;
    cheapest: string;
    mostExpensive: string;
    averageCost: number;
    costRange: { min: number; max: number };
  };
  performanceAnalysis: {
    fastest: string;
    slowest: string;
    averageLatency: number;
    latencyRange: { min: number; max: number };
  };
  qualityAnalysis: {
    highest: string;
    lowest: string;
    averageQuality: number;
    qualityRange: { min: number; max: number };
  };
  tradeoffs: Array<{
    model: string;
    strengths: string[];
    weaknesses: string[];
  }>;
}

/**
 * Experiment Analytics Service - NestJS equivalent of Express ExperimentAnalyticsService
 * Handles metrics calculation, analysis, and AI-powered evaluation of experiment results
 */
@Injectable()
export class ExperimentAnalyticsService {
  private readonly logger = new Logger(ExperimentAnalyticsService.name);
  private readonly QUALITY_EVALUATION_TIMEOUT = 30000; // 30 seconds
  private readonly MAX_RETRY_ATTEMPTS = 3;

  // Simple in-memory cache for analysis results
  private cache = new Map<string, { data: any; expires: number }>();
  private readonly CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours
  private readonly MAX_CACHE_SIZE = 500;

  /** Default judge model for AI evaluation when using AIRouterService (Bedrock) */
  private readonly EVALUATION_MODEL = 'anthropic.claude-3-haiku-20240307-v1:0';

  constructor(
    private readonly aiRouterService: AIRouterService,
    private readonly pricingService: PricingService,
  ) {}

  /**
   * Perform AI-powered evaluation of model responses
   */
  async performAIEvaluation(
    prompt: string,
    response: string,
    criteria: string[],
  ): Promise<number> {
    const cacheKey = `ai_eval_${this.generateHash(prompt + response + criteria.join(','))}`;

    // Check cache first
    const cached = this.getCached(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const evaluationPrompt = `
Evaluate the following AI model response based on these criteria: ${criteria.join(', ')}

Original Prompt: ${prompt.substring(0, 2000)}${prompt.length > 2000 ? '...' : ''}
Model Response: ${response.substring(0, 3000)}${response.length > 3000 ? '...' : ''}

Provide a quality score from 0-100, where:
- 90-100: Excellent response
- 70-89: Good response
- 50-69: Average response
- 30-49: Below average response
- 0-29: Poor response

Consider: relevance, accuracy, coherence, completeness, helpfulness.
Return only the numeric score, no explanation.`;

      const result = await this.aiRouterService.invokeModel({
        model: this.EVALUATION_MODEL,
        prompt: evaluationPrompt,
        parameters: { temperature: 0.1, maxTokens: 10 },
      });

      const parsed = parseInt(
        result.response.trim().replace(/[^0-9]/g, ''),
        10,
      );
      const score = Number.isNaN(parsed)
        ? 50
        : Math.min(100, Math.max(0, parsed));
      this.setCached(cacheKey, score);
      return score;
    } catch (error) {
      this.logger.error('Error performing AI evaluation', {
        error: error instanceof Error ? error.message : String(error),
        promptLength: prompt.length,
        responseLength: response.length,
      });
      // Return neutral score on error and cache to avoid repeated failures
      this.setCached(cacheKey, 50);
      return 50;
    }
  }

  /**
   * Analyze model comparison results
   */
  async analyzeComparisonResults(
    results: ModelComparisonResult[],
  ): Promise<ComparisonAnalysis> {
    if (!results || results.length === 0) {
      throw new Error('No comparison results provided');
    }

    // Calculate cost analysis
    const costs = results.map((r) => r.metrics.cost);
    const costAnalysis = {
      totalModels: results.length,
      cheapest:
        results.find((r) => r.metrics.cost === Math.min(...costs))?.model ?? '',
      mostExpensive:
        results.find((r) => r.metrics.cost === Math.max(...costs))?.model ?? '',
      averageCost: costs.reduce((sum, cost) => sum + cost, 0) / costs.length,
      costRange: {
        min: Math.min(...costs),
        max: Math.max(...costs),
      },
    };

    // Calculate performance analysis
    const latencies = results.map((r) => r.metrics.latency);
    const performanceAnalysis = {
      fastest:
        results.find((r) => r.metrics.latency === Math.min(...latencies))
          ?.model || '',
      slowest:
        results.find((r) => r.metrics.latency === Math.max(...latencies))
          ?.model || '',
      averageLatency:
        latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length,
      latencyRange: {
        min: Math.min(...latencies),
        max: Math.max(...latencies),
      },
    };

    // Calculate quality analysis (exclude null = pending evaluation)
    const qualities = results
      .map((r) => r.metrics.qualityScore)
      .filter((q): q is number => q != null);
    const qualityAnalysis = {
      highest:
        qualities.length > 0
          ? results.find(
              (r) => r.metrics.qualityScore === Math.max(...qualities),
            )?.model || ''
          : '',
      lowest:
        qualities.length > 0
          ? results.find(
              (r) => r.metrics.qualityScore === Math.min(...qualities),
            )?.model || ''
          : '',
      averageQuality:
        qualities.length > 0
          ? qualities.reduce((sum, q) => sum + q, 0) / qualities.length
          : 0,
      qualityRange: {
        min: qualities.length > 0 ? Math.min(...qualities) : 0,
        max: qualities.length > 0 ? Math.max(...qualities) : 0,
      },
    };

    // Generate summary and recommendations
    const summary = this.generateComparisonSummary(
      costAnalysis,
      performanceAnalysis,
      qualityAnalysis,
    );
    const recommendations = this.generateRecommendations(
      results,
      costAnalysis,
      performanceAnalysis,
      qualityAnalysis,
    );
    const tradeoffs = this.analyzeTradeoffs(results);

    return {
      summary,
      recommendations,
      costAnalysis,
      performanceAnalysis,
      qualityAnalysis,
      tradeoffs,
    };
  }

  /**
   * Perform real-time model comparison
   */
  async performRealTimeComparison(
    prompt: string,
    models: Array<{ id: string; name: string; provider: string }>,
    options: {
      maxTokens?: number;
      temperature?: number;
      timeout?: number;
    } = {},
  ): Promise<RealTimeComparisonResult[]> {
    const promises = models.map(async (model) => {
      const startTime = Date.now();
      try {
        let response: string;
        let cost = 0;
        let latency: number;
        let inputTokens: number;
        let outputTokens: number;

        try {
          const modelId = this.toBedrockModelId(model.provider, model.name);
          const aiResult = await this.aiRouterService.invokeModel({
            model: modelId,
            prompt,
            parameters: {
              temperature: options.temperature ?? 0.7,
              maxTokens: options.maxTokens ?? 2048,
            },
          });
          response = aiResult.response;
          latency = aiResult.latency;
          cost = aiResult.cost;
          inputTokens = aiResult.usage.inputTokens;
          outputTokens = aiResult.usage.outputTokens;
        } catch (err) {
          this.logger.warn('AI model call failed', {
            model: model.name,
            provider: model.provider,
            error: err instanceof Error ? err.message : String(err),
          });
          response = '';
          latency = Date.now() - startTime;
          inputTokens = 0;
          outputTokens = 0;
          cost = 0;
        }

        const qualityScore =
          response.length > 0
            ? await this.performAIEvaluation(prompt, response, [
                'relevance',
                'accuracy',
                'coherence',
              ])
            : 0;

        return {
          modelId: model.id,
          modelName: model.name,
          provider: model.provider,
          response,
          cost,
          latency,
          tokens: {
            input: inputTokens,
            output: outputTokens,
            total: inputTokens + outputTokens,
          },
          qualityScore,
          ...(response.length === 0 && {
            error:
              'Model invocation failed; check Bedrock/AI router configuration.',
          }),
          timestamp: new Date(),
        };
      } catch (error) {
        const latency = Date.now() - startTime;
        return {
          modelId: model.id,
          modelName: model.name,
          provider: model.provider,
          response: '',
          cost: 0,
          latency,
          tokens: { input: 0, output: 0, total: 0 },
          error: error instanceof Error ? error.message : String(error),
          timestamp: new Date(),
        };
      }
    });

    const results = await Promise.all(promises);
    return results.sort((a, b) => a.latency - b.latency);
  }

  /**
   * Map provider and model name to a Bedrock model ID for AIRouterService.
   */
  private toBedrockModelId(provider: string, modelName: string): string {
    const normalized = modelName.toLowerCase().replace(/\s+/g, '-');
    if (provider === 'bedrock') return normalized;
    const mapping: Record<string, string> = {
      'gpt-3.5-turbo': 'anthropic.claude-3-haiku-20240307-v1:0',
      'gpt-4': 'anthropic.claude-3-sonnet-20240229-v1:0',
      'claude-3-haiku': 'anthropic.claude-3-haiku-20240307-v1:0',
      'claude-3-sonnet': 'anthropic.claude-3-sonnet-20240229-v1:0',
    };
    return mapping[normalized] ?? 'anthropic.claude-3-haiku-20240307-v1:0';
  }

  /**
   * Generate comparison summary
   */
  private generateComparisonSummary(
    cost: {
      totalModels?: number;
      cheapest: string;
      averageCost: number;
      costRange?: { min: number; max: number };
    },
    performance: { fastest: string; averageLatency: number },
    quality: { highest: string; averageQuality: number },
  ): string {
    const totalModels = cost.totalModels ?? 0;
    return `Comparison of ${totalModels} model(s) shows that ${quality.highest} provides the highest quality responses (${quality.averageQuality.toFixed(1)} avg score), while ${performance.fastest} offers the best performance (${performance.averageLatency.toFixed(0)}ms avg latency). ${cost.cheapest} is the most cost-effective option ($${cost.averageCost.toFixed(4)} avg cost per request).`;
  }

  /**
   * Generate recommendations based on analysis
   */
  private generateRecommendations(
    results: ModelComparisonResult[],
    cost: any,
    performance: any,
    quality: any,
  ): string[] {
    const recommendations: string[] = [];

    // Cost optimization recommendations
    if (cost.averageCost > 0.01) {
      recommendations.push(
        `Consider ${cost.cheapest} for cost-sensitive applications ($${cost.costRange.min.toFixed(4)} per request vs $${cost.averageCost.toFixed(4)} average)`,
      );
    }

    // Performance recommendations
    if (performance.averageLatency > 2000) {
      recommendations.push(
        `For low-latency requirements, ${performance.fastest} provides the best performance (${performance.latencyRange.min}ms response time)`,
      );
    }

    // Quality recommendations
    if (quality.averageQuality < 70) {
      recommendations.push(
        `For high-quality responses, prioritize ${quality.highest} (${quality.qualityRange.max.toFixed(1)} quality score)`,
      );
    }

    // Balanced recommendations
    const balancedModels = results.filter(
      (r) =>
        r.metrics.cost <= cost.averageCost * 1.2 &&
        r.metrics.latency <= performance.averageLatency * 1.5 &&
        r.metrics.qualityScore >= quality.averageQuality * 0.9,
    );

    if (balancedModels.length > 0) {
      recommendations.push(
        `For balanced performance, consider: ${balancedModels
          .map((m) => m.model)
          .join(', ')}`,
      );
    }

    return recommendations;
  }

  /**
   * Analyze tradeoffs between models
   */
  private analyzeTradeoffs(results: ModelComparisonResult[]): Array<{
    model: string;
    strengths: string[];
    weaknesses: string[];
  }> {
    return results.map((result) => {
      const strengths: string[] = [];
      const weaknesses: string[] = [];

      // Analyze cost
      const avgCost =
        results.reduce((sum, r) => sum + r.metrics.cost, 0) / results.length;
      if (result.metrics.cost < avgCost * 0.8) {
        strengths.push('Cost-effective');
      } else if (result.metrics.cost > avgCost * 1.2) {
        weaknesses.push('Higher cost');
      }

      // Analyze performance
      const avgLatency =
        results.reduce((sum, r) => sum + r.metrics.latency, 0) / results.length;
      if (result.metrics.latency < avgLatency * 0.8) {
        strengths.push('Fast response times');
      } else if (result.metrics.latency > avgLatency * 1.2) {
        weaknesses.push('Slower response times');
      }

      // Analyze quality (exclude null = pending evaluation)
      const scoresWithQuality = results.filter(
        (r) => r.metrics.qualityScore != null,
      );
      const avgQuality =
        scoresWithQuality.length > 0
          ? scoresWithQuality.reduce(
              (sum, r) => sum + (r.metrics.qualityScore ?? 0),
              0,
            ) / scoresWithQuality.length
          : 0;
      const q = result.metrics.qualityScore;
      if (q != null) {
        if (q > avgQuality * 1.1) {
          strengths.push('High-quality responses');
        } else if (q < avgQuality * 0.9) {
          weaknesses.push('Lower quality responses');
        }
      }

      return {
        model: result.model,
        strengths,
        weaknesses,
      };
    });
  }



  /**
   * Generate hash for caching
   */
  private generateHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Get cached value
   */
  private getCached(key: string): any | null {
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }
    if (cached) {
      this.cache.delete(key);
    }
    return null;
  }

  /**
   * Set cached value
   */
  private setCached(key: string, data: any): void {
    // Clean up expired entries if cache is getting full
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      this.cleanupExpiredCache();
    }

    this.cache.set(key, {
      data,
      expires: Date.now() + this.CACHE_TTL,
    });
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (value.expires <= now) {
        this.cache.delete(key);
      }
    }
  }
}
