import { Response } from 'express';
import { z } from 'zod';
import { MFAService } from '../services/mfa.service';
import { AuthService } from '../services/auth.service';
import { User } from '../models/User';
import { logger } from '../utils/logger';
import { config } from '../config';

// Validation schemas
const setupTOTPSchema = z.object({
    email: z.string().email(),
});

const verifyTOTPSchema = z.object({
    token: z.string().min(6).max(8),
});

const verifyEmailCodeSchema = z.object({
    code: z.string().length(6),
});

const disableMFASchema = z.object({
    method: z.enum(['email', 'totp']),
});

const addTrustedDeviceSchema = z.object({
    deviceName: z.string().min(1).max(100),
    rememberDevice: z.boolean().optional().default(false),
});

const removeTrustedDeviceSchema = z.object({
    deviceId: z.string().min(1),
});

export class MFAController {
    /**
     * Get MFA status for the current user
     */
    static async getStatus(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id || req.user?._id || req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required. Please log in to access MFA settings.',
                });
                return;
            }

            const status = await MFAService.getMFAStatus(userId);

            res.json({
                success: true,
                data: status,
            });
        } catch (error: any) {
            logger.error('Error getting MFA status:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get MFA status',
                error: error.message,
            });
        }
    }

    /**
     * Setup TOTP (Time-based One-Time Password) for authenticator apps
     */
    static async setupTOTP(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            const { email } = setupTOTPSchema.parse(req.body);

            const result = await MFAService.setupTOTP(userId, email);

            res.json({
                success: true,
                message: 'TOTP setup initiated. Scan the QR code with your authenticator app.',
                data: {
                    qrCodeUrl: result.qrCodeUrl,
                    backupCodes: result.backupCodes,
                },
            });
        } catch (error: any) {
            logger.error('Error setting up TOTP:', error);
            
            if (error instanceof z.ZodError) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid input data',
                    errors: error.errors,
                });
                return;
            }

            res.status(500).json({
                success: false,
                message: 'Failed to setup TOTP',
                error: error.message,
            });
        }
    }

    /**
     * Verify TOTP token and enable TOTP MFA
     */
    static async verifyAndEnableTOTP(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            const { token } = verifyTOTPSchema.parse(req.body);

            const verified = await MFAService.verifyAndEnableTOTP(userId, token);

            if (verified) {
                res.json({
                    success: true,
                    message: 'TOTP enabled successfully',
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Invalid TOTP token',
                });
            }
        } catch (error: any) {
            logger.error('Error verifying TOTP:', error);
            
            if (error instanceof z.ZodError) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid input data',
                    errors: error.errors,
                });
                return;
            }

            res.status(500).json({
                success: false,
                message: 'Failed to verify TOTP',
                error: error.message,
            });
        }
    }

    /**
     * Send email MFA code
     */
    static async sendEmailCode(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id || req.user?._id || req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required. Please log in to send email verification codes.',
                });
                return;
            }

            await MFAService.sendEmailCode(userId);

            res.json({
                success: true,
                message: 'Verification code sent to your email',
            });
        } catch (error: any) {
            logger.error('Error sending email code:', error);
            
            if (error.message.includes('wait') || error.message.includes('attempts')) {
                res.status(429).json({
                    success: false,
                    message: error.message,
                });
                return;
            }

            res.status(500).json({
                success: false,
                message: 'Failed to send verification code',
                error: error.message,
            });
        }
    }

    /**
     * Verify email MFA code and enable email MFA
     */
    static async verifyAndEnableEmailMFA(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            const { code } = verifyEmailCodeSchema.parse(req.body);

            const verified = await MFAService.verifyEmailCode(userId, code);

            if (verified) {
                await MFAService.enableEmailMFA(userId);
                
                res.json({
                    success: true,
                    message: 'Email MFA enabled successfully',
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Invalid or expired verification code',
                });
            }
        } catch (error: any) {
            logger.error('Error verifying email code:', error);
            
            if (error instanceof z.ZodError) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid input data',
                    errors: error.errors,
                });
                return;
            }

            res.status(500).json({
                success: false,
                message: 'Failed to verify email code',
                error: error.message,
            });
        }
    }

    /**
     * Verify MFA during login (for both email and TOTP)
     */
    static async verifyMFA(req: any, res: Response): Promise<void> {
        try {
            const { mfaToken, method, code, rememberDevice, deviceName } = req.body;

            if (!mfaToken || !method || !code) {
                res.status(400).json({
                    success: false,
                    message: 'Missing required fields',
                });
                return;
            }

            // Verify MFA token
            let tokenPayload;
            try {
                tokenPayload = AuthService.verifyMFAToken(mfaToken);
            } catch (error) {
                res.status(401).json({
                    success: false,
                    message: 'Invalid or expired MFA token',
                });
                return;
            }

            const userId = tokenPayload.userId;
            let verified = false;

            if (method === 'email') {
                verified = await MFAService.verifyEmailCode(userId, code);
            } else if (method === 'totp') {
                verified = await MFAService.verifyTOTP(userId, code);
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Invalid MFA method',
                });
                return;
            }

            if (verified) {
                // Get user and complete login
                const user = await User.findById(userId);
                if (!user) {
                    res.status(404).json({
                        success: false,
                        message: 'User not found',
                    });
                    return;
                }

                // Complete the login process
                const { tokens } = await AuthService.completeLogin(user);

                // Check if user wants to remember device
                if (rememberDevice === true) {
                    const userAgent = req.headers['user-agent'] || 'Unknown';
                    const ipAddress = req.ip || req.connection.remoteAddress || 'Unknown';
                    const deviceId = MFAService.generateDeviceId(userAgent, ipAddress);
                    const finalDeviceName = deviceName || 'Unknown Device';

                    await MFAService.addTrustedDevice(userId, {
                        deviceId,
                        deviceName: finalDeviceName,
                        userAgent,
                        ipAddress,
                    });
                }

                // Set refresh token as httpOnly cookie
                res.cookie('refreshToken', tokens.refreshToken, {
                    httpOnly: true,
                    secure: config.env === 'production',
                    sameSite: 'strict',
                    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
                });

                res.json({
                    success: true,
                    message: 'MFA verification successful',
                    data: {
                        user: {
                            id: (user as any)._id,
                            email: user.email,
                            name: user.name,
                            role: user.role,
                            emailVerified: user.emailVerified,
                            subscription: user.subscription,
                        },
                        accessToken: tokens.accessToken,
                        refreshToken: tokens.refreshToken,
                        trustedDevice: rememberDevice === true,
                    },
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Invalid verification code',
                });
            }
        } catch (error: any) {
            logger.error('Error verifying MFA:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to verify MFA',
                error: error.message,
            });
        }
    }

    /**
     * Disable MFA method
     */
    static async disableMFA(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            const { method } = disableMFASchema.parse(req.body);

            await MFAService.disableMFAMethod(userId, method);

            res.json({
                success: true,
                message: `${method.toUpperCase()} MFA disabled successfully`,
            });
        } catch (error: any) {
            logger.error('Error disabling MFA:', error);
            
            if (error instanceof z.ZodError) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid input data',
                    errors: error.errors,
                });
                return;
            }

            res.status(500).json({
                success: false,
                message: 'Failed to disable MFA',
                error: error.message,
            });
        }
    }

    /**
     * Add trusted device
     */
    static async addTrustedDevice(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            const { deviceName } = addTrustedDeviceSchema.parse(req.body);

            const userAgent = req.headers['user-agent'] || 'Unknown';
            const ipAddress = req.ip || req.connection.remoteAddress || 'Unknown';
            const deviceId = MFAService.generateDeviceId(userAgent, ipAddress);

            await MFAService.addTrustedDevice(userId, {
                deviceId,
                deviceName,
                userAgent,
                ipAddress,
            });

            res.json({
                success: true,
                message: 'Device added to trusted devices',
                data: {
                    deviceId,
                    deviceName,
                },
            });
        } catch (error: any) {
            logger.error('Error adding trusted device:', error);
            
            if (error instanceof z.ZodError) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid input data',
                    errors: error.errors,
                });
                return;
            }

            res.status(500).json({
                success: false,
                message: 'Failed to add trusted device',
                error: error.message,
            });
        }
    }

    /**
     * Remove trusted device
     */
    static async removeTrustedDevice(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            const { deviceId } = removeTrustedDeviceSchema.parse(req.body);

            await MFAService.removeTrustedDevice(userId, deviceId);

            res.json({
                success: true,
                message: 'Device removed from trusted devices',
            });
        } catch (error: any) {
            logger.error('Error removing trusted device:', error);
            
            if (error instanceof z.ZodError) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid input data',
                    errors: error.errors,
                });
                return;
            }

            res.status(500).json({
                success: false,
                message: 'Failed to remove trusted device',
                error: error.message,
            });
        }
    }

    /**
     * Check if current device is trusted
     */
    static async checkTrustedDevice(req: any, res: Response): Promise<void> {
        try {
            const userId = req.user?.id || req.userId;
            if (!userId) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            const userAgent = req.headers['user-agent'] || 'Unknown';
            const ipAddress = req.ip || req.connection.remoteAddress || 'Unknown';
            const deviceId = MFAService.generateDeviceId(userAgent, ipAddress);

            const isTrusted = await MFAService.isTrustedDevice(userId, deviceId);

            res.json({
                success: true,
                data: {
                    deviceId,
                    isTrusted,
                },
            });
        } catch (error: any) {
            logger.error('Error checking trusted device:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to check trusted device',
                error: error.message,
            });
        }
    }
}
