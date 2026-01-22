import { Response } from 'express';
import { z } from 'zod';
import { MFAService } from '../services/mfa.service';
import { AuthService } from '../services/auth.service';
import { User } from '../models/User';
import { loggingService } from '../services/logging.service';
import { config } from '../config';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

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
    static async getStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('getStatus', req);

        try {
            const status = await MFAService.getMFAStatus(userId);

            ControllerHelper.logRequestSuccess('getStatus', req, startTime, { hasStatus: !!status });

            // Log business event
            loggingService.logBusiness({
                event: 'mfa_status_retrieved',
                category: 'mfa_operations',
                value: Date.now() - startTime,
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
            ControllerHelper.handleError('getStatus', error, req, res, startTime);
        }
    }

    /**
     * Setup TOTP (Time-based One-Time Password) for authenticator apps
     */
    static async setupTOTP(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        const { email } = setupTOTPSchema.parse(req.body);
        
        ControllerHelper.logRequestStart('setupTOTP', req, { email });

        try {
            const result = await MFAService.setupTOTP(userId, email);

            ControllerHelper.logRequestSuccess('setupTOTP', req, startTime, {
                email,
                hasQrCodeUrl: !!result.qrCodeUrl,
                hasBackupCodes: !!result.backupCodes
            });

            // Log business event
            loggingService.logBusiness({
                event: 'totp_setup_completed',
                category: 'mfa_operations',
                value: Date.now() - startTime,
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
            if (error instanceof z.ZodError) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid input data',
                    errors: error.errors,
                });
                return;
            }
            ControllerHelper.handleError('setupTOTP', error, req, res, startTime, { email });
        }
    }

    /**
     * Verify TOTP token and enable TOTP MFA
     */
    static async verifyAndEnableTOTP(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        const { token } = verifyTOTPSchema.parse(req.body);
        
        ControllerHelper.logRequestStart('verifyAndEnableTOTP', req, { hasToken: !!token });

        try {
            const verified = await MFAService.verifyAndEnableTOTP(userId, token);

            if (verified) {
                ControllerHelper.logRequestSuccess('verifyAndEnableTOTP', req, startTime, { verified });

                // Log business event
                loggingService.logBusiness({
                    event: 'totp_verified_and_enabled',
                    category: 'mfa_operations',
                    value: Date.now() - startTime,
                    metadata: {
                        userId,
                        verified
                    }
                });

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
            if (error instanceof z.ZodError) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid input data',
                    errors: error.errors,
                });
                return;
            }
            ControllerHelper.handleError('verifyAndEnableTOTP', error, req, res, startTime);
        }
    }

    /**
     * Send email MFA code
     */
    static async sendEmailCode(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('sendEmailCode', req);

        try {
            await MFAService.sendEmailCode(userId);

            ControllerHelper.logRequestSuccess('sendEmailCode', req, startTime);

            // Log business event
            loggingService.logBusiness({
                event: 'email_mfa_code_sent',
                category: 'mfa_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId
                }
            });

            res.json({
                success: true,
                message: 'Verification code sent to your email',
            });
        } catch (error: any) {
            if (error.message.includes('wait') || error.message.includes('attempts')) {
                res.status(429).json({
                    success: false,
                    message: error.message,
                });
                return;
            }
            ControllerHelper.handleError('sendEmailCode', error, req, res, startTime);
        }
    }

    /**
     * Verify email MFA code and enable email MFA
     */
    static async verifyAndEnableEmailMFA(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        const { code } = verifyEmailCodeSchema.parse(req.body);
        
        ControllerHelper.logRequestStart('verifyAndEnableEmailMFA', req, { hasCode: !!code });

        try {
            const verified = await MFAService.verifyEmailCode(userId, code);

            if (verified) {
                await MFAService.enableEmailMFA(userId);

                ControllerHelper.logRequestSuccess('verifyAndEnableEmailMFA', req, startTime, { verified });

                // Log business event
                loggingService.logBusiness({
                    event: 'email_mfa_verified_and_enabled',
                    category: 'mfa_operations',
                    value: Date.now() - startTime,
                    metadata: {
                        userId,
                        verified
                    }
                });
                
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
            if (error instanceof z.ZodError) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid input data',
                    errors: error.errors,
                });
                return;
            }
            ControllerHelper.handleError('verifyAndEnableEmailMFA', error, req, res, startTime);
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

                // Get device info for session creation
                const { userAgent, ipAddress } = MFAController.getDeviceInfo(req);
                const deviceInfo = { userAgent, ipAddress };
                
                // Complete the login process
                const { tokens } = await AuthService.completeLogin(user, deviceInfo);

                // Ensure role field is present (fallback to 'user' only if truly missing)
                // Check if role is undefined or null - preserve existing 'admin' or 'user' values
                let userRole = user.role;
                if (!userRole) {
                    // Only set to 'user' if role is truly missing
                    userRole = 'user';
                    user.role = 'user';
                    await user.save().catch((err: unknown) => {
                        loggingService.warn('Failed to update user role in database during MFA verification', {
                            userId,
                            error: err instanceof Error ? err.message : String(err)
                        });
                    });
                }

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
                            role: userRole,
                            emailVerified: user.emailVerified,
                            subscriptionId: user.subscriptionId,
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
            ControllerHelper.handleError('verifyMFA', error, req, res, startTime, {
                method,
                rememberDevice: req.body.rememberDevice
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
    static async removeTrustedDevice(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        const { deviceId } = removeTrustedDeviceSchema.parse(req.body);
        
        ControllerHelper.logRequestStart('removeTrustedDevice', req, { deviceId });

        try {
            await MFAService.removeTrustedDevice(userId, deviceId);

            ControllerHelper.logRequestSuccess('removeTrustedDevice', req, startTime, { deviceId });

            // Log business event
            loggingService.logBusiness({
                event: 'trusted_device_removed',
                category: 'mfa_operations',
                value: Date.now() - startTime,
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
            if (error instanceof z.ZodError) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid input data',
                    errors: error.errors,
                });
                return;
            }
            ControllerHelper.handleError('removeTrustedDevice', error, req, res, startTime, { deviceId });
        }
    }

    /**
     * Check if current device is trusted
     */
    static async checkTrustedDevice(req: AuthenticatedRequest, res: Response): Promise<void> {
        const startTime = Date.now();
        
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        
        ControllerHelper.logRequestStart('checkTrustedDevice', req);

        try {
            const { deviceId, userAgent, ipAddress } = MFAController.getDeviceInfo(req);

            const isTrusted = await MFAService.isTrustedDevice(userId, deviceId);

            ControllerHelper.logRequestSuccess('checkTrustedDevice', req, startTime, {
                deviceId,
                isTrusted
            });

            // Log business event
            loggingService.logBusiness({
                event: 'trusted_device_check_completed',
                category: 'mfa_operations',
                value: Date.now() - startTime,
                metadata: {
                    userId,
                    deviceId,
                    isTrusted
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
            ControllerHelper.handleError('checkTrustedDevice', error, req, res, startTime);
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
