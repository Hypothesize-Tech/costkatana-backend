/**
 * OAuth Scope to Tool Permission Mapper
 * Maps OAuth scopes from integrations to MCP tool permissions
 */

import { IntegrationType, HttpMethod, OAuthScopeMapping } from '../types/permission.types';

export class OAuthScopeMapper {
  // Scope mappings for each integration
  private static readonly SCOPE_MAPPINGS: OAuthScopeMapping[] = [
    // ===== VERCEL =====
    {
      integration: 'vercel',
      scope: 'projects:read',
      tools: ['vercel_list_projects', 'vercel_get_project'],
      httpMethods: ['GET'],
      description: 'Read Vercel projects',
    },
    {
      integration: 'vercel',
      scope: 'projects:write',
      tools: ['vercel_create_project', 'vercel_update_project'],
      httpMethods: ['POST', 'PUT', 'PATCH'],
      description: 'Create and update Vercel projects',
    },
    {
      integration: 'vercel',
      scope: 'projects:delete',
      tools: ['vercel_delete_project'],
      httpMethods: ['DELETE'],
      description: 'Delete Vercel projects',
    },
    {
      integration: 'vercel',
      scope: 'deployments:read',
      tools: ['vercel_list_deployments', 'vercel_get_deployment'],
      httpMethods: ['GET'],
      description: 'Read Vercel deployments',
    },
    {
      integration: 'vercel',
      scope: 'deployments:write',
      tools: ['vercel_create_deployment', 'vercel_rollback_deployment'],
      httpMethods: ['POST'],
      description: 'Create deployments',
    },
    {
      integration: 'vercel',
      scope: 'domains:read',
      tools: ['vercel_list_domains'],
      httpMethods: ['GET'],
      description: 'Read Vercel domains',
    },
    {
      integration: 'vercel',
      scope: 'domains:write',
      tools: ['vercel_add_domain', 'vercel_remove_domain'],
      httpMethods: ['POST', 'DELETE'],
      description: 'Manage Vercel domains',
    },
    {
      integration: 'vercel',
      scope: 'env:read',
      tools: ['vercel_list_env_vars'],
      httpMethods: ['GET'],
      description: 'Read environment variables',
    },
    {
      integration: 'vercel',
      scope: 'env:write',
      tools: ['vercel_set_env_var', 'vercel_delete_env_var'],
      httpMethods: ['POST', 'PUT', 'DELETE'],
      description: 'Manage environment variables',
    },

    // ===== GITHUB =====
    {
      integration: 'github',
      scope: 'repo',
      tools: ['github_list_repos', 'github_create_repo', 'github_list_branches', 'github_create_branch'],
      httpMethods: ['GET', 'POST'],
      description: 'Read and write repository data',
    },
    {
      integration: 'github',
      scope: 'repo:delete',
      tools: ['github_delete_branch'],
      httpMethods: ['DELETE'],
      description: 'Delete repository resources',
    },
    {
      integration: 'github',
      scope: 'issues',
      tools: ['github_list_issues', 'github_get_issue', 'github_create_issue', 'github_update_issue', 'github_close_issue'],
      httpMethods: ['GET', 'POST', 'PATCH'],
      description: 'Manage GitHub issues',
    },
    {
      integration: 'github',
      scope: 'pull_requests',
      tools: ['github_list_prs', 'github_create_pr', 'github_update_pr', 'github_merge_pr'],
      httpMethods: ['GET', 'POST', 'PATCH', 'PUT'],
      description: 'Manage pull requests',
    },

    // ===== GOOGLE =====
    {
      integration: 'google',
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      tools: ['drive_list_files', 'drive_get_file'],
      httpMethods: ['GET'],
      description: 'Read Google Drive files',
    },
    {
      integration: 'google',
      scope: 'https://www.googleapis.com/auth/drive.file',
      tools: ['drive_upload_file', 'drive_update_file', 'drive_create_folder', 'drive_share_file'],
      httpMethods: ['POST', 'PATCH'],
      description: 'Create and update Google Drive files',
    },
    {
      integration: 'google',
      scope: 'https://www.googleapis.com/auth/drive',
      tools: ['drive_delete_file'],
      httpMethods: ['DELETE'],
      description: 'Full Google Drive access including delete',
    },
    {
      integration: 'google',
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      tools: ['sheets_list_spreadsheets', 'sheets_get_values'],
      httpMethods: ['GET'],
      description: 'Read Google Sheets',
    },
    {
      integration: 'google',
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      tools: ['sheets_update_values', 'sheets_append_values'],
      httpMethods: ['PUT', 'POST'],
      description: 'Edit Google Sheets',
    },
    {
      integration: 'google',
      scope: 'https://www.googleapis.com/auth/documents.readonly',
      tools: ['docs_list_documents', 'docs_get_document'],
      httpMethods: ['GET'],
      description: 'Read Google Docs',
    },
    {
      integration: 'google',
      scope: 'https://www.googleapis.com/auth/documents',
      tools: ['docs_create_document'],
      httpMethods: ['POST'],
      description: 'Create and edit Google Docs',
    },

    // ===== SLACK =====
    {
      integration: 'slack',
      scope: 'channels:read',
      tools: ['slack_list_channels'],
      httpMethods: ['GET'],
      description: 'Read Slack channels',
    },
    {
      integration: 'slack',
      scope: 'channels:write',
      tools: ['slack_create_channel', 'slack_archive_channel'],
      httpMethods: ['POST'],
      description: 'Manage Slack channels',
    },
    {
      integration: 'slack',
      scope: 'chat:write',
      tools: ['slack_send_message', 'slack_update_message', 'slack_delete_message'],
      httpMethods: ['POST', 'PUT', 'DELETE'],
      description: 'Send and manage messages',
    },
    {
      integration: 'slack',
      scope: 'users:read',
      tools: ['slack_list_users'],
      httpMethods: ['GET'],
      description: 'Read Slack users',
    },

    // ===== DISCORD =====
    {
      integration: 'discord',
      scope: 'channels:read',
      tools: ['discord_list_channels'],
      httpMethods: ['GET'],
      description: 'Read Discord channels',
    },
    {
      integration: 'discord',
      scope: 'channels:write',
      tools: ['discord_create_channel', 'discord_delete_channel'],
      httpMethods: ['POST', 'DELETE'],
      description: 'Manage Discord channels',
    },
    {
      integration: 'discord',
      scope: 'messages:write',
      tools: ['discord_send_message', 'discord_edit_message', 'discord_delete_message'],
      httpMethods: ['POST', 'PATCH', 'DELETE'],
      description: 'Send and manage messages',
    },
    {
      integration: 'discord',
      scope: 'members:read',
      tools: ['discord_list_users'],
      httpMethods: ['GET'],
      description: 'Read Discord members',
    },
    {
      integration: 'discord',
      scope: 'members:manage',
      tools: ['discord_kick_user', 'discord_ban_user'],
      httpMethods: ['DELETE', 'POST'],
      description: 'Manage Discord members',
    },

    // ===== JIRA =====
    {
      integration: 'jira',
      scope: 'read:jira-work',
      tools: ['jira_list_projects', 'jira_list_issues', 'jira_get_issue'],
      httpMethods: ['GET'],
      description: 'Read Jira data',
    },
    {
      integration: 'jira',
      scope: 'write:jira-work',
      tools: ['jira_create_issue', 'jira_update_issue', 'jira_add_comment', 'jira_transition_issue'],
      httpMethods: ['POST', 'PUT'],
      description: 'Create and update Jira issues',
    },
    {
      integration: 'jira',
      scope: 'delete:jira-work',
      tools: ['jira_delete_issue'],
      httpMethods: ['DELETE'],
      description: 'Delete Jira issues',
    },

    // ===== LINEAR =====
    {
      integration: 'linear',
      scope: 'read',
      tools: ['linear_list_teams', 'linear_list_projects', 'linear_list_issues', 'linear_get_issue'],
      httpMethods: ['GET'],
      description: 'Read Linear data',
    },
    {
      integration: 'linear',
      scope: 'write',
      tools: ['linear_create_issue', 'linear_update_issue'],
      httpMethods: ['POST', 'PATCH'],
      description: 'Create and update Linear issues',
    },
    {
      integration: 'linear',
      scope: 'delete',
      tools: ['linear_delete_issue'],
      httpMethods: ['DELETE'],
      description: 'Delete Linear issues',
    },

    // ===== MONGODB =====
    {
      integration: 'mongodb',
      scope: 'read',
      tools: ['mongodb_find', 'mongodb_aggregate', 'mongodb_count'],
      httpMethods: ['GET'],
      description: 'Read MongoDB data',
    },
    {
      integration: 'mongodb',
      scope: 'write',
      tools: ['mongodb_insert', 'mongodb_update'],
      httpMethods: ['POST', 'PATCH'],
      description: 'Write MongoDB data',
    },
    {
      integration: 'mongodb',
      scope: 'delete',
      tools: ['mongodb_delete'],
      httpMethods: ['DELETE'],
      description: 'Delete MongoDB data',
    },
  ];

  /**
   * Get all tools allowed by given scopes
   */
  static getToolsForScopes(integration: IntegrationType, scopes: string[]): string[] {
    const allowedTools = new Set<string>();

    for (const scope of scopes) {
      const mapping = this.SCOPE_MAPPINGS.find(
        m => m.integration === integration && m.scope === scope
      );

      if (mapping) {
        mapping.tools.forEach(tool => allowedTools.add(tool));
      }
    }

    return Array.from(allowedTools);
  }

  /**
   * Get all HTTP methods allowed by given scopes
   */
  static getHttpMethodsForScopes(integration: IntegrationType, scopes: string[]): HttpMethod[] {
    const allowedMethods = new Set<HttpMethod>();

    for (const scope of scopes) {
      const mapping = this.SCOPE_MAPPINGS.find(
        m => m.integration === integration && m.scope === scope
      );

      if (mapping) {
        mapping.httpMethods.forEach(method => allowedMethods.add(method));
      }
    }

    return Array.from(allowedMethods);
  }

  /**
   * Check if scopes allow specific tool
   */
  static doesScopeAllowTool(
    integration: IntegrationType,
    scopes: string[],
    toolName: string
  ): boolean {
    const allowedTools = this.getToolsForScopes(integration, scopes);
    return allowedTools.includes(toolName);
  }

  /**
   * Get required scope for tool
   */
  static getRequiredScopeForTool(
    integration: IntegrationType,
    toolName: string
  ): string | null {
    const mapping = this.SCOPE_MAPPINGS.find(
      m => m.integration === integration && m.tools.includes(toolName)
    );

    return mapping?.scope || null;
  }

  /**
   * Get all available scopes for integration
   */
  static getAvailableScopes(integration: IntegrationType): OAuthScopeMapping[] {
    return this.SCOPE_MAPPINGS.filter(m => m.integration === integration);
  }

  /**
   * Get human-readable scope descriptions for UI
   */
  static getScopeDescriptions(integration: IntegrationType): Array<{
    scope: string;
    description: string;
    tools: string[];
  }> {
    return this.getAvailableScopes(integration).map(m => ({
      scope: m.scope,
      description: m.description,
      tools: m.tools,
    }));
  }

  /**
   * Get default scopes for an integration (all available scopes)
   */
  static getDefaultScopes(integration: IntegrationType): string[] {
    return this.getAvailableScopes(integration).map(m => m.scope);
  }
}
