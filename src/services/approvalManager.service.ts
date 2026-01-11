import crypto from 'crypto';
import { redisService } from './redis.service';
import { loggingService } from './logging.service';
import { ExecutionPlan } from './governedAgent.service';

export interface ApprovalData {
  token: string;
  plan: ExecutionPlan;
  taskId: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
}

export interface ApprovalValidation {
  valid: boolean;
  plan?: ExecutionPlan;
  taskId?: string;
  reason?: string;
}

export class ApprovalManagerService {
  private static readonly APPROVAL_TTL = 30 * 60; // 30 minutes
  private static readonly KEY_PREFIX = 'approval:';

  /**
   * Generate approval token for a plan
   * Stores in Redis with 30-minute expiry
   */
  static async generateApprovalToken(
    plan: ExecutionPlan,
    taskId: string,
    userId: string
  ): Promise<string> {
    try {
      // Generate cryptographically secure token
      const token = crypto.randomBytes(32).toString('hex');

      const approvalData: ApprovalData = {
        token,
        plan,
        taskId,
        userId,
        expiresAt: Date.now() + this.APPROVAL_TTL * 1000,
        createdAt: Date.now()
      };

      // Store in Redis
      const key = `${this.KEY_PREFIX}${token}`;
      await redisService.set(key, JSON.stringify(approvalData), this.APPROVAL_TTL);

      loggingService.info('✅ Approval token generated', {
        component: 'ApprovalManagerService',
        operation: 'generateApprovalToken',
        taskId,
        userId,
        token: token.substring(0, 8) + '...',
        expiresIn: this.APPROVAL_TTL
      });

      return token;

    } catch (error) {
      loggingService.error('Failed to generate approval token', {
        component: 'ApprovalManagerService',
        operation: 'generateApprovalToken',
        taskId,
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error('Failed to generate approval token');
    }
  }

  /**
   * Validate and consume approval token (one-time use)
   */
  static async validateApproval(token: string, userId: string): Promise<ApprovalValidation> {
    try {
      const key = `${this.KEY_PREFIX}${token}`;
      const data = await redisService.get(key);

      if (!data) {
        loggingService.warn('Approval token not found or expired', {
          component: 'ApprovalManagerService',
          operation: 'validateApproval',
          token: token.substring(0, 8) + '...'
        });

        return {
          valid: false,
          reason: 'Token expired or invalid'
        };
      }

      const approvalData: ApprovalData = JSON.parse(data);

      // Check if token belongs to user
      if (approvalData.userId !== userId) {
        loggingService.warn('Approval token user mismatch', {
          component: 'ApprovalManagerService',
          operation: 'validateApproval',
          token: token.substring(0, 8) + '...',
          expectedUserId: userId,
          actualUserId: approvalData.userId
        });

        return {
          valid: false,
          reason: 'Token not authorized for this user'
        };
      }

      // Check expiry
      if (Date.now() > approvalData.expiresAt) {
        // Clean up expired token
        await redisService.del(key);

        loggingService.warn('Approval token expired', {
          component: 'ApprovalManagerService',
          operation: 'validateApproval',
          token: token.substring(0, 8) + '...',
          expiredAt: new Date(approvalData.expiresAt).toISOString()
        });

        return {
          valid: false,
          reason: 'Token expired'
        };
      }

      // One-time use: delete token immediately
      await redisService.del(key);

      loggingService.info('✅ Approval token validated and consumed', {
        component: 'ApprovalManagerService',
        operation: 'validateApproval',
        taskId: approvalData.taskId,
        userId,
        token: token.substring(0, 8) + '...'
      });

      return {
        valid: true,
        plan: approvalData.plan,
        taskId: approvalData.taskId
      };

    } catch (error) {
      loggingService.error('Failed to validate approval token', {
        component: 'ApprovalManagerService',
        operation: 'validateApproval',
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        valid: false,
        reason: 'Validation failed'
      };
    }
  }

  /**
   * Revoke an approval token before it expires
   */
  static async revokeApproval(token: string, userId: string): Promise<boolean> {
    try {
      const key = `${this.KEY_PREFIX}${token}`;
      const data = await redisService.get(key);

      if (!data) {
        return false; // Token doesn't exist
      }

      const approvalData: ApprovalData = JSON.parse(data);

      // Only allow user who created the token to revoke it
      if (approvalData.userId !== userId) {
        loggingService.warn('Unauthorized approval revocation attempt', {
          component: 'ApprovalManagerService',
          operation: 'revokeApproval',
          token: token.substring(0, 8) + '...',
          attemptedBy: userId,
          ownedBy: approvalData.userId
        });
        return false;
      }

      await redisService.del(key);

      loggingService.info('🚫 Approval token revoked', {
        component: 'ApprovalManagerService',
        operation: 'revokeApproval',
        taskId: approvalData.taskId,
        userId,
        token: token.substring(0, 8) + '...'
      });

      return true;

    } catch (error) {
      loggingService.error('Failed to revoke approval token', {
        component: 'ApprovalManagerService',
        operation: 'revokeApproval',
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Get remaining time for an approval token
   */
  static async getApprovalTTL(token: string): Promise<number> {
    try {
      const key = `${this.KEY_PREFIX}${token}`;
      const ttl = await redisService.getTTL(key);

      return ttl > 0 ? ttl : 0;

    } catch (error) {
      loggingService.error('Failed to get approval TTL', {
        component: 'ApprovalManagerService',
        operation: 'getApprovalTTL',
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Get approval data without consuming token (for preview)
   */
  static async getApprovalPreview(token: string, userId: string): Promise<ApprovalData | null> {
    try {
      const key = `${this.KEY_PREFIX}${token}`;
      const data = await redisService.get(key);

      if (!data) {
        return null;
      }

      const approvalData: ApprovalData = JSON.parse(data);

      // Check if token belongs to user
      if (approvalData.userId !== userId) {
        return null;
      }

      return approvalData;

    } catch (error) {
      loggingService.error('Failed to get approval preview', {
        component: 'ApprovalManagerService',
        operation: 'getApprovalPreview',
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
}
