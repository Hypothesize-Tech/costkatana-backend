import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { GithubOAuthApiService } from '../services/github-oauth-api.service';
import { GithubConnectionService } from '../services/github-connection.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Controller('api/github')
export class GithubOAuthController {
  private readonly logger = new Logger(GithubOAuthController.name);

  constructor(
    private readonly githubOAuthApiService: GithubOAuthApiService,
    private readonly githubConnectionService: GithubConnectionService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Initiate OAuth authorization flow
   * GET /api/github/auth
   */
  @Get('auth')
  @UseGuards(JwtAuthGuard)
  async initiateOAuth(
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query('redirect_uri') redirectUri?: string,
    @Query('state') state?: string,
  ): Promise<void> {
    try {
      this.logger.log('Initiating GitHub OAuth flow', {
        userId: user.id,
        redirectUri,
        state,
      });

      const clientId = this.configService.get<string>('GITHUB_CLIENT_ID');
      if (!clientId) {
        throw new Error('GitHub OAuth client ID not configured');
      }

      // Generate state parameter for security
      const oauthState = state || this.generateOAuthState(user.id, redirectUri);

      // Store state in cache for verification
      const stateKey = `github:oauth:state:${oauthState}`;
      await this.githubOAuthApiService['cacheService'].set(
        stateKey,
        {
          userId: user.id,
          redirectUri:
            redirectUri ||
            this.configService.get<string>('GITHUB_OAUTH_REDIRECT_URI'),
          timestamp: Date.now(),
        },
        600,
      ); // 10 minutes expiry

      // Build GitHub OAuth URL
      const scopes = ['repo', 'user:email', 'read:org'];
      const githubAuthUrl = `https://github.com/login/oauth/authorize?${new URLSearchParams(
        {
          client_id: clientId,
          redirect_uri:
            this.configService.get<string>('GITHUB_OAUTH_REDIRECT_URI') ||
            `${this.configService.get<string>('BASE_URL')}/api/github/callback`,
          scope: scopes.join(' '),
          state: oauthState,
          allow_signup: 'true',
        },
      ).toString()}`;

      this.logger.log('Redirecting to GitHub OAuth', {
        userId: user.id,
        authUrl: githubAuthUrl,
      });

      // Redirect to GitHub OAuth
      res.redirect(githubAuthUrl);
    } catch (error: any) {
      this.logger.error('Failed to initiate OAuth flow', {
        userId: user.id,
        error: error.message,
        stack: error.stack,
      });

      // Redirect to error page or return error response
      const errorRedirectUri =
        redirectUri || this.configService.get<string>('FRONTEND_URL');
      if (errorRedirectUri) {
        res.redirect(
          `${errorRedirectUri}?error=oauth_failed&message=${encodeURIComponent(error.message)}`,
        );
      } else {
        res.status(500).json({
          error: 'OAuth initialization failed',
          message: error.message,
        });
      }
    }
  }

  /**
   * Initiate GitHub App installation flow
   * GET /api/github/install
   */
  @Get('install')
  @UseGuards(JwtAuthGuard)
  async initiateAppInstallation(
    @CurrentUser() user: any,
    @Res() res: Response,
    @Query('redirect_uri') redirectUri?: string,
    @Query('state') state?: string,
  ): Promise<void> {
    try {
      this.logger.log('Initiating GitHub App installation flow', {
        userId: user.id,
        redirectUri,
        state,
      });

      const appId = this.configService.get<string>('GITHUB_APP_ID');
      if (!appId) {
        throw new Error('GitHub App ID not configured');
      }

      // Generate state parameter for security
      const installState =
        state || this.generateInstallState(user.id, redirectUri);

      // Store state in cache for verification
      const stateKey = `github:install:state:${installState}`;
      await this.githubOAuthApiService['cacheService'].set(
        stateKey,
        {
          userId: user.id,
          redirectUri:
            redirectUri ||
            this.configService.get<string>('GITHUB_INSTALL_REDIRECT_URI'),
          timestamp: Date.now(),
        },
        600,
      ); // 10 minutes expiry

      // Build GitHub App installation URL
      const githubInstallUrl = `https://github.com/apps/${this.configService.get<string>('GITHUB_APP_SLUG') || 'cost-katana'}/installations/new?${new URLSearchParams(
        {
          state: installState,
        },
      ).toString()}`;

      this.logger.log('Redirecting to GitHub App installation', {
        userId: user.id,
        installUrl: githubInstallUrl,
      });

      // Redirect to GitHub App installation
      res.redirect(githubInstallUrl);
    } catch (error: any) {
      this.logger.error('Failed to initiate App installation flow', {
        userId: user.id,
        error: error.message,
        stack: error.stack,
      });

      // Redirect to error page or return error response
      const errorRedirectUri =
        redirectUri || this.configService.get<string>('FRONTEND_URL');
      if (errorRedirectUri) {
        res.redirect(
          `${errorRedirectUri}?error=install_failed&message=${encodeURIComponent(error.message)}`,
        );
      } else {
        res.status(500).json({
          error: 'App installation initialization failed',
          message: error.message,
        });
      }
    }
  }

  /**
   * Handle OAuth callback (public - called by GitHub redirect, JWT may not be sent)
   * GET /api/github/callback
   */
  @Public()
  @Get('callback')
  async handleOAuthCallback(
    @Res() res: Response,
    @Req() req: Request,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('installation_id') installationId?: string,
    @Query('setup_action') setupAction?: string,
  ): Promise<void> {
    try {
      this.logger.log('Handling GitHub OAuth callback', {
        hasCode: !!code,
        hasState: !!state,
        hasInstallationId: !!installationId,
        setupAction,
      });

      // Handle different callback types
      if (installationId && setupAction) {
        // This is a GitHub App installation callback
        await this.handleAppInstallationCallback(
          installationId,
          setupAction,
          state,
          res,
        );
      } else if (code) {
        // This is an OAuth callback
        await this.handleOAuthCodeCallback(code, state, res);
      } else {
        throw new Error('Invalid callback parameters');
      }
    } catch (error: any) {
      this.logger.error('OAuth callback failed', {
        error: error.message,
        stack: error.stack,
        query: req.query,
      });

      // Redirect to error page
      const frontendUrl =
        this.configService.get<string>('FRONTEND_URL') ||
        'http://localhost:3000';
      res.redirect(
        `${frontendUrl}?error=callback_failed&message=${encodeURIComponent(error.message)}`,
      );
    }
  }

  /**
   * Handle OAuth code exchange callback
   */
  /**
   * Handles the OAuth code callback: exchanges code for access token and persists GitHub connection.
   *
   * @param code - OAuth code sent by GitHub
   * @param state - State key to verify and associate the session
   * @param res - Express Response to handle the redirect
   */
  private async handleOAuthCodeCallback(
    code: string,
    state: string | undefined,
    res: Response,
  ): Promise<void> {
    // --- Step 1: Verify state parameter ---
    if (!state) {
      throw new Error('Missing state parameter');
    }

    // --- Step 2: Verify HMAC signature and decode state ---
    const decodedState = this.verifyAndDecodeState(state);
    if (!decodedState) {
      throw new Error('Invalid or expired state parameter');
    }

    // --- Step 3: Verify state type ---
    if (decodedState.type !== 'oauth') {
      throw new Error('Invalid state type for OAuth callback');
    }

    // --- Step 4: Check if state was already used (prevent replay attacks) ---
    const stateKey = `github:oauth:state:${state}`;
    const storedStateRaw =
      await this.githubOAuthApiService['cacheService'].get(stateKey);
    const storedState = storedStateRaw as
      | { userId?: string; redirectUri?: string }
      | undefined;

    if (!storedState) {
      // State not found in cache - this could be a replay attack or expired state
      this.logger.warn(
        'State parameter not found in cache - possible replay attack or expired',
        {
          state: state.substring(0, 10) + '...', // Log partial state for debugging
        },
      );
      throw new Error('State parameter already used or expired');
    }

    // --- Step 5: Verify user ID matches ---
    if (storedState.userId !== decodedState.userId) {
      this.logger.error('State user ID mismatch - possible tampering attempt', {
        decodedUserId: decodedState.userId,
        storedUserId: storedState.userId,
      });
      throw new Error('State parameter verification failed');
    }

    // --- Step 6: Remove the used state from cache for security ---
    await this.githubOAuthApiService['cacheService'].del(stateKey);

    const { userId, redirectUri } = decodedState;

    this.logger.log('Processing OAuth code exchange', {
      userId,
      codeLength: code.length,
    });

    // --- Step 4: Exchange code for access token ---
    let tokenResponse: {
      access_token: string;
      scope?: string;
      token_type?: string;
    };
    try {
      tokenResponse =
        await this.githubOAuthApiService.exchangeCodeForToken(code);
    } catch (exchangeErr: any) {
      this.logger.error('GitHub token exchange failed', {
        error: exchangeErr.message,
        stack: exchangeErr.stack,
      });
      throw new Error('GitHub authentication failed during code exchange');
    }

    // --- Step 5: Retrieve authenticated user info from GitHub ---
    let githubUser: { id: number; login: string; [key: string]: any };
    try {
      githubUser = await this.githubOAuthApiService.getAuthenticatedUser(
        tokenResponse.access_token,
      );
    } catch (userinfoErr: any) {
      this.logger.error('GitHub user lookup failed', {
        error: userinfoErr.message,
        stack: userinfoErr.stack,
      });
      throw new Error('Failed to fetch GitHub user');
    }

    // --- Step 6: Persist or update GitHub connection in database ---
    try {
      await this.githubConnectionService.upsertConnection({
        userId,
        githubUserId: githubUser.id,
        githubUsername: githubUser.login,
        accessToken: tokenResponse.access_token,
        scopes: tokenResponse.scope,
      });
    } catch (dbErr: any) {
      this.logger.error('Failed to upsert GitHub connection', {
        error: dbErr.message,
        stack: dbErr.stack,
        userId,
        githubUserId: githubUser.id,
      });
      // Don't throw: safely allow user to proceed for their session
    }

    this.logger.log('OAuth flow completed successfully', {
      userId,
      githubUserId: githubUser.id,
      githubUsername: githubUser.login,
      scopes: tokenResponse.scope,
    });

    // --- Step 7: Redirect to final destination with context ---
    const successRedirectUri =
      redirectUri ||
      this.configService.get<string>('FRONTEND_URL') ||
      'http://localhost:3000';

    // Forward minimal info to frontend for continued onboarding
    const params = new URLSearchParams({
      success: 'oauth_completed',
      user: githubUser.login,
    });

    if (userId) params.append('user_id', userId);
    if (tokenResponse.scope) params.append('scope', tokenResponse.scope);

    res.redirect(`${successRedirectUri}?${params.toString()}`);
  }

  /**
   * Handle GitHub App installation callback
   */
  /**
   * Handles the callback from a GitHub App installation.
   * Completes the installation flow by verifying state, retrieving installation details,
   * persisting the GitHub connection, and redirecting the user.
   */
  private async handleAppInstallationCallback(
    installationId: string,
    setupAction: string,
    state: string | undefined,
    res: Response,
  ): Promise<void> {
    // Step 1: Verify the state parameter (anti-CSRF)
    let decodedState: {
      type: string;
      userId: string;
      timestamp: string;
      redirectUri: string;
      nonce: string;
    } | null = null;
    let storedState: any = null;

    if (state) {
      // First verify HMAC signature
      decodedState = this.verifyAndDecodeState(state);
      if (decodedState && decodedState.type !== 'install') {
        this.logger.warn('Invalid state type for installation callback', {
          expectedType: 'install',
          receivedType: decodedState.type,
        });
        decodedState = null;
      }

      // Then check cache for additional verification
      if (decodedState) {
        const stateKey = `github:install:state:${state}`;
        storedState =
          await this.githubOAuthApiService['cacheService'].get(stateKey);

        if (storedState) {
          // Verify user ID matches
          if (storedState.userId !== decodedState.userId) {
            this.logger.error(
              'Installation state user ID mismatch - possible tampering attempt',
              {
                decodedUserId: decodedState.userId,
                storedUserId: storedState.userId,
              },
            );
            decodedState = null;
            storedState = null;
          } else {
            await this.githubOAuthApiService['cacheService'].del(stateKey);
          }
        } else {
          this.logger.warn(
            'Installation state not found in cache - possible replay attack or expired',
            {
              state: state.substring(0, 10) + '...',
            },
          );
          decodedState = null;
        }
      }
    }

    const userId = decodedState?.userId || storedState?.userId;
    const redirectUri = decodedState?.redirectUri || storedState?.redirectUri;

    this.logger.log('Processing GitHub App installation callback', {
      userId,
      installationId,
      setupAction,
    });

    // Step 2: Get installation details from GitHub
    let installation: any;
    try {
      installation =
        await this.githubOAuthApiService.getInstallation(installationId);
    } catch (err: any) {
      this.logger.error('Failed to fetch GitHub installation details', {
        error: err.message,
        stack: err.stack,
        installationId,
        userId,
      });

      // Redirect to error page
      const errorRedirectUri =
        redirectUri ||
        this.configService.get<string>('FRONTEND_URL') ||
        'http://localhost:3000';
      res.redirect(`${errorRedirectUri}?error=github_install_fetch_failed`);
      return;
    }

    const accountId = installation.account?.id;
    const accountLogin = installation.account?.login;

    // Step 3: Upsert GitHub Installation Connection in DB
    try {
      await this.githubConnectionService.upsertInstallation({
        userId,
        installationId,
        accountId,
        accountLogin,
        setupAction,
      });
    } catch (dbErr: any) {
      this.logger.error('Failed to upsert GitHub App installation in DB', {
        error: dbErr.message,
        stack: dbErr.stack,
        userId,
        installationId,
      });
      // Don't throw: allow user to continue session
    }

    this.logger.log('GitHub App installation completed successfully', {
      userId,
      installationId,
      accountId,
      accountLogin,
      setupAction,
    });

    // Step 4: Redirect to the success page with minimal info for the frontend
    const successRedirectUri =
      redirectUri ||
      this.configService.get<string>('FRONTEND_URL') ||
      'http://localhost:3000';
    const params = new URLSearchParams({
      success: 'install_completed',
    });

    if (accountLogin) params.append('account', accountLogin);
    if (setupAction) params.append('action', setupAction);
    if (userId) params.append('user_id', userId?.toString());

    res.redirect(`${successRedirectUri}?${params.toString()}`);
  }

  /**
   * Generates a secure state parameter for GitHub OAuth to provide CSRF protection and context.
   *
   * The state encodes the userId, current timestamp, redirectUri, and a random nonce,
   * then HMAC-SHA256 signs the data and base64-encodes the result for secure transmission.
   *
   * @param userId - The authenticated user's ID
   * @param redirectUri - The optional client redirect URI
   * @returns HMAC-signed OAuth state parameter string
   */
  private generateOAuthState(userId: string, redirectUri?: string): string {
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex'); // 128-bit random nonce

    // Create the payload data
    const payload = JSON.stringify({
      type: 'oauth',
      userId: userId || '',
      timestamp,
      redirectUri: redirectUri || '',
      nonce,
    });

    // Get HMAC secret from config
    const secret =
      this.configService.get<string>('OAUTH_STATE_SECRET') ||
      this.configService.get<string>('JWT_SECRET') ||
      'default-oauth-secret-change-in-production';

    // Create HMAC signature
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const signature = hmac.digest('hex');

    // Combine payload and signature
    const signedData = JSON.stringify({
      payload: payload,
      signature: signature,
    });

    // Base64 encode for URL safety
    return Buffer.from(signedData)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  /**
   * Verifies the HMAC signature of a state parameter and extracts the original data.
   *
   * @param signedState - The base64-encoded signed state parameter
   * @returns The original state data if signature is valid, null otherwise
   */
  private verifyAndDecodeState(signedState: string): {
    type: string;
    userId: string;
    timestamp: string;
    redirectUri: string;
    nonce: string;
  } | null {
    try {
      // Add back base64 padding if needed
      let base64State = signedState.replace(/-/g, '+').replace(/_/g, '/');

      // Add padding
      while (base64State.length % 4) {
        base64State += '=';
      }

      // Decode and parse
      const signedData = JSON.parse(
        Buffer.from(base64State, 'base64').toString('utf8'),
      );

      if (!signedData.payload || !signedData.signature) {
        this.logger.warn('Invalid state format - missing payload or signature');
        return null;
      }

      // Get HMAC secret from config
      const secret =
        this.configService.get<string>('OAUTH_STATE_SECRET') ||
        this.configService.get<string>('JWT_SECRET') ||
        'default-oauth-secret-change-in-production';

      // Verify HMAC signature
      const hmac = crypto.createHmac('sha256', secret);
      hmac.update(signedData.payload);
      const expectedSignature = hmac.digest('hex');

      if (
        !crypto.timingSafeEqual(
          Buffer.from(expectedSignature, 'hex'),
          Buffer.from(signedData.signature, 'hex'),
        )
      ) {
        this.logger.warn(
          'Invalid state signature - possible tampering attempt',
        );
        return null;
      }

      // Parse the payload
      const payload = JSON.parse(signedData.payload);

      // Validate timestamp (prevent replay attacks - 10 minute window)
      const stateAge = Date.now() - parseInt(payload.timestamp);
      if (stateAge > 10 * 60 * 1000) {
        // 10 minutes
        this.logger.warn('State parameter expired', {
          stateAge: Math.floor(stateAge / 1000) + 's',
        });
        return null;
      }

      return {
        type: payload.type,
        userId: payload.userId,
        timestamp: payload.timestamp,
        redirectUri: payload.redirectUri,
        nonce: payload.nonce,
      };
    } catch (error) {
      this.logger.error('Failed to verify state parameter', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  /**
   * Generates a secure state parameter for GitHub App installation to provide CSRF protection and context.
   *
   * The state encodes the userId, current timestamp, redirectUri, and a random nonce,
   * then HMAC-SHA256 signs the data and base64-encodes the result for secure transmission.
   *
   * @param userId - The authenticated user's ID
   * @param redirectUri - The optional client redirect URI
   * @returns HMAC-signed installation state parameter string
   */
  private generateInstallState(userId: string, redirectUri?: string): string {
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex'); // 128-bit random nonce

    // Create the payload data
    const payload = JSON.stringify({
      type: 'install',
      userId: userId || '',
      timestamp,
      redirectUri: redirectUri || '',
      nonce,
    });

    // Get HMAC secret from config
    const secret =
      this.configService.get<string>('OAUTH_STATE_SECRET') ||
      this.configService.get<string>('JWT_SECRET') ||
      'default-oauth-secret-change-in-production';

    // Create HMAC signature
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const signature = hmac.digest('hex');

    // Combine payload and signature
    const signedData = JSON.stringify({
      payload: payload,
      signature: signature,
    });

    // Base64 encode for URL safety
    return Buffer.from(signedData)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }
}
