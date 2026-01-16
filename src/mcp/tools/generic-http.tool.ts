/**
 * Generic HTTP Tool
 * Allows making HTTP requests with security controls
 */

import { createToolSchema, createParameter } from '../registry/tool-metadata';
import { ToolRegistry } from '../registry/tool-registry';
import { ToolExecutionContext } from '../types/tool-schema';
import { createSuccessResponse, createErrorResponse } from '../types/standard-response';
import { createMCPError } from '../utils/error-mapper';
import { loggingService } from '../../services/logging.service';
import { redisService } from '../../services/redis.service';

export class GenericHTTPTool {
  // URL allowlist (domains that are always allowed)
  private static readonly ALLOWED_DOMAINS = [
    'api.github.com',
    'api.vercel.com',
    'www.googleapis.com',
    'slack.com',
    'discord.com',
    'api.linear.app',
    '.atlassian.net', // Jira Cloud domains
  ];

  // Rate limit for HTTP tool (more restrictive)
  private static readonly RATE_LIMIT_PER_HOUR = 50;

  /**
   * Check if URL is allowed
   */
  private static isURLAllowed(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Check against allowlist
      return this.ALLOWED_DOMAINS.some(allowed => {
        if (allowed.startsWith('.')) {
          return hostname.endsWith(allowed);
        }
        return hostname === allowed;
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * Check rate limit for HTTP tool
   */
  private static async checkRateLimit(userId: string): Promise<{ allowed: boolean; retryAfter?: number }> {
    const key = `ratelimit:http-tool:${userId}`;
    
    try {
      const count = await redisService.incr(key);

      if (count === 1) {
        await redisService.set(key, '1', 3600); // 1 hour
      }

      if (count > this.RATE_LIMIT_PER_HOUR) {
        const ttl = await redisService.getTTL(key);
        return {
          allowed: false,
          retryAfter: ttl > 0 ? ttl : 3600,
        };
      }

      return { allowed: true };
    } catch (error) {
      loggingService.error('Rate limit check failed for HTTP tool', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      // Fail open on error
      return { allowed: true };
    }
  }

  /**
   * Request user approval for external URL
   */
  private static async requestUserApproval(
    userId: string,
    url: string,
    method: string
  ): Promise<boolean> {
    // Check if URL is in allowlist first
    const allowed = this.isURLAllowed(url);
    
    if (allowed) {
      loggingService.info('HTTP tool URL auto-approved (allowlist)', {
        userId,
        url,
        method,
      });
      return true;
    }

    // For non-allowlisted URLs, create approval request
    const { UserApprovalRequest } = await import('../../models/UserApprovalRequest');
    
    const approvalRequest = new UserApprovalRequest({
      userId,
      requestType: 'http_request',
      requestData: {
        url,
        method,
        timestamp: new Date(),
      },
      status: 'pending',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
    });

    await approvalRequest.save();

    // Notify user via RealtimeUpdateService
    const { RealtimeUpdateService } = await import('../../services/realtime-update.service');
    RealtimeUpdateService.broadcastToUser(userId, {
      type: 'mcp_approval_request',
      message: `Approve HTTP ${method} request to ${url}?`,
      approvalId: (approvalRequest._id as any).toString(),
      requestType: 'http_request',
    });

    // Wait for approval with timeout
    const timeoutMs = 5 * 60 * 1000; // 5 minutes
    const pollInterval = 1000; // 1 second
    const maxPolls = timeoutMs / pollInterval;

    for (let i = 0; i < maxPolls; i++) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      const updated = await UserApprovalRequest.findById(approvalRequest._id);
      if (!updated) {
        break;
      }

      if (updated.status === 'approved') {
        loggingService.info('HTTP tool URL approved by user', {
          userId,
          url,
          method,
          approvalId: (approvalRequest._id as any).toString(),
        });
        return true;
      }

      if (updated.status === 'denied') {
        loggingService.info('HTTP tool URL denied by user', {
          userId,
          url,
          method,
          approvalId: (approvalRequest._id as any).toString(),
        });
        return false;
      }
    }

    // Timeout - mark as expired and deny
    await UserApprovalRequest.findByIdAndUpdate(approvalRequest._id, {
      status: 'expired',
    });

    loggingService.warn('HTTP tool URL approval timeout', {
      userId,
      url,
      method,
      approvalId: (approvalRequest._id as any).toString(),
    });

    return false;
  }

  /**
   * Validate and sanitize headers
   */
  private static sanitizeHeaders(headers?: Record<string, string>): Record<string, string> {
    if (!headers) {
      return {};
    }

    const sanitized: Record<string, string> = {};
    const blockedHeaders = ['host', 'connection', 'cookie', 'authorization'];

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (!blockedHeaders.includes(lowerKey)) {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Register the generic HTTP tool
   */
  static register(): void {
    ToolRegistry.registerTool(
      createToolSchema(
        'http_request',
        'github', // Using github as placeholder integration type
        'Make HTTP requests to external APIs',
        'POST',
        [
          createParameter('method', 'string', 'HTTP method', {
            required: true,
            enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
          }),
          createParameter('url', 'string', 'Target URL', { required: true }),
          createParameter('headers', 'object', 'Request headers', { required: false }),
          createParameter('body', 'object', 'Request body (for POST/PUT/PATCH)', { required: false }),
          createParameter('params', 'object', 'Query parameters', { required: false }),
          createParameter('auth', 'object', 'Authentication config', { required: false }),
        ],
        {
          requiredScopes: [],
          dangerous: false,
        }
      ),
      async (params, context: ToolExecutionContext) => {
        const startTime = Date.now();

        try {
          // Validate URL
          if (!params.url || typeof params.url !== 'string') {
            return createErrorResponse(
              {
                code: 'INVALID_PARAMS',
                message: 'URL is required and must be a string',
                recoverable: false,
              },
              {
                integration: 'github',
                operation: 'http_request',
                latency: Date.now() - startTime,
                httpMethod: 'POST',
                permissionChecked: true,
                dangerousOperation: false,
                userId: context.userId,
              }
            );
          }

          // Check rate limit
          const rateLimitCheck = await this.checkRateLimit(context.userId);
          if (!rateLimitCheck.allowed) {
            return createErrorResponse(
              {
                code: 'RATE_LIMIT',
                message: `HTTP tool rate limit exceeded. ${this.RATE_LIMIT_PER_HOUR} requests per hour allowed.`,
                recoverable: true,
                retryAfter: rateLimitCheck.retryAfter,
              },
              {
                integration: 'github',
                operation: 'http_request',
                latency: Date.now() - startTime,
                httpMethod: 'POST',
                permissionChecked: true,
                dangerousOperation: false,
                userId: context.userId,
              }
            );
          }

          // Request approval if not on allowlist
          const approved = await this.requestUserApproval(
            context.userId,
            params.url,
            params.method
          );

          if (!approved) {
            return createErrorResponse(
              {
                code: 'FORBIDDEN',
                message: `URL ${params.url} is not on the allowlist. Contact administrator for approval.`,
                recoverable: false,
              },
              {
                integration: 'github',
                operation: 'http_request',
                latency: Date.now() - startTime,
                httpMethod: 'POST',
                permissionChecked: true,
                dangerousOperation: false,
                userId: context.userId,
              }
            );
          }

          // Sanitize headers
          const headers = this.sanitizeHeaders(params.headers);

          // Add auth if provided
          if (params.auth) {
            if (params.auth.type === 'bearer' && params.auth.token) {
              headers['Authorization'] = `Bearer ${params.auth.token}`;
            } else if (params.auth.type === 'basic' && params.auth.token) {
              headers['Authorization'] = `Basic ${params.auth.token}`;
            }
          }

          // Make HTTP request
          const axios = (await import('axios')).default;
          const config: any = {
            method: params.method,
            url: params.url,
            headers: {
              'User-Agent': 'Cost-Katana-MCP/1.0',
              ...headers,
            },
            timeout: 30000, // 30 second timeout
          };

          if (params.body && ['POST', 'PUT', 'PATCH'].includes(params.method)) {
            config.data = params.body;
          }

          if (params.params) {
            config.params = params.params;
          }

          const response = await axios(config);

          // Log successful request
          loggingService.info('HTTP tool request successful', {
            userId: context.userId,
            method: params.method,
            url: params.url,
            status: response.status,
            latency: Date.now() - startTime,
          });

          return createSuccessResponse(
            {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              data: response.data,
            },
            {
              integration: 'github',
              operation: 'http_request',
              latency: Date.now() - startTime,
              httpMethod: 'POST',
              permissionChecked: true,
              dangerousOperation: false,
              userId: context.userId,
            }
          );
        } catch (error: any) {
          loggingService.error('HTTP tool request failed', {
            error: error.message,
            userId: context.userId,
            method: params.method,
            url: params.url,
            status: error.response?.status,
          });

          return createErrorResponse(
            createMCPError(error),
            {
              integration: 'github',
              operation: 'http_request',
              latency: Date.now() - startTime,
              httpMethod: 'POST',
              permissionChecked: true,
              dangerousOperation: false,
              userId: context.userId,
            }
          );
        }
      },
      {
        enabled: true,
        rateLimitOverride: this.RATE_LIMIT_PER_HOUR,
      }
    );

    loggingService.info('Generic HTTP tool registered');
  }

  /**
   * Add domain to allowlist (admin function)
   */
  static addAllowedDomain(domain: string): void {
    if (!this.ALLOWED_DOMAINS.includes(domain)) {
      this.ALLOWED_DOMAINS.push(domain);
      loggingService.info('Domain added to HTTP tool allowlist', { domain });
    }
  }

  /**
   * Remove domain from allowlist (admin function)
   */
  static removeAllowedDomain(domain: string): boolean {
    const index = this.ALLOWED_DOMAINS.indexOf(domain);
    if (index > -1) {
      this.ALLOWED_DOMAINS.splice(index, 1);
      loggingService.info('Domain removed from HTTP tool allowlist', { domain });
      return true;
    }
    return false;
  }

  /**
   * Get allowed domains
   */
  static getAllowedDomains(): string[] {
    return [...this.ALLOWED_DOMAINS];
  }
}

// Initialize the generic HTTP tool
export function initializeGenericHTTPTool(): void {
  GenericHTTPTool.register();
}
