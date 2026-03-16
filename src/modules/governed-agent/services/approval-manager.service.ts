import { Injectable } from '@nestjs/common';
import { CacheService } from '../../../common/cache/cache.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { ExecutionPlan } from '../interfaces/governed-agent.interfaces';
import * as crypto from 'crypto';

/** Cached approval data shape (stored as JSON in cache; CacheService returns parsed object) */
interface ApprovalCacheData {
  tokenId: string;
  taskId: string;
  userId: string;
  plan: { riskLevel?: string; [key: string]: unknown };
  expiresAt: string;
  createdAt: string;
  [key: string]: unknown;
}

@Injectable()
export class ApprovalManagerService {
  private readonly TOKEN_PREFIX = 'approval:';
  private readonly TOKEN_TTL_SECONDS = 30 * 60; // 30 minutes

  constructor(
    private readonly cacheService: CacheService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Generate a cryptographically secure approval token
   */
  async generateApprovalToken(
    plan: ExecutionPlan,
    taskId: string,
    userId: string,
  ): Promise<string> {
    const tokenId = crypto.randomBytes(32).toString('hex');
    const token = `${this.TOKEN_PREFIX}${tokenId}`;

    const approvalData: ApprovalCacheData = {
      tokenId,
      taskId,
      userId,
      plan: {
        phasesCount: plan.phases.length,
        totalSteps: plan.phases.reduce(
          (sum, phase) => sum + phase.steps.length,
          0,
        ),
        estimatedCost: plan.estimatedCost,
        estimatedDuration: plan.estimatedDuration,
        riskLevel: plan.riskAssessment.level,
        riskReasons: plan.riskAssessment.reasons,
      },
      createdAt: new Date().toISOString(),
      expiresAt: new Date(
        Date.now() + this.TOKEN_TTL_SECONDS * 1000,
      ).toISOString(),
    };

    // Store in cache with TTL (CacheService serializes automatically)
    await this.cacheService.set(token, approvalData, this.TOKEN_TTL_SECONDS);

    this.logger.log('Approval token generated', {
      component: 'ApprovalManagerService',
      operation: 'generateApprovalToken',
      tokenId,
      taskId,
      userId,
      riskLevel: plan.riskAssessment.level,
    });

    return token;
  }

  /**
   * Validate an approval token (one-time use)
   */
  async validateApproval(
    token: string,
    userId: string,
  ): Promise<{
    valid: boolean;
    reason?: string;
    data?: ApprovalCacheData;
  }> {
    try {
      const approvalData =
        await this.cacheService.get<ApprovalCacheData>(token);

      if (!approvalData) {
        return {
          valid: false,
          reason: 'Token not found or expired',
        };
      }

      // Verify user matches
      if (approvalData.userId !== userId) {
        this.logger.warn('Approval token user mismatch', {
          component: 'ApprovalManagerService',
          operation: 'validateApproval',
          tokenUserId: approvalData.userId,
          requestingUserId: userId,
          tokenId: approvalData.tokenId,
        });

        return {
          valid: false,
          reason: 'Token does not belong to this user',
        };
      }

      // Check if token has expired
      const expiresAt = new Date(approvalData.expiresAt);
      if (expiresAt < new Date()) {
        await this.cacheService.del(token);

        return {
          valid: false,
          reason: 'Token has expired',
        };
      }

      // Token is valid - consume it (delete from cache)
      await this.cacheService.del(token);

      this.logger.log('Approval token validated and consumed', {
        component: 'ApprovalManagerService',
        operation: 'validateApproval',
        tokenId: approvalData.tokenId,
        taskId: approvalData.taskId,
        userId,
        riskLevel: approvalData.plan.riskLevel,
      });

      return {
        valid: true,
        data: approvalData,
      };
    } catch (error) {
      this.logger.error('Approval token validation failed', {
        component: 'ApprovalManagerService',
        operation: 'validateApproval',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        valid: false,
        reason: 'Token validation failed due to internal error',
      };
    }
  }

  /**
   * Check if approval token exists and is valid (without consuming)
   */
  async peekApproval(token: string): Promise<{
    exists: boolean;
    valid: boolean;
    data?: ApprovalCacheData;
    timeRemaining?: number;
  }> {
    try {
      const approvalData =
        await this.cacheService.get<ApprovalCacheData>(token);

      if (!approvalData) {
        return { exists: false, valid: false };
      }

      // Check expiration
      const expiresAt = new Date(approvalData.expiresAt);
      const now = new Date();
      const timeRemaining = Math.max(
        0,
        Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
      );

      if (expiresAt < now) {
        await this.cacheService.del(token);
        return { exists: true, valid: false };
      }

      return {
        exists: true,
        valid: true,
        data: approvalData,
        timeRemaining,
      };
    } catch (error) {
      this.logger.error('Approval token peek failed', {
        component: 'ApprovalManagerService',
        operation: 'peekApproval',
        error: error instanceof Error ? error.message : String(error),
      });

      return { exists: false, valid: false };
    }
  }

  /**
   * Revoke an approval token
   */
  async revokeApproval(
    token: string,
    userId: string,
  ): Promise<{
    success: boolean;
    reason?: string;
  }> {
    try {
      const peekResult = await this.peekApproval(token);

      if (!peekResult.exists) {
        return {
          success: false,
          reason: 'Token not found',
        };
      }

      if (!peekResult.valid) {
        return {
          success: false,
          reason: 'Token is expired',
        };
      }

      if (peekResult.data!.userId !== userId) {
        return {
          success: false,
          reason: 'Token does not belong to this user',
        };
      }

      await this.cacheService.del(token);

      this.logger.log('Approval token revoked', {
        component: 'ApprovalManagerService',
        operation: 'revokeApproval',
        tokenId: peekResult.data!.tokenId,
        taskId: peekResult.data!.taskId,
        userId,
      });

      return { success: true };
    } catch (error) {
      this.logger.error('Approval token revocation failed', {
        component: 'ApprovalManagerService',
        operation: 'revokeApproval',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        reason: 'Token revocation failed due to internal error',
      };
    }
  }

  /**
   * Clean up expired tokens (maintenance function).
   * Uses keys() to find approval tokens; Redis TTL normally handles expiration.
   */
  async cleanupExpiredTokens(): Promise<number> {
    let deletedCount = 0;

    try {
      const keys = await this.cacheService.keys(`${this.TOKEN_PREFIX}*`);

      for (const key of keys) {
        try {
          const data = await this.cacheService.get<ApprovalCacheData>(key);
          if (!data) continue;

          const expiresAt = data?.expiresAt;
          if (
            !expiresAt ||
            isNaN(Date.parse(expiresAt)) ||
            new Date(expiresAt) > new Date()
          ) {
            continue;
          }

          await this.cacheService.del(key);
          deletedCount++;
        } catch (err) {
          this.logger.warn('Failed processing token during cleanup', {
            component: 'ApprovalManagerService',
            operation: 'cleanupExpiredTokens',
            key,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      this.logger.debug('Explicit approval token cleanup completed', {
        component: 'ApprovalManagerService',
        operation: 'cleanupExpiredTokens',
        deletedCount,
      });
    } catch (err) {
      this.logger.error('Cleanup of expired approval tokens failed', {
        component: 'ApprovalManagerService',
        operation: 'cleanupExpiredTokens',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return deletedCount;
  }

  /**
   * Get approval statistics (for monitoring)
   */
  async getApprovalStats(): Promise<{
    activeTokens: number;
    tokensByRiskLevel: Record<string, number>;
  }> {
    let activeTokens = 0;
    const tokensByRiskLevel: Record<string, number> = {};

    try {
      const keys = await this.cacheService.keys(`${this.TOKEN_PREFIX}*`);

      for (const key of keys) {
        try {
          const data = await this.cacheService.get<ApprovalCacheData>(key);
          if (!data) continue;

          activeTokens++;
          const riskLevel = data.plan?.riskLevel ?? 'unknown';
          tokensByRiskLevel[riskLevel] =
            (tokensByRiskLevel[riskLevel] ?? 0) + 1;
        } catch (err) {
          this.logger.warn('Failed to parse approval token data', {
            component: 'ApprovalManagerService',
            operation: 'getApprovalStats',
            key,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } catch (err) {
      this.logger.warn('Failed to get approval stats', {
        component: 'ApprovalManagerService',
        operation: 'getApprovalStats',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return {
      activeTokens,
      tokensByRiskLevel,
    };
  }
}
