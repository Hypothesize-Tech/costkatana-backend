import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage } from '../../../schemas/core/usage.schema';
import type { Types } from 'mongoose';

export interface WorkflowAlertThresholds {
  maxCostPerRun?: number;
  maxLatencyMs?: number;
  maxErrorRatePercent?: number;
}

export interface WorkflowAlert {
  workflowId: string;
  workflowName: string;
  userId: string;
  type: 'cost' | 'latency' | 'error_rate';
  value: number;
  threshold: number;
  message: string;
  timestamp: Date;
}

@Injectable()
export class WorkflowAlertingService {
  private readonly logger = new Logger(WorkflowAlertingService.name);
  private readonly defaultThresholds: WorkflowAlertThresholds = {
    maxCostPerRun: 10,
    maxLatencyMs: 120000,
    maxErrorRatePercent: 10,
  };

  constructor(
    @InjectModel(Usage.name) private readonly usageModel: Model<Usage>,
  ) {}

  /**
   * Evaluate workflow runs for a user in a time window and return alerts that exceed thresholds.
   */
  async evaluateAlerts(
    userId: string,
    timeWindowMs: number = 24 * 60 * 60 * 1000,
    thresholds: WorkflowAlertThresholds = {},
  ): Promise<WorkflowAlert[]> {
    const th = { ...this.defaultThresholds, ...thresholds };
    const from = new Date(Date.now() - timeWindowMs);
    const usage = await this.usageModel
      .find({
        $or: [
          { tags: 'workflow' },
          { automationPlatform: { $exists: true, $ne: null } },
        ],
        userId: userId as unknown as Types.ObjectId,
        createdAt: { $gte: from },
      })
      .lean()
      .exec();

    const alerts: WorkflowAlert[] = [];
    const byWorkflow = new Map<
      string,
      Array<{ cost?: number; responseTime?: number; createdAt: Date }>
    >();
    for (const u of usage as Array<{
      workflowId?: string;
      workflowName?: string;
      cost?: number;
      responseTime?: number;
      createdAt: Date;
    }>) {
      const key = u.workflowId ?? u.workflowName ?? 'unknown';
      const list = byWorkflow.get(key) ?? [];
      list.push({
        cost: u.cost,
        responseTime: u.responseTime,
        createdAt: u.createdAt,
      });
      byWorkflow.set(key, list);
    }

    for (const [workflowId, runs] of byWorkflow.entries()) {
      const totalCost = runs.reduce((s, r) => s + (r.cost ?? 0), 0);
      const avgCost = runs.length ? totalCost / runs.length : 0;
      if (th.maxCostPerRun != null && avgCost > th.maxCostPerRun) {
        alerts.push({
          workflowId,
          workflowName: workflowId,
          userId,
          type: 'cost',
          value: avgCost,
          threshold: th.maxCostPerRun,
          message: `Average cost per run ($${avgCost.toFixed(4)}) exceeds threshold ($${th.maxCostPerRun})`,
          timestamp: new Date(),
        });
      }
      const latencies = runs.map((r) => r.responseTime ?? 0).filter(Boolean);
      const maxLatency = latencies.length ? Math.max(...latencies) : 0;
      if (th.maxLatencyMs != null && maxLatency > th.maxLatencyMs) {
        alerts.push({
          workflowId,
          workflowName: workflowId,
          userId,
          type: 'latency',
          value: maxLatency,
          threshold: th.maxLatencyMs,
          message: `Max latency (${maxLatency}ms) exceeds threshold (${th.maxLatencyMs}ms)`,
          timestamp: new Date(),
        });
      }
    }
    return alerts;
  }
}
