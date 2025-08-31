import { Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { registerSchema, loginSchema } from '../utils/validators';
import { loggingService } from '../services/logging.service';
import { config } from '../config';

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
        weeklyReports: boolean;
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
    static async register(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { email, name } = req.body;

        try {
            loggingService.info('User registration initiated', {
                email,
                name,
                requestId: req.headers['x-request-id'] as string
            });

            // Validate input
            const validatedData = registerSchema.parse(req.body);

            // Register user
            const { user, tokens } = await AuthService.register(validatedData);

            const duration = Date.now() - startTime;

            loggingService.info('User registration completed successfully', {
                email,
                name,
                userId: (user as any)._id,
                role: user.role,
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
                    role: user.role
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
                        role: user.role,
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

    static async login(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { email } = req.body;

        try {
            loggingService.info('User login initiated', {
                email,
                requestId: req.headers['x-request-id'] as string
            });

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

            const duration = Date.now() - startTime;

            loggingService.info('User login completed successfully', {
                email: validatedEmail,
                userId: user._id,
                role: user.role,
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
                    role: user.role,
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
                        role: user.role,
                        emailVerified: user.emailVerified,
                        subscription: user.subscription,
                    },
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                },
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('User login failed', {
                email,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

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

        try {
            loggingService.info('User logout initiated', {
                userId,
                requestId: req.headers['x-request-id'] as string
            });

            res.clearCookie('refreshToken');

            const duration = Date.now() - startTime;

            loggingService.info('User logout completed successfully', {
                userId,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'user_logged_out',
                category: 'user_management',
                value: duration,
                metadata: {
                    userId
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
            const duration = Date.now() - startTime;
            
            loggingService.error('Forgot password request failed', {
                email,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Don't reveal if user exists or not
            res.json({
                success: true,
                message: 'If an account exists with this email, password reset instructions have been sent',
            });
        }
        return;
    }

    static async resetPassword(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const { token } = req.params;
        const { password } = req.body;

        try {
            loggingService.info('Password reset initiated', {
                hasToken: !!token,
                hasPassword: !!password,
                passwordLength: password?.length || 0,
                requestId: req.headers['x-request-id'] as string
            });

            if (!token || !password) {
                loggingService.warn('Password reset failed - missing token or password', {
                    hasToken: !!token,
                    hasPassword: !!password,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Token and password are required',
                });
                return;
            }

            if (password.length < 8) {
                loggingService.warn('Password reset failed - password too short', {
                    passwordLength: password.length,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Password must be at least 8 characters',
                });
                return;
            }

            await AuthService.resetPassword(token, password);

            const duration = Date.now() - startTime;

            loggingService.info('Password reset completed successfully', {
                hasToken: true,
                passwordLength: password.length,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'password_reset',
                category: 'user_management',
                value: duration,
                metadata: {
                    hasToken: true,
                    passwordLength: password.length
                }
            });

            res.json({
                success: true,
                message: 'Password reset successful',
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Password reset failed', {
                hasToken: !!token,
                hasPassword: !!password,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            if (error.message === 'Invalid or expired reset token') {
                res.status(400).json({
                    success: false,
                    message: 'Invalid or expired reset token',
                });
                return;
            }

            next(error);
        }
        return;
    }

    static async changePassword(req: any, res: Response, next: NextFunction): Promise<void> {
        const startTime = Date.now();
        const userId = req.user!.id;
        const { oldPassword, newPassword } = req.body;

        try {
            loggingService.info('Password change initiated', {
                userId,
                hasOldPassword: !!oldPassword,
                hasNewPassword: !!newPassword,
                newPasswordLength: newPassword?.length || 0,
                requestId: req.headers['x-request-id'] as string
            });

            if (!oldPassword || !newPassword) {
                loggingService.warn('Password change failed - missing old or new password', {
                    userId,
                    hasOldPassword: !!oldPassword,
                    hasNewPassword: !!newPassword,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'Old password and new password are required',
                });
                return;
            }

            if (newPassword.length < 8) {
                loggingService.warn('Password change failed - new password too short', {
                    userId,
                    newPasswordLength: newPassword.length,
                    requestId: req.headers['x-request-id'] as string
                });

                res.status(400).json({
                    success: false,
                    message: 'New password must be at least 8 characters',
                });
                return;
            }

            await AuthService.changePassword(userId, oldPassword, newPassword);

            const duration = Date.now() - startTime;

            loggingService.info('Password change completed successfully', {
                userId,
                newPasswordLength: newPassword.length,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            // Log business event
            loggingService.logBusiness({
                event: 'password_changed',
                category: 'user_management',
                value: duration,
                metadata: {
                    userId,
                    newPasswordLength: newPassword.length
                }
            });

            res.json({
                success: true,
                message: 'Password changed successfully',
            });
        } catch (error: any) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Password change failed', {
                userId,
                hasOldPassword: !!oldPassword,
                hasNewPassword: !!newPassword,
                error: error.message || 'Unknown error',
                stack: error.stack,
                duration,
                requestId: req.headers['x-request-id'] as string
            });

            if (error.message === 'Invalid current password') {
                res.status(401).json({
                    success: false,
                    message: 'Current password is incorrect',
                });
                return;
            }

            next(error);
        }
        return;
    }
}