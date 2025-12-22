import crypto from 'crypto';
import { User, IUser } from '../models/User';
import { loggingService } from './logging.service';

interface OAuthUserInfo {
    providerId: string;
    email: string;
    name: string;
    avatar?: string;
}

interface OAuthState {
    nonce: string;
    timestamp: number;
    userId?: string;
    provider: 'google' | 'github';
}

interface GoogleTokenResponse {
    access_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
    id_token?: string;
    refresh_token?: string;
}

interface GoogleUserInfo {
    id: string;
    email: string;
    verified_email: boolean;
    name: string;
    given_name?: string;
    family_name?: string;
    picture?: string;
    locale?: string;
}

interface GitHubTokenResponse {
    access_token: string;
    token_type: string;
    scope: string;
}

interface GitHubUserInfo {
    id: number;
    login: string;
    name: string | null;
    email: string | null;
    avatar_url: string;
}

interface GitHubEmailInfo {
    email: string;
    primary: boolean;
    verified: boolean;
    visibility: string | null;
}

export class OAuthService {
    /**
     * Initiate OAuth flow by generating authorization URL
     */
    static initiateOAuth(provider: 'google' | 'github', userId?: string): { authUrl: string; state: string } {
        const nonce = crypto.randomBytes(32).toString('hex');
        const timestamp = Date.now();
        const stateData: OAuthState = { nonce, timestamp, provider, ...(userId && { userId }) };
        const state = Buffer.from(JSON.stringify(stateData)).toString('base64');

        let authUrl: string;

        if (provider === 'google') {
            const clientId = process.env.GOOGLE_CLIENT_ID;
            if (!clientId) {
                loggingService.error('GOOGLE_CLIENT_ID is not set in environment variables');
                throw new Error('Google OAuth is not configured. GOOGLE_CLIENT_ID is missing.');
            }
            
            const callbackUrl = process.env.GOOGLE_CALLBACK_URL ?? `${process.env.BACKEND_URL ?? 'http://localhost:8000'}/api/auth/oauth/google/callback`;
            const scopes = 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar';
            
            authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&response_type=code&scope=${encodeURIComponent(scopes)}&state=${state}&access_type=offline&prompt=consent`;
        } else {
            const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
            const callbackUrl = process.env.GITHUB_OAUTH_CALLBACK_URL ?? `${process.env.BACKEND_URL ?? 'http://localhost:8000'}/api/github/callback`;
            // Include repo scope to access repositories
            const scopes = 'read:user user:email repo';
            
            authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(callbackUrl)}&scope=${scopes}&state=${state}`;
        }

        loggingService.info(`${provider} OAuth flow initiated`, { provider, hasUserId: !!userId });

        return { authUrl, state };
    }

    /**
     * Validate OAuth state parameter
     */
    static validateState(state: string, expectedProvider: 'google' | 'github'): OAuthState {
        try {
            const stateData: OAuthState = JSON.parse(Buffer.from(state, 'base64').toString());
            
            // Validate timestamp (10 minute expiration)
            const age = Date.now() - stateData.timestamp;
            if (age > 10 * 60 * 1000) {
                throw new Error('OAuth state expired. Please try again.');
            }

            // Validate provider
            if (stateData.provider !== expectedProvider) {
                throw new Error('OAuth provider mismatch');
            }

            return stateData;
        } catch (error: any) {
            loggingService.error('Failed to validate OAuth state', { error: error.message });
            throw new Error('Invalid OAuth state parameter');
        }
    }

    /**
     * Exchange Google authorization code for access token and refresh token
     */
    static async exchangeGoogleCodeForToken(code: string): Promise<GoogleTokenResponse> {
        try {
            const clientId = process.env.GOOGLE_CLIENT_ID;
            const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
            const callbackUrl = process.env.GOOGLE_CALLBACK_URL || `${process.env.BACKEND_URL || 'http://localhost:8000'}/api/auth/oauth/google/callback`;

            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: new URLSearchParams({
                    code,
                    client_id: clientId!,
                    client_secret: clientSecret!,
                    redirect_uri: callbackUrl,
                    grant_type: 'authorization_code',
                }),
            });

            if (!response.ok) {
                const errorData = await response.text();
                loggingService.error('Failed to exchange Google code for token', { status: response.status, error: errorData });
                throw new Error('Failed to exchange authorization code');
            }

            const data = await response.json() as GoogleTokenResponse;
            
            if (!data.access_token) {
                throw new Error('No access token received from Google');
            }

            loggingService.info('Google OAuth token exchanged successfully', { 
                hasRefreshToken: !!data.refresh_token,
                expiresIn: data.expires_in 
            });
            return data;
        } catch (error: any) {
            loggingService.error('Failed to exchange Google code', { error: error.message });
            throw error;
        }
    }

    /**
     * Exchange GitHub authorization code for access token
     */
    static async exchangeGitHubCodeForToken(code: string): Promise<string> {
        try {
            const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
            const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

            const response = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    client_id: clientId,
                    client_secret: clientSecret,
                    code,
                }),
            });

            if (!response.ok) {
                const errorData = await response.text();
                loggingService.error('Failed to exchange GitHub code for token', { status: response.status, error: errorData });
                throw new Error('Failed to exchange authorization code');
            }

            const data = await response.json() as GitHubTokenResponse;
            
            if (!data.access_token) {
                throw new Error('No access token received from GitHub');
            }

            loggingService.info('GitHub OAuth token exchanged successfully');
            return data.access_token;
        } catch (error: any) {
            loggingService.error('Failed to exchange GitHub code', { error: error.message });
            throw error;
        }
    }

    /**
     * Get Google user information
     */
    static async getGoogleUserInfo(accessToken: string): Promise<OAuthUserInfo> {
        try {
            const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                },
            });

            if (!response.ok) {
                throw new Error('Failed to fetch Google user info');
            }

            const data = await response.json() as GoogleUserInfo;

            if (!data.email || !data.verified_email) {
                throw new Error('Email not verified or not available');
            }

            loggingService.info('Retrieved Google user info', { email: data.email });

            return {
                providerId: data.id,
                email: data.email,
                name: data.name || data.email.split('@')[0],
                avatar: data.picture,
            };
        } catch (error: any) {
            loggingService.error('Failed to get Google user info', { error: error.message });
            throw error;
        }
    }

    /**
     * Get GitHub user information
     */
    static async getGitHubUserInfo(accessToken: string): Promise<OAuthUserInfo> {
        try {
            // Get user profile
            const userResponse = await fetch('https://api.github.com/user', {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                },
            });

            if (!userResponse.ok) {
                throw new Error('Failed to fetch GitHub user info');
            }

            const userData = await userResponse.json() as GitHubUserInfo;

            // Get user emails (if primary email is not public)
            let email = userData.email;
            
            if (!email) {
                const emailsResponse = await fetch('https://api.github.com/user/emails', {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Accept': 'application/vnd.github.v3+json',
                    },
                });

                if (emailsResponse.ok) {
                    const emails = await emailsResponse.json() as GitHubEmailInfo[];
                    const primaryEmail = emails.find(e => e.primary && e.verified);
                    email = primaryEmail?.email || emails.find(e => e.verified)?.email || null;
                }
            }

            if (!email) {
                throw new Error('No verified email found in GitHub account');
            }

            loggingService.info('Retrieved GitHub user info', { email, login: userData.login });

            return {
                providerId: userData.id.toString(),
                email,
                name: userData.name || userData.login,
                avatar: userData.avatar_url,
            };
        } catch (error: any) {
            loggingService.error('Failed to get GitHub user info', { error: error.message });
            throw error;
        }
    }

    /**
     * Find or create user from OAuth provider
     */
    static async findOrCreateOAuthUser(provider: 'google' | 'github', userInfo: OAuthUserInfo): Promise<IUser> {
        try {
            // Check if user exists with this OAuth provider
            let user = await User.findOne({
                'oauthProviders.provider': provider,
                'oauthProviders.providerId': userInfo.providerId,
            });

            if (user) {
                loggingService.info('Found existing OAuth user', { provider, email: userInfo.email });
                
                // Ensure user has a subscription (for existing users created before subscription requirement)
                if (!user.subscriptionId) {
                    loggingService.info('Existing OAuth user missing subscription, creating default subscription', { 
                        userId: (user as any)._id.toString(),
                        email: userInfo.email 
                    });
                    
                    const { SubscriptionService } = await import('./subscription.service');
                    const subscription = await SubscriptionService.createDefaultSubscription((user as any)._id);
                    
                    user.subscriptionId = subscription._id as any;
                    await user.save();
                    
                    loggingService.info('Created default subscription for existing OAuth user', { 
                        userId: (user as any)._id.toString(),
                        subscriptionId: subscription._id 
                    });
                }
                
                // Update avatar if provided and different (OAuth providers may update avatars)
                if (userInfo.avatar && userInfo.avatar !== user.avatar) {
                    user.avatar = userInfo.avatar;
                    loggingService.info('Updated avatar for existing OAuth user', { 
                        userId: (user as any)._id.toString(),
                        provider 
                    });
                }
                
                // Update last login
                user.lastLogin = new Date();
                await user.save();
                
                return user;
            }

            // Check if user exists with this email
            user = await User.findOne({ email: userInfo.email });

            if (user) {
                // Link OAuth provider to existing account
                loggingService.info('Linking OAuth provider to existing account', { provider, email: userInfo.email });
                
                // Ensure user has a subscription (for existing users created before subscription requirement)
                if (!user.subscriptionId) {
                    loggingService.info('User missing subscription when linking OAuth, creating default subscription', { 
                        userId: (user as any)._id.toString(),
                        email: userInfo.email 
                    });
                    
                    const { SubscriptionService } = await import('./subscription.service');
                    const subscription = await SubscriptionService.createDefaultSubscription((user as any)._id);
                    
                    user.subscriptionId = subscription._id as any;
                    
                    loggingService.info('Created default subscription when linking OAuth', { 
                        userId: (user as any)._id.toString(),
                        subscriptionId: subscription._id 
                    });
                }
                
                user.oauthProviders.push({
                    provider,
                    providerId: userInfo.providerId,
                    email: userInfo.email,
                    linkedAt: new Date(),
                });
                
                user.lastLogin = new Date();
                user.emailVerified = true; // Email verified by OAuth provider
                
                if (userInfo.avatar && !user.avatar) {
                    user.avatar = userInfo.avatar;
                }
                
                await user.save();
                return user;
            }

            // Create new user
            loggingService.info('Creating new OAuth user', { provider, email: userInfo.email });
            
            user = new User({
                email: userInfo.email,
                name: userInfo.name,
                avatar: userInfo.avatar,
                role: 'user',
                emailVerified: true, // Email verified by OAuth provider
                isActive: true,
                lastLogin: new Date(),
                oauthProviders: [{
                    provider,
                    providerId: userInfo.providerId,
                    email: userInfo.email,
                    linkedAt: new Date(),
                }],
                preferences: {
                    emailAlerts: true,
                    alertThreshold: 100,
                    optimizationSuggestions: true,
                },
                usage: {
                    currentMonth: {
                        apiCalls: 0,
                        totalCost: 0,
                        totalTokens: 0,
                        optimizationsSaved: 0,
                    },
                },
                mfa: {
                    enabled: false,
                    methods: [],
                    email: {
                        enabled: false,
                        attempts: 0,
                    },
                    totp: {
                        enabled: false,
                        backupCodes: [],
                    },
                    trustedDevices: [],
                },
                onboarding: {
                    completed: false,
                    projectCreated: false,
                    firstLlmCall: false,
                    stepsCompleted: [],
                },
                accountClosure: {
                    status: 'active',
                    confirmationStatus: {
                        passwordConfirmed: false,
                        emailConfirmed: false,
                        cooldownCompleted: false,
                    },
                    reactivationCount: 0,
                },
            });

            await user.save();

            // Create default free subscription for new OAuth user
            const { SubscriptionService } = await import('./subscription.service');
            const subscription = await SubscriptionService.createDefaultSubscription((user as any)._id);
            
            // Update user with subscriptionId
            user.subscriptionId = subscription._id as any;
            await user.save();

            // Create default workspace for the OAuth user
            const { WorkspaceService } = await import('./workspace.service');
            const workspace = await WorkspaceService.createDefaultWorkspace(
                (user as any)._id.toString(),
                user.name
            );

            // Update user with workspace (primary workspace)
            user.workspaceId = workspace._id;
            user.workspaceMemberships = [{
                workspaceId: workspace._id,
                role: 'owner', // Workspace role (different from User.role which is 'user')
                joinedAt: new Date(),
            }];
            await user.save();

            // Create owner team member record
            const { TeamMember } = await import('../models/TeamMember');
            await TeamMember.create({
                userId: (user as any)._id,
                workspaceId: workspace._id,
                email: user.email,
                role: 'owner',
                status: 'active',
                joinedAt: new Date(),
            });
            
            loggingService.info('New OAuth user created successfully with workspace and subscription', { 
                provider, 
                email: userInfo.email,
                userId: (user as any)._id,
                workspaceId: workspace._id,
                subscriptionId: subscription._id,
            });
            
            return user;
        } catch (error: any) {
            loggingService.error('Failed to find or create OAuth user', { error: error.message, provider });
            throw error;
        }
    }

    /**
     * Link OAuth provider to existing user account
     */
    static async linkOAuthProvider(userId: string, provider: 'google' | 'github', userInfo: OAuthUserInfo): Promise<IUser> {
        try {
            const user = await User.findById(userId);
            
            if (!user) {
                throw new Error('User not found');
            }

            // Check if this OAuth account is already linked to another user
            const existingOAuthUser = await User.findOne({
                _id: { $ne: userId },
                'oauthProviders.provider': provider,
                'oauthProviders.providerId': userInfo.providerId,
            });

            if (existingOAuthUser) {
                throw new Error(`This ${provider} account is already linked to another account`);
            }

            // Check if provider is already linked to this user
            const alreadyLinked = user.oauthProviders.some(
                p => p.provider === provider && p.providerId === userInfo.providerId
            );

            if (alreadyLinked) {
                loggingService.info('OAuth provider already linked', { provider, userId });
                return user;
            }

            // Add OAuth provider
            user.oauthProviders.push({
                provider,
                providerId: userInfo.providerId,
                email: userInfo.email,
                linkedAt: new Date(),
            });

            await user.save();
            
            loggingService.info('OAuth provider linked successfully', { provider, userId, email: userInfo.email });
            
            return user;
        } catch (error: any) {
            loggingService.error('Failed to link OAuth provider', { error: error.message, provider, userId });
            throw error;
        }
    }

    /**
     * Handle OAuth callback
     */
    static async handleOAuthCallback(
        provider: 'google' | 'github',
        code: string,
        state: string
    ): Promise<{ user: IUser; isNewUser: boolean; accessToken?: string; googleTokenResponse?: GoogleTokenResponse; githubTokenResponse?: any }> {
        try {
            // Validate state
            const stateData = this.validateState(state, provider);

            // Exchange code for token
            let accessToken: string;
            let googleTokenResponse: GoogleTokenResponse | undefined = undefined;
            let githubTokenResponse: any = undefined;
            if (provider === 'google') {
                googleTokenResponse = await this.exchangeGoogleCodeForToken(code);
                accessToken = googleTokenResponse.access_token;
            } else {
                // For GitHub, get the full token response
                const callbackUrl = process.env.GITHUB_OAUTH_CALLBACK_URL ?? `${process.env.BACKEND_URL ?? 'http://localhost:8000'}/api/github/callback`;
                const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
                const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;

                const response = await fetch('https://github.com/login/oauth/access_token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                    },
                    body: JSON.stringify({
                        client_id: clientId,
                        client_secret: clientSecret,
                        code,
                        redirect_uri: callbackUrl, // Use callbackUrl explicitly
                    }),
                });

                if (!response.ok) {
                    const errorData = await response.text();
                    loggingService.error('Failed to exchange GitHub code for token', { status: response.status, error: errorData });
                    throw new Error('Failed to exchange authorization code');
                }

                githubTokenResponse = await response.json() as GitHubTokenResponse;
                
                if (!(githubTokenResponse as GitHubTokenResponse).access_token) {
                    throw new Error('No access token received from GitHub');
                }
                
                accessToken = (githubTokenResponse as GitHubTokenResponse).access_token;
                loggingService.info('GitHub OAuth token exchanged successfully');
            }

            // Get user info
            let userInfo: OAuthUserInfo;
            if (provider === 'google') {
                userInfo = await this.getGoogleUserInfo(accessToken);
            } else {
                userInfo = await this.getGitHubUserInfo(accessToken);
            }

            // Check if this is a linking flow (userId in state)
            if (stateData.userId) {
                const user = await this.linkOAuthProvider(stateData.userId, provider, userInfo);
                return { 
                    user, 
                    isNewUser: false, 
                    accessToken, // Always return access token for linking flows
                    googleTokenResponse: provider === 'google' ? googleTokenResponse : undefined,
                    githubTokenResponse 
                };
            }

            // Find or create user
            const existingUser = await User.findOne({
                'oauthProviders.provider': provider,
                'oauthProviders.providerId': userInfo.providerId,
            });

            const isNewUser = !existingUser;
            const user = await this.findOrCreateOAuthUser(provider, userInfo);

            return { 
                user, 
                isNewUser, 
                accessToken: provider === 'github' ? accessToken : undefined, 
                googleTokenResponse: provider === 'google' ? googleTokenResponse : undefined,
                githubTokenResponse 
            };
        } catch (error: any) {
            loggingService.error('Failed to handle OAuth callback', { error: error?.message, provider });
            throw error;
        }
    }
}

