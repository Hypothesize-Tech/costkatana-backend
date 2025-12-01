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
    // User ID string cache for token generation
    private static userIdCache = new Map<string, string>();
    
    // Circuit breaker for database operations
    private static dbFailureCount: number = 0;
    private static readonly MAX_DB_FAILURES = 5;
    private static readonly DB_CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
    private static lastDbFailureTime: number = 0;
    static generateTokens(user: IUser): AuthTokens {
        // Use cached user ID string conversion
        const userIdKey = (user as any)._id?.toString() || '';
        let id: string;
        
        if (this.userIdCache.has(userIdKey)) {
            id = this.userIdCache.get(userIdKey)!;
        } else {
            id = typeof (user as any)._id === 'string'
                ? (user as any)._id
                : (user as any)._id && typeof (user as any)._id.toString === 'function'
                    ? (user as any)._id.toString()
                    : '';
            
            // Cache the result
            this.userIdCache.set(userIdKey, id);
        }

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
        const startTime = Date.now();
        
        try {
            // Check if user already exists
            const existingUser = await User.findOne({ email: data.email }).select('_id email');
            
            // Generate verification token
            const verificationToken = generateToken();

            if (existingUser) {
                throw new Error('User with this email already exists');
            }

            // Create new user (System role is 'user' by default)
            const user = await User.create({
                ...data,
                verificationToken,
                emailVerified: false,
            });

            // Create default free subscription for new user
            const { SubscriptionService } = await import('./subscription.service');
            const subscription = await SubscriptionService.createDefaultSubscription((user as any)._id);
            
            // Update user with subscriptionId
            user.subscriptionId = subscription._id as any;
            await user.save();

            // Create default workspace for the user
            const { WorkspaceService } = await import('./workspace.service');
            const workspace = await WorkspaceService.createDefaultWorkspace(
                (user as any)._id.toString(),
                user.name
            );

            // Update user with workspace (primary workspace)
            user.workspaceId = workspace._id;
            user.workspaceMemberships = [{
                workspaceId: workspace._id,
                role: 'owner', // Workspace role (different from User.role which is 'user')
                joinedAt: new Date(),
            }];
            await user.save();

            // Create owner team member record
            const { TeamMember } = await import('../models/TeamMember');
            await TeamMember.create({
                workspaceId: workspace._id,
                userId: user._id,
                email: user.email,
                role: 'owner', // Workspace role
                status: 'active',
                joinedAt: new Date(),
                customPermissions: {
                    canManageBilling: true,
                    canManageTeam: true,
                    canManageProjects: true,
                    canManageIntegrations: true,
                    canViewAnalytics: true,
                    canExportData: true,
                },
            });

            // Generate tokens
            const tokens = this.generateTokens(user);

            loggingService.info(`New user registered with default workspace: ${user.email}`, {
                userId: (user as any)._id,
                workspaceId: workspace._id,
                executionTime: Date.now() - startTime
            });

            return { user, tokens };
        } catch (error: unknown) {
            const executionTime = Date.now() - startTime;
            loggingService.error('Error in registration:', { 
                error: error instanceof Error ? error.message : String(error),
                email: data.email,
                executionTime
            });
            throw error;
        }
    }

    static async login(email: string, password: string, deviceInfo?: { userAgent: string; ipAddress: string }): Promise<{ user: IUser; tokens?: AuthTokens; requiresMFA?: boolean; mfaToken?: string }> {
        const startTime = Date.now();
        
        try {
            // Check circuit breaker
            if (this.isDbCircuitBreakerOpen()) {
                throw new Error('Database circuit breaker is open');
            }

            // Find user with optimized query - only select needed fields
            const user = await User.findOne({ email }).select('email password isActive mfa lastLogin accountClosure _id name');
            if (!user) {
                throw new Error('Invalid credentials');
            }

            // Run password validation and user checks in parallel
            const [isPasswordValid, deviceTrustCheck] = await Promise.all([
                // Password validation
                (async () => {
                    if (typeof user.comparePassword !== 'function') {
                        throw new Error('Password comparison not implemented');
                    }
                    return await user.comparePassword(password);
                })(),
                // Device trust check (if MFA enabled and device info provided)
                (async () => {
                    if (user.mfa.enabled && user.mfa.methods.length > 0 && deviceInfo) {
                        const deviceId = MFAService.generateDeviceId(deviceInfo.userAgent, deviceInfo.ipAddress);
                        return await MFAService.isTrustedDevice(user._id.toString(), deviceId);
                    }
                    return true; // No MFA or no device info
                })()
            ]);

            if (!isPasswordValid) {
                throw new Error('Invalid credentials');
            }

            // Check account closure status
            if (user.accountClosure && user.accountClosure.status === 'deleted') {
                throw new Error('Account has been permanently deleted');
            }

            // Check if user is active
            if (!user.isActive) {
                throw new Error('Account is deactivated');
            }

            // Auto-reactivate if account is pending deletion
            if (user.accountClosure && user.accountClosure.status === 'pending_deletion') {
                const { accountClosureService } = await import('./accountClosure.service');
                await accountClosureService.reactivateAccount(user._id.toString());
                
                loggingService.info('Account auto-reactivated on login', {
                    userId: user._id.toString(),
                    email: user.email,
                });
            }

            // Check if MFA is required
            if (user.mfa.enabled && user.mfa.methods.length > 0 && !deviceTrustCheck) {
                // Generate MFA token
                const mfaToken = this.generateMFAToken(user._id.toString());
                
                loggingService.info(`MFA required for user: ${user.email}`, {
                    userId: user._id.toString(),
                    executionTime: Date.now() - startTime
                });
                
                return {
                    user,
                    requiresMFA: true,
                    mfaToken,
                };
            }

            // Reset failure count on success
            this.dbFailureCount = 0;

            // Complete login (no MFA required or trusted device)
            return this.completeLogin(user);
        } catch (error: unknown) {
            this.recordDbFailure();
            const executionTime = Date.now() - startTime;
            loggingService.error('Error in login:', { 
                error: error instanceof Error ? error.message : String(error),
                email,
                executionTime
            });
            throw error;
        }
    }

    static async completeLogin(user: any): Promise<{ user: any; tokens: AuthTokens }> {
        const startTime = Date.now();
        
        try {
            // Update last login and track activity in parallel
            const [, tokens] = await Promise.all([
                // Update last login
                (async () => {
                    user.lastLogin = new Date();
                    return await user.save();
                })(),
                // Track login activity
                ActivityService.trackActivity(user._id.toString(), {
                    type: 'login',
                    title: 'User Login',
                    description: 'Successfully logged in'
                })
            ]);

            // Generate tokens (synchronous operation)
            const authTokens = this.generateTokens(user);

            const executionTime = Date.now() - startTime;
            loggingService.info(`User logged in: ${user.email}`, {
                userId: user._id.toString(),
                executionTime
            });

            return { user, tokens: authTokens };
        } catch (error: unknown) {
            const executionTime = Date.now() - startTime;
            loggingService.error('Error completing login:', { 
                error: error instanceof Error ? error.message : String(error),
                userId: user._id?.toString(),
                executionTime
            });
            throw error;
        }
    }

    static async refreshTokens(refreshToken: string): Promise<AuthTokens> {
        const startTime = Date.now();
        
        try {
            // Verify refresh token
            const payload = this.verifyRefreshToken(refreshToken);

            const user = await User.findById(payload.id).select('isActive email _id role');
            if (!user || !user.isActive) {
                throw new Error('User not found or inactive');
            }

            // Generate new tokens
            const tokens = this.generateTokens(user);

            const executionTime = Date.now() - startTime;
            loggingService.debug('Tokens refreshed successfully', {
                userId: payload.id,
                executionTime
            });

            return tokens;
        } catch (error: unknown) {
            const executionTime = Date.now() - startTime;
            loggingService.error('Error refreshing tokens:', { 
                error: error instanceof Error ? error.message : String(error),
                executionTime
            });
            throw error;
        }
    }

    static async verifyEmail(token: string): Promise<void> {
        try {
            // First, try to find user with primary email verification token
            let user: any = await User.findOne({ verificationToken: token });
            
            if (user) {
                // Verify primary email
                user.emailVerified = true;
                user.verificationToken = undefined;
                await user.save();
                loggingService.info(`Primary email verified for user: ${user.email}`);
                return;
            }

            // If not found, check for secondary email verification token
            user = await User.findOne({ 'otherEmails.verificationToken': token });
            
            if (!user) {
                throw new Error('Invalid verification token');
            }

            // Find and verify the specific secondary email
            const otherEmail = user.otherEmails?.find((e: any) => e.verificationToken === token);
            if (otherEmail) {
                otherEmail.verified = true;
                otherEmail.verificationToken = undefined;
                await user.save();
                loggingService.info(`Secondary email verified for user: ${user.email} - verified email: ${otherEmail.email}`);
            } else {
                throw new Error('Invalid verification token');
            }
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
        const startTime = Date.now();
        
        try {
            // Find user with optimized query
            const user = await User.findById(userId).select('password email _id');
            if (!user) {
                throw new Error('User not found');
            }

            // Validate old password
            if (typeof user.comparePassword !== 'function') {
                throw new Error('Password comparison not implemented');
            }
            const isPasswordValid = await user.comparePassword(oldPassword);

            if (!isPasswordValid) {
                throw new Error('Invalid current password');
            }

            // Update password
            user.password = newPassword;
            await user.save();

            loggingService.info(`Password changed for user: ${user.email}`, {
                userId,
                executionTime: Date.now() - startTime
            });

        } catch (error: unknown) {
            const executionTime = Date.now() - startTime;
            loggingService.error('Error changing password:', { 
                error: error instanceof Error ? error.message : String(error),
                userId,
                executionTime
            });
            throw error;
        }
    }

    /**
     * Circuit breaker utilities for database operations
     */
    private static isDbCircuitBreakerOpen(): boolean {
        if (this.dbFailureCount >= this.MAX_DB_FAILURES) {
            const timeSinceLastFailure = Date.now() - this.lastDbFailureTime;
            if (timeSinceLastFailure < this.DB_CIRCUIT_BREAKER_RESET_TIME) {
                return true;
            } else {
                // Reset circuit breaker
                this.dbFailureCount = 0;
                return false;
            }
        }
        return false;
    }

    private static recordDbFailure(): void {
        this.dbFailureCount++;
        this.lastDbFailureTime = Date.now();
    }

    /**
     * Cleanup method for graceful shutdown
     */
    static cleanup(): void {
        // Reset circuit breaker state
        this.dbFailureCount = 0;
        this.lastDbFailureTime = 0;
        
        // Clear user ID cache
        this.userIdCache.clear();
    }
}