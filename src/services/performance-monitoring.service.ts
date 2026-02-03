/**
 * Performance Monitoring Service
 * 
 * Real-time metrics collection, performance monitoring, anomaly detection,
 * and alert generation for comprehensive AI endpoint tracking
 */

import { Usage, IUsage } from '../models/Usage';
import { loggingService } from './logging.service';
import { redisService } from './redis.service';
import { EventEmitter } from 'events';

export interface PerformanceMetrics {
  timestamp: Date;
  
  // Response time metrics
  avgResponseTime: number;
  p50ResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  
  // Network performance
  avgNetworkTime: number;
  avgServerProcessingTime: number;
  avgDataTransferEfficiency: number;
  
  // Cost metrics
  totalCost: number;
  costPerRequest: number;
  costPerToken: number;
  
  // Usage metrics
  requestCount: number;
  errorRate: number;
  tokenThroughput: number;
  
  // Optimization metrics
  optimizationOpportunityRate: number;
  avgPotentialSavings: number;
  avgPerformanceScore: number;
}

export interface PerformanceAlert {
  id: string;
  type: 'performance_degradation' | 'cost_spike' | 'error_rate_increase' | 'optimization_opportunity';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  metrics: Partial<PerformanceMetrics>;
  threshold: number;
  currentValue: number;
  timestamp: Date;
  userId?: string;
  projectId?: string;
}

export interface AlertThresholds {
  responseTime: {
    warning: number;
    critical: number;
  };
  errorRate: {
    warning: number;
    critical: number;
  };
  costPerHour: {
    warning: number;
    critical: number;
  };
  performanceScore: {
    warning: number; // Below this score
    critical: number; // Below this score
  };
  dataTransferEfficiency: {
    warning: number; // Below this threshold
    critical: number; // Below this threshold
  };
}

export class PerformanceMonitoringService extends EventEmitter {
  private static readonly METRICS_CACHE_KEY = 'performance_metrics';
  private static readonly ALERT_CACHE_KEY = 'performance_alerts';
  private static readonly METRICS_RETENTION_HOURS = 24;
  
  private isActive: boolean = false;
  
  private readonly defaultThresholds: AlertThresholds = {
    responseTime: {
      warning: 5000, // 5 seconds
      critical: 10000 // 10 seconds
    },
    errorRate: {
      warning: 0.05, // 5%
      critical: 0.10 // 10%
    },
    costPerHour: {
      warning: 10.0, // $10/hour
      critical: 50.0 // $50/hour
    },
    performanceScore: {
      warning: 50, // Below 50
      critical: 25  // Below 25
    },
    dataTransferEfficiency: {
      warning: 10000, // 10KB/s
      critical: 1000   // 1KB/s
    }
  };
  
  constructor() {
    super();
    this.startRealTimeMonitoring();
  }
  
  /**
   * Start real-time performance monitoring
   */
  public startRealTimeMonitoring(): void {
    this.isActive = true;
    // Collect metrics every minute
    setInterval(async () => {
      try {
        await this.collectRealTimeMetrics();
      } catch (error) {
        loggingService.logError(error as Error, {
          component: 'PerformanceMonitoringService',
          operation: 'collectRealTimeMetrics'
        });
      }
    }, 60000); // 1 minute
    
    // Run anomaly detection every 5 minutes
    setInterval(async () => {
      try {
        await this.runAnomalyDetection();
      } catch (error) {
        loggingService.logError(error as Error, {
          component: 'PerformanceMonitoringService',
          operation: 'runAnomalyDetection'
        });
      }
    }, 300000); // 5 minutes
    
    // Clean up old metrics every hour
    setInterval(async () => {
      try {
        await this.cleanupOldMetrics();
      } catch (error) {
        loggingService.logError(error as Error, {
          component: 'PerformanceMonitoringService',
          operation: 'cleanupOldMetrics'
        });
      }
    }, 3600000); // 1 hour
    
    loggingService.info('Real-time performance monitoring started', {
      component: 'PerformanceMonitoringService',
      metricsInterval: '1 minute',
      anomalyDetectionInterval: '5 minutes',
      cleanupInterval: '1 hour'
    });
  }

  /**
   * Check if monitoring is currently active
   */
  public isMonitoring(): boolean {
    return this.isActive;
  }

  /**
   * Stop real-time monitoring
   */
  public stopRealTimeMonitoring(): void {
    this.isActive = false;
    loggingService.info('Real-time performance monitoring stopped');
  }
  
  /**
   * Collect real-time performance metrics
   */
  async collectRealTimeMetrics(userId?: string): Promise<PerformanceMetrics> {
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);
    
    try {
      const query: any = {
        createdAt: { $gte: oneMinuteAgo, $lte: now }
      };
      
      // Filter by userId if provided
      if (userId) {
        query.userId = userId;
      }
      
      // Aggregate metrics from recent usage data
      const recentUsage = await Usage.find(query);
      
      if (recentUsage.length === 0) {
        return this.createEmptyMetrics(now);
      }
      
      const metrics = await this.calculateMetrics(recentUsage, now);
      
      // Cache metrics in Redis with timestamp
      await this.cacheMetrics(metrics);
      
      // Emit metrics event for real-time subscribers
      this.emit('metrics', metrics);
      
      loggingService.debug('Real-time metrics collected', {
        component: 'PerformanceMonitoringService',
        requestCount: metrics.requestCount,
        avgResponseTime: metrics.avgResponseTime,
        errorRate: metrics.errorRate
      });
      
      return metrics;
      
    } catch (error) {
      loggingService.logError(error as Error, {
        component: 'PerformanceMonitoringService',
        operation: 'collectRealTimeMetrics'
      });
      throw error;
    }
  }
  
  /**
   * Get current performance metrics
   */
  async getCurrentMetrics(userId?: string): Promise<PerformanceMetrics | null> {
    try {
      const cacheKey = userId 
        ? `${PerformanceMonitoringService.METRICS_CACHE_KEY}:current:${userId}`
        : `${PerformanceMonitoringService.METRICS_CACHE_KEY}:current`;
        
      const cached = await redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
      
      // If no cached metrics, collect fresh ones
      return await this.collectRealTimeMetrics(userId);
      
    } catch (error) {
      loggingService.logError(error as Error, {
        component: 'PerformanceMonitoringService',
        operation: 'getCurrentMetrics',
        userId
      });
      return null;
    }
  }
  
  /**
   * Get historical performance metrics
   */
  async getHistoricalMetrics(
    startDate: Date,
    endDate: Date,
    interval: 'minute' | 'hour' | 'day' = 'hour',
    userId?: string
  ): Promise<PerformanceMetrics[]> {
    try {
      const query: any = {
        createdAt: { $gte: startDate, $lte: endDate }
      };
      
      // Filter by userId if provided
      if (userId) {
        query.userId = userId;
      }
      
      const usage = await Usage.find(query).sort({ createdAt: 1 });
      
      return await this.aggregateMetricsByInterval(usage, interval, startDate, endDate);
      
    } catch (error) {
      loggingService.logError(error as Error, {
        component: 'PerformanceMonitoringService',
        operation: 'getHistoricalMetrics',
        userId
      });
      throw error;
    }
  }
  
  /**
   * Run anomaly detection and generate alerts
   */
  async runAnomalyDetection(): Promise<PerformanceAlert[]> {
    try {
      const currentMetrics = await this.getCurrentMetrics();
      if (!currentMetrics) {
        return [];
      }
      
      const alerts: PerformanceAlert[] = [];
      const thresholds = this.defaultThresholds;
      
      // Response time alerts
      if (currentMetrics.avgResponseTime > thresholds.responseTime.critical) {
        alerts.push(this.createAlert(
          'performance_degradation',
          'critical',
          'Critical Response Time Degradation',
          `Average response time (${currentMetrics.avgResponseTime}ms) exceeded critical threshold`,
          currentMetrics,
          thresholds.responseTime.critical,
          currentMetrics.avgResponseTime
        ));
      } else if (currentMetrics.avgResponseTime > thresholds.responseTime.warning) {
        alerts.push(this.createAlert(
          'performance_degradation',
          'medium',
          'Response Time Warning',
          `Average response time (${currentMetrics.avgResponseTime}ms) exceeded warning threshold`,
          currentMetrics,
          thresholds.responseTime.warning,
          currentMetrics.avgResponseTime
        ));
      }
      
      // Error rate alerts
      if (currentMetrics.errorRate > thresholds.errorRate.critical) {
        alerts.push(this.createAlert(
          'error_rate_increase',
          'critical',
          'Critical Error Rate',
          `Error rate (${(currentMetrics.errorRate * 100).toFixed(1)}%) exceeded critical threshold`,
          currentMetrics,
          thresholds.errorRate.critical,
          currentMetrics.errorRate
        ));
      } else if (currentMetrics.errorRate > thresholds.errorRate.warning) {
        alerts.push(this.createAlert(
          'error_rate_increase',
          'medium',
          'High Error Rate',
          `Error rate (${(currentMetrics.errorRate * 100).toFixed(1)}%) exceeded warning threshold`,
          currentMetrics,
          thresholds.errorRate.warning,
          currentMetrics.errorRate
        ));
      }
      
      // Cost spike alerts
      const costPerHour = currentMetrics.totalCost * 60; // Extrapolate from per-minute to per-hour
      if (costPerHour > thresholds.costPerHour.critical) {
        alerts.push(this.createAlert(
          'cost_spike',
          'critical',
          'Critical Cost Spike',
          `Cost rate ($${costPerHour.toFixed(2)}/hour) exceeded critical threshold`,
          currentMetrics,
          thresholds.costPerHour.critical,
          costPerHour
        ));
      } else if (costPerHour > thresholds.costPerHour.warning) {
        alerts.push(this.createAlert(
          'cost_spike',
          'medium',
          'Cost Warning',
          `Cost rate ($${costPerHour.toFixed(2)}/hour) exceeded warning threshold`,
          currentMetrics,
          thresholds.costPerHour.warning,
          costPerHour
        ));
      }
      
      // Performance score alerts
      if (currentMetrics.avgPerformanceScore < thresholds.performanceScore.critical) {
        alerts.push(this.createAlert(
          'performance_degradation',
          'critical',
          'Critical Performance Score',
          `Average performance score (${currentMetrics.avgPerformanceScore}) below critical threshold`,
          currentMetrics,
          thresholds.performanceScore.critical,
          currentMetrics.avgPerformanceScore
        ));
      } else if (currentMetrics.avgPerformanceScore < thresholds.performanceScore.warning) {
        alerts.push(this.createAlert(
          'performance_degradation',
          'medium',
          'Low Performance Score',
          `Average performance score (${currentMetrics.avgPerformanceScore}) below warning threshold`,
          currentMetrics,
          thresholds.performanceScore.warning,
          currentMetrics.avgPerformanceScore
        ));
      }
      
      // Optimization opportunity alerts
      if (currentMetrics.optimizationOpportunityRate > 0.5) { // More than 50% of requests have optimization opportunities
        alerts.push(this.createAlert(
          'optimization_opportunity',
          'medium',
          'High Optimization Potential',
          `${(currentMetrics.optimizationOpportunityRate * 100).toFixed(1)}% of requests have optimization opportunities`,
          currentMetrics,
          0.5,
          currentMetrics.optimizationOpportunityRate
        ));
      }
      
      // Process and store alerts
      if (alerts.length > 0) {
        await this.processAlerts(alerts);
      }
      
      return alerts;
      
    } catch (error) {
      loggingService.logError(error as Error, {
        component: 'PerformanceMonitoringService',
        operation: 'runAnomalyDetection'
      });
      throw error;
    }
  }
  
  /**
   * Process and distribute alerts (caching and events only; no notifications sent)
   */
  private async processAlerts(alerts: PerformanceAlert[]): Promise<void> {
    try {
      // Cache alerts for API/UI consumption
      await this.cacheAlerts(alerts);
      
      // Emit alert events for in-process listeners
      for (const alert of alerts) {
        this.emit('alert', alert);
      }
      
      // Performance alert sending removed - can be re-enabled later
      // (was: sendCriticalAlertNotifications, trackAlertAnalytics)
      
      loggingService.info('Performance alerts processed', {
        component: 'PerformanceMonitoringService',
        alertCount: alerts.length
      });
      
    } catch (error) {
      loggingService.logError(error as Error, {
        component: 'PerformanceMonitoringService',
        operation: 'processAlerts'
      });
    }
  }
  
  /**
   * Get recent performance alerts
   */
  async getRecentAlerts(limit: number = 50): Promise<PerformanceAlert[]> {
    try {
      if (!redisService.client || !redisService.isConnected) {
        console.warn('Redis client not available for retrieving alerts');
        return [];
      }
      
      let cached: string[] = [];
      
      if (typeof redisService.client.lRange === 'function') {
        cached = await redisService.client.lRange(`${PerformanceMonitoringService.ALERT_CACHE_KEY}:recent`, 0, limit - 1);
      } else if (typeof redisService.client.LRANGE === 'function') {
        cached = await (redisService.client as any).LRANGE(`${PerformanceMonitoringService.ALERT_CACHE_KEY}:recent`, 0, limit - 1);
      } else {
        // Fallback: return empty array if Redis list operations aren't available
        console.warn('Redis list operations not available, returning empty alerts array');
        return [];
      }
      
      return cached.map((alert: string) => JSON.parse(alert));
      
    } catch (error) {
      console.error('Error retrieving recent alerts:', error);
      return [];
    }
  }
  
  /**
   * Calculate comprehensive performance metrics from usage data
   */
  private async calculateMetrics(usage: IUsage[], timestamp: Date): Promise<PerformanceMetrics> {
    const totalRequests = usage.length;
    const successfulRequests = usage.filter(u => !u.errorOccurred);
    const errorRate = totalRequests > 0 ? (totalRequests - successfulRequests.length) / totalRequests : 0;
    
    // Response time metrics
    const responseTimes = usage.map(u => u.responseTime).sort((a, b) => a - b);
    const avgResponseTime = responseTimes.length > 0 ? 
      responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length : 0;
    const p50ResponseTime = this.calculatePercentile(responseTimes, 50);
    const p95ResponseTime = this.calculatePercentile(responseTimes, 95);
    const p99ResponseTime = this.calculatePercentile(responseTimes, 99);
    
    // Network performance metrics
    const networkTimes = usage
      .filter(u => u.requestTracking?.performance?.networkTime)
      .map(u => u.requestTracking!.performance.networkTime);
    const avgNetworkTime = networkTimes.length > 0 ?
      networkTimes.reduce((sum, time) => sum + time, 0) / networkTimes.length : 0;
    
    const serverTimes = usage
      .filter(u => u.requestTracking?.performance?.serverProcessingTime)
      .map(u => u.requestTracking!.performance.serverProcessingTime);
    const avgServerProcessingTime = serverTimes.length > 0 ?
      serverTimes.reduce((sum, time) => sum + time, 0) / serverTimes.length : 0;
    
    const efficiencies = usage
      .filter(u => u.requestTracking?.performance?.dataTransferEfficiency)
      .map(u => u.requestTracking!.performance.dataTransferEfficiency);
    const avgDataTransferEfficiency = efficiencies.length > 0 ?
      efficiencies.reduce((sum, eff) => sum + eff, 0) / efficiencies.length : 0;
    
    // Cost metrics
    const totalCost = usage.reduce((sum, u) => sum + u.cost, 0);
    const costPerRequest = totalRequests > 0 ? totalCost / totalRequests : 0;
    const totalTokens = usage.reduce((sum, u) => sum + u.totalTokens, 0);
    const costPerToken = totalTokens > 0 ? totalCost / totalTokens : 0;
    const tokenThroughput = totalTokens; // Tokens per minute
    
    // Optimization metrics
    const requestsWithOptimizations = usage.filter(u => 
      u.optimizationOpportunities?.costOptimization?.potentialSavings && 
      u.optimizationOpportunities.costOptimization.potentialSavings > 0
    );
    const optimizationOpportunityRate = totalRequests > 0 ? 
      requestsWithOptimizations.length / totalRequests : 0;
    
    const potentialSavings = requestsWithOptimizations
      .map(u => u.optimizationOpportunities!.costOptimization!.potentialSavings!)
      .reduce((sum, savings) => sum + savings, 0);
    const avgPotentialSavings = requestsWithOptimizations.length > 0 ?
      potentialSavings / requestsWithOptimizations.length : 0;
    
    const performanceScores = usage
      .filter(u => u.optimizationOpportunities?.performanceOptimization?.currentPerformanceScore)
      .map(u => u.optimizationOpportunities!.performanceOptimization!.currentPerformanceScore);
    const avgPerformanceScore = performanceScores.length > 0 ?
      performanceScores.reduce((sum, score) => sum + score, 0) / performanceScores.length : 0;
    
    return {
      timestamp,
      avgResponseTime,
      p50ResponseTime,
      p95ResponseTime,
      p99ResponseTime,
      avgNetworkTime,
      avgServerProcessingTime,
      avgDataTransferEfficiency,
      totalCost,
      costPerRequest,
      costPerToken,
      requestCount: totalRequests,
      errorRate,
      tokenThroughput,
      optimizationOpportunityRate,
      avgPotentialSavings,
      avgPerformanceScore
    };
  }
  
  /**
   * Helper methods
   */
  private calculatePercentile(sortedArray: number[], percentile: number): number {
    if (sortedArray.length === 0) return 0;
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }
  
  private createEmptyMetrics(timestamp: Date): PerformanceMetrics {
    return {
      timestamp,
      avgResponseTime: 0,
      p50ResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      avgNetworkTime: 0,
      avgServerProcessingTime: 0,
      avgDataTransferEfficiency: 0,
      totalCost: 0,
      costPerRequest: 0,
      costPerToken: 0,
      requestCount: 0,
      errorRate: 0,
      tokenThroughput: 0,
      optimizationOpportunityRate: 0,
      avgPotentialSavings: 0,
      avgPerformanceScore: 0
    };
  }
  
  private createAlert(
    type: PerformanceAlert['type'],
    severity: PerformanceAlert['severity'],
    title: string,
    message: string,
    metrics: PerformanceMetrics,
    threshold: number,
    currentValue: number
  ): PerformanceAlert {
    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      severity,
      title,
      message,
      metrics,
      threshold,
      currentValue,
      timestamp: new Date()
    };
  }
  
  private async cacheMetrics(metrics: PerformanceMetrics): Promise<void> {
    const key = `${PerformanceMonitoringService.METRICS_CACHE_KEY}:current`;
    await redisService.set(key, metrics, 300); // 5 minute TTL
    
    // Also add to historical data
    const historicalKey = `${PerformanceMonitoringService.METRICS_CACHE_KEY}:historical`;
    
    try {
      if (typeof redisService.client.lPush === 'function') {
        await redisService.client.lPush(historicalKey, JSON.stringify(metrics));
      } else {
        // Fallback: use timestamped keys for historical data
        const timestampKey = `${historicalKey}:${Date.now()}`;
        await redisService.set(timestampKey, metrics, 86400); // 24 hour TTL
      }
      
      if (typeof redisService.client.lTrim === 'function') {
        await redisService.client.lTrim(historicalKey, 0, 1440); // Keep 24 hours (1 per minute)
      }
      // If trim is not available, rely on TTL for cleanup
      
    } catch (error) {
      console.error('Error caching historical metrics:', error);
      // Don't throw - metrics caching is not critical for core functionality
    }
  }
  
  private async cacheAlerts(alerts: PerformanceAlert[]): Promise<void> {
    if (!redisService.client || !redisService.isConnected) {
      console.warn('Redis client not available for alert caching');
      return;
    }
    
    try {
      const key = `${PerformanceMonitoringService.ALERT_CACHE_KEY}:recent`;
      
      for (const alert of alerts) {
        // Use LPUSH command (Redis v4+ uses different method names)
        if (typeof redisService.client.lPush === 'function') {
          await redisService.client.lPush(key, JSON.stringify(alert));
        } else if (typeof redisService.client.LPUSH === 'function') {
          await (redisService.client as any).LPUSH(key, JSON.stringify(alert));
        } else {
          // Fallback: use Redis SET with timestamp-based keys
          const alertKey = `${key}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
          await redisService.set(alertKey, alert, 3600); // 1 hour TTL
        }
      }
      
      // Trim the list to keep only recent alerts
      if (typeof redisService.client.lTrim === 'function') {
        await redisService.client.lTrim(key, 0, 1000); // Keep last 1000 alerts
      } else if (typeof redisService.client.LTRIM === 'function') {
        await (redisService.client as any).LTRIM(key, 0, 1000);
      }
      // If trim is not available, we'll rely on TTL for cleanup
      
    } catch (error) {
      console.error('Error caching alerts:', error);
      // Don't throw - alert caching is not critical for functionality
    }
  }
  
  // sendCriticalAlertNotifications and trackAlertAnalytics removed - can be re-enabled later
  
  private async aggregateMetricsByInterval(
    usage: IUsage[],
    interval: 'minute' | 'hour' | 'day',
    startDate: Date,
    endDate: Date
  ): Promise<PerformanceMetrics[]> {
    const intervalMs = interval === 'minute' ? 60000 : interval === 'hour' ? 3600000 : 86400000;
    const buckets = new Map<number, IUsage[]>();
    
    // Filter usage data by date range first
    const filteredUsage = usage.filter(record => {
      const recordTime = record.createdAt.getTime();
      return recordTime >= startDate.getTime() && recordTime <= endDate.getTime();
    });
    
    // Group filtered usage by time interval
    for (const record of filteredUsage) {
      const bucketTime = Math.floor(record.createdAt.getTime() / intervalMs) * intervalMs;
      
      // Ensure bucket time is within the specified range
      if (bucketTime >= startDate.getTime() && bucketTime <= endDate.getTime()) {
        if (!buckets.has(bucketTime)) {
          buckets.set(bucketTime, []);
        }
        buckets.get(bucketTime)!.push(record);
      }
    }
    
    // Fill in missing time buckets with empty metrics for complete time series
    const metrics: PerformanceMetrics[] = [];
    let currentTime = Math.floor(startDate.getTime() / intervalMs) * intervalMs;
    const endTime = Math.floor(endDate.getTime() / intervalMs) * intervalMs;
    
    while (currentTime <= endTime) {
      const records = buckets.get(currentTime) || [];
      const bucketMetrics = await this.calculateMetrics(records, new Date(currentTime));
      metrics.push(bucketMetrics);
      currentTime += intervalMs;
    }
    
    return metrics.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
  
  private async cleanupOldMetrics(): Promise<void> {
    try {
      const cutoffTime = new Date(Date.now() - (PerformanceMonitoringService.METRICS_RETENTION_HOURS * 3600000));
      
      // Clean up cached historical metrics
      const historicalKey = `${PerformanceMonitoringService.METRICS_CACHE_KEY}:historical`;
      const metrics = await redisService.client.lRange(historicalKey, 0, -1);
      
      const validMetrics = metrics.filter((metricStr: string) => {
        const metric = JSON.parse(metricStr) as PerformanceMetrics;
        return new Date(metric.timestamp) > cutoffTime;
      });
      
      if (validMetrics.length !== metrics.length) {
        await redisService.del(historicalKey);
        for (const metric of validMetrics) {
          await redisService.client.lPush(historicalKey, metric);
        }
      }
      
      loggingService.info('Old performance metrics cleaned up', {
        component: 'PerformanceMonitoringService',
        removedCount: metrics.length - validMetrics.length,
        retainedCount: validMetrics.length
      });
      
    } catch (error) {
      loggingService.logError(error as Error, {
        component: 'PerformanceMonitoringService',
        operation: 'cleanupOldMetrics'
      });
    }
  }
}

// Export singleton instance
export const performanceMonitoringService = new PerformanceMonitoringService();