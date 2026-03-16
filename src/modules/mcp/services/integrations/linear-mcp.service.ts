/**
 * Linear MCP Service
 * Full operations for Linear integration
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseIntegrationService } from './base-integration.service';
import { ToolRegistryService } from '../tool-registry.service';
import { TokenManagerService } from '../token-manager.service';
import { LoggerService } from '../../../../common/logger/logger.service';
import {
  createToolSchema,
  createParameter,
  CommonParameters,
} from '../../utils/tool-validation';
import { VercelConnection } from '../../../../schemas/integration/vercel-connection.schema';
import { GitHubConnection } from '../../../../schemas/integration/github-connection.schema';
import { GoogleConnection } from '../../../../schemas/integration/google-connection.schema';
import { MongoDBConnection } from '../../../../schemas/integration/mongodb-connection.schema';
import { AWSConnection } from '../../../../schemas/integration/aws-connection.schema';
import { Integration } from '@/schemas/integration/integration.schema';

const LINEAR_API_BASE = 'https://api.linear.app/graphql';

@Injectable()
export class LinearMcpService
  extends BaseIntegrationService
  implements OnModuleInit
{
  protected integration: 'linear' = 'linear';
  protected version = '1.0.0';

  constructor(
    logger: LoggerService,
    toolRegistry: ToolRegistryService,
    tokenManager: TokenManagerService,
    @InjectModel(VercelConnection.name)
    vercelConnectionModel: Model<VercelConnection>,
    @InjectModel(GitHubConnection.name)
    githubConnectionModel: Model<GitHubConnection>,
    @InjectModel(GoogleConnection.name)
    googleConnectionModel: Model<GoogleConnection>,
    @InjectModel(MongoDBConnection.name)
    mongodbConnectionModel: Model<MongoDBConnection>,
    @InjectModel(AWSConnection.name) awsConnectionModel: Model<AWSConnection>,
    @InjectModel(Integration.name) integrationModel: Model<Integration>,
  ) {
    super(
      logger,
      toolRegistry,
      tokenManager,
      vercelConnectionModel,
      githubConnectionModel,
      googleConnectionModel,
      mongodbConnectionModel,
      awsConnectionModel,
      integrationModel,
    );
  }

  /**
   * Execute GraphQL query
   */
  private async executeGraphQL(
    connectionId: string,
    query: string,
    variables?: any,
  ): Promise<any> {
    const data = await this.makeRequest(connectionId, 'POST', LINEAR_API_BASE, {
      body: {
        query,
        variables,
      },
      timeout: 300000, // 5 minutes
    });

    if (data.errors) {
      throw new Error(`GraphQL Error: ${JSON.stringify(data.errors)}`);
    }

    return data.data;
  }

  onModuleInit() {
    this.registerTools();
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
        { requiredScopes: ['read'] },
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
      },
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
        { requiredScopes: ['read'] },
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
      },
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
        { requiredScopes: ['read'] },
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
      },
    );

    // Get issue
    this.registerTool(
      createToolSchema(
        'linear_get_issue',
        'linear',
        'Get details of a specific issue',
        'GET',
        [createParameter('issueId', 'string', 'Issue ID', { required: true })],
        { requiredScopes: ['read'] },
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
      },
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
          createParameter('priority', 'number', 'Priority (0-4)', {
            required: false,
          }),
          createParameter('assigneeId', 'string', 'Assignee user ID', {
            required: false,
          }),
        ],
        { requiredScopes: ['write'] },
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
      },
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
          CommonParameters.title,
          CommonParameters.description,
          createParameter('priority', 'number', 'New priority (0-4)', {
            required: false,
          }),
          createParameter('stateId', 'string', 'New state ID', {
            required: false,
          }),
        ],
        { requiredScopes: ['write'] },
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
      },
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
        },
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
      },
    );
  }
}
