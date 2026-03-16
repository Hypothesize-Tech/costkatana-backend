import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage, UsageDocument } from '../../../schemas/core/usage.schema';

@Injectable()
export class SmartSamplingService {
  private readonly logger = new Logger(SmartSamplingService.name);

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<UsageDocument>,
  ) {}

  /**
   * Generate smart sample of usage data
   */
  async generateSmartSample(
    sampleSize: number = 1000,
    stratificationFields: string[] = ['service', 'model', 'userId'],
    startDate?: Date,
    endDate?: Date,
  ): Promise<any> {
    try {
      const matchQuery: any = {};

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      // Get stratified sample
      const sample = await this.getStratifiedSample(
        sampleSize,
        stratificationFields,
        matchQuery,
      );

      // Calculate sampling statistics
      const statistics = await this.calculateSamplingStatistics(
        sample,
        matchQuery,
      );

      return {
        sample,
        statistics,
        metadata: {
          totalSampleSize: sample.length,
          stratificationFields,
          dateRange: { startDate, endDate },
          generatedAt: new Date(),
        },
      };
    } catch (error) {
      this.logger.error('Error generating smart sample:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'SmartSamplingService',
        operation: 'generateSmartSample',
      });
      throw error;
    }
  }

  /**
   * Get stratified sample
   */
  private async getStratifiedSample(
    sampleSize: number,
    stratificationFields: string[],
    matchQuery: any,
  ): Promise<any[]> {
    try {
      // Get total count for each stratum
      const stratumCounts = await this.usageModel.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: stratificationFields.reduce(
              (acc, field) => {
                acc[field] = `$${field}`;
                return acc;
              },
              {} as Record<string, string>,
            ),
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            stratum: '$_id',
            count: 1,
          },
        },
        { $sort: { count: -1 } },
      ]);

      const totalRecords = stratumCounts.reduce((sum, s) => sum + s.count, 0);
      const sample: any[] = [];

      for (const stratum of stratumCounts) {
        // Calculate proportional sample size for this stratum
        const stratumSampleSize = Math.max(
          1,
          Math.round((stratum.count / totalRecords) * sampleSize),
        );

        // Get sample from this stratum
        const stratumSample = await this.usageModel.aggregate([
          { $match: { ...matchQuery, ...stratum.stratum } },
          { $sample: { size: Math.min(stratumSampleSize, stratum.count) } },
          {
            $project: {
              _id: 1,
              userId: 1,
              projectId: 1,
              service: 1,
              model: 1,
              endpoint: 1,
              cost: 1,
              totalTokens: 1,
              responseTime: 1,
              createdAt: 1,
              stratum: stratum.stratum,
            },
          },
        ]);

        sample.push(...stratumSample);
      }

      // If we have more samples than requested, trim it
      if (sample.length > sampleSize) {
        sample.splice(sampleSize);
      }

      // If we have fewer samples than requested, fill with random samples
      if (sample.length < sampleSize) {
        const remaining = sampleSize - sample.length;
        const additionalSamples = await this.usageModel.aggregate([
          { $match: matchQuery },
          { $sample: { size: remaining } },
          {
            $project: {
              _id: 1,
              userId: 1,
              projectId: 1,
              service: 1,
              model: 1,
              endpoint: 1,
              cost: 1,
              totalTokens: 1,
              responseTime: 1,
              createdAt: 1,
              stratum: null,
            },
          },
        ]);

        sample.push(...additionalSamples);
      }

      return sample;
    } catch (error) {
      this.logger.error('Error getting stratified sample:', error);
      throw error;
    }
  }

  /**
   * Calculate sampling statistics
   */
  private async calculateSamplingStatistics(
    sample: any[],
    originalQuery: any,
  ): Promise<any> {
    try {
      // Get original population statistics
      const populationStats = await this.usageModel.aggregate([
        { $match: originalQuery },
        {
          $group: {
            _id: null,
            totalRecords: { $sum: 1 },
            avgCost: { $avg: '$cost' },
            avgTokens: { $avg: '$totalTokens' },
            avgResponseTime: { $avg: '$responseTime' },
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
          },
        },
      ]);

      // Calculate sample statistics
      const sampleStats = {
        sampleSize: sample.length,
        avgCost:
          sample.length > 0
            ? sample.reduce((sum, s) => sum + (s.cost || 0), 0) / sample.length
            : 0,
        avgTokens:
          sample.length > 0
            ? sample.reduce(
                (sum, s) => sum + (s.tokens || s.totalTokens || 0),
                0,
              ) / sample.length
            : 0,
        avgResponseTime:
          sample.length > 0
            ? sample.reduce((sum, s) => sum + (s.responseTime || 0), 0) /
              sample.length
            : 0,
        totalCost: sample.reduce((sum, s) => sum + (s.cost || 0), 0),
        totalTokens: sample.reduce(
          (sum, s) => sum + (s.tokens || s.totalTokens || 0),
          0,
        ),
      };

      const population = populationStats[0] || {
        totalRecords: 0,
        avgCost: 0,
        avgTokens: 0,
        avgResponseTime: 0,
        totalCost: 0,
        totalTokens: 0,
      };

      // Calculate representativeness metrics
      const representativeness = {
        costBias:
          population.avgCost > 0
            ? ((sampleStats.avgCost - population.avgCost) /
                population.avgCost) *
              100
            : 0,
        tokensBias:
          population.avgTokens > 0
            ? ((sampleStats.avgTokens - population.avgTokens) /
                population.avgTokens) *
              100
            : 0,
        responseTimeBias:
          population.avgResponseTime > 0
            ? ((sampleStats.avgResponseTime - population.avgResponseTime) /
                population.avgResponseTime) *
              100
            : 0,
        samplingRatio:
          population.totalRecords > 0
            ? sample.length / population.totalRecords
            : 0,
      };

      // Calculate stratum representation
      const stratumCounts = new Map<string, number>();
      sample.forEach((s) => {
        const stratumKey = s.stratum
          ? JSON.stringify(s.stratum)
          : 'unstratified';
        stratumCounts.set(stratumKey, (stratumCounts.get(stratumKey) || 0) + 1);
      });

      return {
        population: {
          totalRecords: population.totalRecords,
          avgCost: population.avgCost,
          avgTokens: population.avgTokens,
          avgResponseTime: population.avgResponseTime,
          totalCost: population.totalCost,
          totalTokens: population.totalTokens,
        },
        sample: sampleStats,
        representativeness,
        stratumDistribution: Object.fromEntries(stratumCounts),
      };
    } catch (error) {
      this.logger.error('Error calculating sampling statistics:', error);
      throw error;
    }
  }

  /**
   * Optimize sampling parameters
   */
  async optimizeSamplingParameters(
    targetMetrics: string[] = ['cost', 'tokens', 'responseTime'],
    confidenceLevel: number = 0.95,
    marginOfError: number = 0.05,
    startDate?: Date,
    endDate?: Date,
  ): Promise<any> {
    try {
      const matchQuery: any = {};

      if (startDate || endDate) {
        matchQuery.createdAt = {};
        if (startDate) matchQuery.createdAt.$gte = startDate;
        if (endDate) matchQuery.createdAt.$lte = endDate;
      }

      // Calculate population variance for target metrics
      const varianceStats = await this.usageModel.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            costVariance: { $stdDevSamp: '$cost' },
            tokensVariance: { $stdDevSamp: '$totalTokens' },
            responseTimeVariance: { $stdDevSamp: '$responseTime' },
            avgCost: { $avg: '$cost' },
            avgTokens: { $avg: '$totalTokens' },
            avgResponseTime: { $avg: '$responseTime' },
          },
        },
      ]);

      const stats = varianceStats[0];

      if (!stats || stats.count === 0) {
        throw new Error('No data available for sampling optimization');
      }

      // Calculate required sample size using statistical formula
      // n = (Z^2 * σ^2) / E^2
      // Where Z is confidence level, σ is standard deviation, E is margin of error

      const zScore =
        confidenceLevel === 0.95
          ? 1.96
          : confidenceLevel === 0.99
            ? 2.576
            : 1.96;

      const calculateSampleSize = (variance: number, mean: number) => {
        if (variance === 0 || mean === 0) return stats.count; // Use full population if no variance
        const relativeError = marginOfError * mean; // Absolute error based on mean
        return Math.ceil(
          (zScore * zScore * variance) / (relativeError * relativeError),
        );
      };

      const optimizedSizes = {
        cost: calculateSampleSize(stats.costVariance || 0, stats.avgCost || 1),
        tokens: calculateSampleSize(
          stats.tokensVariance || 0,
          stats.avgTokens || 1,
        ),
        responseTime: calculateSampleSize(
          stats.responseTimeVariance || 0,
          stats.avgResponseTime || 1,
        ),
      };

      // Determine optimal sample size as maximum of required sizes
      const optimalSampleSize = Math.min(
        stats.count, // Don't exceed population
        Math.max(
          ...targetMetrics.map(
            (metric) => optimizedSizes[metric as keyof typeof optimizedSizes],
          ),
        ),
      );

      // Calculate optimal sampling rate
      const optimalSamplingRate = optimalSampleSize / stats.count;

      return {
        populationSize: stats.count,
        optimalSampleSize,
        optimalSamplingRate,
        confidenceLevel,
        marginOfError,
        targetMetrics,
        metricRequirements: optimizedSizes,
        recommendations: {
          samplingRate: Math.max(0.01, Math.min(1.0, optimalSamplingRate)), // Between 1% and 100%
          stratificationFields: ['service', 'model', 'userId'],
          minimumSampleSize: Math.max(100, Math.min(optimalSampleSize, 10000)),
        },
      };
    } catch (error) {
      this.logger.error('Error optimizing sampling parameters:', {
        error: error instanceof Error ? error.message : String(error),
        component: 'SmartSamplingService',
        operation: 'optimizeSamplingParameters',
      });
      throw error;
    }
  }

  /**
   * Get sampling quality metrics
   */
  async getSamplingQualityMetrics(sample: any[]): Promise<any> {
    try {
      if (!Array.isArray(sample) || sample.length === 0) {
        return {
          sampleSize: 0,
          completeness: {
            costData: 0,
            tokensData: 0,
            responseTimeData: 0,
          },
          statistics: {
            cost: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0 },
            tokens: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0 },
            responseTime: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0 },
          },
          distribution: {
            serviceDistribution: {},
            modelDistribution: {},
            endpointDistribution: {},
          },
          recommendedSamplingRate: 0.1,
          quality: 0,
          efficiency: 0,
        };
      }

      // Calculate basic statistics
      const costs = sample.map((s) => s.cost || 0).filter((c) => c > 0);
      const tokens = sample
        .map((s) => s.tokens ?? s.totalTokens ?? 0)
        .filter((t) => t > 0);
      const responseTimes = sample
        .map((s) => s.responseTime || 0)
        .filter((r) => r > 0);

      const calculateStats = (values: number[]) => {
        if (values.length === 0)
          return { mean: 0, median: 0, stdDev: 0, min: 0, max: 0 };

        const sorted = [...values].sort((a, b) => a - b);
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        const median = sorted[Math.floor(sorted.length / 2)];
        const variance =
          values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) /
          values.length;
        const stdDev = Math.sqrt(variance);

        return {
          mean,
          median,
          stdDev,
          min: Math.min(...values),
          max: Math.max(...values),
        };
      };

      return {
        sampleSize: sample.length,
        completeness: {
          costData: costs.length / sample.length,
          tokensData: tokens.length / sample.length,
          responseTimeData: responseTimes.length / sample.length,
        },
        statistics: {
          cost: calculateStats(costs),
          tokens: calculateStats(tokens),
          responseTime: calculateStats(responseTimes),
        },
        distribution: {
          serviceDistribution: this.getDistribution(sample, 'service'),
          modelDistribution: this.getDistribution(sample, 'model'),
          endpointDistribution: this.getDistribution(sample, 'endpoint'),
        },
      };
    } catch (error) {
      this.logger.error('Error calculating sampling quality metrics:', error);
      throw error;
    }
  }

  /**
   * Get distribution of values for a field
   */
  private getDistribution(items: any[], field: string): Record<string, number> {
    const distribution: Record<string, number> = {};

    items.forEach((item) => {
      const value = item[field] || 'unknown';
      distribution[value] = (distribution[value] || 0) + 1;
    });

    return distribution;
  }
}
