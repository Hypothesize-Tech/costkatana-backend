/**
 * Auto Grant MCP Permissions Service
 * Automatically creates MCP permissions when users connect integrations
 */

import mongoose from 'mongoose';
import { McpPermission } from '../../models/McpPermission';
import { IntegrationType } from '../types/permission.types';
import { loggingService } from '../../services/logging.service';
import { OAuthScopeMapper } from './oauth-scope-mapper';

export class AutoGrantMCPPermissions {
  /**
   * Auto-grant MCP permissions when a new integration is connected
   */
  static async grantPermissionsForNewConnection(
    userId: string,
    integration: IntegrationType,
    connectionId: string
  ): Promise<void> {
    try {
      loggingService.info('🔐 Auto-granting MCP permissions', {
        userId,
        integration,
        connectionId,
      });

      // Check if permissions already exist
      const existing = await McpPermission.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        integration,
        connectionId: new mongoose.Types.ObjectId(connectionId),
      });

      if (existing) {
        loggingService.info('MCP permissions already exist, skipping', {
          userId,
          integration,
          connectionId,
        });
        return;
      }

      // Get all available tools for this integration
      const tools = this.getToolsForIntegration(integration);
      
      // Get OAuth scopes for this integration
      const scopes = OAuthScopeMapper.getDefaultScopes(integration);

      // Create permission document
      await McpPermission.create({
        userId: new mongoose.Types.ObjectId(userId),
        integration,
        connectionId: new mongoose.Types.ObjectId(connectionId),
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

      loggingService.info('✅ MCP permissions auto-granted successfully', {
        userId,
        integration,
        connectionId,
        toolsCount: tools.length,
      });
    } catch (error) {
      loggingService.error('Failed to auto-grant MCP permissions', {
        userId,
        integration,
        connectionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get all available tools for an integration
   */
  private static getToolsForIntegration(integration: IntegrationType): string[] {
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
