import { Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { registerSchema, loginSchema } from '../utils/validators';
import { loggingService } from '../services/logging.service';
import { config } from '../config';
import { User } from '../models/User';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export interface IUser {
    _id?: string;
    email: string;
    password: string;
    name: string;
    avatar?: string;
    role: 'user' | 'admin';
    apiKeys: Array<{
        service: string;
        key: string;
        encryptedKey?: string;
        addedAt: Date;
    }>;
    preferences: {
        emailAlerts: boolean;
        alertThreshold: number;
        optimizationSuggestions: boolean;
    };
    subscription: {
        plan: 'free' | 'pro' | 'enterprise';
        startDate: Date;
        endDate?: Date;
        limits: {
            apiCalls: number;
            optimizations: number;
        };
    };
    usage: {
        currentMonth: {
            apiCalls: number;
            totalCost: number;
            optimizationsSaved: number;
        };
    };
    isActive: boolean;
    emailVerified: boolean;
    verificationToken?: string;
    resetPasswordToken?: string;
    resetPasswordExpires?: Date;
    lastLogin?: Date;
    createdAt: Date;
    updatedAt: Date;
    comparePassword(candidatePassword: string): Promise<boolean>;
}

export class AuthController {
    static async register(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { email, name } = req.body;

        ControllerHelper.logRequestStart('register', req, { email, name });

        try {

            // Validate input
            const validatedData = registerSchema.parse(req.body);

            // Register user (extract required fields)
            const { user, tokens } = await AuthService.register({
                email: validatedData.email,
                password: validatedData.password,
                name: validatedData.name
            });

            // Ensure role field is present (fallback to 'user' only if truly missing)
            // Check if role is undefined or null - preserve existing 'admin' or 'user' values
            let userRole = user.role;
            if (!userRole) {
                // Only set to 'user' if role is truly missing
                userRole = 'user';
                const userDoc = user as any as InstanceType<typeof User>;
                userDoc.role = 'user';
                await userDoc.save().catch((err: unknown) => {
                    loggingService.warn('Failed to update user role in database during registration', {
                        userId: (user as any)._id,
                        error: err instanceof Error ? err.message : String(err)
                    });
                });
            }

            const duration = Date.now() - startTime;

            loggingService.info('User registration completed successfully', {
                email,
                name,
                userId: (user as any)._id,
                role: userRole,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'user_registered',
                category: 'user_management',
                value: duration,
                metadata: {
                    email,
                    name,
                    userId: (user as any)._id,
                    role: userRole
                }
            });

            // Set refresh token as httpOnly cookie
            res.cookie('refreshToken', tokens.refreshToken, {
                httpOnly: true,
                secure: config.env === 'production',
                sameSite: 'strict',
                maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            });

            res.status(201).json({
                success: true,
                message: 'Registration successful. Please verify your email.',
                data: {
                    user: {
                        id: (user as any)._id,
                        email: user.email,
                        name: user.name,
                        role: userRole,
                    },
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                },
            });
        } catch (error: unknown) {
            const duration = Date.now() - startTime;
            
            loggingService.error('User registration failed', {
                email,
                name,
                error: (error as Error).message || 'Unknown error',
                stack: (error as Error).stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            if ((error as Error).message.includes('already exists')) {
                res.status(409).json({
                    success: false,
                    message: 'User with this email already exists',
                });
                return;
            }

            next(error);
        }
        return;
    }

    static async login(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { email } = req.body;

        ControllerHelper.logRequestStart('login', req, { email });

        try {

            // Validate input
            const { email: validatedEmail, password } = loginSchema.parse(req.body);

            // Get device info
            const userAgent = req.headers['user-agent'] || 'Unknown';
            const ipAddress = req.ip || req.connection.remoteAddress || 'Unknown';

            loggingService.info('Login validation passed, proceeding with authentication', {
                email: validatedEmail,
                userAgent,
                ipAddress,
                requestId: req.headers['x-request-id'] as string
            });

            // Login user
            const result = await AuthService.login(validatedEmail, password, { userAgent, ipAddress });

            // Check if MFA is required
            if (result.requiresMFA) {
                const duration = Date.now() - startTime;

                loggingService.info('Login requires MFA verification', {
                    email: validatedEmail,
                    userId: (result.user as any)._id,
                    mfaMethods: result.user.mfa.methods,
                    duration,
                    requestId: req.headers['x-request-id'] as string
                });

                res.json({
                    success: true,
                    message: 'MFA verification required',
                    data: {
                        requiresMFA: true,
                        mfaToken: result.mfaToken,
                        userId: (result.user as any)._id,
                        availableMethods: result.user.mfa.methods,
                    },
                });
                return;
            }

            // Complete login (no MFA required)
            const { user, tokens } = result as { user: any; tokens: any };

            // Ensure role field is present (fallback to 'user' only if truly missing)
            // Check if role is undefined or null - preserve existing 'admin' or 'user' values
            let userRole = user.role;
            if (!userRole) {
                // Only set to 'user' if role is truly missing
                userRole = 'user';
                const userDoc = user as any as InstanceType<typeof User>;
                userDoc.role = 'user';
                await userDoc.save().catch((err: unknown) => {
                    loggingService.warn('Failed to update user role in database during login', {
                        userId: user._id,
                        error: err instanceof Error ? err.message : String(err)
                    });
                });
            }

            const duration = Date.now() - startTime;

            loggingService.info('User login completed successfully', {
                email: validatedEmail,
                userId: user._id,
                role: userRole,
                emailVerified: user.emailVerified,
                duration,
                userAgent,
                ipAddress,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'user_logged_in',
                category: 'user_management',
                value: duration,
                metadata: {
                    email: validatedEmail,
                    userId: user._id,
                    role: userRole,
                    emailVerified: user.emailVerified,
                    userAgent,
                    ipAddress
                }
            });

            // Set refresh token as httpOnly cookie
            res.cookie('refreshToken', tokens.refreshToken, {
                httpOnly: true,
                secure: config.env === 'production',
                sameSite: 'strict',
                maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            });

            res.json({
                success: true,
                message: 'Login successful',
                data: {
                    user: {
                        id: user._id,
                        email: user.email,
                        name: user.name,
                        role: userRole,
                        emailVerified: user.emailVerified,
                        subscription: user.subscription,
                        preferences: user.preferences,
                        usage: user.usage,
                        onboarding: user.onboarding,
                        createdAt: user.createdAt,
                        lastLogin: user.lastLogin,
                        avatar: user.avatar,
                        company: user.company,
                    },
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                },
            });
        } catch (error: any) {
            if (error.message === 'Invalid credentials') {
                res.status(401).json({
                    success: false,
                    message: 'Invalid email or password',
                });
                return;
            }

            if (error.message === 'Account is deactivated') {
                res.status(403).json({
                    success: false,
                    message: 'Your account has been deactivated',
                });
                return;
            }

            ControllerHelper.handleError('login', error, req, res, startTime, { email });
            next(error);
        }
        return;
    }

    static async refreshTokens(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const { refreshToken } = req.cookies;

        try {
            loggingService.info('Token refresh initiated', {
                hasRefreshToken: !!refreshToken,
                requestId: req.headers['x-request-id'] as string
            });

            if (!refreshToken) {
                loggingService.warn('Token refresh failed - no refresh token provided', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(401).json({
                    success: false,
                    message: 'Refresh token not provided',
                });
                return;
            }

            // Refresh tokens
            const tokens = await AuthService.refreshTokens(refreshToken);

            const duration = Date.now() - startTime;

            loggingService.info('Token refresh completed successfully', {
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'tokens_refreshed',
                category: 'user_management',
                value: duration,
                metadata: {
                    hasRefreshToken: true
                }
            });

            // Set new refresh token
            res.cookie('refreshToken', tokens.refreshToken, {
                httpOnly: true,
                secure: config.env === 'production',
                sameSite: 'strict',
                maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
            });

            res.json({
                success: true,
                data: {
                    accessToken: tokens.accessToken,
                },
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Token refresh failed', {
                hasRefreshToken: !!refreshToken,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Clear invalid refresh token
            res.clearCookie('refreshToken');

            res.status(401).json({
                success: false,
                message: 'Invalid or expired refresh token',
            });
        }
        return;
    }

    static async logout(req: any, res: Response): Promise<any> {
        const startTime = Date.now();
        const userId = req.user?.id || 'unknown';
        const userSessionId = req.user?.jti;

        try {
            loggingService.info('User logout initiated', {
                userId,
                userSessionId,
                requestId: req.headers['x-request-id'] as string
            });

            // Revoke current user session if sessionId is available
            if (userSessionId) {
                try {
                    const { UserSessionService } = await import('../services/userSession.service');
                    await UserSessionService.revokeUserSession(userId, userSessionId);
                } catch (sessionError) {
                    // Don't fail logout if session revocation fails
                    loggingService.warn('Error revoking user session on logout', {
                        userId,
                        userSessionId,
                        error: sessionError instanceof Error ? sessionError.message : String(sessionError)
                    });
                }
            }

            res.clearCookie('refreshToken');

            const duration = Date.now() - startTime;

            loggingService.info('User logout completed successfully', {
                userId,
                userSessionId,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'user_logged_out',
                category: 'user_management',
                value: duration,
                metadata: {
                    userId,
                    userSessionId
                }
            });

            return res.json({
                success: true,
                message: 'Logout successful',
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('User logout failed', {
                userId,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Still try to clear cookie and return success
            res.clearCookie('refreshToken');
            return res.json({
                success: true,
                message: 'Logout successful',
            });
        }
    }

    static async verifyEmail(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { token } = req.params;

        try {
            loggingService.info('Email verification initiated', {
                hasToken: !!token,
                requestId: req.headers['x-request-id'] as string
            });

            if (!token) {
                loggingService.warn('Email verification failed - no token provided', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Verification token is required',
                });
                return;
            }

            await AuthService.verifyEmail(token);

            const duration = Date.now() - startTime;

            loggingService.info('Email verification completed successfully', {
                hasToken: true,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'email_verified',
                category: 'user_management',
                value: duration,
                metadata: {
                    hasToken: true
                }
            });

            res.json({
                success: true,
                message: 'Email verified successfully',
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Email verification failed', {
                hasToken: !!token,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            if (error.message === 'Invalid verification token') {
                res.status(400).json({
                    success: false,
                    message: 'Invalid or expired verification token',
                });
                return;
            }

            next(error);
        }
        return;
    }

    static async forgotPassword(req: any, res: Response): Promise<void> {
        const startTime = Date.now();
        const { email } = req.body;

        try {
            loggingService.info('Forgot password request initiated', {
                email,
                requestId: req.headers['x-request-id'] as string
            });

            if (!email) {
                loggingService.warn('Forgot password failed - no email provided', {
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Email is required',
                });
                return;
            }

            const resetToken = await AuthService.forgotPassword(email);

            const duration = Date.now() - startTime;

            loggingService.info('Forgot password request completed successfully', {
                email,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'forgot_password_requested',
                category: 'user_management',
                value: duration,
                metadata: {
                    email
                }
            });

            // In production, send email with reset link
            // For development, return token in response
            const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

            res.json({
                success: true,
                message: 'Password reset instructions sent to your email',
                ...(config.env === 'development' && { resetUrl }),
            });
        } catch (error: any) {
            // Don't reveal if user exists or not
            res.json({
                success: true,
                message: 'If an account exists with this email, password reset instructions have been sent',
            });
        }
        return;
    }

    static async resetPassword(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { token } = req.params;
        const { password } = req.body;

        ControllerHelper.logRequestStart('resetPassword', req, {
            hasToken: !!token,
            hasPassword: !!password,
            passwordLength: password?.length || 0
        });

        try {

            if (!token || !password) {
                res.status(400).json({
                    success: false,
                    message: 'Token and password are required',
                });
                return;
            }

            if (password.length < 8) {
                res.status(400).json({
                    success: false,
                    message: 'Password must be at least 8 characters',
                });
                return;
            }

            await AuthService.resetPassword(token, password);

            ControllerHelper.logRequestSuccess('resetPassword', req, startTime, {
                hasToken: true,
                passwordLength: password.length
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'password_reset',
                'user_management',
                req.userId || 'unknown',
                Date.now() - startTime,
                { hasToken: true, passwordLength: password.length }
            );

            res.json({
                success: true,
                message: 'Password reset successful',
            });
        } catch (error: any) {
            if (error.message === 'Invalid or expired reset token') {
                res.status(400).json({
                    success: false,
                    message: 'Invalid or expired reset token',
                });
                return;
            }

            ControllerHelper.handleError('resetPassword', error, req, res, startTime, {
                hasToken: !!token,
                hasPassword: !!password
            });
            next(error);
        }
        return;
    }

    static async changePassword(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        if (!ControllerHelper.requireAuth(req, res)) return;
        const userId = req.userId!;
        const { oldPassword, newPassword } = req.body;

        ControllerHelper.logRequestStart('changePassword', req, {
            hasOldPassword: !!oldPassword,
            hasNewPassword: !!newPassword,
            newPasswordLength: newPassword?.length || 0
        });

        try {

            if (!oldPassword || !newPassword) {
                res.status(400).json({
                    success: false,
                    message: 'Old password and new password are required',
                });
                return;
            }

            if (newPassword.length < 8) {
                res.status(400).json({
                    success: false,
                    message: 'New password must be at least 8 characters',
                });
                return;
            }

            await AuthService.changePassword(userId, oldPassword, newPassword);

            ControllerHelper.logRequestSuccess('changePassword', req, startTime, {
                newPasswordLength: newPassword.length
            });

            // Log business event
            ControllerHelper.logBusinessEvent(
                'password_changed',
                'user_management',
                userId,
                Date.now() - startTime,
                { newPasswordLength: newPassword.length }
            );

            res.json({
                success: true,
                message: 'Password changed successfully',
            });
        } catch (error: any) {
            if (error.message === 'Invalid current password') {
                res.status(401).json({
                    success: false,
                    message: 'Current password is incorrect',
                });
                return;
            }

            ControllerHelper.handleError('changePassword', error, req, res, startTime, {
                hasOldPassword: !!oldPassword,
                hasNewPassword: !!newPassword
            });
            next(error);
        }
        return;
    }
}