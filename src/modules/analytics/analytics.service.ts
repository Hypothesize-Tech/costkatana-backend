import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Usage, UsageDocument } from '@/schemas/core/usage.schema';
import { LoggerService } from '@/common/logger/logger.service';
import { MixpanelService } from '@/common/services/mixpanel.service';

export interface AnalyticsQuery {
  userId: string;
  startDate?: Date;
  endDate?: Date;
  period?: 'daily' | 'weekly' | 'monthly';
  service?: string;
  model?: string;
  groupBy?: 'service' | 'model' | 'date' | 'hour';
  projectId?: string;
}

interface TimeSeriesData {
  date: Date;
  cost: number;
  tokens: number;
  calls: number;
}

interface SummaryResult {
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  averageCostPerRequest: number;
}

export type { TimeSeriesData, SummaryResult };

/** Event payload for recording a cost/usage event (e.g. from gateway proxy) */
export interface CostEventPayload {
  userId: string;
  projectId?: string;
  cost: number;
  currency?: string;
  provider?: string;
  model?: string;
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  requestType?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectModel(Usage.name) private readonly usageModel: Model<UsageDocument>,
    private readonly loggerService: LoggerService,
    private readonly mixpanelService: MixpanelService,
  ) {}

  /**
   * Record a cost/usage event (e.g. from gateway proxy or budget enforcement).
   * Persists a Usage document for analytics and cost tracking.
   */
  async recordCostEvent(event: CostEventPayload): Promise<void> {
    try {
      const tokens =
        event.tokens ?? (event.inputTokens ?? 0) + (event.outputTokens ?? 0);
      const service = this.mapProviderToService(event.provider);
      const doc = {
        userId: new Types.ObjectId(event.userId),
        projectId: event.projectId
          ? new Types.ObjectId(event.projectId)
          : undefined,
        service,
        model: event.model || 'unknown',
        prompt: '',
        promptTokens: event.inputTokens ?? Math.floor(tokens / 2),
        completionTokens: event.outputTokens ?? Math.ceil(tokens / 2),
        totalTokens: tokens || 0,
        cost: event.cost,
        responseTime: (event.metadata?.processingTime as number) ?? 0,
        metadata: {
          ...event.metadata,
          requestType: event.requestType,
          currency: event.currency ?? 'USD',
        },
      };
      await this.usageModel.create(doc);
      this.loggerService.debug('Cost event recorded', {
        userId: event.userId,
        cost: event.cost,
        model: event.model,
        service,
      });
    } catch (err) {
      this.loggerService.warn('Failed to record cost event', {
        error: err instanceof Error ? err.message : String(err),
        userId: event.userId,
      });
    }
  }

  private mapProviderToService(provider?: string): string {
    if (!provider) return 'aws-bedrock';
    const p = provider.toLowerCase();
    if (p.includes('openai')) return 'openai';
    if (p.includes('anthropic')) return 'anthropic';
    if (p.includes('google') || p.includes('gemini')) return 'google-ai';
    if (p.includes('cohere')) return 'cohere';
    if (p.includes('huggingface')) return 'huggingface';
    if (p.includes('bedrock') || p.includes('aws')) return 'aws-bedrock';
    return 'aws-bedrock';
  }

  async getAnalytics(
    filters: AnalyticsQuery,
    options: { groupBy?: string; includeProjectBreakdown?: boolean } = {},
  ): Promise<{
    summary: SummaryResult;
    timeline: TimeSeriesData[];
    breakdown: { services: any[]; models: any[] };
    trends: { costTrend: string; tokenTrend: string; insights: string[] };
    projectBreakdown?: any[];
  }> {
    const startTime = Date.now();
    this.loggerService.debug('Getting analytics with filters', {
      userId: filters.userId,
    });

    const match: Record<string, unknown> = {
      userId: new Types.ObjectId(filters.userId),
    };

    if (filters.startDate || filters.endDate) {
      (match as any).createdAt = {};
      if (filters.startDate) (match as any).createdAt.$gte = filters.startDate;
      if (filters.endDate) (match as any).createdAt.$lte = filters.endDate;
    }
    if (filters.service) (match as any).service = filters.service;
    if (filters.model) (match as any).model = filters.model;
    if (filters.projectId && filters.projectId !== 'all') {
      (match as any).projectId = new Types.ObjectId(filters.projectId);
    }

    const operations: Promise<unknown>[] = [
      this.getSummary(match as any),
      this.getTimeline(match as any, options.groupBy || 'date'),
      this.getBreakdown(match as any),
    ];

    if (options.includeProjectBreakdown && !filters.projectId) {
      operations.push(this.calculateProjectBreakdown(match as any));
    }

    if (filters.userId) {
      operations.push(
        Promise.resolve()
          .then(() =>
            this.mixpanelService.trackAnalyticsEvent('dashboard_viewed', {
              userId: filters.userId,
              projectId: filters.projectId,
              reportType: options.groupBy,
              dateRange:
                filters.startDate && filters.endDate
                  ? `${filters.startDate.toISOString()}-${filters.endDate.toISOString()}`
                  : undefined,
              filters: {
                service: filters.service,
                model: filters.model,
                groupBy: options.groupBy,
              },
              page: '/analytics',
              component: 'analytics_service',
            }),
          )
          .catch((err: Error) =>
            this.loggerService.warn('Mixpanel tracking failed', {
              error: err.message,
            }),
          ),
      );
    }

    const results = await Promise.all(operations);
    const [summary, timeline, breakdown] = results as [
      SummaryResult,
      TimeSeriesData[],
      { services: any[]; models: any[] },
    ];
    const projectBreakdown =
      options.includeProjectBreakdown && !filters.projectId
        ? (results[3] as any[])
        : null;

    this.loggerService.debug('Analytics result', {
      executionTime: Date.now() - startTime,
      hasProjectBreakdown: !!projectBreakdown,
    });

    return {
      summary,
      timeline,
      breakdown,
      trends: { costTrend: 'stable', tokenTrend: 'stable', insights: [] },
      ...(projectBreakdown != null && { projectBreakdown }),
    };
  }

  async getProjectAnalytics(
    projectId: string,
    filters: Record<string, any>,
    options: { groupBy?: string } = {},
  ): Promise<{
    summary: SummaryResult;
    timeline: TimeSeriesData[];
    breakdown: { services: any[]; models: any[] };
    trends: { costTrend: string; tokenTrend: string; insights: string[] };
  }> {
    const match = {
      ...filters,
      projectId: new Types.ObjectId(projectId),
    };
    const [summary, timeline, breakdown] = await Promise.all([
      this.getSummary(match),
      this.getTimeline(match, options.groupBy || 'date'),
      this.getBreakdown(match),
    ]);
    return {
      summary,
      timeline,
      breakdown,
      trends: { costTrend: 'stable', tokenTrend: 'stable', insights: [] },
    };
  }

  async compareProjects(
    projectIds: string[],
    options: { startDate?: Date; endDate?: Date; metric?: string } = {},
  ): Promise<{ projects: any[]; metric: string }> {
    const match: any = {
      projectId: { $in: projectIds.map((id) => new Types.ObjectId(id)) },
    };
    if (options.startDate || options.endDate) {
      match.createdAt = {};
      if (options.startDate) match.createdAt.$gte = options.startDate;
      if (options.endDate) match.createdAt.$lte = options.endDate;
    }

    const [comparison, projectDetails] = await Promise.all([
      this.usageModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$projectId',
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            totalRequests: { $sum: 1 },
            avgCost: { $avg: '$cost' },
          },
        },
        {
          $project: {
            projectId: '$_id',
            totalCost: { $round: ['$totalCost', 4] },
            totalTokens: 1,
            totalRequests: 1,
            avgCost: { $round: ['$avgCost', 4] },
          },
        },
      ]),
      this.usageModel.db
        .collection('projects')
        .find(
          { _id: { $in: projectIds.map((id) => new Types.ObjectId(id)) } },
          { projection: { name: 1 } },
        )
        .toArray(),
    ]);

    const projectMap = new Map(
      (projectDetails as any[]).map((p: any) => [p._id.toString(), p.name]),
    );
    const enrichedComparison = comparison.map((item: any) => ({
      ...item,
      projectName: projectMap.get(item.projectId?.toString()) || 'Unknown',
    }));

    return { projects: enrichedComparison, metric: options.metric || 'cost' };
  }

  async getRecentUsage(
    filters: {
      userId?: string;
      limit?: number;
      projectId?: string;
      startDate?: Date;
      endDate?: Date;
    } = {},
  ): Promise<any[]> {
    const match: any = {};
    if (filters.userId) match.userId = new Types.ObjectId(filters.userId);
    if (filters.projectId && filters.projectId !== 'all') {
      match.projectId = new Types.ObjectId(filters.projectId);
    }
    if (filters.startDate || filters.endDate) {
      match.createdAt = {};
      if (filters.startDate) match.createdAt.$gte = filters.startDate;
      if (filters.endDate) match.createdAt.$lte = filters.endDate;
    }

    const pipeline: any[] = [
      { $match: match },
      {
        $lookup: {
          from: 'projects',
          localField: 'projectId',
          foreignField: '_id',
          as: 'project',
        },
      },
      {
        $addFields: {
          projectName: {
            $cond: {
              if: { $gt: [{ $size: '$project' }, 0] },
              then: { $arrayElemAt: ['$project.name', 0] },
              else: null,
            },
          },
        },
      },
      {
        $project: {
          userId: 1,
          service: 1,
          model: 1,
          prompt: 1,
          completion: 1,
          cost: 1,
          totalTokens: 1,
          promptTokens: 1,
          completionTokens: 1,
          responseTime: 1,
          createdAt: 1,
          projectName: 1,
          metadata: 1,
          tags: 1,
          optimizationApplied: 1,
          errorOccurred: 1,
        },
      },
      { $sort: { createdAt: -1 } },
      { $limit: filters.limit || 20 },
    ];

    return this.usageModel.aggregate(pipeline);
  }

  async getComparativeAnalytics(
    userId: string,
    period1: { startDate: Date; endDate: Date },
    period2: { startDate: Date; endDate: Date },
  ): Promise<{
    period1: any;
    period2: any;
    comparison: Record<
      string,
      {
        period1: number;
        period2: number;
        change: number;
        percentageChange: number;
      }
    >;
  }> {
    const [data1, data2] = await Promise.all([
      this.getAnalytics({
        userId,
        startDate: period1.startDate,
        endDate: period1.endDate,
      }),
      this.getAnalytics({
        userId,
        startDate: period2.startDate,
        endDate: period2.endDate,
      }),
    ]);

    const calc = (a: number, b: number) =>
      a === 0 ? (b === 0 ? 0 : 100) : ((b - a) / a) * 100;

    return {
      period1: data1,
      period2: data2,
      comparison: {
        cost: {
          period1: data1.summary.totalCost,
          period2: data2.summary.totalCost,
          change: data2.summary.totalCost - data1.summary.totalCost,
          percentageChange: calc(
            data1.summary.totalCost,
            data2.summary.totalCost,
          ),
        },
        tokens: {
          period1: data1.summary.totalTokens,
          period2: data2.summary.totalTokens,
          change: data2.summary.totalTokens - data1.summary.totalTokens,
          percentageChange: calc(
            data1.summary.totalTokens,
            data2.summary.totalTokens,
          ),
        },
        calls: {
          period1: data1.summary.totalRequests,
          period2: data2.summary.totalRequests,
          change: data2.summary.totalRequests - data1.summary.totalRequests,
          percentageChange: calc(
            data1.summary.totalRequests,
            data2.summary.totalRequests,
          ),
        },
        avgCostPerCall: {
          period1: data1.summary.averageCostPerRequest,
          period2: data2.summary.averageCostPerRequest,
          change:
            data2.summary.averageCostPerRequest -
            data1.summary.averageCostPerRequest,
          percentageChange: calc(
            data1.summary.averageCostPerRequest,
            data2.summary.averageCostPerRequest,
          ),
        },
      },
    };
  }

  async exportAnalytics(
    query: AnalyticsQuery,
    format: 'csv' | 'json' = 'json',
  ): Promise<string> {
    const data = await this.getAnalytics(query);
    if (format === 'json') return JSON.stringify(data, null, 2);
    const csvRows = ['Date,Service,Model,Tokens,Cost,Calls'];
    for (const item of data.timeline) {
      csvRows.push(
        `${item.date.toISOString()},${query.service || 'All'},${query.model || 'All'},${item.tokens},${item.cost},${item.calls}`,
      );
    }
    return csvRows.join('\n');
  }

  private async getSummary(
    match: any,
  ): Promise<SummaryResult & { averageResponseTime?: number }> {
    const result = await this.usageModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalCost: { $sum: '$cost' },
          totalTokens: { $sum: '$totalTokens' },
          totalRequests: { $sum: 1 },
          averageCostPerRequest: { $avg: '$cost' },
          averageResponseTime: { $avg: '$responseTime' },
        },
      },
    ]);
    const row = result[0] as any;
    return row
      ? {
          totalCost: row.totalCost ?? 0,
          totalTokens: row.totalTokens ?? 0,
          totalRequests: row.totalRequests ?? 0,
          averageCostPerRequest: row.averageCostPerRequest ?? 0,
          averageResponseTime: row.averageResponseTime ?? 0,
        }
      : {
          totalCost: 0,
          totalTokens: 0,
          totalRequests: 0,
          averageCostPerRequest: 0,
          averageResponseTime: 0,
        };
  }

  private async getTimeline(
    match: any,
    groupBy: string,
  ): Promise<TimeSeriesData[]> {
    const groupStage: any =
      groupBy === 'hour'
        ? {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                day: { $dayOfMonth: '$createdAt' },
                hour: { $hour: '$createdAt' },
              },
              cost: { $sum: '$cost' },
              tokens: { $sum: '$totalTokens' },
              calls: { $sum: 1 },
            },
          }
        : {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
                day: { $dayOfMonth: '$createdAt' },
              },
              cost: { $sum: '$cost' },
              tokens: { $sum: '$totalTokens' },
              calls: { $sum: 1 },
            },
          };

    const data = await this.usageModel.aggregate([
      { $match: match },
      groupStage,
      {
        $project: {
          date: {
            $dateFromParts: {
              year: '$_id.year',
              month: '$_id.month',
              day: '$_id.day',
              ...(groupBy === 'hour' ? { hour: '$_id.hour' } : { hour: 0 }),
            },
          },
          cost: { $round: ['$cost', 4] },
          tokens: 1,
          calls: 1,
        },
      },
      { $sort: { date: 1 } },
    ]);
    return data as TimeSeriesData[];
  }

  private async getBreakdown(
    match: any,
  ): Promise<{ services: any[]; models: any[] }> {
    const [services, models] = await Promise.all([
      this.usageModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$service',
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            totalRequests: { $sum: 1 },
          },
        },
        {
          $project: {
            service: '$_id',
            _id: 0,
            totalCost: { $round: ['$totalCost', 4] },
            totalTokens: 1,
            totalRequests: 1,
          },
        },
        { $sort: { totalCost: -1 } },
      ]),
      this.usageModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: '$model',
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            totalRequests: { $sum: 1 },
          },
        },
        {
          $project: {
            model: '$_id',
            _id: 0,
            totalCost: { $round: ['$totalCost', 4] },
            totalTokens: 1,
            totalRequests: 1,
          },
        },
        { $sort: { totalCost: -1 } },
      ]),
    ]);
    return { services, models };
  }

  /**
   * Project-level cost breakdown. Includes usage with null projectId (e.g. gateway
   * requests) as "Unassigned". Uses same match filter (date range, etc.) as other analytics.
   * Uses a sentinel value for null projectId to avoid $lookup issues with null _id.
   */
  private async calculateProjectBreakdown(match: any): Promise<any[]> {
    const breakdown = await this.usageModel.aggregate([
      { $match: match },
      {
        $addFields: {
          _projectIdForGroup: { $ifNull: ['$projectId', '___UNASSIGNED___'] },
        },
      },
      {
        $group: {
          _id: '$_projectIdForGroup',
          totalCost: { $sum: '$cost' },
          totalTokens: { $sum: '$totalTokens' },
          totalRequests: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'projects',
          let: { groupId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$_id', '$$groupId'] } } },
            { $project: { name: 1 } },
          ],
          as: 'project',
        },
      },
      {
        $addFields: {
          projectName: {
            $cond: {
              if: { $eq: ['$_id', '___UNASSIGNED___'] },
              then: 'Unassigned',
              else: {
                $ifNull: [{ $arrayElemAt: ['$project.name', 0] }, 'Unknown'],
              },
            },
          },
        },
      },
      {
        $project: {
          projectId: {
            $cond: {
              if: { $eq: ['$_id', '___UNASSIGNED___'] },
              then: null,
              else: '$_id',
            },
          },
          projectName: 1,
          totalCost: { $round: ['$totalCost', 4] },
          totalTokens: 1,
          totalRequests: 1,
          _id: 0,
        },
      },
      { $sort: { totalCost: -1 } },
    ]);
    return breakdown;
  }
}
