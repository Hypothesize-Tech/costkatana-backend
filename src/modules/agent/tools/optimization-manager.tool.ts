import { Injectable, Inject } from '@nestjs/common';
import { BaseAgentTool } from './base-agent.tool';
import { MongoDbReaderToolService } from './mongodb-reader.tool';

/**
 * Optimization Manager Tool Service
 * Provides cost optimization recommendations and strategies
 * Ported from Express OptimizationManagerTool with NestJS patterns
 */
@Injectable()
export class OptimizationManagerToolService extends BaseAgentTool {
  constructor(
    @Inject(MongoDbReaderToolService)
    private readonly mongoReader: MongoDbReaderToolService,
  ) {
    super(
      'optimization_manager',
      `Provide cost optimization recommendations and strategies:
- analyze_costs: Analyze current spending patterns
- suggest_optimizations: Suggest specific optimizations
- bulk_analysis: Analyze multiple projects/users
- model_comparison: Compare optimization potential

Input should be a JSON string with:
{
  "operation": "analyze_costs|suggest_optimizations|bulk_analysis|model_comparison",
  "userId": "string",
  "projectId": "string", // Optional
  "timeRange": "last_30_days|last_90_days" // Optional
}`,
    );
  }

  protected async executeLogic(input: any): Promise<any> {
    try {
      const {
        operation,
        userId,
        projectId,
        timeRange = 'last_30_days',
      } = input;

      if (!userId) {
        return this.createErrorResponse(
          'optimization_manager',
          'userId is required',
        );
      }

      switch (operation) {
        case 'analyze_costs':
          return await this.analyzeCosts(userId, projectId, timeRange);

        case 'suggest_optimizations':
          return await this.suggestOptimizations(userId, projectId);

        case 'bulk_analysis':
          return await this.bulkAnalysis(userId);

        case 'model_comparison':
          return await this.modelComparison(userId);

        default:
          return this.createErrorResponse(
            'optimization_manager',
            `Unsupported operation: ${operation}`,
          );
      }
    } catch (error: any) {
      this.logger.error('Optimization manager operation failed', {
        error: error.message,
        input,
      });
      return this.createErrorResponse('optimization_manager', error.message);
    }
  }

  private async analyzeCosts(
    userId: string,
    projectId?: string,
    timeRange: string = 'last_30_days',
  ): Promise<any> {
    try {
      // Query usage data for cost analysis
      const query = {
        collection: 'usages',
        operation: 'aggregate',
        pipeline: [
          {
            $match: {
              userId,
              ...(projectId && { projectId }),
              createdAt: { $gte: this.getDateRange(timeRange) },
            },
          },
          {
            $group: {
              _id: '$model',
              totalCost: { $sum: '$cost' },
              totalTokens: { $sum: '$totalTokens' },
              requestCount: { $sum: 1 },
              avgCostPerRequest: { $avg: '$cost' },
              avgTokensPerRequest: { $avg: '$totalTokens' },
              maxCost: { $max: '$cost' },
              minCost: { $min: '$cost' },
            },
          },
          { $sort: { totalCost: -1 } },
        ],
      };

      const result = await this.mongoReader.runQuery(query);

      if (result.success && result.data?.result) {
        const costAnalysis = result.data.result;
        const totalCost = costAnalysis.reduce(
          (sum: number, model: any) => sum + model.totalCost,
          0,
        );
        const totalRequests = costAnalysis.reduce(
          (sum: number, model: any) => sum + model.requestCount,
          0,
        );
        const totalTokens = costAnalysis.reduce(
          (sum: number, model: any) => sum + model.totalTokens,
          0,
        );

        const topModel = costAnalysis[0];
        const avgCostPerRequest = totalCost / totalRequests;
        const avgTokensPerRequest = totalTokens / totalRequests;

        // Generate insights
        const insights = [
          `Top spending model: ${topModel?._id} (${((topModel?.totalCost / totalCost) * 100).toFixed(1)}% of costs)`,
          `Average cost per request: $${avgCostPerRequest.toFixed(4)}`,
          `Average tokens per request: ${avgTokensPerRequest.toFixed(0)}`,
          `Total requests: ${totalRequests}`,
          `Total tokens: ${totalTokens.toLocaleString()}`,
        ];

        // Cost efficiency analysis
        const efficiencyAnalysis = costAnalysis.map((model: any) => ({
          model: model._id,
          costPerToken: model.totalCost / model.totalTokens,
          efficiency: this.calculateEfficiency(
            model._id,
            model.totalCost / model.totalTokens,
          ),
        }));

        return this.createSuccessResponse('optimization_manager', {
          operation: 'analyze_costs',
          timeRange,
          totalCost: Number(totalCost.toFixed(2)),
          totalRequests,
          totalTokens,
          avgCostPerRequest: Number(avgCostPerRequest.toFixed(4)),
          avgTokensPerRequest: Number(avgTokensPerRequest.toFixed(0)),
          modelBreakdown: costAnalysis.map((model: any) => ({
            model: model._id,
            totalCost: Number(model.totalCost.toFixed(2)),
            totalTokens: model.totalTokens,
            requestCount: model.requestCount,
            avgCostPerRequest: Number(model.avgCostPerRequest.toFixed(4)),
            avgTokensPerRequest: Number(model.avgTokensPerRequest.toFixed(0)),
            costPercentage:
              ((model.totalCost / totalCost) * 100).toFixed(1) + '%',
          })),
          efficiencyAnalysis,
          insights,
          recommendations: this.generateCostRecommendations(
            costAnalysis,
            totalCost,
          ),
          message: 'Cost analysis completed successfully',
        });
      }

      return this.createErrorResponse(
        'optimization_manager',
        'Failed to analyze costs - no data found',
      );
    } catch (error: any) {
      this.logger.error('Cost analysis error', { error: error.message });
      return this.createErrorResponse(
        'optimization_manager',
        'Failed to analyze costs',
      );
    }
  }

  private async suggestOptimizations(
    userId: string,
    projectId?: string,
  ): Promise<any> {
    // Get cost data first
    const costAnalysis = await this.analyzeCosts(userId, projectId);

    if (!costAnalysis.success) {
      return costAnalysis;
    }

    const suggestions = [
      {
        type: 'model_switching',
        title: 'Switch to cost-effective models',
        description:
          'Consider using Nova Lite for simple tasks instead of Nova Pro',
        potentialSavings: '$15-25/month',
        difficulty: 'medium',
      },
      {
        type: 'prompt_optimization',
        title: 'Optimize prompts with Cortex',
        description: 'Use Cortex meta-language to reduce token usage by 40-75%',
        potentialSavings: '$20-40/month',
        difficulty: 'easy',
      },
      {
        type: 'caching',
        title: 'Implement semantic caching',
        description: 'Cache similar queries to reduce redundant API calls',
        potentialSavings: '$10-20/month',
        difficulty: 'hard',
      },
    ];

    return this.createSuccessResponse('optimization_manager', {
      operation: 'suggest_optimizations',
      projectId,
      suggestions,
      priorityOrder: ['prompt_optimization', 'model_switching', 'caching'],
      message: 'Optimization suggestions generated successfully',
    });
  }

  private async bulkAnalysis(userId: string): Promise<any> {
    // Analyze across all user's projects
    const projectsQuery = {
      collection: 'projects',
      operation: 'find',
      query: { userId, isActive: true },
    };

    const projectsResult = await this.mongoReader.runQuery(projectsQuery);

    if (!projectsResult.success) {
      return this.createErrorResponse(
        'optimization_manager',
        'Failed to retrieve projects',
      );
    }

    const projects = projectsResult.data.result;
    const projectAnalyses = [];

    for (const project of projects) {
      const analysis = await this.analyzeCosts(userId, project._id);
      if (analysis.success) {
        projectAnalyses.push({
          projectId: project._id,
          projectName: project.name,
          ...analysis.data,
        });
      }
    }

    const totalCost = projectAnalyses.reduce((sum, p) => sum + p.totalCost, 0);

    return this.createSuccessResponse('optimization_manager', {
      operation: 'bulk_analysis',
      totalProjects: projects.length,
      totalCost,
      projectAnalyses,
      message: 'Bulk analysis completed successfully',
    });
  }

  /**
   * Compares various AI models for a specific user, highlighting cost differences and offering tailored recommendations.
   * @param userId - The ID of the user for whom model comparison is being performed
   */
  private async modelComparison(userId: string): Promise<any> {
    // Later, model list/recommendations could be made user/project-aware via userId (now it's static)
    const models = [
      {
        name: 'amazon.nova-lite-v1:0',
        costPerToken: 0.00015,
        quality: 'medium',
        speed: 'fast',
        bestFor: 'Simple tasks, chat, classification',
      },
      {
        name: 'amazon.nova-pro-v1:0',
        costPerToken: 0.0008,
        quality: 'high',
        speed: 'medium',
        bestFor: 'Complex analysis, code generation, research',
      },
      {
        name: 'anthropic.claude-3-haiku-20240307-v1:0',
        costPerToken: 0.001,
        quality: 'high',
        speed: 'fast',
        bestFor: 'Balanced performance, large context tasks',
      },
      {
        name: 'anthropic.claude-3-sonnet-20240229-v1:0',
        costPerToken: 0.003,
        quality: 'very-high',
        speed: 'medium',
        bestFor: 'Maximum quality, advanced reasoning',
      },
    ];

    // Calculate savings potential for userId context (general calculation here)
    const cheapest = models[0];
    const mostExpensive = models[models.length - 1];
    const potentialSavings =
      (mostExpensive.costPerToken - cheapest.costPerToken) * 1000000; // For 1M tokens

    const recommendations = [
      `User ${userId}: Use ${cheapest.name} for simple tasks to potentially save $${potentialSavings.toFixed(
        2,
      )} monthly versus the most expensive model.`,
      `User ${userId}: Consider ${models[1].name} for cost-effective high-quality tasks.`,
      `User ${userId}: Reserve ${mostExpensive.name} only for tasks requiring maximum quality.`,
      'Consider using prompt optimization to reduce token usage by 40-75%.',
    ];

    return this.createSuccessResponse('optimization_manager', {
      operation: 'model_comparison',
      userId,
      models: models.map((model) => ({
        ...model,
        monthlyCostFor1M: (model.costPerToken * 1000000).toFixed(2),
        monthlyCostFor100K: (model.costPerToken * 100000).toFixed(2),
      })),
      recommendations,
      savingsAnalysis: {
        userId,
        potentialMonthlySavings: `$${potentialSavings.toFixed(2)}`,
        efficiencyGains: '40-75% token reduction with optimized prompts',
        message: 'Model comparison completed successfully',
      },
    });
  }

  private calculateEfficiency(modelName: string, costPerToken: number): string {
    const benchmarks = {
      'amazon.nova-lite-v1:0': 0.00015,
      'amazon.nova-pro-v1:0': 0.0008,
      'anthropic.claude-3-haiku-20240307-v1:0': 0.001,
      'anthropic.claude-3-sonnet-20240229-v1:0': 0.003,
    };

    const benchmark = benchmarks[modelName as keyof typeof benchmarks];
    if (!benchmark) return 'unknown';

    const efficiency = ((benchmark - costPerToken) / benchmark) * 100;
    if (efficiency > 10) return 'excellent';
    if (efficiency > 0) return 'good';
    if (efficiency > -10) return 'average';
    return 'poor';
  }

  private generateCostRecommendations(
    modelBreakdown: any[],
    totalCost: number,
  ): string[] {
    const recommendations: string[] = [];

    if (modelBreakdown.length === 0) return recommendations;

    const topModel = modelBreakdown[0];
    const costConcentration = (topModel.totalCost / totalCost) * 100;

    if (costConcentration > 70) {
      recommendations.push(
        `⚠️ High concentration (${costConcentration.toFixed(1)}%) on ${topModel._id} - consider diversifying model usage`,
      );
    }

    // Check for inefficient model usage
    const inefficientModels = modelBreakdown.filter((model) => {
      const efficiency = this.calculateEfficiency(
        model._id,
        model.totalCost / model.totalTokens,
      );
      return efficiency === 'poor';
    });

    if (inefficientModels.length > 0) {
      recommendations.push(
        `Consider switching from ${inefficientModels.map((m) => m._id).join(', ')} to more cost-effective alternatives`,
      );
    }

    // General recommendations
    if (totalCost > 100) {
      recommendations.push(
        'Enable semantic caching to reduce redundant API calls',
      );
    }

    if (totalCost > 50) {
      recommendations.push(
        'Implement prompt optimization to reduce token usage by 40-75%',
      );
    }

    recommendations.push('Set up spending alerts to prevent budget overruns');

    return recommendations;
  }

  private getDateRange(timeRange: string): Date {
    const now = new Date();
    switch (timeRange) {
      case 'last_7_days':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'last_30_days':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case 'last_90_days':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      case 'last_year':
        return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }
}
