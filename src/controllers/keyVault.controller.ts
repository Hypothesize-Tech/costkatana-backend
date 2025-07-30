import { Response } from 'express';
import { z } from 'zod';
import { KeyVaultService, CreateProxyKeyRequest } from '../services/keyVault.service';
import { logger } from '../utils/logger';

// Validation schemas
const createProviderKeySchema = z.object({
    name: z.string().min(1).max(100).trim(),
    provider: z.enum(['openai', 'anthropic', 'google', 'cohere', 'aws-bedrock', 'deepseek', 'groq']),
    apiKey: z.string().min(1),
    description: z.string().max(500).optional()
});

const createProxyKeySchema = z.object({
    name: z.string().min(1).max(100).trim(),
    providerKeyId: z.string().min(1),
    description: z.string().max(500).optional(),
    projectId: z.string().optional(),
    permissions: z.array(z.enum(['read', 'write', 'admin'])).optional(),
    budgetLimit: z.number().min(0).optional(),
    dailyBudgetLimit: z.number().min(0).optional(),
    monthlyBudgetLimit: z.number().min(0).optional(),
    rateLimit: z.number().min(1).max(10000).optional(),
    allowedIPs: z.array(z.string()).optional(),
    allowedDomains: z.array(z.string()).optional(),
    expiresAt: z.string().datetime().optional()
});

const updateProxyKeyStatusSchema = z.object({
    isActive: z.boolean()
});

export class KeyVaultController {
    /**
     * Create a new provider key
     */
    static async createProviderKey(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const validatedData = createProviderKeySchema.parse(req.body);

            const providerKey = await KeyVaultService.createProviderKey(userId, validatedData);

            // Return the created provider key without the encrypted key
            const response = {
                _id: providerKey._id,
                name: providerKey.name,
                provider: providerKey.provider,
                maskedKey: providerKey.maskedKey,
                description: providerKey.description,
                isActive: providerKey.isActive,
                createdAt: providerKey.createdAt,
                lastUsed: providerKey.lastUsed
            };

            res.status(201).json({
                success: true,
                message: 'Provider key created successfully',
                data: response
            });
        } catch (error) {
            logger.error('Failed to create provider key', error as Error, {
                userId: req.user?.id,
                provider: req.body?.provider
            });

            if (error instanceof z.ZodError) {
                res.status(400).json({
                    success: false,
                    error: 'Validation error',
                    details: error.errors
                });
                return;
            }

            res.status(400).json({
                success: false,
                error: (error as Error).message
            });
        }
    }

    /**
     * Create a new proxy key
     */
    static async createProxyKey(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const validatedData = createProxyKeySchema.parse(req.body);

            // Convert expiresAt string to Date if provided
            const requestData: CreateProxyKeyRequest = {
                ...validatedData,
                expiresAt: validatedData.expiresAt ? new Date(validatedData.expiresAt) : undefined
            };

            const proxyKey = await KeyVaultService.createProxyKey(userId, requestData);

            res.status(201).json({
                success: true,
                message: 'Proxy key created successfully',
                data: {
                    _id: proxyKey._id,
                    keyId: proxyKey.keyId,
                    name: proxyKey.name,
                    description: proxyKey.description,
                    providerKeyId: proxyKey.providerKeyId,
                    projectId: proxyKey.projectId,
                    permissions: proxyKey.permissions,
                    budgetLimit: proxyKey.budgetLimit,
                    dailyBudgetLimit: proxyKey.dailyBudgetLimit,
                    monthlyBudgetLimit: proxyKey.monthlyBudgetLimit,
                    rateLimit: proxyKey.rateLimit,
                    allowedIPs: proxyKey.allowedIPs,
                    allowedDomains: proxyKey.allowedDomains,
                    isActive: proxyKey.isActive,
                    createdAt: proxyKey.createdAt,
                    expiresAt: proxyKey.expiresAt,
                    usageStats: proxyKey.usageStats
                }
            });
        } catch (error) {
            logger.error('Failed to create proxy key', error as Error, {
                userId: req.user?.id,
                providerKeyId: req.body?.providerKeyId
            });

            if (error instanceof z.ZodError) {
                res.status(400).json({
                    success: false,
                    error: 'Validation error',
                    details: error.errors
                });
                return;
            }

            res.status(400).json({
                success: false,
                error: (error as Error).message
            });
        }
    }

    /**
     * Get all provider keys for the authenticated user
     */
    static async getProviderKeys(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const providerKeys = await KeyVaultService.getProviderKeys(userId);

            // Return provider keys without encrypted keys
            const response = providerKeys.map(key => ({
                _id: key._id,
                name: key.name,
                provider: key.provider,
                maskedKey: key.maskedKey,
                description: key.description,
                isActive: key.isActive,
                createdAt: key.createdAt,
                lastUsed: key.lastUsed
            }));

            res.json({
                success: true,
                data: response
            });
        } catch (error) {
            logger.error('Failed to get provider keys', error as Error, {
                userId: req.user?.id
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve provider keys'
            });
        }
    }

    /**
     * Get all proxy keys for the authenticated user
     */
    static async getProxyKeys(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const projectId = req.query.projectId as string;

            const proxyKeys = await KeyVaultService.getProxyKeys(userId, projectId);

            res.json({
                success: true,
                data: proxyKeys
            });
        } catch (error) {
            logger.error('Failed to get proxy keys', error as Error, {
                userId: req.user?.id,
                projectId: req.query.projectId
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve proxy keys'
            });
        }
    }

    /**
     * Delete a provider key
     */
    static async deleteProviderKey(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const providerKeyId = req.params.providerKeyId;

            if (!providerKeyId) {
                res.status(400).json({
                    success: false,
                    error: 'Provider key ID is required'
                });
                return;
            }

            await KeyVaultService.deleteProviderKey(userId, providerKeyId);

            res.json({
                success: true,
                message: 'Provider key deleted successfully'
            });
        } catch (error) {
            logger.error('Failed to delete provider key', error as Error, {
                userId: req.user?.id,
                providerKeyId: req.params.providerKeyId
            });

            res.status(400).json({
                success: false,
                error: (error as Error).message
            });
        }
    }

    /**
     * Delete a proxy key
     */
    static async deleteProxyKey(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const proxyKeyId = req.params.proxyKeyId;

            if (!proxyKeyId) {
                res.status(400).json({
                    success: false,
                    error: 'Proxy key ID is required'
                });
                return;
            }

            await KeyVaultService.deleteProxyKey(userId, proxyKeyId);

            res.json({
                success: true,
                message: 'Proxy key deleted successfully'
            });
        } catch (error) {
            logger.error('Failed to delete proxy key', error as Error, {
                userId: req.user?.id,
                proxyKeyId: req.params.proxyKeyId
            });

            res.status(400).json({
                success: false,
                error: (error as Error).message
            });
        }
    }

    /**
     * Toggle proxy key active status
     */
    static async updateProxyKeyStatus(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const proxyKeyId = req.params.proxyKeyId;
            const { isActive } = updateProxyKeyStatusSchema.parse(req.body);

            if (!proxyKeyId) {
                res.status(400).json({
                    success: false,
                    error: 'Proxy key ID is required'
                });
                return;
            }

            const updatedProxyKey = await KeyVaultService.toggleProxyKey(userId, proxyKeyId, isActive);

            res.json({
                success: true,
                message: `Proxy key ${isActive ? 'activated' : 'deactivated'} successfully`,
                data: updatedProxyKey
            });
        } catch (error) {
            logger.error('Failed to update proxy key status', error as Error, {
                userId: req.user?.id,
                proxyKeyId: req.params.proxyKeyId
            });

            if (error instanceof z.ZodError) {
                res.status(400).json({
                    success: false,
                    error: 'Validation error',
                    details: error.errors
                });
                return;
            }

            res.status(400).json({
                success: false,
                error: (error as Error).message
            });
        }
    }

    /**
     * Get proxy key analytics
     */
    static async getProxyKeyAnalytics(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;
            const proxyKeyId = req.query.proxyKeyId as string;

            const analytics = await KeyVaultService.getProxyKeyAnalytics(userId, proxyKeyId);

            res.json({
                success: true,
                data: analytics
            });
        } catch (error) {
            logger.error('Failed to get proxy key analytics', error as Error, {
                userId: req.user?.id,
                proxyKeyId: req.query.proxyKeyId
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve proxy key analytics'
            });
        }
    }

    /**
     * Get key vault dashboard data
     */
    static async getDashboard(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user!.id;

            const [providerKeys, proxyKeys, analytics] = await Promise.all([
                KeyVaultService.getProviderKeys(userId),
                KeyVaultService.getProxyKeys(userId),
                KeyVaultService.getProxyKeyAnalytics(userId)
            ]);

            // Format provider keys (remove encrypted keys)
            const formattedProviderKeys = providerKeys.map(key => ({
                _id: key._id,
                name: key.name,
                provider: key.provider,
                maskedKey: key.maskedKey,
                description: key.description,
                isActive: key.isActive,
                createdAt: key.createdAt,
                lastUsed: key.lastUsed
            }));

            res.json({
                success: true,
                data: {
                    providerKeys: formattedProviderKeys,
                    proxyKeys,
                    analytics
                }
            });
        } catch (error) {
            logger.error('Failed to get key vault dashboard', error as Error, {
                userId: req.user?.id
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve key vault dashboard'
            });
        }
    }
}