import { Response } from 'express';
import axios from 'axios';
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
            const { metadata, ...updates } = req.body;

            const integration = await IntegrationService.updateIntegration(id, userId, updates);
            
            // Handle metadata update separately if provided
            if (metadata && integration) {
                integration.metadata = {
                    ...(integration.metadata || {}),
                    ...metadata
                };
                await integration.save();
            }

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
     * Initiate JIRA OAuth flow
     * GET /api/integrations/jira/auth
     */
    static async initiateJiraOAuth(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const clientId = process.env.JIRA_CLIENT_ID;
            if (!clientId) {
                return res.status(500).json({
                    success: false,
                    message: 'JIRA Client ID not configured. Please set JIRA_CLIENT_ID in environment variables.'
                });
            }

            const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8000';
            const callbackUrl = process.env.JIRA_CALLBACK_URL ?? `${backendUrl}/api/integrations/jira/callback`;
            
            // Generate state for CSRF protection
            const crypto = require('crypto');
            const state = crypto.randomBytes(16).toString('hex');
            
            // Store state with userId
            const stateData = Buffer.from(JSON.stringify({ userId, nonce: state })).toString('base64');

            const scopes = 'read:jira-work write:jira-work offline_access read:jira-user';
            const authUrl = `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=${clientId}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${stateData}&response_type=code&prompt=consent`;

            loggingService.info('JIRA OAuth flow initiated', { userId });

            return res.status(200).json({
                success: true,
                data: {
                    authUrl,
                    state: stateData
                }
            });
        } catch (error: any) {
            loggingService.error('Failed to initiate JIRA OAuth', {
                error: error.message,
                stack: error.stack
            });
            return res.status(500).json({
                success: false,
                message: 'Failed to initiate JIRA OAuth flow'
            });
        }
    }

    /**
     * Handle JIRA OAuth callback
     * GET /api/integrations/jira/callback
     */
    static async handleJiraOAuthCallback(req: any, res: Response): Promise<void> {
        try {
            const { code, state, error } = req.query;

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

            // Handle error from JIRA
            if (error) {
                loggingService.error('JIRA OAuth error', { error });
                res.redirect(`${frontendUrl}/integrations/jira/error?message=${encodeURIComponent(error as string)}`);
                return;
            }

            // Validate required parameters
            if (!code || !state) {
                loggingService.error('JIRA OAuth callback missing parameters', { code: !!code, state: !!state });
                res.redirect(`${frontendUrl}/integrations/jira/error?message=${encodeURIComponent('Missing code or state parameter')}`);
                return;
            }

            // Decode state
            let stateData: { userId: string; nonce: string };
            try {
                stateData = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
            } catch (error: any) {
                loggingService.error('Failed to decode JIRA OAuth state', { error: error.message });
                res.redirect(`${frontendUrl}/integrations/jira/error?message=${encodeURIComponent('Invalid state parameter')}`);
                return;
            }

            const userId = stateData.userId;

            const clientId = process.env.JIRA_CLIENT_ID;
            const clientSecret = process.env.JIRA_CLIENT_SECRET;
            const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8000';
            const callbackUrl = process.env.JIRA_CALLBACK_URL ?? `${backendUrl}/api/integrations/jira/callback`;

            if (!clientId || !clientSecret) {
                loggingService.error('JIRA OAuth credentials not configured');
                res.redirect(`${frontendUrl}/integrations/jira/error?message=${encodeURIComponent('JIRA OAuth not configured')}`);
                return;
            }

            // Exchange code for token
            const { JiraService } = await import('../services/jira.service');
            const tokenResponse = await JiraService.exchangeCodeForToken(
                code as string,
                clientId,
                clientSecret,
                callbackUrl
            );

            // Get cloud ID and site URL - we need to get the accessible sites first
            // For now, we'll require the user to provide the site URL during setup
            // Or we can fetch it from the token response if available
            // Note: JIRA Cloud OAuth requires an additional step to get the cloud ID
            
            // For initial implementation, we'll store the token and let user configure site URL in the setup modal
            // Get user information using a temporary site URL (will be updated during setup)
            // Actually, we need the site URL first. Let's fetch accessible resources
            
            // Get accessible resources to find the site
            const resourcesResponse = await axios.get('https://api.atlassian.com/oauth/token/accessible-resources', {
                headers: {
                    'Authorization': `Bearer ${tokenResponse.access_token}`,
                    'Accept': 'application/json'
                }
            });

            const resources = resourcesResponse.data || [];
            if (resources.length === 0) {
                loggingService.error('No JIRA sites found for user', { userId });
                res.redirect(`${frontendUrl}/integrations/jira/error?message=${encodeURIComponent('No JIRA sites found')}`);
                return;
            }

            // Use the first site (or we could let user select)
            const site = resources[0];
            const siteUrl = site.url;
            const cloudId = site.id; // Cloud ID is required for OAuth 2.0 API calls

            if (!cloudId) {
                loggingService.error('Cloud ID not found in JIRA resources', { userId, site });
                res.redirect(`${frontendUrl}/integrations/jira/error?message=${encodeURIComponent('Cloud ID not found')}`);
                return;
            }

            // Get user information using cloud ID (required for OAuth 2.0)
            const jiraUser = await JiraService.getAuthenticatedUser(cloudId, tokenResponse.access_token, true);

            // Get projects using cloud ID (required for OAuth 2.0)
            const projects = await JiraService.listProjects(cloudId, tokenResponse.access_token, true);
            
            if (projects.length === 0) {
                loggingService.error('No JIRA projects found for user', { userId, jiraUserId: jiraUser.accountId });
                res.redirect(`${frontendUrl}/integrations/jira/error?message=${encodeURIComponent('No JIRA projects found')}`);
                return;
            }

            // Use the first project (or we could let user select)
            const projectKey = projects[0].key;

            // Create integration with OAuth token
            const integration = await IntegrationService.createIntegration({
                userId,
                type: 'jira_oauth',
                name: `JIRA - ${projects[0].name}`,
                description: `Connected via OAuth for site: ${siteUrl}`,
                credentials: {
                    accessToken: tokenResponse.access_token,
                    siteUrl: siteUrl,
                    cloudId: cloudId, // Store cloud ID for OAuth 2.0 API calls
                    projectKey: projectKey,
                    refreshToken: tokenResponse.refresh_token
                }
            });

            loggingService.info('JIRA OAuth integration created', {
                userId,
                integrationId: integration._id,
                jiraUserId: jiraUser.accountId,
                siteUrl,
                projectKey
            });

            // Redirect to success page
            res.redirect(`${frontendUrl}/integrations/jira/success?integrationId=${integration._id}`);
        } catch (error: any) {
            loggingService.error('Failed to handle JIRA OAuth callback', {
                error: error.message,
                stack: error.stack
            });
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            res.redirect(`${frontendUrl}/integrations/jira/error?message=${encodeURIComponent(error.message || 'Failed to connect JIRA')}`);
        }
    }

    /**
     * Initiate Discord OAuth flow
     * GET /api/integrations/discord/auth
     */
    static async initiateDiscordOAuth(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const clientId = process.env.DISCORD_CLIENT_ID;
            if (!clientId) {
                return res.status(500).json({
                    success: false,
                    message: 'Discord Client ID not configured. Please set DISCORD_CLIENT_ID in environment variables.'
                });
            }

            const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8000';
            const callbackUrl = process.env.DISCORD_CALLBACK_URL ?? `${backendUrl}/api/integrations/discord/callback`;
            
            // Generate state for CSRF protection
            const crypto = require('crypto');
            const state = crypto.randomBytes(16).toString('hex');
            
            // Store state with userId
            const stateData = Buffer.from(JSON.stringify({ userId, nonce: state })).toString('base64');

            // Discord OAuth2 scopes - bot scope is required to get bot token
            // When using 'bot' scope, Discord returns bot.token in the OAuth response
            const scopes = ['bot', 'identify', 'guilds'].join('%20');
            const permissions = '8'; // Administrator permission (gives full access to all features)
            const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=${scopes}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${stateData}&response_type=code`;

            loggingService.info('Discord OAuth flow initiated', { 
                userId,
                scopes: ['bot', 'identify', 'guilds'],
                permissions,
                authUrl: authUrl.substring(0, 100) + '...'
            });

            return res.status(200).json({
                success: true,
                data: {
                    authUrl,
                    state: stateData
                }
            });
        } catch (error: any) {
            loggingService.error('Failed to initiate Discord OAuth', {
                error: error.message,
                stack: error.stack
            });
            return res.status(500).json({
                success: false,
                message: 'Failed to initiate Discord OAuth flow'
            });
        }
    }

    /**
     * Handle Discord OAuth callback
     * GET /api/integrations/discord/callback
     */
    static async handleDiscordOAuthCallback(req: any, res: Response): Promise<void> {
        try {
            const { code, state, error, guild_id } = req.query;

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

            // Handle error from Discord
            if (error) {
                loggingService.error('Discord OAuth error', { error });
                res.redirect(`${frontendUrl}/integrations/discord/error?message=${encodeURIComponent(error as string)}`);
                return;
            }

            // Validate required parameters
            if (!code || !state) {
                loggingService.error('Discord OAuth callback missing parameters', { code: !!code, state: !!state });
                res.redirect(`${frontendUrl}/integrations/discord/error?message=${encodeURIComponent('Missing code or state parameter')}`);
                return;
            }

            // Decode state
            let stateData: { userId: string; nonce: string };
            try {
                stateData = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
            } catch (error: any) {
                loggingService.error('Failed to decode Discord OAuth state', { error: error.message });
                res.redirect(`${frontendUrl}/integrations/discord/error?message=${encodeURIComponent('Invalid state parameter')}`);
                return;
            }

            const userId = stateData.userId;

            const clientId = process.env.DISCORD_CLIENT_ID;
            const clientSecret = process.env.DISCORD_CLIENT_SECRET;
            const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8000';
            const callbackUrl = process.env.DISCORD_CALLBACK_URL ?? `${backendUrl}/api/integrations/discord/callback`;

            if (!clientId || !clientSecret) {
                loggingService.error('Discord OAuth credentials not configured');
                res.redirect(`${frontendUrl}/integrations/discord/error?message=${encodeURIComponent('Discord OAuth not configured')}`);
                return;
            }

            // Exchange code for token
            const axios = require('axios');
            const FormData = require('form-data');
            const formData = new FormData();
            formData.append('client_id', clientId);
            formData.append('client_secret', clientSecret);
            formData.append('grant_type', 'authorization_code');
            formData.append('code', code as string);
            formData.append('redirect_uri', callbackUrl);

            const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', formData, {
                headers: formData.getHeaders()
            });

            loggingService.info('Discord OAuth token response', {
                hasAccessToken: !!tokenResponse.data.access_token,
                hasRefreshToken: !!tokenResponse.data.refresh_token,
                hasBot: !!tokenResponse.data.bot,
                hasBotToken: !!tokenResponse.data.bot?.token,
                scopes: tokenResponse.data.scope,
                tokenResponseKeys: Object.keys(tokenResponse.data)
            });

            const accessToken = tokenResponse.data.access_token;
            const refreshToken = tokenResponse.data.refresh_token;
            
            // Discord's modern OAuth flow doesn't return bot.token in the OAuth response
            // Instead, we need to use the Bot Token from the Discord Developer Portal
            // The bot token should be configured as an environment variable
            const botToken = process.env.DISCORD_BOT_TOKEN || tokenResponse.data.bot?.token;

            if (!botToken) {
                loggingService.error('Discord bot token not configured', {
                    tokenResponseKeys: Object.keys(tokenResponse.data),
                    hasEnvBotToken: !!process.env.DISCORD_BOT_TOKEN,
                    hasBotInResponse: !!tokenResponse.data.bot
                });
                res.redirect(`${frontendUrl}/integrations/discord/error?message=${encodeURIComponent('Discord bot token not configured. Please set DISCORD_BOT_TOKEN in your environment variables. Get your bot token from: https://discord.com/developers/applications → Your App → Bot → Reset Token')}`);
                return;
            }

            // Get user information
            const userResponse = await axios.get('https://discord.com/api/users/@me', {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            });

            const discordUser = userResponse.data;
            const guildId = guild_id as string || '';

            // Get guild information if guild_id is provided
            let guildName = '';
            if (guildId && botToken) {
                try {
                    const guildResponse = await axios.get(`https://discord.com/api/guilds/${guildId}`, {
                        headers: {
                            Authorization: `Bot ${botToken}`
                        }
                    });
                    guildName = guildResponse.data.name;
                } catch (error) {
                    loggingService.warn('Failed to fetch Discord guild name', { guildId });
                }
            }

            // Create Discord OAuth integration
            const Integration = (await import('../models')).Integration;
            const integration = new Integration({
                userId,
                type: 'discord_oauth',
                name: guildName ? `Discord - ${guildName}` : `Discord - ${discordUser.username}`,
                description: `Connected via OAuth as ${discordUser.username}#${discordUser.discriminator}`,
                status: 'active',
                alertRouting: new Map(),
                deliveryConfig: {
                    retryEnabled: true,
                    maxRetries: 3,
                    timeout: 30000
                },
                stats: {
                    totalDeliveries: 0,
                    successfulDeliveries: 0,
                    failedDeliveries: 0,
                    lastDeliveryAt: null,
                    averageResponseTime: 0
                },
                metadata: {
                    discordUserId: discordUser.id,
                    discordUsername: discordUser.username,
                    discriminator: discordUser.discriminator,
                    guildId: guildId || undefined
                }
            });

            // Set encrypted credentials before saving
            integration.setCredentials({
                accessToken,
                refreshToken,
                botToken,
                guildId,
                guildName
            });

            await integration.save();

            loggingService.info('Discord OAuth integration created', {
                userId,
                integrationId: integration._id,
                discordUserId: discordUser.id,
                guildId,
                guildName
            });

            // Redirect to success page
            res.redirect(`${frontendUrl}/integrations/discord/success?integrationId=${integration._id}`);
        } catch (error: any) {
            loggingService.error('Failed to handle Discord OAuth callback', {
                error: error.message,
                stack: error.stack
            });
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            res.redirect(`${frontendUrl}/integrations/discord/error?message=${encodeURIComponent(error.message || 'Failed to connect Discord')}`);
        }
    }

    /**
     * Initiate Slack OAuth flow
     * GET /api/integrations/slack/auth
     */
    static async initiateSlackOAuth(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const clientId = process.env.SLACK_CLIENT_ID;
            if (!clientId) {
                return res.status(500).json({
                    success: false,
                    message: 'Slack Client ID not configured. Please set SLACK_CLIENT_ID in environment variables.'
                });
            }

            const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8000';
            const callbackUrl = process.env.SLACK_CALLBACK_URL ?? `${backendUrl}/api/integrations/slack/callback`;
            
            // Generate state for CSRF protection
            const crypto = require('crypto');
            const state = crypto.randomBytes(16).toString('hex');
            
            // Store state with userId
            const stateData = Buffer.from(JSON.stringify({ userId, nonce: state })).toString('base64');

            // Slack OAuth2 scopes - request bot permissions for full capabilities
            const scopes = [
                'chat:write',        // Send messages
                'channels:read',     // List channels
                'channels:manage',   // Create/archive channels
                'users:read',        // List users
                'channels:history',  // Read channel messages (optional)
                'groups:read'        // List private channels (optional)
            ].join(',');

            const authUrl = `https://slack.com/oauth/v2/authorize?client_id=${clientId}&scope=${scopes}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${stateData}`;

            loggingService.info('Slack OAuth flow initiated', { 
                userId,
                scopes: scopes.split(','),
                authUrl: authUrl.substring(0, 100) + '...'
            });

            return res.status(200).json({
                success: true,
                data: {
                    authUrl,
                    state: stateData
                }
            });
        } catch (error: any) {
            loggingService.error('Failed to initiate Slack OAuth', {
                error: error.message,
                stack: error.stack
            });
            return res.status(500).json({
                success: false,
                message: 'Failed to initiate Slack OAuth flow'
            });
        }
    }

    /**
     * Handle Slack OAuth callback
     * GET /api/integrations/slack/callback
     */
    static async handleSlackOAuthCallback(req: any, res: Response): Promise<void> {
        try {
            const { code, state, error } = req.query;

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

            // Handle error from Slack
            if (error) {
                loggingService.error('Slack OAuth error', { error });
                res.redirect(`${frontendUrl}/integrations/slack/error?message=${encodeURIComponent(error as string)}`);
                return;
            }

            // Validate required parameters
            if (!code || !state) {
                loggingService.error('Slack OAuth callback missing parameters', { code: !!code, state: !!state });
                res.redirect(`${frontendUrl}/integrations/slack/error?message=${encodeURIComponent('Missing code or state parameter')}`);
                return;
            }

            // Decode state
            let stateData: { userId: string; nonce: string };
            try {
                stateData = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
            } catch (error: any) {
                loggingService.error('Failed to decode Slack OAuth state', { error: error.message });
                res.redirect(`${frontendUrl}/integrations/slack/error?message=${encodeURIComponent('Invalid state parameter')}`);
                return;
            }

            const userId = stateData.userId;

            const clientId = process.env.SLACK_CLIENT_ID;
            const clientSecret = process.env.SLACK_CLIENT_SECRET;
            const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8000';
            const callbackUrl = process.env.SLACK_CALLBACK_URL ?? `${backendUrl}/api/integrations/slack/callback`;

            if (!clientId || !clientSecret) {
                loggingService.error('Slack OAuth credentials not configured');
                res.redirect(`${frontendUrl}/integrations/slack/error?message=${encodeURIComponent('Slack OAuth not configured')}`);
                return;
            }

            // Exchange code for token using Slack's oauth.v2.access endpoint
            const axios = require('axios');
            const tokenResponse = await axios.post('https://slack.com/api/oauth.v2.access', 
                new URLSearchParams({
                    client_id: clientId,
                    client_secret: clientSecret,
                    code: code as string,
                    redirect_uri: callbackUrl
                }).toString(),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            loggingService.info('Slack OAuth token response', {
                ok: tokenResponse.data.ok,
                hasAccessToken: !!tokenResponse.data.access_token,
                hasTeam: !!tokenResponse.data.team,
                hasAuthedUser: !!tokenResponse.data.authed_user,
                scopes: tokenResponse.data.scope,
                tokenResponseKeys: Object.keys(tokenResponse.data)
            });

            if (!tokenResponse.data.ok) {
                loggingService.error('Slack OAuth token exchange failed', { 
                    error: tokenResponse.data.error 
                });
                res.redirect(`${frontendUrl}/integrations/slack/error?message=${encodeURIComponent(tokenResponse.data.error || 'Failed to exchange token')}`);
                return;
            }

            const accessToken = tokenResponse.data.access_token;
            const team = tokenResponse.data.team;
            const authedUser = tokenResponse.data.authed_user;
            const botUserId = tokenResponse.data.bot_user_id;

            if (!accessToken || !team) {
                loggingService.error('Slack OAuth response missing required data');
                res.redirect(`${frontendUrl}/integrations/slack/error?message=${encodeURIComponent('Missing access token or team information')}`);
                return;
            }

            // Create new Slack OAuth integration
            const Integration = (await import('../models')).Integration;
            
            const integration = new Integration({
                userId,
                type: 'slack_oauth',
                name: `Slack - ${team.name}`,
                description: `Connected via OAuth to ${team.name} workspace`,
                status: 'active',
                alertRouting: {},
                webhookConfig: {
                    url: '',
                    headers: {},
                    method: 'POST',
                    timeout: 30000,
                    retryAttempts: 3
                },
                deliveryStats: {
                    totalDeliveries: 0,
                    successfulDeliveries: 0,
                    failedDeliveries: 0,
                    lastDeliveryAt: null,
                    averageResponseTime: 0
                },
                metadata: {
                    teamId: team.id,
                    teamName: team.name,
                    authedUserId: authedUser?.id,
                    botUserId
                }
            });

            // Set encrypted credentials before saving
            integration.setCredentials({
                accessToken,
                teamId: team.id,
                teamName: team.name,
                botUserId
            });

            await integration.save();

            loggingService.info('Slack OAuth integration created', {
                userId,
                integrationId: integration._id,
                teamId: team.id,
                teamName: team.name,
                botUserId
            });

            // Redirect to success page
            res.redirect(`${frontendUrl}/integrations/slack/success?integrationId=${integration._id}`);
        } catch (error: any) {
            loggingService.error('Failed to handle Slack OAuth callback', {
                error: error.message,
                stack: error.stack,
                response: error.response?.data
            });
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            res.redirect(`${frontendUrl}/integrations/slack/error?message=${encodeURIComponent(error.message || 'Failed to connect Slack')}`);
        }
    }

    /**
     * Validate JIRA API token and fetch projects
     * POST /api/integrations/jira/validate-token
     */
    static async validateJiraToken(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { accessToken, siteUrl } = req.body;

            if (!accessToken || !siteUrl) {
                return res.status(400).json({
                    success: false,
                    message: 'Access token and site URL are required'
                });
            }

            const { JiraService } = await import('../services/jira.service');

            // Validate token by fetching user info
            try {
                const user = await JiraService.getAuthenticatedUser(siteUrl, accessToken);
                
                // Fetch projects
                const projects = await JiraService.listProjects(siteUrl, accessToken);

                return res.status(200).json({
                    success: true,
                    data: {
                        user,
                        projects
                    }
                });
            } catch (error: any) {
                loggingService.error('Failed to validate JIRA token', { error: error.message });
                return res.status(401).json({
                    success: false,
                    message: error.message || 'Invalid JIRA token or site URL'
                });
            }
        } catch (error: any) {
            loggingService.error('Error validating JIRA token', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to validate JIRA token'
            });
        }
    }

    /**
     * Get JIRA projects for OAuth integration
     * GET /api/integrations/:id/jira/projects
     */
    static async getJiraProjects(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;

            const projects = await IntegrationService.getJiraProjects(id, userId);

            return res.status(200).json({
                success: true,
                data: projects
            });
        } catch (error: any) {
            loggingService.error('Error getting JIRA projects', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get JIRA projects'
            });
        }
    }

    /**
     * Get JIRA issue types for a project
     * GET /api/integrations/:id/jira/projects/:projectKey/issue-types
     */
    static async getJiraIssueTypes(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id, projectKey } = req.params;

            const issueTypes = await IntegrationService.getJiraIssueTypes(id, userId, projectKey);

            return res.status(200).json({
                success: true,
                data: issueTypes
            });
        } catch (error: any) {
            loggingService.error('Error getting JIRA issue types', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get JIRA issue types'
            });
        }
    }

    /**
     * Get JIRA priorities
     * GET /api/integrations/:id/jira/priorities
     */
    static async getJiraPriorities(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;

            const priorities = await IntegrationService.getJiraPriorities(id, userId);

            return res.status(200).json({
                success: true,
                data: priorities
            });
        } catch (error: any) {
            loggingService.error('Error getting JIRA priorities', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to get JIRA priorities'
            });
        }
    }

    /**
     * Create JIRA issue manually
     * POST /api/integrations/:id/jira/issues
     */
    static async createJiraIssue(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id } = req.params;
            const { title, description, projectKey, issueTypeId, priorityId, labels, components } = req.body;

            if (!title || !projectKey || !issueTypeId) {
                return res.status(400).json({
                    success: false,
                    message: 'Title, projectKey, and issueTypeId are required'
                });
            }

            const integration = await IntegrationService.getIntegrationById(id, userId);
            if (!integration || integration.type !== 'jira_oauth') {
                return res.status(404).json({
                    success: false,
                    message: 'JIRA integration not found'
                });
            }

            const credentials = integration.getCredentials();
            if (!credentials.accessToken || !credentials.siteUrl) {
                return res.status(400).json({
                    success: false,
                    message: 'JIRA access token or site URL not configured'
                });
            }

            const { JiraService } = await import('../services/jira.service');
            const result = await JiraService.createIssueFromAlert(
                credentials.siteUrl,
                credentials.accessToken,
                projectKey,
                issueTypeId,
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
                undefined,
                priorityId,
                labels,
                components
            );

            return res.status(201).json({
                success: true,
                message: 'JIRA issue created successfully',
                data: {
                    issueKey: result.issueKey,
                    issueUrl: result.issueUrl
                }
            });
        } catch (error: any) {
            loggingService.error('Error creating JIRA issue', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to create JIRA issue'
            });
        }
    }

    /**
     * Update JIRA issue
     * PUT /api/integrations/:id/jira/issues/:issueKey
     */
    static async updateJiraIssue(req: any, res: Response): Promise<Response> {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized'
                });
            }

            const { id, issueKey } = req.params;
            const updates = req.body;

            const integration = await IntegrationService.getIntegrationById(id, userId);
            if (!integration || integration.type !== 'jira_oauth') {
                return res.status(404).json({
                    success: false,
                    message: 'JIRA integration not found'
                });
            }

            const credentials = integration.getCredentials();
            if (!credentials.accessToken || !credentials.siteUrl) {
                return res.status(400).json({
                    success: false,
                    message: 'JIRA access token or site URL not configured'
                });
            }

            const { JiraService } = await import('../services/jira.service');
            const result = await JiraService.updateIssue(
                credentials.siteUrl,
                credentials.accessToken,
                issueKey,
                updates
            );

            return res.status(200).json({
                success: true,
                message: 'JIRA issue updated successfully',
                data: {
                    responseTime: result.responseTime
                }
            });
        } catch (error: any) {
            loggingService.error('Error updating JIRA issue', { error: error.message });
            return res.status(500).json({
                success: false,
                message: error.message || 'Failed to update JIRA issue'
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

