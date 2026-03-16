import {
  Injectable,
  NestMiddleware,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Agent Sandbox Middleware
 * Provides comprehensive isolation and security controls for agent operations
 * Prevents agents from accessing unauthorized resources or performing dangerous operations
 * Includes resource monitoring, rate limiting, and execution tracking
 */
@Injectable()
export class AgentSandboxMiddleware implements NestMiddleware {
  private readonly logger = new Logger(AgentSandboxMiddleware.name);
  private sandboxEnabled: boolean;
  private allowedDomains: string[];
  private blockedOperations: string[];
  private readonly maxRequestSize = 10 * 1024 * 1024; // 10MB
  private readonly executionTimeouts = new Map<string, NodeJS.Timeout>();
  private readonly activeExecutions = new Map<
    string,
    { startTime: number; userId: string; endpoint: string }
  >();

  // Rate limiting per user
  private readonly requestCounts = new Map<
    string,
    { count: number; resetTime: number }
  >();
  private readonly rateLimit = 100; // requests per window
  private readonly rateLimitWindow = 60000; // 1 minute

  constructor(private configService: ConfigService) {
    this.sandboxEnabled =
      this.configService.get('AGENT_SANDBOX_ENABLED', 'true') === 'true';
    this.allowedDomains = this.configService
      .get('AGENT_ALLOWED_DOMAINS', 'costkatana.com,github.com')
      .split(',')
      .map((d: string) => d.trim());
    this.blockedOperations = [
      'eval',
      'Function',
      'setTimeout',
      'setInterval',
      'require',
      'import',
      'process',
      'child_process',
      'fs',
      'path',
      'os',
      'net',
      'http',
      'https',
      'vm',
      'cluster',
      'worker_threads',
    ];

    // Cleanup stale executions every 5 minutes
    setInterval(() => this.cleanupStaleExecutions(), 300000);
  }

  async use(req: Request, res: Response, next: NextFunction) {
    if (!this.sandboxEnabled) {
      return next();
    }

    // Only apply sandbox to agent-related endpoints
    if (!this.isAgentEndpoint(req.path)) {
      return next();
    }

    // req.user is set by JwtAuthGuard which runs AFTER middleware.
    // Do not block here - let the route guard handle auth (401 if unauthenticated).
    const user = (req as any).user;
    if (!user) {
      this.checkRequestSize(req);
      return next();
    }

    const userId = user.id;

    // Check rate limiting
    this.checkRateLimit(userId);

    // Check request size
    this.checkRequestSize(req);

    // Check if user has agent permissions
    if (!this.hasAgentPermissions(user)) {
      throw new ForbiddenException(
        'Insufficient permissions for agent operations',
      );
    }

    // Validate request content for security
    await this.validateRequestContent(req);

    // Generate execution ID
    const executionId = this.generateExecutionId(userId);

    // Track execution start
    this.trackExecutionStart(executionId, userId, req.path);

    // Add sandbox context to request
    (req as any).sandboxContext = {
      executionId,
      userId: user.id,
      allowedDomains: this.allowedDomains,
      maxExecutionTime: 30000, // 30 seconds
      maxMemoryUsage: 100 * 1024 * 1024, // 100MB
      allowedOperations: this.getAllowedOperations(user),
      timestamp: Date.now(),
      rateLimit: this.getRemainingRequests(userId),
    };

    // Set execution timeout
    const timeout = setTimeout(() => {
      this.handleExecutionTimeout(executionId, userId, req.path);
    }, 30000);

    this.executionTimeouts.set(executionId, timeout);

    // Cleanup on response
    res.on('finish', () => {
      this.trackExecutionEnd(executionId);
      const timeoutHandle = this.executionTimeouts.get(executionId);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        this.executionTimeouts.delete(executionId);
      }
    });

    this.logger.log('Agent request sandboxed', {
      executionId,
      userId: user.id,
      endpoint: req.path,
      method: req.method,
      sandboxEnabled: true,
    });

    next();
  }

  /**
   * Check rate limiting for user
   */
  private checkRateLimit(userId: string): void {
    const now = Date.now();
    const userLimit = this.requestCounts.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
      // Reset or initialize rate limit
      this.requestCounts.set(userId, {
        count: 1,
        resetTime: now + this.rateLimitWindow,
      });
      return;
    }

    if (userLimit.count >= this.rateLimit) {
      const retryAfter = Math.ceil((userLimit.resetTime - now) / 1000);
      throw new ForbiddenException({
        message: 'Rate limit exceeded for agent operations',
        retryAfter,
        limit: this.rateLimit,
        window: this.rateLimitWindow / 1000,
      });
    }

    userLimit.count++;
  }

  /**
   * Get remaining requests for user
   */
  private getRemainingRequests(userId: string): number {
    const userLimit = this.requestCounts.get(userId);
    if (!userLimit) return this.rateLimit;
    return Math.max(0, this.rateLimit - userLimit.count);
  }

  /**
   * Check request size
   */
  private checkRequestSize(req: Request): void {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);

    if (contentLength > this.maxRequestSize) {
      throw new BadRequestException({
        message: 'Request payload too large for agent operations',
        maxSize: this.maxRequestSize,
        receivedSize: contentLength,
      });
    }
  }

  /**
   * Generate unique execution ID
   */
  private generateExecutionId(userId: string): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `${userId}-${timestamp}-${random}`;
  }

  /**
   * Track execution start
   */
  private trackExecutionStart(
    executionId: string,
    userId: string,
    endpoint: string,
  ): void {
    this.activeExecutions.set(executionId, {
      startTime: Date.now(),
      userId,
      endpoint,
    });

    this.logger.debug('Agent execution started', {
      executionId,
      userId,
      endpoint,
      activeExecutions: this.activeExecutions.size,
    });
  }

  /**
   * Track execution end
   */
  private trackExecutionEnd(executionId: string): void {
    const execution = this.activeExecutions.get(executionId);
    if (execution) {
      const duration = Date.now() - execution.startTime;
      this.activeExecutions.delete(executionId);

      this.logger.debug('Agent execution completed', {
        executionId,
        duration,
        userId: execution.userId,
        endpoint: execution.endpoint,
        activeExecutions: this.activeExecutions.size,
      });
    }
  }

  /**
   * Handle execution timeout
   */
  private handleExecutionTimeout(
    executionId: string,
    userId: string,
    endpoint: string,
  ): void {
    this.logger.warn('Agent execution timeout', {
      executionId,
      userId,
      endpoint,
      maxTime: 30000,
    });

    this.activeExecutions.delete(executionId);
    this.executionTimeouts.delete(executionId);
  }

  /**
   * Cleanup stale executions
   */
  private cleanupStaleExecutions(): void {
    const now = Date.now();
    const staleThreshold = 60000; // 1 minute

    for (const [executionId, execution] of this.activeExecutions.entries()) {
      if (now - execution.startTime > staleThreshold) {
        this.logger.warn('Cleaning up stale execution', {
          executionId,
          userId: execution.userId,
          age: now - execution.startTime,
        });
        this.activeExecutions.delete(executionId);
      }
    }
  }

  /**
   * Check if the endpoint is agent-related
   */
  private isAgentEndpoint(path: string): boolean {
    const agentEndpoints = [
      '/api/agent',
      '/api/chat',
      '/api/governed-agent',
      '/api/mcp',
    ];

    return agentEndpoints.some((endpoint) => path.startsWith(endpoint));
  }

  /**
   * Check if user has permissions for agent operations
   */
  private hasAgentPermissions(user: any): boolean {
    // Allow based on subscription plan
    const allowedPlans = ['free', 'basic', 'pro', 'enterprise', 'unlimited'];
    const userPlan = user.subscription?.plan;

    if (userPlan && allowedPlans.includes(userPlan)) {
      return true;
    }

    // In development, allow all authenticated users
    if (process.env.NODE_ENV === 'development') {
      return true;
    }

    // Allow based on specific permissions
    const userPermissions = user.permissions || [];
    return (
      userPermissions.includes('agent_access') ||
      userPermissions.includes('admin')
    );
  }

  /**
   * Validate request content for security issues with enhanced checks
   */
  private async validateRequestContent(req: Request): Promise<void> {
    const body = req.body;

    if (!body || typeof body !== 'object') {
      return;
    }

    // Check for dangerous patterns in request content
    const contentString = JSON.stringify(body).toLowerCase();

    // Check for blocked operations
    for (const operation of this.blockedOperations) {
      if (contentString.includes(operation.toLowerCase())) {
        this.logger.warn('Blocked operation detected in agent request', {
          userId: (req as any).user?.id,
          operation,
          endpoint: req.path,
        });
        throw new ForbiddenException(`Blocked operation: ${operation}`);
      }
    }

    // Check for malicious patterns
    const maliciousPatterns = [
      /<script[\s\S]*?>/i,
      /javascript:/i,
      /data:text\/html/i,
      /vbscript:/i,
      /onload\s*=/i,
      /onerror\s*=/i,
      /onclick\s*=/i,
      /onmouseover\s*=/i,
      /<iframe/i,
      /<embed/i,
      /<object/i,
      /document\.cookie/i,
      /window\.location/i,
      /eval\s*\(/i,
      /new\s+Function\s*\(/i,
    ];

    for (const pattern of maliciousPatterns) {
      if (pattern.test(contentString)) {
        this.logger.warn('Malicious pattern detected in agent request', {
          userId: (req as any).user?.id,
          pattern: pattern.source,
          endpoint: req.path,
        });
        throw new ForbiddenException('Malicious content detected');
      }
    }

    // Check for SQL injection patterns
    const sqlInjectionPatterns = [
      /(\bunion\b.*\bselect\b)|(\bselect\b.*\bfrom\b.*\bwhere\b)/i,
      /(\bdrop\b.*\btable\b)|(\bdelete\b.*\bfrom\b)/i,
      /(\binsert\b.*\binto\b.*\bvalues\b)/i,
      /(\bupdate\b.*\bset\b)/i,
      /--\s*$/m,
      /;\s*drop\s+/i,
      /'\s*or\s+'1'\s*=\s*'1/i,
    ];

    for (const pattern of sqlInjectionPatterns) {
      if (pattern.test(contentString)) {
        this.logger.warn('SQL injection pattern detected', {
          userId: (req as any).user?.id,
          endpoint: req.path,
        });
        throw new ForbiddenException('Suspicious SQL pattern detected');
      }
    }

    // Check for command injection patterns
    const commandInjectionPatterns = [
      /;\s*\w+/,
      /\|\s*\w+/,
      /&&\s*\w+/,
      /`.*`/,
      /\$\(.*\)/,
      />\s*\/\w+/,
      /<\s*\/\w+/,
    ];

    for (const pattern of commandInjectionPatterns) {
      if (pattern.test(contentString)) {
        this.logger.warn('Command injection pattern detected', {
          userId: (req as any).user?.id,
          endpoint: req.path,
        });
        throw new ForbiddenException('Suspicious command pattern detected');
      }
    }

    // Validate URLs in request
    await this.validateUrlsInRequest(body);

    // Check for excessive nesting (potential DoS)
    const maxDepth = 10;
    if (this.getObjectDepth(body) > maxDepth) {
      throw new BadRequestException('Request payload has excessive nesting');
    }

    // Check for circular references
    if (this.hasCircularReference(body)) {
      throw new BadRequestException(
        'Request payload contains circular references',
      );
    }
  }

  /**
   * Get depth of nested object
   */
  private getObjectDepth(obj: any, depth: number = 0): number {
    if (obj === null || typeof obj !== 'object') {
      return depth;
    }

    const depths = Object.values(obj).map((value) =>
      this.getObjectDepth(value, depth + 1),
    );

    return depths.length > 0 ? Math.max(...depths) : depth;
  }

  /**
   * Check for circular references
   */
  private hasCircularReference(obj: any, seen = new WeakSet()): boolean {
    if (obj === null || typeof obj !== 'object') {
      return false;
    }

    if (seen.has(obj)) {
      return true;
    }

    seen.add(obj);

    for (const value of Object.values(obj)) {
      if (this.hasCircularReference(value, seen)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Validate URLs in request to ensure they point to allowed domains with enhanced checks
   */
  private async validateUrlsInRequest(
    obj: any,
    path: string = '',
  ): Promise<void> {
    if (typeof obj === 'string') {
      // Check if string looks like a URL
      if (obj.match(/^https?:\/\//i)) {
        try {
          const url = new URL(obj);

          // Check against allowed domains
          const isAllowed = this.allowedDomains.some(
            (domain) =>
              url.hostname.includes(domain) ||
              url.hostname.endsWith(`.${domain}`),
          );

          if (!isAllowed) {
            this.logger.warn('Blocked URL domain in agent request', {
              url: obj,
              domain: url.hostname,
              allowedDomains: this.allowedDomains,
              path,
            });
            throw new ForbiddenException(
              `URL domain not allowed: ${url.hostname}`,
            );
          }

          // Check for suspicious URL patterns
          if (
            url.hostname === 'localhost' ||
            url.hostname === '127.0.0.1' ||
            url.hostname.startsWith('192.168.') ||
            url.hostname.startsWith('10.') ||
            url.hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)
          ) {
            throw new ForbiddenException(
              'Local/private IP addresses are not allowed',
            );
          }

          // Check for file:// protocol
          if (url.protocol === 'file:') {
            throw new ForbiddenException('File protocol is not allowed');
          }
        } catch (error) {
          if (error instanceof ForbiddenException) {
            throw error;
          }
          this.logger.warn('Invalid URL in agent request', {
            url: obj,
            error: error instanceof Error ? error.message : String(error),
          });
          throw new BadRequestException(`Invalid URL: ${obj}`);
        }
      }
      return;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        await this.validateUrlsInRequest(obj[i], `${path}[${i}]`);
      }
      return;
    }

    if (obj && typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        await this.validateUrlsInRequest(value, path ? `${path}.${key}` : key);
      }
    }
  }

  /**
   * Get allowed operations for the user with enhanced granular permissions
   */
  private getAllowedOperations(user: any): string[] {
    const baseOperations = [
      'web_search',
      'model_selector',
      'code_analysis',
      'text_processing',
    ];

    const plan = user.subscription?.plan;
    const role = user.role;

    // Add operations based on subscription plan
    if (plan === 'pro' || plan === 'enterprise' || plan === 'unlimited') {
      baseOperations.push(
        'advanced_analysis',
        'batch_processing',
        'semantic_search',
      );
    }

    if (plan === 'enterprise' || plan === 'unlimited') {
      baseOperations.push(
        'custom_integrations',
        'advanced_optimization',
        'multi_agent_orchestration',
      );
    }

    // Add advanced operations for admin users
    if (role === 'admin' || plan === 'enterprise') {
      baseOperations.push(
        'file_system_access',
        'database_query',
        'external_api_calls',
      );
    }

    // Super admin gets all operations
    if (role === 'super_admin') {
      baseOperations.push(
        'system_commands',
        'infrastructure_management',
        'security_operations',
      );
    }

    return baseOperations;
  }

  /**
   * Get execution metrics for monitoring
   */
  public getExecutionMetrics(): {
    activeExecutions: number;
    executionsByUser: Record<string, number>;
    averageExecutionTime: number;
  } {
    const executionsByUser: Record<string, number> = {};
    let totalExecutionTime = 0;

    for (const execution of this.activeExecutions.values()) {
      executionsByUser[execution.userId] =
        (executionsByUser[execution.userId] || 0) + 1;
      totalExecutionTime += Date.now() - execution.startTime;
    }

    return {
      activeExecutions: this.activeExecutions.size,
      executionsByUser,
      averageExecutionTime:
        this.activeExecutions.size > 0
          ? totalExecutionTime / this.activeExecutions.size
          : 0,
    };
  }

  /**
   * Force terminate execution
   */
  public terminateExecution(executionId: string): boolean {
    const execution = this.activeExecutions.get(executionId);
    if (execution) {
      this.logger.warn('Forcibly terminating execution', {
        executionId,
        userId: execution.userId,
        endpoint: execution.endpoint,
      });

      this.activeExecutions.delete(executionId);
      const timeout = this.executionTimeouts.get(executionId);
      if (timeout) {
        clearTimeout(timeout);
        this.executionTimeouts.delete(executionId);
      }
      return true;
    }
    return false;
  }
}
