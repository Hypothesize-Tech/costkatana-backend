import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto/api-key.dto';
import { PresignedAvatarUrlDto } from './dto/avatar.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { User, IOtherEmail } from '../../schemas/user/user.schema';
import { Alert } from '../../schemas/user/alert.schema';
import { Usage } from '../../schemas/core/usage.schema';
import { Optimization } from '../../schemas/core/optimization.schema';
import { SubscriptionService } from '../subscription/subscription.service';
import { ActivityService } from '../activity/activity.service';
import { EmailService } from '../email/email.service';
import { AccountClosureService } from '../account-closure/account-closure.service';
import { AuthService } from '../auth/auth.service';
import { StorageService } from '../storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { SnoozeAlertDto, UpdateAlertSettingsDto } from './dto/alert.dto';
import { AddSecondaryEmailDto, SetPrimaryEmailDto } from './dto/email.dto';
import { InitiateAccountClosureDto } from './dto/account-closure.dto';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Alert.name) private alertModel: Model<Alert>,
    @InjectModel(Usage.name) private usageModel: Model<Usage>,
    @InjectModel(Optimization.name)
    private optimizationModel: Model<Optimization>,
    private subscriptionService: SubscriptionService,
    private activityService: ActivityService,
    private emailService: EmailService,
    private accountClosureService: AccountClosureService,
    private authService: AuthService,
    private storageService: StorageService,
  ) {}

  /**
   * Get user profile
   */
  async getProfile(userId: string): Promise<User> {
    const user = await this.userModel.findById(userId).select('-password');
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  /**
   * Sanitize profile object for API response - strips sensitive fields.
   * Never expose: encryptedKey, TOTP secret, backup codes, reset tokens.
   */
  sanitizeProfileForResponse(
    profileObj: Record<string, unknown>,
  ): Record<string, unknown> {
    const sanitized = { ...profileObj };

    // Top-level sensitive fields
    delete sanitized.resetPasswordToken;
    delete sanitized.resetPasswordExpires;
    delete sanitized.verificationToken;
    delete sanitized.verificationTokenExpires;

    // MFA - strip secret and backup codes
    if (sanitized.mfa && typeof sanitized.mfa === 'object') {
      const mfa = { ...(sanitized.mfa as Record<string, unknown>) };
      if (mfa.totp && typeof mfa.totp === 'object') {
        const totp = { ...(mfa.totp as Record<string, unknown>) };
        delete totp.secret;
        delete totp.backupCodes;
        mfa.totp = totp;
      }
      sanitized.mfa = mfa;
    }

    // Account closure - strip deletion token
    if (
      sanitized.accountClosure &&
      typeof sanitized.accountClosure === 'object'
    ) {
      const ac = { ...(sanitized.accountClosure as Record<string, unknown>) };
      delete ac.deletionToken;
      sanitized.accountClosure = ac;
    }

    // Dashboard API keys - strip encryptedKey
    if (Array.isArray(sanitized.dashboardApiKeys)) {
      sanitized.dashboardApiKeys = sanitized.dashboardApiKeys.map(
        (key: Record<string, unknown>) => {
          const k = { ...key };
          delete k.encryptedKey;
          return k;
        },
      );
    }

    // Legacy apiKeys - strip key value
    if (Array.isArray(sanitized.apiKeys)) {
      sanitized.apiKeys = sanitized.apiKeys.map(
        (key: Record<string, unknown>) => {
          const k = { ...key };
          delete k.key;
          return k;
        },
      );
    }

    return sanitized;
  }

  /**
   * Update user profile
   */
  async updateProfile(
    userId: string,
    updateData: UpdateProfileDto,
  ): Promise<User> {
    const user = await this.userModel
      .findByIdAndUpdate(userId, { $set: updateData }, { new: true })
      .select('-password');

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Track activity
    await this.activityService.trackActivity(userId, {
      type: 'profile_updated',
      title: 'Profile Updated',
      description: 'User profile information was updated',
      metadata: { updatedFields: Object.keys(updateData) },
    });

    this.logger.log('Profile updated', {
      userId,
      updatedFields: Object.keys(updateData),
    });
    return user;
  }

  /**
   * Get user statistics for Profile page (matches frontend ProfileStats shape)
   */
  async getStats(userId: string): Promise<any> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const currentMonthStart = new Date();
    currentMonthStart.setDate(1);
    currentMonthStart.setHours(0, 0, 0, 0);

    const accountAge = Math.floor(
      (Date.now() - (user.createdAt?.getTime() ?? Date.now())) /
        (1000 * 60 * 60 * 24),
    );

    try {
      const [usageResults, optimizationResults] = await Promise.all([
        this.usageModel.aggregate([
          {
            $match: { userId: userObjectId },
          },
          {
            $facet: {
              totalStats: [
                {
                  $group: {
                    _id: null,
                    totalCost: { $sum: '$cost' },
                    totalCalls: { $sum: 1 },
                    totalTokens: { $sum: '$totalTokens' },
                  },
                },
              ],
              currentMonthStats: [
                {
                  $match: {
                    createdAt: { $gte: currentMonthStart },
                  },
                },
                {
                  $group: {
                    _id: null,
                    monthCost: { $sum: '$cost' },
                    monthCalls: { $sum: 1 },
                  },
                },
              ],
              serviceStats: [
                {
                  $group: {
                    _id: '$service',
                    count: { $sum: 1 },
                    cost: { $sum: '$cost' },
                  },
                },
                { $sort: { count: -1 } },
                { $limit: 1 },
              ],
              modelStats: [
                {
                  $group: {
                    _id: '$model',
                    count: { $sum: 1 },
                    cost: { $sum: '$cost' },
                  },
                },
                { $sort: { count: -1 } },
                { $limit: 1 },
              ],
              dailyStats: [
                {
                  $group: {
                    _id: {
                      $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
                    },
                    dailyCost: { $sum: '$cost' },
                  },
                },
                {
                  $group: {
                    _id: null,
                    avgDailyCost: { $avg: '$dailyCost' },
                    activeDays: { $sum: 1 },
                  },
                },
              ],
            },
          },
        ]),
        this.optimizationModel.aggregate([
          {
            $match: { userId: userObjectId },
          },
          {
            $facet: {
              totalOptimizations: [
                {
                  $group: {
                    _id: null,
                    totalOptimizations: { $sum: 1 },
                    totalSaved: { $sum: '$costSaved' },
                  },
                },
              ],
              currentMonthOptStats: [
                {
                  $match: {
                    createdAt: { $gte: currentMonthStart },
                  },
                },
                {
                  $group: {
                    _id: null,
                    monthSaved: { $sum: '$costSaved' },
                  },
                },
              ],
            },
          },
        ]),
      ]);

      const usageFacet = usageResults[0];
      const optFacet = optimizationResults[0];
      const totalStats = usageFacet?.totalStats?.[0];
      const currentMonthStats = usageFacet?.currentMonthStats?.[0];
      const serviceStats = usageFacet?.serviceStats?.[0];
      const modelStats = usageFacet?.modelStats?.[0];
      const dailyStats = usageFacet?.dailyStats?.[0];
      const optimizationStats = optFacet?.totalOptimizations?.[0];
      const currentMonthOptStats = optFacet?.currentMonthOptStats?.[0];

      const totalSpent = totalStats?.totalCost ?? 0;
      const totalSaved = optimizationStats?.totalSaved ?? 0;
      const savingsRate =
        totalSpent > 0 ? (totalSaved / (totalSpent + totalSaved)) * 100 : 0;

      return {
        totalSpent,
        totalSaved,
        apiCalls: totalStats?.totalCalls ?? 0,
        optimizations: optimizationStats?.totalOptimizations ?? 0,
        currentMonthSpent: currentMonthStats?.monthCost ?? 0,
        currentMonthSaved: currentMonthOptStats?.monthSaved ?? 0,
        avgDailyCost: dailyStats?.avgDailyCost ?? 0,
        mostUsedService: serviceStats?._id ?? 'N/A',
        mostUsedModel: modelStats?._id ?? 'N/A',
        accountAge,
        savingsRate: Math.round(savingsRate * 100) / 100,
      };
    } catch (error) {
      this.logger.error('Error getting user stats', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return {
        totalSpent: 0,
        totalSaved: 0,
        apiCalls: 0,
        optimizations: 0,
        currentMonthSpent: 0,
        currentMonthSaved: 0,
        avgDailyCost: 0,
        mostUsedService: 'N/A',
        mostUsedModel: 'N/A',
        accountAge,
        savingsRate: 0,
      };
    }
  }

  /**
   * Get user activities
   */
  async getActivities(
    userId: string,
    options?: { page?: number; limit?: number; type?: string },
  ) {
    return this.activityService.getUserActivities(userId, {
      page: options?.page,
      limit: options?.limit,
      type: options?.type as any,
    });
  }

  /**
   * Get user preferences
   */
  async getPreferences(userId: string): Promise<any> {
    const user = await this.userModel.findById(userId).select('preferences');
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user.preferences || {};
  }

  /**
   * Update user preferences
   */
  async updatePreferences(
    userId: string,
    preferences: UpdatePreferencesDto,
  ): Promise<any> {
    const user = await this.userModel
      .findByIdAndUpdate(userId, { $set: { preferences } }, { new: true })
      .select('preferences');

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Track activity
    await this.activityService.trackActivity(userId, {
      type: 'preferences_updated',
      title: 'Preferences Updated',
      description: 'User preferences were updated',
      metadata: { updatedFields: Object.keys(preferences) },
    });

    this.logger.log('Preferences updated', {
      userId,
      updatedFields: Object.keys(preferences),
    });
    return user.preferences;
  }

  /**
   * Get user emails (Express-compatible response structure)
   */
  async getEmails(userId: string): Promise<{
    success: boolean;
    message: string;
    data: {
      emails: Array<{
        email: string;
        isPrimary: boolean;
        verified: boolean;
        addedAt: Date | string;
      }>;
    };
  }> {
    const user = await this.userModel
      .findById(userId)
      .select('email emailVerified createdAt otherEmails');
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const userDoc = user as {
      emailVerified?: boolean;
      createdAt?: Date;
      otherEmails?: IOtherEmail[];
    };
    const primary = {
      email: user.email,
      isPrimary: true,
      verified: userDoc.emailVerified ?? false,
      addedAt: (userDoc.createdAt ?? new Date()) as Date | string,
    };
    const secondary = (userDoc.otherEmails || []).map((e: IOtherEmail) => ({
      email: e.email,
      isPrimary: false,
      verified: e.verified ?? false,
      addedAt: (e.addedAt ?? new Date()) as Date | string,
    }));
    const emails: Array<{
      email: string;
      isPrimary: boolean;
      verified: boolean;
      addedAt: Date | string;
    }> = [primary, ...secondary];

    return {
      success: true,
      message: 'Emails retrieved successfully',
      data: { emails },
    };
  }

  /**
   * Add secondary email
   */
  async addSecondaryEmail(
    userId: string,
    emailData: AddSecondaryEmailDto,
  ): Promise<any> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if email already exists
    if (
      user.email === emailData.email ||
      (user as any).otherEmails?.some((e: any) => e.email === emailData.email)
    ) {
      throw new BadRequestException('Email already exists');
    }

    const secondaryEmail = {
      email: emailData.email,
      verified: false,
      verificationToken: this.generateVerificationToken(),
      addedAt: new Date(),
    };

    (user as any).otherEmails = (user as any).otherEmails || [];
    (user as any).otherEmails.push(secondaryEmail);

    await user.save();

    // Send verification email
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email/${secondaryEmail.verificationToken}`;
    await (this.emailService as any).sendSecondaryEmailVerification?.(
      emailData.email,
      verificationUrl,
      user.name,
    );

    // Track activity
    await this.activityService.trackActivity(userId, {
      type: 'secondary_email_added',
      title: 'Secondary Email Added',
      description: `Secondary email ${emailData.email} was added`,
      metadata: { email: emailData.email },
    });

    this.logger.log('Secondary email added', {
      userId,
      email: emailData.email,
    });
    return {
      message:
        'Secondary email added successfully. Please check your email for verification.',
    };
  }

  /**
   * Remove secondary email
   */
  async removeSecondaryEmail(userId: string, email: string): Promise<any> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const emailIndex = (user as any).otherEmails?.findIndex(
      (e: any) => e.email === email,
    );
    if (emailIndex === undefined || emailIndex === -1) {
      throw new NotFoundException('Secondary email not found');
    }

    (user as any).otherEmails?.splice(emailIndex, 1);
    await user.save();

    // Track activity
    await this.activityService.trackActivity(userId, {
      type: 'secondary_email_removed',
      title: 'Secondary Email Removed',
      description: `Secondary email ${email} was removed`,
      metadata: { email },
    });

    this.logger.log('Secondary email removed', { userId, email });
    return { message: 'Secondary email removed successfully' };
  }

  /**
   * Set primary email
   */
  async setPrimaryEmail(
    userId: string,
    emailData: SetPrimaryEmailDto,
  ): Promise<any> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if email exists in secondary emails and is verified
    const secondaryEmail = (user as any).otherEmails?.find(
      (e: any) => e.email === emailData.email && e.verified,
    );
    if (!secondaryEmail) {
      throw new BadRequestException('Email not found or not verified');
    }

    // Move current primary to secondary
    if ((user as any).otherEmails) {
      (user as any).otherEmails.push({
        email: user.email,
        verified: true,
        addedAt: new Date(),
      });
    }

    // Set new primary
    user.email = emailData.email;
    (user as any).otherEmails = (user as any).otherEmails?.filter(
      (e: any) => e.email !== emailData.email,
    );

    await user.save();

    // Track activity
    await this.activityService.trackActivity(userId, {
      type: 'primary_email_changed',
      title: 'Primary Email Changed',
      description: `Primary email changed to ${emailData.email}`,
      metadata: { newPrimaryEmail: emailData.email },
    });

    this.logger.log('Primary email changed', {
      userId,
      newPrimaryEmail: emailData.email,
    });
    return { message: 'Primary email updated successfully' };
  }

  /**
   * Resend verification email
   */
  async resendVerificationEmail(userId: string, email: string): Promise<any> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Find the email in secondary emails
    const secondaryEmail = (user as any).otherEmails?.find(
      (e: any) => e.email === email,
    );
    if (!secondaryEmail) {
      throw new NotFoundException('Email not found');
    }

    if (secondaryEmail.verified) {
      throw new BadRequestException('Email is already verified');
    }

    // Generate new verification token
    secondaryEmail.verificationToken = this.generateVerificationToken();

    await user.save();

    // Send verification email
    const verificationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email/${secondaryEmail.verificationToken}`;
    await (this.emailService as any).sendSecondaryEmailVerification?.(
      email,
      verificationUrl,
      user.name,
    );

    this.logger.log('Verification email resent', { userId, email });
    return { message: 'Verification email sent successfully' };
  }

  /**
   * Get user alerts
   */
  async getAlerts(
    userId: string,
    options?: { page?: number; limit?: number },
  ): Promise<any> {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const skip = (page - 1) * limit;

    const alerts = await this.alertModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();

    const total = await this.alertModel.countDocuments({ userId }).exec();

    return {
      alerts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Mark all alerts as read
   */
  async markAllAlertsRead(userId: string): Promise<any> {
    await this.alertModel.updateMany(
      { userId, read: false },
      { $set: { read: true, readAt: new Date() } },
    );

    this.logger.log('All alerts marked as read', { userId });
    return { message: 'All alerts marked as read' };
  }

  /**
   * Mark specific alert as read
   */
  async markAlertRead(userId: string, alertId: string): Promise<any> {
    const alert = await this.alertModel.findOneAndUpdate(
      { _id: alertId, userId },
      { $set: { read: true, readAt: new Date() } },
      { new: true },
    );

    if (!alert) {
      throw new NotFoundException('Alert not found');
    }

    this.logger.log('Alert marked as read', { userId, alertId });
    return { message: 'Alert marked as read' };
  }

  /**
   * Delete alert
   */
  async deleteAlert(userId: string, alertId: string): Promise<any> {
    const alert = await this.alertModel.findOneAndDelete({
      _id: alertId,
      userId,
    });

    if (!alert) {
      throw new NotFoundException('Alert not found');
    }

    this.logger.log('Alert deleted', { userId, alertId });
    return { message: 'Alert deleted successfully' };
  }

  /**
   * Get alert settings
   */
  async getAlertSettings(userId: string): Promise<any> {
    const user = await this.userModel.findById(userId).select('preferences');
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      emailAlerts: user.preferences?.emailAlerts || false,
      alertThreshold: user.preferences?.alertThreshold || 10,
      optimizationSuggestions:
        user.preferences?.optimizationSuggestions || false,
      enableSessionReplay: user.preferences?.enableSessionReplay || false,
      sessionReplayTimeout: user.preferences?.sessionReplayTimeout || 30,
    };
  }

  /**
   * Update alert settings
   */
  async updateAlertSettings(
    userId: string,
    settings: UpdateAlertSettingsDto,
  ): Promise<any> {
    const user = await this.userModel
      .findByIdAndUpdate(
        userId,
        { $set: { preferences: { ...settings } } },
        { new: true },
      )
      .select('preferences');

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Track activity
    await this.activityService.trackActivity(userId, {
      type: 'alert_settings_updated',
      title: 'Alert Settings Updated',
      description: 'User alert settings were updated',
      metadata: settings,
    });

    this.logger.log('Alert settings updated', { userId, settings });
    return user.preferences;
  }

  /**
   * Snooze alert
   */
  async snoozeAlert(
    userId: string,
    alertId: string,
    snoozeData: SnoozeAlertDto,
  ): Promise<any> {
    const snoozeUntil = new Date(snoozeData.snoozeUntil);

    const alert = await this.alertModel.findOneAndUpdate(
      { _id: alertId, userId },
      {
        $set: {
          snoozed: true,
          snoozedUntil: snoozeUntil,
        },
      },
      { new: true },
    );

    if (!alert) {
      throw new NotFoundException('Alert not found');
    }

    this.logger.log('Alert snoozed', {
      userId,
      alertId,
      snoozedUntil: snoozeUntil,
    });
    return { message: 'Alert snoozed successfully' };
  }

  /**
   * Test alert system
   */
  async testAlert(userId: string): Promise<any> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Create a test alert
    const testAlert = new this.alertModel({
      userId,
      type: 'test',
      title: 'Test Alert',
      message:
        'This is a test alert to verify your alert system is working correctly.',
      severity: 'info',
      read: false,
    });

    await testAlert.save();

    // Send test email if email alerts are enabled
    if (user.preferences?.emailAlerts) {
      await this.emailService.sendAlertNotification(user, testAlert);
    }

    this.logger.log('Test alert created', { userId, alertId: testAlert._id });
    return { message: 'Test alert sent successfully' };
  }

  /**
   * Get unread alert count
   */
  async getUnreadAlertCount(userId: string): Promise<{ count: number }> {
    const count = await this.alertModel
      .countDocuments({
        userId,
        read: false,
      })
      .exec();

    return { count };
  }

  /**
   * Get alert history
   */
  async getAlertHistory(
    userId: string,
    options?: {
      page?: number;
      limit?: number;
      startDate?: Date;
      endDate?: Date;
    },
  ): Promise<any> {
    const page = options?.page || 1;
    const limit = options?.limit || 20;
    const skip = (page - 1) * limit;

    const query: any = { userId };
    if (options?.startDate || options?.endDate) {
      query.createdAt = {};
      if (options.startDate) query.createdAt.$gte = options.startDate;
      if (options.endDate) query.createdAt.$lte = options.endDate;
    }

    const alerts = await this.alertModel
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();

    const total = await this.alertModel.countDocuments(query).exec();

    return {
      alerts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Initiate account closure
   */
  async initiateAccountClosure(
    userId: string,
    closureData: InitiateAccountClosureDto,
  ): Promise<any> {
    return this.accountClosureService.initiateAccountClosure(
      userId,
      closureData.password,
      closureData.reason,
    );
  }

  /**
   * Confirm account closure
   */
  async confirmAccountClosure(token: string): Promise<any> {
    return this.accountClosureService.confirmClosureViaEmail(token);
  }

  /**
   * Cancel account closure
   */
  async cancelAccountClosure(userId: string): Promise<any> {
    return this.accountClosureService.cancelAccountClosure(userId);
  }

  /**
   * Get account closure status
   */
  async getAccountClosureStatus(userId: string): Promise<any> {
    return this.accountClosureService.getAccountClosureStatus(userId);
  }

  /**
   * Reactivate account
   */
  async reactivateAccount(userId: string): Promise<any> {
    return this.accountClosureService.reactivateAccount(userId);
  }

  /**
   * Generate verification token
   */
  private generateVerificationToken(): string {
    return require('crypto').randomBytes(32).toString('hex');
  }

  /**
   * Get dashboard API keys for user
   */
  async getDashboardApiKeys(userId: string): Promise<any[]> {
    const user = await this.userModel
      .findById(userId)
      .select('dashboardApiKeys');
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Return only safe information (no encrypted keys)
    // Ensure keyId is string (Mongoose subdocs can behave differently)
    return (
      (user as any).dashboardApiKeys?.map((key: any) => ({
        keyId: String(key?.keyId ?? ''),
        name: key.name,
        maskedKey: key.maskedKey,
        permissions: key.permissions,
        lastUsed: key.lastUsed,
        createdAt: key.createdAt,
        expiresAt: key.expiresAt,
        isExpired: key.expiresAt ? new Date() > key.expiresAt : false,
      })) || []
    );
  }

  /**
   * Create dashboard API key
   */
  async createDashboardApiKey(
    userId: string,
    dto: CreateApiKeyDto,
  ): Promise<any> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check if user already has maximum number of API keys (limit to 10)
    if ((user as any).dashboardApiKeys?.length >= 10) {
      throw new BadRequestException('Maximum number of API keys reached (10)');
    }

    // Check for duplicate names
    const existingKey = (user as any).dashboardApiKeys?.find(
      (k: any) => k.name === dto.name,
    );
    if (existingKey) {
      throw new BadRequestException('API key with this name already exists');
    }

    // Generate new dashboard API key
    const keyResult = await this.authService.generateDashboardApiKey(
      user,
      dto.name,
      dto.permissions,
      dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    );

    // Encrypt the API key for storage
    const { encrypt } = await import('../../utils/helpers.js');
    const { encrypted, iv, authTag } = encrypt(keyResult.apiKey);
    const encryptedKey = `${iv}:${authTag}:${encrypted}`;

    // Add to user's dashboard API keys
    const newApiKey = {
      name: dto.name,
      keyId: keyResult.keyId,
      encryptedKey,
      maskedKey: keyResult.maskedKey,
      permissions: dto.permissions,
      createdAt: new Date(),
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      isActive: true,
    };

    (user as any).dashboardApiKeys = (user as any).dashboardApiKeys || [];
    (user as any).dashboardApiKeys.push(newApiKey);
    await user.save();

    // Track activity
    await this.activityService.trackActivity(userId, {
      type: 'api_key_created',
      title: 'API Key Created',
      description: `Dashboard API key "${dto.name}" was created`,
      metadata: {
        keyId: keyResult.keyId,
        name: dto.name,
        permissions: dto.permissions,
      },
    });

    this.logger.log('Dashboard API key created', {
      userId,
      keyId: keyResult.keyId,
      name: dto.name,
    });

    // Return the actual key only during creation
    return {
      keyId: keyResult.keyId,
      name: dto.name,
      apiKey: keyResult.apiKey, // Only returned once during creation
      maskedKey: keyResult.maskedKey,
      permissions: dto.permissions,
      createdAt: newApiKey.createdAt,
      expiresAt: newApiKey.expiresAt,
    };
  }

  /**
   * Update dashboard API key
   */
  async updateDashboardApiKey(
    userId: string,
    keyId: string,
    dto: UpdateApiKeyDto,
  ): Promise<any> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const normalizedKeyId = String(keyId ?? '').trim();
    const keys = (user as any).dashboardApiKeys ?? [];
    let apiKey = keys.find(
      (k: any) =>
        String(k?.keyId ?? '').trim() === normalizedKeyId || k?.keyId === keyId,
    );
    if (!apiKey) {
      apiKey = keys.find(
        (k: any) =>
          String(k?.maskedKey ?? '') === normalizedKeyId ||
          k?.maskedKey === keyId,
      );
    }
    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    // Check for duplicate names (excluding current key)
    if (dto.name && dto.name !== apiKey.name) {
      const currentKeyId = apiKey.keyId;
      const existingKey = (user as any).dashboardApiKeys?.find(
        (k: any) => k.name === dto.name && k.keyId !== currentKeyId,
      );
      if (existingKey) {
        throw new BadRequestException('API key with this name already exists');
      }
      apiKey.name = dto.name;
    }

    if (dto.permissions) {
      apiKey.permissions = dto.permissions;
    }

    if (dto.expiresAt !== undefined) {
      apiKey.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    }

    if (dto.isActive !== undefined) {
      apiKey.isActive = dto.isActive;
    }

    await user.save();

    // Track activity
    await this.activityService.trackActivity(userId, {
      type: 'api_key_updated',
      title: 'API Key Updated',
      description: `Dashboard API key "${apiKey.name}" was updated`,
      metadata: { keyId, updates: dto },
    });

    this.logger.log('Dashboard API key updated', {
      userId,
      keyId,
      updates: dto,
    });

    return {
      keyId: apiKey.keyId,
      name: apiKey.name,
      maskedKey: apiKey.maskedKey,
      permissions: apiKey.permissions,
      lastUsed: apiKey.lastUsed,
      createdAt: apiKey.createdAt,
      expiresAt: apiKey.expiresAt,
    };
  }

  /**
   * Delete dashboard API key
   * Matches by keyId (exact) or maskedKey (fallback for backwards compatibility).
   */
  async deleteDashboardApiKey(userId: string, keyId: string): Promise<any> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const normalizedKeyId = String(keyId ?? '').trim();
    const keys = (user as any).dashboardApiKeys ?? [];

    let keyIndex = keys.findIndex(
      (k: any) =>
        String(k?.keyId ?? '').trim() === normalizedKeyId || k?.keyId === keyId,
    );

    if (keyIndex === -1) {
      keyIndex = keys.findIndex(
        (k: any) =>
          String(k?.maskedKey ?? '') === normalizedKeyId ||
          k?.maskedKey === keyId,
      );
    }

    if (keyIndex === -1) {
      this.logger.warn('Dashboard API key delete failed - key not found', {
        userId,
        keyIdProvided: keyId?.substring?.(0, 12) + '...',
        availableKeyIds: keys.map((k: any) => k.keyId?.substring?.(0, 8)),
      });
      throw new NotFoundException('API key not found');
    }

    const deletedKey = (user as any).dashboardApiKeys[keyIndex];
    (user as any).dashboardApiKeys.splice(keyIndex, 1);
    await user.save();

    // Track activity
    await this.activityService.trackActivity(userId, {
      type: 'api_key_deleted',
      title: 'API Key Deleted',
      description: `Dashboard API key "${deletedKey.name}" was deleted`,
      metadata: { keyId, name: deletedKey.name },
    });

    this.logger.log('Dashboard API key deleted', {
      userId,
      keyId,
      name: deletedKey.name,
    });

    return {
      keyId,
      name: deletedKey.name,
    };
  }

  /**
   * Get presigned URL for avatar upload
   */
  async getPresignedAvatarUrl(
    userId: string,
    dto: PresignedAvatarUrlDto,
  ): Promise<{ uploadUrl: string; key: string; finalUrl: string }> {
    const result = await this.storageService.getPresignedAvatarUploadUrl(
      userId,
      dto.fileName,
      dto.fileType,
    );
    return {
      ...result,
      finalUrl: (result as any).finalUrl ?? result.uploadUrl ?? '',
    };
  }
}
