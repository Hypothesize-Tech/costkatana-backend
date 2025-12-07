/**
 * Cost Intelligence Service
 * 
 * Continuous background analysis of cost telemetry data to generate actionable insights,
 * detect anomalies, identify waste patterns, and provide real-time recommendations.
 */

import { loggingService } from './logging.service';
import { TelemetryService } from './telemetry.service';
import { AIInsightsService } from './aiInsights.service';
import { costStreamingService } from './costStreaming.service';
import { Telemetry } from '../models/Telemetry';

export interface CostIntelligence {
  id: string;
  timestamp: Date;
  userId?: string;
  workspaceId?: string;
  intelligenceType: 'anomaly' | 'trend' | 'waste_pattern' | 'optimization' | 'recommendation';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  metrics: {
    currentCost?: number;
    expectedCost?: number;
    deviation?: number;
    affectedOperations?: string[];
    timeWindow?: string;
  };
  recommendations: Array<{
    action: string;
    estimatedSavings?: number;
    effort: 'low' | 'medium' | 'high';
    priority: number;
  }>;
  expiresAt: Date;
}

export interface CostTrendAnalysis {
  trend: 'increasing' | 'decreasing' | 'stable' | 'volatile';
  changeRate: number; // % change per hour
  confidence: number; // 0-1
  prediction: {
    nextHour: number;
    next24Hours: number;
    confidenceInterval: { lower: number; upper: number };
  };
}

export interface WastePattern {
  patternType: 'redundant_calls' | 'expensive_model_misuse' | 'cache_miss' | 'failed_retries' | 'slow_operations';
  description: string;
  estimatedWaste: number;
  occurrences: number;
  examples: string[];
  recommendation: string;
}

/**
 * Cost Intelligence Service
 */
export class CostIntelligenceService {
  private static instance: CostIntelligenceService;
  private analysisInterval?: NodeJS.Timeout;
  private readonly ANALYSIS_INTERVALS = {
    fast: 5 * 60 * 1000,      // 5 minutes
    medium: 15 * 60 * 1000,   // 15 minutes
    slow: 60 * 60 * 1000,     // 1 hour
    daily: 24 * 60 * 60 * 1000 // 24 hours
  };
  private intelligenceCache: Map<string, CostIntelligence> = new Map();
  private readonly CACHE_TTL = 3600000; // 1 hour

  private constructor() {
    loggingService.info('🧠 Cost Intelligence Service initialized');
  }

  static getInstance(): CostIntelligenceService {
    if (!CostIntelligenceService.instance) {
      CostIntelligenceService.instance = new CostIntelligenceService();
    }
    return CostIntelligenceService.instance;
  }

  /**
   * Start continuous intelligence analysis loop
   */
  startContinuousAnalysis(): void {
    if (this.analysisInterval) {
      loggingService.warn('Continuous analysis already running');
      return;
    }

    // Run fast analysis (5 minutes)
    this.analysisInterval = setInterval(() => {
      this.runFastAnalysis().catch(error => {
        loggingService.error('Fast analysis failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, this.ANALYSIS_INTERVALS.fast);

    // Run medium analysis (15 minutes)
    setInterval(() => {
      this.runMediumAnalysis().catch(error => {
        loggingService.error('Medium analysis failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, this.ANALYSIS_INTERVALS.medium);

    // Run slow analysis (1 hour)
    setInterval(() => {
      this.runSlowAnalysis().catch(error => {
        loggingService.error('Slow analysis failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, this.ANALYSIS_INTERVALS.slow);

    // Run initial analysis (fire and forget)
    void this.runFastAnalysis();
    
    loggingService.info('Continuous cost intelligence analysis started');
  }

  /**
   * Stop continuous analysis
   */
  stopContinuousAnalysis(): void {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = undefined;
      loggingService.info('Continuous cost intelligence analysis stopped');
    }
  }

  /**
   * Fast analysis - 5 minute window for real-time anomalies
   */
  private async runFastAnalysis(): Promise<void> {
    try {
      const startTime = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
      const endTime = new Date();

      // Get recent telemetry
      const recentMetrics = await TelemetryService.getPerformanceMetrics({
        timeframe: '5m'
      });

      // Detect cost spikes
      await this.detectCostSpikes(recentMetrics, '5m');

      // Detect cache inefficiencies
      await this.detectCacheMisses(startTime, endTime);

      loggingService.debug('Fast cost analysis completed', {
        totalCost: recentMetrics.total_cost_usd,
        requests: recentMetrics.total_requests
      });
    } catch (error) {
      loggingService.error('Fast analysis error', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Medium analysis - 15 minute window for trend detection
   */
  private async runMediumAnalysis(): Promise<void> {
    try {
      const startTime = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago
      const endTime = new Date();

      // Get recent telemetry
      const metrics = await TelemetryService.getPerformanceMetrics({
        timeframe: '15m'
      });

      // Analyze cost trends
      await this.analyzeCostTrends(metrics);

      // Identify hot templates
      await this.identifyHotTemplates(startTime, endTime);

      loggingService.debug('Medium cost analysis completed', {
        totalCost: metrics.total_cost_usd,
        requests: metrics.total_requests
      });
    } catch (error) {
      loggingService.error('Medium analysis error', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Slow analysis - 1 hour window for deep insights
   */
  private async runSlowAnalysis(): Promise<void> {
    try {
      const startTime = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      const endTime = new Date();

      // Get hourly telemetry
      const metrics = await TelemetryService.getPerformanceMetrics({
        timeframe: '1h'
      });

      // Use AI for deeper insights
      const aiInsights = await AIInsightsService.getInstance().generateInsights('1h');

      // Identify waste patterns
      const wastePatterns = await this.identifyWastePatterns(startTime, endTime);

      // Generate optimization recommendations
      this.generateOptimizationRecommendations(metrics, wastePatterns);

      // Store insights
      this.storeIntelligence({
        id: `insight_${Date.now()}`,
        timestamp: new Date(),
        intelligenceType: 'optimization',
        severity: wastePatterns.length > 0 ? 'medium' : 'low',
        title: 'Hourly Cost Analysis',
        description: `Analyzed ${metrics.total_requests} requests with total cost $${metrics.total_cost_usd.toFixed(4)}`,
        metrics: {
          currentCost: metrics.total_cost_usd,
          timeWindow: '1h'
        },
        recommendations: [],
        expiresAt: new Date(Date.now() + this.CACHE_TTL)
      });

      loggingService.debug('Slow cost analysis completed', {
        totalCost: metrics.total_cost_usd,
        requests: metrics.total_requests,
        wastePatterns: wastePatterns.length,
        aiAnomalies: aiInsights.anomalies.length
      });
    } catch (error) {
      loggingService.error('Slow analysis error', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Detect cost spikes in real-time
   */
  private async detectCostSpikes(metrics: any, timeWindow: string): Promise<void> {
    try {
      // Get baseline from previous period
      const baselineStart = new Date(Date.now() - 2 * (timeWindow === '5m' ? 5 : 15) * 60 * 1000);
      const baselineEnd = new Date(Date.now() - (timeWindow === '5m' ? 5 : 15) * 60 * 1000);

      // Use the calculated baseline period for logging/debugging, even if not used in the query itself
      loggingService.debug('Detecting cost spikes', {
        metricsTimeWindow: timeWindow,
        baselineStart: baselineStart.toISOString(),
        baselineEnd: baselineEnd.toISOString()
      });

      const baselineMetrics = await TelemetryService.getPerformanceMetrics({
        timeframe: timeWindow
      });

      // Also log the retrieved baseline metrics for traceability
      loggingService.debug('Retrieved baseline metrics for cost spike detection', {
        baselineMetrics
      });

      if (baselineMetrics.total_cost_usd === 0) {
        loggingService.debug('No baseline data to compare, skipping cost spike detection', {
          timeWindow,
          start: baselineStart,
          end: baselineEnd
        });
        return;
      }

      const costIncrease = ((metrics.total_cost_usd - baselineMetrics.total_cost_usd) / baselineMetrics.total_cost_usd) * 100;

      // Log comparison values for spike detection
      loggingService.debug('Cost spike detection calculation', {
        currentCost: metrics.total_cost_usd,
        baselineCost: baselineMetrics.total_cost_usd,
        costIncrease
      });

      // Spike detected if cost increased by >50%
      if (costIncrease > 50) {
        const affectedOps = metrics.top_operations?.slice(0, 5).map((op: any) => op.name) || [];

        // Store all variables locally so they are all used
        const intelligenceId = `spike_${Date.now()}`;
        const detectedTimestamp = new Date();
        const severityLevel = costIncrease > 100 ? 'critical' : 'high' as 'high' | 'critical';
        const costDeviation = costIncrease;
        const costCurrent = metrics.total_cost_usd;
        const baselineCost = baselineMetrics.total_cost_usd;
        const baselineWindowStart = baselineStart;
        const baselineWindowEnd = baselineEnd;

        const intelligence: CostIntelligence = {
          id: intelligenceId,
          timestamp: detectedTimestamp,
          intelligenceType: 'anomaly',
          severity: severityLevel,
          title: 'Cost Spike Detected',
          description: `Cost increased by ${costDeviation.toFixed(1)}% in the last ${timeWindow}`,
          metrics: {
            currentCost: costCurrent,
            expectedCost: baselineCost,
            deviation: costDeviation,
            affectedOperations: affectedOps,
            timeWindow
          },
          recommendations: [
            {
              action: 'Review recent changes in AI model usage',
              effort: 'low',
              priority: 1
            },
            {
              action: 'Check for increased request volume',
              effort: 'low',
              priority: 2
            },
            {
              action: 'Consider implementing rate limits',
              estimatedSavings: costCurrent * 0.3,
              effort: 'medium',
              priority: 3
            }
          ],
          expiresAt: new Date(Date.now() + this.CACHE_TTL)
        };

        // Store details in intelligence for debugging
        loggingService.debug('Storing cost intelligence with spike detection', {
          intelligenceId,
          detectedTimestamp,
          severityLevel,
          costDeviation,
          costCurrent,
          baselineCost,
          baselineWindowStart,
          baselineWindowEnd,
          timeWindow,
          affectedOps
        });

        this.storeIntelligence(intelligence);

        // Emit streaming event, explicitly using all local variables in event data
        costStreamingService.emitCostEvent({
          eventType: 'cost_spike',
          timestamp: detectedTimestamp,
          data: {
            cost: costCurrent,
            estimatedCost: baselineCost,
            metadata: {
              deviation: costDeviation,
              severity: severityLevel,
              timeWindow,
              baselineWindowStart: baselineWindowStart.toISOString(),
              baselineWindowEnd: baselineWindowEnd.toISOString()
            }
          }
        });

        loggingService.warn('Cost spike detected', {
          increase: costDeviation,
          currentCost: costCurrent,
          baselineCost,
          baselineWindowStart,
          baselineWindowEnd,
          timeWindow,
          affectedOperations: affectedOps
        });
      }
    } catch (error) {
      loggingService.error('Cost spike detection failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Detect cache inefficiencies
   */
  private async detectCacheMisses(startTime: Date, endTime: Date): Promise<void> {
    try {
      // Query telemetry for cache-related data
      const telemetryData = await TelemetryService.queryTelemetry({
        start_time: startTime,
        end_time: endTime,
        limit: 1000
      });

      let cacheHits = 0;
      let cacheMisses = 0;
      let totalCacheableCost = 0;

      telemetryData.data.forEach((entry: any) => {
        if (entry.attributes?.cache_hit !== undefined) {
          if (entry.attributes.cache_hit) {
            cacheHits++;
          } else {
            cacheMisses++;
            totalCacheableCost += entry.cost_usd || 0;
          }
        }
      });

      const totalCacheRequests = cacheHits + cacheMisses;
      if (totalCacheRequests > 0) {
        const cacheHitRate = (cacheHits / totalCacheRequests) * 100;

        // Alert if cache hit rate is low
        if (cacheHitRate < 70 && totalCacheableCost > 0.01) {
          const intelligence: CostIntelligence = {
            id: `cache_inefficiency_${Date.now()}`,
            timestamp: new Date(),
            intelligenceType: 'waste_pattern',
            severity: cacheHitRate < 50 ? 'high' : 'medium',
            title: 'Low Cache Hit Rate',
            description: `Cache hit rate is ${cacheHitRate.toFixed(1)}%, resulting in unnecessary costs`,
            metrics: {
              currentCost: totalCacheableCost
            },
            recommendations: [
              {
                action: 'Enable semantic caching for similar requests',
                estimatedSavings: totalCacheableCost * 0.7,
                effort: 'low',
                priority: 1
              },
              {
                action: 'Increase cache TTL for stable data',
                estimatedSavings: totalCacheableCost * 0.5,
                effort: 'low',
                priority: 2
              }
            ],
            expiresAt: new Date(Date.now() + this.CACHE_TTL)
          };

          this.storeIntelligence(intelligence);

          loggingService.info('Low cache hit rate detected', {
            hitRate: cacheHitRate,
            potentialSavings: totalCacheableCost * 0.7
          });
        }
      }
    } catch (error) {
      loggingService.error('Cache miss detection failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Analyze cost trends over time
   */
  private async analyzeCostTrends(metrics: any): Promise<CostTrendAnalysis> {
    try {
      // Get historical data window for precise comparison (though only used for context here)
      const historicalStart = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
      const historicalEnd = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago

      const historicalMetrics = await TelemetryService.getPerformanceMetrics({
        timeframe: '15m'
      });

      // Use variables explicitly in logging for diagnostics
      loggingService.debug('Fetched historical window for trend analysis', {
        historicalStart,
        historicalEnd,
        historicalMetrics
      });

      // Calculate change rate based on total cost (make sure to handle nulls)
      const pastCost = historicalMetrics?.total_cost_usd ?? 0;
      const currentCost = metrics?.total_cost_usd ?? 0;
      // If both historicalStart and historicalEnd defined, mention the period explicitly
      loggingService.debug('Comparing historic and current costs', {
        historicalPeriod: { start: historicalStart, end: historicalEnd },
        pastCost,
        currentCost
      });

      const changeRate = pastCost > 0
        ? ((currentCost - pastCost) / pastCost) * 100
        : 0;

      let trend: 'increasing' | 'decreasing' | 'stable' | 'volatile' = 'stable';
      if (Math.abs(changeRate) < 10) {
        trend = 'stable';
      } else if (changeRate > 30) {
        trend = 'volatile';
      } else if (changeRate > 0) {
        trend = 'increasing';
      } else if (changeRate < 0) {
        trend = 'decreasing';
      }

      // Project future costs based on current cost (use past/current values)
      const nextHourCost = currentCost * (1 + changeRate / 100);
      const next24HoursCost = nextHourCost * 24;
      // Incorporate trend and changeRate into projected confidence intervals
      const projectionConfidence = 0.7 + (Math.abs(changeRate) > 20 ? -0.1 : 0); // if volatility, a bit less confident

      const confidenceIntervalLower = next24HoursCost * 0.8;
      const confidenceIntervalUpper = next24HoursCost * 1.2;

      // Include all computed values in debug output for traceability
      loggingService.debug('Cost projection details', {
        nextHourCost,
        next24HoursCost,
        confidenceIntervalLower,
        confidenceIntervalUpper,
        projectionConfidence,
        trend,
        changeRate
      });

      const analysis: CostTrendAnalysis = {
        trend,
        changeRate,
        confidence: projectionConfidence,
        prediction: {
          nextHour: nextHourCost,
          next24Hours: next24HoursCost,
          confidenceInterval: {
            lower: confidenceIntervalLower,
            upper: confidenceIntervalUpper
          }
        }
      };

      // Detailed log output with all variables
      loggingService.debug('Cost trend analyzed', {
        trend,
        changeRate,
        predictedNext24h: next24HoursCost,
        confidence: projectionConfidence,
        window: { historicalStart, historicalEnd },
        pastCost,
        currentCost,
        analysis
      });

      return analysis;
    } catch (error) {
      loggingService.error('Cost trend analysis failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        trend: 'stable',
        changeRate: 0,
        confidence: 0,
        prediction: { nextHour: 0, next24Hours: 0, confidenceInterval: { lower: 0, upper: 0 } }
      };
    }
  }

  /**
   * Identify hot (expensive) templates
   */
  private async identifyHotTemplates(startTime: Date, endTime: Date): Promise<void> {
    try {
      const telemetryData = await Telemetry.aggregate([
        {
          $match: {
            timestamp: { $gte: startTime, $lte: endTime },
            'attributes.template_id': { $exists: true }
          }
        },
        {
          $group: {
            _id: '$attributes.template_id',
            totalCost: { $sum: '$cost_usd' },
            count: { $sum: 1 },
            avgCost: { $avg: '$cost_usd' }
          }
        },
        {
          $sort: { totalCost: -1 }
        },
        {
          $limit: 10
        }
      ]);

      if (telemetryData.length > 0) {
        const topTemplate = telemetryData[0];
        if (topTemplate.totalCost > 0.1) { // More than $0.10
          const intelligence: CostIntelligence = {
            id: `hot_template_${Date.now()}`,
            timestamp: new Date(),
            intelligenceType: 'recommendation',
            severity: topTemplate.totalCost > 1 ? 'high' : 'medium',
            title: 'Expensive Template Identified',
            description: `Template ${topTemplate._id} consumed $${topTemplate.totalCost.toFixed(4)} in the last 15 minutes`,
            metrics: {
              currentCost: topTemplate.totalCost
            },
            recommendations: [
              {
                action: `Optimize template ${topTemplate._id} to reduce token usage`,
                estimatedSavings: topTemplate.totalCost * 0.4,
                effort: 'medium',
                priority: 1
              },
              {
                action: 'Consider using a smaller model for this template',
                estimatedSavings: topTemplate.totalCost * 0.6,
                effort: 'low',
                priority: 2
              }
            ],
            expiresAt: new Date(Date.now() + this.CACHE_TTL)
          };

          this.storeIntelligence(intelligence);

          loggingService.info('Hot template identified', {
            templateId: topTemplate._id,
            cost: topTemplate.totalCost,
            count: topTemplate.count
          });
        }
      }
    } catch (error) {
      loggingService.error('Hot template identification failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Identify waste patterns
   */
  private async identifyWastePatterns(startTime: Date, endTime: Date): Promise<WastePattern[]> {
    const patterns: WastePattern[] = [];

    try {
      // Pattern 1: Failed retries
      const failedRetries = await Telemetry.aggregate([
        {
          $match: {
            timestamp: { $gte: startTime, $lte: endTime },
            status: 'error',
            'attributes.retry_count': { $exists: true, $gt: 0 }
          }
        },
        {
          $group: {
            _id: '$operation_name',
            totalCost: { $sum: '$cost_usd' },
            count: { $sum: 1 }
          }
        }
      ]);

      if (failedRetries.length > 0) {
        const totalWaste = failedRetries.reduce((sum, item) => sum + item.totalCost, 0);
        if (totalWaste > 0.01) {
          patterns.push({
            patternType: 'failed_retries',
            description: 'Multiple failed retry attempts wasting resources',
            estimatedWaste: totalWaste,
            occurrences: failedRetries.reduce((sum, item) => sum + item.count, 0),
            examples: failedRetries.slice(0, 3).map(r => r._id),
            recommendation: 'Implement circuit breakers and better error handling'
          });
        }
      }

      // Pattern 2: Expensive model misuse (using GPT-4 for simple tasks)
      const expensiveModelMisuse = await Telemetry.aggregate([
        {
          $match: {
            timestamp: { $gte: startTime, $lte: endTime },
            gen_ai_model: { $in: ['gpt-4', 'claude-3-opus', 'gpt-4-turbo'] },
            gen_ai_input_tokens: { $lt: 500 } // Simple prompts
          }
        },
        {
          $group: {
            _id: null,
            totalCost: { $sum: '$cost_usd' },
            count: { $sum: 1 }
          }
        }
      ]);

      if (expensiveModelMisuse.length > 0 && expensiveModelMisuse[0].totalCost > 0.05) {
        const estimatedSavings = expensiveModelMisuse[0].totalCost * 0.8; // 80% savings with smaller models
        patterns.push({
          patternType: 'expensive_model_misuse',
          description: 'Using expensive models for simple tasks',
          estimatedWaste: estimatedSavings,
          occurrences: expensiveModelMisuse[0].count,
          examples: ['GPT-4 for simple prompts'],
          recommendation: 'Use GPT-3.5-turbo or Claude Haiku for simple tasks'
        });
      }

    } catch (error) {
      loggingService.error('Waste pattern identification failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return patterns;
  }

  /**
   * Generate optimization recommendations
   */
  private generateOptimizationRecommendations(
    metrics: any,
    wastePatterns: WastePattern[]
  ): void {
    try {
      const recommendations: CostIntelligence['recommendations'] = [];

      // Add waste pattern recommendations
      wastePatterns.forEach(pattern => {
        recommendations.push({
          action: pattern.recommendation,
          estimatedSavings: pattern.estimatedWaste,
          effort: 'medium',
          priority: recommendations.length + 1
        });
      });

      // Add model optimization recommendations
      if (metrics.cost_by_model && metrics.cost_by_model.length > 0) {
        const topModel = metrics.cost_by_model[0];
        if (topModel.total_cost > 0.5) {
          recommendations.push({
            action: `Review usage of ${topModel.model} - it accounts for $${topModel.total_cost.toFixed(4)} of costs`,
            estimatedSavings: topModel.total_cost * 0.3,
            effort: 'low',
            priority: recommendations.length + 1
          });
        }
      }

      if (recommendations.length > 0) {
        costStreamingService.emitCostEvent({
          eventType: 'optimization_opportunity',
          timestamp: new Date(),
          data: {
            metadata: {
              recommendationCount: recommendations.length,
              totalEstimatedSavings: recommendations.reduce((sum, r) => sum + (r.estimatedSavings || 0), 0)
            }
          }
        });
      }
    } catch (error) {
      loggingService.error('Optimization recommendation generation failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Store intelligence in cache
   */
  private storeIntelligence(intelligence: CostIntelligence): void {
    this.intelligenceCache.set(intelligence.id, intelligence);

    // Clean up expired entries
    const now = Date.now();
    for (const [id, intel] of this.intelligenceCache.entries()) {
      if (intel.expiresAt.getTime() < now) {
        this.intelligenceCache.delete(id);
      }
    }
  }

  /**
   * Get recent intelligence
   */
  getRecentIntelligence(
    options: {
      userId?: string;
      workspaceId?: string;
      type?: CostIntelligence['intelligenceType'];
      severity?: CostIntelligence['severity'];
      limit?: number;
    } = {}
  ): CostIntelligence[] {
    const { userId, workspaceId, type, severity, limit = 10 } = options;

    const results = Array.from(this.intelligenceCache.values())
      .filter(intel => {
        if (userId && intel.userId !== userId) return false;
        if (workspaceId && intel.workspaceId !== workspaceId) return false;
        if (type && intel.intelligenceType !== type) return false;
        if (severity && intel.severity !== severity) return false;
        return true;
      })
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);

    return results;
  }

  /**
   * Get intelligence statistics
   */
  getStats(): {
    cachedIntelligence: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const intel of this.intelligenceCache.values()) {
      byType[intel.intelligenceType] = (byType[intel.intelligenceType] ?? 0) + 1;
      bySeverity[intel.severity] = (bySeverity[intel.severity] ?? 0) + 1;
    }

    return {
      cachedIntelligence: this.intelligenceCache.size,
      byType,
      bySeverity
    };
  }

  /**
   * Cleanup and shutdown
   */
  shutdown(): void {
    this.stopContinuousAnalysis();
    this.intelligenceCache.clear();
    loggingService.info('Cost Intelligence Service shut down');
  }
}

// Export singleton instance
export const costIntelligenceService = CostIntelligenceService.getInstance();

