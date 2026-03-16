import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Usage } from '../../schemas/core/usage.schema';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';

/** Aggregation result shape for usage status facet */
interface MonthlyUsageItem {
  model: string;
  cost: number;
  totalTokens: number;
  createdAt: Date;
}

interface DailyUsageItem {
  model: string;
  createdAt: Date;
}

export interface UsageStatusData {
  current_usage: {
    today: {
      total_requests: number;
      percentage_of_limit: number;
      estimated_limit: number;
    };
    this_month: {
      total_requests: number;
      gpt4_requests: number;
      gpt35_requests: number;
      total_cost: number;
      percentage_of_limit: number;
      estimated_limit: number;
    };
  };
  patterns: {
    average_tokens_per_request: number;
    preferred_model: string;
    daily_average: number;
  };
  predictions: {
    projected_monthly_requests: number;
    projected_monthly_cost: number;
    days_until_limit: number | null;
  };
  detected_plan: {
    name: string;
    confidence: number;
    estimated_monthly_cost: number;
  };
  warnings: Array<{
    type: string;
    severity: string;
    message: string;
    suggestion: string;
  }>;
  optimization_opportunities: Array<{
    type: string;
    message: string;
    potential_savings?: string;
    potential_benefit?: string;
  }>;
}

export interface RecommendationItem {
  type: string;
  priority: string;
  title: string;
  description: string;
  action: string;
  potential_benefit: string;
  url: string;
}

@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);
  private readonly dateRanges = new Map<string, { start: Date; end: Date }>();

  constructor(
    @InjectModel(Usage.name)
    private readonly usageModel: Model<Usage>,
    private readonly configService: ConfigService,
    private readonly businessEventLogging: BusinessEventLoggingService,
  ) {}

  /**
   * Trigger intelligent monitoring for a user (log event and return ack).
   */
  async triggerUserMonitoring(userId: string): Promise<{
    success: true;
    message: string;
    data: { userId: string; timestamp: string; message: string };
  }> {
    const startTime = Date.now();
    this.businessEventLogging.logBusiness({
      event: 'user_monitoring_triggered',
      category: 'monitoring_operations',
      value: Date.now() - startTime,
      metadata: { userId },
    });
    return {
      success: true,
      message: 'Intelligent monitoring triggered successfully',
      data: {
        userId,
        timestamp: new Date().toISOString(),
        message:
          'Your usage patterns have been analyzed and recommendations will be sent if applicable.',
      },
    };
  }

  /**
   * Get user usage status and predictions (ChatGPT-style limits and recommendations).
   */
  async getUserUsageStatus(userId: string): Promise<{
    success: true;
    data: UsageStatusData;
  }> {
    const startTime = Date.now();
    const { startOfMonth, startOfDay } = this.getOptimizedDateRanges();

    const usageResults = await this.usageModel.aggregate([
      {
        $match: {
          userId: new Types.ObjectId(userId),
          service: 'openai',
          'metadata.source': 'chatgpt-custom-gpt',
        },
      },
      {
        $facet: {
          monthlyUsage: [
            { $match: { createdAt: { $gte: startOfMonth } } },
            { $project: { model: 1, cost: 1, totalTokens: 1, createdAt: 1 } },
          ],
          dailyUsage: [
            { $match: { createdAt: { $gte: startOfDay } } },
            { $project: { model: 1, createdAt: 1 } },
          ],
        },
      },
    ]);

    const monthlyUsage: MonthlyUsageItem[] =
      usageResults[0]?.monthlyUsage ?? [];
    const dailyUsage: DailyUsageItem[] = usageResults[0]?.dailyUsage ?? [];

    const monthlyGPT4Count = monthlyUsage.filter((u) =>
      u.model.includes('gpt-4'),
    ).length;
    const monthlyGPT35Count = monthlyUsage.filter((u) =>
      u.model.includes('gpt-3.5'),
    ).length;
    const totalMonthlyCost = monthlyUsage.reduce((sum, u) => sum + u.cost, 0);
    const averageTokensPerRequest =
      monthlyUsage.length > 0
        ? monthlyUsage.reduce((sum, u) => sum + u.totalTokens, 0) /
          monthlyUsage.length
        : 0;

    let detectedPlan = 'free';
    let estimatedLimits = { monthly: 15, daily: 15 };

    if (monthlyGPT4Count > 100 || dailyUsage.length > 200) {
      detectedPlan = 'enterprise';
      estimatedLimits = { monthly: -1, daily: -1 };
    } else if (monthlyGPT4Count > 50 || dailyUsage.length > 100) {
      detectedPlan = 'team';
      estimatedLimits = { monthly: 100, daily: 200 };
    } else if (monthlyGPT4Count > 10 || dailyUsage.length > 25) {
      detectedPlan = 'plus';
      estimatedLimits = { monthly: 50, daily: 100 };
    }

    const monthlyUsagePercentage =
      estimatedLimits.monthly > 0
        ? (monthlyGPT4Count / estimatedLimits.monthly) * 100
        : 0;
    const dailyUsagePercentage =
      estimatedLimits.daily > 0
        ? (dailyUsage.length / estimatedLimits.daily) * 100
        : 0;

    const daysInMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      0,
    ).getDate();
    const currentDay = new Date().getDate();
    const projectedMonthlyUsage =
      estimatedLimits.monthly > 0
        ? Math.ceil((monthlyGPT4Count / currentDay) * daysInMonth)
        : monthlyGPT4Count;

    const warnings: UsageStatusData['warnings'] = [];
    if (monthlyUsagePercentage >= 80) {
      warnings.push({
        type: 'monthly_limit',
        severity: 'high',
        message: `You've used ${monthlyUsagePercentage.toFixed(1)}% of your estimated monthly limit`,
        suggestion:
          'Consider optimizing prompts or switching to GPT-3.5 for simpler tasks',
      });
    }
    if (dailyUsagePercentage >= 90) {
      warnings.push({
        type: 'daily_limit',
        severity: 'urgent',
        message: `You've used ${dailyUsagePercentage.toFixed(1)}% of your estimated daily limit`,
        suggestion:
          "You may hit your daily limit soon. Consider using Cost Katana's direct API access.",
      });
    }
    if (
      projectedMonthlyUsage > estimatedLimits.monthly &&
      estimatedLimits.monthly > 0
    ) {
      warnings.push({
        type: 'projection',
        severity: 'medium',
        message: `At current pace, you'll use ${projectedMonthlyUsage} requests this month (${((projectedMonthlyUsage / estimatedLimits.monthly) * 100).toFixed(1)}% of limit)`,
        suggestion:
          'Consider optimizing your usage patterns to stay within limits',
      });
    }

    const optimization_opportunities: UsageStatusData['optimization_opportunities'] =
      [
        ...(averageTokensPerRequest > 300
          ? [
              {
                type: 'prompt_optimization',
                message: `Your prompts average ${Math.round(averageTokensPerRequest)} tokens. Consider using more concise prompts.`,
                potential_savings:
                  Math.round(averageTokensPerRequest * 0.3) +
                  ' tokens per request',
              },
            ]
          : []),
        ...(monthlyGPT4Count > monthlyGPT35Count && monthlyUsage.length > 20
          ? [
              {
                type: 'model_selection',
                message:
                  'You use GPT-4 frequently. Many tasks could work with GPT-3.5 at 95% lower cost.',
                potential_benefit: 'Up to 95% cost reduction on suitable tasks',
              },
            ]
          : []),
      ];

    const duration = Date.now() - startTime;
    this.businessEventLogging.logBusiness({
      event: 'user_usage_status_retrieved',
      category: 'monitoring_operations',
      value: duration,
      metadata: {
        userId,
        monthlyUsageCount: monthlyUsage.length,
        dailyUsageCount: dailyUsage.length,
        monthlyGPT4Count,
        monthlyGPT35Count,
        totalMonthlyCost,
        averageTokensPerRequest: Math.round(averageTokensPerRequest),
        detectedPlan,
        monthlyUsagePercentage: Math.round(monthlyUsagePercentage * 100) / 100,
        dailyUsagePercentage: Math.round(dailyUsagePercentage * 100) / 100,
        projectedMonthlyUsage,
        warningsCount: warnings.length,
        hasWarnings: warnings.length > 0,
      },
    });

    const data: UsageStatusData = {
      current_usage: {
        today: {
          total_requests: dailyUsage.length,
          percentage_of_limit: dailyUsagePercentage,
          estimated_limit: estimatedLimits.daily,
        },
        this_month: {
          total_requests: monthlyUsage.length,
          gpt4_requests: monthlyGPT4Count,
          gpt35_requests: monthlyGPT35Count,
          total_cost: totalMonthlyCost,
          percentage_of_limit: monthlyUsagePercentage,
          estimated_limit: estimatedLimits.monthly,
        },
      },
      patterns: {
        average_tokens_per_request: Math.round(averageTokensPerRequest),
        preferred_model:
          monthlyGPT4Count > monthlyGPT35Count ? 'GPT-4' : 'GPT-3.5',
        daily_average: Math.round(monthlyUsage.length / currentDay),
      },
      predictions: {
        projected_monthly_requests: projectedMonthlyUsage,
        projected_monthly_cost: (totalMonthlyCost / currentDay) * daysInMonth,
        days_until_limit:
          estimatedLimits.monthly > 0 && monthlyGPT4Count > 0
            ? Math.ceil(
                (estimatedLimits.monthly - monthlyGPT4Count) /
                  (monthlyGPT4Count / currentDay),
              )
            : null,
      },
      detected_plan: {
        name: detectedPlan,
        confidence: detectedPlan === 'free' ? 0.7 : 0.85,
        estimated_monthly_cost:
          detectedPlan === 'free'
            ? 0
            : detectedPlan === 'plus'
              ? 20
              : detectedPlan === 'team'
                ? 25
                : 60,
      },
      warnings,
      optimization_opportunities,
    };

    return { success: true, data };
  }

  /**
   * Get smart recommendations for the user based on recent usage.
   */
  async getSmartRecommendations(userId: string): Promise<{
    success: true;
    data: {
      recommendations: RecommendationItem[];
      analysis_based_on?: string;
      message?: string;
      last_updated: string;
    };
  }> {
    const startTime = Date.now();
    const { startOfMonth } = this.getOptimizedDateRanges();
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL')?.replace(/\/$/, '') ||
      'http://localhost:3000';

    const recentUsage = await this.usageModel
      .find({
        userId: new Types.ObjectId(userId),
        service: 'openai',
        createdAt: { $gte: startOfMonth },
        'metadata.source': 'chatgpt-custom-gpt',
      })
      .select('model totalTokens promptTokens createdAt')
      .limit(50)
      .sort({ createdAt: -1 })
      .lean();

    const recommendations: RecommendationItem[] = [];

    if (recentUsage.length === 0) {
      const duration = Date.now() - startTime;
      this.businessEventLogging.logBusiness({
        event: 'smart_recommendations_retrieved',
        category: 'monitoring_operations',
        value: duration,
        metadata: {
          userId,
          recentUsageCount: 0,
          recommendationsCount: 0,
          hasRecommendations: false,
        },
      });
      return {
        success: true,
        data: {
          recommendations: [],
          message:
            'Start using ChatGPT with Cost Katana to get personalized recommendations!',
          last_updated: new Date().toISOString(),
        },
      };
    }

    const avgTokens =
      recentUsage.reduce((sum, u) => sum + (u.totalTokens ?? 0), 0) /
      recentUsage.length;
    const gpt4Usage = recentUsage.filter((u) =>
      String(u.model).includes('gpt-4'),
    ).length;
    const longPrompts = recentUsage.filter(
      (u) => (u.promptTokens ?? 0) > 400,
    ).length;

    if (avgTokens > 350) {
      recommendations.push({
        type: 'prompt_optimization',
        priority: 'high',
        title: 'Optimize Your Prompt Length',
        description: `Your prompts average ${Math.round(avgTokens)} tokens. Shorter, more focused prompts often get better results.`,
        action: "Try Cost Katana's Prompt Optimizer",
        potential_benefit: 'Save 30-50% on tokens',
        url: `${frontendUrl}/prompt-optimizer?avg_tokens=${Math.round(avgTokens)}`,
      });
    }
    if (gpt4Usage / recentUsage.length > 0.6) {
      recommendations.push({
        type: 'model_selection',
        priority: 'high',
        title: 'Smart Model Selection',
        description: `You use GPT-4 for ${Math.round((gpt4Usage / recentUsage.length) * 100)}% of requests. Many could work with GPT-3.5.`,
        action: 'Use Smart Model Selector',
        potential_benefit: 'Save up to 95% on suitable tasks',
        url: `${frontendUrl}/model-selector?current_usage=${gpt4Usage}`,
      });
    }
    if (longPrompts > recentUsage.length * 0.3) {
      recommendations.push({
        type: 'prompt_structure',
        priority: 'medium',
        title: 'Improve Prompt Structure',
        description: `${Math.round((longPrompts / recentUsage.length) * 100)}% of your prompts are very long. Consider breaking complex requests into steps.`,
        action: 'Learn prompt structuring techniques',
        potential_benefit: 'Better results with fewer tokens',
        url: `${frontendUrl}/guides/prompt-structuring`,
      });
    }
    recommendations.push({
      type: 'analytics',
      priority: 'low',
      title: 'Track Your Progress',
      description:
        'Monitor your optimization progress with detailed analytics and insights.',
      action: 'View Analytics Dashboard',
      potential_benefit: 'Understand your AI usage patterns',
      url: `${frontendUrl}/analytics?source=recommendations`,
    });

    const duration = Date.now() - startTime;
    this.businessEventLogging.logBusiness({
      event: 'smart_recommendations_retrieved',
      category: 'monitoring_operations',
      value: duration,
      metadata: {
        userId,
        recentUsageCount: recentUsage.length,
        recommendationsCount: recommendations.length,
        hasRecommendations: recommendations.length > 0,
        avgTokens: Math.round(avgTokens),
        gpt4Usage,
        gpt4UsagePercentage: Math.round((gpt4Usage / recentUsage.length) * 100),
        longPrompts,
        longPromptsPercentage: Math.round(
          (longPrompts / recentUsage.length) * 100,
        ),
      },
    });

    return {
      success: true,
      data: {
        recommendations,
        analysis_based_on: `${recentUsage.length} recent ChatGPT interactions`,
        last_updated: new Date().toISOString(),
      },
    };
  }

  /**
   * Trigger daily monitoring for all users (admin only). Logs the trigger.
   */
  async triggerDailyMonitoring(
    adminUserId: string,
    adminRole: string,
  ): Promise<{
    success: true;
    message: string;
    timestamp: string;
  }> {
    const startTime = Date.now();
    this.logger.log(
      `Daily monitoring trigger initiated by user=${adminUserId} role=${adminRole}`,
    );
    const duration = Date.now() - startTime;
    this.businessEventLogging.logBusiness({
      event: 'daily_monitoring_triggered',
      category: 'monitoring_operations',
      value: duration,
      metadata: { userId: adminUserId, userRole: adminRole },
    });
    return {
      success: true,
      message: 'Daily monitoring triggered for all users',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Memoized date ranges (start of month, start of day) keyed by today's date string.
   */
  private getOptimizedDateRanges(): {
    startOfMonth: Date;
    startOfDay: Date;
  } {
    const today = new Date().toDateString();
    if (!this.dateRanges.has(today)) {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      this.dateRanges.set(today, { start: startOfMonth, end: startOfDay });

      if (this.dateRanges.size > 1) {
        const keysToDelete = Array.from(this.dateRanges.keys()).filter(
          (key) => key !== today,
        );
        keysToDelete.forEach((key) => this.dateRanges.delete(key));
      }
    }
    const ranges = this.dateRanges.get(today)!;
    return { startOfMonth: ranges.start, startOfDay: ranges.end };
  }
}
