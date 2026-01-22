import { Request, Response, NextFunction } from 'express';
import { GuardrailsService } from '../services/guardrails.service';
import { loggingService } from '../services/logging.service';
import { z } from 'zod';
import mongoose from 'mongoose';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';


// Validation schemas
const checkGuardrailsSchema = z.object({
    requestType: z.enum(['token', 'request', 'log']),
    amount: z.number().positive().optional(),
    modelId: z.string().optional()
});

const trackUsageSchema = z.object({
    tokens: z.number().min(0).optional(),
    requests: z.number().min(0).optional(),
    logs: z.number().min(0).optional(),
    cost: z.number().min(0).optional()
});

const updateSubscriptionSchema = z.object({
    plan: z.enum(['free', 'plus', 'pro', 'enterprise']),
    seats: z.number().min(1).optional()
});

export class GuardrailsController {
    /**
     * Get current usage statistics for the authenticated user
     */
    static async getUserUsage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getUserUsage', req);

        try {
            const stats = await GuardrailsService.getUserUsageStats(userId);
            
            if (!stats) {
                loggingService.warn('User usage statistics not found', {
                    userId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }

            ControllerHelper.logRequestSuccess('getUserUsage', req, startTime, { hasStats: !!stats });

            // Log business event
            loggingService.logBusiness({
                event: 'user_usage_statistics_retrieved',
                category: 'guardrails_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    hasStats: !!stats
                }
            });

            res.json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            ControllerHelper.handleError('getUserUsage', error, req, res, startTime);
            next(error);
        }
    }

    /**
     * Check if a specific request would violate guardrails
     */
    static async checkGuardrails(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        const { requestType, amount, modelId } = checkGuardrailsSchema.parse(req.body);
        
        ControllerHelper.logRequestStart('checkGuardrails', req, { requestType, amount, modelId });

        try {
            const violation = await GuardrailsService.checkRequestGuardrails(
                userId,
                requestType,
                amount || 1,
                modelId
            );

            ControllerHelper.logRequestSuccess('checkGuardrails', req, startTime, {
                requestType,
                amount,
                modelId,
                hasViolation: !!violation,
                violationAction: violation?.action,
                isAllowed: !violation || violation.action === 'allow'
            });

            // Log business event
            loggingService.logBusiness({
                event: 'guardrails_check_completed',
                category: 'guardrails_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    requestType,
                    amount,
                    modelId,
                    hasViolation: !!violation,
                    violationAction: violation?.action,
                    isAllowed: !violation || violation.action === 'allow'
                }
            });

            res.json({
                success: true,
                data: {
                    allowed: !violation || violation.action === 'allow',
                    violation
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('checkGuardrails', error, req, res, startTime, { requestType, amount, modelId });
            next(error);
        }
    }

    /**
     * Manually track usage (for testing or manual adjustments)
     */
    static async trackUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const metrics = trackUsageSchema.parse(req.body);
        const targetUserId = req.params.userId || userId;

        try {
            loggingService.info('Manual usage tracking initiated', {
                userId,
                hasUserId: !!userId,
                targetUserId,
                metrics,
                hasMetrics: !!metrics,
                userRole: req.user?.role,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Manual usage tracking failed - authentication required', {
                    targetUserId,
                    metrics,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // Only allow admins to manually track usage
            if (req.user?.role !== 'admin') {
                loggingService.warn('Manual usage tracking failed - admin access required', {
                    userId,
                    userRole: req.user?.role,
                    targetUserId,
                    metrics,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(403).json({
                    success: false,
                    message: 'Admin access required'
                });
                return;
            }

            loggingService.info('Manual usage tracking processing started', {
                userId,
                targetUserId,
                metrics,
                requestId: req.headers['x-request-id'] as string
            });

            await GuardrailsService.trackUsage(targetUserId, metrics);

            const duration = Date.now() - startTime;

            loggingService.info('Manual usage tracking completed successfully', {
                userId,
                targetUserId,
                metrics,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'manual_usage_tracking_completed',
                category: 'guardrails_operations',
                value: duration,
                metadata: {
                    userId,
                    targetUserId,
                    metrics
                }
            });

            res.json({
                success: true,
                message: 'Usage tracked successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Manual usage tracking failed', {
                userId,
                targetUserId,
                metrics,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    /**
     * Get usage limits for a subscription plan
     */
    static async getPlanLimits(req: Request, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const plan = req.params.plan || 'free';

        ControllerHelper.logRequestStart('getPlanLimits', req as AuthenticatedRequest, { plan });

        try {
            const limits = {
                free: {
                    tokensPerMonth: 1_000_000,
                    requestsPerMonth: 5_000,
                    logsPerMonth: 5_000,
                    projects: 1,
                    workflows: 10,
                    seats: 1,
                    cortexDailyUsage: 0,
                    models: ['claude-3-haiku', 'gpt-3.5-turbo', 'gemini-1.5-flash'],
                    price: 0
                },
                plus: {
                    tokensPerMonth: 2_000_000,
                    requestsPerMonth: 10_000,
                    logsPerMonth: 'unlimited',
                    projects: 'unlimited',
                    workflows: 100,
                    seats: 1,
                    cortexDailyUsage: 0,
                    models: 'all',
                    price: 25
                },
                pro: {
                    tokensPerMonth: 5_000_000,
                    requestsPerMonth: 50_000,
                    logsPerMonth: 'unlimited',
                    projects: 'unlimited',
                    workflows: 100,
                    seats: 20,
                    cortexDailyUsage: 0,
                    models: 'all',
                    price: 499
                },
                enterprise: {
                    tokensPerMonth: 'unlimited',
                    requestsPerMonth: 'unlimited',
                    logsPerMonth: 'unlimited',
                    projects: 'unlimited',
                    workflows: 'unlimited',
                    seats: 'custom',
                    cortexDailyUsage: 'unlimited',
                    models: 'all + custom',
                    price: 'custom'
                }
            };

            if (!limits[plan as keyof typeof limits]) {
                loggingService.warn('Plan limits retrieval failed - invalid plan', {
                    plan,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Invalid plan'
                });
                return;
            }

            ControllerHelper.logRequestSuccess('getPlanLimits', req as AuthenticatedRequest, startTime, {
                plan,
                hasLimits: !!limits[plan as keyof typeof limits]
            });

            // Log business event
            loggingService.logBusiness({
                event: 'plan_limits_retrieved',
                category: 'guardrails_operations',
                value: Date.now() - startTime,
                metadata: {
                    plan,
                    hasLimits: !!limits[plan as keyof typeof limits]
                }
            });

            res.json({
                success: true,
                data: limits[plan as keyof typeof limits]
            });
        } catch (error: any) {
            ControllerHelper.handleError('getPlanLimits', error, req as AuthenticatedRequest, res, startTime, { plan });
            next(error);
        }
    }

    /**
     * Update user subscription plan
     */
    static async updateSubscription(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        const { plan, seats } = updateSubscriptionSchema.parse(req.body);
        
        ControllerHelper.logRequestStart('updateSubscription', req, { plan, seats });

        try {

            // Define plan limits
            const planLimits = {
                free: {
                    apiCalls: 10000,
                    optimizations: 10,
                    tokensPerMonth: 1000000,
                    logsPerMonth: 15000,
                    projects: 5,
                    workflows: 10
                },
                plus: {
                    apiCalls: 50000,
                    optimizations: 100,
                    tokensPerMonth: 10000000,
                    logsPerMonth: -1, // Unlimited
                    projects: -1,
                    workflows: 100
                },
                pro: {
                    apiCalls: 100000,
                    optimizations: 1000,
                    tokensPerMonth: 15000000,
                    logsPerMonth: -1,
                    projects: -1,
                    workflows: 100
                },
                enterprise: {
                    apiCalls: -1,
                    optimizations: -1,
                    tokensPerMonth: -1,
                    logsPerMonth: -1,
                    projects: -1,
                    workflows: -1
                }
            };

            // Calculate billing
            const billingAmounts = {
                free: 0,
                plus: seats ? seats * 25 : 25,
                pro: 399,
                enterprise: 0 // Custom pricing
            };

            const User = require('../models/User').User;
            const user = await User.findByIdAndUpdate(
                userId,
                {
                    'subscription.plan': plan,
                    'subscription.seats': seats || (plan === 'pro' ? 20 : 1),
                    'subscription.limits': planLimits[plan],
                    'subscription.billing.amount': billingAmounts[plan],
                    'subscription.billing.nextBillingDate': plan !== 'free' 
                        ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) 
                        : undefined,
                    'subscription.startDate': new Date()
                },
                { new: true }
            ).select('subscription');

            if (!user) {
                loggingService.warn('Subscription update failed - user not found', {
                    userId,
                    plan,
                    seats,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }

            // Log the subscription change
            const Activity = require('../models/Activity').Activity;
            await Activity.create({
                userId,
                type: 'subscription_changed',
                title: 'Subscription Updated',
                description: `Subscription updated to ${plan} plan`,
                metadata: {
                    oldPlan: req.user.subscription?.plan,
                    newPlan: plan,
                    seats
                }
            });

            ControllerHelper.logRequestSuccess('updateSubscription', req, startTime, {
                plan,
                seats,
                oldPlan: req.user?.subscription?.plan,
                newPlan: plan,
                hasUser: !!user
            });

            // Log business event
            loggingService.logBusiness({
                event: 'subscription_updated',
                category: 'guardrails_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    oldPlan: req.user?.subscription?.plan,
                    newPlan: plan,
                    seats,
                    hasUser: !!user
                }
            });

            res.json({
                success: true,
                message: 'Subscription updated successfully',
                data: user.subscription
            });
        } catch (error: any) {
            ControllerHelper.handleError('updateSubscription', error, req, res, startTime, { plan, seats });
            next(error);
        }
    }

    /**
     * Get usage alerts for the authenticated user
     */
    static async getUsageAlerts(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getUsageAlerts', req);

        try {
            const Alert = require('../models/Alert').Alert;
            const alerts = await Alert.find({
                userId,
                type: 'usage_warning',
                read: false
            })
            .sort('-createdAt')
            .limit(10);

            ControllerHelper.logRequestSuccess('getUsageAlerts', req, startTime, {
                alertsCount: alerts.length,
                hasAlerts: !!alerts && alerts.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'usage_alerts_retrieved',
                category: 'guardrails_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    alertsCount: alerts.length,
                    hasAlerts: !!alerts && alerts.length > 0
                }
            });

            res.json({
                success: true,
                data: alerts
            });
        } catch (error: any) {
            ControllerHelper.handleError('getUsageAlerts', error, req, res, startTime);
            next(error);
        }
    }

    /**
     * Reset monthly usage (admin only)
     */
    static async resetMonthlyUsage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('resetMonthlyUsage', req);

        try {
            // Only allow admins
            if (!ControllerHelper.requirePermission(req, res, (user) => user?.role === 'admin')) {
                return;
            }

            await GuardrailsService.resetMonthlyUsage();

            ControllerHelper.logRequestSuccess('resetMonthlyUsage', req, startTime, {
                userRole: req.user?.role
            });

            // Log business event
            loggingService.logBusiness({
                event: 'monthly_usage_reset_completed',
                category: 'guardrails_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    userRole: req.user?.role
                }
            });

            res.json({
                success: true,
                message: 'Monthly usage reset successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('resetMonthlyUsage', error, req, res, startTime);
            next(error);
        }
    }

        /**
     * Get usage trend for the authenticated user
     */
    static async getUsageTrend(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        const days = parseInt(req.query.days as string) || 7;
        
        ControllerHelper.logRequestStart('getUsageTrend', req, { days });

        try {

            const Usage = require('../models/Usage').Usage;
            
            // Optimized: Single aggregation query for entire date range
            const today = new Date();
            const startDate = new Date(today);
            startDate.setDate(startDate.getDate() - (days - 1));
            startDate.setHours(0, 0, 0, 0);
            
            const endDate = new Date(today);
            endDate.setHours(23, 59, 59, 999);

            // Generate date boundaries for bucketing
            const dateBoundaries = [];
            for (let i = 0; i < days; i++) {
                const date = new Date(startDate);
                date.setDate(date.getDate() + i);
                dateBoundaries.push(date.toISOString().split('T')[0]);
            }

            // Single aggregation query with date bucketing
            const trendData = await Usage.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        createdAt: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $group: {
                        _id: {
                            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
                        },
                        requests: { $sum: 1 },
                        tokens: { $sum: '$totalTokens' },
                        cost: { $sum: '$cost' }
                    }
                },
                {
                    $sort: { _id: 1 }
                }
            ]);

            // Create lookup map for O(1) access
            const dataMap = new Map(
                trendData.map((item: any) => [item._id, {
                    requests: item.requests,
                    tokens: item.tokens,
                    cost: item.cost
                }])
            );

            // Build trend array with all dates (including zeros)
            const trend = dateBoundaries.map(dateStr => {
                const data = dataMap.get(dateStr) as { requests: number; tokens: number; cost: number } | undefined;
                return {
                    date: dateStr,
                    requests: data?.requests || 0,
                    tokens: data?.tokens || 0,
                    cost: data?.cost || 0
                };
            });

            ControllerHelper.logRequestSuccess('getUsageTrend', req, startTime, {
                days,
                trendLength: trend.length,
                hasTrend: !!trend && trend.length > 0
            });

            // Log business event
            loggingService.logBusiness({
                event: 'usage_trend_retrieved',
                category: 'guardrails_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    days,
                    trendLength: trend.length,
                    hasTrend: !!trend && trend.length > 0
                }
            });

            res.json({
                success: true,
                data: trend
            });
        } catch (error: any) {
            ControllerHelper.handleError('getUsageTrend', error, req, res, startTime, { days });
            next(error);
        }
    }

    /**
     * Get usage trend by date range for the authenticated user
     */
    static async getUsageTrendByDateRange(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        const { startDate, endDate } = req.query;
        
        ControllerHelper.logRequestStart('getUsageTrendByDateRange', req, { startDate, endDate });

        try {

            if (!startDate || !endDate) {
                loggingService.warn('Usage trend by date range retrieval failed - missing dates', {
                    userId,
                    startDate,
                    endDate,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Start date and end date are required'
                });
                return;
            }

            const start = new Date(startDate as string);
            const end = new Date(endDate as string);
            
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                loggingService.warn('Usage trend by date range retrieval failed - invalid date format', {
                    userId,
                    startDate,
                    endDate,
                    start,
                    end,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Invalid date format'
                });
                return;
            }

            loggingService.info('Usage trend by date range retrieval processing started', {
                userId,
                startDate,
                endDate,
                start,
                end,
                requestId: req.headers['x-request-id'] as string
            });

            const Activity = require('../models/Activity').Activity;
            const Usage = require('../models/Usage').Usage;
            
            // Optimized: Single aggregation query for entire date range
            const adjustedStart = new Date(start);
            adjustedStart.setHours(0, 0, 0, 0);
            const adjustedEnd = new Date(end);
            adjustedEnd.setHours(23, 59, 59, 999);

            // Generate all dates in range
            const dateArray = [];
            const currentDate = new Date(adjustedStart);
            while (currentDate <= adjustedEnd) {
                dateArray.push(currentDate.toISOString().split('T')[0]);
                currentDate.setDate(currentDate.getDate() + 1);
            }

            // Parallel aggregation queries for activities and usage
            const [activitiesData, usageData] = await Promise.all([
                Activity.aggregate([
                    {
                        $match: {
                            userId: userId,
                            createdAt: { $gte: adjustedStart, $lte: adjustedEnd }
                        }
                    },
                    {
                        $group: {
                            _id: {
                                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
                            },
                            requests: { $sum: 1 },
                            tokens: { $sum: '$metadata.tokens' },
                            cost: { $sum: '$metadata.cost' }
                        }
                    }
                ]),
                Usage.aggregate([
                    {
                        $match: {
                            userId: userId,
                            createdAt: { $gte: adjustedStart, $lte: adjustedEnd }
                        }
                    },
                    {
                        $group: {
                            _id: {
                                $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
                            },
                            totalTokens: { $sum: '$totalTokens' },
                            totalCost: { $sum: '$cost' }
                        }
                    }
                ])
            ]);

            // Create lookup maps for O(1) access
            const activitiesMap = new Map(
                activitiesData.map((item: any) => [item._id, {
                    requests: item.requests || 0,
                    tokens: item.tokens || 0,
                    cost: item.cost || 0
                }])
            );

            const usageMap = new Map(
                usageData.map((item: any) => [item._id, {
                    tokens: item.totalTokens || 0,
                    cost: item.totalCost || 0
                }])
            );

            // Build trend array combining both data sources
            const trend = dateArray.map(dateStr => {
                const activityData = activitiesMap.get(dateStr) as { requests: number; tokens: number; cost: number } | undefined;
                const usageDataForDate = usageMap.get(dateStr) as { tokens: number; cost: number } | undefined;
                
                return {
                    date: dateStr,
                    requests: activityData?.requests || 0,
                    tokens: (activityData?.tokens || 0) + (usageDataForDate?.tokens || 0),
                    cost: (activityData?.cost || 0) + (usageDataForDate?.cost || 0)
                };
            });

            const duration = Date.now() - startTime;

            loggingService.info('Usage trend by date range retrieved successfully', {
                userId,
                startDate,
                endDate,
                duration,
                trendLength: trend.length,
                hasTrend: !!trend && trend.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'usage_trend_by_date_range_retrieved',
                category: 'guardrails_operations',
                value: duration,
                metadata: {
                    userId,
                    startDate,
                    endDate,
                    trendLength: trend.length,
                    hasTrend: !!trend && trend.length > 0
                }
            });

            res.json({
                success: true,
                data: trend
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Usage trend by date range retrieval failed', {
                userId,
                startDate,
                endDate,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }

    /**
     * Simulate usage for testing (admin only)
     */
    static async simulateUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const { userId: targetUserId, percentage } = req.body;
        const finalTargetUserId = targetUserId || userId;

        try {
            loggingService.info('Usage simulation initiated', {
                userId,
                hasUserId: !!userId,
                targetUserId,
                finalTargetUserId,
                percentage,
                hasPercentage: !!percentage,
                userRole: req.user?.role,
                nodeEnv: process.env.NODE_ENV,
                requestId: req.headers['x-request-id'] as string
            });

            // Only allow admins in development
            if (req.user?.role !== 'admin' || process.env.NODE_ENV === 'production') {
                loggingService.warn('Usage simulation failed - not available in production', {
                    userId,
                    userRole: req.user?.role,
                    nodeEnv: process.env.NODE_ENV,
                    targetUserId,
                    percentage,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(403).json({
                    success: false,
                    message: 'Not available in production'
                });
                return;
            }

            loggingService.info('Usage simulation processing started', {
                userId,
                finalTargetUserId,
                percentage,
                userRole: req.user?.role,
                requestId: req.headers['x-request-id'] as string
            });

            // Get user's plan limits
            const User = require('../models/User').User;
            const user = await User.findById(finalTargetUserId);
            
            if (!user) {
                loggingService.warn('Usage simulation failed - target user not found', {
                    userId,
                    finalTargetUserId,
                    percentage,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }

            const limits = user.subscription?.limits || {
                tokensPerMonth: 1000000,
                apiCalls: 10000
            };

            // Simulate usage to the specified percentage
            const simulatedUsage = {
                tokens: Math.floor(limits.tokensPerMonth * (percentage / 100)),
                requests: Math.floor(limits.apiCalls * (percentage / 100)),
                cost: Math.floor(100 * (percentage / 100))
            };

            await GuardrailsService.trackUsage(finalTargetUserId, simulatedUsage);

            const duration = Date.now() - startTime;

            loggingService.info('Usage simulation completed successfully', {
                userId,
                finalTargetUserId,
                percentage,
                duration,
                simulatedUsage,
                hasUser: !!user,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'usage_simulation_completed',
                category: 'guardrails_operations',
                value: duration,
                metadata: {
                    userId,
                    finalTargetUserId,
                    percentage,
                    simulatedUsage,
                    hasUser: !!user
                }
            });

            res.json({
                success: true,
                message: `Simulated ${percentage}% usage for user`,
                data: simulatedUsage
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Usage simulation failed', {
                userId,
                targetUserId,
                finalTargetUserId,
                percentage,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            next(error);
        }
    }
}
