import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '@/schemas/user/user.schema';
import { AuthService } from '../auth.service';

@Injectable()
export class AuthMfaTokenGuard implements CanActivate {
  private readonly logger = new Logger(AuthMfaTokenGuard.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<User>,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();

    this.logger.log('=== MFA AUTHENTICATION GUARD STARTED ===', {
      component: 'AuthMfaTokenGuard',
      operation: 'canActivate',
      type: 'mfa_token_auth',
      path: request.path,
      method: request.method,
    });

    this.logger.log('Step 1: Extracting authentication header', {
      component: 'AuthMfaTokenGuard',
      operation: 'canActivate',
      type: 'mfa_token_auth',
      step: 'extract_header',
    });

    // Extract token from Authorization header
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      this.logger.warn('No Authorization header or invalid format', {
        component: 'AuthMfaTokenGuard',
        operation: 'canActivate',
        type: 'mfa_token_auth',
        step: 'header_validation_failed',
        hasHeader: !!authHeader,
        headerFormat: authHeader ? authHeader.substring(0, 20) + '...' : 'none',
      });
      throw new UnauthorizedException('No authentication provided');
    }

    const token = authHeader.substring(7);
    this.logger.log('Token extracted from header successfully', {
      component: 'AuthMfaTokenGuard',
      operation: 'canActivate',
      type: 'mfa_token_auth',
      step: 'token_extracted',
      tokenLength: token.length,
      tokenPrefix: token.substring(0, 10) + '...',
    });

    this.logger.log('Step 2: Attempting MFA token verification', {
      component: 'AuthMfaTokenGuard',
      operation: 'canActivate',
      type: 'mfa_token_auth',
      step: 'try_mfa_token',
    });

    let user: any = null;

    // Try MFA token first (for login flow)
    try {
      const payload = this.authService.verifyMFAToken(token);
      this.logger.log('MFA token verified successfully', {
        component: 'AuthMfaTokenGuard',
        operation: 'canActivate',
        type: 'mfa_token_auth',
        step: 'mfa_token_verified',
        userId: payload.userId,
        tokenType: 'mfa_token',
      });

      this.logger.log('Step 2a: Finding user for MFA token', {
        component: 'AuthMfaTokenGuard',
        operation: 'canActivate',
        type: 'mfa_token_auth',
        step: 'find_user_mfa',
      });

      user = await this.userModel.findById(payload.userId);
      if (user) {
        this.logger.log('User found via MFA token', {
          component: 'AuthMfaTokenGuard',
          operation: 'canActivate',
          type: 'mfa_token_auth',
          step: 'user_found_mfa',
          userId: user._id,
          email: user.email,
          name: user.name,
          role: user.role,
        });
      } else {
        this.logger.warn('User not found for MFA token', {
          component: 'AuthMfaTokenGuard',
          operation: 'canActivate',
          type: 'mfa_token_auth',
          step: 'user_not_found_mfa',
          userId: payload.userId,
        });
      }
    } catch (mfaError) {
      this.logger.log(
        'MFA token verification failed, trying regular access token',
        {
          component: 'AuthMfaTokenGuard',
          operation: 'canActivate',
          type: 'mfa_token_auth',
          step: 'mfa_failed_try_access',
          mfaError:
            mfaError instanceof Error ? mfaError.message : 'Unknown error',
        },
      );

      this.logger.log('Step 2b: Attempting access token verification', {
        component: 'AuthMfaTokenGuard',
        operation: 'canActivate',
        type: 'mfa_token_auth',
        step: 'try_access_token',
      });

      // Try regular access token (for setup flow)
      try {
        const payload = this.authService.verifyAccessToken(token);
        const accessTokenUserId = (payload as { id?: string; sub?: string }).id ?? (payload as { sub?: string }).sub;
        this.logger.log('Access token verified successfully', {
          component: 'AuthMfaTokenGuard',
          operation: 'canActivate',
          type: 'mfa_token_auth',
          step: 'access_token_verified',
          userId: accessTokenUserId,
          tokenType: 'access_token',
        });

        this.logger.log('Step 2c: Finding user for access token', {
          component: 'AuthMfaTokenGuard',
          operation: 'canActivate',
          type: 'mfa_token_auth',
          step: 'find_user_access',
        });

        user = await this.userModel.findById(accessTokenUserId);
        if (user) {
          this.logger.log('User found via access token', {
            component: 'AuthMfaTokenGuard',
            operation: 'canActivate',
            type: 'mfa_token_auth',
            step: 'user_found_access',
            userId: user._id,
            email: user.email,
            name: user.name,
            role: user.role,
          });
        } else {
          this.logger.warn('User not found for access token', {
            component: 'AuthMfaTokenGuard',
            operation: 'canActivate',
            type: 'mfa_token_auth',
            step: 'user_not_found_access',
            userId: accessTokenUserId,
          });
        }
      } catch (accessError) {
        this.logger.warn('Both MFA and access token verification failed', {
          component: 'AuthMfaTokenGuard',
          operation: 'canActivate',
          type: 'mfa_token_auth',
          step: 'both_tokens_failed',
          mfaError:
            mfaError instanceof Error ? mfaError.message : 'Unknown error',
          accessError:
            accessError instanceof Error
              ? accessError.message
              : 'Unknown error',
        });
        throw new UnauthorizedException('Invalid or expired token');
      }
    }

    if (!user) {
      this.logger.warn('User not found for any token type', {
        component: 'AuthMfaTokenGuard',
        operation: 'canActivate',
        type: 'mfa_token_auth',
        step: 'no_user_found',
        tokenLength: token.length,
        tokenPrefix: token.substring(0, 10) + '...',
      });
      throw new UnauthorizedException('Invalid token: User not found');
    }

    this.logger.log('Step 3: Setting up user context', {
      component: 'AuthMfaTokenGuard',
      operation: 'canActivate',
      type: 'mfa_token_auth',
      step: 'setup_user_context',
    });

    // Set user context for the request
    request.user = {
      id: user._id.toString(),
      _id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
    };
    request.userId = user._id.toString();

    this.logger.log('User context set successfully', {
      component: 'AuthMfaTokenGuard',
      operation: 'canActivate',
      type: 'mfa_token_auth',
      step: 'user_context_set',
      userId: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
    });

    this.logger.log('MFA authentication completed successfully', {
      component: 'AuthMfaTokenGuard',
      operation: 'canActivate',
      type: 'mfa_token_auth',
      step: 'authentication_success',
      userId: user._id.toString(),
      totalTime: `${Date.now() - startTime}ms`,
    });

    this.logger.log('=== MFA AUTHENTICATION GUARD COMPLETED ===', {
      component: 'AuthMfaTokenGuard',
      operation: 'canActivate',
      type: 'mfa_token_auth',
      step: 'completed',
      userId: user._id.toString(),
      totalTime: `${Date.now() - startTime}ms`,
    });

    return true;
  }
}
