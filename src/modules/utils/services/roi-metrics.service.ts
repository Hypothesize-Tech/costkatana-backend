import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage } from '../../../schemas/core/usage.schema';
import { Project } from '../../../schemas/team-project/project.schema';
import { User } from '../../../schemas/user/user.schema';
import { SimulationTracking } from '../../../schemas/analytics/simulation-tracking.schema';
import { Optimization } from '../../../schemas/core/optimization.schema';

interface WorkflowROIMetrics {
  workflowId: string;
  workflowName: string;
  platform: string;
  timeRange: {
    startDate: Date;
    endDate: Date;
  };

  // Cost metrics
  totalCost: number;
  totalOrchestrationCost: number;
  totalAICost: number;
  previousPeriodCost: number;
  costChange: number;
  costChangePercentage: number;

  // Execution metrics
  totalExecutions: number;
  averageCostPerExecution: number;

  // Efficiency score (0-100, higher is better)
  efficiencyScore: number;
  efficiencyFactors: {
    costPerExecution: number;
    orchestrationOverhead: number;
    modelEfficiency: number;
    cachingUtilization: number;
  };

  // Trends
  trends: {
    dailyCosts: Array<{ date: string; cost: number; executions: number }>;
    costPerExecutionTrend: 'improving' | 'degrading' | 'stable';
  };
}

interface ProjectROIMetrics {
  projectId: string;
  projectName: string;
  timeRange: {
    startDate: Date;
    endDate: Date;
  };

  // Cost metrics
  totalCost: number;
  previousPeriodCost: number;
  costChange: number;
  costChangePercentage: number;

  // Optimization metrics
  totalSimulations: number;
  optimizationsApplied: number;
  potentialSavings: number;
  actualSavings: number;
  savingsRate: number;

  // Usage metrics
  totalRequests: number;
  totalTokens: number;
  averageCostPerRequest: number;
  averageTokensPerRequest: number;

  // Model breakdown
  modelBreakdown: Array<{
    model: string;
    cost: number;
    requests: number;
    tokens: number;
    percentage: number;
  }>;
}

interface UserROISummary {
  userId: string;
  userName: string;
  email: string;
  timeRange: {
    startDate: Date;
    endDate: Date;
  };

  // Overall metrics
  totalSavings: number;
  totalOptimizations: number;
  rank: number;
  totalUsers: number;

  // Project-level metrics
  projects: ProjectROIMetrics[];
}

/**
 * ROI Metrics Service
 * Calculates return on investment metrics for AI usage optimization
 */
@Injectable()
export class ROIMetricsService {
  private readonly logger = new Logger(ROIMetricsService.name);

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<any>,
    @InjectModel(Project.name) private projectModel: Model<any>,
    @InjectModel(User.name) private userModel: Model<any>,
    @InjectModel(SimulationTracking.name)
    private simulationTrackingModel: Model<any>,
    @InjectModel(Optimization.name) private optimizationModel: Model<any>,
  ) {}

  /**
   * Calculate ROI metrics for a project
   */
  async calculateProjectROI(
    projectId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<ProjectROIMetrics> {
    try {
      // Get project info
      const project = await this.projectModel.findById(projectId).lean();
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      // Get usage data for the project
      const usageData = await this.usageModel
        .find({
          projectId,
          createdAt: { $gte: startDate, $lte: endDate },
        })
        .lean();

      // Calculate previous period for comparison
      const periodLength = endDate.getTime() - startDate.getTime();
      const previousStartDate = new Date(startDate.getTime() - periodLength);
      const previousEndDate = startDate;

      const previousUsageData = await this.usageModel
        .find({
          projectId,
          createdAt: { $gte: previousStartDate, $lte: previousEndDate },
        })
        .lean();

      // Calculate current period metrics
      const totalCost = usageData.reduce((sum, usage) => sum + usage.cost, 0);
      const previousPeriodCost = previousUsageData.reduce(
        (sum, usage) => sum + usage.cost,
        0,
      );
      const costChange = totalCost - previousPeriodCost;
      const costChangePercentage =
        previousPeriodCost > 0 ? (costChange / previousPeriodCost) * 100 : 0;

      const totalRequests = usageData.length;
      const totalTokens = usageData.reduce(
        (sum, usage) => sum + usage.totalTokens,
        0,
      );
      const averageCostPerRequest =
        totalRequests > 0 ? totalCost / totalRequests : 0;
      const averageTokensPerRequest =
        totalRequests > 0 ? totalTokens / totalRequests : 0;

      // Get simulation and optimization data
      const [simulationData, optimizationData] = await Promise.all([
        this.simulationTrackingModel.countDocuments({
          userId: (project as { ownerId?: unknown }).ownerId,
          createdAt: { $gte: startDate, $lte: endDate },
        }),
        Promise.all([
          this.optimizationModel.countDocuments({
            projectId,
            status: 'completed',
            createdAt: { $gte: startDate, $lte: endDate },
          }),
          this.optimizationModel.aggregate([
            {
              $match: {
                projectId,
                createdAt: { $gte: startDate, $lte: endDate },
              },
            },
            {
              $group: {
                _id: null,
                totalPotentialSavings: {
                  $sum: '$performanceMetrics.potentialSavings',
                },
              },
            },
          ]),
          this.optimizationModel.aggregate([
            {
              $match: {
                projectId,
                status: 'completed',
                createdAt: { $gte: startDate, $lte: endDate },
              },
            },
            {
              $group: {
                _id: null,
                totalActualSavings: {
                  $sum: '$performanceMetrics.actualSavings',
                },
              },
            },
          ]),
        ]),
      ]);

      const optimizationsApplied = optimizationData[0];
      const potentialSavings =
        optimizationData[1][0]?.totalPotentialSavings || 0;
      const actualSavings = optimizationData[2][0]?.totalActualSavings || 0;

      // Model breakdown
      const modelMap = new Map<
        string,
        { cost: number; requests: number; tokens: number }
      >();
      for (const usage of usageData) {
        const existing = modelMap.get(usage.model) || {
          cost: 0,
          requests: 0,
          tokens: 0,
        };
        existing.cost += usage.cost;
        existing.requests += 1;
        existing.tokens += usage.totalTokens;
        modelMap.set(usage.model, existing);
      }

      const modelBreakdown = Array.from(modelMap.entries()).map(
        ([model, data]) => ({
          model,
          cost: data.cost,
          requests: data.requests,
          tokens: data.tokens,
          percentage: totalCost > 0 ? (data.cost / totalCost) * 100 : 0,
        }),
      );

      return {
        projectId,
        projectName: (project as any).name || 'Unknown Project',
        timeRange: { startDate, endDate },
        totalCost,
        previousPeriodCost,
        costChange,
        costChangePercentage,
        totalSimulations: simulationData,
        optimizationsApplied,
        potentialSavings,
        actualSavings,
        savingsRate: totalCost > 0 ? actualSavings / totalCost : 0,
        totalRequests,
        totalTokens,
        averageCostPerRequest,
        averageTokensPerRequest,
        modelBreakdown,
      };
    } catch (error) {
      this.logger.error('Failed to calculate project ROI', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Calculate ROI metrics for a user
   */
  async calculateUserROI(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<UserROISummary> {
    try {
      // Get user info
      const user = await this.userModel.findById(userId).lean();
      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      // Get user's projects
      const projects = await this.projectModel
        .find({
          $or: [{ ownerId: userId }, { 'members.userId': userId }],
        })
        .lean();

      // Calculate ROI for each project
      const projectROIs: ProjectROIMetrics[] = [];
      let totalSavings = 0;
      let totalOptimizations = 0;

      for (const project of projects) {
        try {
          const projectROI = await this.calculateProjectROI(
            (project as any)._id.toString(),
            startDate,
            endDate,
          );
          projectROIs.push(projectROI);
          totalSavings += projectROI.actualSavings;
          totalOptimizations += projectROI.optimizationsApplied;
        } catch (error) {
          this.logger.warn(
            `Failed to calculate ROI for project ${(project as { _id: unknown })._id}`,
            {
              projectId: (project as { _id: unknown })._id,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }

      // Calculate user rank based on total savings compared to other users
      const allUserSavings = await this.userModel.aggregate([
        // Match users who have projects
        {
          $lookup: {
            from: 'projects',
            localField: '_id',
            foreignField: 'ownerId',
            as: 'ownedProjects',
          },
        },
        {
          $lookup: {
            from: 'projects',
            localField: '_id',
            foreignField: 'members.userId',
            as: 'memberProjects',
          },
        },
        {
          $addFields: {
            allProjects: {
              $concatArrays: ['$ownedProjects', '$memberProjects'],
            },
          },
        },
        { $unwind: '$allProjects' },
        {
          $group: {
            _id: '$_id',
            userId: { $first: '$_id' },
            projects: { $push: '$allProjects' },
          },
        },
        // Calculate savings for each user
        {
          $addFields: {
            totalSavings: {
              $sum: {
                $map: {
                  input: '$projects',
                  as: 'project',
                  in: {
                    $sum: {
                      $map: {
                        input: {
                          $filter: {
                            input: '$project.optimizations',
                            cond: {
                              $and: [
                                { $gte: ['$$this.createdAt', startDate] },
                                { $lte: ['$$this.createdAt', endDate] },
                              ],
                            },
                          },
                        },
                        as: 'optimization',
                        in: '$$optimization.actualSavings',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        { $sort: { totalSavings: -1 } },
        {
          $group: {
            _id: null,
            users: { $push: { userId: '$userId', savings: '$totalSavings' } },
          },
        },
        {
          $project: {
            rankedUsers: {
              $map: {
                input: '$users',
                as: 'user',
                in: {
                  userId: '$$user.userId',
                  savings: '$$user.savings',
                  rank: {
                    $add: [
                      { $indexOfArray: ['$users.userId', '$$user.userId'] },
                      1,
                    ],
                  },
                },
              },
            },
            totalUsers: { $size: '$users' },
          },
        },
      ]);

      const rankingData = allUserSavings[0] || {
        rankedUsers: [],
        totalUsers: 0,
      };
      const userRanking = rankingData.rankedUsers.find(
        (r: any) => r.userId.toString() === userId,
      );

      const rank = userRanking?.rank || 1;
      const totalUsers = rankingData.totalUsers || 1;

      return {
        userId,
        userName: (user as any).name || 'Unknown User',
        email: (user as any).email,
        timeRange: { startDate, endDate },
        totalSavings,
        totalOptimizations,
        rank,
        totalUsers,
        projects: projectROIs,
      };
    } catch (error) {
      this.logger.error('Failed to calculate user ROI', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Calculate workflow ROI metrics
   */
  async calculateWorkflowROI(
    workflowId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<WorkflowROIMetrics> {
    try {
      // Get usage data for this workflow
      const usageData = await this.usageModel
        .find({
          'metadata.workflowId': workflowId,
          createdAt: { $gte: startDate, $lte: endDate },
        })
        .lean();

      // Calculate previous period for comparison
      const periodLength = endDate.getTime() - startDate.getTime();
      const previousStartDate = new Date(startDate.getTime() - periodLength);
      const previousEndDate = startDate;

      const previousUsageData = await this.usageModel
        .find({
          'metadata.workflowId': workflowId,
          createdAt: { $gte: previousStartDate, $lte: previousEndDate },
        })
        .lean();

      // Calculate metrics
      const totalCost = usageData.reduce((sum, usage) => sum + usage.cost, 0);
      const orchestrationOverheadRate = parseFloat(
        process.env.ORCHESTRATION_OVERHEAD_RATE || '0.1',
      ); // Configurable orchestration overhead rate
      const totalOrchestrationCost = totalCost * orchestrationOverheadRate;
      const totalAICost = totalCost - totalOrchestrationCost;
      const previousPeriodCost = previousUsageData.reduce(
        (sum, usage) => sum + usage.cost,
        0,
      );
      const costChange = totalCost - previousPeriodCost;
      const costChangePercentage =
        previousPeriodCost > 0 ? (costChange / previousPeriodCost) * 100 : 0;

      const totalExecutions = usageData.length;
      const averageCostPerExecution =
        totalExecutions > 0 ? totalCost / totalExecutions : 0;

      // Calculate efficiency score (simplified)
      const efficiencyFactors = {
        costPerExecution: averageCostPerExecution,
        orchestrationOverhead:
          totalOrchestrationCost / Math.max(totalCost, 0.01),
        modelEfficiency: 0.8, // Would need model performance data
        cachingUtilization: 0.3, // Would need caching data
      };

      const efficiencyScore = Math.min(
        100,
        Math.max(
          0,
          (1 - efficiencyFactors.orchestrationOverhead) * 40 +
            (1 - Math.min(averageCostPerExecution / 0.1, 1)) * 30 +
            efficiencyFactors.modelEfficiency * 20 +
            efficiencyFactors.cachingUtilization * 10,
        ),
      );

      // Calculate daily costs (simplified)
      const dailyCosts = this.calculateDailyCosts(
        usageData,
        startDate,
        endDate,
      );

      // Determine trend
      const costPerExecutionTrend = this.calculateCostTrend(dailyCosts);

      return {
        workflowId,
        workflowName: `Workflow ${workflowId}`,
        platform: 'cost-katana',
        timeRange: { startDate, endDate },
        totalCost,
        totalOrchestrationCost,
        totalAICost,
        previousPeriodCost,
        costChange,
        costChangePercentage,
        totalExecutions,
        averageCostPerExecution,
        efficiencyScore,
        efficiencyFactors,
        trends: {
          dailyCosts,
          costPerExecutionTrend,
        },
      };
    } catch (error) {
      this.logger.error('Failed to calculate workflow ROI', {
        workflowId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get top cost-saving projects
   */
  async getTopCostSavingProjects(
    limit: number = 10,
    startDate?: Date,
    endDate?: Date,
  ): Promise<ProjectROIMetrics[]> {
    try {
      const start =
        startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate || new Date();

      // Get all projects with usage in the period
      const projectsWithUsage = await this.usageModel.distinct('projectId', {
        createdAt: { $gte: start, $lte: end },
      });

      const projectROIs: ProjectROIMetrics[] = [];

      for (const projectId of projectsWithUsage.slice(0, 50)) {
        // Limit for performance
        try {
          const roi = await this.calculateProjectROI(
            projectId.toString(),
            start,
            end,
          );
          if (roi.actualSavings > 0) {
            projectROIs.push(roi);
          }
        } catch (error) {
          this.logger.warn(
            `Failed to calculate ROI metrics for project ${projectId}`,
            {
              projectId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }

      // Sort by savings and return top results
      return projectROIs
        .sort((a, b) => b.actualSavings - a.actualSavings)
        .slice(0, limit);
    } catch (error) {
      this.logger.error('Failed to get top cost-saving projects', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Calculate daily costs from usage data
   */
  private calculateDailyCosts(
    usageData: any[],
    startDate: Date,
    endDate: Date,
  ): Array<{ date: string; cost: number; executions: number }> {
    const dailyMap = new Map<string, { cost: number; executions: number }>();

    for (const usage of usageData) {
      if (!usage.createdAt) continue;
      const dateObj = new Date(usage.createdAt);
      // Use UTC 'YYYY-MM-DD' format to prevent timezone drift
      const date = dateObj.toISOString().split('T')[0];

      // Only count if within bounds (inclusive)
      if (
        (startDate && dateObj < startDate) ||
        (endDate && dateObj > endDate)
      ) {
        continue;
      }

      const existing = dailyMap.get(date) || { cost: 0, executions: 0 };
      existing.cost += usage.cost ?? 0;
      existing.executions += 1;
      dailyMap.set(date, existing);
    }

    // Make sure to include all days in the interval, even if there was no usage
    const days: Array<{ date: string; cost: number; executions: number }> = [];
    for (
      let day = new Date(startDate);
      day <= endDate;
      day.setUTCDate(day.getUTCDate() + 1)
    ) {
      const dateStr = day.toISOString().split('T')[0];
      const data = dailyMap.get(dateStr) || { cost: 0, executions: 0 };
      days.push({
        date: dateStr,
        cost: data.cost,
        executions: data.executions,
      });
    }

    return days;
  }

  /**
   * Calculate cost trend from daily data
   */
  private calculateCostTrend(
    dailyCosts: Array<{ date: string; cost: number; executions: number }>,
  ): 'improving' | 'degrading' | 'stable' {
    if (dailyCosts.length < 7) return 'stable';

    const recent = dailyCosts.slice(-7);
    const earlier = dailyCosts.slice(-14, -7);

    if (earlier.length === 0) return 'stable';

    const recentAvgCostPerExecution =
      recent.reduce(
        (sum, day) =>
          sum + (day.executions > 0 ? day.cost / day.executions : 0),
        0,
      ) / recent.length;

    const earlierAvgCostPerExecution =
      earlier.reduce(
        (sum, day) =>
          sum + (day.executions > 0 ? day.cost / day.executions : 0),
        0,
      ) / earlier.length;

    const change = recentAvgCostPerExecution - earlierAvgCostPerExecution;
    const changePercent = Math.abs(change / earlierAvgCostPerExecution);

    if (changePercent < 0.05) return 'stable';
    return change < 0 ? 'improving' : 'degrading';
  }

  /**
   * Generate ROI report for a user
   */
  async generateROIReport(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<any> {
    try {
      const userROI = await this.calculateUserROI(userId, startDate, endDate);

      // Generate insights and recommendations
      const insights = this.generateROIInsights(userROI);
      const recommendations = this.generateROIRecommendations(userROI);

      return {
        userId,
        timeRange: { startDate, endDate },
        summary: {
          totalSavings: userROI.totalSavings,
          totalOptimizations: userROI.totalOptimizations,
          projectsCount: userROI.projects.length,
          averageSavingsPerProject:
            userROI.projects.length > 0
              ? userROI.totalSavings / userROI.projects.length
              : 0,
        },
        projects: userROI.projects,
        insights,
        recommendations,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to generate ROI report', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Generate insights from ROI data
   */
  private generateROIInsights(userROI: UserROISummary): string[] {
    const insights: string[] = [];

    if (userROI.totalSavings > 100) {
      insights.push(
        `💰 You've saved $${userROI.totalSavings.toFixed(2)} in AI costs!`,
      );
    }

    const highCostProjects = userROI.projects.filter((p) => p.totalCost > 50);
    if (highCostProjects.length > 0) {
      insights.push(
        `📊 ${highCostProjects.length} projects have costs over $50 - consider optimization.`,
      );
    }

    const efficientProjects = userROI.projects.filter(
      (p) => p.savingsRate > 0.2,
    );
    if (efficientProjects.length > 0) {
      insights.push(
        `✅ ${efficientProjects.length} projects have savings rates over 20% - great job!`,
      );
    }

    return insights;
  }

  /**
   * Generate recommendations based on ROI data
   */
  private generateROIRecommendations(userROI: UserROISummary): Array<{
    priority: 'high' | 'medium' | 'low';
    title: string;
    description: string;
    potentialSavings: number;
  }> {
    const recommendations: Array<{
      priority: 'high' | 'medium' | 'low';
      title: string;
      description: string;
      potentialSavings: number;
    }> = [];

    // Check for high-cost projects without savings
    const highCostLowSavingsProjects = userROI.projects.filter(
      (p) => p.totalCost > 20 && p.savingsRate < 0.1,
    );

    for (const project of highCostLowSavingsProjects) {
      recommendations.push({
        priority: 'high',
        title: `Optimize ${project.projectName}`,
        description: `This project has $${project.totalCost.toFixed(2)} in costs with only ${project.savingsRate.toFixed(1)}% savings rate.`,
        potentialSavings: project.totalCost * 0.2, // Estimate 20% potential savings
      });
    }

    // Check for projects with high token usage but low savings
    const highUsageProjects = userROI.projects.filter(
      (p) => p.averageTokensPerRequest > 2000 && p.savingsRate < 0.15,
    );

    for (const project of highUsageProjects) {
      recommendations.push({
        priority: 'medium',
        title: `Review token usage in ${project.projectName}`,
        description: `High token consumption (${project.averageTokensPerRequest.toFixed(0)} tokens/request) suggests optimization opportunities.`,
        potentialSavings: project.totalCost * 0.15,
      });
    }

    return recommendations.slice(0, 5); // Limit to top 5
  }
}
