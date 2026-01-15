/**
 * Confirmation Service
 * Handles user confirmations for dangerous operations
 */

import { v4 as uuidv4 } from 'uuid';
import { loggingService } from '../../services/logging.service';
import { redisService } from '../../services/redis.service';
import { IntegrationType } from '../types/permission.types';
import { AuditLogger } from '../utils/audit-logger';

export interface ConfirmationRequest {
  confirmationId: string;
  userId: string;
  integration: IntegrationType;
  toolName: string;
  resource: string;
  action: string;
  impact: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface ConfirmationResponse {
  confirmationId: string;
  confirmed: boolean;
  timestamp: Date;
  timedOut: boolean;
}

export class ConfirmationService {
  private static readonly TIMEOUT_SECONDS = 120; // 2 minutes
  private static readonly REDIS_PREFIX = 'mcp:confirmation:';

  /**
   * Create confirmation request
   */
  static async createConfirmationRequest(
    userId: string,
    integration: IntegrationType,
    toolName: string,
    resource: string,
    action: string,
    impact: string
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

    // Store in Redis with TTL
    const key = this.getRedisKey(confirmationId);
    await redisService.set(
      key,
      JSON.stringify(request),
      this.TIMEOUT_SECONDS
    );

    loggingService.info('Confirmation request created', {
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
  static async waitForConfirmation(
    confirmationId: string,
    timeoutSeconds: number = this.TIMEOUT_SECONDS
  ): Promise<ConfirmationResponse> {
    const responseKey = this.getResponseRedisKey(confirmationId);
    const startTime = Date.now();

    // Poll for response (check every 500ms)
    while (Date.now() - startTime < timeoutSeconds * 1000) {
      const responseData = await redisService.get(responseKey);
      
      if (responseData) {
        const response = JSON.parse(responseData);
        
        // Clean up
        await this.cleanup(confirmationId);
        
        loggingService.info('Confirmation received', {
          confirmationId,
          confirmed: response.confirmed,
        });

        return response;
      }

      // Wait 500ms before next check
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Timeout
    await this.cleanup(confirmationId);

    loggingService.warn('Confirmation timeout', {
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
  static async submitConfirmation(
    confirmationId: string,
    confirmed: boolean
  ): Promise<boolean> {
    // Check if request exists
    const requestKey = this.getRedisKey(confirmationId);
    const requestData = await redisService.get(requestKey);

    if (!requestData) {
      loggingService.warn('Confirmation request not found or expired', {
        confirmationId,
      });
      return false;
    }

    const request: ConfirmationRequest = JSON.parse(requestData);

    // Store response
    const responseKey = this.getResponseRedisKey(confirmationId);
    const response: ConfirmationResponse = {
      confirmationId,
      confirmed,
      timestamp: new Date(),
      timedOut: false,
    };

    await redisService.set(
      responseKey,
      JSON.stringify(response),
      60 // Keep for 1 minute
    );

    // Log confirmation
    await AuditLogger.logConfirmation(
      request.userId,
      request.integration,
      request.toolName,
      request.resource,
      request.action,
      confirmed,
      false
    );

    loggingService.info('Confirmation submitted', {
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
  static async getConfirmationRequest(
    confirmationId: string
  ): Promise<ConfirmationRequest | null> {
    const key = this.getRedisKey(confirmationId);
    const data = await redisService.get(key);

    if (!data) {
      return null;
    }

    return JSON.parse(data);
  }

  /**
   * Check if admin can bypass confirmation
   */
  static canBypassConfirmation(isAdmin: boolean): boolean {
    // Admins can bypass confirmations, but it's still logged
    return isAdmin;
  }

  /**
   * Cancel confirmation request
   */
  static async cancelConfirmation(confirmationId: string): Promise<boolean> {
    await this.cleanup(confirmationId);

    loggingService.info('Confirmation cancelled', {
      confirmationId,
    });

    return true;
  }

  /**
   * Get all pending confirmations for user (Production implementation)
   */
  static async getPendingConfirmations(userId: string): Promise<ConfirmationRequest[]> {
    try {
      // Use UserApprovalRequest model instead of scanning Redis
      const { UserApprovalRequest } = await import('../../models/UserApprovalRequest');
      
      const approvals = await UserApprovalRequest.find({
        userId,
        requestType: 'dangerous_operation',
        status: 'pending',
        expiresAt: { $gt: new Date() },
      }).sort({ createdAt: -1 }).limit(10).lean();

      return approvals.map(approval => ({
        confirmationId: approval._id.toString(),
        userId: approval.userId.toString(),
        integration: (approval.requestData.integration as IntegrationType) || 'vercel',
        toolName: approval.requestData.toolName || '',
        resource: approval.requestData.resource || '',
        action: approval.requestData.action || '',
        impact: `Operation on ${approval.requestData.resource}`,
        expiresAt: approval.expiresAt,
        createdAt: approval.createdAt,
      }));
    } catch (error) {
      loggingService.error('Failed to get pending confirmations', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return [];
    }
  }

  /**
   * Clean up confirmation data
   */
  private static async cleanup(confirmationId: string): Promise<void> {
    const requestKey = this.getRedisKey(confirmationId);
    const responseKey = this.getResponseRedisKey(confirmationId);

    await Promise.all([
      redisService.del(requestKey),
      redisService.del(responseKey),
    ]);
  }

  /**
   * Get Redis key for confirmation request
   */
  private static getRedisKey(confirmationId: string): string {
    return `${this.REDIS_PREFIX}request:${confirmationId}`;
  }

  /**
   * Get Redis key for confirmation response
   */
  private static getResponseRedisKey(confirmationId: string): string {
    return `${this.REDIS_PREFIX}response:${confirmationId}`;
  }

  /**
   * Generate impact description
   */
  static generateImpactDescription(
    _integration: IntegrationType,
    toolName: string,
    resource: string
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
}
