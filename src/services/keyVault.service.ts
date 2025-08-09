import crypto from 'crypto';
import mongoose, { Types } from 'mongoose';
import { ProviderKey, IProviderKey, ProxyKey, IProxyKey } from '../models';
import { encrypt, decrypt } from '../utils/helpers';
import { logger } from '../utils/logger';

export interface CreateProviderKeyRequest {
    name: string;
    provider: 'openai' | 'anthropic' | 'google' | 'cohere' | 'aws-bedrock' | 'deepseek' | 'groq';
    apiKey: string;
    description?: string;
}

export interface CreateProxyKeyRequest {
    name: string;
    providerKeyId: string;
    description?: string;
    projectId?: string;
    // Team/Project-based distribution
    teamId?: string;
    assignedProjects?: string[];
    scope?: 'personal' | 'team' | 'project' | 'organization';
    sharedWith?: string[]; // User IDs to share with
    permissions?: ('read' | 'write' | 'admin')[];
    budgetLimit?: number;
    dailyBudgetLimit?: number;
    monthlyBudgetLimit?: number;
    rateLimit?: number;
    allowedIPs?: string[];
    allowedDomains?: string[];
    expiresAt?: Date;
}

export interface ProxyKeyUsage {
    proxyKeyId: string;
    cost: number;
    requests: number;
}

export class KeyVaultService {
    /**
     * Create a new provider key in the vault
     */
    static async createProviderKey(userId: string, request: CreateProviderKeyRequest): Promise<IProviderKey> {
        try {
            // Check if user already has a provider key with this name and provider
            const existingKey = await ProviderKey.findOne({
                userId: new Types.ObjectId(userId),
                provider: request.provider,
                name: request.name
            });

            if (existingKey) {
                throw new Error(`Provider key with name "${request.name}" for ${request.provider} already exists`);
            }

            // Encrypt the API key
            const { encrypted, iv, authTag } = encrypt(request.apiKey);
            const encryptedKey = `${iv}:${authTag}:${encrypted}`;

            // Create masked version of the key
            const maskedKey = this.maskApiKey(request.apiKey);

            // Create the provider key
            const providerKey = new ProviderKey({
                name: request.name,
                provider: request.provider,
                encryptedKey,
                maskedKey,
                userId: new Types.ObjectId(userId),
                description: request.description,
                isActive: true
            });

            await providerKey.save();

            logger.info('Provider key created successfully', {
                userId,
                provider: request.provider,
                name: request.name,
                keyId: providerKey._id
            });

            return providerKey;
        } catch (error) {
            logger.error('Failed to create provider key', error as Error, {
                userId,
                provider: request.provider,
                name: request.name
            });
            throw error;
        }
    }

    /**
     * Create a new proxy key linked to a provider key
     */
    static async createProxyKey(userId: string, request: CreateProxyKeyRequest): Promise<IProxyKey> {
        try {
            // Verify the provider key exists and belongs to the user
            const providerKey = await ProviderKey.findOne({
                _id: new Types.ObjectId(request.providerKeyId),
                userId: new Types.ObjectId(userId),   
                isActive: true
            });

            if (!providerKey) {
                throw new Error('Provider key not found or not accessible');
            }

            // Generate unique proxy key ID
            const keyId = this.generateProxyKeyId();

            // Verify project exists if projectId is provided
            if (request.projectId) {
                const { Project } = await import('../models/Project');
                const project = await Project.findOne({
                    _id: new Types.ObjectId(request.projectId),
                    $or: [
                        { owner: new Types.ObjectId(userId) },
                        { members: new Types.ObjectId(userId) }
                    ]
                });

                if (!project) {
                    throw new Error('Project not found or not accessible');
                }
            }

            // Validate team access if teamId is provided
            if (request.teamId) {
                const { Team } = await import('../models/Team');
                const team = await Team.findOne({
                    _id: new Types.ObjectId(request.teamId),
                    $or: [
                        { ownerId: new Types.ObjectId(userId) },
                        { members: new Types.ObjectId(userId) }
                    ],
                    isActive: true
                });

                if (!team) {
                    throw new Error('Team not found or not accessible');
                }
            }

            // Validate assigned projects if provided
            if (request.assignedProjects && request.assignedProjects.length > 0) {
                const { Project } = await import('../models/Project');
                const projectIds = request.assignedProjects.map(id => new Types.ObjectId(id));
                const projects = await Project.find({
                    _id: { $in: projectIds },
                    $or: [
                        { owner: new Types.ObjectId(userId) },
                        { members: new Types.ObjectId(userId) }
                    ]
                });

                if (projects.length !== request.assignedProjects.length) {
                    throw new Error('One or more assigned projects not found or not accessible');
                }
            }

            // Validate shared users if provided
            if (request.sharedWith && request.sharedWith.length > 0) {
                const { User } = await import('../models/User');
                const userIds = request.sharedWith.map(id => new Types.ObjectId(id));
                const users = await User.find({
                    _id: { $in: userIds }
                });

                if (users.length !== request.sharedWith.length) {
                    throw new Error('One or more users to share with not found');
                }
            }

            // Create the proxy key
            const proxyKey = new ProxyKey({
                keyId,
                name: request.name,
                description: request.description,
                providerKeyId: new Types.ObjectId(request.providerKeyId),
                userId: new Types.ObjectId(userId),
                projectId: request.projectId ? new Types.ObjectId(request.projectId) : undefined,
                // Team/Project-based distribution fields
                teamId: request.teamId ? new Types.ObjectId(request.teamId) : undefined,
                assignedProjects: request.assignedProjects ? request.assignedProjects.map(id => new Types.ObjectId(id)) : undefined,
                scope: request.scope || 'personal',
                sharedWith: request.sharedWith ? request.sharedWith.map(id => new Types.ObjectId(id)) : undefined,
                permissions: request.permissions || ['read'],
                budgetLimit: request.budgetLimit,
                dailyBudgetLimit: request.dailyBudgetLimit,
                monthlyBudgetLimit: request.monthlyBudgetLimit,
                rateLimit: request.rateLimit,
                allowedIPs: request.allowedIPs,
                allowedDomains: request.allowedDomains,
                expiresAt: request.expiresAt,
                isActive: true,
                usageStats: {
                    totalRequests: 0,
                    totalCost: 0,
                    lastResetDate: new Date(),
                    dailyCost: 0,
                    monthlyCost: 0
                }
            });

            await proxyKey.save();

            logger.info('Proxy key created successfully', {
                userId,
                proxyKeyId: keyId,
                name: request.name,
                providerKeyId: request.providerKeyId
            });

            return proxyKey;
        } catch (error) {
            logger.error('Failed to create proxy key', error as Error, {
                userId,
                name: request.name,
                providerKeyId: request.providerKeyId
            });
            throw error;
        }
    }

    /**
     * Resolve a proxy key to get the master provider key
     */
    static async resolveProxyKey(proxyKeyId: string): Promise<{
        proxyKey: IProxyKey;
        providerKey: IProviderKey;
        decryptedApiKey: string;
    } | null> {
        try {
            // Find the proxy key
            const proxyKey = await ProxyKey.findOne({
                keyId: proxyKeyId,
                isActive: true
            }).populate('providerKeyId');

            if (!proxyKey) {
                return null;
            }

            // Check if proxy key is expired
            if (proxyKey.isExpired()) {
                logger.warn('Proxy key is expired', { proxyKeyId });
                return null;
            }

            // Check if proxy key is over budget
            if (proxyKey.isOverBudget()) {
                logger.warn('Proxy key is over budget', { proxyKeyId });
                return null;
            }

            const providerKey = proxyKey.providerKeyId as any as IProviderKey;
            
            if (!providerKey || !providerKey.isActive) {
                logger.warn('Provider key not found or inactive', { proxyKeyId });
                return null;
            }

            // Decrypt the provider API key
            const [iv, authTag, encrypted] = providerKey.encryptedKey.split(':');
            const decryptedApiKey = decrypt(encrypted, iv, authTag);

            // Update last used timestamp
            proxyKey.lastUsed = new Date();
            providerKey.lastUsed = new Date();
            
            await Promise.all([
                proxyKey.save(),
                providerKey.save()
            ]);

            return {
                proxyKey,
                providerKey,
                decryptedApiKey
            };
        } catch (error) {
            logger.error('Failed to resolve proxy key', error as Error, { proxyKeyId });
            return null;
        }
    }

    /**
     * Update proxy key usage statistics
     */
    static async updateProxyKeyUsage(proxyKeyId: string, cost: number, requests: number = 1): Promise<void> {
        try {
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

            await ProxyKey.updateOne(
                { keyId: proxyKeyId },
                {
                    $inc: {
                        'usageStats.totalRequests': requests,
                        'usageStats.totalCost': cost,
                        'usageStats.dailyCost': cost,
                        'usageStats.monthlyCost': cost
                    },
                    $set: {
                        lastUsed: now
                    }
                }
            );

            // Reset daily stats if it's a new day
            const proxyKey = await ProxyKey.findOne({ keyId: proxyKeyId });
            if (proxyKey && proxyKey.usageStats.lastResetDate < startOfDay) {
                await ProxyKey.updateOne(
                    { keyId: proxyKeyId },
                    {
                        $set: {
                            'usageStats.dailyCost': cost,
                            'usageStats.lastResetDate': startOfDay
                        }
                    }
                );
            }

            // Reset monthly stats if it's a new month
            if (proxyKey && proxyKey.usageStats.lastResetDate < startOfMonth) {
                await ProxyKey.updateOne(
                    { keyId: proxyKeyId },
                    {
                        $set: {
                            'usageStats.monthlyCost': cost
                        }
                    }
                );
            }
        } catch (error) {
            logger.error('Failed to update proxy key usage', error as Error, { proxyKeyId, cost, requests });
        }
    }

    /**
     * List all provider keys for a user
     */
    static async getProviderKeys(userId: string): Promise<IProviderKey[]> {
        return ProviderKey.find({
            userId: new Types.ObjectId(userId)
        }).sort({ createdAt: -1 });
    }

    /**
     * List all proxy keys for a user
     */
    static async getProxyKeys(userId: string, projectId?: string): Promise<IProxyKey[]> {
        const query: any = { userId: new Types.ObjectId(userId) };
        
        if (projectId) {
            query.projectId = new Types.ObjectId(projectId);
        }

        return ProxyKey.find(query)
            .populate('providerKeyId', 'name provider')
            .populate('projectId', 'name')
            .sort({ createdAt: -1 });
    }

    /**
     * Delete a provider key and all associated proxy keys
     */
    static async deleteProviderKey(userId: string, providerKeyId: string): Promise<void> {
        try {
            // Verify ownership
            const providerKey = await ProviderKey.findOne({
                _id: new Types.ObjectId(providerKeyId),
                userId: new Types.ObjectId(userId)
            });

            if (!providerKey) {
                throw new Error('Provider key not found');
            }

            // Delete all associated proxy keys
            await ProxyKey.deleteMany({
                providerKeyId: new Types.ObjectId(providerKeyId)
            });

            // Delete the provider key
            await ProviderKey.deleteOne({
                _id: new Types.ObjectId(providerKeyId)
            });

            logger.info('Provider key deleted successfully', {
                userId,
                providerKeyId,
                provider: providerKey.provider
            });
        } catch (error) {
            logger.error('Failed to delete provider key', error as Error, {
                userId,
                providerKeyId
            });
            throw error;
        }
    }

    /**
     * Delete a proxy key
     */
    static async deleteProxyKey(userId: string, proxyKeyId: string): Promise<void> {
        try {
            const result = await ProxyKey.deleteOne({
                keyId: proxyKeyId,
                userId: new Types.ObjectId(userId)
            });

            if (result.deletedCount === 0) {
                throw new Error('Proxy key not found');
            }

            logger.info('Proxy key deleted successfully', {
                userId,
                proxyKeyId
            });
        } catch (error) {
            logger.error('Failed to delete proxy key', error as Error, {
                userId,
                proxyKeyId
            });
            throw error;
        }
    }

    /**
     * Toggle proxy key active status
     */
    static async toggleProxyKey(userId: string, proxyKeyId: string, isActive: boolean): Promise<IProxyKey> {
        const proxyKey = await ProxyKey.findOneAndUpdate(
            {
                keyId: proxyKeyId,
                userId: new Types.ObjectId(userId)
            },
            { isActive },
            { new: true }
        );

        if (!proxyKey) {
            throw new Error('Proxy key not found');
        }

        logger.info('Proxy key status updated', {
            userId,
            proxyKeyId,
            isActive
        });

        return proxyKey;
    }

    /**
     * Generate a unique proxy key ID
     */
    private static generateProxyKeyId(): string {
        const randomBytes = crypto.randomBytes(16).toString('hex');
        return `ck-proxy-${randomBytes}`;
    }

    /**
     * Create a masked version of an API key
     */
    private static maskApiKey(apiKey: string): string {
        if (apiKey.length <= 8) {
            return '*'.repeat(apiKey.length);
        }

        const start = apiKey.substring(0, 4);
        const end = apiKey.substring(apiKey.length - 4);
        const middle = '*'.repeat(Math.max(4, apiKey.length - 8));

        return `${start}${middle}${end}`;
    }

    /**
     * Get proxy key analytics
     */
    static async getProxyKeyAnalytics(userId: string, proxyKeyId?: string): Promise<any> {
        const matchQuery: any = { userId: new Types.ObjectId(userId) };
        
        if (proxyKeyId) {
            matchQuery.keyId = proxyKeyId;
        }

        const analytics = await ProxyKey.aggregate([
            { $match: matchQuery },
            {
                $group: {
                    _id: null,
                    totalKeys: { $sum: 1 },
                    activeKeys: { $sum: { $cond: ['$isActive', 1, 0] } },
                    totalRequests: { $sum: '$usageStats.totalRequests' },
                    totalCost: { $sum: '$usageStats.totalCost' },
                    dailyCost: { $sum: '$usageStats.dailyCost' },
                    monthlyCost: { $sum: '$usageStats.monthlyCost' }
                }
            }
        ]);

        return analytics[0] || {
            totalKeys: 0,
            activeKeys: 0,
            totalRequests: 0,
            totalCost: 0,
            dailyCost: 0,
            monthlyCost: 0
        };
    }

    // ============================================
    // TEAM/PROJECT-BASED PROXY KEY DISTRIBUTION
    // ============================================

    /**
     * Get team-based key queries for a user
     */
    private static async getUserTeamKeyQueries(userId: string): Promise<any[]> {
        try {
            // Import Team model dynamically to avoid circular dependency
            const Team = mongoose.model('Team');
            
            // Find teams where user is a member
            const teams = await Team.find({
                $or: [
                    { ownerId: new Types.ObjectId(userId) },
                    { 'members.userId': new Types.ObjectId(userId) }
                ]
            }).select('_id').lean();

            if (teams.length === 0) {
                return [];
            }

            const teamIds = teams.map((team: any) => team._id);
            
            // Return query conditions for team keys
            return [
                { teamId: { $in: teamIds } }
            ];
        } catch (error) {
            logger.error('Error getting user team key queries:', error);
            return [];
        }
    }

    /**
     * Get proxy keys accessible by a user (including shared keys)
     */
    static async getAccessibleProxyKeys(userId: string): Promise<IProxyKey[]> {
        try {
            const proxyKeys = await ProxyKey.find({
                $or: [
                    // Keys owned by the user
                    { userId: new Types.ObjectId(userId) },
                    // Keys shared with the user
                    { sharedWith: new Types.ObjectId(userId) },
                    // Team keys where user is a member
                    ...(await this.getUserTeamKeyQueries(userId))
                ],
                isActive: true
            })
            .populate('providerKeyId', 'name provider maskedKey')
            .populate('projectId', 'name')
            .populate('teamId', 'name')
            .populate('assignedProjects', 'name')
            .populate('sharedWith', 'name email')
            .sort({ createdAt: -1 });

            return proxyKeys;
        } catch (error) {
            logger.error('Error getting accessible proxy keys', error as Error, { userId });
            throw new Error('Failed to get accessible proxy keys');
        }
    }

    /**
     * Share a proxy key with other users
     */
    static async shareProxyKey(
        userId: string,
        proxyKeyId: string,
        shareWith: string[]
    ): Promise<IProxyKey> {
        try {
            // Find the proxy key and verify ownership
            const proxyKey = await ProxyKey.findOne({
                keyId: proxyKeyId,
                userId: new Types.ObjectId(userId),
                isActive: true
            });

            if (!proxyKey) {
                throw new Error('Proxy key not found or not accessible');
            }

            // Validate users exist
            const { User } = await import('../models/User');
            const userIds = shareWith.map(id => new Types.ObjectId(id));
            const users = await User.find({
                _id: { $in: userIds }
            });

            if (users.length !== shareWith.length) {
                throw new Error('One or more users not found');
            }

            // Update shared users
            proxyKey.sharedWith = userIds as any;
            proxyKey.scope = 'team'; // Update scope when sharing
            await proxyKey.save();

            logger.info('Proxy key shared successfully', {
                userId,
                proxyKeyId,
                sharedWith: shareWith
            });

            return proxyKey;
        } catch (error) {
            logger.error('Error sharing proxy key', error as Error, {
                userId,
                proxyKeyId,
                shareWith
            });
            throw error;
        }
    }

    /**
     * Assign proxy key to projects
     */
    static async assignProxyKeyToProjects(
        userId: string,
        proxyKeyId: string,
        projectIds: string[]
    ): Promise<IProxyKey> {
        try {
            // Find the proxy key and verify ownership
            const proxyKey = await ProxyKey.findOne({
                keyId: proxyKeyId,
                userId: new Types.ObjectId(userId),
                isActive: true
            });

            if (!proxyKey) {
                throw new Error('Proxy key not found or not accessible');
            }

            // Validate projects exist and user has access
            const { Project } = await import('../models/Project');
            const projectObjectIds = projectIds.map(id => new Types.ObjectId(id));
            const projects = await Project.find({
                _id: { $in: projectObjectIds },
                $or: [
                    { owner: new Types.ObjectId(userId) },
                    { members: new Types.ObjectId(userId) }
                ]
            });

            if (projects.length !== projectIds.length) {
                throw new Error('One or more projects not found or not accessible');
            }

            // Update assigned projects
            proxyKey.assignedProjects = projectObjectIds as any;
            proxyKey.scope = 'project'; // Update scope when assigning to projects
            await proxyKey.save();

            logger.info('Proxy key assigned to projects successfully', {
                userId,
                proxyKeyId,
                projectIds
            });

            return proxyKey;
        } catch (error) {
            logger.error('Error assigning proxy key to projects', error as Error, {
                userId,
                proxyKeyId,
                projectIds
            });
            throw error;
        }
    }

    /**
     * Get proxy keys for a specific team
     */
    static async getTeamProxyKeys(userId: string, teamId: string): Promise<IProxyKey[]> {
        try {
            // Verify user has access to the team
            const { Team } = await import('../models/Team');
            const team = await Team.findOne({
                _id: new Types.ObjectId(teamId),
                $or: [
                    { ownerId: new Types.ObjectId(userId) },
                    { members: new Types.ObjectId(userId) }
                ],
                isActive: true
            });

            if (!team) {
                throw new Error('Team not found or not accessible');
            }

            // Get proxy keys for the team
            const proxyKeys = await ProxyKey.find({
                teamId: new Types.ObjectId(teamId),
                isActive: true
            })
            .populate('providerKeyId', 'name provider maskedKey')
            .populate('userId', 'name email')
            .populate('assignedProjects', 'name')
            .sort({ createdAt: -1 });

            return proxyKeys;
        } catch (error) {
            logger.error('Error getting team proxy keys', error as Error, {
                userId,
                teamId
            });
            throw error;
        }
    }

    /**
     * Get proxy keys for a specific project
     */
    static async getProjectProxyKeys(userId: string, projectId: string): Promise<IProxyKey[]> {
        try {
            // Verify user has access to the project
            const { Project } = await import('../models/Project');
            const project = await Project.findOne({
                _id: new Types.ObjectId(projectId),
                $or: [
                    { owner: new Types.ObjectId(userId) },
                    { members: new Types.ObjectId(userId) }
                ]
            });

            if (!project) {
                throw new Error('Project not found or not accessible');
            }

            // Get proxy keys assigned to the project
            const proxyKeys = await ProxyKey.find({
                $or: [
                    { projectId: new Types.ObjectId(projectId) },
                    { assignedProjects: new Types.ObjectId(projectId) }
                ],
                isActive: true
            })
            .populate('providerKeyId', 'name provider maskedKey')
            .populate('userId', 'name email')
            .populate('teamId', 'name')
            .sort({ createdAt: -1 });

            return proxyKeys;
        } catch (error) {
            logger.error('Error getting project proxy keys', error as Error, {
                userId,
                projectId
            });
            throw error;
        }
    }

    /**
     * Validate if a user can use a specific proxy key
     */
    static async validateProxyKeyAccess(proxyKeyId: string, userId: string): Promise<boolean> {
        try {
            const proxyKey = await ProxyKey.findOne({
                keyId: proxyKeyId,
                isActive: true
            });

            if (!proxyKey) {
                return false;
            }

            // Use the model method to check access
            return proxyKey.canBeUsedBy(new Types.ObjectId(userId) as any);
        } catch (error) {
            logger.error('Error validating proxy key access', error as Error, {
                proxyKeyId,
                userId
            });
            return false;
        }
    }
}