import crypto from 'crypto';
import mongoose, { Types } from 'mongoose';
import { ProviderKey, IProviderKey, ProxyKey, IProxyKey } from '../models';
import { encrypt, decrypt } from '../utils/helpers';
import { loggingService } from './logging.service';

// ============================================================================
// OPTIMIZATION UTILITY CLASSES
// ============================================================================

/**
 * Background processor for non-critical operations
 */
class KeyVaultBackgroundProcessor {
    private operationQueue: Array<() => Promise<void>> = [];
    private processor?: NodeJS.Timeout;

    queueOperation(operation: () => Promise<void>) {
        this.operationQueue.push(operation);
        this.startProcessor();
    }

    private startProcessor() {
        if (this.processor) return;

        this.processor = setTimeout(async () => {
            await this.processQueue();
            this.processor = undefined;

            if (this.operationQueue.length > 0) {
                this.startProcessor();
            }
        }, 100);
    }

    private async processQueue() {
        const operations = this.operationQueue.splice(0, 5); // Process 5 at a time
        await Promise.allSettled(operations.map(op => op()));
    }
}

/**
 * Key formatter with memoization
 */
class KeyFormatter {
    private formatCache = new Map<string, any>();

    formatProviderKey(key: any): any {
        const cacheKey = `provider_${key._id}_${key.updatedAt || key.createdAt}`;

        if (this.formatCache.has(cacheKey)) {
            return this.formatCache.get(cacheKey);
        }

        const formatted = {
            _id: key._id,
            name: key.name,
            provider: key.provider,
            maskedKey: key.maskedKey,
            description: key.description,
            isActive: key.isActive,
            createdAt: key.createdAt,
            lastUsed: key.lastUsed
        };

        this.formatCache.set(cacheKey, formatted);
        this.cleanupCache();
        return formatted;
    }

    formatProxyKeys(keys: any[]): any[] {
        return keys.map(key => this.formatProxyKey(key));
    }

    formatProxyKey(key: any): any {
        const cacheKey = `proxy_${key._id}_${key.updatedAt || key.createdAt}`;

        if (this.formatCache.has(cacheKey)) {
            return this.formatCache.get(cacheKey);
        }

        const formatted = {
            _id: key._id,
            keyId: key.keyId,
            name: key.name,
            description: key.description,
            providerKeyId: key.providerKeyId,
            projectId: key.projectId,
            permissions: key.permissions,
            budgetLimit: key.budgetLimit,
            dailyBudgetLimit: key.dailyBudgetLimit,
            monthlyBudgetLimit: key.monthlyBudgetLimit,
            rateLimit: key.rateLimit,
            allowedIPs: key.allowedIPs,
            allowedDomains: key.allowedDomains,
            isActive: key.isActive,
            createdAt: key.createdAt,
            expiresAt: key.expiresAt,
            usageStats: key.usageStats
        };

        this.formatCache.set(cacheKey, formatted);
        this.cleanupCache();
        return formatted;
    }

    // Cleanup cache periodically
    private cleanupCache() {
        if (this.formatCache.size > 1000) {
            const entries = Array.from(this.formatCache.entries());
            const toKeep = entries.slice(-500); // Keep last 500 entries
            this.formatCache.clear();
            toKeep.forEach(([key, value]) => this.formatCache.set(key, value));
        }
    }
}

/**
 * Crypto worker pool for non-blocking operations
 */
class CryptoWorkerPool {
    private queue: Array<{ operation: string; data: any; resolve: Function; reject: Function }> = [];

    async encrypt(data: string): Promise<{ encrypted: string; iv: string; authTag: string }> {
        return new Promise((resolve, reject) => {
            this.queue.push({ operation: 'encrypt', data, resolve, reject });
            this.processQueue();
        });
    }

    async decrypt(encrypted: string, iv: string, authTag: string): Promise<string> {
        return new Promise((resolve, reject) => {
            this.queue.push({ operation: 'decrypt', data: { encrypted, iv, authTag }, resolve, reject });
            this.processQueue();
        });
    }

    private processQueue() {
        if (this.queue.length === 0) return;

        // Process crypto operations in background
        setImmediate(() => {
            const job = this.queue.shift();
            if (job) {
                try {
                    const { encrypt, decrypt } = require('../utils/helpers');
                    const result = job.operation === 'encrypt' 
                        ? encrypt(job.data) 
                        : decrypt(job.data.encrypted, job.data.iv, job.data.authTag);
                    job.resolve(result);
                } catch (error) {
                    job.reject(error);
                }
                this.processQueue();
            }
        });
    }
}

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

    private static backgroundProcessor = new KeyVaultBackgroundProcessor();
    private static keyFormatter = new KeyFormatter();
    private static cryptoWorkerPool = new CryptoWorkerPool();

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

            loggingService.info('Provider key created successfully', { value:  { 
                userId,
                provider: request.provider,
                name: request.name,
                keyId: providerKey._id
             } });

            return providerKey;
        } catch (error) {
            loggingService.error('Failed to create provider key', {
                userId,
                provider: request.provider,
                name: request.name
            });
            throw error;
        }
    }

    /**
     * Create a new proxy key linked to a provider key with parallel validation
     */
    static async createProxyKey(userId: string, request: CreateProxyKeyRequest): Promise<IProxyKey> {
        try {
            // Generate unique proxy key ID
            const keyId = this.generateProxyKeyId();

            // Parallel validation of all entities
            const validationPromises = [
                this.validateProviderKey(userId, request.providerKeyId),
                request.projectId ? this.validateProject(userId, request.projectId) : Promise.resolve(null),
                request.teamId ? this.validateTeam(userId, request.teamId) : Promise.resolve(null),
                request.assignedProjects ? this.validateProjects(userId, request.assignedProjects) : Promise.resolve(null),
                request.sharedWith ? this.validateUsers(request.sharedWith) : Promise.resolve(null)
            ];

            const [providerKey, project, team, projects, users] = await Promise.all(validationPromises);

            // All validations passed, create proxy key
            return this.createProxyKeyWithValidatedData(userId, request, keyId, {
                providerKey,
                project,
                team,
                projects,
                users
            });
        } catch (error) {
            loggingService.error('Failed to create proxy key', {
                error: error instanceof Error ? error.message : String(error),
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
                loggingService.warn('Proxy key is expired', { value:  { proxyKeyId  } });
                return null;
            }

            // Check if proxy key is over budget
            if (proxyKey.isOverBudget()) {
                loggingService.warn('Proxy key is over budget', { value:  { proxyKeyId  } });
                return null;
            }

            const providerKey = proxyKey.providerKeyId as any as IProviderKey;
            
            if (!providerKey || !providerKey.isActive) {
                loggingService.warn('Provider key not found or inactive', { value:  { proxyKeyId  } });
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
            loggingService.error('Failed to resolve proxy key', {
                error: error instanceof Error ? error.message : String(error),
                proxyKeyId
            });
            return null;
        }
    }

    /**
     * Update proxy key usage statistics with atomic operations
     */
    static async updateProxyKeyUsage(proxyKeyId: string, cost: number, requests: number = 1): Promise<void> {
        try {
            const now = new Date();
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

            // Single atomic operation with conditional logic
            await ProxyKey.updateOne(
                { keyId: proxyKeyId },
                [
                    {
                        $set: {
                            'usageStats.totalRequests': { $add: ['$usageStats.totalRequests', requests] },
                            'usageStats.totalCost': { $add: ['$usageStats.totalCost', cost] },
                            'usageStats.dailyCost': {
                                $cond: [
                                    { $lt: ['$usageStats.lastResetDate', startOfDay] },
                                    cost, // Reset to current cost if new day
                                    { $add: ['$usageStats.dailyCost', cost] }
                                ]
                            },
                            'usageStats.monthlyCost': {
                                $cond: [
                                    { $lt: ['$usageStats.lastResetDate', startOfMonth] },
                                    cost, // Reset to current cost if new month
                                    { $add: ['$usageStats.monthlyCost', cost] }
                                ]
                            },
                            'usageStats.lastResetDate': {
                                $cond: [
                                    { $lt: ['$usageStats.lastResetDate', startOfDay] },
                                    startOfDay,
                                    '$usageStats.lastResetDate'
                                ]
                            },
                            lastUsed: now
                        }
                    }
                ]
            );
        } catch (error) {
            loggingService.error('Failed to update proxy key usage', {
                error: error instanceof Error ? error.message : String(error),
                proxyKeyId,
                cost,
                requests
            });
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
     * List all proxy keys for a user with memory-efficient population
     */
    static async getProxyKeys(userId: string, projectId?: string): Promise<IProxyKey[]> {
        const query: any = { userId: new Types.ObjectId(userId) };
        
        if (projectId) {
            query.projectId = new Types.ObjectId(projectId);
        }

        return ProxyKey.find(query)
            .select('keyId name description isActive usageStats createdAt providerKeyId projectId expiresAt budgetLimit dailyBudgetLimit monthlyBudgetLimit rateLimit allowedIPs allowedDomains permissions')
            .populate('providerKeyId', 'name provider maskedKey') // Only essential fields
            .populate('projectId', 'name') // Only name needed
            .lean()
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

            loggingService.info('Provider key deleted successfully', { value:  { 
                userId,
                providerKeyId,
                provider: providerKey.provider
             } });
        } catch (error) {
            loggingService.error('Failed to delete provider key', {
                error: error instanceof Error ? error.message : String(error),
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

            loggingService.info('Proxy key deleted successfully', { value:  { 
                userId,
                proxyKeyId
             } });
        } catch (error) {
            loggingService.error('Failed to delete proxy key', {
                error: error instanceof Error ? error.message : String(error),
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

        loggingService.info('Proxy key status updated', { value:  { 
            userId,
            proxyKeyId,
            isActive
         } });

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
            loggingService.error('Error getting user team key queries:', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    /**
     * Get proxy keys accessible by a user with optimized access control
     */
    static async getAccessibleProxyKeys(userId: string): Promise<IProxyKey[]> {
        try {
            // Use separate optimized queries instead of complex $or
            const [ownedKeys, sharedKeys, teamKeys] = await Promise.all([
                // Direct ownership - fastest query
                ProxyKey.find({ userId: new Types.ObjectId(userId), isActive: true })
                    .select('keyId name description usageStats createdAt providerKeyId projectId')
                    .populate('providerKeyId', 'name provider maskedKey')
                    .populate('projectId', 'name')
                    .lean(),
                
                // Shared keys - indexed query
                ProxyKey.find({ sharedWith: new Types.ObjectId(userId), isActive: true })
                    .select('keyId name description usageStats createdAt providerKeyId projectId')
                    .populate('providerKeyId', 'name provider maskedKey')
                    .populate('projectId', 'name')
                    .lean(),
                
                // Team keys - optimized with pre-computed team IDs
                this.getTeamProxyKeysOptimized(userId)
            ]);

            // Merge and deduplicate results
            const allKeys = [...ownedKeys, ...sharedKeys, ...teamKeys];
            const uniqueKeys = this.deduplicateKeys(allKeys);
            
            return uniqueKeys.sort((a: any, b: any) => 
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
        } catch (error) {
            loggingService.error('Error getting accessible proxy keys', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
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

            loggingService.info('Proxy key shared successfully', { value:  { 
                userId,
                proxyKeyId,
                sharedWith: shareWith
             } });

            return proxyKey;
        } catch (error) {
            loggingService.error('Error sharing proxy key', {
                error: error instanceof Error ? error.message : String(error),
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

            loggingService.info('Proxy key assigned to projects successfully', { value:  { 
                userId,
                proxyKeyId,
                projectIds
             } });

            return proxyKey;
        } catch (error) {
            loggingService.error('Error assigning proxy key to projects', {
                error: error instanceof Error ? error.message : String(error),
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
            loggingService.error('Error getting team proxy keys', {
                error: error instanceof Error ? error.message : String(error),
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
            loggingService.error('Error getting project proxy keys', {
                error: error instanceof Error ? error.message : String(error),
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
            loggingService.error('Error validating proxy key access', {
                error: error instanceof Error ? error.message : String(error),
                proxyKeyId,
                userId
            });
            return false;
        }
    }

    // ============================================================================
    // OPTIMIZATION UTILITY METHODS
    // ============================================================================

    /**
     * Validate provider key ownership and access
     */
    private static async validateProviderKey(userId: string, providerKeyId: string): Promise<any> {
        const providerKey = await ProviderKey.findOne({
            _id: new Types.ObjectId(providerKeyId),
            userId: new Types.ObjectId(userId),
            isActive: true
        }).lean();

        if (!providerKey) {
            throw new Error('Provider key not found or not accessible');
        }

        return providerKey;
    }

    /**
     * Validate project access
     */
    private static async validateProject(userId: string, projectId: string): Promise<any> {
        const { Project } = await import('../models/Project');
        const project = await Project.findOne({
            _id: new Types.ObjectId(projectId),
            $or: [
                { owner: new Types.ObjectId(userId) },
                { members: new Types.ObjectId(userId) }
            ]
        }).lean();

        if (!project) {
            throw new Error('Project not found or not accessible');
        }

        return project;
    }

    /**
     * Validate team access
     */
    private static async validateTeam(userId: string, teamId: string): Promise<any> {
        const { Team } = await import('../models/Team');
        const team = await Team.findOne({
            _id: new Types.ObjectId(teamId),
            $or: [
                { ownerId: new Types.ObjectId(userId) },
                { members: new Types.ObjectId(userId) }
            ],
            isActive: true
        }).lean();

        if (!team) {
            throw new Error('Team not found or not accessible');
        }

        return team;
    }

    /**
     * Validate multiple projects access
     */
    private static async validateProjects(userId: string, projectIds: string[]): Promise<any[]> {
        const { Project } = await import('../models/Project');
        const projectObjectIds = projectIds.map(id => new Types.ObjectId(id));
        const projects = await Project.find({
            _id: { $in: projectObjectIds },
            $or: [
                { owner: new Types.ObjectId(userId) },
                { members: new Types.ObjectId(userId) }
            ]
        }).lean();

        if (projects.length !== projectIds.length) {
            throw new Error('One or more assigned projects not found or not accessible');
        }

        return projects;
    }

    /**
     * Validate users exist
     */
    private static async validateUsers(userIds: string[]): Promise<any[]> {
        const { User } = await import('../models/User');
        const userObjectIds = userIds.map(id => new Types.ObjectId(id));
        const users = await User.find({
            _id: { $in: userObjectIds }
        }).lean();

        if (users.length !== userIds.length) {
            throw new Error('One or more users to share with not found');
        }

        return users;
    }

    /**
     * Create proxy key with validated data
     */
    private static async createProxyKeyWithValidatedData(
        userId: string,
        request: CreateProxyKeyRequest,
        keyId: string,
        validatedData: any
    ): Promise<IProxyKey> {
        const proxyKey = new ProxyKey({
            keyId,
            name: request.name,
            description: request.description,
            providerKeyId: new Types.ObjectId(request.providerKeyId),
            userId: new Types.ObjectId(userId),
            projectId: request.projectId ? new Types.ObjectId(request.projectId) : undefined,
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

        loggingService.info('Proxy key created successfully', { value: { 
            userId,
            proxyKeyId: keyId,
            name: request.name,
            providerKeyId: request.providerKeyId
        }});

        return proxyKey;
    }

    /**
     * Get team proxy keys optimized
     */
    private static async getTeamProxyKeysOptimized(userId: string): Promise<any[]> {
        try {
            const teamQueries = await this.getUserTeamKeyQueries(userId);
            if (teamQueries.length === 0) {
                return [];
            }

            return ProxyKey.find({
                $or: teamQueries,
                isActive: true
            })
            .select('keyId name description usageStats createdAt providerKeyId projectId')
            .populate('providerKeyId', 'name provider maskedKey')
            .populate('projectId', 'name')
            .lean();
        } catch (error) {
            loggingService.error('Error getting team proxy keys optimized', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            return [];
        }
    }

    /**
     * Deduplicate keys by keyId
     */
    private static deduplicateKeys(keys: any[]): any[] {
        const seen = new Set<string>();
        return keys.filter(key => {
            if (seen.has(key.keyId)) {
                return false;
            }
            seen.add(key.keyId);
            return true;
        });
    }

    /**
     * Get unified dashboard data with single aggregation
     */
    static async getDashboardData(userId: string): Promise<any> {
        try {
            const result = await ProxyKey.aggregate([
                {
                    $facet: {
                        // Provider keys summary
                        providerKeys: [
                            { $lookup: { from: 'providerkeys', localField: 'providerKeyId', foreignField: '_id', as: 'provider' }},
                            { $unwind: '$provider' },
                            { $match: { 'provider.userId': new Types.ObjectId(userId) }},
                            { $group: { _id: '$provider._id', provider: { $first: '$provider' }}},
                            { $replaceRoot: { newRoot: '$provider' }},
                            { $project: { 
                                _id: 1, name: 1, provider: 1, maskedKey: 1, 
                                description: 1, isActive: 1, createdAt: 1, lastUsed: 1 
                            }}
                        ],
                        // Proxy keys
                        proxyKeys: [
                            { $match: { userId: new Types.ObjectId(userId) }},
                            { $lookup: { from: 'providerkeys', localField: 'providerKeyId', foreignField: '_id', as: 'providerKey' }},
                            { $lookup: { from: 'projects', localField: 'projectId', foreignField: '_id', as: 'project' }},
                            { $project: {
                                keyId: 1, name: 1, description: 1, isActive: 1, usageStats: 1, 
                                createdAt: 1, expiresAt: 1, budgetLimit: 1, dailyBudgetLimit: 1,
                                monthlyBudgetLimit: 1, rateLimit: 1, allowedIPs: 1, allowedDomains: 1,
                                permissions: 1, 'providerKey.name': 1, 'providerKey.provider': 1,
                                'providerKey.maskedKey': 1, 'project.name': 1
                            }}
                        ],
                        // Analytics
                        analytics: [
                            { $match: { userId: new Types.ObjectId(userId) }},
                            {
                                $group: {
                                    _id: null,
                                    totalKeys: { $sum: 1 },
                                    activeKeys: { $sum: { $cond: ['$isActive', 1, 0] }},
                                    totalRequests: { $sum: '$usageStats.totalRequests' },
                                    totalCost: { $sum: '$usageStats.totalCost' },
                                    dailyCost: { $sum: '$usageStats.dailyCost' },
                                    monthlyCost: { $sum: '$usageStats.monthlyCost' }
                                }
                            }
                        ]
                    }
                }
            ]);

            const data = result[0];
            return {
                providerKeys: data.providerKeys || [],
                proxyKeys: data.proxyKeys || [],
                analytics: data.analytics[0] || {
                    totalKeys: 0,
                    activeKeys: 0,
                    totalRequests: 0,
                    totalCost: 0,
                    dailyCost: 0,
                    monthlyCost: 0
                }
            };
        } catch (error) {
            loggingService.error('Error getting dashboard data', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
            throw new Error('Failed to get dashboard data');
        }
    }
}