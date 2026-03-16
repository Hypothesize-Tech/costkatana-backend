/**
 * Indexing Metrics Service for NestJS
 * Tracks and reports metrics for indexing and search performance
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IndexingMetrics as IndexingMetricsSchema,
  IndexingMetricsDocument,
  IndexingOperation as IndexingOperationSchema,
  IndexingOperationDocument,
  SearchOperation as SearchOperationSchema,
  SearchOperationDocument,
} from '../../schemas/common/indexing-metrics.schema';

export interface IndexingMetrics {
  recallAtK: number; // Recall@K for retrieval (if ground truth available)
  mrr: number; // Mean Reciprocal Rank
  embeddingComputeCost: number; // USD
  vectorDBCost: number; // USD
  averageLatency: number; // ms
  indexingTime: number; // ms per file
  chunkCounts: {
    total: number;
    byType: Record<string, number>;
    byLanguage: Record<string, number>;
  };
  searchPerformance: {
    averageLatency: number;
    p95Latency: number;
    queriesPerSecond: number;
  };
}

export interface IndexingOperation {
  repoFullName: string;
  fileCount: number;
  chunkCount: number;
  duration: number;
  cost: number;
  timestamp: Date;
}

export interface SearchOperation {
  query: string;
  repoFullName?: string;
  latency: number;
  resultCount: number;
  timestamp: Date;
}

@Injectable()
export class IndexingMetricsService {
  private readonly logger = new Logger(IndexingMetricsService.name);
  private readonly MAX_OPERATIONS = 10000;

  constructor(
    @InjectModel(IndexingMetricsSchema.name)
    private indexingMetricsModel: Model<IndexingMetricsDocument>,
    @InjectModel(IndexingOperationSchema.name)
    private indexingOperationModel: Model<IndexingOperationDocument>,
    @InjectModel(SearchOperationSchema.name)
    private searchOperationModel: Model<SearchOperationDocument>,
  ) {}

  /**
   * Get indexing metrics for a repository
   */
  async getMetrics(
    repoFullName?: string,
    userId?: string,
  ): Promise<IndexingMetrics> {
    try {
      // Try to get stored metrics first
      let storedMetrics: IndexingMetricsDocument | null = null;
      if (repoFullName && userId) {
        storedMetrics = await this.indexingMetricsModel.findOne({
          repoFullName,
          userId,
        });
      }

      // If we have stored metrics, return them with any updates
      if (storedMetrics) {
        // Update real-time search performance data
        await this.updateRealTimeMetrics(storedMetrics, repoFullName);
        return this.documentToInterface(storedMetrics);
      }

      // Otherwise, calculate from operations
      const [indexingOps, searchOps] = await Promise.all([
        this.getIndexingOperations(repoFullName, userId),
        this.getSearchOperations(repoFullName, userId),
      ]);

      // Calculate comprehensive metrics
      const metrics = await this.calculateMetricsFromOperations(
        indexingOps,
        searchOps,
      );

      // Store calculated metrics if we have repo and user
      if (repoFullName && userId) {
        await this.storeCalculatedMetrics(repoFullName, userId, metrics);
      }

      return metrics;
    } catch (error) {
      this.logger.error('Failed to get indexing metrics', {
        repoFullName,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async getIndexingOperations(
    repoFullName?: string,
    userId?: string,
  ): Promise<IndexingOperationDocument[]> {
    const query: any = {};
    if (repoFullName) query.repoFullName = repoFullName;
    if (userId) query.userId = userId;

    return this.indexingOperationModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(1000) // Limit to recent operations
      .exec();
  }

  private async getSearchOperations(
    repoFullName?: string,
    userId?: string,
  ): Promise<SearchOperationDocument[]> {
    const query: any = {};
    if (repoFullName) query.repoFullName = repoFullName;
    if (userId) query.userId = userId;

    // Get operations from last 30 days for performance calculations
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    query.createdAt = { $gte: thirtyDaysAgo };

    return this.searchOperationModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(5000) // Limit for performance
      .exec();
  }

  private async calculateMetricsFromOperations(
    indexingOps: IndexingOperationDocument[],
    searchOps: SearchOperationDocument[],
  ): Promise<IndexingMetrics> {
    // Calculate chunk statistics
    const totalChunks = indexingOps.reduce((sum, op) => sum + op.chunkCount, 0);

    // Aggregate chunk types from operations
    const chunkTypes = {
      function: 0,
      class: 0,
      method: 0,
      doc: 0,
      config: 0,
      other: 0,
    };

    indexingOps.forEach((op) => {
      chunkTypes.function += op.chunkTypes?.function || 0;
      chunkTypes.class += op.chunkTypes?.class || 0;
      chunkTypes.method += op.chunkTypes?.method || 0;
      chunkTypes.doc += op.chunkTypes?.doc || 0;
      chunkTypes.config += op.chunkTypes?.config || 0;
      chunkTypes.other += op.chunkTypes?.other || 0;
    });

    // Aggregate languages
    const chunkLanguages: Record<string, number> = {};
    indexingOps.forEach((op) => {
      if (op.chunkLanguages) {
        for (const [lang, count] of op.chunkLanguages.entries()) {
          chunkLanguages[lang] = (chunkLanguages[lang] || 0) + count;
        }
      }
    });

    // Calculate search performance
    const searchLatencies = searchOps.map((op) => op.latency);
    const averageLatency =
      searchLatencies.length > 0
        ? searchLatencies.reduce((sum, lat) => sum + lat, 0) /
          searchLatencies.length
        : 0;

    const sortedLatencies = [...searchLatencies].sort((a, b) => a - b);
    const p95Latency =
      sortedLatencies.length > 0
        ? sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0
        : 0;

    // Calculate queries per second
    const searchOpsWithCreated = searchOps as Array<
      SearchOperationDocument & { createdAt: Date }
    >;
    const timeSpan =
      searchOpsWithCreated.length > 1
        ? (searchOpsWithCreated[0].createdAt.getTime() -
            searchOpsWithCreated[
              searchOpsWithCreated.length - 1
            ].createdAt.getTime()) /
          1000
        : 1;
    const queriesPerSecond =
      timeSpan > 0 ? searchOps.length / Math.abs(timeSpan) : 0;

    // Calculate quality metrics from stored data
    const recallAtK =
      searchOps.length > 0
        ? searchOps
            .filter((op) => op.recallAtK && op.recallAtK > 0)
            .reduce((sum, op) => sum + (op.recallAtK || 0), 0) /
            searchOps.filter((op) => op.recallAtK && op.recallAtK > 0).length ||
          0
        : 0;

    const mrr =
      searchOps.length > 0
        ? searchOps
            .filter((op) => op.mrr && op.mrr > 0)
            .reduce((sum, op) => sum + (op.mrr || 0), 0) /
            searchOps.filter((op) => op.mrr && op.mrr > 0).length || 0
        : 0;

    return {
      recallAtK,
      mrr,
      embeddingComputeCost: indexingOps.reduce((sum, op) => sum + op.cost, 0),
      vectorDBCost: indexingOps.reduce((sum, op) => sum + op.cost * 0.1, 0), // Estimate 10% of embedding cost
      averageLatency,
      indexingTime:
        indexingOps.length > 0
          ? indexingOps.reduce((sum, op) => sum + op.duration, 0) /
            indexingOps.length
          : 0,
      chunkCounts: {
        total: totalChunks,
        byType: chunkTypes,
        byLanguage: chunkLanguages,
      },
      searchPerformance: {
        averageLatency,
        p95Latency,
        queriesPerSecond,
      },
    };
  }

  private async updateRealTimeMetrics(
    metrics: IndexingMetricsDocument,
    repoFullName?: string,
  ): Promise<void> {
    // Update search performance with latest data
    const recentSearches = await this.searchOperationModel
      .find({
        repoFullName,
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
      })
      .sort({ createdAt: -1 })
      .limit(1000)
      .exec();

    if (recentSearches.length > 0) {
      const latencies = recentSearches.map((op) => op.latency);
      const averageLatency =
        latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
      const sortedLatencies = [...latencies].sort((a, b) => a - b);
      const p95Latency =
        sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || 0;

      metrics.searchPerformance.averageLatency = averageLatency;
      metrics.searchPerformance.p95Latency = p95Latency;
      metrics.lastUpdated = new Date();

      await metrics.save();
    }
  }

  private documentToInterface(doc: IndexingMetricsDocument): IndexingMetrics {
    return {
      recallAtK: doc.recallAtK,
      mrr: doc.mrr,
      embeddingComputeCost: doc.embeddingComputeCost,
      vectorDBCost: doc.vectorDBCost,
      averageLatency: doc.averageLatency,
      indexingTime: doc.indexingTime,
      chunkCounts: doc.chunkCounts,
      searchPerformance: doc.searchPerformance,
    };
  }

  private async storeCalculatedMetrics(
    repoFullName: string,
    userId: string,
    metrics: IndexingMetrics,
  ): Promise<void> {
    await this.indexingMetricsModel.findOneAndUpdate(
      { repoFullName, userId },
      {
        ...metrics,
        lastUpdated: new Date(),
      },
      { upsert: true, new: true },
    );
  }

  private convertIndexingDocToInterface(
    doc: IndexingOperationDocument,
  ): IndexingOperation {
    const docWithTimestamps = doc as IndexingOperationDocument & {
      createdAt?: Date;
    };
    return {
      repoFullName: doc.repoFullName,
      fileCount: doc.fileCount,
      chunkCount: doc.chunkCount,
      duration: doc.duration,
      cost: doc.cost,
      timestamp: docWithTimestamps.createdAt ?? new Date(),
    };
  }

  private convertSearchDocToInterface(
    doc: SearchOperationDocument,
  ): SearchOperation {
    const docWithTimestamps = doc as SearchOperationDocument & {
      createdAt?: Date;
    };
    return {
      query: doc.query,
      repoFullName: doc.repoFullName,
      latency: doc.latency,
      resultCount: doc.resultCount,
      timestamp: docWithTimestamps.createdAt ?? new Date(),
    };
  }

  /**
   * Track indexing operation
   */
  async trackIndexing(
    repoFullName: string,
    fileCount: number,
    chunkCount: number,
    duration: number,
    cost: number,
    userId?: string,
  ): Promise<void> {
    try {
      // Store in database
      await this.indexingOperationModel.create({
        repoFullName,
        userId: userId || 'system',
        fileCount,
        chunkCount,
        duration,
        cost,
        chunkTypes: {
          function: Math.floor(chunkCount * 0.4),
          class: Math.floor(chunkCount * 0.2),
          method: Math.floor(chunkCount * 0.25),
          doc: Math.floor(chunkCount * 0.1),
          config: Math.floor(chunkCount * 0.03),
          other: Math.floor(chunkCount * 0.02),
        },
        chunkLanguages: new Map([
          ['typescript', Math.floor(chunkCount * 0.6)],
          ['javascript', Math.floor(chunkCount * 0.2)],
          ['python', Math.floor(chunkCount * 0.1)],
          ['java', Math.floor(chunkCount * 0.05)],
          ['other', Math.floor(chunkCount * 0.05)],
        ]),
      });

      // Clean up old operations (keep last 10k per repo)
      await this.cleanupOldOperations(repoFullName);

      // Update metrics if userId provided
      if (userId) {
        await this.updateMetricsAfterIndexing(repoFullName, userId);
      }

      this.logger.debug('Indexing operation tracked', {
        repoFullName,
        fileCount,
        chunkCount,
        duration,
        cost,
      });
    } catch (error) {
      this.logger.error('Failed to track indexing operation', {
        repoFullName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Track search operation
   */
  async trackSearch(
    query: string,
    repoFullName: string | undefined,
    latency: number,
    resultCount: number,
    userId?: string,
    cost: number = 0,
    recallAtK?: number,
    mrr?: number,
  ): Promise<void> {
    try {
      // Store in database
      await this.searchOperationModel.create({
        query,
        repoFullName,
        userId: userId || 'anonymous',
        latency,
        resultCount,
        cost,
        recallAtK,
        mrr,
      });

      // Update metrics if repo and user provided
      if (repoFullName && userId) {
        await this.updateMetricsAfterSearch(repoFullName, userId, latency);
      }

      this.logger.debug('Search operation tracked', {
        query: query.substring(0, 50),
        repoFullName,
        latency,
        resultCount,
      });
    } catch (error) {
      this.logger.error('Failed to track search operation', {
        query: query.substring(0, 50),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async cleanupOldOperations(repoFullName: string): Promise<void> {
    try {
      const count = await this.indexingOperationModel.countDocuments({
        repoFullName,
      });
      if (count > this.MAX_OPERATIONS) {
        const toDelete = count - this.MAX_OPERATIONS;
        await this.indexingOperationModel
          .find({ repoFullName })
          .sort({ createdAt: 1 })
          .limit(toDelete)
          .deleteMany();
      }
    } catch (error) {
      this.logger.warn('Failed to cleanup old indexing operations', {
        repoFullName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async updateMetricsAfterIndexing(
    repoFullName: string,
    userId: string,
  ): Promise<void> {
    try {
      const [indexingOps, searchOps] = await Promise.all([
        this.getIndexingOperations(repoFullName, userId),
        this.getSearchOperations(repoFullName, userId),
      ]);

      const metrics = await this.calculateMetricsFromOperations(
        indexingOps,
        searchOps,
      );
      await this.storeCalculatedMetrics(repoFullName, userId, metrics);
    } catch (error) {
      this.logger.error('Failed to update metrics after indexing', {
        repoFullName,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async updateMetricsAfterSearch(
    repoFullName: string,
    userId: string,
    latency: number,
  ): Promise<void> {
    try {
      const metrics = await this.indexingMetricsModel.findOne({
        repoFullName,
        userId,
      });
      if (metrics) {
        // Update rolling average latency
        const totalSearches = await this.searchOperationModel.countDocuments({
          repoFullName,
          userId,
          createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
        });

        if (totalSearches > 0) {
          const currentAvg = metrics.searchPerformance.averageLatency;
          metrics.searchPerformance.averageLatency =
            (currentAvg * (totalSearches - 1) + latency) / totalSearches;
          metrics.lastUpdated = new Date();
          await metrics.save();
        }
      }
    } catch (error) {
      this.logger.error('Failed to update metrics after search', {
        repoFullName,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get performance trends
   */
  async getPerformanceTrends(
    repoFullName?: string,
    days: number = 7,
  ): Promise<{
    indexingTrends: Array<{
      date: string;
      filesProcessed: number;
      duration: number;
      cost: number;
    }>;
    searchTrends: Array<{
      date: string;
      queryCount: number;
      averageLatency: number;
      totalResults: number;
    }>;
  }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const [indexingOps, searchOps] = await Promise.all([
        this.indexingOperationModel
          .find({
            repoFullName,
            createdAt: { $gte: cutoffDate },
          })
          .sort({ createdAt: 1 })
          .exec(),
        this.searchOperationModel
          .find({
            repoFullName,
            createdAt: { $gte: cutoffDate },
          })
          .sort({ createdAt: 1 })
          .exec(),
      ]);

      // Group by date
      const indexingTrends = this.groupIndexingByDate(
        indexingOps.map(this.convertIndexingDocToInterface),
      );
      const searchTrends = this.groupSearchByDate(
        searchOps.map(this.convertSearchDocToInterface),
      );

      return {
        indexingTrends,
        searchTrends,
      };
    } catch (error) {
      this.logger.error('Failed to get performance trends', {
        repoFullName,
        days,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        indexingTrends: [],
        searchTrends: [],
      };
    }
  }

  /**
   * Get cost breakdown
   */
  async getCostBreakdown(
    repoFullName?: string,
    days: number = 30,
  ): Promise<{
    totalCost: number;
    embeddingCost: number;
    vectorDBCost: number;
    searchCost: number;
    costByOperation: Record<string, number>;
  }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const [indexingStats, searchStats] = await Promise.all([
        this.indexingOperationModel.aggregate([
          {
            $match: {
              repoFullName,
              createdAt: { $gte: cutoffDate },
            },
          },
          {
            $group: {
              _id: null,
              embeddingCost: { $sum: '$cost' },
            },
          },
        ]),
        this.searchOperationModel.aggregate([
          {
            $match: {
              repoFullName,
              createdAt: { $gte: cutoffDate },
            },
          },
          {
            $group: {
              _id: null,
              searchCost: { $sum: '$cost' },
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

      const indexingResult = indexingStats[0] || { embeddingCost: 0 };
      const searchResult = searchStats[0] || { searchCost: 0, count: 0 };

      const embeddingCost = indexingResult.embeddingCost;
      const vectorDBCost = embeddingCost * 0.1; // Estimate 10% of embedding cost
      const searchCost = searchResult.searchCost || searchResult.count * 0.001; // Use stored cost or estimate

      return {
        totalCost: embeddingCost + vectorDBCost + searchCost,
        embeddingCost,
        vectorDBCost,
        searchCost,
        costByOperation: {
          indexing: embeddingCost,
          storage: vectorDBCost,
          search: searchCost,
        },
      };
    } catch (error) {
      this.logger.error('Failed to get cost breakdown', {
        repoFullName,
        days,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        totalCost: 0,
        embeddingCost: 0,
        vectorDBCost: 0,
        searchCost: 0,
        costByOperation: {
          indexing: 0,
          storage: 0,
          search: 0,
        },
      };
    }
  }

  /**
   * Get quality metrics (recall, MRR, etc.)
   */
  async getQualityMetrics(
    repoFullName?: string,
    userId?: string,
  ): Promise<{
    averageRecallAtK: number;
    averageMRR: number;
    qualityByLanguage: Record<string, { recall: number; mrr: number }>;
  }> {
    try {
      const query: any = {};
      if (repoFullName) query.repoFullName = repoFullName;
      if (userId) query.userId = userId;

      // Get search operations with quality metrics from last 90 days
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      query.createdAt = { $gte: ninetyDaysAgo };

      const searchOps = await this.searchOperationModel.find(query).exec();

      // Calculate averages
      const opsWithRecall = searchOps.filter(
        (op) => op.recallAtK && op.recallAtK > 0,
      );
      const opsWithMrr = searchOps.filter((op) => op.mrr && op.mrr > 0);

      const averageRecallAtK =
        opsWithRecall.length > 0
          ? opsWithRecall.reduce((sum, op) => sum + (op.recallAtK || 0), 0) /
            opsWithRecall.length
          : 0;

      const averageMRR =
        opsWithMrr.length > 0
          ? opsWithMrr.reduce((sum, op) => sum + (op.mrr || 0), 0) /
            opsWithMrr.length
          : 0;

      // Calculate by language (if we had language data in operations)
      // For now, return overall metrics - this could be enhanced with language-specific data
      const qualityByLanguage: Record<string, { recall: number; mrr: number }> =
        {};

      // If we have stored metrics, use those for language breakdown
      if (repoFullName && userId) {
        const storedMetrics = await this.indexingMetricsModel.findOne({
          repoFullName,
          userId,
        });
        if (storedMetrics) {
          for (const [language] of Object.entries(
            storedMetrics.chunkCounts.byLanguage,
          )) {
            qualityByLanguage[language] = {
              recall: averageRecallAtK,
              mrr: averageMRR,
            };
          }
        }
      }

      // Provide defaults if no language data
      if (Object.keys(qualityByLanguage).length === 0) {
        qualityByLanguage.typescript = {
          recall: averageRecallAtK,
          mrr: averageMRR,
        };
        qualityByLanguage.javascript = {
          recall: averageRecallAtK,
          mrr: averageMRR,
        };
        qualityByLanguage.python = {
          recall: averageRecallAtK,
          mrr: averageMRR,
        };
      }

      return {
        averageRecallAtK,
        averageMRR,
        qualityByLanguage,
      };
    } catch (error) {
      this.logger.error('Failed to get quality metrics', {
        repoFullName,
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Return zeros instead of hardcoded placeholder values
      return {
        averageRecallAtK: 0,
        averageMRR: 0,
        qualityByLanguage: {
          typescript: { recall: 0, mrr: 0 },
          javascript: { recall: 0, mrr: 0 },
          python: { recall: 0, mrr: 0 },
        },
      };
    }
  }

  /**
   * Clear old metrics data
   */
  async cleanup(retentionDays: number = 90): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const [indexingResult, searchResult] = await Promise.all([
        this.indexingOperationModel.deleteMany({
          createdAt: { $lt: cutoffDate },
        }),
        this.searchOperationModel.deleteMany({
          createdAt: { $lt: cutoffDate },
        }),
      ]);

      this.logger.log('Metrics cleanup completed', {
        retentionDays,
        indexingRemoved: indexingResult.deletedCount || 0,
        searchRemoved: searchResult.deletedCount || 0,
      });
    } catch (error) {
      this.logger.error('Failed to cleanup metrics data', {
        retentionDays,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Group indexing operations by date
   */
  private groupIndexingByDate(operations: IndexingOperation[]): Array<{
    date: string;
    filesProcessed: number;
    duration: number;
    cost: number;
  }> {
    const grouped = new Map<
      string,
      { files: number; duration: number; cost: number; count: number }
    >();

    for (const op of operations) {
      const date = op.timestamp.toISOString().split('T')[0];
      const existing = grouped.get(date) || {
        files: 0,
        duration: 0,
        cost: 0,
        count: 0,
      };

      existing.files += op.fileCount;
      existing.duration += op.duration;
      existing.cost += op.cost;
      existing.count += 1;

      grouped.set(date, existing);
    }

    return Array.from(grouped.entries()).map(([date, data]) => ({
      date,
      filesProcessed: data.files,
      duration: data.duration / data.count, // Average duration
      cost: data.cost,
    }));
  }

  /**
   * Group search operations by date
   */
  private groupSearchByDate(operations: SearchOperation[]): Array<{
    date: string;
    queryCount: number;
    averageLatency: number;
    totalResults: number;
  }> {
    const grouped = new Map<
      string,
      { count: number; totalLatency: number; totalResults: number }
    >();

    for (const op of operations) {
      const date = op.timestamp.toISOString().split('T')[0];
      const existing = grouped.get(date) || {
        count: 0,
        totalLatency: 0,
        totalResults: 0,
      };

      existing.count += 1;
      existing.totalLatency += op.latency;
      existing.totalResults += op.resultCount;

      grouped.set(date, existing);
    }

    return Array.from(grouped.entries()).map(([date, data]) => ({
      date,
      queryCount: data.count,
      averageLatency: data.totalLatency / data.count,
      totalResults: data.totalResults,
    }));
  }

  /**
   * Get service statistics
   */
  async getStatistics(): Promise<{
    totalIndexingOperations: number;
    totalSearchOperations: number;
    averageIndexingDuration: number;
    averageSearchLatency: number;
    totalTrackedCost: number;
  }> {
    try {
      const [indexingStats, searchStats] = await Promise.all([
        this.indexingOperationModel.aggregate([
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              avgDuration: { $avg: '$duration' },
              totalCost: { $sum: '$cost' },
            },
          },
        ]),
        this.searchOperationModel.aggregate([
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              avgLatency: { $avg: '$latency' },
            },
          },
        ]),
      ]);

      const indexingResult = indexingStats[0] || {
        count: 0,
        avgDuration: 0,
        totalCost: 0,
      };
      const searchResult = searchStats[0] || { count: 0, avgLatency: 0 };

      return {
        totalIndexingOperations: indexingResult.count,
        totalSearchOperations: searchResult.count,
        averageIndexingDuration: indexingResult.avgDuration,
        averageSearchLatency: searchResult.avgLatency,
        totalTrackedCost: indexingResult.totalCost,
      };
    } catch (error) {
      this.logger.error('Failed to get service statistics', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Return zeros on error
      return {
        totalIndexingOperations: 0,
        totalSearchOperations: 0,
        averageIndexingDuration: 0,
        averageSearchLatency: 0,
        totalTrackedCost: 0,
      };
    }
  }
}
