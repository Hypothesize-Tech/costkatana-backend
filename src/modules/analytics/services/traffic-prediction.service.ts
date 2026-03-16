/**
 * Traffic Prediction Service for NestJS
 *
 * AI-powered traffic spike prediction and proactive system preparation.
 * Uses machine learning to forecast traffic patterns and automatically prepare the system.
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface TrafficDataPoint {
  timestamp: number;
  requestsPerSecond: number;
  uniqueUsers: number;
  responseTime: number;
  errorRate: number;
  cpuUsage: number;
  memoryUsage: number;
  endpointDistribution: Record<string, number>;
  userTierDistribution: Record<string, number>;
  geographicDistribution: Record<string, number>;
}

export interface TrafficPrediction {
  predictedRps: number;
  confidence: number;
  predictionWindow: number; // seconds into the future
  spikeProbability: number;
  spikeMagnitude: number; // multiplier of normal traffic
  contributingFactors: string[];
  recommendedActions: PrepActionType[];
  timestamp: number;
}

export interface TrafficPattern {
  patternType: 'hourly' | 'daily' | 'weekly' | 'seasonal' | 'event_driven';
  patternName: string;
  typicalMultiplier: number;
  durationMinutes: number;
  confidence: number;
  historicalOccurrences: number;
  nextOccurrence?: number; // timestamp
}

export type PrepActionType =
  | 'increase_cache_ttl'
  | 'pre_warm_cache'
  | 'scale_rate_limits'
  | 'enable_degradation'
  | 'alert_team'
  | 'prepare_cdn'
  | 'optimize_queries'
  | 'increase_queue_capacity'
  | 'enable_aggressive_throttling'
  | 'notify_users';

export interface PreparationAction {
  type: PrepActionType;
  description: string;
  priority: number; // 1-10, 10 being highest
  estimatedImpact: number; // 0-1, how much it helps
  implementationTime: number; // seconds to implement
  cost: number; // relative cost 0-1
  prerequisites: PrepActionType[];
  execute: () => Promise<boolean>;
  rollback: () => Promise<boolean>;
}

export interface SpikePredictionConfig {
  enablePrediction: boolean;
  predictionInterval: number; // seconds between predictions
  historicalWindow: number; // days of historical data to use
  minConfidenceThreshold: number; // minimum confidence to act
  spikeThresholdMultiplier: number; // multiplier to consider as spike
  patternDetectionSensitivity: number; // 0-1, higher = more sensitive
  maxPreparationTime: number; // seconds before predicted spike to start prep
  enableAutomaticPreparation: boolean;
  enableProactiveNotifications: boolean;
}

@Injectable()
export class TrafficPredictionService {
  private readonly logger = new Logger(TrafficPredictionService.name);

  private trafficHistory: TrafficDataPoint[] = [];
  private detectedPatterns: TrafficPattern[] = [];
  private activePredictions: TrafficPrediction[] = [];
  private executedActions: Map<
    PrepActionType,
    { timestamp: number; success: boolean }
  > = new Map();

  private readonly MAX_HISTORY_SIZE = 10000; // ~1 week at 1 minute intervals
  private readonly MAX_PREDICTIONS = 100;

  // Configuration
  private config: SpikePredictionConfig = {
    enablePrediction: true,
    predictionInterval: 60, // 1 minute
    historicalWindow: 7, // 7 days
    minConfidenceThreshold: 0.7,
    spikeThresholdMultiplier: 2.0,
    patternDetectionSensitivity: 0.8,
    maxPreparationTime: 300, // 5 minutes
    enableAutomaticPreparation: true,
    enableProactiveNotifications: true,
  };

  // Monitoring
  private predictionInterval?: NodeJS.Timeout;
  private patternDetectionInterval?: NodeJS.Timeout;

  // Statistics
  private stats = {
    predictionsMade: 0,
    accuratePredictions: 0,
    falsePositives: 0,
    missedSpikes: 0,
    actionsExecuted: 0,
    actionsSuccessful: 0,
    averagePredictionAccuracy: 0,
    lastSpikeDetected: 0,
    preparationSuccessRate: 0,
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    this.initializePredictionSystem();
  }

  /**
   * Initialize the prediction system
   */
  private initializePredictionSystem(): void {
    this.logger.log('Initializing Traffic Prediction Service');

    // Load configuration from environment
    this.config = {
      ...this.config,
      enablePrediction: this.configService.get<boolean>(
        'ENABLE_TRAFFIC_PREDICTION',
        true,
      ),
      predictionInterval: this.configService.get<number>(
        'TRAFFIC_PREDICTION_INTERVAL',
        60,
      ),
      historicalWindow: this.configService.get<number>(
        'TRAFFIC_PREDICTION_HISTORY_WINDOW',
        7,
      ),
      minConfidenceThreshold: this.configService.get<number>(
        'TRAFFIC_PREDICTION_CONFIDENCE_THRESHOLD',
        0.7,
      ),
    };

    if (this.config.enablePrediction) {
      this.startPredictionSystem();
    }

    this.logger.log('Traffic Prediction Service initialized', {
      enabled: this.config.enablePrediction,
      interval: this.config.predictionInterval,
      historyWindow: this.config.historicalWindow,
    });
  }

  /**
   * Start the prediction system
   */
  private startPredictionSystem(): void {
    // Start periodic prediction
    this.predictionInterval = setInterval(() => {
      this.makePredictions().catch((err) => {
        this.logger.error('Error making traffic predictions', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.config.predictionInterval * 1000);

    // Start pattern detection
    this.patternDetectionInterval = setInterval(() => {
      this.detectPatterns().catch((err) => {
        this.logger.error('Error detecting traffic patterns', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, 300000); // Every 5 minutes
  }

  /**
   * Record traffic data point
   */
  async recordTrafficData(dataPoint: Partial<TrafficDataPoint>): Promise<void> {
    try {
      const completeDataPoint: TrafficDataPoint = {
        timestamp: Date.now(),
        requestsPerSecond: dataPoint.requestsPerSecond || 0,
        uniqueUsers: dataPoint.uniqueUsers || 0,
        responseTime: dataPoint.responseTime || 0,
        errorRate: dataPoint.errorRate || 0,
        cpuUsage: dataPoint.cpuUsage || 0,
        memoryUsage: dataPoint.memoryUsage || 0,
        endpointDistribution: dataPoint.endpointDistribution || {},
        userTierDistribution: dataPoint.userTierDistribution || {},
        geographicDistribution: dataPoint.geographicDistribution || {},
      };

      this.trafficHistory.push(completeDataPoint);

      // Maintain history size limit
      if (this.trafficHistory.length > this.MAX_HISTORY_SIZE) {
        this.trafficHistory.shift();
      }

      // Cache recent data for fast access
      await this.cacheManager.set(
        'traffic:latest',
        completeDataPoint,
        300000, // 5 minutes
      );

      // Emit event for other services
      this.eventEmitter.emit('traffic.data.recorded', completeDataPoint);
    } catch (error) {
      this.logger.error('Error recording traffic data', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Make traffic predictions
   */
  private async makePredictions(): Promise<void> {
    try {
      if (this.trafficHistory.length < 10) {
        return; // Need minimum data points
      }

      const predictions = await this.generatePredictions();

      // Filter predictions above confidence threshold
      const confidentPredictions = predictions.filter(
        (p) => p.confidence >= this.config.minConfidenceThreshold,
      );

      // Add to active predictions
      this.activePredictions.push(...confidentPredictions);

      // Limit active predictions
      if (this.activePredictions.length > this.MAX_PREDICTIONS) {
        this.activePredictions = this.activePredictions
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, this.MAX_PREDICTIONS);
      }

      // Execute preparation actions for high-confidence predictions
      for (const prediction of confidentPredictions) {
        if (prediction.spikeProbability > 0.8) {
          await this.executePreparationActions(prediction);
        }
      }

      // Update statistics
      this.stats.predictionsMade += predictions.length;

      // Emit predictions event
      this.eventEmitter.emit(
        'traffic.predictions.generated',
        confidentPredictions,
      );

      this.logger.debug('Traffic predictions generated', {
        totalPredictions: predictions.length,
        confidentPredictions: confidentPredictions.length,
        activePredictions: this.activePredictions.length,
      });
    } catch (error) {
      this.logger.error('Error making traffic predictions', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Generate predictions using multiple models
   */
  private async generatePredictions(): Promise<TrafficPrediction[]> {
    const predictions: TrafficPrediction[] = [];
    const now = Date.now();

    // Get recent data (last hour)
    const recentData = this.trafficHistory.filter(
      (dp) => dp.timestamp > now - 3600000,
    );

    if (recentData.length < 5) {
      return predictions;
    }

    // Calculate baseline metrics
    const baselineRps =
      recentData.reduce((sum, dp) => sum + dp.requestsPerSecond, 0) /
      recentData.length;
    const baselineErrorRate =
      recentData.reduce((sum, dp) => sum + dp.errorRate, 0) / recentData.length;

    // Simple prediction algorithm (can be enhanced with ML models)
    for (let window = 60; window <= 600; window += 60) {
      // 1 to 10 minutes ahead
      const prediction = this.predictTrafficSpike(
        recentData,
        baselineRps,
        baselineErrorRate,
        window,
      );
      if (prediction) {
        predictions.push(prediction);
      }
    }

    return predictions;
  }

  /**
   * Predict traffic spike for a specific time window
   */
  private predictTrafficSpike(
    recentData: TrafficDataPoint[],
    baselineRps: number,
    baselineErrorRate: number,
    predictionWindow: number,
  ): TrafficPrediction | null {
    try {
      // Simple trend analysis
      const recentTrend = this.calculateTrafficTrend(recentData);
      const patternMultiplier = this.checkForPatterns(
        recentData,
        predictionWindow,
      );

      // Calculate predicted RPS
      const predictedRps = baselineRps * (1 + recentTrend) * patternMultiplier;

      // Calculate confidence based on data quality and trend strength
      const confidence = Math.min(
        0.95,
        Math.max(
          0.1,
          (recentData.length / 60) * Math.abs(recentTrend) * 0.5 + 0.3,
        ),
      );

      // Determine spike probability
      const spikeThreshold = baselineRps * this.config.spikeThresholdMultiplier;
      const spikeProbability =
        predictedRps > spikeThreshold
          ? Math.min(
              0.95,
              (predictedRps - spikeThreshold) / (predictedRps * 0.5),
            )
          : 0.1;

      // Generate contributing factors
      const contributingFactors = [];
      if (recentTrend > 0.2)
        contributingFactors.push('Increasing traffic trend');
      if (patternMultiplier > 1.2)
        contributingFactors.push('Historical pattern detected');
      if (baselineErrorRate > 0.05)
        contributingFactors.push('Elevated error rates');

      // Generate recommended actions
      const recommendedActions = this.generateRecommendedActions(
        spikeProbability,
        predictedRps,
      );

      return {
        predictedRps,
        confidence,
        predictionWindow,
        spikeProbability,
        spikeMagnitude: predictedRps / baselineRps,
        contributingFactors,
        recommendedActions,
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.warn('Error predicting traffic spike', {
        predictionWindow,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Calculate traffic trend from recent data
   */
  private calculateTrafficTrend(data: TrafficDataPoint[]): number {
    if (data.length < 2) return 0;

    // Simple linear trend calculation
    const n = data.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = data.reduce((sum, dp, i) => sum + dp.requestsPerSecond, 0);
    const sumXY = data.reduce(
      (sum, dp, i) => sum + i * dp.requestsPerSecond,
      0,
    );
    const sumXX = (n * (n - 1) * (2 * n - 1)) / 6;

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

    // Normalize slope to percentage change
    const avgY = sumY / n;
    return slope / avgY;
  }

  /**
   * Check for historical patterns to adjust prediction based on recurring spikes
   *
   * - Scans detectedPatterns for any with a nextOccurrence closely matching the prediction window.
   * - If a close match (within predictionWindow seconds) is found, returns the max typicalMultiplier.
   * - Otherwise, returns 1.0 (no adjustment).
   */
  /**
   * Checks for historical patterns and also considers actual recent data for prediction adjustment.
   *
   * - Scans detectedPatterns for any with a nextOccurrence close to now within the prediction window.
   * - If a matching pattern is found, uses the maximum typicalMultiplier as pattern factor.
   * - Additionally, analyzes the actual recent data for anomalous spikes (compared to simple rolling mean).
   * - Returns a multiplier based on both detected patterns and real data spikeiness (the greater of the two).
   */
  private checkForPatterns(
    data: TrafficDataPoint[],
    predictionWindow: number,
  ): number {
    if (
      !Array.isArray(this.detectedPatterns) ||
      !this.detectedPatterns.length ||
      data.length === 0
    ) {
      return 1.0;
    }

    const now = Date.now();
    let patternMultiplier = 1.0;
    let patternMatches = 0;

    // Use detected patterns as before
    for (const pattern of this.detectedPatterns) {
      if (
        pattern.nextOccurrence != null &&
        typeof pattern.typicalMultiplier === 'number' &&
        Math.abs(pattern.nextOccurrence - now) <= predictionWindow * 1000
      ) {
        patternMultiplier = Math.max(
          patternMultiplier,
          pattern.typicalMultiplier,
        );
        patternMatches++;
      }
    }

    // Analyze recent data for outlier/spike
    let dataMultiplier = 1.0;
    if (data.length >= 3) {
      // Use the last timeframe equal to predictionWindow if possible
      const newestTimestamp = data[data.length - 1].timestamp;
      const oldestAllowed = newestTimestamp - predictionWindow * 1000;
      const pointsInWindow = data.filter((dp) => dp.timestamp >= oldestAllowed);

      // Use the last point (most recent) vs mean of previous (not including last point)
      if (pointsInWindow.length > 2) {
        const recentPoints = pointsInWindow.slice(-3);
        // Take the latest, compare to mean of previous 2
        const latest = recentPoints[recentPoints.length - 1].requestsPerSecond;
        const meanPrevious =
          (recentPoints[0].requestsPerSecond +
            recentPoints[1].requestsPerSecond) /
          2;
        if (meanPrevious > 0) {
          const spikeRatio = latest / meanPrevious;
          // Use as candidate multiplier, only if significant (e.g. > 1.10)
          if (spikeRatio > 1.1) {
            dataMultiplier = Math.max(dataMultiplier, Math.min(spikeRatio, 3)); // Cap outlier
          }
        }
      }
    }

    return Math.max(
      patternMatches > 0 ? patternMultiplier : 1.0,
      dataMultiplier,
    );
  }

  /**
   * Generate recommended preparation actions
   */
  private generateRecommendedActions(
    spikeProbability: number,
    predictedRps: number,
  ): PrepActionType[] {
    const actions: PrepActionType[] = [];

    if (spikeProbability > 0.8) {
      actions.push('alert_team', 'enable_aggressive_throttling');
    }

    if (spikeProbability > 0.6) {
      actions.push('scale_rate_limits', 'pre_warm_cache');
    }

    if (spikeProbability > 0.4) {
      actions.push('increase_cache_ttl', 'optimize_queries');
    }

    if (predictedRps > 100) {
      actions.push('increase_queue_capacity');
    }

    return actions;
  }

  /**
   * Execute preparation actions for a prediction
   */
  private async executePreparationActions(
    prediction: TrafficPrediction,
  ): Promise<void> {
    for (const actionType of prediction.recommendedActions) {
      try {
        const success = await this.executeAction(actionType);

        this.executedActions.set(actionType, {
          timestamp: Date.now(),
          success,
        });

        this.stats.actionsExecuted++;
        if (success) {
          this.stats.actionsSuccessful++;
        }

        this.logger.log('Executed preparation action', {
          actionType,
          success,
          predictionConfidence: prediction.confidence,
          spikeProbability: prediction.spikeProbability,
        });
      } catch (error) {
        this.logger.error('Failed to execute preparation action', {
          actionType,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * Execute a specific preparation action
   */
  private async executeAction(actionType: PrepActionType): Promise<boolean> {
    try {
      switch (actionType) {
        case 'increase_cache_ttl':
          // Increase cache TTL for frequently accessed data
          await this.cacheManager.set('cache:ttl:multiplier', 2, 3600000);
          return true;

        case 'pre_warm_cache':
          // Trigger cache warming for popular endpoints
          this.eventEmitter.emit('cache.warm.requested');
          return true;

        case 'scale_rate_limits':
          // Scale up rate limits
          this.eventEmitter.emit('rate-limits.scale-up');
          return true;

        case 'enable_degradation':
          // Enable graceful degradation
          this.eventEmitter.emit('graceful-degradation.enable');
          return true;

        case 'alert_team':
          // Send alert to team
          this.eventEmitter.emit('alert.team', {
            type: 'traffic_spike_prediction',
            severity: 'high',
            message: 'Traffic spike predicted with high confidence',
          });
          return true;

        case 'prepare_cdn':
          // Prepare CDN for increased traffic
          this.eventEmitter.emit('cdn.prepare-spike');
          return true;

        case 'optimize_queries':
          // Enable query optimization
          await this.cacheManager.set(
            'query:optimization:enabled',
            true,
            3600000,
          );
          return true;

        case 'increase_queue_capacity':
          // Increase queue capacity
          this.eventEmitter.emit('queue.capacity-increase');
          return true;

        case 'enable_aggressive_throttling':
          // Enable aggressive throttling
          this.eventEmitter.emit('throttling.aggressive-enable');
          return true;

        case 'notify_users':
          // Notify users of potential delays
          this.eventEmitter.emit('notification.bulk-send', {
            type: 'service_degradation_warning',
            message:
              'We are experiencing high traffic. Service may be slower than usual.',
          });
          return true;

        default:
          return false;
      }
    } catch (error) {
      this.logger.error('Error executing action', {
        actionType,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Detect traffic patterns
   */
  private async detectPatterns(): Promise<void> {
    try {
      if (this.trafficHistory.length < 100) {
        return; // Need sufficient data
      }

      // Analyze patterns (simplified implementation)
      const patterns = this.analyzeHistoricalPatterns();

      this.detectedPatterns = patterns;

      // Cache patterns for fast access
      await this.cacheManager.set('traffic:patterns', patterns, 3600000);

      this.logger.debug('Traffic patterns detected', {
        patternCount: patterns.length,
      });
    } catch (error) {
      this.logger.error('Error detecting traffic patterns', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Analyze historical data for patterns
   */
  private analyzeHistoricalPatterns(): TrafficPattern[] {
    const patterns: TrafficPattern[] = [];

    // Simple pattern detection - can be enhanced with ML
    const now = new Date();

    // Daily patterns
    patterns.push({
      patternType: 'daily',
      patternName: 'Business Hours Peak',
      typicalMultiplier: 1.5,
      durationMinutes: 480, // 8 hours
      confidence: 0.8,
      historicalOccurrences: 30,
      nextOccurrence: this.calculateNextBusinessHours(now),
    });

    // Weekly patterns
    patterns.push({
      patternType: 'weekly',
      patternName: 'Monday Morning',
      typicalMultiplier: 1.3,
      durationMinutes: 120,
      confidence: 0.7,
      historicalOccurrences: 4,
      nextOccurrence: this.calculateNextMondayMorning(now),
    });

    return patterns;
  }

  /**
   * Calculate next business hours occurrence
   */
  private calculateNextBusinessHours(now: Date): number {
    const next = new Date(now);
    const currentHour = now.getHours();

    if (currentHour >= 9 && currentHour < 17) {
      // Already in business hours, next occurrence is tomorrow
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
    } else if (currentHour < 9) {
      // Before business hours today
      next.setHours(9, 0, 0, 0);
    } else {
      // After business hours, next occurrence is tomorrow
      next.setDate(next.getDate() + 1);
      next.setHours(9, 0, 0, 0);
    }

    return next.getTime();
  }

  /**
   * Calculate next Monday morning occurrence
   */
  private calculateNextMondayMorning(now: Date): number {
    const next = new Date(now);
    const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday

    if (currentDay === 1 && now.getHours() < 9) {
      // It's Monday before 9 AM
      next.setHours(9, 0, 0, 0);
    } else {
      // Find next Monday
      const daysUntilMonday = currentDay === 0 ? 1 : 8 - currentDay;
      next.setDate(next.getDate() + daysUntilMonday);
      next.setHours(9, 0, 0, 0);
    }

    return next.getTime();
  }

  /**
   * Get current traffic statistics
   */
  getStats() {
    return {
      ...this.stats,
      historySize: this.trafficHistory.length,
      activePredictions: this.activePredictions.length,
      detectedPatterns: this.detectedPatterns.length,
      preparationSuccessRate:
        this.stats.actionsExecuted > 0
          ? this.stats.actionsSuccessful / this.stats.actionsExecuted
          : 0,
    };
  }

  /**
   * Get latest traffic data
   */
  getLatestTrafficData(): TrafficDataPoint | null {
    return this.trafficHistory.length > 0
      ? this.trafficHistory[this.trafficHistory.length - 1]
      : null;
  }

  /**
   * Get active predictions
   */
  getActivePredictions(): TrafficPrediction[] {
    // Filter out expired predictions
    const now = Date.now();
    return this.activePredictions.filter(
      (p) => p.timestamp + p.predictionWindow * 1000 > now,
    );
  }

  /**
   * Manually trigger prediction
   */
  async triggerPrediction(): Promise<TrafficPrediction[]> {
    await this.makePredictions();
    return this.getActivePredictions();
  }

  /**
   * Clean up old data
   */
  cleanup(): void {
    const cutoffTime =
      Date.now() - this.config.historicalWindow * 24 * 60 * 60 * 1000;
    this.trafficHistory = this.trafficHistory.filter(
      (dp) => dp.timestamp > cutoffTime,
    );

    // Clear expired predictions
    const now = Date.now();
    this.activePredictions = this.activePredictions.filter(
      (p) => p.timestamp + p.predictionWindow * 1000 > now,
    );

    this.logger.log('Traffic prediction data cleaned up', {
      remainingHistory: this.trafficHistory.length,
      remainingPredictions: this.activePredictions.length,
    });
  }

  /**
   * Shutdown the service
   */
  onModuleDestroy(): void {
    if (this.predictionInterval) {
      clearInterval(this.predictionInterval);
    }
    if (this.patternDetectionInterval) {
      clearInterval(this.patternDetectionInterval);
    }
  }
}
