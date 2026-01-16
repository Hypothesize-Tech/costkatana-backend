/**
 * Jira MCP Server
 * Full operations for Jira integration
 */

import { BaseIntegrationMCP } from './base-integration.mcp';
import { createToolSchema, createParameter, CommonParameters } from '../registry/tool-metadata';

// Note: Jira Cloud API base will be determined by the user's domain (stored in connection)
const JIRA_API_VERSION = '/rest/api/3';

export class JiraMCP extends BaseIntegrationMCP {
  constructor() {
    super('jira', '1.0.0');
  }
  /**
   * Build JIRA API URL based on whether it's OAuth (Cloud ID) or API token (site URL)
   */
  private buildJiraUrl(domainOrCloudId: string, path: string): string {
    // Check if it's a Cloud ID (UUID format) or a domain
    const isCloudId = domainOrCloudId.match(/^[a-f0-9-]{36}$/i);
    
    if (isCloudId) {
      // OAuth 2.0 with Cloud ID uses Atlassian API format
      return `https://api.atlassian.com/ex/jira/${domainOrCloudId}${path}`;
    } else {
      // API token uses direct site URL
      return `https://${domainOrCloudId}${path}`;
    }
  }

  /**
   * Get Jira Cloud domain from connection
   */
  private async getJiraDomain(connectionId: string): Promise<string> {
    const { Integration } = await import('../../models/Integration');
    const conn = await Integration.findById(connectionId);
    
    if (!conn) {
      throw new Error('JIRA connection not found');
    }
    
    // Decrypt credentials
    const credentials = conn.getCredentials();
    
    // For OAuth 2.0, use Cloud ID (Atlassian API format)
    // For API token, use siteUrl
    const cloudId = credentials.cloudId;
    if (cloudId) {
      // Return Cloud ID for OAuth 2.0 (will be used in Atlassian API URL format)
      return cloudId;
    }
    
    // Fallback to siteUrl for API token authentication
    const siteUrl = credentials.siteUrl;
    if (siteUrl) {
      // Extract domain from full URL (e.g., https://hypothesize-team.atlassian.net -> hypothesize-team.atlassian.net)
      try {
        const url = new URL(siteUrl);
        return url.hostname;
      } catch {
        return siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      }
    }
    
    throw new Error('JIRA domain/cloudId not found in connection');
  }

  registerTools(): void {
    // ===== PROJECT OPERATIONS =====

    // List projects
    this.registerTool(
      createToolSchema(
        'jira_list_projects',
        'jira',
        'List Jira projects',
        'GET',
        [CommonParameters.limit],
        { requiredScopes: ['read:jira-work'] }
      ),
      async (params, context) => {
        const domain = await this.getJiraDomain(context.connectionId);
        const queryParams: any = {
          maxResults: params.limit || 20,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          this.buildJiraUrl(domain, `${JIRA_API_VERSION}/project`),
          { params: queryParams, timeout: 300000 } // 5 minutes
        );

        return {
          projects: data,
          count: data.length,
        };
      }
    );

    // ===== ISSUE OPERATIONS =====

    // List issues
    this.registerTool(
      createToolSchema(
        'jira_list_issues',
        'jira',
        'List Jira issues using JQL',
        'GET',
        [
          createParameter('jql', 'string', 'JQL query', { required: false, default: 'order by created DESC' }),
          CommonParameters.limit,
        ],
        { requiredScopes: ['read:jira-work'] }
      ),
      async (params, context) => {
        const domain = await this.getJiraDomain(context.connectionId);
        const queryParams: any = {
          jql: params.jql || 'order by created DESC',
          maxResults: params.limit || 20,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          this.buildJiraUrl(domain, `${JIRA_API_VERSION}/search`),
          { params: queryParams, timeout: 300000 } // 5 minutes
        );

        return {
          issues: data.issues || [],
          total: data.total,
          count: data.issues?.length || 0,
        };
      }
    );

    // Get issue
    this.registerTool(
      createToolSchema(
        'jira_get_issue',
        'jira',
        'Get details of a specific issue',
        'GET',
        [createParameter('issueKey', 'string', 'Issue key (e.g., PROJ-123)', { required: true })],
        { requiredScopes: ['read:jira-work'] }
      ),
      async (params, context) => {
        const domain = await this.getJiraDomain(context.connectionId);
        
        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          this.buildJiraUrl(domain, `${JIRA_API_VERSION}/issue/${params.issueKey}`),
          { timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Create issue
    this.registerTool(
      createToolSchema(
        'jira_create_issue',
        'jira',
        'Create a new Jira issue',
        'POST',
        [
          createParameter('projectKey', 'string', 'Project key', { required: true }),
          CommonParameters.title,
          CommonParameters.description,
          createParameter('issueType', 'string', 'Issue type', {
            required: false,
            default: 'Task',
          }),
          createParameter('priority', 'string', 'Priority', { required: false }),
          createParameter('assignee', 'string', 'Assignee account ID', { required: false }),
        ],
        { requiredScopes: ['write:jira-work'] }
      ),
      async (params, context) => {
        const domain = await this.getJiraDomain(context.connectionId);
        
        const body = {
          fields: {
            project: { key: params.projectKey },
            summary: params.title,
            description: params.description ? {
              type: 'doc',
              version: 1,
              content: [{
                type: 'paragraph',
                content: [{ type: 'text', text: params.description }],
              }],
            } : undefined,
            issuetype: { name: params.issueType || 'Task' },
            priority: params.priority ? { name: params.priority } : undefined,
            assignee: params.assignee ? { id: params.assignee } : undefined,
          },
        };

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          this.buildJiraUrl(domain, `${JIRA_API_VERSION}/issue`),
          { body, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Update issue
    this.registerTool(
      createToolSchema(
        'jira_update_issue',
        'jira',
        'Update an existing issue',
        'PUT',
        [
          createParameter('issueKey', 'string', 'Issue key (e.g., PROJ-123)', { required: true }),
          createParameter('summary', 'string', 'New summary', { required: false }),
          createParameter('description', 'string', 'New description', { required: false }),
          createParameter('priority', 'string', 'New priority', { required: false }),
        ],
        { requiredScopes: ['write:jira-work'] }
      ),
      async (params, context) => {
        const domain = await this.getJiraDomain(context.connectionId);
        const { issueKey, ...fields } = params;

        const body: any = { fields: {} };
        
        if (fields.summary) body.fields.summary = fields.summary;
        if (fields.description) {
          body.fields.description = {
            type: 'doc',
            version: 1,
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: fields.description }],
            }],
          };
        }
        if (fields.priority) body.fields.priority = { name: fields.priority };

        await this.makeRequest(
          context.connectionId,
          'PUT',
          this.buildJiraUrl(domain, `${JIRA_API_VERSION}/issue/${issueKey}`),
          { body, timeout: 300000 } // 5 minutes
        );

        return {
          success: true,
          message: `Issue ${issueKey} updated successfully`,
        };
      }
    );

    // Delete issue
    this.registerTool(
      createToolSchema(
        'jira_delete_issue',
        'jira',
        'Delete a Jira issue',
        'DELETE',
        [createParameter('issueKey', 'string', 'Issue key (e.g., PROJ-123)', { required: true })],
        {
          requiredScopes: ['delete:jira-work'],
          dangerous: true,
        }
      ),
      async (params, context) => {
        const domain = await this.getJiraDomain(context.connectionId);

        await this.makeRequest(
          context.connectionId,
          'DELETE',
          this.buildJiraUrl(domain, `${JIRA_API_VERSION}/issue/${params.issueKey}`),
          { timeout: 300000 } // 5 minutes
        );

        return {
          success: true,
          message: `Issue ${params.issueKey} deleted successfully`,
        };
      }
    );

    // Add comment
    this.registerTool(
      createToolSchema(
        'jira_add_comment',
        'jira',
        'Add a comment to an issue',
        'POST',
        [
          createParameter('issueKey', 'string', 'Issue key (e.g., PROJ-123)', { required: true }),
          createParameter('comment', 'string', 'Comment text', { required: true }),
        ],
        { requiredScopes: ['write:jira-work'] }
      ),
      async (params, context) => {
        const domain = await this.getJiraDomain(context.connectionId);
        
        const body = {
          body: {
            type: 'doc',
            version: 1,
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: params.comment }],
            }],
          },
        };

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          this.buildJiraUrl(domain, `${JIRA_API_VERSION}/issue/${params.issueKey}/comment`),
          { body, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Transition issue
    this.registerTool(
      createToolSchema(
        'jira_transition_issue',
        'jira',
        'Transition an issue to a new status',
        'POST',
        [
          createParameter('issueKey', 'string', 'Issue key (e.g., PROJ-123)', { required: true }),
          createParameter('transitionId', 'string', 'Transition ID', { required: true }),
          createParameter('comment', 'string', 'Optional comment', { required: false }),
        ],
        { requiredScopes: ['write:jira-work'] }
      ),
      async (params, context) => {
        const domain = await this.getJiraDomain(context.connectionId);
        
        const body: any = {
          transition: { id: params.transitionId },
        };

        if (params.comment) {
          body.update = {
            comment: [{
              add: {
                body: {
                  type: 'doc',
                  version: 1,
                  content: [{
                    type: 'paragraph',
                    content: [{ type: 'text', text: params.comment }],
                  }],
                },
              },
            }],
          };
        }

        await this.makeRequest(
          context.connectionId,
          'POST',
          this.buildJiraUrl(domain, `${JIRA_API_VERSION}/issue/${params.issueKey}/transitions`),
          { body, timeout: 300000 } // 5 minutes
        );

        return {
          success: true,
          message: `Issue ${params.issueKey} transitioned successfully`,
        };
      }
    );
  }
}

// Initialize and register Jira tools
export function initializeJiraMCP(): void {
  const jiraMCP = new JiraMCP();
  jiraMCP.registerTools();
}
