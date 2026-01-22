import { Request, Response } from 'express';
import { GitHubService, OAuthTokenResponse, GitHubUser } from '../services/github.service';
import { GitHubIntegrationService, StartIntegrationOptions } from '../services/githubIntegration.service';
import { GitHubConnection, GitHubIntegration } from '../models';
import { loggingService } from '../services/logging.service';
import { GitHubErrors } from '../utils/githubErrors';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';
import crypto from 'crypto';

export class GitHubController {
    /**
     * Initialize GitHub App installation
     * GET /api/github/install
     */
    static async initiateAppInstallation(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('initiateAppInstallation', req);

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
            if (!(req as any).session) {
                const error = GitHubErrors.SESSION_NOT_CONFIGURED;
                loggingService.error(error.message, { code: error.code });
                res.status(error.httpStatus).json(GitHubErrors.formatError(error));
                return;
            }
            (req as any).session.githubAppState = { state, nonce, timestamp, userId };

            const installUrl = `https://github.com/apps/${process.env.GITHUB_APP_SLUG || 'costkatana'}/installations/new?state=${state}`;

            ControllerHelper.logRequestSuccess('initiateAppInstallation', req, startTime, { userId, hasSession: !!(req as any).session });

            res.json({
                success: true,
                data: {
                    installUrl,
                    state
                }
            });

        } catch (error: any) {
            ControllerHelper.handleError('initiateAppInstallation', error, req, res, startTime);
        }
    }

    /**
     * Initialize OAuth flow
     * GET /api/github/auth
     */
    static async initiateOAuth(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('initiateOAuth', req);

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
            
            // Store state in Redis/cache instead of session (for distributed deployments)
            const { redisService } = await import('../services/redis.service');
            const stateKey = `github:oauth:state:${stateData}`;
            await redisService.set(stateKey, { state: stateData, nonce, timestamp, userId }, 600); // 10 min TTL

            const scopes = 'repo,read:user,user:email';
            const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&state=${stateData}`;

            ControllerHelper.logRequestSuccess('initiateOAuth', req, startTime, { userId, hasRedis: true });

            res.json({
                success: true,
                data: {
                    authUrl,
                    state: stateData
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('initiateOAuth', error, req, res, startTime);
        }
    }

    /**
     * OAuth callback handler
     * GET /api/github/callback
     * Handles both user authentication OAuth (login) and integration OAuth
     */
    static async handleOAuthCallback(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            ControllerHelper.logRequestStart('handleOAuthCallback', req);
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

            // Check if this is a user authentication OAuth (login) by checking Redis
            // Login OAuth uses Redis state, integration OAuth uses session state
            const { redisService } = await import('../services/redis.service');
            const stateKey = `oauth:state:${state}`;
            let loginOAuthState: any = null;
            
            try {
                loginOAuthState = await redisService.get(stateKey);
                if (loginOAuthState) {
                    // This is a login OAuth flow - handle it here
                    loggingService.info('Detected login OAuth flow in GitHub callback', { stateKey });
                    
                    // Delete state after reading (one-time use)
                    await redisService.del(stateKey);
                    
                    // Validate state
                    if (loginOAuthState.state !== state || loginOAuthState.provider !== 'github') {
                        loggingService.warn('OAuth state mismatch in GitHub callback', { 
                            expectedState: state,
                            receivedState: loginOAuthState?.state,
                            expectedProvider: 'github',
                            receivedProvider: loginOAuthState?.provider,
                        });
                        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
                        res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('Invalid OAuth state. Please try again.')}`);
                        return;
                    }
                    
                    // Validate timestamp (10 minute expiration)
                    const stateAge = Date.now() - (loginOAuthState.timestamp || 0);
                    if (stateAge > 10 * 60 * 1000) {
                        loggingService.warn('OAuth state expired in GitHub callback', { 
                            stateAge: `${Math.floor(stateAge / 1000)}s`,
                        });
                        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
                        res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('OAuth state expired. Please try again.')}`);
                        return;
                    }
                    
                    // Handle OAuth callback using OAuth service
                    const { OAuthService } = await import('../services/oauth.service');
                    const { user, isNewUser, accessToken: oauthAccessToken, githubTokenResponse } = await OAuthService.handleOAuthCallback(
                        'github',
                        code as string,
                        state as string
                    );
                    
                    // Get the actual User document to update
                    const { User } = await import('../models/User');
                    const userDoc = await User.findById((user as any)._id);
                    if (!userDoc) {
                        throw new Error('User not found after OAuth callback');
                    }
                    
                    userDoc.lastLoginMethod = 'github';
                    await userDoc.save();
                    
                    // Handle GitHub connection and integration (same as in OAuth controller)
                    if (oauthAccessToken && githubTokenResponse) {
                        try {
                            await GitHubService.initialize();
                            const githubUser = await GitHubService.getAuthenticatedUser(oauthAccessToken);
                            
                            let connection = await GitHubConnection.findOne({
                                userId: userDoc._id.toString(),
                                githubUserId: githubUser.id,
                            }).select('+accessToken +refreshToken');
                            
                            const expiresAt = githubTokenResponse?.expires_in
                                ? new Date(Date.now() + githubTokenResponse.expires_in * 1000)
                                : undefined;
                            
                            if (connection) {
                                connection.accessToken = oauthAccessToken;
                                if (githubTokenResponse?.refresh_token) {
                                    connection.refreshToken = githubTokenResponse.refresh_token;
                                }
                                connection.tokenType = 'oauth';
                                connection.scope = githubTokenResponse.scope;
                                connection.expiresAt = expiresAt;
                                connection.isActive = true;
                                connection.lastSyncedAt = new Date();
                                await connection.save();
                                loggingService.info('GitHub OAuth connection updated during login', { userId: userDoc._id.toString(), githubUsername: githubUser.login });
                            } else {
                                connection = await GitHubConnection.create({
                                    userId: userDoc._id.toString(),
                                    accessToken: oauthAccessToken,
                                    refreshToken: githubTokenResponse?.refresh_token,
                                    tokenType: 'oauth',
                                    scope: githubTokenResponse?.scope || 'read:user user:email repo',
                                    expiresAt,
                                    githubUserId: githubUser.id,
                                    githubUsername: githubUser.login,
                                    avatarUrl: githubUser.avatar_url,
                                    isActive: true,
                                    repositories: [],
                                    lastSyncedAt: new Date(),
                                });
                                loggingService.info('GitHub OAuth connection created during login', { userId: userDoc._id.toString(), githubUsername: githubUser.login });
                            }
                            
                            try {
                                const repositories = await GitHubService.listUserRepositories(connection);
                                connection.repositories = repositories;
                                connection.lastSyncedAt = new Date();
                                await connection.save();
                                loggingService.info('GitHub repositories synced during login', { userId: userDoc._id.toString(), repositoriesCount: repositories.length });
                            } catch (repoError: any) {
                                loggingService.warn('Failed to sync GitHub repositories during login', { userId: userDoc._id.toString(), error: repoError.message });
                            }
                            
                            try {
                                const { Integration } = await import('../models/Integration');
                                const existingIntegration = await Integration.findOne({
                                    userId: userDoc._id,
                                    type: 'github_oauth',
                                });
                                
                                if (existingIntegration) {
                                    existingIntegration.status = 'active';
                                    existingIntegration.metadata = {
                                        ...existingIntegration.metadata,
                                        connectionId: connection._id.toString(),
                                        githubUsername: githubUser.login,
                                        repositoriesCount: connection.repositories.length,
                                        lastSynced: new Date(),
                                    };
                                    await existingIntegration.save();
                                    loggingService.info('GitHub integration updated during login', { userId: userDoc._id.toString(), integrationId: existingIntegration._id });
                                } else {
                                    const integration = new Integration({
                                        userId: userDoc._id,
                                        type: 'github_oauth',
                                        name: `GitHub (${githubUser.login})`,
                                        description: `GitHub OAuth integration connected via login`,
                                        status: 'active',
                                        encryptedCredentials: '',
                                        metadata: {
                                            connectionId: connection._id.toString(),
                                            githubUsername: githubUser.login,
                                            githubUserId: githubUser.id,
                                            repositoriesCount: connection.repositories.length,
                                            connectedVia: 'oauth_login',
                                            lastSynced: new Date(),
                                        },
                                        stats: { totalDeliveries: 0, successfulDeliveries: 0, failedDeliveries: 0, averageResponseTime: 0 },
                                    });
                                    await integration.save();
                                    loggingService.info('GitHub integration created during login', { userId: userDoc._id.toString(), integrationId: integration._id });
                                }
                            } catch (integrationError: any) {
                                loggingService.warn('Failed to create GitHub integration during login', { userId: userDoc._id.toString(), error: integrationError.message });
                            }
                        } catch (githubError: any) {
                            loggingService.warn('Failed to setup GitHub connection during login', { userId: userDoc._id.toString(), error: githubError.message });
                        }
                    }
                    
                    // Generate JWT tokens
                    const { AuthService } = await import('../services/auth.service');
                    const tokens = await AuthService.generateTokens(userDoc);
                    
                    // Redirect to frontend with tokens
                    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
                    const redirectUrl = `${frontendUrl}/oauth/callback?accessToken=${encodeURIComponent(tokens.accessToken)}&refreshToken=${encodeURIComponent(tokens.refreshToken)}&isNewUser=${isNewUser}&lastLoginMethod=github`;
                    res.redirect(redirectUrl);
                    return;
                }
            } catch (error: any) {
                loggingService.debug('No login OAuth state found in Redis, checking for integration OAuth', { 
                    error: error.message 
                });
            }

            // This is an integration OAuth flow - use existing logic
            // Initialize GitHub service first
            await GitHubService.initialize();

            // Validate state parameter (CSRF protection) - check Redis/cache
            const githubStateKey = `github:oauth:state:${state}`;
            const storedState = await redisService.get(githubStateKey);
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

            // Clear used state (one-time use)
            await redisService.del(githubStateKey);

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

                // Auto-grant MCP permissions for new connection
                const { AutoGrantMCPPermissions } = await import('../mcp/permissions/auto-grant.service');
                await AutoGrantMCPPermissions.grantPermissionsForNewConnection(
                    userId,
                    'github',
                    connection._id.toString()
                );
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
                status: error.status,
                duration: Date.now() - startTime
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
    static async handleGitHubAppInstallation(req: AuthenticatedRequest, res: Response, installationId: string): Promise<void> {
        const startTime = Date.now();
        try {
            ControllerHelper.logRequestStart('handleGitHubAppInstallation', req);
            // Initialize GitHub service first
            await GitHubService.initialize();

            const { state } = req.query;
            let userId: string | undefined;

            // Try to get userId from state parameter first
            if (state) {
                try {
                    const stateData = JSON.parse(Buffer.from(state as string, 'base64').toString('utf-8'));
                    
                    // Validate state if stored in session
                    const storedState = (req as any).session?.githubAppState;
                    if (storedState && storedState.state === state) {
                        // Validate timestamp (10 minute window)
                        const stateAge = Date.now() - storedState.timestamp;
                        if (stateAge <= 10 * 60 * 1000) {
                            userId = storedState.userId;
                            // Clear used state
                            delete (req as any).session.githubAppState;
                            
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
                userId = req.userId || (req as any).session?.userId;
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

            ControllerHelper.logRequestSuccess('handleGitHubAppInstallation', req, startTime, {
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
                stack: error.stack,
                duration: Date.now() - startTime
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
    static async listConnections(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('listConnections', req);

            const connections = await GitHubConnection.find({
                userId,
                isActive: true
            });

            ControllerHelper.logRequestSuccess('listConnections', req, startTime, { userId, count: connections.length });

            res.json({
                success: true,
                data: connections
            });
        } catch (error: any) {
            ControllerHelper.handleError('listConnections', error, req, res, startTime);
        }
    }

    /**
     * Get repositories for a connection
     * GET /api/github/connections/:connectionId/repositories
     */
    static async getRepositories(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getRepositories', req);

            const { connectionId } = req.params;
            ServiceHelper.validateObjectId(connectionId, 'connectionId');

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

            ControllerHelper.logRequestSuccess('getRepositories', req, startTime, { userId, connectionId });

            res.json({
                success: true,
                data: {
                    repositories: connection.repositories,
                    lastSynced: connection.lastSyncedAt
                }
            });
        } catch (error: any) {
            ControllerHelper.handleError('getRepositories', error, req, res, startTime);
        }
    }

    /**
     * Start integration for a repository
     * POST /api/github/integrations
     */
    static async startIntegration(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('startIntegration', req);

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

            ServiceHelper.validateObjectId(connectionId, 'connectionId');

            const integration = await GitHubIntegrationService.startIntegration(options);

            ControllerHelper.logRequestSuccess('startIntegration', req, startTime, {
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
            ControllerHelper.handleError('startIntegration', error, req, res, startTime);
        }
    }

    /**
     * Get integration status
     * GET /api/github/integrations/:integrationId
     */
    static async getIntegrationStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('getIntegrationStatus', req);

            const { integrationId } = req.params;
            ServiceHelper.validateObjectId(integrationId, 'integrationId');

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

            ControllerHelper.logRequestSuccess('getIntegrationStatus', req, startTime, { userId, integrationId });

            res.json({
                success: true,
                data: progress
            });
        } catch (error: any) {
            ControllerHelper.handleError('getIntegrationStatus', error, req, res, startTime);
        }
    }

    /**
     * List user's integrations
     * GET /api/github/integrations
     */
    static async listIntegrations(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('listIntegrations', req);

            const { status, limit } = req.query;

            const integrations = await GitHubIntegrationService.listUserIntegrations(userId, {
                status: status as string,
                limit: limit ? parseInt(limit as string) : undefined
            });

            ControllerHelper.logRequestSuccess('listIntegrations', req, startTime, { userId, count: integrations.length });

            res.json({
                success: true,
                data: integrations
            });
        } catch (error: any) {
            ControllerHelper.handleError('listIntegrations', error, req, res, startTime);
        }
    }

    /**
     * Update integration from chat
     * POST /api/github/integrations/:integrationId/update
     */
    static async updateIntegration(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('updateIntegration', req);

            const { integrationId } = req.params;
            const { changes } = req.body;

            ServiceHelper.validateObjectId(integrationId, 'integrationId');

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

            ControllerHelper.logRequestSuccess('updateIntegration', req, startTime, { userId, integrationId });

            res.json({
                success: true,
                message: 'Integration update started'
            });
        } catch (error: any) {
            ControllerHelper.handleError('updateIntegration', error, req, res, startTime);
        }
    }

    /**
     * Disconnect GitHub connection
     * DELETE /api/github/connections/:connectionId
     */
    static async disconnectConnection(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        try {
            if (!ControllerHelper.requireAuth(req, res)) {
                return;
            }
            const userId = req.userId!;
            ControllerHelper.logRequestStart('disconnectConnection', req);

            const { connectionId } = req.params;
            ServiceHelper.validateObjectId(connectionId, 'connectionId');

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

            ControllerHelper.logRequestSuccess('disconnectConnection', req, startTime, { userId, connectionId });

            res.json({
                success: true,
                message: 'Connection disconnected successfully'
            });
        } catch (error: any) {
            ControllerHelper.handleError('disconnectConnection', error, req, res, startTime);
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



