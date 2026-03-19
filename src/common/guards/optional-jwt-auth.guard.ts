import {
  Injectable,
  ExecutionContext,
  CanActivate,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../schemas/user/user.schema';
import { UserSession } from '../../schemas/user/user-session.schema';
import { decrypt } from '../../utils/helpers';

interface AuthenticatedUser {
  id: string;
  _id: string;
  email: string;
  role?: string;
  permissions?: string[];
  sessionId?: string;
  apiKeyId?: string;
}

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(OptionalJwtAuthGuard.name);

  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(UserSession.name) private userSessionModel: Model<UserSession>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    try {
      const token = this.extractTokenFromRequest(request);

      // If no token is provided, allow the request to proceed without authentication
      if (!token) {
        return true;
      }

      // Handle dashboard API key authentication (dak_ or ck_ prefix)
      if (
        token.startsWith('dak_') ||
        token.startsWith('ck_') ||
        (request.query.apiKey &&
          (request.query.apiKey.startsWith('dak_') ||
            request.query.apiKey.startsWith('ck_')))
      ) {
        const apiKeyToken =
          request.query.apiKey &&
          (request.query.apiKey.startsWith('dak_') ||
            request.query.apiKey.startsWith('ck_'))
            ? request.query.apiKey
            : token;
        const user = await this.authenticateApiKey(apiKeyToken);
        request.user = user;
        return true;
      }

      // Handle JWT authentication
      const user = await this.authenticateJwt(token);
      request.user = user;
      return true;
    } catch (error) {
      // For optional auth, we don't throw errors - just allow the request to proceed
      // The request.user will be undefined, which is fine for optional authentication
      return true;
    }
  }

  private extractTokenFromRequest(request: any): string | null {
    // Check for CostKatana-Auth header first (gateway requests)
    const costkatanaAuth = request.headers['costkatana-auth'] as string;
    if (costkatanaAuth && costkatanaAuth.startsWith('Bearer ')) {
      return costkatanaAuth.substring(7);
    }

    // Check Authorization header (Bearer token)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Check query parameter
    if (request.query.token) {
      return request.query.token;
    }

    // Check apiKey query parameter
    if (request.query.apiKey) {
      return request.query.apiKey;
    }

    // Check cookie
    if (request.cookies?.token) {
      return request.cookies.token;
    }

    return null;
  }

  private async authenticateJwt(token: string): Promise<AuthenticatedUser> {
    try {
      const secret = this.configService.get<string>('JWT_SECRET');
      if (!secret) {
        throw new Error(
          'JWT_SECRET is required. Application should have validated this at startup.',
        );
      }
      const payload = this.jwtService.verify(token, { secret });

      // Check if token is expired
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error('Token has expired');
      }

      // Fetch user - standard tokens use 'id'; support 'sub' for JWT spec compatibility
      const userId =
        (payload as { id?: string; sub?: string }).id ??
        (payload as { sub?: string }).sub;
      const user = await this.userModel.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check if user account is closed
      if (user.accountClosure?.status === 'deleted') {
        throw new Error('Account is closed');
      }

      // If jti claim exists, validate user session (for session-based auth)
      const sessionId = payload.jti ?? payload.sessionId;
      if (sessionId) {
        try {
          const session = await this.userSessionModel.findOne({
            userSessionId: sessionId,
            userId: user._id,
            isActive: true,
          });

          if (!session) {
            throw new Error('Session has been revoked or is invalid');
          }

          // Update session last activity
          await this.userSessionModel.findByIdAndUpdate(session._id, {
            lastActivityAt: new Date(),
          });
        } catch (sessionError) {
          // Log but don't block for optional auth
          this.logger.warn('Session validation failed', sessionError);
        }
      }

      return {
        id: user._id.toString(),
        _id: user._id.toString(),
        email: user.email,
        role: user.role,
        permissions: (user as any).permissions || [],
        sessionId: payload.jti ?? payload.sessionId,
      };
    } catch (error) {
      throw error;
    }
  }

  private async authenticateApiKey(apiKey: string): Promise<AuthenticatedUser> {
    const parsedKey = this.parseApiKey(apiKey);
    if (!parsedKey) {
      throw new Error('Invalid API key format');
    }

    const { userId, keyId, secret } = parsedKey;

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new Error('Invalid API key');
    }

    if (user.accountClosure?.status === 'deleted') {
      throw new Error('Account is closed');
    }

    const apiKeyDoc = user.dashboardApiKeys?.find(
      (key) =>
        key.keyId === keyId &&
        key.isActive !== false &&
        (!key.expiresAt || key.expiresAt > new Date()),
    );

    if (!apiKeyDoc) {
      throw new Error('Invalid or expired API key');
    }

    const [iv, authTag, encrypted] = apiKeyDoc.encryptedKey.split(':');
    if (!iv || !authTag || !encrypted) {
      throw new Error('Invalid API key format in database');
    }

    let decryptedSecret: string;
    try {
      decryptedSecret = decrypt(encrypted, iv, authTag, this.configService);
    } catch {
      throw new Error('Failed to validate API key');
    }

    if (secret !== decryptedSecret) {
      throw new Error('Invalid API key');
    }

    await this.userModel.updateOne(
      { _id: user._id, 'dashboardApiKeys.keyId': keyId },
      { $set: { 'dashboardApiKeys.$.lastUsed': new Date() } },
    );

    return {
      id: (user as any)._id.toString(),
      _id: (user as any)._id.toString(),
      email: user.email,
      role: user.role,
      permissions: apiKeyDoc.permissions || [],
      apiKeyId: keyId,
    };
  }

  private parseApiKey(
    apiKey: string,
  ): { userId: string; keyId: string; secret: string } | null {
    const parts = apiKey.split('_');
    // Support both dak_ (Dashboard API Key) and ck_ (Cost Katana key) formats.
    // Both use format: prefix_userId_keyId_secret (4 parts).
    if (parts.length !== 4 || !['dak', 'ck'].includes(parts[0])) return null;
    return { userId: parts[1], keyId: parts[2], secret: parts[3] };
  }
}
