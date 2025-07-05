import { Response, NextFunction } from 'express';
import { User } from '../models/User';
import { Alert } from '../models/Alert';
import { updateProfileSchema, updateSubscriptionSchema } from '../utils/validators';
import { encrypt } from '../utils/helpers';
import { logger } from '../utils/logger';
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
    static async getProfile(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;

            const user = await User.findById(userId).select('-password -resetPasswordToken -resetPasswordExpires -verificationToken');

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            res.json({
                success: true,
                data: user,
            });
        } catch (error: any) {
            logger.error('Get profile error:', error);
            next(error);
        }
        return;
    }

    static async updateProfile(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { name, preferences, avatar } = updateProfileSchema.parse(req.body);

            const user = await User.findById(userId);

            if (!user) {
                return next(new AppError('User not found', 404));
            }

            if (name) user.name = name;
            if (avatar) user.avatar = avatar;
            if (preferences) {
                user.preferences = { ...user.preferences, ...preferences };
            }

            await user.save();

            res.json({
                success: true,
                message: 'Profile updated successfully',
                data: user,
            });
        } catch (error: any) {
            logger.error(`Error updating profile for user ${req.user!.id}:`, error);
            next(error);
        }
    }

    static async getPresignedAvatarUrl(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { fileName, fileType } = presignedUrlSchema.parse(req.body);

            const { uploadUrl, key } = await S3Service.getPresignedAvatarUploadUrl(userId, fileName, fileType);

            const finalUrl = `https://${process.env.AWS_S3_BUCKETNAME}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;

            res.json({
                success: true,
                data: {
                    uploadUrl,
                    key,
                    finalUrl
                },
            });
        } catch (error) {
            logger.error('Error getting pre-signed URL:', error);
            next(error);
        }
    }



    static async getAlerts(req: any, res: Response, next: NextFunction) {
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
            logger.error('Get alerts error:', error);
            next(error);
        }
    }

    static async markAlertAsRead(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { id } = req.params;

            const alert = await Alert.findOneAndUpdate(
                { _id: id, userId },
                { read: true, readAt: new Date() },
                { new: true }
            );

            if (!alert) {
                return res.status(404).json({
                    success: false,
                    message: 'Alert not found',
                });
            }

            res.json({
                success: true,
                message: 'Alert marked as read',
            });
        } catch (error: any) {
            logger.error('Mark alert as read error:', error);
            next(error);
        }
        return;
    }

    static async markAllAlertsAsRead(req: any, res: Response, next: NextFunction) {
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
            logger.error('Mark all alerts as read error:', error);
            next(error);
        }
    }

    static async deleteAlert(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { id } = req.params;

            const alert = await Alert.findOneAndDelete({ _id: id, userId });

            if (!alert) {
                return res.status(404).json({
                    success: false,
                    message: 'Alert not found',
                });
            }

            res.json({
                success: true,
                message: 'Alert deleted successfully',
            });
        } catch (error: any) {
            logger.error('Delete alert error:', error);
            next(error);
        }
        return;
    }

    static async getSubscription(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;

            const user = await User.findById(userId).select('subscription usage');
            if (!user) {
                return res.status(404).json({
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
            logger.error('Get subscription error:', error);
            next(error);
        }
        return;
    }

    static async updateSubscription(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { plan } = updateSubscriptionSchema.parse(req.body);

            if (!['free', 'pro', 'enterprise'].includes(plan)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid subscription plan',
                });
            }

            const limits = {
                free: { apiCalls: 1000, optimizations: 10 },
                pro: { apiCalls: 10000, optimizations: 100 },
                enterprise: { apiCalls: -1, optimizations: -1 }, // Unlimited
            };

            const user = await User.findByIdAndUpdate(
                userId,
                {
                    'subscription.plan': plan,
                    'subscription.limits': limits[plan as keyof typeof limits],
                    'subscription.startDate': new Date(),
                },
                { new: true }
            ).select('subscription');

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            res.json({
                success: true,
                message: 'Subscription updated successfully',
                data: user.subscription,
            });
        } catch (error: any) {
            logger.error('Update subscription error:', error);
            next(error);
        }
        return;
    }

    static async getUserStats(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;

            // Import required models
            const { Usage } = await import('../models/Usage');
            const { Optimization } = await import('../models/Optimization');

            // Get user data
            const user = await User.findById(userId).select('createdAt usage subscription');
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            // Calculate account age in days
            const accountAge = Math.floor((Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24));

            // Get total stats (all time)
            const [totalStats] = await Usage.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId) } },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' },
                        totalCalls: { $sum: 1 },
                        totalTokens: { $sum: '$totalTokens' },
                    }
                }
            ]);

            // Get current month stats
            const currentMonthStart = new Date();
            currentMonthStart.setDate(1);
            currentMonthStart.setHours(0, 0, 0, 0);

            const [currentMonthStats] = await Usage.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
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
            ]);

            // Get optimization stats
            const [optimizationStats] = await Optimization.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId) } },
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
            ]);

            // Get current month optimization stats
            const [currentMonthOptStats] = await Optimization.aggregate([
                {
                    $match: {
                        userId: new mongoose.Types.ObjectId(userId),
                        createdAt: { $gte: currentMonthStart }
                    }
                },
                {
                    $group: {
                        _id: null,
                        monthSaved: { $sum: '$costSaved' },
                    }
                }
            ]);

            // Get most used service and model
            const [serviceStats] = await Usage.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId) } },
                {
                    $group: {
                        _id: '$service',
                        count: { $sum: 1 },
                        cost: { $sum: '$cost' }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 1 }
            ]);

            const [modelStats] = await Usage.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId) } },
                {
                    $group: {
                        _id: '$model',
                        count: { $sum: 1 },
                        cost: { $sum: '$cost' }
                    }
                },
                { $sort: { count: -1 } },
                { $limit: 1 }
            ]);

            // Calculate average daily cost (for days with activity)
            const [dailyStats] = await Usage.aggregate([
                { $match: { userId: new mongoose.Types.ObjectId(userId) } },
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
            ]);

            // Calculate savings rate
            const totalSpent = totalStats?.totalCost || 0;
            const totalSaved = optimizationStats?.totalSaved || 0;
            const savingsRate = totalSpent > 0 ? (totalSaved / (totalSpent + totalSaved)) * 100 : 0;

            const stats = {
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

            res.json({
                success: true,
                data: stats,
            });
        } catch (error: any) {
            logger.error('Get user stats error:', error);
            next(error);
        }
        return;
    }

    static async getUserActivities(req: any, res: Response, next: NextFunction) {
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
            logger.error('Get user activities error:', error);
            next(error);
        }
        return;
    }

    static async createDashboardApiKey(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { name, permissions, expiresAt } = createApiKeySchema.parse(req.body);

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            // Check if user already has maximum number of API keys (limit to 10)
            if (user.dashboardApiKeys.length >= 10) {
                return res.status(400).json({
                    success: false,
                    message: 'Maximum number of API keys reached (10)',
                });
            }

            // Check for duplicate names
            const existingKey = user.dashboardApiKeys.find(k => k.name === name);
            if (existingKey) {
                return res.status(400).json({
                    success: false,
                    message: 'API key with this name already exists',
                });
            }

            // Generate new dashboard API key
            const { keyId, apiKey, maskedKey } = AuthService.generateDashboardApiKey(user, name, permissions);

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
            logger.error('Create dashboard API key error:', error);
            next(error);
        }
        return;
    }

    static async getDashboardApiKeys(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;

            const user = await User.findById(userId).select('dashboardApiKeys');
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            // Return only safe information (no encrypted keys)
            const apiKeys = user.dashboardApiKeys.map(k => ({
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
            logger.error('Get dashboard API keys error:', error);
            next(error);
        }
        return;
    }

    static async deleteDashboardApiKey(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { keyId } = req.params;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            const keyIndex = user.dashboardApiKeys.findIndex(k => k.keyId === keyId);
            if (keyIndex === -1) {
                return res.status(404).json({
                    success: false,
                    message: 'API key not found',
                });
            }

            const deletedKey = user.dashboardApiKeys[keyIndex];
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
            logger.error('Delete dashboard API key error:', error);
            next(error);
        }
        return;
    }

    static async updateDashboardApiKey(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { keyId } = req.params;
            const { name, permissions, expiresAt } = req.body;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            const apiKey = user.dashboardApiKeys.find(k => k.keyId === keyId);
            if (!apiKey) {
                return res.status(404).json({
                    success: false,
                    message: 'API key not found',
                });
            }

            // Check for duplicate names (excluding current key)
            if (name && name !== apiKey.name) {
                const existingKey = user.dashboardApiKeys.find(k => k.name === name && k.keyId !== keyId);
                if (existingKey) {
                    return res.status(400).json({
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
            logger.error('Update dashboard API key error:', error);
            next(error);
        }
        return;
    }
}