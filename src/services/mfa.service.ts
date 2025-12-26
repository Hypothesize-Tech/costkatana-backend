import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import crypto from 'crypto';
import { User } from '../models/User';
import { emailTransporter, EMAIL_CONFIG } from '../config/email';
import { loggingService } from './logging.service';
import { BackupCodesService } from './backupCodes.service';

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
                name: `CostKatana (${userEmail})`,
                issuer: 'CostKatana',
                length: 32,
            });

            // Generate backup codes using new service (8 codes, 10 characters each)
            const plainBackupCodes = BackupCodesService.generateBackupCodes();
            
            const [qrCodeUrl, hashedBackupCodes] = await Promise.all([
                qrcode.toDataURL(secret.otpauth_url!),
                BackupCodesService.hashBackupCodes(plainBackupCodes)
            ]);

            // Atomic update using findByIdAndUpdate
            await User.findByIdAndUpdate(userId, {
                $set: {
                    'mfa.totp.secret': secret.base32,
                    'mfa.totp.backupCodes': hashedBackupCodes
                }
            });

            this.debugLog(`TOTP setup initiated for user: ${userId}`);

            return {
                secret: secret.base32!,
                qrCodeUrl,
                backupCodes: plainBackupCodes, // Return plain codes for one-time display
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
     * Check if device is trusted with enhanced logging and fallback mechanisms
     */
    static async isTrustedDevice(userId: string, deviceId: string): Promise<boolean> {
        try {
            const user = await User.findById(userId).select('mfa.trustedDevices email');
            if (!user) {
                loggingService.warn('Trusted device check failed - user not found', { userId, deviceId });
                return false;
            }

            const now = new Date();
            
            // Log the device check attempt
            loggingService.info('Checking trusted device', {
                userId,
                deviceId,
                trustedDevicesCount: user.mfa.trustedDevices.length,
                email: user.email
            });

            // Find exact match first
            const trustedDevice = user.mfa.trustedDevices.find(
                device => device.deviceId === deviceId && device.expiresAt > now
            );

            if (trustedDevice) {
                loggingService.info('Trusted device found - exact match', {
                    userId,
                    deviceId,
                    deviceName: trustedDevice.deviceName,
                    expiresAt: trustedDevice.expiresAt,
                    email: user.email
                });
                
                // Update last used
                trustedDevice.lastUsed = now;
                await user.save();
                return true;
            }

            // Try fallback matching for devices with similar fingerprints (in case of minor UA changes)
            const devicePrefix = deviceId.substring(0, 12); // Use base fingerprint part
            const fallbackDevice = user.mfa.trustedDevices.find(device => {
                const storedPrefix = device.deviceId.substring(0, 12);
                return storedPrefix === devicePrefix && device.expiresAt > now;
            });

            if (fallbackDevice) {
                loggingService.info('Trusted device found - fallback match (updating device ID)', {
                    userId,
                    oldDeviceId: fallbackDevice.deviceId,
                    newDeviceId: deviceId,
                    deviceName: fallbackDevice.deviceName,
                    email: user.email
                });
                
                // Update the device ID and last used (handles minor UA changes/IP changes)
                fallbackDevice.deviceId = deviceId;
                fallbackDevice.lastUsed = now;
                await user.save();
                return true;
            }

            // Clean up expired devices while we're here
            const expiredCount = user.mfa.trustedDevices.filter(device => device.expiresAt <= now).length;
            if (expiredCount > 0) {
                user.mfa.trustedDevices = user.mfa.trustedDevices.filter(device => device.expiresAt > now);
                await user.save();
                
                loggingService.info('Cleaned up expired trusted devices', {
                    userId,
                    expiredCount,
                    remainingCount: user.mfa.trustedDevices.length,
                    email: user.email
                });
            }

            loggingService.info('Device not trusted', {
                userId,
                deviceId,
                trustedDevicesCount: user.mfa.trustedDevices.length,
                expiredDevicesRemoved: expiredCount,
                email: user.email
            });

            return false;
        } catch (error) {
            loggingService.error('Error checking trusted device:', { 
                error: error instanceof Error ? error.message : String(error),
                userId,
                deviceId,
                stack: error instanceof Error ? error.stack : undefined
            });
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
            const majorVersion = match ? Math.floor(parseInt(match[1]) / 10) * 10 : '0'; // Round to nearest 10
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
                    subject: 'Your Cost Katana Security Code',
                    html: `
                        <!DOCTYPE html>
                        <html>
                          <head>
                            <style>
                              body {
                                font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                                line-height: 1.6;
                                color: #1f2937;
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                margin: 0;
                                padding: 40px 20px;
                              }
                              .container {
                                max-width: 600px;
                                margin: 0 auto;
                                background: rgba(255, 255, 255, 0.95);
                                backdrop-filter: blur(10px);
                                border-radius: 24px;
                                overflow: hidden;
                                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
                              }
                              .header {
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                color: white;
                                padding: 40px 30px;
                                text-align: center;
                              }
                              .header h1 {
                                margin: 0;
                                font-size: 32px;
                                font-weight: 700;
                                letter-spacing: -0.5px;
                              }
                              .content {
                                padding: 40px 30px;
                                background: white;
                              }
                              .content h2 {
                                color: #1f2937;
                                font-size: 24px;
                                font-weight: 600;
                                margin: 0 0 20px 0;
                              }
                              .content p {
                                color: #4b5563;
                                margin: 16px 0;
                                font-size: 16px;
                              }
                              .code-box {
                                background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%);
                                padding: 32px;
                                text-align: center;
                                margin: 24px 0;
                                border-radius: 16px;
                                border: 2px solid #667eea;
                              }
                              .code {
                                color: #667eea;
                                font-size: 48px;
                                font-weight: 700;
                                margin: 0;
                                letter-spacing: 8px;
                                font-family: 'Courier New', monospace;
                              }
                              .footer {
                                text-align: center;
                                padding: 30px;
                                color: #6b7280;
                                font-size: 14px;
                                background: #f9fafb;
                              }
                              .icon-container {
                                margin-bottom: 10px;
                              }
                              .warning-box {
                                background: #fef3c7;
                                border-left: 4px solid #f59e0b;
                                padding: 16px;
                                margin: 20px 0;
                                border-radius: 8px;
                                display: flex;
                                align-items: flex-start;
                                gap: 12px;
                              }
                              .warning-box p {
                                margin: 0;
                                color: #78350f;
                                font-size: 14px;
                              }
                              .icon-inline {
                                flex-shrink: 0;
                                margin-top: 2px;
                              }
                            </style>
                          </head>
                          <body>
                            <div class="container">
                              <div class="header">
                                <div class="icon-container">
                                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M12 1C8.69 1 6 3.69 6 7V10C4.9 10 4 10.9 4 12V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V12C20 10.9 19.1 10 18 10V7C18 3.69 15.31 1 12 1ZM12 3C14.21 3 16 4.79 16 7V10H8V7C8 4.79 9.79 3 12 3ZM12 17C10.9 17 10 16.1 10 15C10 13.9 10.9 13 12 13C13.1 13 14 13.9 14 15C14 16.1 13.1 17 12 17Z" fill="white"/>
                                  </svg>
                                </div>
                                <h1>Security Verification</h1>
                              </div>
                              <div class="content">
                                <h2>Your Verification Code</h2>
                                <p>Use this code to complete your multi-factor authentication:</p>
                                <div class="code-box">
                                  <div class="code">${code}</div>
                                </div>
                                <div class="warning-box">
                                  <svg class="icon-inline" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z" fill="#f59e0b"/>
                                  </svg>
                                  <p><strong>This code will expire in 10 minutes</strong> for security reasons.</p>
                                </div>
                                <p>If you didn't request this code, please ignore this email or contact support if you have concerns.</p>
                              </div>
                              <div class="footer">
                                <p><strong>Cost Katana</strong> - AI Cost Optimization Platform</p>
                                <p>© ${new Date().getFullYear()} Cost Katana. All rights reserved.</p>
                              </div>
                            </div>
                          </body>
                        </html>
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


