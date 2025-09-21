import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import crypto from 'crypto';
import { User } from '../models/User';
import { emailTransporter, EMAIL_CONFIG } from '../config/email';
import { loggingService } from './logging.service';

export interface MFASetupResult {
    secret: string;
    qrCodeUrl: string;
    backupCodes: string[];
}

export interface TrustedDevice {
    deviceId: string;
    deviceName: string;
    userAgent: string;
    ipAddress: string;
    expiresAt: Date;
}

export class MFAService {
    private static readonly EMAIL_CODE_EXPIRY = 10 * 60 * 1000; // 10 minutes
    private static readonly MAX_EMAIL_ATTEMPTS = 5;
    private static readonly BACKUP_CODES_COUNT = 10;
    private static readonly TRUSTED_DEVICE_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30 days
    private static readonly RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour
    private static emailQueue: Array<() => Promise<void>> = [];
    private static emailProcessor?: NodeJS.Timeout;

    /**
     * Generate TOTP secret and QR code for authenticator app setup
     */
    static async setupTOTP(userId: string, userEmail: string): Promise<MFASetupResult> {
        try {
            // Optimized user query - only fetch MFA fields
            const user = await User.findById(userId).select('mfa');
            if (!user) {
                throw new Error('User not found');
            }

            // Generate secret and QR code in parallel
            const secret = speakeasy.generateSecret({
                name: `AI Cost Optimizer (${userEmail})`,
                issuer: 'AI Cost Optimizer',
                length: 32,
            });

            const [qrCodeUrl, backupCodes] = await Promise.all([
                qrcode.toDataURL(secret.otpauth_url!),
                Promise.resolve(this.generateBackupCodes())
            ]);

            // Atomic update using findByIdAndUpdate
            await User.findByIdAndUpdate(userId, {
                $set: {
                    'mfa.totp.secret': secret.base32,
                    'mfa.totp.backupCodes': backupCodes
                }
            });

            this.debugLog(`TOTP setup initiated for user: ${userId}`);

            return {
                secret: secret.base32!,
                qrCodeUrl,
                backupCodes,
            };
        } catch (error) {
            loggingService.error('Error setting up TOTP:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Verify TOTP token and enable TOTP MFA
     */
    static async verifyAndEnableTOTP(userId: string, token: string): Promise<boolean> {
        try {
            // Optimized query - only fetch MFA fields
            const user = await User.findById(userId).select('mfa');
            if (!user || !user.mfa.totp.secret) {
                throw new Error('TOTP setup not found');
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
                    'mfa.enabled': true
                };

                // Add TOTP to methods if not present
                if (!user.mfa.methods.includes('totp')) {
                    updateFields['$addToSet'] = { 'mfa.methods': 'totp' };
                }

                await User.findByIdAndUpdate(userId, updateFields);

                this.debugLog(`TOTP enabled for user: ${userId}`);
                return true;
            }

            return false;
        } catch (error) {
            loggingService.error('Error verifying TOTP:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Verify TOTP token for authentication
     */
    static async verifyTOTP(userId: string, token: string): Promise<boolean> {
        try {
            // Optimized query - only fetch TOTP fields
            const user = await User.findById(userId).select('mfa.totp');
            if (!user || !user.mfa.totp.enabled || !user.mfa.totp.secret) {
                return false;
            }

            // Check if it's a backup code
            if (user.mfa.totp.backupCodes.includes(token)) {
                // Atomic update to remove backup code and update lastUsed
                await User.findByIdAndUpdate(userId, {
                    $pull: { 'mfa.totp.backupCodes': token },
                    $set: { 'mfa.totp.lastUsed': new Date() }
                });

                this.debugLog(`Backup code used for user: ${userId}`);
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
                await User.findByIdAndUpdate(userId, {
                    $set: { 'mfa.totp.lastUsed': new Date() }
                });

                this.debugLog(`TOTP verified for user: ${userId}`);
                return true;
            }

            return false;
        } catch (error) {
            loggingService.error('Error verifying TOTP:', { error: error instanceof Error ? error.message : String(error) });
            return false;
        }
    }

    /**
     * Generate and send email MFA code
     */
    static async sendEmailCode(userId: string): Promise<boolean> {
        try {
            // Optimized query - only fetch email and MFA fields
            const user = await User.findById(userId).select('email mfa.email');
            if (!user) {
                throw new Error('User not found');
            }

            const now = new Date();
            
            // Streamlined rate limiting check
            const rateLimitResult = this.checkEmailRateLimit(user.mfa.email, now);
            if (!rateLimitResult.allowed) {
                throw new Error(rateLimitResult.message);
            }

            // Generate code and expiry
            const code = this.generateEmailCode();
            const expiresAt = new Date(now.getTime() + this.EMAIL_CODE_EXPIRY);

            // Atomic update for email code and rate limiting
            await User.findByIdAndUpdate(userId, {
                $set: {
                    'mfa.email.code': code,
                    'mfa.email.codeExpires': expiresAt,
                    'mfa.email.lastAttempt': now
                },
                $inc: { 'mfa.email.attempts': 1 }
            });

            // Queue email sending for background processing
            this.queueEmailSending(user.email, code);

            this.debugLog(`Email MFA code generated for user: ${userId}`);
            return true;
        } catch (error) {
            loggingService.error('Error sending email code:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Verify email MFA code
     */
    static async verifyEmailCode(userId: string, code: string): Promise<boolean> {
        try {
            // Optimized query - only fetch email MFA fields
            const user = await User.findById(userId).select('mfa.email');
            if (!user || !user.mfa.email.code || !user.mfa.email.codeExpires) {
                return false;
            }

            const now = new Date();
            
            // Check if code is expired
            if (now > user.mfa.email.codeExpires) {
                // Atomic clear of expired code
                await User.findByIdAndUpdate(userId, {
                    $unset: {
                        'mfa.email.code': '',
                        'mfa.email.codeExpires': ''
                    }
                });
                return false;
            }

            // Verify code
            if (user.mfa.email.code === code) {
                // Atomic clear code and reset attempts on success
                await User.findByIdAndUpdate(userId, {
                    $unset: {
                        'mfa.email.code': '',
                        'mfa.email.codeExpires': ''
                    },
                    $set: { 'mfa.email.attempts': 0 }
                });

                this.debugLog(`Email code verified for user: ${userId}`);
                return true;
            }

            return false;
        } catch (error) {
            loggingService.error('Error verifying email code:', { error: error instanceof Error ? error.message : String(error) });
            return false;
        }
    }

    /**
     * Enable email MFA
     */
    static async enableEmailMFA(userId: string): Promise<boolean> {
        try {
            // Check if email method already exists
            const user = await User.findById(userId).select('mfa.methods');
            if (!user) {
                throw new Error('User not found');
            }

            // Atomic update to enable email MFA
            const updateFields: any = {
                'mfa.email.enabled': true,
                'mfa.enabled': true
            };

            // Add email to methods if not present
            if (!user.mfa.methods.includes('email')) {
                updateFields['$addToSet'] = { 'mfa.methods': 'email' };
            }

            await User.findByIdAndUpdate(userId, updateFields);

            this.debugLog(`Email MFA enabled for user: ${userId}`);
            return true;
        } catch (error) {
            loggingService.error('Error enabling email MFA:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Disable MFA method
     */
    static async disableMFAMethod(userId: string, method: 'email' | 'totp'): Promise<boolean> {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
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
            user.mfa.methods = user.mfa.methods.filter(m => m !== method);

            // Disable MFA entirely if no methods are enabled
            if (user.mfa.methods.length === 0) {
                user.mfa.enabled = false;
            }

            await user.save();

            loggingService.info(`${method.toUpperCase()} MFA disabled for user: ${userId}`);
            return true;
        } catch (error) {
            loggingService.error(`Error disabling ${method} MFA:`, { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Add trusted device
     */
    static async addTrustedDevice(userId: string, deviceInfo: Omit<TrustedDevice, 'expiresAt'>): Promise<boolean> {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            const expiresAt = new Date(Date.now() + this.TRUSTED_DEVICE_EXPIRY);
            
            // Remove existing device with same deviceId if exists
            user.mfa.trustedDevices = user.mfa.trustedDevices.filter(
                device => device.deviceId !== deviceInfo.deviceId
            );

            // Add new trusted device
            user.mfa.trustedDevices.push({
                ...deviceInfo,
                createdAt: new Date(),
                lastUsed: new Date(),
                expiresAt,
            });

            await user.save();

            loggingService.info(`Trusted device added for user: ${userId}`);
            return true;
        } catch (error) {
            loggingService.error('Error adding trusted device:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Check if device is trusted
     */
    static async isTrustedDevice(userId: string, deviceId: string): Promise<boolean> {
        try {
            const user = await User.findById(userId);
            if (!user) {
                return false;
            }

            const now = new Date();
            const trustedDevice = user.mfa.trustedDevices.find(
                device => device.deviceId === deviceId && device.expiresAt > now
            );

            if (trustedDevice) {
                // Update last used
                trustedDevice.lastUsed = now;
                await user.save();
                return true;
            }

            return false;
        } catch (error) {
            loggingService.error('Error checking trusted device:', { error: error instanceof Error ? error.message : String(error) });
            return false;
        }
    }

    /**
     * Remove trusted device
     */
    static async removeTrustedDevice(userId: string, deviceId: string): Promise<boolean> {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            user.mfa.trustedDevices = user.mfa.trustedDevices.filter(
                device => device.deviceId !== deviceId
            );

            await user.save();

            loggingService.info(`Trusted device removed for user: ${userId}`);
            return true;
        } catch (error) {
            loggingService.error('Error removing trusted device:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Get MFA status for user
     */
    static async getMFAStatus(userId: string): Promise<any> {
        try {
            const user = await User.findById(userId).select('mfa');
            if (!user) {
                throw new Error('User not found');
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
                trustedDevices: user.mfa.trustedDevices.map(device => ({
                    deviceId: device.deviceId,
                    deviceName: device.deviceName,
                    lastUsed: device.lastUsed,
                    expiresAt: device.expiresAt,
                })),
            };
        } catch (error) {
            loggingService.error('Error getting MFA status:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    /**
     * Generate backup codes for TOTP
     */
    private static generateBackupCodes(): string[] {
        const codes: string[] = [];
        for (let i = 0; i < this.BACKUP_CODES_COUNT; i++) {
            codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
        }
        return codes;
    }

    /**
     * Generate email verification code
     */
    private static generateEmailCode(): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    /**
     * Generate device ID from request info
     */
    static generateDeviceId(userAgent: string, ipAddress: string): string {
        return crypto
            .createHash('sha256')
            .update(`${userAgent}-${ipAddress}`)
            .digest('hex')
            .substring(0, 16);
    }

    // ============================================================================
    // OPTIMIZATION UTILITY METHODS
    // ============================================================================

    /**
     * Conditional debug logging
     */
    private static debugLog(message: string): void {
            loggingService.info(message);
    }

    /**
     * Streamlined email rate limiting check
     */
    private static checkEmailRateLimit(emailMfa: any, now: Date): { allowed: boolean; message?: string } {
        // Check 1-minute cooldown
        if (emailMfa.lastAttempt && (now.getTime() - emailMfa.lastAttempt.getTime()) < 60000) {
            return { allowed: false, message: 'Please wait before requesting another code' };
        }

        // Check max attempts with 1-hour reset
        if (emailMfa.attempts >= this.MAX_EMAIL_ATTEMPTS) {
            const resetTime = new Date(emailMfa.lastAttempt.getTime() + this.RATE_LIMIT_WINDOW);
            if (now < resetTime) {
                return { allowed: false, message: 'Too many attempts. Please try again later.' };
            }
        }

        return { allowed: true };
    }

    /**
     * Queue email sending for background processing
     */
    private static queueEmailSending(userEmail: string, code: string): void {
        const emailOperation = async () => {
            try {
                const transporter = await emailTransporter;
                await transporter.sendMail({
                    from: EMAIL_CONFIG.from,
                    to: userEmail,
                    subject: 'Your AI Cost Optimizer Security Code',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #333;">Security Verification Code</h2>
                            <p>Your verification code is:</p>
                            <div style="background: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0;">
                                <h1 style="color: #4F46E5; font-size: 32px; margin: 0; letter-spacing: 5px;">${code}</h1>
                            </div>
                            <p>This code will expire in 10 minutes.</p>
                            <p>If you didn't request this code, please ignore this email or contact support if you have concerns.</p>
                            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
                            <p style="color: #666; font-size: 12px;">AI Cost Optimizer Security Team</p>
                        </div>
                    `,
                });
                this.debugLog(`Email sent successfully to: ${userEmail}`);
            } catch (error) {
                loggingService.error('Background email sending failed:', { 
                    error: error instanceof Error ? error.message : String(error),
                    userEmail 
                });
            }
        };

        this.emailQueue.push(emailOperation);
        this.startEmailProcessor();
    }

    /**
     * Start background email processor
     */
    private static startEmailProcessor(): void {
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
    private static async processEmailQueue(): Promise<void> {
        const operations = this.emailQueue.splice(0, 3); // Process 3 emails at a time
        await Promise.allSettled(operations.map(op => op()));
    }
}


