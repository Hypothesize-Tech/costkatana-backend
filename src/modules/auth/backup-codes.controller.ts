/**
 * Backup Codes Controller (NestJS)
 *
 * Production API for 2FA backup codes: generate (with password verification),
 * verify password, and get metadata. Path: api/backup-codes.
 * Full parity with Express backupCodes.controller and backupCodes.routes.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BusinessEventLoggingService } from '../../common/services/business-event-logging.service';
import { User } from '../../schemas/user/user.schema';
import { BackupCodesService } from './backup-codes.service';
import { GenerateBackupCodesDto } from './dto/generate-backup-codes.dto';
import { VerifyBackupCodesPasswordDto } from './dto/verify-backup-codes-password.dto';

@Controller('api/backup-codes')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class BackupCodesController {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly backupCodesService: BackupCodesService,
    private readonly businessEventLoggingService: BusinessEventLoggingService,
  ) {}

  /**
   * Generate new backup codes (requires password verification)
   * POST /api/backup-codes/generate
   */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generateBackupCodes(
    @CurrentUser() user: { id: string },
    @Body() dto: GenerateBackupCodesDto,
  ) {
    const startTime = Date.now();
    const userId = user.id;

    const dbUser = await this.userModel.findById(userId).select('password mfa');
    if (!dbUser) {
      throw new NotFoundException('User not found');
    }

    if (!dbUser.password) {
      throw new BadRequestException(
        'Password not set for this account. Please set a password first.',
      );
    }

    const isPasswordValid = await dbUser.comparePassword(dto.password);
    if (!isPasswordValid) {
      this.businessEventLoggingService.logBusiness({
        event: 'backup_codes_generate_failed_invalid_password',
        category: 'security',
        value: Date.now() - startTime,
        metadata: { userId },
      });
      throw new UnauthorizedException('Invalid password');
    }

    const plainCodes = this.backupCodesService.generateBackupCodes();
    const hashedCodes =
      await this.backupCodesService.hashBackupCodes(plainCodes);

    await this.userModel.findByIdAndUpdate(userId, {
      $set: {
        'mfa.totp.backupCodes': hashedCodes,
        'mfa.totp.lastUsed': new Date(),
      },
    });

    const duration = Date.now() - startTime;
    this.businessEventLoggingService.logBusiness({
      event: 'backup_codes_generated',
      category: 'security',
      value: duration,
      metadata: {
        userId,
        codesCount: plainCodes.length,
      },
    });

    return {
      success: true,
      data: {
        codes: plainCodes,
        count: plainCodes.length,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Verify user password (before showing backup code operations)
   * POST /api/backup-codes/verify-password
   */
  @Post('verify-password')
  @HttpCode(HttpStatus.OK)
  async verifyPassword(
    @CurrentUser() user: { id: string },
    @Body() dto: VerifyBackupCodesPasswordDto,
  ) {
    const startTime = Date.now();
    const userId = user.id;

    const dbUser = await this.userModel.findById(userId).select('password');
    if (!dbUser) {
      throw new NotFoundException('User not found');
    }

    if (!dbUser.password) {
      throw new BadRequestException(
        'Password not set for this account. Please set a password first.',
      );
    }

    const isPasswordValid = await dbUser.comparePassword(dto.password);
    if (!isPasswordValid) {
      this.businessEventLoggingService.logBusiness({
        event: 'backup_codes_verify_password_failed',
        category: 'security',
        value: Date.now() - startTime,
        metadata: { userId },
      });
      throw new UnauthorizedException('Invalid password');
    }

    this.businessEventLoggingService.logBusiness({
      event: 'backup_codes_password_verified',
      category: 'security',
      value: Date.now() - startTime,
      metadata: { userId },
    });

    return {
      success: true,
      data: {
        verified: true,
      },
    };
  }

  /**
   * Get backup codes metadata (count, last generated date; not the actual codes)
   * GET /api/backup-codes/metadata
   */
  @Get('metadata')
  @HttpCode(HttpStatus.OK)
  async getBackupCodesMetadata(@CurrentUser() user: { id: string }) {
    const startTime = Date.now();
    const userId = user.id;

    const dbUser = await this.userModel
      .findById(userId)
      .select('mfa.totp.backupCodes mfa.totp.lastUsed');
    if (!dbUser) {
      throw new NotFoundException('User not found');
    }

    const hasBackupCodes =
      Array.isArray(dbUser.mfa?.totp?.backupCodes) &&
      dbUser.mfa.totp.backupCodes.length > 0;
    const codesCount = hasBackupCodes ? dbUser.mfa.totp.backupCodes.length : 0;
    const lastGenerated = dbUser.mfa?.totp?.lastUsed;

    this.businessEventLoggingService.logBusiness({
      event: 'backup_codes_metadata_retrieved',
      category: 'security',
      value: Date.now() - startTime,
      metadata: {
        userId,
        hasBackupCodes,
        codesCount,
      },
    });

    return {
      success: true,
      data: {
        hasBackupCodes,
        codesCount,
        lastGenerated: lastGenerated?.toISOString() ?? null,
      },
    };
  }
}
