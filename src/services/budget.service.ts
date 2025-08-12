import { logger } from '../utils/logger';
import { Usage } from '../models';
import mongoose from 'mongoose';
import { webhookEventEmitter } from './webhookEventEmitter.service';
import { WEBHOOK_EVENTS } from '../types/webhook.types';

interface BudgetStatus {
  overall: {
    budget: number;
    used: number;
    remaining: number;
    cost: number;
    usagePercentage: number;
  };
  projects: Array<{
    name: string;
    budget: number;
    used: number;
    remaining: number;
    cost: number;
    usagePercentage: number;
  }>;
  alerts: Array<{
    type: string;
    message: string;
    severity: 'low' | 'medium' | 'high';
    timestamp: string;
  }>;
  recommendations: Array<{
    type: string;
    message: string;
    impact: 'low' | 'medium' | 'high';
    estimatedSavings: number;
  }>;
}

export class BudgetService {
  static async getBudgetStatus(userId: string, projectFilter?: string): Promise<BudgetStatus> {
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const endOfMonth = new Date();
      endOfMonth.setMonth(endOfMonth.getMonth() + 1);
      endOfMonth.setDate(0);
      endOfMonth.setHours(23, 59, 59, 999);

      // Get user's budget settings (default to 100K tokens)
      const userBudget = 100000; // This would come from user settings

      // Get overall usage for the month
      const overallUsage = await this.getOverallUsage(userId, startOfMonth, endOfMonth);
      
      // Get project-specific usage
      const projectUsage = await this.getProjectUsage(userId, startOfMonth, endOfMonth, projectFilter);

      // Calculate overall budget status
      const overall = {
        budget: userBudget,
        used: overallUsage.totalTokens,
        remaining: Math.max(0, userBudget - overallUsage.totalTokens),
        cost: overallUsage.totalCost,
        usagePercentage: (overallUsage.totalTokens / userBudget) * 100,
      };

      // Generate alerts based on usage
      const alerts = this.generateAlerts(overall, projectUsage, userId);

      // Generate recommendations
      const recommendations = this.generateRecommendations(overall, projectUsage);

      return {
        overall,
        projects: projectUsage,
        alerts,
        recommendations,
      };
    } catch (error) {
      logger.error('Error getting budget status:', error);
      throw error;
    }
  }

  private static async getOverallUsage(userId: string, startDate: Date, endDate: Date) {
    const match: any = {
      userId: new mongoose.Types.ObjectId(userId),
      createdAt: { $gte: startDate, $lte: endDate },
    };

    const result = await Usage.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalTokens: { $sum: '$totalTokens' },
          totalCost: { $sum: '$cost' },
          totalRequests: { $sum: 1 },
        },
      },
    ]);

    const usage = result[0] || { totalTokens: 0, totalCost: 0, totalRequests: 0 };
    return usage;
  }

  private static async getProjectUsage(userId: string, startDate: Date, endDate: Date, projectFilter?: string) {
    const match: any = {
      userId: new mongoose.Types.ObjectId(userId),
      createdAt: { $gte: startDate, $lte: endDate },
    };

    if (projectFilter) {
      // If projectFilter is a project name, we need to look it up
      if (!mongoose.Types.ObjectId.isValid(projectFilter)) {
        const project = await mongoose.model('Project').findOne({ 
          name: projectFilter, 
          userId: new mongoose.Types.ObjectId(userId) 
        });
        if (project) {
          match.projectId = project._id;
        }
      } else {
        match.projectId = new mongoose.Types.ObjectId(projectFilter);
      }
    }

    const pipeline = [
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
        $group: {
          _id: '$projectId',
          name: { $first: { $arrayElemAt: ['$project.name', 0] } },
          totalTokens: { $sum: '$totalTokens' },
          totalCost: { $sum: '$cost' },
          totalRequests: { $sum: 1 },
        },
      },
      { $sort: { totalCost: -1 as const } },
    ];

    const results = await Usage.aggregate(pipeline);

    // Calculate budget for each project (default 10K tokens per project)
    return results.map(project => {
      const projectBudget = 10000; // This would come from project settings
      const usagePercentage = (project.totalTokens / projectBudget) * 100;
      
      return {
        name: project.name || 'Unknown Project',
        budget: projectBudget,
        used: project.totalTokens,
        remaining: Math.max(0, projectBudget - project.totalTokens),
        cost: project.totalCost,
        usagePercentage,
      };
    });
  }

  private static generateAlerts(overall: any, projects: any[], userId: string): Array<{
    type: string;
    message: string;
    severity: 'low' | 'medium' | 'high';
    timestamp: string;
  }> {
    const alerts: Array<{
      type: string;
      message: string;
      severity: 'low' | 'medium' | 'high';
      timestamp: string;
    }> = [];
    const now = new Date().toISOString();

    // Overall budget alerts
    if (overall.usagePercentage >= 90) {
      alerts.push({
        type: 'budget_critical',
        message: `Critical: You've used ${overall.usagePercentage.toFixed(1)}% of your monthly budget`,
        severity: 'high' as const,
        timestamp: now,
      });
      
      // Emit webhook event for budget exceeded or warning
      if (overall.usagePercentage >= 100) {
        webhookEventEmitter.emitWebhookEvent(WEBHOOK_EVENTS.BUDGET_EXCEEDED, userId, {
          cost: { amount: overall.cost, currency: 'USD' },
          metrics: {
            current: overall.used,
            threshold: overall.budget,
            changePercentage: overall.usagePercentage - 100,
            unit: 'tokens'
          }
        });
      } else {
        webhookEventEmitter.emitWebhookEvent(WEBHOOK_EVENTS.BUDGET_WARNING, userId, {
          cost: { amount: overall.cost, currency: 'USD' },
          metrics: {
            current: overall.used,
            threshold: overall.budget,
            changePercentage: overall.usagePercentage,
            unit: 'tokens'
          }
        });
      }
    } else if (overall.usagePercentage >= 75) {
      alerts.push({
        type: 'budget_warning',
        message: `Warning: You've used ${overall.usagePercentage.toFixed(1)}% of your monthly budget`,
        severity: 'medium' as const,
        timestamp: now,
      });
      
      // Emit webhook event for budget warning
      webhookEventEmitter.emitWebhookEvent(WEBHOOK_EVENTS.BUDGET_WARNING, userId, {
        cost: { amount: overall.cost, currency: 'USD' },
        metrics: {
          current: overall.used,
          threshold: overall.budget,
          changePercentage: overall.usagePercentage,
          unit: 'tokens'
        }
      });
    } else if (overall.usagePercentage >= 50) {
      alerts.push({
        type: 'budget_notice',
        message: `Notice: You've used ${overall.usagePercentage.toFixed(1)}% of your monthly budget`,
        severity: 'low' as const,
        timestamp: now,
      });
    }

    // Project-specific alerts
    projects.forEach(project => {
      if (project.usagePercentage >= 90) {
        alerts.push({
          type: 'project_critical',
          message: `Critical: Project "${project.name}" has used ${project.usagePercentage.toFixed(1)}% of its budget`,
          severity: 'high' as const,
          timestamp: now,
        });
      } else if (project.usagePercentage >= 75) {
        alerts.push({
          type: 'project_warning',
          message: `Warning: Project "${project.name}" has used ${project.usagePercentage.toFixed(1)}% of its budget`,
          severity: 'medium' as const,
          timestamp: now,
        });
      }
    });

    // High cost alerts
    if (overall.cost > 50) {
      alerts.push({
        type: 'cost_high',
        message: `High cost alert: You've spent $${overall.cost.toFixed(2)} this month`,
        severity: 'medium' as const,
        timestamp: now,
      });
      
      // Emit webhook event for cost alert
      try {
        logger.info('Emitting cost alert webhook', { userId, cost: overall.cost });
        webhookEventEmitter.emitCostAlert(
          userId,
          undefined, // No specific project
          overall.cost,
          50, // threshold
          'USD'
        );
      } catch (error) {
        logger.error('Failed to emit cost alert webhook', { error });
      }
    }

    return alerts;
  }

  private static generateRecommendations(overall: any, projects: any[]): Array<{
    type: string;
    message: string;
    impact: 'low' | 'medium' | 'high';
    estimatedSavings: number;
  }> {
    const recommendations: Array<{
      type: string;
      message: string;
      impact: 'low' | 'medium' | 'high';
      estimatedSavings: number;
    }> = [];

    // Budget optimization recommendations
    if (overall.usagePercentage >= 75) {
      recommendations.push({
        type: 'budget_increase',
        message: 'Consider increasing your monthly budget to avoid service interruptions',
        impact: 'high' as const,
        estimatedSavings: 0, // No savings, but prevents downtime
      });
    }

    // Cost optimization recommendations
    if (overall.cost > 30) {
      recommendations.push({
        type: 'cost_optimization',
        message: 'Enable prompt optimization to reduce token usage and costs',
        impact: 'high' as const,
        estimatedSavings: overall.cost * 0.2, // 20% potential savings
      });
    }

    // Model optimization recommendations
    if (overall.usagePercentage > 50) {
      recommendations.push({
        type: 'model_optimization',
        message: 'Consider using more cost-effective models for non-critical tasks',
        impact: 'medium' as const,
        estimatedSavings: overall.cost * 0.15, // 15% potential savings
      });
    }

    // Project-specific recommendations
    projects.forEach(project => {
      if (project.usagePercentage >= 75) {
        recommendations.push({
          type: 'project_optimization',
          message: `Optimize prompts in project "${project.name}" to reduce token usage`,
          impact: 'medium' as const,
          estimatedSavings: project.cost * 0.25, // 25% potential savings
        });
      }
    });

    return recommendations;
  }
}
