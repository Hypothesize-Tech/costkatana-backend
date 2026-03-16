import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage } from '../../../schemas/analytics/usage.schema';
import type { Types } from 'mongoose';

export interface WorkflowOptimizationSuggestion {
  workflowId: string;
  workflowName: string;
  type: 'model_switch' | 'batch' | 'cache' | 'timeout';
  description: string;
  estimatedSavingsPercent?: number;
  priority: 'low' | 'medium' | 'high';
}

@Injectable()
export class WorkflowOptimizationService {
  private readonly logger = new Logger(WorkflowOptimizationService.name);

  constructor(
    @InjectModel(Usage.name) private readonly usageModel: Model<Usage>,
  ) {}

  /**
   * Analyze workflow usage and return optimization suggestions.
   */
  async getSuggestions(
    userId: string,
    timeWindowMs: number = 7 * 24 * 60 * 60 * 1000,
  ): Promise<WorkflowOptimizationSuggestion[]> {
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

    const suggestions: WorkflowOptimizationSuggestion[] = [];
    const byWorkflow = new Map<
      string,
      Array<{ cost?: number; model?: string; responseTime?: number }>
    >();
    for (const u of usage as Array<{
      workflowId?: string;
      workflowName?: string;
      cost?: number;
      model?: string;
      responseTime?: number;
    }>) {
      const key = u.workflowId ?? u.workflowName ?? 'unknown';
      const list = byWorkflow.get(key) ?? [];
      list.push({ cost: u.cost, model: u.model, responseTime: u.responseTime });
      byWorkflow.set(key, list);
    }

    for (const [workflowId, runs] of byWorkflow.entries()) {
      const totalCost = runs.reduce((s, r) => s + (r.cost ?? 0), 0);
      const avgCost = runs.length ? totalCost / runs.length : 0;
      const models = runs.map((r) => r.model).filter(Boolean) as string[];
      const modelCounts = new Map<string, number>();
      for (const m of models) {
        modelCounts.set(m, (modelCounts.get(m) ?? 0) + 1);
      }
      if (avgCost > 0.5 && models.length > 0) {
        suggestions.push({
          workflowId,
          workflowName: workflowId,
          type: 'model_switch',
          description:
            'Consider using a lower-cost model for high-volume steps to reduce cost.',
          estimatedSavingsPercent: 20,
          priority: 'medium',
        });
      }
      if (runs.length > 10) {
        suggestions.push({
          workflowId,
          workflowName: workflowId,
          type: 'batch',
          description: 'Batch similar requests to reduce per-call overhead.',
          estimatedSavingsPercent: 10,
          priority: 'low',
        });
      }
    }
    return suggestions;
  }
}
