import { Response } from 'express';
import { z } from 'zod';
import { KeyVaultService, CreateProxyKeyRequest } from '../services/keyVault.service';
import { loggingService } from '../services/logging.service';

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
        const startTime = Date.now();
        const userId = req.user?.id;
        const validatedData = createProviderKeySchema.parse(req.body);

        try {
            loggingService.info('Provider key creation initiated', {
                userId,
                hasUserId: !!userId,
                providerKeyName: validatedData.name,
                provider: validatedData.provider,
                hasDescription: !!validatedData.description,
                hasApiKey: !!validatedData.apiKey,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Provider key creation failed - authentication required', {
                    providerKeyName: validatedData.name,
                    provider: validatedData.provider,
                    hasDescription: !!validatedData.description,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            loggingService.info('Provider key creation processing started', {
                userId,
                providerKeyName: validatedData.name,
                provider: validatedData.provider,
                hasDescription: !!validatedData.description,
                requestId: req.headers['x-request-id'] as string
            });

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

            const duration = Date.now() - startTime;

            loggingService.info('Provider key created successfully', {
                userId,
                providerKeyName: validatedData.name,
                provider: validatedData.provider,
                duration,
                providerKeyId: providerKey._id,
                hasDescription: !!validatedData.description,
                isActive: providerKey.isActive,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'provider_key_created',
                category: 'key_vault_operations',
                value: duration,
                metadata: {
                    userId,
                    providerKeyName: validatedData.name,
                    provider: validatedData.provider,
                    providerKeyId: providerKey._id,
                    hasDescription: !!validatedData.description,
                    isActive: providerKey.isActive
                }
            });

            res.status(201).json({
                success: true,
                message: 'Provider key created successfully',
                data: response
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Provider key creation failed', {
                userId,
                providerKeyName: validatedData?.name,
                provider: validatedData?.provider,
                hasDescription: !!validatedData?.description,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
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
                error: error.message
            });
        }
    }

    /**
     * Create a new proxy key
     */
    static async createProxyKey(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const validatedData = createProxyKeySchema.parse(req.body);

        try {
            loggingService.info('Proxy key creation initiated', {
                userId,
                hasUserId: !!userId,
                proxyKeyName: validatedData.name,
                providerKeyId: validatedData.providerKeyId,
                hasDescription: !!validatedData.description,
                hasProjectId: !!validatedData.projectId,
                hasPermissions: !!validatedData.permissions && validatedData.permissions.length > 0,
                hasBudgetLimits: !!(validatedData.budgetLimit || validatedData.dailyBudgetLimit || validatedData.monthlyBudgetLimit),
                hasRateLimit: !!validatedData.rateLimit,
                hasAllowedIPs: !!validatedData.allowedIPs && validatedData.allowedIPs.length > 0,
                hasAllowedDomains: !!validatedData.allowedDomains && validatedData.allowedDomains.length > 0,
                hasExpiresAt: !!validatedData.expiresAt,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Proxy key creation failed - authentication required', {
                    proxyKeyName: validatedData.name,
                    providerKeyId: validatedData.providerKeyId,
                    hasDescription: !!validatedData.description,
                    hasProjectId: !!validatedData.projectId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            loggingService.info('Proxy key creation processing started', {
                userId,
                proxyKeyName: validatedData.name,
                providerKeyId: validatedData.providerKeyId,
                hasDescription: !!validatedData.description,
                hasProjectId: !!validatedData.projectId,
                hasPermissions: !!validatedData.permissions && validatedData.permissions.length > 0,
                hasBudgetLimits: !!(validatedData.budgetLimit || validatedData.dailyBudgetLimit || validatedData.monthlyBudgetLimit),
                hasRateLimit: !!validatedData.rateLimit,
                hasAllowedIPs: !!validatedData.allowedIPs && validatedData.allowedIPs.length > 0,
                hasAllowedDomains: !!validatedData.allowedDomains && validatedData.allowedDomains.length > 0,
                hasExpiresAt: !!validatedData.expiresAt,
                requestId: req.headers['x-request-id'] as string
            });

            // Convert expiresAt string to Date if provided
            const requestData: CreateProxyKeyRequest = {
                ...validatedData,
                expiresAt: validatedData.expiresAt ? new Date(validatedData.expiresAt) : undefined
            };

            const proxyKey = await KeyVaultService.createProxyKey(userId, requestData);

            const duration = Date.now() - startTime;

            loggingService.info('Proxy key created successfully', {
                userId,
                proxyKeyName: validatedData.name,
                providerKeyId: validatedData.providerKeyId,
                duration,
                proxyKeyId: proxyKey._id,
                hasDescription: !!validatedData.description,
                hasProjectId: !!validatedData.projectId,
                hasPermissions: !!validatedData.permissions && validatedData.permissions.length > 0,
                hasBudgetLimits: !!(validatedData.budgetLimit || validatedData.dailyBudgetLimit || validatedData.monthlyBudgetLimit),
                hasRateLimit: !!validatedData.rateLimit,
                hasAllowedIPs: !!validatedData.allowedIPs && validatedData.allowedIPs.length > 0,
                hasAllowedDomains: !!validatedData.allowedDomains && validatedData.allowedDomains.length > 0,
                hasExpiresAt: !!validatedData.expiresAt,
                isActive: proxyKey.isActive,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'proxy_key_created',
                category: 'key_vault_operations',
                value: duration,
                metadata: {
                    userId,
                    proxyKeyName: validatedData.name,
                    providerKeyId: validatedData.providerKeyId,
                    proxyKeyId: proxyKey._id,
                    hasDescription: !!validatedData.description,
                    hasProjectId: !!validatedData.projectId,
                    hasPermissions: !!validatedData.permissions && validatedData.permissions.length > 0,
                    hasBudgetLimits: !!(validatedData.budgetLimit || validatedData.dailyBudgetLimit || validatedData.monthlyBudgetLimit),
                    hasRateLimit: !!validatedData.rateLimit,
                    hasAllowedIPs: !!validatedData.allowedIPs && validatedData.allowedIPs.length > 0,
                    hasAllowedDomains: !!validatedData.allowedDomains && validatedData.allowedDomains.length > 0,
                    hasExpiresAt: !!validatedData.expiresAt,
                    isActive: proxyKey.isActive
                }
            });

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
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Proxy key creation failed', {
                userId,
                proxyKeyName: validatedData?.name,
                providerKeyId: validatedData?.providerKeyId,
                hasDescription: !!validatedData?.description,
                hasProjectId: !!validatedData?.projectId,
                hasPermissions: !!validatedData?.permissions && validatedData?.permissions.length > 0,
                hasBudgetLimits: !!(validatedData?.budgetLimit || validatedData?.dailyBudgetLimit || validatedData?.monthlyBudgetLimit),
                hasRateLimit: !!validatedData?.rateLimit,
                hasAllowedIPs: !!validatedData?.allowedIPs && validatedData?.allowedIPs.length > 0,
                hasAllowedDomains: !!validatedData?.allowedDomains && validatedData?.allowedDomains.length > 0,
                hasExpiresAt: !!validatedData?.expiresAt,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
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
                error: error.message
            });
        }
    }

    /**
     * Get all provider keys for the authenticated user
     */
    static async getProviderKeys(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;

        try {
            loggingService.info('Provider keys retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Provider keys retrieval failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            loggingService.info('Provider keys retrieval processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

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

            const duration = Date.now() - startTime;

            loggingService.info('Provider keys retrieved successfully', {
                userId,
                duration,
                providerKeysCount: providerKeys.length,
                hasProviderKeys: !!providerKeys && providerKeys.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'provider_keys_retrieved',
                category: 'key_vault_operations',
                value: duration,
                metadata: {
                    userId,
                    providerKeysCount: providerKeys.length,
                    hasProviderKeys: !!providerKeys && providerKeys.length > 0
                }
            });

            res.json({
                success: true,
                data: response
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Provider keys retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
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
        const startTime = Date.now();
        const userId = req.user?.id;
        const projectId = req.query.projectId as string;

        try {
            loggingService.info('Proxy keys retrieval initiated', {
                userId,
                hasUserId: !!userId,
                projectId,
                hasProjectId: !!projectId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Proxy keys retrieval failed - authentication required', {
                    projectId,
                    hasProjectId: !!projectId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            loggingService.info('Proxy keys retrieval processing started', {
                userId,
                projectId,
                hasProjectId: !!projectId,
                requestId: req.headers['x-request-id'] as string
            });

            const proxyKeys = await KeyVaultService.getProxyKeys(userId, projectId);

            const duration = Date.now() - startTime;

            loggingService.info('Proxy keys retrieved successfully', {
                userId,
                projectId,
                hasProjectId: !!projectId,
                duration,
                proxyKeysCount: proxyKeys.length,
                hasProxyKeys: !!proxyKeys && proxyKeys.length > 0,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'proxy_keys_retrieved',
                category: 'key_vault_operations',
                value: duration,
                metadata: {
                    userId,
                    projectId,
                    hasProjectId: !!projectId,
                    proxyKeysCount: proxyKeys.length,
                    hasProxyKeys: !!proxyKeys && proxyKeys.length > 0
                }
            });

            res.json({
                success: true,
                data: proxyKeys
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Proxy keys retrieval failed', {
                userId,
                projectId,
                hasProjectId: !!projectId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
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
        const startTime = Date.now();
        const userId = req.user?.id;
        const providerKeyId = req.params.providerKeyId;

        try {
            loggingService.info('Provider key deletion initiated', {
                userId,
                hasUserId: !!userId,
                providerKeyId,
                hasProviderKeyId: !!providerKeyId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Provider key deletion failed - authentication required', {
                    providerKeyId,
                    hasProviderKeyId: !!providerKeyId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            if (!providerKeyId) {
                loggingService.warn('Provider key deletion failed - missing provider key ID', {
                    userId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Provider key ID is required'
                });
                return;
            }

            loggingService.info('Provider key deletion processing started', {
                userId,
                providerKeyId,
                requestId: req.headers['x-request-id'] as string
            });

            await KeyVaultService.deleteProviderKey(userId, providerKeyId);

            const duration = Date.now() - startTime;

            loggingService.info('Provider key deleted successfully', {
                userId,
                providerKeyId,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'provider_key_deleted',
                category: 'key_vault_operations',
                value: duration,
                metadata: {
                    userId,
                    providerKeyId
                }
            });

            res.json({
                success: true,
                message: 'Provider key deleted successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Provider key deletion failed', {
                userId,
                providerKeyId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Delete a proxy key
     */
    static async deleteProxyKey(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const proxyKeyId = req.params.proxyKeyId;

        try {
            loggingService.info('Proxy key deletion initiated', {
                userId,
                hasUserId: !!userId,
                proxyKeyId,
                hasProxyKeyId: !!proxyKeyId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Proxy key deletion failed - authentication required', {
                    proxyKeyId,
                    hasProxyKeyId: !!proxyKeyId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            if (!proxyKeyId) {
                loggingService.warn('Proxy key deletion failed - missing proxy key ID', {
                    userId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Proxy key ID is required'
                });
                return;
            }

            loggingService.info('Proxy key deletion processing started', {
                userId,
                proxyKeyId,
                requestId: req.headers['x-request-id'] as string
            });

            await KeyVaultService.deleteProxyKey(userId, proxyKeyId);

            const duration = Date.now() - startTime;

            loggingService.info('Proxy key deleted successfully', {
                userId,
                proxyKeyId,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'proxy_key_deleted',
                category: 'key_vault_operations',
                value: duration,
                metadata: {
                    userId,
                    proxyKeyId
                }
            });

            res.json({
                success: true,
                message: 'Proxy key deleted successfully'
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Proxy key deletion failed', {
                userId,
                proxyKeyId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Toggle proxy key active status
     */
    static async updateProxyKeyStatus(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const proxyKeyId = req.params.proxyKeyId;
        const { isActive } = updateProxyKeyStatusSchema.parse(req.body);

        try {
            loggingService.info('Proxy key status update initiated', {
                userId,
                hasUserId: !!userId,
                proxyKeyId,
                hasProxyKeyId: !!proxyKeyId,
                isActive,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Proxy key status update failed - authentication required', {
                    proxyKeyId,
                    hasProxyKeyId: !!proxyKeyId,
                    isActive,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            if (!proxyKeyId) {
                loggingService.warn('Proxy key status update failed - missing proxy key ID', {
                    userId,
                    isActive,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    error: 'Proxy key ID is required'
                });
                return;
            }

            loggingService.info('Proxy key status update processing started', {
                userId,
                proxyKeyId,
                isActive,
                requestId: req.headers['x-request-id'] as string
            });

            const updatedProxyKey = await KeyVaultService.toggleProxyKey(userId, proxyKeyId, isActive);

            const duration = Date.now() - startTime;

            loggingService.info('Proxy key status updated successfully', {
                userId,
                proxyKeyId,
                isActive,
                duration,
                hasUpdatedProxyKey: !!updatedProxyKey,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'proxy_key_status_updated',
                category: 'key_vault_operations',
                value: duration,
                metadata: {
                    userId,
                    proxyKeyId,
                    isActive,
                    hasUpdatedProxyKey: !!updatedProxyKey
                }
            });

            res.json({
                success: true,
                message: `Proxy key ${isActive ? 'activated' : 'deactivated'} successfully`,
                data: updatedProxyKey
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Proxy key status update failed', {
                userId,
                proxyKeyId,
                isActive,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
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
                error: error.message
            });
        }
    }

    /**
     * Get proxy key analytics
     */
    static async getProxyKeyAnalytics(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id;
        const proxyKeyId = req.query.proxyKeyId as string;

        try {
            loggingService.info('Proxy key analytics retrieval initiated', {
                userId,
                hasUserId: !!userId,
                proxyKeyId,
                hasProxyKeyId: !!proxyKeyId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Proxy key analytics retrieval failed - authentication required', {
                    proxyKeyId,
                    hasProxyKeyId: !!proxyKeyId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            loggingService.info('Proxy key analytics retrieval processing started', {
                userId,
                proxyKeyId,
                hasProxyKeyId: !!proxyKeyId,
                requestId: req.headers['x-request-id'] as string
            });

            const analytics = await KeyVaultService.getProxyKeyAnalytics(userId, proxyKeyId);

            const duration = Date.now() - startTime;

            loggingService.info('Proxy key analytics retrieved successfully', {
                userId,
                proxyKeyId,
                hasProxyKeyId: !!proxyKeyId,
                duration,
                hasAnalytics: !!analytics,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'proxy_key_analytics_retrieved',
                category: 'key_vault_operations',
                value: duration,
                metadata: {
                    userId,
                    proxyKeyId,
                    hasProxyKeyId: !!proxyKeyId,
                    hasAnalytics: !!analytics
                }
            });

            res.json({
                success: true,
                data: analytics
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Proxy key analytics retrieval failed', {
                userId,
                proxyKeyId,
                hasProxyKeyId: !!proxyKeyId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
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
        const startTime = Date.now();
        const userId = req.user?.id;

        try {
            loggingService.info('Key vault dashboard retrieval initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Key vault dashboard retrieval failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    error: 'Authentication required'
                });
                return;
            }

            loggingService.info('Key vault dashboard retrieval processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            
            const dashboardData = await KeyVaultService.getDashboardData(userId);

            const duration = Date.now() - startTime;

            loggingService.info('Key vault dashboard retrieved successfully', {
                userId,
                duration,
                providerKeysCount: dashboardData.providerKeys.length,
                proxyKeysCount: dashboardData.proxyKeys.length,
                hasProviderKeys: !!dashboardData.providerKeys && dashboardData.providerKeys.length > 0,
                hasProxyKeys: !!dashboardData.proxyKeys && dashboardData.proxyKeys.length > 0,
                hasAnalytics: !!dashboardData.analytics,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'key_vault_dashboard_retrieved',
                category: 'key_vault_operations',
                value: duration,
                metadata: {
                    userId,
                    providerKeysCount: dashboardData.providerKeys.length,
                    proxyKeysCount: dashboardData.proxyKeys.length,
                    hasProviderKeys: !!dashboardData.providerKeys && dashboardData.providerKeys.length > 0,
                    hasProxyKeys: !!dashboardData.proxyKeys && dashboardData.proxyKeys.length > 0,
                    hasAnalytics: !!dashboardData.analytics
                }
            });

            res.json({
                success: true,
                data: dashboardData
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Key vault dashboard retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                error: 'Failed to retrieve key vault dashboard'
            });
        }
    }
}