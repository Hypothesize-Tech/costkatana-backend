import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Res,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { MfaService } from './mfa.service';
import { AuthService } from './auth.service';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthMfaTokenGuard } from './guards/auth-mfa-token.guard';
import { MfaRateLimitGuard } from './guards/mfa-rate-limit.guard';
import { MfaRateLimit } from './decorators/mfa-rate-limit.decorator';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '@/schemas/user/user.schema';

// Import DTOs
import { SetupTOTPDto } from './dto/setup-totp.dto';
import { VerifyTOTPDto } from './dto/verify-totp.dto';
import { VerifyEmailCodeDto } from './dto/verify-email-code.dto';
import { VerifyMFADto } from './dto/verify-mfa.dto';
import { DisableMFADto } from './dto/disable-mfa.dto';
import { AddTrustedDeviceDto } from './dto/add-trusted-device.dto';
import { RemoveTrustedDeviceDto } from './dto/remove-trusted-device.dto';

// Device ID memoization per request
const deviceIdCache = new Map<string, string>();

@Controller('api/mfa')
@UseGuards(JwtAuthGuard, MfaRateLimitGuard)
export class MfaController {
  constructor(
    private readonly mfaService: MfaService,
    private readonly authService: AuthService,
    private readonly businessEventLoggingService: BusinessEventLoggingService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  /**
   * Get MFA status for the current user
   * GET /api/mfa/status
   */
  @Get('status')
  @HttpCode(HttpStatus.OK)
  async getStatus(@CurrentUser() user: { id: string; _id: string }) {
    const startTime = Date.now();

    const status = await this.mfaService.getMFAStatus(user.id);

    // Log business event
    this.businessEventLoggingService.logBusiness({
      event: 'mfa_status_retrieved',
      category: 'mfa_operations',
      value: Date.now() - startTime,
      metadata: {
        userId: user.id,
        hasStatus: !!status,
      },
    });

    return {
      success: true,
      data: status,
    };
  }

  /**
   * Setup TOTP (Time-based One-Time Password) for authenticator apps
   * POST /api/mfa/totp/setup
   */
  @Post('totp/setup')
  @HttpCode(HttpStatus.OK)
  @MfaRateLimit({ windowMs: 900000, max: 10 }) // Standard: 10 req / 15 min
  async setupTOTP(
    @CurrentUser() user: { id: string; _id: string },
    @Body() dto: SetupTOTPDto,
  ) {
    const startTime = Date.now();

    const result = await this.mfaService.setupTOTP(user.id, dto.email);

    // Log business event
    this.businessEventLoggingService.logBusiness({
      event: 'totp_setup_completed',
      category: 'mfa_operations',
      value: Date.now() - startTime,
      metadata: {
        userId: user.id,
        email: dto.email,
        hasQrCodeUrl: !!result.qrCodeUrl,
        hasBackupCodes: !!result.backupCodes,
      },
    });

    return {
      success: true,
      message:
        'TOTP setup initiated. Scan the QR code with your authenticator app.',
      data: {
        qrCodeUrl: result.qrCodeUrl,
        backupCodes: result.backupCodes,
      },
    };
  }

  /**
   * Verify TOTP token and enable TOTP MFA
   * POST /api/mfa/totp/verify
   */
  @Post('totp/verify')
  @HttpCode(HttpStatus.OK)
  @MfaRateLimit({ windowMs: 300000, max: 5 }) // Strict: 5 req / 5 min
  async verifyAndEnableTOTP(
    @CurrentUser() user: { id: string; _id: string },
    @Body() dto: VerifyTOTPDto,
  ) {
    const startTime = Date.now();

    const verified = await this.mfaService.verifyAndEnableTOTP(
      user.id,
      dto.token,
    );

    if (verified) {
      // Log business event
      this.businessEventLoggingService.logBusiness({
        event: 'totp_verified_and_enabled',
        category: 'mfa_operations',
        value: Date.now() - startTime,
        metadata: {
          userId: user.id,
          verified,
        },
      });

      return {
        success: true,
        message: 'TOTP enabled successfully',
      };
    } else {
      throw new BadRequestException('Invalid TOTP token');
    }
  }

  /**
   * Send email MFA code
   * POST /api/mfa/email/send-code
   */
  @Post('email/send-code')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthMfaTokenGuard) // Override class-level guards for dual token auth
  @MfaRateLimit({ windowMs: 900000, max: 10 }) // Standard: 10 req / 15 min
  async sendEmailCode(@Body() req: any) {
    const startTime = Date.now();
    const userId = req.userId!;

    await this.mfaService.sendEmailCode(userId);

    // Log business event
    this.businessEventLoggingService.logBusiness({
      event: 'email_mfa_code_sent',
      category: 'mfa_operations',
      value: Date.now() - startTime,
      metadata: {
        userId,
      },
    });

    return {
      success: true,
      message: 'Verification code sent to your email',
    };
  }

  /**
   * Verify email MFA code and enable email MFA
   * POST /api/mfa/email/verify
   */
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  @MfaRateLimit({ windowMs: 300000, max: 5 }) // Strict: 5 req / 5 min
  async verifyAndEnableEmailMFA(
    @CurrentUser() user: { id: string; _id: string },
    @Body() dto: VerifyEmailCodeDto,
  ) {
    const startTime = Date.now();

    const verified = await this.mfaService.verifyEmailCode(user.id, dto.code);

    if (verified) {
      await this.mfaService.enableEmailMFA(user.id);

      // Log business event
      this.businessEventLoggingService.logBusiness({
        event: 'email_mfa_verified_and_enabled',
        category: 'mfa_operations',
        value: Date.now() - startTime,
        metadata: {
          userId: user.id,
          verified,
        },
      });

      return {
        success: true,
        message: 'Email MFA enabled successfully',
      };
    } else {
      throw new BadRequestException('Invalid or expired verification code');
    }
  }

  /**
   * Verify MFA during login (for both email and TOTP)
   * POST /api/mfa/verify
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Public() // No JWT auth for login MFA verification
  @MfaRateLimit({ windowMs: 300000, max: 5 }) // Strict: 5 req / 5 min
  async verifyMFA(
    @Body() dto: VerifyMFADto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    const startTime = Date.now();
    const { mfaToken, method, code, rememberDevice, deviceName } = dto;

    if (!mfaToken || !method || !code) {
      throw new BadRequestException('Missing required fields');
    }

    // Verify MFA token
    let tokenPayload;
    try {
      tokenPayload = this.authService.verifyMFAToken(mfaToken);
    } catch (error) {
      throw new BadRequestException('Invalid or expired MFA token');
    }

    const userId = tokenPayload.userId;
    let verified = false;

    if (method === 'email') {
      verified = await this.mfaService.verifyEmailCode(userId, code);
    } else if (method === 'totp') {
      verified = await this.mfaService.verifyTOTP(userId, code);
    } else {
      throw new BadRequestException('Invalid MFA method');
    }

    if (verified) {
      // Get device info for session creation
      const { deviceId, userAgent, ipAddress } = this.getDeviceInfo(req);
      const deviceInfo = { userAgent, ipAddress };

      // Get the actual user from database
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Complete the login process
      const { tokens } = await this.authService.completeLogin(user, deviceInfo);

      // Check if user wants to remember device
      let trustedDeviceAdded = false;
      if (rememberDevice === true) {
        const finalDeviceName = deviceName || 'Unknown Device';

        await this.mfaService.addTrustedDevice(userId, {
          deviceId,
          deviceName: finalDeviceName,
          userAgent,
          ipAddress,
        });
        trustedDeviceAdded = true;
      }

      // Set refresh token as httpOnly cookie
      res.cookie('refreshToken', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      });

      const duration = Date.now() - startTime;

      // Log business event
      this.businessEventLoggingService.logBusiness({
        event: 'mfa_verification_completed',
        category: 'mfa_operations',
        value: duration,
        metadata: {
          userId,
          method,
          hasCode: !!code,
          codeLength: code?.length,
          verified,
          hasUser: !!user,
          hasTokens: !!tokens,
          trustedDeviceAdded,
        },
      });

      return {
        success: true,
        message: 'MFA verification successful',
        data: {
          user: {
            id: (user as any)._id,
            email: user.email,
            name: user.name,
            role: user.role,
            emailVerified: user.emailVerified,
            subscriptionId: user.subscriptionId,
          },
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          trustedDevice: rememberDevice === true,
        },
      };
    } else {
      throw new BadRequestException('Invalid verification code');
    }
  }

  /**
   * Disable MFA method
   * POST /api/mfa/disable
   */
  @Post('disable')
  @HttpCode(HttpStatus.OK)
  async disableMFA(
    @CurrentUser() user: { id: string; _id: string },
    @Body() dto: DisableMFADto,
  ) {
    const startTime = Date.now();

    await this.mfaService.disableMFAMethod(user.id, dto.method);

    // Log business event
    this.businessEventLoggingService.logBusiness({
      event: 'mfa_method_disabled',
      category: 'mfa_operations',
      value: Date.now() - startTime,
      metadata: {
        userId: user.id,
        method: dto.method,
      },
    });

    return {
      success: true,
      message: `${dto.method.toUpperCase()} MFA disabled successfully`,
    };
  }

  /**
   * Add trusted device
   * POST /api/mfa/trusted-devices/add
   */
  @Post('trusted-devices/add')
  @HttpCode(HttpStatus.OK)
  async addTrustedDevice(
    @CurrentUser() user: { id: string; _id: string },
    @Body() dto: AddTrustedDeviceDto,
    @Req() req: Request,
  ) {
    const startTime = Date.now();
    const { deviceId, userAgent, ipAddress } = this.getDeviceInfo(req);

    await this.mfaService.addTrustedDevice(user.id, {
      deviceId,
      deviceName: dto.deviceName,
      userAgent,
      ipAddress,
    });

    // Log business event
    this.businessEventLoggingService.logBusiness({
      event: 'trusted_device_added',
      category: 'mfa_operations',
      value: Date.now() - startTime,
      metadata: {
        userId: user.id,
        deviceName: dto.deviceName,
        deviceId,
        hasUserAgent: !!userAgent,
        hasIpAddress: !!ipAddress,
      },
    });

    return {
      success: true,
      message: 'Device added to trusted devices',
      data: {
        deviceId,
        deviceName: dto.deviceName,
      },
    };
  }

  /**
   * Remove trusted device
   * DELETE /api/mfa/trusted-devices/remove
   */
  @Delete('trusted-devices/remove')
  @HttpCode(HttpStatus.OK)
  async removeTrustedDevice(
    @CurrentUser() user: { id: string; _id: string },
    @Body() dto: RemoveTrustedDeviceDto,
  ) {
    const startTime = Date.now();

    await this.mfaService.removeTrustedDevice(user.id, dto.deviceId);

    // Log business event
    this.businessEventLoggingService.logBusiness({
      event: 'trusted_device_removed',
      category: 'mfa_operations',
      value: Date.now() - startTime,
      metadata: {
        userId: user.id,
        deviceId: dto.deviceId,
      },
    });

    return {
      success: true,
      message: 'Device removed from trusted devices',
    };
  }

  /**
   * Check if current device is trusted
   * GET /api/mfa/trusted-devices/check
   */
  @Get('trusted-devices/check')
  @HttpCode(HttpStatus.OK)
  async checkTrustedDevice(
    @CurrentUser() user: { id: string; _id: string },
    @Req() req: Request,
  ) {
    const startTime = Date.now();
    const { deviceId } = this.getDeviceInfo(req);

    const isTrusted = await this.mfaService.isTrustedDevice(user.id, deviceId);

    // Log business event
    this.businessEventLoggingService.logBusiness({
      event: 'trusted_device_check_completed',
      category: 'mfa_operations',
      value: Date.now() - startTime,
      metadata: {
        userId: user.id,
        deviceId,
        isTrusted,
      },
    });

    return {
      success: true,
      data: {
        deviceId,
        isTrusted,
      },
    };
  }

  /**
   * Get device information with memoization
   */
  private getDeviceInfo(req: Request): {
    deviceId: string;
    userAgent: string;
    ipAddress: string;
  } {
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const ipAddress = req.ip || req.connection.remoteAddress || 'Unknown';

    // Create cache key for this request
    const cacheKey = `${userAgent}-${ipAddress}`;

    let deviceId = deviceIdCache.get(cacheKey);
    if (!deviceId) {
      deviceId = MfaService.generateDeviceId(userAgent, ipAddress);
      deviceIdCache.set(cacheKey, deviceId);

      // Clean cache periodically (keep last 100 entries)
      if (deviceIdCache.size > 100) {
        const firstKey = deviceIdCache.keys().next().value;
        deviceIdCache.delete(firstKey);
      }
    }

    return { deviceId: deviceId, userAgent, ipAddress };
  }
}
