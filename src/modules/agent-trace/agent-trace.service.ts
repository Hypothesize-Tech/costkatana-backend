import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage, UsageDocument } from '../../schemas/core/usage.schema';
import type { Types } from 'mongoose';

interface UsageLean {
  _id?: unknown;
  userId?: unknown;
  traceId?: string;
  traceName?: string;
  traceStep?: string;
  traceSequence?: number;
  automationPlatform?: string;
  cost?: number;
  totalTokens?: number;
  responseTime?: number;
  model?: string;
  service?: string;
  createdAt?: Date;
  tags?: string[];
}

/**
 * Agent Trace service - queries Usage collection using traceId/traceName fields
 * (aligned with Express agentTrace.controller)
 */
@Injectable()
export class AgentTraceService {
  private readonly logger = new Logger(AgentTraceService.name);

  constructor(
    @InjectModel(Usage.name) private readonly usageModel: Model<Usage>,
  ) {}

  async getTracesList(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    data: unknown[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      pages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
  }> {
    const skip = (page - 1) * limit;

    const traceUsage = await this.usageModel
      .find({
        $or: [
          { tags: 'agent_trace' },
          { traceId: { $exists: true, $ne: null } },
        ],
        userId: userId as unknown as Types.ObjectId,
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    if (!traceUsage?.length) {
      return {
        data: [],
        pagination: {
          page,
          limit,
          total: 0,
          pages: 0,
          hasNext: false,
          hasPrev: false,
        },
      };
    }

    const tracesMap = new Map<string, UsageLean[]>();
    for (const u of traceUsage as UsageLean[]) {
      const traceId = u.traceId;
      if (!traceId) continue;
      if (!tracesMap.has(traceId)) tracesMap.set(traceId, []);
      tracesMap.get(traceId)!.push(u);
    }

    const traceSummaries: unknown[] = [];
    for (const [traceId, steps] of Array.from(tracesMap.entries())) {
      const arr = steps;
      arr.sort(
        (a: any, b: any) => (a.traceSequence ?? 0) - (b.traceSequence ?? 0),
      );

      const name = arr[0].traceName ?? 'Unknown Trace';
      const totalCost = arr.reduce(
        (sum: number, x: any) => sum + (x.cost ?? 0),
        0,
      );
      const totalTokens = arr.reduce(
        (sum: number, x: any) => sum + (x.totalTokens ?? 0),
        0,
      );

      const startTime = arr[0].createdAt!;
      const endTime = arr[arr.length - 1].createdAt!;
      const duration =
        new Date(endTime).getTime() - new Date(startTime).getTime();

      traceSummaries.push({
        traceId,
        traceName: name,
        totalCost,
        totalTokens,
        requestCount: arr.length,
        averageCost: totalCost / arr.length,
        steps: arr.map((s: any) => ({
          step: s.traceStep,
          sequence: s.traceSequence,
          cost: s.cost,
          tokens: s.totalTokens,
          responseTime: s.responseTime,
          model: s.model,
          service: s.service,
          timestamp: s.createdAt,
        })),
        startTime,
        endTime,
        duration,
        status: 'completed',
        createdAt: startTime,
        updatedAt: endTime,
      });
    }

    traceSummaries.sort(
      (a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    const total = traceSummaries.length;
    const data = traceSummaries.slice(skip, skip + limit);

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: skip + limit < total,
        hasPrev: page > 1,
      },
    };
  }

  async getTraceAnalytics(userId: string): Promise<{
    totalTraces: number;
    totalCost: number;
    averageTraceCost: number;
    topTraceTypes: Array<{
      traceName: string;
      count: number;
      totalCost: number;
      averageCost: number;
    }>;
    costByStep: unknown[];
  }> {
    const traceUsage = await this.usageModel
      .find({
        $or: [
          { tags: 'agent_trace' },
          { traceId: { $exists: true, $ne: null } },
        ],
        userId: userId as unknown as Types.ObjectId,
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    if (!traceUsage?.length) {
      return {
        totalTraces: 0,
        totalCost: 0,
        averageTraceCost: 0,
        topTraceTypes: [],
        costByStep: [],
      };
    }

    const tracesMap = new Map<string, UsageLean[]>();
    for (const u of traceUsage as UsageLean[]) {
      const traceId = u.traceId;
      if (!traceId) continue;
      if (!tracesMap.has(traceId)) tracesMap.set(traceId, []);
      tracesMap.get(traceId)!.push(u);
    }

    const totalTraces = tracesMap.size;
    const totalCost = (traceUsage as UsageLean[]).reduce(
      (sum: number, u: any) => sum + (u.cost ?? 0),
      0,
    );

    const traceTypesMap = new Map<
      string,
      { count: number; totalCost: number }
    >();
    for (const [, steps] of Array.from(tracesMap.entries())) {
      const arr = steps;
      const name = arr[0].traceName ?? 'Unknown Trace';
      const cost = arr.reduce((sum: number, x: any) => sum + (x.cost ?? 0), 0);

      const prev = traceTypesMap.get(name) ?? { count: 0, totalCost: 0 };
      prev.count += 1;
      prev.totalCost += cost;
      traceTypesMap.set(name, prev);
    }

    const topTraceTypes = Array.from(traceTypesMap.entries()).map(
      ([traceName, data]) => ({
        traceName,
        count: data.count,
        totalCost: data.totalCost,
        averageCost: data.totalCost / data.count,
      }),
    );

    topTraceTypes.sort((a, b) => b.totalCost - a.totalCost);

    return {
      totalTraces,
      totalCost,
      averageTraceCost: totalTraces ? totalCost / totalTraces : 0,
      topTraceTypes,
      costByStep: [],
    };
  }

  async getObservabilityDashboard(
    userId: string,
    timeRange: string = '24h',
  ): Promise<{
    overview: {
      totalExecutions: number;
      successRate: number;
      averageDuration: number;
      totalCost: number;
      activeWorkflows: number;
    };
    recentExecutions: unknown[];
    performanceMetrics: unknown;
    costAnalysis: unknown;
    alerts: unknown[];
  }> {
    // Parse timeRange into a date window
    const now = new Date();
    let fromDate = new Date(now.getTime());
    if (typeof timeRange === 'string') {
      const regex = /^(\d+)([hdw])$/;
      const match = regex.exec(timeRange);
      if (match) {
        const value = parseInt(match[1], 10);
        const unit = match[2];
        switch (unit) {
          case 'h':
            fromDate.setHours(now.getHours() - value);
            break;
          case 'd':
            fromDate.setDate(now.getDate() - value);
            break;
          case 'w':
            fromDate.setDate(now.getDate() - value * 7);
            break;
          default:
            fromDate = new Date(now.getTime() - 24 * 3600 * 1000);
        }
      } else {
        // default to 24 hours
        fromDate = new Date(now.getTime() - 24 * 3600 * 1000);
      }
    }

    const traceUsage = await this.usageModel
      .find({
        $or: [
          { tags: 'agent_trace' },
          { traceId: { $exists: true, $ne: null } },
          { automationPlatform: { $exists: true, $ne: null } },
        ],
        userId: userId as unknown as Types.ObjectId,
        createdAt: { $gte: fromDate },
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    if (!traceUsage?.length) {
      return {
        overview: {
          totalExecutions: 0,
          successRate: 0,
          averageDuration: 0,
          totalCost: 0,
          activeWorkflows: 0,
        },
        recentExecutions: [],
        performanceMetrics: {
          throughput: { period: 'hour', values: [] },
          latency: { p50: 0, p95: 0, p99: 0 },
          errorRate: { current: 0, trend: 0 },
        },
        costAnalysis: { totalSpend: 0, breakdown: [], trend: { daily: [] } },
        alerts: [],
      };
    }

    const tracesMap = new Map<string, UsageLean[]>();
    for (const u of traceUsage as UsageLean[]) {
      let key: string | null = null;

      if (u.automationPlatform) {
        key = u.traceId
          ? `${u.automationPlatform}_${u.traceId}`
          : u.traceName
            ? `${u.automationPlatform}_${u.traceName}`
            : `${u.automationPlatform}_unknown_${String(u._id)}`;
      } else if (u.traceId) {
        key = u.traceId;
      } else if (u.tags?.includes?.('agent_trace') && u.traceName) {
        key = `trace_${u.traceName}`;
      }

      if (!key) continue;
      if (!tracesMap.has(key)) tracesMap.set(key, []);
      tracesMap.get(key)!.push(u);
    }

    const recentExecutions: Array<{
      traceId?: string;
      traceName?: string;
      automationPlatform?: string;
      totalCost?: number;
      totalTokens?: number;
      requestCount?: number;
      averageCost?: number;
      steps?: unknown[];
      startTime?: unknown;
      endTime?: unknown;
      duration?: number;
    }> = [];
    for (const [traceId, steps] of Array.from(tracesMap.entries())) {
      const arr = [...steps].sort((a: any, b: any) => {
        if (a.traceSequence !== undefined && b.traceSequence !== undefined) {
          return a.traceSequence - b.traceSequence;
        }
        return (
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });

      const name = arr[0].traceName ?? 'Unknown Trace';
      const automationPlatform = arr[0].automationPlatform;

      const totalCost = arr.reduce(
        (sum: number, x: any) => sum + (x.cost ?? 0),
        0,
      );
      const totalTokens = arr.reduce(
        (sum: number, x: any) => sum + (x.totalTokens ?? 0),
        0,
      );

      const startTime = arr[0].createdAt!;
      const endTime = arr[arr.length - 1].createdAt!;
      const duration =
        new Date(endTime).getTime() - new Date(startTime).getTime();

      recentExecutions.push({
        traceId,
        traceName: name,
        automationPlatform: automationPlatform || undefined,
        totalCost,
        totalTokens,
        requestCount: arr.length,
        averageCost: totalCost / arr.length,
        steps: arr.map((s: any) => ({
          step: s.traceStep ?? s.traceName ?? 'Step',
          sequence: s.traceSequence ?? 0,
          cost: s.cost,
          tokens: s.totalTokens,
          responseTime: s.responseTime ?? 0,
          model: s.model,
          service: s.service,
          timestamp: s.createdAt,
          automationPlatform: s.automationPlatform || undefined,
        })),
        startTime,
        endTime,
        duration,
      });
    }

    recentExecutions.sort((a: any, b: any) => {
      const aTime = new Date(a.endTime).getTime();
      const bTime = new Date(b.endTime).getTime();
      return bTime - aTime;
    });

    const sumCost = recentExecutions.reduce(
      (sum: number, w: any) => sum + (w.totalCost as number),
      0,
    );
    const avgDuration =
      recentExecutions.length > 0
        ? recentExecutions.reduce(
            (sum: number, w: any) => sum + (w.duration as number),
            0,
          ) / recentExecutions.length
        : 0;

    return {
      overview: {
        totalExecutions: tracesMap.size,
        successRate: 95,
        averageDuration: avgDuration,
        totalCost: sumCost,
        activeWorkflows: 0,
      },
      recentExecutions,
      performanceMetrics: {
        throughput: {
          period: 'hour',
          values: Array.from({ length: 24 }, (_, i) =>
            i >= 9 && i <= 17
              ? 3 + Math.floor(Math.random() * 5)
              : Math.floor(Math.random() * 3),
          ),
        },
        latency: {
          p50: avgDuration,
          p95: avgDuration * 1.5,
          p99: avgDuration * 2,
        },
        errorRate: { current: 5, trend: 0 },
      },
      costAnalysis: {
        totalSpend: sumCost,
        breakdown: Array.from(
          new Set(
            (recentExecutions as Array<{ traceName: string }>).map(
              (w) => w.traceName,
            ),
          ),
        ).map((name) => {
          const items = (
            recentExecutions as Array<{ traceName: string; totalCost: number }>
          ).filter((w) => w.traceName === name);
          const amount = items.reduce((sum, w) => sum + w.totalCost, 0);
          return {
            category: name,
            amount,
            percentage: sumCost > 0 ? (amount / sumCost) * 100 : 0,
          };
        }),
        trend: {
          daily: Array.from({ length: 7 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - i));
            const dayStart = new Date(d);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(d);
            dayEnd.setHours(23, 59, 59, 999);
            const executionsForDay = (
              recentExecutions as Array<{ endTime: Date; totalCost: number }>
            ).filter((e) => {
              const end = new Date(e.endTime).getTime();
              return end >= dayStart.getTime() && end <= dayEnd.getTime();
            });
            const dayTotal = executionsForDay.reduce(
              (sum, e) => sum + e.totalCost,
              0,
            );
            return {
              date: d.toISOString().split('T')[0],
              amount: dayTotal,
            };
          }),
        },
      },
      alerts: [],
    };
  }
}
