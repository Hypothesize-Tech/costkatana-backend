import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  Redirect,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { OAuthService } from './oauth.service';
import { GitHubIntegrationService } from './github-integration.service';
import { GoogleIntegrationService } from './google-integration.service';
import { MfaService } from '../auth/mfa.service';
import { ConfigService } from '@nestjs/config';
import { OAuthCallbackQueryDto } from './dto/oauth-callback-query.dto';
import { Public } from '../../common/decorators/public.decorator';

@Controller('api/auth/oauth')
export class OAuthController {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly githubIntegrationService: GitHubIntegrationService,
    private readonly googleIntegrationService: GoogleIntegrationService,
    private readonly mfaService: MfaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Initiate OAuth flow
   */
  @Get(':provider')
  async initiateOAuth(
    @Param('provider') provider: string,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    if (provider !== 'google' && provider !== 'github') {
      throw new BadRequestException(
        'Invalid provider. Must be google or github',
      );
    }

    const userId = user?.id;
    const result = await this.oauthService.initiateOAuth(provider, userId);

    return {
      authUrl: result.authUrl,
      provider: result.provider,
    };
  }

  /**
   * Handle OAuth callback (public - called by OAuth provider redirect, JWT may not be sent)
   */
  @Public()
  @Get(':provider/callback')
  async handleOAuthCallback(
    @Param('provider') provider: string,
    @Query() query: OAuthCallbackQueryDto,
    @Req() req: any,
    @Res() res: Response,
  ) {
    try {
      // 1. Validate provider
      if (provider !== 'google' && provider !== 'github') {
        return res.redirect(
          `${this.getFrontendUrl()}/login?error=invalid_provider`,
        );
      }

      // 2. Handle error from OAuth provider
      if (query.error) {
        const errorMsg = query.error_description || query.error;
        return res.redirect(
          `${this.getFrontendUrl()}/login?error=${encodeURIComponent(errorMsg)}`,
        );
      }

      // 3. Validate required params
      if (!query.code || !query.state) {
        return res.redirect(
          `${this.getFrontendUrl()}/login?error=missing_code_or_state`,
        );
      }

      // 4-7. Handle OAuth callback through service
      const result = await this.oauthService.handleOAuthCallback(
        provider,
        query.code,
        query.state,
        req,
      );

      // 8. Update last login method for login flows
      if (!result.requiresMFA) {
        await this.oauthService.updateLastLoginMethod(
          (result.user as any)._id.toString(),
          provider,
        );
      }

      // 9-10. Integration setup is handled in OAuthService.handleOAuthCallback

      // 11. MFA check (handled in service, redirect if required)
      if (result.requiresMFA) {
        return res.redirect(
          `${this.getFrontendUrl()}/oauth/callback?` +
            `requiresMFA=true&` +
            `mfaToken=${encodeURIComponent(result.mfaToken!)}&` +
            `userId=${encodeURIComponent((result.user as any)._id.toString())}&` +
            `availableMethods=${encodeURIComponent(result.availableMethods!.join(','))}&` +
            `lastLoginMethod=${encodeURIComponent(provider)}`,
        );
      }

      // 12. Linking flow: redirect to integrations page
      const userId = (result.user as any)._id.toString();
      const isLinkingFlow = await this.isLinkingFlow(userId, provider);
      if (isLinkingFlow) {
        const connectionExists =
          provider === 'github'
            ? await this.githubIntegrationService.verifyConnection(userId)
            : await this.googleIntegrationService.verifyConnection(userId);

        if (connectionExists) {
          return res.redirect(
            `${this.getFrontendUrl()}/integrations?${provider}Connected=true&message=${encodeURIComponent(`${provider} account linked successfully`)}`,
          );
        } else {
          return res.redirect(
            `${this.getFrontendUrl()}/integrations?error=${encodeURIComponent(`Failed to setup ${provider} connection`)}`,
          );
        }
      }

      // 13. Login flow: redirect with tokens
      return res.redirect(
        `${this.getFrontendUrl()}/oauth/callback?` +
          `accessToken=${encodeURIComponent(result.accessToken)}&` +
          `refreshToken=${encodeURIComponent(result.refreshToken)}&` +
          `isNewUser=${result.isNewUser}&` +
          `lastLoginMethod=${encodeURIComponent(provider)}`,
      );
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : 'OAuth callback failed';
      return res.redirect(
        `${this.getFrontendUrl()}/login?error=${encodeURIComponent(errorMsg)}`,
      );
    }
  }

  /**
   * Link OAuth provider
   */
  @Post(':provider/link')
  @UseGuards(JwtAuthGuard)
  async linkOAuthProvider(
    @Param('provider') provider: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (provider !== 'google' && provider !== 'github') {
      throw new BadRequestException(
        'Invalid provider. Must be google or github',
      );
    }

    // Check if already linked
    const linkedProviders = await this.oauthService.getLinkedProviders(user.id);
    const alreadyLinked = linkedProviders.some((p) => p.provider === provider);

    if (alreadyLinked) {
      throw new BadRequestException(`${provider} account already linked`);
    }

    // Initiate OAuth flow for linking
    const result = await this.oauthService.initiateOAuth(provider, user.id);

    return {
      authUrl: result.authUrl,
      provider: result.provider,
      scopes:
        provider === 'google'
          ? [
              'openid',
              'email',
              'profile',
              'https://www.googleapis.com/auth/drive.file',
            ]
          : ['read:user', 'user:email', 'repo'],
    };
  }

  /**
   * Get linked providers
   */
  @Get('linked')
  @UseGuards(JwtAuthGuard)
  async getLinkedProviders(@CurrentUser() user: AuthenticatedUser) {
    return await this.oauthService.getLinkedProviders(user.id);
  }

  /**
   * Unlink OAuth provider
   */
  @Delete(':provider/unlink')
  @UseGuards(JwtAuthGuard)
  async unlinkOAuthProvider(
    @Param('provider') provider: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (provider !== 'google' && provider !== 'github') {
      throw new BadRequestException(
        'Invalid provider. Must be google or github',
      );
    }

    await this.oauthService.unlinkOAuthProvider(user.id, provider);

    return { message: `${provider} account unlinked successfully` };
  }

  // ============================================================================
  // PRIVATE HELPER METHODS
  // ============================================================================

  /**
   * Get frontend URL from config
   */
  private getFrontendUrl(): string {
    return (
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000'
    );
  }

  /**
   * Check if this is a linking flow by checking if user has password/other providers
   */
  private async isLinkingFlow(
    userId: string,
    provider: string,
  ): Promise<boolean> {
    try {
      const linkedProviders =
        await this.oauthService.getLinkedProviders(userId);
      // If user has multiple providers or a password, consider it a linking scenario
      return linkedProviders.length > 1;
    } catch (error) {
      return false;
    }
  }
}
