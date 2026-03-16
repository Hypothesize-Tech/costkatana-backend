import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  McpPermission,
  McpPermissionDocument,
} from '@/schemas/security/mcp-permission.schema';
import { VercelConnection } from '@/schemas/integration/vercel-connection.schema';
import { GitHubConnection } from '@/schemas/integration/github-connection.schema';
import { GoogleConnection } from '@/schemas/integration/google-connection.schema';
import { MongoDBConnection } from '@/schemas/integration/mongodb-connection.schema';
import { Integration } from '@/schemas/integration/integration.schema';
import {
  IntegrationType,
  PermissionCheckContext,
  PermissionCheckResult,
  ToolPermissions,
} from '../types/mcp.types';
import { OAuthScopeMapperService } from './oauth-scope-mapper.service';
import { McpAuditService } from './mcp-audit.service';
import { LoggerService } from '@/common/logger/logger.service';

@Injectable()
export class McpPermissionService {
  constructor(
    @InjectModel(McpPermission.name)
    private mcpPermissionModel: Model<McpPermissionDocument>,
    @InjectModel(VercelConnection.name)
    private vercelConnectionModel: Model<VercelConnection>,
    @InjectModel(GitHubConnection.name)
    private githubConnectionModel: Model<GitHubConnection>,
    @InjectModel(GoogleConnection.name)
    private googleConnectionModel: Model<GoogleConnection>,
    @InjectModel(MongoDBConnection.name)
    private mongodbConnectionModel: Model<MongoDBConnection>,
    @InjectModel(Integration.name) private integrationModel: Model<Integration>,
    private oauthScopeMapper: OAuthScopeMapperService,
    private auditService: McpAuditService,
    private logger: LoggerService,
  ) {}

  /**
   * Create or update permission for user's connection
   */
  async grantPermission(
    userId: string,
    integration: IntegrationType,
    connectionId: string,
    scopes: string[],
    options: {
      grantedBy?: 'user' | 'admin';
      expiresAt?: Date;
      resourceRestrictions?: any;
    } = {},
  ): Promise<McpPermissionDocument> {
    // Map scopes to tools and HTTP methods
    const tools = this.oauthScopeMapper.getToolsForScopes(integration, scopes);
    const httpMethods = this.oauthScopeMapper.getHttpMethodsForScopes(
      integration,
      scopes,
    );

    const permissions: ToolPermissions = {
      tools,
      scopes,
      httpMethods,
      resources: options.resourceRestrictions,
    };

    // Convert userId and connectionId to ObjectId for consistent storage
    const userObjectId = new Types.ObjectId(userId);
    const connectionObjectId = new Types.ObjectId(connectionId);

    this.logger.debug('MCP permission grant - input', {
      userId,
      userIdType: typeof userId,
      connectionId,
      connectionIdType: typeof connectionId,
      integration,
    });

    this.logger.debug('MCP permission grant - converted to ObjectId', {
      userObjectId: userObjectId.toString(),
      connectionObjectId: connectionObjectId.toString(),
    });

    // Upsert permission
    const permission = await this.mcpPermissionModel.findOneAndUpdate(
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
      { upsert: true, new: true },
    );

    this.logger.log('MCP permission granted', {
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
   * Auto-grant MCP permissions when a new integration is connected
   */
  async grantPermissionsForNewConnection(
    userId: string,
    integration: IntegrationType,
    connectionId: string,
  ): Promise<void> {
    try {
      this.logger.log('🔐 Auto-granting MCP permissions', {
        userId,
        integration,
        connectionId,
      });

      // Check if permissions already exist
      const existing = await this.mcpPermissionModel.findOne({
        userId: new Types.ObjectId(userId),
        integration,
        connectionId: new Types.ObjectId(connectionId),
      });

      if (existing) {
        this.logger.log('MCP permissions already exist, skipping', {
          userId,
          integration,
          connectionId,
        });
        return;
      }

      // Get all available tools for this integration
      const tools = this.getToolsForIntegration(integration);

      // Get OAuth scopes for this integration
      const scopes = this.oauthScopeMapper.getDefaultScopes(integration);

      // Create permission document
      await this.mcpPermissionModel.create({
        userId: new Types.ObjectId(userId),
        integration,
        connectionId: new Types.ObjectId(connectionId),
        permissions: {
          tools,
          scopes,
          httpMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          resources: {
            projectIds: [],
            repoIds: [],
            fileIds: [],
            channelIds: [],
            ownOnly: false,
          },
        },
        grantedAt: new Date(),
        grantedBy: 'admin', // Auto-granted by system
        expiresAt: null, // No expiration
      });

      this.logger.log('✅ MCP permissions auto-granted successfully', {
        userId,
        integration,
        connectionId,
        toolsCount: tools.length,
      });
    } catch (error) {
      this.logger.error('Failed to auto-grant MCP permissions', {
        userId,
        integration,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check if user has permission for specific tool
   */
  async checkPermission(
    context: PermissionCheckContext,
  ): Promise<PermissionCheckResult> {
    try {
      // Log what we're receiving
      this.logger.log('🔍 MCP permission check - received context', {
        userId: context.userId,
        userIdType: typeof context.userId,
        integration: context.integration,
        connectionId: context.connectionId,
        connectionIdType: typeof context.connectionId,
        toolName: context.toolName,
      });

      // Audit log the permission request
      await this.auditService.logPermissionRequest(
        context.userId,
        context.integration,
        context.resourceId || context.toolName,
        context.httpMethod,
        context.endpoint || `/${context.toolName}`,
        context.requestBody,
        context.ipAddress,
        context.userAgent,
        {
          connectionId: context.connectionId,
          toolName: context.toolName,
        },
      );

      // Convert to ObjectId for querying
      const userObjectId = new Types.ObjectId(context.userId);
      const connectionObjectId = new Types.ObjectId(context.connectionId);

      this.logger.log('🔍 MCP permission check - converted to ObjectId', {
        userObjectId: userObjectId.toString(),
        connectionObjectId: connectionObjectId.toString(),
      });

      // Get permission document
      const permission = await this.mcpPermissionModel
        .findOne({
          userId: userObjectId,
          integration: context.integration,
          connectionId: connectionObjectId,
        })
        .lean();

      this.logger.log('🔍 MCP permission check - query result', {
        found: !!permission,
        permissionUserId: permission?.userId?.toString(),
        permissionConnectionId: permission?.connectionId?.toString(),
      });

      if (!permission) {
        // Audit log permission denial
        await this.auditService.logPermissionDenial(
          context.userId,
          context.integration,
          context.resourceId || context.toolName,
          context.httpMethod,
          context.endpoint || `/${context.toolName}`,
          'No permissions configured for this integration',
          context.ipAddress,
          context.userAgent,
          {
            connectionId: context.connectionId,
            toolName: context.toolName,
          },
        );

        return {
          allowed: false,
          reason: 'No permissions configured for this integration',
        };
      }

      // Check if expired
      if (permission.expiresAt && permission.expiresAt < new Date()) {
        // Audit log permission denial
        await this.auditService.logPermissionDenial(
          context.userId,
          context.integration,
          context.resourceId || context.toolName,
          context.httpMethod,
          context.endpoint || `/${context.toolName}`,
          'Permissions have expired',
          context.ipAddress,
          context.userAgent,
          {
            connectionId: context.connectionId,
            toolName: context.toolName,
            expiresAt: permission.expiresAt,
          },
        );

        return {
          allowed: false,
          reason: 'Permissions have expired',
        };
      }

      // Check tool permission
      if (!permission.permissions.tools.includes(context.toolName)) {
        const requiredScope = this.oauthScopeMapper.getRequiredScopeForTool(
          context.integration,
          context.toolName,
        );

        // Audit log permission denial
        await this.auditService.logPermissionDenial(
          context.userId,
          context.integration,
          context.resourceId || context.toolName,
          context.httpMethod,
          context.endpoint || `/${context.toolName}`,
          `Tool '${context.toolName}' not allowed`,
          context.ipAddress,
          context.userAgent,
          {
            connectionId: context.connectionId,
            toolName: context.toolName,
            missingScope: requiredScope,
            availableTools: permission.permissions.tools,
          },
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
        // Audit log permission denial
        await this.auditService.logPermissionDenial(
          context.userId,
          context.integration,
          context.resourceId || context.toolName,
          context.httpMethod,
          context.endpoint || `/${context.toolName}`,
          `HTTP method '${context.httpMethod}' not allowed for this integration`,
          context.ipAddress,
          context.userAgent,
          {
            connectionId: context.connectionId,
            toolName: context.toolName,
            httpMethod: context.httpMethod,
            allowedMethods: permission.permissions.httpMethods,
          },
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
          context.integration,
        );

        if (!resourceAllowed) {
          // Audit log permission denial
          await this.auditService.logPermissionDenial(
            context.userId,
            context.integration,
            context.resourceId || context.toolName,
            context.httpMethod,
            context.endpoint || `/${context.toolName}`,
            `Access to resource '${context.resourceId}' is restricted`,
            context.ipAddress,
            context.userAgent,
            {
              connectionId: context.connectionId,
              toolName: context.toolName,
              resourceId: context.resourceId,
              resourceRestrictions: permission.permissions.resources,
            },
          );

          return {
            allowed: false,
            reason: `Access to resource '${context.resourceId}' is restricted`,
          };
        }
      }

      // Check if dangerous operation requires confirmation
      const isDangerous =
        context.httpMethod === 'DELETE' ||
        context.toolName.includes('delete') ||
        context.toolName.includes('remove');

      if (isDangerous) {
        // Audit log permission approval (with confirmation required)
        await this.auditService.logPermissionApproval(
          context.userId,
          context.integration,
          context.resourceId || context.toolName,
          context.httpMethod,
          context.endpoint || `/${context.toolName}`,
          { allowed: true, requiresConfirmation: true },
          context.ipAddress,
          context.userAgent,
          {
            connectionId: context.connectionId,
            toolName: context.toolName,
            requiresConfirmation: true,
            dangerousOperation: true,
          },
        );

        return {
          allowed: true,
          requiresConfirmation: true,
        };
      }

      // Update usage tracking
      await this.mcpPermissionModel.updateOne(
        { _id: permission._id },
        {
          $set: { lastUsed: new Date() },
          $inc: { usageCount: 1 },
        },
      );

      // Audit log permission approval
      await this.auditService.logPermissionApproval(
        context.userId,
        context.integration,
        context.resourceId || context.toolName,
        context.httpMethod,
        context.endpoint || `/${context.toolName}`,
        { allowed: true },
        context.ipAddress,
        context.userAgent,
        {
          connectionId: context.connectionId,
          toolName: context.toolName,
          requiresConfirmation: false,
        },
      );

      return {
        allowed: true,
      };
    } catch (error) {
      this.logger.error('Permission check failed', {
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
  private async checkResourceAccess(
    resourceId: string,
    restrictions: any,
    userId: string,
    integration: IntegrationType,
  ): Promise<boolean> {
    // If ownOnly is true, verify ownership
    if (restrictions.ownOnly) {
      return await this.verifyResourceOwnership(
        resourceId,
        userId,
        integration,
      );
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
   * Ported from Express PermissionManager.verifyResourceOwnership
   */
  private async verifyResourceOwnership(
    resourceId: string,
    userId: string,
    integration: IntegrationType,
  ): Promise<boolean> {
    try {
      switch (integration) {
        case 'vercel': {
          const conn = await this.vercelConnectionModel.findOne({
            userId,
            'projects.id': resourceId,
          });
          return !!conn;
        }

        case 'github': {
          // GitHub repositories.id is number in schema; try numeric then string
          const idNum = parseInt(resourceId, 10);
          const conn = !Number.isNaN(idNum)
            ? await this.githubConnectionModel.findOne({
                userId,
                'repositories.id': idNum,
              })
            : await this.githubConnectionModel.findOne({
                userId,
                'repositories.id': resourceId,
              });
          return !!conn;
        }

        case 'google': {
          // Check if the resourceId exists in the user's Google Drive files
          const conn = await this.googleConnectionModel.findOne({
            userId,
            status: 'active',
            'driveFiles.id': resourceId,
          });
          return !!conn;
        }

        case 'mongodb': {
          const conn = await this.mongodbConnectionModel.findOne({
            userId,
            status: 'active',
          });
          return !!conn;
        }

        default: {
          // Slack, discord, jira, linear, aws: use generic Integration model
          const userObjectId = new Types.ObjectId(userId);
          const conn = await this.integrationModel.findOne({
            userId: userObjectId,
            type: new RegExp(integration, 'i'),
            status: 'active',
          });
          return !!conn;
        }
      }
    } catch (error) {
      this.logger.error('Failed to verify resource ownership', {
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
  async getPermissions(
    userId: string,
    integration: IntegrationType,
    connectionId: string,
  ): Promise<ToolPermissions | null> {
    const permission = await this.mcpPermissionModel
      .findOne({
        userId,
        integration,
        connectionId,
      })
      .lean();

    return (permission?.permissions as ToolPermissions) || null;
  }

  /**
   * Revoke permissions
   */
  async revokePermission(
    userId: string,
    integration: IntegrationType,
    connectionId: string,
  ): Promise<boolean> {
    const result = await this.mcpPermissionModel.deleteOne({
      userId,
      integration,
      connectionId,
    });

    this.logger.log('MCP permission revoked', {
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
  async updateResourceRestrictions(
    userId: string,
    integration: IntegrationType,
    connectionId: string,
    restrictions: any,
  ): Promise<boolean> {
    const result = await this.mcpPermissionModel.updateOne(
      { userId, integration, connectionId },
      { $set: { 'permissions.resources': restrictions } },
    );

    this.logger.log('MCP resource restrictions updated', {
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
  async getUserPermissions(userId: string): Promise<McpPermissionDocument[]> {
    return (await this.mcpPermissionModel
      .find({ userId })
      .lean()) as McpPermissionDocument[];
  }

  /**
   * Clean up expired permissions
   */
  async cleanupExpiredPermissions(): Promise<number> {
    const result = await this.mcpPermissionModel.deleteMany({
      expiresAt: { $lt: new Date() },
    });

    if (result.deletedCount > 0) {
      this.logger.log('Cleaned up expired MCP permissions', {
        count: result.deletedCount,
      });
    }

    return result.deletedCount;
  }

  /**
   * Get all available tools for an integration
   */
  private getToolsForIntegration(integration: IntegrationType): string[] {
    const toolMap: Record<IntegrationType, string[]> = {
      vercel: [
        'vercel_list_projects',
        'vercel_get_project',
        'vercel_create_project',
        'vercel_delete_project',
        'vercel_list_deployments',
        'vercel_get_deployment',
        'vercel_cancel_deployment',
        'vercel_list_domains',
        'vercel_add_domain',
        'vercel_remove_domain',
        'vercel_get_env_vars',
        'vercel_set_env_var',
        'vercel_delete_env_var',
      ],
      github: [
        'github_list_repos',
        'github_get_repo',
        'github_create_repo',
        'github_list_issues',
        'github_create_issue',
        'github_update_issue',
        'github_list_prs',
        'github_create_pr',
        'github_update_pr',
        'github_list_branches',
        'github_create_branch',
        'github_delete_branch',
      ],
      google: [
        // Drive tools (6)
        'drive_get_file',
        'drive_upload_file',
        'drive_update_file',
        'drive_delete_file',
        'drive_create_folder',
        'drive_share_file',

        // Sheets tools (3)
        'sheets_get_values',
        'sheets_update_values',
        'sheets_append_values',

        // Docs tools (2)
        'docs_get_document',
        'docs_create_document',
      ],
      mongodb: [
        'mongodb_find',
        'mongodb_aggregate',
        'mongodb_insert',
        'mongodb_update',
        'mongodb_delete',
        'mongodb_count',
        'mongodb_distinct',
        'mongodb_list_collections',
        'mongodb_list_indexes',
        'mongodb_collection_stats',
        'mongodb_analyze_schema',
        'mongodb_explain_query',
        'mongodb_suggest_indexes',
      ],
      aws: [
        'aws_get_costs',
        'aws_cost_breakdown',
        'aws_cost_forecast',
        'aws_cost_anomalies',
        'aws_list_ec2',
        'aws_stop_ec2',
        'aws_start_ec2',
        'aws_idle_instances',
        'aws_list_s3',
        'aws_list_rds',
        'aws_list_lambda',
        'aws_optimize',
      ],
      slack: [
        'slack_list_channels',
        'slack_send_message',
        'slack_get_channel_history',
        'slack_list_users',
        'slack_get_user_profile',
        'slack_set_channel_topic',
        'slack_create_channel',
      ],
      discord: [
        'discord_list_channels',
        'discord_send_message',
        'discord_get_channel_messages',
        'discord_list_members',
        'discord_get_member',
        'discord_create_channel',
        'discord_delete_channel',
        'discord_update_channel',
        'discord_list_roles',
      ],
      jira: [
        'jira_list_projects',
        'jira_get_project',
        'jira_list_issues',
        'jira_get_issue',
        'jira_create_issue',
        'jira_update_issue',
        'jira_add_comment',
        'jira_get_transitions',
      ],
      linear: [
        'linear_list_teams',
        'linear_list_projects',
        'linear_list_issues',
        'linear_get_issue',
        'linear_create_issue',
        'linear_update_issue',
        'linear_add_comment',
      ],
    };

    return toolMap[integration] || [];
  }
}
