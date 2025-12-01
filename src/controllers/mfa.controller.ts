import { Response } from 'express';
import { z } from 'zod';
import { MFAService } from '../services/mfa.service';
import { AuthService } from '../services/auth.service';
import { User } from '../models/User';
import { loggingService } from '../services/logging.service';
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
    // Device ID memoization per request
    private static deviceIdCache = new Map<string, string>();
    /**
     * Get MFA status for the current user
     */
    static async getStatus(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const userId = req.user?.id || req.user?._id || req.userId;

        try {
            loggingService.info('MFA status retrieval initiated', {
                userId,
                hasUserId: !!userId,
                userSource: req.user?.id ? 'req.user.id' : req.user?._id ? 'req.user._id' : req.userId ? 'req.userId' : 'none',
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('MFA status retrieval failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    message: 'Authentication required. Please log in to access MFA settings.',
                });
                return;
            }

            loggingService.info('MFA status retrieval processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            const status = await MFAService.getMFAStatus(userId);

            const duration = Date.now() - startTime;

            loggingService.info('MFA status retrieved successfully', {
                userId,
                duration,
                hasStatus: !!status,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'mfa_status_retrieved',
                category: 'mfa_operations',
                value: duration,
                metadata: {
                    userId,
                    hasStatus: !!status
                }
            });

            res.json({
                success: true,
                data: status,
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('MFA status retrieval failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const userId = req.user?.id || req.userId;
        const { email } = setupTOTPSchema.parse(req.body);

        try {
            loggingService.info('TOTP setup initiated', {
                userId,
                hasUserId: !!userId,
                email,
                hasEmail: !!email,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('TOTP setup failed - authentication required', {
                    email,
                    hasEmail: !!email,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            loggingService.info('TOTP setup processing started', {
                userId,
                email,
                requestId: req.headers['x-request-id'] as string
            });

            const result = await MFAService.setupTOTP(userId, email);

            const duration = Date.now() - startTime;

            loggingService.info('TOTP setup completed successfully', {
                userId,
                email,
                duration,
                hasQrCodeUrl: !!result.qrCodeUrl,
                hasBackupCodes: !!result.backupCodes,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'totp_setup_completed',
                category: 'mfa_operations',
                value: duration,
                metadata: {
                    userId,
                    email,
                    hasQrCodeUrl: !!result.qrCodeUrl,
                    hasBackupCodes: !!result.backupCodes
                }
            });

            res.json({
                success: true,
                message: 'TOTP setup initiated. Scan the QR code with your authenticator app.',
                data: {
                    qrCodeUrl: result.qrCodeUrl,
                    backupCodes: result.backupCodes,
                },
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('TOTP setup failed', {
                userId,
                email,
                hasEmail: !!email,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });
            
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
        const startTime = Date.now();
        const userId = req.user?.id || req.userId;
        const { token } = verifyTOTPSchema.parse(req.body);

        try {
            loggingService.info('TOTP verification and enablement initiated', {
                userId,
                hasUserId: !!userId,
                hasToken: !!token,
                tokenLength: token?.length,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('TOTP verification and enablement failed - authentication required', {
                    hasToken: !!token,
                    tokenLength: token?.length,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            loggingService.info('TOTP verification and enablement processing started', {
                userId,
                hasToken: !!token,
                tokenLength: token?.length,
                requestId: req.headers['x-request-id'] as string
            });

            const verified = await MFAService.verifyAndEnableTOTP(userId, token);

            const duration = Date.now() - startTime;

            if (verified) {
                loggingService.info('TOTP verification and enablement completed successfully', {
                    userId,
                    hasToken: !!token,
                    tokenLength: token?.length,
                    duration,
                    verified,
                    requestId: req.headers['x-request-id'] as string
                });

                // Log business event
                loggingService.logBusiness({
                    event: 'totp_verified_and_enabled',
                    category: 'mfa_operations',
                    value: duration,
                    metadata: {
                        userId,
                        hasToken: !!token,
                        tokenLength: token?.length,
                        verified
                    }
                });

                res.json({
                    success: true,
                    message: 'TOTP enabled successfully',
                });
            } else {
                loggingService.warn('TOTP verification and enablement failed - invalid token', {
                    userId,
                    hasToken: !!token,
                    tokenLength: token?.length,
                    duration,
                    verified,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Invalid TOTP token',
                });
            }
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('TOTP verification and enablement failed', {
                userId,
                hasToken: !!token,
                tokenLength: token?.length,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });
            
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
        const startTime = Date.now();
        const userId = req.user?.id || req.user?._id || req.userId;

        try {
            loggingService.info('Email MFA code sending initiated', {
                userId,
                hasUserId: !!userId,
                userSource: req.user?.id ? 'req.user.id' : req.user?._id ? 'req.user._id' : req.userId ? 'req.userId' : 'none',
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Email MFA code sending failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    message: 'Authentication required. Please log in to send email verification codes.',
                });
                return;
            }

            loggingService.info('Email MFA code sending processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            await MFAService.sendEmailCode(userId);

            const duration = Date.now() - startTime;

            loggingService.info('Email MFA code sent successfully', {
                userId,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'email_mfa_code_sent',
                category: 'mfa_operations',
                value: duration,
                metadata: {
                    userId
                }
            });

            res.json({
                success: true,
                message: 'Verification code sent to your email',
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Email MFA code sending failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });
            
            if (error.message.includes('wait') || error.message.includes('attempts')) {
                loggingService.warn('Email MFA code sending rate limited', {
                    userId,
                    error: error.message,
                    duration,
                    requestId: req.headers['x-request-id'] as string
                });

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
        const startTime = Date.now();
        const userId = req.user?.id || req.userId;
        const { code } = verifyEmailCodeSchema.parse(req.body);

        try {
            loggingService.info('Email MFA verification and enablement initiated', {
                userId,
                hasUserId: !!userId,
                hasCode: !!code,
                codeLength: code?.length,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Email MFA verification and enablement failed - authentication required', {
                    hasCode: !!code,
                    codeLength: code?.length,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            loggingService.info('Email MFA verification and enablement processing started', {
                userId,
                hasCode: !!code,
                codeLength: code?.length,
                requestId: req.headers['x-request-id'] as string
            });

            const verified = await MFAService.verifyEmailCode(userId, code);

            if (verified) {
                await MFAService.enableEmailMFA(userId);

                const duration = Date.now() - startTime;

                loggingService.info('Email MFA verification and enablement completed successfully', {
                    userId,
                    hasCode: !!code,
                    codeLength: code?.length,
                    duration,
                    verified,
                    requestId: req.headers['x-request-id'] as string
                });

                // Log business event
                loggingService.logBusiness({
                    event: 'email_mfa_verified_and_enabled',
                    category: 'mfa_operations',
                    value: duration,
                    metadata: {
                        userId,
                        hasCode: !!code,
                        codeLength: code?.length,
                        verified
                    }
                });
                
                res.json({
                    success: true,
                    message: 'Email MFA enabled successfully',
                });
            } else {
                const duration = Date.now() - startTime;

                loggingService.warn('Email MFA verification and enablement failed - invalid code', {
                    userId,
                    hasCode: !!code,
                    codeLength: code?.length,
                    duration,
                    verified,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Invalid or expired verification code',
                });
            }
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Email MFA verification and enablement failed', {
                userId,
                hasCode: !!code,
                codeLength: code?.length,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });
            
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
        const startTime = Date.now();
        const { mfaToken, method, code, rememberDevice, deviceName } = req.body;

        try {
            loggingService.info('MFA verification during login initiated', {
                hasMfaToken: !!mfaToken,
                method,
                hasMethod: !!method,
                hasCode: !!code,
                codeLength: code?.length,
                rememberDevice,
                hasDeviceName: !!deviceName,
                requestId: req.headers['x-request-id'] as string
            });

            if (!mfaToken || !method || !code) {
                loggingService.warn('MFA verification during login failed - missing required fields', {
                    hasMfaToken: !!mfaToken,
                    method,
                    hasMethod: !!method,
                    hasCode: !!code,
                    codeLength: code?.length,
                    requestId: req.headers['x-request-id'] as string
                });

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
            } catch (error: any) {
                loggingService.warn('MFA verification during login failed - invalid MFA token', {
                    method,
                    hasCode: !!code,
                    codeLength: code?.length,
                    error: error.message || 'Unknown error',
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    message: 'Invalid or expired MFA token',
                });
                return;
            }

            const userId = tokenPayload.userId;
            let verified = false;

            loggingService.info('MFA verification processing started', {
                userId,
                method,
                hasCode: !!code,
                codeLength: code?.length,
                rememberDevice,
                hasDeviceName: !!deviceName,
                requestId: req.headers['x-request-id'] as string
            });

            if (method === 'email') {
                verified = await MFAService.verifyEmailCode(userId, code);
            } else if (method === 'totp') {
                verified = await MFAService.verifyTOTP(userId, code);
            } else {
                loggingService.warn('MFA verification during login failed - invalid MFA method', {
                    userId,
                    method,
                    hasCode: !!code,
                    codeLength: code?.length,
                    requestId: req.headers['x-request-id'] as string
                });

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
                    loggingService.warn('MFA verification during login failed - user not found', {
                        userId,
                        method,
                        hasCode: !!code,
                        codeLength: code?.length,
                        requestId: req.headers['x-request-id'] as string
                    });

                    res.status(404).json({
                        success: false,
                        message: 'User not found',
                    });
                    return;
                }

                // Complete the login process
                const { tokens } = await AuthService.completeLogin(user);

                // Check if user wants to remember device
                let trustedDeviceAdded = false;
                if (rememberDevice === true) {
                    const { deviceId, userAgent, ipAddress } = MFAController.getDeviceInfo(req);
                    const finalDeviceName = deviceName || 'Unknown Device';

                    await MFAService.addTrustedDevice(userId, {
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
                    secure: config.env === 'production',
                    sameSite: 'strict',
                    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
                });

                const duration = Date.now() - startTime;

                loggingService.info('MFA verification during login completed successfully', {
                    userId,
                    method,
                    hasCode: !!code,
                    codeLength: code?.length,
                    duration,
                    verified,
                    hasUser: !!user,
                    hasTokens: !!tokens,
                    trustedDeviceAdded,
                    requestId: req.headers['x-request-id'] as string
                });

                // Log business event
                loggingService.logBusiness({
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
                        trustedDeviceAdded
                    }
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
                            subscriptionId: user.subscriptionId,
                        },
                        accessToken: tokens.accessToken,
                        refreshToken: tokens.refreshToken,
                        trustedDevice: rememberDevice === true,
                    },
                });
            } else {
                const duration = Date.now() - startTime;

                loggingService.warn('MFA verification during login failed - invalid verification code', {
                    userId,
                    method,
                    hasCode: !!code,
                    codeLength: code?.length,
                    duration,
                    verified,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Invalid verification code',
                });
            }
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('MFA verification during login failed', {
                method,
                hasCode: !!req.body.code,
                codeLength: req.body.code?.length,
                rememberDevice: req.body.rememberDevice,
                hasDeviceName: !!req.body.deviceName,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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
        const startTime = Date.now();
        const userId = req.user?.id || req.userId;
        const { method } = disableMFASchema.parse(req.body);

        try {
            loggingService.info('MFA disablement initiated', {
                userId,
                hasUserId: !!userId,
                method,
                hasMethod: !!method,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('MFA disablement failed - authentication required', {
                    method,
                    hasMethod: !!method,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            loggingService.info('MFA disablement processing started', {
                userId,
                method,
                requestId: req.headers['x-request-id'] as string
            });

            await MFAService.disableMFAMethod(userId, method);

            const duration = Date.now() - startTime;

            loggingService.info('MFA disablement completed successfully', {
                userId,
                method,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'mfa_method_disabled',
                category: 'mfa_operations',
                value: duration,
                metadata: {
                    userId,
                    method
                }
            });

            res.json({
                success: true,
                message: `${method.toUpperCase()} MFA disabled successfully`,
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('MFA disablement failed', {
                userId,
                method,
                hasMethod: !!method,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });
            
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
        const startTime = Date.now();
        const userId = req.user?.id || req.userId;
        const { deviceName } = addTrustedDeviceSchema.parse(req.body);

        try {
            loggingService.info('Trusted device addition initiated', {
                userId,
                hasUserId: !!userId,
                deviceName,
                hasDeviceName: !!deviceName,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Trusted device addition failed - authentication required', {
                    deviceName,
                    hasDeviceName: !!deviceName,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            loggingService.info('Trusted device addition processing started', {
                userId,
                deviceName,
                requestId: req.headers['x-request-id'] as string
            });

            const { deviceId, userAgent, ipAddress } = MFAController.getDeviceInfo(req);

            await MFAService.addTrustedDevice(userId, {
                deviceId,
                deviceName,
                userAgent,
                ipAddress,
            });

            const duration = Date.now() - startTime;

            loggingService.info('Trusted device added successfully', {
                userId,
                deviceName,
                duration,
                deviceId,
                hasUserAgent: !!userAgent,
                hasIpAddress: !!ipAddress,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'trusted_device_added',
                category: 'mfa_operations',
                value: duration,
                metadata: {
                    userId,
                    deviceName,
                    deviceId,
                    hasUserAgent: !!userAgent,
                    hasIpAddress: !!ipAddress
                }
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Trusted device addition failed', {
                userId,
                deviceName,
                hasDeviceName: !!deviceName,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });
            
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
        const startTime = Date.now();
        const userId = req.user?.id || req.userId;
        const { deviceId } = removeTrustedDeviceSchema.parse(req.body);

        try {
            loggingService.info('Trusted device removal initiated', {
                userId,
                hasUserId: !!userId,
                deviceId,
                hasDeviceId: !!deviceId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Trusted device removal failed - authentication required', {
                    deviceId,
                    hasDeviceId: !!deviceId,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            loggingService.info('Trusted device removal processing started', {
                userId,
                deviceId,
                requestId: req.headers['x-request-id'] as string
            });

            await MFAService.removeTrustedDevice(userId, deviceId);

            const duration = Date.now() - startTime;

            loggingService.info('Trusted device removed successfully', {
                userId,
                deviceId,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'trusted_device_removed',
                category: 'mfa_operations',
                value: duration,
                metadata: {
                    userId,
                    deviceId
                }
            });

            res.json({
                success: true,
                message: 'Device removed from trusted devices',
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Trusted device removal failed', {
                userId,
                deviceId,
                hasDeviceId: !!deviceId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });
            
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
        const startTime = Date.now();
        const userId = req.user?.id || req.userId;

        try {
            loggingService.info('Trusted device check initiated', {
                userId,
                hasUserId: !!userId,
                requestId: req.headers['x-request-id'] as string
            });

            if (!userId) {
                loggingService.warn('Trusted device check failed - authentication required', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
                return;
            }

            loggingService.info('Trusted device check processing started', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            const { deviceId, userAgent, ipAddress } = MFAController.getDeviceInfo(req);

            const isTrusted = await MFAService.isTrustedDevice(userId, deviceId);

            const duration = Date.now() - startTime;

            loggingService.info('Trusted device check completed successfully', {
                userId,
                duration,
                deviceId,
                isTrusted,
                hasUserAgent: !!userAgent,
                hasIpAddress: !!ipAddress,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'trusted_device_check_completed',
                category: 'mfa_operations',
                value: duration,
                metadata: {
                    userId,
                    deviceId,
                    isTrusted,
                    hasUserAgent: !!userAgent,
                    hasIpAddress: !!ipAddress
                }
            });

            res.json({
                success: true,
                data: {
                    deviceId,
                    isTrusted,
                },
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Trusted device check failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            res.status(500).json({
                success: false,
                message: 'Failed to check trusted device',
                error: error.message,
            });
        }
    }

    // ============================================================================
    // OPTIMIZATION UTILITY METHODS
    // ============================================================================

    /**
     * Get device information with memoization
     */
    private static getDeviceInfo(req: any): { deviceId: string; userAgent: string; ipAddress: string } {
        const userAgent = req.headers['user-agent'] || 'Unknown';
        const ipAddress = req.ip || req.connection.remoteAddress || 'Unknown';
        
        // Create cache key for this request
        const cacheKey = `${userAgent}-${ipAddress}`;
        
        let deviceId = MFAController.deviceIdCache.get(cacheKey);
        if (!deviceId) {
            deviceId = MFAService.generateDeviceId(userAgent, ipAddress);
            MFAController.deviceIdCache.set(cacheKey, deviceId);
            
            // Clean cache periodically (keep last 100 entries)
            if (MFAController.deviceIdCache.size > 100) {
                const firstKey = MFAController.deviceIdCache.keys().next().value;
                MFAController.deviceIdCache.delete(firstKey || '');
            }
        }

        return { deviceId, userAgent, ipAddress };
    }
}
