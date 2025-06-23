import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { Alert } from '../models/Alert';
import { updateProfileSchema, addApiKeySchema } from '../utils/validators';
import { encrypt } from '../utils/helpers';
import { logger } from '../utils/logger';

export class UserController {
    static async getProfile(req: Request, res: Response, next: NextFunction) {
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

    static async updateProfile(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const validatedData = updateProfileSchema.parse(req.body);

            const user = await User.findByIdAndUpdate(
                userId,
                { $set: validatedData },
                { new: true, runValidators: true }
            ).select('-password -resetPasswordToken -resetPasswordExpires -verificationToken');

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            res.json({
                success: true,
                message: 'Profile updated successfully',
                data: user,
            });
        } catch (error: any) {
            logger.error('Update profile error:', error);
            next(error);
        }
        return;
    }

    static async addApiKey(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { service, key } = addApiKeySchema.parse(req.body);

            // Encrypt the API key
            const { encrypted, iv, authTag } = encrypt(key);
            const encryptedKey = `${iv}:${authTag}:${encrypted}`;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            // Check if API key for this service already exists
            const existingKeyIndex = user.apiKeys.findIndex(k => k.service === service);

            if (existingKeyIndex !== -1) {
                // Update existing key
                user.apiKeys[existingKeyIndex] = {
                    service,
                    key: key.substring(0, 4) + '...' + key.substring(key.length - 4), // Store masked version
                    encryptedKey,
                    addedAt: new Date(),
                };
            } else {
                // Add new key
                user.apiKeys.push({
                    service,
                    key: key.substring(0, 4) + '...' + key.substring(key.length - 4), // Store masked version
                    encryptedKey,
                    addedAt: new Date(),
                });
            }

            await user.save();

            res.json({
                success: true,
                message: 'API key added successfully',
                data: {
                    service,
                    maskedKey: key.substring(0, 4) + '...' + key.substring(key.length - 4),
                    addedAt: new Date(),
                },
            });
        } catch (error: any) {
            logger.error('Add API key error:', error);
            next(error);
        }
        return;
    }

    static async removeApiKey(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { service } = req.params;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            const keyIndex = user.apiKeys.findIndex(k => k.service === service);
            if (keyIndex === -1) {
                return res.status(404).json({
                    success: false,
                    message: 'API key not found',
                });
            }

            user.apiKeys.splice(keyIndex, 1);
            await user.save();

            res.json({
                success: true,
                message: 'API key removed successfully',
            });
        } catch (error: any) {
            logger.error('Remove API key error:', error);
            next(error);
        }
        return;
    }

    static async getApiKeys(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;

            const user = await User.findById(userId).select('apiKeys');
            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            // Return only masked keys, not encrypted ones
            const apiKeys = user.apiKeys.map(k => ({
                service: k.service,
                maskedKey: k.key,
                addedAt: k.addedAt,
            }));

            res.json({
                success: true,
                data: apiKeys,
            });
        } catch (error: any) {
            logger.error('Get API keys error:', error);
            next(error);
        }
        return;
    }

    static async getAlerts(req: Request, res: Response, next: NextFunction) {
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

    static async markAlertAsRead(req: Request, res: Response, next: NextFunction) {
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

    static async markAllAlertsAsRead(req: Request, res: Response, next: NextFunction) {
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

    static async deleteAlert(req: Request, res: Response, next: NextFunction) {
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

    static async getSubscription(req: Request, res: Response, next: NextFunction) {
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

    static async updateSubscription(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { plan } = req.body;

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
}