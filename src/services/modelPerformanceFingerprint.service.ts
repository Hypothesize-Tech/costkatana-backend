import { 
  ModelPerformanceFingerprint, 
  IModelPerformanceFingerprint,
  WindowMetrics,
  PercentileStats,
  CapabilityPerformance,
  PerformanceTrend
} from '../models/ModelPerformanceFingerprint';
import { Telemetry } from '../models/Telemetry';
import { Usage } from '../models/Usage';
import { AILog } from '../models/AILog';
import { loggingService } from './logging.service';

/**
 * Model Performance Fingerprint Service
 * Aggregates real-world performance data from telemetry, usage, and AI logs
 */
export class ModelPerformanceFingerprintService {
  private static readonly SMOOTHING_FACTOR = 0.2; // EMA smoothing factor
  private static readonly MIN_SAMPLE_SIZE = 10; // Minimum samples for reliable metrics

  /**
   * Update performance fingerprint for a specific model
   */
  static async updateModelFingerprint(modelId: string, provider: string): Promise<IModelPerformanceFingerprint> {
    try {
      const now = new Date();
      
      // Calculate window boundaries
      const windows = {
        '24h': new Date(now.getTime() - 24 * 60 * 60 * 1000),
        '7d': new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        '30d': new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        'lifetime': new Date(0)
      };

      // Aggregate metrics for each window
      const window24h = await this.aggregateWindowMetrics(modelId, windows['24h'], now);
      const window7d = await this.aggregateWindowMetrics(modelId, windows['7d'], now);
      const window30d = await this.aggregateWindowMetrics(modelId, windows['30d'], now);
      const lifetime = await this.aggregateWindowMetrics(modelId, windows['lifetime'], now);

      // Calculate capability-specific performance
      const capabilities = await this.calculateCapabilityPerformance(modelId, windows['30d'], now);

      // Calculate performance trends
      const trends = await this.calculatePerformanceTrends(modelId);

      // Calculate routing weight with smoothing
      const routingWeight = await this.calculateRoutingWeight(window24h, window7d);

      // Get or create fingerprint
      let fingerprint = await ModelPerformanceFingerprint.findOne({ modelId });
      
      if (!fingerprint) {
        fingerprint = new ModelPerformanceFingerprint({
          modelId,
          provider,
          modelName: modelId,
          window24h,
          window7d,
          window30d,
          lifetime,
          capabilities,
          trends,
          routingWeight,
          confidenceScore: this.calculateConfidence(window24h.totalRequests),
          dataCompleteness: this.calculateDataCompleteness(window24h),
          lastAggregationRun: now,
          nextScheduledUpdate: new Date(now.getTime() + 3600000) // 1 hour
        });
      } else {
        // Apply EMA smoothing to routing weight
        const newWeight = this.calculateRoutingWeight(window24h, window7d);
        fingerprint.routingWeight = this.applyEMASmoothing(
          fingerprint.routingWeight,
          newWeight,
          this.SMOOTHING_FACTOR
        );

        // Update all metrics
        fingerprint.window24h = window24h;
        fingerprint.window7d = window7d;
        fingerprint.window30d = window30d;
        fingerprint.lifetime = lifetime;
        fingerprint.capabilities = capabilities;
        fingerprint.trends = trends;
        fingerprint.confidenceScore = this.calculateConfidence(window24h.totalRequests);
        fingerprint.dataCompleteness = this.calculateDataCompleteness(window24h);
        fingerprint.lastAggregationRun = now;
        fingerprint.nextScheduledUpdate = new Date(now.getTime() + 3600000);
      }

      await fingerprint.save();

      loggingService.info('✅ Updated model performance fingerprint', {
        modelId,
        routingWeight: fingerprint.routingWeight.toFixed(3),
        requests24h: window24h.totalRequests,
        failureRate: (window24h.failureRate * 100).toFixed(1) + '%'
      });

      return fingerprint;
    } catch (error) {
      loggingService.error('❌ Failed to update model fingerprint', {
        modelId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Aggregate metrics for a specific time window
   */
  private static async aggregateWindowMetrics(
    modelId: string,
    windowStart: Date,
    windowEnd: Date
  ): Promise<WindowMetrics> {
    try {
      // Query telemetry data
      const telemetryData = await Telemetry.find({
        gen_ai_model: modelId,
        timestamp: { $gte: windowStart, $lte: windowEnd }
      }).lean();

      // Query usage data (fallback if telemetry is sparse)
      const usageData = await Usage.find({
        model: modelId,
        createdAt: { $gte: windowStart, $lte: windowEnd }
      }).lean();

      // Query AI logs for additional context
      const aiLogs = await AILog.find({
        aiModel: modelId,
        timestamp: { $gte: windowStart, $lte: windowEnd }
      }).lean();

      // Combine all data sources
      const allRequests = [
        ...telemetryData.map(t => ({
          latency: t.duration_ms ?? 0,
          success: t.status === 'success',
          inputTokens: t.prompt_tokens ?? 0,
          outputTokens: t.completion_tokens ?? 0,
          cost: t.cost_usd ?? 0,
          cacheHit: (t.attributes as Record<string, unknown>)?.cacheHit === true
        })),
        ...usageData.map(u => ({
          latency: u.responseTime,
          success: !u.errorOccurred,
          inputTokens: u.promptTokens,
          outputTokens: u.completionTokens,
          cost: u.cost,
          cacheHit: (u.metadata as Record<string, unknown>)?.cacheHit === true
        })),
        ...aiLogs.map(l => ({
          latency: l.responseTime,
          success: l.success ?? false,
          inputTokens: l.inputTokens ?? 0,
          outputTokens: l.outputTokens ?? 0,
          cost: l.cost ?? 0,
          cacheHit: l.cacheHit ?? false
        }))
      ];

      const totalRequests = allRequests.length;
      const successfulRequests = allRequests.filter(r => r.success).length;
      const failedRequests = totalRequests - successfulRequests;

      // Calculate latency percentiles
      const latencies = allRequests.map(r => r.latency).filter(l => l > 0).sort((a, b) => a - b);
      const latency: PercentileStats = {
        p50: latencies.length > 0 ? this.calculatePercentile(latencies, 0.5) : 0,
        p90: latencies.length > 0 ? this.calculatePercentile(latencies, 0.9) : 0,
        p95: latencies.length > 0 ? this.calculatePercentile(latencies, 0.95) : 0,
        p99: latencies.length > 0 ? this.calculatePercentile(latencies, 0.99) : 0
      };

      // Calculate token statistics
      const totalInputTokens = allRequests.reduce((sum, r) => sum + r.inputTokens, 0);
      const totalOutputTokens = allRequests.reduce((sum, r) => sum + r.outputTokens, 0);
      const totalTokens = totalInputTokens + totalOutputTokens;

      // Calculate cost statistics
      const totalCost = allRequests.reduce((sum, r) => sum + r.cost, 0);
      const avgCostPerRequest = totalRequests > 0 ? totalCost / totalRequests : 0;
      const costPer1KTokens = totalTokens > 0 ? (totalCost / totalTokens) * 1000 : 0;

      // Calculate cache statistics
      const cacheHits = allRequests.filter(r => r.cacheHit).length;
      const cacheHitRate = totalRequests > 0 ? cacheHits / totalRequests : 0;
      
      // Estimate cache benefit (cost of requests that would have been made)
      const avgCostWithoutCache = avgCostPerRequest;
      const avgCacheHitBenefit = cacheHits > 0 ? avgCostWithoutCache * 0.9 : 0; // Assume 90% savings

      return {
        latency,
        totalRequests,
        successfulRequests,
        failedRequests,
        failureRate: totalRequests > 0 ? failedRequests / totalRequests : 0,
        avgInputTokens: totalRequests > 0 ? totalInputTokens / totalRequests : 0,
        avgOutputTokens: totalRequests > 0 ? totalOutputTokens / totalRequests : 0,
        totalTokens,
        totalCost,
        avgCostPerRequest,
        costPer1KTokens,
        cacheHitRate,
        avgCacheHitBenefit,
        windowStart,
        windowEnd,
        lastUpdated: new Date()
      };
    } catch (error) {
      loggingService.error('Failed to aggregate window metrics', {
        modelId,
        error: error instanceof Error ? error.message : String(error)
      });
      
      // Return empty metrics on error
      return this.getEmptyWindowMetrics(windowStart, windowEnd);
    }
  }

  /**
   * Calculate capability-specific performance
   */
  private static async calculateCapabilityPerformance(
    modelId: string,
    windowStart: Date,
    windowEnd: Date
  ): Promise<CapabilityPerformance[]> {
    try {
      // Query usage data with tags that indicate capability
      const usageData = await Usage.find({
        model: modelId,
        createdAt: { $gte: windowStart, $lte: windowEnd },
        tags: { $exists: true, $ne: [] }
      }).lean();

      // Group by capability (inferred from tags)
      const capabilityMap = new Map<string, { 
        costs: number[], 
        quality: number[], 
        count: number 
      }>();

      for (const usage of usageData) {
        // Infer capability from tags or metadata
        const capability = this.inferCapability(usage.tags, usage.metadata);
        
        if (!capabilityMap.has(capability)) {
          capabilityMap.set(capability, { costs: [], quality: [], count: 0 });
        }
        
        const capData = capabilityMap.get(capability)!;
        capData.costs.push(usage.cost);
        capData.count++;
        
        // If user provided rating, use it for quality
        if (usage.metadata?.userRating) {
          capData.quality.push(usage.metadata.userRating / 5); // Normalize to 0-1
        }
      }

      // Calculate performance scores for each capability
      const capabilities: CapabilityPerformance[] = [];
      
      for (const [capability, data] of capabilityMap) {
        if (data.count < this.MIN_SAMPLE_SIZE) continue;

        const avgCost = data.costs.reduce((a, b) => a + b, 0) / data.costs.length;
        const avgQuality = data.quality.length > 0
          ? data.quality.reduce((a, b) => a + b, 0) / data.quality.length
          : 0.5;

        // Cost efficiency: normalize by comparing to typical cost range
        const costEfficiency = Math.max(0, Math.min(1, 1 - (avgCost / 0.01))); // Assume $0.01 as high cost

        // Performance score: weighted combination
        const performanceScore = (costEfficiency * 0.4) + (avgQuality * 0.6);

        capabilities.push({
          capability,
          performanceScore,
          costEfficiency,
          qualityScore: avgQuality,
          sampleSize: data.count
        });
      }

      return capabilities;
    } catch (error) {
      loggingService.error('Failed to calculate capability performance', {
        modelId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Calculate performance trends by comparing windows
   */
  private static async calculatePerformanceTrends(modelId: string): Promise<PerformanceTrend[]> {
    try {
      const fingerprint = await ModelPerformanceFingerprint.findOne({ modelId });
      if (!fingerprint) return [];

      const trends: PerformanceTrend[] = [];

      // Compare 24h vs 7d for recent trends
      const latencyChange = this.calculatePercentageChange(
        fingerprint.window24h.latency.p50,
        fingerprint.window7d.latency.p50
      );
      trends.push({
        metric: 'latency',
        direction: this.getTrendDirection(latencyChange),
        percentageChange: latencyChange,
        confidence: this.calculateConfidence(fingerprint.window24h.totalRequests)
      });

      const costChange = this.calculatePercentageChange(
        fingerprint.window24h.costPer1KTokens,
        fingerprint.window7d.costPer1KTokens
      );
      trends.push({
        metric: 'cost',
        direction: this.getTrendDirection(costChange),
        percentageChange: costChange,
        confidence: this.calculateConfidence(fingerprint.window24h.totalRequests)
      });

      const failureRateChange = this.calculatePercentageChange(
        fingerprint.window24h.failureRate,
        fingerprint.window7d.failureRate
      );
      trends.push({
        metric: 'failure_rate',
        direction: this.getTrendDirection(failureRateChange),
        percentageChange: failureRateChange,
        confidence: this.calculateConfidence(fingerprint.window24h.totalRequests)
      });

      return trends;
    } catch (error) {
      loggingService.error('Failed to calculate performance trends', {
        modelId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Calculate routing weight based on performance metrics
   */
  private static calculateRoutingWeight(window24h: WindowMetrics, window7d: WindowMetrics): number {
    // Weighted scoring:
    // - Low latency: 25%
    // - Low cost: 25%
    // - Low failure rate: 30%
    // - High cache hit rate: 20%
    // Use both 24h and 7d windows for some smoothing

    // Latency (lower is better, normalize to 10s max)
    const avgLatencyP50 = (window24h.latency.p50 + window7d.latency.p50) / 2;
    const latencyScore = 1 - Math.min(1, avgLatencyP50 / 10000);

    // Cost (lower is better, normalize to $0.01/1K tokens max)
    const avgCostPer1KTokens = (window24h.costPer1KTokens + window7d.costPer1KTokens) / 2;
    const costScore = 1 - Math.min(1, avgCostPer1KTokens / 0.01);

    // Failure rate (lower is better)
    const avgFailureRate = (window24h.failureRate + window7d.failureRate) / 2;
    const reliabilityScore = 1 - avgFailureRate;

    // Cache hit rate (higher is better)
    const avgCacheHitRate = (window24h.cacheHitRate + window7d.cacheHitRate) / 2;
    const cacheScore = avgCacheHitRate;

    const weight = (
      latencyScore * 0.25 +
      costScore * 0.25 +
      reliabilityScore * 0.30 +
      cacheScore * 0.20
    );

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, weight));
  }

  /**
   * Apply exponential moving average smoothing
   */
  private static applyEMASmoothing(oldValue: number, newValue: number, alpha: number): number {
    return alpha * newValue + (1 - alpha) * oldValue;
  }

  /**
   * Calculate statistical confidence based on sample size
   */
  private static calculateConfidence(sampleSize: number): number {
    // Confidence increases logarithmically with sample size
    if (sampleSize < this.MIN_SAMPLE_SIZE) return 0;
    if (sampleSize >= 1000) return 1;
    
    return Math.min(1, Math.log10(sampleSize) / Math.log10(1000));
  }

  /**
   * Calculate data completeness score
   */
  private static calculateDataCompleteness(metrics: WindowMetrics): number {
    const checks = [
      metrics.totalRequests > 0,
      metrics.latency.p50 > 0,
      metrics.totalCost > 0,
      metrics.avgInputTokens > 0,
      metrics.avgOutputTokens > 0
    ];
    
    const completedChecks = checks.filter(c => c).length;
    return completedChecks / checks.length;
  }

  /**
   * Calculate percentile from sorted array
   */
  private static calculatePercentile(sorted: number[], percentile: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Calculate percentage change between two values
   */
  private static calculatePercentageChange(current: number, previous: number): number {
    if (previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  }

  /**
   * Determine trend direction from percentage change
   */
  private static getTrendDirection(percentageChange: number): 'improving' | 'degrading' | 'stable' {
    if (Math.abs(percentageChange) < 5) return 'stable';
    return percentageChange < 0 ? 'improving' : 'degrading';
  }

  /**
   * Infer capability from tags and metadata
   */
  private static inferCapability(tags: string[], metadata: Record<string, unknown>): string {
    // Check tags first
    const capabilityTags = ['code', 'chat', 'summarization', 'translation', 'analysis', 'creative'];
    for (const tag of tags) {
      const lowerTag = tag.toLowerCase();
      for (const cap of capabilityTags) {
        if (lowerTag.includes(cap)) return cap;
      }
    }

    // Check metadata
    if (metadata?.capability && typeof metadata.capability === 'string') return metadata.capability;
    if (metadata?.templateCategory && typeof metadata.templateCategory === 'string') return metadata.templateCategory;

    return 'general';
  }

  /**
   * Get empty window metrics (fallback)
   */
  private static getEmptyWindowMetrics(windowStart: Date, windowEnd: Date): WindowMetrics {
    return {
      latency: { p50: 0, p90: 0, p95: 0, p99: 0 },
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      failureRate: 0,
      avgInputTokens: 0,
      avgOutputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      avgCostPerRequest: 0,
      costPer1KTokens: 0,
      cacheHitRate: 0,
      avgCacheHitBenefit: 0,
      windowStart,
      windowEnd,
      lastUpdated: new Date()
    };
  }

  /**
   * Query best models for a capability with cost and quality constraints
   */
  static async queryBestModels(params: {
    capability?: string;
    maxCostPer1KTokens?: number;
    minQualityScore?: number;
    maxLatencyMs?: number;
    minRoutingWeight?: number;
    limit?: number;
  }): Promise<IModelPerformanceFingerprint[]> {
    try {
      const query: any = { isActive: true };

      if (params.capability) {
        query['capabilities.capability'] = params.capability;
      }

      if (params.minRoutingWeight !== undefined) {
        query.routingWeight = { $gte: params.minRoutingWeight };
      }

      const models = await ModelPerformanceFingerprint.find(query)
        .sort({ routingWeight: -1, 'window24h.costPer1KTokens': 1 })
        .limit(params.limit || 10)
        .lean();

      // Apply additional filters
      return models.filter((model: any) => {
        if (params.maxCostPer1KTokens && model.window24h.costPer1KTokens > params.maxCostPer1KTokens) {
          return false;
        }
        
        if (params.maxLatencyMs && model.window24h.latency.p50 > params.maxLatencyMs) {
          return false;
        }

        if (params.capability && params.minQualityScore) {
          const capPerf = model.capabilities.find((c: any) => c.capability === params.capability);
          if (!capPerf || capPerf.qualityScore < params.minQualityScore) {
            return false;
          }
        }

        return true;
      }) as unknown as IModelPerformanceFingerprint[];
    } catch (error) {
      loggingService.error('Failed to query best models', {
        params,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Get performance trend for a specific model and metric
   */
  static async getPerformanceTrend(
    modelId: string,
    metric: 'latency' | 'cost' | 'failure_rate' | 'quality'
  ): Promise<PerformanceTrend | null> {
    try {
      const fingerprint = await ModelPerformanceFingerprint.findOne({ modelId });
      if (!fingerprint) return null;

      return fingerprint.trends.find(t => t.metric === metric) || null;
    } catch (error) {
      loggingService.error('Failed to get performance trend', {
        modelId,
        metric,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Bulk update all active models
   */
  static async updateAllModels(): Promise<void> {
    try {
      loggingService.info('🔄 Starting bulk model performance update...');

      // Get distinct models from telemetry
      const models = await Telemetry.distinct('gen_ai_model');
      
      loggingService.info(`Found ${models.length} models to update`);

      let updated = 0;
      let failed = 0;

      for (const modelId of models) {
        if (!modelId) continue;

        try {
          // Infer provider from model ID
          const provider = this.inferProvider(modelId);
          await this.updateModelFingerprint(modelId, provider);
          updated++;
        } catch (error) {
          failed++;
          loggingService.warn(`Failed to update model ${modelId}`, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      loggingService.info('✅ Completed bulk model performance update', {
        updated,
        failed,
        total: models.length
      });
    } catch (error) {
      loggingService.error('❌ Bulk update failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Infer provider from model ID
   */
  private static inferProvider(modelId: string): string {
    const lower = modelId.toLowerCase();
    
    if (lower.includes('gpt') || lower.includes('openai')) return 'openai';
    if (lower.includes('claude') || lower.includes('anthropic')) return 'anthropic';
    if (lower.includes('gemini') || lower.includes('palm')) return 'google';
    if (lower.includes('bedrock') || lower.includes('titan') || lower.includes('nova')) return 'aws-bedrock';
    if (lower.includes('mistral')) return 'mistral';
    if (lower.includes('cohere')) return 'cohere';
    if (lower.includes('llama') || lower.includes('meta')) return 'meta';
    
    return 'unknown';
  }
}

