import { Response } from 'express';
import { IntegrationService } from '../services/integration.service';
import { NotificationService } from '../services/notification.service';
import { loggingService } from '../services/logging.service';

export class IntegrationController {
    /**
     * Create a new integration
     * POST /api/integrations
     */
    static async createIntegration(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { type, name, description, credentials, alertRouting, deliveryConfig } = req.body;

            if (!type || !name || !credentials) {
                return res.status(400).json({
                    success: false,
                    message: 'Type, name, and credentials are required'
                });
            }

            const integration = await IntegrationService.createIntegration({
                userId,
                type,
                name,
                description,
                credentials,
                alertRouting,
                deliveryConfig
            });

            return res.status(201).json({
                success: true,
                message: 'Integration created successfully',
                data: {
                    id: integration._id,
                    type: integration.type,
                    name: integration.name,
                    description: integration.description,
                    status: integration.status,
                    alertRouting: Object.fromEntries(integration.alertRouting),
                    deliveryConfig: integration.deliveryConfig,
                    stats: integration.stats,
                    createdAt: integration.createdAt
                }
            });
        } catch (error: any) {
            loggingService.error('Error creating integration', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to create integration'
            });
        }
    }

    /**
     * Get all integrations for the user
     * GET /api/integrations
     */
    static async getIntegrations(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { type, status } = req.query;

            const integrations = await IntegrationService.getUserIntegrations(userId, {
                type: type as any,
                status: status as string
            });

            // Format response without exposing credentials
            const formattedIntegrations = integrations.map(integration => ({
                id: integration._id,
                type: integration.type,
                name: integration.name,
                description: integration.description,
                status: integration.status,
                alertRouting: Object.fromEntries(integration.alertRouting || new Map()),
                deliveryConfig: integration.deliveryConfig,
                stats: integration.stats,
                healthCheckStatus: integration.healthCheckStatus,
                lastHealthCheck: integration.lastHealthCheck,
                errorMessage: integration.errorMessage,
                createdAt: integration.createdAt,
                updatedAt: integration.updatedAt
            }));

            return res.status(200).json({
                success: true,
                data: formattedIntegrations,
                count: formattedIntegrations.length
            });
        } catch (error: any) {
            loggingService.error('Error getting integrations', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get integrations'
            });
        }
    }

    /**
     * Get a specific integration
     * GET /api/integrations/:id
     */
    static async getIntegration(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;

            const integration = await IntegrationService.getIntegrationById(id, userId);

            if (!integration) {
                return res.status(404).json({
                    success: false,
                    message: 'Integration not found'
                });
            }

            return res.status(200).json({
                success: true,
                data: {
                    id: integration._id,
                    type: integration.type,
                    name: integration.name,
                    description: integration.description,
                    status: integration.status,
                    alertRouting: Object.fromEntries(integration.alertRouting || new Map()),
                    deliveryConfig: integration.deliveryConfig,
                    stats: integration.stats,
                    healthCheckStatus: integration.healthCheckStatus,
                    lastHealthCheck: integration.lastHealthCheck,
                    errorMessage: integration.errorMessage,
                    createdAt: integration.createdAt,
                    updatedAt: integration.updatedAt
                }
            });
        } catch (error: any) {
            loggingService.error('Error getting integration', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get integration'
            });
        }
    }

    /**
     * Update an integration
     * PUT /api/integrations/:id
     */
    static async updateIntegration(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;
            const updates = req.body;

            const integration = await IntegrationService.updateIntegration(id, userId, updates);

            if (!integration) {
                return res.status(404).json({
                    success: false,
                    message: 'Integration not found'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Integration updated successfully',
                data: {
                    id: integration._id,
                    type: integration.type,
                    name: integration.name,
                    description: integration.description,
                    status: integration.status,
                    alertRouting: Object.fromEntries(integration.alertRouting || new Map()),
                    deliveryConfig: integration.deliveryConfig,
                    stats: integration.stats,
                    updatedAt: integration.updatedAt
                }
            });
        } catch (error: any) {
            loggingService.error('Error updating integration', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to update integration'
            });
        }
    }

    /**
     * Delete an integration
     * DELETE /api/integrations/:id
     */
    static async deleteIntegration(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;

            const deleted = await IntegrationService.deleteIntegration(id, userId);

            if (!deleted) {
                return res.status(404).json({
                    success: false,
                    message: 'Integration not found'
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Integration deleted successfully'
            });
        } catch (error: any) {
            loggingService.error('Error deleting integration', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to delete integration'
            });
        }
    }

    /**
     * Test an integration
     * POST /api/integrations/:id/test
     */
    static async testIntegration(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;

            const result = await IntegrationService.testIntegration(id, userId);

            return res.status(200).json({
                success: result.success,
                message: result.message,
                data: {
                    responseTime: result.responseTime
                }
            });
        } catch (error: any) {
            loggingService.error('Error testing integration', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to test integration'
            });
        }
    }

    /**
     * Get integration statistics
     * GET /api/integrations/:id/stats
     */
    static async getIntegrationStats(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;

            const stats = await IntegrationService.getIntegrationStats(id, userId);

            if (!stats) {
                return res.status(404).json({
                    success: false,
                    message: 'Integration not found'
                });
            }

            return res.status(200).json({
                success: true,
                data: stats
            });
        } catch (error: any) {
            loggingService.error('Error getting integration stats', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get integration stats'
            });
        }
    }

    /**
     * Get delivery logs
     * GET /api/integrations/:id/logs
     */
    static async getDeliveryLogs(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;
            const { status, alertType, startDate, endDate, limit } = req.query;

            const logs = await NotificationService.getDeliveryLogs(userId, id, {
                status: status as string,
                alertType: alertType as string,
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                limit: limit ? parseInt(limit as string) : undefined
            });

            return res.status(200).json({
                success: true,
                data: logs,
                count: logs.length
            });
        } catch (error: any) {
            loggingService.error('Error getting delivery logs', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get delivery logs'
            });
        }
    }

    /**
     * Get all delivery logs (not filtered by integration)
     * GET /api/integrations/logs/all
     */
    static async getAllDeliveryLogs(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { status, alertType, startDate, endDate, limit } = req.query;

            const logs = await NotificationService.getDeliveryLogs(userId, undefined, {
                status: status as string,
                alertType: alertType as string,
                startDate: startDate ? new Date(startDate as string) : undefined,
                endDate: endDate ? new Date(endDate as string) : undefined,
                limit: limit ? parseInt(limit as string) : undefined
            });

            return res.status(200).json({
                success: true,
                data: logs,
                count: logs.length
            });
        } catch (error: any) {
            loggingService.error('Error getting all delivery logs', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get delivery logs'
            });
        }
    }

    /**
     * Get Slack channels for OAuth integration
     * GET /api/integrations/:id/slack/channels
     */
    static async getSlackChannels(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;

            const channels = await IntegrationService.getSlackChannels(id, userId);

            return res.status(200).json({
                success: true,
                data: channels
            });
        } catch (error: any) {
            loggingService.error('Error getting Slack channels', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get Slack channels'
            });
        }
    }

    /**
     * Get Discord guilds for bot integration
     * GET /api/integrations/:id/discord/guilds
     */
    static async getDiscordGuilds(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;

            const guilds = await IntegrationService.getDiscordGuilds(id, userId);

            return res.status(200).json({
                success: true,
                data: guilds
            });
        } catch (error: any) {
            loggingService.error('Error getting Discord guilds', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get Discord guilds'
            });
        }
    }

    /**
     * Get Discord channels for a guild
     * GET /api/integrations/:id/discord/guilds/:guildId/channels
     */
    static async getDiscordChannels(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id, guildId } = req.params;

            const channels = await IntegrationService.getDiscordChannels(id, userId, guildId);

            return res.status(200).json({
                success: true,
                data: channels
            });
        } catch (error: any) {
            loggingService.error('Error getting Discord channels', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get Discord channels'
            });
        }
    }

    /**
     * Retry failed deliveries for an alert
     * POST /api/integrations/alerts/:alertId/retry
     */
    static async retryFailedDeliveries(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { alertId } = req.params;

            await NotificationService.retryFailedDeliveries(alertId);

            return res.status(200).json({
                success: true,
                message: 'Failed deliveries retried successfully'
            });
        } catch (error: any) {
            loggingService.error('Error retrying failed deliveries', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to retry deliveries'
            });
        }
    }
}

