import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { LoggingService } from './logging.service';
import * as os from 'os';

export interface SystemLoad {
  cpuUsage: number;
  memoryUsage: number;
  loadAverage: number;
  activeConnections: number;
  responseTime: number;
  errorRate: number;
  timestamp: number;
}

export interface TrafficPattern {
  requestsPerSecond: number;
  peakRequestsPerSecond: number;
  averageResponseTime: number;
  errorRate: number;
  uniqueUsers: number;
  timestamp: number;
  windowSize: number;
}

export interface AdaptiveRateLimitConfig {
  baseLimit: number;
  minLimit: number;
  maxLimit: number;
  scalingFactor: number;
  loadThreshold: {
    cpu: number;
    memory: number;
    responseTime: number;
    errorRate: number;
  };
  adaptationWindow: number;
  predictionWindow: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  currentLimit: number;
  adjustedLimit: number;
  systemLoad: number;
  trafficPressure: number;
  retryAfter?: number;
  reason: string;
}

let adaptiveRateLimitServiceInstance: AdaptiveRateLimitService | null = null;

export function getAdaptiveRateLimitService(): AdaptiveRateLimitService {
  if (!adaptiveRateLimitServiceInstance) {
    throw new Error(
      'AdaptiveRateLimitService not initialized. Ensure CommonModule is imported.',
    );
  }
  return adaptiveRateLimitServiceInstance;
}

/**
 * Adaptive Rate Limiting Service
 * Dynamically adjusts rate limits based on system load, traffic patterns, and performance metrics
 */
@Injectable()
export class AdaptiveRateLimitService implements OnModuleDestroy {
  private readonly logger = new Logger(AdaptiveRateLimitService.name);
  private systemLoadHistory: SystemLoad[] = [];
  private trafficPatternHistory: TrafficPattern[] = [];
  private rateLimitCache = new Map<
    string,
    { limit: number; lastUpdated: number }
  >();
  private readonly MAX_HISTORY_SIZE = 1000;
  private readonly LOAD_COLLECTION_INTERVAL = 5000;
  private readonly ADAPTATION_INTERVAL = 30000;
  private loadCollectionTimer?: NodeJS.Timeout;
  private adaptationTimer?: NodeJS.Timeout;

  private defaultConfig: AdaptiveRateLimitConfig = {
    baseLimit: 100,
    minLimit: 10,
    maxLimit: 1000,
    scalingFactor: 0.8,
    loadThreshold: {
      cpu: 70,
      memory: 80,
      responseTime: 2000,
      errorRate: 5,
    },
    adaptationWindow: 300,
    predictionWindow: 600,
  };

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
  ) {
    adaptiveRateLimitServiceInstance = this;
    this.startSystemMonitoring();
    this.startAdaptationEngine();
  }

  /**
   * Check rate limit with adaptive scaling
   */
  async checkRateLimit(
    key: string,
    config: Partial<AdaptiveRateLimitConfig> = {},
    metadata: {
      userId?: string;
      endpoint?: string;
      priority?: 'high' | 'medium' | 'low';
    } = {},
  ): Promise<RateLimitDecision> {
    const startTime = Date.now();
    const finalConfig = { ...this.defaultConfig, ...config };

    try {
      const currentLoad = await this.getCurrentSystemLoad();
      const trafficPressure = await this.calculateTrafficPressure(key);
      const adaptedLimit = await this.calculateAdaptiveLimit(
        key,
        finalConfig,
        currentLoad,
        trafficPressure,
      );
      const currentUsage = await this.getCurrentUsage(key);
      const allowed = currentUsage < adaptedLimit;

      await this.recordRateLimitDecision(key, {
        allowed,
        currentLimit: finalConfig.baseLimit,
        adjustedLimit: adaptedLimit,
        systemLoad: this.calculateSystemLoadScore(currentLoad),
        trafficPressure,
        timestamp: Date.now(),
        metadata,
      });

      const decision: RateLimitDecision = {
        allowed,
        currentLimit: finalConfig.baseLimit,
        adjustedLimit: adaptedLimit,
        systemLoad: this.calculateSystemLoadScore(currentLoad),
        trafficPressure,
        reason: this.generateDecisionReason(
          allowed,
          currentLoad,
          trafficPressure,
          adaptedLimit,
        ),
      };

      if (!allowed) {
        decision.retryAfter = this.calculateRetryAfter(
          currentLoad,
          trafficPressure,
        );
      }

      this.logger.log(`Adaptive rate limit check completed for ${key}`, {
        decision,
        duration: Date.now() - startTime,
      });

      return decision;
    } catch (error) {
      this.logger.error(`Adaptive rate limit check failed for ${key}`, {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });

      const currentUsage = await this.getCurrentUsage(key);
      return {
        allowed: currentUsage < finalConfig.baseLimit,
        currentLimit: finalConfig.baseLimit,
        adjustedLimit: finalConfig.baseLimit,
        systemLoad: 0,
        trafficPressure: 0,
        reason: 'Fallback due to system error',
      };
    }
  }

  /**
   * Calculate adaptive limit based on system state
   */
  private async calculateAdaptiveLimit(
    key: string,
    config: AdaptiveRateLimitConfig,
    systemLoad: SystemLoad,
    trafficPressure: number,
  ): Promise<number> {
    let adaptiveFactor = 1.0;

    // CPU-based adjustment
    if (systemLoad.cpuUsage > config.loadThreshold.cpu) {
      const cpuPressure =
        (systemLoad.cpuUsage - config.loadThreshold.cpu) /
        (100 - config.loadThreshold.cpu);
      adaptiveFactor *= 1 - cpuPressure * config.scalingFactor;
    }

    // Memory-based adjustment
    if (systemLoad.memoryUsage > config.loadThreshold.memory) {
      const memoryPressure =
        (systemLoad.memoryUsage - config.loadThreshold.memory) /
        (100 - config.loadThreshold.memory);
      adaptiveFactor *= 1 - memoryPressure * config.scalingFactor;
    }

    // Response time-based adjustment
    if (systemLoad.responseTime > config.loadThreshold.responseTime) {
      const responsePressure = Math.min(
        systemLoad.responseTime / config.loadThreshold.responseTime - 1,
        2,
      );
      adaptiveFactor *= 1 - responsePressure * config.scalingFactor * 0.5;
    }

    // Error rate-based adjustment
    if (systemLoad.errorRate > config.loadThreshold.errorRate) {
      const errorPressure =
        (systemLoad.errorRate - config.loadThreshold.errorRate) / 50;
      adaptiveFactor *= 1 - errorPressure * config.scalingFactor;
    }

    adaptiveFactor *= 1 - trafficPressure * 0.3;

    let adaptedLimit = Math.floor(
      config.baseLimit * Math.max(adaptiveFactor, 0.1),
    );
    adaptedLimit = Math.max(
      config.minLimit,
      Math.min(config.maxLimit, adaptedLimit),
    );

    const cachedLimit = this.rateLimitCache.get(key);
    if (cachedLimit && Date.now() - cachedLimit.lastUpdated < 60000) {
      const smoothingFactor = 0.7;
      adaptedLimit = Math.floor(
        adaptedLimit * smoothingFactor +
          cachedLimit.limit * (1 - smoothingFactor),
      );
    }

    this.rateLimitCache.set(key, {
      limit: adaptedLimit,
      lastUpdated: Date.now(),
    });
    return adaptedLimit;
  }

  /**
   * Get current system load metrics
   */
  private async getCurrentSystemLoad(): Promise<SystemLoad> {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();

    const cpuUsage = Math.min((loadAvg[0] / cpus.length) * 100, 100);
    const memoryUsage = (memUsage.rss / totalMem) * 100;
    const responseTime = await this.getAverageResponseTime();
    const errorRate = await this.getRecentErrorRate();
    const activeConnections = await this.getActiveConnectionCount();

    return {
      cpuUsage,
      memoryUsage,
      loadAverage: loadAvg[0],
      activeConnections,
      responseTime,
      errorRate,
      timestamp: Date.now(),
    };
  }

  /**
   * Calculate traffic pressure for a given key
   */
  private async calculateTrafficPressure(key: string): Promise<number> {
    try {
      const recentPattern = await this.getRecentTrafficPattern(key);
      if (!recentPattern) return 0;

      let pressure = 0;

      const historicalAvg = await this.getHistoricalAverageRPS(key);
      if (historicalAvg > 0) {
        const rpsRatio = recentPattern.requestsPerSecond / historicalAvg;
        pressure += Math.min((rpsRatio - 1) * 0.5, 1);
      }

      const historicalResponseTime =
        await this.getHistoricalAverageResponseTime(key);
      if (historicalResponseTime > 0) {
        const responseRatio =
          recentPattern.averageResponseTime / historicalResponseTime;
        pressure += Math.min((responseRatio - 1) * 0.3, 0.5);
      }

      const historicalErrorRate = await this.getHistoricalAverageErrorRate(key);
      if (recentPattern.errorRate > historicalErrorRate + 1) {
        pressure += Math.min(
          (recentPattern.errorRate - historicalErrorRate) / 10,
          0.3,
        );
      }

      return Math.min(pressure, 1);
    } catch (error) {
      this.logger.warn(`Failed to calculate traffic pressure for ${key}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Get current usage for a key
   */
  private async getCurrentUsage(key: string): Promise<number> {
    try {
      const cacheKey = `adaptive_rate_limit:${key}`;
      const usage = await this.cacheService.get(cacheKey);
      return usage ? (usage as any).count || 0 : 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Record rate limit decision for analytics
   */
  private async recordRateLimitDecision(
    key: string,
    decision: any,
  ): Promise<void> {
    try {
      const analyticsKey = `rate_limit_analytics:${key}`;
      const analytics = (await this.cacheService.get(analyticsKey)) || {
        decisions: [],
      };

      (analytics as any).decisions.push(decision);

      if ((analytics as any).decisions.length > 100) {
        (analytics as any).decisions = (analytics as any).decisions.slice(-100);
      }

      await this.cacheService.set(analyticsKey, analytics, 3600);
    } catch (error) {
      this.logger.debug(`Failed to record rate limit analytics for ${key}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Start system monitoring
   */
  private startSystemMonitoring(): void {
    this.loadCollectionTimer = setInterval(async () => {
      try {
        const systemLoad = await this.getCurrentSystemLoad();
        this.systemLoadHistory.push(systemLoad);

        if (this.systemLoadHistory.length > this.MAX_HISTORY_SIZE) {
          this.systemLoadHistory = this.systemLoadHistory.slice(
            -this.MAX_HISTORY_SIZE,
          );
        }

        await this.cacheService.set('system_load_current', systemLoad, 30);
      } catch (error) {
        this.logger.warn('System load collection failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.LOAD_COLLECTION_INTERVAL);
  }

  /**
   * Start adaptation engine
   */
  private startAdaptationEngine(): void {
    this.adaptationTimer = setInterval(async () => {
      try {
        await this.performAdaptation();
      } catch (error) {
        this.logger.error('Adaptation engine failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, this.ADAPTATION_INTERVAL);
  }

  /**
   * Perform system-wide rate limit adaptation
   */
  private async performAdaptation(): Promise<void> {
    const systemTrend = this.analyzeSystemTrend();
    const trafficTrend = await this.analyzeTrafficTrend();
    const predictedLoad = this.predictFutureLoad();

    if (predictedLoad > 0.8) {
      this.logger.log('High load predicted, preparing adaptive measures', {
        predictedLoad,
        systemTrend,
        trafficTrend,
      });

      await this.prepareForHighLoad();
    }
  }

  // Helper methods
  private calculateSystemLoadScore(load: SystemLoad): number {
    return (
      (load.cpuUsage +
        load.memoryUsage +
        Math.min(load.responseTime / 100, 100)) /
      3
    );
  }

  private generateDecisionReason(
    allowed: boolean,
    load: SystemLoad,
    pressure: number,
    limit: number,
  ): string {
    if (allowed) {
      return `Request allowed. Adaptive limit: ${limit}`;
    }

    const reasons = [];
    if (load.cpuUsage > 70)
      reasons.push(`high CPU (${load.cpuUsage.toFixed(1)}%)`);
    if (load.memoryUsage > 80)
      reasons.push(`high memory (${load.memoryUsage.toFixed(1)}%)`);
    if (pressure > 0.5)
      reasons.push(`high traffic pressure (${(pressure * 100).toFixed(1)}%)`);

    return `Request denied due to ${reasons.length ? reasons.join(', ') : 'rate limit exceeded'}. Adaptive limit: ${limit}`;
  }

  private calculateRetryAfter(load: SystemLoad, pressure: number): number {
    let retryAfter = 60;
    const loadFactor = this.calculateSystemLoadScore(load) / 100;
    retryAfter += Math.floor(loadFactor * 120);
    retryAfter += Math.floor(pressure * 60);
    return Math.min(retryAfter, 300);
  }

  // Dynamic methods integrated with actual system telemetry
  private async getAverageResponseTime(): Promise<number> {
    try {
      const telemetryData = await this.cacheService.get(
        'telemetry_performance_metrics',
      );
      if (telemetryData) {
        const metrics = telemetryData as any;
        return metrics.averageResponseTime || 500;
      }

      const recentRequests = await this.cacheService.get(
        'recent_request_metrics',
      );
      if (recentRequests) {
        const requests = recentRequests as any[];
        const responseTimes = requests
          .filter(
            (req) => req.responseTime && Date.now() - req.timestamp < 300000,
          )
          .map((req) => req.responseTime);

        if (responseTimes.length > 0) {
          return (
            responseTimes.reduce((sum, time) => sum + time, 0) /
            responseTimes.length
          );
        }
      }

      return 500;
    } catch {
      return 500;
    }
  }

  private async getRecentErrorRate(): Promise<number> {
    try {
      const errorMetrics = await this.cacheService.get('error_rate_metrics');
      if (errorMetrics) {
        return (errorMetrics as any).rate || 0;
      }

      const recentRequests = await this.cacheService.get(
        'recent_request_metrics',
      );
      if (recentRequests) {
        const requests = recentRequests as any[];
        const recentReqs = requests.filter(
          (req) => Date.now() - req.timestamp < 300000,
        );
        const errorReqs = recentReqs.filter((req) => req.statusCode >= 400);

        return recentReqs.length > 0
          ? (errorReqs.length / recentReqs.length) * 100
          : 0;
      }

      return 0;
    } catch {
      return 0;
    }
  }

  private async getActiveConnectionCount(): Promise<number> {
    try {
      const connectionMetrics = await this.cacheService.get(
        'connection_pool_metrics',
      );
      if (connectionMetrics) {
        return (connectionMetrics as any).active || 0;
      }

      const activeKeys = await this.getActiveRateLimitKeys();
      return activeKeys.length;
    } catch {
      return 0;
    }
  }

  private async getActiveRateLimitKeys(): Promise<string[]> {
    try {
      const activeKeys =
        (await this.cacheService.get('active_rate_limit_keys')) || [];
      return activeKeys as string[];
    } catch {
      return [];
    }
  }

  private async getRecentTrafficPattern(
    key: string,
  ): Promise<TrafficPattern | null> {
    try {
      const pattern = await this.cacheService.get(`traffic_pattern:${key}`);
      if (pattern) return pattern as TrafficPattern;

      const rateLimitRecord = await this.cacheService.get(
        `adaptive_rate_limit:${key}`,
      );
      if (rateLimitRecord) {
        const record = rateLimitRecord as any;
        return {
          requestsPerSecond: record.count || 0,
          peakRequestsPerSecond: record.peakCount || 0,
          averageResponseTime: 500,
          errorRate: 0,
          uniqueUsers: 1,
          timestamp: Date.now(),
          windowSize: 60,
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  private async getHistoricalAverageRPS(key: string): Promise<number> {
    try {
      const historical = await this.cacheService.get(`historical_rps:${key}`);
      if (historical) return (historical as any).average || 1;

      const usageHistory = await this.cacheService.get(
        `rate_limit_usage_history:${key}`,
      );
      if (usageHistory) {
        const history = usageHistory as any[];
        const avgUsage =
          history.reduce((sum, usage) => sum + (usage.count || 0), 0) /
          history.length;
        return Math.max(1, avgUsage / 60);
      }

      return 1;
    } catch {
      return 1;
    }
  }

  private async getHistoricalAverageResponseTime(key: string): Promise<number> {
    try {
      const historical = await this.cacheService.get(
        `historical_response_time:${key}`,
      );
      if (historical) return (historical as any).average || 500;

      const telemetryData = await this.cacheService.get(
        'telemetry_performance_metrics',
      );
      if (telemetryData) {
        return (telemetryData as any).averageResponseTime || 500;
      }

      return 500;
    } catch {
      return 500;
    }
  }

  private async getHistoricalAverageErrorRate(key: string): Promise<number> {
    try {
      const historical = await this.cacheService.get(
        `historical_error_rate:${key}`,
      );
      if (historical) return (historical as any).average || 0;

      const requestHistory = await this.cacheService.get(
        `request_history:${key}`,
      );
      if (requestHistory) {
        const history = requestHistory as any[];
        const errorRequests = history.filter((req) => req.statusCode >= 400);
        return history.length > 0
          ? (errorRequests.length / history.length) * 100
          : 0;
      }

      return 0;
    } catch {
      return 0;
    }
  }

  private analyzeSystemTrend(): 'improving' | 'stable' | 'degrading' {
    if (this.systemLoadHistory.length < 10) return 'stable';

    const recent = this.systemLoadHistory.slice(-10);
    const older = this.systemLoadHistory.slice(-20, -10);

    const recentAvg =
      recent.reduce(
        (sum, load) => sum + this.calculateSystemLoadScore(load),
        0,
      ) / recent.length;
    const olderAvg =
      older.reduce(
        (sum, load) => sum + this.calculateSystemLoadScore(load),
        0,
      ) / older.length;

    const difference = recentAvg - olderAvg;

    if (difference > 5) return 'degrading';
    if (difference < -5) return 'improving';
    return 'stable';
  }

  private async analyzeTrafficTrend(): Promise<
    'increasing' | 'stable' | 'decreasing'
  > {
    return 'stable';
  }

  private predictFutureLoad(): number {
    if (this.systemLoadHistory.length < 5) return 0.5;

    const recent = this.systemLoadHistory.slice(-5);
    const loads = recent.map(
      (load) => this.calculateSystemLoadScore(load) / 100,
    );

    const n = loads.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = loads.reduce((sum, load) => sum + load, 0);
    const sumXY = loads.reduce((sum, load, index) => sum + index * load, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const predictedLoad = intercept + slope * n;
    return Math.max(0, Math.min(1, predictedLoad));
  }

  private async prepareForHighLoad(): Promise<void> {
    await this.cacheService.set('system_high_load_predicted', true, 300);

    this.logger.warn('System preparing for predicted high load', {
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get adaptive rate limiting statistics
   */
  async getStatistics(): Promise<{
    systemLoad: SystemLoad;
    activeLimits: number;
    adaptationRate: number;
    averageAdjustment: number;
  }> {
    const systemLoad = await this.getCurrentSystemLoad();
    const activeLimits = this.rateLimitCache.size;

    const recentAdjustments = Array.from(this.rateLimitCache.values()).filter(
      (entry) => Date.now() - entry.lastUpdated < 300000,
    ).length;
    const adaptationRate =
      activeLimits > 0 ? recentAdjustments / activeLimits : 0;

    const adjustments = Array.from(this.rateLimitCache.values()).map(
      (entry) => entry.limit,
    );
    const averageAdjustment =
      adjustments.length > 0
        ? adjustments.reduce((sum, limit) => sum + limit, 0) /
          adjustments.length
        : this.defaultConfig.baseLimit;

    return {
      systemLoad,
      activeLimits,
      adaptationRate,
      averageAdjustment,
    };
  }

  /**
   * Cleanup resources
   */
  onModuleDestroy(): void {
    if (this.loadCollectionTimer) {
      clearInterval(this.loadCollectionTimer);
      this.loadCollectionTimer = undefined;
    }

    if (this.adaptationTimer) {
      clearInterval(this.adaptationTimer);
      this.adaptationTimer = undefined;
    }

    this.systemLoadHistory = [];
    this.trafficPatternHistory = [];
    this.rateLimitCache.clear();
  }
}
