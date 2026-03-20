import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthService } from '../../auth/auth.service';
import { KeyVaultService } from '../../key-vault/key-vault.service';
import { AgentIdentityService } from '../../agent-identity/agent-identity.service';
import { GatewayContext } from '../interfaces/gateway.interfaces';
import { CacheService } from '../../../common/cache/cache.service';
import { AgentIdentityDocument } from '@/schemas/agent/agent-identity.schema';

@Injectable()
export class GatewayAuthGuard implements CanActivate {
  private readonly logger = new Logger(GatewayAuthGuard.name);

  constructor(
    private authService: AuthService,
    private keyVaultService: KeyVaultService,
    private agentIdentityService: AgentIdentityService,
    private cacheService: CacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const startTime = Date.now();
    const requestId = request.requestId || 'unknown';

    try {
      this.logger.log('=== GATEWAY AUTHENTICATION STARTED ===', {
        component: 'GatewayAuthGuard',
        operation: 'canActivate',
        type: 'gateway_authentication',
        requestId,
        path: request.originalUrl,
        method: request.method,
      });

      this.logger.log('Step 1: Extracting authentication header', {
        component: 'GatewayAuthGuard',
        operation: 'canActivate',
        type: 'gateway_authentication',
        step: 'extract_header',
        requestId,
      });

      // Accept CostKatana-Auth (gateway/SDK) or standard Authorization (dashboard)
      const authHeader =
        (request.headers['costkatana-auth'] as string) ??
        (request.headers['authorization'] as string);

      if (!authHeader) {
        this.logger.warn('Authentication header missing', {
          component: 'GatewayAuthGuard',
          operation: 'canActivate',
          type: 'gateway_authentication',
          step: 'header_missing',
          requestId,
          path: request.originalUrl,
          method: request.method,
        });
        throw new UnauthorizedException({
          error: 'Authentication header is required',
          message:
            'Please provide authentication via CostKatana-Auth or Authorization header',
        });
      }

      this.logger.log('Step 2: Analyzing authentication type', {
        component: 'GatewayAuthGuard',
        operation: 'canActivate',
        type: 'gateway_authentication',
        step: 'analyze_auth_type',
        requestId,
      });

      // Merge with any context from GatewayHeadersMiddleware (CostKatana-* headers)
      const gatewayContext: GatewayContext = {
        ...(request.gatewayContext ?? {}),
        startTime,
        requestId,
      };

      // Extract Bearer token or API key
      let token: string | undefined;
      let apiKey: string | undefined;
      let user: any;
      let userId: string = '';

      if (authHeader.startsWith('Bearer ')) {
        const authValue = authHeader.substring(7);

        // Check if it's an API key (starts with 'dak_'), proxy key (starts with 'ck-proxy-'), or JWT token
        if (authValue.startsWith('dak_')) {
          apiKey = authValue;
          this.logger.log('Dashboard API key found in CostKatana-Auth header', {
            component: 'GatewayAuthGuard',
            operation: 'canActivate',
            type: 'gateway_authentication',
            step: 'api_key_detected',
            authType: 'dashboard_api_key',
            requestId,
          });
        } else if (authValue.startsWith('ck-proxy-')) {
          this.logger.log('Proxy key detected, processing authentication', {
            component: 'GatewayAuthGuard',
            operation: 'canActivate',
            type: 'gateway_authentication',
            step: 'proxy_key_detected',
            authType: 'proxy_key',
            requestId,
          });

          // Handle proxy key authentication
          const proxyKeyResult = await this.handleProxyKeyAuth(
            authValue,
            request,
            response,
          );
          if (!proxyKeyResult) {
            return false; // Response already sent by handleProxyKeyAuth
          }

          // Set user context from proxy key
          user = proxyKeyResult.user;
          userId = proxyKeyResult.userId;

          // Add proxy key context to request
          gatewayContext.userId = userId;
          gatewayContext.proxyKeyId = authValue;
          gatewayContext.providerKey = proxyKeyResult.decryptedApiKey;
          gatewayContext.provider = proxyKeyResult.provider;
          gatewayContext.authMethodOverride = 'gateway';

          this.logger.log('Proxy key authenticated successfully', {
            component: 'GatewayAuthGuard',
            operation: 'canActivate',
            type: 'gateway_authentication',
            step: 'proxy_key_success',
            proxyKeyId: authValue,
            userId,
            provider: proxyKeyResult.provider,
            requestId,
          });
        } else if (authValue.startsWith('ck-agent-')) {
          this.logger.log(
            'Agent token detected, processing agent authentication',
            {
              component: 'GatewayAuthGuard',
              operation: 'canActivate',
              type: 'gateway_authentication',
              step: 'agent_token_detected',
              authType: 'agent_token',
              requestId,
            },
          );

          // Handle agent authentication
          const clientIP = request.ip || request.connection.remoteAddress || '';
          const agentIdentity =
            await this.agentIdentityService.authenticateAgent(
              authValue,
              clientIP,
            );
          if (!agentIdentity) {
            this.logger.warn('Agent authentication failed', {
              component: 'GatewayAuthGuard',
              operation: 'canActivate',
              type: 'gateway_authentication',
              step: 'agent_auth_failed',
              requestId,
            });
            throw new UnauthorizedException({
              error: 'Invalid agent token',
              message: 'Agent authentication failed',
            });
          }

          // Get user associated with agent
          user = await this.agentIdentityService.getUserByAgentId(
            agentIdentity.agentId,
          );
          if (!user) {
            this.logger.warn('User not found for agent', {
              component: 'GatewayAuthGuard',
              operation: 'canActivate',
              type: 'gateway_authentication',
              agentId: agentIdentity.agentId,
              userId: agentIdentity.userId?.toString(),
              requestId,
            });
            throw new UnauthorizedException({
              error: 'Invalid agent token',
              message: 'User not found for agent',
            });
          }

          userId = user._id.toString();

          // Add agent context to request
          gatewayContext.userId = userId;
          gatewayContext.authMethodOverride = 'agent';
          gatewayContext.isAgentRequest = true;
          gatewayContext.agentId = agentIdentity.agentId;
          gatewayContext.agentIdentityId = (
            agentIdentity as AgentIdentityDocument
          )._id.toString();
          gatewayContext.agentToken = authValue;
          gatewayContext.agentType = agentIdentity.agentType;
          gatewayContext.workspaceId = agentIdentity.workspaceId?.toString();
          gatewayContext.organizationId =
            agentIdentity.organizationId?.toString();

          this.logger.log('Agent authenticated successfully', {
            component: 'GatewayAuthGuard',
            operation: 'canActivate',
            type: 'gateway_authentication',
            step: 'agent_auth_success',
            agentId: agentIdentity.agentId,
            agentType: agentIdentity.agentType,
            userId,
            requestId,
          });
        } else {
          token = authValue;
          this.logger.log('JWT token found in CostKatana-Auth header', {
            component: 'GatewayAuthGuard',
            operation: 'canActivate',
            type: 'gateway_authentication',
            step: 'jwt_token_detected',
            authType: 'jwt_token',
            requestId,
          });
        }
      } else {
        this.logger.warn('Invalid auth header format', {
          component: 'GatewayAuthGuard',
          operation: 'canActivate',
          type: 'gateway_authentication',
          step: 'invalid_format',
          requestId,
          headerValue: authHeader.substring(0, 20) + '...',
        });
        throw new BadRequestException({
          error: 'Invalid auth header format',
          message: 'Auth header must be in format: Bearer YOUR_TOKEN',
        });
      }

      this.logger.log('Step 3: Processing authentication', {
        component: 'GatewayAuthGuard',
        operation: 'canActivate',
        type: 'gateway_authentication',
        step: 'process_auth',
        requestId,
      });

      if (apiKey) {
        this.logger.log('Step 3a: Processing API key authentication', {
          component: 'GatewayAuthGuard',
          operation: 'canActivate',
          type: 'gateway_authentication',
          step: 'process_api_key',
          requestId,
        });

        // Parse API key
        const parsedKey = this.authService.parseApiKey(apiKey);
        if (!parsedKey) {
          this.logger.warn('Invalid API key format', {
            component: 'GatewayAuthGuard',
            operation: 'canActivate',
            type: 'gateway_authentication',
            step: 'invalid_api_key_format',
            requestId,
            apiKey: apiKey.substring(0, 10) + '...',
          });
          throw new UnauthorizedException({
            error: 'Invalid API key format',
            message: 'CostKatana API key format is invalid',
          });
        }

        // Find user and validate API key
        user = await this.authService.findUserById(parsedKey.userId);
        if (!user) {
          this.logger.warn('User not found for API key', {
            component: 'GatewayAuthGuard',
            operation: 'canActivate',
            type: 'gateway_authentication',
            step: 'user_not_found',
            requestId,
            userId: parsedKey.userId,
          });
          throw new UnauthorizedException({
            error: 'Invalid API key',
            message: 'User not found for provided API key',
          });
        }

        // Find matching API key in user's dashboard keys
        const userApiKey = user.dashboardApiKeys?.find(
          (key: any) => key.keyId === parsedKey.keyId,
        );
        if (!userApiKey) {
          this.logger.warn('API key not found in user account', {
            component: 'GatewayAuthGuard',
            operation: 'canActivate',
            type: 'gateway_authentication',
            step: 'api_key_not_found',
            requestId,
            userId: parsedKey.userId,
            keyId: parsedKey.keyId,
          });
          throw new UnauthorizedException({
            error: 'Invalid API key',
            message: 'API key not found in user account',
          });
        }

        // Decrypt and validate the full API key
        try {
          const decryptedKey = this.authService.decryptApiKey(
            userApiKey.encryptedKey,
          );

          if (decryptedKey !== apiKey) {
            this.logger.warn('API key validation failed', {
              component: 'GatewayAuthGuard',
              operation: 'canActivate',
              type: 'gateway_authentication',
              step: 'api_key_validation_failed',
              requestId,
              userId: parsedKey.userId,
              keyId: parsedKey.keyId,
            });
            throw new UnauthorizedException({
              error: 'Invalid API key',
              message: 'API key validation failed',
            });
          }
        } catch (error) {
          this.logger.error(
            error instanceof Error ? error.message : String(error),
            (error as Error).stack,
            {
              component: 'GatewayAuthGuard',
              operation: 'canActivate',
              type: 'gateway_authentication',
              step: 'api_key_decryption_error',
              apiKeyId: parsedKey.keyId,
              requestId,
            },
          );
          throw new UnauthorizedException({
            error: 'Invalid API key',
            message: 'API key validation failed',
          });
        }

        // Check if API key is expired
        if (userApiKey.expiresAt && userApiKey.expiresAt < new Date()) {
          this.logger.warn('API key has expired', {
            component: 'GatewayAuthGuard',
            operation: 'canActivate',
            type: 'gateway_authentication',
            step: 'api_key_expired',
            requestId,
            userId: parsedKey.userId,
            keyId: parsedKey.keyId,
            expiresAt: userApiKey.expiresAt,
          });
          throw new UnauthorizedException({
            error: 'API key expired',
            message: 'Your API key has expired',
          });
        }

        userId = user._id.toString();

        this.logger.log('API key authentication successful', {
          component: 'GatewayAuthGuard',
          operation: 'canActivate',
          type: 'gateway_authentication',
          step: 'api_key_success',
          requestId,
          userId,
          keyId: parsedKey.keyId,
        });
      } else if (token) {
        this.logger.log('Step 3b: Processing JWT token authentication', {
          component: 'GatewayAuthGuard',
          operation: 'canActivate',
          type: 'gateway_authentication',
          step: 'process_jwt',
          requestId,
        });

        // JWT token validation (reuse existing logic)
        // Standard login tokens use 'id', API-key tokens use 'sub' - support both
        try {
          const decoded = this.authService.verifyAccessToken(token);
          const payload = decoded as { sub?: string; id?: string };
          userId = payload.sub ?? payload.id ?? '';
          if (!userId) {
            throw new UnauthorizedException({
              error: 'Invalid token',
              message: 'Token payload missing user identifier',
            });
          }
          user = await this.authService.findUserById(userId);

          if (!user) {
            this.logger.warn('User not found for JWT token', {
              component: 'GatewayAuthGuard',
              operation: 'canActivate',
              type: 'gateway_authentication',
              step: 'jwt_user_not_found',
              requestId,
              userId,
            });
            throw new UnauthorizedException({
              error: 'Invalid token',
              message: 'User not found for provided token',
            });
          }

          this.logger.log('JWT token validation successful', {
            component: 'GatewayAuthGuard',
            operation: 'canActivate',
            type: 'gateway_authentication',
            step: 'jwt_success',
            requestId,
            userId,
          });
        } catch (error) {
          this.logger.error(
            error instanceof Error ? error.message : String(error),
            (error as Error).stack,
            {
              component: 'GatewayAuthGuard',
              operation: 'canActivate',
              type: 'gateway_authentication',
              step: 'jwt_validation_error',
              requestId,
              tokenId: token.substring(0, 10) + '...',
            },
          );
          throw new UnauthorizedException({
            error: 'Invalid token',
            message: 'Token validation failed',
          });
        }
      }

      this.logger.log('Step 4: Setting up gateway context', {
        component: 'GatewayAuthGuard',
        operation: 'canActivate',
        type: 'gateway_authentication',
        step: 'setup_context',
        requestId,
      });

      // Set gateway context
      gatewayContext.userId = userId;
      request.gatewayContext = gatewayContext;

      // Attach user to request
      request.user = user;

      this.logger.log('Gateway authentication completed successfully', {
        component: 'GatewayAuthGuard',
        operation: 'canActivate',
        type: 'gateway_authentication',
        step: 'completed',
        requestId,
        userId,
        authMethod: apiKey ? 'API Key' : token ? 'JWT Token' : 'Proxy/Agent',
        totalTime: `${Date.now() - startTime}ms`,
      });

      this.logger.log('=== GATEWAY AUTHENTICATION COMPLETED ===', {
        component: 'GatewayAuthGuard',
        operation: 'canActivate',
        type: 'gateway_authentication',
        step: 'completed',
        requestId,
        userId,
        totalTime: `${Date.now() - startTime}ms`,
      });

      return true;
    } catch (error) {
      this.logger.error(
        error instanceof Error ? error.message : String(error),
        (error as Error).stack,
        {
          component: 'GatewayAuthGuard',
          operation: 'canActivate',
          type: 'gateway_authentication',
          step: 'error',
          requestId,
          totalTime: `${Date.now() - startTime}ms`,
        },
      );

      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      throw new UnauthorizedException({
        error: 'Authentication failed',
        message: 'Internal server error during authentication',
      });
    }
  }

  /**
   * Handle proxy key authentication
   */
  private async handleProxyKeyAuth(
    proxyKeyId: string,
    request: any,
    response: any,
  ): Promise<{
    user: any;
    userId: string;
    decryptedApiKey: string;
    provider: string;
  } | null> {
    try {
      // Resolve proxy key to get master provider key
      const result = await this.keyVaultService.resolveProxyKey(proxyKeyId);

      if (!result) {
        this.logger.warn('Proxy key resolution failed', {
          component: 'GatewayAuthGuard',
          operation: 'handleProxyKeyAuth',
          type: 'proxy_key_auth',
          step: 'resolution_failed',
          proxyKeyId,
        });

        response.status(401).json({
          error: 'Invalid proxy key',
          message: 'Proxy key not found, expired, or over budget',
        });
        return null;
      }

      const { proxyKey, providerKey, decryptedApiKey } = result;

      // Get user information
      const user = await this.authService.findUserById(
        proxyKey.userId.toString(),
      );
      if (!user) {
        this.logger.warn('User not found for proxy key', {
          component: 'GatewayAuthGuard',
          operation: 'handleProxyKeyAuth',
          type: 'proxy_key_auth',
          step: 'user_not_found',
          proxyKeyId,
          userId: proxyKey.userId,
        });

        response.status(401).json({
          error: 'Invalid proxy key',
          message: 'User not found for proxy key',
        });
        return null;
      }

      // Check rate limiting if configured
      if (proxyKey.rateLimit) {
        const rateLimitResult = await this.checkRateLimit(request);
        if (!rateLimitResult.allowed) {
          return null; // Rate limit exceeded, response already sent
        }
      }

      // Check IP whitelist if configured
      if (proxyKey.allowedIPs && proxyKey.allowedIPs.length > 0) {
        const clientIP = request.ip || request.connection.remoteAddress || '';
        if (!proxyKey.allowedIPs.includes(clientIP)) {
          this.logger.warn('IP not allowed for proxy key', {
            component: 'GatewayAuthGuard',
            operation: 'handleProxyKeyAuth',
            type: 'proxy_key_auth',
            proxyKeyId,
            clientIP,
            allowedIPs: proxyKey.allowedIPs,
          });

          response.status(403).json({
            error: 'Access denied',
            message: 'Your IP address is not allowed to use this proxy key',
          });
          return null;
        }
      }

      return {
        user,
        userId: (
          user as unknown as { _id: { toString(): string } }
        )._id.toString(),
        decryptedApiKey,
        provider: providerKey.provider,
      };
    } catch (error) {
      this.logger.error(
        'Proxy key auth error',
        error instanceof Error ? error.message : String(error),
        {
          component: 'GatewayAuthGuard',
          operation: 'handleProxyKeyAuth',
          type: 'proxy_key_auth',
          step: 'error',
          proxyKeyId,
        },
      );

      response.status(500).json({
        error: 'Authentication error',
        message: 'Internal server error during proxy key authentication',
      });
      return null;
    }
  }

  /**
   * Check rate limit for proxy key requests
   */
  private async checkRateLimit(
    request: any,
  ): Promise<{ allowed: boolean; retryAfter?: number }> {
    try {
      const startTime = Date.now();
      const requestId =
        (request.headers['x-request-id'] as string) || 'unknown';

      this.logger.debug('Checking rate limit for gateway request', {
        component: 'GatewayAuthGuard',
        operation: 'checkRateLimit',
        type: 'rate_limit_check',
        requestId,
        userId: request.user?.id,
        hasUser: !!request.user?.id,
        hasIP: !!request.ip,
      });

      // Generate rate limit key based on user or IP
      const key = request.user?.id || request.ip || 'anonymous';
      const cacheKey = `gateway_rate_limit:${key}`;
      const now = Date.now();
      const windowMs = 60000; // 1 minute window
      const maxRequests = 100; // Max 100 requests per minute

      // Get rate limit record from cache
      let record: { count: number; resetTime: number } | null = null;
      try {
        record = await this.cacheService.get<{
          count: number;
          resetTime: number;
        }>(cacheKey);
      } catch (cacheError) {
        this.logger.warn('Failed to retrieve rate limit record from cache', {
          component: 'GatewayAuthGuard',
          operation: 'checkRateLimit',
          type: 'rate_limit_cache_error',
          requestId,
          key,
          cacheKey,
          error:
            cacheError instanceof Error ? cacheError.message : 'Unknown error',
        });
      }

      // Check if record exists and is still valid
      if (!record || record.resetTime < now) {
        // Create new record
        record = {
          count: 1,
          resetTime: now + windowMs,
        };

        this.logger.debug('New rate limit record created', {
          component: 'GatewayAuthGuard',
          operation: 'checkRateLimit',
          type: 'rate_limit_new_record',
          requestId,
          key,
          cacheKey,
          resetTime: new Date(record.resetTime).toISOString(),
        });
      } else {
        // Increment existing record
        record.count++;

        this.logger.debug('Existing rate limit record incremented', {
          component: 'GatewayAuthGuard',
          operation: 'checkRateLimit',
          type: 'rate_limit_increment',
          requestId,
          key,
          cacheKey,
          newCount: record.count,
          maxRequests,
          remaining: Math.max(0, maxRequests - record.count),
        });
      }

      // Check if limit exceeded
      if (record.count > maxRequests) {
        const retryAfter = Math.ceil((record.resetTime - now) / 1000);

        this.logger.warn('Rate limit exceeded for gateway request', {
          component: 'GatewayAuthGuard',
          operation: 'checkRateLimit',
          type: 'rate_limit_exceeded',
          requestId,
          key,
          cacheKey,
          count: record.count,
          maxRequests,
          retryAfter,
          resetTime: new Date(record.resetTime).toISOString(),
        });

        return { allowed: false, retryAfter };
      }

      // Store updated record in cache (non-blocking)
      try {
        const ttl = Math.ceil((record.resetTime - now) / 1000);
        await this.cacheService.set(cacheKey, record, ttl, {
          type: 'gateway_rate_limit',
          key,
          maxRequests,
          windowMs,
        });

        this.logger.debug('Rate limit record stored successfully', {
          component: 'GatewayAuthGuard',
          operation: 'checkRateLimit',
          type: 'rate_limit_stored',
          requestId,
          key,
          cacheKey,
          ttl,
          count: record.count,
        });
      } catch (storeError) {
        this.logger.warn('Failed to store rate limit record', {
          component: 'GatewayAuthGuard',
          operation: 'checkRateLimit',
          type: 'rate_limit_store_error',
          requestId,
          key,
          cacheKey,
          error:
            storeError instanceof Error ? storeError.message : 'Unknown error',
        });
        // Don't fail the request if cache store fails
      }

      this.logger.debug('Rate limit check passed', {
        component: 'GatewayAuthGuard',
        operation: 'checkRateLimit',
        type: 'rate_limit_allowed',
        requestId,
        key,
        currentCount: record.count,
        maxRequests,
        remaining: maxRequests - record.count,
        processingTime: `${Date.now() - startTime}ms`,
      });

      return { allowed: true };
    } catch (error) {
      this.logger.error('Rate limit check failed', {
        component: 'GatewayAuthGuard',
        operation: 'checkRateLimit',
        type: 'rate_limit_error',
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Fail-open: allow request if rate limit check fails
      return { allowed: true };
    }
  }
}
