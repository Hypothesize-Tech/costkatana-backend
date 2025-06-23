import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { registerSchema, loginSchema } from '../utils/validators';
import { logger } from '../utils/logger';
import { config } from '../config';

export interface IUser {
    _id?: string;
    email: string;
    password: string;
    name: string;
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
    static async register(req: Request, res: Response, next: NextFunction) {
        try {
            // Validate input
            const validatedData = registerSchema.parse(req.body);

            // Register user
            const { user, tokens } = await AuthService.register(validatedData);

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
                },
            });
        } catch (error: unknown) {
            logger.error('Registration error:', error);

            if ((error as Error).message.includes('already exists')) {
                return res.status(409).json({
                    success: false,
                    message: 'User with this email already exists',
                });
            }

            next(error);
        }
        return;
    }

    static async login(req: Request, res: Response, next: NextFunction) {
        try {
            // Validate input
            const { email, password } = loginSchema.parse(req.body);

            // Login user
            const { user, tokens } = await AuthService.login(email, password);

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
                        id: (user as any)._id,
                        email: user.email,
                        name: user.name,
                        role: user.role,
                        emailVerified: user.emailVerified,
                        subscription: user.subscription,
                    },
                    accessToken: tokens.accessToken,
                },
            });
        } catch (error: any) {
            logger.error('Login error:', error);

            if (error.message === 'Invalid credentials') {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password',
                });
            }

            if (error.message === 'Account is deactivated') {
                return res.status(403).json({
                    success: false,
                    message: 'Your account has been deactivated',
                });
            }

            next(error);
        }
        return;
    }

    static async refreshTokens(req: Request, res: Response) {
        try {
            const { refreshToken } = req.cookies;

            if (!refreshToken) {
                return res.status(401).json({
                    success: false,
                    message: 'Refresh token not provided',
                });
            }

            // Refresh tokens
            const tokens = await AuthService.refreshTokens(refreshToken);

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
            logger.error('Refresh token error:', error);

            // Clear invalid refresh token
            res.clearCookie('refreshToken');

            res.status(401).json({
                success: false,
                message: 'Invalid or expired refresh token',
            });
        }
        return;
    }

    static async logout(res: Response) {
        res.clearCookie('refreshToken');

        res.json({
            success: true,
            message: 'Logout successful',
        });
        return;
    }

    static async verifyEmail(req: Request, res: Response, next: NextFunction) {
        try {
            const { token } = req.params;

            if (!token) {
                return res.status(400).json({
                    success: false,
                    message: 'Verification token is required',
                });
            }

            await AuthService.verifyEmail(token);

            res.json({
                success: true,
                message: 'Email verified successfully',
            });
        } catch (error: any) {
            logger.error('Email verification error:', error);

            if (error.message === 'Invalid verification token') {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or expired verification token',
                });
            }

            next(error);
        }
        return;
    }

    static async forgotPassword(req: Request, res: Response) {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: 'Email is required',
                });
            }

            const resetToken = await AuthService.forgotPassword(email);

            // In production, send email with reset link
            // For development, return token in response
            const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

            res.json({
                success: true,
                message: 'Password reset instructions sent to your email',
                ...(config.env === 'development' && { resetUrl }),
            });
        } catch (error: any) {
            logger.error('Forgot password error:', error);

            // Don't reveal if user exists or not
            res.json({
                success: true,
                message: 'If an account exists with this email, password reset instructions have been sent',
            });
        }
        return;
    }

    static async resetPassword(req: Request, res: Response, next: NextFunction) {
        try {
            const { token } = req.params;
            const { password } = req.body;

            if (!token || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Token and password are required',
                });
            }

            if (password.length < 8) {
                return res.status(400).json({
                    success: false,
                    message: 'Password must be at least 8 characters',
                });
            }

            await AuthService.resetPassword(token, password);

            res.json({
                success: true,
                message: 'Password reset successful',
            });
        } catch (error: any) {
            logger.error('Reset password error:', error);

            if (error.message === 'Invalid or expired reset token') {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or expired reset token',
                });
            }

            next(error);
        }
        return;
    }

    static async changePassword(req: Request, res: Response, next: NextFunction) {
        try {
            const userId = req.user!.id;
            const { oldPassword, newPassword } = req.body;

            if (!oldPassword || !newPassword) {
                return res.status(400).json({
                    success: false,
                    message: 'Old password and new password are required',
                });
            }

            if (newPassword.length < 8) {
                return res.status(400).json({
                    success: false,
                    message: 'New password must be at least 8 characters',
                });
            }

            await AuthService.changePassword(userId, oldPassword, newPassword);

            res.json({
                success: true,
                message: 'Password changed successfully',
            });
        } catch (error: any) {
            logger.error('Change password error:', error);

            if (error.message === 'Invalid current password') {
                return res.status(401).json({
                    success: false,
                    message: 'Current password is incorrect',
                });
            }

            next(error);
        }
        return;
    }
}