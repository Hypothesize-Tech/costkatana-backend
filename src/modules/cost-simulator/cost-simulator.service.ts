/**
 * Cost Simulator Service (NestJS)
 *
 * Port from Express costSimulator.service.ts.
 * Provides inline cost simulation and prediction for every request,
 * offering cost-effective alternatives and optimization suggestions.
 * Used by GatewayAnalyticsService and BudgetEnforcementService.
 */

import { Injectable, Logger } from '@nestjs/common';
import { TelemetryService } from '../utils/services/telemetry.service';
import { BudgetService } from '../budget/budget.service';
import { TokenCounterService } from '../utils/services/token-counter.service';
import { AIProvider } from '../../utils/modelDiscovery.types';
import { generateSecureId } from '../../common/utils/secure-id.util';

export interface CostSimulation {
  requestId: string;
  timestamp: Date;

  originalRequest: {
    model: string;
    provider: string;
    estimatedTokens: {
      input: number;
      output: number;
      total: number;
    };
    estimatedCost: number;
    estimatedLatency: number;
    confidence: number;
  };

  alternatives: Array<{
    model: string;
    provider: string;
    estimatedCost: number;
    estimatedLatency: number;
    costSavings: number;
    costSavingsPercentage: number;
    quality: 'lower' | 'similar' | 'higher';
    recommendation: string;
    confidence: number;
  }>;

  costBreakdown: {
    inputCost: number;
    outputCost: number;
    processingCost: number;
    overheadCost: number;
  };

  riskAssessment: {
    budgetRisk: 'low' | 'medium' | 'high';
    performanceRisk: 'low' | 'medium' | 'high';
    recommendation: string;
  };
}

export interface SimulationAccuracy {
  simulationId: string;
  estimatedCost: number;
  actualCost: number;
  variance: number;
  variancePercentage: number;
  timestamp: Date;
}

export interface SimulateRequestCostOptions {
  includeAlternatives?: boolean;
  maxOutputTokens?: number;
  complexity?: 'simple' | 'medium' | 'complex' | 'expert';
}

@Injectable()
export class CostSimulatorService {
  private readonly logger = new Logger(CostSimulatorService.name);
  private readonly accuracyHistory = new Map<string, SimulationAccuracy>();
  private readonly MAX_ACCURACY_HISTORY = 1000;

  private readonly MODEL_PRICING: Record<
    string,
    { input: number; output: number }
  > = {
    'gpt-4': { input: 30, output: 60 },
    'gpt-4-turbo': { input: 10, output: 30 },
    'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
    'claude-3-opus': { input: 15, output: 75 },
    'claude-3-sonnet': { input: 3, output: 15 },
    'claude-3-haiku': { input: 0.25, output: 1.25 },
    'claude-3-5-haiku': { input: 0.8, output: 4 },
    'gemini-1.5-pro': { input: 3.5, output: 10.5 },
    'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  };

  constructor(
    private readonly telemetryService: TelemetryService,
    private readonly budgetService: BudgetService,
    private readonly tokenCounterService: TokenCounterService,
  ) {
    this.logger.log('Cost Simulator Service initialized');
  }

  /**
   * Simulate cost for a request before execution
   */
  async simulateRequestCost(
    prompt: string,
    model: string,
    provider: string,
    userId?: string,
    workspaceId?: string,
    options: SimulateRequestCostOptions = {},
  ): Promise<CostSimulation> {
    const requestId = generateSecureId(`sim_${model}_${provider}`);
    const {
      includeAlternatives = true,
      maxOutputTokens = 1000,
      complexity = 'medium',
    } = options;

    const providerEnum = this.mapProviderToEnum(provider);
    this.logger.debug('Estimating tokens using provider enum', {
      provider,
      providerEnum,
    });

    const inputTokens = this.tokenCounterService.estimateTokens(prompt, model);

    const outputTokens = await this.estimateOutputTokens(
      inputTokens,
      model,
      complexity,
      maxOutputTokens,
    );
    const totalTokens = inputTokens + outputTokens;

    const pricing = this.getModelPricing(model);
    const accuracyMultiplier = this.getAccuracyMultiplier(
      model,
      userId,
      workspaceId,
    );
    const inputCost =
      (inputTokens / 1_000_000) * pricing.input * accuracyMultiplier;
    const outputCost =
      (outputTokens / 1_000_000) * pricing.output * accuracyMultiplier;

    const processingCost = (0.001 * totalTokens) / 1000;
    const overheadCost = 0.002;

    const estimatedCost =
      inputCost + outputCost + processingCost + overheadCost;

    const estimatedLatency = await this.estimateLatency(
      model,
      totalTokens,
      userId,
      workspaceId,
    );

    const confidence = this.calculateConfidence(
      model,
      estimatedCost,
      userId,
      workspaceId,
    );

    const simulation: CostSimulation = {
      requestId,
      timestamp: new Date(),
      originalRequest: {
        model,
        provider,
        estimatedTokens: {
          input: inputTokens,
          output: outputTokens,
          total: totalTokens,
        },
        estimatedCost,
        estimatedLatency,
        confidence,
      },
      alternatives: [],
      costBreakdown: {
        inputCost,
        outputCost,
        processingCost,
        overheadCost,
      },
      riskAssessment: {
        budgetRisk: 'low',
        performanceRisk: 'low',
        recommendation:
          'Request is within acceptable cost and performance parameters',
      },
    };

    if (includeAlternatives) {
      simulation.alternatives = await this.generateAlternatives(
        model,
        provider,
        inputTokens,
        outputTokens,
        estimatedCost,
        estimatedLatency,
        complexity,
        userId,
        workspaceId,
      );
    }

    if (userId) {
      try {
        const budgetStatus = await this.budgetService.getBudgetStatus(
          userId,
          workspaceId,
        );
        // Use cost (spent) and a default monthly budget in dollars for risk assessment
        const monthlyBudgetDollars = 100;
        const spent = budgetStatus?.overall?.cost ?? 0;
        const remainingDollars = Math.max(0, monthlyBudgetDollars - spent);

        if (
          remainingDollars < Infinity &&
          estimatedCost > remainingDollars * 0.5
        ) {
          simulation.riskAssessment.budgetRisk = 'high';
          simulation.riskAssessment.recommendation = `This request will consume ${((estimatedCost / remainingDollars) * 100).toFixed(1)}% of remaining budget. Consider using a cheaper alternative.`;
        } else if (
          remainingDollars < Infinity &&
          remainingDollars > 0 &&
          estimatedCost > remainingDollars * 0.1
        ) {
          simulation.riskAssessment.budgetRisk = 'medium';
          simulation.riskAssessment.recommendation = `This request will consume ${((estimatedCost / remainingDollars) * 100).toFixed(1)}% of remaining budget.`;
        }
      } catch (e) {
        this.logger.error('Error fetching budget status', {
          userId,
          workspaceId,
          error: e instanceof Error ? e.message : e,
        });
      }
    }

    if (estimatedLatency > 10000) {
      simulation.riskAssessment.performanceRisk = 'high';
      simulation.riskAssessment.recommendation +=
        ' High latency expected. Consider a faster model.';
    } else if (estimatedLatency > 5000) {
      simulation.riskAssessment.performanceRisk = 'medium';
    }

    this.logger.debug('Cost simulation completed', {
      requestId,
      model,
      estimatedCost,
      alternatives: simulation.alternatives.length,
      userId,
      workspaceId,
    });

    return simulation;
  }

  private async generateAlternatives(
    currentModel: string,
    currentProvider: string,
    inputTokens: number,
    outputTokens: number,
    currentCost: number,
    currentLatency: number,
    complexity: 'simple' | 'medium' | 'complex' | 'expert',
    userId?: string,
    workspaceId?: string,
  ): Promise<CostSimulation['alternatives']> {
    const alternatives: CostSimulation['alternatives'] = [];
    const alternativeModels = this.getAlternativeModels(
      currentModel,
      currentProvider,
      complexity,
    );

    for (const altModel of alternativeModels) {
      const pricing = this.getModelPricing(altModel.model);
      const accuracyMultiplier = this.getAccuracyMultiplier(
        altModel.model,
        userId,
        workspaceId,
      );

      const inputCost =
        (inputTokens / 1_000_000) * pricing.input * accuracyMultiplier;
      const outputCost =
        (outputTokens / 1_000_000) * pricing.output * accuracyMultiplier;
      const processingCost = (0.001 * (inputTokens + outputTokens)) / 1000;
      const overheadCost = 0.002;
      const estimatedCost =
        inputCost + outputCost + processingCost + overheadCost;

      const costSavings = currentCost - estimatedCost;
      const costSavingsPercentage = (costSavings / currentCost) * 100;

      const estimatedLatency = await this.estimateLatency(
        altModel.model,
        inputTokens + outputTokens,
        userId,
        workspaceId,
      );

      if (costSavings > 0.0001) {
        alternatives.push({
          model: altModel.model,
          provider: altModel.provider,
          estimatedCost,
          estimatedLatency,
          costSavings,
          costSavingsPercentage,
          quality: altModel.quality,
          recommendation: `${altModel.recommendation} Compared to ${currentModel} (${currentProvider}) at ~${Math.round(currentLatency)}ms.`,
          confidence: this.calculateConfidence(
            altModel.model,
            estimatedCost,
            userId,
            workspaceId,
          ),
        });
      }
    }

    alternatives.sort((a, b) => b.costSavings - a.costSavings);
    return alternatives.slice(0, 5);
  }

  private getAlternativeModels(
    currentModel: string,
    _currentProvider: string,
    complexity: 'simple' | 'medium' | 'complex' | 'expert',
  ): Array<{
    model: string;
    provider: string;
    quality: 'lower' | 'similar' | 'higher';
    recommendation: string;
  }> {
    const alternatives: Array<{
      model: string;
      provider: string;
      quality: 'lower' | 'similar' | 'higher';
      recommendation: string;
    }> = [];

    if (currentModel.includes('gpt-4')) {
      if (complexity === 'simple' || complexity === 'medium') {
        alternatives.push({
          model: 'gpt-3.5-turbo',
          provider: 'openai',
          quality: 'lower',
          recommendation:
            'Significantly cheaper with good quality for simpler tasks',
        });
      }
      if (complexity === 'medium' || complexity === 'complex') {
        alternatives.push({
          model: 'claude-3-sonnet',
          provider: 'anthropic',
          quality: 'similar',
          recommendation: 'Similar quality at lower cost',
        });
      }
    }
    if (currentModel.includes('opus')) {
      alternatives.push({
        model: 'claude-3-sonnet',
        provider: 'anthropic',
        quality: 'similar',
        recommendation: 'Good balance of quality and cost',
      });
      if (complexity !== 'expert') {
        alternatives.push({
          model: 'claude-3-haiku',
          provider: 'anthropic',
          quality: 'lower',
          recommendation: 'Much faster and cheaper for simpler tasks',
        });
      }
    }
    if (currentModel.includes('sonnet')) {
      if (complexity === 'simple') {
        alternatives.push({
          model: 'claude-3-haiku',
          provider: 'anthropic',
          quality: 'similar',
          recommendation: 'Faster and cheaper for simple tasks',
        });
        alternatives.push({
          model: 'gemini-1.5-flash',
          provider: 'google',
          quality: 'similar',
          recommendation: 'Very cost-effective alternative',
        });
      }
    }
    if (currentModel.includes('gemini-1.5-pro')) {
      alternatives.push({
        model: 'gemini-1.5-flash',
        provider: 'google',
        quality: 'lower',
        recommendation: 'Much cheaper with acceptable quality',
      });
      if (complexity !== 'simple') {
        alternatives.push({
          model: 'claude-3-sonnet',
          provider: 'anthropic',
          quality: 'similar',
          recommendation: 'Similar quality at comparable cost',
        });
      }
    }

    return alternatives;
  }

  private async estimateOutputTokens(
    inputTokens: number,
    model: string,
    complexity: 'simple' | 'medium' | 'complex' | 'expert',
    maxTokens: number,
  ): Promise<number> {
    try {
      const metrics = await this.telemetryService.getPerformanceMetrics({
        timeframe: '24h',
      });

      const metricsWithCount = metrics as {
        total_requests?: number;
        total_tokens?: number;
        avg_tokens?: number;
        p95_duration_ms?: number;
      };
      const totalRequests =
        (metrics as unknown as { count?: number }).count ??
        metricsWithCount.total_requests ??
        0;
      const avgTokens =
        metricsWithCount.avg_tokens ??
        (metricsWithCount.total_tokens && totalRequests
          ? metricsWithCount.total_tokens / totalRequests
          : 0);

      if (totalRequests > 0 && avgTokens > 0) {
        const avgOutputRatio = 0.6;
        const historicalAvgOutput = avgTokens * avgOutputRatio;
        const scaleFactor = inputTokens / (avgTokens * 0.4 || 1);
        return Math.min(
          maxTokens,
          Math.round(historicalAvgOutput * scaleFactor),
        );
      }
    } catch (error) {
      this.logger.debug(
        'Failed to get historical output tokens, using estimation',
        {
          error: error instanceof Error ? error.message : String(error),
          model,
        },
      );
    }

    const complexityMultiplierByModel: Record<
      string,
      Record<string, number>
    > = {
      'gpt-4': { simple: 0.45, medium: 1.0, complex: 1.6, expert: 2.1 },
      'gpt-3.5': { simple: 0.5, medium: 1.0, complex: 1.5, expert: 2.0 },
      claude: { simple: 0.55, medium: 1.05, complex: 1.5, expert: 1.95 },
      gemini: { simple: 0.6, medium: 1.1, complex: 1.55, expert: 2.2 },
    };

    const baseModelKey = Object.keys(complexityMultiplierByModel).find((k) =>
      model.toLowerCase().includes(k),
    );
    const multiplierTable = baseModelKey
      ? complexityMultiplierByModel[baseModelKey]
      : {
          simple: 0.5,
          medium: 1.0,
          complex: 1.5,
          expert: 2.0,
        };
    const multiplier = multiplierTable[complexity];

    return Math.min(maxTokens, Math.round(inputTokens * multiplier));
  }

  private async estimateLatency(
    model: string,
    totalTokens: number,
    userId?: string,
    workspaceId?: string,
  ): Promise<number> {
    try {
      const metrics = await this.telemetryService.getPerformanceMetrics({
        timeframe: '1h',
        workspace_id: workspaceId,
      });

      if (
        metrics.p95_duration_ms !== undefined &&
        metrics.p95_duration_ms > 0
      ) {
        const baseLatency = metrics.p95_duration_ms;
        const avgTokens = 1000;
        const tokenRatio = totalTokens / avgTokens;
        return Math.round(baseLatency * tokenRatio);
      }
    } catch (error) {
      this.logger.debug('Failed to get historical latency, using estimation', {
        error: error instanceof Error ? error.message : String(error),
        model,
        userId,
        workspaceId,
      });
    }

    const modelBaseLatency: Record<string, number> = {
      'gpt-4': 1800,
      'gpt-3.5': 900,
      claude: 1100,
      gemini: 1200,
    };
    let defaultBase = 1000;
    for (const m of Object.keys(modelBaseLatency)) {
      if (model.toLowerCase().includes(m)) {
        defaultBase = modelBaseLatency[m];
        break;
      }
    }
    return Math.round(defaultBase + totalTokens / 10);
  }

  private getModelPricing(model: string): { input: number; output: number } {
    let pricing = this.MODEL_PRICING[model];
    if (!pricing) {
      for (const [key, value] of Object.entries(this.MODEL_PRICING)) {
        if (model.includes(key) || key.includes(model)) {
          pricing = value;
          break;
        }
      }
    }
    if (!pricing) {
      this.logger.warn('Unknown model pricing, using default', { model });
      pricing = { input: 3, output: 15 };
    }
    return pricing;
  }

  private getAccuracyMultiplier(
    model: string,
    userId?: string,
    workspaceId?: string,
  ): number {
    try {
      let accuracyData = Array.from(this.accuracyHistory.values()).filter((a) =>
        a.simulationId.includes(model),
      );
      if (userId) {
        accuracyData = accuracyData.filter((a) =>
          a.simulationId.includes(userId),
        );
      }
      if (workspaceId) {
        accuracyData = accuracyData.filter((a) =>
          a.simulationId.includes(workspaceId),
        );
      }

      const recentAccuracies = accuracyData.slice(-50);

      if (recentAccuracies.length > 10) {
        const avgActualToEstimated =
          recentAccuracies.reduce(
            (sum, a) => sum + a.actualCost / a.estimatedCost,
            0,
          ) / recentAccuracies.length;
        return Math.max(0.8, Math.min(1.2, avgActualToEstimated));
      }
    } catch (error) {
      this.logger.debug('Failed to calculate accuracy multiplier', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return 1.0;
  }

  private calculateConfidence(
    model: string,
    _estimatedCost: number,
    userId?: string,
    workspaceId?: string,
  ): number {
    try {
      let recentAccuracy = Array.from(this.accuracyHistory.values()).filter(
        (a) => a.simulationId.includes(model),
      );
      if (userId) {
        recentAccuracy = recentAccuracy.filter((a) =>
          a.simulationId.includes(userId),
        );
      }
      if (workspaceId) {
        recentAccuracy = recentAccuracy.filter((a) =>
          a.simulationId.includes(workspaceId),
        );
      }
      recentAccuracy = recentAccuracy.slice(-20);

      if (recentAccuracy.length > 5) {
        const avgVariance =
          recentAccuracy.reduce(
            (sum, a) => sum + Math.abs(a.variancePercentage),
            0,
          ) / recentAccuracy.length;
        const varianceConfidence = Math.max(0, 1 - avgVariance / 100);
        const dataConfidence = Math.min(1, recentAccuracy.length / 20);
        return varianceConfidence * 0.7 + dataConfidence * 0.3;
      }
    } catch (error) {
      this.logger.debug('Failed to calculate confidence', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        workspaceId,
      });
    }
    return 0.7;
  }

  /**
   * Record actual cost to improve future simulations.
   */
  recordActualCost(
    simulationId: string,
    actualCost: number,
    estimatedCost: number,
  ): void {
    const variance = actualCost - estimatedCost;
    const variancePercentage = (variance / (estimatedCost || 1)) * 100;

    const accuracy: SimulationAccuracy = {
      simulationId,
      estimatedCost,
      actualCost,
      variance,
      variancePercentage,
      timestamp: new Date(),
    };

    this.accuracyHistory.set(simulationId, accuracy);

    if (this.accuracyHistory.size > this.MAX_ACCURACY_HISTORY) {
      const oldestKey = Array.from(this.accuracyHistory.keys())[0];
      this.accuracyHistory.delete(oldestKey);
    }

    this.logger.debug('Recorded simulation accuracy', {
      simulationId,
      variance,
      variancePercentage,
    });
  }

  getAccuracyStats(): {
    totalSimulations: number;
    avgVariance: number;
    avgVariancePercentage: number;
    accuracyByModel: Map<string, { count: number; avgVariance: number }>;
  } {
    const accuracyByModel = new Map<
      string,
      { count: number; avgVariance: number }
    >();
    let totalVariance = 0;
    let totalVariancePercentage = 0;
    for (const accuracy of this.accuracyHistory.values()) {
      const segments = accuracy.simulationId.split('_');
      const model = segments.length >= 3 ? segments[2] : 'unknown';
      if (!accuracyByModel.has(model)) {
        accuracyByModel.set(model, { count: 0, avgVariance: 0 });
      }
      const modelStats = accuracyByModel.get(model);
      if (!modelStats) continue;
      modelStats.count++;
      modelStats.avgVariance =
        (modelStats.avgVariance * (modelStats.count - 1) +
          Math.abs(accuracy.variance)) /
        modelStats.count;
      totalVariance += Math.abs(accuracy.variance);
      totalVariancePercentage += Math.abs(accuracy.variancePercentage);
    }

    return {
      totalSimulations: this.accuracyHistory.size,
      avgVariance:
        this.accuracyHistory.size > 0
          ? totalVariance / this.accuracyHistory.size
          : 0,
      avgVariancePercentage:
        this.accuracyHistory.size > 0
          ? totalVariancePercentage / this.accuracyHistory.size
          : 0,
      accuracyByModel,
    };
  }

  private mapProviderToEnum(provider: string): AIProvider {
    const providerMap: Record<string, AIProvider> = {
      openai: AIProvider.OpenAI,
      anthropic: AIProvider.Anthropic,
      google: AIProvider.Google,
      'aws-bedrock': AIProvider.AWSBedrock,
      bedrock: AIProvider.AWSBedrock,
    };
    return providerMap[provider.toLowerCase()] ?? AIProvider.OpenAI;
  }

  onModuleDestroy(): void {
    this.accuracyHistory.clear();
    this.logger.log('Cost Simulator Service shut down');
  }
}
