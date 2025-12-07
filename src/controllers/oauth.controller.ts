import { Response, NextFunction } from 'express';
import { OAuthService } from '../services/oauth.service';
import { AuthService } from '../services/auth.service';
import { loggingService } from '../services/logging.service';
import { redisService } from '../services/redis.service';

export class OAuthController {
    /**
     * Initiate OAuth flow
     * GET /api/auth/oauth/:provider
     */
    static async initiateOAuth(req: any, res: Response, _next: NextFunction): Promise<void> {
        try {
            const provider = req.params.provider as 'google' | 'github';
            
            // Validate provider
            if (!['google', 'github'].includes(provider)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid OAuth provider. Supported providers: google, github',
                });
                return;
            }

            // Check environment configuration
            const requiredEnvVars = provider === 'google' 
                ? ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']
                : ['GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET'];

            const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
            if (missingVars.length > 0) {
                loggingService.error(`Missing OAuth configuration for ${provider}`, { missingVars });
                res.status(500).json({
                    success: false,
                    message: `${provider} OAuth is not configured on the server`,
                });
                return;
            }

            // Get userId if user is authenticated (for linking)
            const userId = req.userId;

            // Generate OAuth URL
            const { authUrl, state } = OAuthService.initiateOAuth(provider, userId);

            // Store state for validation (10 minute TTL)
            // Uses Redis in production, in-memory cache in local dev, session as final fallback
            const stateKey = `oauth:state:${state}`;
            const stateData = {
                state,
                provider,
                timestamp: Date.now(),
                userId: userId || null,
            };
            
            try {
                // Use RedisService.set() which handles Redis + in-memory fallback automatically
                await redisService.set(stateKey, stateData, 600); // 10 minutes
                loggingService.info('OAuth state stored successfully', { provider, stateKey });
            } catch (error: any) {
                loggingService.warn('Failed to store OAuth state, using session fallback', { 
                    error: error.message,
                    provider 
                });
                // Final fallback to session if all else fails
                if (req.session) {
                    req.session.oauthState = stateData;
                } else {
                    // If no session either, log warning but continue (state validation will fail gracefully)
                    loggingService.warn('No session available for OAuth state fallback', { provider });
                }
            }

            loggingService.info(`${provider} OAuth flow initiated`, { provider, hasUserId: !!userId });

            res.json({
                success: true,
                data: {
                    authUrl,
                    provider,
                },
            });
        } catch (error: any) {
            loggingService.error('Failed to initiate OAuth', {
                error: error.message,
                provider: req.params.provider,
            });
            
            res.status(500).json({
                success: false,
                message: 'Failed to initiate OAuth flow',
                error: error.message,
            });
        }
    }

    /**
     * Handle OAuth callback
     * GET /api/auth/oauth/:provider/callback
     */
    static async handleOAuthCallback(req: any, res: Response, _next: NextFunction): Promise<void> {
        try {
            const provider = req.params.provider as 'google' | 'github';
            const { code, state, error: oauthError, error_description } = req.query;

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

            // Handle OAuth errors
            if (oauthError) {
                loggingService.warn('OAuth provider returned error', { 
                    provider, 
                    error: oauthError, 
                    description: error_description 
                });
                
                res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error_description || oauthError)}`);
                return;
            }

            // Validate required parameters
            if (!code || !state) {
                loggingService.warn('Missing code or state in OAuth callback', { provider });
                res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('Missing OAuth parameters')}`);
                return;
            }

            // Validate state (CSRF protection)
            // Tries: Redis/in-memory cache -> Session -> Fail gracefully
            const stateKey = `oauth:state:${state}`;
            let storedState: any = null;
            
            // Try RedisService.get() first (handles Redis + in-memory automatically)
            try {
                storedState = await redisService.get(stateKey);
                if (storedState) {
                    // Delete state after reading (one-time use)
                    await redisService.del(stateKey);
                    loggingService.info('OAuth state retrieved from cache', { provider, stateKey });
                }
            } catch (error: any) {
                loggingService.warn('Failed to get OAuth state from cache', { 
                    error: error.message,
                    provider 
                });
            }
            
            // Fallback to session if cache didn't have it
            if (!storedState && req.session?.oauthState) {
                storedState = req.session.oauthState;
                if (req.session) {
                    delete req.session.oauthState;
                }
                loggingService.info('OAuth state retrieved from session fallback', { provider });
            }
            
            // Validate state
            if (!storedState) {
                loggingService.warn('OAuth state not found', { 
                    provider,
                    stateKey,
                    hasSession: !!req.session,
                });
                res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('OAuth state expired or invalid. Please try again.')}`);
                return;
            }
            
            if (storedState.state !== state || storedState.provider !== provider) {
                loggingService.warn('OAuth state mismatch', { 
                    provider, 
                    expectedState: state,
                    receivedState: storedState?.state,
                    expectedProvider: provider,
                    receivedProvider: storedState?.provider,
                });
                res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('Invalid OAuth state. Please try again.')}`);
                return;
            }
            
            // Validate timestamp (10 minute expiration)
            const stateAge = Date.now() - (storedState.timestamp || 0);
            if (stateAge > 10 * 60 * 1000) {
                loggingService.warn('OAuth state expired', { 
                    provider,
                    stateAge: `${Math.floor(stateAge / 1000)}s`,
                });
                res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('OAuth state expired. Please try again.')}`);
                return;
            }

            // Handle OAuth callback
            const { user, isNewUser, accessToken: oauthAccessToken } = await OAuthService.handleOAuthCallback(
                provider,
                code as string,
                state as string
            );

            // Get the actual User document to update
            const { User } = await import('../models/User');
            const userDoc = await User.findById((user as any)._id);
            
            if (!userDoc) {
                throw new Error('User not found after OAuth callback');
            }

            // Update last login method (only for login, not for linking)
            // Check if this is a linking flow by checking if userId was in state
            let isLinkingFlow = false;
            try {
                const stateData = OAuthService.validateState(state as string, provider);
                isLinkingFlow = !!stateData.userId;
                if (!isLinkingFlow) {
                    // This is a login flow, update lastLoginMethod
                    userDoc.lastLoginMethod = provider;
                    await userDoc.save();
                }
            } catch {
                // If state validation fails, assume it's a login flow
                userDoc.lastLoginMethod = provider;
                await userDoc.save();
            }

            // For GitHub OAuth, create/update GitHub connection and fetch repositories
            // This applies to both login and linking flows
            if (provider === 'github' && oauthAccessToken) {
                try {
                    const { GitHubService } = await import('../services/github.service');
                    const { GitHubConnection } = await import('../models/GitHubConnection');
                    
                    // Initialize GitHub service
                    await GitHubService.initialize();
                    
                    // Get GitHub user info
                    const githubUser = await GitHubService.getAuthenticatedUser(oauthAccessToken);
                    
                    // Check if connection already exists
                    let connection = await GitHubConnection.findOne({
                        userId: (userDoc as any)._id.toString(),
                        githubUserId: githubUser.id
                    }).select('+accessToken +refreshToken');
                    
                    if (connection) {
                        // Update existing connection
                        connection.accessToken = oauthAccessToken; // Will be encrypted by pre-save hook
                        connection.tokenType = 'oauth';
                        connection.isActive = true;
                        connection.lastSyncedAt = new Date();
                        connection.githubUsername = githubUser.login;
                        connection.avatarUrl = githubUser.avatar_url;
                        await connection.save();
                        
                        loggingService.info('GitHub OAuth connection updated during login', {
                            userId: (userDoc as any)._id.toString(),
                            githubUsername: githubUser.login,
                        });
                    } else {
                        // Create new connection
                        connection = await GitHubConnection.create({
                            userId: (userDoc as any)._id.toString(),
                            accessToken: oauthAccessToken,
                            tokenType: 'oauth',
                            githubUserId: githubUser.id,
                            githubUsername: githubUser.login,
                            avatarUrl: githubUser.avatar_url,
                            isActive: true,
                            repositories: [],
                            lastSyncedAt: new Date()
                        });
                        
                        loggingService.info('GitHub OAuth connection created during login', {
                            userId: (userDoc as any)._id.toString(),
                            githubUsername: githubUser.login,
                        });
                    }
                    
                    // Fetch and sync repositories
                    try {
                        const repositories = await GitHubService.listUserRepositories(connection);
                        connection.repositories = repositories;
                        connection.lastSyncedAt = new Date();
                        await connection.save();
                        
                        loggingService.info('GitHub repositories synced during login', {
                            userId: (userDoc as any)._id.toString(),
                            repositoriesCount: repositories.length,
                        });
                    } catch (repoError: any) {
                        // Log but don't fail the login if repo sync fails
                        loggingService.warn('Failed to sync GitHub repositories during login', {
                            userId: (userDoc as any)._id.toString(),
                            error: repoError.message,
                        });
                    }
                    
                    // Create/update Integration record to mark GitHub as integrated
                    try {
                        const { Integration } = await import('../models/Integration');
                        const existingIntegration = await Integration.findOne({
                            userId: (userDoc as any)._id,
                            type: 'github_oauth',
                        });
                        
                        if (existingIntegration) {
                            // Update existing integration
                            existingIntegration.status = 'active';
                            existingIntegration.metadata = {
                                ...existingIntegration.metadata,
                                connectionId: connection._id.toString(),
                                githubUsername: githubUser.login,
                                repositoriesCount: connection.repositories.length,
                                lastSynced: new Date(),
                            };
                            await existingIntegration.save();
                            
                            loggingService.info('GitHub integration updated during login', {
                                userId: (userDoc as any)._id.toString(),
                                integrationId: existingIntegration._id,
                            });
                        } else {
                            // Create new integration
                            const integration = new Integration({
                                userId: (userDoc as any)._id,
                                type: 'github_oauth',
                                name: `GitHub (${githubUser.login})`,
                                description: isLinkingFlow 
                                    ? `GitHub OAuth integration connected via account linking`
                                    : `GitHub OAuth integration connected via login`,
                                status: 'active',
                                encryptedCredentials: '', // GitHub connection is stored separately
                                metadata: {
                                    connectionId: connection._id.toString(),
                                    githubUsername: githubUser.login,
                                    githubUserId: githubUser.id,
                                    repositoriesCount: connection.repositories.length,
                                    connectedVia: isLinkingFlow ? 'oauth_linking' : 'oauth_login',
                                    lastSynced: new Date(),
                                },
                                stats: {
                                    totalDeliveries: 0,
                                    successfulDeliveries: 0,
                                    failedDeliveries: 0,
                                    averageResponseTime: 0,
                                },
                            });
                            await integration.save();
                            
                            loggingService.info(`GitHub integration created during ${isLinkingFlow ? 'linking' : 'login'}`, {
                                userId: (userDoc as any)._id.toString(),
                                integrationId: integration._id,
                            });
                        }
                    } catch (integrationError: any) {
                        // Log but don't fail the login if integration creation fails
                        loggingService.warn('Failed to create GitHub integration during login', {
                            userId: (userDoc as any)._id.toString(),
                            error: integrationError.message,
                        });
                    }
                } catch (githubError: any) {
                    // Log but don't fail the login if GitHub connection setup fails
                    loggingService.warn('Failed to setup GitHub connection during login', {
                        userId: (userDoc as any)._id.toString(),
                        error: githubError.message,
                    });
                }
            }

            // Check if MFA is enabled for OAuth users
            // Note: OAuth providers (Google/GitHub) already provide strong 2FA
            // But if user has explicitly enabled MFA in Cost Katana, we should respect it
            if (userDoc.mfa.enabled && userDoc.mfa.methods.length > 0) {
                // Generate MFA token
                const mfaToken = AuthService.generateMFAToken((userDoc as any)._id.toString());

                loggingService.info(`${provider} OAuth login requires MFA`, {
                    provider,
                    userId: (userDoc as any)._id,
                    email: userDoc.email,
                    mfaMethods: userDoc.mfa.methods,
                });

                // Redirect to frontend with MFA requirement
                const redirectUrl = `${frontendUrl}/oauth/callback?requiresMFA=true&mfaToken=${encodeURIComponent(mfaToken)}&userId=${encodeURIComponent((userDoc as any)._id.toString())}&availableMethods=${encodeURIComponent(userDoc.mfa.methods.join(','))}&lastLoginMethod=${provider}`;
                
                res.redirect(redirectUrl);
                return;
            }

            // Generate JWT tokens (no MFA required)
            const tokens = AuthService.generateTokens(userDoc);

            loggingService.info(`${provider} OAuth login successful`, {
                provider,
                userId: (userDoc as any)._id,
                email: userDoc.email,
                isNewUser,
            });

            // Redirect to frontend with tokens
            const redirectUrl = `${frontendUrl}/oauth/callback?accessToken=${encodeURIComponent(tokens.accessToken)}&refreshToken=${encodeURIComponent(tokens.refreshToken)}&isNewUser=${isNewUser}&lastLoginMethod=${provider}`;
            
            res.redirect(redirectUrl);
        } catch (error: any) {
            loggingService.error('Failed to handle OAuth callback', {
                error: error.message,
                stack: error.stack,
                provider: req.params.provider,
            });

            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
            res.redirect(`${frontendUrl}/login?error=${encodeURIComponent(error.message || 'OAuth authentication failed')}`);
        }
    }

    /**
     * Link OAuth provider to existing account
     * POST /api/auth/oauth/:provider/link
     * Protected route - requires authentication
     */
    static async linkOAuthProvider(req: any, res: Response, _next: NextFunction): Promise<void> {
        try {
            const provider = req.params.provider as 'google' | 'github';
            const userId = req.userId;

            // Validate provider
            if (!['google', 'github'].includes(provider)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid OAuth provider. Supported providers: google, github',
                });
                return;
            }

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            // Generate OAuth URL with userId in state for linking
            const { authUrl } = OAuthService.initiateOAuth(provider, userId);

            loggingService.info(`${provider} OAuth linking initiated`, { provider, userId });

            res.json({
                success: true,
                data: {
                    authUrl,
                    provider,
                },
            });
        } catch (error: any) {
            loggingService.error('Failed to initiate OAuth linking', {
                error: error.message,
                provider: req.params.provider,
                userId: req.userId,
            });

            res.status(500).json({
                success: false,
                message: 'Failed to link OAuth provider',
                error: error.message,
            });
        }
    }

    /**
     * Get linked OAuth providers for current user
     * GET /api/auth/oauth/linked
     * Protected route - requires authentication
     */
    static async getLinkedProviders(req: any, res: Response, _next: NextFunction): Promise<void> {
        try {
            const userId = req.userId;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            const { User } = await import('../models/User');
            const user = await User.findById(userId).select('oauthProviders email');

            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            const linkedProviders = user.oauthProviders.map(provider => ({
                provider: provider.provider,
                email: provider.email,
                linkedAt: provider.linkedAt,
            }));

            res.json({
                success: true,
                data: {
                    providers: linkedProviders,
                    hasPassword: !!user.password,
                },
            });
        } catch (error: any) {
            loggingService.error('Failed to get linked OAuth providers', {
                error: error.message,
                userId: req.userId,
            });

            res.status(500).json({
                success: false,
                message: 'Failed to retrieve linked providers',
                error: error.message,
            });
        }
    }

    /**
     * Unlink OAuth provider from account
     * DELETE /api/auth/oauth/:provider/unlink
     * Protected route - requires authentication
     */
    static async unlinkOAuthProvider(req: any, res: Response, _next: NextFunction): Promise<void> {
        try {
            const provider = req.params.provider as 'google' | 'github';
            const userId = req.userId;

            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            const { User } = await import('../models/User');
            const user = await User.findById(userId);

            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
                return;
            }

            // Check if user has password or other OAuth providers
            const otherProviders = user.oauthProviders.filter(p => p.provider !== provider);
            
            if (!user.password && otherProviders.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'Cannot unlink the only authentication method. Please set a password first.',
                });
                return;
            }

            // Remove OAuth provider
            user.oauthProviders = otherProviders;
            await user.save();

            loggingService.info(`${provider} OAuth provider unlinked`, { provider, userId });

            res.json({
                success: true,
                message: `${provider} account unlinked successfully`,
            });
        } catch (error: any) {
            loggingService.error('Failed to unlink OAuth provider', {
                error: error.message,
                provider: req.params.provider,
                userId: req.userId,
            });

            res.status(500).json({
                success: false,
                message: 'Failed to unlink OAuth provider',
                error: error.message,
            });
        }
    }
}

