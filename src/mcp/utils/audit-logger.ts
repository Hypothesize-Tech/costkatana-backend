/**
 * Audit Logger for MCP Operations
 * Logs all tool executions for security and compliance
 */

import mongoose from 'mongoose';
import { MongodbMcpAuditLog } from '../../schemas/security/mongodb-mcp-audit-log.schema';
import { loggingService } from '../../common/services/logging.service';
import { IntegrationType, HttpMethod } from '../types/permission.types';
import { MCPToolResponse } from '../types/standard-response';

export interface AuditLogEntry {
  timestamp: Date;
  userId: string;
  integration: IntegrationType;
  toolName: string;
  httpMethod: HttpMethod;
  params: Record<string, unknown>;
  success: boolean;
  error?: string;
  latency: number;
  permissionChecked: boolean;
  dangerousOperation: boolean;
  confirmed?: boolean;
  connectionId?: string;
  ipAddress?: string;
}

export class AuditLogger {
  private static auditLogs: AuditLogEntry[] = [];
  private static readonly MAX_LOGS = 10000; // Keep last 10k logs in memory

  /**
   * Log tool execution
   */
  static async logExecution(
    userId: string,
    integration: IntegrationType,
    toolName: string,
    httpMethod: HttpMethod,
    params: unknown,
    response: MCPToolResponse,
    options: {
      confirmed?: boolean;
      connectionId?: string;
      ipAddress?: string;
    } = {},
  ): Promise<void> {
    const entry: AuditLogEntry = {
      timestamp: new Date(),
      userId,
      integration,
      toolName,
      httpMethod,
      params: this.sanitizeParams(params),
      success: response.success,
      error: response.error?.message,
      latency: response.metadata.latency,
      permissionChecked: response.metadata.permissionChecked,
      dangerousOperation: response.metadata.dangerousOperation,
      confirmed: options.confirmed,
      connectionId: options.connectionId,
      ipAddress: options.ipAddress,
    };

    // Log to service
    loggingService.info('MCP tool execution', entry);

    // For dangerous operations or failures, log with higher severity
    if (entry.dangerousOperation || !entry.success) {
      loggingService.warn('MCP dangerous/failed operation', entry);
    }

    // Store in dedicated audit log collection for compliance
    await this.storeAuditLog(entry);
  }

  /**
   * Log confirmation request/response
   */
  static async logConfirmation(
    userId: string,
    integration: IntegrationType,
    toolName: string,
    resource: string,
    action: string,
    confirmed: boolean,
    timedOut: boolean = false,
  ): Promise<void> {
    const logEntry = {
      timestamp: new Date(),
      userId,
      integration,
      toolName,
      resource,
      action,
      confirmed,
      timedOut,
    };

    loggingService.info('MCP confirmation', logEntry);

    // Store confirmation logs as well for audit trail
    await this.storeConfirmationLog(logEntry);
  }

  /**
   * Log permission denial
   */
  static async logPermissionDenial(
    userId: string,
    integration: IntegrationType,
    toolName: string,
    reason: string,
    missingScope?: string,
  ): Promise<void> {
    const logEntry = {
      timestamp: new Date(),
      userId,
      integration,
      toolName,
      reason,
      missingScope,
    };

    loggingService.warn('MCP permission denied', logEntry);

    // Store permission denial logs for security monitoring
    await this.storePermissionDenialLog(logEntry);
  }

  /**
   * Sanitize sensitive parameters
   */
  private static sanitizeParams(params: unknown): Record<string, unknown> {
    if (!params || typeof params !== 'object' || params === null) {
      return {};
    }

    const sanitized = { ...(params as Record<string, unknown>) };
    const sensitiveKeys = [
      'password',
      'token',
      'secret',
      'key',
      'apiKey',
      'accessToken',
    ];

    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
        sanitized[key] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  /**
   * Store audit log entry
   */
  private static async storeAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      // Add to in-memory store
      this.auditLogs.push(entry);

      // Keep only the last MAX_LOGS entries
      if (this.auditLogs.length > this.MAX_LOGS) {
        this.auditLogs = this.auditLogs.slice(-this.MAX_LOGS);
      }

      const MongodbMcpAuditLogModel = (
        await import('../../common/utils/get-mongoose-models')
      ).getMongodbMcpAuditLogModel();
      await MongodbMcpAuditLogModel.create({
        ...entry,
        context: {
          userId: new mongoose.Types.ObjectId(entry.userId),
          connectionId: new mongoose.Types.ObjectId(entry.connectionId),
        },
      });
      loggingService.debug('Audit log stored', {
        entryId: `${entry.userId}-${entry.timestamp.getTime()}`,
      });
    } catch (error) {
      loggingService.error('Failed to store audit log', {
        error: error instanceof Error ? error.message : String(error),
        entry: { ...entry, params: '[SANITIZED]' },
      });
    }
  }

  /**
   * Store confirmation log entry to persistent database
   */
  private static async storeConfirmationLog(
    entry: Record<string, unknown>,
  ): Promise<void> {
    try {
      const McpSecurityEventLogModel = (
        await import('../../common/utils/get-mongoose-models')
      ).getMcpSecurityEventLogModel();

      const doc = {
        eventType: 'confirmation',
        timestamp:
          entry.timestamp instanceof Date ? entry.timestamp : new Date(),
        userId: new mongoose.Types.ObjectId(String(entry.userId)),
        integration: entry.integration,
        toolName: entry.toolName,
        resource: entry.resource,
        action: entry.action,
        confirmed: entry.confirmed,
        timedOut: entry.timedOut,
      };

      await McpSecurityEventLogModel.create(doc);

      loggingService.debug('Confirmation log persisted', {
        entryId: `${entry.userId}-${entry.timestamp}`,
      });
    } catch (error) {
      loggingService.error('Failed to store confirmation log', {
        error: error instanceof Error ? error.message : String(error),
        entry,
      });
    }
  }

  /**
   * Store permission denial log entry to persistent database
   */
  private static async storePermissionDenialLog(
    entry: Record<string, unknown>,
  ): Promise<void> {
    try {
      const McpSecurityEventLogModel = (
        await import('../../common/utils/get-mongoose-models')
      ).getMcpSecurityEventLogModel();

      const doc = {
        eventType: 'permission_denial',
        timestamp:
          entry.timestamp instanceof Date ? entry.timestamp : new Date(),
        userId: new mongoose.Types.ObjectId(String(entry.userId)),
        integration: entry.integration,
        toolName: entry.toolName,
        reason: entry.reason,
        missingScope: entry.missingScope,
      };

      await McpSecurityEventLogModel.create(doc);

      loggingService.debug('Permission denial log persisted', {
        entryId: `${entry.userId}-${entry.timestamp}`,
      });
    } catch (error) {
      loggingService.error('Failed to store permission denial log', {
        error: error instanceof Error ? error.message : String(error),
        entry,
      });
    }
  }

  /**
   * Get audit logs for user (admin function)
   */
  static async getUserAuditLogs(
    userId: string,
    options: {
      integration?: IntegrationType;
      startDate?: Date;
      endDate?: Date;
      limit?: number;
    } = {},
  ): Promise<AuditLogEntry[]> {
    try {
      loggingService.info('Audit log query', {
        userId,
        ...options,
      });

      // Filter logs from in-memory store
      let filteredLogs = this.auditLogs.filter((log) => log.userId === userId);

      // Apply integration filter
      if (options.integration) {
        filteredLogs = filteredLogs.filter(
          (log) => log.integration === options.integration,
        );
      }

      // Apply date range filters
      if (options.startDate) {
        filteredLogs = filteredLogs.filter(
          (log) => log.timestamp >= options.startDate!,
        );
      }

      if (options.endDate) {
        filteredLogs = filteredLogs.filter(
          (log) => log.timestamp <= options.endDate!,
        );
      }

      // Sort by timestamp (newest first)
      filteredLogs.sort(
        (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
      );

      // Apply limit
      if (options.limit && options.limit > 0) {
        filteredLogs = filteredLogs.slice(0, options.limit);
      }

      return filteredLogs;
    } catch (error) {
      loggingService.error('Failed to query audit logs', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        options,
      });
      return [];
    }
  }

  /**
   * Get audit log statistics
   */
  static async getAuditStats(userId?: string): Promise<{
    totalLogs: number;
    successfulOperations: number;
    failedOperations: number;
    dangerousOperations: number;
    integrationBreakdown: Record<IntegrationType, number>;
  }> {
    try {
      const logs = userId
        ? this.auditLogs.filter((log) => log.userId === userId)
        : this.auditLogs;

      const stats = {
        totalLogs: logs.length,
        successfulOperations: logs.filter((log) => log.success).length,
        failedOperations: logs.filter((log) => !log.success).length,
        dangerousOperations: logs.filter((log) => log.dangerousOperation)
          .length,
        integrationBreakdown: {} as Record<IntegrationType, number>,
      };

      // Calculate integration breakdown
      for (const log of logs) {
        stats.integrationBreakdown[log.integration] =
          (stats.integrationBreakdown[log.integration] || 0) + 1;
      }

      return stats;
    } catch (error) {
      loggingService.error('Failed to calculate audit stats', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
      return {
        totalLogs: 0,
        successfulOperations: 0,
        failedOperations: 0,
        dangerousOperations: 0,
        integrationBreakdown: {} as Record<IntegrationType, number>,
      };
    }
  }

  /**
   * Clear old audit logs (maintenance function)
   */
  static async clearOldLogs(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const initialCount = this.auditLogs.length;
      this.auditLogs = this.auditLogs.filter(
        (log) => log.timestamp > cutoffDate,
      );
      const clearedCount = initialCount - this.auditLogs.length;

      loggingService.info('Audit logs cleared', {
        clearedCount,
        remainingCount: this.auditLogs.length,
        cutoffDate,
      });

      return clearedCount;
    } catch (error) {
      loggingService.error('Failed to clear old audit logs', {
        error: error instanceof Error ? error.message : String(error),
        olderThanDays,
      });
      return 0;
    }
  }
}
