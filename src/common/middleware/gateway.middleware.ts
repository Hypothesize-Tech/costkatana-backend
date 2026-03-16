import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../schemas/user/user.schema';
import { Project } from '../../schemas/team-project/project.schema';
import { KeyVaultService } from '../../modules/key-vault/key-vault.service';
import { CacheService } from '../cache/cache.service';

interface GatewayContext {
  startTime: number;
  requestId?: string;
  targetUrl?: string;
  projectId?: string;
  authMethodOverride?: 'gateway' | 'standard' | 'agent';
  cacheEnabled?: boolean;
  retryEnabled?: boolean;
  budgetId?: string;
  userId?: string;
  properties?: Record<string, string>;
  sessionId?: string;
  traceId?: string;
  modelOverride?: string;
  securityEnabled?: boolean;
  rateLimitPolicy?: string;
  proxyKeyId?: string;
  providerKey?: string;
  provider?: string;
  workspaceId?: string;
}

@Injectable()
export class GatewayMiddleware implements NestMiddleware {
  private readonly logger = new Logger(GatewayMiddleware.name);

  constructor(
    private configService: ConfigService,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(Project.name) private projectModel: Model<Project>,
    private keyVaultService: KeyVaultService,
    private cacheService: CacheService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const requestId = (req as any).requestId || 'unknown';

    try {
      this.logger.log('Gateway middleware initiated', {
        component: 'GatewayMiddleware',
        operation: 'use',
        type: 'gateway_request',
        requestId,
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
      });

      // Initialize gateway context
      const gatewayContext: GatewayContext = {
        startTime,
        requestId,
        cacheEnabled: true,
        retryEnabled: true,
        securityEnabled: true,
      };

      (req as any).gatewayContext = gatewayContext;

      // Extract gateway headers
      this.extractGatewayHeaders(req, gatewayContext);

      // Validate project access if project ID is specified
      if (gatewayContext.projectId) {
        const projectAccess = await this.validateProjectAccess(
          gatewayContext.projectId,
          req,
        );
        if (!projectAccess.allowed) {
          this.logger.warn('Project access denied', {
            component: 'GatewayMiddleware',
            operation: 'use',
            type: 'project_access_denied',
            requestId,
            projectId: gatewayContext.projectId,
            userId: (req as any).user?.id,
            reason: projectAccess.reason,
          });

          res.status(403).json({
            success: false,
            message: 'Access denied to project',
            error: projectAccess.reason,
          });
          return;
        }
      }

      // Check rate limits for gateway requests
      const rateLimitCheck = await this.checkGatewayRateLimit(req);
      if (!rateLimitCheck.allowed) {
        this.logger.warn('Gateway rate limit exceeded', {
          component: 'GatewayMiddleware',
          operation: 'use',
          type: 'gateway_rate_limit_exceeded',
          requestId,
          retryAfter: rateLimitCheck.retryAfter,
        });

        res.setHeader(
          'Retry-After',
          rateLimitCheck.retryAfter?.toString() || '60',
        );
        res.status(429).json({
          success: false,
          message: 'Too many requests',
          retryAfter: rateLimitCheck.retryAfter,
        });
        return;
      }

      // Handle proxy key authentication if present
      if (req.headers['x-proxy-key']) {
        const proxyAuth = await this.handleProxyKeyAuth(req, res);
        if (!proxyAuth) {
          // Response already sent by handleProxyKeyAuth
          return;
        }
        gatewayContext.authMethodOverride = 'gateway';
        gatewayContext.proxyKeyId = proxyAuth.proxyKeyId;
        gatewayContext.provider = proxyAuth.provider;
      }

      // Set gateway context on request
      (req as any).gatewayContext = gatewayContext;

      this.logger.log('Gateway middleware completed successfully', {
        component: 'GatewayMiddleware',
        operation: 'use',
        type: 'gateway_request_completed',
        requestId,
        hasProjectId: !!gatewayContext.projectId,
        hasProxyKey: !!gatewayContext.proxyKeyId,
        duration: `${Date.now() - startTime}ms`,
      });

      next();
    } catch (error) {
      this.logger.error('Gateway middleware error', {
        component: 'GatewayMiddleware',
        operation: 'use',
        type: 'gateway_error',
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${Date.now() - startTime}ms`,
      });

      res.status(500).json({
        success: false,
        message: 'Gateway processing error',
      });
    }
  }

  private extractGatewayHeaders(req: Request, context: GatewayContext): void {
    // Extract CostKatana-specific headers
    context.targetUrl = req.headers['x-target-url'] as string;
    context.projectId = req.headers['x-costkatana-project-id'] as string;
    context.budgetId = req.headers['x-budget-id'] as string;
    context.workspaceId = req.headers['x-workspace-id'] as string;
    context.modelOverride = req.headers['x-model-override'] as string;
    context.traceId = req.headers['x-trace-id'] as string;

    // Extract feature flags
    context.cacheEnabled = req.headers['x-cache-enabled'] !== 'false';
    context.retryEnabled = req.headers['x-retry-enabled'] !== 'false';
    context.securityEnabled = req.headers['x-security-enabled'] !== 'false';

    // Extract rate limit policy
    context.rateLimitPolicy =
      (req.headers['x-rate-limit-policy'] as string) || 'default';

    this.logger.debug('Gateway headers extracted', {
      component: 'GatewayMiddleware',
      operation: 'extractGatewayHeaders',
      type: 'gateway_headers',
      requestId: context.requestId,
      projectId: context.projectId,
      hasTargetUrl: !!context.targetUrl,
      cacheEnabled: context.cacheEnabled,
      securityEnabled: context.securityEnabled,
    });
  }

  private async checkGatewayRateLimit(
    req: Request,
  ): Promise<{ allowed: boolean; retryAfter?: number }> {
    const windowMs = 60000; // 1 minute
    const maxRequests = 100;

    const user = (req as any).user;
    const key = user?.id || req.ip || 'anonymous';
    const cacheKey = `gateway_rate_limit:${key}`;
    const now = Date.now();

    type RateLimitRecord = { count: number; resetTime: number };
    let record: RateLimitRecord | null = null;

    try {
      record = await this.cacheService.get<RateLimitRecord>(cacheKey);
    } catch (error) {
      this.logger.warn('Gateway rate limit: cache get failed', {
        component: 'GatewayMiddleware',
        operation: 'checkGatewayRateLimit',
        cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    if (!record || record.resetTime < now) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
    } else {
      record.count++;
    }

    if (record.count > maxRequests) {
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);
      this.logger.warn('Gateway rate limit exceeded', {
        component: 'GatewayMiddleware',
        operation: 'checkGatewayRateLimit',
        type: 'gateway_rate_limit_exceeded',
        key,
        cacheKey,
        count: record.count,
        maxRequests,
        retryAfter,
      });
      return { allowed: false, retryAfter };
    }

    try {
      const ttl = Math.ceil((record.resetTime - now) / 1000);
      await this.cacheService.set(cacheKey, record, ttl);
    } catch (error) {
      this.logger.warn('Gateway rate limit: cache set failed', {
        component: 'GatewayMiddleware',
        operation: 'checkGatewayRateLimit',
        cacheKey,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return { allowed: true };
  }

  private async handleProxyKeyAuth(
    req: Request,
    res: Response,
  ): Promise<{ proxyKeyId: string; provider: string } | null> {
    try {
      const proxyKeyId = req.headers['x-proxy-key'] as string;
      if (!proxyKeyId) {
        return null;
      }

      this.logger.log('Proxy key authentication initiated', {
        component: 'GatewayMiddleware',
        operation: 'handleProxyKeyAuth',
        type: 'proxy_key_auth',
        requestId: (req as any).requestId,
        proxyKeyId,
      });

      // Resolve proxy key through KeyVault service
      const result = await this.keyVaultService.resolveProxyKey(proxyKeyId);
      if (!result) {
        this.logger.warn('Proxy key resolution failed', {
          component: 'GatewayMiddleware',
          operation: 'handleProxyKeyAuth',
          type: 'proxy_key_auth_failed',
          requestId: (req as any).requestId,
          proxyKeyId,
        });

        res.status(401).json({
          success: false,
          message: 'Invalid proxy key',
        });
        return null;
      }

      const { proxyKey, providerKey } = result;

      // Get user information
      const user = await this.userModel.findById(proxyKey.userId);
      if (!user) {
        this.logger.warn('User not found for proxy key', {
          component: 'GatewayMiddleware',
          operation: 'handleProxyKeyAuth',
          type: 'proxy_key_auth_user_not_found',
          requestId: (req as any).requestId,
          proxyKeyId,
          userId: proxyKey.userId,
        });

        res.status(401).json({
          success: false,
          message: 'Invalid proxy key configuration',
        });
        return null;
      }

      // Check if account is closed
      if (user.accountClosure?.status === 'deleted') {
        this.logger.warn('Account is closed for proxy key', {
          component: 'GatewayMiddleware',
          operation: 'handleProxyKeyAuth',
          type: 'proxy_key_auth_account_closed',
          requestId: (req as any).requestId,
          proxyKeyId,
          userId: user._id,
        });

        res.status(401).json({
          success: false,
          message: 'Account is closed',
        });
        return null;
      }

      // Check IP whitelist if configured
      if (proxyKey.allowedIPs && proxyKey.allowedIPs.length > 0) {
        const clientIP =
          req.ip || req.connection?.remoteAddress?.toString() || '';
        if (!proxyKey.allowedIPs.includes(clientIP)) {
          this.logger.warn('IP not allowed for proxy key', {
            component: 'GatewayMiddleware',
            operation: 'handleProxyKeyAuth',
            type: 'proxy_key_auth_ip_denied',
            requestId: (req as any).requestId,
            proxyKeyId,
            clientIP,
            allowedIPs: proxyKey.allowedIPs,
          });

          res.status(403).json({
            success: false,
            message: 'IP not allowed for this proxy key',
          });
          return null;
        }
      }

      // Check domain whitelist if configured
      if (proxyKey.allowedDomains && proxyKey.allowedDomains.length > 0) {
        const referer = req.headers.referer || '';
        const origin = req.headers.origin || '';

        // Extract domain from referer or origin
        let requestDomain = '';
        try {
          if (referer) {
            requestDomain = new URL(referer).hostname;
          } else if (origin) {
            requestDomain = new URL(origin).hostname;
          }
        } catch (error) {
          // Invalid URL, skip domain check
        }

        if (requestDomain && !proxyKey.allowedDomains.includes(requestDomain)) {
          this.logger.warn('Domain not allowed for proxy key', {
            component: 'GatewayMiddleware',
            operation: 'handleProxyKeyAuth',
            type: 'proxy_key_auth_domain_denied',
            requestId: (req as any).requestId,
            proxyKeyId,
            requestDomain,
            allowedDomains: proxyKey.allowedDomains,
          });

          res.status(403).json({
            success: false,
            message: 'Domain not allowed for this proxy key',
          });
          return null;
        }
      }

      this.logger.log('Proxy key authentication successful', {
        component: 'GatewayMiddleware',
        operation: 'handleProxyKeyAuth',
        type: 'proxy_key_auth_success',
        requestId: (req as any).requestId,
        proxyKeyId,
        provider: providerKey.provider,
        userId: user._id,
      });

      return {
        proxyKeyId: (proxyKey as any)._id.toString(),
        provider: providerKey.provider,
      };
    } catch (error) {
      this.logger.error('Proxy key authentication error', {
        component: 'GatewayMiddleware',
        operation: 'handleProxyKeyAuth',
        type: 'proxy_key_auth_error',
        requestId: (req as any).requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      res.status(500).json({
        success: false,
        message: 'Proxy key authentication error',
      });

      return null;
    }
  }

  private async validateProjectAccess(
    projectId: string,
    req: Request,
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const user = (req as any).user;
      if (!user) {
        return { allowed: false, reason: 'Authentication required' };
      }

      // Find the project
      const project = await this.projectModel.findById(projectId);
      if (!project) {
        return { allowed: false, reason: 'Project not found' };
      }

      // Check if project is active
      if (!project.isActive) {
        return { allowed: false, reason: 'Project is not active' };
      }

      // Check if user is project owner
      const isOwner = project.ownerId?.toString() === user.id;
      if (isOwner) {
        return { allowed: true };
      }

      // Check if user has workspace membership with appropriate role
      const userDoc = await this.userModel.findById(user.id);
      if (!userDoc) {
        return { allowed: false, reason: 'User not found' };
      }

      // Check workspace memberships for access to projects in that workspace
      const hasWorkspaceAccess = (userDoc as any).workspaceMemberships?.some(
        (membership: any) =>
          membership.workspaceId?.toString() ===
            project.workspaceId?.toString() && membership.role !== 'viewer',
      );

      if (hasWorkspaceAccess) {
        return { allowed: true };
      }

      return { allowed: false, reason: 'Insufficient project permissions' };
    } catch (error) {
      this.logger.error('Project access validation error', {
        component: 'GatewayMiddleware',
        operation: 'validateProjectAccess',
        type: 'project_validation_error',
        projectId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return { allowed: false, reason: 'Project validation error' };
    }
  }
}
