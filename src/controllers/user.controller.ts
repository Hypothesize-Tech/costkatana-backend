import { Response, NextFunction } from 'express';
import { User } from '../models/User';
import { Alert } from '../models/Alert';
import { updateProfileSchema } from '../utils/validators';
import { loggingService } from '../services/logging.service';
import { AppError } from '../middleware/error.middleware';
import { AuthService } from '../services/auth.service';
import { accountClosureService } from '../services/accountClosure.service';
import { SubscriptionService } from '../services/subscription.service';
import mongoose from 'mongoose';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

/**
 * Core user controller for profile, alerts, preferences, and account management
 */
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
    
    // Stats timeout constant
    private static readonly STATS_TIMEOUT = 30000; // 30 seconds
    
    // ObjectId conversion utilities
    private static objectIdCache = new Map<string, mongoose.Types.ObjectId>();
    
    /**
     * Initialize background processor
     */
    static {
        UserController.startBackgroundProcessor();
    }
    static async getProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) {
            return;
        }
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getProfile', req);

        try {
            // Use ServiceHelper circuit breaker for database operations
            const user = await ServiceHelper.withCircuitBreaker(
                async () => {
                    const result = await User.findById(userId).select('-password -resetPasswordToken -resetPasswordExpires -verificationToken');
                    if (!result) {
                        throw new AppError('User not found', 404);
                    }
                    return result;
                },
                {
                    maxFailures: UserController.MAX_DB_FAILURES,
                    resetTimeout: UserController.DB_CIRCUIT_BREAKER_RESET_TIME,
                    operationName: 'user-getProfile'
                }
            );

            // Populate subscription if subscriptionId exists
            let subscription = null;
            if (user.subscriptionId) {
                const { SubscriptionService } = await import('../services/subscription.service');
                subscription = await SubscriptionService.getSubscriptionByUserId(userId);
            }

            // Convert user to plain object
            const userObject: any = user.toObject();
            
            // Transform _id to id for frontend compatibility
            if (userObject._id) {
                userObject.id = userObject._id.toString();
            }

            // Ensure role field is present (fallback to 'user' only if truly missing)
            // Check if role is undefined or null - preserve existing 'admin' or 'user' values
            if (!userObject.role) {
                const dbRole = user.role;
                if (!dbRole) {
                    // Role is truly missing in both object and DB, set to 'user'
                    userObject.role = 'user';
                    user.role = 'user';
                    await user.save().catch(err => {
                        loggingService.warn('Failed to update user role in database', {
                            userId,
                            error: err instanceof Error ? err.message : String(err)
                        });
                    });
                } else {
                    // Role exists in DB but not in object, use DB value
                    userObject.role = dbRole;
                }
            }

            // Add subscription to user object
            if (subscription) {
                userObject.subscription = subscription.toObject();
            } else {
                // If no subscription found, log warning (shouldn't happen, but safety check)
                if (user.subscriptionId) {
                    loggingService.warn('User has subscriptionId but subscription not found', { 
                        userId, 
                        subscriptionId: user.subscriptionId 
                    });
                }
                // Don't fail, just return user without subscription
            }

            ControllerHelper.logRequestSuccess('getProfile', req, startTime, {
                userName: user.name,
                userEmail: user.email
            });

            // Queue business event logging to background
            UserController.queueBackgroundOperation(async () => {
                ControllerHelper.logBusinessEvent(
                    'user_profile_retrieved',
                    'user_management',
                    userId,
                    undefined,
                    {
                        userEmail: user.email,
                        userName: user.name
                    }
                );
            });

            // Keep existing response format (backward compatibility)
            res.json({
                success: true,
                data: userObject,
            });
        } catch (error: any) {
            ControllerHelper.handleError('getProfile', error, req, res, startTime);
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

    static async getAlerts(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) {
            return;
        }
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getAlerts', req);

        try {
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

            ControllerHelper.logRequestSuccess('getAlerts', req, startTime, {
                alertCount: alerts.length,
                total,
                unreadOnly
            });

            // Keep existing response format (backward compatibility)
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
            ControllerHelper.handleError('getAlerts', error, req, res, startTime);
            next(error);
        }
    }

    static async markAlertAsRead(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) {
            return;
        }
        const userId = req.userId!;
        ControllerHelper.logRequestStart('markAlertAsRead', req);

        try {
            const { id } = req.params;

            // Validate MongoDB ObjectId
            ServiceHelper.validateObjectId(id, 'Alert ID');

            const alert = await Alert.findOneAndUpdate(
                { _id: id, userId },
                { read: true, readAt: new Date() },
                { new: true }
            );

            if (!alert) {
                ControllerHelper.logRequestSuccess('markAlertAsRead', req, startTime, { alertId: id, found: false });
                res.status(404).json({
                    success: false,
                    message: 'Alert not found',
                });
                return;
            }

            ControllerHelper.logRequestSuccess('markAlertAsRead', req, startTime, { alertId: id });
            ControllerHelper.logBusinessEvent(
                'alert_marked_read',
                'user_alerts',
                userId,
                undefined,
                { alertId: id }
            );

            // Keep existing response format (backward compatibility)
            res.json({
                success: true,
                message: 'Alert marked as read',
            });
        } catch (error: any) {
            ControllerHelper.handleError('markAlertAsRead', error, req, res, startTime);
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

    static async deleteAlert(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) {
            return;
        }
        const userId = req.userId!;
        ControllerHelper.logRequestStart('deleteAlert', req);

        try {
            const { id } = req.params;

            // Validate MongoDB ObjectId
            ServiceHelper.validateObjectId(id, 'Alert ID');

            const alert = await Alert.findOneAndDelete({ _id: id, userId });

            if (!alert) {
                ControllerHelper.logRequestSuccess('deleteAlert', req, startTime, { alertId: id, found: false });
                res.status(404).json({
                    success: false,
                    message: 'Alert not found',
                });
                return;
            }

            ControllerHelper.logRequestSuccess('deleteAlert', req, startTime, { alertId: id });
            ControllerHelper.logBusinessEvent(
                'alert_deleted',
                'user_alerts',
                userId,
                undefined,
                { alertId: id }
            );

            // Keep existing response format (backward compatibility)
            res.json({
                success: true,
                message: 'Alert deleted successfully',
            });
        } catch (error: any) {
            ControllerHelper.handleError('deleteAlert', error, req, res, startTime);
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
        const user: any = await User.findById(userId).select('createdAt usage subscriptionId');
        if (!user) {
            throw new Error('User not found');
        }

        // Fetch subscription if subscriptionId exists
        let subscription = null;
        if (user.subscriptionId) {
            const { SubscriptionService } = await import('../services/subscription.service');
            subscription = await SubscriptionService.getSubscriptionByUserId(userId);
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
            subscription: subscription ? {
                plan: subscription.plan,
                limits: subscription.limits
            } : {
                plan: 'free',
                limits: {
                    tokensPerMonth: 1000000,
                    requestsPerMonth: 10000,
                    logsPerMonth: 15000,
                    projects: 1,
                    workflows: 10,
                    seats: 1,
                }
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
}
