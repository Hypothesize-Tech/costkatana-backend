import { Response, NextFunction } from 'express';
import { User } from '../models/User';
import { Alert } from '../models/Alert';
import { updateProfileSchema, updateSubscriptionSchema } from '../utils/validators';
import { encrypt } from '../utils/helpers';
import { loggingService } from '../services/logging.service';
import { AppError } from '../middleware/error.middleware';
import { S3Service } from '../services/s3.service';
import { AuthService } from '../services/auth.service';
import { z } from 'zod';
import mongoose from 'mongoose';

const presignedUrlSchema = z.object({
    fileName: z.string(),
    fileType: z.string(),
});

const createApiKeySchema = z.object({
    name: z.string().min(1, 'Name is required').max(50, 'Name must be less than 50 characters'),
    permissions: z.array(z.enum(['read', 'write', 'admin'])).default(['read']),
    expiresAt: z.string().optional().transform((val) => {
        if (!val) return undefined;
        // If it's already a datetime string, return as is
        if (val.includes('T') || val.includes('Z')) {
            return val;
        }
        // If it's a date string (YYYY-MM-DD), convert to end of day datetime
        if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
            return `${val}T23:59:59.999Z`;
        }
        return val;
    }).pipe(z.string().datetime().optional()),
});

export class UserController {
    // Background processing queue
    private static backgroundQueue: Array<() => Promise<void>> = [];
    private static backgroundProcessor?: NodeJS.Timeout;
    
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly DB_CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;
    
    // Circuit breaker for S3 operations
    private static s3FailureCount: number = 0;
    private static readonly MAX_S3_FAILURES = 3;
    private static readonly S3_CIRCUIT_BREAKER_RESET_TIME = 180000; // 3 minutes
    private static lastS3FailureTime: number = 0;
    
    // Request timeout configuration
    private static readonly DEFAULT_TIMEOUT = 15000; // 15 seconds
    private static readonly STATS_TIMEOUT = 30000; // 30 seconds for stats
    private static readonly HISTORY_TIMEOUT = 25000; // 25 seconds for history
    
    // Pre-computed subscription limits
    private static readonly SUBSCRIPTION_LIMITS = {
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
    
    // ObjectId conversion utilities
    private static objectIdCache = new Map<string, mongoose.Types.ObjectId>();
    
    /**
     * Initialize background processor
     */
    static {
        this.startBackgroundProcessor();
    }
    static async getProfile(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { requestId, userId } = this.validateAuthentication(req, res);
        if (!userId) return;

        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const user = await User.findById(userId).select('-password -resetPasswordToken -resetPasswordExpires -verificationToken');

            if (!user) {
                loggingService.warn('User profile retrieval failed - user not found', { requestId, userId });
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            const duration = Date.now() - startTime;

            // Queue business event logging to background
            this.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'user_profile_retrieved',
                    category: 'user_management',
                    value: duration,
                    metadata: {
                        userId,
                        userEmail: user.email,
                        userName: user.name
                    }
                });
            });

            // Reset failure count on success
            this.dbFailureCount = 0;

            res.json({
                success: true,
                data: user,
            });
        } catch (error: any) {
            this.recordDbFailure();
            const duration = Date.now() - startTime;
            
            loggingService.error('User profile retrieval failed', {
                requestId,
                userId,
                error: error.message || 'Unknown error',
                duration
            });
            
            next(error);
        }
        return;
    }

    static async updateProfile(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { requestId, userId } = this.validateAuthentication(req, res);
        if (!userId) return;

        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const { name, preferences, avatar } = updateProfileSchema.parse(req.body);

            const user = await User.findById(userId);

            if (!user) {
                loggingService.warn('User profile update failed - user not found', { requestId, userId });
                return next(new AppError('User not found', 404));
            }

            // Track updated fields for logging
            const updatedFields: string[] = [];
            if (name) {
                user.name = name;
                updatedFields.push('name');
            }
            if (avatar) {
                user.avatar = avatar;
                updatedFields.push('avatar');
            }
            if (preferences) {
                user.preferences = { ...user.preferences, ...preferences };
                updatedFields.push('preferences');
            }

            await user.save();
            const duration = Date.now() - startTime;

            // Queue business event logging to background
            this.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'user_profile_updated',
                    category: 'user_management',
                    value: duration,
                    metadata: {
                        userId,
                        userEmail: user.email,
                        userName: user.name,
                        updatedFields
                    }
                });
            });

            // Reset failure count on success
            this.dbFailureCount = 0;

            res.json({
                success: true,
                message: 'Profile updated successfully',
                data: user,
            });
        } catch (error: any) {
            this.recordDbFailure();
            const duration = Date.now() - startTime;
            
            loggingService.error('User profile update failed', {
                requestId,
                userId,
                error: error.message || 'Unknown error',
                duration
            });
            
            next(error);
        }
    }

    static async getPresignedAvatarUrl(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { requestId, userId } = this.validateAuthentication(req, res);
        if (!userId) return;

        try {
            // Check S3 circuit breaker
            if (this.isS3CircuitBreakerOpen()) {
                throw new Error('S3 service circuit breaker is open');
            }

            const { fileName, fileType } = presignedUrlSchema.parse(req.body);

            const { uploadUrl, key } = await S3Service.getPresignedAvatarUploadUrl(userId, fileName, fileType);

            const finalUrl = `https://${process.env.AWS_S3_BUCKETNAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
            const duration = Date.now() - startTime;

            // Queue business event logging to background
            this.queueBackgroundOperation(async () => {
                loggingService.logBusiness({
                    event: 'presigned_avatar_url_generated',
                    category: 'user_management',
                    value: duration,
                    metadata: {
                        userId,
                        fileName,
                        fileType
                    }
                });
            });

            // Reset failure count on success
            this.s3FailureCount = 0;

            res.json({
                success: true,
                data: {
                    uploadUrl,
                    key,
                    finalUrl
                },
            });
        } catch (error: any) {
            this.recordS3Failure();
            const duration = Date.now() - startTime;
            
            loggingService.error('Get presigned avatar URL failed', {
                requestId,
                userId,
                fileName: req.body?.fileName,
                fileType: req.body?.fileType,
                error: error.message || 'Unknown error',
                duration
            });
            
            next(error);
        }
    }



    static async getAlerts(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { page = 1, limit = 20, unreadOnly = false } = req.query;

            const query: any = { userId };
            if (unreadOnly === 'true') {
                query.read = false;
            }

            const skip = (Number(page) - 1) * Number(limit);

            const [alerts, total] = await Promise.all([
                Alert.find(query)
                    .sort({ createdAt: -1 })
                    .skip(skip)
                    .limit(Number(limit))
                    .lean(),
                Alert.countDocuments(query),
            ]);

            res.json({
                success: true,
                data: alerts,
                pagination: {
                    page: Number(page),
                    limit: Number(limit),
                    total,
                    pages: Math.ceil(total / Number(limit)),
                },
            });
        } catch (error: any) {
            loggingService.error('Get alerts failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                page: req.query.page,
                limit: req.query.limit,
                unreadOnly: req.query.unreadOnly,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async markAlertAsRead(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { id } = req.params;

            const alert = await Alert.findOneAndUpdate(
                { _id: id, userId },
                { read: true, readAt: new Date() },
                { new: true }
            );

            if (!alert) {
                res.status(404).json({
                    success: false,
                    message: 'Alert not found',
                });
            }

            res.json({
                success: true,
                message: 'Alert marked as read',
            });
        } catch (error: any) {
            loggingService.error('Mark alert as read failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                alertId: req.params.id,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
        return;
    }

    static async markAllAlertsAsRead(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;

            await Alert.updateMany(
                { userId, read: false },
                { read: true, readAt: new Date() }
            );

            res.json({
                success: true,
                message: 'All alerts marked as read',
            });
        } catch (error: any) {
            loggingService.error('Mark all alerts as read failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
    }

    static async deleteAlert(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { id } = req.params;

            const alert = await Alert.findOneAndDelete({ _id: id, userId });

            if (!alert) {
                res.status(404).json({
                    success: false,
                    message: 'Alert not found',
                });
            }

            res.json({
                success: true,
                message: 'Alert deleted successfully',
            });
        } catch (error: any) {
            loggingService.error('Delete alert failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                alertId: req.params.id,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
        return;
    }

    static async getAlertSettings(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;

            const user: any = await User.findById(userId).select('preferences');
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            // Default alert settings based on user preferences
            const settings = {
                email: {
                    costAlerts: user.preferences.emailAlerts,
                    optimizationSuggestions: user.preferences.optimizationSuggestions,
                    weeklyReports: user.preferences.weeklyReports,
                    monthlyReports: false,
                    anomalyDetection: true,
                },
                push: {
                    costAlerts: user.preferences.emailAlerts,
                    optimizationSuggestions: user.preferences.optimizationSuggestions,
                    anomalyDetection: true,
                },
                thresholds: {
                    dailyCostLimit: user.preferences.alertThreshold,
                    weeklyCostLimit: user.preferences.alertThreshold * 7,
                    monthlyCostLimit: user.preferences.alertThreshold * 30,
                    anomalyPercentage: 50,
                },
            };

            res.json({
                success: true,
                data: settings,
            });
        } catch (error: any) {
            loggingService.error('Get alert settings failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
        return;
    }

    static async updateAlertSettings(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { email, thresholds } = req.body;

            const user: any = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            // Update user preferences based on alert settings
            if (email) {
                user.preferences.emailAlerts = email.costAlerts || false;
                user.preferences.optimizationSuggestions = email.optimizationSuggestions || false;
                user.preferences.weeklyReports = email.weeklyReports || false;
            }

            if (thresholds && thresholds.dailyCostLimit) {
                user.preferences.alertThreshold = thresholds.dailyCostLimit;
            }

            await user.save();

            res.json({
                success: true,
                message: 'Alert settings updated successfully',
            });
        } catch (error: any) {
            loggingService.error('Update alert settings failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                hasEmailSettings: !!req.body?.email,
                hasThresholds: !!req.body?.thresholds,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
        return;
    }

    static async testAlert(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { type } = req.body;

            if (!type || !['cost', 'optimization', 'anomaly', 'system'].includes(type)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid alert type. Must be one of: cost, optimization, anomaly, system',
                });
            }

            // Create a test alert
            const testAlert = new Alert({
                userId,
                type,
                title: `Test ${type} Alert`,
                message: `This is a test ${type} alert to verify your notification settings.`,
                severity: 'medium',
                read: false,
                metadata: {
                    isTest: true,
                    testType: type,
                },
            });

            await testAlert.save();

            res.json({
                success: true,
                message: `Test ${type} alert created successfully`,
            });
        } catch (error: any) {
            loggingService.error('Test alert failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                alertType: req.body?.type,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
        return;
    }

    static async getUnreadAlertCount(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;

            const counts = await Alert.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId), read: false } },
                {
                    $group: {
                        _id: '$severity',
                        count: { $sum: 1 },
                    },
                },
            ]);

            const result = {
                count: 0,
                critical: 0,
                high: 0,
                medium: 0,
                low: 0,
            };

            counts.forEach((item) => {
                result[item._id as keyof typeof result] = item.count;
                result.count += item.count;
            });

            res.json({
                success: true,
                data: result,
            });
        } catch (error: any) {
            loggingService.error('Get unread alert count failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
        return;
    }

    static async snoozeAlert(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { id } = req.params;
            const { until } = req.body;

            if (!until) {
                res.status(400).json({
                    success: false,
                    message: 'Snooze until date is required',
                });
            }

            const snoozeUntil = new Date(until);
            if (snoozeUntil <= new Date()) {
                res.status(400).json({
                    success: false,
                    message: 'Snooze date must be in the future',
                });
            }

            const alert = await Alert.findOneAndUpdate(
                { _id: id, userId },
                {
                    snoozedUntil: snoozeUntil,
                    read: true,
                    readAt: new Date(),
                },
                { new: true }
            );

            if (!alert) {
                res.status(404).json({
                    success: false,
                    message: 'Alert not found',
                });
            }

            res.json({
                success: true,
                message: 'Alert snoozed successfully',
            });
        } catch (error: any) {
            loggingService.error('Snooze alert failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                alertId: req.params.id,
                snoozeUntil: req.body?.until,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
        return;
    }

    static async getAlertHistory(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { page = 1, limit = 20, groupBy = 'day' } = req.query;

            // Calculate date grouping based on groupBy parameter
            let dateGrouping;
            switch (groupBy) {
                case 'week':
                    dateGrouping = {
                        $dateToString: {
                            format: '%Y-%U',
                            date: '$createdAt',
                        },
                    };
                    break;
                case 'month':
                    dateGrouping = {
                        $dateToString: {
                            format: '%Y-%m',
                            date: '$createdAt',
                        },
                    };
                    break;
                default: // day
                    dateGrouping = {
                        $dateToString: {
                            format: '%Y-%m-%d',
                            date: '$createdAt',
                        },
                    };
            }

            const history = await Alert.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId) } },
                {
                    $group: {
                        _id: dateGrouping,
                        total: { $sum: 1 },
                        costAlerts: {
                            $sum: { $cond: [{ $eq: ['$type', 'cost'] }, 1, 0] },
                        },
                        optimizations: {
                            $sum: { $cond: [{ $eq: ['$type', 'optimization'] }, 1, 0] },
                        },
                        anomalies: {
                            $sum: { $cond: [{ $eq: ['$type', 'anomaly'] }, 1, 0] },
                        },
                        system: {
                            $sum: { $cond: [{ $eq: ['$type', 'system'] }, 1, 0] },
                        },
                        totalCostImpact: { $sum: { $ifNull: ['$metadata.costImpact', 0] } },
                    },
                },
                { $sort: { _id: -1 } },
                { $skip: (Number(page) - 1) * Number(limit) },
                { $limit: Number(limit) },
            ]);

            // Get summary statistics
            const [summary] = await Alert.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId) } },
                {
                    $group: {
                        _id: null,
                        totalAlerts: { $sum: 1 },
                        totalCostImpact: { $sum: { $ifNull: ['$metadata.costImpact', 0] } },
                        types: { $push: '$type' },
                    },
                },
            ]);

            const formattedHistory = history.map((item) => ({
                date: item._id,
                counts: {
                    total: item.total,
                    costAlerts: item.costAlerts,
                    optimizations: item.optimizations,
                    anomalies: item.anomalies,
                    system: item.system,
                },
                totalCostImpact: item.totalCostImpact,
            }));

            // Calculate most common type
            let mostCommonType = 'N/A';
            if (summary && summary.types) {
                const typeCounts = summary.types.reduce((acc: any, type: string) => {
                    acc[type] = (acc[type] || 0) + 1;
                    return acc;
                }, {});
                mostCommonType = Object.keys(typeCounts).reduce((a, b) =>
                    typeCounts[a] > typeCounts[b] ? a : b
                );
            }

            const result = {
                history: formattedHistory,
                summary: {
                    totalAlerts: summary?.totalAlerts || 0,
                    avgPerDay: summary?.totalAlerts ? Math.round((summary.totalAlerts / 30) * 100) / 100 : 0,
                    mostCommonType,
                    totalCostImpact: summary?.totalCostImpact || 0,
                },
            };

            res.json({
                success: true,
                data: result,
            });
        } catch (error: any) {
            loggingService.error('Get alert history failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                page: req.query.page,
                limit: req.query.limit,
                groupBy: req.query.groupBy,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
        return;
    }

    static async getSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;

            const user: any = await User.findById(userId).select('subscription usage');
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            const subscriptionData = {
                plan: user.subscription.plan,
                startDate: user.subscription.startDate,
                endDate: user.subscription.endDate,
                limits: user.subscription.limits,
                usage: {
                    apiCalls: user.usage.currentMonth.apiCalls,
                    apiCallsLimit: user.subscription.limits.apiCalls,
                    apiCallsPercentage: (user.usage.currentMonth.apiCalls / user.subscription.limits.apiCalls) * 100,
                    optimizations: user.usage.currentMonth.optimizationsSaved,
                    optimizationsLimit: user.subscription.limits.optimizations,
                    optimizationsPercentage: (user.usage.currentMonth.optimizationsSaved / user.subscription.limits.optimizations) * 100,
                },
            };

            res.json({
                success: true,
                data: subscriptionData,
            });
        } catch (error: any) {
            loggingService.error('Get subscription failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
        return;
    }

    static async updateSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = this.validateAuthentication(req, res);
        if (!userId) return;

        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            const { plan } = updateSubscriptionSchema.parse(req.body);

            if (!['free', 'plus', 'pro', 'enterprise'].includes(plan)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid subscription plan',
                });
                return;
            }

            // Use pre-computed subscription limits
            const planLimits = this.SUBSCRIPTION_LIMITS[plan as keyof typeof this.SUBSCRIPTION_LIMITS];

            const user: any = await User.findByIdAndUpdate(
                userId,
                {
                    'subscription.plan': plan,
                    'subscription.limits': planLimits,
                    'subscription.startDate': new Date(),
                },
                { new: true }
            ).select('subscription');

            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Reset failure count on success
            this.dbFailureCount = 0;

            res.json({
                success: true,
                message: 'Subscription updated successfully',
                data: user.subscription,
            });
        } catch (error: any) {
            this.recordDbFailure();
            loggingService.error('Update subscription failed', {
                requestId,
                userId,
                plan: req.body?.plan,
                error: error.message || 'Unknown error'
            });
            next(error);
        }
        return;
    }

    static async getUserStats(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = this.validateAuthentication(req, res);
        if (!userId) return;

        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            // Add timeout handling
            const statsPromise = this.getUserStatsWithTimeout(userId);
            const result = await Promise.race([
                statsPromise,
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Stats operation timeout')), this.STATS_TIMEOUT)
                )
            ]);

            // Reset failure count on success
            this.dbFailureCount = 0;

            res.json({
                success: true,
                data: result,
            });
        } catch (error: any) {
            this.recordDbFailure();
            loggingService.error('Get user stats failed', {
                requestId,
                userId,
                error: error.message || 'Unknown error'
            });
            next(error);
        }
        return;
    }

    static async getUserActivities(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { page = 1, limit = 20, type, startDate, endDate } = req.query;

            // Import activity service
            const { ActivityService } = await import('../services/activity.service');

            const result = await ActivityService.getUserActivities(userId, {
                page: Number(page),
                limit: Number(limit),
                type: type as any,
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined
            });

            res.json({
                success: true,
                data: result.activities,
                pagination: result.pagination
            });
        } catch (error: any) {
            loggingService.error('Get user activities failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                page: req.query.page,
                limit: req.query.limit,
                type: req.query.type,
                startDate: req.query.startDate,
                endDate: req.query.endDate,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
        return;
    }

    static async createDashboardApiKey(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { name, permissions, expiresAt } = createApiKeySchema.parse(req.body);

            const user: any = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            // Check if user already has maximum number of API keys (limit to 10)
            if (user.dashboardApiKeys.length >= 10) {
                res.status(400).json({
                    success: false,
                    message: 'Maximum number of API keys reached (10)',
                });
            }

            // Check for duplicate names
            const existingKey: any = user.dashboardApiKeys.find((k: any) => k.name === name);
            if (existingKey) {
                res.status(400).json({
                    success: false,
                    message: 'API key with this name already exists',
                });
            }

            // Generate new dashboard API key
            const { keyId, apiKey, maskedKey } = AuthService.generateDashboardApiKey(user as any, name, permissions);

            // Encrypt the API key for storage
            const { encrypted, iv, authTag } = encrypt(apiKey);
            const encryptedKey = `${iv}:${authTag}:${encrypted}`;

            // Add to user's dashboard API keys
            const newApiKey = {
                name,
                keyId,
                encryptedKey,
                maskedKey,
                permissions,
                createdAt: new Date(),
                expiresAt: expiresAt ? new Date(expiresAt) : undefined,
            };

            user.dashboardApiKeys.push(newApiKey);
            await user.save();

            res.status(201).json({
                success: true,
                message: 'Dashboard API key created successfully',
                data: {
                    keyId,
                    name,
                    apiKey, // Return the actual key only once during creation
                    maskedKey,
                    permissions,
                    createdAt: newApiKey.createdAt,
                    expiresAt: newApiKey.expiresAt,
                },
            });
        } catch (error: any) {
            loggingService.error('Create dashboard API key failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                name: req.body?.name,
                permissions: req.body?.permissions,
                expiresAt: req.body?.expiresAt,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
        return;
    }

    static async getDashboardApiKeys(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;

            const user: any = await User.findById(userId).select('dashboardApiKeys');
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            // Return only safe information (no encrypted keys)
            const apiKeys: any = user.dashboardApiKeys.map((k: any) => ({
                keyId: k.keyId,
                name: k.name,
                maskedKey: k.maskedKey,
                permissions: k.permissions,
                lastUsed: k.lastUsed,
                createdAt: k.createdAt,
                expiresAt: k.expiresAt,
                isExpired: k.expiresAt ? new Date() > k.expiresAt : false,
            }));

            res.json({
                success: true,
                data: apiKeys,
            });
        } catch (error: any) {
            loggingService.error('Get dashboard API keys failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
        return;
    }

    static async deleteDashboardApiKey(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { keyId } = req.params;

            const user: any = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            const keyIndex: any = user.dashboardApiKeys.findIndex((k: any) => k.keyId === keyId);
            if (keyIndex === -1) {
                res.status(404).json({
                    success: false,
                    message: 'API key not found',
                });
            }

            const deletedKey: any = user.dashboardApiKeys[keyIndex];
            user.dashboardApiKeys.splice(keyIndex, 1);
            await user.save();

            res.json({
                success: true,
                message: 'Dashboard API key deleted successfully',
                data: {
                    keyId,
                    name: deletedKey.name,
                },
            });
        } catch (error: any) {
            loggingService.error('Delete dashboard API key failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                keyId: req.params.keyId,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
        return;
    }

    static async updateDashboardApiKey(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user!.id;
            const { keyId } = req.params;
            const { name, permissions, expiresAt } = req.body;

            const user: any = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            const apiKey: any = user.dashboardApiKeys.find((k: any) => k.keyId === keyId);
            if (!apiKey) {
                res.status(404).json({
                    success: false,
                    message: 'API key not found',
                });
            }

            // Check for duplicate names (excluding current key)
            if (name && name !== apiKey.name) {
                const existingKey: any = user.dashboardApiKeys.find((k: any) => k.name === name && k.keyId !== keyId);
                if (existingKey) {
                    res.status(400).json({
                        success: false,
                        message: 'API key with this name already exists',
                    });
                }
                apiKey.name = name;
            }

            if (permissions) {
                apiKey.permissions = permissions;
            }

            if (expiresAt !== undefined) {
                apiKey.expiresAt = expiresAt ? new Date(expiresAt) : undefined;
            }

            await user.save();

            res.json({
                success: true,
                message: 'Dashboard API key updated successfully',
                data: {
                    keyId: apiKey.keyId,
                    name: apiKey.name,
                    maskedKey: apiKey.maskedKey,
                    permissions: apiKey.permissions,
                    lastUsed: apiKey.lastUsed,
                    createdAt: apiKey.createdAt,
                    expiresAt: apiKey.expiresAt,
                },
            });
        } catch (error: any) {
            loggingService.error('Update dashboard API key failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                hasUserId: !!req.user!.id,
                keyId: req.params.keyId,
                name: req.body?.name,
                permissions: req.body?.permissions,
                expiresAt: req.body?.expiresAt,
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            next(error);
        }
        return;
    }

    /**
     * Authentication validation utility
     */
    private static validateAuthentication(req: any, res: Response): { requestId: string; userId: string } | { requestId: null; userId: null } {
        const requestId = req.headers['x-request-id'] as string;
        const userId = req.user?.id;

        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'Authentication required',
            });
            return { requestId: null, userId: null };
        }

        return { requestId, userId };
    }

    /**
     * ObjectId validation and conversion utilities
     */
    private static validateAndConvertObjectId(id: string): mongoose.Types.ObjectId {
        // Check cache first
        if (this.objectIdCache.has(id)) {
            return this.objectIdCache.get(id)!;
        }

        let objectId: mongoose.Types.ObjectId;
        if (mongoose.Types.ObjectId.isValid(id)) {
            objectId = new mongoose.Types.ObjectId(id);
        } else {
            throw new Error(`Invalid ObjectId: ${id}`);
        }

        // Cache the result
        this.objectIdCache.set(id, objectId);
        return objectId;
    }

    /**
     * Get user stats with optimized aggregation
     */
    private static async getUserStatsWithTimeout(userId: string): Promise<any> {
        // Import required models
        const { Usage } = await import('../models/Usage');
        const { Optimization } = await import('../models/Optimization');

        // Get user data
        const user: any = await User.findById(userId).select('createdAt usage subscription');
        if (!user) {
            throw new Error('User not found');
        }

        // Calculate account age in days
        const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));

        const currentMonthStart = new Date();
        currentMonthStart.setDate(1);
        currentMonthStart.setHours(0, 0, 0, 0);

        const userObjectId = this.validateAndConvertObjectId(userId);

        // Use $facet to combine all Usage aggregations
        const [usageResults] = await Usage.aggregate([
            {
                $facet: {
                    totalStats: [
                        { $match: { userId: userObjectId } },
                        {
                            $group: {
                                _id: null,
                                totalCost: { $sum: '$cost' },
                                totalCalls: { $sum: 1 },
                                totalTokens: { $sum: '$totalTokens' },
                            }
                        }
                    ],
                    currentMonthStats: [
                        {
                            $match: {
                                userId: userObjectId,
                                createdAt: { $gte: currentMonthStart }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                monthCost: { $sum: '$cost' },
                                monthCalls: { $sum: 1 },
                            }
                        }
                    ],
                    serviceStats: [
                        { $match: { userId: userObjectId } },
                        {
                            $group: {
                                _id: '$service',
                                count: { $sum: 1 },
                                cost: { $sum: '$cost' }
                            }
                        },
                        { $sort: { count: -1 } },
                        { $limit: 1 }
                    ],
                    modelStats: [
                        { $match: { userId: userObjectId } },
                        {
                            $group: {
                                _id: '$model',
                                count: { $sum: 1 },
                                cost: { $sum: '$cost' }
                            }
                        },
                        { $sort: { count: -1 } },
                        { $limit: 1 }
                    ],
                    dailyStats: [
                        { $match: { userId: userObjectId } },
                        {
                            $group: {
                                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                                dailyCost: { $sum: '$cost' }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                avgDailyCost: { $avg: '$dailyCost' },
                                activeDays: { $sum: 1 }
                            }
                        }
                    ]
                }
            }
        ]);

        // Use $facet for Optimization aggregations
        const [optimizationResults] = await Optimization.aggregate([
            {
                $facet: {
                    totalOptimizations: [
                        { $match: { userId: userObjectId } },
                        {
                            $group: {
                                _id: null,
                                totalOptimizations: { $sum: 1 },
                                totalSaved: { $sum: '$costSaved' },
                                appliedOptimizations: {
                                    $sum: { $cond: [{ $eq: ['$applied', true] }, 1, 0] }
                                }
                            }
                        }
                    ],
                    currentMonthOptStats: [
                        {
                            $match: {
                                userId: userObjectId,
                                createdAt: { $gte: currentMonthStart }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                monthSaved: { $sum: '$costSaved' },
                            }
                        }
                    ]
                }
            }
        ]);

        // Extract results
        const totalStats = usageResults.totalStats[0];
        const currentMonthStats = usageResults.currentMonthStats[0];
        const serviceStats = usageResults.serviceStats[0];
        const modelStats = usageResults.modelStats[0];
        const dailyStats = usageResults.dailyStats[0];
        
        const optimizationStats = optimizationResults.totalOptimizations[0];
        const currentMonthOptStats = optimizationResults.currentMonthOptStats[0];

        // Calculate savings rate
        const totalSpent = totalStats?.totalCost || 0;
        const totalSaved = optimizationStats?.totalSaved || 0;
        const savingsRate = totalSpent > 0 ? (totalSaved / (totalSpent + totalSaved)) * 100 : 0;

        return {
            totalSpent: totalStats?.totalCost || 0,
            totalSaved: optimizationStats?.totalSaved || 0,
            apiCalls: totalStats?.totalCalls || 0,
            optimizations: optimizationStats?.totalOptimizations || 0,
            currentMonthSpent: currentMonthStats?.monthCost || 0,
            currentMonthSaved: currentMonthOptStats?.monthSaved || 0,
            avgDailyCost: dailyStats?.avgDailyCost || 0,
            mostUsedService: serviceStats?._id || 'N/A',
            mostUsedModel: modelStats?._id || 'N/A',
            accountAge,
            savingsRate: Math.round(savingsRate * 100) / 100,
            appliedOptimizations: optimizationStats?.appliedOptimizations || 0,
            subscription: {
                plan: user.subscription.plan,
                limits: user.subscription.limits
            }
        };
    }

    /**
     * Circuit breaker utilities for database operations
     */
    private static isDbCircuitBreakerOpen(): boolean {
        if (this.dbFailureCount >= this.MAX_DB_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastDbFailureTime;
            if (timeSinceLastFailure < this.DB_CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.dbFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordDbFailure(): void {
        this.dbFailureCount++;
        this.lastDbFailureTime = Date.now();
    }

    /**
     * Circuit breaker utilities for S3 operations
     */
    private static isS3CircuitBreakerOpen(): boolean {
        if (this.s3FailureCount >= this.MAX_S3_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastS3FailureTime;
            if (timeSinceLastFailure < this.S3_CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.s3FailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordS3Failure(): void {
        this.s3FailureCount++;
        this.lastS3FailureTime = Date.now();
    }

    /**
     * Background processing queue utilities
     */
    private static queueBackgroundOperation(operation: () => Promise<void>): void {
        this.backgroundQueue.push(operation);
    }

    private static startBackgroundProcessor(): void {
        this.backgroundProcessor = setInterval(async () => {
            if (this.backgroundQueue.length > 0) {
                const operations = this.backgroundQueue.splice(0, 10); // Process up to 10 operations at once
                
                await Promise.allSettled(
                    operations.map(async (operation) => {
                        try {
                            await operation();
                        } catch (error) {
                            loggingService.error('Background operation failed', { 
                                error: error instanceof Error ? error.message : String(error) 
                            });
                        }
                    })
                );
            }
        }, 1000); // Process every second
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        // Clear background processor
        if (this.backgroundProcessor) {
            clearInterval(this.backgroundProcessor);
            this.backgroundProcessor = undefined;
        }
        
        // Clear background queue
        this.backgroundQueue.length = 0;
        
        // Reset circuit breaker state
        this.dbFailureCount = 0;
        this.lastDbFailureTime = 0;
        this.s3FailureCount = 0;
        this.lastS3FailureTime = 0;
        
        // Clear ObjectId cache
        this.objectIdCache.clear();
    }
}