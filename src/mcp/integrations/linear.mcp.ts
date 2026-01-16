/**
 * Linear MCP Server
 * Full operations for Linear integration
 */

import { BaseIntegrationMCP } from './base-integration.mcp';
import { createToolSchema, createParameter, CommonParameters } from '../registry/tool-metadata';

const LINEAR_API_BASE = 'https://api.linear.app/graphql';

export class LinearMCP extends BaseIntegrationMCP {
  constructor() {
    super('linear', '1.0.0');
  }

  /**
   * Execute GraphQL query
   */
  private async executeGraphQL(connectionId: string, query: string, variables?: any): Promise<any> {
    const data = await this.makeRequest(
      connectionId,
      'POST',
      LINEAR_API_BASE,
      {
        body: {
          query,
          variables,
        },
        timeout: 300000, // 5 minutes
      }
    );

    if (data.errors) {
      throw new Error(`GraphQL Error: ${JSON.stringify(data.errors)}`);
    }

    return data.data;
  }

  registerTools(): void {
    // ===== TEAM OPERATIONS =====

    // List teams
    this.registerTool(
      createToolSchema(
        'linear_list_teams',
        'linear',
        'List Linear teams',
        'GET',
        [CommonParameters.limit],
        { requiredScopes: ['read'] }
      ),
      async (params, context) => {
        const query = `
          query Teams($first: Int) {
            teams(first: $first) {
              nodes {
                id
                name
                key
                description
                createdAt
              }
            }
          }
        `;

        const data = await this.executeGraphQL(context.connectionId, query, {
          first: params.limit || 20,
        });

        return {
          teams: data.teams.nodes,
          count: data.teams.nodes.length,
        };
      }
    );

    // ===== PROJECT OPERATIONS =====

    // List projects
    this.registerTool(
      createToolSchema(
        'linear_list_projects',
        'linear',
        'List Linear projects',
        'GET',
        [CommonParameters.limit],
        { requiredScopes: ['read'] }
      ),
      async (params, context) => {
        const query = `
          query Projects($first: Int) {
            projects(first: $first) {
              nodes {
                id
                name
                description
                state
                progress
                createdAt
                updatedAt
              }
            }
          }
        `;

        const data = await this.executeGraphQL(context.connectionId, query, {
          first: params.limit || 20,
        });

        return {
          projects: data.projects.nodes,
          count: data.projects.nodes.length,
        };
      }
    );

    // ===== ISSUE OPERATIONS =====

    // List issues
    this.registerTool(
      createToolSchema(
        'linear_list_issues',
        'linear',
        'List Linear issues',
        'GET',
        [
          createParameter('teamId', 'string', 'Team ID', { required: false }),
          CommonParameters.state,
          CommonParameters.limit,
        ],
        { requiredScopes: ['read'] }
      ),
      async (params, context) => {
        const filter: any = {};
        
        if (params.teamId) {
          filter.team = { id: { eq: params.teamId } };
        }
        
        if (params.state) {
          filter.state = { name: { eq: params.state } };
        }

        const query = `
          query Issues($first: Int, $filter: IssueFilter) {
            issues(first: $first, filter: $filter) {
              nodes {
                id
                title
                description
                priority
                state {
                  name
                }
                team {
                  name
                }
                assignee {
                  name
                  email
                }
                createdAt
                updatedAt
              }
            }
          }
        `;

        const data = await this.executeGraphQL(context.connectionId, query, {
          first: params.limit || 20,
          filter,
        });

        return {
          issues: data.issues.nodes,
          count: data.issues.nodes.length,
        };
      }
    );

    // Get issue
    this.registerTool(
      createToolSchema(
        'linear_get_issue',
        'linear',
        'Get details of a specific issue',
        'GET',
        [createParameter('issueId', 'string', 'Issue ID', { required: true })],
        { requiredScopes: ['read'] }
      ),
      async (params, context) => {
        const query = `
          query Issue($id: String!) {
            issue(id: $id) {
              id
              title
              description
              priority
              state {
                name
              }
              team {
                name
              }
              assignee {
                name
                email
              }
              labels {
                nodes {
                  name
                }
              }
              comments {
                nodes {
                  body
                  user {
                    name
                  }
                  createdAt
                }
              }
              createdAt
              updatedAt
            }
          }
        `;

        const data = await this.executeGraphQL(context.connectionId, query, {
          id: params.issueId,
        });

        return data.issue;
      }
    );

    // Create issue
    this.registerTool(
      createToolSchema(
        'linear_create_issue',
        'linear',
        'Create a new Linear issue',
        'POST',
        [
          createParameter('teamId', 'string', 'Team ID', { required: true }),
          CommonParameters.title,
          CommonParameters.description,
          createParameter('priority', 'number', 'Priority (0-4)', { required: false }),
          createParameter('assigneeId', 'string', 'Assignee user ID', { required: false }),
        ],
        { requiredScopes: ['write'] }
      ),
      async (params, context) => {
        const query = `
          mutation IssueCreate($input: IssueCreateInput!) {
            issueCreate(input: $input) {
              success
              issue {
                id
                title
                identifier
                url
              }
            }
          }
        `;

        const input: any = {
          teamId: params.teamId,
          title: params.title,
        };

        if (params.description) input.description = params.description;
        if (params.priority !== undefined) input.priority = params.priority;
        if (params.assigneeId) input.assigneeId = params.assigneeId;

        const data = await this.executeGraphQL(context.connectionId, query, {
          input,
        });

        return data.issueCreate.issue;
      }
    );

    // Update issue
    this.registerTool(
      createToolSchema(
        'linear_update_issue',
        'linear',
        'Update an existing issue',
        'PATCH',
        [
          createParameter('issueId', 'string', 'Issue ID', { required: true }),
          createParameter('title', 'string', 'New title', { required: false }),
          createParameter('description', 'string', 'New description', { required: false }),
          createParameter('priority', 'number', 'New priority (0-4)', { required: false }),
          createParameter('stateId', 'string', 'New state ID', { required: false }),
        ],
        { requiredScopes: ['write'] }
      ),
      async (params, context) => {
        const { issueId, ...updates } = params;

        const query = `
          mutation IssueUpdate($id: String!, $input: IssueUpdateInput!) {
            issueUpdate(id: $id, input: $input) {
              success
              issue {
                id
                title
              }
            }
          }
        `;

        const data = await this.executeGraphQL(context.connectionId, query, {
          id: issueId,
          input: updates,
        });

        return data.issueUpdate.issue;
      }
    );

    // Delete issue
    this.registerTool(
      createToolSchema(
        'linear_delete_issue',
        'linear',
        'Delete a Linear issue',
        'DELETE',
        [createParameter('issueId', 'string', 'Issue ID', { required: true })],
        {
          requiredScopes: ['write'],
          dangerous: true,
        }
      ),
      async (params, context) => {
        const query = `
          mutation IssueDelete($id: String!) {
            issueDelete(id: $id) {
              success
            }
          }
        `;

        const data = await this.executeGraphQL(context.connectionId, query, {
          id: params.issueId,
        });

        return {
          success: data.issueDelete.success,
          message: `Issue ${params.issueId} deleted successfully`,
        };
      }
    );
  }
}

// Initialize and register Linear tools
export function initializeLinearMCP(): void {
  const linearMCP = new LinearMCP();
  linearMCP.registerTools();
}
