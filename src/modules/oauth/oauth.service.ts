import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { User } from '../../schemas/user/user.schema';
import { CacheService } from '../../common/cache/cache.service';
import { AuthService } from '../auth/auth.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { WorkspaceService } from '../team/services/workspace.service';
import { GitHubIntegrationService } from './github-integration.service';
import { GoogleIntegrationService } from './google-integration.service';
import { MfaService } from '../auth/mfa.service';

interface OAuthStateData {
  provider: 'google' | 'github';
  userId?: string; // Present for linking flows
  nonce: string;
  timestamp: number;
}

interface OAuthUserInfo {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  provider: 'google' | 'github';
}

interface OAuthCallbackResult {
  user: User;
  isNewUser: boolean;
  accessToken: string;
  refreshToken: string;
  oauthAccessToken?: string;
  googleTokenResponse?: GoogleTokenResponse;
  requiresMFA?: boolean;
  mfaToken?: string;
  availableMethods?: string[];
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private readonly STATE_TTL = 10 * 60; // 10 minutes

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly authService: AuthService,
    private readonly subscriptionService: SubscriptionService,
    private readonly workspaceService: WorkspaceService,
    private readonly githubIntegrationService: GitHubIntegrationService,
    private readonly googleIntegrationService: GoogleIntegrationService,
    private readonly mfaService: MfaService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  /**
   * Initiate OAuth flow
   */
  async initiateOAuth(
    provider: 'google' | 'github',
    userId?: string,
  ): Promise<{ authUrl: string; provider: string }> {
    try {
      const stateData: OAuthStateData = {
        provider,
        nonce: this.generateNonce(),
        timestamp: Date.now(),
      };

      if (userId) {
        stateData.userId = userId; // For linking flows
      }

      // Store state in cache
      const stateKey = `oauth:state:${stateData.nonce}`;
      await this.cacheService.set(stateKey, stateData, this.STATE_TTL);

      // Generate auth URL
      const authUrl = this.buildAuthUrl(provider, stateData.nonce);

      this.logger.debug(
        `OAuth initiated: ${provider}, userId: ${userId || 'anonymous'}`,
      );

      return { authUrl, provider };
    } catch (error) {
      this.logger.error(
        'Error initiating OAuth:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Validate and consume OAuth state
   */
  async validateAndConsumeState(
    state: string,
    provider: 'google' | 'github',
  ): Promise<OAuthStateData> {
    try {
      // Decode and parse state
      const stateData = this.decodeState(state);

      // Validate provider match
      if (stateData.provider !== provider) {
        throw new BadRequestException('Provider mismatch in OAuth state');
      }

      // Validate timestamp (10 minutes max age)
      const age = Date.now() - stateData.timestamp;
      if (age > this.STATE_TTL * 1000) {
        throw new BadRequestException('OAuth state has expired');
      }

      // Retrieve and delete from cache
      const stateKey = `oauth:state:${stateData.nonce}`;
      const cachedStateRaw = await this.cacheService.get(stateKey);

      if (!cachedStateRaw) {
        throw new BadRequestException('OAuth state not found or expired');
      }

      const cachedState = cachedStateRaw as OAuthStateData;

      // Verify nonce matches
      if (cachedState.nonce !== stateData.nonce) {
        throw new BadRequestException('OAuth state nonce mismatch');
      }

      // Consume state (delete from cache)
      await this.cacheService.del(stateKey);

      this.logger.debug(`OAuth state validated and consumed: ${provider}`);
      return cachedState;
    } catch (error) {
      this.logger.error(
        'Error validating OAuth state:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Resolve callback state (handles URL encoding and corruption)
   */
  resolveCallbackState(rawState: string): string {
    try {
      // Handle common URL encoding issues
      let normalizedState = rawState;

      // Replace spaces with + (URL encoding)
      normalizedState = normalizedState.replace(/\s/g, '+');

      // Ensure proper base64 padding
      while (normalizedState.length % 4 !== 0) {
        normalizedState += '=';
      }

      return normalizedState;
    } catch (error) {
      this.logger.error(
        'Error resolving callback state:',
        error instanceof Error ? error.message : String(error),
      );
      throw new BadRequestException('Invalid OAuth state format');
    }
  }

  /**
   * Exchange authorization code for Google tokens
   */
  async exchangeGoogleCode(code: string): Promise<GoogleTokenResponse> {
    try {
      const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
      const clientSecret = this.configService.get<string>(
        'GOOGLE_CLIENT_SECRET',
      );
      const redirectUri = this.configService.get<string>('GOOGLE_REDIRECT_URI');

      if (!clientId || !clientSecret || !redirectUri) {
        throw new Error('Google OAuth configuration missing');
      }

      const response = await firstValueFrom(
        this.httpService.post<GoogleTokenResponse>(
          'https://oauth2.googleapis.com/token',
          {
            client_id: clientId,
            client_secret: clientSecret,
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
          },
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 10000,
          },
        ),
      );

      this.logger.debug('Google token exchange successful');
      return response.data;
    } catch (error) {
      this.logger.error(
        'Error exchanging Google code:',
        error instanceof Error ? error.message : String(error),
      );
      throw new BadRequestException(
        'Failed to exchange Google authorization code',
      );
    }
  }

  /**
   * Exchange authorization code for GitHub token
   */
  async exchangeGitHubCode(code: string): Promise<string> {
    try {
      const clientId = this.configService.get<string>('GITHUB_CLIENT_ID');
      const clientSecret = this.configService.get<string>(
        'GITHUB_CLIENT_SECRET',
      );

      if (!clientId || !clientSecret) {
        throw new Error('GitHub OAuth configuration missing');
      }

      const response = await firstValueFrom(
        this.httpService.post(
          'https://github.com/login/oauth/access_token',
          {
            client_id: clientId,
            client_secret: clientSecret,
            code,
          },
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
            },
            timeout: 10000,
          },
        ),
      );

      if (response.data.error) {
        throw new Error(
          `GitHub OAuth error: ${response.data.error_description}`,
        );
      }

      this.logger.debug('GitHub token exchange successful');
      return response.data.access_token;
    } catch (error) {
      this.logger.error(
        'Error exchanging GitHub code:',
        error instanceof Error ? error.message : String(error),
      );
      throw new BadRequestException(
        'Failed to exchange GitHub authorization code',
      );
    }
  }

  /**
   * Get Google user info
   */
  async getGoogleUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    try {
      const response = await firstValueFrom(
        this.httpService.get('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          timeout: 10000,
        }),
      );

      return {
        id: response.data.id,
        email: response.data.email,
        name: response.data.name,
        avatar: response.data.picture,
        provider: 'google',
      };
    } catch (error) {
      this.logger.error(
        'Error getting Google user info:',
        error instanceof Error ? error.message : String(error),
      );
      throw new BadRequestException('Failed to get Google user information');
    }
  }

  /**
   * Get GitHub user info
   */
  async getGitHubUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    try {
      // Get user info
      const userResponse = await firstValueFrom(
        this.httpService.get('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': 'CostKatana/1.0',
          },
          timeout: 10000,
        }),
      );

      let email = userResponse.data.email;

      // If no email, try to get from emails endpoint
      if (!email) {
        try {
          const emailsResponse = await firstValueFrom(
            this.httpService.get('https://api.github.com/user/emails', {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'User-Agent': 'CostKatana/1.0',
              },
              timeout: 5000,
            }),
          );

          const primaryEmail = emailsResponse.data.find(
            (e: any) => e.primary && e.verified,
          );
          email = primaryEmail?.email;
        } catch (emailError) {
          this.logger.warn(
            'Failed to fetch GitHub emails:',
            emailError instanceof Error
              ? emailError.message
              : String(emailError),
          );
        }
      }

      return {
        id: userResponse.data.id.toString(),
        email,
        name: userResponse.data.name,
        avatar: userResponse.data.avatar_url,
        provider: 'github',
      };
    } catch (error) {
      this.logger.error(
        'Error getting GitHub user info:',
        error instanceof Error ? error.message : String(error),
      );
      throw new BadRequestException('Failed to get GitHub user information');
    }
  }

  /**
   * Find or create OAuth user
   */
  async findOrCreateOAuthUser(
    provider: 'google' | 'github',
    userInfo: OAuthUserInfo,
  ): Promise<{ user: User; isNewUser: boolean }> {
    try {
      // First, check if user already exists with this OAuth provider
      const existingUser = await this.userModel.findOne({
        'oauthProviders.provider': provider,
        'oauthProviders.providerId': userInfo.id,
      });

      if (existingUser) {
        this.logger.debug(`Existing OAuth user found: ${existingUser._id}`);
        return { user: existingUser, isNewUser: false };
      }

      // Check if user exists with same email
      if (userInfo.email) {
        const emailUser = await this.userModel.findOne({
          email: userInfo.email,
        });

        if (emailUser) {
          // Link OAuth provider to existing account
          await this.linkOAuthProvider(
            emailUser._id.toString(),
            provider,
            userInfo,
          );
          this.logger.debug(
            `Linked OAuth provider to existing user: ${emailUser._id}`,
          );
          return { user: emailUser, isNewUser: false };
        }
      }

      // Create new user
      const newUser = await this.createOAuthUser(provider, userInfo);
      this.logger.debug(`Created new OAuth user: ${(newUser as any)._id}`);

      return { user: newUser, isNewUser: true };
    } catch (error) {
      this.logger.error(
        'Error finding or creating OAuth user:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Link OAuth provider to existing user
   */
  async linkOAuthProvider(
    userId: string,
    provider: 'google' | 'github',
    userInfo: OAuthUserInfo,
  ): Promise<void> {
    try {
      // Check if provider is already linked to this user
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new BadRequestException('User not found');
      }

      const existingProvider = user.oauthProviders.find(
        (p) => p.provider === provider && p.providerId === userInfo.id,
      );

      if (existingProvider) {
        throw new ConflictException(`${provider} account already linked`);
      }

      // Check if this OAuth account is linked to another user
      const otherUser = await this.userModel.findOne({
        'oauthProviders.provider': provider,
        'oauthProviders.providerId': userInfo.id,
        _id: { $ne: userId },
      });

      if (otherUser) {
        throw new ConflictException(
          `${provider} account is already linked to another user`,
        );
      }

      // Add provider to user
      user.oauthProviders.push({
        provider,
        providerId: userInfo.id,
        email: userInfo.email,
        name: userInfo.name,
        avatar: userInfo.avatar,
        linkedAt: new Date(),
      });

      await user.save();

      this.logger.debug(`Linked ${provider} provider to user: ${userId}`);
    } catch (error) {
      this.logger.error(
        'Error linking OAuth provider:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Handle OAuth callback
   */
  async handleOAuthCallback(
    provider: 'google' | 'github',
    code: string,
    state: string,
    req: any,
  ): Promise<OAuthCallbackResult> {
    try {
      // 1. Resolve state string
      const normalizedState = this.resolveCallbackState(state);

      // 2. Validate and consume state
      const stateData = await this.validateAndConsumeState(
        normalizedState,
        provider,
      );

      // 3. Exchange code for token
      let accessToken: string;
      let googleTokenResponse: GoogleTokenResponse | undefined;

      if (provider === 'google') {
        googleTokenResponse = await this.exchangeGoogleCode(code);
        accessToken = googleTokenResponse.access_token;
      } else {
        accessToken = await this.exchangeGitHubCode(code);
      }

      // 4. Get user info
      const userInfo =
        provider === 'google'
          ? await this.getGoogleUserInfo(accessToken)
          : await this.getGitHubUserInfo(accessToken);

      // 5. Handle linking vs login flow
      if (stateData.userId) {
        // Linking flow
        await this.linkOAuthProvider(stateData.userId, provider, userInfo);

        // Setup integration
        if (provider === 'github') {
          await this.githubIntegrationService.setupConnection(
            stateData.userId,
            accessToken,
            true,
          );
        } else {
          await this.googleIntegrationService.setupConnection(
            stateData.userId,
            accessToken,
            googleTokenResponse!,
            true,
          );
        }

        const user = await this.userModel.findById(stateData.userId);
        if (!user) {
          throw new BadRequestException('User not found after linking');
        }

        const tokens = await this.authService.generateTokens(user);

        return {
          user,
          isNewUser: false,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          oauthAccessToken: accessToken,
          googleTokenResponse,
        };
      } else {
        // Login flow
        const { user, isNewUser } = await this.findOrCreateOAuthUser(
          provider,
          userInfo,
        );

        // Generate JWT tokens
        const tokens = await this.authService.generateTokens(user);

        // Check MFA requirements
        const deviceId = this.generateDeviceId(req);
        const userId = (user as any)._id.toString();

        // Setup integration for new users or first-time OAuth login
        if (provider === 'github') {
          await this.githubIntegrationService.setupConnection(
            userId,
            accessToken,
            false,
          );
        } else {
          await this.googleIntegrationService.setupConnection(
            userId,
            accessToken,
            googleTokenResponse!,
            false,
          );
        }
        const isTrusted = await this.mfaService.isTrustedDevice(
          userId,
          deviceId,
        );

        if (user.mfa.enabled && !isTrusted) {
          // MFA required
          const mfaToken = this.generateMFAToken();

          // Cache MFA context
          await this.cacheService.set(
            `mfa:${mfaToken}`,
            {
              userId,
              deviceId,
              provider,
              oauthAccessToken: accessToken,
              googleTokenResponse,
            },
            15 * 60,
          ); // 15 minutes

          return {
            user,
            isNewUser,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            oauthAccessToken: accessToken,
            googleTokenResponse,
            requiresMFA: true,
            mfaToken,
            availableMethods: user.mfa.methods,
          };
        }

        // Update last login method
        await this.userModel.findByIdAndUpdate(userId, {
          $set: { lastLoginMethod: provider },
        });

        return {
          user,
          isNewUser,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          oauthAccessToken: accessToken,
          googleTokenResponse,
        };
      }
    } catch (error) {
      this.logger.error(
        'Error handling OAuth callback:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Get linked OAuth providers for user
   */
  async getLinkedProviders(
    userId: string,
  ): Promise<Array<{ provider: string; email: string; linkedAt: Date }>> {
    try {
      const user = await this.userModel
        .findById(userId)
        .select('oauthProviders');
      if (!user) {
        throw new BadRequestException('User not found');
      }

      return user.oauthProviders.map((provider) => ({
        provider: provider.provider,
        email: provider.email,
        linkedAt: provider.linkedAt,
      }));
    } catch (error) {
      this.logger.error(
        'Error getting linked providers:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Unlink OAuth provider
   */
  async unlinkOAuthProvider(
    userId: string,
    provider: 'google' | 'github',
  ): Promise<void> {
    try {
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Safety check: must have password or another OAuth provider
      const hasPassword = !!user.password;
      const otherProviders = user.oauthProviders.filter(
        (p) => p.provider !== provider,
      );

      if (!hasPassword && otherProviders.length === 0) {
        throw new BadRequestException(
          'Cannot unlink provider: no alternative login method available',
        );
      }

      // Remove provider
      user.oauthProviders = user.oauthProviders.filter(
        (p) => p.provider !== provider,
      );
      await user.save();

      this.logger.debug(`Unlinked ${provider} provider from user: ${userId}`);
    } catch (error) {
      this.logger.error(
        'Error unlinking OAuth provider:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Generate nonce for OAuth state
   */
  private generateNonce(): string {
    return require('crypto').randomBytes(16).toString('hex');
  }

  /**
   * Decode base64 state to OAuthStateData
   */
  private decodeState(state: string): OAuthStateData {
    try {
      const decoded = Buffer.from(state, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    } catch (error) {
      throw new BadRequestException('Invalid OAuth state encoding');
    }
  }

  /**
   * Build OAuth authorization URL
   */
  private buildAuthUrl(provider: 'google' | 'github', state: string): string {
    const base64State = Buffer.from(
      JSON.stringify({
        provider,
        nonce: state,
        timestamp: Date.now(),
      }),
    ).toString('base64');

    if (provider === 'google') {
      const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
      const redirectUri = this.configService.get<string>('GOOGLE_REDIRECT_URI');

      return (
        `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${encodeURIComponent(clientId!)}&` +
        `redirect_uri=${encodeURIComponent(redirectUri!)}&` +
        `scope=${encodeURIComponent('openid email profile https://www.googleapis.com/auth/drive.file')}&` +
        `response_type=code&` +
        `state=${encodeURIComponent(base64State)}&` +
        `access_type=offline&` +
        `prompt=consent`
      );
    } else {
      const clientId = this.configService.get<string>('GITHUB_CLIENT_ID');
      const redirectUri = this.configService.get<string>('GITHUB_REDIRECT_URI');

      return (
        `https://github.com/login/oauth/authorize?` +
        `client_id=${encodeURIComponent(clientId!)}&` +
        `redirect_uri=${encodeURIComponent(redirectUri!)}&` +
        `scope=${encodeURIComponent('read:user user:email repo')}&` +
        `state=${encodeURIComponent(base64State)}`
      );
    }
  }

  /**
   * Create new OAuth user with full defaults
   */
  private async createOAuthUser(
    provider: 'google' | 'github',
    userInfo: OAuthUserInfo,
  ): Promise<User> {
    const user = new this.userModel({
      email: userInfo.email,
      firstName: userInfo.name?.split(' ')[0] || '',
      lastName: userInfo.name?.split(' ').slice(1).join(' ') || '',
      avatar: userInfo.avatar,
      oauthProviders: [
        {
          provider,
          providerId: userInfo.id,
          email: userInfo.email,
          name: userInfo.name,
          avatar: userInfo.avatar,
          linkedAt: new Date(),
        },
      ],
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
        currentStep: 'welcome',
        steps: {
          welcome: { completed: false, completedAt: null },
          project_creation: { completed: false, completedAt: null },
          project_pricing: { completed: false, completedAt: null },
          llm_query: { completed: false, completedAt: null },
          completion: { completed: false, completedAt: null },
        },
      },
      accountClosure: {
        requested: false,
        requestedAt: null,
        completed: false,
        completedAt: null,
      },
      preferences: {
        theme: 'light',
        notifications: {
          email: true,
          push: true,
        },
        language: 'en',
      },
      usage: {
        totalTokens: 0,
        totalCost: 0,
        lastActivity: new Date(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const savedUser = await user.save();

    // Create default subscription
    await this.subscriptionService.createDefaultSubscription(
      savedUser._id.toString(),
    );

    // Create default workspace
    const userName = (savedUser as any).name || savedUser.email.split('@')[0];
    await this.workspaceService.createDefaultWorkspace(
      savedUser._id.toString(),
      userName,
    );

    return savedUser;
  }

  /**
   * Generate device ID from request
   */
  private generateDeviceId(req: any): string {
    const userAgent = req.headers?.['user-agent'] || '';
    const ipAddress = req.ip || req.connection?.remoteAddress || '';
    return MfaService.generateDeviceId(userAgent, ipAddress);
  }

  /**
   * Update user's last login method
   */
  async updateLastLoginMethod(
    userId: string,
    provider: 'google' | 'github',
  ): Promise<void> {
    try {
      await this.userModel.findByIdAndUpdate(userId, {
        $set: { lastLoginMethod: provider },
      });
    } catch (error) {
      this.logger.error(
        'Error updating last login method:',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Generate MFA token for verification flow
   */
  private generateMFAToken(): string {
    return require('crypto').randomBytes(32).toString('hex');
  }
}
