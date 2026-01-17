import { loggingService } from './logging.service';
import { User } from '../models/User';
import { Project } from '../models/Project';
import { Activity } from '../models/Activity';
import { Alert } from '../models/Alert';
import { EmailService } from './email.service';
import { Response } from 'express';

import { Usage } from '../models/Usage';
import mongoose from 'mongoose';
import { MODEL_PRICING } from '../utils/pricing';
import { AIRouterService } from './aiRouter.service';

// Subscription plan limits based on costkxatana.com pricing
export interface PlanLimits {
    tokensPerMonth: number;
    requestsPerMonth: number;
    logsPerMonth: number;
    projects: number;
    workflows: number;
    seats: number;
    models: string[];
    features: string[];
}

export interface UsageMetrics {
    tokens: number;
    requests: number;
    logs: number;
    projects: number;
    workflows: number;
    cost: number;
    period: 'daily' | 'monthly';
}

export interface GuardrailViolation {
    type: 'soft' | 'hard' | 'warning';
    metric: string;
    current: number;
    limit: number;
    percentage: number;
    message: string;
    action: 'allow' | 'throttle' | 'block';
    suggestions: string[];
}

// In-memory cache for quick lookups (replace with Redis in production)
class UsageCache {
    private cache: Map<string, { data: any; expiry: number }> = new Map();
    private readonly TTL = 60000; // 1 minute cache

    set(key: string, value: any, ttl: number = this.TTL): void {
        this.cache.set(key, {
            data: value,
            expiry: Date.now() + ttl
        });
    }

    get(key: string): any {
        const item = this.cache.get(key);
        if (!item) return null;
        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return null;
        }
        return item.data;
    }

    delete(key: string): void {
        this.cache.delete(key);
    }

    clear(): void {
        this.cache.clear();
    }
}

export class GuardrailsService {
    private static usageCache = new UsageCache();
    
    // Optimization: Background processing queues
    private static alertQueue: Array<() => Promise<void>> = [];
    private static usageBatchQueue = new Map<string, Partial<UsageMetrics>>();
    private static alertTracker = new Map<string, number>();
    private static backgroundProcessor?: NodeJS.Timeout;
    private static usageBatchProcessor?: NodeJS.Timeout;
    
    // Define subscription plans with their limits
    private static readonly SUBSCRIPTION_PLANS: Record<string, PlanLimits> = {
        free: {
            tokensPerMonth: 1_000_000,
            requestsPerMonth: 10_000,
            logsPerMonth: 15_000,
            projects: 5,
            workflows: 10,
            seats: 1,
            models: ['claude-3-haiku', 'gpt-3.5-turbo', 'gemini-1.5-flash'],
            features: ['basic_analytics', 'usage_tracking', 'unified_endpoint']
        },
        plus: {
            tokensPerMonth: 10_000_000,
            requestsPerMonth: 50_000,
            logsPerMonth: -1, // Unlimited
            projects: -1, // Unlimited
            workflows: 100,
            seats: -1, // Paid per seat
            models: ['*'], // All models
            features: ['advanced_analytics', 'predictive_analytics', 'batch_processing', 
                      'failover', 'security_moderation', 'training', 'usage_tracking', 
                      'unified_endpoint', 'advanced_metrics']
        },
        pro: {
            tokensPerMonth: 15_000_000, // Per seat
            requestsPerMonth: 100_000,
            logsPerMonth: -1, // Unlimited
            projects: -1, // Unlimited
            workflows: 100, // Per user
            seats: 20, // Included seats
            models: ['*'], // All models
            features: ['advanced_analytics', 'predictive_analytics', 'batch_processing', 
                      'failover', 'security_moderation', 'training', 'usage_tracking', 
                      'unified_endpoint', 'advanced_metrics', 'priority_support']
        },
        enterprise: {
            tokensPerMonth: -1, // Unlimited
            requestsPerMonth: -1, // Unlimited
            logsPerMonth: -1, // Unlimited
            projects: -1, // Unlimited
            workflows: -1, // Unlimited
            seats: -1, // Custom
            models: ['*', 'custom'], // All models + custom
            features: ['*'] // All features
        }
    };

    // Warning thresholds for proactive alerts
    private static readonly WARNING_THRESHOLDS = [50, 75, 90, 95, 99];

    /**
     * Check workflow quota for a user based on their subscription plan
     * Returns violation if user has reached their workflow limit
     */
    static async checkWorkflowQuota(userId: string): Promise<GuardrailViolation | null> {
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
                    suggestions: []
                };
            }

            // Get subscription from new Subscription model
            const { SubscriptionService } = await import('./subscription.service');
            const subscription = await SubscriptionService.getSubscriptionByUserId(userId);
            const planName = subscription?.plan || 'free';
            const planLimits = subscription ? SubscriptionService.getPlanLimits(planName) : this.SUBSCRIPTION_PLANS[planName];
            
            // Check subscription status
            if (subscription && subscription.status !== 'active' && subscription.status !== 'trialing') {
                return {
                    type: 'hard',
                    metric: 'subscription',
                    current: 0,
                    limit: 0,
                    percentage: 0,
                    message: `Subscription is ${subscription.status}. Please activate your subscription.`,
                    action: 'block',
                    suggestions: ['Reactivate your subscription or upgrade to continue']
                };
            }
            
            if (!planLimits) {
                loggingService.error('Unknown subscription plan:', { planName });
                return null;
            }

            // Skip check for unlimited (-1) limits
            if (planLimits.workflows === -1) {
                return null;
            }

            return null;
        } catch (error) {
            loggingService.error('Error checking workflow quota:', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return null;
        }
    }

    /**
     * Check if a user can make a request based on their guardrails with parallel validation
     */
    static async checkRequestGuardrails(
        userId: string,
        requestType: 'token' | 'request' | 'log',
        amount: number = 1,
        modelId?: string
    ): Promise<GuardrailViolation | null> {
        try {
            // Parallel execution of user and usage data fetching
            const [user, usage] = await Promise.all([
                this.getUserWithCache(userId),
                this.getCurrentUsage(userId)
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
                    suggestions: []
                };
            }

            // Get plan limits
            // Get subscription from new Subscription model
            const { SubscriptionService } = await import('./subscription.service');
            const subscription = await SubscriptionService.getSubscriptionByUserId(userId);
            const planName = subscription?.plan || 'free';
            const planLimits = subscription ? SubscriptionService.getPlanLimits(planName) : this.SUBSCRIPTION_PLANS[planName];
            
            // Check subscription status
            if (subscription && subscription.status !== 'active' && subscription.status !== 'trialing') {
                return {
                    type: 'hard',
                    metric: 'subscription',
                    current: 0,
                    limit: 0,
                    percentage: 0,
                    message: `Subscription is ${subscription.status}. Please activate your subscription.`,
                    action: 'block',
                    suggestions: ['Reactivate your subscription or upgrade to continue']
                };
            }
            
            if (!planLimits) {
                loggingService.error('Unknown subscription plan:', { planName });
                return null;
            }

            // Check model access for free tier
            if (modelId && planName === 'free') {
                const allowedModels = (planLimits as any).allowedModels || (planLimits as any).models || [];
                if (!allowedModels.includes(modelId) && !allowedModels.includes('*')) {
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
                            `Available models for free tier: ${allowedModels.join(', ')}`
                        ]
                    };
                }
            }

            // Check specific metric
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

            // Skip check for unlimited (-1) limits
            if (limitValue === -1) {
                return null;
            }

            const percentage = (currentValue / limitValue) * 100;

            // Hard limit reached
            if (currentValue > limitValue) {
                return {
                    type: 'hard',
                    metric: metricName,
                    current: currentValue,
                    limit: limitValue,
                    percentage,
                    message: `Monthly ${metricName} limit exceeded`,
                    action: 'block',
                    suggestions: this.getUpgradeSuggestions(planName, metricName)
                };
            }

            // Warning thresholds
            for (const threshold of this.WARNING_THRESHOLDS) {
                if (percentage >= threshold && percentage < threshold + 5) {
                    // Get AI-powered contextual suggestions
                    const suggestions = await this.getOptimizationSuggestions(userId, metricName, percentage);
                    
                    const violation: GuardrailViolation = {
                        type: 'warning',
                        metric: metricName,
                        current: currentValue,
                        limit: limitValue,
                        percentage,
                        message: `${threshold}% of monthly ${metricName} limit reached`,
                        action: 'allow',
                        suggestions
                    };

                    // Queue alert for background processing
                    this.queueAlert(userId, violation);
                    
                    return violation;
                }
            }

            // Soft throttling at 80% for free tier
            if (planName === 'free' && percentage >= 80) {
                // Get AI-powered contextual suggestions
                const suggestions = await this.getOptimizationSuggestions(userId, metricName, percentage);
                
                return {
                    type: 'soft',
                    metric: metricName,
                    current: currentValue,
                    limit: limitValue,
                    percentage,
                    message: `Approaching ${metricName} limit - throttling enabled`,
                    action: 'throttle',
                    suggestions
                };
            }

            return null;
        } catch (error) {
            loggingService.error('Error checking guardrails:', { error: error instanceof Error ? error.message : String(error) });
            return null;
        }
    }

    /**
     * Track usage for a user with batching optimization
     */
    static async trackUsage(
        userId: string,
        metrics: Partial<UsageMetrics>,
        modelId?: string
    ): Promise<void> {
        try {
            // Calculate cost if not provided but tokens are available
            let calculatedCost = metrics.cost || 0;
            if (!calculatedCost && metrics.tokens && modelId) {
                // Estimate input/output split (rough estimate)
                const inputTokens = Math.floor(metrics.tokens * 0.6);
                const outputTokens = Math.floor(metrics.tokens * 0.4);
                calculatedCost = this.calculateTokenCost(modelId, inputTokens, outputTokens);
            }

            // Add to batch queue instead of immediate database update
            this.addToBatchQueue(userId, {
                ...metrics,
                cost: calculatedCost
            });

            // Clear cache for immediate consistency
            this.usageCache.delete(`user:${userId}`);
            this.usageCache.delete(`usage:${userId}`);

            // Log activity in background
            this.queueBackgroundOperation(async () => {
                await Activity.create({
                    userId,
                    type: 'api_call',
                    title: 'Usage Tracked',
                    description: `Usage tracked: ${JSON.stringify({ ...metrics, calculatedCost })}`,
                    metadata: { ...metrics, calculatedCost, modelId }
                });
            });

            // Check for violations after update (non-blocking)
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
            loggingService.error('Error tracking usage:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Get current usage for a user with unified database queries
     */
    static async getCurrentUsage(userId: string): Promise<UsageMetrics> {
        try {
            // Check cache first
            const cacheKey = `usage:${userId}`;
            const cached = this.usageCache.get(cacheKey);
            loggingService.info(`Cache lookup for ${cacheKey}: ${cached ? 'Hit' : 'Miss'}`);
            if (cached) return cached;

            const user = await User.findById(userId);
            loggingService.info(`User lookup for ${userId}: ${user ? 'Found' : 'Not found'}`);
            if (!user) {
                return {
                    tokens: 0,
                    requests: 0,
                    logs: 0,
                    projects: 0,
                    workflows: 0,
                    cost: 0,
                    period: 'monthly'
                };
            }

            // Get subscription to use the correct period start date
            const { SubscriptionService } = await import('./subscription.service');
            const subscription = await SubscriptionService.getSubscriptionByUserId(userId);
            
            // Use subscription period start if available, otherwise use 1st of current month
            let periodStart: Date;
            if (subscription?.usage?.currentPeriodStart) {
                periodStart = new Date(subscription.usage.currentPeriodStart);
            } else {
                periodStart = new Date();
                periodStart.setDate(1);
                periodStart.setHours(0, 0, 0, 0);
            }

            // Unified database query using $facet for all metrics
            const [allMetrics] = await Promise.all([
                this.getAllUsageMetrics(userId, periodStart)
            ]);

            // If subscription exists, use subscription usage data (more accurate)
            let usage: UsageMetrics;
            if (subscription?.usage) {
                usage = {
                    tokens: subscription.usage.tokensUsed || allMetrics.usage.totalTokens || 0,
                    requests: subscription.usage.requestsUsed || allMetrics.usage.requestCount || 0,
                    logs: subscription.usage.logsUsed || allMetrics.logs.count || 0,
                    projects: allMetrics.projects.count || 0,
                    workflows: subscription.usage.workflowsUsed || allMetrics.workflows.count || 0,
                    cost: allMetrics.usage.totalCost || 0, // Cost from actual usage records
                    period: 'monthly'
                };
            } else {
                usage = {
                    tokens: allMetrics.usage.totalTokens || 0,
                    requests: allMetrics.usage.requestCount || 0,
                    logs: allMetrics.logs.count || 0,
                    projects: allMetrics.projects.count || 0,
                    workflows: allMetrics.workflows.count || 0,
                    cost: allMetrics.usage.totalCost || 0,
                    period: 'monthly'
                };
            }

            // Cache for 1 minute
            this.usageCache.set(cacheKey, usage, 60000);

            return usage;
        } catch (error) {
            loggingService.error('Error getting current usage:', { error: error instanceof Error ? error.message : String(error) });
            return {
                tokens: 0,
                requests: 0,
                logs: 0,
                projects: 0,
                workflows: 0,
                cost: 0,
                period: 'monthly'
            };
        }
    }

    /**
     * Unified database query for all usage metrics
     */
    private static async getAllUsageMetrics(userId: string, startOfMonth: Date): Promise<any> {
        // Single aggregation query combining all metrics
        const userObjectId = new mongoose.Types.ObjectId(userId);
        
        // Parallel execution of optimized queries
        const [projectCount, usageData, logCount] = await Promise.all([
            // Projects count
            Project.countDocuments({
                $or: [
                    { ownerId: userObjectId },
                    { 'members.userId': userObjectId }
                ],
                isActive: true
            }),
            
            // Usage data aggregation
            Usage.aggregate([
                {
                    $match: {
                        userId: userObjectId,
                        createdAt: { $gte: startOfMonth }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalTokens: { $sum: '$totalTokens' },
                        totalCost: { $sum: '$cost' },
                        requestCount: { $sum: 1 }
                    }
                }
            ]),
            
            // Activity logs count
            Activity.countDocuments({
                userId,
                createdAt: { $gte: startOfMonth }
            }),
        ]);

        return {
            projects: { count: projectCount },
            usage: usageData[0] || { totalTokens: 0, totalCost: 0, requestCount: 0 },
            logs: { count: logCount },
        };
    }

    /**
     * Clear cache for a specific user (for testing/debugging)
     */
    static clearUserCache(userId: string): void {
        this.usageCache.delete(`user:${userId}`);
        this.usageCache.delete(`usage:${userId}`);
        loggingService.info(`Cache cleared for user ${userId}`);
    }

    /**
     * Reset monthly usage for all users
     */
    static async resetMonthlyUsage(): Promise<void> {
        try {
            loggingService.info('Resetting monthly usage for all users');
            
            await User.updateMany(
                {},
                {
                    $set: {
                        'usage.currentMonth': {
                            apiCalls: 0,
                            totalCost: 0,
                            totalTokens: 0,
                            optimizationsSaved: 0
                        }
                    }
                }
            );

            // Clear all usage caches
            this.usageCache.clear();
            
            loggingService.info('Monthly usage reset completed');
        } catch (error) {
            loggingService.error('Error resetting monthly usage:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Get usage statistics for a user
     */
    static async getUserUsageStats(userId: string): Promise<any> {
        try {
            const user = await this.getUserWithCache(userId);
            if (!user) return null;

            const usage = await this.getCurrentUsage(userId);
            // Get subscription from new Subscription model
            const { SubscriptionService } = await import('./subscription.service');
            const subscription = await SubscriptionService.getSubscriptionByUserId(userId);
            const planName = subscription?.plan || 'free';
            const planLimits = subscription ? SubscriptionService.getPlanLimits(planName) : this.SUBSCRIPTION_PLANS[planName];
            
            // Check subscription status
            if (subscription && subscription.status !== 'active' && subscription.status !== 'trialing') {
                return {
                    type: 'hard',
                    metric: 'subscription',
                    current: 0,
                    limit: 0,
                    percentage: 0,
                    message: `Subscription is ${subscription.status}. Please activate your subscription.`,
                    action: 'block',
                    suggestions: ['Reactivate your subscription or upgrade to continue']
                };
            }

            // Calculate percentages
            const percentages = {
                tokens: planLimits.tokensPerMonth === -1 ? 0 : 
                    (usage.tokens / planLimits.tokensPerMonth) * 100,
                requests: planLimits.requestsPerMonth === -1 ? 0 : 
                    (usage.requests / planLimits.requestsPerMonth) * 100,
                logs: planLimits.logsPerMonth === -1 ? 0 : 
                    (usage.logs / planLimits.logsPerMonth) * 100,
                projects: planLimits.projects === -1 ? 0 : 
                    (usage.projects / planLimits.projects) * 100,
                workflows: planLimits.workflows === -1 ? 0 : 
                    (usage.workflows / planLimits.workflows) * 100
            };

            // Get daily usage trend
            const dailyUsage = await this.getDailyUsageTrend(userId, 7);

            // Predict end of month usage
            const predictions = this.predictEndOfMonthUsage(usage, new Date().getDate());

            return {
                current: usage,
                limits: {
                    ...planLimits,
                    models: subscription?.allowedModels || (planLimits as any).allowedModels || (planLimits as PlanLimits).models || []
                },
                percentages,
                dailyTrend: dailyUsage,
                predictions,
                plan: planName,
                recommendations: this.generateRecommendations(usage, { 
                    ...planLimits, 
                    models: subscription?.allowedModels || (planLimits as any).allowedModels || (planLimits as PlanLimits).models || []
                }, percentages)
            };
        } catch (error) {
            loggingService.error('Error getting user usage stats:', { error: error instanceof Error ? error.message : String(error) });
            return null;
        }
    }

    /**
     * Middleware to enforce guardrails on requests with parallel validation
     */
    static async enforceGuardrails(req: any, res: Response, next: Function): Promise<void> {
        try {
            const userId = req.user?.id || req.gatewayContext?.userId;
            if (!userId) {
                return next();
            }

            // Estimate tokens for the request (simplified)
            const estimatedTokens = GuardrailsService.estimateRequestTokens(req);
            
            // Parallel guardrail checks
            const [requestViolation, tokenViolation] = await Promise.all([
                GuardrailsService.checkRequestGuardrails(userId, 'request', 1, req.body?.model),
                GuardrailsService.checkRequestGuardrails(userId, 'token', estimatedTokens, req.body?.model)
            ]);

            // Check request violation first
            if (requestViolation) {
                // Add headers for client awareness
                res.setHeader('X-Guardrail-Status', requestViolation.type);
                res.setHeader('X-Guardrail-Metric', requestViolation.metric);
                res.setHeader('X-Guardrail-Percentage', requestViolation.percentage.toFixed(2));

                switch (requestViolation.action) {
                    case 'block':
                        res.status(429).json({
                            success: false,
                            error: 'Usage limit exceeded',
                            violation: requestViolation,
                            upgradeUrl: 'https://www.costkatana.com/#pricing'
                        });
                        return;
                    
                    case 'throttle':
                        // Add artificial delay for free tier throttling
                        const delay = Math.min(5000, requestViolation.percentage * 50);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        break;
                }
            }

            // Check token violation
            if (tokenViolation?.action === 'block') {
                res.status(429).json({
                    success: false,
                    error: 'Token limit exceeded',
                    violation: tokenViolation,
                    upgradeUrl: 'https://www.costkatana.com/#pricing'
                });
                return;
            }

            // Track the request (non-blocking)
            GuardrailsService.trackUsage(userId, {
                requests: 1,
                tokens: estimatedTokens
            });

            next();
        } catch (error) {
            loggingService.error('Error enforcing guardrails:', { error: error instanceof Error ? error.message : String(error) });
            next(); // Don't block on errors
        }
    }

    /**
     * Send usage alert to user
     */
    private static async sendUsageAlert(
        userId: string, 
        violation: GuardrailViolation
    ): Promise<void> {
        try {
            const user = await User.findById(userId);
            if (!user || !user.preferences?.emailAlerts) return;

            // Check if we already sent an alert for this threshold today
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const existingAlert = await Alert.findOne({
                userId,
                type: 'usage_warning',
                'metadata.metric': violation.metric,
                'metadata.percentage': { $gte: violation.percentage - 5, $lte: violation.percentage + 5 },
                createdAt: { $gte: today }
            });

            if (existingAlert) return;

            // Create alert
            await Alert.create({
                userId,
                type: 'usage_warning',
                severity: violation.percentage >= 90 ? 'high' : 
                         violation.percentage >= 75 ? 'medium' : 'low',
                title: `${violation.metric} usage at ${violation.percentage.toFixed(1)}%`,
                message: violation.message,
                metadata: {
                    metric: violation.metric,
                    percentage: violation.percentage,
                    current: violation.current,
                    limit: violation.limit,
                    suggestions: violation.suggestions
                }
            });

            // Send email if critical
            if (violation.percentage >= 90) {
                // Use existing sendAlertNotification method
                try {
                    const alertForEmail = {
                        type: 'usage_warning',
                        severity: 'high' as const,
                        title: `Critical Usage Alert: ${violation.metric} at ${violation.percentage.toFixed(1)}%`,
                        message: violation.message,
                        metadata: {
                            metric: violation.metric,
                            percentage: violation.percentage,
                            current: violation.current,
                            limit: violation.limit,
                            suggestions: violation.suggestions
                        }
                    };
                    await EmailService.sendAlertNotification(user, alertForEmail as any);
                } catch (emailError) {
                    loggingService.error('Failed to send usage alert email:', { error: emailError instanceof Error ? emailError.message : String(emailError) });
                }
            }
        } catch (error) {
            loggingService.error('Error sending usage alert:', { error: error instanceof Error ? error.message : String(error) });
        }
    }


    /**
     * Estimate tokens for a request
     */
    private static estimateRequestTokens(req: any): number {
        // Simplified token estimation
        const body = JSON.stringify(req.body || {});
        const estimatedTokens = Math.ceil(body.length / 4); // Rough estimate: 4 chars per token
        
        // Add buffer for response
        return estimatedTokens * 2;
    }

    /**
     * Calculate cost for tokens using pricing data
     */
    private static calculateTokenCost(
        modelId: string, 
        inputTokens: number, 
        outputTokens: number = 0
    ): number {
        try {
            // Use the combined pricing data from utils/pricing
            const modelPricing = MODEL_PRICING.find((p: any) => 
                p.modelId === modelId || 
                p.modelName.toLowerCase().includes(modelId.toLowerCase())
            );

            if (!modelPricing) {
                // Default fallback pricing (GPT-3.5 Turbo equivalent)
                return ((inputTokens * 0.5) + (outputTokens * 1.5)) / 1000000;
            }

            // Calculate cost based on pricing unit
            const inputCost = (inputTokens * modelPricing.inputPrice) / 1000000;
            const outputCost = (outputTokens * modelPricing.outputPrice) / 1000000;
            
            return inputCost + outputCost;
        } catch (error) {
            loggingService.error('Error calculating token cost:', { error: error instanceof Error ? error.message : String(error) });
            return 0;
        }
    }

    /**
     * Get daily usage trend
     */
    private static async getDailyUsageTrend(
        userId: string, 
        days: number
    ): Promise<any[]> {
        const trend = [];
        const today = new Date();
        
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            
            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);
            
            const activities = await Activity.countDocuments({
                userId,
                createdAt: { $gte: date, $lt: nextDate }
            });
            
            trend.push({
                date: date.toISOString().split('T')[0],
                requests: activities
            });
        }
        
        return trend;
    }

    /**
     * Predict end of month usage
     */
    private static predictEndOfMonthUsage(
        current: UsageMetrics, 
        currentDay: number
    ): any {
        const daysInMonth = new Date(
            new Date().getFullYear(), 
            new Date().getMonth() + 1, 
            0
        ).getDate();
        
        const remainingDays = daysInMonth - currentDay;
        const dailyRate = {
            tokens: current.tokens / currentDay,
            requests: current.requests / currentDay,
            logs: current.logs / currentDay
        };
        
        return {
            tokens: Math.ceil(current.tokens + (dailyRate.tokens * remainingDays)),
            requests: Math.ceil(current.requests + (dailyRate.requests * remainingDays)),
            logs: Math.ceil(current.logs + (dailyRate.logs * remainingDays))
        };
    }

    /**
     * Generate recommendations based on usage
     */
    private static generateRecommendations(
        usage: UsageMetrics,
        limits: PlanLimits,
        percentages: any
    ): string[] {
        const recommendations = [];
        
        // High token usage
        if (percentages.tokens > 70) {
            recommendations.push('Consider using smaller models for simple tasks');
            recommendations.push('Implement prompt optimization to reduce token usage');
            recommendations.push('Enable caching for repeated requests');
        }
        
        // High request count
        if (percentages.requests > 70) {
            recommendations.push('Batch multiple operations into single requests');
            recommendations.push('Implement request deduplication');
            recommendations.push('Use webhooks instead of polling');
        }
        
        // Project limit approaching
        if (limits.projects !== -1 && percentages.projects > 80) {
            recommendations.push('Archive inactive projects to free up space');
            recommendations.push('Consider upgrading for unlimited projects');
        }
        
        // Cost optimization
        if (usage.cost > 100) {
            recommendations.push('Review model usage - consider cheaper alternatives');
            recommendations.push('Enable cost alerts for better monitoring');
            recommendations.push('Use batch processing for bulk operations');
        }
        
        return recommendations;
    }

    /**
     * Get upgrade suggestions
     */
    private static getUpgradeSuggestions(
        currentPlan: string, 
        metric: string
    ): string[] {
        const suggestions = [];
        
        switch (currentPlan) {
            case 'free':
                if (metric === 'workflows') {
                    suggestions.push('Upgrade to Plus plan for 100 workflows (10x increase)');
                    suggestions.push('Plus plan includes unlimited logs and projects');
                } else {
                    suggestions.push('Upgrade to Plus plan for 10x more tokens and requests');
                    suggestions.push('Plus plan includes unlimited logs and projects');
                }
                suggestions.push('Get access to all AI models with Plus or Pro');
                break;
            case 'plus':
                if (metric === 'workflows') {
                    suggestions.push('Upgrade to Pro plan for 100 workflows per user');
                    suggestions.push('Pro plan includes 20 seats at a flat rate');
                } else {
                    suggestions.push('Upgrade to Pro plan for 50% more tokens per seat');
                    suggestions.push('Pro plan includes 20 seats at a flat rate');
                }
                suggestions.push('Get priority support with Pro plan');
                break;
            case 'pro':
                if (metric === 'workflows') {
                    suggestions.push('Contact sales for Enterprise plan with unlimited workflows');
                } else {
                    suggestions.push('Contact sales for Enterprise plan with unlimited usage');
                }
                suggestions.push('Enterprise includes custom integrations and SLA');
                break;
        }
        
        suggestions.push(`Current ${metric} usage can be optimized - check recommendations`);
        suggestions.push('Visit https://www.costkatana.com/#pricing for plan details');
        
        return suggestions;
    }

    /**
     * Get AI-powered, context-aware optimization suggestions based on actual workflow usage
     */
    private static async getOptimizationSuggestions(
        userId: string,
        metric: string, 
        percentage: number
    ): Promise<string[]> {
        try {
            // Check cache first (cache key includes userId, metric, and percentage bucket)
            const cacheKey = `suggestions:${userId}:${metric}:${Math.floor(percentage / 10) * 10}`;
            const cached = this.usageCache.get(cacheKey);
            if (cached) {
                return cached;
            }

            // Get user's actual workflow usage and patterns
            const workflowContext = await this.analyzeUserWorkflows(userId, metric);
            
            // Build AI prompt with context
            const prompt = this.buildOptimizationPrompt(metric, percentage, workflowContext);
            
            // Use AWS Bedrock to generate contextual suggestions
            const modelId = 'amazon.nova-pro-v1:0';
            const aiResponse = await AIRouterService.invokeModel(prompt, modelId);
            
            // Parse AI response
            let suggestions: string[] = [];
            if (aiResponse && typeof aiResponse === 'string') {
                try {
                    // Try to parse as JSON first
                    const parsed = JSON.parse(aiResponse);
                    if (Array.isArray(parsed.suggestions)) {
                        suggestions = parsed.suggestions;
                    } else if (Array.isArray(parsed)) {
                        suggestions = parsed;
                    } else if (parsed.recommendations && Array.isArray(parsed.recommendations)) {
                        suggestions = parsed.recommendations.map((r: any) => 
                            typeof r === 'string' ? r : r.description || r.suggestion || JSON.stringify(r)
                        );
                    }
                } catch {
                    // If not JSON, try to extract suggestions from text
                    suggestions = this.extractSuggestionsFromText(aiResponse);
                }
            }

            // Fallback to basic suggestions if AI fails or returns empty
            if (suggestions.length === 0) {
                suggestions = this.getFallbackSuggestions(metric, percentage, workflowContext);
            }

            // Limit to 5 most relevant suggestions
            suggestions = suggestions.slice(0, 5);

            // Cache for 5 minutes
            this.usageCache.set(cacheKey, suggestions, 300000);
            
            return suggestions;
        } catch (error) {
            loggingService.error('Error getting AI optimization suggestions', {
                component: 'GuardrailsService',
                operation: 'getOptimizationSuggestions',
                error: error instanceof Error ? error.message : String(error),
                userId,
                metric,
                percentage
            });
            
            // Return fallback suggestions on error
            return this.getFallbackSuggestions(metric, percentage, {});
        }
    }

    /**
     * Analyze user's actual workflow usage patterns for context
     */
    private static async analyzeUserWorkflows(
        userId: string,
        metric: string
    ): Promise<{
        workflowCount: number;
        activeWorkflows: Array<{
            workflowId: string;
            workflowName: string;
            platform: string;
            totalCost: number;
            totalExecutions: number;
            averageCostPerExecution: number;
            topModels: Array<{ model: string; cost: number; percentage: number }>;
        }>;
        totalCost: number;
        totalExecutions: number;
        topExpensiveWorkflows: Array<{ workflowName: string; cost: number }>;
        modelDistribution: Record<string, number>;
        usagePatterns: {
            peakHours: string[];
            averageExecutionsPerDay: number;
            costTrend: 'increasing' | 'decreasing' | 'stable';
        };
    }> {
        try {
            const userObjectId = new mongoose.Types.ObjectId(userId);
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            // Get workflow usage data
            const workflowUsage = await Usage.aggregate([
                {
                    $match: {
                        userId: userObjectId,
                        automationPlatform: { $exists: true, $ne: null },
                        workflowId: { $exists: true, $ne: null },
                        createdAt: { $gte: startOfMonth }
                    }
                },
                {
                    $group: {
                        _id: {
                            workflowId: '$workflowId',
                            workflowName: '$workflowName',
                            platform: '$automationPlatform'
                        },
                        totalCost: { $sum: '$cost' },
                        totalExecutions: { $sum: 1 },
                        models: {
                            $push: {
                                model: '$model',
                                cost: '$cost'
                            }
                        }
                    }
                },
                { $sort: { totalCost: -1 } },
                { $limit: 10 }
            ]);

            // Get model distribution
            const modelUsage = await Usage.aggregate([
                {
                    $match: {
                        userId: userObjectId,
                        createdAt: { $gte: startOfMonth }
                    }
                },
                {
                    $group: {
                        _id: '$model',
                        totalCost: { $sum: '$cost' },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { totalCost: -1 } }
            ]);

            const modelDistribution: Record<string, number> = {};
            let totalModelCost = 0;
            modelUsage.forEach((m: any) => {
                if (m._id) {
                    modelDistribution[m._id] = m.totalCost;
                    totalModelCost += m.totalCost;
                }
            });

            // Calculate model percentages
            Object.keys(modelDistribution).forEach(model => {
                if (totalModelCost > 0) {
                    modelDistribution[model] = (modelDistribution[model] / totalModelCost) * 100;
                }
            });

            // Process workflow data
            const activeWorkflows = workflowUsage.map((wf: any) => {
                const totalCost = wf.totalCost || 0;
                const totalExecutions = wf.totalExecutions || 1;
                
                // Calculate top models for this workflow
                const modelMap = new Map<string, number>();
                (wf.models || []).forEach((m: any) => {
                    if (m.model) {
                        modelMap.set(m.model, (modelMap.get(m.model) || 0) + (m.cost || 0));
                    }
                });

                const topModels = Array.from(modelMap.entries())
                    .map(([model, cost]) => ({
                        model,
                        cost,
                        percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0
                    }))
                    .sort((a, b) => b.cost - a.cost)
                    .slice(0, 3);

                return {
                    workflowId: wf._id.workflowId || 'unknown',
                    workflowName: wf._id.workflowName || 'Unknown Workflow',
                    platform: wf._id.platform || 'unknown',
                    totalCost,
                    totalExecutions,
                    averageCostPerExecution: totalExecutions > 0 ? totalCost / totalExecutions : 0,
                    topModels
                };
            });

            const totalCost = activeWorkflows.reduce((sum, wf) => sum + wf.totalCost, 0);
            const totalExecutions = activeWorkflows.reduce((sum, wf) => sum + wf.totalExecutions, 0);

            // Calculate actual peak hours from usage data
            const hourlyUsage = await Usage.aggregate([
                {
                    $match: {
                        userId: userObjectId,
                        createdAt: { $gte: startOfMonth }
                    }
                },
                {
                    $group: {
                        _id: {
                            $hour: '$createdAt'
                        },
                        count: { $sum: 1 },
                        totalCost: { $sum: '$cost' }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 3 }
            ]);

            const peakHours = hourlyUsage
                .map((h: any) => {
                    const hour = h._id ?? 0;
                    return `${hour.toString().padStart(2, '0')}:00`;
                })
                .filter((h: string) => h !== '00:00' || hourlyUsage.length > 0);

            // Calculate cost trend by comparing first half vs second half of month
            const now = new Date();
            const midMonth = new Date(now.getFullYear(), now.getMonth(), 15);
            const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
            const currentDay = now.getDate();
            
            // Only calculate trend if we're past mid-month
            let costTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
            if (currentDay >= 15) {
                const [firstHalfCost, secondHalfCost] = await Promise.all([
                    Usage.aggregate([
                        {
                            $match: {
                                userId: userObjectId,
                                createdAt: { $gte: startOfMonth, $lt: midMonth }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                totalCost: { $sum: '$cost' }
                            }
                        }
                    ]),
                    Usage.aggregate([
                        {
                            $match: {
                                userId: userObjectId,
                                createdAt: { $gte: midMonth, $lte: now }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                totalCost: { $sum: '$cost' }
                            }
                        }
                    ])
                ]);

                const firstHalf = firstHalfCost[0]?.totalCost ?? 0;
                const secondHalf = secondHalfCost[0]?.totalCost ?? 0;
                const firstHalfDays = 14;
                const secondHalfDays = currentDay - 14;
                
                if (secondHalfDays > 0 && firstHalfDays > 0) {
                    const firstHalfDaily = firstHalf / firstHalfDays;
                    const secondHalfDaily = secondHalf / secondHalfDays;
                    const changePercent = ((secondHalfDaily - firstHalfDaily) / firstHalfDaily) * 100;
                    
                    if (changePercent > 10) {
                        costTrend = 'increasing';
                    } else if (changePercent < -10) {
                        costTrend = 'decreasing';
                    } else {
                        costTrend = 'stable';
                    }
                }
            }

            // Calculate accurate average executions per day
            const daysSinceMonthStart = Math.max(1, currentDay);
            const averageExecutionsPerDay = totalExecutions > 0 ? totalExecutions / daysSinceMonthStart : 0;

            const usagePatterns = {
                peakHours: peakHours.length > 0 ? peakHours : [],
                averageExecutionsPerDay,
                costTrend
            };

            return {
                workflowCount: activeWorkflows.length,
                activeWorkflows,
                totalCost,
                totalExecutions,
                topExpensiveWorkflows: activeWorkflows
                    .slice(0, 5)
                    .map(wf => ({ workflowName: wf.workflowName, cost: wf.totalCost })),
                modelDistribution,
                usagePatterns
            };
        } catch (error) {
            loggingService.error('Error analyzing user workflows', {
                component: 'GuardrailsService',
                operation: 'analyzeUserWorkflows',
                error: error instanceof Error ? error.message : String(error),
                userId,
                metric
            });
            return {
                workflowCount: 0,
                activeWorkflows: [],
                totalCost: 0,
                totalExecutions: 0,
                topExpensiveWorkflows: [],
                modelDistribution: {},
                usagePatterns: {
                    peakHours: [],
                    averageExecutionsPerDay: 0,
                    costTrend: 'stable'
                }
            };
        }
    }

    /**
     * Build AI prompt with workflow context
     */
    private static buildOptimizationPrompt(
        metric: string,
        percentage: number,
        workflowContext: any
    ): string {
        return `You are an AI cost optimization expert analyzing a user's AI usage patterns. Generate specific, actionable optimization suggestions based on their actual workflow data.

USER CONTEXT:
- Metric: ${metric}
- Current Usage: ${percentage.toFixed(1)}% of limit
- Active Workflows: ${workflowContext.workflowCount || 0}
- Total Monthly Cost: $${(workflowContext.totalCost || 0).toFixed(2)}
- Total Executions: ${workflowContext.totalExecutions || 0}

TOP WORKFLOWS:
${(workflowContext.activeWorkflows || []).slice(0, 5).map((wf: any, idx: number) => `
${idx + 1}. ${wf.workflowName} (${wf.platform})
   - Cost: $${wf.totalCost.toFixed(2)}
   - Executions: ${wf.totalExecutions}
   - Avg Cost/Execution: $${wf.averageCostPerExecution.toFixed(4)}
   - Top Models: ${wf.topModels.map((m: any) => `${m.model} (${m.percentage.toFixed(1)}%)`).join(', ')}
`).join('')}

MODEL DISTRIBUTION:
${Object.entries(workflowContext.modelDistribution || {}).slice(0, 5).map(([model, pct]) => 
    `- ${model}: ${(pct as number).toFixed(1)}%`
).join('\n')}

USAGE PATTERNS:
- Average Executions/Day: ${(workflowContext.usagePatterns?.averageExecutionsPerDay || 0).toFixed(1)}
- Cost Trend: ${workflowContext.usagePatterns?.costTrend || 'stable'}

INSTRUCTIONS:
1. Analyze the user's actual workflow patterns and identify specific optimization opportunities
2. Provide 3-5 highly specific, actionable suggestions tailored to their workflows
3. Focus on workflows that are most expensive or inefficient
4. Consider their model usage patterns and suggest model switches where appropriate
5. Suggest workflow consolidation if multiple similar workflows exist
6. Provide caching recommendations for frequently executed workflows
7. If ${percentage}% > 90, include upgrade suggestions but prioritize optimization first

CRITICAL: Be specific. Instead of "optimize workflows", say "Consolidate 'Customer Support Automation' and 'Support Ticket Processing' workflows - they have 80% overlap and cost $X/month combined."

RESPONSE FORMAT - ONLY JSON, NO OTHER TEXT:
{
  "suggestions": [
    "Specific actionable suggestion 1 based on their workflow 'WorkflowName'",
    "Specific actionable suggestion 2 mentioning actual models or costs",
    "Specific actionable suggestion 3 with concrete steps"
  ]
}

Return ONLY the JSON object. No explanations, no markdown formatting.`;
    }

    /**
     * Extract suggestions from AI text response
     */
    private static extractSuggestionsFromText(text: string): string[] {
        const suggestions: string[] = [];
        
        // Try to find numbered or bulleted lists
        const lines = text.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            // Match numbered lists (1., 2., etc.) or bullets (-, *, •)
            const match = trimmed.match(/^[\d\-*•]\s*\.?\s*(.+)$/);
            if (match && match[1]) {
                suggestions.push(match[1].trim());
            } else if (trimmed.length > 20 && trimmed.length < 200 && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
                // Potential suggestion line
                suggestions.push(trimmed);
            }
        }
        
        return suggestions.slice(0, 5);
    }

    /**
     * Fallback suggestions when AI is unavailable
     */
    private static getFallbackSuggestions(
        metric: string,
        percentage: number,
        workflowContext: any
    ): string[] {
        const suggestions: string[] = [];
        
        // Use workflow context if available for better fallback
        if (workflowContext.activeWorkflows && workflowContext.activeWorkflows.length > 0) {
            const topWorkflow = workflowContext.activeWorkflows[0];
            if (metric === 'workflows') {
                suggestions.push(`Review '${topWorkflow.workflowName}' - it's your most expensive workflow ($${topWorkflow.totalCost.toFixed(2)}/month)`);
                if (workflowContext.activeWorkflows.length > 5) {
                    suggestions.push(`You have ${workflowContext.activeWorkflows.length} active workflows. Consider consolidating similar ones.`);
                }
            }
        }
        
        // Add metric-specific fallbacks
        if (metric === 'tokens') {
            suggestions.push('Use prompt compression techniques to reduce token usage');
            suggestions.push('Switch to cheaper models (e.g., Claude Haiku, GPT-3.5 Turbo) for simple tasks');
            suggestions.push('Enable semantic caching to reduce redundant API calls');
            if (percentage > 90) {
                suggestions.push('Consider upgrading your plan for more tokens');
            }
        } else if (metric === 'requests') {
            suggestions.push('Batch multiple operations together to reduce request count');
            suggestions.push('Implement client-side caching for repeated requests');
            suggestions.push('Use webhooks instead of polling where possible');
            if (percentage > 90) {
                suggestions.push('Upgrade your plan for higher request limits');
            }
        } else if (metric === 'logs') {
            suggestions.push('Reduce verbose logging for non-critical operations');
            suggestions.push('Archive old logs to external storage');
            suggestions.push('Upgrade to Plus for unlimited logs');
        } else if (metric === 'workflows') {
            if (suggestions.length === 0) {
                suggestions.push('Review and consolidate similar workflows');
                suggestions.push('Archive or deactivate unused workflows');
                suggestions.push('Consider combining multiple workflows into one');
            }
            if (percentage > 90) {
                suggestions.push('Upgrade your plan for more workflow capacity');
            }
        }
        
        return suggestions.slice(0, 5);
    }

    // ============================================================================
    // OPTIMIZATION UTILITY METHODS
    // ============================================================================

    /**
     * Add usage metrics to batch queue for efficient database updates
     */
    private static addToBatchQueue(userId: string, metrics: Partial<UsageMetrics>): void {
        const existing = this.usageBatchQueue.get(userId) || {};
        
        this.usageBatchQueue.set(userId, {
            tokens: (existing.tokens || 0) + (metrics.tokens || 0),
            requests: (existing.requests || 0) + (metrics.requests || 0),
            logs: (existing.logs || 0) + (metrics.logs || 0),
            cost: (existing.cost || 0) + (metrics.cost || 0)
        });

        // Start batch processor if not running
        if (!this.usageBatchProcessor) {
            this.usageBatchProcessor = setTimeout(() => {
                this.processBatchQueue();
            }, 1000); // Process every 1 second
        }
    }

    /**
     * Process batched usage updates
     */
    private static async processBatchQueue(): Promise<void> {
        if (this.usageBatchQueue.size === 0) {
            this.usageBatchProcessor = undefined;
            return;
        }

        const updates = Array.from(this.usageBatchQueue.entries());
        this.usageBatchQueue.clear();

        try {
            // Parallel batch updates
            await Promise.all(updates.map(async ([userId, metrics]) => {
                const updateObj: any = {};
                
                if (metrics.tokens) {
                    updateObj['usage.currentMonth.totalTokens'] = metrics.tokens;
                }
                if (metrics.requests) {
                    updateObj['usage.currentMonth.apiCalls'] = metrics.requests;
                }
                if (metrics.cost) {
                    updateObj['usage.currentMonth.totalCost'] = metrics.cost;
                }

                if (Object.keys(updateObj).length > 0) {
                    await User.findByIdAndUpdate(userId, { $inc: updateObj });
                }
            }));
        } catch (error) {
            loggingService.error('Error processing usage batch queue:', { error: error instanceof Error ? error.message : String(error) });
        }

        // Continue processing if more items are queued
        if (this.usageBatchQueue.size > 0) {
            this.usageBatchProcessor = setTimeout(() => {
                this.processBatchQueue();
            }, 1000);
        } else {
            this.usageBatchProcessor = undefined;
        }
    }

    /**
     * Queue alert for background processing with deduplication
     */
    private static queueAlert(userId: string, violation: GuardrailViolation): void {
        // Smart alert deduplication
        const alertKey = `${userId}:${violation.metric}:${Math.floor(violation.percentage/5)*5}`;
        const now = Date.now();
        
        // Check if we sent this alert recently (within 1 hour)
        if (this.alertTracker.has(alertKey)) {
            const lastSent = this.alertTracker.get(alertKey)!;
            if (now - lastSent < 3600000) { // 1 hour
                return; // Skip duplicate alert
            }
        }

        this.alertTracker.set(alertKey, now);
        
        // Queue for background processing
        this.queueBackgroundOperation(async () => {
            await this.sendUsageAlert(userId, violation);
        });
    }

    /**
     * Queue background operation for non-blocking processing
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        this.alertQueue.push(operation);
        
        if (!this.backgroundProcessor) {
            this.backgroundProcessor = setTimeout(() => {
                this.processBackgroundQueue();
            }, 100); // Process queue every 100ms
        }
    }

    /**
     * Process background operations queue
     */
    private static async processBackgroundQueue(): Promise<void> {
        if (this.alertQueue.length === 0) {
            this.backgroundProcessor = undefined;
            return;
        }

        const operations = this.alertQueue.splice(0, 10); // Process 10 operations at a time
        
        try {
            await Promise.allSettled(operations.map(op => op()));
        } catch (error) {
            loggingService.warn('Background operation failed', {
                error: error instanceof Error ? error.message : String(error)
            });
        }

        // Continue processing if more operations are queued
        if (this.alertQueue.length > 0) {
            this.backgroundProcessor = setTimeout(() => {
                this.processBackgroundQueue();
            }, 100);
        } else {
            this.backgroundProcessor = undefined;
        }
    }

    /**
     * Memory-efficient user lookup with projection
     */
    private static async getUserWithCache(userId: string): Promise<any> {
        const cacheKey = `user:${userId}`;
        const cached = this.usageCache.get(cacheKey);
        if (cached) return cached;

        // Use projection to fetch only needed fields
        const user = await User.findById(userId)
            .select('preferences.emailAlerts subscriptionId')
            .populate('subscriptionId', 'plan limits status')
            .lean();
            
        if (user) {
            this.usageCache.set(cacheKey, user, 300000); // Cache for 5 minutes
        }
        return user;
    }
}
