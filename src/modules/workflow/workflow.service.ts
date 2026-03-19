import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage } from '../../schemas/core/usage.schema';
import type { Types } from 'mongoose';

interface UsageLean {
  _id?: unknown;
  userId?: unknown;
  workflowId?: string;
  workflowName?: string;
  workflowStep?: string;
  workflowSequence?: number;
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
 * Workflow list, analytics, and dashboard from Usage collection (aligned with Express).
 */
@Injectable()
export class WorkflowService {
  constructor(
    @InjectModel(Usage.name) private readonly usageModel: Model<Usage>,
  ) {}

  async getWorkflowsList(
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
    const workflowUsage = await this.usageModel
      .find({
        tags: 'workflow',
        userId: userId as unknown as Types.ObjectId,
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    if (!workflowUsage?.length) {
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

    const workflowsMap = new Map<string, UsageLean[]>();
    for (const u of workflowUsage as UsageLean[]) {
      const wid = u.workflowId;
      if (!wid) continue;
      if (!workflowsMap.has(wid)) workflowsMap.set(wid, []);
      workflowsMap.get(wid)!.push(u);
    }

    const workflowSummaries: unknown[] = [];
    for (const [workflowId, steps] of workflowsMap.entries()) {
      const arr = steps;
      arr.sort((a, b) => (a.workflowSequence ?? 0) - (b.workflowSequence ?? 0));
      const name = arr[0].workflowName ?? 'Unknown Workflow';
      const totalCost = arr.reduce((s, x) => s + (x.cost ?? 0), 0);
      const totalTokens = arr.reduce((s, x) => s + (x.totalTokens ?? 0), 0);
      const startTime = arr[0].createdAt!;
      const endTime = arr[arr.length - 1].createdAt!;
      const duration =
        new Date(endTime).getTime() - new Date(startTime).getTime();
      workflowSummaries.push({
        workflowId,
        workflowName: name,
        totalCost,
        totalTokens,
        requestCount: arr.length,
        averageCost: totalCost / arr.length,
        steps: arr.map(
          (s) =>
            ({
              step: s.workflowStep,
              sequence: s.workflowSequence,
              cost: s.cost,
              tokens: s.totalTokens,
              responseTime: s.responseTime,
              model: s.model,
              service: s.service,
              timestamp: s.createdAt,
            }) as Record<string, unknown>,
        ),
        startTime,
        endTime,
        duration,
        status: 'completed',
        createdAt: startTime,
        updatedAt: endTime,
      });
    }

    workflowSummaries.sort(
      (a, b) =>
        new Date((b as { createdAt: Date }).createdAt).getTime() -
        new Date((a as { createdAt: Date }).createdAt).getTime(),
    );
    const total = workflowSummaries.length;
    const data = workflowSummaries.slice(skip, skip + limit);
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

  async getWorkflowAnalytics(userId: string): Promise<{
    totalWorkflows: number;
    totalCost: number;
    averageWorkflowCost: number;
    topWorkflowTypes: Array<{
      workflowName: string;
      count: number;
      totalCost: number;
      averageCost: number;
    }>;
    costByStep: unknown[];
  }> {
    const workflowUsage = await this.usageModel
      .find({
        tags: 'workflow',
        userId: userId as unknown as Types.ObjectId,
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    if (!workflowUsage?.length) {
      return {
        totalWorkflows: 0,
        totalCost: 0,
        averageWorkflowCost: 0,
        topWorkflowTypes: [],
        costByStep: [],
      };
    }

    const workflowsMap = new Map<string, UsageLean[]>();
    for (const u of workflowUsage as UsageLean[]) {
      const wid = u.workflowId;
      if (!wid) continue;
      if (!workflowsMap.has(wid)) workflowsMap.set(wid, []);
      workflowsMap.get(wid)!.push(u);
    }

    const totalWorkflows = workflowsMap.size;
    const totalCost = (workflowUsage as UsageLean[]).reduce(
      (s, u) => s + (u.cost ?? 0),
      0,
    );
    const workflowTypesMap = new Map<
      string,
      { count: number; totalCost: number }
    >();
    for (const [, steps] of workflowsMap.entries()) {
      const arr = steps;
      const name = arr[0].workflowName ?? 'Unknown Workflow';
      const cost = arr.reduce((s, x) => s + (x.cost ?? 0), 0);
      const prev = workflowTypesMap.get(name) ?? { count: 0, totalCost: 0 };
      prev.count += 1;
      prev.totalCost += cost;
      workflowTypesMap.set(name, prev);
    }
    const topWorkflowTypes = Array.from(workflowTypesMap.entries()).map(
      ([workflowName, data]) => ({
        workflowName,
        count: data.count,
        totalCost: data.totalCost,
        averageCost: data.totalCost / data.count,
      }),
    );
    topWorkflowTypes.sort((a, b) => b.totalCost - a.totalCost);

    return {
      totalWorkflows,
      totalCost,
      averageWorkflowCost: totalWorkflows ? totalCost / totalWorkflows : 0,
      topWorkflowTypes,
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

    const workflowUsage = await this.usageModel
      .find({
        $or: [
          { tags: 'workflow' },
          { automationPlatform: { $exists: true, $ne: null } },
        ],
        userId: userId as unknown as Types.ObjectId,
        createdAt: { $gte: fromDate },
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    if (!workflowUsage?.length) {
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

    const workflowsMap = new Map<string, UsageLean[]>();
    for (const u of workflowUsage as UsageLean[]) {
      let key: string | null = null;
      if (u.automationPlatform) {
        key = u.workflowId
          ? `${u.automationPlatform}_${u.workflowId}`
          : u.workflowName
            ? `${u.automationPlatform}_${u.workflowName}`
            : `${u.automationPlatform}_unknown_${String(u._id)}`;
      } else if (u.workflowId) {
        key = u.workflowId;
      } else if (u.tags?.includes?.('workflow') && u.workflowName) {
        key = `workflow_${u.workflowName}`;
      }
      if (!key) continue;
      if (!workflowsMap.has(key)) workflowsMap.set(key, []);
      workflowsMap.get(key)!.push(u);
    }

    const recentExecutions: unknown[] = [];
    for (const [workflowId, steps] of workflowsMap.entries()) {
      const arr = [...steps].sort(
        (a, b) => (a.workflowSequence ?? 0) - (b.workflowSequence ?? 0),
      );
      const name = arr[0].workflowName ?? 'Unknown Workflow';
      const totalCost = arr.reduce((s, x) => s + (x.cost ?? 0), 0);
      const totalTokens = arr.reduce((s, x) => s + (x.totalTokens ?? 0), 0);
      const startTime = arr[0].createdAt!;
      const endTime = arr[arr.length - 1].createdAt!;
      const duration =
        new Date(endTime).getTime() - new Date(startTime).getTime();
      recentExecutions.push({
        workflowId,
        workflowName: name,
        automationPlatform: arr[0].automationPlatform,
        totalCost,
        totalTokens,
        requestCount: arr.length,
        averageCost: totalCost / arr.length,
        steps: arr.map((s) => ({
          step: s.workflowStep ?? s.workflowName ?? 'Step',
          sequence: s.workflowSequence ?? 0,
          cost: s.cost,
          tokens: s.totalTokens,
          responseTime: s.responseTime ?? 0,
          model: s.model,
          service: s.service,
          timestamp: s.createdAt,
          automationPlatform: s.automationPlatform,
        })),
        startTime,
        endTime,
        duration,
      });
    }

    recentExecutions.sort(
      (a, b) =>
        new Date((b as { endTime: Date }).endTime).getTime() -
        new Date((a as { endTime: Date }).endTime).getTime(),
    );
    const sumCost = (recentExecutions as Array<{ totalCost: number }>).reduce(
      (s, w) => s + w.totalCost,
      0,
    );
    const avgDuration =
      recentExecutions.length > 0
        ? (recentExecutions as Array<{ duration: number }>).reduce(
            (s, w) => s + w.duration,
            0,
          ) / recentExecutions.length
        : 0;

    // Compute throughput per hour from actual execution data (last 24 hours)
    const nowMs = now.getTime();
    const hourlyCounts = new Array<number>(24).fill(0);
    const oneHourMs = 60 * 60 * 1000;
    for (const exec of recentExecutions as Array<{ endTime: Date }>) {
      const endMs = new Date(exec.endTime).getTime();
      const hoursAgo = (nowMs - endMs) / oneHourMs;
      const bucketIndex = Math.floor(hoursAgo);
      if (bucketIndex >= 0 && bucketIndex < 24) {
        hourlyCounts[23 - bucketIndex] += 1;
      }
    }

    return {
      overview: {
        totalExecutions: workflowsMap.size,
        successRate: 95,
        averageDuration: avgDuration,
        totalCost: sumCost,
        activeWorkflows: 0,
      },
      recentExecutions,
      performanceMetrics: {
        throughput: {
          period: 'hour',
          values: hourlyCounts,
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
            (recentExecutions as Array<{ workflowName: string }>).map(
              (w) => w.workflowName,
            ),
          ),
        ).map((name) => {
          const items = (
            recentExecutions as Array<{
              workflowName: string;
              totalCost: number;
            }>
          ).filter((w) => w.workflowName === name);
          const amount = items.reduce((s, w) => s + w.totalCost, 0);
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
            // Filter executions for this day
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
              (s, e) => s + e.totalCost,
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
