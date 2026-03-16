import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Telemetry,
  TelemetryDocument,
} from '../../../schemas/core/telemetry.schema';

export interface AnomalyDetection {
  id: string;
  type:
    | 'cost_spike'
    | 'performance_degradation'
    | 'error_surge'
    | 'usage_anomaly';
  severity: 'low' | 'medium' | 'high' | 'critical';
  confidence: number; // 0-1
  description: string;
  affected_operations: string[];
  impact: {
    cost_impact?: number;
    performance_impact?: number;
    error_rate_impact?: number;
  };
  recommendations: string[];
  detected_at: Date;
  time_window: {
    start: Date;
    end: Date;
  };
}

export interface CostOptimization {
  id: string;
  category: 'model_selection' | 'caching' | 'batching' | 'routing' | 'scaling';
  potential_savings: {
    amount_usd: number;
    percentage: number;
  };
  confidence: number;
  description: string;
  affected_operations: string[];
  implementation_difficulty: 'low' | 'medium' | 'high';
  time_to_implement: string; // e.g., "2-4 hours"
  prerequisites?: string[];
  recommendations: string[];
  priority_score: number; // 1-10
}

export interface PredictiveForecast {
  id: string;
  type:
    | 'cost_projection'
    | 'usage_trend'
    | 'performance_forecast'
    | 'error_prediction';
  timeframe: '1d' | '7d' | '30d' | '90d' | '3d';
  confidence: number;
  forecast: {
    current_value: number;
    predicted_value: number;
    growth_rate: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  };
  description: string;
  recommendations: string[];
  risk_level: 'low' | 'medium' | 'high';
  generated_at: Date;
}

export interface AIInsightsResult {
  anomalies: AnomalyDetection[];
  optimizations: CostOptimization[];
  forecasts: PredictiveForecast[];
  summary: {
    total_anomalies: number;
    total_optimizations: number;
    total_forecasts: number;
    critical_issues: number;
    estimated_savings: number;
    health_score: number; // 0-100
  };
  generated_at: Date;
  time_window: {
    start: Date;
    end: Date;
  };
}

/**
 * AIInsightsService
 *
 * Advanced AI-powered insights service for telemetry analysis including:
 * - Anomaly detection (cost spikes, performance issues, error surges)
 * - Cost optimization recommendations
 * - Predictive forecasting
 * - Circuit breaker pattern for reliability
 * - Parallel processing for performance
 */
@Injectable()
export class AIInsightsService {
  private readonly logger = new Logger(AIInsightsService.name);
  private readonly circuitBreaker: {
    failures: number;
    lastFailure: number;
    state: 'closed' | 'open' | 'half-open';
    resetTimeout: number;
  };

  constructor(
    @InjectModel(Telemetry.name)
    private readonly telemetryModel: Model<TelemetryDocument>,
  ) {
    // Initialize circuit breaker
    this.circuitBreaker = {
      failures: 0,
      lastFailure: 0,
      state: 'closed',
      resetTimeout: 60000, // 60 seconds
    };
  }

  /**
   * Generate comprehensive AI insights
   */
  async generateInsights(options?: {
    tenant_id?: string;
    workspace_id?: string;
    timeframe?: string;
    focus_area?: 'cost' | 'performance' | 'usage' | 'errors';
  }): Promise<AIInsightsResult> {
    try {
      // Check circuit breaker
      if (!this.canExecute()) {
        this.logger.warn(
          'Circuit breaker is open, returning cached or empty insights',
        );
        return this.getEmptyInsights();
      }

      // Parse timeframe
      const { startDate, endDate } = this.parseTimeframe(options?.timeframe);

      // Fetch telemetry data
      const telemetryData = await this.fetchTelemetryData(
        startDate,
        endDate,
        options,
      );

      if (telemetryData.length === 0) {
        return this.getEmptyInsights();
      }

      // Generate insights in parallel with circuit breaker protection
      const [anomalies, optimizations, forecasts] = await Promise.all([
        this.detectAnomalies(telemetryData, options?.focus_area),
        this.generateOptimizations(telemetryData, options?.focus_area),
        this.generateForecasts(telemetryData, options?.focus_area),
      ]);

      // Calculate summary metrics
      const summary = this.calculateSummary(
        anomalies,
        optimizations,
        forecasts,
      );

      // Success - reset circuit breaker
      this.circuitBreaker.failures = 0;
      this.circuitBreaker.state = 'closed';

      return {
        anomalies,
        optimizations,
        forecasts,
        summary,
        generated_at: new Date(),
        time_window: { start: startDate, end: endDate },
      };
    } catch (error) {
      this.logger.error('Failed to generate AI insights:', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Record failure for circuit breaker
      this.recordFailure();

      // Return cached or empty insights
      return this.getEmptyInsights();
    }
  }

  /**
   * Detect anomalies in telemetry data
   */
  private async detectAnomalies(
    telemetryData: any[],
    focusArea?: string,
  ): Promise<AnomalyDetection[]> {
    try {
      const anomalies: AnomalyDetection[] = [];

      // Analyze different types of anomalies in parallel
      const anomalyPromises = [
        this.detectCostSpikes(telemetryData),
        this.detectPerformanceDegradation(telemetryData),
        this.detectErrorSurges(telemetryData),
        this.detectUsageAnomalies(telemetryData),
      ];

      const results = await Promise.all(anomalyPromises);

      // Flatten results and filter by focus area if specified
      const allAnomalies = results.flat();
      if (focusArea) {
        return allAnomalies.filter((anomaly) =>
          this.isRelevantToFocusArea(anomaly, focusArea),
        );
      }

      return allAnomalies.sort((a, b) => b.severity.localeCompare(a.severity));
    } catch (error) {
      this.logger.error('Failed to detect anomalies:', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Detect cost spikes
   */
  private async detectCostSpikes(
    telemetryData: any[],
  ): Promise<AnomalyDetection[]> {
    const spikes: AnomalyDetection[] = [];

    // Group by operation and calculate statistics
    const operationStats = this.calculateOperationStats(telemetryData);

    for (const [operation, stats] of Object.entries(operationStats)) {
      if (stats.avgCost > 0.1 && stats.costVariance > 2) {
        // High cost with high variance indicates potential spikes
        const recentData = telemetryData
          .filter((t) => t.operation_name === operation)
          .sort(
            (a, b) =>
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          )
          .slice(0, 10);

        const spikeThreshold = stats.avgCost * 3; // 3x average cost
        const spikeInstances = recentData.filter(
          (t) => t.cost_usd > spikeThreshold,
        );

        if (spikeInstances.length > 0) {
          spikes.push({
            id: `cost-spike-${operation}-${Date.now()}`,
            type: 'cost_spike',
            severity: this.calculateSeverity(
              spikeInstances.length,
              recentData.length,
            ),
            confidence: Math.min(
              (spikeInstances.length / recentData.length) * 100,
              95,
            ),
            description: `Cost spikes detected in ${operation}: ${spikeInstances.length} instances exceeding $${spikeThreshold.toFixed(4)}`,
            affected_operations: [operation],
            impact: {
              cost_impact: spikeInstances.reduce(
                (sum, t) => sum + t.cost_usd,
                0,
              ),
            },
            recommendations: [
              'Implement cost monitoring alerts',
              'Review model selection logic',
              'Consider caching strategies',
              'Analyze spike timing patterns',
            ],
            detected_at: new Date(),
            time_window: {
              start: new Date(
                Math.min(
                  ...recentData.map((t) => new Date(t.timestamp).getTime()),
                ),
              ),
              end: new Date(
                Math.max(
                  ...recentData.map((t) => new Date(t.timestamp).getTime()),
                ),
              ),
            },
          });
        }
      }
    }

    return spikes;
  }

  /**
   * Detect performance degradation
   */
  private async detectPerformanceDegradation(
    telemetryData: any[],
  ): Promise<AnomalyDetection[]> {
    const degradations: AnomalyDetection[] = [];

    const operationStats = this.calculateOperationStats(telemetryData);

    for (const [operation, stats] of Object.entries(operationStats)) {
      if (stats.avgDuration > 1000 && stats.durationVariance > 1.5) {
        // High latency with variance suggests degradation
        const recentData = telemetryData
          .filter((t) => t.operation_name === operation)
          .sort(
            (a, b) =>
              new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
          )
          .slice(0, 20);

        // Calculate trend (sliding window analysis)
        const trend = this.calculateTrend(recentData.map((t) => t.duration_ms));
        const degradationThreshold = stats.avgDuration * 1.5;

        if (
          trend.trend === 'increasing' &&
          recentData.filter((t) => t.duration_ms > degradationThreshold)
            .length >
            recentData.length * 0.3
        ) {
          degradations.push({
            id: `perf-degradation-${operation}-${Date.now()}`,
            type: 'performance_degradation',
            severity: 'high',
            confidence: 85,
            description: `Performance degradation detected in ${operation}: average latency increased by ${(trend.changePercent || 0).toFixed(1)}%`,
            affected_operations: [operation],
            impact: {
              performance_impact: trend.changePercent,
            },
            recommendations: [
              'Check system resource utilization',
              'Review database query performance',
              'Consider load balancing adjustments',
              'Implement performance monitoring',
            ],
            detected_at: new Date(),
            time_window: {
              start: new Date(
                Math.min(
                  ...recentData.map((t) => new Date(t.timestamp).getTime()),
                ),
              ),
              end: new Date(
                Math.max(
                  ...recentData.map((t) => new Date(t.timestamp).getTime()),
                ),
              ),
            },
          });
        }
      }
    }

    return degradations;
  }

  /**
   * Detect error surges
   */
  private async detectErrorSurges(
    telemetryData: any[],
  ): Promise<AnomalyDetection[]> {
    const surges: AnomalyDetection[] = [];

    // Group by time windows (last 24 hours in 1-hour buckets)
    const hourlyStats = this.groupByTimeWindow(telemetryData, 'hour');

    for (const [timeKey, data] of Object.entries(hourlyStats)) {
      const errorRate =
        data.filter((t) => t.status >= 400).length / data.length;
      const avgErrorRate = this.calculateAverageErrorRate(hourlyStats);

      if (errorRate > avgErrorRate * 3 && errorRate > 0.1) {
        // 3x average and >10%
        surges.push({
          id: `error-surge-${timeKey}-${Date.now()}`,
          type: 'error_surge',
          severity: errorRate > 0.5 ? 'critical' : 'high',
          confidence: Math.min(errorRate * 100, 95),
          description: `Error surge detected: ${Math.round(errorRate * 100)}% error rate in ${timeKey}`,
          affected_operations: [...new Set(data.map((t) => t.operation_name))],
          impact: {
            error_rate_impact: errorRate,
          },
          recommendations: [
            'Check application logs for root cause',
            'Review recent deployments',
            'Monitor system health metrics',
            'Implement error rate alerts',
          ],
          detected_at: new Date(),
          time_window: {
            start: new Date(timeKey),
            end: new Date(new Date(timeKey).getTime() + 60 * 60 * 1000),
          },
        });
      }
    }

    return surges;
  }

  /**
   * Detect usage anomalies
   */
  private async detectUsageAnomalies(
    telemetryData: any[],
  ): Promise<AnomalyDetection[]> {
    const anomalies: AnomalyDetection[] = [];

    // Analyze usage patterns by operation
    const operationStats = this.calculateOperationStats(telemetryData);

    for (const [operation, stats] of Object.entries(operationStats)) {
      // Check for unusual spikes in call volume
      const recentData = telemetryData
        .filter((t) => t.operation_name === operation)
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )
        .slice(0, 50);

      if (recentData.length < 10) continue; // Not enough data

      const callVolume = recentData.length;
      const avgCallsPerHour = callVolume / 24; // Assuming 24 hour window

      // Statistical anomaly detection using z-score
      const zScore = this.calculateZScore(avgCallsPerHour, operationStats);

      if (Math.abs(zScore) > 2.5) {
        // 2.5 standard deviations
        anomalies.push({
          id: `usage-anomaly-${operation}-${Date.now()}`,
          type: 'usage_anomaly',
          severity: Math.abs(zScore) > 3.5 ? 'high' : 'medium',
          confidence: Math.min(Math.abs(zScore) * 20, 90),
          description: `Usage anomaly detected in ${operation}: ${zScore > 0 ? 'increased' : 'decreased'} call volume`,
          affected_operations: [operation],
          impact: {},
          recommendations: [
            'Monitor usage patterns closely',
            'Check for potential abuse or DoS attempts',
            'Review rate limiting policies',
            'Scale infrastructure if needed',
          ],
          detected_at: new Date(),
          time_window: {
            start: new Date(
              Math.min(
                ...recentData.map((t) => new Date(t.timestamp).getTime()),
              ),
            ),
            end: new Date(
              Math.max(
                ...recentData.map((t) => new Date(t.timestamp).getTime()),
              ),
            ),
          },
        });
      }
    }

    return anomalies;
  }

  /**
   * Generate cost optimization recommendations
   */
  private async generateOptimizations(
    telemetryData: any[],
    focusArea?: string,
  ): Promise<CostOptimization[]> {
    try {
      const optimizations: CostOptimization[] = [];

      // Analyze different optimization categories
      const optimizationPromises = [
        this.analyzeModelSelection(telemetryData),
        this.analyzeCachingOpportunities(telemetryData),
        this.analyzeBatchingOpportunities(telemetryData),
        this.analyzeRoutingOptimizations(telemetryData),
        this.analyzeScalingRecommendations(telemetryData),
      ];

      const results = await Promise.all(optimizationPromises);
      const allOptimizations = results.flat();

      // Filter by focus area if specified
      if (focusArea === 'cost') {
        return allOptimizations.filter((opt) => opt.category !== 'scaling'); // Scaling might not be pure cost optimization
      }

      return allOptimizations.sort(
        (a, b) => b.priority_score - a.priority_score,
      );
    } catch (error) {
      this.logger.error('Failed to generate optimizations:', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Analyze model selection opportunities
   */
  private async analyzeModelSelection(
    telemetryData: any[],
  ): Promise<CostOptimization[]> {
    const optimizations: CostOptimization[] = [];

    // Group by AI model usage
    const modelUsage = telemetryData.reduce(
      (acc, t) => {
        if (t.gen_ai_model) {
          if (!acc[t.gen_ai_model]) {
            acc[t.gen_ai_model] = { totalCost: 0, totalCalls: 0, avgTokens: 0 };
          }
          acc[t.gen_ai_model].totalCost += t.cost_usd || 0;
          acc[t.gen_ai_model].totalCalls += 1;
          acc[t.gen_ai_model].avgTokens =
            (acc[t.gen_ai_model].avgTokens + (t.gen_ai_input_tokens || 0)) / 2;
        }
        return acc;
      },
      {} as Record<
        string,
        { totalCost: number; totalCalls: number; avgTokens: number }
      >,
    );

    // Find expensive models that could be replaced
    for (const [model, stats] of Object.entries(modelUsage)) {
      const typedStats = stats as { totalCost: number; avgTokens: number };
      if (typedStats.totalCost > 10 && typedStats.avgTokens < 1000) {
        // High cost, low token usage
        const potentialSavings = typedStats.totalCost * 0.4; // Assume 40% savings with better model selection

        optimizations.push({
          id: `model-selection-${model}-${Date.now()}`,
          category: 'model_selection',
          potential_savings: {
            amount_usd: potentialSavings,
            percentage: 40,
          },
          confidence: 75,
          description: `Consider switching from ${model} to more cost-effective alternatives`,
          affected_operations: telemetryData
            .filter((t) => t.gen_ai_model === model)
            .map((t) => t.operation_name)
            .filter((v, i, a) => a.indexOf(v) === i),
          implementation_difficulty: 'medium',
          time_to_implement: '4-8 hours',
          prerequisites: [
            'Model compatibility testing',
            'Performance benchmarking',
          ],
          recommendations: [
            'Benchmark alternative models with similar capabilities',
            'Test performance impact of model switch',
            'Implement gradual rollout with A/B testing',
            'Monitor cost savings and performance metrics',
          ],
          priority_score: Math.min(potentialSavings / 100, 9), // Scale priority by potential savings
        });
      }
    }

    return optimizations;
  }

  /**
   * Analyze caching opportunities
   */
  private async analyzeCachingOpportunities(
    telemetryData: any[],
  ): Promise<CostOptimization[]> {
    const optimizations: CostOptimization[] = [];

    // Look for repeated similar requests
    const operationFrequency = telemetryData.reduce(
      (acc, t) => {
        const key = `${t.operation_name}-${t.http_method}-${t.http_route}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    for (const [operationKey, frequency] of Object.entries(
      operationFrequency,
    )) {
      if ((frequency as number) > 100) {
        // High frequency operations
        const operationData = telemetryData.filter(
          (t) =>
            `${t.operation_name}-${t.http_method}-${t.http_route}` ===
            operationKey,
        );

        const avgCost =
          operationData.reduce((sum, t) => sum + (t.cost_usd || 0), 0) /
          operationData.length;
        const potentialSavings = avgCost * (frequency as number) * 0.6; // Assume 60% cost reduction with caching

        if (potentialSavings > 5) {
          // Only if significant savings
          optimizations.push({
            id: `caching-${operationKey.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`,
            category: 'caching',
            potential_savings: {
              amount_usd: potentialSavings,
              percentage: 60,
            },
            confidence: 80,
            description: `Implement caching for frequently called operation: ${operationKey}`,
            affected_operations: [operationKey.split('-')[0]],
            implementation_difficulty: 'low',
            time_to_implement: '2-4 hours',
            recommendations: [
              'Implement Redis caching layer',
              'Set appropriate cache TTL based on data freshness requirements',
              'Add cache invalidation logic',
              'Monitor cache hit rates and performance impact',
            ],
            priority_score: Math.min(potentialSavings / 50, 8),
          });
        }
      }
    }

    return optimizations;
  }

  /**
   * Analyze batching opportunities
   */
  private async analyzeBatchingOpportunities(
    telemetryData: any[],
  ): Promise<CostOptimization[]> {
    const optimizations: CostOptimization[] = [];

    // Look for multiple similar calls that could be batched
    const operationPatterns = telemetryData.reduce(
      (acc, t) => {
        const pattern = `${t.operation_name}-${t.http_method}`;
        if (!acc[pattern]) acc[pattern] = [];
        acc[pattern].push(t);
        return acc;
      },
      {} as Record<string, any[]>,
    );

    for (const [pattern, calls] of Object.entries(operationPatterns)) {
      if ((calls as any[]).length > 10) {
        // Multiple calls of same pattern
        const timeWindow = 5 * 60 * 1000; // 5 minutes
        const batchedGroups = this.groupIntoBatches(calls as any[], timeWindow);

        // Find groups with multiple calls that could be batched
        const batchableGroups = batchedGroups.filter(
          (group) => group.length > 3,
        );

        if (batchableGroups.length > 0) {
          const totalCalls = batchableGroups.reduce(
            (sum, group) => sum + group.length,
            0,
          );
          const avgCostPerCall =
            (calls as any[]).reduce(
              (sum: number, t: any) => sum + (t.cost_usd || 0),
              0,
            ) / (calls as any[]).length;
          const potentialSavings = totalCalls * avgCostPerCall * 0.3; // Assume 30% savings with batching

          optimizations.push({
            id: `batching-${pattern}-${Date.now()}`,
            category: 'batching',
            potential_savings: {
              amount_usd: potentialSavings,
              percentage: 30,
            },
            confidence: 70,
            description: `Batch multiple ${pattern} calls to reduce API overhead`,
            affected_operations: [pattern.split('-')[0]],
            implementation_difficulty: 'medium',
            time_to_implement: '6-12 hours',
            prerequisites: [
              'API endpoint modifications',
              'Client library updates',
            ],
            recommendations: [
              'Modify API to accept batch requests',
              'Update client libraries to support batching',
              'Implement request deduplication',
              'Add batch size limits and error handling',
            ],
            priority_score: Math.min(potentialSavings / 25, 7),
          });
        }
      }
    }

    return optimizations;
  }

  /**
   * Analyze routing optimizations
   */
  private async analyzeRoutingOptimizations(
    telemetryData: any[],
  ): Promise<CostOptimization[]> {
    const optimizations: CostOptimization[] = [];

    // Analyze latency vs cost tradeoffs
    const operationStats = this.calculateOperationStats(telemetryData);

    for (const [operation, stats] of Object.entries(operationStats)) {
      if (stats.avgCost > 0.05 && stats.avgDuration < 500) {
        // High cost but fast response - might benefit from cheaper but slower routing
        const potentialSavings = stats.totalCost * 0.25; // Assume 25% cost reduction

        optimizations.push({
          id: `routing-${operation}-${Date.now()}`,
          category: 'routing',
          potential_savings: {
            amount_usd: potentialSavings,
            percentage: 25,
          },
          confidence: 65,
          description: `Consider routing ${operation} to cost-optimized endpoints`,
          affected_operations: [operation],
          implementation_difficulty: 'high',
          time_to_implement: '1-2 weeks',
          prerequisites: [
            'Multi-region infrastructure',
            'Routing logic implementation',
          ],
          recommendations: [
            'Implement intelligent routing based on SLAs',
            'Set up cost-optimized endpoints in cheaper regions',
            'Add performance monitoring across routes',
            'Implement failover logic for route failures',
          ],
          priority_score: Math.min(potentialSavings / 20, 6),
        });
      }
    }

    return optimizations;
  }

  /**
   * Analyze scaling recommendations
   */
  private async analyzeScalingRecommendations(
    telemetryData: any[],
  ): Promise<CostOptimization[]> {
    const optimizations: CostOptimization[] = [];

    // Analyze usage patterns to detect over/under provisioning
    const hourlyUsage = this.groupByTimeWindow(telemetryData, 'hour');

    // Calculate utilization variance
    const utilizationRates = Object.values(hourlyUsage).map(
      (data: any[]) => data.length / 100, // Assuming 100 calls/hour capacity
    );

    const avgUtilization =
      utilizationRates.reduce((sum, rate) => sum + rate, 0) /
      utilizationRates.length;
    const utilizationVariance = this.calculateVariance(utilizationRates);

    if (utilizationVariance > 0.5 && avgUtilization < 0.6) {
      // High variance and low average utilization suggests over-provisioning
      const peakUtilization = Math.max(...utilizationRates);
      const wastedCapacity = peakUtilization - avgUtilization;
      const potentialSavings = wastedCapacity * 50; // Assume $50/hour savings per unit of over-provisioning

      optimizations.push({
        id: `scaling-${Date.now()}`,
        category: 'scaling',
        potential_savings: {
          amount_usd: potentialSavings,
          percentage: Math.round((wastedCapacity / peakUtilization) * 100),
        },
        confidence: 60,
        description: 'Optimize resource scaling to match usage patterns',
        affected_operations: [],
        implementation_difficulty: 'high',
        time_to_implement: '1-3 weeks',
        prerequisites: ['Auto-scaling configuration', 'Load testing'],
        recommendations: [
          'Implement auto-scaling based on usage patterns',
          'Use spot instances for non-critical workloads',
          'Implement predictive scaling based on historical data',
          'Monitor scaling events and adjust thresholds',
        ],
        priority_score: Math.min(potentialSavings / 100, 5),
      });
    }

    return optimizations;
  }

  /**
   * Generate predictive forecasts
   */
  private async generateForecasts(
    telemetryData: any[],
    focusArea?: string,
  ): Promise<PredictiveForecast[]> {
    try {
      const forecasts: PredictiveForecast[] = [];

      // Generate different types of forecasts
      const forecastPromises = [
        this.generateCostProjection(telemetryData),
        this.generateUsageTrend(telemetryData),
        this.generatePerformanceForecast(telemetryData),
        this.generateErrorPrediction(telemetryData),
      ];

      const results = await Promise.all(forecastPromises);
      const allForecasts = results.flat();

      // Filter by focus area if specified
      if (focusArea) {
        return allForecasts.filter((forecast) =>
          this.isRelevantToFocusArea(forecast, focusArea),
        );
      }

      return allForecasts;
    } catch (error) {
      this.logger.error('Failed to generate forecasts:', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Generate cost projection forecast
   */
  private async generateCostProjection(
    telemetryData: any[],
  ): Promise<PredictiveForecast[]> {
    const forecasts: PredictiveForecast[] = [];

    // Calculate cost trends over time
    const dailyCosts = this.groupByTimeWindow(
      telemetryData,
      'day',
      (t) => t.cost_usd || 0,
    );

    if (Object.keys(dailyCosts).length >= 7) {
      // Need at least a week of data
      const costValues = Object.values(dailyCosts).map((data: any[]) =>
        data.reduce((sum, t) => sum + t, 0),
      );

      const trend = this.calculateTrend(
        costValues.map((value, index) => ({ value, index })),
      );

      if (trend.trend !== 'stable') {
        const currentValue = costValues[costValues.length - 1];
        const growthRate = trend.changePercent || 0;
        const predictedValue = currentValue * (1 + growthRate / 100);

        forecasts.push({
          id: `cost-projection-${Date.now()}`,
          type: 'cost_projection',
          timeframe: '30d',
          confidence: 70,
          forecast: {
            current_value: currentValue,
            predicted_value: predictedValue,
            growth_rate: growthRate,
            trend: trend.trend,
          },
          description: `Cost ${trend.trend} trend detected: projected ${Math.abs(growthRate).toFixed(1)}% ${trend.trend === 'increasing' ? 'increase' : 'decrease'} over next 30 days`,
          recommendations:
            trend.trend === 'increasing'
              ? [
                  'Implement cost monitoring alerts',
                  'Review recent changes that may have increased costs',
                  'Consider cost optimization measures',
                  'Plan budget adjustments',
                ]
              : [
                  'Monitor for cost optimization opportunities',
                  'Consider scaling up if costs are decreasing too rapidly',
                  'Review if cost reductions are intentional',
                ],
          risk_level: Math.abs(growthRate) > 20 ? 'high' : 'medium',
          generated_at: new Date(),
        });
      }
    }

    return forecasts;
  }

  /**
   * Generate usage trend forecast
   */
  private async generateUsageTrend(
    telemetryData: any[],
  ): Promise<PredictiveForecast[]> {
    const forecasts: PredictiveForecast[] = [];

    // Calculate usage trends
    const hourlyUsage = this.groupByTimeWindow(telemetryData, 'hour');

    const usageCounts = Object.values(hourlyUsage).map(
      (data: any[]) => data.length,
    );

    if (usageCounts.length >= 24) {
      // At least 24 hours of data
      const trend = this.calculateTrend(
        usageCounts.map((count, index) => ({ value: count, index })),
      );

      if (trend.trend !== 'stable') {
        const currentValue = usageCounts[usageCounts.length - 1];
        const growthRate = trend.changePercent || 0;
        const predictedValue = Math.round(
          currentValue * (1 + growthRate / 100),
        );

        forecasts.push({
          id: `usage-trend-${Date.now()}`,
          type: 'usage_trend',
          timeframe: '7d',
          confidence: 75,
          forecast: {
            current_value: currentValue,
            predicted_value: predictedValue,
            growth_rate: growthRate,
            trend: trend.trend,
          },
          description: `Usage ${trend.trend} trend: projected ${Math.abs(growthRate).toFixed(1)}% ${trend.trend === 'increasing' ? 'increase' : 'decrease'} in call volume`,
          recommendations:
            trend.trend === 'increasing'
              ? [
                  'Prepare for increased load',
                  'Consider scaling infrastructure',
                  'Review rate limiting policies',
                  'Monitor resource utilization',
                ]
              : [
                  'Optimize resource allocation',
                  'Consider cost-saving measures',
                  'Review if usage decrease is expected',
                ],
          risk_level: Math.abs(growthRate) > 30 ? 'high' : 'low',
          generated_at: new Date(),
        });
      }
    }

    return forecasts;
  }

  /**
   * Generate performance forecast
   */
  private async generatePerformanceForecast(
    telemetryData: any[],
  ): Promise<PredictiveForecast[]> {
    const forecasts: PredictiveForecast[] = [];

    // Calculate performance trends
    const operationStats = this.calculateOperationStats(telemetryData);

    for (const [operation, stats] of Object.entries(operationStats)) {
      const operationData = telemetryData.filter(
        (t) => t.operation_name === operation,
      );
      const performanceValues = operationData.map((t) => t.duration_ms);

      if (performanceValues.length >= 20) {
        const trend = this.calculateTrend(
          performanceValues.map((value, index) => ({ value, index })),
        );

        if (trend.trend === 'increasing') {
          forecasts.push({
            id: `performance-forecast-${operation}-${Date.now()}`,
            type: 'performance_forecast',
            timeframe: '7d',
            confidence: 65,
            forecast: {
              current_value: stats.avgDuration,
              predicted_value:
                stats.avgDuration * (1 + (trend.changePercent || 0) / 100),
              growth_rate: trend.changePercent || 0,
              trend: 'increasing',
            },
            description: `Performance degradation forecast for ${operation}: ${Math.abs(trend.changePercent || 0).toFixed(1)}% increase in latency expected`,
            recommendations: [
              'Monitor system performance closely',
              'Check for resource bottlenecks',
              'Review recent code changes',
              'Consider performance optimization measures',
            ],
            risk_level: 'high',
            generated_at: new Date(),
          });
        }
      }
    }

    return forecasts;
  }

  /**
   * Generate error prediction
   */
  private async generateErrorPrediction(
    telemetryData: any[],
  ): Promise<PredictiveForecast[]> {
    const forecasts: PredictiveForecast[] = [];

    // Calculate error rate trends
    const hourlyErrors = this.groupByTimeWindow(telemetryData, 'hour', (t) =>
      t.status >= 400 ? 1 : 0,
    );

    const errorRates = Object.values(hourlyErrors).map((data: any[]) => {
      const total = data.reduce((sum, val) => sum + val, 0);
      return data.length > 0 ? total / data.length : 0;
    });

    if (errorRates.length >= 24) {
      const trend = this.calculateTrend(
        errorRates.map((rate, index) => ({ value: rate, index })),
      );

      if (
        trend.trend === 'increasing' &&
        trend.changePercent &&
        trend.changePercent > 10
      ) {
        const currentValue = errorRates[errorRates.length - 1] * 100;
        const predictedValue = currentValue * (1 + trend.changePercent / 100);

        forecasts.push({
          id: `error-prediction-${Date.now()}`,
          type: 'error_prediction',
          timeframe: '7d',
          confidence: 60,
          forecast: {
            current_value: currentValue,
            predicted_value: predictedValue,
            growth_rate: trend.changePercent,
            trend: 'increasing',
          },
          description: `Error rate increase forecast: projected rise from ${currentValue.toFixed(1)}% to ${predictedValue.toFixed(1)}%`,
          recommendations: [
            'Investigate root causes of current errors',
            'Review recent deployments and changes',
            'Implement additional error monitoring',
            'Prepare incident response procedures',
          ],
          risk_level: 'high',
          generated_at: new Date(),
        });
      }
    }

    return forecasts;
  }

  // Helper methods

  private calculateOperationStats(telemetryData: any[]): Record<
    string,
    {
      totalCost: number;
      avgCost: number;
      costVariance: number;
      avgDuration: number;
      durationVariance: number;
      totalCalls: number;
    }
  > {
    const stats: Record<string, any> = {};

    const operationGroups = telemetryData.reduce(
      (acc, t) => {
        const op = t.operation_name || 'unknown';
        if (!acc[op]) acc[op] = [];
        acc[op].push(t);
        return acc;
      },
      {} as Record<string, any[]>,
    );

    for (const [operation, data] of Object.entries(operationGroups)) {
      const typedData = data as any[];
      const costs = typedData.map((t: any) => t.cost_usd || 0);
      const durations = typedData.map((t: any) => t.duration_ms || 0);

      stats[operation] = {
        totalCost: costs.reduce((sum: number, cost: number) => sum + cost, 0),
        avgCost:
          costs.reduce((sum: number, cost: number) => sum + cost, 0) /
          costs.length,
        costVariance: this.calculateVariance(costs),
        avgDuration:
          durations.reduce((sum: number, dur: number) => sum + dur, 0) /
          durations.length,
        durationVariance: this.calculateVariance(durations),
        totalCalls: typedData.length,
      };
    }

    return stats;
  }

  private calculateTrend(values: any[]): {
    trend: 'increasing' | 'decreasing' | 'stable';
    changePercent?: number;
  } {
    if (values.length < 3) return { trend: 'stable' };

    const recent = values.slice(-Math.min(10, values.length));
    const older = values.slice(-Math.min(20, values.length), -10);

    if (older.length === 0) return { trend: 'stable' };

    const recentAvg =
      recent.reduce(
        (sum, val) => sum + (typeof val === 'object' ? val.value : val),
        0,
      ) / recent.length;
    const olderAvg =
      older.reduce(
        (sum, val) => sum + (typeof val === 'object' ? val.value : val),
        0,
      ) / older.length;

    const changePercent = ((recentAvg - olderAvg) / olderAvg) * 100;

    if (Math.abs(changePercent) < 5) return { trend: 'stable' };
    return {
      trend: changePercent > 0 ? 'increasing' : 'decreasing',
      changePercent: Math.abs(changePercent),
    };
  }

  private calculateVariance(values: number[]): number {
    if (values.length <= 1) return 0;

    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, sq) => sum + sq, 0) / squaredDiffs.length;
  }

  private calculateZScore(value: number, stats: Record<string, any>): number {
    // Simplified z-score calculation
    const values = Object.values(stats).map((s: any) => s.totalCalls || 0);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const stdDev = Math.sqrt(this.calculateVariance(values));

    return stdDev > 0 ? (value - mean) / stdDev : 0;
  }

  private groupByTimeWindow(
    telemetryData: any[],
    window: 'hour' | 'day',
    valueExtractor?: (t: any) => number,
  ): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    const windowMs = window === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

    telemetryData.forEach((t) => {
      const timestamp = new Date(t.timestamp).getTime();
      const windowStart = Math.floor(timestamp / windowMs) * windowMs;
      const key = new Date(windowStart).toISOString();

      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(valueExtractor ? valueExtractor(t) : t);
    });

    return grouped;
  }

  private calculateAverageErrorRate(
    hourlyStats: Record<string, any[]>,
  ): number {
    const errorRates = Object.values(hourlyStats).map((data: any[]) => {
      const errors = data.filter((t) => t.status >= 400).length;
      return errors / data.length;
    });

    return errorRates.reduce((sum, rate) => sum + rate, 0) / errorRates.length;
  }

  private groupIntoBatches(calls: any[], timeWindow: number): any[][] {
    const sorted = calls.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    const batches: any[][] = [];

    let currentBatch: any[] = [];
    let lastTime = 0;

    sorted.forEach((call) => {
      const callTime = new Date(call.timestamp).getTime();

      if (currentBatch.length === 0 || callTime - lastTime <= timeWindow) {
        currentBatch.push(call);
      } else {
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
        }
        currentBatch = [call];
      }

      lastTime = callTime;
    });

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    return batches;
  }

  private parseTimeframe(timeframe?: string): {
    startDate: Date;
    endDate: Date;
  } {
    const now = new Date();
    let hours = 24; // Default 24 hours

    if (timeframe === '1h') hours = 1;
    else if (timeframe === '7d') hours = 7 * 24;
    else if (timeframe === '30d') hours = 30 * 24;

    const endDate = now;
    const startDate = new Date(now.getTime() - hours * 60 * 60 * 1000);

    return { startDate, endDate };
  }

  private async fetchTelemetryData(
    startDate: Date,
    endDate: Date,
    options?: { tenant_id?: string; workspace_id?: string },
  ): Promise<any[]> {
    const query: any = {
      timestamp: {
        $gte: startDate,
        $lte: endDate,
      },
    };

    if (options?.tenant_id) query.tenant_id = options.tenant_id;
    if (options?.workspace_id) query.workspace_id = options.workspace_id;

    const results = await this.telemetryModel
      .find(query)
      .sort({ timestamp: -1 })
      .limit(10000) // Reasonable limit for analysis
      .lean();

    return results;
  }

  private calculateSeverity(
    instanceCount: number,
    totalCount: number,
  ): 'low' | 'medium' | 'high' | 'critical' {
    const ratio = instanceCount / totalCount;
    if (ratio > 0.5) return 'critical';
    if (ratio > 0.25) return 'high';
    if (ratio > 0.1) return 'medium';
    return 'low';
  }

  private isRelevantToFocusArea(item: any, focusArea: string): boolean {
    if (item.type) {
      // For anomalies
      switch (focusArea) {
        case 'cost':
          return item.type.includes('cost');
        case 'performance':
          return (
            item.type.includes('performance') || item.type.includes('latency')
          );
        case 'usage':
          return item.type.includes('usage');
        case 'errors':
          return item.type.includes('error');
      }
    } else if (item.category) {
      // For optimizations
      return focusArea === 'cost'; // Most optimizations are cost-related
    } else if (item.type) {
      // For forecasts
      switch (focusArea) {
        case 'cost':
          return item.type.includes('cost');
        case 'performance':
          return item.type.includes('performance');
        case 'usage':
          return item.type.includes('usage');
        case 'errors':
          return item.type.includes('error');
      }
    }
    return true;
  }

  private calculateSummary(
    anomalies: AnomalyDetection[],
    optimizations: CostOptimization[],
    forecasts: PredictiveForecast[],
  ): any {
    const totalAnomalies = anomalies.length;
    const criticalIssues = anomalies.filter(
      (a) => a.severity === 'critical',
    ).length;
    const estimatedSavings = optimizations.reduce(
      (sum, opt) => sum + opt.potential_savings.amount_usd,
      0,
    );
    const healthScore = Math.max(
      0,
      100 - totalAnomalies * 5 - criticalIssues * 20,
    );

    return {
      total_anomalies: totalAnomalies,
      total_optimizations: optimizations.length,
      total_forecasts: forecasts.length,
      critical_issues: criticalIssues,
      estimated_savings: estimatedSavings,
      health_score: healthScore,
    };
  }

  private getEmptyInsights(): AIInsightsResult {
    return {
      anomalies: [],
      optimizations: [],
      forecasts: [],
      summary: {
        total_anomalies: 0,
        total_optimizations: 0,
        total_forecasts: 0,
        critical_issues: 0,
        estimated_savings: 0,
        health_score: 100,
      },
      generated_at: new Date(),
      time_window: {
        start: new Date(Date.now() - 24 * 60 * 60 * 1000),
        end: new Date(),
      },
    };
  }

  // Circuit breaker methods

  private canExecute(): boolean {
    const now = Date.now();

    if (this.circuitBreaker.state === 'open') {
      if (
        now - this.circuitBreaker.lastFailure >
        this.circuitBreaker.resetTimeout
      ) {
        this.circuitBreaker.state = 'half-open';
        this.logger.log('Circuit breaker transitioning to half-open state');
        return true;
      }
      return false;
    }

    return true;
  }

  private recordFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailure = Date.now();

    if (this.circuitBreaker.failures >= 3) {
      this.circuitBreaker.state = 'open';
      this.logger.warn('Circuit breaker opened due to repeated failures');
    }
  }
}
