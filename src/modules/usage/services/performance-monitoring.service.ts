import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Usage, UsageDocument } from '@/schemas/core/usage.schema';
import { Cron, CronExpression } from '@nestjs/schedule';

interface PerformanceMetrics {
  timestamp: Date;
  responseTime: {
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    min: number;
    max: number;
  };
  throughput: {
    requestsPerSecond: number;
    totalRequests: number;
  };
  errorRate: {
    percentage: number;
    totalErrors: number;
    totalRequests: number;
  };
  costMetrics: {
    totalCost: number;
    avgCostPerRequest: number;
    costPerSecond: number;
  };
  modelPerformance: Record<
    string,
    {
      avgResponseTime: number;
      errorRate: number;
      totalRequests: number;
    }
  >;
  geoPerformance: Record<
    string,
    {
      avgResponseTime: number;
      avgNetworkTime: number;
      totalRequests: number;
    }
  >;
}

interface AnomalyAlert {
  id: string;
  type:
    | 'response_time_spike'
    | 'error_rate_spike'
    | 'cost_spike'
    | 'throughput_drop'
    | 'memory_usage_high';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  metric: string;
  currentValue: number;
  threshold: number;
  timestamp: Date;
  affectedServices?: string[];
  recommendedActions?: string[];
}

interface HistoricalMetrics {
  period: string;
  metrics: PerformanceMetrics[];
  anomalies: AnomalyAlert[];
  trends: {
    responseTime: 'increasing' | 'decreasing' | 'stable';
    errorRate: 'increasing' | 'decreasing' | 'stable';
    throughput: 'increasing' | 'decreasing' | 'stable';
    cost: 'increasing' | 'decreasing' | 'stable';
  };
}

@Injectable()
export class PerformanceMonitoringService extends EventEmitter2 {
  private readonly logger = new Logger(PerformanceMonitoringService.name);
  private metricsBuffer: PerformanceMetrics[] = [];
  private alertsBuffer: AnomalyAlert[] = [];
  private readonly METRICS_RETENTION_PERIOD = 24 * 60 * 60 * 1000; // 24 hours
  private readonly ALERTS_RETENTION_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 days

  // Anomaly detection thresholds
  private readonly THRESHOLDS = {
    responseTime: {
      warning: 5000, // 5 seconds
      critical: 10000, // 10 seconds
    },
    errorRate: {
      warning: 5, // 5%
      critical: 10, // 10%
    },
    costSpike: {
      warning: 50, // 50% increase
      critical: 100, // 100% increase
    },
    throughputDrop: {
      warning: 30, // 30% drop
      critical: 50, // 50% drop
    },
  };

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
  ) {
    super();
    this.startMetricsCollection();
    this.startAnomalyDetection();
  }

  /**
   * Get current performance metrics
   */
  async getCurrentMetrics(
    timeRangeMinutes: number = 5,
  ): Promise<PerformanceMetrics> {
    try {
      const startTime = new Date(Date.now() - timeRangeMinutes * 60 * 1000);

      const metrics = await this.usageModel.aggregate([
        {
          $match: {
            createdAt: { $gte: startTime },
          },
        },
        {
          $group: {
            _id: null,
            totalRequests: { $sum: 1 },
            avgResponseTime: { $avg: '$responseTime' },
            minResponseTime: { $min: '$responseTime' },
            maxResponseTime: { $max: '$responseTime' },
            responseTimes: { $push: '$responseTime' },
            totalErrors: {
              $sum: { $cond: [{ $eq: ['$errorOccurred', true] }, 1, 0] },
            },
            totalCost: { $sum: '$cost' },
            modelStats: {
              $push: {
                model: '$model',
                responseTime: '$responseTime',
                errorOccurred: '$errorOccurred',
              },
            },
            geoStats: {
              $push: {
                country: '$requestTracking.clientInfo.geoLocation.country',
                responseTime: '$responseTime',
                networkTime: '$requestTracking.performance.networkTime',
              },
            },
          },
        },
      ]);

      if (metrics.length === 0) {
        return this.getEmptyMetrics();
      }

      const data = metrics[0];

      // Calculate percentiles
      const responseTimes = data.responseTimes.sort(
        (a: number, b: number) => a - b,
      );
      const p50 = this.calculatePercentile(responseTimes, 50);
      const p95 = this.calculatePercentile(responseTimes, 95);
      const p99 = this.calculatePercentile(responseTimes, 99);

      // Calculate throughput
      const timeRangeSeconds = timeRangeMinutes * 60;
      const requestsPerSecond = data.totalRequests / timeRangeSeconds;

      // Process model performance
      const modelPerformance = this.processModelStats(data.modelStats);

      // Process geo performance
      const geoPerformance = this.processGeoStats(data.geoStats);

      const currentMetrics: PerformanceMetrics = {
        timestamp: new Date(),
        responseTime: {
          avg: data.avgResponseTime || 0,
          p50,
          p95,
          p99,
          min: data.minResponseTime || 0,
          max: data.maxResponseTime || 0,
        },
        throughput: {
          requestsPerSecond,
          totalRequests: data.totalRequests,
        },
        errorRate: {
          percentage:
            data.totalRequests > 0
              ? (data.totalErrors / data.totalRequests) * 100
              : 0,
          totalErrors: data.totalErrors,
          totalRequests: data.totalRequests,
        },
        costMetrics: {
          totalCost: data.totalCost || 0,
          avgCostPerRequest:
            data.totalRequests > 0 ? data.totalCost / data.totalRequests : 0,
          costPerSecond: data.totalCost / timeRangeSeconds,
        },
        modelPerformance,
        geoPerformance,
      };

      // Store metrics in buffer
      this.metricsBuffer.push(currentMetrics);

      // Clean old metrics
      this.cleanOldMetrics();

      return currentMetrics;
    } catch (error) {
      this.logger.error('Failed to get current metrics', error);
      return this.getEmptyMetrics();
    }
  }

  /**
   * Get historical metrics
   */
  async getHistoricalMetrics(
    startDate: Date,
    endDate: Date,
    interval: 'minute' | 'hour' | 'day' = 'hour',
  ): Promise<HistoricalMetrics> {
    try {
      const groupBy = this.getGroupByExpression(interval);

      const metrics = await this.usageModel.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: groupBy,
            totalRequests: { $sum: 1 },
            avgResponseTime: { $avg: '$responseTime' },
            responseTimes: { $push: '$responseTime' },
            totalErrors: {
              $sum: { $cond: [{ $eq: ['$errorOccurred', true] }, 1, 0] },
            },
            totalCost: { $sum: '$cost' },
            modelStats: {
              $push: {
                model: '$model',
                responseTime: '$responseTime',
                errorOccurred: '$errorOccurred',
              },
            },
            geoStats: {
              $push: {
                country: '$requestTracking.clientInfo.geoLocation.country',
                responseTime: '$responseTime',
                networkTime: '$requestTracking.performance.networkTime',
              },
            },
          },
        },
        {
          $sort: { _id: 1 },
        },
      ]);

      const processedMetrics: PerformanceMetrics[] = metrics.map((metric) => {
        const responseTimes = metric.responseTimes.sort(
          (a: number, b: number) => a - b,
        );

        return {
          timestamp: new Date(metric._id),
          responseTime: {
            avg: metric.avgResponseTime || 0,
            p50: this.calculatePercentile(responseTimes, 50),
            p95: this.calculatePercentile(responseTimes, 95),
            p99: this.calculatePercentile(responseTimes, 99),
            min: Math.min(...responseTimes),
            max: Math.max(...responseTimes),
          },
          throughput: {
            requestsPerSecond:
              metric.totalRequests / this.getIntervalSeconds(interval),
            totalRequests: metric.totalRequests,
          },
          errorRate: {
            percentage:
              metric.totalRequests > 0
                ? (metric.totalErrors / metric.totalRequests) * 100
                : 0,
            totalErrors: metric.totalErrors,
            totalRequests: metric.totalRequests,
          },
          costMetrics: {
            totalCost: metric.totalCost || 0,
            avgCostPerRequest:
              metric.totalRequests > 0
                ? metric.totalCost / metric.totalRequests
                : 0,
            costPerSecond: metric.totalCost / this.getIntervalSeconds(interval),
          },
          modelPerformance: this.processModelStats(metric.modelStats || []),
          geoPerformance: this.processGeoStats(metric.geoStats || []),
        };
      });

      // Get anomalies for the period
      const anomalies = this.alertsBuffer.filter(
        (alert) => alert.timestamp >= startDate && alert.timestamp <= endDate,
      );

      // Calculate trends
      const trends = this.calculateTrends(processedMetrics);

      return {
        period: `${startDate.toISOString()} - ${endDate.toISOString()}`,
        metrics: processedMetrics,
        anomalies,
        trends,
      };
    } catch (error) {
      this.logger.error('Failed to get historical metrics', error);
      throw error;
    }
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit: number = 50): AnomalyAlert[] {
    return this.alertsBuffer
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Manually trigger anomaly check
   */
  async checkForAnomalies(): Promise<AnomalyAlert[]> {
    try {
      const currentMetrics = await this.getCurrentMetrics(10); // Last 10 minutes
      const alerts: AnomalyAlert[] = [];

      // Check response time anomalies
      if (
        currentMetrics.responseTime.avg > this.THRESHOLDS.responseTime.critical
      ) {
        alerts.push(
          this.createAlert(
            'response_time_spike',
            'critical',
            `Critical response time spike: ${currentMetrics.responseTime.avg}ms`,
            'response_time',
            currentMetrics.responseTime.avg,
            this.THRESHOLDS.responseTime.critical,
          ),
        );
      } else if (
        currentMetrics.responseTime.avg > this.THRESHOLDS.responseTime.warning
      ) {
        alerts.push(
          this.createAlert(
            'response_time_spike',
            'high',
            `High response time: ${currentMetrics.responseTime.avg}ms`,
            'response_time',
            currentMetrics.responseTime.avg,
            this.THRESHOLDS.responseTime.warning,
          ),
        );
      }

      // Check error rate anomalies
      if (
        currentMetrics.errorRate.percentage > this.THRESHOLDS.errorRate.critical
      ) {
        alerts.push(
          this.createAlert(
            'error_rate_spike',
            'critical',
            `Critical error rate: ${currentMetrics.errorRate.percentage.toFixed(2)}%`,
            'error_rate',
            currentMetrics.errorRate.percentage,
            this.THRESHOLDS.errorRate.critical,
          ),
        );
      } else if (
        currentMetrics.errorRate.percentage > this.THRESHOLDS.errorRate.warning
      ) {
        alerts.push(
          this.createAlert(
            'error_rate_spike',
            'medium',
            `Elevated error rate: ${currentMetrics.errorRate.percentage.toFixed(2)}%`,
            'error_rate',
            currentMetrics.errorRate.percentage,
            this.THRESHOLDS.errorRate.warning,
          ),
        );
      }

      // Store alerts
      this.alertsBuffer.push(...alerts);

      // Emit alerts
      alerts.forEach((alert) => {
        this.emit('performance.alert', alert);
        this.logger.warn('Performance anomaly detected', alert);
      });

      return alerts;
    } catch (error) {
      this.logger.error('Failed to check for anomalies', error);
      return [];
    }
  }

  /**
   * Start metrics collection cron job
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  private async collectMetrics() {
    try {
      await this.getCurrentMetrics(1); // 1 minute window
    } catch (error) {
      this.logger.error('Failed to collect metrics', error);
    }
  }

  /**
   * Start anomaly detection cron job
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  private async detectAnomalies() {
    try {
      await this.checkForAnomalies();
    } catch (error) {
      this.logger.error('Failed to detect anomalies', error);
    }
  }

  /**
   * Start metrics collection and anomaly detection
   */
  private startMetricsCollection(): void {
    this.logger.log('Starting performance monitoring metrics collection');
    // Cron jobs are handled by @Cron decorators
  }

  /**
   * Start anomaly detection
   */
  private startAnomalyDetection(): void {
    this.logger.log('Starting performance monitoring anomaly detection');
    // Cron jobs are handled by @Cron decorators
  }

  /**
   * Calculate percentile from sorted array
   */
  private calculatePercentile(
    sortedArray: number[],
    percentile: number,
  ): number {
    if (sortedArray.length === 0) return 0;

    const index = (percentile / 100) * (sortedArray.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) {
      return sortedArray[lower];
    }

    return (
      sortedArray[lower] +
      (sortedArray[upper] - sortedArray[lower]) * (index - lower)
    );
  }

  /**
   * Process model performance statistics
   */
  private processModelStats(modelStats: any[]): Record<string, any> {
    const modelMap: Record<string, any> = {};

    modelStats.forEach((stat) => {
      const model = stat.model;
      if (!modelMap[model]) {
        modelMap[model] = {
          avgResponseTime: 0,
          errorRate: 0,
          totalRequests: 0,
          responseTimes: [],
          errors: 0,
        };
      }

      modelMap[model].responseTimes.push(stat.responseTime);
      modelMap[model].totalRequests++;
      if (stat.errorOccurred) {
        modelMap[model].errors++;
      }
    });

    // Calculate averages
    Object.keys(modelMap).forEach((model) => {
      const stats = modelMap[model];
      stats.avgResponseTime =
        stats.responseTimes.reduce((a: number, b: number) => a + b, 0) /
        stats.responseTimes.length;
      stats.errorRate = (stats.errors / stats.totalRequests) * 100;
      delete stats.responseTimes; // Clean up
    });

    return modelMap;
  }

  /**
   * Process geo performance statistics
   */
  private processGeoStats(geoStats: any[]): Record<string, any> {
    const geoMap: Record<string, any> = {};

    geoStats.forEach((stat) => {
      const country = stat.country;
      if (!country) return;

      if (!geoMap[country]) {
        geoMap[country] = {
          avgResponseTime: 0,
          avgNetworkTime: 0,
          totalRequests: 0,
          responseTimes: [],
          networkTimes: [],
        };
      }

      geoMap[country].responseTimes.push(stat.responseTime);
      geoMap[country].networkTimes.push(stat.networkTime);
      geoMap[country].totalRequests++;
    });

    // Calculate averages
    Object.keys(geoMap).forEach((country) => {
      const stats = geoMap[country];
      stats.avgResponseTime =
        stats.responseTimes.reduce((a: number, b: number) => a + b, 0) /
        stats.responseTimes.length;
      stats.avgNetworkTime =
        stats.networkTimes.reduce((a: number, b: number) => a + b, 0) /
        stats.networkTimes.length;
      delete stats.responseTimes; // Clean up
      delete stats.networkTimes; // Clean up
    });

    return geoMap;
  }

  /**
   * Get group by expression for aggregation
   */
  private getGroupByExpression(interval: 'minute' | 'hour' | 'day'): any {
    switch (interval) {
      case 'minute':
        return {
          $dateToString: {
            format: '%Y-%m-%d %H:%M',
            date: '$createdAt',
          },
        };
      case 'hour':
        return {
          $dateToString: {
            format: '%Y-%m-%d %H',
            date: '$createdAt',
          },
        };
      case 'day':
        return {
          $dateToString: {
            format: '%Y-%m-%d',
            date: '$createdAt',
          },
        };
    }
  }

  /**
   * Get interval in seconds
   */
  private getIntervalSeconds(interval: 'minute' | 'hour' | 'day'): number {
    switch (interval) {
      case 'minute':
        return 60;
      case 'hour':
        return 3600;
      case 'day':
        return 86400;
    }
  }

  /**
   * Create alert object
   */
  private createAlert(
    type: AnomalyAlert['type'],
    severity: AnomalyAlert['severity'],
    message: string,
    metric: string,
    currentValue: number,
    threshold: number,
  ): AnomalyAlert {
    return {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      severity,
      message,
      metric,
      currentValue,
      threshold,
      timestamp: new Date(),
      recommendedActions: this.getRecommendedActions(type),
    };
  }

  /**
   * Get recommended actions for alert type
   */
  private getRecommendedActions(type: AnomalyAlert['type']): string[] {
    switch (type) {
      case 'response_time_spike':
        return [
          'Check model performance and consider switching to faster models',
          'Review prompt optimization opportunities',
          'Check network connectivity and latency',
          'Consider implementing caching for frequent requests',
        ];
      case 'error_rate_spike':
        return [
          'Review error logs for patterns',
          'Check API rate limits and quotas',
          'Verify model availability and status',
          'Implement retry logic with exponential backoff',
        ];
      case 'cost_spike':
        return [
          'Review recent model usage and costs',
          'Consider cost optimization suggestions',
          'Check for unexpected high-token requests',
          'Set up budget alerts and limits',
        ];
      case 'throughput_drop':
        return [
          'Check system resources (CPU, memory)',
          'Review recent deployments and changes',
          'Monitor external service dependencies',
          'Consider scaling resources if needed',
        ];
      default:
        return ['Monitor system performance closely'];
    }
  }

  /**
   * Calculate trends from metrics
   */
  private calculateTrends(
    metrics: PerformanceMetrics[],
  ): HistoricalMetrics['trends'] {
    if (metrics.length < 2) {
      return {
        responseTime: 'stable',
        errorRate: 'stable',
        throughput: 'stable',
        cost: 'stable',
      };
    }

    const calculateTrend = (
      values: number[],
    ): 'increasing' | 'decreasing' | 'stable' => {
      if (values.length < 3) return 'stable';

      const recent = values.slice(-3);
      const older = values.slice(0, 3);

      const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

      // Handle division by zero
      if (olderAvg === 0) {
        return recentAvg > 0 ? 'increasing' : 'stable';
      }

      const changePercent = ((recentAvg - olderAvg) / Math.abs(olderAvg)) * 100;

      if (changePercent > 10) return 'increasing';
      if (changePercent < -10) return 'decreasing';
      return 'stable';
    };

    return {
      responseTime: calculateTrend(metrics.map((m) => m.responseTime.avg)),
      errorRate: calculateTrend(metrics.map((m) => m.errorRate.percentage)),
      throughput: calculateTrend(
        metrics.map((m) => m.throughput.requestsPerSecond),
      ),
      cost: calculateTrend(metrics.map((m) => m.costMetrics.totalCost)),
    };
  }

  /**
   * Get empty metrics object
   */
  private getEmptyMetrics(): PerformanceMetrics {
    return {
      timestamp: new Date(),
      responseTime: {
        avg: 0,
        p50: 0,
        p95: 0,
        p99: 0,
        min: 0,
        max: 0,
      },
      throughput: {
        requestsPerSecond: 0,
        totalRequests: 0,
      },
      errorRate: {
        percentage: 0,
        totalErrors: 0,
        totalRequests: 0,
      },
      costMetrics: {
        totalCost: 0,
        avgCostPerRequest: 0,
        costPerSecond: 0,
      },
      modelPerformance: {},
      geoPerformance: {},
    };
  }

  /**
   * Clean old metrics and alerts
   */
  private cleanOldMetrics(): void {
    const now = Date.now();

    this.metricsBuffer = this.metricsBuffer.filter(
      (metric) =>
        now - metric.timestamp.getTime() < this.METRICS_RETENTION_PERIOD,
    );

    this.alertsBuffer = this.alertsBuffer.filter(
      (alert) => now - alert.timestamp.getTime() < this.ALERTS_RETENTION_PERIOD,
    );
  }

  /**
   * Get performance report
   */
  async getPerformanceReport(
    userId: string,
    timeRange: { start: Date; end: Date },
  ): Promise<{
    summary: PerformanceMetrics;
    trends: HistoricalMetrics['trends'];
    alerts: AnomalyAlert[];
    recommendations: string[];
  }> {
    try {
      const summary = await this.getCurrentMetrics();
      const historical = await this.getHistoricalMetrics(
        timeRange.start,
        timeRange.end,
        'hour',
      );
      const alerts = this.getRecentAlerts(20);

      const recommendations = this.generateRecommendations(
        summary,
        historical.trends,
        alerts,
      );

      return {
        summary,
        trends: historical.trends,
        alerts,
        recommendations,
      };
    } catch (error) {
      this.logger.error(
        `Failed to generate performance report for user ${userId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Generate recommendations based on metrics and trends
   */
  private generateRecommendations(
    metrics: PerformanceMetrics,
    trends: HistoricalMetrics['trends'],
    alerts: AnomalyAlert[],
  ): string[] {
    const recommendations: string[] = [];

    // Response time recommendations
    if (metrics.responseTime.avg > 3000) {
      recommendations.push(
        'Consider optimizing prompts to reduce token count and response time',
      );
    }

    if (trends.responseTime === 'increasing') {
      recommendations.push(
        'Response times are trending upward - review recent changes and model usage',
      );
    }

    // Error rate recommendations
    if (metrics.errorRate.percentage > 5) {
      recommendations.push(
        'High error rate detected - check API keys, rate limits, and model availability',
      );
    }

    // Cost recommendations
    if (trends.cost === 'increasing') {
      recommendations.push(
        'Costs are increasing - review usage patterns and consider cost optimization',
      );
    }

    // Throughput recommendations
    if (trends.throughput === 'decreasing') {
      recommendations.push(
        'Throughput is decreasing - monitor system resources and consider scaling',
      );
    }

    // Alert-based recommendations
    if (alerts.some((a) => a.severity === 'critical')) {
      recommendations.push(
        'Critical alerts detected - immediate attention required',
      );
    }

    return recommendations.length > 0
      ? recommendations
      : ['System performance is within normal parameters'];
  }
}
