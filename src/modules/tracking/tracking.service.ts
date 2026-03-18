import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage } from '@/schemas/core/usage.schema';
import { Project } from '@/schemas/team-project/project.schema';
import { calculateCost } from '@/utils/pricing';

interface TrackingRequest {
  model: string;
  tokens: number;
  inputTokens?: number;
  outputTokens?: number;
  project?: string;
  user?: string;
  feedback?: 'positive' | 'negative' | 'neutral';
  cost?: number;
  description?: string;
  provider?: string;
  prompt?: string;
  response?: string;
}

export interface TrackingResult {
  requestId: string;
  model: string;
  tokens: number;
  cost: number;
  project?: string;
  user?: string;
  provider?: string;
  feedback?: string;
  timestamp: string;
  costAnalysis: {
    tokenCost: number;
    apiCost: number;
    totalCost: number;
    costPerToken: number;
  };
  usageImpact: {
    monthlyUsage: number;
    monthlyCost: number;
    budgetUsage: number;
    budgetRemaining: number;
  };
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<Usage>,
    @InjectModel(Project.name) private projectModel: Model<Project>,
  ) {}

  async trackManualRequest(
    userId: string,
    request: TrackingRequest,
  ): Promise<TrackingResult> {
    try {
      // Calculate cost if not provided
      const calculatedCost =
        request.cost ||
        this.calculateRequestCost(
          request.model,
          request.tokens,
          request.provider,
        );

      // Get or create project
      let projectId = null;
      if (request.project) {
        projectId = await this.getOrCreateProject(userId, request.project);
      }

      const inputTokens =
        request.inputTokens != null && request.outputTokens != null
          ? request.inputTokens
          : Math.floor(request.tokens * 0.7);
      const outputTokens =
        request.inputTokens != null && request.outputTokens != null
          ? request.outputTokens
          : Math.floor(request.tokens * 0.3);

      const usageData = {
        userId,
        model: request.model,
        provider: request.provider || 'openai',
        totalTokens: request.tokens,
        inputTokens,
        outputTokens,
        cost: calculatedCost,
        projectId: projectId,
        user: request.user,
        feedback: request.feedback,
        description: request.description,
        prompt: request.prompt,
        response: request.response,
        requestType: 'manual',
        timestamp: new Date(),
      };

      const usage = new this.usageModel(usageData);
      await usage.save();

      // Calculate cost analysis
      const costAnalysis = this.calculateCostAnalysis(
        request.model,
        request.tokens,
        calculatedCost,
        request.provider,
      );

      // Calculate usage impact
      const usageImpact = await this.calculateUsageImpact(
        userId,
        calculatedCost,
        request.tokens,
      );

      return {
        requestId: usage._id.toString(),
        model: request.model,
        tokens: request.tokens,
        cost: calculatedCost,
        project: request.project,
        user: request.user,
        provider: request.provider,
        feedback: request.feedback,
        timestamp: usage.createdAt.toISOString(),
        costAnalysis,
        usageImpact,
      };
    } catch (error) {
      this.logger.error('Error tracking manual request:', error);
      throw error;
    }
  }

  private calculateRequestCost(
    model: string,
    tokens: number,
    provider?: string,
  ): number {
    try {
      return calculateCost(tokens, tokens, provider || 'openai', model);
    } catch (error) {
      this.logger.warn(
        `Failed to calculate cost for ${model}, using fallback calculation`,
      );
      // Fallback calculation: $0.002 per 1K tokens
      return (tokens / 1000) * 0.002;
    }
  }

  private calculateCostAnalysis(
    _model: string,
    tokens: number,
    totalCost: number,
    _provider?: string,
  ): {
    tokenCost: number;
    apiCost: number;
    totalCost: number;
    costPerToken: number;
  } {
    const tokenCost = totalCost * 0.95; // 95% of cost is token cost
    const apiCost = totalCost * 0.05; // 5% is API overhead
    const costPerToken = totalCost / tokens;

    return {
      tokenCost,
      apiCost,
      totalCost,
      costPerToken,
    };
  }

  private async calculateUsageImpact(
    userId: string,
    _cost: number,
    _tokens: number,
  ): Promise<{
    monthlyUsage: number;
    monthlyCost: number;
    budgetUsage: number;
    budgetRemaining: number;
  }> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date();
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);
    endOfMonth.setDate(0);
    endOfMonth.setHours(23, 59, 59, 999);

    // Get monthly usage
    const monthlyUsage = await this.usageModel.aggregate([
      {
        $match: {
          userId,
          timestamp: { $gte: startOfMonth, $lte: endOfMonth },
        },
      },
      {
        $group: {
          _id: null,
          totalTokens: { $sum: '$totalTokens' },
          totalCost: { $sum: '$cost' },
        },
      },
    ]);

    const usage = monthlyUsage[0] || { totalTokens: 0, totalCost: 0 };
    const monthlyUsageTokens = usage.totalTokens;
    const monthlyCost = usage.totalCost;

    // Default budget is 100K tokens
    const budget = 100000;
    const budgetUsage = (monthlyUsageTokens / budget) * 100;
    const budgetRemaining = Math.max(0, budget - monthlyUsageTokens);

    return {
      monthlyUsage: monthlyUsageTokens,
      monthlyCost,
      budgetUsage,
      budgetRemaining,
    };
  }

  private async getOrCreateProject(
    userId: string,
    projectName: string,
  ): Promise<string | null> {
    try {
      // Try to find existing project
      const existingProject = await this.projectModel.findOne({
        name: projectName,
        userId,
      });

      if (existingProject) {
        return existingProject._id.toString();
      }

      // Create new project
      const newProject = new this.projectModel({
        name: projectName,
        userId,
        description: `Auto-created project for manual tracking`,
        createdAt: new Date(),
      });

      await newProject.save();
      return newProject._id.toString();
    } catch (error) {
      this.logger.error('Error getting or creating project:', error);
      // Return null if project creation fails
      return null;
    }
  }
}
