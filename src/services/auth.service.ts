import jwt, { SignOptions, Secret, JwtPayload } from 'jsonwebtoken';
import { User, IUser } from '../models/User';
import { config } from '../config';
import { generateToken } from '../utils/helpers';
import { loggingService } from './logging.service';
import { ActivityService } from './activity.service';
import { MFAService } from './mfa.service';

interface TokenPayload extends JwtPayload {
    id: string;
    email: string;
    role: string;
    jti?: string; // JWT ID for API key identification
}

interface AuthTokens {
    accessToken: string;
    refreshToken: string;
}

interface DashboardApiKey {
    keyId: string;
    apiKey: string;
    maskedKey: string;
}

export class AuthService {
    static generateTokens(user: IUser): AuthTokens {
        // Ensure _id is string
        const id: string =
            typeof (user as any)._id === 'string'
                ? (user as any)._id
                : (user as any)._id && typeof (user as any)._id.toString === 'function'
                    ? (user as any)._id.toString()
                    : '';
        const payload: TokenPayload = {
            id,
            email: user.email,
            role: user.role,
        };

        const accessToken = jwt.sign(
            payload,
            config.jwt.secret as Secret,
            { expiresIn: config.jwt.expiresIn } as SignOptions
        );

        const refreshToken = jwt.sign(
            payload,
            config.jwt.refreshSecret as Secret,
            { expiresIn: config.jwt.refreshExpiresIn } as SignOptions
        );

        return { accessToken, refreshToken };
    }

    static generateDashboardApiKey(user: IUser, name: string, permissions: string[] = ['read'], expiresAt?: Date): DashboardApiKey {
        // Generate unique key ID and API key
        const keyId = generateToken(16); // 32 character hex string
        const apiKeySecret = generateToken(32); // 64 character hex string

        // Create API key in format: dak_userId_keyId_secret (Dashboard API Key)
        const apiKey = `dak_${(user as any)._id.toString()}_${keyId}_${apiKeySecret}`;

        // Create masked version for display
        const maskedKey = `dak_${keyId.substring(0, 4)}...${keyId.substring(-4)}`;

        // Use the parameters to avoid TypeScript warnings
        loggingService.info(`Creating API key "${name}" with permissions: ${permissions.join(', ')}${expiresAt ? ` (expires: ${expiresAt})` : ''}`);

        return {
            keyId,
            apiKey,
            maskedKey
        };
    }

    static generateApiKeyToken(userId: string, keyId: string, permissions: string[] = ['read']): string {
        const payload: TokenPayload = {
            id: userId,
            email: '', // Not needed for API key auth
            role: 'user',
            jti: keyId, // JWT ID matches the key ID for validation
            permissions
        };

        return jwt.sign(
            payload,
            config.jwt.secret as Secret,
            { expiresIn: '365d' } as SignOptions // Long-lived for API keys
        );
    }

    static verifyAccessToken(token: string): TokenPayload {
        const decoded = jwt.verify(token, config.jwt.secret as Secret);
        if (typeof decoded === 'string' || !decoded) {
            throw new Error('Invalid token payload');
        }
        // Type assertion is safe here after check
        return decoded as TokenPayload;
    }

    static verifyRefreshToken(token: string): TokenPayload {
        const decoded = jwt.verify(token, config.jwt.refreshSecret as Secret);
        if (typeof decoded === 'string' || !decoded) {
            throw new Error('Invalid token payload');
        }
        return decoded as TokenPayload;
    }

    static generateMFAToken(userId: string): string {
        const payload = {
            userId,
            type: 'mfa',
            exp: Math.floor(Date.now() / 1000) + (10 * 60), // 10 minutes
        };
        
        return jwt.sign(payload, config.jwt.secret as Secret);
    }

    static verifyMFAToken(token: string): { userId: string } {
        try {
            const payload = jwt.verify(token, config.jwt.secret as Secret) as any;
            
            if (payload.type !== 'mfa') {
                throw new Error('Invalid token type');
            }
            
            return { userId: payload.userId };
        } catch (error) {
            throw new Error('Invalid MFA token');
        }
    }

    static parseApiKey(apiKey: string): { userId: string; keyId: string; secret: string } | null {
        // Parse API key format: dak_userId_keyId_secret
        const parts = apiKey.split('_');
        if (parts.length !== 4 || parts[0] !== 'dak') {
            return null;
        }

        return {
            userId: parts[1],
            keyId: parts[2],
            secret: parts[3]
        };
    }

    static async register(data: {
        email: string;
        password: string;
        name: string;
    }): Promise<{ user: IUser; tokens: AuthTokens }> {
        try {
            // Check if user already exists
            const existingUser = await User.findOne({ email: data.email });
            if (existingUser) {
                throw new Error('User with this email already exists');
            }

            // Create verification token
            const verificationToken = generateToken();

            // Create new user
            const user = await User.create({
                ...data,
                verificationToken,
                emailVerified: false,
            });

            // Generate tokens
            const tokens = this.generateTokens(user);

            // Send verification email (handled by email service)

            loggingService.info(`New user registered: ${user.email}`);

            return { user, tokens };
        } catch (error: unknown) {
            loggingService.error('Error in registration:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async login(email: string, password: string, deviceInfo?: { userAgent: string; ipAddress: string }): Promise<{ user: IUser; tokens?: AuthTokens; requiresMFA?: boolean; mfaToken?: string }> {
        try {
            // Find user
            const user = await User.findOne({ email });
            if (!user) {
                throw new Error('Invalid credentials');
            }

            // Check password
            if (typeof user.comparePassword !== 'function') {
                throw new Error('Password comparison not implemented');
            }
            const isPasswordValid = await user.comparePassword(password);
            if (!isPasswordValid) {
                throw new Error('Invalid credentials');
            }

            // Check if user is active
            if (!user.isActive) {
                throw new Error('Account is deactivated');
            }

            // Check if MFA is enabled
            if (user.mfa.enabled && user.mfa.methods.length > 0) {
                // Check if device is trusted
                let isTrustedDevice = false;
                if (deviceInfo) {
                    const deviceId = MFAService.generateDeviceId(deviceInfo.userAgent, deviceInfo.ipAddress);
                    isTrustedDevice = await MFAService.isTrustedDevice(user._id.toString(), deviceId);
                }

                if (!isTrustedDevice) {
                    // Generate temporary MFA token for verification
                    const mfaToken = this.generateMFAToken(user._id.toString());
                    
                    loggingService.info(`MFA required for user: ${user.email}`);
                    
                    return {
                        user,
                        requiresMFA: true,
                        mfaToken,
                    };
                }
            }

            // Complete login (no MFA required or trusted device)
            return this.completeLogin(user);
        } catch (error: unknown) {
            loggingService.error('Error in login:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async completeLogin(user: any): Promise<{ user: any; tokens: AuthTokens }> {
        try {
            // Update last login
            user.lastLogin = new Date();
            await user.save();

            // Track login activity
            await ActivityService.trackActivity(user._id.toString(), {
                type: 'login',
                title: 'User Login',
                description: 'Successfully logged in'
            });

            // Generate tokens
            const tokens = this.generateTokens(user);

            loggingService.info(`User logged in: ${user.email}`);

            return { user, tokens };
        } catch (error: unknown) {
            loggingService.error('Error completing login:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async refreshTokens(refreshToken: string): Promise<AuthTokens> {
        try {
            // Verify refresh token
            const payload = this.verifyRefreshToken(refreshToken);

            // Find user
            const user = await User.findById(payload.id);
            if (!user || !user.isActive) {
                throw new Error('User not found or inactive');
            }

            // Generate new tokens
            const tokens = this.generateTokens(user);

            return tokens;
        } catch (error: unknown) {
            loggingService.error('Error refreshing tokens:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async verifyEmail(token: string): Promise<void> {
        try {
            const user = await User.findOne({ verificationToken: token });
            if (!user) {
                throw new Error('Invalid verification token');
            }

            user.emailVerified = true;
            user.verificationToken = undefined;
            await user.save();

            loggingService.info(`Email verified for user: ${user.email}`);
        } catch (error: unknown) {
            loggingService.error('Error verifying email:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async forgotPassword(email: string): Promise<string> {
        try {
            const user = await User.findOne({ email });
            if (!user) {
                throw new Error('User not found');
            }

            // Generate reset token
            const resetToken = generateToken();
            user.resetPasswordToken = resetToken;
            user.resetPasswordExpires = new Date(Date.now() + 3600000); // 1 hour
            await user.save();

            loggingService.info(`Password reset requested for: ${user.email}`);

            return resetToken;
        } catch (error: unknown) {
            loggingService.error('Error in forgot password:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async resetPassword(token: string, newPassword: string): Promise<void> {
        try {
            const user = await User.findOne({
                resetPasswordToken: token,
                resetPasswordExpires: { $gt: new Date() },
            });

            if (!user) {
                throw new Error('Invalid or expired reset token');
            }

            user.password = newPassword;
            user.resetPasswordToken = undefined;
            user.resetPasswordExpires = undefined;
            await user.save();

            loggingService.info(`Password reset for user: ${user.email}`);
        } catch (error: unknown) {
            loggingService.error('Error resetting password:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    static async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<void> {
        try {
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            if (typeof user.comparePassword !== 'function') {
                throw new Error('Password comparison not implemented');
            }
            const isPasswordValid = await user.comparePassword(oldPassword);
            if (!isPasswordValid) {
                throw new Error('Invalid current password');
            }

            user.password = newPassword;
            await user.save();

            loggingService.info(`Password changed for user: ${user.email}`);
        } catch (error: unknown) {
            loggingService.error('Error changing password:', { error: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }
}