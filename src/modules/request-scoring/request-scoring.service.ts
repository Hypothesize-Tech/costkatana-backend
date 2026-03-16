import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  RequestScore,
  RequestScoreDocument,
} from '../../schemas/analytics/request-score.schema';

export interface ScoreRequestData {
  requestId: string;
  score: number;
  notes?: string;
  trainingTags?: string[];
  tokenEfficiency?: number;
  costEfficiency?: number;
}

@Injectable()
export class RequestScoringService {
  private readonly logger = new Logger(RequestScoringService.name);

  constructor(
    @InjectModel(RequestScore.name)
    private requestScoreModel: Model<RequestScoreDocument>,
  ) {}

  // ==================== SCORING ====================

  async scoreRequest(
    userId: string,
    scoreData: ScoreRequestData,
  ): Promise<RequestScore> {
    this.logger.log(
      `Scoring request ${scoreData.requestId} for user ${userId}`,
    );

    // Check if score already exists
    const existingScore = await this.requestScoreModel.findOne({
      requestId: scoreData.requestId,
      userId: new Types.ObjectId(userId),
    });

    if (existingScore) {
      // Update existing score
      Object.assign(existingScore, {
        score: scoreData.score,
        notes: scoreData.notes,
        trainingTags: scoreData.trainingTags,
        tokenEfficiency: scoreData.tokenEfficiency,
        costEfficiency: scoreData.costEfficiency,
        isTrainingCandidate: scoreData.score >= 4,
        updatedAt: new Date(),
      });
      return existingScore.save();
    }

    // Create new score
    const requestScore = new this.requestScoreModel({
      requestId: scoreData.requestId,
      userId: new Types.ObjectId(userId),
      score: scoreData.score,
      notes: scoreData.notes,
      trainingTags: scoreData.trainingTags,
      tokenEfficiency: scoreData.tokenEfficiency,
      costEfficiency: scoreData.costEfficiency,
      isTrainingCandidate: scoreData.score >= 4,
    });

    const savedScore = await requestScore.save();

    this.logger.log(`Request ${scoreData.requestId} scored successfully`);
    return savedScore;
  }

  async getRequestScore(
    userId: string,
    requestId: string,
  ): Promise<RequestScore | null> {
    this.logger.log(
      `Getting score for request ${requestId} and user ${userId}`,
    );

    return this.requestScoreModel
      .findOne({
        requestId,
        userId: new Types.ObjectId(userId),
      })
      .lean();
  }

  async getUserScores(
    userId: string,
    filters: {
      minScore?: number;
      maxScore?: number;
      isTrainingCandidate?: boolean;
      trainingTags?: string[];
      limit?: number;
      offset?: number;
    },
  ): Promise<RequestScore[]> {
    this.logger.log(`Getting user scores for ${userId}`, filters);

    const query: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
    };

    if (filters.minScore !== undefined) {
      query.score = { $gte: filters.minScore };
    }

    if (filters.maxScore !== undefined) {
      query.score = query.score
        ? { ...query.score, $lte: filters.maxScore }
        : { $lte: filters.maxScore };
    }

    if (filters.isTrainingCandidate !== undefined) {
      query.isTrainingCandidate = filters.isTrainingCandidate;
    }

    if (filters.trainingTags?.length) {
      query.trainingTags = { $in: filters.trainingTags };
    }

    return this.requestScoreModel
      .find(query)
      .sort({ scoredAt: -1 })
      .skip(filters.offset || 0)
      .limit(filters.limit || 50)
      .lean();
  }

  async getTrainingCandidates(
    userId: string,
    filters: {
      minScore?: number;
      maxTokens?: number;
      maxCost?: number;
      providers?: string[];
      models?: string[];
      features?: string[];
      limit?: number;
    },
  ): Promise<any[]> {
    this.logger.log(`Getting training candidates for ${userId}`, filters);

    const query: Record<string, unknown> = {
      userId: new Types.ObjectId(userId),
      isTrainingCandidate: true,
      score: { $gte: filters.minScore || 4 },
    };

    // Join request scores with usage data using aggregation pipeline
    const pipeline = [
      // Match request scores for the user
      {
        $match: {
          userId: new Types.ObjectId(userId),
          isTrainingCandidate: true,
          score: { $gte: filters.minScore || 4 },
        },
      },
      // Join with usage data on requestId
      {
        $lookup: {
          from: 'usages',
          localField: 'requestId',
          foreignField: 'requestId',
          as: 'usageData',
        },
      },
      // Unwind usage data (one-to-one relationship expected)
      {
        $unwind: {
          path: '$usageData',
          preserveNullAndEmptyArrays: true,
        },
      },
      // Add computed fields for efficiency metrics
      {
        $addFields: {
          tokenEfficiency: {
            $cond: {
              if: {
                $and: ['$usageData.inputTokens', '$usageData.outputTokens'],
              },
              then: {
                $multiply: [
                  {
                    $divide: [
                      {
                        $add: [
                          '$usageData.inputTokens',
                          '$usageData.outputTokens',
                        ],
                      },
                      { $max: ['$usageData.promptTokens', 1] },
                    ],
                  },
                  100,
                ],
              },
              else: {
                // Fallback calculation based on score when no usage data
                $switch: {
                  branches: [
                    {
                      case: { $gte: ['$score', 4.5] },
                      then: {
                        $add: [
                          95,
                          { $multiply: [{ $subtract: ['$score', 4.5] }, 10] },
                        ],
                      },
                    },
                    {
                      case: { $gte: ['$score', 4.0] },
                      then: {
                        $add: [
                          85,
                          { $multiply: [{ $subtract: ['$score', 4.0] }, 20] },
                        ],
                      },
                    },
                    {
                      case: { $gte: ['$score', 3.5] },
                      then: {
                        $add: [
                          70,
                          { $multiply: [{ $subtract: ['$score', 3.5] }, 30] },
                        ],
                      },
                    },
                  ],
                  default: {
                    $add: [
                      60,
                      { $multiply: [{ $subtract: ['$score', 3.0] }, 20] },
                    ],
                  },
                },
              },
            },
          },
          costEfficiency: {
            $cond: {
              if: '$usageData.cost',
              then: {
                $multiply: [
                  {
                    $divide: [
                      '$usageData.cost',
                      {
                        $max: [
                          {
                            $add: [
                              '$usageData.inputTokens',
                              '$usageData.outputTokens',
                            ],
                          },
                          1,
                        ],
                      },
                    ],
                  },
                  -1000000, // Convert to efficiency percentage (lower cost per token = higher efficiency)
                ],
              },
              else: {
                // Fallback based on score
                $multiply: [
                  {
                    $switch: {
                      branches: [
                        {
                          case: { $gte: ['$score', 4.5] },
                          then: {
                            $add: [
                              95,
                              {
                                $multiply: [{ $subtract: ['$score', 4.5] }, 10],
                              },
                            ],
                          },
                        },
                        {
                          case: { $gte: ['$score', 4.0] },
                          then: {
                            $add: [
                              85,
                              {
                                $multiply: [{ $subtract: ['$score', 4.0] }, 20],
                              },
                            ],
                          },
                        },
                        {
                          case: { $gte: ['$score', 3.5] },
                          then: {
                            $add: [
                              70,
                              {
                                $multiply: [{ $subtract: ['$score', 3.5] }, 30],
                              },
                            ],
                          },
                        },
                      ],
                      default: {
                        $add: [
                          60,
                          { $multiply: [{ $subtract: ['$score', 3.0] }, 20] },
                        ],
                      },
                    },
                  },
                  {
                    $add: [
                      0.8,
                      { $multiply: [{ $subtract: ['$score', 3.0] }, 0.1] },
                    ],
                  },
                ],
              },
            },
          },
          totalTokens: {
            $cond: {
              if: {
                $and: ['$usageData.inputTokens', '$usageData.outputTokens'],
              },
              then: {
                $add: ['$usageData.inputTokens', '$usageData.outputTokens'],
              },
              else: {
                $switch: {
                  branches: [
                    { case: { $gte: ['$score', 4.5] }, then: 100 },
                    { case: { $gte: ['$score', 4.0] }, then: 150 },
                    { case: { $gte: ['$score', 3.5] }, then: 250 },
                  ],
                  default: 400,
                },
              },
            },
          },
          totalCost: {
            $ifNull: ['$usageData.cost', 0],
          },
          hasUsageData: {
            $cond: {
              if: '$usageData',
              then: true,
              else: false,
            },
          },
        },
      },
      // Apply additional filters
      ...(filters.maxTokens
        ? [
            {
              $match: {
                totalTokens: { $lte: filters.maxTokens },
              },
            },
          ]
        : []),
      ...(filters.maxCost
        ? [
            {
              $match: {
                totalCost: { $lte: filters.maxCost },
              },
            },
          ]
        : []),
      ...(filters.providers?.length
        ? [
            {
              $match: {
                'usageData.provider': { $in: filters.providers },
              },
            },
          ]
        : []),
      ...(filters.models?.length
        ? [
            {
              $match: {
                'usageData.model': { $in: filters.models },
              },
            },
          ]
        : []),
      // Sort by score and recency
      {
        $sort: {
          score: -1,
          scoredAt: -1,
        },
      },
      // Limit results
      {
        $limit: filters.limit || 100,
      },
      // Populate user data
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'userData',
        },
      },
      {
        $unwind: {
          path: '$userData',
          preserveNullAndEmptyArrays: true,
        },
      },
      // Project final result
      {
        $project: {
          _id: 1,
          requestId: 1,
          score: 1,
          notes: 1,
          scoredAt: 1,
          isTrainingCandidate: 1,
          trainingTags: 1,
          createdAt: 1,
          updatedAt: 1,
          userId: 1,
          userData: {
            name: '$userData.name',
            email: '$userData.email',
          },
          tokens: '$totalTokens',
          cost: { $round: ['$totalCost', 4] },
          provider: '$usageData.provider',
          model: '$usageData.model',
          features: '$trainingTags',
          tokenEfficiency: { $round: ['$tokenEfficiency', 2] },
          costEfficiency: { $round: ['$costEfficiency', 2] },
          metrics: {
            tokenEfficiency: { $round: ['$tokenEfficiency', 2] },
            costEfficiency: { $round: ['$costEfficiency', 2] },
            tokens: '$totalTokens',
            cost: { $round: ['$totalCost', 4] },
            score: '$score',
          },
          usageData: {
            provider: '$usageData.provider',
            model: '$usageData.model',
            inputTokens: '$usageData.inputTokens',
            outputTokens: '$usageData.outputTokens',
            cost: '$usageData.cost',
            responseTime: '$usageData.responseTime',
          },
          isRealData: '$hasUsageData',
        },
      },
    ];

    const candidates = await this.requestScoreModel.aggregate(
      pipeline as import('mongoose').PipelineStage[],
    );

    this.logger.log(
      `Found ${candidates.length} training candidates with usage data join`,
    );

    return candidates;
  }

  async getScoringAnalytics(userId: string): Promise<{
    totalScores: number;
    averageScore: number;
    scoreDistribution: Record<number, number>;
    trainingCandidates: number;
    topTags: string[];
    scoringTrends: any[];
  }> {
    this.logger.log(`Getting scoring analytics for ${userId}`);

    const scores = await this.requestScoreModel
      .find({ userId: new Types.ObjectId(userId) })
      .sort({ scoredAt: -1 })
      .lean();

    const totalScores = scores.length;
    const averageScore =
      totalScores > 0
        ? scores.reduce((sum, s) => sum + s.score, 0) / totalScores
        : 0;

    const scoreDistribution = scores.reduce(
      (dist, score) => {
        dist[score.score] = (dist[score.score] || 0) + 1;
        return dist;
      },
      {} as Record<number, number>,
    );

    const trainingCandidates = scores.filter(
      (s) => s.isTrainingCandidate,
    ).length;

    const allTags = scores.flatMap((s) => s.trainingTags || []);
    const tagCount = allTags.reduce(
      (count, tag) => {
        count[tag] = (count[tag] || 0) + 1;
        return count;
      },
      {} as Record<string, number>,
    );

    const topTags = Object.entries(tagCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([tag]) => tag);

    // Calculate real scoring trends over the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentScores = await this.requestScoreModel
      .find({
        userId: new Types.ObjectId(userId),
        scoredAt: { $gte: thirtyDaysAgo },
      })
      .sort({ scoredAt: 1 })
      .lean();

    // Group scores by date and calculate daily averages
    const dailyStats = new Map<string, { totalScore: number; count: number }>();

    recentScores.forEach((score) => {
      const dateKey = score.scoredAt.toISOString().split('T')[0]; // YYYY-MM-DD format
      const existing = dailyStats.get(dateKey) || { totalScore: 0, count: 0 };
      existing.totalScore += score.score;
      existing.count += 1;
      dailyStats.set(dateKey, existing);
    });

    const scoringTrends = Array.from(dailyStats.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14) // Last 14 days
      .map(([date, stats]) => ({
        date,
        averageScore: Math.round((stats.totalScore / stats.count) * 100) / 100,
        totalScores: stats.count,
      }));

    return {
      totalScores,
      averageScore,
      scoreDistribution,
      trainingCandidates,
      topTags,
      scoringTrends,
    };
  }

  async bulkScoreRequests(
    userId: string,
    scores: ScoreRequestData[],
  ): Promise<RequestScore[]> {
    this.logger.log(
      `Bulk scoring ${scores.length} requests for user ${userId}`,
    );

    const results: RequestScore[] = [];

    for (const scoreData of scores) {
      try {
        const result = await this.scoreRequest(userId, scoreData);
        results.push(result);
      } catch (error) {
        this.logger.error(
          `Failed to score request ${scoreData.requestId}`,
          error,
        );
        // Continue with other scores
      }
    }

    this.logger.log(
      `Bulk scoring completed: ${results.length}/${scores.length} successful`,
    );
    return results;
  }

  async deleteScore(userId: string, requestId: string): Promise<boolean> {
    this.logger.log(
      `Deleting score for request ${requestId} and user ${userId}`,
    );

    const result = await this.requestScoreModel.findOneAndDelete({
      requestId,
      userId: new Types.ObjectId(userId),
    });

    return !!result;
  }
}
