import {
  Controller,
  Get,
  Delete,
  Post,
  Param,
  Body,
  Res,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { UserSessionService } from './user-session.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ConfigService } from '@nestjs/config';

interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  jti?: string;
  userSessionId?: string;
}

@Controller('api/auth')
@UseGuards(JwtAuthGuard)
export class UserSessionController {
  private readonly logger = new Logger(UserSessionController.name);

  constructor(
    private readonly userSessionService: UserSessionService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Get all active user sessions
   */
  @Get('user-sessions')
  async getActiveUserSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const startTime = Date.now();
    const userId = user.id;
    const currentUserSessionId = user.jti ?? user.userSessionId;

    try {
      const sessions = await this.userSessionService.getActiveUserSessions(
        userId,
        currentUserSessionId,
      );

      this.logger.log(`Retrieved ${sessions.length} active sessions for user`, {
        userId,
        sessionCount: sessions.length,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: sessions,
      };
    } catch (error) {
      this.logger.error('Failed to get active user sessions', {
        userId,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Revoke a specific user session
   */
  @Delete('user-sessions/:userSessionId')
  async revokeUserSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userSessionId') userSessionId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const startTime = Date.now();
    const userId = user.id;
    const currentUserSessionId = user.jti ?? user.userSessionId;

    try {
      // Prevent revoking current session
      if (userSessionId === currentUserSessionId) {
        throw new BadRequestException('Cannot revoke current session');
      }

      await this.userSessionService.revokeUserSession(userId, userSessionId);

      this.logger.log('User session revoked successfully', {
        userId,
        userSessionId,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Session revoked successfully',
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error('Failed to revoke user session', {
        userId,
        userSessionId,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Revoke all other user sessions except current
   */
  @Delete('user-sessions/others')
  async revokeAllOtherUserSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const startTime = Date.now();
    const userId = user.id;
    const currentUserSessionId = user.jti ?? user.userSessionId;

    try {
      if (!currentUserSessionId) {
        throw new BadRequestException('Current session not found');
      }

      const revokedCount =
        await this.userSessionService.revokeAllOtherUserSessions(
          userId,
          currentUserSessionId,
        );

      this.logger.log('All other user sessions revoked successfully', {
        userId,
        currentUserSessionId,
        revokedCount,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: `${revokedCount} session(s) revoked successfully`,
        data: { revokedCount },
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error('Failed to revoke all other user sessions', {
        userId,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Revoke user session from email link (public endpoint)
   */
  @Post('user-sessions/revoke/:userSessionId/:revokeToken')
  async revokeUserSessionFromEmail(
    @Param('userSessionId') userSessionId: string,
    @Param('revokeToken') revokeToken: string,
    @Res() response: Response,
  ) {
    const startTime = Date.now();

    try {
      if (!revokeToken || !userSessionId) {
        throw new BadRequestException(
          'User session ID and revoke token are required',
        );
      }

      const result =
        await this.userSessionService.revokeUserSessionByToken(revokeToken);

      // Verify that the userSessionId matches
      if (result.userSessionId !== userSessionId) {
        throw new BadRequestException('Invalid user session ID');
      }

      this.logger.log('User session revoked via email token successfully', {
        userId: result.userId,
        userSessionId: result.userSessionId,
        duration: Date.now() - startTime,
      });

      // Redirect to frontend with success message
      const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
      response.redirect(`${frontendUrl}/settings/security?sessionRevoked=true`);
    } catch (error) {
      const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');

      if (error instanceof BadRequestException) {
        this.logger.warn('Invalid revoke token attempt', {
          userSessionId,
          error: error.message,
          duration: Date.now() - startTime,
        });
        response.redirect(
          `${frontendUrl}/settings/security?sessionRevoked=false&error=invalid_token`,
        );
        return;
      }

      this.logger.error('Failed to revoke user session from email', {
        userSessionId,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });
      response.redirect(
        `${frontendUrl}/settings/security?sessionRevoked=false&error=server_error`,
      );
    }
  }
}
