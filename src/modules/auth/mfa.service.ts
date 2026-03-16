import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import * as speakeasy from 'speakeasy';
import * as qrcode from 'qrcode';
import { User } from '../../schemas/user/user.schema';
import { EmailService } from '../email/email.service';
import { BackupCodesService } from './backup-codes.service';

interface MFASetupResult {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

interface TrustedDevice {
  deviceId: string;
  deviceName: string;
  userAgent: string;
  ipAddress: string;
  expiresAt: Date;
}

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);
  private readonly EMAIL_CODE_EXPIRY = 10 * 60 * 1000; // 10 minutes
  private readonly MAX_EMAIL_ATTEMPTS = 5;
  private readonly BACKUP_CODES_COUNT = 10;
  private readonly TRUSTED_DEVICE_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days
  private readonly RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
  private emailQueue: Array<() => Promise<void>> = [];
  private emailProcessor?: NodeJS.Timeout;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly emailService: EmailService,
    private readonly backupCodesService: BackupCodesService,
  ) {}

  /**
   * Generate TOTP secret and QR code for authenticator app setup
   */
  async setupTOTP(userId: string, userEmail: string): Promise<MFASetupResult> {
    try {
      // Optimized user query - only fetch MFA fields
      const user = await this.userModel.findById(userId).select('mfa');
      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Generate secret and QR code in parallel
      const secret = speakeasy.generateSecret({
        name: `CostKatana (${userEmail})`,
        issuer: 'CostKatana',
        length: 32,
      });

      // Generate backup codes using new service (8 codes, 10 characters each)
      const plainBackupCodes = this.backupCodesService.generateBackupCodes();

      const [qrCodeUrl, hashedBackupCodes] = await Promise.all([
        qrcode.toDataURL(secret.otpauth_url!),
        this.backupCodesService.hashBackupCodes(plainBackupCodes),
      ]);

      // Atomic update using findByIdAndUpdate
      await this.userModel.findByIdAndUpdate(userId, {
        $set: {
          'mfa.totp.secret': secret.base32,
          'mfa.totp.backupCodes': hashedBackupCodes,
        },
      });

      this.logger.debug(`TOTP setup initiated for user: ${userId}`);

      return {
        secret: secret.base32,
        qrCodeUrl,
        backupCodes: plainBackupCodes, // Return plain codes for one-time display
      };
    } catch (error) {
      this.logger.error(
        'Error setting up TOTP:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Verify TOTP token and enable TOTP MFA
   */
  async verifyAndEnableTOTP(userId: string, token: string): Promise<boolean> {
    try {
      // Optimized query - only fetch TOTP fields
      const user = await this.userModel.findById(userId).select('mfa.totp');
      if (!user || !user.mfa.totp.secret) {
        throw new BadRequestException('TOTP setup not found');
      }

      const verified = speakeasy.totp.verify({
        secret: user.mfa.totp.secret,
        encoding: 'base32',
        token,
        window: 2, // Allow 2 time steps (60 seconds) tolerance
      });

      if (verified) {
        // Atomic update to enable TOTP
        const updateFields: any = {
          'mfa.totp.enabled': true,
          'mfa.totp.lastUsed': new Date(),
          'mfa.enabled': true,
        };

        // Add TOTP to methods if not present
        if (!user.mfa.methods.includes('totp')) {
          updateFields['$addToSet'] = { 'mfa.methods': 'totp' };
        }

        await this.userModel.findByIdAndUpdate(userId, updateFields);

        this.logger.debug(`TOTP enabled for user: ${userId}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(
        'Error verifying TOTP:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Verify TOTP token for authentication
   */
  async verifyTOTP(userId: string, token: string): Promise<boolean> {
    try {
      // Optimized query - only fetch TOTP fields
      const user = await this.userModel.findById(userId).select('mfa.totp');
      if (!user || !user.mfa.totp.enabled || !user.mfa.totp.secret) {
        return false;
      }

      // Check if it's a backup code
      const backupVerification = await this.backupCodesService.verifyBackupCode(
        token,
        user.mfa.totp.backupCodes,
      );
      if (backupVerification.verified) {
        // Atomic update to remove backup code and update lastUsed
        await this.userModel.findByIdAndUpdate(userId, {
          $pull: {
            'mfa.totp.backupCodes':
              user.mfa.totp.backupCodes[backupVerification.codeIndex!],
          },
          $set: { 'mfa.totp.lastUsed': new Date() },
        });

        this.logger.debug(`Backup code used for user: ${userId}`);
        return true;
      }

      // Verify TOTP token
      const verified = speakeasy.totp.verify({
        secret: user.mfa.totp.secret,
        encoding: 'base32',
        token,
        window: 2,
      });

      if (verified) {
        // Atomic update for lastUsed
        await this.userModel.findByIdAndUpdate(userId, {
          $set: { 'mfa.totp.lastUsed': new Date() },
        });

        this.logger.debug(`TOTP verified for user: ${userId}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(
        'Error verifying TOTP:',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  /**
   * Generate and send email MFA code
   */
  async sendEmailCode(userId: string): Promise<boolean> {
    try {
      // Optimized query - only fetch email and MFA fields
      const user = await this.userModel
        .findById(userId)
        .select('email mfa.email');
      if (!user) {
        throw new BadRequestException('User not found');
      }

      const now = new Date();

      // Streamlined rate limiting check
      const rateLimitResult = this.checkEmailRateLimit(user.mfa.email, now);
      if (!rateLimitResult.allowed) {
        throw new BadRequestException(rateLimitResult.message);
      }

      // Generate code and expiry
      const code = this.generateEmailCode();
      const expiresAt = new Date(now.getTime() + this.EMAIL_CODE_EXPIRY);

      // Atomic update for email code and rate limiting
      await this.userModel.findByIdAndUpdate(userId, {
        $set: {
          'mfa.email.code': code,
          'mfa.email.codeExpires': expiresAt,
          'mfa.email.lastAttempt': now,
        },
        $inc: { 'mfa.email.attempts': 1 },
      });

      // Queue email sending for background processing
      this.queueEmailSending(user.email, code);

      this.logger.debug(`Email MFA code generated for user: ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(
        'Error sending email code:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Verify email MFA code
   */
  async verifyEmailCode(userId: string, code: string): Promise<boolean> {
    try {
      // Optimized query - only fetch email MFA fields
      const user = await this.userModel.findById(userId).select('mfa.email');
      if (!user || !user.mfa.email.code || !user.mfa.email.codeExpires) {
        return false;
      }

      const now = new Date();

      // Check if code is expired
      if (now > user.mfa.email.codeExpires) {
        // Atomic clear of expired code
        await this.userModel.findByIdAndUpdate(userId, {
          $unset: {
            'mfa.email.code': '',
            'mfa.email.codeExpires': '',
          },
        });
        return false;
      }

      // Verify code
      if (user.mfa.email.code === code) {
        // Atomic clear code and reset attempts on success
        await this.userModel.findByIdAndUpdate(userId, {
          $unset: {
            'mfa.email.code': '',
            'mfa.email.codeExpires': '',
          },
          $set: { 'mfa.email.attempts': 0 },
        });

        this.logger.debug(`Email code verified for user: ${userId}`);
        return true;
      }

      return false;
    } catch (error) {
      this.logger.error(
        'Error verifying email code:',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  /**
   * Enable email MFA
   */
  async enableEmailMFA(userId: string): Promise<boolean> {
    try {
      // Check if email method already exists
      const user = await this.userModel.findById(userId).select('mfa.methods');
      if (!user) {
        throw new BadRequestException('User not found');
      }

      // Atomic update to enable email MFA
      const updateFields: any = {
        'mfa.email.enabled': true,
        'mfa.enabled': true,
      };

      // Add email to methods if not present
      if (!user.mfa.methods.includes('email')) {
        updateFields['$addToSet'] = { 'mfa.methods': 'email' };
      }

      await this.userModel.findByIdAndUpdate(userId, updateFields);

      this.logger.debug(`Email MFA enabled for user: ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(
        'Error enabling email MFA:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Disable MFA method
   */
  async disableMFAMethod(
    userId: string,
    method: 'email' | 'totp',
  ): Promise<boolean> {
    try {
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new BadRequestException('User not found');
      }

      if (method === 'email') {
        user.mfa.email.enabled = false;
        user.mfa.email.code = undefined;
        user.mfa.email.codeExpires = undefined;
        user.mfa.email.attempts = 0;
      } else if (method === 'totp') {
        user.mfa.totp.enabled = false;
        user.mfa.totp.secret = undefined;
        user.mfa.totp.backupCodes = [];
      }

      // Remove method from enabled methods
      user.mfa.methods = user.mfa.methods.filter((m) => m !== method);

      // Disable MFA entirely if no methods are enabled
      if (user.mfa.methods.length === 0) {
        user.mfa.enabled = false;
      }

      await user.save();

      this.logger.log(
        `${method.toUpperCase()} MFA disabled for user: ${userId}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Error disabling ${method} MFA:`,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Add trusted device
   */
  async addTrustedDevice(
    userId: string,
    deviceInfo: Omit<TrustedDevice, 'expiresAt'>,
  ): Promise<boolean> {
    try {
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new BadRequestException('User not found');
      }

      const expiresAt = new Date(Date.now() + this.TRUSTED_DEVICE_EXPIRY);

      // Remove existing device with same deviceId if exists
      user.mfa.trustedDevices = user.mfa.trustedDevices.filter(
        (device) => device.deviceId !== deviceInfo.deviceId,
      );

      // Add new trusted device
      user.mfa.trustedDevices.push({
        ...deviceInfo,
        createdAt: new Date(),
        lastUsed: new Date(),
        expiresAt,
      });

      await user.save();

      this.logger.log(`Trusted device added for user: ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(
        'Error adding trusted device:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Check if device is trusted with enhanced logging and fallback mechanisms
   */
  async isTrustedDevice(userId: string, deviceId: string): Promise<boolean> {
    try {
      const user = await this.userModel
        .findById(userId)
        .select('mfa.trustedDevices email');
      if (!user) {
        this.logger.warn('Trusted device check failed - user not found', {
          userId,
          deviceId,
        });
        return false;
      }

      const now = new Date();

      // Log the device check attempt
      this.logger.log('Checking trusted device', {
        userId,
        deviceId,
        trustedDevicesCount: user.mfa.trustedDevices.length,
        email: user.email,
      });

      // Find exact match first
      const trustedDevice = user.mfa.trustedDevices.find(
        (device) => device.deviceId === deviceId && device.expiresAt > now,
      );

      if (trustedDevice) {
        this.logger.log('Trusted device found - exact match', {
          userId,
          deviceId,
          deviceName: trustedDevice.deviceName,
          expiresAt: trustedDevice.expiresAt,
          email: user.email,
        });

        // Update last used
        trustedDevice.lastUsed = now;
        await user.save();
        return true;
      }

      // Try fallback matching for devices with similar fingerprints (in case of minor UA changes)
      const devicePrefix = deviceId.substring(0, 12); // Use base fingerprint part
      const fallbackDevice = user.mfa.trustedDevices.find((device) => {
        const storedPrefix = device.deviceId.substring(0, 12);
        return storedPrefix === devicePrefix && device.expiresAt > now;
      });

      if (fallbackDevice) {
        this.logger.log(
          'Trusted device found - fallback match (updating device ID)',
          {
            userId,
            oldDeviceId: fallbackDevice.deviceId,
            newDeviceId: deviceId,
            deviceName: fallbackDevice.deviceName,
            email: user.email,
          },
        );

        // Update the device ID and last used (handles minor UA changes/IP changes)
        fallbackDevice.deviceId = deviceId;
        fallbackDevice.lastUsed = now;
        await user.save();
        return true;
      }

      // Clean up expired devices while we're here
      const expiredCount = user.mfa.trustedDevices.filter(
        (device) => device.expiresAt <= now,
      ).length;
      if (expiredCount > 0) {
        user.mfa.trustedDevices = user.mfa.trustedDevices.filter(
          (device) => device.expiresAt > now,
        );
        await user.save();

        this.logger.log('Cleaned up expired trusted devices', {
          userId,
          expiredCount,
          remainingCount: user.mfa.trustedDevices.length,
          email: user.email,
        });
      }

      this.logger.log('Device not trusted', {
        userId,
        deviceId,
        trustedDevicesCount: user.mfa.trustedDevices.length,
        expiredDevicesRemoved: expiredCount,
        email: user.email,
      });

      return false;
    } catch (error) {
      this.logger.error('Error checking trusted device:', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        deviceId,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return false;
    }
  }

  /**
   * Remove trusted device
   */
  async removeTrustedDevice(
    userId: string,
    deviceId: string,
  ): Promise<boolean> {
    try {
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new BadRequestException('User not found');
      }

      user.mfa.trustedDevices = user.mfa.trustedDevices.filter(
        (device) => device.deviceId !== deviceId,
      );

      await user.save();

      this.logger.log(`Trusted device removed for user: ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(
        'Error removing trusted device:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Get MFA status for user
   */
  async getMFAStatus(userId: string): Promise<any> {
    try {
      const user = await this.userModel.findById(userId).select('mfa');
      if (!user) {
        throw new BadRequestException('User not found');
      }

      return {
        enabled: user.mfa.enabled,
        methods: user.mfa.methods,
        email: {
          enabled: user.mfa.email.enabled,
        },
        totp: {
          enabled: user.mfa.totp.enabled,
          hasBackupCodes: user.mfa.totp.backupCodes.length > 0,
        },
        trustedDevices: user.mfa.trustedDevices.map((device) => ({
          deviceId: device.deviceId,
          deviceName: device.deviceName,
          lastUsed: device.lastUsed,
          expiresAt: device.expiresAt,
        })),
      };
    } catch (error) {
      this.logger.error(
        'Error getting MFA status:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Generate backup codes for TOTP
   */
  private generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < this.BACKUP_CODES_COUNT; i++) {
      codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }
    return codes;
  }

  /**
   * Generate email verification code
   */
  private generateEmailCode(): string {
    return crypto.randomInt(100000, 999999).toString();
  }

  /**
   * Generate device ID from request info
   * Uses a more stable fingerprinting approach that focuses on browser/OS rather than exact UA string
   */
  static generateDeviceId(userAgent: string, ipAddress: string): string {
    // Extract stable browser/OS information from user agent
    const normalizedUA = this.normalizeUserAgent(userAgent);

    // Create base fingerprint with normalized UA - don't rely heavily on IP for home users
    const baseFingerprint = crypto
      .createHash('sha256')
      .update(normalizedUA)
      .digest('hex')
      .substring(0, 12);

    // Add IP-based suffix for additional security (but shorter to reduce IP change impact)
    const ipSuffix = crypto
      .createHash('sha256')
      .update(ipAddress)
      .digest('hex')
      .substring(0, 4);

    return `${baseFingerprint}${ipSuffix}`;
  }

  /**
   * Normalize user agent to focus on stable browser/OS characteristics
   * This reduces false negatives from minor browser updates
   */
  private static normalizeUserAgent(userAgent: string): string {
    const ua = userAgent.toLowerCase();

    // Extract browser type and major version only
    let browserInfo = '';
    if (ua.includes('chrome/')) {
      const match = ua.match(/chrome\/(\d+)/);
      const majorVersion = match
        ? Math.floor(parseInt(match[1]) / 10) * 10
        : '0'; // Round to nearest 10
      browserInfo = `chrome-${majorVersion}`;
    } else if (ua.includes('firefox/')) {
      const match = ua.match(/firefox\/(\d+)/);
      const majorVersion = match ? Math.floor(parseInt(match[1]) / 5) * 5 : '0'; // Round to nearest 5
      browserInfo = `firefox-${majorVersion}`;
    } else if (ua.includes('safari/')) {
      browserInfo = 'safari';
    } else if (ua.includes('edge/')) {
      browserInfo = 'edge';
    } else {
      browserInfo = 'other';
    }

    // Extract OS information
    let osInfo = '';
    if (ua.includes('windows')) osInfo = 'windows';
    else if (ua.includes('macos') || ua.includes('mac os')) osInfo = 'macos';
    else if (ua.includes('linux')) osInfo = 'linux';
    else if (ua.includes('android')) osInfo = 'android';
    else if (ua.includes('ios')) osInfo = 'ios';
    else osInfo = 'other';

    return `${browserInfo}-${osInfo}`;
  }

  // ============================================================================
  // OPTIMIZATION UTILITY METHODS
  // ============================================================================

  /**
   * Conditional debug logging
   */
  private debugLog(message: string): void {
    this.logger.log(message);
  }

  /**
   * Streamlined email rate limiting check
   */
  private checkEmailRateLimit(
    emailMfa: any,
    now: Date,
  ): { allowed: boolean; message?: string } {
    // Check 1-minute cooldown
    if (
      emailMfa.lastAttempt &&
      now.getTime() - emailMfa.lastAttempt.getTime() < 60000
    ) {
      return {
        allowed: false,
        message: 'Please wait before requesting another code',
      };
    }

    // Check max attempts with 1-hour reset
    if (emailMfa.attempts >= this.MAX_EMAIL_ATTEMPTS) {
      const resetTime = new Date(
        emailMfa.lastAttempt.getTime() + this.RATE_LIMIT_WINDOW,
      );
      if (now < resetTime) {
        return {
          allowed: false,
          message: 'Too many attempts. Please try again later.',
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Queue email sending for background processing
   */
  private queueEmailSending(userEmail: string, code: string): void {
    const emailOperation = async () => {
      try {
        await this.emailService.sendMFAEmail(userEmail, code);
        this.debugLog(`Email sent successfully to: ${userEmail}`);
      } catch (error) {
        this.logger.error('Background email sending failed:', {
          error: error instanceof Error ? error.message : String(error),
          userEmail,
        });
      }
    };

    this.emailQueue.push(emailOperation);
    this.startEmailProcessor();
  }

  /**
   * Start background email processor
   */
  private startEmailProcessor(): void {
    if (this.emailProcessor) return;

    this.emailProcessor = setTimeout(async () => {
      await this.processEmailQueue();
      this.emailProcessor = undefined;

      if (this.emailQueue.length > 0) {
        this.startEmailProcessor();
      }
    }, 100);
  }

  /**
   * Process background email queue
   */
  private async processEmailQueue(): Promise<void> {
    const operations = this.emailQueue.splice(0, 3); // Process 3 emails at a time
    await Promise.allSettled(operations.map((op) => op()));
  }
}
