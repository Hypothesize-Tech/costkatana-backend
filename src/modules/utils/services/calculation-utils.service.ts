/**
 * Calculation Utils Service
 *
 * Provides mathematical and statistical calculations for cost optimization,
 * performance metrics, and data analysis.
 */

import { Injectable, Logger } from '@nestjs/common';

export interface SavingsCalculation {
  /** Total cost savings in USD */
  totalSavings: number;

  /** Percentage reduction in cost */
  percentageReduction: number;

  /** Token savings */
  tokenSavings: number;

  /** Breakdown by category */
  breakdown: {
    compression: number;
    modelSelection: number;
    caching: number;
    contextTrimming: number;
  };

  /** Time period for calculation */
  timePeriod: 'daily' | 'weekly' | 'monthly' | 'yearly';

  /** Confidence in calculation */
  confidence: number;
}

export interface PerformanceMetrics {
  /** Average response time in milliseconds */
  averageResponseTime: number;

  /** 95th percentile response time */
  p95ResponseTime: number;

  /** Success rate (0-1) */
  successRate: number;

  /** Throughput (requests per second) */
  throughput: number;

  /** Error rate (0-1) */
  errorRate: number;

  /** Cost per request in USD */
  costPerRequest: number;

  /** Token efficiency (tokens per dollar) */
  tokenEfficiency: number;
}

export interface CortexMetrics {
  /** Semantic integrity score (0-1) */
  semanticIntegrity: number;

  /** Compression ratio achieved */
  compressionRatio: number;

  /** Processing overhead (additional time in ms) */
  processingOverhead: number;

  /** Cache hit rate (0-1) */
  cacheHitRate: number;

  /** Model utilization efficiency */
  modelUtilization: number;

  /** Fallback frequency */
  fallbackFrequency: number;
}

@Injectable()
export class CalculationUtilsService {
  private readonly logger = new Logger(CalculationUtilsService.name);

  /**
   * Calculate unified savings across multiple optimization techniques
   */
  calculateUnifiedSavings(
    originalCost: number,
    optimizedCost: number,
    originalTokens: number,
    optimizedTokens: number,
    breakdown?: {
      compressionSavings: number;
      modelSavings: number;
      cacheSavings: number;
      contextSavings: number;
    },
  ): SavingsCalculation {
    const totalSavings = Math.max(0, originalCost - optimizedCost);
    const percentageReduction =
      originalCost > 0 ? (totalSavings / originalCost) * 100 : 0;
    const tokenSavings = Math.max(0, originalTokens - optimizedTokens);

    // Default breakdown if not provided
    const defaultBreakdown = {
      compression: totalSavings * 0.4,
      modelSelection: totalSavings * 0.3,
      caching: totalSavings * 0.2,
      contextTrimming: totalSavings * 0.1,
    };

    const rawBreakdown = breakdown || defaultBreakdown;
    const finalBreakdown =
      'compression' in rawBreakdown && 'modelSelection' in rawBreakdown
        ? rawBreakdown
        : {
            compression:
              (rawBreakdown as any).compressionSavings ??
              defaultBreakdown.compression,
            modelSelection:
              (rawBreakdown as any).modelSavings ??
              defaultBreakdown.modelSelection,
            caching:
              (rawBreakdown as any).cacheSavings ?? defaultBreakdown.caching,
            contextTrimming:
              (rawBreakdown as any).contextSavings ??
              defaultBreakdown.contextTrimming,
          };

    // Calculate confidence based on data completeness
    const confidence = breakdown ? 0.95 : 0.75;

    return {
      totalSavings,
      percentageReduction,
      tokenSavings,
      breakdown: finalBreakdown,
      timePeriod: 'monthly', // Default, can be parameterized
      confidence,
    };
  }

  /**
   * Convert Cortex metrics to unified scoring system
   */
  convertToCortexMetrics(rawMetrics: {
    semanticIntegrity?: number;
    compressionRatio?: number;
    processingOverhead?: number;
    cacheHitRate?: number;
    modelUtilization?: number;
    fallbackFrequency?: number;
  }): CortexMetrics {
    return {
      semanticIntegrity: rawMetrics.semanticIntegrity ?? 0.85,
      compressionRatio: rawMetrics.compressionRatio ?? 1.0,
      processingOverhead: rawMetrics.processingOverhead ?? 50,
      cacheHitRate: rawMetrics.cacheHitRate ?? 0.3,
      modelUtilization: rawMetrics.modelUtilization ?? 0.8,
      fallbackFrequency: rawMetrics.fallbackFrequency ?? 0.05,
    };
  }

  /**
   * Calculate performance metrics from raw data
   */
  calculatePerformanceMetrics(
    responseTimes: number[],
    successCount: number,
    totalRequests: number,
    totalCost: number,
    totalTokens: number,
    options?: { windowSeconds?: number },
  ): PerformanceMetrics {
    if (responseTimes.length === 0 || totalRequests === 0) {
      return this.getEmptyPerformanceMetrics();
    }

    // Calculate response time metrics
    const averageResponseTime =
      responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
    const sortedTimes = [...responseTimes].sort((a, b) => a - b);
    const p95ResponseTime =
      sortedTimes[Math.floor(sortedTimes.length * 0.95)] ||
      sortedTimes[sortedTimes.length - 1];

    // Calculate rates
    const successRate = successCount / totalRequests;
    const errorRate = 1 - successRate;

    const windowSeconds = options?.windowSeconds ?? 60;
    const throughput = totalRequests / Math.max(1, windowSeconds);

    // Calculate cost metrics
    const costPerRequest = totalCost / totalRequests;
    const tokenEfficiency = totalTokens > 0 ? totalTokens / totalCost : 0;

    return {
      averageResponseTime,
      p95ResponseTime,
      successRate,
      throughput,
      errorRate,
      costPerRequest,
      tokenEfficiency,
    };
  }

  /**
   * Calculate statistical measures
   */
  calculateStatistics(values: number[]): {
    mean: number;
    median: number;
    mode: number[];
    standardDeviation: number;
    variance: number;
    min: number;
    max: number;
    quartiles: [number, number, number];
    skewness: number;
    kurtosis: number;
  } {
    if (values.length === 0) {
      return this.getEmptyStatistics();
    }

    const sorted = [...values].sort((a, b) => a - b);
    const n = values.length;

    // Basic statistics
    const mean = values.reduce((sum, val) => sum + val, 0) / n;
    const median =
      n % 2 === 0
        ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
        : sorted[Math.floor(n / 2)];

    const min = sorted[0];
    const max = sorted[n - 1];

    // Mode calculation
    const frequency: Record<number, number> = {};
    values.forEach((val) => {
      frequency[val] = (frequency[val] || 0) + 1;
    });
    const maxFreq = Math.max(...Object.values(frequency));
    const mode = Object.keys(frequency)
      .filter((key) => frequency[Number(key)] === maxFreq)
      .map(Number);

    // Variance and standard deviation
    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const standardDeviation = Math.sqrt(variance);

    // Quartiles
    const q1 = sorted[Math.floor(n * 0.25)];
    const q3 = sorted[Math.floor(n * 0.75)];
    const quartiles: [number, number, number] = [q1, median, q3];

    // Skewness and kurtosis
    const skewness =
      values.reduce(
        (sum, val) => sum + Math.pow((val - mean) / standardDeviation, 3),
        0,
      ) / n;
    const kurtosis =
      values.reduce(
        (sum, val) => sum + Math.pow((val - mean) / standardDeviation, 4),
        0,
      ) /
        n -
      3;

    return {
      mean,
      median,
      mode,
      standardDeviation,
      variance,
      min,
      max,
      quartiles,
      skewness,
      kurtosis,
    };
  }

  /**
   * Calculate cost projections
   */
  calculateCostProjection(
    currentUsage: {
      dailyRequests: number;
      averageTokensPerRequest: number;
      currentModel: string;
      currentCostPerToken: number;
    },
    optimizations: {
      compressionRatio: number;
      modelSwitch?: {
        newModel: string;
        newCostPerToken: number;
        adoptionRate: number;
      };
      caching: {
        hitRate: number;
        cacheSavings: number;
      };
      batching?: {
        batchSize: number;
        batchEfficiency: number;
      };
      parallelization?: {
        parallelismFactor: number;
        overheadCost: number;
      };
    },
    timeHorizon: 'weekly' | 'monthly' | 'quarterly' | 'yearly',
  ): {
    projectedCost: number;
    projectedSavings: number;
    savingsPercentage: number;
    breakdown: {
      baseCost: number;
      compressionSavings: number;
      modelSavings: number;
      cacheSavings: number;
      batchSavings: number;
      parallelSavings: number;
    };
    confidence: number;
    riskFactors: string[];
    recommendations: string[];
  } {
    const timeMultiplier = {
      weekly: 7,
      monthly: 30,
      quarterly: 90,
      yearly: 365,
    }[timeHorizon];

    const dailyTokens =
      currentUsage.dailyRequests * currentUsage.averageTokensPerRequest;
    const periodTokens = dailyTokens * timeMultiplier;

    // Base cost without optimizations
    const baseCost = periodTokens * currentUsage.currentCostPerToken;

    // Compression savings
    // compressionRatio > 1 means compression (fewer tokens needed)
    // e.g., ratio of 2.0 means 50% of original tokens
    const compressedTokens = periodTokens / optimizations.compressionRatio;
    const compressionSavings =
      (periodTokens - compressedTokens) * currentUsage.currentCostPerToken;

    // Model switch savings
    let modelSavings = 0;
    if (optimizations.modelSwitch) {
      const modelSwitchTokens =
        compressedTokens * optimizations.modelSwitch.adoptionRate;
      const oldCost = modelSwitchTokens * currentUsage.currentCostPerToken;
      const newCost =
        modelSwitchTokens * optimizations.modelSwitch.newCostPerToken;
      modelSavings = Math.max(0, oldCost - newCost);
    }

    // Cache savings
    const cacheableTokens =
      compressedTokens * (1 - optimizations.caching.hitRate);
    const cacheSavings =
      cacheableTokens *
      currentUsage.currentCostPerToken *
      optimizations.caching.cacheSavings;

    // Batching savings
    let batchSavings = 0;
    if (optimizations.batching) {
      const batches = Math.ceil(
        currentUsage.dailyRequests / optimizations.batching.batchSize,
      );
      const batchOverheadReduction =
        (currentUsage.dailyRequests - batches) *
        currentUsage.currentCostPerToken *
        0.1;
      batchSavings =
        batchOverheadReduction *
        timeMultiplier *
        optimizations.batching.batchEfficiency;
    }

    // Parallelization savings (may have overhead)
    let parallelSavings = 0;
    if (optimizations.parallelization) {
      const parallelEfficiency =
        optimizations.parallelization.parallelismFactor /
        (1 + optimizations.parallelization.overheadCost);
      parallelSavings = baseCost * (1 - 1 / parallelEfficiency) * 0.8; // Conservative estimate
    }

    const totalSavings =
      compressionSavings +
      modelSavings +
      cacheSavings +
      batchSavings +
      parallelSavings;
    const projectedCost = Math.max(0, baseCost - totalSavings);
    const savingsPercentage =
      baseCost > 0 ? (totalSavings / baseCost) * 100 : 0;

    // Calculate confidence based on data completeness and optimization complexity
    let confidence = 0.8; // Base confidence
    const riskFactors: string[] = [];
    const recommendations: string[] = [];

    // Adjust confidence and identify risks
    if (
      optimizations.modelSwitch &&
      optimizations.modelSwitch.adoptionRate < 0.5
    ) {
      confidence -= 0.1;
      riskFactors.push('Low model adoption rate may reduce projected savings');
      recommendations.push(
        'Gradually increase model adoption to maximize savings',
      );
    }

    if (optimizations.compressionRatio < 1.2) {
      confidence -= 0.05;
      riskFactors.push('Low compression ratio limits savings potential');
      recommendations.push('Consider more aggressive compression techniques');
    }

    if (optimizations.caching.hitRate < 0.3) {
      confidence -= 0.1;
      riskFactors.push('Low cache hit rate reduces effectiveness');
      recommendations.push('Optimize cache strategy or increase cache size');
    }

    if (totalSavings > baseCost * 0.5) {
      confidence -= 0.15;
      riskFactors.push(
        'Projected savings exceed 50% of base cost - verify assumptions',
      );
      recommendations.push('Validate optimization assumptions with real data');
    }

    confidence = Math.max(0.1, Math.min(1.0, confidence));

    return {
      projectedCost,
      projectedSavings: totalSavings,
      savingsPercentage,
      breakdown: {
        baseCost,
        compressionSavings,
        modelSavings,
        cacheSavings,
        batchSavings,
        parallelSavings,
      },
      confidence,
      riskFactors,
      recommendations,
    };
  }

  /**
   * Calculate optimization effectiveness score
   */
  calculateOptimizationEffectiveness(
    beforeMetrics: PerformanceMetrics,
    afterMetrics: PerformanceMetrics,
    costReduction: number,
    additionalFactors?: {
      reliability?: number; // 0-1 scale
      userSatisfaction?: number; // 0-1 scale
      maintenanceCost?: number; // additional cost in USD
      scalability?: number; // 0-1 scale
    },
  ): {
    effectivenessScore: number;
    performanceImprovement: number;
    costBenefitRatio: number;
    overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
    breakdown: {
      performanceScore: number;
      costScore: number;
      reliabilityScore: number;
      scalabilityScore: number;
      userSatisfactionScore: number;
    };
    recommendations: string[];
    concerns: string[];
  } {
    // Performance improvement (lower response time, higher success rate, lower error rate)
    const responseTimeImprovement =
      beforeMetrics.averageResponseTime > 0
        ? Math.max(
            0,
            (beforeMetrics.averageResponseTime -
              afterMetrics.averageResponseTime) /
              beforeMetrics.averageResponseTime,
          )
        : 0;
    const successRateImprovement =
      afterMetrics.successRate - beforeMetrics.successRate;
    const errorRateReduction = beforeMetrics.errorRate - afterMetrics.errorRate;
    const throughputImprovement =
      afterMetrics.throughput > beforeMetrics.throughput
        ? (afterMetrics.throughput - beforeMetrics.throughput) /
          beforeMetrics.throughput
        : 0;

    const performanceImprovement =
      responseTimeImprovement * 0.3 +
      successRateImprovement * 0.25 +
      errorRateReduction * 0.25 +
      throughputImprovement * 0.2;

    // Cost benefit ratio (savings per performance unit)
    const costBenefitRatio =
      performanceImprovement > 0 ? costReduction / performanceImprovement : 0;

    // Component scores
    const performanceScore = Math.min(performanceImprovement, 1.0);
    const costScore = Math.min(costReduction / 100, 1.0); // Normalize to $100 max for scoring
    const reliabilityScore =
      additionalFactors?.reliability ??
      this.calculateReliabilityScore(beforeMetrics, afterMetrics);
    const scalabilityScore =
      additionalFactors?.scalability ??
      this.calculateScalabilityScore(beforeMetrics, afterMetrics);
    const userSatisfactionScore = additionalFactors?.userSatisfaction ?? 0.8; // Default neutral

    // Adjust for maintenance costs
    const maintenancePenalty = additionalFactors?.maintenanceCost
      ? Math.min(additionalFactors.maintenanceCost / 50, 0.3)
      : 0;

    // Overall effectiveness score
    const effectivenessScore = Math.max(
      0,
      performanceScore * 0.3 +
        costScore * 0.25 +
        reliabilityScore * 0.2 +
        scalabilityScore * 0.15 +
        userSatisfactionScore * 0.1 -
        maintenancePenalty,
    );

    // Grade calculation with more nuanced thresholds
    let overallGrade: 'A' | 'B' | 'C' | 'D' | 'F';
    if (effectivenessScore >= 0.85) overallGrade = 'A';
    else if (effectivenessScore >= 0.7) overallGrade = 'B';
    else if (effectivenessScore >= 0.55) overallGrade = 'C';
    else if (effectivenessScore >= 0.4) overallGrade = 'D';
    else overallGrade = 'F';

    // Generate recommendations and concerns
    const recommendations: string[] = [];
    const concerns: string[] = [];

    if (performanceScore < 0.5) {
      concerns.push('Performance improvement is below acceptable threshold');
      recommendations.push(
        'Consider alternative optimization strategies to improve performance',
      );
    }

    if (costScore < 0.3) {
      concerns.push('Cost savings are minimal');
      recommendations.push(
        'Evaluate if the optimization justifies the implementation cost',
      );
    }

    if (reliabilityScore < 0.7) {
      concerns.push('Optimization may impact system reliability');
      recommendations.push(
        'Add comprehensive testing and monitoring before full deployment',
      );
    }

    if (scalabilityScore < 0.6) {
      concerns.push('Optimization may not scale well with increased load');
      recommendations.push('Test optimization under high load conditions');
    }

    if (maintenancePenalty > 0.2) {
      concerns.push('High maintenance costs may offset savings');
      recommendations.push(
        'Consider simpler optimization approaches with lower maintenance overhead',
      );
    }

    if (effectivenessScore > 0.8) {
      recommendations.push(
        'Optimization is highly effective - consider applying similar techniques elsewhere',
      );
    }

    return {
      effectivenessScore,
      performanceImprovement,
      costBenefitRatio,
      overallGrade,
      breakdown: {
        performanceScore,
        costScore,
        reliabilityScore,
        scalabilityScore,
        userSatisfactionScore,
      },
      recommendations,
      concerns,
    };
  }

  private calculateReliabilityScore(
    before: PerformanceMetrics,
    after: PerformanceMetrics,
  ): number {
    // Reliability based on error rate stability and success rate
    const errorRateChange = after.errorRate - before.errorRate;
    const successRateChange = after.successRate - before.successRate;

    let reliabilityScore = 0.8; // Base reliability

    if (errorRateChange > 0.05) {
      reliabilityScore -= 0.3; // Significant error rate increase
    } else if (errorRateChange < -0.02) {
      reliabilityScore += 0.1; // Error rate decreased
    }

    if (successRateChange < -0.05) {
      reliabilityScore -= 0.2; // Significant success rate drop
    } else if (successRateChange > 0.02) {
      reliabilityScore += 0.1; // Success rate improved
    }

    return Math.max(0, Math.min(1, reliabilityScore));
  }

  private calculateScalabilityScore(
    before: PerformanceMetrics,
    after: PerformanceMetrics,
  ): number {
    // Scalability based on throughput improvement and resource efficiency
    const throughputChange = after.throughput - before.throughput;
    const throughputEfficiency =
      after.throughput / (after.averageResponseTime || 1);

    let scalabilityScore = 0.7; // Base scalability

    if (throughputChange > before.throughput * 0.2) {
      scalabilityScore += 0.2; // Good throughput improvement
    }

    if (throughputEfficiency > 100) {
      scalabilityScore += 0.1; // Good efficiency
    }

    return Math.max(0, Math.min(1, scalabilityScore));
  }

  /**
   * Calculate trend analysis
   */
  calculateTrendAnalysis(
    dataPoints: Array<{ timestamp: Date; value: number }>,
    windowSize: number = 7,
  ): {
    trend: 'increasing' | 'decreasing' | 'stable';
    slope: number;
    rSquared: number;
    confidence: number;
    forecast: number[];
    seasonality: boolean;
    volatility: number;
    changePoints: number[];
  } {
    if (dataPoints.length < windowSize) {
      return {
        trend: 'stable',
        slope: 0,
        rSquared: 0,
        confidence: 0,
        forecast: [],
        seasonality: false,
        volatility: 0,
        changePoints: [],
      };
    }

    // Sort data points by timestamp
    const sortedPoints = [...dataPoints].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
    const values = sortedPoints.map((dp) => dp.value);
    const n = values.length;

    // Simple linear regression
    const x = Array.from({ length: n }, (_, i) => i);
    const y = values;

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R-squared
    const yMean = sumY / n;
    const ssRes = y.reduce((sum, yi, i) => {
      const predicted = slope * x[i] + intercept;
      return sum + Math.pow(yi - predicted, 2);
    }, 0);
    const ssTot = y.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
    const rSquared = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;

    // Determine trend with more sophisticated analysis
    let trend: 'increasing' | 'decreasing' | 'stable';
    const slopeThreshold = this.calculateDynamicThreshold(values);

    if (Math.abs(slope) < slopeThreshold) {
      trend = 'stable';
    } else if (slope > 0) {
      trend = 'increasing';
    } else {
      trend = 'decreasing';
    }

    // Calculate volatility (coefficient of variation)
    const mean = yMean;
    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / n;
    const stdDev = Math.sqrt(variance);
    const volatility = mean > 0 ? stdDev / mean : 0;

    // Detect seasonality (simple autocorrelation check)
    const seasonality = this.detectSeasonality(values, windowSize);

    // Find change points using simple differencing
    const changePoints = this.detectChangePoints(values, slopeThreshold * 2);

    // Enhanced forecast with confidence intervals
    const forecast = this.generateForecastWithConfidence(
      values,
      slope,
      intercept,
      5,
    );

    const confidence = Math.min(rSquared * (1 - volatility), 1);

    return {
      trend,
      slope,
      rSquared,
      confidence,
      forecast,
      seasonality,
      volatility,
      changePoints,
    };
  }

  private calculateDynamicThreshold(values: number[]): number {
    // Calculate threshold based on data variability
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
      values.length;
    const stdDev = Math.sqrt(variance);

    // Threshold is 0.5 standard deviations from mean slope
    return stdDev * 0.5;
  }

  private detectSeasonality(values: number[], windowSize: number): boolean {
    if (values.length < windowSize * 2) return false;

    // Simple autocorrelation check
    const mean = values.reduce((a, b) => a + b, 0) / values.length;

    // Calculate autocorrelation at lag = windowSize
    let numerator = 0;
    let denominator = 0;

    for (let i = windowSize; i < values.length; i++) {
      numerator += (values[i] - mean) * (values[i - windowSize] - mean);
      denominator += Math.pow(values[i] - mean, 2);
    }

    const autocorrelation = denominator > 0 ? numerator / denominator : 0;

    return Math.abs(autocorrelation) > 0.6; // Threshold for seasonality detection
  }

  private detectChangePoints(values: number[], threshold: number): number[] {
    const changePoints: number[] = [];
    const differences = [];

    // Calculate first differences
    for (let i = 1; i < values.length; i++) {
      differences.push(Math.abs(values[i] - values[i - 1]));
    }

    // Find points where difference exceeds threshold
    for (let i = 0; i < differences.length; i++) {
      if (differences[i] > threshold) {
        changePoints.push(i + 1); // +1 because differences are between indices
      }
    }

    return changePoints;
  }

  private generateForecastWithConfidence(
    values: number[],
    slope: number,
    intercept: number,
    periods: number,
  ): number[] {
    const forecast: number[] = [];
    const n = values.length;

    // Calculate standard error of regression
    const yMean = values.reduce((a, b) => a + b, 0) / n;
    const ssRes = values.reduce((sum, yi, i) => {
      const predicted = slope * i + intercept;
      return sum + Math.pow(yi - predicted, 2);
    }, 0);
    const standardError = Math.sqrt(ssRes / (n - 2));

    // Generate forecast with basic confidence adjustment
    for (let i = 0; i < periods; i++) {
      const predicted = slope * (n + i) + intercept;

      // Add some uncertainty for longer forecasts
      const uncertainty =
        standardError *
        Math.sqrt(
          1 +
            1 / n +
            Math.pow(i + 1, 2) /
              values.reduce(
                (sum, _, idx) => sum + Math.pow(idx - (n - 1) / 2, 2),
                0,
              ),
        );

      forecast.push(predicted);
    }

    return forecast;
  }

  /**
   * Calculate percentile values
   */
  calculatePercentiles(values: number[], percentiles: number[]): number[] {
    if (values.length === 0) return percentiles.map(() => 0);

    const sorted = [...values].sort((a, b) => a - b);

    return percentiles.map((p) => {
      const index = (p / 100) * (sorted.length - 1);
      const lower = Math.floor(index);
      const upper = Math.ceil(index);

      if (lower === upper) {
        return sorted[lower];
      }

      const weight = index - lower;
      return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    });
  }

  /**
   * Calculate moving averages
   */
  calculateMovingAverage(values: number[], windowSize: number): number[] {
    if (values.length < windowSize) return values;

    const result: number[] = [];
    for (let i = windowSize - 1; i < values.length; i++) {
      const window = values.slice(i - windowSize + 1, i + 1);
      const average = window.reduce((sum, val) => sum + val, 0) / windowSize;
      result.push(average);
    }

    return result;
  }

  /**
   * Calculate correlation coefficient between two datasets
   */
  calculateCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length === 0) return 0;

    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
    const sumYY = y.reduce((sum, yi) => sum + yi * yi, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt(
      (n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY),
    );

    return denominator === 0 ? 0 : numerator / denominator;
  }

  /**
   * Get empty performance metrics
   */
  private getEmptyPerformanceMetrics(): PerformanceMetrics {
    return {
      averageResponseTime: 0,
      p95ResponseTime: 0,
      successRate: 0,
      throughput: 0,
      errorRate: 1,
      costPerRequest: 0,
      tokenEfficiency: 0,
    };
  }

  /**
   * Get empty statistics
   */
  private getEmptyStatistics(): ReturnType<
    CalculationUtilsService['calculateStatistics']
  > {
    return {
      mean: 0,
      median: 0,
      mode: [],
      standardDeviation: 0,
      variance: 0,
      min: 0,
      max: 0,
      quartiles: [0, 0, 0],
      skewness: 0,
      kurtosis: 0,
    };
  }
}
