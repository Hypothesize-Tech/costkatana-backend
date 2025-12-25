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

            // Log callback attempt immediately
            loggingService.info('OAuth callback received', {
                provider,
                hasCode: !!code,
                hasState: !!state,
                hasError: !!oauthError,
                error: oauthError,
                errorDescription: error_description,
                path: req.path,
                query: Object.keys(req.query),
            });

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
            // Express automatically URL-decodes query parameters, but base64 uses + and / which might get corrupted
            // We need to handle this carefully - get the raw state from the URL if possible
            let decodedState: any = null;
            let stateForValidation: string = state as string; // This will be passed to handleOAuthCallback
            
            try {
                const stateString = state as string;
                
                loggingService.info('Decoding OAuth state', { 
                    provider,
                    stateLength: stateString.length,
                    statePrefix: stateString.substring(0, 30),
                    stateHasPlus: stateString.includes('+'),
                    stateHasPercent: stateString.includes('%'),
                    stateHasSpace: stateString.includes(' '),
                });
                
                // Express URL-decodes query params, but base64 + becomes space, / becomes something else
                // Try to get raw state from URL if possible, otherwise fix the state
                let stateToDecode = stateString;
                
                // If state contains spaces, they might be decoded + signs from base64
                // Base64 uses + and / which URL encoding converts to %2B and %2F
                // But Express decodes %2B to +, so that should be fine
                // However, if + was in the original base64 and got URL-encoded as %2B, Express decodes it back to +
                // So the state should be correct as-is from Express
                
                // Check if state looks URL-encoded (contains %XX patterns that weren't decoded)
                if (stateString.includes('%')) {
                    try {
                        stateToDecode = decodeURIComponent(stateString);
                        stateForValidation = stateToDecode; // Use decoded version for validation
                        loggingService.info('State was URL-encoded, decoded it', { 
                            provider,
                            originalLength: stateString.length,
                            decodedLength: stateToDecode.length,
                        });
                    } catch (decodeError: any) {
                        // If decode fails, use original (might already be decoded)
                        loggingService.warn('Failed to URL-decode state, using as-is', { 
                            provider,
                            error: decodeError.message,
                        });
                        stateToDecode = stateString;
                        stateForValidation = stateString;
                    }
                } else {
                    // State doesn't have % signs, so Express already decoded it
                    // But if it has spaces, they might be corrupted + signs
                    if (stateString.includes(' ')) {
                        // Replace spaces with + (base64 uses + not space)
                        stateToDecode = stateString.replace(/ /g, '+');
                        stateForValidation = stateToDecode;
                        loggingService.info('State contains spaces, replaced with +', { 
                            provider,
                            originalLength: stateString.length,
                            fixedLength: stateToDecode.length,
                        });
                    } else {
                        stateToDecode = stateString;
                        stateForValidation = stateString;
                    }
                }
                
                // Base64-decode the state
                decodedState = JSON.parse(Buffer.from(stateToDecode, 'base64').toString());
                
                loggingService.info('OAuth state decoded successfully', { 
                    provider,
                    hasNonce: !!decodedState.nonce,
                    hasTimestamp: !!decodedState.timestamp,
                    hasProvider: !!decodedState.provider,
                    noncePrefix: decodedState.nonce?.substring(0, 8),
                    timestamp: decodedState.timestamp,
                    providerMatch: decodedState.provider === provider,
                });
            } catch (error: any) {
                loggingService.error('Failed to decode OAuth state', { 
                    error: error.message,
                    errorStack: error.stack,
                    provider,
                    stateLength: (state as string)?.length,
                    statePrefix: (state as string)?.substring(0, 50),
                    stateSuffix: (state as string)?.substring(Math.max(0, (state as string)?.length - 20)),
                });
                res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('Invalid OAuth state. Please try again.')}`);
                return;
            }

            // Validate timestamp (10 minute expiration)
            const stateAge = Date.now() - (decodedState.timestamp || 0);
            if (stateAge > 10 * 60 * 1000) {
                loggingService.warn('OAuth state expired', { 
                    provider,
                    stateAge: `${Math.floor(stateAge / 1000)}s`,
                });
                res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('OAuth state expired. Please try again.')}`);
                return;
            }

            // Validate provider
            if (decodedState.provider !== provider) {
                loggingService.warn('OAuth provider mismatch', { 
                    expectedProvider: provider,
                    receivedProvider: decodedState.provider,
                });
                res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('Invalid OAuth provider. Please try again.')}`);
                return;
            }

            // Try to verify state was stored (CSRF protection)
            // Tries: Redis/in-memory cache -> Session -> Continue anyway (state is self-contained)
            // Use the original state (URL-encoded) for the cache key, but decodedStateString for comparison
            const stateKey = `oauth:state:${state}`;
            let storedState: any = null;
            
            // Try RedisService.get() first (handles Redis + in-memory automatically)
            try {
                storedState = await redisService.get(stateKey);
                if (storedState) {
                    // Delete state after reading (one-time use)
                    await redisService.del(stateKey);
                    loggingService.info('OAuth state retrieved from cache', { 
                        provider, 
                        stateKey,
                        storedStateType: typeof storedState,
                        hasStateField: !!(storedState as any)?.state,
                    });
                } else {
                    loggingService.warn('OAuth state not found in cache', { 
                        provider,
                        stateKey,
                    });
                }
            } catch (error: any) {
                loggingService.warn('Failed to get OAuth state from cache', { 
                    error: error.message,
                    errorStack: error.stack,
                    provider 
                });
            }
            
            // Fallback to session if cache didn't have it
            if (!storedState && req.session?.oauthState) {
                storedState = req.session.oauthState;
                if (req.session) {
                    delete req.session.oauthState;
                }
                loggingService.info('OAuth state retrieved from session fallback', { 
                    provider,
                    storedStateType: typeof storedState,
                });
            }
            
            // If state was stored, verify it matches (additional CSRF protection)
            if (storedState) {
                // The storedState is an object with { state, provider, timestamp, userId }
                // where state is the base64-encoded string. We need to decode it to get the nonce.
                let storedStateDecoded: any = null;
                try {
                    // storedState.state contains the base64-encoded state string (not URL-encoded)
                    if (storedState.state && typeof storedState.state === 'string') {
                        // The stored state is already base64-encoded, no URL decoding needed
                        storedStateDecoded = JSON.parse(Buffer.from(storedState.state, 'base64').toString());
                    } else if (typeof storedState === 'string') {
                        // Fallback: if storedState itself is a string, try to decode it
                        // First try URL-decode, then base64-decode
                        try {
                            const urlDecoded = decodeURIComponent(storedState);
                            storedStateDecoded = JSON.parse(Buffer.from(urlDecoded, 'base64').toString());
                        } catch {
                            // If URL decode fails, try direct base64 decode
                            storedStateDecoded = JSON.parse(Buffer.from(storedState, 'base64').toString());
                        }
                    } else {
                        // If storedState is already decoded, use it directly
                        storedStateDecoded = storedState;
                    }
                } catch (error: any) {
                    loggingService.warn('Failed to decode stored OAuth state', { 
                        error: error.message,
                    provider,
                        storedStateType: typeof storedState,
                        hasStateField: !!(storedState as any)?.state,
                });
                    // Continue anyway - the state is already validated from the query param
                }

                // Verify nonce matches (CSRF protection)
                if (storedStateDecoded && storedStateDecoded.nonce && decodedState.nonce) {
                    if (storedStateDecoded.nonce !== decodedState.nonce) {
                        loggingService.warn('OAuth state nonce mismatch', { 
                    provider, 
                            storedNonce: storedStateDecoded.nonce?.substring(0, 8),
                            receivedNonce: decodedState.nonce?.substring(0, 8),
                });
                res.redirect(`${frontendUrl}/login?error=${encodeURIComponent('Invalid OAuth state. Please try again.')}`);
                return;
            }
                    loggingService.info('OAuth state nonce verified successfully', { provider });
                }
            } else {
                // State not found in cache/session, but state is self-contained and validated
                // This can happen if Redis is down or state expired from cache but not from timestamp
                // Log warning but continue if timestamp is valid
                loggingService.warn('OAuth state not found in cache/session, but state is self-validated', { 
                    provider,
                    stateKey,
                    hasSession: !!req.session,
                });
            }

            // Handle OAuth callback
            // Pass the stateForValidation we prepared (handles URL decoding and space-to-plus conversion)
            loggingService.info('Calling handleOAuthCallback', { 
                provider,
                stateLength: stateForValidation.length,
                statePrefix: stateForValidation.substring(0, 20),
            });
            
            let user: any;
            let isNewUser: boolean;
            let oauthAccessToken: string | undefined;
            let googleTokenResponse: any;
            
            try {
                const result = await OAuthService.handleOAuthCallback(
                    provider,
                    code as string,
                    stateForValidation
                );
                user = result.user;
                isNewUser = result.isNewUser;
                oauthAccessToken = result.accessToken;
                googleTokenResponse = result.googleTokenResponse;
            } catch (oauthError: any) {
                // If OAuth callback fails, this is a critical error - user cannot be authenticated
                loggingService.error('OAuth callback failed', {
                    error: oauthError.message,
                    stack: oauthError.stack,
                    provider,
                });
                throw oauthError; // Re-throw to be caught by outer catch block
            }

            // Get the actual User document to update
            const { User } = await import('../models/User');
            const userDoc = await User.findById((user as any)._id);
            
            if (!userDoc) {
                loggingService.error('User not found after OAuth callback', {
                    provider,
                    userId: (user as any)?._id,
                });
                throw new Error('User not found after OAuth callback');
            }

            // Update last login method (only for login, not for linking)
            // Check if this is a linking flow by checking if userId was in decodedState
            // We already decoded the state earlier, so use decodedState instead of re-validating
            const isLinkingFlow = !!decodedState.userId;
            
            // Use the correct userId - for linking flows, use decodedState.userId; for login flows, use userDoc._id
            // Both should be the same, but using decodedState.userId for linking ensures consistency
            const targetUserId = isLinkingFlow && decodedState.userId 
                ? decodedState.userId 
                : (userDoc as any)._id.toString();
            
                if (!isLinkingFlow) {
                    // This is a login flow, update lastLoginMethod
                    userDoc.lastLoginMethod = provider;
                    await userDoc.save();
            } else {
                loggingService.info(`${provider} OAuth linking flow detected`, {
                    provider,
                    userId: decodedState.userId,
                    currentUserId: (userDoc as any)._id.toString(),
                    targetUserId,
                });
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
                        userId: targetUserId,
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
                        
                        loggingService.info(`GitHub OAuth connection updated during ${isLinkingFlow ? 'linking' : 'login'}`, {
                            userId: targetUserId,
                            githubUsername: githubUser.login,
                            isLinkingFlow,
                        });
                    } else {
                        // Create new connection
                        connection = await GitHubConnection.create({
                            userId: targetUserId,
                            accessToken: oauthAccessToken,
                            tokenType: 'oauth',
                            githubUserId: githubUser.id,
                            githubUsername: githubUser.login,
                            avatarUrl: githubUser.avatar_url,
                            isActive: true,
                            repositories: [],
                            lastSyncedAt: new Date()
                        });
                        
                        loggingService.info(`GitHub OAuth connection created during ${isLinkingFlow ? 'linking' : 'login'}`, {
                            userId: targetUserId,
                            githubUsername: githubUser.login,
                            isLinkingFlow,
                        });
                    }
                    
                    // Fetch and sync repositories
                    try {
                        const repositories = await GitHubService.listUserRepositories(connection);
                        connection.repositories = repositories;
                        connection.lastSyncedAt = new Date();
                        await connection.save();
                        
                        loggingService.info(`GitHub repositories synced during ${isLinkingFlow ? 'linking' : 'login'}`, {
                            userId: targetUserId,
                            repositoriesCount: repositories.length,
                            isLinkingFlow,
                        });
                    } catch (repoError: any) {
                        // Log but don't fail the login if repo sync fails
                        loggingService.warn(`Failed to sync GitHub repositories during ${isLinkingFlow ? 'linking' : 'login'}`, {
                            userId: targetUserId,
                            error: repoError.message,
                            isLinkingFlow,
                        });
                    }
                    
                    // Create/update Integration record to mark GitHub as integrated
                    try {
                        const { Integration } = await import('../models/Integration');
                        const existingIntegration = await Integration.findOne({
                            userId: targetUserId,
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
                                connectedVia: isLinkingFlow ? 'oauth_linking' : 'oauth_login',
                                lastSynced: new Date(),
                            };
                            await existingIntegration.save();
                            
                            loggingService.info(`GitHub integration updated during ${isLinkingFlow ? 'linking' : 'login'}`, {
                                userId: targetUserId,
                                integrationId: existingIntegration._id,
                                isLinkingFlow,
                            });
                        } else {
                            // Create new integration
                            const integration = new Integration({
                                userId: targetUserId,
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
                                userId: targetUserId,
                                integrationId: integration._id,
                                isLinkingFlow,
                            });
                        }
                    } catch (integrationError: any) {
                        // Log but don't fail the login if integration creation fails
                        loggingService.warn(`Failed to create GitHub integration during ${isLinkingFlow ? 'linking' : 'login'}`, {
                            userId: targetUserId,
                            error: integrationError.message,
                            isLinkingFlow,
                        });
                    }
                } catch (githubError: any) {
                    // Log but don't fail the login if GitHub connection setup fails
                    loggingService.warn(`Failed to setup GitHub connection during ${isLinkingFlow ? 'linking' : 'login'}`, {
                        userId: targetUserId,
                        error: githubError.message,
                        isLinkingFlow,
                    });
                }
            }

            // For Google OAuth, create/update Google connection and sync Drive files
            // This applies to both login and linking flows
            // IMPORTANT: For login flows, connection setup failures should NOT prevent login/MFA
            // Only fail for linking flows where connection setup is required
            if (provider === 'google' && (oauthAccessToken || googleTokenResponse?.access_token)) {
                // Use oauthAccessToken if available, otherwise extract from googleTokenResponse
                const googleAccessToken = oauthAccessToken || googleTokenResponse?.access_token;
                
                // Only proceed with connection setup if we have a token
                // For login flows, missing token is not fatal - user can still login
                if (!googleAccessToken) {
                    loggingService.warn('No Google access token available for connection setup', {
                        provider,
                        userId: targetUserId,
                        isLinkingFlow,
                        hasOAuthToken: !!oauthAccessToken,
                        hasGoogleTokenResponse: !!googleTokenResponse,
                    });
                    
                    // For linking flows, fail if no token
                    if (isLinkingFlow) {
                        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
                        res.redirect(`${frontendUrl}/integrations?error=${encodeURIComponent('No Google access token available. Please try again.')}`);
                        return;
                    }
                    // For login flows, just skip connection setup and continue to MFA check
                } else {
                    loggingService.info('Starting Google connection setup', {
                        provider,
                        userId: targetUserId,
                        isLinkingFlow,
                        hasOAuthToken: !!oauthAccessToken,
                        hasGoogleTokenResponse: !!googleTokenResponse,
                        hasRefreshToken: !!googleTokenResponse?.refresh_token,
                        hasGoogleAccessToken: !!googleAccessToken,
                    });
                    
                    try {
                        const { GoogleService } = await import('../services/google.service');
                        const { GoogleConnection } = await import('../models/GoogleConnection');
                        
                        loggingService.info('Getting Google user info', {
                            provider,
                            userId: targetUserId,
                        });
                        
                        // Get Google user info
                        loggingService.info('About to call GoogleService.getAuthenticatedUser', {
                            userId: targetUserId,
                            hasAccessToken: !!googleAccessToken,
                            accessTokenLength: googleAccessToken?.length,
                        });
                        
                        const googleUser = await GoogleService.getAuthenticatedUser(googleAccessToken);
                        
                        loggingService.info('Google user info retrieved', {
                            provider,
                            userId: targetUserId,
                            googleUserId: googleUser.id,
                            googleEmail: googleUser.email,
                        });
                        
                        // Check if connection already exists
                        let connection = await GoogleConnection.findOne({
                            userId: targetUserId,
                            googleUserId: googleUser.id
                        }).select('+accessToken +refreshToken');
                        
                        if (connection) {
                            // Update existing connection
                            connection.accessToken = googleAccessToken; // Will be encrypted by pre-save hook
                            if (googleTokenResponse?.refresh_token) {
                                connection.refreshToken = googleTokenResponse.refresh_token; // Will be encrypted by pre-save hook
                            }
                            // Store the granted scopes from OAuth response
                            if (googleTokenResponse?.scope) {
                                connection.scope = googleTokenResponse.scope;
                            }
                            connection.tokenType = 'oauth';
                            connection.isActive = true;
                            connection.healthStatus = 'healthy';
                            connection.lastSyncedAt = new Date();
                            connection.googleEmail = googleUser.email;
                            connection.googleName = googleUser.name;
                            connection.googleAvatar = googleUser.picture;
                            connection.googleDomain = googleUser.hd;
                            await connection.save();
                            
                            loggingService.info(`Google OAuth connection updated during ${isLinkingFlow ? 'linking' : 'login'}`, {
                                userId: targetUserId,
                                googleEmail: googleUser.email,
                                isLinkingFlow,
                            });
                        } else {
                            // Create new connection
                            loggingService.info('Creating new Google connection', {
                                userId: targetUserId,
                                googleUserId: googleUser.id,
                                googleEmail: googleUser.email,
                                hasRefreshToken: !!googleTokenResponse?.refresh_token,
                            });
                            
                            connection = await GoogleConnection.create({
                                userId: targetUserId,
                                accessToken: googleAccessToken,
                                refreshToken: googleTokenResponse?.refresh_token,
                                scope: googleTokenResponse?.scope || '', // Store granted scopes
                                tokenType: 'oauth',
                                googleUserId: googleUser.id,
                                googleEmail: googleUser.email,
                                googleName: googleUser.name,
                                googleAvatar: googleUser.picture,
                                googleDomain: googleUser.hd,
                                isActive: true,
                                healthStatus: 'healthy',
                                driveFiles: [],
                                lastSyncedAt: new Date()
                            });
                            
                            loggingService.info(`Google OAuth connection created during ${isLinkingFlow ? 'linking' : 'login'}`, {
                                userId: targetUserId,
                                connectionId: connection._id,
                                googleEmail: googleUser.email,
                                isLinkingFlow,
                            });
                            
                            // Create or update Integration record with connection metadata
                            try {
                                const { Integration } = await import('../models/Integration');
                                const existingIntegration = await Integration.findOne({
                                    userId: targetUserId,
                                    type: 'google_oauth'
                                });
                                
                                if (existingIntegration) {
                                    // Update metadata with new connectionId
                                    existingIntegration.metadata = {
                                        ...existingIntegration.metadata,
                                        connectionId: connection._id.toString(),
                                        email: googleUser.email,
                                        scopes: (connection as any).scopes || [],
                                        googleUserId: googleUser.id
                                    };
                                    existingIntegration.status = 'active';
                                    await existingIntegration.save();
                                    
                                    loggingService.info('Updated existing Google Integration record', {
                                        userId: targetUserId,
                                        integrationId: existingIntegration._id,
                                        connectionId: connection._id
                                    });
                                } else {
                                    // Create new Integration record
                                    await Integration.create({
                                        userId: targetUserId,
                                        type: 'google_oauth',
                                        name: `Google (${googleUser.email})`,
                                        description: 'Google Workspace integration via OAuth',
                                        status: 'active',
                                        encryptedCredentials: '', // Credentials stored in GoogleConnection
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
                                            averageResponseTime: 0
                                        },
                                        metadata: {
                                            connectionId: connection._id.toString(),
                                            email: googleUser.email,
                                            scopes: (connection as any).scopes || [],
                                            googleUserId: googleUser.id
                                        }
                                    });
                                    
                                    loggingService.info('Created new Google Integration record', {
                                        userId: targetUserId,
                                        connectionId: connection._id
                                    });
                                }
                            } catch (integrationError: any) {
                                loggingService.error('Failed to create/update Google Integration record', {
                                    userId: targetUserId,
                                    connectionId: connection._id,
                                    error: integrationError.message
                                });
                                // Don't fail the entire flow if Integration creation fails
                            }
                        }
                        
                        // Fetch and sync Drive files
                        try {
                            const { files } = await GoogleService.listDriveFiles(connection, { pageSize: 50 });
                            connection.driveFiles = files;
                            connection.lastSyncedAt = new Date();
                            await connection.save();
                            
                            loggingService.info(`Google Drive files synced during ${isLinkingFlow ? 'linking' : 'login'}`, {
                                userId: targetUserId,
                                filesCount: files.length,
                                isLinkingFlow,
                            });
                        } catch (driveError: any) {
                            // Log but don't fail the login if Drive sync fails
                            loggingService.warn(`Failed to sync Google Drive files during ${isLinkingFlow ? 'linking' : 'login'}`, {
                                userId: targetUserId,
                                error: driveError.message,
                                isLinkingFlow,
                            });
                        }
                        
                        // Create/update Integration record to mark Google as integrated
                        try {
                            const { Integration } = await import('../models/Integration');
                            const existingIntegration = await Integration.findOne({
                                userId: targetUserId,
                                type: 'google_oauth',
                            });
                            
                            if (existingIntegration) {
                                existingIntegration.status = 'active';
                                existingIntegration.metadata = {
                                    ...existingIntegration.metadata,
                                    connectionId: connection._id.toString(),
                                    googleEmail: googleUser.email,
                                    googleDomain: googleUser.hd,
                                    driveFilesCount: connection.driveFiles.length,
                                    connectedVia: isLinkingFlow ? 'oauth_linking' : 'oauth_login',
                                    lastSynced: new Date(),
                                };
                                await existingIntegration.save();
                                
                                loggingService.info(`Google integration updated during ${isLinkingFlow ? 'linking' : 'login'}`, {
                                    userId: targetUserId,
                                    integrationId: existingIntegration._id,
                                    isLinkingFlow,
                                });
                            } else {
                                // Create new integration record
                                const integration = new Integration({
                                    userId: targetUserId,
                                    type: 'google_oauth',
                                    name: `Google Workspace - ${googleUser.email}`,
                                    description: 'Google Workspace integration for Drive, Docs, and Sheets',
                                    status: 'active',
                                    encryptedCredentials: '', // Credentials stored in GoogleConnection
                                    metadata: {
                                        connectionId: connection._id.toString(),
                                        googleEmail: googleUser.email,
                                        googleDomain: googleUser.hd,
                                        driveFilesCount: connection.driveFiles.length,
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
                                
                                loggingService.info(`Google integration created during ${isLinkingFlow ? 'linking' : 'login'}`, {
                                    userId: targetUserId,
                                    integrationId: integration._id,
                                    isLinkingFlow,
                                });
                            }
                        } catch (integrationError: any) {
                            // Log but don't fail the login if integration creation fails
                            loggingService.warn(`Failed to create Google integration during ${isLinkingFlow ? 'linking' : 'login'}`, {
                                userId: targetUserId,
                                error: integrationError.message,
                                isLinkingFlow,
                            });
                        }
                    } catch (googleError: any) {
                        // For login flows, connection setup failures should NOT prevent login/MFA
                        // Only fail for linking flows where connection setup is required
                        loggingService.error(`Failed to setup Google connection during ${isLinkingFlow ? 'linking' : 'login'}`, {
                            userId: targetUserId,
                            error: googleError.message,
                            stack: googleError.stack,
                            errorName: googleError.name,
                            errorCode: googleError.code,
                            isLinkingFlow,
                            hasOAuthToken: !!oauthAccessToken,
                            hasGoogleTokenResponse: !!googleTokenResponse,
                            provider,
                        });
                        
                        // For linking flows, we should fail if connection setup fails
                        if (isLinkingFlow) {
                            const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
                            const errorMessage = `Failed to connect google account. ${googleError.message || 'Please try again.'}`;
                            res.redirect(`${frontendUrl}/integrations?error=${encodeURIComponent(errorMessage)}`);
                            return;
                        }
                        // For login flows, continue - connection setup failure should not block login/MFA
                        loggingService.info('Continuing login flow despite Google connection setup failure', {
                            userId: targetUserId,
                            provider,
                        });
                    }
                }
            }

            // Check if MFA is enabled for OAuth users
            // Note: OAuth providers (Google/GitHub) already provide strong 2FA
            // But if user has explicitly enabled MFA in Cost Katana, we should respect it
            // IMPORTANT: Skip MFA check for linking flows (when userId is in state)
            // because the user is already authenticated and just linking a provider
            // IMPORTANT: This check MUST happen after user authentication is successful,
            // regardless of whether Google/GitHub connection setup succeeded or failed.
            // Connection setup failures should NOT prevent MFA check for login flows.
            if (!isLinkingFlow && userDoc.mfa.enabled && userDoc.mfa.methods.length > 0) {
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

            // For linking flows, verify connection was created and redirect to integrations page
            if (isLinkingFlow) {
                // Verify connection was created for Google/GitHub
                let connectionExists = false;
                let connectionError: string | null = null;
                
                if (provider === 'google') {
                    try {
                        const { GoogleConnection } = await import('../models/GoogleConnection');
                        // Check both active and inactive connections to see if one was created but marked inactive
                        const activeConnection = await GoogleConnection.findOne({
                            userId: targetUserId,
                            isActive: true
                        });
                        const inactiveConnection = await GoogleConnection.findOne({
                            userId: targetUserId,
                            isActive: false
                        });
                        
                        connectionExists = !!activeConnection;
                        
                        if (!connectionExists && inactiveConnection) {
                            connectionError = 'Connection was created but is inactive. Please check server logs.';
                            loggingService.warn('Google connection exists but is inactive', {
                                userId: targetUserId,
                                connectionId: inactiveConnection._id,
                                provider,
                            });
                        } else if (!connectionExists) {
                            connectionError = 'No Google connection found in database after OAuth callback.';
                            loggingService.error('Google connection not found after OAuth callback for linking flow', {
                                userId: targetUserId,
                                provider,
                                hasOAuthToken: !!oauthAccessToken,
                                hasGoogleTokenResponse: !!googleTokenResponse,
                            });
                        }
                    } catch (checkError: any) {
                        connectionError = `Failed to verify Google connection: ${checkError.message}`;
                        loggingService.error('Failed to verify Google connection after OAuth callback', {
                            userId: targetUserId,
                            error: checkError.message,
                            stack: checkError.stack,
                            provider,
                        });
                    }
                } else if (provider === 'github') {
                    try {
                        const { GitHubConnection } = await import('../models/GitHubConnection');
                        const connection = await GitHubConnection.findOne({
                            userId: targetUserId,
                            isActive: true
                        });
                        connectionExists = !!connection;
                        
                        if (!connectionExists) {
                            connectionError = 'No GitHub connection found in database after OAuth callback.';
                            loggingService.error('GitHub connection not found after OAuth callback for linking flow', {
                                userId: targetUserId,
                                provider,
                                hasOAuthToken: !!oauthAccessToken,
                            });
                        }
                    } catch (checkError: any) {
                        connectionError = `Failed to verify GitHub connection: ${checkError.message}`;
                        loggingService.error('Failed to verify GitHub connection after OAuth callback', {
                            userId: targetUserId,
                            error: checkError.message,
                            stack: checkError.stack,
                            provider,
                        });
                    }
                }

                if (connectionExists) {
                    loggingService.info(`${provider} OAuth provider linked successfully`, {
                        provider,
                        userId: (userDoc as any)._id,
                        email: userDoc.email,
                    });

                    // Redirect to integrations page with success message
                    const redirectUrl = `${frontendUrl}/integrations?${provider}Connected=true&message=${encodeURIComponent(`${provider} account linked successfully`)}`;
                    
                    res.redirect(redirectUrl);
                    return;
                } else {
                    // Connection creation failed - redirect with error
                    const errorMessage = connectionError || `Failed to connect ${provider} account. Please try again.`;
                    loggingService.error(`${provider} OAuth linking failed - connection not created`, {
                        provider,
                        userId: (userDoc as any)._id,
                        email: userDoc.email,
                        connectionError,
                        hasOAuthToken: !!oauthAccessToken,
                        hasGoogleTokenResponse: !!googleTokenResponse,
                    });

                    const redirectUrl = `${frontendUrl}/integrations?error=${encodeURIComponent(errorMessage)}`;
                    
                    res.redirect(redirectUrl);
                    return;
                }
            }

            // Generate JWT tokens (no MFA required) - only for login flows
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
                    scopes: provider === 'google' ? [
                        'openid',
                        'https://www.googleapis.com/auth/userinfo.email',
                        'https://www.googleapis.com/auth/userinfo.profile',
                        'https://www.googleapis.com/auth/drive.file',
                        'https://www.googleapis.com/auth/documents',
                        'https://www.googleapis.com/auth/spreadsheets',
                        'https://www.googleapis.com/auth/gmail.send',
                        'https://www.googleapis.com/auth/gmail.readonly', // READ emails for billing/invoice data
                        'https://www.googleapis.com/auth/calendar'
                    ] : [
                        'user:email',
                        'repo'
                    ],
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

