import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Header,
} from '@nestjs/common';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ZodPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { SnoozeAlertDto, UpdateAlertSettingsDto } from './dto/alert.dto';
import { AddSecondaryEmailDto, SetPrimaryEmailDto } from './dto/email.dto';
import {
  InitiateAccountClosureDto,
  ConfirmClosureDto,
} from './dto/account-closure.dto';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto/api-key.dto';
import { PresignedAvatarUrlDto } from './dto/avatar.dto';
import {
  updateProfileSchema,
  updatePreferencesSchema,
  addSecondaryEmailSchema,
  setPrimaryEmailSchema,
  initiateAccountClosureSchema,
} from '../../common/validators/user.validators';

@Controller('api/user')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  // Profile endpoints
  @Get('profile')
  async getProfile(@CurrentUser() user: any) {
    const profile = await this.userService.getProfile(user.id);
    const profileObj =
      typeof (profile as any).toObject === 'function'
        ? (profile as any).toObject()
        : { ...profile };
    if (profileObj._id && !profileObj.id) {
      profileObj.id = String(profileObj._id);
    }
    const sanitized = this.userService.sanitizeProfileForResponse(
      profileObj as Record<string, unknown>,
    );
    return {
      success: true,
      message: 'Profile retrieved successfully',
      data: sanitized,
    };
  }

  @Put('profile')
  async updateProfile(
    @CurrentUser() user: any,
    @Body(ZodPipe(updateProfileSchema)) updateData: UpdateProfileDto,
  ) {
    const profile = await this.userService.updateProfile(user.id, updateData);
    const profileObj =
      typeof (profile as any).toObject === 'function'
        ? (profile as any).toObject()
        : { ...profile };
    if (profileObj._id && !profileObj.id) {
      profileObj.id = String(profileObj._id);
    }
    const sanitized = this.userService.sanitizeProfileForResponse(
      profileObj as Record<string, unknown>,
    );
    return {
      success: true,
      message: 'Profile updated successfully',
      data: sanitized,
    };
  }

  // Stats endpoint
  @Get('stats')
  async getStats(@CurrentUser() user: any) {
    const stats = await this.userService.getStats(user.id);
    return {
      success: true,
      message: 'User stats retrieved successfully',
      data: stats,
    };
  }

  // Activities endpoint
  @Get('activities')
  async getActivities(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('type') type?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const data = await this.userService.getActivities(user.id, {
      page,
      limit,
      type,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
    return {
      success: true,
      message: 'User activities retrieved successfully',
      data,
    };
  }

  // Preferences endpoints
  @Get('preferences')
  async getPreferences(@CurrentUser() user: any) {
    return this.userService.getPreferences(user.id);
  }

  @Patch('preferences')
  async updatePreferences(
    @CurrentUser() user: any,
    @Body() preferences: UpdatePreferencesDto,
  ) {
    return this.userService.updatePreferences(user.id, preferences);
  }

  // Email management endpoints
  @Get('emails')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  async getEmails(@CurrentUser() user: any) {
    return this.userService.getEmails(user.id);
  }

  @Post('emails/secondary')
  @HttpCode(HttpStatus.CREATED)
  async addSecondaryEmail(
    @CurrentUser() user: any,
    @Body(ZodPipe(addSecondaryEmailSchema)) emailData: AddSecondaryEmailDto,
  ) {
    return this.userService.addSecondaryEmail(user.id, emailData);
  }

  @Delete('emails/secondary/:email')
  async removeSecondaryEmail(
    @CurrentUser() user: any,
    @Param('email') email: string,
  ) {
    return this.userService.removeSecondaryEmail(user.id, email);
  }

  @Put('emails/primary')
  async setPrimaryEmail(
    @CurrentUser() user: any,
    @Body(ZodPipe(setPrimaryEmailSchema)) emailData: SetPrimaryEmailDto,
  ) {
    return this.userService.setPrimaryEmail(user.id, emailData);
  }

  @Post('emails/:email/resend-verification')
  async resendVerificationEmail(
    @CurrentUser() user: any,
    @Param('email') email: string,
  ) {
    return this.userService.resendVerificationEmail(user.id, email);
  }

  // Alert management endpoints
  @Get('alerts')
  async getAlerts(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.userService.getAlerts(user.id, { page, limit });
  }

  @Put('alerts/read-all')
  async markAllAlertsRead(@CurrentUser() user: any) {
    return this.userService.markAllAlertsRead(user.id);
  }

  @Put('alerts/:id/read')
  async markAlertRead(@CurrentUser() user: any, @Param('id') alertId: string) {
    return this.userService.markAlertRead(user.id, alertId);
  }

  @Delete('alerts/:id')
  async deleteAlert(@CurrentUser() user: any, @Param('id') alertId: string) {
    return this.userService.deleteAlert(user.id, alertId);
  }

  @Get('alerts/settings')
  async getAlertSettings(@CurrentUser() user: any) {
    return this.userService.getAlertSettings(user.id);
  }

  @Put('alerts/settings')
  async updateAlertSettings(
    @CurrentUser() user: any,
    @Body() settings: UpdateAlertSettingsDto,
  ) {
    return this.userService.updateAlertSettings(user.id, settings);
  }

  @Post('alerts/test')
  @HttpCode(HttpStatus.CREATED)
  async testAlert(@CurrentUser() user: any) {
    return this.userService.testAlert(user.id);
  }

  @Get('alerts/unread-count')
  async getUnreadAlertCount(@CurrentUser() user: any) {
    return this.userService.getUnreadAlertCount(user.id);
  }

  @Put('alerts/:id/snooze')
  async snoozeAlert(
    @CurrentUser() user: any,
    @Param('id') alertId: string,
    @Body() snoozeData: SnoozeAlertDto,
  ) {
    return this.userService.snoozeAlert(user.id, alertId, snoozeData);
  }

  @Get('alerts/history')
  async getAlertHistory(
    @CurrentUser() user: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const options: any = { page, limit };
    if (startDate) options.startDate = new Date(startDate);
    if (endDate) options.endDate = new Date(endDate);

    return this.userService.getAlertHistory(user.id, options);
  }

  // Account closure endpoints
  @Post('account/closure/initiate')
  @HttpCode(HttpStatus.CREATED)
  async initiateAccountClosure(
    @CurrentUser() user: any,
    @Body(ZodPipe(initiateAccountClosureSchema))
    closureData: InitiateAccountClosureDto,
  ) {
    return this.userService.initiateAccountClosure(user.id, closureData);
  }

  @Post('account/closure/confirm/:token')
  async confirmAccountClosure(@Param('token') token: string) {
    return this.userService.confirmAccountClosure(token);
  }

  @Post('account/closure/cancel')
  async cancelAccountClosure(@CurrentUser() user: any) {
    return this.userService.cancelAccountClosure(user.id);
  }

  @Get('account/closure/status')
  async getAccountClosureStatus(@CurrentUser() user: any) {
    return this.userService.getAccountClosureStatus(user.id);
  }

  @Post('account/reactivate')
  async reactivateAccount(@CurrentUser() user: any) {
    return this.userService.reactivateAccount(user.id);
  }

  // Dashboard API Key routes
  @Get('dashboard-api-keys')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  async getDashboardApiKeys(@CurrentUser() user: any) {
    return this.userService.getDashboardApiKeys(user.id);
  }

  @Post('dashboard-api-keys')
  @HttpCode(HttpStatus.CREATED)
  async createDashboardApiKey(
    @CurrentUser() user: any,
    @Body() createData: CreateApiKeyDto,
  ) {
    const result = await this.userService.createDashboardApiKey(
      user.id,
      createData,
    );
    return {
      success: true,
      message: 'Dashboard API key created successfully',
      data: result,
    };
  }

  @Put('dashboard-api-keys/:keyId')
  async updateDashboardApiKey(
    @CurrentUser() user: any,
    @Param('keyId') keyId: string,
    @Body() updateData: UpdateApiKeyDto,
  ) {
    const result = await this.userService.updateDashboardApiKey(
      user.id,
      keyId,
      updateData,
    );
    return {
      success: true,
      message: 'Dashboard API key updated successfully',
      data: result,
    };
  }

  @Delete('dashboard-api-keys/:keyId')
  async deleteDashboardApiKey(
    @CurrentUser() user: any,
    @Param('keyId') keyId: string,
  ) {
    const result = await this.userService.deleteDashboardApiKey(user.id, keyId);
    return {
      success: true,
      message: 'Dashboard API key deleted successfully',
      data: result,
    };
  }

  // Avatar upload route
  @Post('profile/avatar-upload-url')
  async getPresignedAvatarUrl(
    @CurrentUser() user: any,
    @Body() avatarData: PresignedAvatarUrlDto,
  ) {
    const result = await this.userService.getPresignedAvatarUrl(
      user.id,
      avatarData,
    );
    return {
      success: true,
      data: result,
    };
  }
}
