import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  UseGuards,
  Res,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';
import {
  RequestFeedbackService,
  FeedbackAnalytics,
} from '../request-feedback/request-feedback.service';
import { ProjectService } from '../project/project.service';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage, UsageDocument } from '../../schemas/core/usage.schema';
import { User, UserDocument } from '../../schemas/user/user.schema';
import { Types } from 'mongoose';
import {
  AnalyticsQueryDto,
  ComparativeAnalyticsQueryDto,
  ProjectComparisonQueryDto,
  InsightsQueryDto,
  DashboardQueryDto,
  RecentUsageQueryDto,
  ExportQueryDto,
} from './dto/analytics-query.dto';

@Controller('api/analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly requestFeedbackService: RequestFeedbackService,
    private readonly projectService: ProjectService,
    private readonly businessLogging: BusinessEventLoggingService,
    @InjectModel(Usage.name) private readonly usageModel: Model<UsageDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  @Get()
  async getAnalytics(
    @CurrentUser() user: { id: string },
    @Query() query: AnalyticsQueryDto,
  ) {
    const startTime = Date.now();
    const validated = {
      userId: user.id,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      period: query.period,
      service: query.service,
      model: query.model,
      groupBy: query.groupBy,
      projectId: query.projectId,
    };
    const analytics = await this.analyticsService.getAnalytics(validated, {
      includeProjectBreakdown: true,
    });
    this.businessLogging.logBusiness({
      event: 'analytics_retrieved',
      category: 'data_analytics',
      value: Date.now() - startTime,
      metadata: {
        userId: user.id,
        totalCost: analytics.summary.totalCost,
        totalRequests: analytics.summary.totalRequests,
        totalTokens: analytics.summary.totalTokens,
        hasProjectBreakdown: !!analytics.projectBreakdown,
      },
    });
    return { success: true, data: analytics };
  }

  @Post('compare')
  async getComparativeAnalytics(
    @CurrentUser() user: { id: string },
    @Query() query: ComparativeAnalyticsQueryDto,
  ) {
    const startTime = Date.now();
    const { period1Start, period1End, period2Start, period2End } = query;
    if (!period1Start || !period1End || !period2Start || !period2End) {
      throw new BadRequestException('All period dates are required');
    }
    const comparison = await this.analyticsService.getComparativeAnalytics(
      user.id,
      { startDate: new Date(period1Start), endDate: new Date(period1End) },
      { startDate: new Date(period2Start), endDate: new Date(period2End) },
    );
    this.businessLogging.logBusiness({
      event: 'comparative_analytics_retrieved',
      category: 'data_analytics',
      value: Date.now() - startTime,
      metadata: {
        userId: user.id,
        period1Duration: `${period1Start} to ${period1End}`,
        period2Duration: `${period2Start} to ${period2End}`,
      },
    });
    return { success: true, data: comparison };
  }

  @Get('export')
  async exportAnalytics(
    @CurrentUser() user: { id: string },
    @Res() res: Response,
    @Query() query: ExportQueryDto,
  ) {
    const startTime = Date.now();
    const format = (query.format as 'json' | 'csv') || 'json';
    const validated = {
      userId: user.id,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
      period: query.period,
      service: query.service,
      model: query.model,
      groupBy: query.groupBy,
      projectId: query.projectId,
    };
    const exportData = await this.analyticsService.exportAnalytics(
      validated,
      format,
    );
    const filename = `analytics-export-${Date.now()}.${format}`;
    this.businessLogging.logBusiness({
      event: 'analytics_exported',
      category: 'data_export',
      value: Date.now() - startTime,
      metadata: {
        userId: user.id,
        format,
        filename,
        dataSize: typeof exportData === 'string' ? exportData.length : 0,
      },
    });
    res.setHeader(
      'Content-Type',
      format === 'csv' ? 'text/csv' : 'application/json',
    );
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(exportData);
  }

  @Get('insights')
  async getInsights(
    @CurrentUser() user: { id: string },
    @Query() query: InsightsQueryDto,
  ) {
    const startTime = Date.now();
    const timeframe = query.timeframe || '30d';
    let startDate: Date;
    const endDate = new Date();
    switch (timeframe) {
      case '7d':
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }
    const analytics = await this.analyticsService.getAnalytics({
      userId: user.id,
      startDate,
      endDate,
    });
    const insights = {
      summary: {
        totalSpent: analytics.summary.totalCost,
        totalCalls: analytics.summary.totalRequests,
        avgCostPerCall: analytics.summary.averageCostPerRequest,
        totalTokens: analytics.summary.totalTokens,
      },
      trends: analytics.trends,
      topCostDrivers: {
        services: analytics.breakdown.services.slice(0, 3),
        models: analytics.breakdown.models.slice(0, 3),
      },
      timeline: analytics.timeline,
      recommendations: analytics.trends.insights.slice(0, 5),
    };
    this.businessLogging.logBusiness({
      event: 'analytics_insights_retrieved',
      category: 'data_analytics',
      value: Date.now() - startTime,
      metadata: {
        userId: user.id,
        timeframe,
        totalSpent: insights.summary.totalSpent,
        totalCalls: insights.summary.totalCalls,
        insightsCount: insights.recommendations.length,
      },
    });
    return { success: true, data: insights };
  }

  @Get('dashboard')
  async getDashboardData(
    @CurrentUser() user: { id: string },
    @Query() query: DashboardQueryDto,
  ) {
    const startTime = Date.now();
    const objectUserId = new Types.ObjectId(user.id);
    const projectId = query.projectId;
    const baseFilter: any = { userId: objectUserId };
    if (projectId && projectId !== 'all') {
      baseFilter.projectId = new Types.ObjectId(projectId);
    }
    let endDate = new Date();
    let startDate: Date;

    const rangeMs: Record<string, number> = {
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
      '90d': 90 * 24 * 60 * 60 * 1000,
      '365d': 365 * 24 * 60 * 60 * 1000,
    };
    const requestedRange = query.timeRange;

    if (requestedRange && rangeMs[requestedRange]) {
      startDate = new Date(endDate.getTime() - rangeMs[requestedRange]);
    } else {
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    const hasRecentUsage = await this.usageModel.exists({
      ...baseFilter,
      createdAt: { $gte: startDate, $lte: endDate },
    });
    if (!requestedRange && !hasRecentUsage) {
      const usageBounds = await this.usageModel.aggregate([
        { $match: baseFilter },
        {
          $group: {
            _id: null,
            minDate: { $min: '$createdAt' },
            maxDate: { $max: '$createdAt' },
          },
        },
      ]);
      if (usageBounds.length > 0 && usageBounds[0].minDate) {
        startDate = usageBounds[0].minDate;
        endDate = usageBounds[0].maxDate;
      }
    }
    const today = new Date(endDate);
    today.setHours(0, 0, 0, 0);
    const todayEnd = new Date(endDate);
    todayEnd.setHours(23, 59, 59, 999);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayEnd = new Date(yesterday);
    yesterdayEnd.setHours(23, 59, 59, 999);

    const [analytics, todayStats, yesterdayStats, userDoc] = await Promise.all([
      this.analyticsService.getAnalytics(
        {
          userId: user.id,
          startDate,
          endDate,
          projectId: projectId as string,
        },
        { includeProjectBreakdown: true },
      ),
      this.analyticsService.getAnalytics({
        userId: user.id,
        startDate: today,
        endDate: todayEnd,
        projectId: projectId as string,
      }),
      this.analyticsService.getAnalytics({
        userId: user.id,
        startDate: yesterday,
        endDate: yesterdayEnd,
        projectId: projectId as string,
      }),
      this.userModel
        .findById(user.id)
        .select('name email subscription usage')
        .lean()
        .exec(),
    ]);

    const calculateChange = (
      oldValue: number,
      newValue: number,
    ): {
      value: number;
      percentage: number;
      trend: 'up' | 'down' | 'stable';
    } => {
      const change = newValue - oldValue;
      const percentage =
        oldValue === 0 ? (newValue === 0 ? 0 : 100) : (change / oldValue) * 100;
      return {
        value: change,
        percentage,
        trend: change > 0 ? 'up' : change < 0 ? 'down' : 'stable',
      };
    };

    const dashboardData = {
      user: userDoc,
      overview: {
        totalCost: {
          value: analytics.summary.totalCost,
          change: calculateChange(
            yesterdayStats.summary.totalCost,
            todayStats.summary.totalCost,
          ),
        },
        totalCalls: {
          value: analytics.summary.totalRequests,
          change: calculateChange(
            yesterdayStats.summary.totalRequests,
            todayStats.summary.totalRequests,
          ),
        },
        avgCostPerCall: {
          value: analytics.summary.averageCostPerRequest,
          change: calculateChange(
            yesterdayStats.summary.averageCostPerRequest,
            todayStats.summary.averageCostPerRequest,
          ),
        },
        totalOptimizationSavings: { value: 0, change: 0 },
      },
      charts: {
        costOverTime: analytics.timeline,
        serviceBreakdown: analytics.breakdown.services,
        modelUsage: analytics.breakdown.models.slice(0, 5),
      },
      recentActivity: { topPrompts: [], optimizationOpportunities: 0 },
      insights: analytics.trends.insights.slice(0, 3),
    };

    this.businessLogging.logBusiness({
      event: 'dashboard_data_retrieved',
      category: 'dashboard_analytics',
      value: Date.now() - startTime,
      metadata: {
        userId: user.id,
        projectId: projectId || 'all',
        totalCost: dashboardData.overview.totalCost.value,
        totalCalls: dashboardData.overview.totalCalls.value,
        insightsCount: dashboardData.insights.length,
      },
    });
    return { success: true, data: dashboardData };
  }

  @Get('projects/compare')
  async getProjectComparison(
    @CurrentUser() user: { id: string },
    @Query() query: ProjectComparisonQueryDto,
  ) {
    const startTime = Date.now();
    let projectIdsArray: string[] = [];
    if (Array.isArray(query.projectIds)) {
      projectIdsArray = query.projectIds;
    } else if (typeof query.projectIds === 'string') {
      projectIdsArray = [query.projectIds];
    } else {
      throw new BadRequestException('projectIds parameter is required');
    }
    if (projectIdsArray.length === 0) {
      throw new BadRequestException('At least one project ID is required');
    }
    const userProjects = await this.projectService.getUserProjects(user.id);
    const accessibleIds = userProjects.map(
      (p: any) => p._id?.toString?.() ?? p._id,
    );
    const validProjectIds = projectIdsArray.filter((id) =>
      accessibleIds.includes(id),
    );
    if (validProjectIds.length === 0) {
      throw new ForbiddenException('No accessible projects found');
    }
    const comparison = await this.analyticsService.compareProjects(
      validProjectIds,
      {
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
        metric: query.metric,
      },
    );
    this.businessLogging.logBusiness({
      event: 'project_comparison_completed',
      category: 'project_analytics',
      value: Date.now() - startTime,
      metadata: {
        userId: user.id,
        requestedProjectIds: projectIdsArray.length,
        validProjectIds: validProjectIds.length,
        metric: comparison.metric,
      },
    });
    return { success: true, data: comparison };
  }

  @Get('projects/:projectId')
  async getProjectAnalytics(
    @CurrentUser() user: { id: string },
    @Param('projectId') projectId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    const startTime = Date.now();
    let project: any;
    try {
      project = await this.projectService.getProjectById(projectId, user.id);
    } catch (err: any) {
      if (
        err?.message === 'Access denied' ||
        err?.message === 'Project not found'
      ) {
        throw new NotFoundException('Project not found or access denied');
      }
      throw err;
    }
    if (!project) {
      throw new NotFoundException('Project not found or access denied');
    }
    const filters: any = { projectId };
    if (query.startDate)
      filters.createdAt = { $gte: new Date(query.startDate) };
    if (query.endDate) {
      filters.createdAt = filters.createdAt || {};
      filters.createdAt.$lte = new Date(query.endDate);
    }
    if (query.service) filters.service = query.service;
    if (query.model) filters.model = query.model;
    const analytics = await this.analyticsService.getProjectAnalytics(
      projectId,
      filters,
      { groupBy: (query.groupBy as string) || 'date' },
    );
    this.businessLogging.logBusiness({
      event: 'project_analytics_retrieved',
      category: 'project_analytics',
      value: Date.now() - startTime,
      metadata: {
        userId: user.id,
        projectId,
        groupBy: query.groupBy,
      },
    });
    return {
      success: true,
      data: {
        ...analytics,
        project: {
          id: project._id,
          name: project.name,
          budget: project.budget,
          spending: project.spending,
        },
      },
    };
  }

  @Get('recent-usage')
  async getRecentUsage(
    @CurrentUser() user: { id: string },
    @Query() query: RecentUsageQueryDto,
  ) {
    const startTime = Date.now();
    const recentUsage = await this.analyticsService.getRecentUsage({
      userId: user.id,
      limit: query.limit ? Number(query.limit) : 10,
      projectId: query.projectId,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    });
    this.businessLogging.logBusiness({
      event: 'recent_usage_retrieved',
      category: 'usage_analytics',
      value: Date.now() - startTime,
      metadata: {
        userId: user.id,
        limit: query.limit || 10,
        projectId: query.projectId || 'all',
        usageCount: recentUsage.length,
      },
    });
    return { success: true, data: recentUsage };
  }

  @Get('feedback')
  async getFeedbackAnalytics(@CurrentUser() user: { id: string }) {
    const startTime = Date.now();
    const feedbackAnalytics =
      await this.requestFeedbackService.getFeedbackAnalytics(user.id);
    this.businessLogging.logBusiness({
      event: 'feedback_analytics_retrieved',
      category: 'feedback_analytics',
      value: Date.now() - startTime,
      metadata: {
        userId: user.id,
        totalCost: feedbackAnalytics.totalCost,
        averageRating: feedbackAnalytics.averageRating,
        positiveCost: feedbackAnalytics.positiveCost,
        negativeCost: feedbackAnalytics.negativeCost,
      },
    });
    const insights = {
      wastedSpendPercentage:
        feedbackAnalytics.totalCost > 0
          ? (feedbackAnalytics.negativeCost / feedbackAnalytics.totalCost) * 100
          : 0,
      returnOnAISpend: feedbackAnalytics.averageRating,
      costEfficiencyScore:
        feedbackAnalytics.totalCost > 0
          ? (feedbackAnalytics.positiveCost / feedbackAnalytics.totalCost) * 100
          : 0,
      recommendations: this.generateFeedbackRecommendations(feedbackAnalytics),
    };
    return {
      success: true,
      data: { ...feedbackAnalytics, insights },
    };
  }

  private generateFeedbackRecommendations(
    analytics: FeedbackAnalytics,
  ): string[] {
    const recommendations: string[] = [];
    if (analytics.totalCost > 0) {
      const wastedPercentage =
        (analytics.negativeCost / analytics.totalCost) * 100;
      if (wastedPercentage > 30) {
        recommendations.push(
          `You're spending ${wastedPercentage.toFixed(1)}% of your AI budget on negatively-rated responses. Consider optimizing prompts or switching models.`,
        );
      }
    }
    const implicit = analytics.implicitSignalsAnalysis;
    if (implicit.copyRate < 0.3) {
      recommendations.push(
        `Only ${(implicit.copyRate * 100).toFixed(1)}% of responses are being copied by users. This suggests low practical value - review your prompts.`,
      );
    }
    if (implicit.rephraseRate > 0.4) {
      recommendations.push(
        `${(implicit.rephraseRate * 100).toFixed(1)}% of users are rephrasing their questions immediately. Your AI may not be understanding queries correctly.`,
      );
    }
    for (const [model, stats] of Object.entries(analytics.ratingsByModel)) {
      const s = stats as { positive: number; negative: number };
      const total = s.positive + s.negative;
      if (total > 5 && s.positive / total < 0.5) {
        recommendations.push(
          `Model "${model}" has a low satisfaction rate (${((s.positive / total) * 100).toFixed(1)}%). Consider switching to a different model.`,
        );
      }
    }
    for (const [feature, stats] of Object.entries(analytics.ratingsByFeature)) {
      const s = stats as { positive: number; negative: number };
      const total = s.positive + s.negative;
      if (total > 3 && s.positive / total < 0.4) {
        recommendations.push(
          `Feature "${feature}" has poor user satisfaction (${((s.positive / total) * 100).toFixed(1)}%). Consider redesigning this feature.`,
        );
      }
    }
    if (recommendations.length === 0) {
      recommendations.push(
        'Great job! Your AI responses are performing well. Keep monitoring feedback to maintain quality.',
      );
    }
    return recommendations;
  }
}
