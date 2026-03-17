import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { Usage, UsageDocument } from '@/schemas/analytics/usage.schema';
import {
  TagHierarchy as TagHierarchyModel,
  TagHierarchyDocument,
} from '@/schemas/tagging/tag-hierarchy.schema';
import {
  CostAllocationRule as CostAllocationRuleModel,
  CostAllocationRuleDocument,
} from '@/schemas/tagging/cost-allocation-rule.schema';

export interface TagHierarchy {
  id: string;
  name: string;
  parent?: string;
  children?: string[];
  color?: string;
  description?: string;
  createdBy: string;
  createdAt: Date;
  isActive: boolean;
}

export interface CostAllocationRule {
  id: string;
  name: string;
  tagFilters: string[];
  allocationPercentage: number;
  department: string;
  team: string;
  costCenter: string;
  createdBy: string;
  isActive: boolean;
}

export interface TagAnalytics {
  tag: string;
  totalCost: number;
  totalCalls: number;
  totalTokens: number;
  averageCost: number;
  trend: 'up' | 'down' | 'stable';
  trendPercentage: number;
  lastUsed: Date;
  topServices: Array<{ service: string; cost: number; percentage: number }>;
  topModels: Array<{ model: string; cost: number; percentage: number }>;
  timeSeriesData: Array<{
    date: string;
    cost: number;
    calls: number;
    tokens: number;
  }>;
}

export interface RealTimeTagMetrics {
  tag: string;
  currentCost: number;
  currentCalls: number;
  hourlyRate: number;
  projectedDailyCost: number;
  projectedMonthlyCost: number;
  budgetUtilization?: number;
  alertThreshold?: number;
  lastUpdate: Date;
  isAboveBaseline?: boolean;
}

export interface GetTagAnalyticsOptions {
  startDate?: Date;
  endDate?: Date;
  tagFilter?: string[];
  includeHierarchy?: boolean;
  includeRealTime?: boolean;
}

const MAX_DB_FAILURES = 5;
const CIRCUIT_BREAKER_RESET_MS = 300_000; // 5 minutes
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const TAG_COLORS = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#06B6D4',
  '#84CC16',
  '#F97316',
  '#EC4899',
  '#6366F1',
];

const COMMON_TAGS = [
  'development',
  'production',
  'testing',
  'staging',
  'frontend',
  'backend',
  'api',
  'ui',
  'ml',
  'data',
  'urgent',
  'routine',
  'experimental',
  'optimization',
];

@Injectable()
export class TaggingService {
  private readonly logger = new Logger(TaggingService.name);
  private dbFailureCount = 0;
  private lastDbFailureTime = 0;

  constructor(
    @InjectModel(Usage.name)
    private readonly usageModel: Model<UsageDocument>,
    @InjectModel(TagHierarchyModel.name)
    private readonly tagHierarchyModel: Model<TagHierarchyDocument>,
    @InjectModel(CostAllocationRuleModel.name)
    private readonly costAllocationRuleModel: Model<CostAllocationRuleDocument>,
  ) {}

  async getTagAnalytics(
    userId: string,
    options: GetTagAnalyticsOptions = {},
  ): Promise<TagAnalytics[]> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('Database circuit breaker is open');
    }

    const startDate =
      options.startDate ?? new Date(Date.now() - THIRTY_DAYS_MS);
    const endDate = options.endDate ?? new Date();
    const { tagFilter } = options;

    const matchStage: Record<string, unknown> = {
      userId,
      createdAt: { $gte: startDate, $lte: endDate },
      tags: { $exists: true, $not: { $size: 0 } },
    };
    if (tagFilter?.length) {
      matchStage.tags = { $in: tagFilter };
    }

    const pipeline: PipelineStage[] = [
      { $match: matchStage },
      { $unwind: '$tags' },
      ...(tagFilter?.length ? [{ $match: { tags: { $in: tagFilter } } }] : []),
      {
        $facet: {
          analytics: [
            {
              $group: {
                _id: '$tags',
                totalCost: { $sum: '$cost' },
                totalCalls: { $sum: 1 },
                totalTokens: { $sum: { $ifNull: ['$totalTokens', 0] } },
                lastUsed: { $max: '$createdAt' },
                serviceBreakdown: {
                  $push: { service: '$provider', cost: '$cost' },
                },
                modelBreakdown: {
                  $push: { model: '$model', cost: '$cost' },
                },
                timeSeriesRaw: {
                  $push: {
                    date: {
                      $dateToString: {
                        format: '%Y-%m-%d',
                        date: '$createdAt',
                      },
                    },
                    cost: '$cost',
                    tokens: { $ifNull: ['$totalTokens', 0] },
                  },
                },
              },
            },
            {
              $project: {
                _id: 0,
                tag: '$_id',
                totalCost: 1,
                totalCalls: 1,
                totalTokens: 1,
                averageCost: { $divide: ['$totalCost', '$totalCalls'] },
                lastUsed: 1,
                serviceBreakdown: 1,
                modelBreakdown: 1,
                timeSeriesRaw: 1,
              },
            },
            { $sort: { totalCost: -1 } },
            { $limit: 50 },
          ],
        },
      },
    ];

    try {
      const results = await this.usageModel.aggregate<{
        analytics: Array<{
          tag: string;
          totalCost: number;
          totalCalls: number;
          totalTokens: number;
          averageCost: number;
          lastUsed: Date;
          serviceBreakdown: Array<{ service: string; cost: number }>;
          modelBreakdown: Array<{ model: string; cost: number }>;
          timeSeriesRaw: Array<{ date: string; cost: number; tokens: number }>;
        }>;
      }>(pipeline);

      const analytics = results[0]?.analytics ?? [];
      const tagAnalytics: TagAnalytics[] = analytics.map((row) => ({
        tag: row.tag,
        totalCost: row.totalCost,
        totalCalls: row.totalCalls,
        totalTokens: row.totalTokens,
        averageCost: row.averageCost,
        trend: 'stable' as const,
        trendPercentage: 0,
        lastUsed: row.lastUsed,
        topServices: this.processServiceBreakdown(
          row.serviceBreakdown,
          row.totalCost,
        ),
        topModels: this.processModelBreakdown(
          row.modelBreakdown,
          row.totalCost,
        ),
        timeSeriesData: this.processTimeSeriesData(row.timeSeriesRaw),
      }));

      this.dbFailureCount = 0;
      return tagAnalytics;
    } catch (error) {
      this.recordDbFailure();
      this.logger.error('Error getting tag analytics', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw error;
    }
  }

  async getRealTimeTagMetrics(
    userId: string,
    tags?: string[],
  ): Promise<RealTimeTagMetrics[]> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('Database circuit breaker is open');
    }

    const now = new Date();
    const hourAgo = new Date(now.getTime() - ONE_HOUR_MS);
    const dayAgo = new Date(now.getTime() - ONE_DAY_MS);

    const baseMatch: Record<string, unknown> = { userId };
    if (tags?.length) {
      baseMatch.tags = { $in: tags };
    }

    const pipeline: PipelineStage[] = [
      { $match: baseMatch },
      { $unwind: '$tags' },
      ...(tags?.length ? [{ $match: { tags: { $in: tags } } }] : []),
      {
        $facet: {
          currentHour: [
            { $match: { createdAt: { $gte: hourAgo, $lte: now } } },
            {
              $group: {
                _id: '$tags',
                currentCost: { $sum: '$cost' },
                currentCalls: { $sum: 1 },
              },
            },
          ],
          baseline24h: [
            { $match: { createdAt: { $gte: dayAgo, $lte: now } } },
            {
              $group: {
                _id: null,
                totalCost: { $sum: '$cost' },
              },
            },
          ],
        },
      },
    ];

    try {
      const results = await this.usageModel.aggregate<{
        currentHour: Array<{
          _id: string;
          currentCost: number;
          currentCalls: number;
        }>;
        baseline24h: Array<{ totalCost: number }>;
      }>(pipeline);

      const baseline24h = results[0]?.baseline24h?.[0]?.totalCost ?? 0;
      const avgHourlyBaseline = baseline24h / 24;
      const currentHour = results[0]?.currentHour ?? [];

      const metrics: RealTimeTagMetrics[] = currentHour.map((row) => {
        const hourlyRate = row.currentCost;
        const projectedDailyCost = hourlyRate * 24;
        const projectedMonthlyCost = projectedDailyCost * 30;
        const isAboveBaseline = row.currentCost > avgHourlyBaseline * 1.1;
        return {
          tag: row._id,
          currentCost: row.currentCost,
          currentCalls: row.currentCalls,
          hourlyRate,
          projectedDailyCost,
          projectedMonthlyCost,
          lastUpdate: now,
          isAboveBaseline,
        };
      });

      this.dbFailureCount = 0;
      return metrics;
    } catch (error) {
      this.recordDbFailure();
      this.logger.error('Error getting real-time tag metrics', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw error;
    }
  }

  async createTagHierarchy(
    userId: string,
    data: {
      name: string;
      parent?: string;
      color?: string;
      description?: string;
    },
  ): Promise<TagHierarchy> {
    const hierarchyDoc = new this.tagHierarchyModel({
      name: data.name,
      parent: data.parent,
      children: [],
      color: data.color ?? this.generateRandomColor(),
      description: data.description,
      createdBy: userId,
      isActive: true,
    });
    await hierarchyDoc.save();
    return {
      id: hierarchyDoc._id.toString(),
      name: hierarchyDoc.name,
      parent: hierarchyDoc.parent,
      children: hierarchyDoc.children ?? [],
      color: hierarchyDoc.color,
      description: hierarchyDoc.description,
      createdBy: hierarchyDoc.createdBy,
      createdAt: (hierarchyDoc as any).createdAt ?? new Date(),
      isActive: hierarchyDoc.isActive,
    };
  }

  async getTagSuggestions(
    userId: string,
    context: {
      service?: string;
      model?: string;
      prompt?: string;
      projectId?: string;
    },
  ): Promise<string[]> {
    if (this.isCircuitBreakerOpen()) {
      throw new Error('Database circuit breaker is open');
    }

    const suggestions = new Set<string>();
    const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);

    try {
      const tagFrequencyData = await this.usageModel.aggregate<{
        tag: string;
        frequency: number;
      }>([
        {
          $match: {
            userId,
            createdAt: { $gte: sevenDaysAgo },
            tags: { $exists: true, $not: { $size: 0 } },
          },
        },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', frequency: { $sum: 1 } } },
        { $sort: { frequency: -1 } },
        { $limit: 10 },
        { $project: { _id: 0, tag: '$_id', frequency: 1 } },
      ]);

      tagFrequencyData.forEach(({ tag }) => suggestions.add(tag));
      if (context.service) suggestions.add(context.service);
      if (context.model) suggestions.add(context.model);
      if (context.projectId) suggestions.add('project');
      COMMON_TAGS.forEach((tag) => suggestions.add(tag));

      this.dbFailureCount = 0;
      return Array.from(suggestions).slice(0, 20);
    } catch (error) {
      this.recordDbFailure();
      this.logger.error('Error getting tag suggestions', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      throw error;
    }
  }

  async createCostAllocationRule(
    userId: string,
    data: {
      name: string;
      tagFilters: string[];
      allocationPercentage: number;
      department: string;
      team: string;
      costCenter: string;
    },
  ): Promise<CostAllocationRule> {
    const ruleDoc = new this.costAllocationRuleModel({
      name: data.name,
      tagFilters: data.tagFilters,
      allocationPercentage: data.allocationPercentage,
      department: data.department,
      team: data.team,
      costCenter: data.costCenter,
      createdBy: userId,
      isActive: true,
    });
    await ruleDoc.save();
    return {
      id: ruleDoc._id.toString(),
      name: ruleDoc.name,
      tagFilters: ruleDoc.tagFilters,
      allocationPercentage: ruleDoc.allocationPercentage,
      department: ruleDoc.department,
      team: ruleDoc.team,
      costCenter: ruleDoc.costCenter,
      createdBy: ruleDoc.createdBy,
      isActive: ruleDoc.isActive,
    };
  }

  isCircuitBreakerOpen(): boolean {
    if (this.dbFailureCount < MAX_DB_FAILURES) return false;
    const elapsed = Date.now() - this.lastDbFailureTime;
    if (elapsed < CIRCUIT_BREAKER_RESET_MS) return true;
    this.dbFailureCount = 0;
    return false;
  }

  private recordDbFailure(): void {
    this.dbFailureCount += 1;
    this.lastDbFailureTime = Date.now();
  }

  private processServiceBreakdown(
    rows: Array<{ service: string; cost: number }>,
    totalCost: number,
  ): Array<{ service: string; cost: number; percentage: number }> {
    const map = new Map<string, number>();
    for (const { service, cost } of rows) {
      map.set(service, (map.get(service) ?? 0) + cost);
    }
    return Array.from(map.entries())
      .map(([service, cost]) => ({
        service,
        cost,
        percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);
  }

  private processModelBreakdown(
    rows: Array<{ model: string; cost: number }>,
    totalCost: number,
  ): Array<{ model: string; cost: number; percentage: number }> {
    const map = new Map<string, number>();
    for (const { model, cost } of rows) {
      map.set(model, (map.get(model) ?? 0) + cost);
    }
    return Array.from(map.entries())
      .map(([model, cost]) => ({
        model,
        cost,
        percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 5);
  }

  private processTimeSeriesData(
    rows: Array<{ date: string; cost: number; tokens: number }>,
  ): Array<{ date: string; cost: number; calls: number; tokens: number }> {
    const map = new Map<
      string,
      { cost: number; calls: number; tokens: number }
    >();
    for (const { date, cost, tokens } of rows) {
      const cur = map.get(date);
      if (cur) {
        cur.cost += cost;
        cur.calls += 1;
        cur.tokens += tokens;
      } else {
        map.set(date, { cost, calls: 1, tokens });
      }
    }
    return Array.from(map.entries())
      .map(([date, data]) => ({
        date,
        cost: data.cost,
        calls: data.calls,
        tokens: data.tokens,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30);
  }

  private generateTagId(): string {
    return `tag_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private generateRandomColor(): string {
    return (
      TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)] ?? TAG_COLORS[0]
    );
  }

  onModuleDestroy(): void {
    this.dbFailureCount = 0;
    this.lastDbFailureTime = 0;
  }
}
