import {
  Injectable,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { User } from '../../schemas/user/user.schema';
import { UserSession } from '../../schemas/user/user-session.schema';
import { TeamMember } from '../../schemas/team-project/team-member.schema';
import { v4 as uuidv4 } from 'uuid';
import { SubscriptionService } from '../subscription/subscription.service';
import { WorkspaceService } from '../team/services/workspace.service';
import { ActivityService } from '../activity/activity.service';
import { EmailService } from '../email/email.service';
import { AccountClosureService } from '../account-closure/account-closure.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { MfaService } from './mfa.service';
import { UserSessionService } from '../user-session/user-session.service';

interface TokenPayload {
  id?: string; // User ID (aligned with Express)
  sub?: string; // Subject / user ID (JWT standard, API keys)
  email: string;
  role: string;
  jti?: string; // JWT ID for session identification (aligned with Express)
  sessionId?: string; // User session ID for refresh/revocation
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

interface LoginResult {
  user: User;
  tokens?: AuthTokens;
  requiresMFA?: boolean;
  mfaToken?: string;
}

interface DeviceInfo {
  userAgent: string;
  ipAddress: string;
}

let authServiceInstance: AuthService | null = null;

export function getAuthService(): AuthService {
  if (!authServiceInstance) {
    throw new Error(
      'AuthService not initialized. Ensure AuthModule is imported.',
    );
  }
  return authServiceInstance;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // User ID string cache for token generation
  private static userIdCache = new Map<string, string>();

  // Circuit breaker for database operations
  private static dbFailureCount: number = 0;
  private static readonly MAX_DB_FAILURES = 5;
  private static readonly DB_CIRCUIT_BREAKER_RESET_TIME = 300000; // 5 minutes
  private static lastDbFailureTime: number = 0;

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(UserSession.name) private userSessionModel: Model<UserSession>,
    @InjectModel(TeamMember.name) private teamMemberModel: Model<TeamMember>,
    private subscriptionService: SubscriptionService,
    private workspaceService: WorkspaceService,
    private activityService: ActivityService,
    private emailService: EmailService,
    private accountClosureService: AccountClosureService,
    private encryptionService: EncryptionService,
    private mfaService: MfaService,
    private userSessionService: UserSessionService,
  ) {
    authServiceInstance = this;
  }

  generateTokens(user: User, userSessionId?: string): AuthTokens {
    // Use cached user ID string conversion
    const userIdKey = (user as any)._id?.toString() || '';
    let id: string;

    if (AuthService.userIdCache.has(userIdKey)) {
      id = AuthService.userIdCache.get(userIdKey)!;
    } else {
      id = (user as any)._id?.toString() || '';
      // Cache the result
      AuthService.userIdCache.set(userIdKey, id);
    }

    const payload: TokenPayload = {
      id,
      email: user.email,
      role: user.role || 'user',
      ...(userSessionId && { jti: userSessionId, sessionId: userSessionId }),
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_EXPIRES_IN', '1h'),
    });

    const refreshToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
      secret: this.configService.get('JWT_REFRESH_SECRET'),
    });

    return { accessToken, refreshToken };
  }

  generateDashboardApiKey(
    user: User,
    name: string,
    permissions: string[] = ['read'],
    expiresAt?: Date,
  ): DashboardApiKey {
    // Generate unique key ID and API key
    const keyId = this.generateToken(16); // 32 character hex string
    const apiKeySecret = this.generateToken(32); // 64 character hex string

    // Create API key in format: dak_userId_keyId_secret (Dashboard API Key)
    const apiKey = `dak_${(user as any)._id?.toString()}_${keyId}_${apiKeySecret}`;

    // Create masked version for display
    const maskedKey = `dak_${keyId.substring(0, 4)}...${keyId.substring(keyId.length - 4)}`;

    this.logger.log(
      `Creating API key "${name}" with permissions: ${permissions.join(', ')}${expiresAt ? ` (expires: ${expiresAt})` : ''}`,
    );

    return {
      keyId,
      apiKey,
      maskedKey,
    };
  }

  generateApiKeyToken(
    userId: string,
    keyId: string,
    permissions: string[] = ['read'],
  ): string {
    const payload: TokenPayload = {
      sub: userId,
      id: userId,
      email: '', // Not needed for API key auth
      role: 'api_key',
      jti: keyId,
    };

    return this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_API_KEY_EXPIRES_IN', '365d'),
      secret: this.configService.get('JWT_API_KEY_SECRET'),
    });
  }

  verifyAccessToken(token: string): TokenPayload {
    try {
      return this.jwtService.verify(token, {
        secret: this.configService.get('JWT_SECRET'),
      });
    } catch (error) {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  verifyRefreshToken(token: string): TokenPayload {
    try {
      return this.jwtService.verify(token, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  generateMFAToken(userId: string): string {
    const payload = {
      sub: userId,
      type: 'mfa',
      iat: Math.floor(Date.now() / 1000),
    };

    return this.jwtService.sign(payload, {
      expiresIn: '5m', // 5 minutes
      secret: this.configService.get('JWT_MFA_SECRET'),
    });
  }

  verifyMFAToken(token: string): { userId: string } {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get('JWT_MFA_SECRET'),
      });

      if (payload.type !== 'mfa') {
        throw new UnauthorizedException('Invalid MFA token type');
      }

      // MFA tokens use 'sub'; support 'id' for consistency
      const userId =
        (payload as { sub?: string; id?: string }).sub ??
        (payload as { id?: string }).id;
      if (!userId) {
        throw new UnauthorizedException(
          'Invalid MFA token: missing user identifier',
        );
      }
      return { userId };
    } catch (error) {
      throw new UnauthorizedException('Invalid MFA token');
    }
  }

  parseApiKey(
    apiKey: string,
  ): { userId: string; keyId: string; secret: string } | null {
    // Check if it's a dashboard API key (starts with 'dak_')
    if (!apiKey.startsWith('dak_')) {
      return null;
    }

    const parts = apiKey.split('_');
    if (parts.length !== 4) {
      return null;
    }

    const [prefix, userId, keyId, secret] = parts;
    if (prefix !== 'dak') {
      return null;
    }

    return { userId, keyId, secret };
  }

  async register(data: {
    email: string;
    password: string;
    name: string;
    confirmPassword?: string;
    role?: string;
  }): Promise<{ user: User; tokens: AuthTokens }> {
    const startTime = Date.now();

    try {
      // Check if user already exists
      const existingUser = await this.userModel
        .findOne({
          email: data.email.toLowerCase(),
        })
        .select('_id email');

      // Generate verification token
      const verificationToken = this.generateToken(32);

      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Create new user (System role is 'user' by default)
      const user = await this.userModel.create({
        ...data,
        email: data.email.toLowerCase(),
        verificationToken: verificationToken,
        verificationTokenExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiry
        emailVerified: false,
      });

      // Create default free subscription for new user
      const subscription =
        await this.subscriptionService.createDefaultSubscription(
          (user as any)._id,
        );

      // Update user with subscriptionId
      user.subscriptionId =
        subscription._id as unknown as User['subscriptionId'];
      await user.save();

      // Create default workspace for the user
      const workspace = await this.workspaceService.createDefaultWorkspace(
        (user as any)._id.toString(),
        user.name,
      );

      // Update user with workspace (primary workspace)
      user.workspaceId = workspace._id as unknown as User['workspaceId'];
      user.workspaceMemberships = [
        {
          workspaceId:
            workspace._id as unknown as import('mongoose').Schema.Types.ObjectId,
          role: 'owner',
          joinedAt: new Date(),
        },
      ];
      await user.save();

      // Create owner team member record
      await this.teamMemberModel.create({
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

      this.logger.log(
        `New user registered with default workspace: ${user.email}`,
        {
          userId: (user as any)._id,
          workspaceId: workspace._id,
          executionTime: Date.now() - startTime,
        },
      );

      return { user, tokens };
    } catch (error: unknown) {
      const executionTime = Date.now() - startTime;
      this.logger.error('Error in registration:', {
        error: error instanceof Error ? error.message : String(error),
        email: data.email,
        executionTime,
      });
      throw error;
    }
  }

  async login(
    email: string,
    password: string,
    deviceInfo?: DeviceInfo,
  ): Promise<LoginResult> {
    const startTime = Date.now();

    try {
      // Check circuit breaker
      if (AuthService.isDbCircuitBreakerOpen()) {
        throw new Error('Database circuit breaker is open');
      }

      // Find user with optimized query - only select needed fields
      const user = await this.userModel
        .findOne({ email })
        .select(
          'email password role isActive mfa lastLogin accountClosure _id name emailVerified avatar subscriptionId preferences usage onboarding createdAt company',
        );
      if (!user) {
        throw new Error('Invalid credentials');
      }

      // Run password validation and user checks in parallel
      const [isPasswordValid, deviceTrustCheck] = await Promise.all([
        // Password validation
        (async () => {
          if (!user.password) {
            throw new Error(
              'No password set for this user. Please use OAuth login.',
            );
          }
          return await bcrypt.compare(password, user.password);
        })(),
        // Device trust check (if MFA enabled and device info provided)
        (async () => {
          if (user.mfa.enabled && user.mfa.methods.length > 0 && deviceInfo) {
            const deviceId = MfaService.generateDeviceId(
              deviceInfo.userAgent,
              deviceInfo.ipAddress,
            );
            return await this.mfaService.isTrustedDevice(
              user._id.toString(),
              deviceId,
            );
          }
          return true; // No MFA or no device info
        })(),
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
      if (
        user.accountClosure &&
        user.accountClosure.status === 'pending_deletion'
      ) {
        await this.accountClosureService.reactivateAccount(user._id.toString());

        this.logger.log('Account auto-reactivated on login', {
          userId: user._id.toString(),
          email: user.email,
        });
      }

      // Check if MFA is required
      if (
        user.mfa.enabled &&
        user.mfa.methods.length > 0 &&
        !deviceTrustCheck
      ) {
        // Generate MFA token
        const mfaToken = this.generateMFAToken(user._id.toString());

        this.logger.log(`MFA required for user: ${user.email}`, {
          userId: user._id.toString(),
          executionTime: Date.now() - startTime,
        });

        return {
          user,
          requiresMFA: true,
          mfaToken,
        };
      }

      // Reset failure count on success
      AuthService.dbFailureCount = 0;

      // Complete login (no MFA required or trusted device)
      return this.completeLogin(user, deviceInfo);
    } catch (error: unknown) {
      AuthService.recordDbFailure();
      const executionTime = Date.now() - startTime;
      this.logger.error('Error in login:', {
        error: error instanceof Error ? error.message : String(error),
        email,
        executionTime,
      });
      throw error;
    }
  }

  async completeLogin(
    user: any,
    deviceInfo?: DeviceInfo,
  ): Promise<{ user: any; tokens: AuthTokens }> {
    const startTime = Date.now();

    try {
      // Ensure user has a subscription (for existing users created before subscription requirement)
      if (!user.subscriptionId) {
        this.logger.log(
          'User missing subscription, creating default subscription',
          {
            userId: user._id.toString(),
            email: user.email,
          },
        );

        const subscription =
          await this.subscriptionService.createDefaultSubscription(user._id);

        user.subscriptionId = subscription._id;
        await user.save();

        this.logger.log('Created default subscription for existing user', {
          userId: user._id.toString(),
          subscriptionId: subscription._id.toString(),
        });
      }

      // Update last login and track activity in parallel
      const [_] = await Promise.all([
        // Update last login
        (async () => {
          user.lastLogin = new Date();
          return await user.save();
        })(),
        // Track login activity
        this.activityService.trackActivity(user._id.toString(), {
          type: 'login',
          title: 'User Login',
          description: 'Successfully logged in',
        }),
      ]);

      // Create user session first if device info is provided, then generate tokens with sessionId
      let userSessionId: string | undefined;
      let isNewDevice = false;

      if (deviceInfo) {
        try {
          // Generate session ID and tokens first so we never persist a placeholder refresh token
          const preGeneratedSessionId = crypto.randomBytes(32).toString('hex');
          const tokens = this.generateTokens(user, preGeneratedSessionId);

          const { userSession, isNewDevice: newDevice } =
            await this.userSessionService.createUserSession(
              user._id.toString(),
              deviceInfo,
              tokens.refreshToken,
              { userSessionId: preGeneratedSessionId },
            );

          userSessionId = userSession.userSessionId;
          isNewDevice = newDevice;

          // Send new device email notification
          if (isNewDevice) {
            try {
              await this.emailService.sendNewDeviceLoginNotification(
                { name: user.name, email: user.email },
                {
                  deviceName: userSession.deviceName,
                  ipAddress: userSession.ipAddress,
                  location: userSession.location
                    ? {
                        country: userSession.location.country ?? '',
                        region:
                          (userSession.location as { region?: string })
                            .region ?? '',
                        city: userSession.location.city ?? '',
                      }
                    : undefined,
                  userAgent: userSession.userAgent,
                },
              );
              this.logger.log('New device login notification email sent', {
                userId: user._id.toString(),
                email: user.email,
                deviceName: userSession.deviceName,
              });
            } catch (emailError) {
              this.logger.error(
                'Failed to send new device login notification email',
                {
                  userId: user._id.toString(),
                  email: user.email,
                  error:
                    emailError instanceof Error
                      ? emailError.message
                      : String(emailError),
                },
              );
              // Don't fail login if email fails
            }
          }
        } catch (sessionError) {
          // Don't fail login if session creation fails
          this.logger.warn('Error creating user session on login', {
            userId: user._id.toString(),
            error:
              sessionError instanceof Error
                ? sessionError.message
                : String(sessionError),
          });
        }
      }

      // Generate tokens (regenerate if session was created)
      const tokens = userSessionId
        ? this.generateTokens(user, userSessionId)
        : this.generateTokens(user);

      this.logger.log(`User logged in: ${user.email}`, {
        userId: user._id?.toString(),
        email: user.email,
        sessionId: userSessionId,
        requiresMFA: false,
        executionTime: Date.now() - startTime,
      });

      return { user, tokens };
    } catch (error: unknown) {
      const executionTime = Date.now() - startTime;
      this.logger.error('Error in completeLogin:', {
        error: error instanceof Error ? error.message : String(error),
        userId: user._id?.toString(),
        executionTime,
      });
      throw error;
    }
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    const payload = this.verifyRefreshToken(refreshToken);

    // Standard tokens use 'id'; support 'sub' for JWT spec compatibility
    const userId =
      (payload as { id?: string; sub?: string }).id ??
      (payload as { sub?: string }).sub;
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Check account closure status
    if (user.accountClosure?.status === 'deleted') {
      throw new UnauthorizedException('Account is closed');
    }

    // Validate session if sessionId is in token
    if (payload.jti) {
      const session = await this.userSessionModel.findOne({
        userSessionId: payload.sessionId ?? payload.jti,
        userId: (user as any)._id,
        isActive: true,
      });

      if (!session) {
        throw new UnauthorizedException('Invalid session');
      }

      // Check if session is expired
      if (session.expiresAt && session.expiresAt < new Date()) {
        await this.userSessionModel.findByIdAndUpdate(session._id, {
          isActive: false,
        });
        throw new UnauthorizedException('Session expired');
      }

      // Update session activity asynchronously (non-blocking)
      setImmediate(async () => {
        try {
          await this.userSessionModel.updateOne(
            { userSessionId: payload.sessionId ?? payload.jti },
            { lastActiveAt: new Date() },
          );
        } catch (error) {
          // Silently fail activity updates
          this.logger.debug('Failed to update session activity', {
            sessionId: payload.sessionId ?? payload.jti,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    }

    // Generate new tokens
    const tokens = this.generateTokens(user, payload.sessionId ?? payload.jti);

    this.logger.log(`Tokens refreshed for user: ${user.email}`, {
      userId: (user as any)._id?.toString(),
      email: user.email,
    });

    return tokens;
  }

  /**
   * Verify user email using the opaque token from the verification link (production flow).
   * Supports primary and secondary (otherEmails) verification. Rejects invalid or expired tokens.
   */
  async verifyEmail(token: string): Promise<void> {
    try {
      const user = await this.userModel.findOne({
        $or: [
          { verificationToken: token },
          { 'otherEmails.verificationToken': token },
        ],
      });

      if (!user) {
        throw new BadRequestException('Invalid verification token');
      }

      // Primary email: check expiry then verify
      if (user.verificationToken === token) {
        const expires = (user as any).verificationTokenExpires;
        if (expires && new Date(expires) < new Date()) {
          await this.userModel.findByIdAndUpdate((user as any)._id, {
            verificationToken: undefined,
            verificationTokenExpires: undefined,
          });
          throw new BadRequestException('Verification token has expired');
        }
        await this.userModel.findByIdAndUpdate((user as any)._id, {
          emailVerified: true,
          emailVerifiedAt: new Date(),
          verificationToken: undefined,
          verificationTokenExpires: undefined,
        });
      } else {
        const otherEmailIndex = user.otherEmails?.findIndex(
          (email: any) => email.verificationToken === token,
        );

        if (otherEmailIndex === undefined || otherEmailIndex === -1) {
          throw new BadRequestException('Invalid verification token');
        }

        // Mark secondary email as verified
        user.otherEmails[otherEmailIndex].verified = true;
        user.otherEmails[otherEmailIndex].verificationToken = undefined;
        await user.save();
      }

      this.logger.log(`Email verified for user: ${user.email}`, {
        userId: (user as any)._id?.toString(),
        email: user.email,
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Invalid or expired verification token');
    }
  }

  async forgotPassword(email: string): Promise<string> {
    const user = await this.userModel.findOne({ email: email.toLowerCase() });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Generate reset token and hash it for storage
    const resetToken = this.generateToken(32);
    const hashedResetToken = crypto
      .createHash('sha256')
      .update(resetToken)
      .digest('hex');

    // Store hashed token with expiry
    await this.userModel.findByIdAndUpdate((user as any)._id, {
      resetPasswordToken: hashedResetToken,
      resetPasswordExpires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    });

    // Send password reset email
    try {
      const resetUrl = `${this.configService.getOrThrow<string>('FRONTEND_URL')}/reset-password/${resetToken}`;
      await this.emailService.sendPasswordResetEmail(
        { name: user.name, email: user.email },
        resetUrl,
      );
    } catch (emailError) {
      this.logger.error('Failed to send password reset email', {
        userId: (user as any)._id?.toString(),
        email,
        error:
          emailError instanceof Error ? emailError.message : String(emailError),
      });
      // Don't fail the request if email fails
    }

    this.logger.log(`Password reset requested for user: ${email}`, {
      userId: (user as any)._id?.toString(),
      email,
    });

    return resetToken;
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    try {
      // Hash the incoming token to compare with stored hash
      const hashedToken = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      // Find user with non-expired reset token
      const user = await this.userModel.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: new Date() },
      });

      if (!user) {
        throw new BadRequestException('Invalid or expired reset token');
      }

      // Hash new password (pre-save hook will handle this, but we do it explicitly for clarity)
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update password and clear reset token fields
      await this.userModel.findByIdAndUpdate((user as any)._id, {
        password: hashedPassword,
        passwordChangedAt: new Date(),
        resetPasswordToken: undefined,
        resetPasswordExpires: undefined,
      });

      // Deactivate all sessions for security
      await this.userSessionModel.updateMany(
        { userId: user._id, isActive: true },
        {
          isActive: false,
          deactivatedAt: new Date(),
          deactivationReason: 'password_reset',
        },
      );

      this.logger.log(`Password reset completed for user: ${user.email}`, {
        userId: (user as any)._id?.toString(),
        email: user.email,
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Invalid or expired reset token');
    }
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Verify old password
    const isOldPasswordValid = user.password
      ? await bcrypt.compare(oldPassword, user.password)
      : false;
    if (!isOldPasswordValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await this.userModel.findByIdAndUpdate((user as any)._id, {
      password: hashedPassword,
      passwordChangedAt: new Date(),
    });

    this.logger.log(`Password changed for user: ${user.email}`, {
      userId: (user as any)._id?.toString(),
      email: user.email,
    });
  }

  private static isDbCircuitBreakerOpen(): boolean {
    if (AuthService.dbFailureCount >= AuthService.MAX_DB_FAILURES) {
      const timeSinceLastFailure = Date.now() - AuthService.lastDbFailureTime;
      if (timeSinceLastFailure < AuthService.DB_CIRCUIT_BREAKER_RESET_TIME) {
        return true;
      } else {
        // Reset circuit breaker
        AuthService.dbFailureCount = 0;
        return false;
      }
    }
    return false;
  }

  private static recordDbFailure(): void {
    AuthService.dbFailureCount++;
    AuthService.lastDbFailureTime = Date.now();
  }

  async loginWithOAuth(
    provider: string,
    providerId: string,
    email: string,
    name: string,
    profileData?: any,
  ): Promise<{ user: User; tokens: AuthTokens; isNewUser: boolean }> {
    // Check circuit breaker
    if (AuthService.isDbCircuitBreakerOpen()) {
      throw new BadRequestException('Service temporarily unavailable');
    }

    try {
      // Find or create user
      let user = await this.userModel.findOne({
        $or: [
          { email: email.toLowerCase() },
          { [`oauthProfiles.${provider}.id`]: providerId },
        ],
      });

      let isNewUser = false;

      if (!user) {
        // Create new user
        user = new this.userModel({
          email: email.toLowerCase(),
          name,
          role: 'user',
          emailVerified: true, // OAuth emails are pre-verified
          oauthProfiles: {
            [provider]: {
              id: providerId,
              email,
              profileData,
              connectedAt: new Date(),
            },
          },
          preferences: {
            emailAlerts: true,
            alertThreshold: 10,
            optimizationSuggestions: true,
            theme: 'light',
            currency: 'USD',
          },
        });
        await user.save();
        isNewUser = true;

        this.logger.log(`New user created via OAuth (${provider}): ${email}`, {
          userId: (user as any)._id?.toString(),
          email,
          provider,
          isNewUser: true,
        });
      } else {
        // Update existing user's OAuth profile
        if (!user.oauthProviders) {
          (user as any).oauthProviders = [];
        }
        (user as any).oauthProviders.push({
          id: providerId,
          email,
          profileData,
          connectedAt: new Date(),
        });
        await user.save();

        this.logger.log(
          `Existing user logged in via OAuth (${provider}): ${email}`,
          {
            userId: (user as any)._id?.toString(),
            email,
            provider,
            isNewUser: false,
          },
        );
      }

      // Create session and generate tokens
      const session = new this.userSessionModel({
        userId: (user as any)._id,
        deviceInfo: {
          userAgent: 'OAuth Login',
          ipAddress: 'OAuth Provider',
          lastActivityAt: new Date(),
        },
        isActive: true,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      });

      await session.save();

      const tokens = this.generateTokens(user, session._id.toString());

      // Update user last login
      await this.userModel.findByIdAndUpdate((user as any)._id, {
        lastLoginAt: new Date(),
        $inc: { loginCount: 1 },
      });

      return { user, tokens, isNewUser };
    } catch (error) {
      AuthService.recordDbFailure();
      throw error;
    }
  }

  static cleanup(): void {
    // Clear user ID cache
    AuthService.userIdCache.clear();

    // Reset circuit breaker
    AuthService.dbFailureCount = 0;
    AuthService.lastDbFailureTime = 0;
  }

  private generateToken(length: number): string {
    return uuidv4().replace(/-/g, '').substring(0, length);
  }

  /**
   * Find user by ID - added for Gateway compatibility
   */
  async findUserById(userId: string): Promise<User | null> {
    try {
      return await this.userModel.findById(userId).exec();
    } catch (error) {
      this.logger.error('Error finding user by ID', {
        error: error instanceof Error ? error.message : 'Unknown error',
        userId,
      });
      return null;
    }
  }

  /**
   * Decrypt API key - added for Gateway compatibility
   */
  decryptApiKey(encryptedKey: string): string {
    try {
      return this.encryptionService.decrypt(encryptedKey);
    } catch (error) {
      this.logger.error('Error decrypting API key', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new BadRequestException('Failed to decrypt API key');
    }
  }
}
