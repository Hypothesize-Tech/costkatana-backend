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
import * as speakeasy from 'speakeasy';

@Injectable()
export class MfaGuard implements CanActivate {
  constructor(
    private configService: ConfigService,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // If no user is authenticated, MFA guard shouldn't be applied
    if (!user) {
      return true;
    }

    try {
      // Check if user has MFA enabled
      const dbUser = await this.userModel.findById(user.id);
      if (!dbUser) {
        throw new UnauthorizedException('User not found');
      }

      // If MFA is not enabled, skip verification
      if (!dbUser.mfa?.enabled) {
        return true;
      }

      const mfaToken = this.extractMfaToken(request);

      if (!mfaToken) {
        throw new UnauthorizedException('MFA token required');
      }

      const secret = dbUser.mfa.totp.secret;
      if (!secret) {
        throw new UnauthorizedException('MFA secret not configured');
      }
      const isValid = this.verifyMfaToken(mfaToken, secret);

      if (!isValid) {
        throw new UnauthorizedException('Invalid MFA token');
      }

      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('MFA verification failed');
    }
  }

  private extractMfaToken(request: any): string | null {
    // Check x-mfa-token header
    return request.headers['x-mfa-token'] || null;
  }

  private verifyMfaToken(token: string, secret: string): boolean {
    try {
      // Verify TOTP token
      const verified = speakeasy.totp.verify({
        secret: secret,
        encoding: 'base32',
        token: token,
        window: 2, // Allow 30-second window for clock drift
      });

      return verified;
    } catch (error) {
      return false;
    }
  }
}
