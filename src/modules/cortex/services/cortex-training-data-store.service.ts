/**
 * Cortex Training Data Store Service (NestJS)
 * Production service for training data API: stats, export, feedback.
 * Matches Express CortexTrainingDataCollectorService API for getStats, exportTrainingData, addUserFeedback.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CortexTrainingData,
  CortexTrainingDataDocument,
} from '../../../schemas/core/cortex-training-data.schema';

export interface ExportFilters {
  startDate?: Date;
  endDate?: Date;
  userId?: string;
  complexity?: 'simple' | 'medium' | 'complex';
  minTokenReduction?: number;
  limit?: number;
}

export interface UserFeedbackData {
  rating?: number;
  isSuccessful?: boolean;
  improvementSuggestions?: string[];
}

@Injectable()
export class CortexTrainingDataStoreService {
  private readonly logger = new Logger(CortexTrainingDataStoreService.name);

  constructor(
    @InjectModel(CortexTrainingData.name)
    private readonly cortexTrainingDataModel: Model<CortexTrainingDataDocument>,
  ) {}

  /**
   * Get training data statistics (production parity with Express getStats).
   */
  async getStats(): Promise<{
    totalCollected: number;
    successfulSaves: number;
    failedSaves: number;
    averageProcessingTime: number;
    batchesProcessed: number;
    queueSize: number;
    batchQueueSize: number;
  }> {
    const totalCollected = await this.cortexTrainingDataModel
      .countDocuments()
      .exec();
    const withPerf = await this.cortexTrainingDataModel
      .countDocuments({
        'performance.totalProcessingTime': { $exists: true, $ne: null },
      })
      .exec();
    const avgResult = await this.cortexTrainingDataModel
      .aggregate<{
        avg: number;
      }>([
        {
          $match: {
            'performance.totalProcessingTime': { $exists: true, $gt: 0 },
          },
        },
        {
          $group: {
            _id: null,
            avg: { $avg: '$performance.totalProcessingTime' },
          },
        },
      ])
      .exec();
    const averageProcessingTime = avgResult[0]?.avg ?? 0;
    return {
      totalCollected,
      successfulSaves: totalCollected,
      failedSaves: 0,
      averageProcessingTime: Math.round(averageProcessingTime * 100) / 100,
      batchesProcessed: Math.ceil(totalCollected / 50),
      queueSize: 0,
      batchQueueSize: 0,
    };
  }

  /**
   * Export training data for model training (production parity with Express exportTrainingData).
   */
  async exportTrainingData(
    filters: ExportFilters = {},
  ): Promise<Record<string, unknown>[]> {
    const query: Record<string, unknown> = {};

    if (filters.startDate || filters.endDate) {
      query.timestamp = {};
      if (filters.startDate)
        (query.timestamp as Record<string, Date>).$gte = filters.startDate;
      if (filters.endDate)
        (query.timestamp as Record<string, Date>).$lte = filters.endDate;
    }

    if (filters.userId) query.userId = filters.userId;
    if (filters.complexity) query['context.complexity'] = filters.complexity;
    if (filters.minTokenReduction != null) {
      query['performance.tokenReductionPercentage'] = {
        $gte: filters.minTokenReduction,
      };
    }

    const data = await this.cortexTrainingDataModel
      .find(query)
      .sort({ timestamp: -1 })
      .limit(filters.limit ?? 1000)
      .lean()
      .exec();

    this.logger.log(
      `Exported Cortex training data count=${data.length} filters=${JSON.stringify(filters)}`,
    );
    return data as Record<string, unknown>[];
  }

  /**
   * Add user feedback to existing training data (production parity with Express addUserFeedback).
   */
  async addUserFeedback(
    sessionId: string,
    feedback: UserFeedbackData,
  ): Promise<void> {
    const update: Record<string, unknown> = {};
    if (feedback.rating != null)
      update['trainingLabels.userFeedback'] = feedback.rating;
    if (feedback.isSuccessful != null)
      update['trainingLabels.isSuccessful'] = feedback.isSuccessful;
    if (feedback.improvementSuggestions != null) {
      update['trainingLabels.improvementSuggestions'] =
        feedback.improvementSuggestions;
    }
    if (Object.keys(update).length === 0) return;

    const result = await this.cortexTrainingDataModel
      .updateOne({ sessionId }, { $set: update })
      .exec();

    if (result.matchedCount === 0) {
      this.logger.warn(
        `No training data found for sessionId=${sessionId} to add feedback`,
      );
      return;
    }
    this.logger.debug(
      `User feedback added sessionId=${sessionId} rating=${feedback.rating}`,
    );
  }

  /**
   * Get basic insights for GET /insights (optimized, returns immediately).
   */
  async getBasicInsights(
    filters: ExportFilters,
    userId: string,
    isAdmin: boolean,
  ): Promise<{
    totalSessions: number;
    averageTokenReduction: number;
    averageProcessingTime: number;
    averageCostSavings: number;
    complexityBreakdown: { simple: number; medium: number; complex: number };
    successRate: number;
    averageUserRating: number;
    modelUsage: Record<
      string,
      {
        usage: Record<string, number>;
        averageProcessingTime: Record<string, number>;
      }
    >;
    isBasicStats: boolean;
  }> {
    const query: Record<string, unknown> = {};
    if (filters.startDate || filters.endDate) {
      query.timestamp = {};
      if (filters.startDate)
        (query.timestamp as Record<string, Date>).$gte = filters.startDate;
      if (filters.endDate)
        (query.timestamp as Record<string, Date>).$lte = filters.endDate;
    }
    if (!isAdmin && userId) query.userId = userId;

    const limited = await this.cortexTrainingDataModel
      .find(query)
      .sort({ timestamp: -1 })
      .limit(1000)
      .lean()
      .exec();

    const totalSessions = limited.length;
    const avgTokenReduction =
      totalSessions > 0
        ? limited.reduce(
            (sum, d) =>
              sum + ((d.performance as any)?.tokenReductionPercentage ?? 0),
            0,
          ) / totalSessions
        : 0;
    const avgProcessingTime =
      totalSessions > 0
        ? limited.reduce(
            (sum, d) =>
              sum + ((d.performance as any)?.totalProcessingTime ?? 0),
            0,
          ) / totalSessions
        : 0;
    const avgCostSavings =
      totalSessions > 0
        ? limited.reduce(
            (sum, d) => sum + ((d.performance as any)?.costSavings ?? 0),
            0,
          ) / totalSessions
        : 0;
    const complexityBreakdown = {
      simple: limited.filter((d) => (d.context as any)?.complexity === 'simple')
        .length,
      medium: limited.filter((d) => (d.context as any)?.complexity === 'medium')
        .length,
      complex: limited.filter(
        (d) => (d.context as any)?.complexity === 'complex',
      ).length,
    };
    const successfulSessions = limited.filter(
      (d) => (d.trainingLabels as any)?.isSuccessful !== false,
    ).length;
    const successRate =
      totalSessions > 0 ? successfulSessions / totalSessions : 0;
    const ratedItems = limited.filter(
      (d) => (d.trainingLabels as any)?.userFeedback != null,
    );
    const averageUserRating =
      ratedItems.length > 0
        ? ratedItems.reduce(
            (sum, d) => sum + ((d.trainingLabels as any)?.userFeedback ?? 0),
            0,
          ) / ratedItems.length
        : 0;

    const modelUsage = {
      encoder: {
        usage: {} as Record<string, number>,
        averageProcessingTime: {} as Record<string, number>,
      },
      coreProcessor: {
        usage: {} as Record<string, number>,
        averageProcessingTime: {} as Record<string, number>,
      },
      decoder: {
        usage: {} as Record<string, number>,
        averageProcessingTime: {} as Record<string, number>,
      },
    };
    for (const d of limited) {
      const enc = (d as any).encoderStage?.model;
      const core = (d as any).coreProcessorStage?.model;
      const dec = (d as any).decoderStage?.model;
      if (enc)
        modelUsage.encoder.usage[enc] =
          (modelUsage.encoder.usage[enc] ?? 0) + 1;
      if (core)
        modelUsage.coreProcessor.usage[core] =
          (modelUsage.coreProcessor.usage[core] ?? 0) + 1;
      if (dec)
        modelUsage.decoder.usage[dec] =
          (modelUsage.decoder.usage[dec] ?? 0) + 1;
    }

    return {
      totalSessions,
      averageTokenReduction: Math.round(avgTokenReduction * 100) / 100,
      averageProcessingTime: Math.round(avgProcessingTime * 100) / 100,
      averageCostSavings: Math.round(avgCostSavings * 10000) / 10000,
      complexityBreakdown,
      successRate: Math.round(successRate * 10000) / 10000,
      averageUserRating: Math.round(averageUserRating * 100) / 100,
      modelUsage,
      isBasicStats: true,
    };
  }
}
