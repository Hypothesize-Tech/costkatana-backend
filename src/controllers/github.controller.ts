import { Request, Response } from 'express';
import { GitHubService, OAuthTokenResponse, GitHubUser } from '../services/github.service';
import { GitHubIntegrationService, StartIntegrationOptions } from '../services/githubIntegration.service';
import { GitHubConnection, GitHubIntegration } from '../models';
import { loggingService } from '../services/logging.service';
import { GitHubErrors } from '../utils/githubErrors';
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
                const error = GitHubErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GitHubErrors.formatError(error));
                return;
            }

            const appId = process.env.GITHUB_APP_ID;
            if (!appId) {
                const error = GitHubErrors.APP_NOT_CONFIGURED;
                res.status(error.httpStatus).json(GitHubErrors.formatError(error));
                return;
            }

            // Generate secure state for CSRF protection
            const nonce = crypto.randomBytes(32).toString('hex');
            const timestamp = Date.now();
            const state = Buffer.from(JSON.stringify({ userId, nonce, timestamp, type: 'app' })).toString('base64');
            
            // Store state in session for validation
            if (!req.session) {
                const error = GitHubErrors.SESSION_NOT_CONFIGURED;
                loggingService.error(error.message, { code: error.code });
                res.status(error.httpStatus).json(GitHubErrors.formatError(error));
                return;
            }
            req.session.githubAppState = { state, nonce, timestamp, userId };

            const installUrl = `https://github.com/apps/${process.env.GITHUB_APP_SLUG || 'costkatana'}/installations/new?state=${state}`;

            loggingService.info('GitHub App installation initiated', {
                userId,
                hasSession: !!req.session
            });

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
                const error = GitHubErrors.AUTH_REQUIRED;
                res.status(error.httpStatus).json(GitHubErrors.formatError(error));
                return;
            }

            // Initialize GitHub service first
            await GitHubService.initialize();

            const clientId = process.env.GITHUB_CLIENT_ID;
            // OAuth callback must go to backend, not frontend
            const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:8000';
            const callbackUrl = process.env.GITHUB_CALLBACK_URL ?? `${backendUrl}/api/github/callback`;
            
            // Generate secure state for CSRF protection
            const nonce = crypto.randomBytes(32).toString('hex');
            const timestamp = Date.now();
            const stateData = Buffer.from(JSON.stringify({ userId, nonce, timestamp })).toString('base64');
            
            // Store state in session for validation
            if (!req.session) {
                const error = GitHubErrors.SESSION_NOT_CONFIGURED;
                loggingService.error(error.message, { code: error.code });
                res.status(error.httpStatus).json(GitHubErrors.formatError(error));
                return;
            }
            req.session.githubOAuthState = { state: stateData, nonce, timestamp, userId };

            const scopes = 'repo,read:user,user:email';
            const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&state=${stateData}`;

            loggingService.info('GitHub OAuth flow initiated', {
                userId,
                hasSession: !!req.session
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

            // Validate state parameter (CSRF protection)
            const storedState = req.session?.githubOAuthState;
            if (!storedState || storedState.state !== state) {
                const error = GitHubErrors.OAUTH_STATE_INVALID;
                loggingService.warn(error.message, {
                    hasStoredState: !!storedState,
                    statesMatch: storedState?.state === state,
                    code: error.code
                });
                const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
                res.redirect(`${frontendUrl}/github/error?message=${encodeURIComponent(error.actionable)}`);
                return;
            }

            // Check state timestamp (prevent replay attacks - 10 minute window)
            const stateAge = Date.now() - storedState.timestamp;
            if (stateAge > 10 * 60 * 1000) {
                const error = GitHubErrors.OAUTH_STATE_EXPIRED;
                loggingService.warn(error.message, {
                    stateAgeMs: stateAge,
                    code: error.code
                });
                const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
                res.redirect(`${frontendUrl}/github/error?message=${encodeURIComponent(error.actionable)}`);
                return;
            }

            // Decode and validate state
            const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
            const userId = stateData.userId;

            // Verify userId matches stored state
            if (userId !== storedState.userId) {
                loggingService.error('OAuth userId mismatch', {
                    stateUserId: userId,
                    storedUserId: storedState.userId
                });
                const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
                res.redirect(`${frontendUrl}/github/error?message=${encodeURIComponent('Authentication error. Please try again.')}`);
                return;
            }

            // Clear used state
            delete req.session.githubOAuthState;

            // Exchange code for token
            const tokenResponse: OAuthTokenResponse = await GitHubService.exchangeCodeForToken(code as string);

            // Get user information
            const githubUser: GitHubUser = await GitHubService.getAuthenticatedUser(tokenResponse.access_token);

            // Check if connection already exists
            let connection = await GitHubConnection.findOne({
                userId,
                githubUserId: githubUser.id
            }).select('+accessToken +refreshToken');

            // Calculate token expiration
            const expiresAt = tokenResponse.expires_in 
                ? new Date(Date.now() + tokenResponse.expires_in * 1000)
                : undefined;

            if (connection) {
                // Update existing connection
                connection.accessToken = tokenResponse.access_token; // Will be encrypted by pre-save hook
                if (tokenResponse.refresh_token) {
                    connection.refreshToken = tokenResponse.refresh_token; // Will be encrypted by pre-save hook
                }
                connection.tokenType = 'oauth';
                connection.scope = tokenResponse.scope;
                connection.expiresAt = expiresAt;
                connection.isActive = true;
                connection.lastSyncedAt = new Date();
                await connection.save();
                
                loggingService.info('GitHub OAuth connection updated', {
                    userId,
                    hasRefreshToken: !!tokenResponse.refresh_token,
                    expiresAt
                });
            } else {
                // Create new connection
                connection = await GitHubConnection.create({
                    userId,
                    accessToken: tokenResponse.access_token,
                    refreshToken: tokenResponse.refresh_token,
                    tokenType: 'oauth',
                    scope: tokenResponse.scope,
                    expiresAt,
                    githubUserId: githubUser.id,
                    githubUsername: githubUser.login,
                    avatarUrl: githubUser.avatar_url,
                    isActive: true,
                    repositories: [],
                    lastSyncedAt: new Date()
                });
                
                loggingService.info('GitHub OAuth connection created', {
                    userId,
                    hasRefreshToken: !!tokenResponse.refresh_token,
                    expiresAt
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
     * GET /api/github/callback?installation_id=xxx&setup_action=install&state=xxx
     */
    static async handleGitHubAppInstallation(req: any, res: Response, installationId: string): Promise<void> {
        try {
            // Initialize GitHub service first
            await GitHubService.initialize();

            const { state } = req.query;
            let userId: string | undefined;

            // Try to get userId from state parameter first
            if (state) {
                try {
                    const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
                    
                    // Validate state if stored in session
                    const storedState = req.session?.githubAppState;
                    if (storedState && storedState.state === state) {
                        // Validate timestamp (10 minute window)
                        const stateAge = Date.now() - storedState.timestamp;
                        if (stateAge <= 10 * 60 * 1000) {
                            userId = storedState.userId;
                            // Clear used state
                            delete req.session.githubAppState;
                            
                            loggingService.info('GitHub App state validated successfully', {
                                userId,
                                installationId
                            });
                        } else {
                            loggingService.warn('GitHub App state expired', {
                                stateAge,
                                installationId
                            });
                        }
                    } else if (stateData.userId) {
                        // Fallback: Use userId from state if session not available
                        userId = stateData.userId;
                        loggingService.info('Using userId from state (no session validation)', {
                            userId,
                            installationId
                        });
                    }
                } catch (error) {
                    loggingService.warn('Failed to parse GitHub App state', {
                        error: error instanceof Error ? error.message : 'Unknown',
                        installationId
                    });
                }
            }

            // Fallback to session userId
            if (!userId) {
                userId = req.userId || req.session?.userId;
            }
            
            if (!userId) {
                // No userId found - store installation for later linking
                loggingService.warn('GitHub App installation without userId, storing for later linking', {
                    installationId
                });
                
                const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
                res.redirect(`${frontendUrl}/github/link-installation?installationId=${installationId}`);
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
                    githubUserId: installation.account?.id,
                    githubUsername: installation.account?.login,
                    avatarUrl: installation.account?.avatar_url,
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
                const error = GitHubErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GitHubErrors.formatError(error));
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
                const error = GitHubErrors.INTEGRATION_NOT_FOUND;
                res.status(error.httpStatus).json(GitHubErrors.formatError(error));
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
                const error = GitHubErrors.INTEGRATION_NOT_FOUND;
                res.status(error.httpStatus).json(GitHubErrors.formatError(error));
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
                const error = GitHubErrors.CONNECTION_NOT_FOUND;
                res.status(error.httpStatus).json(GitHubErrors.formatError(error));
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
            // Use raw body if available, otherwise stringify (should always have rawBody)
            const payload = (req as any).rawBody || JSON.stringify(req.body);

            // Verify webhook signature
            if (!GitHubService.verifyWebhookSignature(payload, signature)) {
                const error = GitHubErrors.WEBHOOK_SIGNATURE_INVALID;
                loggingService.warn(error.message, {
                    hasSignature: !!signature,
                    hasRawBody: !!(req as any).rawBody,
                    path: req.path,
                    code: error.code
                });
                res.status(error.httpStatus).json(GitHubErrors.formatError(error));
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
                case 'push':
                    await this.handlePushEvent(req.body);
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
     * Handle push events for cache invalidation
     */
    private static async handlePushEvent(payload: any): Promise<void> {
        try {
            const repo = payload.repository?.full_name;
            const branch = payload.ref?.replace('refs/heads/', '');
            const commits = payload.commits || [];

            if (!repo) {
                loggingService.warn('Push event missing repository information');
                return;
            }

            loggingService.info('GitHub push event received', {
                repo,
                branch,
                commitCount: commits.length,
                headCommit: payload.head_commit?.id
            });

            // Import CacheInvalidationService dynamically to avoid circular dependencies
            const { CacheInvalidationService } = await import('../services/cacheInvalidation.service');
            
            // Invalidate caches for this repo
            await CacheInvalidationService.invalidateRepo(repo, branch);

            // Schedule background reindex if significant changes
            if (commits.length > 0) {
                // Look up user and connection for this repository
                const { RepositoryUserMapping } = await import('../models');
                const mapping = await RepositoryUserMapping.findOne({ repositoryFullName: repo });
                
                if (mapping) {
                    const { ReindexQueue } = await import('../queues/reindex.queue');
                    
                    try {
                        await ReindexQueue.addReindexJob({
                            repoFullName: repo,
                            branch,
                            userId: mapping.userId,
                            connectionId: mapping.connectionId,
                            priority: 'high'
                        });
                        
                        loggingService.info('Scheduled reindex job for push event', {
                            repo,
                            userId: mapping.userId,
                            commitCount: commits.length
                        });
                    } catch (error) {
                        loggingService.warn('Failed to schedule reindex job', {
                            repo,
                            error: error instanceof Error ? error.message : 'Unknown'
                        });
                    }
                } else {
                    loggingService.info('No user mapping found for repository, skipping reindex', {
                        repo
                    });
                }
            }
        } catch (error) {
            loggingService.error('Push event handling failed', {
                error: error instanceof Error ? error.message : 'Unknown',
                stack: error instanceof Error ? error.stack : undefined
            });
        }
    }

    /**
     * Handle installation events
     */
    private static async handleInstallationEvent(payload: any): Promise<void> {
        try {
            const action = payload.action;
            const installation = payload.installation;
            const installationId = installation?.id?.toString();

            if (!installationId) {
                loggingService.warn('GitHub App installation event missing installation ID', {
                    action,
                });
                return;
            }

            loggingService.info('GitHub App installation event received', {
                action,
                installationId,
                accountId: installation.account?.id,
                accountLogin: installation.account?.login,
            });

            // Initialize GitHub service
            await GitHubService.initialize();

            switch (action) {
                case 'created':
                    await this.handleInstallationCreated(installation);
                    break;

                case 'deleted':
                    await this.handleInstallationDeleted(installationId);
                    break;

                case 'suspend':
                    await this.handleInstallationSuspended(installationId);
                    break;

                case 'unsuspend':
                    await this.handleInstallationUnsuspended(installationId);
                    break;

                case 'new_permissions_accepted':
                    await this.handleInstallationPermissionsUpdated(installation);
                    break;

                default:
                    loggingService.info('Unhandled GitHub App installation action', {
                        action,
                        installationId,
                    });
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Failed to handle GitHub App installation event', {
                action: payload.action,
                installationId: payload.installation?.id,
                error: errorMessage,
                stack: error instanceof Error ? error.stack : undefined,
            });
        }
    }

    /**
     * Handle installation created event
     */
    private static async handleInstallationCreated(installation: any): Promise<void> {
        try {
            const installationId = installation.id?.toString();
            if (!installationId) {
                loggingService.warn('Installation created event missing installation ID');
                return;
            }

            // Check if connection already exists
            let connection = await GitHubConnection.findOne({
                installationId,
            }).select('+accessToken');

            if (connection) {
                // Update existing connection
                connection.isActive = true;
                connection.githubUserId = installation.account?.id;
                connection.githubUsername = installation.account?.login;
                connection.avatarUrl = installation.account?.avatar_url;
                connection.lastSyncedAt = new Date();
                await connection.save();

                loggingService.info('GitHub App installation connection updated', {
                    installationId,
                    userId: connection.userId,
                    githubUsername: connection.githubUsername,
                });
            } else {
                // Installation created but no user connection yet
                // This can happen if installation was done outside our flow
                // Store installation info for later linking
                loggingService.info('GitHub App installation created but no user connection found', {
                    installationId,
                    accountLogin: installation.account?.login,
                    accountId: installation.account?.id,
                });
            }

            // If connection exists, sync repositories
            if (connection) {
                try {
                    const repositories = await GitHubService.listUserRepositories(connection);
                    connection.repositories = repositories;
                    connection.lastSyncedAt = new Date();
                    await connection.save();

                    loggingService.info('Repositories synced for installation', {
                        installationId,
                        repositoriesCount: repositories.length,
                    });
                } catch (syncError: unknown) {
                    const errorMessage = syncError instanceof Error ? syncError.message : String(syncError);
                    loggingService.warn('Failed to sync repositories for installation', {
                        installationId,
                        error: errorMessage,
                    });
                }
            }
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Failed to handle installation created event', {
                installationId: installation.id,
                error: errorMessage,
            });
            throw error;
        }
    }

    /**
     * Handle installation deleted event
     */
    private static async handleInstallationDeleted(installationId: string): Promise<void> {
        try {
            // Find all connections with this installation ID
            const connections = await GitHubConnection.find({
                installationId,
            });

            if (connections.length === 0) {
                loggingService.info('No connections found for deleted installation', {
                    installationId,
                });
                return;
            }

            // Mark all connections as inactive
            for (const connection of connections) {
                connection.isActive = false;
                await connection.save();

                loggingService.info('GitHub App connection deactivated due to installation deletion', {
                    installationId,
                    userId: connection.userId,
                    connectionId: connection._id.toString(),
                });
            }

            // Also mark related integrations as inactive or failed
            const { GitHubIntegration } = await import('../models');
            const integrations = await GitHubIntegration.find({
                connectionId: { $in: connections.map(c => c._id) },
                status: { $in: ['initializing', 'analyzing', 'generating', 'draft', 'open', 'updating'] },
            });

            for (const integration of integrations) {
                if (integration.status === 'open' || integration.status === 'draft') {
                    integration.status = 'closed';
                } else {
                    integration.status = 'failed';
                    integration.errorMessage = 'GitHub App installation was deleted';
                }
                await integration.save();
            }

            loggingService.info('GitHub App installation deletion processed', {
                installationId,
                connectionsDeactivated: connections.length,
                integrationsUpdated: integrations.length,
            });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Failed to handle installation deleted event', {
                installationId,
                error: errorMessage,
            });
            throw error;
        }
    }

    /**
     * Handle installation suspended event
     */
    private static async handleInstallationSuspended(installationId: string): Promise<void> {
        try {
            const connections = await GitHubConnection.find({
                installationId,
                isActive: true,
            });

            for (const connection of connections) {
                connection.isActive = false;
                await connection.save();

                loggingService.info('GitHub App connection suspended', {
                    installationId,
                    userId: connection.userId,
                    connectionId: connection._id.toString(),
                });
            }

            loggingService.info('GitHub App installation suspension processed', {
                installationId,
                connectionsSuspended: connections.length,
            });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Failed to handle installation suspended event', {
                installationId,
                error: errorMessage,
            });
            throw error;
        }
    }

    /**
     * Handle installation unsuspended event
     */
    private static async handleInstallationUnsuspended(installationId: string): Promise<void> {
        try {
            const connections = await GitHubConnection.find({
                installationId,
            });

            for (const connection of connections) {
                connection.isActive = true;
                connection.lastSyncedAt = new Date();
                await connection.save();

                // Sync repositories after unsuspension
                try {
                    const repositories = await GitHubService.listUserRepositories(connection);
                    connection.repositories = repositories;
                    await connection.save();
                } catch (syncError: unknown) {
                    const errorMessage = syncError instanceof Error ? syncError.message : String(syncError);
                    loggingService.warn('Failed to sync repositories after unsuspension', {
                        installationId,
                        connectionId: connection._id.toString(),
                        error: errorMessage,
                    });
                }

                loggingService.info('GitHub App connection unsuspended', {
                    installationId,
                    userId: connection.userId,
                    connectionId: connection._id.toString(),
                });
            }

            loggingService.info('GitHub App installation unsuspension processed', {
                installationId,
                connectionsReactivated: connections.length,
            });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Failed to handle installation unsuspended event', {
                installationId,
                error: errorMessage,
            });
            throw error;
        }
    }

    /**
     * Handle installation permissions updated event
     */
    private static async handleInstallationPermissionsUpdated(installation: any): Promise<void> {
        try {
            const installationId = installation.id?.toString();
            if (!installationId) {
                loggingService.warn('Installation permissions updated event missing installation ID');
                return;
            }

            const connections = await GitHubConnection.find({
                installationId,
            }).select('+accessToken');

            for (const connection of connections) {
                // Update connection metadata
                connection.githubUserId = installation.account?.id;
                connection.githubUsername = installation.account?.login;
                connection.avatarUrl = installation.account?.avatar_url;
                connection.isActive = true;
                connection.lastSyncedAt = new Date();

                // Sync repositories with new permissions
                try {
                    const repositories = await GitHubService.listUserRepositories(connection);
                    connection.repositories = repositories;
                    await connection.save();

                    loggingService.info('Repositories synced after permissions update', {
                        installationId,
                        userId: connection.userId,
                        repositoriesCount: repositories.length,
                    });
                } catch (syncError: unknown) {
                    const errorMessage = syncError instanceof Error ? syncError.message : String(syncError);
                    loggingService.warn('Failed to sync repositories after permissions update', {
                        installationId,
                        connectionId: connection._id.toString(),
                        error: errorMessage,
                    });
                    // Still save the connection update even if sync fails
                    await connection.save();
                }
            }

            loggingService.info('GitHub App installation permissions update processed', {
                installationId,
                connectionsUpdated: connections.length,
            });
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('Failed to handle installation permissions updated event', {
                installationId: installation.id,
                error: errorMessage,
            });
            throw error;
        }
    }
}

export default GitHubController;



