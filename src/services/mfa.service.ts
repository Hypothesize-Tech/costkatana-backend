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

    /**
     * Generate TOTP secret and QR code for authenticator app setup
     */
    static async setupTOTP(userId: string, userEmail: string): Promise<MFASetupResult> {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Generate secret
            const secret = speakeasy.generateSecret({
                name: `AI Cost Optimizer (${userEmail})`,
                issuer: 'AI Cost Optimizer',
                length: 32,
            });

            // Generate QR code
            const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url!);

            // Generate backup codes
            const backupCodes = this.generateBackupCodes();

            // Save secret to user (but don't enable TOTP yet)
            user.mfa.totp.secret = secret.base32;
            user.mfa.totp.backupCodes = backupCodes;
            await user.save();

            loggingService.info(`TOTP setup initiated for user: ${userId}`);

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
            const user = await User.findById(userId);
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
                // Enable TOTP
                user.mfa.totp.enabled = true;
                user.mfa.totp.lastUsed = new Date();
                
                // Add TOTP to enabled methods if not already present
                if (!user.mfa.methods.includes('totp')) {
                    user.mfa.methods.push('totp');
                }
                
                // Enable MFA if not already enabled
                user.mfa.enabled = true;
                
                await user.save();

                loggingService.info(`TOTP enabled for user: ${userId}`);
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
            const user = await User.findById(userId);
            if (!user || !user.mfa.totp.enabled || !user.mfa.totp.secret) {
                return false;
            }

            // Check if it's a backup code
            if (user.mfa.totp.backupCodes.includes(token)) {
                // Remove used backup code
                user.mfa.totp.backupCodes = user.mfa.totp.backupCodes.filter(code => code !== token);
                user.mfa.totp.lastUsed = new Date();
                await user.save();

                loggingService.info(`Backup code used for user: ${userId}`);
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
                user.mfa.totp.lastUsed = new Date();
                await user.save();

                loggingService.info(`TOTP verified for user: ${userId}`);
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
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Check rate limiting
            const now = new Date();
            if (user.mfa.email.lastAttempt && 
                (now.getTime() - user.mfa.email.lastAttempt.getTime()) < 60000) { // 1 minute
                throw new Error('Please wait before requesting another code');
            }

            if (user.mfa.email.attempts >= this.MAX_EMAIL_ATTEMPTS) {
                const resetTime = new Date(user.mfa.email.lastAttempt!.getTime() + 60 * 60 * 1000); // 1 hour
                if (now < resetTime) {
                    throw new Error('Too many attempts. Please try again later.');
                }
                // Reset attempts after 1 hour
                user.mfa.email.attempts = 0;
            }

            // Generate code
            const code = this.generateEmailCode();
            const expiresAt = new Date(now.getTime() + this.EMAIL_CODE_EXPIRY);

            // Save code to user
            user.mfa.email.code = code;
            user.mfa.email.codeExpires = expiresAt;
            user.mfa.email.attempts += 1;
            user.mfa.email.lastAttempt = now;
            await user.save();

            // Send email
            const transporter = await emailTransporter;
            await transporter.sendMail({
                from: EMAIL_CONFIG.from,
                to: user.email,
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

            loggingService.info(`Email MFA code sent to user: ${userId}`);
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
            const user = await User.findById(userId);
            if (!user || !user.mfa.email.code || !user.mfa.email.codeExpires) {
                return false;
            }

            const now = new Date();
            
            // Check if code is expired
            if (now > user.mfa.email.codeExpires) {
                // Clear expired code
                user.mfa.email.code = undefined;
                user.mfa.email.codeExpires = undefined;
                await user.save();
                return false;
            }

            // Verify code
            if (user.mfa.email.code === code) {
                // Clear code after successful verification
                user.mfa.email.code = undefined;
                user.mfa.email.codeExpires = undefined;
                user.mfa.email.attempts = 0; // Reset attempts on success
                await user.save();

                loggingService.info(`Email code verified for user: ${userId}`);
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
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            user.mfa.email.enabled = true;
            
            // Add email to enabled methods if not already present
            if (!user.mfa.methods.includes('email')) {
                user.mfa.methods.push('email');
            }
            
            // Enable MFA if not already enabled
            user.mfa.enabled = true;
            
            await user.save();

            loggingService.info(`Email MFA enabled for user: ${userId}`);
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
            const user = await User.findById(userId);
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
}


