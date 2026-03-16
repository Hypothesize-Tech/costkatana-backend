import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Res,
  UseGuards,
  Logger,
  BadRequestException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { UserSessionService } from '../user-session/user-session.service';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  jti?: string;
  userSessionId?: string;
}

@Controller('api/auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly mfaService: MfaService,
    private readonly userSessionService: UserSessionService,
    private readonly businessEventService: BusinessEventLoggingService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Register a new user
   */
  @Post('register')
  @Public()
  async register(
    @Body(ValidationPipe) registerDto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log('User registration initiated', {
        email: registerDto.email,
        name: registerDto.name,
      });

      const { user, tokens } = await this.authService.register(registerDto);

      // Log business event
      await this.businessEventService.logEvent({
        event: 'user_registered',
        category: 'user_management',
        value: Date.now() - startTime,
        metadata: {
          email: registerDto.email,
          name: registerDto.name,
          userId: (user as any)._id?.toString(),
          role: user.role,
        },
      });

      // Set refresh token as httpOnly cookie
      response.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: this.configService.get('NODE_ENV') === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      this.logger.log('User registration completed successfully', {
        email: registerDto.email,
        userId: (user as any)._id?.toString(),
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Registration successful. Please verify your email.',
        data: {
          user: {
            id: (user as any)._id,
            email: user.email,
            name: user.name,
            role: user.role,
          },
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      };
    } catch (error) {
      this.logger.error('User registration failed', {
        email: registerDto.email,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });

      if (error instanceof Error && error.message.includes('already exists')) {
        throw new BadRequestException('User with this email already exists');
      }

      throw error;
    }
  }

  /**
   * Login user
   */
  @Post('login')
  @Public()
  async login(
    @Body(ValidationPipe) loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log('User login initiated', {
        email: loginDto.email,
      });

      // Get device info
      const userAgent = response.req.headers['user-agent'] || 'Unknown';
      const ipAddress =
        response.req.ip || response.req.connection.remoteAddress || 'Unknown';

      const result = await this.authService.login(
        loginDto.email,
        loginDto.password,
        {
          userAgent,
          ipAddress,
        },
      );

      // Check if MFA is required
      if (result.requiresMFA) {
        this.logger.log('Login requires MFA verification', {
          email: loginDto.email,
          userId: (result.user as any)._id?.toString(),
          mfaMethods: result.user.mfa?.methods,
          duration: Date.now() - startTime,
        });

        return {
          success: true,
          message: 'MFA verification required',
          data: {
            requiresMFA: true,
            mfaToken: result.mfaToken,
            userId: (result.user as any)._id,
            availableMethods: result.user.mfa?.methods || [],
          },
        };
      }

      // Complete login (no MFA required)
      const { user, tokens } = result as { user: any; tokens: any };

      // Log business event
      await this.businessEventService.logEvent({
        event: 'user_logged_in',
        category: 'user_management',
        value: Date.now() - startTime,
        metadata: {
          email: loginDto.email,
          userId: user._id?.toString(),
          role: user.role,
          emailVerified: user.emailVerified,
          userAgent,
          ipAddress,
        },
      });

      // Set refresh token as httpOnly cookie
      response.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: this.configService.get('NODE_ENV') === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      this.logger.log('User login completed successfully', {
        email: loginDto.email,
        userId: user._id?.toString(),
        role: user.role,
        emailVerified: user.emailVerified,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
            emailVerified: user.emailVerified,
            subscription: user.subscription,
            preferences: user.preferences,
            usage: user.usage,
            onboarding: user.onboarding,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin,
            avatar: user.avatar,
            company: user.company,
          },
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        },
      };
    } catch (error) {
      this.logger.error('User login failed', {
        email: loginDto.email,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });

      if (error instanceof Error) {
        if (error.message === 'Invalid credentials') {
          throw new UnauthorizedException('Invalid email or password');
        }
        if (error.message === 'Account is deactivated') {
          throw new UnauthorizedException('Your account has been deactivated');
        }
        if (error.message === 'Account has been permanently deleted') {
          throw new UnauthorizedException(
            'Account has been permanently deleted',
          );
        }
      }

      throw error;
    }
  }

  /**
   * Refresh access token
   */
  @Post('refresh')
  @Public()
  async refreshTokens(@Res({ passthrough: true }) response: Response) {
    const startTime = Date.now();
    const refreshToken = response.req.cookies?.refreshToken;

    try {
      this.logger.log('Token refresh initiated', {
        hasRefreshToken: !!refreshToken,
      });

      if (!refreshToken) {
        throw new UnauthorizedException('Refresh token not provided');
      }

      const tokens = await this.authService.refreshTokens(refreshToken);

      // Log business event
      await this.businessEventService.logEvent({
        event: 'tokens_refreshed',
        category: 'user_management',
        value: Date.now() - startTime,
        metadata: {
          hasRefreshToken: true,
        },
      });

      // Set new refresh token
      response.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: this.configService.get('NODE_ENV') === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      this.logger.log('Token refresh completed successfully', {
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        data: {
          accessToken: tokens.accessToken,
        },
      };
    } catch (error) {
      this.logger.error('Token refresh failed', {
        hasRefreshToken: !!refreshToken,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });

      // Clear invalid refresh token
      response.clearCookie('refreshToken');

      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  /**
   * Logout user
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const startTime = Date.now();
    const userId = user.id;
    const userSessionId = user.jti ?? user.userSessionId;

    try {
      this.logger.log('User logout initiated', {
        userId,
        userSessionId,
      });

      // Revoke current user session if sessionId is available
      if (userSessionId) {
        try {
          await this.userSessionService.revokeUserSession(
            userId,
            userSessionId,
          );
        } catch (sessionError) {
          // Don't fail logout if session revocation fails
          this.logger.warn('Error revoking user session on logout', {
            userId,
            userSessionId,
            error:
              sessionError instanceof Error
                ? sessionError.message
                : String(sessionError),
          });
        }
      }

      response.clearCookie('refreshToken');

      // Log business event
      await this.businessEventService.logEvent({
        event: 'user_logged_out',
        category: 'user_management',
        value: Date.now() - startTime,
        metadata: {
          userId,
          userSessionId,
        },
      });

      this.logger.log('User logout completed successfully', {
        userId,
        userSessionId,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Logout successful',
      };
    } catch (error) {
      this.logger.error('User logout failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });

      // Still clear cookie and return success
      response.clearCookie('refreshToken');
      return {
        success: true,
        message: 'Logout successful',
      };
    }
  }

  /**
   * Verify email
   */
  @Get('verify-email/:token')
  @Public()
  async verifyEmail(@Param('token') token: string) {
    const startTime = Date.now();

    try {
      this.logger.log('Email verification initiated', {
        hasToken: !!token,
      });

      if (!token) {
        throw new BadRequestException('Verification token is required');
      }

      await this.authService.verifyEmail(token);

      // Log business event
      await this.businessEventService.logEvent({
        event: 'email_verified',
        category: 'user_management',
        value: Date.now() - startTime,
        metadata: {
          hasToken: true,
        },
      });

      this.logger.log('Email verification completed successfully', {
        hasToken: true,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Email verified successfully',
      };
    } catch (error) {
      this.logger.error('Email verification failed', {
        hasToken: !!token,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException('Invalid or expired verification token');
    }
  }

  /**
   * Forgot password
   */
  @Post('forgot-password')
  @Public()
  async forgotPassword(
    @Body(ValidationPipe) forgotPasswordDto: ForgotPasswordDto,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log('Forgot password request initiated', {
        email: forgotPasswordDto.email,
      });

      if (!forgotPasswordDto.email) {
        throw new BadRequestException('Email is required');
      }

      const resetToken = await this.authService.forgotPassword(
        forgotPasswordDto.email,
      );

      // Log business event
      await this.businessEventService.logEvent({
        event: 'forgot_password_requested',
        category: 'user_management',
        value: Date.now() - startTime,
        metadata: {
          email: forgotPasswordDto.email,
        },
      });

      this.logger.log('Forgot password request completed successfully', {
        email: forgotPasswordDto.email,
        duration: Date.now() - startTime,
      });

      const resetUrl = `${this.configService.get('FRONTEND_URL', 'http://localhost:3000')}/reset-password/${resetToken}`;

      return {
        success: true,
        message: 'Password reset instructions sent to your email',
        ...(this.configService.get('NODE_ENV') === 'development' && {
          resetUrl,
        }),
      };
    } catch (error) {
      // Don't reveal if user exists or not
      this.logger.log('Forgot password request completed (generic response)', {
        email: forgotPasswordDto.email,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message:
          'If an account exists with this email, password reset instructions have been sent',
      };
    }
  }

  /**
   * Reset password
   */
  @Post('reset-password/:token')
  @Public()
  async resetPassword(
    @Param('token') token: string,
    @Body(ValidationPipe) resetPasswordDto: ResetPasswordDto,
  ) {
    const startTime = Date.now();

    try {
      this.logger.log('Password reset initiated', {
        hasToken: !!token,
        hasPassword: !!resetPasswordDto.password,
      });

      if (!token || !resetPasswordDto.password) {
        throw new BadRequestException('Token and password are required');
      }

      if (resetPasswordDto.password.length < 8) {
        throw new BadRequestException('Password must be at least 8 characters');
      }

      await this.authService.resetPassword(token, resetPasswordDto.password);

      // Log business event
      await this.businessEventService.logEvent({
        event: 'password_reset',
        category: 'user_management',
        value: Date.now() - startTime,
        metadata: {
          hasToken: true,
          passwordLength: resetPasswordDto.password.length,
        },
      });

      this.logger.log('Password reset completed successfully', {
        hasToken: true,
        passwordLength: resetPasswordDto.password.length,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Password reset successful',
      };
    } catch (error) {
      this.logger.error('Password reset failed', {
        hasToken: !!token,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException('Invalid or expired reset token');
    }
  }

  /**
   * Change password
   */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(ValidationPipe) changePasswordDto: ChangePasswordDto,
  ) {
    const startTime = Date.now();
    const userId = user.id;

    try {
      this.logger.log('Password change initiated', {
        userId,
        hasOldPassword: !!changePasswordDto.oldPassword,
        hasNewPassword: !!changePasswordDto.newPassword,
      });

      if (!changePasswordDto.oldPassword || !changePasswordDto.newPassword) {
        throw new BadRequestException(
          'Old password and new password are required',
        );
      }

      if (changePasswordDto.newPassword.length < 8) {
        throw new BadRequestException(
          'New password must be at least 8 characters',
        );
      }

      await this.authService.changePassword(
        userId,
        changePasswordDto.oldPassword,
        changePasswordDto.newPassword,
      );

      // Log business event
      await this.businessEventService.logEvent({
        event: 'password_changed',
        category: 'user_management',
        value: Date.now() - startTime,
        metadata: {
          userId,
          newPasswordLength: changePasswordDto.newPassword.length,
        },
      });

      this.logger.log('Password change completed successfully', {
        userId,
        newPasswordLength: changePasswordDto.newPassword.length,
        duration: Date.now() - startTime,
      });

      return {
        success: true,
        message: 'Password changed successfully',
      };
    } catch (error) {
      this.logger.error('Password change failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
      });

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw error;
    }
  }
}
