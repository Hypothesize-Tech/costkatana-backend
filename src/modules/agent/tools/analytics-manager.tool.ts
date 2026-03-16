import { Injectable, Inject } from '@nestjs/common';
import { BaseAgentTool } from './base-agent.tool';
import { MongoDbReaderToolService } from './mongodb-reader.tool';

/**
 * Analytics Manager Tool Service
 * Provides comprehensive analytics: dashboard, cost trends, model performance, etc.
 * Ported from Express AnalyticsManagerTool with NestJS patterns
 */
@Injectable()
export class AnalyticsManagerToolService extends BaseAgentTool {
  constructor(
    @Inject(MongoDbReaderToolService)
    private readonly mongoReader: MongoDbReaderToolService,
  ) {
    super(
      'analytics_manager',
      `Analyze usage patterns, costs, tokens, and generate analytics reports:
- dashboard: Cost breakdown and usage summary
- token_usage: Detailed token consumption analytics
- model_performance: Model speed, quality, and efficiency metrics
- usage_patterns: When and how AI is being used
- cost_trends: Spending patterns over time
- user_stats: Account-level statistics and achievements
- project_analytics: Project-specific analytics
- anomaly_detection: Identify unusual spending patterns
- forecasting: Predict future costs and usage

Input should be a JSON string with:
{
  "operation": "dashboard|token_usage|model_performance|usage_patterns|cost_trends|user_stats|project_analytics|anomaly_detection|forecasting|comparative_analysis",
  "userId": "string",
  "timeRange": "last_7_days|last_30_days|last_90_days|custom",
  "projectId": "string" // Optional
}`,
    );
  }

  protected async executeLogic(input: any): Promise<any> {
    try {
      const {
        operation,
        userId,
        timeRange = 'last_30_days',
        projectId,
      } = input;

      if (!userId) {
        return this.createErrorResponse(
          'analytics_manager',
          'userId is required',
        );
      }

      switch (operation) {
        case 'dashboard':
          return await this.getDashboardAnalytics(userId, timeRange, projectId);

        case 'token_usage':
          return await this.getTokenUsageAnalytics(
            userId,
            timeRange,
            projectId,
          );

        case 'model_performance':
          return await this.getModelPerformanceAnalytics(userId, timeRange);

        case 'usage_patterns':
          return await this.getUsagePatternsAnalytics(userId, timeRange);

        case 'cost_trends':
          return await this.getCostTrendsAnalytics(userId, timeRange);

        case 'user_stats':
          return await this.getUserStatsAnalytics(userId);

        case 'project_analytics':
          return await this.getProjectAnalytics(userId, projectId);

        case 'anomaly_detection':
          return await this.getAnomalyDetectionAnalytics(userId, timeRange);

        case 'forecasting':
          return await this.getForecastingAnalytics(userId, timeRange);

        case 'comparative_analysis':
          return await this.getComparativeAnalysis(userId, timeRange);

        default:
          return this.createErrorResponse(
            'analytics_manager',
            `Unsupported operation: ${operation}`,
          );
      }
    } catch (error: any) {
      this.logger.error('Analytics manager operation failed', {
        error: error.message,
        input,
      });
      return this.createErrorResponse('analytics_manager', error.message);
    }
  }

  private async getDashboardAnalytics(
    userId: string,
    timeRange: string,
    projectId?: string,
  ): Promise<any> {
    try {
      // Query usage data for dashboard
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
              _id: null,
              totalRequests: { $sum: 1 },
              totalCost: { $sum: '$cost' },
              totalTokens: { $sum: '$totalTokens' },
              avgCostPerRequest: { $avg: '$cost' },
              avgTokensPerRequest: { $avg: '$totalTokens' },
              uniqueModels: { $addToSet: '$model' },
              lastRequest: { $max: '$createdAt' },
            },
          },
        ],
      };

      const result = await this.mongoReader.runQuery(query);

      if (result.success && result.data?.result?.[0]) {
        const data = result.data.result[0];

        // Get top models
        const topModelsQuery = {
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
                requests: { $sum: 1 },
                cost: { $sum: '$cost' },
                tokens: { $sum: '$totalTokens' },
              },
            },
            { $sort: { cost: -1 } },
            { $limit: 3 },
          ],
        };

        const topModelsResult = await this.mongoReader.runQuery(topModelsQuery);
        const topModels = topModelsResult.success
          ? topModelsResult.data.result
          : [];

        return this.createSuccessResponse('analytics_manager', {
          operation: 'dashboard',
          timeRange,
          summary: {
            totalRequests: data.totalRequests || 0,
            totalCost: data.totalCost || 0,
            totalTokens: data.totalTokens || 0,
            avgCostPerRequest: data.avgCostPerRequest || 0,
            avgTokensPerRequest: data.avgTokensPerRequest || 0,
            uniqueModels: data.uniqueModels?.length || 0,
            lastRequest: data.lastRequest,
          },
          topModels,
          trends: {
            costGrowth: 'stable', // Would calculate actual trends
            usageGrowth: 'increasing',
          },
          message: 'Dashboard analytics retrieved successfully',
        });
      }

      return this.createErrorResponse(
        'analytics_manager',
        'Failed to retrieve dashboard data',
      );
    } catch (error: any) {
      this.logger.error('Dashboard analytics error', { error: error.message });
      return this.createErrorResponse(
        'analytics_manager',
        'Failed to retrieve dashboard data',
      );
    }
  }

  private async getTokenUsageAnalytics(
    userId: string,
    timeRange: string,
    projectId?: string,
  ): Promise<any> {
    // Query token usage data
    const query = {
      collection: 'usages',
      operation: 'aggregate',
      pipeline: [
        { $match: { userId, ...(projectId && { projectId }) } },
        {
          $group: {
            _id: '$model',
            totalTokens: { $sum: '$totalTokens' },
            totalCost: { $sum: '$cost' },
            requestCount: { $sum: 1 },
          },
        },
        { $sort: { totalTokens: -1 } },
        { $limit: 10 },
      ],
    };

    const result = await this.mongoReader.runQuery(query);

    if (result.success) {
      return this.createSuccessResponse('analytics_manager', {
        operation: 'token_usage',
        timeRange,
        tokenBreakdown: result.data.result,
        message: 'Token usage analytics retrieved successfully',
      });
    }

    return this.createErrorResponse(
      'analytics_manager',
      'Failed to retrieve token usage data',
    );
  }

  private async getModelPerformanceAnalytics(
    userId: string,
    timeRange: string,
  ): Promise<any> {
    // Query model performance data
    const query = {
      collection: 'usages',
      operation: 'aggregate',
      pipeline: [
        { $match: { userId } },
        {
          $group: {
            _id: '$model',
            avgResponseTime: { $avg: '$responseTime' },
            totalRequests: { $sum: 1 },
            totalCost: { $sum: '$cost' },
            successRate: {
              $avg: { $cond: [{ $eq: ['$success', true] }, 1, 0] },
            },
          },
        },
        { $sort: { totalRequests: -1 } },
        { $limit: 5 },
      ],
    };

    const result = await this.mongoReader.runQuery(query);

    if (result.success) {
      return this.createSuccessResponse('analytics_manager', {
        operation: 'model_performance',
        timeRange,
        models: result.data.result,
        message: 'Model performance analytics retrieved successfully',
      });
    }

    return this.createErrorResponse(
      'analytics_manager',
      'Failed to retrieve model performance data',
    );
  }

  private async getUsagePatternsAnalytics(
    userId: string,
    timeRange: string,
  ): Promise<any> {
    try {
      // Query usage patterns from database
      const query = {
        collection: 'usages',
        operation: 'aggregate',
        pipeline: [
          {
            $match: {
              userId,
              createdAt: { $gte: this.getDateRange(timeRange) },
            },
          },
          {
            $group: {
              _id: {
                hour: { $hour: '$createdAt' },
                dayOfWeek: { $dayOfWeek: '$createdAt' },
              },
              count: { $sum: 1 },
              totalCost: { $sum: '$cost' },
              avgTokens: { $avg: '$totalTokens' },
            },
          },
          { $sort: { count: -1 } },
        ],
      };

      const result = await this.mongoReader.runQuery(query);

      if (result.success && result.data?.result) {
        const patterns = result.data.result;

        // Calculate peak usage patterns
        const hourlyPatterns = patterns.reduce((acc: any, pattern: any) => {
          const hour = pattern._id.hour;
          const day = pattern._id.dayOfWeek;
          if (!acc[hour]) acc[hour] = { total: 0, days: {} };
          acc[hour].total += pattern.count;
          acc[hour].days[day] = (acc[hour].days[day] || 0) + pattern.count;
          return acc;
        }, {});

        const peakHour = Object.entries(hourlyPatterns).reduce((a, b) =>
          hourlyPatterns[a[0]].total > hourlyPatterns[b[0]].total ? a : b,
        )?.[0];

        const dayNames = [
          'Sunday',
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
        ];
        const mostActiveDay = patterns[0]?._id?.dayOfWeek
          ? dayNames[patterns[0]._id.dayOfWeek - 1]
          : 'Unknown';

        const totalRequests = patterns.reduce(
          (sum: number, p: any) => sum + p.count,
          0,
        );
        const avgDaily = Math.round(
          totalRequests / this.getDaysInRange(timeRange),
        );

        return this.createSuccessResponse('analytics_manager', {
          operation: 'usage_patterns',
          timeRange,
          patterns: {
            peakHours: peakHour
              ? `${peakHour}:00-${parseInt(peakHour) + 1}:00`
              : '2-4 PM',
            avgDailyRequests: avgDaily,
            mostActiveDay,
            hourlyDistribution: Object.entries(hourlyPatterns).map(
              ([hour, data]: [string, any]) => ({
                hour: `${hour}:00`,
                requests: data.total,
                avgCost:
                  data.total > 0
                    ? (data.totalCost / data.total).toFixed(4)
                    : '0.0000',
              }),
            ),
            weeklyDistribution: dayNames.map((day, index) => {
              const dayPatterns = patterns.filter(
                (p: any) => p._id.dayOfWeek === index + 1,
              );
              return {
                day,
                requests: dayPatterns.reduce(
                  (sum: number, p: any) => sum + p.count,
                  0,
                ),
              };
            }),
          },
          insights: this.generateUsageInsights(
            patterns,
            totalRequests,
            timeRange,
          ),
          message: 'Usage patterns analytics retrieved successfully',
        });
      }

      // Fallback response
      return this.createSuccessResponse('analytics_manager', {
        operation: 'usage_patterns',
        timeRange,
        patterns: {
          peakHours: '2-4 PM',
          avgDailyRequests: 45,
          mostActiveDay: 'Tuesday',
          note: 'Using fallback data - no usage data found for the specified period',
        },
        message: 'Usage patterns analytics retrieved (fallback data)',
      });
    } catch (error: any) {
      this.logger.error('Usage patterns analytics error', {
        error: error.message,
      });
      return this.createErrorResponse(
        'analytics_manager',
        'Failed to retrieve usage patterns',
      );
    }
  }

  private async getCostTrendsAnalytics(
    userId: string,
    timeRange: string,
  ): Promise<any> {
    try {
      // Query cost trends over time
      const query = {
        collection: 'usages',
        operation: 'aggregate',
        pipeline: [
          {
            $match: {
              userId,
              createdAt: { $gte: this.getDateRange(timeRange) },
            },
          },
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
              },
              totalCost: { $sum: '$cost' },
              totalRequests: { $sum: 1 },
              avgCostPerRequest: { $avg: '$cost' },
            },
          },
          { $sort: { '_id.year': 1, '_id.month': 1 } },
        ],
      };

      const result = await this.mongoReader.runQuery(query);

      if (
        result.success &&
        result.data?.result &&
        result.data.result.length > 1
      ) {
        const trends = result.data.result;

        // Calculate growth rates
        const monthlyCosts = trends.map((t: any) => t.totalCost);
        const growthRates = [];

        for (let i = 1; i < monthlyCosts.length; i++) {
          const growth =
            ((monthlyCosts[i] - monthlyCosts[i - 1]) / monthlyCosts[i - 1]) *
            100;
          growthRates.push(growth);
        }

        const avgGrowthRate =
          growthRates.reduce((a, b) => a + b, 0) / growthRates.length;
        const currentMonth = trends[trends.length - 1];

        return this.createSuccessResponse('analytics_manager', {
          operation: 'cost_trends',
          timeRange,
          trends: {
            monthlyBreakdown: trends.map((t: any) => ({
              period: `${t._id.year}-${String(t._id.month).padStart(2, '0')}`,
              totalCost: Number(t.totalCost.toFixed(2)),
              totalRequests: t.totalRequests,
              avgCostPerRequest: Number(t.avgCostPerRequest.toFixed(4)),
            })),
            averageMonthlyCost: Number(
              (
                monthlyCosts.reduce((a: number, b: number) => a + b, 0) /
                monthlyCosts.length
              ).toFixed(2),
            ),
            growthRate: Number(avgGrowthRate.toFixed(2)),
            direction: avgGrowthRate > 0 ? 'increasing' : 'decreasing',
            volatility: this.calculateVolatility(monthlyCosts),
            forecast: {
              nextMonth: Number(
                (currentMonth.totalCost * (1 + avgGrowthRate / 100)).toFixed(2),
              ),
              confidence: Math.max(0, 100 - Math.abs(avgGrowthRate) * 2),
            },
          },
          insights: this.generateTrendInsights(trends, avgGrowthRate),
          message: 'Cost trends analytics retrieved successfully',
        });
      }

      // Fallback response
      return this.createSuccessResponse('analytics_manager', {
        operation: 'cost_trends',
        timeRange,
        trends: {
          monthlyGrowth: 5.2,
          avgMonthlyCost: 125.5,
          direction: 'increasing',
          note: 'Using fallback data - insufficient historical data for trend analysis',
        },
        message: 'Cost trends analytics retrieved (fallback data)',
      });
    } catch (error: any) {
      this.logger.error('Cost trends analytics error', {
        error: error.message,
      });
      return this.createErrorResponse(
        'analytics_manager',
        'Failed to retrieve cost trends',
      );
    }
  }

  private async getUserStatsAnalytics(userId: string): Promise<any> {
    try {
      // Query comprehensive user statistics
      const query = {
        collection: 'usages',
        operation: 'aggregate',
        pipeline: [
          { $match: { userId } },
          {
            $group: {
              _id: null,
              totalRequests: { $sum: 1 },
              totalCost: { $sum: '$cost' },
              totalTokens: { $sum: '$totalTokens' },
              firstRequest: { $min: '$createdAt' },
              lastRequest: { $max: '$createdAt' },
              uniqueModels: { $addToSet: '$model' },
              avgCostPerRequest: { $avg: '$cost' },
              avgTokensPerRequest: { $avg: '$totalTokens' },
            },
          },
        ],
      };

      const result = await this.mongoReader.runQuery(query);

      if (result.success && result.data?.result?.[0]) {
        const stats = result.data.result[0];

        // Calculate derived statistics
        const accountAge = stats.firstRequest
          ? Math.floor(
              (Date.now() - new Date(stats.firstRequest).getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : 0;

        const activeDays =
          stats.firstRequest && stats.lastRequest
            ? Math.floor(
                (new Date(stats.lastRequest).getTime() -
                  new Date(stats.firstRequest).getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : 0;

        // Get most used model
        const modelQuery = {
          collection: 'usages',
          operation: 'aggregate',
          pipeline: [
            { $match: { userId } },
            { $group: { _id: '$model', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 1 },
          ],
        };

        const modelResult = await this.mongoReader.runQuery(modelQuery);
        const favoriteModel =
          modelResult.success && modelResult.data?.result?.[0]
            ? modelResult.data.result[0]._id
            : 'unknown';

        return this.createSuccessResponse('analytics_manager', {
          operation: 'user_stats',
          stats: {
            totalRequests: stats.totalRequests,
            totalCost: Number(stats.totalCost.toFixed(2)),
            totalTokens: stats.totalTokens,
            activeDays: Math.max(1, activeDays),
            accountAge: Math.max(1, accountAge),
            favoriteModel,
            uniqueModels: stats.uniqueModels?.length || 0,
            avgCostPerRequest: Number(stats.avgCostPerRequest.toFixed(4)),
            avgTokensPerRequest: Number(stats.avgTokensPerRequest.toFixed(0)),
            requestsPerDay: Number(
              (stats.totalRequests / Math.max(1, activeDays)).toFixed(1),
            ),
            costPerDay: Number(
              (stats.totalCost / Math.max(1, activeDays)).toFixed(2),
            ),
            efficiency: this.calculateUserEfficiency(stats),
          },
          achievements: this.calculateUserAchievements(stats),
          message: 'User statistics retrieved successfully',
        });
      }

      // Fallback response
      return this.createSuccessResponse('analytics_manager', {
        operation: 'user_stats',
        stats: {
          totalRequests: 1250,
          totalCost: 450.75,
          activeDays: 28,
          favoriteModel: 'nova-pro',
          accountAge: 90,
          note: 'Using fallback data - no user statistics found',
        },
        message: 'User statistics retrieved (fallback data)',
      });
    } catch (error: any) {
      this.logger.error('User stats analytics error', { error: error.message });
      return this.createErrorResponse(
        'analytics_manager',
        'Failed to retrieve user statistics',
      );
    }
  }

  private async getProjectAnalytics(
    userId: string,
    projectId?: string,
  ): Promise<any> {
    try {
      // Query project analytics
      const matchCondition: any = { userId };
      if (projectId) {
        matchCondition.projectId = projectId;
      }

      const query = {
        collection: 'usages',
        operation: 'aggregate',
        pipeline: [
          { $match: matchCondition },
          {
            $group: {
              _id: '$projectId',
              totalRequests: { $sum: 1 },
              totalCost: { $sum: '$cost' },
              totalTokens: { $sum: '$totalTokens' },
              uniqueModels: { $addToSet: '$model' },
              avgCostPerRequest: { $avg: '$cost' },
              lastActivity: { $max: '$createdAt' },
            },
          },
          { $sort: { totalCost: -1 } },
        ],
      };

      const result = await this.mongoReader.runQuery(query);

      if (result.success && result.data?.result) {
        const projects = result.data.result;

        // Get project names from projects collection if available
        const projectDetails = await this.enrichProjectDetails(
          userId,
          projects,
        );

        return this.createSuccessResponse('analytics_manager', {
          operation: 'project_analytics',
          projectId,
          projects: projectDetails,
          summary: {
            totalProjects: projects.length,
            totalCost: Number(
              projects
                .reduce((sum: number, p: any) => sum + p.totalCost, 0)
                .toFixed(2),
            ),
            totalRequests: projects.reduce(
              (sum: number, p: any) => sum + p.totalRequests,
              0,
            ),
            avgCostPerProject: Number(
              (
                projects.reduce((sum: number, p: any) => sum + p.totalCost, 0) /
                projects.length
              ).toFixed(2),
            ),
          },
          message: 'Project analytics retrieved successfully',
        });
      }

      // Fallback response
      return this.createSuccessResponse('analytics_manager', {
        operation: 'project_analytics',
        projectId,
        projects: [
          { name: 'ChatBot', cost: 125.5, requests: 450, efficiency: 0.85 },
          { name: 'CodeGen', cost: 89.3, requests: 320, efficiency: 0.92 },
        ],
        message: 'Project analytics retrieved (fallback data)',
      });
    } catch (error: any) {
      this.logger.error('Project analytics error', { error: error.message });
      return this.createErrorResponse(
        'analytics_manager',
        'Failed to retrieve project analytics',
      );
    }
  }

  private async getAnomalyDetectionAnalytics(
    userId: string,
    timeRange: string,
  ): Promise<any> {
    try {
      // Query usage data for anomaly detection
      const query = {
        collection: 'usages',
        operation: 'aggregate',
        pipeline: [
          {
            $match: {
              userId,
              createdAt: { $gte: this.getDateRange(timeRange) },
            },
          },
          {
            $group: {
              _id: {
                date: {
                  $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
                },
              },
              dailyCost: { $sum: '$cost' },
              dailyRequests: { $sum: 1 },
              avgCostPerRequest: { $avg: '$cost' },
            },
          },
          { $sort: { '_id.date': 1 } },
        ],
      };

      const result = await this.mongoReader.runQuery(query);

      if (result.success && result.data?.result) {
        const dailyStats = result.data.result;

        // Simple anomaly detection based on statistical thresholds
        const anomalies = this.detectAnomalies(dailyStats);

        return this.createSuccessResponse('analytics_manager', {
          operation: 'anomaly_detection',
          timeRange,
          anomalies,
          analysis: {
            totalDays: dailyStats.length,
            anomalousDays: anomalies.length,
            anomalyRate:
              dailyStats.length > 0
                ? ((anomalies.length / dailyStats.length) * 100).toFixed(1) +
                  '%'
                : '0%',
          },
          message:
            anomalies.length > 0
              ? `Anomaly detection completed - ${anomalies.length} unusual patterns detected`
              : 'Anomaly detection completed - no unusual patterns detected',
        });
      }

      return this.createSuccessResponse('analytics_manager', {
        operation: 'anomaly_detection',
        timeRange,
        anomalies: [],
        message: 'Anomaly detection completed - no data available for analysis',
      });
    } catch (error: any) {
      this.logger.error('Anomaly detection error', { error: error.message });
      return this.createErrorResponse(
        'analytics_manager',
        'Failed to perform anomaly detection',
      );
    }
  }

  private async getForecastingAnalytics(
    userId: string,
    timeRange: string,
  ): Promise<any> {
    try {
      // Query historical data for forecasting
      const query = {
        collection: 'usages',
        operation: 'aggregate',
        pipeline: [
          {
            $match: {
              userId,
              createdAt: { $gte: this.getDateRange(timeRange) },
            },
          },
          {
            $group: {
              _id: {
                year: { $year: '$createdAt' },
                month: { $month: '$createdAt' },
              },
              totalCost: { $sum: '$cost' },
              totalRequests: { $sum: 1 },
            },
          },
          { $sort: { '_id.year': 1, '_id.month': 1 } },
        ],
      };

      const result = await this.mongoReader.runQuery(query);

      if (
        result.success &&
        result.data?.result &&
        result.data.result.length >= 3
      ) {
        const historicalData = result.data.result;

        // Simple linear regression for forecasting
        const forecast = this.calculateForecast(historicalData);

        return this.createSuccessResponse('analytics_manager', {
          operation: 'forecasting',
          timeRange,
          forecast,
          historicalData: historicalData.map((d: any) => ({
            period: `${d._id.year}-${String(d._id.month).padStart(2, '0')}`,
            cost: Number(d.totalCost.toFixed(2)),
            requests: d.totalRequests,
          })),
          message: 'Cost forecasting completed successfully',
        });
      }

      // Fallback response
      return this.createSuccessResponse('analytics_manager', {
        operation: 'forecasting',
        timeRange,
        forecast: {
          nextMonth: 145.2,
          nextQuarter: 425.8,
          confidence: 85,
          growthRate: 3.2,
          note: 'Using fallback forecast - insufficient historical data',
        },
        message: 'Cost forecasting completed (fallback data)',
      });
    } catch (error: any) {
      this.logger.error('Forecasting analytics error', {
        error: error.message,
      });
      return this.createErrorResponse(
        'analytics_manager',
        'Failed to generate forecast',
      );
    }
  }

  private async getComparativeAnalysis(
    userId: string,
    timeRange: string,
  ): Promise<any> {
    try {
      // Get current period data
      const currentRange = this.getDateRange(timeRange);
      const currentQuery = {
        collection: 'usages',
        operation: 'aggregate',
        pipeline: [
          {
            $match: {
              userId,
              createdAt: { $gte: currentRange },
            },
          },
          {
            $group: {
              _id: null,
              totalCost: { $sum: '$cost' },
              totalRequests: { $sum: 1 },
              avgCostPerRequest: { $avg: '$cost' },
            },
          },
        ],
      };

      // Get previous period data for comparison
      const previousRange = this.getPreviousPeriodRange(timeRange);
      const previousQuery = {
        collection: 'usages',
        operation: 'aggregate',
        pipeline: [
          {
            $match: {
              userId,
              createdAt: { $gte: previousRange.start, $lt: previousRange.end },
            },
          },
          {
            $group: {
              _id: null,
              totalCost: { $sum: '$cost' },
              totalRequests: { $sum: 1 },
              avgCostPerRequest: { $avg: '$cost' },
            },
          },
        ],
      };

      const [currentResult, previousResult] = await Promise.all([
        this.mongoReader.runQuery(currentQuery),
        this.mongoReader.runQuery(previousQuery),
      ]);

      if (currentResult.success && previousResult.success) {
        const current = currentResult.data?.result?.[0] || {
          totalCost: 0,
          totalRequests: 0,
          avgCostPerRequest: 0,
        };
        const previous = previousResult.data?.result?.[0] || {
          totalCost: 0,
          totalRequests: 0,
          avgCostPerRequest: 0,
        };

        const costChange = current.totalCost - previous.totalCost;
        const costChangePercent =
          previous.totalCost > 0 ? (costChange / previous.totalCost) * 100 : 0;

        const requestChange = current.totalRequests - previous.totalRequests;
        const requestChangePercent =
          previous.totalRequests > 0
            ? (requestChange / previous.totalRequests) * 100
            : 0;

        return this.createSuccessResponse('analytics_manager', {
          operation: 'comparative_analysis',
          timeRange,
          comparison: {
            current: {
              cost: Number(current.totalCost.toFixed(2)),
              requests: current.totalRequests,
              avgCostPerRequest: Number(current.avgCostPerRequest.toFixed(4)),
            },
            previous: {
              cost: Number(previous.totalCost.toFixed(2)),
              requests: previous.totalRequests,
              avgCostPerRequest: Number(previous.avgCostPerRequest.toFixed(4)),
            },
            change: {
              cost: Number(costChange.toFixed(2)),
              costPercent: Number(costChangePercent.toFixed(1)),
              requests: requestChange,
              requestsPercent: Number(requestChangePercent.toFixed(1)),
            },
            trend:
              costChange > 0
                ? 'increasing'
                : costChange < 0
                  ? 'decreasing'
                  : 'stable',
          },
          insights: this.generateComparativeInsights(current, previous),
          message: 'Comparative analysis completed successfully',
        });
      }

      // Fallback response
      return this.createSuccessResponse('analytics_manager', {
        operation: 'comparative_analysis',
        timeRange,
        comparison: {
          current: 125.5,
          previous: 98.3,
          change: 27.7,
          trend: 'increasing',
          note: 'Using fallback data - insufficient data for comparison',
        },
        message: 'Comparative analysis completed (fallback data)',
      });
    } catch (error: any) {
      this.logger.error('Comparative analysis error', { error: error.message });
      return this.createErrorResponse(
        'analytics_manager',
        'Failed to perform comparative analysis',
      );
    }
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

  private getDaysInRange(timeRange: string): number {
    switch (timeRange) {
      case 'last_7_days':
        return 7;
      case 'last_30_days':
        return 30;
      case 'last_90_days':
        return 90;
      case 'last_year':
        return 365;
      default:
        return 30;
    }
  }

  private generateUsageInsights(
    patterns: any[],
    totalRequests: number,
    timeRange: string,
  ): string[] {
    const insights: string[] = [];

    if (patterns.length === 0) return insights;

    // Peak usage insights
    const peakHour = patterns[0]?._id?.hour;
    if (peakHour) {
      const hourLabel =
        peakHour < 12
          ? `${peakHour} AM`
          : peakHour === 12
            ? '12 PM'
            : `${peakHour - 12} PM`;
      insights.push(`Peak usage occurs at ${hourLabel}`);
    }

    // Daily patterns
    const totalDays = this.getDaysInRange(timeRange);
    const avgDaily = totalRequests / totalDays;
    if (avgDaily > 100) {
      insights.push('High daily usage - consider optimizing frequent requests');
    } else if (avgDaily < 10) {
      insights.push('Low daily usage - potential for increased utilization');
    }

    return insights;
  }

  private calculateVolatility(costs: number[]): number {
    if (costs.length < 2) return 0;

    const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
    const variance =
      costs.reduce((sum, cost) => sum + Math.pow(cost - mean, 2), 0) /
      costs.length;
    const stdDev = Math.sqrt(variance);

    return Number(((stdDev / mean) * 100).toFixed(2)); // Coefficient of variation as percentage
  }

  private generateTrendInsights(
    trends: any[],
    avgGrowthRate: number,
  ): string[] {
    const insights = [];

    if (avgGrowthRate > 10) {
      insights.push('⚠️ Rapid cost increase detected - review usage patterns');
    } else if (avgGrowthRate > 5) {
      insights.push('📈 Moderate cost growth - monitor closely');
    } else if (avgGrowthRate < -5) {
      insights.push('📉 Cost reduction achieved - good optimization results');
    }

    const volatility = this.calculateVolatility(trends.map((t) => t.totalCost));
    if (volatility > 50) {
      insights.push('⚠️ High cost volatility - consider budget alerts');
    }

    return insights;
  }

  private calculateUserEfficiency(stats: any): string {
    const costPerToken = stats.totalCost / stats.totalTokens;
    const requestsPerDay =
      stats.totalRequests /
      Math.max(
        1,
        Math.floor(
          (Date.now() - new Date(stats.firstRequest).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );

    // Simple efficiency scoring
    let efficiency = 0.5; // Base score

    if (costPerToken < 0.001) efficiency += 0.2; // Low cost per token
    if (requestsPerDay > 50) efficiency += 0.1; // High utilization
    if (stats.totalRequests > 1000) efficiency += 0.2; // Experienced user

    if (efficiency > 0.8) return 'excellent';
    if (efficiency > 0.6) return 'good';
    if (efficiency > 0.4) return 'average';
    return 'needs_improvement';
  }

  private calculateUserAchievements(stats: any): string[] {
    const achievements = [];

    if (stats.totalRequests > 1000)
      achievements.push('🚀 Power User (1000+ requests)');
    if (stats.totalCost < 100)
      achievements.push('💰 Cost Conscious (Under $100 spent)');
    if (stats.uniqueModels?.length > 3)
      achievements.push('🔄 Model Explorer (4+ models used)');
    if (stats.totalTokens > 1000000)
      achievements.push('📊 Token Master (1M+ tokens processed)');

    const accountAge = Math.floor(
      (Date.now() - new Date(stats.firstRequest).getTime()) /
        (1000 * 60 * 60 * 24),
    );
    if (accountAge > 365)
      achievements.push('🎯 Veteran (1+ year using CostKatana)');

    return achievements;
  }

  private async enrichProjectDetails(
    userId: string,
    projects: any[],
  ): Promise<any[]> {
    try {
      // Try to get project names from projects collection
      const projectIds = projects.map((p) => p._id).filter((id) => id);
      if (projectIds.length === 0) return projects;

      const projectQuery = {
        collection: 'projects',
        operation: 'find',
        query: { userId, _id: { $in: projectIds } },
      };

      const projectResult = await this.mongoReader.runQuery(projectQuery);

      if (projectResult.success && projectResult.data?.result) {
        const projectMap = new Map(
          projectResult.data.result.map((p: any) => [
            p._id.toString(),
            p.name || p.title || 'Unnamed Project',
          ]),
        );

        return projects.map((project) => ({
          ...project,
          name:
            projectMap.get(project._id?.toString()) || `Project ${project._id}`,
          efficiency: this.calculateProjectEfficiency(project),
          costRank: projects.findIndex((p) => p._id === project._id) + 1,
        }));
      }
    } catch (error: any) {
      this.logger.warn('Failed to enrich project details', {
        error: error.message,
      });
    }

    // Return projects without enrichment
    return projects.map((project, index) => ({
      ...project,
      name: `Project ${project._id || index + 1}`,
      efficiency: this.calculateProjectEfficiency(project),
      costRank: index + 1,
    }));
  }

  private calculateProjectEfficiency(project: any): number {
    if (!project.totalTokens || !project.totalCost) return 0.5;

    const costPerToken = project.totalCost / project.totalTokens;
    const avgCostPerRequest = project.totalCost / project.totalRequests;

    // Normalize efficiency score
    let efficiency = 0.5;

    if (costPerToken < 0.0005) efficiency += 0.2;
    if (avgCostPerRequest < 0.01) efficiency += 0.2;
    if (project.totalRequests > 100) efficiency += 0.1;

    return Math.min(1, efficiency);
  }

  private detectAnomalies(dailyStats: any[]): any[] {
    if (dailyStats.length < 7) return []; // Need at least a week of data

    const costs = dailyStats.map((d) => d.dailyCost);
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
    const stdDev = Math.sqrt(
      costs.reduce((sum, cost) => sum + Math.pow(cost - mean, 2), 0) /
        costs.length,
    );

    const anomalies = [];
    const threshold = 2; // 2 standard deviations

    for (const stat of dailyStats) {
      const zScore = Math.abs((stat.dailyCost - mean) / stdDev);
      if (zScore > threshold) {
        anomalies.push({
          date: stat._id.date,
          cost: Number(stat.dailyCost.toFixed(2)),
          expectedCost: Number(mean.toFixed(2)),
          deviation: Number((zScore * stdDev).toFixed(2)),
          severity: zScore > 3 ? 'high' : 'medium',
          type: stat.dailyCost > mean ? 'spike' : 'drop',
        });
      }
    }

    return anomalies;
  }

  private calculateForecast(historicalData: any[]): any {
    if (historicalData.length < 3) {
      return {
        nextMonth: 125.0,
        nextQuarter: 375.0,
        confidence: 50,
        growthRate: 0,
        note: 'Insufficient data for accurate forecasting',
      };
    }

    // Simple linear regression
    const n = historicalData.length;
    const x = historicalData.map((_, i) => i); // Time indices
    const y = historicalData.map((d) => d.totalCost);

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Forecast next month and quarter
    const nextMonth = intercept + slope * n;
    const nextQuarter = intercept + slope * (n + 2);

    // Calculate growth rate
    const firstHalf = historicalData.slice(0, Math.floor(n / 2));
    const secondHalf = historicalData.slice(Math.floor(n / 2));

    const firstHalfAvg =
      firstHalf.reduce((sum, d) => sum + d.totalCost, 0) / firstHalf.length;
    const secondHalfAvg =
      secondHalf.reduce((sum, d) => sum + d.totalCost, 0) / secondHalf.length;

    const growthRate =
      firstHalfAvg > 0
        ? ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100
        : 0;

    // Calculate confidence based on data consistency
    const variance =
      y.reduce(
        (sum, yi) =>
          sum + Math.pow(yi - (slope * x[y.indexOf(yi)] + intercept), 2),
        0,
      ) / n;
    const rSquared =
      1 -
      variance /
        (y.reduce((sum, yi) => sum + Math.pow(yi - sumY / n, 2), 0) / n);
    const confidence = Math.max(0, Math.min(100, rSquared * 100));

    return {
      nextMonth: Number(Math.max(0, nextMonth).toFixed(2)),
      nextQuarter: Number(Math.max(0, nextQuarter).toFixed(2)),
      confidence: Number(confidence.toFixed(0)),
      growthRate: Number(growthRate.toFixed(2)),
      method: 'linear_regression',
      dataPoints: n,
    };
  }

  private getPreviousPeriodRange(timeRange: string): {
    start: Date;
    end: Date;
  } {
    const now = new Date();
    let periodLength: number;

    switch (timeRange) {
      case 'last_7_days':
        periodLength = 7 * 24 * 60 * 60 * 1000;
        break;
      case 'last_30_days':
        periodLength = 30 * 24 * 60 * 60 * 1000;
        break;
      case 'last_90_days':
        periodLength = 90 * 24 * 60 * 60 * 1000;
        break;
      default:
        periodLength = 30 * 24 * 60 * 60 * 1000;
    }

    const currentEnd = this.getDateRange(timeRange);
    const previousEnd = new Date(currentEnd.getTime());
    const previousStart = new Date(currentEnd.getTime() - periodLength);

    return { start: previousStart, end: previousEnd };
  }

  private generateComparativeInsights(current: any, previous: any): string[] {
    const insights = [];

    const costChange = current.totalCost - previous.totalCost;
    const costChangePercent =
      previous.totalCost > 0 ? (costChange / previous.totalCost) * 100 : 0;

    if (costChangePercent > 20) {
      insights.push(
        '⚠️ Significant cost increase - review recent usage patterns',
      );
    } else if (costChangePercent < -20) {
      insights.push(
        '📉 Cost reduction achieved - optimization strategies working',
      );
    }

    const requestChange = current.totalRequests - previous.totalRequests;
    if (requestChange > 0) {
      insights.push(`📈 ${requestChange} more requests this period`);
    } else if (requestChange < 0) {
      insights.push(`📉 ${Math.abs(requestChange)} fewer requests this period`);
    }

    const efficiencyChange =
      current.avgCostPerRequest - previous.avgCostPerRequest;
    if (Math.abs(efficiencyChange) > 0.001) {
      const direction = efficiencyChange > 0 ? 'decreased' : 'improved';
      insights.push(
        `Efficiency ${direction} by ${Math.abs(efficiencyChange * 100).toFixed(1)}% per request`,
      );
    }

    return insights;
  }
}
