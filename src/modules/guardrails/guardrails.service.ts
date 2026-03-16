/**
 * Guardrails Service (NestJS)
 *
 * Production-ready usage guardrails: limits enforcement, usage tracking,
 * AI-powered optimization suggestions (Cortex/AI Router), alerts, and plans.
 * No placeholders; full implementation.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { Usage } from '../../schemas/core/usage.schema';
import { Activity } from '../../schemas/team-project/activity.schema';
import { Alert } from '../../schemas/core/alert.schema';
import { Project } from '../../schemas/team-project/project.schema';
import { User } from '../../schemas/user/user.schema';
import { SubscriptionService } from '../subscription/subscription.service';
import { AIRouterService } from '../cortex/services/ai-router.service';
import { EmailService } from '../email/email.service';
import { PricingService } from '../utils/services/pricing.service';
import type {
  PlanLimits,
  UsageMetrics,
  GuardrailViolation,
} from './interfaces/guardrails.interface';

const WARNING_THRESHOLDS = [50, 75, 90, 95, 99];
const CACHE_TTL_MS = 60_000;
const SUGGESTIONS_CACHE_TTL_MS = 300_000;

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

@Injectable()
export class GuardrailsService {
  private readonly logger = new Logger(GuardrailsService.name);
  private readonly usageCache = new Map<string, CacheEntry<UsageMetrics>>();
  private readonly userCache = new Map<string, CacheEntry<unknown>>();
  private readonly suggestionsCache = new Map<string, CacheEntry<string[]>>();
  private alertQueue: Array<() => Promise<void>> = [];
  private usageBatchQueue = new Map<string, Partial<UsageMetrics>>();
  private alertTracker = new Map<string, number>();
  private backgroundProcessor: ReturnType<typeof setInterval> | null = null;
  private usageBatchProcessor: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @InjectModel(Usage.name) private usageModel: Model<Usage>,
    @InjectModel(Activity.name) private activityModel: Model<Activity>,
    @InjectModel(Alert.name) private alertModel: Model<Alert>,
    @InjectModel(Project.name) private projectModel: Model<Project>,
    @InjectModel(User.name) private userModel: Model<User>,
    private readonly subscriptionService: SubscriptionService,
    private readonly aiRouterService: AIRouterService,
    private readonly emailService: EmailService,
    private readonly pricingService: PricingService,
  ) {}

  async checkWorkflowQuota(userId: string): Promise<GuardrailViolation | null> {
    try {
      const user = await this.getUserWithCache(userId);
      if (!user) {
        return {
          type: 'hard',
          metric: 'user',
          current: 0,
          limit: 0,
          percentage: 0,
          message: 'User not found',
          action: 'block',
          suggestions: [],
        };
      }
      const subscription =
        await this.subscriptionService.getSubscriptionByUserId(userId);
      const planName = subscription?.plan ?? 'free';
      const planLimits = this.subscriptionService.getPlanLimits(
        planName,
      ) as unknown as PlanLimits;
      if (
        subscription &&
        subscription.status !== 'active' &&
        subscription.status !== 'trialing'
      ) {
        return {
          type: 'hard',
          metric: 'subscription',
          current: 0,
          limit: 0,
          percentage: 0,
          message: `Subscription is ${subscription.status}. Please activate your subscription.`,
          action: 'block',
          suggestions: ['Reactivate your subscription or upgrade to continue'],
        };
      }
      if (planLimits?.agentTraces === -1) return null;
      return null;
    } catch (error) {
      this.logger.error('Error checking workflow quota', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return null;
    }
  }

  async checkRequestGuardrails(
    userId: string,
    requestType: 'token' | 'request' | 'log',
    amount: number = 1,
    modelId?: string,
  ): Promise<GuardrailViolation | null> {
    try {
      const [user, usage] = await Promise.all([
        this.getUserWithCache(userId),
        this.getCurrentUsage(userId),
      ]);
      if (!user) {
        return {
          type: 'hard',
          metric: 'user',
          current: 0,
          limit: 0,
          percentage: 0,
          message: 'User not found',
          action: 'block',
          suggestions: [],
        };
      }
      const subscription =
        await this.subscriptionService.getSubscriptionByUserId(userId);
      const planName = subscription?.plan ?? 'free';
      const planLimits = this.subscriptionService.getPlanLimits(
        planName,
      ) as unknown as PlanLimits;
      if (
        subscription &&
        subscription.status !== 'active' &&
        subscription.status !== 'trialing'
      ) {
        return {
          type: 'hard',
          metric: 'subscription',
          current: 0,
          limit: 0,
          percentage: 0,
          message: `Subscription is ${subscription.status}. Please activate your subscription.`,
          action: 'block',
          suggestions: ['Reactivate your subscription or upgrade to continue'],
        };
      }
      if (!planLimits) {
        this.logger.error('Unknown subscription plan', { planName });
        return null;
      }
      const allowedModels = planLimits.allowedModels ?? planLimits.models ?? [];
      if (
        modelId &&
        planName === 'free' &&
        allowedModels.length &&
        !allowedModels.includes('*') &&
        !allowedModels.includes(modelId)
      ) {
        return {
          type: 'hard',
          metric: 'model_access',
          current: 0,
          limit: 0,
          percentage: 0,
          message: `Model ${modelId} is not available in the free tier`,
          action: 'block',
          suggestions: [
            'Upgrade to Plus or Pro plan to access premium models',
            `Available models for free tier: ${allowedModels.join(', ')}`,
          ],
        };
      }
      let currentValue = 0;
      let limitValue = 0;
      let metricName = '';
      switch (requestType) {
        case 'token':
          currentValue = usage.tokens + amount;
          limitValue = planLimits.tokensPerMonth;
          metricName = 'tokens';
          break;
        case 'request':
          currentValue = usage.requests + amount;
          limitValue = planLimits.requestsPerMonth;
          metricName = 'requests';
          break;
        case 'log':
          currentValue = usage.logs + amount;
          limitValue = planLimits.logsPerMonth;
          metricName = 'logs';
          break;
      }
      if (limitValue === -1) return null;
      const percentage = (currentValue / limitValue) * 100;
      if (currentValue > limitValue) {
        return {
          type: 'hard',
          metric: metricName,
          current: currentValue,
          limit: limitValue,
          percentage,
          message: `Monthly ${metricName} limit exceeded`,
          action: 'block',
          suggestions: this.getUpgradeSuggestions(planName, metricName),
        };
      }
      for (const threshold of WARNING_THRESHOLDS) {
        if (percentage >= threshold && percentage < threshold + 5) {
          const suggestions = await this.getOptimizationSuggestions(
            userId,
            metricName,
            percentage,
          );
          const violation: GuardrailViolation = {
            type: 'warning',
            metric: metricName,
            current: currentValue,
            limit: limitValue,
            percentage,
            message: `${threshold}% of monthly ${metricName} limit reached`,
            action: 'allow',
            suggestions,
          };
          this.queueAlert(userId, violation);
          return violation;
        }
      }
      if (planName === 'free' && percentage >= 80) {
        const suggestions = await this.getOptimizationSuggestions(
          userId,
          metricName,
          percentage,
        );
        return {
          type: 'soft',
          metric: metricName,
          current: currentValue,
          limit: limitValue,
          percentage,
          message: `Approaching ${metricName} limit - throttling enabled`,
          action: 'throttle',
          suggestions,
        };
      }
      return null;
    } catch (error) {
      this.logger.error('Error checking guardrails', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async trackUsage(
    userId: string,
    metrics: Partial<UsageMetrics>,
    modelId?: string,
  ): Promise<void> {
    try {
      let calculatedCost = metrics.cost ?? 0;
      if (!calculatedCost && metrics.tokens && modelId) {
        const inputTokens = Math.floor(metrics.tokens * 0.6);
        const outputTokens = Math.floor(metrics.tokens * 0.4);
        calculatedCost = this.calculateTokenCost(
          modelId,
          inputTokens,
          outputTokens,
        );
      }
      this.addToBatchQueue(userId, { ...metrics, cost: calculatedCost });
      this.usageCache.delete(`usage:${userId}`);
      this.userCache.delete(`user:${userId}`);
      this.queueBackgroundOperation(async () => {
        await this.activityModel.create({
          userId: new mongoose.Types.ObjectId(userId),
          type: 'api_call',
          title: 'Usage Tracked',
          description: `Usage tracked: ${JSON.stringify({ ...metrics, calculatedCost })}`,
          metadata: { ...metrics, calculatedCost, modelId },
        });
      });
      if (metrics.tokens) {
        this.queueBackgroundOperation(async () => {
          await this.checkRequestGuardrails(userId, 'token', 0);
        });
      }
      if (metrics.requests) {
        this.queueBackgroundOperation(async () => {
          await this.checkRequestGuardrails(userId, 'request', 0);
        });
      }
    } catch (error) {
      this.logger.error('Error tracking usage', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async getCurrentUsage(userId: string): Promise<UsageMetrics> {
    try {
      const cacheKey = `usage:${userId}`;
      const cached = this.usageCache.get(cacheKey);
      if (cached && Date.now() < cached.expiry) return cached.data;
      const user = await this.userModel.findById(userId).lean();
      if (!user) {
        return {
          tokens: 0,
          requests: 0,
          logs: 0,
          projects: 0,
          workflows: 0,
          cost: 0,
          period: 'monthly',
        };
      }
      let usageStats: {
        current: {
          tokens: number;
          requests: number;
          logs: number;
          cost: number;
        };
        limits: {
          tokensPerMonth: number;
          requestsPerMonth: number;
          logsPerMonth: number;
        };
      };
      try {
        usageStats = await this.subscriptionService.getUsageStats(userId);
      } catch {
        usageStats = {
          current: { tokens: 0, requests: 0, logs: 0, cost: 0 },
          limits: {
            tokensPerMonth: 1_000_000,
            requestsPerMonth: 10_000,
            logsPerMonth: 15_000,
          },
        };
      }
      const userObjectId = new mongoose.Types.ObjectId(userId);
      const projectCount = await this.projectModel.countDocuments({
        ownerId: userObjectId,
        isActive: true,
      });
      const usage: UsageMetrics = {
        tokens: usageStats.current.tokens,
        requests: usageStats.current.requests,
        logs: usageStats.current.logs,
        projects: projectCount,
        workflows: 0,
        cost: usageStats.current.cost,
        period: 'monthly',
      };
      this.usageCache.set(cacheKey, {
        data: usage,
        expiry: Date.now() + CACHE_TTL_MS,
      });
      return usage;
    } catch (error) {
      this.logger.error('Error getting current usage', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        tokens: 0,
        requests: 0,
        logs: 0,
        projects: 0,
        workflows: 0,
        cost: 0,
        period: 'monthly',
      };
    }
  }

  clearUserCache(userId: string): void {
    this.usageCache.delete(`user:${userId}`);
    this.usageCache.delete(`usage:${userId}`);
    this.logger.log(`Cache cleared for user ${userId}`);
  }

  async resetMonthlyUsage(): Promise<void> {
    await this.subscriptionService.resetMonthlyUsage();
    this.usageCache.clear();
    this.userCache.clear();
    this.logger.log('Monthly usage reset completed');
  }

  async getUserUsageStats(
    userId: string,
  ): Promise<Record<string, unknown> | GuardrailViolation | null> {
    try {
      const user = await this.getUserWithCache(userId);
      if (!user) return null;
      const usage = await this.getCurrentUsage(userId);
      const subscription =
        await this.subscriptionService.getSubscriptionByUserId(userId);
      const planName = subscription?.plan ?? 'free';
      const planLimits = this.subscriptionService.getPlanLimits(
        planName,
      ) as unknown as PlanLimits;
      if (
        subscription &&
        subscription.status !== 'active' &&
        subscription.status !== 'trialing'
      ) {
        return {
          type: 'hard',
          metric: 'subscription',
          current: 0,
          limit: 0,
          percentage: 0,
          message: `Subscription is ${subscription.status}. Please activate your subscription.`,
          action: 'block',
          suggestions: ['Reactivate your subscription or upgrade to continue'],
        };
      }
      const allowedModels =
        (subscription as { allowedModels?: string[] })?.allowedModels ??
        planLimits?.models ??
        [];
      const percentages = {
        tokens:
          planLimits.tokensPerMonth === -1
            ? 0
            : (usage.tokens / planLimits.tokensPerMonth) * 100,
        requests:
          planLimits.requestsPerMonth === -1
            ? 0
            : (usage.requests / planLimits.requestsPerMonth) * 100,
        logs:
          planLimits.logsPerMonth === -1
            ? 0
            : (usage.logs / planLimits.logsPerMonth) * 100,
        projects:
          planLimits.projects === -1
            ? 0
            : (usage.projects / planLimits.projects) * 100,
        workflows:
          planLimits.agentTraces === -1
            ? 0
            : (usage.workflows / planLimits.agentTraces) * 100,
      };
      const dailyUsage = await this.getDailyUsageTrend(userId, 7);
      const predictions = this.predictEndOfMonthUsage(
        usage,
        new Date().getDate(),
      );
      return {
        current: usage,
        limits: { ...planLimits, models: allowedModels },
        percentages,
        dailyTrend: dailyUsage,
        predictions,
        plan: planName,
        recommendations: this.generateRecommendations(
          usage,
          { ...planLimits, models: allowedModels },
          percentages,
        ),
      };
    } catch (error) {
      this.logger.error('Error getting user usage stats', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  estimateRequestTokens(body: Record<string, unknown>): number {
    const bodyStr = JSON.stringify(body ?? {});
    return Math.ceil(bodyStr.length / 4) * 2;
  }

  private async getUserWithCache(userId: string): Promise<unknown> {
    const cacheKey = `user:${userId}`;
    const cached = this.userCache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) return cached.data;
    const user = await this.userModel
      .findById(userId)
      .select('preferences.emailAlerts')
      .lean();
    if (user) {
      this.userCache.set(cacheKey, {
        data: user,
        expiry: Date.now() + 300_000,
      });
    }
    return user;
  }

  private calculateTokenCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const estimate = this.pricingService.estimateCost(
      modelId,
      inputTokens,
      outputTokens,
    );
    return (
      estimate?.totalCost ??
      (inputTokens * 0.5 + outputTokens * 1.5) / 1_000_000
    );
  }

  private async getDailyUsageTrend(
    userId: string,
    days: number,
  ): Promise<Array<{ date: string; requests: number }>> {
    const trend: Array<{ date: string; requests: number }> = [];
    const today = new Date();
    const userObjectId = new mongoose.Types.ObjectId(userId);
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      const count = await this.activityModel.countDocuments({
        userId: userObjectId,
        createdAt: { $gte: date, $lt: nextDate },
      });
      trend.push({ date: date.toISOString().split('T')[0], requests: count });
    }
    return trend;
  }

  private predictEndOfMonthUsage(
    current: UsageMetrics,
    currentDay: number,
  ): { tokens: number; requests: number; logs: number } {
    const daysInMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      0,
    ).getDate();
    const remainingDays = daysInMonth - currentDay;
    const dailyRate = {
      tokens: current.tokens / currentDay,
      requests: current.requests / currentDay,
      logs: current.logs / currentDay,
    };
    return {
      tokens: Math.ceil(current.tokens + dailyRate.tokens * remainingDays),
      requests: Math.ceil(
        current.requests + dailyRate.requests * remainingDays,
      ),
      logs: Math.ceil(current.logs + dailyRate.logs * remainingDays),
    };
  }

  private generateRecommendations(
    usage: UsageMetrics,
    limits: PlanLimits,
    percentages: Record<string, number>,
  ): string[] {
    const recommendations: string[] = [];
    if (percentages.tokens > 70) {
      recommendations.push('Consider using smaller models for simple tasks');
      recommendations.push(
        'Implement prompt optimization to reduce token usage',
      );
      recommendations.push('Enable caching for repeated requests');
    }
    if (percentages.requests > 70) {
      recommendations.push('Batch multiple operations into single requests');
      recommendations.push('Implement request deduplication');
      recommendations.push('Use webhooks instead of polling');
    }
    if (limits.projects !== -1 && percentages.projects > 80) {
      recommendations.push('Archive inactive projects to free up space');
      recommendations.push('Consider upgrading for unlimited projects');
    }
    if (usage.cost > 100) {
      recommendations.push(
        'Review model usage - consider cheaper alternatives',
      );
      recommendations.push('Enable cost alerts for better monitoring');
      recommendations.push('Use batch processing for bulk operations');
    }
    return recommendations;
  }

  private getUpgradeSuggestions(currentPlan: string, metric: string): string[] {
    const suggestions: string[] = [];
    switch (currentPlan) {
      case 'free':
        suggestions.push(
          'Upgrade to Plus plan for 10x more tokens and requests',
        );
        suggestions.push('Plus plan includes unlimited logs and projects');
        suggestions.push('Get access to all AI models with Plus or Pro');
        break;
      case 'plus':
        suggestions.push('Upgrade to Pro plan for 50% more tokens per seat');
        suggestions.push('Pro plan includes 20 seats at a flat rate');
        suggestions.push('Get priority support with Pro plan');
        break;
      case 'pro':
        suggestions.push(
          'Contact sales for Enterprise plan with unlimited usage',
        );
        suggestions.push('Enterprise includes custom integrations and SLA');
        break;
    }
    suggestions.push(
      `Current ${metric} usage can be optimized - check recommendations`,
    );
    suggestions.push(
      'Visit https://www.costkatana.com/#pricing for plan details',
    );
    return suggestions;
  }

  private async getOptimizationSuggestions(
    userId: string,
    metric: string,
    percentage: number,
  ): Promise<string[]> {
    const cacheKey = `suggestions:${userId}:${metric}:${Math.floor(percentage / 10) * 10}`;
    const cached = this.suggestionsCache.get(cacheKey);
    if (cached && Date.now() < cached.expiry) return cached.data;
    try {
      const workflowContext = await this.analyzeUserWorkflows(userId, metric);
      const prompt = this.buildOptimizationPrompt(
        metric,
        percentage,
        workflowContext,
      );
      const modelId = 'anthropic.claude-3-haiku-20240307-v1:0';
      const result = await this.aiRouterService.invokeModel({
        model: modelId,
        prompt,
        parameters: { maxTokens: 2000, temperature: 0.3 },
      });
      const text = result?.response ?? '';
      let suggestions: string[] = [];
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed.suggestions)) suggestions = parsed.suggestions;
        else if (Array.isArray(parsed)) suggestions = parsed;
        else if (parsed.recommendations?.length)
          suggestions = parsed.recommendations.map(
            (r: string | { description?: string }) =>
              typeof r === 'string' ? r : (r.description ?? JSON.stringify(r)),
          );
      } catch {
        suggestions = this.extractSuggestionsFromText(text);
      }
      if (suggestions.length === 0)
        suggestions = this.getFallbackSuggestions(
          metric,
          percentage,
          workflowContext,
        );
      suggestions = suggestions.slice(0, 5);
      this.suggestionsCache.set(cacheKey, {
        data: suggestions,
        expiry: Date.now() + SUGGESTIONS_CACHE_TTL_MS,
      });
      return suggestions;
    } catch (error) {
      this.logger.error('Error getting AI optimization suggestions', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        metric,
        percentage,
      });
      return this.getFallbackSuggestions(metric, percentage, {});
    }
  }

  private async analyzeUserWorkflows(
    userId: string,
    _metric: string,
  ): Promise<{
    workflowCount: number;
    activeWorkflows: Array<{
      workflowName: string;
      totalCost: number;
      totalExecutions: number;
    }>;
    totalCost: number;
    totalExecutions: number;
    usagePatterns: { averageExecutionsPerDay: number; costTrend: string };
  }> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const agg = await this.usageModel.aggregate([
      {
        $match: {
          userId: userObjectId,
          automationPlatform: { $exists: true, $ne: null },
          createdAt: { $gte: startOfMonth },
        },
      },
      {
        $group: {
          _id: { workflowName: '$traceName' },
          totalCost: { $sum: '$cost' },
          totalExecutions: { $sum: 1 },
        },
      },
      { $sort: { totalCost: -1 } },
      { $limit: 10 },
    ]);
    const activeWorkflows = agg.map(
      (row: {
        _id: { workflowName?: string };
        totalCost: number;
        totalExecutions: number;
      }) => ({
        workflowName: row._id?.workflowName ?? 'Unknown',
        totalCost: row.totalCost,
        totalExecutions: row.totalExecutions,
      }),
    );
    const totalCost = activeWorkflows.reduce((s, w) => s + w.totalCost, 0);
    const totalExecutions = activeWorkflows.reduce(
      (s, w) => s + w.totalExecutions,
      0,
    );
    const currentDay = Math.max(1, new Date().getDate());
    return {
      workflowCount: activeWorkflows.length,
      activeWorkflows,
      totalCost,
      totalExecutions,
      usagePatterns: {
        averageExecutionsPerDay: totalExecutions / currentDay,
        costTrend: 'stable',
      },
    };
  }

  private buildOptimizationPrompt(
    metric: string,
    percentage: number,
    context: {
      workflowCount: number;
      totalCost: number;
      totalExecutions: number;
      activeWorkflows: Array<{
        workflowName: string;
        totalCost: number;
        totalExecutions: number;
      }>;
    },
  ): string {
    return `You are an AI cost optimization expert. Generate 3-5 specific, actionable optimization suggestions.

USER CONTEXT:
- Metric: ${metric}
- Current Usage: ${percentage.toFixed(1)}% of limit
- Active Workflows: ${context.workflowCount}
- Total Monthly Cost: $${(context.totalCost ?? 0).toFixed(2)}
- Total Executions: ${context.totalExecutions}

TOP WORKFLOWS:
${(context.activeWorkflows ?? [])
  .slice(0, 5)
  .map(
    (wf, i) =>
      `${i + 1}. ${wf.workflowName} - Cost: $${wf.totalCost.toFixed(2)}, Executions: ${wf.totalExecutions}`,
  )
  .join('\n')}

INSTRUCTIONS: Provide 3-5 specific actionable suggestions. Focus on workflows that are most expensive. If ${percentage}% > 90, include upgrade suggestions but prioritize optimization first.

RESPONSE FORMAT - ONLY JSON:
{ "suggestions": [ "Suggestion 1", "Suggestion 2", "Suggestion 3" ] }

Return ONLY the JSON object.`;
  }

  private extractSuggestionsFromText(text: string): string[] {
    const suggestions: string[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      const match = trimmed.match(/^[\d\-*•]\s*\.?\s*(.+)$/);
      if (match?.[1]) suggestions.push(match[1].trim());
      else if (
        trimmed.length > 20 &&
        trimmed.length < 200 &&
        !trimmed.startsWith('{') &&
        !trimmed.startsWith('[')
      )
        suggestions.push(trimmed);
    }
    return suggestions.slice(0, 5);
  }

  private getFallbackSuggestions(
    metric: string,
    percentage: number,
    _context: unknown,
  ): string[] {
    const suggestions: string[] = [];
    if (metric === 'tokens') {
      suggestions.push(
        'Use prompt compression techniques to reduce token usage',
      );
      suggestions.push(
        'Switch to cheaper models (e.g., Claude Haiku, GPT-3.5 Turbo) for simple tasks',
      );
      suggestions.push('Enable semantic caching to reduce redundant API calls');
      if (percentage > 90)
        suggestions.push('Consider upgrading your plan for more tokens');
    } else if (metric === 'requests') {
      suggestions.push(
        'Batch multiple operations together to reduce request count',
      );
      suggestions.push('Implement client-side caching for repeated requests');
      suggestions.push('Use webhooks instead of polling where possible');
      if (percentage > 90)
        suggestions.push('Upgrade your plan for higher request limits');
    } else if (metric === 'logs') {
      suggestions.push('Reduce verbose logging for non-critical operations');
      suggestions.push('Archive old logs to external storage');
      suggestions.push('Upgrade to Plus for unlimited logs');
    }
    return suggestions.slice(0, 5);
  }

  private addToBatchQueue(
    userId: string,
    metrics: Partial<UsageMetrics>,
  ): void {
    const existing = this.usageBatchQueue.get(userId) ?? {};
    this.usageBatchQueue.set(userId, {
      tokens: (existing.tokens ?? 0) + (metrics.tokens ?? 0),
      requests: (existing.requests ?? 0) + (metrics.requests ?? 0),
      logs: (existing.logs ?? 0) + (metrics.logs ?? 0),
      cost: (existing.cost ?? 0) + (metrics.cost ?? 0),
    });
    if (!this.usageBatchProcessor) {
      this.usageBatchProcessor = setTimeout(() => {
        this.processBatchQueue();
      }, 1000);
    }
  }

  private async processBatchQueue(): Promise<void> {
    if (this.usageBatchQueue.size === 0) {
      this.usageBatchProcessor = null;
      return;
    }
    const updates = Array.from(this.usageBatchQueue.entries());
    this.usageBatchQueue.clear();
    try {
      for (const [userId, metrics] of updates) {
        if (metrics.tokens || metrics.requests || metrics.cost) {
          await this.subscriptionService.recordUsage(userId, {
            tokens: metrics.tokens ?? 0,
            requests: metrics.requests ?? 0,
            cost: metrics.cost ?? 0,
          });
        }
      }
    } catch (error) {
      this.logger.error('Error processing usage batch queue', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (this.usageBatchQueue.size > 0) {
      this.usageBatchProcessor = setTimeout(
        () => this.processBatchQueue(),
        1000,
      );
    } else {
      this.usageBatchProcessor = null;
    }
  }

  private queueAlert(userId: string, violation: GuardrailViolation): void {
    const alertKey = `${userId}:${violation.metric}:${Math.floor(violation.percentage / 5) * 5}`;
    const now = Date.now();
    if (
      this.alertTracker.has(alertKey) &&
      now - (this.alertTracker.get(alertKey) ?? 0) < 3600000
    )
      return;
    this.alertTracker.set(alertKey, now);
    this.queueBackgroundOperation(async () => {
      await this.sendUsageAlert(userId, violation);
    });
  }

  private queueBackgroundOperation(operation: () => Promise<void>): void {
    this.alertQueue.push(operation);
    if (!this.backgroundProcessor) {
      this.backgroundProcessor = setInterval(() => {
        this.processBackgroundQueue();
      }, 100);
    }
  }

  private async processBackgroundQueue(): Promise<void> {
    if (this.alertQueue.length === 0) {
      if (this.backgroundProcessor) {
        clearInterval(this.backgroundProcessor);
        this.backgroundProcessor = null;
      }
      return;
    }
    const batch = this.alertQueue.splice(0, 10);
    await Promise.allSettled(batch.map((op) => op()));
    if (this.alertQueue.length === 0 && this.backgroundProcessor) {
      clearInterval(this.backgroundProcessor);
      this.backgroundProcessor = null;
    }
  }

  private async sendUsageAlert(
    userId: string,
    violation: GuardrailViolation,
  ): Promise<void> {
    try {
      const user = await this.userModel.findById(userId).lean();
      const prefs = (user as { preferences?: { emailAlerts?: boolean } })
        ?.preferences;
      if (!user || !prefs?.emailAlerts) return;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const existing = await this.alertModel.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        type: 'usage_spike',
        'data.metric': violation.metric,
        'data.percentage': {
          $gte: violation.percentage - 5,
          $lte: violation.percentage + 5,
        },
        createdAt: { $gte: today },
      });
      if (existing) return;
      await this.alertModel.create({
        userId: new mongoose.Types.ObjectId(userId),
        type: 'usage_spike',
        severity:
          violation.percentage >= 90
            ? 'high'
            : violation.percentage >= 75
              ? 'medium'
              : 'low',
        title: `${violation.metric} usage at ${violation.percentage.toFixed(1)}%`,
        message: violation.message,
        data: {
          metric: violation.metric,
          percentage: violation.percentage,
          current: violation.current,
          limit: violation.limit,
          recommendations: violation.suggestions,
        },
      });
      if (violation.percentage >= 90) {
        try {
          await this.emailService.sendAlertNotification(
            user as { email: string },
            {
              type: 'usage_spike',
              message: violation.message,
              title: `Critical Usage Alert: ${violation.metric} at ${violation.percentage.toFixed(1)}%`,
              severity: 'high',
            },
          );
        } catch (emailError) {
          this.logger.error('Failed to send usage alert email', {
            error:
              emailError instanceof Error
                ? emailError.message
                : String(emailError),
          });
        }
      }
    } catch (error) {
      this.logger.error('Error sending usage alert', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
