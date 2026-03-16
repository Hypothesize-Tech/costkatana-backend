import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  CanActivate,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../schemas/user/user.schema';
import { UserSessionService } from '../../modules/user-session/user-session.service';
import { EncryptionService } from '../encryption/encryption.service';

interface AuthenticatedUser {
  id: string;
  _id: string;
  email: string;
  role?: string;
  permissions?: string[];
  sessionId?: string;
  apiKeyId?: string;
  workspaceId?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectModel(User.name) private userModel: Model<User>,
    private userSessionService: UserSessionService,
    private encryptionService: EncryptionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

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

      if (!token) {
        throw new UnauthorizedException('No authentication token provided');
      }

      // Handle dashboard API key authentication (dak_ or ck_ prefix)
      if (token.startsWith('dak_') || token.startsWith('ck_')) {
        const user = await this.authenticateApiKey(token, request);
        request.user = user;
        return true;
      }

      // Handle JWT authentication
      const user = await this.authenticateJwt(token, request);
      request.user = user;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Authentication failed');
    }
  }

  private extractTokenFromRequest(request: any): string | null {
    // Check CostKatana-Auth header first (gateway requests - same as Express)
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
    if (request.query.apiKey) {
      return request.query.apiKey;
    }

    // Check cookie
    if (request.cookies?.token) {
      return request.cookies.token;
    }

    return null;
  }

  private async authenticateJwt(
    token: string,
    request: any,
  ): Promise<AuthenticatedUser> {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get('JWT_SECRET') || 'default-secret',
      });

      // Check if token is expired
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        throw new UnauthorizedException('Token has expired');
      }

      // Fetch user - standard tokens use 'id'; support 'sub' for JWT spec compatibility
      const userId = (payload as { id?: string; sub?: string }).id ?? (payload as { sub?: string }).sub;
      const user = await this.userModel
        .findById(userId)
        .select('_id email role permissions accountClosure workspaceId');
      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      // Check if user account is closed
      if (user.accountClosure?.status === 'deleted') {
        throw new UnauthorizedException('Account is closed');
      }

      // Validate session if jti is in token (aligned with Express)
      if (payload.jti) {
        const isValidSession = await this.userSessionService.validateSession(
          payload.jti,
        );
        if (!isValidSession) {
          throw new UnauthorizedException('Invalid session');
        }

        // Update session last activity asynchronously (don't block auth)
        setImmediate(async () => {
          try {
            await this.userSessionService.updateUserSessionActivity(
              payload.jti,
            );
          } catch (error) {
            this.logger.warn(
              'Failed to update session activity (non-critical)',
              {
                sessionId: payload.jti,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        });
      }

      return {
        id: user._id.toString(),
        _id: user._id.toString(),
        email: user.email,
        role: user.role,
        permissions:
          (user as any).permissions?.length > 0
            ? (user as any).permissions
            : ['read', 'write', 'admin'],
        sessionId: payload.jti, // Aligned with Express (jti field)
        workspaceId: (user as any).workspaceId?.toString() ?? undefined,
      };
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        throw new UnauthorizedException('Invalid token');
      }
      if (error.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Token has expired');
      }
      throw error;
    }
  }

  private async authenticateApiKey(
    apiKey: string,
    request: any,
  ): Promise<AuthenticatedUser> {
    const parsedKey = this.parseApiKey(apiKey);
    if (!parsedKey) {
      throw new UnauthorizedException('Invalid API key format');
    }

    const { userId, keyId, secret } = parsedKey;

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (user.accountClosure?.status === 'deleted') {
      throw new UnauthorizedException('Account is closed');
    }

    const apiKeyDoc = user.dashboardApiKeys?.find(
      (key) =>
        key.keyId === keyId &&
        key.isActive !== false &&
        (!key.expiresAt || key.expiresAt > new Date()),
    );

    if (!apiKeyDoc) {
      throw new UnauthorizedException('Invalid or expired API key');
    }

    const [iv, authTag, encrypted] = apiKeyDoc.encryptedKey.split(':');
    if (!iv || !authTag || !encrypted) {
      throw new UnauthorizedException('Invalid API key format in database');
    }

    let decryptedSecret: string;
    try {
      decryptedSecret = this.encryptionService.decrypt(apiKeyDoc.encryptedKey);
    } catch {
      throw new UnauthorizedException('Failed to validate API key');
    }

    if (secret !== decryptedSecret) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Use the request, e.g., track request info on the API key usage
    // Example: Store client IP and user-agent for auditing if available
    const auditInfo: Record<string, any> = {};
    if (request) {
      if (request.ip || request.headers['x-forwarded-for']) {
        auditInfo.lastUsedIp = request.headers['x-forwarded-for'] || request.ip;
      }
      if (request.headers && request.headers['user-agent']) {
        auditInfo.lastUsedUserAgent = request.headers['user-agent'];
      }
    }

    await this.userModel.updateOne(
      { _id: user._id, 'dashboardApiKeys.keyId': keyId },
      {
        $set: {
          'dashboardApiKeys.$.lastUsed': new Date(),
          ...(Object.entries(auditInfo).length > 0
            ? Object.fromEntries(
                Object.entries(auditInfo).map(([k, v]) => [
                  `dashboardApiKeys.$.${k}`,
                  v,
                ]),
              )
            : {}),
        },
      },
    );

    return {
      id: (user as any)._id.toString(),
      _id: (user as any)._id.toString(),
      email: user.email,
      role: user.role,
      permissions: apiKeyDoc.permissions || [],
      apiKeyId: keyId,
      // Optionally, you can expose request/audit info if desired:
      ...(auditInfo.lastUsedIp ? { lastUsedIp: auditInfo.lastUsedIp } : {}),
      ...(auditInfo.lastUsedUserAgent
        ? { lastUsedUserAgent: auditInfo.lastUsedUserAgent }
        : {}),
    };
  }

  private parseApiKey(
    apiKey: string,
  ): { userId: string; keyId: string; secret: string } | null {
    const parts = apiKey.split('_');
    if (parts.length !== 4 || parts[0] !== 'dak') return null;
    return { userId: parts[1], keyId: parts[2], secret: parts[3] };
  }
}
