import { Integration, IIntegration, IntegrationType, IntegrationCredentials } from '../models/Integration';
import { loggingService } from './logging.service';
import { SlackService } from './slack.service';
import { DiscordService } from './discord.service';
import { LinearService } from './linear.service';
import mongoose from 'mongoose';

export interface CreateIntegrationDto {
    userId: string;
    type: IntegrationType;
    name: string;
    description?: string;
    credentials: IntegrationCredentials;
    alertRouting?: Record<string, any>;
    deliveryConfig?: {
        retryEnabled?: boolean;
        maxRetries?: number;
        timeout?: number;
        batchDelay?: number;
    };
    metadata?: Record<string, any>;
}

export interface UpdateIntegrationDto {
    name?: string;
    description?: string;
    status?: 'active' | 'inactive' | 'error' | 'pending';
    credentials?: IntegrationCredentials;
    alertRouting?: Record<string, any>;
    deliveryConfig?: {
        retryEnabled?: boolean;
        maxRetries?: number;
        timeout?: number;
        batchDelay?: number;
    };
}

export class IntegrationService {
    /**
     * Create a new integration
     */
    static async createIntegration(dto: CreateIntegrationDto): Promise<IIntegration> {
        try {
            const integration = new Integration({
                userId: new mongoose.Types.ObjectId(dto.userId),
                type: dto.type,
                name: dto.name,
                description: dto.description,
                status: 'pending',
                encryptedCredentials: '', // Will be set by setCredentials
                alertRouting: dto.alertRouting ? new Map(Object.entries(dto.alertRouting)) : new Map(),
                deliveryConfig: {
                    retryEnabled: dto.deliveryConfig?.retryEnabled ?? true,
                    maxRetries: dto.deliveryConfig?.maxRetries ?? 3,
                    timeout: dto.deliveryConfig?.timeout ?? 30000,
                    batchDelay: dto.deliveryConfig?.batchDelay
                },
                metadata: dto.metadata ?? {},
                stats: {
                    totalDeliveries: 0,
                    successfulDeliveries: 0,
                    failedDeliveries: 0,
                    averageResponseTime: 0
                }
            });

            // Encrypt and set credentials
            integration.setCredentials(dto.credentials);

            await integration.save();

            loggingService.info('Integration created successfully', {
                integrationId: integration._id,
                userId: dto.userId,
                type: dto.type
            });

            return integration;
        } catch (error: any) {
            loggingService.error('Failed to create integration', {
                error: error.message,
                userId: dto.userId,
                type: dto.type
            });
            throw error;
        }
    }

    /**
     * Get all integrations for a user
     */
    static async getUserIntegrations(userId: string, filters?: {
        type?: IntegrationType;
        status?: string;
    }): Promise<IIntegration[]> {
        try {
            const query: any = { userId: new mongoose.Types.ObjectId(userId) };

            if (filters?.type) {
                query.type = filters.type;
            }
            if (filters?.status) {
                query.status = filters.status;
            }

            const integrations = await Integration.find(query)
                .sort({ createdAt: -1 });

            return integrations;
        } catch (error: any) {
            loggingService.error('Failed to get user integrations', {
                error: error.message,
                userId
            });
            throw error;
        }
    }

    /**
     * Get a single integration by ID
     */
    static async getIntegrationById(integrationId: string, userId: string): Promise<IIntegration | null> {
        try {
            const integration = await Integration.findOne({
                _id: new mongoose.Types.ObjectId(integrationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            return integration;
        } catch (error: any) {
            loggingService.error('Failed to get integration', {
                error: error.message,
                integrationId,
                userId
            });
            throw error;
        }
    }

    /**
     * Update an integration
     */
    static async updateIntegration(
        integrationId: string,
        userId: string,
        updates: UpdateIntegrationDto
    ): Promise<IIntegration | null> {
        try {
            const integration = await Integration.findOne({
                _id: new mongoose.Types.ObjectId(integrationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!integration) {
                return null;
            }

            // Update basic fields
            if (updates.name) integration.name = updates.name;
            if (updates.description !== undefined) integration.description = updates.description;
            if (updates.status) integration.status = updates.status;

            // Update credentials if provided
            if (updates.credentials) {
                integration.setCredentials(updates.credentials);
            }

            // Update alert routing
            if (updates.alertRouting) {
                integration.alertRouting = new Map(Object.entries(updates.alertRouting)) as any;
            }

            // Update delivery config
            if (updates.deliveryConfig) {
                integration.deliveryConfig = {
                    ...integration.deliveryConfig,
                    ...updates.deliveryConfig
                };
            }

            // Update metadata if provided (for OAuth integrations that need to update autoCreateIssues, etc.)
            if ((updates as unknown as { metadata?: Record<string, unknown> }).metadata) {
                integration.metadata = {
                    ...(integration.metadata ?? {}),
                    ...(updates as unknown as { metadata?: Record<string, unknown> }).metadata
                };
            }

            await integration.save();

            loggingService.info('Integration updated successfully', {
                integrationId,
                userId
            });

            return integration;
        } catch (error: any) {
            loggingService.error('Failed to update integration', {
                error: error.message,
                integrationId,
                userId
            });
            throw error;
        }
    }

    /**
     * Delete an integration
     */
    static async deleteIntegration(integrationId: string, userId: string): Promise<boolean> {
        try {
            const result = await Integration.deleteOne({
                _id: new mongoose.Types.ObjectId(integrationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (result.deletedCount === 0) {
                return false;
            }

            loggingService.info('Integration deleted successfully', {
                integrationId,
                userId
            });

            return true;
        } catch (error: any) {
            loggingService.error('Failed to delete integration', {
                error: error.message,
                integrationId,
                userId
            });
            throw error;
        }
    }

    /**
     * Test an integration
     */
    static async testIntegration(integrationId: string, userId: string): Promise<{
        success: boolean;
        message: string;
        responseTime: number;
    }> {
        try {
            const integration = await Integration.findOne({
                _id: new mongoose.Types.ObjectId(integrationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!integration) {
                throw new Error('Integration not found');
            }

            const credentials = integration.getCredentials();
            let result;

            switch (integration.type) {
                case 'slack_webhook':
                    if (!credentials.webhookUrl) {
                        throw new Error('Webhook URL not configured');
                    }
                    result = await SlackService.testIntegration(credentials.webhookUrl);
                    break;

                case 'slack_oauth':
                    if (!credentials.accessToken || !credentials.channelId) {
                        throw new Error('Slack OAuth credentials not configured');
                    }
                    result = await SlackService.testIntegration(
                        undefined,
                        credentials.accessToken,
                        credentials.channelId
                    );
                    break;

                case 'discord_webhook':
                    if (!credentials.webhookUrl) {
                        throw new Error('Webhook URL not configured');
                    }
                    result = await DiscordService.testIntegration(credentials.webhookUrl);
                    break;

                case 'discord_oauth':
                    if (!credentials.botToken || !credentials.channelId) {
                        throw new Error('Discord bot credentials not configured');
                    }
                    result = await DiscordService.testIntegration(
                        undefined,
                        credentials.botToken,
                        credentials.channelId
                    );
                    break;

                case 'linear_oauth':
                    if (!credentials.accessToken || !credentials.teamId) {
                        throw new Error('Linear OAuth credentials not configured');
                    }
                    result = await LinearService.testIntegration(
                        credentials.accessToken,
                        credentials.teamId
                    );
                    break;

                case 'jira_oauth': {
                    if (!credentials.accessToken || !credentials.siteUrl || !credentials.projectKey) {
                        throw new Error('JIRA OAuth credentials not configured');
                    }
                    const { JiraService } = await import('./jira.service');
                    result = await JiraService.testIntegration(
                        credentials.siteUrl,
                        credentials.accessToken,
                        credentials.projectKey
                    );
                    break;
                }

                case 'custom_webhook':
                    if (!credentials.webhookUrl) {
                        throw new Error('Webhook URL not configured');
                    }
                    // For custom webhooks, we'll use the generic webhook test
                    result = await SlackService.testIntegration(credentials.webhookUrl);
                    break;

                default:
                    throw new Error(`Unsupported integration type: ${integration.type}`);
            }

            // Update integration status based on test result
            if (result.success) {
                integration.status = 'active';
                integration.lastHealthCheck = new Date();
                integration.healthCheckStatus = 'healthy';
                integration.errorMessage = undefined;
            } else {
                integration.status = 'error';
                integration.lastHealthCheck = new Date();
                integration.healthCheckStatus = 'unhealthy';
                integration.errorMessage = result.message;
            }

            await integration.save();

            loggingService.info('Integration tested', {
                integrationId,
                userId,
                success: result.success,
                responseTime: result.responseTime
            });

            return result;
        } catch (error: any) {
            loggingService.error('Failed to test integration', {
                error: error.message,
                integrationId,
                userId
            });

            // Update integration status to error
            const integration = await Integration.findById(integrationId);
            if (integration) {
                integration.status = 'error';
                integration.lastHealthCheck = new Date();
                integration.healthCheckStatus = 'unhealthy';
                integration.errorMessage = error.message;
                await integration.save();
            }

            return {
                success: false,
                message: error.message || 'Integration test failed',
                responseTime: 0
            };
        }
    }

    /**
     * Perform health check on an integration
     */
    static async performHealthCheck(integrationId: string): Promise<void> {
        try {
            const integration = await Integration.findById(integrationId);
            if (!integration) {
                return;
            }

            const credentials = integration.getCredentials();
            let isHealthy = false;

            try {
                switch (integration.type) {
                    case 'slack_webhook':
                        // Webhook URLs don't have a health check endpoint, assume healthy if URL exists
                        isHealthy = !!credentials.webhookUrl;
                        break;

                    case 'slack_oauth':
                        // Could verify token by making a simple API call
                        if (credentials.accessToken) {
                            await SlackService.listChannels(credentials.accessToken);
                            isHealthy = true;
                        }
                        break;

                    case 'discord_webhook':
                        isHealthy = !!credentials.webhookUrl;
                        break;

                    case 'discord_oauth':
                        if (credentials.botToken) {
                            await DiscordService.listGuilds(credentials.botToken);
                            isHealthy = true;
                        }
                        break;

                    case 'linear_oauth':
                        if (credentials.accessToken && credentials.teamId) {
                            await LinearService.testIntegration(credentials.accessToken, credentials.teamId);
                            isHealthy = true;
                        }
                        break;

                    case 'jira_oauth': {
                        if (credentials.accessToken && credentials.siteUrl && credentials.projectKey) {
                            const { JiraService } = await import('./jira.service');
                            await JiraService.testIntegration(
                                credentials.siteUrl,
                                credentials.accessToken,
                                credentials.projectKey
                            );
                            isHealthy = true;
                        }
                        break;
                    }

                    case 'custom_webhook':
                        isHealthy = !!credentials.webhookUrl;
                        break;
                }

                integration.lastHealthCheck = new Date();
                integration.healthCheckStatus = isHealthy ? 'healthy' : 'unhealthy';
                if (isHealthy) {
                    integration.status = 'active';
                    integration.errorMessage = undefined;
                }
            } catch (error: any) {
                integration.lastHealthCheck = new Date();
                integration.healthCheckStatus = 'unhealthy';
                integration.status = 'error';
                integration.errorMessage = error.message;
            }

            await integration.save();
        } catch (error: any) {
            loggingService.error('Health check failed', {
                error: error.message,
                integrationId
            });
        }
    }

    /**
     * Get integration statistics
     */
    static async getIntegrationStats(integrationId: string, userId: string): Promise<any> {
        try {
            const integration = await Integration.findOne({
                _id: new mongoose.Types.ObjectId(integrationId),
                userId: new mongoose.Types.ObjectId(userId)
            }).lean();

            if (!integration) {
                return null;
            }

            return {
                totalDeliveries: integration.stats.totalDeliveries,
                successfulDeliveries: integration.stats.successfulDeliveries,
                failedDeliveries: integration.stats.failedDeliveries,
                successRate: integration.stats.totalDeliveries > 0
                    ? (integration.stats.successfulDeliveries / integration.stats.totalDeliveries) * 100
                    : 0,
                averageResponseTime: integration.stats.averageResponseTime,
                lastDeliveryAt: integration.stats.lastDeliveryAt,
                lastSuccessAt: integration.stats.lastSuccessAt,
                lastFailureAt: integration.stats.lastFailureAt,
                healthStatus: integration.healthCheckStatus,
                lastHealthCheck: integration.lastHealthCheck
            };
        } catch (error: any) {
            loggingService.error('Failed to get integration stats', {
                error: error.message,
                integrationId,
                userId
            });
            throw error;
        }
    }

    /**
     * Update integration statistics after a delivery attempt
     */
    static async updateDeliveryStats(
        integrationId: string,
        success: boolean,
        responseTime: number
    ): Promise<void> {
        try {
            const integration = await Integration.findById(integrationId);
            if (!integration) {
                return;
            }

            integration.stats.totalDeliveries += 1;

            if (success) {
                integration.stats.successfulDeliveries += 1;
                integration.stats.lastSuccessAt = new Date();
            } else {
                integration.stats.failedDeliveries += 1;
                integration.stats.lastFailureAt = new Date();
            }

            integration.stats.lastDeliveryAt = new Date();

            // Update average response time (moving average)
            const currentAvg = integration.stats.averageResponseTime || 0;
            const totalCount = integration.stats.totalDeliveries;
            integration.stats.averageResponseTime = 
                (currentAvg * (totalCount - 1) + responseTime) / totalCount;

            await integration.save();
        } catch (error: any) {
            loggingService.error('Failed to update delivery stats', {
                error: error.message,
                integrationId
            });
        }
    }

    /**
     * Get Slack channels for OAuth integration
     */
    static async getSlackChannels(integrationId: string, userId: string): Promise<any[]> {
        try {
            const integration = await Integration.findOne({
                _id: new mongoose.Types.ObjectId(integrationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!integration || integration.type !== 'slack_oauth') {
                throw new Error('Integration not found or not a Slack OAuth integration');
            }

            const credentials = integration.getCredentials();
            if (!credentials.accessToken) {
                throw new Error('Access token not found');
            }

            return await SlackService.listChannels(credentials.accessToken);
        } catch (error: any) {
            loggingService.error('Failed to get Slack channels', {
                error: error.message,
                integrationId,
                userId
            });
            throw error;
        }
    }

    /**
     * Get Discord guilds and channels for bot integration
     */
    static async getDiscordGuilds(integrationId: string, userId: string): Promise<any[]> {
        try {
            const integration = await Integration.findOne({
                _id: new mongoose.Types.ObjectId(integrationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!integration || integration.type !== 'discord_oauth') {
                throw new Error('Integration not found or not a Discord OAuth integration');
            }

            const credentials = integration.getCredentials();
            if (!credentials.botToken) {
                throw new Error('Bot token not found');
            }

            return await DiscordService.listGuilds(credentials.botToken);
        } catch (error: any) {
            loggingService.error('Failed to get Discord guilds', {
                error: error.message,
                integrationId,
                userId
            });
            throw error;
        }
    }

    /**
     * Get Discord channels for a specific guild
     */
    static async getDiscordChannels(
        integrationId: string,
        userId: string,
        guildId: string
    ): Promise<any[]> {
        try {
            const integration = await Integration.findOne({
                _id: new mongoose.Types.ObjectId(integrationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!integration || integration.type !== 'discord_oauth') {
                throw new Error('Integration not found or not a Discord OAuth integration');
            }

            const credentials = integration.getCredentials();
            if (!credentials.botToken) {
                throw new Error('Bot token not found');
            }

            return await DiscordService.listGuildChannels(credentials.botToken, guildId);
        } catch (error: any) {
            loggingService.error('Failed to get Discord channels', {
                error: error.message,
                integrationId,
                userId,
                guildId
            });
            throw error;
        }
    }

    /**
     * Get Linear teams for OAuth integration
     */
    static async getLinearTeams(integrationId: string, userId: string): Promise<any[]> {
        try {
            const integration = await Integration.findOne({
                _id: new mongoose.Types.ObjectId(integrationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!integration || integration.type !== 'linear_oauth') {
                throw new Error('Integration not found or not a Linear OAuth integration');
            }

            const credentials = integration.getCredentials();
            if (!credentials.accessToken) {
                throw new Error('Access token not found');
            }

            return await LinearService.listTeams(credentials.accessToken);
        } catch (error: any) {
            loggingService.error('Failed to get Linear teams', {
                error: error.message,
                integrationId,
                userId
            });
            throw error;
        }
    }

    /**
     * Get Linear projects for a team
     */
    static async getLinearProjects(
        integrationId: string,
        userId: string,
        teamId: string
    ): Promise<any[]> {
        try {
            const integration = await Integration.findOne({
                _id: new mongoose.Types.ObjectId(integrationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!integration || integration.type !== 'linear_oauth') {
                throw new Error('Integration not found or not a Linear OAuth integration');
            }

            const credentials = integration.getCredentials();
            if (!credentials.accessToken) {
                throw new Error('Access token not found');
            }

            return await LinearService.listProjects(credentials.accessToken, teamId);
        } catch (error: any) {
            loggingService.error('Failed to get Linear projects', {
                error: error.message,
                integrationId,
                userId,
                teamId
            });
            throw error;
        }
    }

    /**
     * Get JIRA projects for OAuth integration
     */
    static async getJiraProjects(integrationId: string, userId: string): Promise<any[]> {
        try {
            const integration = await Integration.findOne({
                _id: new mongoose.Types.ObjectId(integrationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!integration || integration.type !== 'jira_oauth') {
                throw new Error('Integration not found or not a JIRA OAuth integration');
            }

            const credentials = integration.getCredentials();
            if (!credentials.accessToken || !credentials.siteUrl) {
                throw new Error('Access token or site URL not found');
            }

            const { JiraService } = await import('./jira.service');
            return await JiraService.listProjects(credentials.siteUrl, credentials.accessToken);
        } catch (error: any) {
            loggingService.error('Failed to get JIRA projects', {
                error: error.message,
                integrationId
            });
            throw error;
        }
    }

    /**
     * Get JIRA issue types for a project
     */
    static async getJiraIssueTypes(
        integrationId: string,
        userId: string,
        projectKey: string
    ): Promise<any[]> {
        try {
            const integration = await Integration.findOne({
                _id: new mongoose.Types.ObjectId(integrationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!integration || integration.type !== 'jira_oauth') {
                throw new Error('Integration not found or not a JIRA OAuth integration');
            }

            const credentials = integration.getCredentials();
            if (!credentials.accessToken || !credentials.siteUrl) {
                throw new Error('Access token or site URL not found');
            }

            const { JiraService } = await import('./jira.service');
            return await JiraService.getIssueTypes(credentials.siteUrl, credentials.accessToken, projectKey);
        } catch (error: any) {
            loggingService.error('Failed to get JIRA issue types', {
                error: error.message,
                integrationId,
                projectKey
            });
            throw error;
        }
    }

    /**
     * Get JIRA priorities
     */
    static async getJiraPriorities(integrationId: string, userId: string): Promise<any[]> {
        try {
            const integration = await Integration.findOne({
                _id: new mongoose.Types.ObjectId(integrationId),
                userId: new mongoose.Types.ObjectId(userId)
            });

            if (!integration || integration.type !== 'jira_oauth') {
                throw new Error('Integration not found or not a JIRA OAuth integration');
            }

            const credentials = integration.getCredentials();
            if (!credentials.accessToken || !credentials.siteUrl) {
                throw new Error('Access token or site URL not found');
            }

            const { JiraService } = await import('./jira.service');
            return await JiraService.listPriorities(credentials.siteUrl, credentials.accessToken);
        } catch (error: any) {
            loggingService.error('Failed to get JIRA priorities', {
                error: error.message,
                integrationId
            });
            throw error;
        }
    }
}

