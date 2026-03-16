import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { IntegrationType, HttpMethod } from '../types/mcp.types';
import { CacheService } from '../../../common/cache/cache.service';
import { McpAuditService } from './mcp-audit.service';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  UserApprovalRequest,
  UserApprovalRequestDocument,
} from '../../../schemas/user/user-approval-request.schema';

export interface ConfirmationRequest {
  confirmationId: string;
  userId: string;
  integration: IntegrationType;
  toolName: string;
  resource: string;
  action: string;
  impact: string;
  httpMethod?: HttpMethod;
  endpoint?: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface ConfirmationResponse {
  confirmationId: string;
  confirmed: boolean;
  timestamp: Date;
  timedOut: boolean;
}

@Injectable()
export class ConfirmationService {
  private readonly TIMEOUT_SECONDS = 120; // 2 minutes
  private readonly CACHE_PREFIX = 'mcp:confirmation:';

  constructor(
    private cacheService: CacheService,
    private auditService: McpAuditService,
    private logger: LoggerService,
    @InjectModel(UserApprovalRequest.name)
    private userApprovalRequestModel: Model<UserApprovalRequestDocument>,
  ) {}

  /**
   * Create confirmation request
   */
  async createConfirmationRequest(
    userId: string,
    integration: IntegrationType,
    toolName: string,
    resource: string,
    action: string,
    impact: string,
  ): Promise<ConfirmationRequest> {
    const confirmationId = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.TIMEOUT_SECONDS * 1000);

    const request: ConfirmationRequest = {
      confirmationId,
      userId,
      integration,
      toolName,
      resource,
      action,
      impact,
      expiresAt,
      createdAt: now,
    };

    // Store in cache with TTL
    const key = this.getCacheKey(confirmationId);
    await this.cacheService.set(key, request, this.TIMEOUT_SECONDS);

    // Dual-write to UserApprovalRequest for getPendingConfirmations (Express parity)
    try {
      await this.userApprovalRequestModel.create({
        userId: new Types.ObjectId(userId),
        requestType: 'dangerous_operation',
        requestData: {
          integration,
          toolName,
          resource,
          action,
          confirmationId,
          timestamp: now,
        },
        status: 'pending',
        expiresAt,
      });
    } catch (err) {
      this.logger.warn(
        'Failed to create UserApprovalRequest for confirmation',
        {
          confirmationId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }

    this.logger.info('Confirmation request created', {
      confirmationId,
      userId,
      integration,
      toolName,
      resource,
      action,
    });

    return request;
  }

  /**
   * Wait for confirmation response
   */
  async waitForConfirmation(
    confirmationId: string,
    timeoutSeconds: number = this.TIMEOUT_SECONDS,
  ): Promise<ConfirmationResponse> {
    const responseKey = this.getResponseCacheKey(confirmationId);
    const startTime = Date.now();

    // Poll for response (check every 500ms)
    while (Date.now() - startTime < timeoutSeconds * 1000) {
      const responseData = await this.cacheService.get(responseKey);

      if (responseData) {
        const response = responseData as ConfirmationResponse;

        // Clean up
        await this.cleanup(confirmationId);

        this.logger.info('Confirmation received', {
          confirmationId,
          confirmed: response.confirmed,
        });

        return response;
      }

      // Wait 500ms before next check
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Timeout
    await this.cleanup(confirmationId);

    this.logger.warn('Confirmation timeout', {
      confirmationId,
    });

    return {
      confirmationId,
      confirmed: false,
      timestamp: new Date(),
      timedOut: true,
    };
  }

  /**
   * Submit confirmation response
   */
  async submitConfirmation(
    confirmationId: string,
    confirmed: boolean,
  ): Promise<boolean> {
    // Check if request exists
    const requestKey = this.getCacheKey(confirmationId);
    const requestData = await this.cacheService.get(requestKey);

    if (!requestData) {
      this.logger.warn('Confirmation request not found or expired', {
        confirmationId,
      });
      return false;
    }

    const request = requestData as ConfirmationRequest;

    // Store response
    const responseKey = this.getResponseCacheKey(confirmationId);
    const response: ConfirmationResponse = {
      confirmationId,
      confirmed,
      timestamp: new Date(),
      timedOut: false,
    };

    await this.cacheService.set(responseKey, response, 60); // Keep for 1 minute

    // Update UserApprovalRequest status for audit
    await this.userApprovalRequestModel.updateMany(
      { 'requestData.confirmationId': confirmationId },
      {
        $set: {
          status: confirmed ? 'approved' : 'denied',
          respondedAt: new Date(),
        },
      },
    );

    // Audit log the confirmation response
    await this.auditService.logPermissionAction({
      userId: request.userId,
      action: confirmed ? 'approval' : 'denial',
      integration: request.integration,
      resourceId: request.resource,
      method: request.httpMethod || 'POST', // Default to POST if not specified
      endpoint: request.endpoint || `/${request.toolName}`,
      responseBody: {
        confirmationId,
        confirmed,
        timestamp: response.timestamp,
        status: confirmed ? 'approved' : 'denied',
      },
      metadata: {
        confirmationId,
        toolName: request.toolName,
        action: request.action,
        impact: request.impact,
        confirmationResponse: confirmed,
      },
    });

    this.logger.info('Confirmation submitted', {
      confirmationId,
      confirmed,
      userId: request.userId,
      resource: request.resource,
    });

    return true;
  }

  /**
   * Get pending confirmation request
   */
  async getConfirmationRequest(
    confirmationId: string,
  ): Promise<ConfirmationRequest | null> {
    const key = this.getCacheKey(confirmationId);
    const data = await this.cacheService.get(key);

    if (!data) {
      return null;
    }

    return data as ConfirmationRequest;
  }

  /**
   * Get all pending confirmations for user (Express parity).
   * Uses UserApprovalRequest for querying; requestData.confirmationId links to cache.
   */
  async getPendingConfirmations(
    userId: string,
  ): Promise<ConfirmationRequest[]> {
    try {
      const approvals = await this.userApprovalRequestModel
        .find({
          userId: new Types.ObjectId(userId),
          requestType: 'dangerous_operation',
          status: 'pending',
          expiresAt: { $gt: new Date() },
        })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      return approvals.map((approval) => {
        const data = approval.requestData as {
          integration?: string;
          toolName?: string;
          resource?: string;
          action?: string;
          confirmationId?: string;
        };
        return {
          confirmationId:
            data.confirmationId ?? (approval as any)._id.toString(),
          userId: approval.userId.toString(),
          integration: (data.integration as IntegrationType) ?? 'vercel',
          toolName: data.toolName ?? '',
          resource: data.resource ?? '',
          action: data.action ?? '',
          impact: `Operation on ${data.resource ?? 'resource'}`,
          expiresAt: approval.expiresAt,
          createdAt: approval.createdAt,
        };
      });
    } catch (error) {
      this.logger.error('Failed to get pending confirmations', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return [];
    }
  }

  /**
   * Check if admin can bypass confirmation
   */
  canBypassConfirmation(isAdmin: boolean): boolean {
    // Admins can bypass confirmations, but it's still logged
    return isAdmin;
  }

  /**
   * Cancel confirmation request
   */
  async cancelConfirmation(confirmationId: string): Promise<boolean> {
    await this.cleanup(confirmationId);

    this.logger.info('Confirmation cancelled', {
      confirmationId,
    });

    return true;
  }

  /**
   * Generate impact description
   */
  generateImpactDescription(
    _integration: IntegrationType,
    toolName: string,
    resource: string,
  ): string {
    if (toolName.includes('delete')) {
      return `⚠️ This will permanently delete ${resource}. This action cannot be undone.`;
    }

    if (toolName.includes('remove')) {
      return `⚠️ This will remove ${resource}. This may affect dependent resources.`;
    }

    if (toolName.includes('ban') || toolName.includes('kick')) {
      return `⚠️ This will remove the user from the workspace. They will lose access immediately.`;
    }

    if (toolName.includes('archive')) {
      return `⚠️ This will archive ${resource}. It can be restored later.`;
    }

    return `⚠️ This is a potentially destructive operation on ${resource}.`;
  }

  /**
   * Clean up confirmation data
   */
  private async cleanup(confirmationId: string): Promise<void> {
    const requestKey = this.getCacheKey(confirmationId);
    const responseKey = this.getResponseCacheKey(confirmationId);

    await Promise.all([
      this.cacheService.del(requestKey),
      this.cacheService.del(responseKey),
    ]);
  }

  /**
   * Get cache key for confirmation request
   */
  private getCacheKey(confirmationId: string): string {
    return `${this.CACHE_PREFIX}request:${confirmationId}`;
  }

  /**
   * Get cache key for confirmation response
   */
  private getResponseCacheKey(confirmationId: string): string {
    return `${this.CACHE_PREFIX}response:${confirmationId}`;
  }
}
