import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  CanActivate,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../schemas/user/user.schema';

interface AuthenticatedUser {
  id: string;
  _id: string;
  email: string;
  role?: string;
  permissions?: string[];
  apiKeyId?: string;
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private configService: ConfigService,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    try {
      const apiKey = this.extractApiKeyFromRequest(request);

      if (!apiKey) {
        throw new UnauthorizedException('No API key provided');
      }

      const user = await this.authenticateApiKey(apiKey, request);
      request.user = user;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('API key authentication failed');
    }
  }

  private extractApiKeyFromRequest(request: any): string | null {
    // Check Authorization header (Bearer with ck_ prefix)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ck_')) {
      return authHeader.substring(7); // Remove 'Bearer ' prefix
    }

    // Check X-API-Key header
    if (request.headers['x-api-key']) {
      return request.headers['x-api-key'];
    }

    // Check query parameter
    if (request.query.api_key) {
      return request.query.api_key;
    }

    return null;
  }

  private async authenticateApiKey(
    apiKey: string,
    request: any,
  ): Promise<AuthenticatedUser> {
    // Parse API key format: dak_userId_keyId_secret
    const parsedKey = this.parseApiKey(apiKey);
    if (!parsedKey) {
      throw new UnauthorizedException('Invalid API key format');
    }

    const { userId, keyId, secret } = parsedKey;

    // Find user and validate API key
    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Check if account is closed
    if (user.accountClosure?.status === 'deleted') {
      throw new UnauthorizedException('Account is closed');
    }

    // Find the API key in user's dashboardApiKeys
    const apiKeyDoc = user.dashboardApiKeys?.find(
      (key) =>
        key.keyId === keyId &&
        key.isActive !== false &&
        (!key.expiresAt || key.expiresAt > new Date()),
    );

    if (!apiKeyDoc) {
      throw new UnauthorizedException('Invalid or expired API key');
    }

    // Decrypt the stored encrypted key for validation
    const [iv, authTag, encrypted] = apiKeyDoc.encryptedKey.split(':');
    if (!iv || !authTag || !encrypted) {
      throw new UnauthorizedException('Invalid API key format in database');
    }

    let decryptedSecret: string;
    try {
      // Import decrypt function from helpers
      const { decrypt } = require('../../utils/helpers');
      decryptedSecret = decrypt(encrypted, iv, authTag, this.configService);
    } catch (error) {
      throw new UnauthorizedException('Failed to validate API key');
    }

    // Compare the provided secret with the decrypted secret
    if (secret !== decryptedSecret) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Update last used timestamp
    await this.userModel.updateOne(
      { _id: user._id, 'dashboardApiKeys.keyId': keyId },
      {
        $set: {
          'dashboardApiKeys.$.lastUsed': new Date(),
        },
      },
    );

    return {
      id: user._id.toString(),
      _id: user._id.toString(),
      email: user.email,
      role: user.role,
      permissions: apiKeyDoc.permissions || [],
      apiKeyId: keyId,
    };
  }

  private parseApiKey(
    apiKey: string,
  ): { userId: string; keyId: string; secret: string } | null {
    // Parse API key format: dak_userId_keyId_secret
    const parts = apiKey.split('_');
    if (parts.length !== 4 || parts[0] !== 'dak') {
      return null;
    }

    return {
      userId: parts[1],
      keyId: parts[2],
      secret: parts[3],
    };
  }
}
