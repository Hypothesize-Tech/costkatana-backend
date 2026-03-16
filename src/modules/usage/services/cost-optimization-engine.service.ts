import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage, UsageDocument } from '@/schemas/core/usage.schema';
import { findCheapestModel, estimateCost } from '@/utils/pricing';
import { generateOptimizationSuggestions } from '@/utils/optimizationUtils';

interface OptimizationRule {
  id: string;
  name: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  condition: (usage: any) => boolean;
  suggestion: (usage: any) => OptimizationSuggestion;
}

interface OptimizationSuggestion {
  type:
    | 'model_downgrade'
    | 'prompt_optimization'
    | 'caching'
    | 'batch_processing'
    | 'regional_optimization';
  title: string;
  description: string;
  potentialSavings: number;
  confidence: number;
  implementation: string;
  tradeoffs?: string;
  alternativeModel?: string;
  estimatedTokens?: number;
}

interface OptimizationResult {
  usageId: string;
  suggestions: OptimizationSuggestion[];
  totalPotentialSavings: number;
  appliedOptimizations: string[];
  metadata: {
    processingTime: number;
    rulesApplied: number;
    analyzedAt: Date;
  };
}

interface OptimizationReport {
  summary: {
    totalPotentialSavings: number;
    optimizationOpportunities: number;
    highPrioritySuggestions: number;
    mediumPrioritySuggestions: number;
    lowPrioritySuggestions: number;
  };
  suggestions: OptimizationSuggestion[];
  byCategory: Record<string, OptimizationSuggestion[]>;
  trends: {
    costTrend: 'increasing' | 'decreasing' | 'stable';
    optimizationTrend: 'improving' | 'declining' | 'stable';
    topCostDrivers: string[];
  };
  recommendations: string[];
}

@Injectable()
export class CostOptimizationEngineService {
  private readonly logger = new Logger(CostOptimizationEngineService.name);

  // Optimization rules - the 5 core optimization strategies
  private readonly optimizationRules: OptimizationRule[] = [
    {
      id: 'high_cost_model',
      name: 'High-Cost Model Detection',
      description:
        'Detect usage of expensive models that could be replaced with cheaper alternatives',
      priority: 'high',
      condition: (usage) => this.isHighCostModel(usage),
      suggestion: (usage) => this.suggestModelDowngrade(usage),
    },
    {
      id: 'prompt_optimization',
      name: 'Prompt Optimization',
      description:
        'Identify prompts that could be compressed or optimized for token efficiency',
      priority: 'medium',
      condition: (usage) => this.hasOptimizationPotential(usage),
      suggestion: (usage) => this.suggestPromptOptimization(usage),
    },
    {
      id: 'caching_opportunity',
      name: 'Caching Opportunity',
      description:
        'Detect repeated prompts that could benefit from semantic caching',
      priority: 'medium',
      condition: (usage) => this.isCacheable(usage),
      suggestion: (usage) => this.suggestCaching(usage),
    },
    {
      id: 'batch_processing',
      name: 'Batch Processing',
      description: 'Identify patterns that could benefit from request batching',
      priority: 'low',
      condition: (usage) => this.isBatchable(usage),
      suggestion: (usage) => this.suggestBatching(usage),
    },
    {
      id: 'regional_optimization',
      name: 'Regional Optimization',
      description:
        'Suggest geographically closer providers for better performance and cost',
      priority: 'medium',
      condition: (usage) => this.hasRegionalOptimization(usage),
      suggestion: (usage) => this.suggestRegionalOptimization(usage),
    },
  ];

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
  ) {}

  /**
   * Analyze and optimize usage data
   */
  async analyzeAndOptimize(
    userId: string,
    projectId?: string,
    timeframe?: { startDate: Date; endDate: Date },
  ): Promise<OptimizationReport> {
    try {
      const startTime = Date.now();
      this.logger.log(`Starting cost optimization analysis for user ${userId}`);

      // Get usage data for analysis
      const usageData = await this.getUsageDataForAnalysis(
        userId,
        projectId,
        timeframe,
      );

      if (usageData.length === 0) {
        return this.createEmptyReport();
      }

      // Apply optimization rules
      const suggestions: OptimizationSuggestion[] = [];
      let totalPotentialSavings = 0;

      for (const usage of usageData) {
        const usageSuggestions = await this.applyOptimizationRules(usage);
        suggestions.push(...usageSuggestions);

        totalPotentialSavings += usageSuggestions.reduce(
          (sum, suggestion) => sum + suggestion.potentialSavings,
          0,
        );
      }

      // Group suggestions by category
      const byCategory = this.groupSuggestionsByCategory(suggestions);

      // Calculate trends
      const trends = await this.calculateOptimizationTrends(userId, timeframe);

      // Generate recommendations
      const recommendations = this.generateRecommendations(suggestions, trends);

      // Create summary
      const summary = {
        totalPotentialSavings,
        optimizationOpportunities: suggestions.length,
        highPrioritySuggestions: suggestions.filter(
          (s) => this.getSuggestionPriority(s) === 'high',
        ).length,
        mediumPrioritySuggestions: suggestions.filter(
          (s) => this.getSuggestionPriority(s) === 'medium',
        ).length,
        lowPrioritySuggestions: suggestions.filter(
          (s) => this.getSuggestionPriority(s) === 'low',
        ).length,
      };

      const report: OptimizationReport = {
        summary,
        suggestions: suggestions.slice(0, 50), // Limit to top 50 suggestions
        byCategory,
        trends,
        recommendations,
      };

      const processingTime = Date.now() - startTime;
      this.logger.log(
        `Cost optimization analysis completed for user ${userId} in ${processingTime}ms`,
        {
          totalSuggestions: suggestions.length,
          potentialSavings: totalPotentialSavings,
          highPriority: summary.highPrioritySuggestions,
        },
      );

      return report;
    } catch (error) {
      this.logger.error(
        `Failed to analyze and optimize for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get usage-specific optimizations
   */
  async getUsageOptimizations(
    usageId: string,
    userId: string,
  ): Promise<OptimizationResult> {
    try {
      const startTime = Date.now();

      const usage = await this.usageModel.findOne({ _id: usageId, userId });
      if (!usage) {
        throw new Error(`Usage record ${usageId} not found`);
      }

      const suggestions = await this.applyOptimizationRules(usage);
      const totalPotentialSavings = suggestions.reduce(
        (sum, suggestion) => sum + suggestion.potentialSavings,
        0,
      );

      const result: OptimizationResult = {
        usageId,
        suggestions,
        totalPotentialSavings,
        appliedOptimizations: [],
        metadata: {
          processingTime: Date.now() - startTime,
          rulesApplied: this.optimizationRules.length,
          analyzedAt: new Date(),
        },
      };

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get usage optimizations for ${usageId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Monitor optimization opportunities continuously
   */
  async monitorOptimizationOpportunities(
    userId: string,
    thresholds: {
      minSavings?: number;
      highPriorityOnly?: boolean;
      timeWindowHours?: number;
    } = {},
  ): Promise<{
    opportunities: OptimizationSuggestion[];
    alerts: Array<{
      type: 'high_savings' | 'trending_costs' | 'inefficient_patterns';
      message: string;
      severity: 'low' | 'medium' | 'high';
    }>;
  }> {
    try {
      const {
        minSavings = 1.0,
        highPriorityOnly = false,
        timeWindowHours = 24,
      } = thresholds;

      const timeWindow = new Date(
        Date.now() - timeWindowHours * 60 * 60 * 1000,
      );

      // Get recent usage for monitoring
      const recentUsage = await this.usageModel
        .find({
          userId,
          createdAt: { $gte: timeWindow },
        })
        .sort({ createdAt: -1 })
        .limit(1000);

      const opportunities: OptimizationSuggestion[] = [];
      const alerts: Array<any> = [];

      // Analyze patterns
      for (const usage of recentUsage) {
        const suggestions = await this.applyOptimizationRules(usage);

        for (const suggestion of suggestions) {
          if (suggestion.potentialSavings >= minSavings) {
            if (
              !highPriorityOnly ||
              this.getSuggestionPriority(suggestion) === 'high'
            ) {
              opportunities.push(suggestion);
            }
          }
        }
      }

      // Generate alerts based on patterns
      alerts.push(...this.generateMonitoringAlerts(recentUsage, opportunities));

      return { opportunities, alerts };
    } catch (error) {
      this.logger.error(
        `Failed to monitor optimization opportunities for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Apply all optimization rules to a usage record
   */
  private async applyOptimizationRules(
    usage: any,
  ): Promise<OptimizationSuggestion[]> {
    const suggestions: OptimizationSuggestion[] = [];

    for (const rule of this.optimizationRules) {
      try {
        if (rule.condition(usage)) {
          const suggestion = rule.suggestion(usage);
          if (suggestion && suggestion.potentialSavings > 0) {
            suggestions.push(suggestion);
          }
        }
      } catch (error) {
        this.logger.warn(`Failed to apply optimization rule ${rule.id}`, error);
      }
    }

    // Also apply utility-based suggestions
    try {
      const utilitySuggestions = generateOptimizationSuggestions(
        usage.prompt || '',
        usage.service || 'openai',
        usage.model || 'gpt-4',
        [], // Could pass conversation history if available
      );

      suggestions.push(
        ...utilitySuggestions.suggestions.map((s) => ({
          type: s.type as any,
          title: s.explanation.split('.')[0],
          description: s.explanation,
          potentialSavings: s.estimatedSavings,
          confidence: s.confidence,
          implementation: s.implementation,
          tradeoffs: s.tradeoffs,
        })),
      );
    } catch (error) {
      this.logger.warn('Failed to generate utility-based suggestions', error);
    }

    return suggestions;
  }

  /**
   * Rule 1: High-cost model detection
   */
  private isHighCostModel(usage: any): boolean {
    const highCostModels = [
      'gpt-4-turbo',
      'gpt-4',
      'claude-3-opus',
      'claude-3-5-sonnet',
      'gemini-1.5-pro',
    ];

    return (
      highCostModels.includes(usage.model) &&
      usage.promptTokens > 1000 &&
      usage.cost > 0.1
    );
  }

  /**
   * Rule 1: Suggest model downgrade
   */
  private suggestModelDowngrade(usage: any): OptimizationSuggestion {
    const provider = usage.service || usage.provider;
    const cheapest = findCheapestModel(provider, undefined);

    if (!cheapest) {
      return null as any;
    }

    const estimated = estimateCost(
      usage.promptTokens,
      usage.completionTokens,
      cheapest.provider,
      cheapest.modelId,
    );
    const alternativeCost = estimated.totalCost;
    const savings = usage.cost - alternativeCost;

    if (savings <= 0) {
      return null as any;
    }

    return {
      type: 'model_downgrade',
      title: 'Consider Cheaper Model',
      description: `Switch from ${usage.model} to ${cheapest.modelId} for ${Math.round((savings / usage.cost) * 100)}% cost savings`,
      potentialSavings: savings,
      confidence: 0.8,
      implementation: `Change model parameter from ${usage.model} to ${cheapest.modelId}`,
      tradeoffs: 'May have slightly different response quality or capabilities',
      alternativeModel: cheapest.modelId,
      estimatedTokens: usage.promptTokens + usage.completionTokens,
    };
  }

  /**
   * Rule 2: Check for prompt optimization potential
   */
  private hasOptimizationPotential(usage: any): boolean {
    return (
      (usage.prompt || '').length > 500 &&
      usage.promptTokens > 500 &&
      usage.cost > 0.05
    );
  }

  /**
   * Rule 2: Suggest prompt optimization
   */
  private suggestPromptOptimization(usage: any): OptimizationSuggestion {
    // Estimate potential savings from prompt compression
    const estimatedCompressionRatio = 0.8; // 20% reduction
    const estimatedCost = usage.cost * estimatedCompressionRatio;
    const savings = usage.cost - estimatedCost;

    return {
      type: 'prompt_optimization',
      title: 'Optimize Prompt Length',
      description: 'Compress or optimize prompt to reduce token count and cost',
      potentialSavings: savings,
      confidence: 0.7,
      implementation:
        'Use prompt compression techniques, remove redundant text, use concise language',
      tradeoffs:
        'May require careful testing to ensure response quality is maintained',
    };
  }

  /**
   * Rule 3: Check if request is cacheable
   */
  private isCacheable(usage: any): boolean {
    // Simple heuristic: similar prompts with same model
    return (usage.prompt || '').length > 100 && usage.promptTokens > 200;
  }

  /**
   * Rule 3: Suggest caching
   */
  private suggestCaching(usage: any): OptimizationSuggestion {
    const estimatedSavings = usage.cost * 0.6; // 60% savings from caching

    return {
      type: 'caching',
      title: 'Implement Semantic Caching',
      description: 'Cache similar prompts to avoid redundant API calls',
      potentialSavings: estimatedSavings,
      confidence: 0.6,
      implementation:
        'Implement semantic caching layer to store and reuse similar prompt responses',
      tradeoffs: 'Requires additional infrastructure and cache management',
    };
  }

  /**
   * Rule 4: Check if request can be batched
   */
  private isBatchable(usage: any): boolean {
    return (
      usage.promptTokens < 1000 &&
      usage.completionTokens < 1000 &&
      usage.responseTime < 3000
    );
  }

  /**
   * Rule 4: Suggest batching
   */
  private suggestBatching(usage: any): OptimizationSuggestion {
    const estimatedSavings = usage.cost * 0.3; // 30% savings from batching

    return {
      type: 'batch_processing',
      title: 'Implement Request Batching',
      description:
        'Batch multiple similar requests to reduce per-request overhead',
      potentialSavings: estimatedSavings,
      confidence: 0.5,
      implementation: 'Group similar requests and process them in batches',
      tradeoffs: 'May increase latency for individual requests',
    };
  }

  /**
   * Rule 5: Check for regional optimization
   */
  private hasRegionalOptimization(usage: any): boolean {
    return (
      (usage.requestTracking?.performance?.networkTime || 0) > 2000 ||
      (usage.requestTracking?.clientInfo?.geoLocation?.country &&
        usage.requestTracking.networking?.serverIP)
    );
  }

  /**
   * Rule 5: Suggest regional optimization
   */
  private suggestRegionalOptimization(usage: any): OptimizationSuggestion {
    const networkTime = usage.requestTracking?.performance?.networkTime || 0;
    const estimatedSavings = usage.cost * 0.1; // 10% savings from better routing

    return {
      type: 'regional_optimization',
      title: 'Optimize Geographic Routing',
      description: `High network latency (${networkTime}ms) detected. Consider routing to closer geographic region.`,
      potentialSavings: estimatedSavings,
      confidence: 0.7,
      implementation:
        'Use geo-aware load balancing or select providers with data centers closer to users',
      tradeoffs: 'May require changes to provider selection logic',
    };
  }

  /**
   * Get usage data for analysis
   */
  private async getUsageDataForAnalysis(
    userId: string,
    projectId?: string,
    timeframe?: { startDate: Date; endDate: Date },
  ): Promise<any[]> {
    const matchQuery: any = { userId };

    if (projectId) {
      matchQuery.projectId = projectId;
    }

    if (timeframe) {
      matchQuery.createdAt = {
        $gte: timeframe.startDate,
        $lte: timeframe.endDate,
      };
    }

    return await this.usageModel
      .find(matchQuery)
      .sort({ createdAt: -1 })
      .limit(1000) // Analyze last 1000 records
      .lean();
  }

  /**
   * Group suggestions by category
   */
  private groupSuggestionsByCategory(
    suggestions: OptimizationSuggestion[],
  ): Record<string, OptimizationSuggestion[]> {
    return suggestions.reduce(
      (groups, suggestion) => {
        const category = suggestion.type;
        if (!groups[category]) {
          groups[category] = [];
        }
        groups[category].push(suggestion);
        return groups;
      },
      {} as Record<string, OptimizationSuggestion[]>,
    );
  }

  /**
   * Calculate optimization trends using statistical analysis
   */
  private async calculateOptimizationTrends(
    userId: string,
    timeframe?: { startDate: Date; endDate: Date },
  ): Promise<OptimizationReport['trends']> {
    const recentUsage = await this.getUsageDataForAnalysis(
      userId,
      undefined,
      timeframe,
    );

    if (recentUsage.length < 3) {
      return {
        costTrend: 'stable',
        optimizationTrend: 'stable',
        topCostDrivers: [],
      };
    }

    // Sort usage by date for proper time series analysis
    const sortedUsage = recentUsage.sort(
      (a, b) =>
        new Date(a.createdAt || 0).getTime() -
        new Date(b.createdAt || 0).getTime(),
    );

    // Calculate cost trend using linear regression
    const costTrend = this.calculateLinearTrend(
      sortedUsage.map((u, i) => ({ x: i, y: u.cost })),
    );

    // Calculate optimization trend based on token efficiency over time
    const optimizationTrend = this.calculateOptimizationTrend(sortedUsage);

    // Calculate top cost drivers with percentage breakdown
    const modelCosts = sortedUsage.reduce(
      (acc, usage) => {
        acc[usage.model] = (acc[usage.model] || 0) + usage.cost;
        return acc;
      },
      {} as Record<string, number>,
    );

    const totalCost = Object.values(modelCosts).reduce(
      (sum: number, cost: number) => sum + cost,
      0,
    ) as number;
    const topCostDrivers = Object.entries(modelCosts)
      .map(([model, cost]: [string, number]) => ({
        model,
        cost,
        percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
      }))
      .sort((a: { cost: number }, b: { cost: number }) => b.cost - a.cost)
      .slice(0, 5)
      .map((item) => item.model);

    return {
      costTrend,
      optimizationTrend,
      topCostDrivers,
    };
  }

  /**
   * Calculate linear trend using simple linear regression
   */
  private calculateLinearTrend(
    dataPoints: Array<{ x: number; y: number }>,
  ): 'increasing' | 'decreasing' | 'stable' {
    if (dataPoints.length < 3) return 'stable';

    const n = dataPoints.length;
    const sumX = dataPoints.reduce((sum, point) => sum + point.x, 0);
    const sumY = dataPoints.reduce((sum, point) => sum + point.y, 0);
    const sumXY = dataPoints.reduce((sum, point) => sum + point.x * point.y, 0);
    const sumXX = dataPoints.reduce((sum, point) => sum + point.x * point.x, 0);

    // Calculate slope (m) = (n * sumXY - sumX * sumY) / (n * sumXX - sumX^2)
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    // Calculate correlation coefficient for confidence
    const meanX = sumX / n;
    const meanY = sumY / n;
    const numerator = dataPoints.reduce(
      (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
      0,
    );
    const denominatorX = Math.sqrt(
      dataPoints.reduce((sum, point) => sum + Math.pow(point.x - meanX, 2), 0),
    );
    const denominatorY = Math.sqrt(
      dataPoints.reduce((sum, point) => sum + Math.pow(point.y - meanY, 2), 0),
    );

    const correlation =
      denominatorX * denominatorY !== 0
        ? numerator / (denominatorX * denominatorY)
        : 0;

    // Only consider trend significant if correlation is strong enough
    const significantSlope = Math.abs(correlation) > 0.3 ? slope : 0;

    if (significantSlope > 0.01) return 'increasing';
    if (significantSlope < -0.01) return 'decreasing';
    return 'stable';
  }

  /**
   * Calculate optimization trend based on token efficiency
   */
  private calculateOptimizationTrend(
    usageData: any[],
  ): 'improving' | 'declining' | 'stable' {
    if (usageData.length < 5) return 'stable';

    // Calculate token efficiency (cost per token) over time
    const efficiencyPoints = usageData
      .filter((u) => u.totalTokens > 0)
      .map((u, index) => ({
        x: index,
        y: u.cost / u.totalTokens, // cost per token
      }));

    if (efficiencyPoints.length < 3) return 'stable';

    const trend = this.calculateLinearTrend(efficiencyPoints);

    // For optimization trend, decreasing cost per token means improving
    switch (trend) {
      case 'decreasing':
        return 'improving';
      case 'increasing':
        return 'declining';
      default:
        return 'stable';
    }
  }

  /**
   * Generate recommendations based on suggestions and trends
   */
  private generateRecommendations(
    suggestions: OptimizationSuggestion[],
    trends: OptimizationReport['trends'],
  ): string[] {
    const recommendations: string[] = [];

    if (suggestions.length === 0) {
      return ['Your usage is already well-optimized!'];
    }

    // High-level recommendations
    const highPriorityCount = suggestions.filter(
      (s) => this.getSuggestionPriority(s) === 'high',
    ).length;
    if (highPriorityCount > 0) {
      recommendations.push(
        `You have ${highPriorityCount} high-priority optimization opportunities that could save you $${suggestions
          .filter((s) => this.getSuggestionPriority(s) === 'high')
          .reduce((sum, s) => sum + s.potentialSavings, 0)
          .toFixed(2)}`,
      );
    }

    if (trends.costTrend === 'increasing') {
      recommendations.push(
        'Your costs are trending upward. Consider implementing the suggested optimizations soon.',
      );
    }

    if (trends.topCostDrivers.length > 0) {
      recommendations.push(
        `Focus on optimizing usage of ${trends.topCostDrivers[0]} which is your highest cost driver.`,
      );
    }

    // Specific recommendations based on suggestion types
    const suggestionTypes = [...new Set(suggestions.map((s) => s.type))];

    if (suggestionTypes.includes('model_downgrade')) {
      recommendations.push(
        'Consider switching to more cost-effective models for suitable use cases.',
      );
    }

    if (suggestionTypes.includes('prompt_optimization')) {
      recommendations.push(
        'Implement prompt compression and optimization techniques.',
      );
    }

    if (suggestionTypes.includes('caching')) {
      recommendations.push(
        'Consider implementing semantic caching for repeated prompts.',
      );
    }

    return recommendations;
  }

  /**
   * Get suggestion priority
   */
  private getSuggestionPriority(
    suggestion: OptimizationSuggestion,
  ): 'high' | 'medium' | 'low' {
    if (suggestion.potentialSavings > 10) return 'high';
    if (suggestion.potentialSavings > 1) return 'medium';
    return 'low';
  }

  /**
   * Create empty report
   */
  private createEmptyReport(): OptimizationReport {
    return {
      summary: {
        totalPotentialSavings: 0,
        optimizationOpportunities: 0,
        highPrioritySuggestions: 0,
        mediumPrioritySuggestions: 0,
        lowPrioritySuggestions: 0,
      },
      suggestions: [],
      byCategory: {},
      trends: {
        costTrend: 'stable',
        optimizationTrend: 'stable',
        topCostDrivers: [],
      },
      recommendations: [
        'No optimization opportunities found in the selected time period.',
      ],
    };
  }

  /**
   * Generate monitoring alerts
   */
  private generateMonitoringAlerts(
    usageData: any[],
    opportunities: OptimizationSuggestion[],
  ): Array<any> {
    const alerts: Array<any> = [];

    // High savings alert
    const highSavingsOpportunities = opportunities.filter(
      (o) => o.potentialSavings > 5,
    );
    if (highSavingsOpportunities.length > 0) {
      alerts.push({
        type: 'high_savings',
        message: `${highSavingsOpportunities.length} high-value optimization opportunities detected`,
        severity: 'high',
      });
    }

    // Cost trend alert
    const recentCosts = usageData.slice(0, 10).map((u) => u.cost);
    const olderCosts = usageData.slice(10, 20).map((u) => u.cost);

    if (recentCosts.length > 0 && olderCosts.length > 0) {
      const recentAvg =
        recentCosts.reduce((a, b) => a + b, 0) / recentCosts.length;
      const olderAvg =
        olderCosts.reduce((a, b) => a + b, 0) / olderCosts.length;

      if (recentAvg > olderAvg * 1.5) {
        alerts.push({
          type: 'trending_costs',
          message:
            'Cost increase of ' +
            Math.round((recentAvg / olderAvg - 1) * 100) +
            '% detected',
          severity: 'medium',
        });
      }
    }

    return alerts;
  }
}
