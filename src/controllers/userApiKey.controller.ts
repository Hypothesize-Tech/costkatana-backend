import { Response, NextFunction } from 'express';
import { User } from '../models/User';
import { loggingService } from '../services/logging.service';
import { AuthService } from '../services/auth.service';
import { encrypt } from '../utils/helpers';
import { z } from 'zod';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';

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

/**
 * Controller for managing user dashboard API keys
 */
export class UserApiKeyController {
    /**
     * Create a new dashboard API key
     * POST /api/user/dashboard-api-keys
     */
    static async createDashboardApiKey(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) {
            return;
        }
        const userId = req.userId!;
        ControllerHelper.logRequestStart('createDashboardApiKey', req);

        try {
            const { name, permissions, expiresAt } = createApiKeySchema.parse(req.body);

            const user: any = await User.findById(userId);
            if (!user) {
                ControllerHelper.logRequestSuccess('createDashboardApiKey', req, startTime, { userFound: false });
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Check if user already has maximum number of API keys (limit to 10)
            if (user.dashboardApiKeys.length >= 10) {
                ControllerHelper.logRequestSuccess('createDashboardApiKey', req, startTime, { limitReached: true });
                res.status(400).json({
                    success: false,
                    message: 'Maximum number of API keys reached (10)',
                });
                return;
            }

            // Check for duplicate names
            const existingKey: any = user.dashboardApiKeys.find((k: any) => k.name === name);
            if (existingKey) {
                ControllerHelper.logRequestSuccess('createDashboardApiKey', req, startTime, { duplicateName: true });
                res.status(400).json({
                    success: false,
                    message: 'API key with this name already exists',
                });
                return;
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

            ControllerHelper.logRequestSuccess('createDashboardApiKey', req, startTime, {
                keyId,
                name,
                permissions
            });
            ControllerHelper.logBusinessEvent(
                'api_key_created',
                'user_management',
                userId,
                undefined,
                { keyId, name, permissions }
            );

            // Keep existing response format (backward compatibility)
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
            ControllerHelper.handleError('createDashboardApiKey', error, req, res, startTime);
            next(error);
        }
        return;
    }

    /**
     * Get all dashboard API keys for the user
     * GET /api/user/dashboard-api-keys
     */
    static async getDashboardApiKeys(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) {
            return;
        }
        const userId = req.userId!;
        ControllerHelper.logRequestStart('getDashboardApiKeys', req);

        try {
            const user: any = await User.findById(userId).select('dashboardApiKeys');
            if (!user) {
                ControllerHelper.logRequestSuccess('getDashboardApiKeys', req, startTime, { userFound: false });
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
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

            ControllerHelper.logRequestSuccess('getDashboardApiKeys', req, startTime, {
                keyCount: apiKeys.length
            });

            // Keep existing response format (backward compatibility)
            res.json({
                success: true,
                data: apiKeys,
            });
        } catch (error: any) {
            ControllerHelper.handleError('getDashboardApiKeys', error, req, res, startTime);
            next(error);
        }
        return;
    }

    /**
     * Delete a dashboard API key
     * DELETE /api/user/dashboard-api-keys/:keyId
     */
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
                return;
            }

            const keyIndex: any = user.dashboardApiKeys.findIndex((k: any) => k.keyId === keyId);
            if (keyIndex === -1) {
                res.status(404).json({
                    success: false,
                    message: 'API key not found',
                });
                return;
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

    /**
     * Update a dashboard API key
     * PUT /api/user/dashboard-api-keys/:keyId
     */
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
                return;
            }

            const apiKey: any = user.dashboardApiKeys.find((k: any) => k.keyId === keyId);
            if (!apiKey) {
                res.status(404).json({
                    success: false,
                    message: 'API key not found',
                });
                return;
            }

            // Check for duplicate names (excluding current key)
            if (name && name !== apiKey.name) {
                const existingKey: any = user.dashboardApiKeys.find((k: any) => k.name === name && k.keyId !== keyId);
                if (existingKey) {
                    res.status(400).json({
                        success: false,
                        message: 'API key with this name already exists',
                    });
                    return;
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
}
