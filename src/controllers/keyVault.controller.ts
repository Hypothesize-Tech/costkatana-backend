import { Response } from 'express';
import { z } from 'zod';
import { KeyVaultService, CreateProxyKeyRequest } from '../services/keyVault.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

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
    static async createProviderKey(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const validatedData = createProviderKeySchema.parse(req.body);

        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('createProviderKey', req);

            // Ensure all required fields are present
            const providerKeyRequest = {
                name: validatedData.name,
                provider: validatedData.provider,
                apiKey: validatedData.apiKey,
                description: validatedData.description
            };

            const providerKey = await KeyVaultService.createProviderKey(userId, providerKeyRequest);

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

            ControllerHelper.logRequestSuccess('createProviderKey', req, startTime, {
                providerKeyId: providerKey._id
            });

            // Log business event
            loggingService.logBusiness({
                event: 'provider_key_created',
                category: 'key_vault_operations',
                value: Date.now() - startTime,
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
            if (error instanceof z.ZodError) {
                res.status(400).json({
                    success: false,
                    error: 'Validation error',
                    details: error.errors
                });
                return;
            }
            ControllerHelper.handleError('createProviderKey', error, req, res, startTime);
        }
    }

    /**
     * Create a new proxy key
     */
    static async createProxyKey(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const validatedData = createProxyKeySchema.parse(req.body);

        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('createProxyKey', req);
            
            ServiceHelper.validateObjectId(validatedData.providerKeyId, 'providerKeyId');
            if (validatedData.projectId) {
                ServiceHelper.validateObjectId(validatedData.projectId, 'projectId');
            }

            // Convert expiresAt string to Date if provided and ensure required fields
            const requestData: CreateProxyKeyRequest = {
                name: validatedData.name,
                providerKeyId: validatedData.providerKeyId,
                description: validatedData.description,
                projectId: validatedData.projectId,
                permissions: validatedData.permissions,
                budgetLimit: validatedData.budgetLimit,
                dailyBudgetLimit: validatedData.dailyBudgetLimit,
                monthlyBudgetLimit: validatedData.monthlyBudgetLimit,
                rateLimit: validatedData.rateLimit,
                allowedIPs: validatedData.allowedIPs,
                allowedDomains: validatedData.allowedDomains,
                expiresAt: validatedData.expiresAt ? new Date(validatedData.expiresAt) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // Default to 1 year
            };

            const proxyKey = await KeyVaultService.createProxyKey(userId, requestData);

            ControllerHelper.logRequestSuccess('createProxyKey', req, startTime, {
                proxyKeyId: proxyKey._id
            });

            // Log business event
            loggingService.logBusiness({
                event: 'proxy_key_created',
                category: 'key_vault_operations',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('createProxyKey', error, req, res, startTime);
        }
    }

    /**
     * Get all provider keys for the authenticated user
     */
    static async getProviderKeys(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();

        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getProviderKeys', req);

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

            ControllerHelper.logRequestSuccess('getProviderKeys', req, startTime, {
                providerKeysCount: providerKeys.length
            });

            // Log business event
            loggingService.logBusiness({
                event: 'provider_keys_retrieved',
                category: 'key_vault_operations',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getProviderKeys', error, req, res, startTime);
        }
    }

    /**
     * Get all proxy keys for the authenticated user
     */
    static async getProxyKeys(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const projectId = req.query.projectId as string;

        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getProxyKeys', req);
            
            if (projectId) {
                ServiceHelper.validateObjectId(projectId, 'projectId');
            }

            const proxyKeys = await KeyVaultService.getProxyKeys(userId, projectId);

            ControllerHelper.logRequestSuccess('getProxyKeys', req, startTime, {
                proxyKeysCount: proxyKeys.length
            });

            // Log business event
            loggingService.logBusiness({
                event: 'proxy_keys_retrieved',
                category: 'key_vault_operations',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getProxyKeys', error, req, res, startTime);
        }
    }

    /**
     * Delete a provider key
     */
    static async deleteProviderKey(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const providerKeyId = req.params.providerKeyId;

        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('deleteProviderKey', req);
            
            if (!providerKeyId) {
                res.status(400).json({
                    success: false,
                    error: 'Provider key ID is required'
                });
                return;
            }
            
            ServiceHelper.validateObjectId(providerKeyId, 'providerKeyId');

            await KeyVaultService.deleteProviderKey(userId, providerKeyId);

            ControllerHelper.logRequestSuccess('deleteProviderKey', req, startTime);

            // Log business event
            loggingService.logBusiness({
                event: 'provider_key_deleted',
                category: 'key_vault_operations',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('deleteProviderKey', error, req, res, startTime);
        }
    }

    /**
     * Delete a proxy key
     */
    static async deleteProxyKey(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const proxyKeyId = req.params.proxyKeyId;

        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('deleteProxyKey', req);
            
            if (!proxyKeyId) {
                res.status(400).json({
                    success: false,
                    error: 'Proxy key ID is required'
                });
                return;
            }
            
            ServiceHelper.validateObjectId(proxyKeyId, 'proxyKeyId');

            await KeyVaultService.deleteProxyKey(userId, proxyKeyId);

            ControllerHelper.logRequestSuccess('deleteProxyKey', req, startTime);

            // Log business event
            loggingService.logBusiness({
                event: 'proxy_key_deleted',
                category: 'key_vault_operations',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('deleteProxyKey', error, req, res, startTime);
        }
    }

    /**
     * Toggle proxy key active status
     */
    static async updateProxyKeyStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const proxyKeyId = req.params.proxyKeyId;
        const { isActive } = updateProxyKeyStatusSchema.parse(req.body);

        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('updateProxyKeyStatus', req);
            
            if (!proxyKeyId) {
                res.status(400).json({
                    success: false,
                    error: 'Proxy key ID is required'
                });
                return;
            }
            
            ServiceHelper.validateObjectId(proxyKeyId, 'proxyKeyId');

            const updatedProxyKey = await KeyVaultService.toggleProxyKey(userId, proxyKeyId, isActive);

            ControllerHelper.logRequestSuccess('updateProxyKeyStatus', req, startTime);

            // Log business event
            loggingService.logBusiness({
                event: 'proxy_key_status_updated',
                category: 'key_vault_operations',
                value: Date.now() - startTime,
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
            if (error instanceof z.ZodError) {
                res.status(400).json({
                    success: false,
                    error: 'Validation error',
                    details: error.errors
                });
                return;
            }
            ControllerHelper.handleError('updateProxyKeyStatus', error, req, res, startTime);
        }
    }

    /**
     * Get proxy key analytics
     */
    static async getProxyKeyAnalytics(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        const proxyKeyId = req.query.proxyKeyId as string;

        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getProxyKeyAnalytics', req);
            
            if (proxyKeyId) {
                ServiceHelper.validateObjectId(proxyKeyId, 'proxyKeyId');
            }

            const analytics = await KeyVaultService.getProxyKeyAnalytics(userId, proxyKeyId);

            ControllerHelper.logRequestSuccess('getProxyKeyAnalytics', req, startTime);

            // Log business event
            loggingService.logBusiness({
                event: 'proxy_key_analytics_retrieved',
                category: 'key_vault_operations',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getProxyKeyAnalytics', error, req, res, startTime);
        }
    }

    /**
     * Get key vault dashboard data
     */
    static async getDashboard(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();

        try {
            if (!ControllerHelper.requireAuth(req, res)) return;
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getDashboard', req);

            const dashboardData = await KeyVaultService.getDashboardData(userId);

            ControllerHelper.logRequestSuccess('getDashboard', req, startTime, {
                providerKeysCount: dashboardData.providerKeys.length,
                proxyKeysCount: dashboardData.proxyKeys.length
            });

            // Log business event
            loggingService.logBusiness({
                event: 'key_vault_dashboard_retrieved',
                category: 'key_vault_operations',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getDashboard', error, req, res, startTime);
        }
    }
}