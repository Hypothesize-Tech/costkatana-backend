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

            const { type, name, description, credentials, alertRouting, deliveryConfig, metadata } = req.body;

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
                deliveryConfig,
                metadata
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
     * Get Linear teams for OAuth integration
     * GET /api/integrations/:id/linear/teams
     */
    static async getLinearTeams(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;

            const teams = await IntegrationService.getLinearTeams(id, userId);

            return res.status(200).json({
                success: true,
                data: teams
            });
        } catch (error: any) {
            loggingService.error('Error getting Linear teams', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get Linear teams'
            });
        }
    }

    /**
     * Get Linear projects for a team
     * GET /api/integrations/:id/linear/teams/:teamId/projects
     */
    static async getLinearProjects(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id, teamId } = req.params;

            const projects = await IntegrationService.getLinearProjects(id, userId, teamId);

            return res.status(200).json({
                success: true,
                data: projects
            });
        } catch (error: any) {
            loggingService.error('Error getting Linear projects', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get Linear projects'
            });
        }
    }

    /**
     * Create Linear issue manually
     * POST /api/integrations/:id/linear/issues
     */
    static async createLinearIssue(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;
            const { title, description, teamId, projectId } = req.body;

            if (!title || !teamId) {
                return res.status(400).json({
                    success: false,
                    message: 'Title and teamId are required'
                });
            }

            const integration = await IntegrationService.getIntegrationById(id, userId);
            if (!integration || integration.type !== 'linear_oauth') {
                return res.status(404).json({
                    success: false,
                    message: 'Linear integration not found'
                });
            }

            const credentials = integration.getCredentials();
            if (!credentials.accessToken) {
                return res.status(400).json({
                    success: false,
                    message: 'Linear access token not configured'
                });
            }

            const { LinearService } = await import('../services/linear.service');
            const result = await LinearService.createIssueFromAlert(
                credentials.accessToken,
                teamId,
                projectId,
                {
                    _id: '',
                    title,
                    message: description || title,
                    type: 'system' as any,
                    severity: 'medium' as any,
                    userId: integration.userId,
                    createdAt: new Date(),
                    data: {}
                } as any,
                undefined
            );

            return res.status(201).json({
                success: true,
                message: 'Linear issue created successfully',
                data: {
                    issueId: result.issueId,
                    issueUrl: result.issueUrl
                }
            });
        } catch (error: any) {
            loggingService.error('Error creating Linear issue', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to create Linear issue'
            });
        }
    }

    /**
     * Update Linear issue
     * PUT /api/integrations/:id/linear/issues/:issueId
     */
    static async updateLinearIssue(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id, issueId } = req.params;
            const updates = req.body;

            const integration = await IntegrationService.getIntegrationById(id, userId);
            if (!integration || integration.type !== 'linear_oauth') {
                return res.status(404).json({
                    success: false,
                    message: 'Linear integration not found'
                });
            }

            const credentials = integration.getCredentials();
            if (!credentials.accessToken) {
                return res.status(400).json({
                    success: false,
                    message: 'Linear access token not configured'
                });
            }

            const { LinearService } = await import('../services/linear.service');
            const result = await LinearService.updateIssue(
                credentials.accessToken,
                issueId,
                updates
            );

            return res.status(200).json({
                success: true,
                message: 'Linear issue updated successfully',
                data: {
                    responseTime: result.responseTime
                }
            });
        } catch (error: any) {
            loggingService.error('Error updating Linear issue', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to update Linear issue'
            });
        }
    }

    /**
     * Validate Linear API token and fetch teams
     * POST /api/integrations/linear/validate-token
     */
    static async validateLinearToken(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { accessToken } = req.body;

            if (!accessToken) {
                return res.status(400).json({
                    success: false,
                    message: 'Access token is required'
                });
            }

            const { LinearService } = await import('../services/linear.service');

            // Validate token by fetching user info
            try {
                const user = await LinearService.getAuthenticatedUser(accessToken);
                
                // Fetch teams
                const teams = await LinearService.listTeams(accessToken);

                // Optionally fetch projects if teamId is provided
                const { teamId } = req.body;
                let projects: any[] = [];
                if (teamId) {
                    try {
                        projects = await LinearService.listProjects(accessToken, teamId);
                    } catch (error) {
                        // Projects are optional, don't fail if we can't fetch them
                        loggingService.warn('Failed to fetch Linear projects', { error: (error as any)?.message });
                    }
                }

                return res.status(200).json({
                    success: true,
                    data: {
                        user: {
                            id: user.id,
                            name: user.name,
                            email: user.email,
                            active: user.active
                        },
                        teams,
                        projects: teamId ? projects : undefined
                    }
                });
            } catch (error: any) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid Linear API token',
                    error: error.message
                });
            }
        } catch (error: any) {
            loggingService.error('Failed to validate Linear token', {
                error: error.message,
                stack: error.stack
            });
            return res.status(500).json({
                success: false,
                message: 'Failed to validate Linear token',
                error: error.message
            });
        }
    }

    /**
     * Initiate Linear OAuth flow
     * GET /api/integrations/linear/auth
     */
    static async initiateLinearOAuth(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const clientId = process.env.LINEAR_CLIENT_ID;
            if (!clientId) {
                return res.status(500).json({
                    success: false,
                    message: 'Linear Client ID not configured. Please set LINEAR_CLIENT_ID in environment variables.'
                });
            }

            const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8000';
            const callbackUrl = process.env.LINEAR_CALLBACK_URL ?? `${backendUrl}/api/integrations/linear/callback`;
            
            // Generate state for CSRF protection
            const crypto = require('crypto');
            const state = crypto.randomBytes(16).toString('hex');
            
            // Store state with userId
            const stateData = Buffer.from(JSON.stringify({ userId, nonce: state })).toString('base64');

            // Linear OAuth scopes
            const scopes = 'write read';
            const authUrl = `https://linear.app/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&state=${stateData}&response_type=code`;

            loggingService.info('Linear OAuth flow initiated', { userId });

            return res.status(200).json({
                success: true,
                data: {
                    authUrl,
                    state: stateData
                }
            });
        } catch (error: any) {
            loggingService.error('Failed to initiate Linear OAuth', {
                error: error.message,
                stack: error.stack
            });
            return res.status(500).json({
                success: false,
                message: 'Failed to initiate Linear OAuth flow',
                error: error.message
            });
        }
    }

    /**
     * Handle Linear OAuth callback
     * GET /api/integrations/linear/callback
     */
    static async handleLinearOAuthCallback(req: any, res: Response): Promise<void> {
        try {
            const { code, state, error } = req.query;

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

            // Handle error from Linear
            if (error) {
                loggingService.error('Linear OAuth error', { error });
                res.redirect(`${frontendUrl}/integrations/linear/error?message=${encodeURIComponent(error as string)}`);
                return;
            }

            // Validate required parameters
            if (!code || !state) {
                loggingService.error('Linear OAuth callback missing parameters', { code: !!code, state: !!state });
                res.redirect(`${frontendUrl}/integrations/linear/error?message=${encodeURIComponent('Missing code or state parameter')}`);
                return;
            }

            // Decode state
            let stateData: { userId: string; nonce: string };
            try {
                stateData = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
            } catch (error: any) {
                loggingService.error('Failed to decode Linear OAuth state', { error: error.message });
                res.redirect(`${frontendUrl}/integrations/linear/error?message=${encodeURIComponent('Invalid state parameter')}`);
                return;
            }

            const userId = stateData.userId;

            const clientId = process.env.LINEAR_CLIENT_ID;
            const clientSecret = process.env.LINEAR_CLIENT_SECRET;
            const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8000';
            const callbackUrl = process.env.LINEAR_CALLBACK_URL ?? `${backendUrl}/api/integrations/linear/callback`;

            if (!clientId || !clientSecret) {
                loggingService.error('Linear OAuth credentials not configured');
                res.redirect(`${frontendUrl}/integrations/linear/error?message=${encodeURIComponent('Linear OAuth not configured')}`);
                return;
            }

            // Exchange code for token
            const { LinearService } = await import('../services/linear.service');
            const tokenResponse = await LinearService.exchangeCodeForToken(
                code as string,
                clientId,
                clientSecret,
                callbackUrl
            );

            // Get user information
            const linearUser = await LinearService.getAuthenticatedUser(tokenResponse.access_token);

            // Get teams
            const teams = await LinearService.listTeams(tokenResponse.access_token);
            
            if (teams.length === 0) {
                loggingService.error('No Linear teams found for user', { userId, linearUserId: linearUser.id });
                res.redirect(`${frontendUrl}/integrations/linear/error?message=${encodeURIComponent('No Linear teams found')}`);
                return;
            }

            // Use the first team (or we could let user select)
            const teamId = teams[0].id;

            // Create integration with OAuth token
            const integration = await IntegrationService.createIntegration({
                userId,
                type: 'linear_oauth',
                name: `Linear - ${teams[0].name}`,
                description: `Connected via OAuth for team: ${teams[0].name}`,
                credentials: {
                    accessToken: tokenResponse.access_token,
                    teamId: teamId,
                    teamName: teams[0].name,
                    refreshToken: tokenResponse.refresh_token
                }
            });

            loggingService.info('Linear OAuth integration created', {
                userId,
                integrationId: integration._id,
                linearUserId: linearUser.id,
                teamId
            });

            // Redirect to success page
            res.redirect(`${frontendUrl}/integrations/linear/success?integrationId=${integration._id}`);
        } catch (error: any) {
            loggingService.error('Failed to handle Linear OAuth callback', {
                error: error.message,
                stack: error.stack
            });
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            res.redirect(`${frontendUrl}/integrations/linear/error?message=${encodeURIComponent(error.message || 'Failed to connect Linear')}`);
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

