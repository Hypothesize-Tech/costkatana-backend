/**
 * Permission Manager
 * Manages and validates MCP tool permissions
 */

import { McpPermission, IMcpPermission } from '../../models/McpPermission';
import {
  IntegrationType,
  PermissionCheckContext,
  PermissionCheckResult,
  ToolPermissions,
} from '../types/permission.types';
import { OAuthScopeMapper } from './oauth-scope-mapper';
import { loggingService } from '../../services/logging.service';
import { AuditLogger } from '../utils/audit-logger';
import { Types } from 'mongoose';

export class PermissionManager {
  /**
   * Create or update permission for user's connection
   */
  static async grantPermission(
    userId: string,
    integration: IntegrationType,
    connectionId: string,
    scopes: string[],
    options: {
      grantedBy?: 'user' | 'admin';
      expiresAt?: Date;
      resourceRestrictions?: any;
    } = {}
  ): Promise<IMcpPermission> {
    // Map scopes to tools and HTTP methods
    const tools = OAuthScopeMapper.getToolsForScopes(integration, scopes);
    const httpMethods = OAuthScopeMapper.getHttpMethodsForScopes(integration, scopes);

    const permissions: ToolPermissions = {
      tools,
      scopes,
      httpMethods,
      resources: options.resourceRestrictions,
    };

    // Convert userId and connectionId to ObjectId for consistent storage
    const userObjectId = new Types.ObjectId(userId);
    const connectionObjectId = new Types.ObjectId(connectionId);

    loggingService.debug('MCP permission grant - input', {
      userId,
      userIdType: typeof userId,
      connectionId,
      connectionIdType: typeof connectionId,
      integration,
    });

    loggingService.debug('MCP permission grant - converted to ObjectId', {
      userObjectId: userObjectId.toString(),
      connectionObjectId: connectionObjectId.toString(),
    });

    // Upsert permission
    const permission = await McpPermission.findOneAndUpdate(
      { userId: userObjectId, integration, connectionId: connectionObjectId },
      {
        userId: userObjectId,
        integration,
        connectionId: connectionObjectId,
        permissions,
        grantedAt: new Date(),
        grantedBy: options.grantedBy || 'user',
        expiresAt: options.expiresAt,
      },
      { upsert: true, new: true }
    );

    loggingService.info('MCP permission granted', {
      userId,
      integration,
      connectionId,
      toolCount: tools.length,
      scopeCount: scopes.length,
      grantedBy: options.grantedBy || 'user',
    });

    return permission;
  }

  /**
   * Check if user has permission for specific tool
   */
  static async checkPermission(
    context: PermissionCheckContext
  ): Promise<PermissionCheckResult> {
    try {
      // Log what we're receiving
      loggingService.info('🔍 MCP permission check - received context', {
        userId: context.userId,
        userIdType: typeof context.userId,
        integration: context.integration,
        connectionId: context.connectionId,
        connectionIdType: typeof context.connectionId,
        toolName: context.toolName,
      });

      // Convert to ObjectId for querying
      const userObjectId = new Types.ObjectId(context.userId);
      const connectionObjectId = new Types.ObjectId(context.connectionId);

      loggingService.info('🔍 MCP permission check - converted to ObjectId', {
        userObjectId: userObjectId.toString(),
        connectionObjectId: connectionObjectId.toString(),
      });

      // Get permission document
      const permission = await McpPermission.findOne({
        userId: userObjectId,
        integration: context.integration,
        connectionId: connectionObjectId,
      }).lean();

      loggingService.info('🔍 MCP permission check - query result', {
        found: !!permission,
        permissionUserId: permission?.userId?.toString(),
        permissionConnectionId: permission?.connectionId?.toString(),
      });

      if (!permission) {
        await AuditLogger.logPermissionDenial(
          context.userId,
          context.integration,
          context.toolName,
          'No permission document found'
        );

        return {
          allowed: false,
          reason: 'No permissions configured for this integration',
        };
      }

      // Check if expired
      if (permission.expiresAt && permission.expiresAt < new Date()) {
        await AuditLogger.logPermissionDenial(
          context.userId,
          context.integration,
          context.toolName,
          'Permission expired'
        );

        return {
          allowed: false,
          reason: 'Permissions have expired',
        };
      }

      // Check tool permission
      if (!permission.permissions.tools.includes(context.toolName)) {
        const requiredScope = OAuthScopeMapper.getRequiredScopeForTool(
          context.integration,
          context.toolName
        );

        await AuditLogger.logPermissionDenial(
          context.userId,
          context.integration,
          context.toolName,
          'Tool not in allowed tools',
          requiredScope || undefined
        );

        return {
          allowed: false,
          reason: `Tool '${context.toolName}' not allowed`,
          missingPermission: context.toolName,
          missingScope: requiredScope || undefined,
        };
      }

      // Check HTTP method permission
      if (!permission.permissions.httpMethods.includes(context.httpMethod)) {
        await AuditLogger.logPermissionDenial(
          context.userId,
          context.integration,
          context.toolName,
          `HTTP method '${context.httpMethod}' not allowed`
        );

        return {
          allowed: false,
          reason: `HTTP method '${context.httpMethod}' not allowed for this integration`,
        };
      }

      // Check resource-level restrictions if provided
      if (context.resourceId && permission.permissions.resources) {
        const resourceAllowed = await this.checkResourceAccess(
          context.resourceId,
          permission.permissions.resources,
          context.userId,
          context.integration
        );

        if (!resourceAllowed) {
          await AuditLogger.logPermissionDenial(
            context.userId,
            context.integration,
            context.toolName,
            `Resource access denied: ${context.resourceId}`
          );

          return {
            allowed: false,
            reason: `Access to resource '${context.resourceId}' is restricted`,
          };
        }
      }

      // Check if dangerous operation requires confirmation
      const isDangerous = context.httpMethod === 'DELETE' ||
        context.toolName.includes('delete') ||
        context.toolName.includes('remove');

      if (isDangerous) {
        return {
          allowed: true,
          requiresConfirmation: true,
        };
      }

      // Update usage tracking
      await McpPermission.updateOne(
        { _id: permission._id },
        {
          $set: { lastUsed: new Date() },
          $inc: { usageCount: 1 },
        }
      );

      return {
        allowed: true,
      };
    } catch (error) {
      loggingService.error('Permission check failed', {
        error: error instanceof Error ? error.message : String(error),
        context,
      });

      // Fail closed on error
      return {
        allowed: false,
        reason: 'Permission check failed due to system error',
      };
    }
  }

  /**
   * Check resource-level access
   */
  private static async checkResourceAccess(
    resourceId: string,
    restrictions: any,
    userId: string,
    integration: IntegrationType
  ): Promise<boolean> {
    // If ownOnly is true, verify ownership
    if (restrictions.ownOnly) {
      return await this.verifyResourceOwnership(resourceId, userId, integration);
    }

    // Check specific resource ID lists
    if (restrictions.projectIds && restrictions.projectIds.length > 0) {
      return restrictions.projectIds.includes(resourceId);
    }

    if (restrictions.repoIds && restrictions.repoIds.length > 0) {
      return restrictions.repoIds.includes(resourceId);
    }

    if (restrictions.fileIds && restrictions.fileIds.length > 0) {
      return restrictions.fileIds.includes(resourceId);
    }

    if (restrictions.channelIds && restrictions.channelIds.length > 0) {
      return restrictions.channelIds.includes(resourceId);
    }

    // No restrictions mean all resources are allowed
    return true;
  }

  /**
   * Verify resource ownership (Production implementation)
   */
  private static async verifyResourceOwnership(
    resourceId: string,
    userId: string,
    integration: IntegrationType
  ): Promise<boolean> {
    try {
      switch (integration) {
        case 'vercel': {
          const { VercelConnection } = await import('../../models/VercelConnection');
          const conn = await VercelConnection.findOne({
            userId,
            'projects.id': resourceId,
          });
          return !!conn;
        }

        case 'github': {
          const { GitHubConnection } = await import('../../models/GitHubConnection');
          const conn = await GitHubConnection.findOne({
            userId,
            'repositories.id': resourceId,
          });
          return !!conn;
        }

        case 'google': {
          const { GoogleConnection } = await import('../../models/GoogleConnection');
          const conn = await GoogleConnection.findOne({
            userId,
            'driveFiles.id': resourceId,
          });
          return !!conn;
        }

        case 'mongodb': {
          // For MongoDB, verify the collection exists in user's connection
          const { MongoDBConnection } = await import('../../models/MongoDBConnection');
          const conn = await MongoDBConnection.findOne({ userId });
          return !!conn;
        }

        default:
          // For other integrations, use standard Integration model
          const { Integration } = await import('../../models/Integration');
          const conn = await Integration.findOne({
            userId,
            type: new RegExp(integration, 'i'),
          });
          return !!conn;
      }
    } catch (error) {
      loggingService.error('Failed to verify resource ownership', {
        error: error instanceof Error ? error.message : String(error),
        resourceId,
        userId,
        integration,
      });
      // Fail closed on error
      return false;
    }
  }

  /**
   * Get permissions for user's connection
   */
  static async getPermissions(
    userId: string,
    integration: IntegrationType,
    connectionId: string
  ): Promise<ToolPermissions | null> {
    const permission = await McpPermission.findOne({
      userId,
      integration,
      connectionId,
    }).lean();

    return permission?.permissions || null;
  }

  /**
   * Revoke permissions
   */
  static async revokePermission(
    userId: string,
    integration: IntegrationType,
    connectionId: string
  ): Promise<boolean> {
    const result = await McpPermission.deleteOne({
      userId,
      integration,
      connectionId,
    });

    loggingService.info('MCP permission revoked', {
      userId,
      integration,
      connectionId,
      deleted: result.deletedCount,
    });

    return result.deletedCount > 0;
  }

  /**
   * Update resource restrictions
   */
  static async updateResourceRestrictions(
    userId: string,
    integration: IntegrationType,
    connectionId: string,
    restrictions: any
  ): Promise<boolean> {
    const result = await McpPermission.updateOne(
      { userId, integration, connectionId },
      { $set: { 'permissions.resources': restrictions } }
    );

    loggingService.info('MCP resource restrictions updated', {
      userId,
      integration,
      connectionId,
      modified: result.modifiedCount,
    });

    return result.modifiedCount > 0;
  }

  /**
   * Get all permissions for user
   */
  static async getUserPermissions(userId: string): Promise<any[]> {
    return await McpPermission.find({ userId }).lean();
  }

  /**
   * Clean up expired permissions
   */
  static async cleanupExpiredPermissions(): Promise<number> {
    const result = await McpPermission.deleteMany({
      expiresAt: { $lt: new Date() },
    });

    if (result.deletedCount > 0) {
      loggingService.info('Cleaned up expired MCP permissions', {
        count: result.deletedCount,
      });
    }

    return result.deletedCount;
  }
}
