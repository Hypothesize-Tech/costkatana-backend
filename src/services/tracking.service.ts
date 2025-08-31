import { loggingService } from './logging.service';
import { Usage } from '../models';
import mongoose from 'mongoose';
import { calculateCost } from '../utils/pricing';

interface TrackingRequest {
  model: string;
  tokens: number;
  project?: string;
  user?: string;
  feedback?: 'positive' | 'negative' | 'neutral';
  cost?: number;
  description?: string;
  provider?: string;
  prompt?: string;
  response?: string;
}

interface TrackingResult {
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

export class TrackingService {
  static async trackManualRequest(userId: string, request: TrackingRequest): Promise<TrackingResult> {
    try {
      // Calculate cost if not provided
      const calculatedCost = request.cost || this.calculateRequestCost(request.model, request.tokens, request.provider);
      
      // Get or create project
      let projectId = null;
      if (request.project) {
        projectId = await this.getOrCreateProject(userId, request.project);
      }

      // Create usage record
      const usageData = {
        userId: new mongoose.Types.ObjectId(userId),
        model: request.model,
        provider: request.provider || 'openai',
        totalTokens: request.tokens,
        inputTokens: Math.floor(request.tokens * 0.7), // Estimate 70% input, 30% output
        outputTokens: Math.floor(request.tokens * 0.3),
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

      const usage = new Usage(usageData);
      await usage.save();

      // Calculate cost analysis
      const costAnalysis = this.calculateCostAnalysis(request.model, request.tokens, calculatedCost, request.provider);

      // Calculate usage impact
      const usageImpact = await this.calculateUsageImpact(userId, calculatedCost, request.tokens);

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
      loggingService.error('Error tracking manual request:', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private static calculateRequestCost(model: string, tokens: number, provider?: string): number {
    try {
      return calculateCost(tokens, tokens, provider || 'openai', model);
    } catch (error) {
      loggingService.warn(`Failed to calculate cost for ${model}, using fallback calculation`);
      // Fallback calculation: $0.002 per 1K tokens
      return (tokens / 1000) * 0.002;
    }
  }

  private static calculateCostAnalysis(_model: string, tokens: number, totalCost: number, _provider?: string): {
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

  private static async calculateUsageImpact(userId: string, _cost: number, _tokens: number): Promise<{
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
    const monthlyUsage = await Usage.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
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

  private static async getOrCreateProject(userId: string, projectName: string): Promise<mongoose.Types.ObjectId | null> {
    try {
      // Try to find existing project
      const existingProject = await mongoose.model('Project').findOne({
        name: projectName,
        userId: new mongoose.Types.ObjectId(userId),
      });

      if (existingProject) {
        return existingProject._id;
      }

      // Create new project
      const ProjectModel = mongoose.model('Project');
      const newProject = new ProjectModel({
        name: projectName,
        userId: new mongoose.Types.ObjectId(userId),
        description: `Auto-created project for manual tracking`,
        createdAt: new Date(),
      });

      await newProject.save();
      return newProject._id;
    } catch (error) {
      loggingService.error('Error getting or creating project:', { error: error instanceof Error ? error.message : String(error) });
      // Return null if project creation fails
      return null;
    }
  }
}
