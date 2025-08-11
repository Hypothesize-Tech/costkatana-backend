import { logger } from '../utils/logger';
import { User } from '../models/User';
import { Project } from '../models/Project';
import { Activity } from '../models/Activity';
import { Alert } from '../models/Alert';
import { EmailService } from './email.service';
import { Response } from 'express';
import { MODEL_PRICING } from '../utils/pricing';
import { Usage } from '../models/Usage';
import mongoose from 'mongoose';

// Subscription plan limits based on costkatana.com pricing
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
     * Check if a user can make a request based on their guardrails
     */
    static async checkRequestGuardrails(
        userId: string,
        requestType: 'token' | 'request' | 'log',
        amount: number = 1,
        modelId?: string
    ): Promise<GuardrailViolation | null> {
        try {
            // Get user with subscription info
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

            // Get plan limits
            const planName = user.subscription?.plan || 'free';
            const planLimits = this.SUBSCRIPTION_PLANS[planName];
            
            if (!planLimits) {
                logger.error('Unknown subscription plan:', planName);
                return null;
            }

            // Check model access for free tier
            if (modelId && planName === 'free') {
                if (!planLimits.models.includes(modelId)) {
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
                            `Available models for free tier: ${planLimits.models.join(', ')}`
                        ]
                    };
                }
            }

            // Get current usage
            const usage = await this.getCurrentUsage(userId);
            
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
                    const violation: GuardrailViolation = {
                        type: 'warning',
                        metric: metricName,
                        current: currentValue,
                        limit: limitValue,
                        percentage,
                        message: `${threshold}% of monthly ${metricName} limit reached`,
                        action: 'allow',
                        suggestions: this.getOptimizationSuggestions(metricName, percentage)
                    };

                    // Send alert if crossing threshold for first time
                    await this.sendUsageAlert(userId, violation);
                    
                    return violation;
                }
            }

            // Soft throttling at 80% for free tier
            if (planName === 'free' && percentage >= 80) {
                return {
                    type: 'soft',
                    metric: metricName,
                    current: currentValue,
                    limit: limitValue,
                    percentage,
                    message: `Approaching ${metricName} limit - throttling enabled`,
                    action: 'throttle',
                    suggestions: this.getOptimizationSuggestions(metricName, percentage)
                };
            }

            return null;
        } catch (error) {
            logger.error('Error checking guardrails:', error);
            return null;
        }
    }

    /**
     * Track usage for a user
     */
    static async trackUsage(
        userId: string,
        metrics: Partial<UsageMetrics>,
        modelId?: string
    ): Promise<void> {
        try {
            const user = await User.findById(userId);
            if (!user) return;

            // Calculate cost if not provided but tokens are available
            let calculatedCost = metrics.cost || 0;
            if (!calculatedCost && metrics.tokens && modelId) {
                // Estimate input/output split (rough estimate)
                const inputTokens = Math.floor(metrics.tokens * 0.6);
                const outputTokens = Math.floor(metrics.tokens * 0.4);
                calculatedCost = this.calculateTokenCost(modelId, inputTokens, outputTokens);
            }

            // Update monthly usage
            const updates: any = {};
            
            if (metrics.tokens) {
                updates['usage.currentMonth.totalTokens'] = 
                    (user.usage?.currentMonth?.totalTokens || 0) + metrics.tokens;
            }
            
            if (metrics.requests) {
                updates['usage.currentMonth.apiCalls'] = 
                    (user.usage?.currentMonth?.apiCalls || 0) + metrics.requests;
            }
            
            if (calculatedCost > 0) {
                updates['usage.currentMonth.totalCost'] = 
                    (user.usage?.currentMonth?.totalCost || 0) + calculatedCost;
            }

            await User.findByIdAndUpdate(userId, { $inc: updates });

            // Clear cache
            this.usageCache.delete(`user:${userId}`);
            this.usageCache.delete(`usage:${userId}`);

            // Log activity
            await Activity.create({
                userId,
                type: 'api_call',
                title: 'Usage Tracked',
                description: `Usage tracked: ${JSON.stringify({ ...metrics, calculatedCost })}`,
                metadata: { ...metrics, calculatedCost, modelId }
            });

            // Check for violations after update
            if (metrics.tokens) {
                await this.checkRequestGuardrails(userId, 'token', 0);
            }
            if (metrics.requests) {
                await this.checkRequestGuardrails(userId, 'request', 0);
            }
        } catch (error) {
            logger.error('Error tracking usage:', error);
        }
    }

    /**
     * Get current usage for a user
     */
    static async getCurrentUsage(userId: string): Promise<UsageMetrics> {
        try {
            // Check cache first
            const cacheKey = `usage:${userId}`;
            const cached = this.usageCache.get(cacheKey);
            logger.info(`Cache lookup for ${cacheKey}: ${cached ? 'Hit' : 'Miss'}`);
            if (cached) return cached;

            const user = await User.findById(userId);
            logger.info(`User lookup for ${userId}: ${user ? 'Found' : 'Not found'}`);
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

            // Count projects and workflows
            const projectCount = await Project.countDocuments({
                $or: [
                    { ownerId: new mongoose.Types.ObjectId(userId) },
                    { 'members.userId': new mongoose.Types.ObjectId(userId) }
                ],
                isActive: true
            });
            
            // Debug logging for projects
            logger.info(`Project count for user ${userId}: ${projectCount}`);
            
            // Count unique workflows for the user this month
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);
            
            const workflowCount = await Usage.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        workflowId: { $exists: true, $ne: null },
                        createdAt: { $gte: startOfMonth }
                    }
                },
                {
                    $group: {
                        _id: '$workflowId'
                    }
                },
                {
                    $count: 'totalWorkflows'
                }
            ]).then(result => result[0]?.totalWorkflows || 0);

            // Count logs (activities)
            
            const logCount = await Activity.countDocuments({
                userId,
                createdAt: { $gte: startOfMonth }
            });

            // Get real usage data from Usage collection for current month
            
            const realUsageData = await Usage.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
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
            ]);

            const realTokens = realUsageData[0]?.totalTokens || 0;
            const realCost = realUsageData[0]?.totalCost || 0;
            const realRequests = realUsageData[0]?.requestCount || 0;

            const usage: UsageMetrics = {
                tokens: realTokens,
                requests: realRequests,
                logs: logCount,
                projects: projectCount,
                workflows: workflowCount,
                cost: realCost,
                period: 'monthly'
            };

            // Cache for 1 minute
            this.usageCache.set(cacheKey, usage, 60000);

            return usage;
        } catch (error) {
            logger.error('Error getting current usage:', error);
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
     * Clear cache for a specific user (for testing/debugging)
     */
    static clearUserCache(userId: string): void {
        this.usageCache.delete(`user:${userId}`);
        this.usageCache.delete(`usage:${userId}`);
        logger.info(`Cache cleared for user ${userId}`);
    }

    /**
     * Reset monthly usage for all users
     */
    static async resetMonthlyUsage(): Promise<void> {
        try {
            logger.info('Resetting monthly usage for all users');
            
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
            
            logger.info('Monthly usage reset completed');
        } catch (error) {
            logger.error('Error resetting monthly usage:', error);
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
            const planName = user.subscription?.plan || 'free';
            const planLimits = this.SUBSCRIPTION_PLANS[planName];

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
                limits: planLimits,
                percentages,
                dailyTrend: dailyUsage,
                predictions,
                plan: planName,
                recommendations: this.generateRecommendations(usage, planLimits, percentages)
            };
        } catch (error) {
            logger.error('Error getting user usage stats:', error);
            return null;
        }
    }

    /**
     * Middleware to enforce guardrails on requests
     */
    static async enforceGuardrails(req: any, res: Response, next: Function): Promise<void> {
        try {
            const userId = req.user?.id || req.gatewayContext?.userId;
            if (!userId) {
                return next();
            }

            // Estimate tokens for the request (simplified)
            const estimatedTokens = GuardrailsService.estimateRequestTokens(req);
            
            // Check guardrails
            const violation = await GuardrailsService.checkRequestGuardrails(
                userId, 
                'request', 
                1,
                req.body?.model
            );

            if (violation) {
                // Add headers for client awareness
                res.setHeader('X-Guardrail-Status', violation.type);
                res.setHeader('X-Guardrail-Metric', violation.metric);
                res.setHeader('X-Guardrail-Percentage', violation.percentage.toFixed(2));

                switch (violation.action) {
                    case 'block':
                        res.status(429).json({
                            success: false,
                            error: 'Usage limit exceeded',
                            violation,
                            upgradeUrl: 'https://costkatana.com/pricing'
                        });
                        return;
                    
                    case 'throttle':
                        // Add artificial delay for free tier throttling
                        const delay = Math.min(5000, violation.percentage * 50);
                        await new Promise(resolve => setTimeout(resolve, delay));
                        break;
                }
            }

            // Check token limits
            const tokenViolation = await GuardrailsService.checkRequestGuardrails(
                userId,
                'token',
                estimatedTokens,
                req.body?.model
            );

            if (tokenViolation?.action === 'block') {
                res.status(429).json({
                    success: false,
                    error: 'Token limit exceeded',
                    violation: tokenViolation,
                    upgradeUrl: 'https://costkatana.com/pricing'
                });
                return;
            }

            // Track the request
            await GuardrailsService.trackUsage(userId, {
                requests: 1,
                tokens: estimatedTokens
            });

            next();
        } catch (error) {
            logger.error('Error enforcing guardrails:', error);
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
                    logger.error('Failed to send usage alert email:', emailError);
                }
            }
        } catch (error) {
            logger.error('Error sending usage alert:', error);
        }
    }

    /**
     * Get user with cache
     */
    private static async getUserWithCache(userId: string): Promise<any> {
        const cacheKey = `user:${userId}`;
        const cached = this.usageCache.get(cacheKey);
        if (cached) return cached;

        const user = await User.findById(userId);
        if (user) {
            this.usageCache.set(cacheKey, user, 300000); // Cache for 5 minutes
        }
        return user;
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
            const modelPricing = MODEL_PRICING.find(p => 
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
            logger.error('Error calculating token cost:', error);
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
                suggestions.push('Upgrade to Plus plan for 10x more tokens and requests');
                suggestions.push('Plus plan includes unlimited logs and projects');
                suggestions.push('Get access to all AI models with Plus or Pro');
                break;
            case 'plus':
                suggestions.push('Upgrade to Pro plan for 50% more tokens per seat');
                suggestions.push('Pro plan includes 20 seats at a flat rate');
                suggestions.push('Get priority support with Pro plan');
                break;
            case 'pro':
                suggestions.push('Contact sales for Enterprise plan with unlimited usage');
                suggestions.push('Enterprise includes custom integrations and SLA');
                break;
        }
        
        suggestions.push(`Current ${metric} usage can be optimized - check recommendations`);
        suggestions.push('Visit https://costkatana.com/pricing for plan details');
        
        return suggestions;
    }

    /**
     * Get optimization suggestions
     */
    private static getOptimizationSuggestions(
        metric: string, 
        percentage: number
    ): string[] {
        const suggestions = [];
        
        if (metric === 'tokens') {
            suggestions.push('Use prompt compression techniques');
            suggestions.push('Switch to cheaper models for simple tasks');
            suggestions.push('Enable semantic caching to reduce redundant calls');
            if (percentage > 90) {
                suggestions.push('Consider upgrading your plan for more tokens');
            }
        } else if (metric === 'requests') {
            suggestions.push('Batch multiple operations together');
            suggestions.push('Implement client-side caching');
            suggestions.push('Use webhooks instead of polling');
            if (percentage > 90) {
                suggestions.push('Upgrade your plan for higher request limits');
            }
        } else if (metric === 'logs') {
            suggestions.push('Reduce verbose logging for non-critical operations');
            suggestions.push('Archive old logs to external storage');
            suggestions.push('Upgrade to Plus for unlimited logs');
        }
        
        return suggestions;
    }
}
