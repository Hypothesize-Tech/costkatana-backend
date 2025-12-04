import { Response, NextFunction } from 'express';
import { User } from '../models/User';
import { Alert } from '../models/Alert';
import { updateProfileSchema, updateSubscriptionSchema } from '../utils/validators';
import { encrypt } from '../utils/helpers';
import { loggingService } from '../services/logging.service';
import { AppError } from '../middleware/error.middleware';
import { S3Service } from '../services/s3.service';
import { AuthService } from '../services/auth.service';
import { accountClosureService } from '../services/accountClosure.service';
import { SubscriptionService } from '../services/subscription.service';
import { SubscriptionNotificationService } from '../services/subscriptionNotification.service';
import { paymentGatewayManager } from '../services/paymentGateway/paymentGatewayManager.service';
import { PaymentMethod } from '../models/PaymentMethod';
import { convertCurrency, getCurrencyForCountry, convertToSmallestUnit } from '../utils/currencyConverter';
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

    /**
     * Helper to add CORS headers to response
     */
    private static addCorsHeaders(req: any, res: Response): void {
        const origin = req.headers.origin;
        if (origin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
    }
    
    // Circuit breaker for S3 operations
    private static s3FailureCount: number = 0;
    
    // Stats timeout constant
    private static readonly STATS_TIMEOUT = 30000; // 30 seconds
    private static readonly MAX_S3_FAILURES = 3;
    private static readonly S3_CIRCUIT_BREAKER_RESET_TIME = 180000; // 3 minutes
    private static lastS3FailureTime: number = 0;
    

    
    // ObjectId conversion utilities
    private static objectIdCache = new Map<string, mongoose.Types.ObjectId>();
    
    /**
     * Initialize background processor
     */
    static {
        UserController.startBackgroundProcessor();
    }
    static async getProfile(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            // Check circuit breaker
            if (UserController.isDbCircuitBreakerOpen()) {
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
            UserController.queueBackgroundOperation(async () => {
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
            UserController.dbFailureCount = 0;

            res.json({
                success: true,
                data: user,
            });
        } catch (error: any) {
            UserController.recordDbFailure();
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
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            // Check circuit breaker
            if (UserController.isDbCircuitBreakerOpen()) {
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
                // Ensure preferences object exists
                if (!user.preferences) {
                    user.preferences = {} as typeof user.preferences;
                }
                
                // Convert user preferences to plain object for safe manipulation
                const existingPrefs = JSON.parse(JSON.stringify(user.preferences || {}));
                
                // Build clean preferences object, filtering out undefined values
                const cleanPreferences: Record<string, unknown> = {};
                
                Object.keys(preferences).forEach((key) => {
                    const value = (preferences as Record<string, unknown>)[key];
                    
                    // Skip undefined/null values
                    if (value === undefined || value === null) {
                        return;
                    }
                    
                    // Handle nested objects (emailEngagement, integrations)
                    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
                        const existingNested = (existingPrefs as Record<string, unknown>)?.[key];
                        
                        // Special handling for integrations.alertTypeRouting (Mongoose Map type)
                        if (key === 'integrations') {
                            const integrationsValue = value as Record<string, unknown>;
                            const existingIntegrations = existingNested as Record<string, unknown> | undefined;
                            
                            // Build merged integrations object
                            const mergedIntegrations: Record<string, unknown> = {};
                            
                            // Handle alertTypeRouting - convert plain object to Map if needed
                            if (integrationsValue.alertTypeRouting !== undefined) {
                                if (integrationsValue.alertTypeRouting && typeof integrationsValue.alertTypeRouting === 'object' && !Array.isArray(integrationsValue.alertTypeRouting)) {
                                    const routingObj = integrationsValue.alertTypeRouting as Record<string, string[]>;
                                    // Convert plain object to Map for Mongoose
                                    mergedIntegrations.alertTypeRouting = new Map(Object.entries(routingObj));
                                } else if (existingIntegrations?.alertTypeRouting instanceof Map) {
                                    // Preserve existing Map if no new value
                                    mergedIntegrations.alertTypeRouting = existingIntegrations.alertTypeRouting;
                                }
                            } else if (existingIntegrations?.alertTypeRouting instanceof Map) {
                                // Preserve existing Map if not provided
                                mergedIntegrations.alertTypeRouting = existingIntegrations.alertTypeRouting;
                            }
                            
                            // Handle other integration fields
                            if (integrationsValue.defaultChannels !== undefined) {
                                mergedIntegrations.defaultChannels = integrationsValue.defaultChannels;
                            } else if (existingIntegrations?.defaultChannels !== undefined) {
                                mergedIntegrations.defaultChannels = existingIntegrations.defaultChannels;
                            }
                            
                            if (integrationsValue.fallbackToEmail !== undefined) {
                                mergedIntegrations.fallbackToEmail = integrationsValue.fallbackToEmail;
                            } else if (existingIntegrations?.fallbackToEmail !== undefined) {
                                mergedIntegrations.fallbackToEmail = existingIntegrations.fallbackToEmail;
                            }
                            
                            // Only set if we have valid values
                            if (Object.keys(mergedIntegrations).length > 0) {
                                cleanPreferences[key] = mergedIntegrations;
                            }
                        } else {
                            // Regular nested object handling (emailEngagement, etc.)
                            // Deep merge nested objects, filtering out undefined values
                            const nestedClean: Record<string, unknown> = {};
                            Object.keys(value as Record<string, unknown>).forEach((nestedKey) => {
                                const nestedValue = (value as Record<string, unknown>)[nestedKey];
                                if (nestedValue !== undefined && nestedValue !== null) {
                                    nestedClean[nestedKey] = nestedValue;
                                }
                            });
                            
                            // Only update if we have valid nested values
                            if (Object.keys(nestedClean).length > 0) {
                                // Merge with existing nested object if it exists
                                if (existingNested && typeof existingNested === 'object' && existingNested !== null && !Array.isArray(existingNested) && !(existingNested instanceof Date) && !(existingNested instanceof Map)) {
                                    cleanPreferences[key] = { ...existingNested, ...nestedClean };
                                } else {
                                    cleanPreferences[key] = nestedClean;
                                }
                            }
                        }
                    } else {
                        // Primitive values or arrays - set directly
                        cleanPreferences[key] = value;
                    }
                });
                
                // Merge clean preferences with existing preferences
                user.preferences = { ...existingPrefs, ...cleanPreferences } as typeof user.preferences;
                
                // Mark preferences as modified for Mongoose to ensure nested objects are saved
                user.markModified('preferences');
                updatedFields.push('preferences');
            }

            await user.save();
            const duration = Date.now() - startTime;

            // Queue business event logging to background
            UserController.queueBackgroundOperation(async () => {
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
            UserController.dbFailureCount = 0;

            res.json({
                success: true,
                message: 'Profile updated successfully',
                data: user,
            });
        } catch (error: any) {
            UserController.recordDbFailure();
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
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            // Check S3 circuit breaker
            if (UserController.isS3CircuitBreakerOpen()) {
                throw new Error('S3 service circuit breaker is open');
            }

            const { fileName, fileType } = presignedUrlSchema.parse(req.body);

            const { uploadUrl, key } = await S3Service.getPresignedAvatarUploadUrl(userId, fileName, fileType);

            const finalUrl = `https://${process.env.AWS_S3_BUCKETNAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
            const duration = Date.now() - startTime;

            // Queue business event logging to background
            UserController.queueBackgroundOperation(async () => {
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
            UserController.s3FailureCount = 0;

            res.json({
                success: true,
                data: {
                    uploadUrl,
                    key,
                    finalUrl
                },
            });
        } catch (error: any) {
            UserController.recordS3Failure();
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

            const subscription = await SubscriptionService.getSubscriptionByUserId(userId);
            if (!subscription) {
                res.status(404).json({
                    success: false,
                    message: 'Subscription not found',
                });
                return;
            }

            const usageAnalytics = await SubscriptionService.getUsageAnalytics(userId);

            res.json({
                success: true,
                data: {
                    ...subscription.toObject(),
                    usageAnalytics,
                },
            });
        } catch (error: any) {
            loggingService.error('Get subscription failed', {
                requestId: req.headers['x-request-id'] as string,
                userId: req.user!.id,
                error: error.message || 'Unknown error',
            });
            next(error);
        }
        return;
    }

    static async updateSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            // Check circuit breaker
            if (UserController.isDbCircuitBreakerOpen()) {
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

            // Get current subscription
            const currentSubscription = await SubscriptionService.getSubscriptionByUserId(userId);
            if (!currentSubscription) {
                res.status(404).json({
                    success: false,
                    message: 'Subscription not found',
                });
                return;
            }

            // Determine if this is an upgrade or downgrade
            const planHierarchy = ['free', 'plus', 'pro', 'enterprise'];
            const currentIndex = planHierarchy.indexOf(currentSubscription.plan);
            const newIndex = planHierarchy.indexOf(plan);

            let updatedSubscription;
            if (newIndex > currentIndex) {
                // Upgrade - requires payment gateway
                const { paymentGateway, paymentMethodId } = req.body;
                if (!paymentGateway || !paymentMethodId) {
                    res.status(400).json({
                        success: false,
                        message: 'Payment gateway and payment method required for upgrade',
                    });
                    return;
                }

                updatedSubscription = await SubscriptionService.upgradeSubscription(
                    userId,
                    plan as 'plus' | 'pro' | 'enterprise',
                    paymentGateway,
                    paymentMethodId,
                    { interval: req.body.interval || 'monthly' }
                );

                // Send notification
                const user = await User.findById(userId);
                if (user) {
                    await SubscriptionNotificationService.sendSubscriptionUpgradedEmail(
                        user,
                        currentSubscription.plan,
                        plan
                    );
                }
            } else if (newIndex < currentIndex) {
                // Downgrade
                updatedSubscription = await SubscriptionService.downgradeSubscription(
                    userId,
                    plan as 'free' | 'plus' | 'pro',
                    req.body.scheduleForPeriodEnd !== false
                );

                // Send notification
                const user = await User.findById(userId);
                if (user) {
                    await SubscriptionNotificationService.sendSubscriptionDowngradedEmail(
                        user,
                        currentSubscription.plan,
                        plan,
                        updatedSubscription.billing.nextBillingDate || new Date()
                    );
                }
            } else {
                // Same plan - no change needed
                updatedSubscription = currentSubscription;
            }

            // Reset failure count on success
            UserController.dbFailureCount = 0;

            res.json({
                success: true,
                message: 'Subscription updated successfully',
                data: updatedSubscription,
            });
        } catch (error: any) {
            UserController.recordDbFailure();
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
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            // Check circuit breaker
            if (UserController.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            // Add timeout handling
            const statsPromise = UserController.getUserStatsWithTimeout(userId);
            const result = await Promise.race([
                statsPromise,
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Stats operation timeout')), UserController.STATS_TIMEOUT)
                )
            ]);

            // Reset failure count on success
            UserController.dbFailureCount = 0;

            res.json({
                success: true,
                data: result,
            });
        } catch (error: any) {
            UserController.recordDbFailure();
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
                isActive: true,
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
            const { name, permissions, expiresAt, isActive } = req.body;

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

            if (isActive !== undefined) {
                apiKey.isActive = isActive;
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
            // Add CORS headers for error response
            UserController.addCorsHeaders(req, res);
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

        const userObjectId = UserController.validateAndConvertObjectId(userId);

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
        if (UserController.dbFailureCount >= UserController.MAX_DB_FAILURES) {
            const timeSinceLastFailure = Date.now() - UserController.lastDbFailureTime;
            if (timeSinceLastFailure < UserController.DB_CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                UserController.dbFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordDbFailure(): void {
        UserController.dbFailureCount++;
        this.lastDbFailureTime = Date.now();
    }

    /**
     * Circuit breaker utilities for S3 operations
     */
    private static isS3CircuitBreakerOpen(): boolean {
        if (UserController.s3FailureCount >= UserController.MAX_S3_FAILURES) {
            const timeSinceLastFailure = Date.now() - UserController.lastS3FailureTime;
            if (timeSinceLastFailure < UserController.S3_CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                UserController.s3FailureCount = 0;
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
     * Update user preferences including session replay settings
     * PATCH /api/user/preferences
     */
    static async updatePreferences(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = req.user?.id || req.userId;

        try {
            loggingService.info('User preferences update initiated', {
                requestId,
                userId
            });

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
            }

            // Check circuit breaker
            if (UserController.isDbCircuitBreakerOpen()) {
                throw new Error('Service temporarily unavailable');
            }

            const { emailAlerts, alertThreshold, optimizationSuggestions, enableSessionReplay, sessionReplayTimeout } = req.body;

            const updateData: any = {};
            if (emailAlerts !== undefined) updateData['preferences.emailAlerts'] = emailAlerts;
            if (alertThreshold !== undefined) updateData['preferences.alertThreshold'] = alertThreshold;
            if (optimizationSuggestions !== undefined) updateData['preferences.optimizationSuggestions'] = optimizationSuggestions;
            if (enableSessionReplay !== undefined) updateData['preferences.enableSessionReplay'] = enableSessionReplay;
            if (sessionReplayTimeout !== undefined) updateData['preferences.sessionReplayTimeout'] = sessionReplayTimeout;

            const user = await User.findByIdAndUpdate(
                userId,
                { $set: updateData },
                { new: true, runValidators: true }
            ).select('-password');

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            const duration = Date.now() - startTime;

            loggingService.info('User preferences updated successfully', {
                requestId,
                duration,
                userId,
                updatedFields: Object.keys(updateData)
            });

            // Log business event
            loggingService.logBusiness({
                event: 'user_preferences_updated',
                category: 'user',
                value: duration,
                metadata: {
                    userId,
                    enableSessionReplay: user.preferences.enableSessionReplay,
                    sessionReplayTimeout: user.preferences.sessionReplayTimeout
                }
            });

            res.json({
                success: true,
                message: 'Preferences updated successfully',
                data: {
                    preferences: user.preferences
                }
            });
        } catch (error: any) {
            UserController.recordDbFailure();
            const duration = Date.now() - startTime;

            loggingService.error('Update user preferences failed', {
                requestId,
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            next(error);
        }
    }

    /**
     * Get user preferences
     * GET /api/user/preferences
     */
    static async getPreferences(req: any, res: Response, next: NextFunction): Promise<Response | void> {
        const startTime = Date.now();
        const requestId = req.headers['x-request-id'] as string;
        const userId = req.user?.id || req.userId;

        try {
            loggingService.info('User preferences retrieval initiated', {
                requestId,
                userId
            });

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
            }

            const user = await User.findById(userId).select('preferences');

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            const duration = Date.now() - startTime;

            loggingService.info('User preferences retrieved successfully', {
                requestId,
                duration,
                userId
            });

            res.json({
                success: true,
                data: {
                    preferences: user.preferences
                }
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;

            loggingService.error('Get user preferences failed', {
                requestId,
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration
            });

            next(error);
        }
    }

    /**
     * Get all user emails (primary + secondary)
     * GET /api/user/emails
     */
    static async getEmails(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const user = await User.findById(userId).select('email emailVerified otherEmails');
            
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Format response with primary and secondary emails
            const emails = [
                {
                    email: user.email,
                    isPrimary: true,
                    verified: user.emailVerified,
                    addedAt: user.createdAt,
                },
                ...(user.otherEmails || []).map((otherEmail: any) => ({
                    email: otherEmail.email,
                    isPrimary: false,
                    verified: otherEmail.verified,
                    addedAt: otherEmail.addedAt,
                })),
            ];

            res.json({
                success: true,
                data: { emails },
            });
        } catch (error: any) {
            loggingService.error('Get emails failed', {
                requestId,
                userId,
                error: error.message || 'Unknown error',
            });
            next(error);
        }
    }

    /**
     * Add secondary email
     * POST /api/user/emails/secondary
     */
    static async addSecondaryEmail(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { email } = req.body;
            
            const user: any = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Check if already at max limit (2 secondary emails)
            if (user.otherEmails && user.otherEmails.length >= 2) {
                res.status(400).json({
                    success: false,
                    message: 'Maximum number of emails reached (3 total)',
                });
                return;
            }

            // Check if email already exists as primary
            if (user.email.toLowerCase() === email.toLowerCase()) {
                res.status(400).json({
                    success: false,
                    message: 'This email is already your primary email',
                });
                return;
            }

            // Check if email already exists in otherEmails
            if (user.otherEmails && user.otherEmails.some((e: any) => e.email.toLowerCase() === email.toLowerCase())) {
                res.status(400).json({
                    success: false,
                    message: 'This email is already added to your account',
                });
                return;
            }

            // Check if email exists for another user (primary or secondary)
            const existingUser = await User.findOne({
                $or: [
                    { email: email.toLowerCase() },
                    { 'otherEmails.email': email.toLowerCase() }
                ]
            });

            if (existingUser) {
                res.status(400).json({
                    success: false,
                    message: 'This email is already associated with another account',
                });
                return;
            }

            // Generate verification token
            const { generateToken } = await import('../utils/helpers');
            const verificationToken = generateToken();

            // Add to otherEmails array
            if (!user.otherEmails) {
                user.otherEmails = [];
            }

            user.otherEmails.push({
                email: email.toLowerCase(),
                verified: false,
                verificationToken,
                addedAt: new Date(),
            });

            await user.save();

            // Send verification email
            const { EmailService } = await import('../services/email.service');
            const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;
            await EmailService.sendSecondaryEmailVerification(email, verificationUrl, user.name);

            loggingService.logBusiness({
                event: 'secondary_email_added',
                category: 'user_management',
                metadata: {
                    userId,
                    email,
                }
            });

            res.status(201).json({
                success: true,
                message: 'Verification email sent to the address',
                data: {
                    email,
                    verified: false,
                },
            });
        } catch (error: any) {
            loggingService.error('Add secondary email failed', {
                requestId,
                userId,
                error: error.message || 'Unknown error',
            });
            next(error);
        }
    }

    /**
     * Remove secondary email
     * DELETE /api/user/emails/secondary/:email
     */
    static async removeSecondaryEmail(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { email } = req.params;

            const user: any = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Check if trying to remove primary email
            if (user.email.toLowerCase() === email.toLowerCase()) {
                res.status(400).json({
                    success: false,
                    message: 'Cannot remove primary email. Set another email as primary first.',
                });
                return;
            }

            // Find and remove the email from otherEmails
            const initialLength = user.otherEmails?.length || 0;
            user.otherEmails = (user.otherEmails || []).filter(
                (e: any) => e.email.toLowerCase() !== email.toLowerCase()
            );

            if (user.otherEmails.length === initialLength) {
                res.status(404).json({
                    success: false,
                    message: 'Email not found in your account',
                });
                return;
            }

            await user.save();

            loggingService.logBusiness({
                event: 'secondary_email_removed',
                category: 'user_management',
                metadata: {
                    userId,
                    email,
                }
            });

            res.json({
                success: true,
                message: 'Email removed successfully',
            });
        } catch (error: any) {
            loggingService.error('Remove secondary email failed', {
                requestId,
                userId,
                error: error.message || 'Unknown error',
            });
            next(error);
        }
    }

    /**
     * Set primary email (swap primary with verified secondary)
     * PUT /api/user/emails/primary
     */
    static async setPrimaryEmail(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { email } = req.body;

            const user: any = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Check if already primary
            if (user.email.toLowerCase() === email.toLowerCase()) {
                res.status(400).json({
                    success: false,
                    message: 'This email is already your primary email',
                });
                return;
            }

            // Find the email in otherEmails
            const secondaryEmail = user.otherEmails?.find(
                (e: any) => e.email.toLowerCase() === email.toLowerCase()
            );

            if (!secondaryEmail) {
                res.status(404).json({
                    success: false,
                    message: 'Email not found in your account',
                });
                return;
            }

            // Check if verified
            if (!secondaryEmail.verified) {
                res.status(400).json({
                    success: false,
                    message: 'Email must be verified before setting as primary',
                });
                return;
            }

            // Swap: Move current primary to otherEmails, new email becomes primary
            const currentPrimaryEmail = user.email;
            const currentPrimaryVerified = user.emailVerified;

            // Remove the new primary from otherEmails
            user.otherEmails = (user.otherEmails || []).filter(
                (e: any) => e.email.toLowerCase() !== email.toLowerCase()
            );

            // Add old primary to otherEmails
            user.otherEmails.push({
                email: currentPrimaryEmail,
                verified: currentPrimaryVerified,
                verificationToken: user.verificationToken,
                addedAt: new Date(),
            });

            // Set new primary
            user.email = email.toLowerCase();
            user.emailVerified = true; // It was verified as secondary
            user.verificationToken = undefined;

            await user.save();

            loggingService.logBusiness({
                event: 'primary_email_changed',
                category: 'user_management',
                metadata: {
                    userId,
                    oldPrimary: currentPrimaryEmail,
                    newPrimary: email,
                }
            });

            res.json({
                success: true,
                message: 'Primary email updated successfully',
                data: {
                    primaryEmail: user.email,
                },
            });
        } catch (error: any) {
            loggingService.error('Set primary email failed', {
                requestId,
                userId,
                error: error.message || 'Unknown error',
            });
            next(error);
        }
    }

    /**
     * Resend verification email
     * POST /api/user/emails/:email/resend-verification
     */
    static async resendVerification(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { email } = req.params;

            const user: any = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            const { generateToken } = await import('../utils/helpers');
            const { EmailService } = await import('../services/email.service');
            const verificationToken = generateToken();
            const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${verificationToken}`;

            // Check if it's the primary email
            if (user.email.toLowerCase() === email.toLowerCase()) {
                if (user.emailVerified) {
                    res.status(400).json({
                        success: false,
                        message: 'This email is already verified',
                    });
                    return;
                }

                user.verificationToken = verificationToken;
                await user.save();
                await EmailService.sendVerificationEmail(user, verificationUrl);

                res.json({
                    success: true,
                    message: 'Verification email sent',
                });
                return;
            }

            // Check if it's a secondary email
            const secondaryEmail = user.otherEmails?.find(
                (e: any) => e.email.toLowerCase() === email.toLowerCase()
            );

            if (!secondaryEmail) {
                res.status(404).json({
                    success: false,
                    message: 'Email not found in your account',
                });
                return;
            }

            if (secondaryEmail.verified) {
                res.status(400).json({
                    success: false,
                    message: 'This email is already verified',
                });
                return;
            }

            // Update verification token for secondary email
            secondaryEmail.verificationToken = verificationToken;
            await user.save();
            await EmailService.sendSecondaryEmailVerification(email, verificationUrl, user.name);

            loggingService.logBusiness({
                event: 'verification_email_resent',
                category: 'user_management',
                metadata: {
                    userId,
                    email,
                }
            });

            res.json({
                success: true,
                message: 'Verification email sent',
            });
        } catch (error: any) {
            loggingService.error('Resend verification failed', {
                requestId,
                userId,
                email: req.params.email,
                error: error.message || 'Unknown error',
            });
            next(error);
        }
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
        UserController.dbFailureCount = 0;
        this.lastDbFailureTime = 0;
        this.s3FailureCount = 0;
        this.lastS3FailureTime = 0;
        
        // Clear ObjectId cache
        this.objectIdCache.clear();
    }

    /**
     * Initiate account closure
     * POST /api/user/account/closure/initiate
     */
    static async initiateAccountClosure(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { password, reason } = req.body;
            const userId = req.userId;

            loggingService.info('Initiating account closure', {
                userId,
                hasReason: !!reason,
            });

            const result = await accountClosureService.initiateAccountClosure(userId, password, reason);

            res.json({
                success: true,
                message: 'Account closure initiated. Please check your email to confirm.',
                data: result,
            });
        } catch (error: any) {
            loggingService.error('Error initiating account closure', {
                error: error.message,
                userId: req.userId,
            });
            next(error);
        }
    }

    /**
     * Confirm account closure via email token
     * POST /api/user/account/closure/confirm/:token
     */
    static async confirmAccountClosure(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const { token } = req.params;

            loggingService.info('Confirming account closure via email', { token: token.substring(0, 10) + '...' });

            const result = await accountClosureService.confirmClosureViaEmail(token);

            res.json({
                success: true,
                message: 'Account closure confirmed. Cooldown period started.',
                data: result,
            });
        } catch (error: any) {
            loggingService.error('Error confirming account closure', {
                error: error.message,
            });
            next(error);
        }
    }

    /**
     * Cancel account closure
     * POST /api/user/account/closure/cancel
     */
    static async cancelAccountClosure(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.userId;

            loggingService.info('Cancelling account closure', { userId });

            await accountClosureService.cancelAccountClosure(userId);

            res.json({
                success: true,
                message: 'Account closure cancelled successfully.',
            });
        } catch (error: any) {
            loggingService.error('Error cancelling account closure', {
                error: error.message,
                userId: req.userId,
            });
            next(error);
        }
    }

    /**
     * Get account closure status
     * GET /api/user/account/closure/status
     */
    static async getAccountClosureStatus(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.userId;

            const status = await accountClosureService.getAccountClosureStatus(userId);

            res.json({
                success: true,
                data: status,
            });
        } catch (error: any) {
            loggingService.error('Error getting account closure status', {
                error: error.message,
                userId: req.userId,
            });
            next(error);
        }
    }

    /**
     * Reactivate account during grace period
     * POST /api/user/account/reactivate
     */
    static async reactivateAccount(req: any, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.userId;

            loggingService.info('Reactivating account', { userId });

            await accountClosureService.reactivateAccount(userId);

            res.json({
                success: true,
                message: 'Account reactivated successfully. Welcome back!',
            });
        } catch (error: any) {
            loggingService.error('Error reactivating account', {
                error: error.message,
                userId: req.userId,
            });
            next(error);
        }
    }

    /**
     * Upgrade subscription
     * POST /api/user/subscription/upgrade
     */
    static async upgradeSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { plan: planRaw, paymentGateway, paymentMethodId, interval, discountCode } = req.body;
            
            // Normalize plan name to lowercase
            const plan = planRaw ? (planRaw as string).toLowerCase() as 'plus' | 'pro' | 'enterprise' : undefined;

            if (!plan || !['plus', 'pro', 'enterprise'].includes(plan)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid plan for upgrade',
                });
                return;
            }

            if (!paymentGateway || !paymentMethodId) {
                res.status(400).json({
                    success: false,
                    message: 'Payment gateway and payment method required',
                });
                return;
            }

            const currentSubscription = await SubscriptionService.getSubscriptionByUserId(userId);
            if (!currentSubscription) {
                res.status(404).json({
                    success: false,
                    message: 'Subscription not found',
                });
                return;
            }

            const updatedSubscription = await SubscriptionService.upgradeSubscription(
                userId,
                plan,
                paymentGateway,
                paymentMethodId,
                { interval: interval || 'monthly', discountCode }
            );

            // Send notification
            const user = await User.findById(userId);
            if (user) {
                await SubscriptionNotificationService.sendSubscriptionUpgradedEmail(
                    user,
                    currentSubscription.plan,
                    plan
                );
            }

            res.json({
                success: true,
                message: 'Subscription upgraded successfully',
                data: updatedSubscription,
            });
        } catch (error: any) {
            loggingService.error('Upgrade subscription failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Create Stripe setup intent for payment method collection
     * POST /api/user/subscription/create-stripe-setup-intent
     */
    static async createStripeSetupIntent(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            // Get user for customer creation
            const user = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Create or get Stripe customer
            const customerResult = await paymentGatewayManager.createCustomer('stripe', {
                email: user.email,
                name: user.name || user.email,
                userId: userId.toString(),
            });

            // Create setup intent using Stripe gateway
            const stripeGateway = paymentGatewayManager.getGateway('stripe') as any;
            
            // Access Stripe instance - we need to create setup intent directly
            // Import Stripe SDK
            const Stripe = require('stripe') as any;
            if (!process.env.STRIPE_SECRET_KEY) {
                res.status(500).json({
                    success: false,
                    message: 'Stripe is not configured',
                });
                return;
            }
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
                apiVersion: '2024-12-18.acacia',
            }) as any;

            const setupIntent = await stripe.setupIntents.create({
                customer: customerResult.customerId,
                payment_method_types: ['card'],
                usage: 'off_session', // For recurring payments
            }) as any;

            // Log gateway for debugging
            loggingService.debug('Stripe gateway initialized', {
                requestId,
                userId,
                gatewayType: stripeGateway.constructor.name,
            });

            res.json({
                success: true,
                data: {
                    clientSecret: setupIntent.client_secret as string,
                    customerId: customerResult.customerId,
                },
            });
        } catch (error: any) {
            loggingService.error('Create Stripe setup intent failed', {
                requestId,
                userId,
                error: error.message as string,
            });
            next(error);
        }
        return;
    }

    /**
     * Confirm Stripe payment and upgrade subscription
     * POST /api/user/subscription/confirm-stripe-payment
     */
    static async confirmStripePayment(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { setupIntentId, paymentMethodId, plan: planRaw, billingInterval, discountCode } = req.body as any;
            
            // Normalize plan name to lowercase
            const plan = planRaw ? (planRaw as string).toLowerCase() as 'plus' | 'pro' | 'enterprise' : undefined;

            if (!paymentMethodId || !plan) {
                UserController.addCorsHeaders(req, res);
                res.status(400).json({
                    success: false,
                    message: 'Payment method ID and plan are required',
                });
                return;
            }

            if (!['plus', 'pro', 'enterprise'].includes(plan)) {
                UserController.addCorsHeaders(req, res);
                res.status(400).json({
                    success: false,
                    message: 'Invalid plan',
                });
                return;
            }

            // Get user
            const user = await User.findById(userId);
            if (!user) {
                UserController.addCorsHeaders(req, res);
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Access Stripe instance for payment method retrieval
            const Stripe = require('stripe') as any;
            if (!process.env.STRIPE_SECRET_KEY) {
                UserController.addCorsHeaders(req, res);
                res.status(500).json({
                    success: false,
                    message: 'Stripe is not configured',
                });
                return;
            }
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
                apiVersion: '2024-12-18.acacia',
            }) as any;

            // Get Stripe gateway service
            const stripeGateway = paymentGatewayManager.getGateway('stripe') as any;

            // Get payment method details first to check if it's already attached
            const paymentMethodDetails = await stripeGateway.getPaymentMethod(paymentMethodId as string) as any;
            
            // Get or create Stripe customer
            let gatewayCustomerId: string;
            const existingPaymentMethod = await PaymentMethod.findOne({ userId, gateway: 'stripe' });
            if (existingPaymentMethod) {
                gatewayCustomerId = existingPaymentMethod.gatewayCustomerId;
            } else {
                const customerResult = await paymentGatewayManager.createCustomer('stripe', {
                    email: user.email,
                    name: user.name || user.email,
                    userId: userId.toString(),
                });
                gatewayCustomerId = customerResult.customerId;
            }

            // Attach payment method to customer only if not already attached
            // Check if payment method already has a customer attached
            if (paymentMethodDetails.customer) {
                // Payment method is already attached to a customer
                if (paymentMethodDetails.customer !== gatewayCustomerId) {
                    // It's attached to a different customer - this shouldn't happen in normal flow
                    // but we'll log it and continue with the current customer
                    loggingService.warn('Payment method attached to different customer', {
                        requestId,
                        userId,
                        paymentMethodId: paymentMethodId as string,
                        existingCustomer: paymentMethodDetails.customer,
                        targetCustomer: gatewayCustomerId,
                    });
                }
                // Payment method is already attached to the correct customer, no need to attach again
            } else {
                // Payment method is not attached to any customer, attach it now
                try {
                    await stripeGateway.attachPaymentMethodToCustomer(paymentMethodId as string, gatewayCustomerId);
                } catch (attachError: any) {
                    // If it's already attached (race condition), that's okay
                    if (attachError.message && attachError.message.includes('already been attached')) {
                        loggingService.info('Payment method already attached (race condition)', {
                            requestId,
                            userId,
                            paymentMethodId: paymentMethodId as string,
                        });
                    } else {
                        // Re-throw if it's a different error
                        throw attachError;
                    }
                }
            }

            // Log setup intent ID for debugging
            if (setupIntentId) {
                loggingService.debug('Setup intent confirmed', {
                    requestId,
                    userId,
                    setupIntentId: setupIntentId as string,
                });
            }

            // Create or update payment method in database
            let paymentMethod: any = await PaymentMethod.findOne({
                gateway: 'stripe',
                gatewayPaymentMethodId: paymentMethodId as string,
                userId,
            });

            if (!paymentMethod) {
                paymentMethod = new PaymentMethod({
                    userId,
                    gateway: 'stripe',
                    gatewayCustomerId: gatewayCustomerId,
                    gatewayPaymentMethodId: paymentMethodId as string,
                    type: 'card',
                    card: {
                        last4: (paymentMethodDetails.card?.last4 || '') as string,
                        brand: (paymentMethodDetails.card?.brand || '') as string,
                        expiryMonth: (paymentMethodDetails.card?.exp_month || 0) as number,
                        expiryYear: (paymentMethodDetails.card?.exp_year || 0) as number,
                        maskedNumber: `**** **** **** ${paymentMethodDetails.card?.last4 || ''}`,
                    },
                    isDefault: true,
                    isActive: true,
                    setupForRecurring: true,
                    recurringStatus: 'active',
                });
                await paymentMethod.save();
            }

            // Set as default payment method
            await stripeGateway.setDefaultPaymentMethod(gatewayCustomerId, paymentMethodId as string);

            // Log stripe instance for debugging
            loggingService.debug('Stripe instance created', {
                requestId,
                userId,
                stripeVersion: stripe.VERSION,
            });

            // Upgrade subscription
            const updatedSubscription = await SubscriptionService.upgradeSubscription(
                userId,
                plan as 'plus' | 'pro' | 'enterprise',
                'stripe',
                paymentMethod._id.toString(),
                { interval: (billingInterval as 'monthly' | 'yearly') || 'monthly', discountCode: discountCode as string }
            );

            res.json({
                success: true,
                message: 'Stripe payment confirmed and subscription upgraded successfully',
                data: updatedSubscription,
            });
        } catch (error: any) {
            loggingService.error('Confirm Stripe payment failed', {
                requestId,
                userId,
                error: error.message as string,
            });
            next(error);
        }
        return;
    }

    /**
     * Create PayPal subscription plan
     * POST /api/user/subscription/create-paypal-plan
     */
    static async createPayPalPlan(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { plan: planRaw, billingInterval, amount, currency = 'USD', discountCode } = req.body;
            
            // Normalize plan name to lowercase
            const plan = planRaw ? (planRaw as string).toLowerCase() as 'plus' | 'pro' | 'enterprise' : undefined;

            if (!plan || !billingInterval || !amount) {
                res.status(400).json({
                    success: false,
                    message: 'Plan, billing interval, and amount are required',
                });
                return;
            }
            
            if (!['plus', 'pro', 'enterprise'].includes(plan)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid plan',
                });
                return;
            }

            // Apply discount if provided
            let finalAmount = parseFloat(amount);
            if (discountCode) {
                try {
                    const { Discount } = await import('../models/Discount');
                    const codeUpper = discountCode.toUpperCase().trim();
                    const discount = await Discount.findOne({
                        code: codeUpper,
                        isActive: true,
                    });

                    if (discount) {
                        // Validate discount (basic checks)
                        const now = new Date();
                        if (now >= discount.validFrom && now <= discount.validUntil) {
                            if (discount.maxUses === -1 || discount.currentUses < discount.maxUses) {
                                const normalizedPlan = plan ? (plan as string).toLowerCase() : null;
                                if (discount.applicablePlans.length === 0 || (normalizedPlan && discount.applicablePlans.includes(normalizedPlan as any))) {
                                    if (!discount.minAmount || finalAmount >= discount.minAmount) {
                                        // Calculate discount
                                        let discountAmount = 0;
                                        if (discount.type === 'percentage') {
                                            discountAmount = (finalAmount * discount.amount) / 100;
                                        } else {
                                            discountAmount = discount.amount;
                                        }
                                        discountAmount = Math.min(discountAmount, finalAmount);
                                        finalAmount = Math.max(0, finalAmount - discountAmount);
                                    }
                                }
                            }
                        }
                    }
                } catch (discountError: any) {
                    loggingService.warn('Error applying discount code in PayPal plan creation', {
                        requestId,
                        userId,
                        discountCode,
                        error: discountError?.message,
                    });
                    // Continue without discount if validation fails
                }
            }

            // Get user for email
            const user = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Create PayPal customer
            const customerResult = await paymentGatewayManager.createCustomer('paypal', {
                email: user.email,
                name: user.name || user.email,
                userId: userId.toString(),
            });

            // Create subscription in PayPal (this creates the billing plan first, then the subscription)
            // The backend creates a PayPal billing plan and returns the plan ID to the frontend SDK
            // The frontend SDK will use this plan ID to create the subscription when user approves
            const paypalGateway = paymentGatewayManager.getGateway('paypal');
            const subscriptionResult = await paypalGateway.createSubscription({
                customerId: customerResult.customerId,
                paymentMethodId: '', // Not needed for initial creation
                planId: `${plan}_${billingInterval}`,
                amount: finalAmount,
                currency: currency.toUpperCase(),
                interval: billingInterval,
                metadata: {
                    userId: userId.toString(),
                    plan: plan,
                    discountCode: discountCode || undefined,
                },
            });

            // Extract the plan ID from metadata (set by PayPal service)
            const planId = subscriptionResult.metadata?.planId || subscriptionResult.subscriptionId;

            res.json({
                success: true,
                data: {
                    planId: planId, // PayPal billing plan ID for frontend SDK
                    subscriptionId: subscriptionResult.subscriptionId, // Subscription ID for reference
                },
            });
        } catch (error: any) {
            loggingService.error('Create PayPal plan failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Handle PayPal subscription approval and upgrade
     * POST /api/user/subscription/approve-paypal
     */
    static async approvePayPalSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { subscriptionId, plan: planRaw, billingInterval, discountCode } = req.body;
            
            // Normalize plan name to lowercase
            const plan = planRaw ? (planRaw as string).toLowerCase() as 'plus' | 'pro' | 'enterprise' : undefined;

            if (!subscriptionId) {
                res.status(400).json({
                    success: false,
                    message: 'PayPal subscription ID is required',
                });
                return;
            }

            if (!plan || !['plus', 'pro', 'enterprise'].includes(plan)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid plan',
                });
                return;
            }

            // Get PayPal subscription details
            const paypalGateway = paymentGatewayManager.getGateway('paypal');
            const paypalSubscription = await paypalGateway.getSubscription(subscriptionId);

            if (!paypalSubscription) {
                res.status(404).json({
                    success: false,
                    message: 'PayPal subscription not found',
                });
                return;
            }

            // Get user email for PayPal customer ID
            const user = await User.findById(userId);
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Create or get PayPal customer
            const customerResult = await paymentGatewayManager.createCustomer('paypal', {
                email: user.email,
                name: user.name || user.email,
                userId: userId.toString(),
            });

            // Create payment method from PayPal subscription
            const paymentMethodResult = await paymentGatewayManager.createPaymentMethod('paypal', {
                type: 'paypal',
                customerId: customerResult.customerId,
                paypalEmail: user.email,
            });

            // Find or create payment method in database
            let paymentMethod: any = await PaymentMethod.findOne({
                gateway: 'paypal',
                gatewayPaymentMethodId: paymentMethodResult.paymentMethodId,
                userId,
            });

            if (!paymentMethod) {
                paymentMethod = new PaymentMethod({
                    userId,
                    gateway: 'paypal',
                    gatewayCustomerId: customerResult.customerId,
                    gatewayPaymentMethodId: subscriptionId, // Use subscription ID as payment method ID
                    type: 'paypal_account',
                    paypalAccount: {
                        email: user.email,
                    },
                    isDefault: true,
                    isActive: true,
                    setupForRecurring: true,
                    recurringStatus: 'active',
                });
                await paymentMethod.save();
            }

            // Upgrade subscription
            const updatedSubscription = await SubscriptionService.upgradeSubscription(
                userId,
                plan,
                'paypal',
                paymentMethod._id.toString(),
                { interval: billingInterval || 'monthly', discountCode }
            );

            // Update subscription with PayPal subscription ID
            updatedSubscription.gatewaySubscriptionId = subscriptionId;
            await updatedSubscription.save();

            res.json({
                success: true,
                message: 'PayPal subscription approved and subscription upgraded successfully',
                data: updatedSubscription,
            });
        } catch (error: any) {
            loggingService.error('Approve PayPal subscription failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Create Razorpay order for subscription
     * POST /api/user/subscription/create-razorpay-order
     */
    static async createRazorpayOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

            try {
                const body = req.body as any;
                const { plan: planRaw, billingInterval, amount, currency, country, discountCode } = {
                    plan: body.plan as string,
                    billingInterval: body.billingInterval as 'monthly' | 'yearly',
                    amount: body.amount as number,
                    currency: body.currency as string | undefined,
                    country: body.country as string | undefined,
                    discountCode: body.discountCode as string | undefined,
                };

                // Normalize plan name to lowercase
                const plan = planRaw ? (planRaw as string).toLowerCase() as 'plus' | 'pro' | 'enterprise' : undefined;

            if (!plan || !billingInterval || !amount) {
                res.status(400).json({
                    success: false,
                    message: 'Plan, billing interval, and amount are required',
                });
                return;
            }

            if (!['plus', 'pro', 'enterprise'].includes(plan)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid plan for upgrade',
                });
                return;
            }

            // Get user
            const user = await User.findById(userId);
            if (!user) {
                UserController.addCorsHeaders(req, res);
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }

            // Validate user email (required for Razorpay customer creation)
            if (!user.email) {
                UserController.addCorsHeaders(req, res);
                res.status(400).json({
                    success: false,
                    message: 'User email is required to create a Razorpay order. Please update your profile with an email address.',
                });
                return;
            }

            // Check if Razorpay gateway is available and configured
            if (!paymentGatewayManager.isGatewayAvailable('razorpay')) {
                UserController.addCorsHeaders(req, res);
                res.status(500).json({
                    success: false,
                    message: 'Razorpay payment gateway is not available. Please check your Razorpay configuration.',
                });
                return;
            }

            const razorpayGateway = paymentGatewayManager.getGateway('razorpay') as any;
            if (!razorpayGateway || !razorpayGateway.razorpay) {
                UserController.addCorsHeaders(req, res);
                res.status(500).json({
                    success: false,
                    message: 'Razorpay SDK is not initialized. Please check that RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set in your environment variables.',
                });
                return;
            }

            // Validate Razorpay credentials are configured
            if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
                UserController.addCorsHeaders(req, res);
                res.status(500).json({
                    success: false,
                    message: 'Razorpay credentials are not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables.',
                });
                return;
            }

            // Get or create Razorpay customer
            let gatewayCustomerId: string;
            const existingPaymentMethod = await PaymentMethod.findOne({ userId, gateway: 'razorpay' });
            if (existingPaymentMethod) {
                gatewayCustomerId = existingPaymentMethod.gatewayCustomerId;
            } else {
                try {
                    const customerResult = await paymentGatewayManager.createCustomer('razorpay', {
                        email: user.email,
                        name: user.name || user.email || 'Customer',
                        userId: userId.toString(),
                    });
                    gatewayCustomerId = customerResult.customerId;
                } catch (customerError: any) {
                    // If customer creation fails, check if customer already exists
                    const errorMessage = customerError?.message || customerError?.error?.description || 'Failed to create Razorpay customer';
                    const errorCode = customerError?.statusCode || customerError?.code || customerError?.error?.code;
                    
                    // Check if error is due to customer already existing
                    const isCustomerExistsError = errorMessage.includes('already exists') || 
                                                 errorMessage.includes('Customer already exists') ||
                                                 errorCode === 400;
                    
                    if (isCustomerExistsError) {
                        // Try to find existing customer by email
                        try {
                            // Access Razorpay-specific method by casting to any
                            const razorpayGatewayService = razorpayGateway as any;
                            if (razorpayGatewayService && typeof razorpayGatewayService.findCustomerByEmail === 'function') {
                                const existingCustomerId = await razorpayGatewayService.findCustomerByEmail(user.email);
                                if (existingCustomerId) {
                                    gatewayCustomerId = existingCustomerId;
                                    loggingService.info('Found existing Razorpay customer', {
                                        requestId,
                                        userId,
                                        userEmail: user.email,
                                        customerId: existingCustomerId,
                                    });
                                } else {
                                    // Customer exists but we couldn't find it, throw original error
                                    throw customerError;
                                }
                            } else {
                                // Method not available, throw original error
                                throw customerError;
                            }
                        } catch (findError: any) {
                            // If finding customer fails, log and throw original error
                            loggingService.warn('Failed to find existing Razorpay customer', {
                                requestId,
                                userId,
                                userEmail: user.email,
                                findError: findError?.message || String(findError),
                            });
                            throw customerError;
                        }
                    } else {
                        // Different error, log and throw
                        loggingService.error('Failed to create Razorpay customer', {
                            requestId,
                            userId,
                            userEmail: user.email,
                            error: errorMessage,
                            errorCode,
                            errorDetails: customerError,
                            razorpayConfigured: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
                        });
                        
                        UserController.addCorsHeaders(req, res);
                        
                        // Provide more specific error messages based on error type
                        let userFriendlyMessage = 'Failed to create Razorpay customer. Please check your Razorpay configuration.';
                        if (errorMessage.includes('not initialized') || errorMessage.includes('Install razorpay')) {
                            userFriendlyMessage = 'Razorpay SDK is not properly initialized. Please check your server configuration.';
                        } else if (errorMessage.includes('Email is required')) {
                            userFriendlyMessage = 'Email address is required to create a Razorpay customer.';
                        } else if (errorCode === 401 || errorMessage.includes('authentication') || errorMessage.includes('Unauthorized')) {
                            userFriendlyMessage = 'Razorpay authentication failed. Please verify your RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are correct.';
                        }
                        
                        res.status(500).json({
                            success: false,
                            message: userFriendlyMessage,
                            error: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
                            errorCode: process.env.NODE_ENV === 'development' ? errorCode : undefined,
                        });
                        return;
                    }
                }
            }

            // Apply discount if provided
            let finalAmount = amount;
            if (discountCode) {
                try {
                    const { Discount } = await import('../models/Discount');
                    const codeUpper = discountCode.toUpperCase().trim();
                    const discount = await Discount.findOne({
                        code: codeUpper,
                        isActive: true,
                    });

                    if (discount) {
                        // Validate discount (basic checks)
                        const now = new Date();
                        if (now >= discount.validFrom && now <= discount.validUntil) {
                            if (discount.maxUses === -1 || discount.currentUses < discount.maxUses) {
                                const normalizedPlan = plan ? (plan as string).toLowerCase() : null;
                                if (discount.applicablePlans.length === 0 || (normalizedPlan && discount.applicablePlans.includes(normalizedPlan as any))) {
                                    if (!discount.minAmount || amount >= discount.minAmount) {
                                        // Calculate discount
                                        let discountAmount = 0;
                                        if (discount.type === 'percentage') {
                                            discountAmount = (amount * discount.amount) / 100;
                                        } else {
                                            discountAmount = discount.amount;
                                        }
                                        discountAmount = Math.min(discountAmount, amount);
                                        finalAmount = Math.max(0, amount - discountAmount);
                                    }
                                }
                            }
                        }
                    }
                } catch (discountError: any) {
                    loggingService.warn('Error applying discount code in order creation', {
                        requestId,
                        userId,
                        discountCode,
                        error: discountError?.message,
                    });
                    // Continue without discount if validation fails
                }
            }

            // Create Razorpay order
            // Determine currency based on country
            const orderCurrency = country ? getCurrencyForCountry(country) : (currency || 'USD').toUpperCase();
            
            // Convert amount if currency is different (using dynamic exchange rates)
            let orderAmount = finalAmount;
            if (currency && currency.toUpperCase() !== orderCurrency) {
                orderAmount = await convertCurrency(finalAmount, currency.toUpperCase(), orderCurrency);
            }
            
            // Ensure minimum amount (Razorpay requires at least 1.00 in base currency)
            const MINIMUM_ORDER_AMOUNT = 1.0; // 1 USD or 1 INR
            if (orderAmount < MINIMUM_ORDER_AMOUNT) {
                UserController.addCorsHeaders(req, res);
                res.status(400).json({
                    success: false,
                    message: `Order amount after discount (${orderCurrency} ${orderAmount.toFixed(2)}) is below the minimum required amount of ${orderCurrency} ${MINIMUM_ORDER_AMOUNT.toFixed(2)}. Please adjust your discount code.`,
                });
                return;
            }

            // Convert to smallest unit (paise for INR, cents for USD)
            const amountInSmallestUnit = convertToSmallestUnit(orderAmount, orderCurrency);

            const orderNotes: Record<string, any> = {
                userId: userId.toString(),
                plan,
                billingInterval,
                customerId: gatewayCustomerId,
                originalAmount: amount,
                finalAmount: finalAmount,
                originalCurrency: currency || 'USD',
            };

            // Store country in order notes if provided
            if (country) {
                orderNotes.country = country;
            }

            // Store discount code in order notes if provided
            if (discountCode) {
                orderNotes.discountCode = discountCode.toUpperCase().trim();
            }

            const order = await razorpayGateway.razorpay.orders.create({
                amount: amountInSmallestUnit,
                currency: orderCurrency,
                receipt: `sub_${plan}_${billingInterval}_${Date.now()}`,
                notes: orderNotes,
            });

            res.json({
                success: true,
                data: {
                    orderId: order.id,
                    amount: order.amount,
                    currency: order.currency,
                    keyId: process.env.RAZORPAY_KEY_ID,
                    country: country || null, // Return country for frontend confirmation
                    convertedAmount: orderAmount, // Return converted amount for display
                },
            });
        } catch (error: any) {
            // Extract error message from various error formats
            let errorMessage = 'Failed to create Razorpay order';
            if (error instanceof Error) {
                errorMessage = error.message;
            } else if (error?.message) {
                errorMessage = error.message;
            } else if (error?.error?.description) {
                errorMessage = error.error.description;
            } else if (typeof error === 'string') {
                errorMessage = error;
            }
            
            // Check for minimum amount error
            const isMinimumAmountError = 
                errorMessage.includes('Order amount less than minimum') ||
                errorMessage.includes('minimum amount allowed') ||
                (error?.error?.code === 'BAD_REQUEST_ERROR' && errorMessage.includes('minimum'));
            
            loggingService.error('Create Razorpay order failed', {
                requestId,
                userId,
                error: errorMessage,
                errorDetails: error,
                isMinimumAmountError,
            });
            
            UserController.addCorsHeaders(req, res);
            
            if (isMinimumAmountError) {
                res.status(400).json({
                    success: false,
                    message: `Order amount after discount is below the minimum required amount. Please adjust your discount code to ensure the final amount is at least $1.00 (or ₹1.00).`,
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: 'Failed to create Razorpay order',
                    error: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
                });
            }
        }
    }

    /**
     * Confirm Razorpay payment and upgrade subscription
     * POST /api/user/subscription/confirm-razorpay-payment
     */
    static async confirmRazorpayPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const body = req.body as any;
            const { paymentId, orderId, signature, plan: planRaw, billingInterval, discountCode } = {
                paymentId: body.paymentId as string,
                orderId: body.orderId as string,
                signature: body.signature as string,
                plan: body.plan as string,
                billingInterval: body.billingInterval as 'monthly' | 'yearly',
                discountCode: body.discountCode as string | undefined,
            };
            
            // Normalize plan name to lowercase
            const plan = planRaw ? (planRaw as string).toLowerCase() as 'plus' | 'pro' | 'enterprise' : undefined;

            if (!paymentId || !orderId || !signature || !plan) {
                res.status(400).json({
                    success: false,
                    message: 'Payment ID, order ID, signature, and plan are required',
                });
                return;
            }

            if (!['plus', 'pro', 'enterprise'].includes(plan)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid plan for upgrade',
                });
                return;
            }

            // Get user
            const user = await User.findById(userId);
            if (!user) {
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }

            // Verify payment signature
            const razorpayGateway = paymentGatewayManager.getGateway('razorpay') as any;
            if (!razorpayGateway || !razorpayGateway.razorpay) {
                res.status(500).json({ success: false, message: 'Razorpay is not configured' });
                return;
            }

            const crypto = require('crypto');
            const webhookSecret = process.env.RAZORPAY_KEY_SECRET || '';
            const generatedSignature = crypto
                .createHmac('sha256', webhookSecret)
                .update(`${orderId}|${paymentId}`)
                .digest('hex');

            if (generatedSignature !== signature) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid payment signature',
                });
                return;
            }

            // Fetch payment details from Razorpay
            const payment = await razorpayGateway.razorpay.payments.fetch(paymentId);

            if (payment.status !== 'captured' && payment.status !== 'authorized') {
                res.status(400).json({
                    success: false,
                    message: `Payment not successful. Status: ${payment.status}`,
                });
                return;
            }

            // Get or create Razorpay customer
            let gatewayCustomerId: string;
            const existingPaymentMethod = await PaymentMethod.findOne({ userId, gateway: 'razorpay' });
            if (existingPaymentMethod) {
                gatewayCustomerId = existingPaymentMethod.gatewayCustomerId;
            } else {
                try {
                    const customerResult = await paymentGatewayManager.createCustomer('razorpay', {
                        email: user.email,
                        name: user.name || user.email || 'Customer',
                        userId: userId.toString(),
                    });
                    gatewayCustomerId = customerResult.customerId;
                } catch (customerError: any) {
                    // If customer creation fails, check if customer already exists
                    const errorMessage = customerError?.message || customerError?.error?.description || 'Failed to create Razorpay customer';
                    const errorCode = customerError?.statusCode || customerError?.code || customerError?.error?.code;
                    
                    // Check if error is due to customer already existing
                    const isCustomerExistsError = errorMessage.includes('already exists') || 
                                                 errorMessage.includes('Customer already exists') ||
                                                 errorCode === 400;
                    
                    if (isCustomerExistsError) {
                        // Try to find existing customer by email
                        try {
                            // Access Razorpay-specific method by casting to any
                            const razorpayGatewayService = razorpayGateway as any;
                            if (razorpayGatewayService && typeof razorpayGatewayService.findCustomerByEmail === 'function') {
                                const existingCustomerId = await razorpayGatewayService.findCustomerByEmail(user.email);
                                if (existingCustomerId) {
                                    gatewayCustomerId = existingCustomerId;
                                    loggingService.info('Found existing Razorpay customer', {
                                        requestId,
                                        userId,
                                        userEmail: user.email,
                                        customerId: existingCustomerId,
                                    });
                                } else {
                                    // Customer exists but we couldn't find it, throw original error
                                    throw customerError;
                                }
                            } else {
                                // Method not available, throw original error
                                throw customerError;
                            }
                        } catch (findError: any) {
                            // If finding customer fails, log and throw original error
                            loggingService.warn('Failed to find existing Razorpay customer', {
                                requestId,
                                userId,
                                userEmail: user.email,
                                findError: findError?.message || String(findError),
                            });
                            throw customerError;
                        }
                    } else {
                        // Different error, log and throw
                        loggingService.error('Failed to create Razorpay customer', {
                            requestId,
                            userId,
                            userEmail: user.email,
                            error: errorMessage,
                            errorCode,
                            errorDetails: customerError,
                        });
                        throw customerError;
                    }
                }
            }

            // Create or update payment method in database
            let paymentMethod = await PaymentMethod.findOne({
                gateway: 'razorpay',
                gatewayPaymentMethodId: paymentId,
                userId,
            });

            if (!paymentMethod && payment.method) {
                const cardDetails = payment.card || {};
                paymentMethod = new PaymentMethod({
                    userId: new mongoose.Types.ObjectId(userId.toString()),
                    gateway: 'razorpay',
                    gatewayCustomerId: gatewayCustomerId,
                    gatewayPaymentMethodId: paymentId,
                    type: payment.method === 'card' ? 'card' : payment.method,
                    card: payment.method === 'card' ? {
                        last4: cardDetails.last4 || '',
                        brand: cardDetails.network || '',
                        expiryMonth: cardDetails.expiry_month || 0,
                        expiryYear: cardDetails.expiry_year || 0,
                        maskedNumber: `**** **** **** ${cardDetails.last4 || ''}`,
                    } : undefined,
                    isDefault: true,
                    isActive: true,
                    setupForRecurring: true,
                    recurringStatus: 'active',
                });
                await paymentMethod.save();
            }

            // Upgrade subscription
            // For Razorpay, we'll create a subscription in Razorpay
            // The payment ID will be stored separately for reference
            const paymentMethodId = paymentMethod && paymentMethod._id ? paymentMethod._id.toString() : '';
            const updatedSubscription = await SubscriptionService.upgradeSubscription(
                userId,
                plan,
                'razorpay',
                paymentMethodId,
                { 
                    interval: billingInterval || 'monthly', 
                    discountCode
                }
            );

            // Store the payment ID for reference (in addition to the subscription ID)
            if (paymentId && !updatedSubscription.gatewaySubscriptionId) {
                updatedSubscription.gatewaySubscriptionId = paymentId;
            }

            res.json({
                success: true,
                message: 'Razorpay payment confirmed and subscription upgraded successfully',
                data: updatedSubscription,
            });
        } catch (error: any) {
            loggingService.error('Confirm Razorpay payment failed', {
                requestId,
                userId,
                error: error.message as string,
            });
            next(error);
        }
    }

    /**
     * Downgrade subscription
     * POST /api/user/subscription/downgrade
     */
    static async downgradeSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { plan, scheduleForPeriodEnd } = req.body;

            if (!['free', 'plus', 'pro'].includes(plan)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid plan for downgrade',
                });
                return;
            }

            const currentSubscription = await SubscriptionService.getSubscriptionByUserId(userId);
            if (!currentSubscription) {
                res.status(404).json({
                    success: false,
                    message: 'Subscription not found',
                });
                return;
            }

            const updatedSubscription = await SubscriptionService.downgradeSubscription(
                userId,
                plan,
                scheduleForPeriodEnd !== false
            );

            // Send notification
            const user = await User.findById(userId);
            if (user) {
                await SubscriptionNotificationService.sendSubscriptionDowngradedEmail(
                    user,
                    currentSubscription.plan,
                    plan,
                    updatedSubscription.billing.nextBillingDate || new Date()
                );
            }

            res.json({
                success: true,
                message: 'Subscription downgraded successfully',
                data: updatedSubscription,
            });
        } catch (error: any) {
            loggingService.error('Downgrade subscription failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Cancel subscription
     * POST /api/user/subscription/cancel
     */
    static async cancelSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { cancelAtPeriodEnd, reason } = req.body;

            const subscription = await SubscriptionService.cancelSubscription(
                userId,
                cancelAtPeriodEnd !== false,
                reason
            );

            // Send notification
            const user = await User.findById(userId);
            if (user) {
                await SubscriptionNotificationService.sendSubscriptionCanceledEmail(
                    user,
                    subscription,
                    new Date()
                );
            }

            res.json({
                success: true,
                message: 'Subscription canceled successfully',
                data: subscription,
            });
        } catch (error: any) {
            loggingService.error('Cancel subscription failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Reactivate subscription
     * POST /api/user/subscription/reactivate
     */
    static async reactivateSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const subscription = await SubscriptionService.reactivateSubscription(userId);

            // Send notification
            const user = await User.findById(userId);
            if (user) {
                await SubscriptionNotificationService.sendSubscriptionReactivatedEmail(user, subscription);
            }

            res.json({
                success: true,
                message: 'Subscription reactivated successfully',
                data: subscription,
            });
        } catch (error: any) {
            loggingService.error('Reactivate subscription failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Pause subscription
     * POST /api/user/subscription/pause
     */
    static async pauseSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { reason } = req.body;
            const subscription = await SubscriptionService.pauseSubscription(userId, reason);

            res.json({
                success: true,
                message: 'Subscription paused successfully',
                data: subscription,
            });
        } catch (error: any) {
            loggingService.error('Pause subscription failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Resume subscription
     * POST /api/user/subscription/resume
     */
    static async resumeSubscription(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const subscription = await SubscriptionService.resumeSubscription(userId);

            res.json({
                success: true,
                message: 'Subscription resumed successfully',
                data: subscription,
            });
        } catch (error: any) {
            loggingService.error('Resume subscription failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Update payment method
     * PUT /api/user/subscription/payment-method
     */
    static async updatePaymentMethod(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { paymentMethodId } = req.body;

            if (!paymentMethodId) {
                res.status(400).json({
                    success: false,
                    message: 'Payment method ID required',
                });
                return;
            }

            const subscription = await SubscriptionService.updatePaymentMethod(userId, paymentMethodId);

            res.json({
                success: true,
                message: 'Payment method updated successfully',
                data: subscription,
            });
        } catch (error: any) {
            loggingService.error('Update payment method failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Update billing cycle
     * PUT /api/user/subscription/billing-cycle
     */
    static async updateBillingCycle(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { interval } = req.body;

            if (!['monthly', 'yearly'].includes(interval)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid billing interval. Must be monthly or yearly',
                });
                return;
            }

            const subscription = await SubscriptionService.updateBillingCycle(userId, interval);

            res.json({
                success: true,
                message: 'Billing cycle updated successfully',
                data: subscription,
            });
        } catch (error: any) {
            loggingService.error('Update billing cycle failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Validate discount code (for checkout preview)
     * POST /api/user/subscription/validate-discount
     */
    static async validateDiscountCode(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { code, plan, amount } = req.body;

            if (!code) {
                res.status(400).json({
                    success: false,
                    message: 'Discount code required',
                });
                return;
            }

            const { Discount } = await import('../models/Discount');
            const codeUpper = code.toUpperCase().trim();
            
            const discount = await Discount.findOne({
                code: codeUpper,
                isActive: true,
            });

            if (!discount) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid or inactive discount code',
                });
                return;
            }

            // Check if discount is user-specific and matches
            if (discount.userId) {
                const userIdStr: string = typeof userId === 'string' ? userId : String(userId);
                const discountUserIdStr: string = typeof discount.userId === 'string' 
                    ? discount.userId 
                    : String(discount.userId);
                if (discountUserIdStr !== userIdStr) {
                    res.status(403).json({
                        success: false,
                        message: 'This discount code is not available for your account',
                    });
                    return;
                }
            }

            // Check if discount is still valid (date range)
            const now = new Date();
            if (now < discount.validFrom) {
                res.status(400).json({
                    success: false,
                    message: 'Discount code is not yet valid',
                });
                return;
            }

            if (now > discount.validUntil) {
                res.status(400).json({
                    success: false,
                    message: 'Discount code has expired',
                });
                return;
            }

            // Check if discount has exceeded max uses
            if (discount.maxUses !== -1 && discount.currentUses >= discount.maxUses) {
                res.status(400).json({
                    success: false,
                    message: 'Discount code has reached its maximum usage limit',
                });
                return;
            }

            // Check if discount applies to the plan
            // Normalize plan name to lowercase for comparison
            const normalizedPlan = plan ? (plan as string).toLowerCase() : null;
            if (normalizedPlan && discount.applicablePlans.length > 0 && !discount.applicablePlans.includes(normalizedPlan as any)) {
                res.status(400).json({
                    success: false,
                    message: `This discount code is not applicable to ${plan} plan`,
                });
                return;
            }

            // Check minimum amount requirement if applicable
            if (discount.minAmount && amount && amount < discount.minAmount) {
                res.status(400).json({
                    success: false,
                    message: `This discount code requires a minimum purchase amount of $${discount.minAmount}`,
                });
                return;
            }

            // Calculate discount amount
            let discountAmount = 0;
            if (amount) {
                if (discount.type === 'percentage') {
                    discountAmount = (amount * discount.amount) / 100;
                } else {
                    discountAmount = discount.amount;
                }
                // Ensure discount doesn't exceed the amount
                discountAmount = Math.min(discountAmount, amount);
            }

            res.json({
                success: true,
                data: {
                    code: discount.code,
                    type: discount.type,
                    amount: discount.amount,
                    discountAmount: discountAmount,
                    finalAmount: amount ? Math.max(0, amount - discountAmount) : 0,
                },
            });
        } catch (error: any) {
            loggingService.error('Validate discount code failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Apply discount code
     * POST /api/user/subscription/discount
     */
    static async applyDiscountCode(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { code } = req.body;

            if (!code) {
                res.status(400).json({
                    success: false,
                    message: 'Discount code required',
                });
                return;
            }

            const subscription = await SubscriptionService.applyDiscountCode(userId, code);

            res.json({
                success: true,
                message: 'Discount code applied successfully',
                data: subscription,
            });
        } catch (error: any) {
            loggingService.error('Apply discount code failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Get available plans
     * GET /api/user/subscription/plans
     */
    static async getAvailablePlans(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const subscription = await SubscriptionService.getSubscriptionByUserId(userId);
            if (!subscription) {
                res.status(404).json({
                    success: false,
                    message: 'Subscription not found',
                });
                return;
            }

            const availableUpgrades = SubscriptionService.getAvailableUpgrades(subscription.plan);
            const allPlans = ['free', 'plus', 'pro', 'enterprise'] as const;

            const plans = allPlans.map(plan => {
                const limits = SubscriptionService.getPlanLimits(plan);
                const pricing = SubscriptionService.getPlanPricing(plan, 'monthly');
                const yearlyPricing = SubscriptionService.getPlanPricing(plan, 'yearly');

                return {
                    plan,
                    limits,
                    pricing: {
                        monthly: pricing.amount,
                        yearly: yearlyPricing.amount,
                        currency: pricing.currency,
                    },
                    canUpgrade: availableUpgrades.includes(plan as any),
                    isCurrent: subscription.plan === plan,
                };
            });

            res.json({
                success: true,
                data: {
                    currentPlan: subscription.plan,
                    availableUpgrades,
                    plans,
                },
            });
        } catch (error: any) {
            loggingService.error('Get available plans failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Get usage analytics
     * GET /api/user/subscription/usage
     */
    static async getUsageAnalytics(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { period } = req.query;
            const analytics = await SubscriptionService.getUsageAnalytics(
                userId,
                (period as 'daily' | 'weekly' | 'monthly') || 'monthly'
            );

            res.json({
                success: true,
                data: analytics,
            });
        } catch (error: any) {
            loggingService.error('Get usage analytics failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Get user spending summary
     * GET /api/user/spending
     */
    static async getUserSpending(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { AdminUserAnalyticsService } = await import('../services/adminUserAnalytics.service');
            
            const filters: any = {};

            // Parse query parameters
            if (req.query.startDate) {
                filters.startDate = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                filters.endDate = new Date(req.query.endDate);
            }
            if (req.query.service) {
                filters.service = req.query.service;
            }
            if (req.query.model) {
                filters.model = req.query.model;
            }
            if (req.query.projectId) {
                filters.projectId = req.query.projectId;
            }

            const userSpending = await AdminUserAnalyticsService.getUserDetailedSpending(userId.toString(), filters);

            if (!userSpending) {
                res.status(404).json({
                    success: false,
                    message: 'User spending data not found'
                });
                return;
            }

            loggingService.info('User spending retrieved', {
                component: 'UserController',
                operation: 'getUserSpending',
                userId,
                requestId
            });

            res.json({
                success: true,
                data: userSpending
            });
        } catch (error: any) {
            loggingService.error('Get user spending failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }

    /**
     * Get subscription history
     * GET /api/user/subscription/history
     */
    static async getSubscriptionHistory(req: any, res: Response, next: NextFunction): Promise<void> {
        const { requestId, userId } = UserController.validateAuthentication(req, res);
        if (!userId) return;

        try {
            const { SubscriptionHistory } = await import('../models/SubscriptionHistory');
            const subscription = await SubscriptionService.getSubscriptionByUserId(userId);
            if (!subscription) {
                res.status(404).json({
                    success: false,
                    message: 'Subscription not found',
                });
                return;
            }

            const history = await SubscriptionHistory.find({ subscriptionId: subscription._id })
                .sort({ createdAt: -1 })
                .limit(50);

            res.json({
                success: true,
                data: history,
            });
        } catch (error: any) {
            loggingService.error('Get subscription history failed', {
                requestId,
                userId,
                error: error.message,
            });
            next(error);
        }
        return;
    }
}