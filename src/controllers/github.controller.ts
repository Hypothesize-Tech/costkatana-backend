import { Request, Response } from 'express';
import { GitHubService, OAuthTokenResponse, GitHubUser } from '../services/github.service';
import { GitHubIntegrationService, StartIntegrationOptions } from '../services/githubIntegration.service';
import { GitHubConnection, GitHubIntegration } from '../models';
import { loggingService } from '../services/logging.service';
import crypto from 'crypto';

export class GitHubController {
    /**
     * Initialize GitHub App installation
     * GET /api/github/install
     */
    static async initiateAppInstallation(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const appId = process.env.GITHUB_APP_ID;
            if (!appId) {
                res.status(500).json({
                    success: false,
                    message: 'GitHub App ID not configured'
                });
                return;
            }

            // Generate state for security
            const state = Buffer.from(JSON.stringify({ userId, timestamp: Date.now() })).toString('base64');
            
            // Store state in session for validation
            req.session = req.session || {};
            req.session.githubState = state;

            const installUrl = `https://github.com/apps/${process.env.GITHUB_APP_SLUG || 'costkatana'}/installations/new?state=${state}`;

            res.json({
                success: true,
                data: {
                    installUrl,
                    state
                }
            });

        } catch (error: any) {
            loggingService.error('Failed to initiate GitHub App installation', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to initiate GitHub App installation',
                error: error.message
            });
        }
    }

    /**
     * Initialize OAuth flow
     * GET /api/github/auth
     */
    static async initiateOAuth(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            // Initialize GitHub service first
            await GitHubService.initialize();

            const clientId = process.env.GITHUB_CLIENT_ID;
            // OAuth callback must go to backend, not frontend
            const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8000';
            const callbackUrl = process.env.GITHUB_CALLBACK_URL ?? `${backendUrl}/api/github/callback`;
            
            // Generate state for CSRF protection
            const state = crypto.randomBytes(16).toString('hex');
            
            // Store state in session or temporary cache
            // For now, we'll include userId in state
            const stateData = Buffer.from(JSON.stringify({ userId, nonce: state })).toString('base64');

            const scopes = 'repo,read:user,user:email';
            const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&state=${stateData}`;

            loggingService.info('GitHub OAuth flow initiated', {
                userId
            });

            res.json({
                success: true,
                data: {
                    authUrl,
                    state: stateData
                }
            });
        } catch (error: any) {
            loggingService.error('Failed to initiate GitHub OAuth', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to initiate OAuth flow',
                error: error.message
            });
        }
    }

    /**
     * OAuth callback handler
     * GET /api/github/callback
     */
    static async handleOAuthCallback(req: any, res: Response): Promise<void> {
        try {
            const { code, state, installation_id, setup_action } = req.query;

            // Handle GitHub App installation
            if (installation_id && setup_action === 'install') {
                return this.handleGitHubAppInstallation(req, res, installation_id as string);
            }

            // Handle OAuth flow
            if (!code || !state) {
                res.status(400).json({
                    success: false,
                    message: 'Missing code or state parameter'
                });
                return;
            }

            // Initialize GitHub service first
            await GitHubService.initialize();

            // Decode state
            const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
            const userId = stateData.userId;

            // Exchange code for token
            const tokenResponse: OAuthTokenResponse = await GitHubService.exchangeCodeForToken(code as string);

            // Get user information
            const githubUser: GitHubUser = await GitHubService.getAuthenticatedUser(tokenResponse.access_token);

            // Check if connection already exists
            let connection = await GitHubConnection.findOne({
                userId,
                githubUserId: githubUser.id
            }).select('+accessToken');

            if (connection) {
                // Update existing connection
                connection.accessToken = tokenResponse.access_token; // Will be encrypted by pre-save hook
                connection.tokenType = 'oauth';
                connection.scope = tokenResponse.scope;
                connection.isActive = true;
                connection.lastSyncedAt = new Date();
                await connection.save();
            } else {
                // Create new connection
                connection = await GitHubConnection.create({
                    userId,
                    accessToken: tokenResponse.access_token,
                    tokenType: 'oauth',
                    scope: tokenResponse.scope,
                    githubUserId: githubUser.id,
                    githubUsername: githubUser.login,
                    avatarUrl: githubUser.avatar_url,
                    isActive: true,
                    repositories: [],
                    lastSyncedAt: new Date()
                });
            }

            // Sync repositories
            const repositories = await GitHubService.listUserRepositories(connection);
            connection.repositories = repositories;
            await connection.save();

            loggingService.info('GitHub OAuth connection established', {
                userId,
                githubUsername: githubUser.login,
                repositoriesCount: repositories.length
            });

            // Redirect to frontend with success
            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            res.redirect(`${frontendUrl}/github/success?connectionId=${connection._id}`);
        } catch (error: any) {
            loggingService.error('GitHub OAuth callback failed', {
                error: error.message,
                stack: error.stack,
                code: error.code,
                status: error.status
            });

            const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
            const errorMessage = error.message || 'An unexpected error occurred during GitHub authentication';
            res.redirect(`${frontendUrl}/github/error?message=${encodeURIComponent(errorMessage)}`);
        }
    }

    /**
     * Handle GitHub App installation
     * GET /api/github/callback?installation_id=xxx&setup_action=install
     */
    static async handleGitHubAppInstallation(req: any, res: Response, installationId: string): Promise<void> {
        try {
            // Initialize GitHub service first
            await GitHubService.initialize();

            // For GitHub App installations, we need to get the user ID from the session or request
            // Since this is an app installation, we'll need to handle it differently
            const userId = req.userId || req.session?.userId;
            
            if (!userId) {
                // If no user ID, redirect to frontend with error
                const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
                res.redirect(`${frontendUrl}/github/error?message=${encodeURIComponent('User session not found. Please try again.')}`);
                return;
            }

            // Get installation details from GitHub
            const installation = await GitHubService.getInstallation(installationId);
            
            // Create or update GitHub connection for app installation
            let connection = await GitHubConnection.findOne({
                userId,
                installationId
            }).select('+accessToken');

            if (connection) {
                // Update existing connection
                connection.isActive = true;
                connection.lastSyncedAt = new Date();
                await connection.save();
            } else {
                // Create new connection for GitHub App
                connection = await GitHubConnection.create({
                    userId,
                    installationId,
                    tokenType: 'app',
                    isActive: true,
                    lastSyncedAt: new Date()
                });
            }

            // Get repositories for this installation
            const repositories = await GitHubService.listUserRepositories(connection);
            connection.repositories = repositories;
            await connection.save();

            loggingService.info('GitHub App installation completed', {
                userId,
                installationId,
                repositoriesCount: repositories.length
            });

            // Redirect to frontend with success
            const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
            res.redirect(`${frontendUrl}/github/success?connectionId=${connection._id}&type=app`);

        } catch (error: any) {
            loggingService.error('GitHub App installation failed', {
                installationId,
                error: error.message,
                stack: error.stack
            });

            const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
            const errorMessage = error.message || 'Failed to complete GitHub App installation';
            res.redirect(`${frontendUrl}/github/error?message=${encodeURIComponent(errorMessage)}`);
        }
    }

    /**
     * List user's GitHub connections
     * GET /api/github/connections
     */
    static async listConnections(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const connections = await GitHubConnection.find({
                userId,
                isActive: true
            });

            res.json({
                success: true,
                data: connections
            });
        } catch (error: any) {
            loggingService.error('Failed to list GitHub connections', {
                error: error.message
            });

            res.status(500).json({
                success: false,
                message: 'Failed to list connections',
                error: error.message
            });
        }
    }

    /**
     * Get repositories for a connection
     * GET /api/github/connections/:connectionId/repositories
     */
    static async getRepositories(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { connectionId } = req.params;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const connection = await GitHubConnection.findOne({
                _id: connectionId,
                userId,
                isActive: true
            });

            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Connection not found'
                });
                return;
            }

            // Optionally refresh repositories
            if (req.query.refresh === 'true') {
                try {
                    const repositories = await GitHubService.listUserRepositories(connection);
                    connection.repositories = repositories;
                    connection.lastSyncedAt = new Date();
                    await connection.save();
                } catch (refreshError: any) {
                    loggingService.error('Failed to refresh repositories', {
                        connectionId,
                        userId,
                        error: refreshError.message
                    });
                    // Continue with existing repositories if refresh fails
                }
            }

            res.json({
                success: true,
                data: {
                    repositories: connection.repositories,
                    lastSynced: connection.lastSyncedAt
                }
            });
        } catch (error: any) {
            loggingService.error('Failed to get repositories', {
                error: error.message
            });

            res.status(500).json({
                success: false,
                message: 'Failed to get repositories',
                error: error.message
            });
        }
    }

    /**
     * Start integration for a repository
     * POST /api/github/integrations
     */
    static async startIntegration(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const {
                connectionId,
                repositoryId,
                repositoryName,
                repositoryFullName,
                integrationType,
                selectedFeatures,
                conversationId
            } = req.body;

            // Validate required fields
            if (!connectionId || !repositoryId || !repositoryName || !repositoryFullName || !integrationType) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required fields'
                });
                return;
            }

            // Validate integration type
            if (!['npm', 'cli', 'python', 'http-headers'].includes(integrationType)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid integration type'
                });
                return;
            }

            // Start integration
            const options: StartIntegrationOptions = {
                userId,
                connectionId,
                repositoryId,
                repositoryName,
                repositoryFullName,
                integrationType,
                selectedFeatures: selectedFeatures || [],
                conversationId
            };

            const integration = await GitHubIntegrationService.startIntegration(options);

            loggingService.info('GitHub integration started', {
                userId,
                integrationId: integration._id.toString(),
                repository: repositoryFullName
            });

            res.status(201).json({
                success: true,
                data: {
                    integrationId: integration._id.toString(),
                    status: integration.status,
                    repositoryName: integration.repositoryName,
                    branchName: integration.branchName
                }
            });
        } catch (error: any) {
            loggingService.error('Failed to start integration', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Failed to start integration',
                error: error.message
            });
        }
    }

    /**
     * Get integration status
     * GET /api/github/integrations/:integrationId
     */
    static async getIntegrationStatus(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { integrationId } = req.params;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const integration = await GitHubIntegration.findOne({
                _id: integrationId,
                userId
            });

            if (!integration) {
                res.status(404).json({
                    success: false,
                    message: 'Integration not found'
                });
                return;
            }

            // Check for stuck integrations before returning status
            await GitHubIntegrationService.recoverStuckIntegrations();

            const progress = await GitHubIntegrationService.getIntegrationStatus(integrationId);

            res.json({
                success: true,
                data: progress
            });
        } catch (error: any) {
            loggingService.error('Failed to get integration status', {
                error: error.message
            });

            res.status(500).json({
                success: false,
                message: 'Failed to get integration status',
                error: error.message
            });
        }
    }

    /**
     * List user's integrations
     * GET /api/github/integrations
     */
    static async listIntegrations(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const { status, limit } = req.query;

            const integrations = await GitHubIntegrationService.listUserIntegrations(userId, {
                status: status as string,
                limit: limit ? parseInt(limit as string) : undefined
            });

            res.json({
                success: true,
                data: integrations
            });
        } catch (error: any) {
            loggingService.error('Failed to list integrations', {
                error: error.message
            });

            res.status(500).json({
                success: false,
                message: 'Failed to list integrations',
                error: error.message
            });
        }
    }

    /**
     * Update integration from chat
     * POST /api/github/integrations/:integrationId/update
     */
    static async updateIntegration(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { integrationId } = req.params;
            const { changes } = req.body;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            if (!changes) {
                res.status(400).json({
                    success: false,
                    message: 'Changes description required'
                });
                return;
            }

            const integration = await GitHubIntegration.findOne({
                _id: integrationId,
                userId
            });

            if (!integration) {
                res.status(404).json({
                    success: false,
                    message: 'Integration not found'
                });
                return;
            }

            await GitHubIntegrationService.updateIntegrationFromChat(integrationId, changes);

            res.json({
                success: true,
                message: 'Integration update started'
            });
        } catch (error: any) {
            loggingService.error('Failed to update integration', {
                error: error.message
            });

            res.status(500).json({
                success: false,
                message: 'Failed to update integration',
                error: error.message
            });
        }
    }

    /**
     * Disconnect GitHub connection
     * DELETE /api/github/connections/:connectionId
     */
    static async disconnectConnection(req: any, res: Response): Promise<void> {
        try {
            const userId = req.userId;
            const { connectionId } = req.params;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }

            const connection = await GitHubConnection.findOne({
                _id: connectionId,
                userId
            });

            if (!connection) {
                res.status(404).json({
                    success: false,
                    message: 'Connection not found'
                });
                return;
            }

            connection.isActive = false;
            await connection.save();

            loggingService.info('GitHub connection disconnected', {
                userId,
                connectionId
            });

            res.json({
                success: true,
                message: 'Connection disconnected successfully'
            });
        } catch (error: any) {
            loggingService.error('Failed to disconnect connection', {
                error: error.message
            });

            res.status(500).json({
                success: false,
                message: 'Failed to disconnect connection',
                error: error.message
            });
        }
    }

    /**
     * Webhook handler for GitHub events
     * POST /api/github/webhook
     */
    static async handleWebhook(req: Request, res: Response): Promise<void> {
        try {
            const signature = req.headers['x-hub-signature-256'] as string;
            const payload = JSON.stringify(req.body);

            // Verify webhook signature
            if (!GitHubService.verifyWebhookSignature(payload, signature)) {
                res.status(401).json({
                    success: false,
                    message: 'Invalid webhook signature'
                });
                return;
            }

            const event = req.headers['x-github-event'] as string;

            loggingService.info('GitHub webhook received', {
                event,
                action: req.body.action
            });

            // Handle different webhook events
            switch (event) {
                case 'pull_request':
                    await this.handlePullRequestEvent(req.body);
                    break;
                case 'installation':
                    await this.handleInstallationEvent(req.body);
                    break;
                // Add more event handlers as needed
                default:
                    loggingService.info('Unhandled webhook event', { event });
            }

            res.json({ success: true });
        } catch (error: any) {
            loggingService.error('Webhook handling failed', {
                error: error.message,
                stack: error.stack
            });

            res.status(500).json({
                success: false,
                message: 'Webhook processing failed'
            });
        }
    }

    /**
     * Handle pull request events
     */
    private static async handlePullRequestEvent(payload: any): Promise<void> {
        const { action, pull_request } = payload;

        // Find integration by PR number
        const integration = await GitHubIntegration.findOne({
            prNumber: pull_request.number,
            repositoryFullName: pull_request.base.repo.full_name
        });

        if (!integration) {
            return;
        }

        // Update integration status based on PR state
        if (action === 'closed' && pull_request.merged) {
            integration.status = 'merged';
            await integration.save();
        } else if (action === 'closed') {
            integration.status = 'closed';
            await integration.save();
        }

        loggingService.info('Pull request event handled', {
            integrationId: integration._id.toString(),
            action,
            prNumber: pull_request.number
        });
    }

    /**
     * Handle installation events
     */
    private static async handleInstallationEvent(payload: any): Promise<void> {
        loggingService.info('GitHub App installation event', {
            action: payload.action,
            installationId: payload.installation?.id
        });

        // TODO: Handle GitHub App installation/uninstallation
    }
}

export default GitHubController;



