import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ThreatLog,
  ThreatLogDocument,
} from '../../schemas/security/threat-log.schema';
import {
  ModerationConfig,
  ModerationConfigDocument,
  ModerationConfigInput,
  ModerationConfigOutput,
  ModerationConfigPii,
} from '../../schemas/security/moderation-config.schema';
import {
  ModerationAppeal,
  ModerationAppealDocument,
} from '../../schemas/security/moderation-appeal.schema';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';

const DEFAULT_MODERATION_CONFIG = {
  inputModeration: {
    enableBasicFirewall: true,
    enableAdvancedFirewall: true,
    promptGuardThreshold: 0.7,
    openaiSafeguardThreshold: 0.7,
  },
  outputModeration: {
    enableOutputModeration: true,
    toxicityThreshold: 0.7,
    enablePIIDetection: true,
    enableToxicityCheck: true,
    enableHateSpeechCheck: true,
    enableSexualContentCheck: true,
    enableViolenceCheck: true,
    enableSelfHarmCheck: true,
    action: 'block',
  },
  piiDetection: {
    enablePIIDetection: true,
    useAI: true,
    sanitizationEnabled: true,
  },
} as const;

export interface ModerationAnalyticsQuery {
  startDate?: string;
  endDate?: string;
  includeInputModeration?: boolean;
  includeOutputModeration?: boolean;
}

export interface ModerationThreatsQuery {
  page?: string;
  limit?: string;
  category?: string;
  stage?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortOrder?: string;
}

export interface UpdateModerationConfigBody {
  inputModeration?: ModerationConfigInput;
  outputModeration?: ModerationConfigOutput;
  piiDetection?: ModerationConfigPii;
}

export interface AppealModerationBody {
  threatId: string;
  reason: string;
  additionalContext?: string;
}

interface ThreatTrendItem {
  date: Date;
  count: number;
  categories: string[];
  avgConfidence: number;
}

interface SanitizedThreatItem {
  id: Types.ObjectId;
  requestId: string;
  threatCategory: string;
  confidence: number;
  stage: string;
  reason: string;
  costSaved: number;
  timestamp: Date;
  promptPreview: string | null;
  promptHash: string | null;
  ipAddress: string | null;
  details: {
    method?: string;
    threatLevel?: string;
    action?: string;
    violationCategories?: unknown;
    matchedPatterns: number;
  };
}

@Injectable()
export class ModerationService {
  private static readonly OBJECT_ID_CACHE_MAX = 100;
  private readonly objectIdCache = new Map<string, Types.ObjectId>();
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    @InjectModel(ThreatLog.name)
    private readonly threatLogModel: Model<ThreatLogDocument>,
    @InjectModel(ModerationConfig.name)
    private readonly moderationConfigModel: Model<ModerationConfigDocument>,
    @InjectModel(ModerationAppeal.name)
    private readonly moderationAppealModel: Model<ModerationAppealDocument>,
    private readonly businessEventLogging: BusinessEventLoggingService,
  ) {}

  /**
   * Get comprehensive moderation analytics for the authenticated user.
   */
  async getModerationAnalytics(
    userId: string,
    query: ModerationAnalyticsQuery,
  ): Promise<{
    data: {
      input: Record<string, unknown>;
      output: Record<string, unknown>;
      trends: ThreatTrendItem[];
      routes: unknown[];
      categories: unknown[];
      summary: Record<string, unknown>;
    };
    metadata: Record<string, unknown>;
  }> {
    const {
      startDate,
      endDate,
      includeInputModeration = true,
      includeOutputModeration = true,
    } = query;

    const dateRange =
      startDate && endDate
        ? { start: new Date(startDate), end: new Date(endDate) }
        : undefined;

    const userObjectId = this.getMemoizedObjectId(userId);

    const [
      trendAnalytics,
      routeAnalytics,
      categoryAnalytics,
      unifiedAnalytics,
    ] = await Promise.all([
      this.getThreatTrends(userId, dateRange),
      this.getBlockRateByRoute(userId, dateRange),
      this.getTopViolationCategories(userId, dateRange),
      this.getUnifiedAnalytics(userObjectId, dateRange),
    ]);

    const stats = unifiedAnalytics.threatStats ?? {
      totalCostSaved: 0,
      totalThreats: 0,
      inputThreats: 0,
      outputThreats: 0,
      inputCostSaved: 0,
      outputCostSaved: 0,
    };

    const inputThreatsByCategory =
      unifiedAnalytics.inputThreatsByCategory ?? {};
    const outputViolationsByCategory =
      unifiedAnalytics.outputViolationsByCategory ?? {};
    const blockRateByModel = unifiedAnalytics.blockRateByModel ?? {};

    const inputAnalytics = {
      totalRequests: Math.max(stats.inputThreats * 5, 100),
      blockedRequests: stats.inputThreats,
      costSaved: stats.inputCostSaved,
      threatsByCategory: inputThreatsByCategory,
    };

    const outputAnalytics = {
      totalResponses: Math.max(stats.outputThreats * 3, 50),
      blockedResponses: Math.floor(stats.outputThreats * 0.7),
      redactedResponses: Math.floor(stats.outputThreats * 0.2),
      annotatedResponses: Math.floor(stats.outputThreats * 0.1),
      violationsByCategory: outputViolationsByCategory,
      blockRateByModel,
    };

    this.businessEventLogging.logBusiness({
      event: 'moderation_analytics_retrieved',
      category: 'moderation_operations',
      value: 0,
      metadata: {
        userId,
        startDate,
        endDate,
        includeInputModeration: Boolean(includeInputModeration),
        includeOutputModeration: Boolean(includeOutputModeration),
        totalThreats: stats.totalThreats,
        totalCostSaved: stats.totalCostSaved,
      },
    });

    return {
      data: {
        input: inputAnalytics,
        output: outputAnalytics,
        trends: trendAnalytics,
        routes: routeAnalytics,
        categories: categoryAnalytics,
        summary: {
          totalThreats: stats.totalThreats,
          totalCostSaved: stats.totalCostSaved,
          overallBlockRate: this.calculateOverallBlockRate(
            inputAnalytics,
            outputAnalytics,
          ),
          lastUpdated: new Date().toISOString(),
        },
      },
      metadata: {
        dateRange,
        includeInputModeration,
        includeOutputModeration,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Get paginated moderation threat samples for audit.
   */
  async getModerationThreats(
    userId: string,
    query: ModerationThreatsQuery,
  ): Promise<{
    data: {
      threats: SanitizedThreatItem[];
      pagination: {
        currentPage: number;
        totalPages: number;
        totalCount: number;
        hasNext: boolean;
        hasPrev: boolean;
      };
      filters: Record<string, unknown>;
    };
  }> {
    const {
      page = '1',
      limit = '20',
      category,
      stage,
      startDate,
      endDate,
      sortBy = 'timestamp',
      sortOrder = 'desc',
    } = query;

    const pageNum = parseInt(page, 10);
    const limitNum = Math.min(parseInt(limit, 10), 100);
    const skip = (pageNum - 1) * limitNum;

    const userObjectId = this.getMemoizedObjectId(userId);

    const matchQuery: Record<string, unknown> = { userId: userObjectId };
    if (category) (matchQuery as any).threatCategory = category;
    if (stage) (matchQuery as any).stage = stage;
    if (startDate && endDate) {
      (matchQuery as any).timestamp = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const sortDir = sortOrder === 'desc' ? -1 : 1;
    const results = await this.threatLogModel.aggregate([
      { $match: matchQuery },
      {
        $facet: {
          threats: [
            { $sort: { [sortBy]: sortDir } },
            { $skip: skip },
            { $limit: limitNum },
            {
              $project: {
                _id: 1,
                requestId: 1,
                threatCategory: 1,
                confidence: 1,
                stage: 1,
                reason: 1,
                costSaved: 1,
                timestamp: 1,
                promptPreview: 1,
                promptHash: 1,
                ipAddress: 1,
                'details.method': 1,
                'details.threatLevel': 1,
                'details.action': 1,
                'details.violationCategories': 1,
                'details.matchedPatterns': 1,
              },
            },
          ],
          totalCount: [{ $count: 'count' }],
        },
      },
    ]);

    const threats = results[0]?.threats ?? [];
    const totalCount = results[0]?.totalCount?.[0]?.count ?? 0;
    const totalPages = Math.ceil(totalCount / limitNum);
    const sanitizedThreats = this.sanitizeThreatsData(threats);

    this.businessEventLogging.logBusiness({
      event: 'moderation_threats_retrieved',
      category: 'moderation_operations',
      value: 0,
      metadata: {
        userId,
        page,
        limit,
        threatsCount: threats.length,
        totalCount,
        totalPages,
      },
    });

    return {
      data: {
        threats: sanitizedThreats,
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalCount,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1,
        },
        filters: {
          category: category ?? null,
          stage: stage ?? null,
          dateRange: startDate && endDate ? { startDate, endDate } : null,
        },
      },
    };
  }

  /**
   * Get moderation configuration for the user (from DB or defaults).
   */
  async getModerationConfig(
    userId: string,
  ): Promise<{ data: Record<string, unknown> }> {
    const userObjectId = this.getMemoizedObjectId(userId);
    const config = await this.moderationConfigModel
      .findOne({ userId: userObjectId })
      .lean()
      .exec();

    const data = config
      ? {
          inputModeration: {
            ...DEFAULT_MODERATION_CONFIG.inputModeration,
            ...config.inputModeration,
          },
          outputModeration: {
            ...DEFAULT_MODERATION_CONFIG.outputModeration,
            ...config.outputModeration,
          },
          piiDetection: {
            ...DEFAULT_MODERATION_CONFIG.piiDetection,
            ...config.piiDetection,
          },
        }
      : { ...DEFAULT_MODERATION_CONFIG };

    this.businessEventLogging.logBusiness({
      event: 'moderation_configuration_retrieved',
      category: 'moderation_operations',
      metadata: { userId, hasConfig: !!config },
    });

    return { data: data as Record<string, unknown> };
  }

  /**
   * Update and persist moderation configuration for the user.
   */
  async updateModerationConfig(
    userId: string,
    body: UpdateModerationConfigBody,
  ): Promise<{ message: string; data: typeof body }> {
    const userObjectId = this.getMemoizedObjectId(userId);

    const updatePayload: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (body.inputModeration)
      updatePayload.inputModeration = body.inputModeration;
    if (body.outputModeration)
      updatePayload.outputModeration = body.outputModeration;
    if (body.piiDetection) updatePayload.piiDetection = body.piiDetection;

    await this.moderationConfigModel.findOneAndUpdate(
      { userId: userObjectId },
      { $set: updatePayload },
      { upsert: true, new: true },
    );

    this.businessEventLogging.logBusiness({
      event: 'moderation_configuration_updated',
      category: 'moderation_operations',
      metadata: {
        userId,
        configKeys: Object.keys(body),
      },
    });

    return {
      message: 'Moderation configuration updated successfully',
      data: body,
    };
  }

  /**
   * Submit an appeal for a moderation decision. Persists appeal and returns appeal id.
   */
  async appealModerationDecision(
    userId: string,
    body: AppealModerationBody,
  ): Promise<{
    message: string;
    data: { appealId: string; status: string; submittedAt: Date };
  }> {
    const { threatId, reason, additionalContext } = body;

    if (!threatId || !reason) {
      throw new BadRequestException('threatId and reason are required');
    }

    if (!Types.ObjectId.isValid(threatId)) {
      throw new BadRequestException('Invalid threatId format');
    }

    const threat = await this.threatLogModel.findById(threatId).exec();
    if (!threat) {
      this.logger.warn('Moderation appeal - threat not found', {
        userId,
        threatId,
      });
      throw new NotFoundException('The specified threat log was not found');
    }

    if (threat.userId?.toString() !== userId) {
      this.logger.warn('Moderation appeal - unauthorized threat access', {
        userId,
        threatId,
        threatUserId: threat.userId?.toString(),
      });
      throw new ForbiddenException(
        'You can only appeal your own moderation decisions',
      );
    }

    const appeal = await this.moderationAppealModel.create({
      threatId: new Types.ObjectId(threatId),
      userId: new Types.ObjectId(userId),
      reason,
      additionalContext,
      status: 'pending',
      submittedAt: new Date(),
    });

    this.businessEventLogging.logBusiness({
      event: 'moderation_appeal_submitted',
      category: 'moderation_operations',
      metadata: {
        userId,
        threatId,
        appealId: appeal._id.toString(),
      },
    });

    return {
      message:
        'Appeal submitted successfully. It will be reviewed by our team.',
      data: {
        appealId: appeal._id.toString(),
        status: appeal.status,
        submittedAt: appeal.submittedAt,
      },
    };
  }

  private getMemoizedObjectId(userId: string): Types.ObjectId {
    let objectId = this.objectIdCache.get(userId);
    if (!objectId) {
      objectId = new Types.ObjectId(userId);
      this.objectIdCache.set(userId, objectId);
      if (this.objectIdCache.size > ModerationService.OBJECT_ID_CACHE_MAX) {
        const firstKey = this.objectIdCache.keys().next().value;
        if (firstKey) this.objectIdCache.delete(firstKey);
      }
    }
    return objectId;
  }

  private async getThreatTrends(
    userId: string,
    dateRange?: { start: Date; end: Date },
  ): Promise<ThreatTrendItem[]> {
    try {
      const userObjectId = this.getMemoizedObjectId(userId);
      const matchQuery: Record<string, unknown> = { userId: userObjectId };
      if (dateRange) {
        (matchQuery as any).timestamp = {
          $gte: dateRange.start,
          $lte: dateRange.end,
        };
      }

      const trends = await this.threatLogModel.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: {
              year: { $year: '$timestamp' },
              month: { $month: '$timestamp' },
              day: { $dayOfMonth: '$timestamp' },
            },
            count: { $sum: 1 },
            categories: { $push: '$threatCategory' },
            avgConfidence: { $avg: '$confidence' },
          },
        },
        {
          $project: {
            date: {
              $dateFromParts: {
                year: '$_id.year',
                month: '$_id.month',
                day: '$_id.day',
              },
            },
            count: 1,
            categories: 1,
            avgConfidence: { $round: ['$avgConfidence', 2] },
          },
        },
        { $sort: { date: 1 } },
        { $limit: 30 },
      ]);

      return trends as ThreatTrendItem[];
    } catch (err) {
      this.logger.error('Error getting threat trends', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private async getBlockRateByRoute(
    userId: string,
    dateRange?: { start: Date; end: Date },
  ): Promise<unknown[]> {
    try {
      const userObjectId = this.getMemoizedObjectId(userId);
      const matchQuery: Record<string, unknown> = { userId: userObjectId };
      if (dateRange) {
        (matchQuery as any).timestamp = {
          $gte: dateRange.start,
          $lte: dateRange.end,
        };
      }

      return this.threatLogModel.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: { stage: '$stage', category: '$threatCategory' },
            count: { $sum: 1 },
            avgConfidence: { $avg: '$confidence' },
          },
        },
        {
          $group: {
            _id: '$_id.stage',
            totalBlocked: { $sum: '$count' },
            categories: {
              $push: {
                category: '$_id.category',
                count: '$count',
                avgConfidence: { $round: ['$avgConfidence', 2] },
              },
            },
          },
        },
      ]);
    } catch (err) {
      this.logger.error('Error getting route analytics', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private async getTopViolationCategories(
    userId: string,
    dateRange?: { start: Date; end: Date },
  ): Promise<unknown[]> {
    try {
      const userObjectId = this.getMemoizedObjectId(userId);
      const matchQuery: Record<string, unknown> = { userId: userObjectId };
      if (dateRange) {
        (matchQuery as any).timestamp = {
          $gte: dateRange.start,
          $lte: dateRange.end,
        };
      }

      return this.threatLogModel.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: '$threatCategory',
            count: { $sum: 1 },
            avgConfidence: { $avg: '$confidence' },
            totalCostSaved: { $sum: '$costSaved' },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
        {
          $project: {
            category: '$_id',
            count: 1,
            avgConfidence: { $round: ['$avgConfidence', 2] },
            totalCostSaved: { $round: ['$totalCostSaved', 2] },
            _id: 0,
          },
        },
      ]);
    } catch (err) {
      this.logger.error('Error getting violation categories', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private calculateOverallBlockRate(
    inputAnalytics: { totalRequests?: number; blockedRequests?: number },
    outputAnalytics: { totalResponses?: number; blockedResponses?: number },
  ): number {
    const totalRequests =
      (inputAnalytics?.totalRequests ?? 0) +
      (outputAnalytics?.totalResponses ?? 0);
    const totalBlocked =
      (inputAnalytics?.blockedRequests ?? 0) +
      (outputAnalytics?.blockedResponses ?? 0);
    return totalRequests > 0 ? (totalBlocked / totalRequests) * 100 : 0;
  }

  private async getUnifiedAnalytics(
    userObjectId: Types.ObjectId,
    dateRange?: { start: Date; end: Date },
  ): Promise<{
    threatStats: {
      totalCostSaved: number;
      totalThreats: number;
      inputThreats: number;
      outputThreats: number;
      inputCostSaved: number;
      outputCostSaved: number;
    };
    inputThreatsByCategory: Record<string, number>;
    outputViolationsByCategory: Record<string, number>;
    blockRateByModel: Record<string, number>;
  }> {
    const defaultStats = {
      totalCostSaved: 0,
      totalThreats: 0,
      inputThreats: 0,
      outputThreats: 0,
      inputCostSaved: 0,
      outputCostSaved: 0,
    };

    try {
      const matchQuery: Record<string, unknown> = { userId: userObjectId };
      if (dateRange) {
        (matchQuery as any).timestamp = {
          $gte: dateRange.start,
          $lte: dateRange.end,
        };
      }

      const results = await this.threatLogModel.aggregate([
        { $match: matchQuery },
        {
          $facet: {
            threatStats: [
              {
                $group: {
                  _id: null,
                  totalCostSaved: { $sum: '$costSaved' },
                  totalThreats: { $sum: 1 },
                  inputThreats: {
                    $sum: {
                      $cond: [
                        {
                          $in: ['$stage', ['prompt-guard', 'openai-safeguard']],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  outputThreats: {
                    $sum: {
                      $cond: [{ $eq: ['$stage', 'output-guard'] }, 1, 0],
                    },
                  },
                  inputCostSaved: {
                    $sum: {
                      $cond: [
                        {
                          $in: ['$stage', ['prompt-guard', 'openai-safeguard']],
                        },
                        '$costSaved',
                        0,
                      ],
                    },
                  },
                  outputCostSaved: {
                    $sum: {
                      $cond: [
                        { $eq: ['$stage', 'output-guard'] },
                        '$costSaved',
                        0,
                      ],
                    },
                  },
                },
              },
            ],
            inputThreatsByCategory: [
              {
                $match: {
                  stage: { $in: ['prompt-guard', 'openai-safeguard'] },
                },
              },
              { $group: { _id: '$threatCategory', count: { $sum: 1 } } },
              {
                $group: {
                  _id: null,
                  categories: { $push: { k: '$_id', v: '$count' } },
                },
              },
              { $replaceRoot: { newRoot: { $arrayToObject: '$categories' } } },
            ],
            outputViolationsByCategory: [
              { $match: { stage: 'output-guard' } },
              { $group: { _id: '$threatCategory', count: { $sum: 1 } } },
              {
                $group: {
                  _id: null,
                  categories: { $push: { k: '$_id', v: '$count' } },
                },
              },
              { $replaceRoot: { newRoot: { $arrayToObject: '$categories' } } },
            ],
            blockRateByModel: [
              { $match: { 'details.model': { $exists: true } } },
              { $group: { _id: '$details.model', count: { $sum: 1 } } },
              {
                $group: {
                  _id: null,
                  models: { $push: { k: '$_id', v: '$count' } },
                },
              },
              { $replaceRoot: { newRoot: { $arrayToObject: '$models' } } },
            ],
          },
        },
      ]);

      const result = results[0] ?? {};
      return {
        threatStats: result.threatStats?.[0] ?? defaultStats,
        inputThreatsByCategory: result.inputThreatsByCategory?.[0] ?? {},
        outputViolationsByCategory:
          result.outputViolationsByCategory?.[0] ?? {},
        blockRateByModel: result.blockRateByModel?.[0] ?? {},
      };
    } catch (err) {
      this.logger.error('Error getting unified analytics', {
        userObjectId: userObjectId.toString(),
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        threatStats: defaultStats,
        inputThreatsByCategory: {},
        outputViolationsByCategory: {},
        blockRateByModel: {},
      };
    }
  }

  private sanitizeThreatsData(threats: any[]): SanitizedThreatItem[] {
    return threats.map((threat) => ({
      id: threat._id,
      requestId: threat.requestId,
      threatCategory: threat.threatCategory,
      confidence: threat.confidence,
      stage: threat.stage,
      reason: threat.reason,
      costSaved: threat.costSaved,
      timestamp: threat.timestamp,
      promptPreview: threat.promptPreview ?? null,
      promptHash: threat.promptHash
        ? String(threat.promptHash).substring(0, 8)
        : null,
      ipAddress: threat.ipAddress
        ? String(threat.ipAddress).replace(/(\d+\.\d+\.\d+)\.\d+/, '$1.xxx')
        : null,
      details: {
        method: threat.details?.method,
        threatLevel: threat.details?.threatLevel,
        action: threat.details?.action,
        violationCategories: threat.details?.violationCategories,
        matchedPatterns: Array.isArray(threat.details?.matchedPatterns)
          ? threat.details.matchedPatterns.length
          : 0,
      },
    }));
  }
}
