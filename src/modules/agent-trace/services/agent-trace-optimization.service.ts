import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Usage } from '../../../schemas/core/usage.schema';
import { Activity } from '../../../schemas/core/activity.schema';

export interface WorkflowOptimizationRecommendation {
  type: 'immediate' | 'short_term' | 'long_term';
  category:
    | 'model_switch'
    | 'caching'
    | 'redundancy'
    | 'batching'
    | 'prompt_optimization'
    | 'workflow_design';
  title: string;
  description: string;
  workflowId?: string;
  workflowName?: string;
  step?: string;
  currentModel?: string;
  recommendedModel?: string;
  potentialSavings: number;
  potentialSavingsPercentage: number;
  implementationEffort: 'low' | 'medium' | 'high';
  estimatedTimeToImplement?: string;
  steps: string[];
  metadata?: Record<string, any>;
}

export interface WorkflowPerformanceMetrics {
  workflowId: string;
  workflowName: string;
  platform: string;
  totalCost: number;
  totalExecutions: number;
  totalTokens: number;
  averageCostPerExecution: number;
  averageTokensPerExecution: number;
  averageResponseTime: number;
  costPerStep: Array<{
    step: string;
    sequence: number;
    cost: number;
    tokens: number;
    executions: number;
    averageCost: number;
  }>;
  modelUsage: Array<{
    model: string;
    service: string;
    cost: number;
    tokens: number;
    executions: number;
    percentageOfTotal: number;
  }>;
  timeSeries: Array<{
    date: string;
    cost: number;
    executions: number;
    tokens: number;
  }>;
}

/**
 * Agent Trace Optimization Service - NestJS equivalent of Express WorkflowOptimizationService
 * Provides optimization recommendations and performance analytics for agent traces
 */
@Injectable()
export class AgentTraceOptimizationService {
  private readonly logger = new Logger(AgentTraceOptimizationService.name);

  constructor(
    @InjectModel(Usage.name) private readonly usageModel: Model<Usage>,
    @InjectModel(Activity.name) private readonly activityModel: Model<Activity>,
  ) {}

  /**
   * Get workflow performance metrics
   */
  async getWorkflowPerformanceMetrics(
    userId: string,
    workflowId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<WorkflowPerformanceMetrics | null> {
    try {
      const match: Record<string, unknown> = {
        userId: new Types.ObjectId(userId),
        traceId: workflowId,
        automationPlatform: { $exists: true, $ne: null },
      };

      if (startDate || endDate) {
        match.createdAt = {} as Record<string, Date>;
        if (startDate)
          (match.createdAt as Record<string, Date>).$gte = startDate;
        if (endDate) (match.createdAt as Record<string, Date>).$lte = endDate;
      }

      // Get workflow usage data (include model and service from Usage for modelUsage breakdown)
      const workflowData = await this.usageModel.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalCost: { $sum: '$cost' },
            totalTokens: { $sum: '$totalTokens' },
            totalExecutions: { $sum: 1 },
            averageResponseTime: { $avg: '$responseTime' },
            workflowName: { $first: '$traceName' },
            platform: { $first: '$automationPlatform' },
            steps: {
              $push: {
                step: '$traceStep',
                sequence: '$traceSequence',
                cost: '$cost',
                tokens: '$totalTokens',
                responseTime: '$responseTime',
                model: '$model',
                service: '$service',
              },
            },
          },
        },
      ]);

      if (!workflowData || workflowData.length === 0) {
        return null;
      }

      const data = workflowData[0];

      // Process cost per step
      const stepMap = new Map<
        string,
        {
          step: string;
          sequence: number;
          cost: number;
          tokens: number;
          executions: number;
        }
      >();
      data.steps.forEach(
        (step: {
          step?: string;
          sequence?: number;
          cost?: number;
          tokens?: number;
        }) => {
          if (step.step) {
            const existing = stepMap.get(step.step) || {
              step: step.step,
              sequence: step.sequence || 0,
              cost: 0,
              tokens: 0,
              executions: 0,
            };
            existing.cost += step.cost || 0;
            existing.tokens += step.tokens || 0;
            existing.executions += 1;
            stepMap.set(step.step, existing);
          }
        },
      );

      const costPerStep = Array.from(stepMap.values()).map((step) => ({
        ...step,
        averageCost: step.executions > 0 ? step.cost / step.executions : 0,
      }));

      // Process model usage from steps (model and service from Usage schema)
      const modelMap = new Map<
        string,
        {
          model: string;
          service: string;
          cost: number;
          tokens: number;
          executions: number;
        }
      >();
      data.steps.forEach(
        (step: {
          model?: string;
          service?: string;
          cost?: number;
          tokens?: number;
        }) => {
          const model = step.model ?? 'unknown';
          const service = step.service ?? 'unknown';
          const key = `${model}-${service}`;
          const existing = modelMap.get(key);
          if (existing) {
            existing.cost += step.cost ?? 0;
            existing.tokens += step.tokens ?? 0;
            existing.executions += 1;
          } else {
            modelMap.set(key, {
              model,
              service,
              cost: step.cost ?? 0,
              tokens: step.tokens ?? 0,
              executions: 1,
            });
          }
        },
      );

      const modelUsage = Array.from(modelMap.values()).map((model) => ({
        ...model,
        percentageOfTotal:
          data.totalCost > 0 ? (model.cost / data.totalCost) * 100 : 0,
      }));

      // Generate time series (last 30 days)
      const timeSeries = await this.generateTimeSeriesData(
        userId,
        workflowId,
        startDate,
        endDate,
      );

      return {
        workflowId,
        workflowName: data.workflowName || workflowId,
        platform: data.platform || 'unknown',
        totalCost: data.totalCost || 0,
        totalExecutions: data.totalExecutions || 0,
        totalTokens: data.totalTokens || 0,
        averageCostPerExecution:
          data.totalExecutions > 0 ? data.totalCost / data.totalExecutions : 0,
        averageTokensPerExecution:
          data.totalExecutions > 0
            ? data.totalTokens / data.totalExecutions
            : 0,
        averageResponseTime: data.averageResponseTime || 0,
        costPerStep,
        modelUsage,
        timeSeries,
      };
    } catch (error) {
      this.logger.error('Error getting workflow performance metrics', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        workflowId,
      });
      throw error;
    }
  }

  /**
   * Generate time series data for workflow performance
   */
  private async generateTimeSeriesData(
    userId: string,
    workflowId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<
    Array<{ date: string; cost: number; executions: number; tokens: number }>
  > {
    try {
      const start =
        startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate || new Date();

      const timeSeries = await this.usageModel.aggregate([
        {
          $match: {
            userId: new Types.ObjectId(userId),
            traceId: workflowId,
            automationPlatform: { $exists: true, $ne: null },
            createdAt: { $gte: start, $lte: end },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
              },
            },
            cost: { $sum: '$cost' },
            executions: { $sum: 1 },
            tokens: { $sum: '$totalTokens' },
          },
        },
        {
          $sort: { _id: 1 },
        },
      ]);

      return timeSeries.map((item) => ({
        date: item._id,
        cost: item.cost || 0,
        executions: item.executions || 0,
        tokens: item.tokens || 0,
      }));
    } catch (error) {
      this.logger.error('Error generating time series data', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        workflowId,
      });
      return [];
    }
  }

  /**
   * Get optimization recommendations for a workflow
   */
  async getWorkflowOptimizationRecommendations(
    userId: string,
    workflowId?: string,
  ): Promise<WorkflowOptimizationRecommendation[]> {
    try {
      const recommendations: WorkflowOptimizationRecommendation[] = [];

      // Get workflows to analyze
      const workflowIds = workflowId
        ? [workflowId]
        : await this.getUserWorkflowIds(userId);

      for (const wfId of workflowIds) {
        const metrics = await this.getWorkflowPerformanceMetrics(userId, wfId);

        if (!metrics) continue;

        // Analyze for optimization opportunities
        const workflowRecommendations =
          await this.analyzeWorkflowForOptimizations(metrics);
        recommendations.push(...workflowRecommendations);
      }

      // Sort by potential savings
      return recommendations.sort(
        (a, b) => b.potentialSavings - a.potentialSavings,
      );
    } catch (error) {
      this.logger.error('Error getting optimization recommendations', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        workflowId,
      });
      throw error;
    }
  }

  /**
   * Analyze a workflow for optimization opportunities
   */
  private async analyzeWorkflowForOptimizations(
    metrics: WorkflowPerformanceMetrics,
  ): Promise<WorkflowOptimizationRecommendation[]> {
    const recommendations: WorkflowOptimizationRecommendation[] = [];

    // High cost per execution
    if (metrics.averageCostPerExecution > 0.1) {
      recommendations.push({
        type: 'immediate',
        category: 'model_switch',
        title: 'Switch to More Cost-Effective Model',
        description: `Current average cost of $${metrics.averageCostPerExecution.toFixed(
          4,
        )} per execution is high`,
        workflowId: metrics.workflowId,
        workflowName: metrics.workflowName,
        potentialSavings: metrics.totalCost * 0.3,
        potentialSavingsPercentage: 30,
        implementationEffort: 'medium',
        estimatedTimeToImplement: '2-4 hours',
        steps: [
          'Analyze current model usage breakdown',
          'Identify cost-effective alternatives',
          'Test model switch with sample executions',
          'Implement gradual rollout',
        ],
      });
    }

    // Single point of failure (only one model used)
    const uniqueModels = new Set(metrics.modelUsage.map((m) => m.model));
    if (uniqueModels.size === 1) {
      recommendations.push({
        type: 'short_term',
        category: 'redundancy',
        title: 'Add Model Redundancy',
        description:
          'Workflow relies on single model - add fallback options for reliability',
        workflowId: metrics.workflowId,
        workflowName: metrics.workflowName,
        potentialSavings: 0, // Reliability improvement
        potentialSavingsPercentage: 0,
        implementationEffort: 'medium',
        estimatedTimeToImplement: '4-6 hours',
        steps: [
          'Identify alternative models with similar capabilities',
          'Implement fallback logic in workflow',
          'Test failover scenarios',
          'Monitor reliability improvements',
        ],
      });
    }

    // High token usage per step
    const highTokenSteps = metrics.costPerStep.filter(
      (step) => step.averageCost > metrics.averageCostPerExecution * 1.5,
    );

    if (highTokenSteps.length > 0) {
      recommendations.push({
        type: 'short_term',
        category: 'prompt_optimization',
        title: 'Optimize High-Cost Steps',
        description: `${highTokenSteps.length} step(s) have significantly higher costs than average`,
        workflowId: metrics.workflowId,
        workflowName: metrics.workflowName,
        step: highTokenSteps[0].step,
        potentialSavings: highTokenSteps.reduce(
          (sum, step) => sum + step.cost * 0.4,
          0,
        ),
        potentialSavingsPercentage: 40,
        implementationEffort: 'high',
        estimatedTimeToImplement: '8-12 hours',
        steps: [
          'Analyze prompts in high-cost steps',
          'Implement prompt optimization techniques',
          'Test optimized prompts with A/B testing',
          'Measure cost and quality improvements',
        ],
      });
    }

    // Batch processing opportunity
    if (
      metrics.totalExecutions > 100 &&
      metrics.averageCostPerExecution > 0.01
    ) {
      recommendations.push({
        type: 'long_term',
        category: 'batching',
        title: 'Implement Batch Processing',
        description:
          'High execution volume suggests batch processing could reduce costs',
        workflowId: metrics.workflowId,
        workflowName: metrics.workflowName,
        potentialSavings: metrics.totalCost * 0.25,
        potentialSavingsPercentage: 25,
        implementationEffort: 'high',
        estimatedTimeToImplement: '2-3 weeks',
        steps: [
          'Design batch processing workflow',
          'Implement batch queuing system',
          'Update downstream systems for batch handling',
          'Monitor performance and cost improvements',
        ],
      });
    }

    return recommendations;
  }

  /**
   * Get user's workflow IDs
   */
  private async getUserWorkflowIds(userId: string): Promise<string[]> {
    try {
      const workflows = await this.usageModel.aggregate([
        {
          $match: {
            userId: new Types.ObjectId(userId),
            automationPlatform: { $exists: true, $ne: null },
            traceId: { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: '$traceId',
          },
        },
        {
          $limit: 20, // Limit to avoid performance issues
        },
      ]);

      return workflows.map((w) => w._id);
    } catch (error) {
      this.logger.error('Error getting user workflow IDs', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return [];
    }
  }

  /**
   * Apply optimization recommendation
   */
  async applyOptimizationRecommendation(
    userId: string,
    recommendationId: string,
    recommendation: WorkflowOptimizationRecommendation,
  ): Promise<{
    success: boolean;
    message: string;
    appliedChanges?: Record<string, unknown>;
  }> {
    try {
      const userIdObj = new Types.ObjectId(userId);

      this.logger.log(
        `Applying optimization recommendation: ${recommendation.title}`,
        {
          userId,
          recommendationId,
          workflowId: recommendation.workflowId,
          category: recommendation.category,
        },
      );

      // Persist application as activity for audit and analytics
      await this.activityModel.create({
        userId: userIdObj,
        type: 'optimization_applied',
        title: `Applied: ${recommendation.title}`,
        description: recommendation.description,
        metadata: {
          recommendationId,
          workflowId: recommendation.workflowId,
          workflowName: recommendation.workflowName,
          category: recommendation.category,
          step: recommendation.step,
          currentModel: recommendation.currentModel,
          recommendedModel: recommendation.recommendedModel,
          potentialSavings: recommendation.potentialSavings,
          potentialSavingsPercentage: recommendation.potentialSavingsPercentage,
          implementationEffort: recommendation.implementationEffort,
        },
      });

      const appliedChanges: Record<string, unknown> = {
        recommendationId,
        appliedAt: new Date(),
        category: recommendation.category,
        workflowId: recommendation.workflowId,
      };

      return {
        success: true,
        message: `Optimization recommendation "${recommendation.title}" applied successfully and recorded.`,
        appliedChanges,
      };
    } catch (error) {
      this.logger.error('Error applying optimization recommendation', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        recommendationId,
      });
      throw error;
    }
  }

  /**
   * Get workflow efficiency score
   */
  async getWorkflowEfficiencyScore(
    userId: string,
    workflowId: string,
  ): Promise<{
    score: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    factors: Record<string, number>;
    recommendations: string[];
  }> {
    try {
      const metrics = await this.getWorkflowPerformanceMetrics(
        userId,
        workflowId,
      );

      if (!metrics) {
        throw new Error('Workflow metrics not found');
      }

      // Calculate efficiency factors (0-100 scale)
      const costEfficiency = Math.max(
        0,
        100 - metrics.averageCostPerExecution * 1000,
      );
      const tokenEfficiency = Math.max(
        0,
        100 - metrics.averageTokensPerExecution / 10,
      );
      const modelDiversity = Math.min(100, metrics.modelUsage.length * 25);
      const executionEfficiency = Math.max(
        0,
        100 - metrics.averageResponseTime / 100,
      );

      const factors = {
        costEfficiency,
        tokenEfficiency,
        modelDiversity,
        executionEfficiency,
      };

      // Calculate overall score
      const score =
        Object.values(factors).reduce((sum, factor) => sum + factor, 0) / 4;

      // Determine grade
      let grade: 'A' | 'B' | 'C' | 'D' | 'F';
      if (score >= 90) grade = 'A';
      else if (score >= 80) grade = 'B';
      else if (score >= 70) grade = 'C';
      else if (score >= 60) grade = 'D';
      else grade = 'F';

      // Generate recommendations
      const recommendations: string[] = [];
      if (costEfficiency < 70) {
        recommendations.push(
          'Consider switching to more cost-effective models',
        );
      }
      if (tokenEfficiency < 70) {
        recommendations.push('Optimize prompts to reduce token usage');
      }
      if (modelDiversity < 50) {
        recommendations.push('Add model redundancy for better reliability');
      }
      if (executionEfficiency < 70) {
        recommendations.push(
          'Review and optimize workflow steps for faster execution',
        );
      }

      return {
        score: Math.round(score),
        grade,
        factors,
        recommendations,
      };
    } catch (error) {
      this.logger.error('Error calculating workflow efficiency score', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        workflowId,
      });
      throw error;
    }
  }
}
