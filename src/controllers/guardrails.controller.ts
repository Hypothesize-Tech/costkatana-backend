import { Request, Response, NextFunction } from 'express';
import { GuardrailsService } from '../services/guardrails.service';
import { logger } from '../utils/logger';
import { z } from 'zod';
import mongoose from 'mongoose';


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
    static async getUserUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const stats = await GuardrailsService.getUserUsageStats(userId);
            
            if (!stats) {
                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }

            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            logger.error('Error getting user usage:', error);
            next(error);
        }
    }

    /**
     * Check if a specific request would violate guardrails
     */
    static async checkGuardrails(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const { requestType, amount, modelId } = checkGuardrailsSchema.parse(req.body);

            const violation = await GuardrailsService.checkRequestGuardrails(
                userId,
                requestType,
                amount || 1,
                modelId
            );

            res.json({
                success: true,
                data: {
                    allowed: !violation || violation.action === 'allow',
                    violation
                }
            });
        } catch (error) {
            logger.error('Error checking guardrails:', error);
            next(error);
        }
    }

    /**
     * Manually track usage (for testing or manual adjustments)
     */
    static async trackUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // Only allow admins to manually track usage
            if (req.user?.role !== 'admin') {
                res.status(403).json({
                    success: false,
                    message: 'Admin access required'
                });
                return;
            }

            const metrics = trackUsageSchema.parse(req.body);
            const targetUserId = req.params.userId || userId;

            await GuardrailsService.trackUsage(targetUserId, metrics);

            res.json({
                success: true,
                message: 'Usage tracked successfully'
            });
        } catch (error) {
            logger.error('Error tracking usage:', error);
            next(error);
        }
    }

    /**
     * Get usage limits for a subscription plan
     */
    static async getPlanLimits(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const plan = req.params.plan || 'free';
            
            const limits = {
                free: {
                    tokensPerMonth: 1_000_000,
                    requestsPerMonth: 10_000,
                    logsPerMonth: 15_000,
                    projects: 5,
                    workflows: 10,
                    seats: 1,
                    models: ['claude-3-haiku', 'gpt-3.5-turbo', 'gemini-1.5-flash'],
                    price: 0
                },
                plus: {
                    tokensPerMonth: 10_000_000,
                    requestsPerMonth: 50_000,
                    logsPerMonth: 'unlimited',
                    projects: 'unlimited',
                    workflows: 100,
                    seats: 'per-seat pricing',
                    models: 'all',
                    price: 25
                },
                pro: {
                    tokensPerMonth: 15_000_000,
                    requestsPerMonth: 100_000,
                    logsPerMonth: 'unlimited',
                    projects: 'unlimited',
                    workflows: 100,
                    seats: 20,
                    models: 'all',
                    price: 399
                },
                enterprise: {
                    tokensPerMonth: 'unlimited',
                    requestsPerMonth: 'unlimited',
                    logsPerMonth: 'unlimited',
                    projects: 'unlimited',
                    workflows: 'unlimited',
                    seats: 'custom',
                    models: 'all + custom',
                    price: 'custom'
                }
            };

            if (!limits[plan as keyof typeof limits]) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid plan'
                });
                return;
            }

            res.json({
                success: true,
                data: limits[plan as keyof typeof limits]
            });
        } catch (error) {
            logger.error('Error getting plan limits:', error);
            next(error);
        }
    }

    /**
     * Update user subscription plan
     */
    static async updateSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const { plan, seats } = updateSubscriptionSchema.parse(req.body);

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

            res.json({
                success: true,
                message: 'Subscription updated successfully',
                data: user.subscription
            });
        } catch (error) {
            logger.error('Error updating subscription:', error);
            next(error);
        }
    }

    /**
     * Get usage alerts for the authenticated user
     */
    static async getUsageAlerts(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const Alert = require('../models/Alert').Alert;
            const alerts = await Alert.find({
                userId,
                type: 'usage_warning',
                read: false
            })
            .sort('-createdAt')
            .limit(10);

            res.json({
                success: true,
                data: alerts
            });
        } catch (error) {
            logger.error('Error getting usage alerts:', error);
            next(error);
        }
    }

    /**
     * Reset monthly usage (admin only)
     */
    static async resetMonthlyUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            // Only allow admins
            if (req.user?.role !== 'admin') {
                res.status(403).json({
                    success: false,
                    message: 'Admin access required'
                });
                return;
            }

            await GuardrailsService.resetMonthlyUsage();

            res.json({
                success: true,
                message: 'Monthly usage reset successfully'
            });
        } catch (error) {
            logger.error('Error resetting monthly usage:', error);
            next(error);
        }
    }

        /**
     * Get usage trend for the authenticated user
     */
    static async getUsageTrend(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const days = parseInt(req.query.days as string) || 7;
            const Usage = require('../models/Usage').Usage;
            
            const trend = [];
            const today = new Date();
            
            for (let i = days - 1; i >= 0; i--) {
                const date = new Date(today);
                date.setDate(date.getDate() - i);
                date.setHours(0, 0, 0, 0);
                
                const nextDate = new Date(date);
                nextDate.setDate(nextDate.getDate() + 1);
                
                // Get real usage data for the day from Usage collection
                const usageData = await Usage.aggregate([
                    {
                        $match: {
                            userId: new mongoose.Types.ObjectId(userId),
                            createdAt: { $gte: date, $lt: nextDate }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            requests: { $sum: 1 },
                            totalTokens: { $sum: '$totalTokens' },
                            totalCost: { $sum: '$cost' }
                        }
                    }
                ]);
                
                trend.push({
                    date: date.toISOString().split('T')[0],
                    requests: usageData[0]?.requests || 0,
                    tokens: usageData[0]?.totalTokens || 0,
                    cost: usageData[0]?.totalCost || 0
                });
            }

            res.json({
                success: true,
                data: trend
            });
        } catch (error) {
            logger.error('Error getting usage trend:', error);
            next(error);
        }
    }

    /**
     * Get usage trend by date range for the authenticated user
     */
    static async getUsageTrendByDateRange(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const { startDate, endDate } = req.query;
            if (!startDate || !endDate) {
                res.status(400).json({
                    success: false,
                    message: 'Start date and end date are required'
                });
                return;
            }

            const start = new Date(startDate as string);
            const end = new Date(endDate as string);
            
            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid date format'
                });
                return;
            }

            const Activity = require('../models/Activity').Activity;
            const Usage = require('../models/Usage').Usage;
            
            const trend = [];
            const currentDate = new Date(start);
            
            while (currentDate <= end) {
                const date = new Date(currentDate);
                date.setHours(0, 0, 0, 0);
                
                const nextDate = new Date(date);
                nextDate.setDate(nextDate.getDate() + 1);
                
                // Get activities for the day
                const activities = await Activity.aggregate([
                    {
                        $match: {
                            userId: userId,
                            createdAt: { $gte: date, $lt: nextDate }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            requests: { $sum: 1 },
                            tokens: { $sum: '$metadata.tokens' },
                            cost: { $sum: '$metadata.cost' }
                        }
                    }
                ]);
                
                // Get usage data for the day
                const usageData = await Usage.aggregate([
                    {
                        $match: {
                            userId: userId,
                            createdAt: { $gte: date, $lt: nextDate }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            totalTokens: { $sum: '$totalTokens' },
                            totalCost: { $sum: '$totalCost' }
                        }
                    }
                ]);
                
                trend.push({
                    date: date.toISOString().split('T')[0],
                    requests: activities[0]?.requests || 0,
                    tokens: (activities[0]?.tokens || 0) + (usageData[0]?.totalTokens || 0),
                    cost: (activities[0]?.cost || 0) + (usageData[0]?.totalCost || 0)
                });
                
                currentDate.setDate(currentDate.getDate() + 1);
            }

            res.json({
                success: true,
                data: trend
            });
        } catch (error) {
            logger.error('Error getting usage trend by date range:', error);
            next(error);
        }
    }

    /**
     * Simulate usage for testing (admin only)
     */
    static async simulateUsage(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            // Only allow admins in development
            if (req.user?.role !== 'admin' || process.env.NODE_ENV === 'production') {
                res.status(403).json({
                    success: false,
                    message: 'Not available in production'
                });
                return;
            }

            const { userId, percentage } = req.body;
            const targetUserId = userId || req.user.id;
            
            // Get user's plan limits
            const User = require('../models/User').User;
            const user = await User.findById(targetUserId);
            
            if (!user) {
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

            await GuardrailsService.trackUsage(targetUserId, simulatedUsage);

            res.json({
                success: true,
                message: `Simulated ${percentage}% usage for user`,
                data: simulatedUsage
            });
        } catch (error) {
            logger.error('Error simulating usage:', error);
            next(error);
        }
    }
}
