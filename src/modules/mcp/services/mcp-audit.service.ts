import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  McpPermissionAuditLog,
  McpPermissionAuditLogDocument,
} from '../../../schemas/security/mcp-permission-audit-log.schema';
import { IntegrationType } from '../types/mcp.types';

export interface AuditLogData {
  userId: string | Types.ObjectId;
  action: 'request' | 'denial' | 'approval';
  integration: IntegrationType;
  resourceId: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  endpoint: string;
  requestBody?: Record<string, any>;
  responseBody?: Record<string, any>;
  errorMessage?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class McpAuditService {
  private readonly logger = new Logger(McpAuditService.name);

  constructor(
    @InjectModel(McpPermissionAuditLog.name)
    private auditLogModel: Model<McpPermissionAuditLogDocument>,
  ) {}

  /**
   * Log a permission-related action
   */
  async logPermissionAction(data: AuditLogData): Promise<void> {
    try {
      const auditLog = new this.auditLogModel({
        userId:
          typeof data.userId === 'string'
            ? new Types.ObjectId(data.userId)
            : data.userId,
        action: data.action,
        integration: data.integration,
        resourceId: data.resourceId,
        method: data.method,
        endpoint: data.endpoint,
        requestBody: data.requestBody,
        responseBody: data.responseBody,
        errorMessage: data.errorMessage,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        metadata: data.metadata,
      });

      await auditLog.save();
      this.logger.log(
        `Audit log created for ${data.action} action on ${data.integration}:${data.resourceId}`,
      );
    } catch (error) {
      this.logger.error('Failed to create audit log', {
        error: error instanceof Error ? error.message : 'Unknown error',
        data,
      });
      // Don't throw - audit logging should not break the main flow
    }
  }

  /**
   * Log a permission request
   */
  async logPermissionRequest(
    userId: string | Types.ObjectId,
    integration: IntegrationType,
    resourceId: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    endpoint: string,
    requestBody?: Record<string, any>,
    ipAddress?: string,
    userAgent?: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.logPermissionAction({
      userId,
      action: 'request',
      integration,
      resourceId,
      method,
      endpoint,
      requestBody,
      ipAddress,
      userAgent,
      metadata,
    });
  }

  /**
   * Log a permission denial
   */
  async logPermissionDenial(
    userId: string | Types.ObjectId,
    integration: IntegrationType,
    resourceId: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    endpoint: string,
    errorMessage?: string,
    ipAddress?: string,
    userAgent?: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.logPermissionAction({
      userId,
      action: 'denial',
      integration,
      resourceId,
      method,
      endpoint,
      errorMessage,
      ipAddress,
      userAgent,
      metadata,
    });
  }

  /**
   * Log a permission approval
   */
  async logPermissionApproval(
    userId: string | Types.ObjectId,
    integration: IntegrationType,
    resourceId: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    endpoint: string,
    responseBody?: Record<string, any>,
    ipAddress?: string,
    userAgent?: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    await this.logPermissionAction({
      userId,
      action: 'approval',
      integration,
      resourceId,
      method,
      endpoint,
      responseBody,
      ipAddress,
      userAgent,
      metadata,
    });
  }

  /**
   * Get audit logs for a user or all logs (when userId omitted, for admin)
   */
  async getAuditLogs(options?: {
    userId?: string | Types.ObjectId;
    limit?: number;
    offset?: number;
    integration?: IntegrationType;
    action?: 'request' | 'denial' | 'approval';
    startDate?: Date;
    endDate?: Date;
  }): Promise<McpPermissionAuditLogDocument[]> {
    const query: Record<string, unknown> = {};
    if (options?.userId) {
      query.userId =
        typeof options.userId === 'string'
          ? new Types.ObjectId(options.userId)
          : options.userId;
    }
    if (options?.integration) {
      query.integration = options.integration;
    }
    if (options?.action) {
      query.action = options.action;
    }
    if (options?.startDate || options?.endDate) {
      query.createdAt = {};
      if (options.startDate) {
        (query.createdAt as Record<string, Date>).$gte = options.startDate;
      }
      if (options.endDate) {
        (query.createdAt as Record<string, Date>).$lte = options.endDate;
      }
    }
    return this.auditLogModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(options?.limit || 50)
      .skip(options?.offset || 0)
      .exec();
  }

  /**
   * Get audit logs for a user
   */
  async getUserAuditLogs(
    userId: string | Types.ObjectId,
    options?: {
      limit?: number;
      offset?: number;
      integration?: IntegrationType;
      action?: 'request' | 'denial' | 'approval';
      startDate?: Date;
      endDate?: Date;
    },
  ): Promise<McpPermissionAuditLogDocument[]> {
    const query: any = {
      userId: typeof userId === 'string' ? new Types.ObjectId(userId) : userId,
    };

    if (options?.integration) {
      query.integration = options.integration;
    }

    if (options?.action) {
      query.action = options.action;
    }

    if (options?.startDate || options?.endDate) {
      query.createdAt = {};
      if (options.startDate) {
        query.createdAt.$gte = options.startDate;
      }
      if (options.endDate) {
        query.createdAt.$lte = options.endDate;
      }
    }

    return this.auditLogModel
      .find(query)
      .sort({ createdAt: -1 })
      .limit(options?.limit || 50)
      .skip(options?.offset || 0)
      .exec();
  }

  /**
   * Get audit statistics for a user
   */
  async getUserAuditStats(
    userId: string | Types.ObjectId,
    startDate?: Date,
    endDate?: Date,
  ): Promise<{
    totalRequests: number;
    totalDenials: number;
    totalApprovals: number;
    requestsByIntegration: Record<string, number>;
    denialsByIntegration: Record<string, number>;
    approvalsByIntegration: Record<string, number>;
  }> {
    const matchStage: any = {
      userId: typeof userId === 'string' ? new Types.ObjectId(userId) : userId,
    };

    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = startDate;
      if (endDate) matchStage.createdAt.$lte = endDate;
    }

    const stats = await this.auditLogModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { action: '$action', integration: '$integration' },
          count: { $sum: 1 },
        },
      },
    ]);

    const result = {
      totalRequests: 0,
      totalDenials: 0,
      totalApprovals: 0,
      requestsByIntegration: {} as Record<string, number>,
      denialsByIntegration: {} as Record<string, number>,
      approvalsByIntegration: {} as Record<string, number>,
    };

    for (const stat of stats) {
      const { action, integration } = stat._id;
      const count = stat.count;

      if (action === 'request') {
        result.totalRequests += count;
        result.requestsByIntegration[integration] =
          (result.requestsByIntegration[integration] || 0) + count;
      } else if (action === 'denial') {
        result.totalDenials += count;
        result.denialsByIntegration[integration] =
          (result.denialsByIntegration[integration] || 0) + count;
      } else if (action === 'approval') {
        result.totalApprovals += count;
        result.approvalsByIntegration[integration] =
          (result.approvalsByIntegration[integration] || 0) + count;
      }
    }

    return result;
  }

  /**
   * Clean up old audit logs (for maintenance)
   */
  async cleanupOldLogs(olderThanDays: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.auditLogModel.deleteMany({
      createdAt: { $lt: cutoffDate },
    });

    this.logger.log(`Cleaned up ${result.deletedCount} old audit logs`);
    return result.deletedCount;
  }
}
