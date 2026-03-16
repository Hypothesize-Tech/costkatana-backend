import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  RequestFeedback,
  RequestFeedbackDocument,
} from '../../schemas/analytics/request-feedback.schema';
import { Usage, UsageDocument } from '../../schemas/core/usage.schema';

export interface FeedbackData {
  rating: boolean;
  comment?: string;
  implicitSignals?: {
    copied?: boolean;
    conversationContinued?: boolean;
    immediateRephrase?: boolean;
    sessionDuration?: number;
    codeAccepted?: boolean;
  };
  userAgent?: string;
  ipAddress?: string;
}

export interface FeedbackAnalytics {
  totalRequests: number;
  ratedRequests: number;
  positiveRatings: number;
  negativeRatings: number;
  totalCost: number;
  positiveCost: number;
  negativeCost: number;
  averageRating: number;
  costPerPositiveRating: number;
  costPerNegativeRating: number;
  ratingsByProvider: Record<
    string,
    { positive: number; negative: number; cost: number }
  >;
  ratingsByModel: Record<
    string,
    { positive: number; negative: number; cost: number }
  >;
  ratingsByFeature: Record<
    string,
    { positive: number; negative: number; cost: number }
  >;
  implicitSignalsAnalysis: {
    copyRate: number;
    continuationRate: number;
    rephraseRate: number;
    codeAcceptanceRate: number;
    averageSessionDuration: number;
  };
  costSavedFromBlocked?: number;
}

interface AggregationBasicStats {
  totalRequests: number;
  positiveRatings: number;
  negativeRatings: number;
  totalCost: number;
  positiveCost: number;
  negativeCost: number;
}

interface AggregationImplicitStats {
  totalWithSignals: number;
  copiedCount: number;
  continuedCount: number;
  rephrasedCount: number;
  codeAcceptedCount: number;
  totalSessionDuration: number;
}

@Injectable()
export class RequestFeedbackService {
  private readonly logger = new Logger(RequestFeedbackService.name);

  private dbFailureCount = 0;
  private lastDbFailureTime = 0;
  private readonly MAX_DB_FAILURES = 5;
  private readonly CIRCUIT_BREAKER_RESET_TIME = 300_000; // 5 minutes

  constructor(
    @InjectModel(RequestFeedback.name)
    private readonly requestFeedbackModel: Model<RequestFeedbackDocument>,
    @InjectModel(Usage.name)
    private readonly usageModel: Model<UsageDocument>,
  ) {}

  async submitFeedback(
    requestId: string,
    userId: string,
    feedbackData: FeedbackData,
  ): Promise<void> {
    const existing = await this.requestFeedbackModel.findOne({ requestId });
    if (existing) {
      throw new Error('Feedback already exists for this request');
    }

    const usageRecord = await this.usageModel
      .findOne({ 'metadata.requestId': requestId })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    const feedbackRecord = new this.requestFeedbackModel({
      requestId,
      userId,
      rating: feedbackData.rating,
      comment: feedbackData.comment,
      modelName: usageRecord?.model,
      provider: usageRecord?.service,
      cost: usageRecord?.cost,
      tokens: (usageRecord as any)?.totalTokens,
      implicitSignals: feedbackData.implicitSignals,
      userAgent: feedbackData.userAgent,
      ipAddress: feedbackData.ipAddress,
      feature: (usageRecord as any)?.metadata?.feature,
    });

    await feedbackRecord.save();

    this.logger.log('Feedback submitted successfully', {
      requestId,
      userId,
      rating: feedbackData.rating,
      cost: usageRecord?.cost,
    });
  }

  async getFeedbackAnalytics(userId: string): Promise<FeedbackAnalytics> {
    if (this.isDbCircuitBreakerOpen()) {
      throw new Error('Database circuit breaker is open');
    }

    try {
      const results = await this.requestFeedbackModel.aggregate([
        { $match: { userId } },
        {
          $facet: {
            basicStats: [
              {
                $group: {
                  _id: null,
                  totalRequests: { $sum: 1 },
                  positiveRatings: { $sum: { $cond: ['$rating', 1, 0] } },
                  negativeRatings: { $sum: { $cond: ['$rating', 0, 1] } },
                  totalCost: { $sum: { $ifNull: ['$cost', 0] } },
                  positiveCost: {
                    $sum: { $cond: ['$rating', { $ifNull: ['$cost', 0] }, 0] },
                  },
                  negativeCost: {
                    $sum: { $cond: ['$rating', 0, { $ifNull: ['$cost', 0] }] },
                  },
                },
              },
            ],
            byProvider: [
              {
                $group: {
                  _id: { $ifNull: ['$provider', 'unknown'] },
                  positive: { $sum: { $cond: ['$rating', 1, 0] } },
                  negative: { $sum: { $cond: ['$rating', 0, 1] } },
                  cost: { $sum: { $ifNull: ['$cost', 0] } },
                },
              },
            ],
            byModel: [
              {
                $group: {
                  _id: { $ifNull: ['$modelName', 'unknown'] },
                  positive: { $sum: { $cond: ['$rating', 1, 0] } },
                  negative: { $sum: { $cond: ['$rating', 0, 1] } },
                  cost: { $sum: { $ifNull: ['$cost', 0] } },
                },
              },
            ],
            byFeature: [
              {
                $group: {
                  _id: { $ifNull: ['$feature', 'unknown'] },
                  positive: { $sum: { $cond: ['$rating', 1, 0] } },
                  negative: { $sum: { $cond: ['$rating', 0, 1] } },
                  cost: { $sum: { $ifNull: ['$cost', 0] } },
                },
              },
            ],
            implicitSignals: [
              { $match: { implicitSignals: { $exists: true, $ne: null } } },
              {
                $group: {
                  _id: null,
                  totalWithSignals: { $sum: 1 },
                  copiedCount: {
                    $sum: { $cond: ['$implicitSignals.copied', 1, 0] },
                  },
                  continuedCount: {
                    $sum: {
                      $cond: ['$implicitSignals.conversationContinued', 1, 0],
                    },
                  },
                  rephrasedCount: {
                    $sum: {
                      $cond: ['$implicitSignals.immediateRephrase', 1, 0],
                    },
                  },
                  codeAcceptedCount: {
                    $sum: { $cond: ['$implicitSignals.codeAccepted', 1, 0] },
                  },
                  totalSessionDuration: {
                    $sum: { $ifNull: ['$implicitSignals.sessionDuration', 0] },
                  },
                },
              },
            ],
          },
        },
      ]);

      const result = results[0];
      if (!result?.basicStats?.length) {
        return this.getEmptyAnalytics();
      }

      const basicStats = result.basicStats[0] as AggregationBasicStats;
      const implicitStats = (result.implicitSignals[0] || {
        totalWithSignals: 0,
        copiedCount: 0,
        continuedCount: 0,
        rephrasedCount: 0,
        codeAcceptedCount: 0,
        totalSessionDuration: 0,
      }) as AggregationImplicitStats;

      const ratingsByProvider = this.mapFacetToRecord(result.byProvider);
      const ratingsByModel = this.mapFacetToRecord(result.byModel);
      const ratingsByFeature = this.mapFacetToRecord(result.byFeature);

      const implicitSignalsAnalysis = {
        copyRate:
          implicitStats.totalWithSignals > 0
            ? implicitStats.copiedCount / implicitStats.totalWithSignals
            : 0,
        continuationRate:
          implicitStats.totalWithSignals > 0
            ? implicitStats.continuedCount / implicitStats.totalWithSignals
            : 0,
        rephraseRate:
          implicitStats.totalWithSignals > 0
            ? implicitStats.rephrasedCount / implicitStats.totalWithSignals
            : 0,
        codeAcceptanceRate:
          implicitStats.totalWithSignals > 0
            ? implicitStats.codeAcceptedCount / implicitStats.totalWithSignals
            : 0,
        averageSessionDuration:
          implicitStats.totalWithSignals > 0
            ? implicitStats.totalSessionDuration /
              implicitStats.totalWithSignals
            : 0,
      };

      this.dbFailureCount = 0;

      return {
        totalRequests: basicStats.totalRequests,
        ratedRequests: basicStats.totalRequests,
        positiveRatings: basicStats.positiveRatings,
        negativeRatings: basicStats.negativeRatings,
        totalCost: basicStats.totalCost,
        positiveCost: basicStats.positiveCost,
        negativeCost: basicStats.negativeCost,
        averageRating:
          basicStats.totalRequests > 0
            ? basicStats.positiveRatings / basicStats.totalRequests
            : 0,
        costPerPositiveRating:
          basicStats.positiveRatings > 0
            ? basicStats.positiveCost / basicStats.positiveRatings
            : 0,
        costPerNegativeRating:
          basicStats.negativeRatings > 0
            ? basicStats.negativeCost / basicStats.negativeRatings
            : 0,
        ratingsByProvider,
        ratingsByModel,
        ratingsByFeature,
        implicitSignalsAnalysis,
      };
    } catch (error) {
      this.recordDbFailure();
      this.logger.error('Error getting feedback analytics', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getGlobalFeedbackAnalytics(): Promise<FeedbackAnalytics> {
    if (this.isDbCircuitBreakerOpen()) {
      throw new Error('Database circuit breaker is open');
    }

    try {
      const results = await this.requestFeedbackModel.aggregate([
        {
          $facet: {
            basicStats: [
              {
                $group: {
                  _id: null,
                  totalRequests: { $sum: 1 },
                  positiveRatings: { $sum: { $cond: ['$rating', 1, 0] } },
                  negativeRatings: { $sum: { $cond: ['$rating', 0, 1] } },
                  totalCost: { $sum: { $ifNull: ['$cost', 0] } },
                  positiveCost: {
                    $sum: { $cond: ['$rating', { $ifNull: ['$cost', 0] }, 0] },
                  },
                  negativeCost: {
                    $sum: { $cond: ['$rating', 0, { $ifNull: ['$cost', 0] }] },
                  },
                },
              },
            ],
            byProvider: [
              {
                $group: {
                  _id: { $ifNull: ['$provider', 'unknown'] },
                  positive: { $sum: { $cond: ['$rating', 1, 0] } },
                  negative: { $sum: { $cond: ['$rating', 0, 1] } },
                  cost: { $sum: { $ifNull: ['$cost', 0] } },
                },
              },
            ],
            byModel: [
              {
                $group: {
                  _id: { $ifNull: ['$modelName', 'unknown'] },
                  positive: { $sum: { $cond: ['$rating', 1, 0] } },
                  negative: { $sum: { $cond: ['$rating', 0, 1] } },
                  cost: { $sum: { $ifNull: ['$cost', 0] } },
                },
              },
            ],
            byFeature: [
              {
                $group: {
                  _id: { $ifNull: ['$feature', 'unknown'] },
                  positive: { $sum: { $cond: ['$rating', 1, 0] } },
                  negative: { $sum: { $cond: ['$rating', 0, 1] } },
                  cost: { $sum: { $ifNull: ['$cost', 0] } },
                },
              },
            ],
            implicitSignals: [
              { $match: { implicitSignals: { $exists: true, $ne: null } } },
              {
                $group: {
                  _id: null,
                  totalWithSignals: { $sum: 1 },
                  copiedCount: {
                    $sum: { $cond: ['$implicitSignals.copied', 1, 0] },
                  },
                  continuedCount: {
                    $sum: {
                      $cond: ['$implicitSignals.conversationContinued', 1, 0],
                    },
                  },
                  rephrasedCount: {
                    $sum: {
                      $cond: ['$implicitSignals.immediateRephrase', 1, 0],
                    },
                  },
                  codeAcceptedCount: {
                    $sum: { $cond: ['$implicitSignals.codeAccepted', 1, 0] },
                  },
                  totalSessionDuration: {
                    $sum: { $ifNull: ['$implicitSignals.sessionDuration', 0] },
                  },
                },
              },
            ],
          },
        },
      ]);

      const result = results[0];
      if (!result?.basicStats?.length) {
        return this.getEmptyAnalytics();
      }

      const basicStats = result.basicStats[0] as AggregationBasicStats;
      const implicitStats = (result.implicitSignals[0] || {
        totalWithSignals: 0,
        copiedCount: 0,
        continuedCount: 0,
        rephrasedCount: 0,
        codeAcceptedCount: 0,
        totalSessionDuration: 0,
      }) as AggregationImplicitStats;

      const ratingsByProvider = this.mapFacetToRecord(result.byProvider);
      const ratingsByModel = this.mapFacetToRecord(result.byModel);
      const ratingsByFeature = this.mapFacetToRecord(result.byFeature);

      const implicitSignalsAnalysis = {
        copyRate:
          implicitStats.totalWithSignals > 0
            ? implicitStats.copiedCount / implicitStats.totalWithSignals
            : 0,
        continuationRate:
          implicitStats.totalWithSignals > 0
            ? implicitStats.continuedCount / implicitStats.totalWithSignals
            : 0,
        rephraseRate:
          implicitStats.totalWithSignals > 0
            ? implicitStats.rephrasedCount / implicitStats.totalWithSignals
            : 0,
        codeAcceptanceRate:
          implicitStats.totalWithSignals > 0
            ? implicitStats.codeAcceptedCount / implicitStats.totalWithSignals
            : 0,
        averageSessionDuration:
          implicitStats.totalWithSignals > 0
            ? implicitStats.totalSessionDuration /
              implicitStats.totalWithSignals
            : 0,
      };

      this.dbFailureCount = 0;

      return {
        totalRequests: basicStats.totalRequests,
        ratedRequests: basicStats.totalRequests,
        positiveRatings: basicStats.positiveRatings,
        negativeRatings: basicStats.negativeRatings,
        totalCost: basicStats.totalCost,
        positiveCost: basicStats.positiveCost,
        negativeCost: basicStats.negativeCost,
        averageRating:
          basicStats.totalRequests > 0
            ? basicStats.positiveRatings / basicStats.totalRequests
            : 0,
        costPerPositiveRating:
          basicStats.positiveRatings > 0
            ? basicStats.positiveCost / basicStats.positiveRatings
            : 0,
        costPerNegativeRating:
          basicStats.negativeRatings > 0
            ? basicStats.negativeCost / basicStats.negativeRatings
            : 0,
        ratingsByProvider,
        ratingsByModel,
        ratingsByFeature,
        implicitSignalsAnalysis,
      };
    } catch (error) {
      this.recordDbFailure();
      this.logger.error('Error getting global feedback analytics', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getFeedbackByRequestId(
    requestId: string,
  ): Promise<RequestFeedbackDocument | null> {
    const doc = await this.requestFeedbackModel
      .findOne({ requestId })
      .lean()
      .exec();
    return doc as RequestFeedbackDocument | null;
  }

  async updateImplicitSignals(
    requestId: string,
    signals: {
      copied?: boolean;
      conversationContinued?: boolean;
      immediateRephrase?: boolean;
      sessionDuration?: number;
      codeAccepted?: boolean;
    },
  ): Promise<void> {
    await this.requestFeedbackModel
      .findOneAndUpdate(
        { requestId },
        {
          $set: {
            'implicitSignals.copied': signals.copied,
            'implicitSignals.conversationContinued':
              signals.conversationContinued,
            'implicitSignals.immediateRephrase': signals.immediateRephrase,
            'implicitSignals.sessionDuration': signals.sessionDuration,
            'implicitSignals.codeAccepted': signals.codeAccepted,
          },
        },
        { upsert: false },
      )
      .exec();

    this.logger.log('Implicit signals updated', { requestId, signals });
  }

  recordDbFailure(): void {
    this.dbFailureCount++;
    this.lastDbFailureTime = Date.now();
  }

  private getEmptyAnalytics(): FeedbackAnalytics {
    return {
      totalRequests: 0,
      ratedRequests: 0,
      positiveRatings: 0,
      negativeRatings: 0,
      totalCost: 0,
      positiveCost: 0,
      negativeCost: 0,
      averageRating: 0,
      costPerPositiveRating: 0,
      costPerNegativeRating: 0,
      ratingsByProvider: {},
      ratingsByModel: {},
      ratingsByFeature: {},
      implicitSignalsAnalysis: {
        copyRate: 0,
        continuationRate: 0,
        rephraseRate: 0,
        codeAcceptanceRate: 0,
        averageSessionDuration: 0,
      },
    };
  }

  private isDbCircuitBreakerOpen(): boolean {
    if (this.dbFailureCount >= this.MAX_DB_FAILURES) {
      const elapsed = Date.now() - this.lastDbFailureTime;
      if (elapsed < this.CIRCUIT_BREAKER_RESET_TIME) {
        return true;
      }
      this.dbFailureCount = 0;
    }
    return false;
  }

  private mapFacetToRecord(
    facet: Array<{
      _id: string;
      positive: number;
      negative: number;
      cost: number;
    }>,
  ): Record<string, { positive: number; negative: number; cost: number }> {
    const record: Record<
      string,
      { positive: number; negative: number; cost: number }
    > = {};
    for (const item of facet || []) {
      record[item._id] = {
        positive: item.positive,
        negative: item.negative,
        cost: item.cost,
      };
    }
    return record;
  }
}
