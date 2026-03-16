import { Injectable, Inject } from '@nestjs/common';
import { BaseAgentTool } from './base-agent.tool';
import axios, { AxiosResponse } from 'axios';
import { CacheService } from '../../../common/cache/cache.service';
import { UserNotificationService } from '../../../common/services/user-notification.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  UserApprovalRequest,
  UserApprovalRequestDocument,
} from '../../../schemas/user/user-approval-request.schema';

/**
 * Generic HTTP Tool Service
 * Allows making HTTP requests with security controls and URL allowlisting
 * Ported from Express GenericHTTPTool with NestJS patterns
 */
@Injectable()
export class GenericHTTPTool extends BaseAgentTool {
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
  private static readonly RATE_LIMIT_TTL = 3600; // 1 hour in seconds

  constructor(
    @Inject(CacheService) private readonly cacheService: CacheService,
    private readonly userNotificationService: UserNotificationService,
    @InjectModel(UserApprovalRequest.name)
    private readonly userApprovalRequestModel: Model<UserApprovalRequestDocument>,
  ) {
    super(
      'generic_http',
      `Make HTTP requests to external APIs with security controls:

Input should be a JSON string with:
{
  "userId": "user identifier for rate limiting and approval",
  "method": "GET|POST|PUT|PATCH|DELETE",
  "url": "target URL",
  "headers": {"key": "value"},
  "body": {"key": "value"} (for POST/PUT/PATCH),
  "params": {"key": "value"} (query parameters),
  "auth": {"type": "bearer|basic", "token": "auth_token"}
}

Security features:
- URL allowlisting for trusted domains
- Rate limiting (50 requests/hour)
- User approval for non-allowlisted URLs
- Header sanitization
- Request/response logging`,
    );
  }

  protected async executeLogic(input: any): Promise<any> {
    try {
      const { userId, method, url, headers, body, params, auth } = input;

      // Validate required parameters
      if (!userId) {
        return this.createErrorResponse('generic_http', 'User ID is required');
      }

      if (!method || !url) {
        return this.createErrorResponse(
          'generic_http',
          'Method and URL are required',
        );
      }

      // Validate HTTP method
      const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
      if (!validMethods.includes(method.toUpperCase())) {
        return this.createErrorResponse(
          'generic_http',
          `Invalid HTTP method. Must be one of: ${validMethods.join(', ')}`,
        );
      }

      // Check rate limit
      const rateLimitCheck = await this.checkRateLimit(userId);
      if (!rateLimitCheck.allowed) {
        return this.createErrorResponse(
          'generic_http',
          `Rate limit exceeded. ${GenericHTTPTool.RATE_LIMIT_PER_HOUR} requests per hour allowed. Retry after ${rateLimitCheck.retryAfter} seconds.`,
        );
      }

      // Request approval if not on allowlist
      const approved = await this.requestUserApproval(userId, url, method);
      if (!approved) {
        return this.createErrorResponse(
          'generic_http',
          `URL ${url} is not on the allowlist. Contact administrator for approval.`,
        );
      }

      // Sanitize headers
      const sanitizedHeaders = this.sanitizeHeaders(headers);

      // Add auth if provided
      if (auth) {
        if (auth.type === 'bearer' && auth.token) {
          sanitizedHeaders['Authorization'] = `Bearer ${auth.token}`;
        } else if (auth.type === 'basic' && auth.token) {
          sanitizedHeaders['Authorization'] = `Basic ${auth.token}`;
        }
      }

      // Make HTTP request
      const axiosConfig: any = {
        method: method.toUpperCase(),
        url,
        headers: {
          'User-Agent': 'Cost-Katana-Agent/1.0',
          ...sanitizedHeaders,
        },
        timeout: 30000, // 30 second timeout
      };

      if (body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
        axiosConfig.data = body;
      }

      if (params) {
        axiosConfig.params = params;
      }

      const response: AxiosResponse = await axios(axiosConfig);

      return this.createSuccessResponse('generic_http', {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        data: response.data,
        url: response.config.url,
        method: response.config.method?.toUpperCase(),
      });
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.message ||
        error.response?.data ||
        error.message ||
        'Unknown HTTP request error';

      return {
        ...this.createErrorResponse('generic_http', errorMessage),
        status: error.response?.status,
        statusText: error.response?.statusText,
        url: error.config?.url,
        method: error.config?.method,
      };
    }
  }

  /**
   * Check if URL is allowed
   */
  private isURLAllowed(url: string): boolean {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;

      // Check against allowlist
      return GenericHTTPTool.ALLOWED_DOMAINS.some((allowed) => {
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
  private async checkRateLimit(
    userId: string,
  ): Promise<{ allowed: boolean; retryAfter?: number }> {
    const key = `ratelimit:http-tool:${userId}`;

    try {
      // Get current count
      const currentCount = (await this.cacheService.get(key)) || 0;
      const count = parseInt(currentCount.toString()) || 0;

      if (count >= GenericHTTPTool.RATE_LIMIT_PER_HOUR) {
        // Use fixed TTL as retry-after (CacheService does not expose getTTL)
        return {
          allowed: false,
          retryAfter: GenericHTTPTool.RATE_LIMIT_TTL,
        };
      }

      // Increment counter
      const newCount = count + 1;
      await this.cacheService.set(
        key,
        newCount,
        GenericHTTPTool.RATE_LIMIT_TTL,
      );

      return { allowed: true };
    } catch (error) {
      this.logger.warn('Rate limit check failed for HTTP tool', {
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
  private async requestUserApproval(
    userId: string,
    url: string,
    method: string,
  ): Promise<boolean> {
    // Check if URL is in allowlist first
    if (this.isURLAllowed(url)) {
      this.logger.log('HTTP tool URL auto-approved (allowlist)', {
        userId,
        url,
        method,
      });
      return true;
    }

    // For non-allowlisted URLs, create approval request
    const approvalRequest = new this.userApprovalRequestModel({
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

    const confirmationId = `http_approval_${userId}_${approvalRequest._id.toString()}`;

    this.logger.log('HTTP tool approval request created', {
      userId,
      url,
      method,
      approvalId: approvalRequest._id.toString(),
      confirmationId,
    });

    try {
      // Request approval via notification service with 5-minute timeout
      const approved = await this.userNotificationService.requestApproval(
        userId,
        confirmationId,
        'HTTP Request Approval Required',
        `The HTTP tool wants to make a ${method} request to: ${url}. This URL is not in the allowlist. Do you approve this request?`,
        {
          url,
          method,
          approvalId: approvalRequest._id.toString(),
        },
        300, // 5 minutes
      );

      // Update the approval request status
      if (approved) {
        await this.userApprovalRequestModel.findByIdAndUpdate(
          approvalRequest._id,
          {
            status: 'approved',
          },
        );
        this.logger.log('HTTP tool URL approved by user', {
          userId,
          url,
          method,
          approvalId: approvalRequest._id.toString(),
          confirmationId,
        });
        return true;
      } else {
        await this.userApprovalRequestModel.findByIdAndUpdate(
          approvalRequest._id,
          {
            status: 'denied',
          },
        );
        this.logger.log('HTTP tool URL denied by user', {
          userId,
          url,
          method,
          approvalId: approvalRequest._id.toString(),
          confirmationId,
        });
        return false;
      }
    } catch (error) {
      this.logger.error('HTTP tool approval request failed', {
        userId,
        url,
        method,
        approvalId: approvalRequest._id.toString(),
        confirmationId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Mark as expired on error
      await this.userApprovalRequestModel.findByIdAndUpdate(
        approvalRequest._id,
        {
          status: 'expired',
        },
      );

      return false;
    }
  }

  /**
   * Validate and sanitize headers
   */
  private sanitizeHeaders(
    headers?: Record<string, string>,
  ): Record<string, string> {
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
   * Add domain to allowlist (admin function)
   */
  static addAllowedDomain(domain: string): void {
    if (!GenericHTTPTool.ALLOWED_DOMAINS.includes(domain)) {
      GenericHTTPTool.ALLOWED_DOMAINS.push(domain);
    }
  }

  /**
   * Remove domain from allowlist (admin function)
   */
  static removeAllowedDomain(domain: string): boolean {
    const index = GenericHTTPTool.ALLOWED_DOMAINS.indexOf(domain);
    if (index > -1) {
      GenericHTTPTool.ALLOWED_DOMAINS.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Get allowed domains
   */
  static getAllowedDomains(): string[] {
    return [...GenericHTTPTool.ALLOWED_DOMAINS];
  }
}
