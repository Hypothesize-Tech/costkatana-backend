/**
 * GitHub MCP Service
 * Full CRUD operations for GitHub integration
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
import { VercelConnection } from '@/schemas/integration/vercel-connection.schema';
import { GitHubConnection } from '@/schemas/integration/github-connection.schema';
import { GoogleConnection } from '@/schemas/integration/google-connection.schema';
import { MongoDBConnection } from '@/schemas/integration/mongodb-connection.schema';
import { AWSConnection } from '@/schemas/integration/aws-connection.schema';
import { Integration } from '@/schemas/integration/integration.schema';

const GITHUB_API_BASE = 'https://api.github.com';

@Injectable()
export class GitHubMcpService
  extends BaseIntegrationService
  implements OnModuleInit
{
  protected integration: 'github' = 'github';
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
    @InjectModel(AWSConnection.name)
    awsConnectionModel: Model<AWSConnection>,
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

  onModuleInit() {
    this.registerTools();
  }

  registerTools(): void {
    // ===== REPOSITORY OPERATIONS =====

    // List repositories
    this.registerTool(
      createToolSchema(
        'github_list_repos',
        'github',
        'List user repositories',
        'GET',
        [
          createParameter('type', 'string', 'Type of repositories to list', {
            required: false,
            enum: ['all', 'owner', 'public', 'private', 'member'],
            default: 'all',
          }),
          createParameter('sort', 'string', 'Sort order', {
            required: false,
            enum: ['created', 'updated', 'pushed', 'full_name'],
            default: 'updated',
          }),
          createParameter('direction', 'string', 'Sort direction', {
            required: false,
            enum: ['asc', 'desc'],
            default: 'desc',
          }),
          CommonParameters.limit,
        ],
        { requiredScopes: ['repo'] },
      ),
      async (params, context) => {
        const queryParams: any = {
          type: params.type || 'all',
          sort: params.sort || 'updated',
          direction: params.direction || 'desc',
          per_page: Math.min(params.limit || 30, 100), // GitHub max is 100
        };

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${GITHUB_API_BASE}/user/repos`,
          { params: queryParams, timeout: 30000 },
        );

        return {
          repositories: data || [],
          count: data?.length || 0,
        };
      },
    );

    // Get repository
    this.registerTool(
      createToolSchema(
        'github_get_repo',
        'github',
        'Get repository details',
        'GET',
        [
          createParameter('owner', 'string', 'Repository owner', {
            required: true,
          }),
          createParameter('repo', 'string', 'Repository name', {
            required: true,
          }),
        ],
        { requiredScopes: ['repo'] },
      ),
      async (params, context) => {
        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}`,
          { timeout: 30000 },
        );

        return data;
      },
    );

    // Create repository
    this.registerTool(
      createToolSchema(
        'github_create_repo',
        'github',
        'Create a new repository',
        'POST',
        [
          createParameter('name', 'string', 'Repository name', {
            required: true,
          }),
          createParameter('description', 'string', 'Repository description', {
            required: false,
          }),
          createParameter(
            'private',
            'boolean',
            'Whether the repository is private',
            {
              required: false,
              default: false,
            },
          ),
          createParameter('auto_init', 'boolean', 'Initialize with README', {
            required: false,
            default: true,
          }),
        ],
        { requiredScopes: ['repo'] },
      ),
      async (params, context) => {
        const body = {
          name: params.name,
          description: params.description,
          private: params.private || false,
          auto_init: params.auto_init !== false,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${GITHUB_API_BASE}/user/repos`,
          { body, timeout: 30000 },
        );

        return data;
      },
    );

    // ===== ISSUE OPERATIONS =====

    // List issues
    this.registerTool(
      createToolSchema(
        'github_list_issues',
        'github',
        'List repository issues',
        'GET',
        [
          createParameter('owner', 'string', 'Repository owner', {
            required: true,
          }),
          createParameter('repo', 'string', 'Repository name', {
            required: true,
          }),
          createParameter('state', 'string', 'Issue state', {
            required: false,
            enum: ['open', 'closed', 'all'],
            default: 'open',
          }),
          createParameter('labels', 'string', 'Comma-separated labels', {
            required: false,
          }),
          CommonParameters.limit,
        ],
        { requiredScopes: ['issues'] },
      ),
      async (params, context) => {
        const queryParams: any = {
          state: params.state || 'open',
          per_page: Math.min(params.limit || 30, 100),
        };

        if (params.labels) {
          queryParams.labels = params.labels;
        }

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/issues`,
          { params: queryParams, timeout: 30000 },
        );

        return {
          issues: data || [],
          count: data?.length || 0,
        };
      },
    );

    // Get issue
    this.registerTool(
      createToolSchema(
        'github_get_issue',
        'github',
        'Get issue details',
        'GET',
        [
          createParameter('owner', 'string', 'Repository owner', {
            required: true,
          }),
          createParameter('repo', 'string', 'Repository name', {
            required: true,
          }),
          createParameter('issue_number', 'number', 'Issue number', {
            required: true,
          }),
        ],
        { requiredScopes: ['issues'] },
      ),
      async (params, context) => {
        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/issues/${params.issue_number}`,
          { timeout: 30000 },
        );

        return data;
      },
    );

    // Create issue
    this.registerTool(
      createToolSchema(
        'github_create_issue',
        'github',
        'Create a new issue',
        'POST',
        [
          createParameter('owner', 'string', 'Repository owner', {
            required: true,
          }),
          createParameter('repo', 'string', 'Repository name', {
            required: true,
          }),
          createParameter('title', 'string', 'Issue title', { required: true }),
          createParameter('body', 'string', 'Issue body', { required: false }),
          createParameter('labels', 'array', 'Issue labels', {
            required: false,
          }),
          createParameter('assignees', 'array', 'Issue assignees', {
            required: false,
          }),
        ],
        { requiredScopes: ['issues'] },
      ),
      async (params, context) => {
        const body: any = {
          title: params.title,
        };

        if (params.body) body.body = params.body;
        if (params.labels) body.labels = params.labels;
        if (params.assignees) body.assignees = params.assignees;

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/issues`,
          { body, timeout: 30000 },
        );

        return data;
      },
    );

    // Update issue
    this.registerTool(
      createToolSchema(
        'github_update_issue',
        'github',
        'Update an issue',
        'PATCH',
        [
          createParameter('owner', 'string', 'Repository owner', {
            required: true,
          }),
          createParameter('repo', 'string', 'Repository name', {
            required: true,
          }),
          createParameter('issue_number', 'number', 'Issue number', {
            required: true,
          }),
          createParameter('title', 'string', 'Issue title', {
            required: false,
          }),
          createParameter('body', 'string', 'Issue body', { required: false }),
          createParameter('state', 'string', 'Issue state', {
            required: false,
            enum: ['open', 'closed'],
          }),
          createParameter('labels', 'array', 'Issue labels', {
            required: false,
          }),
          createParameter('assignees', 'array', 'Issue assignees', {
            required: false,
          }),
        ],
        { requiredScopes: ['issues'] },
      ),
      async (params, context) => {
        const { owner, repo, issue_number, ...updates } = params;

        const data = await this.makeRequest(
          context.connectionId,
          'PATCH',
          `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${issue_number}`,
          { body: updates, timeout: 30000 },
        );

        return data;
      },
    );

    // ===== PULL REQUEST OPERATIONS =====

    // List pull requests
    this.registerTool(
      createToolSchema(
        'github_list_prs',
        'github',
        'List repository pull requests',
        'GET',
        [
          createParameter('owner', 'string', 'Repository owner', {
            required: true,
          }),
          createParameter('repo', 'string', 'Repository name', {
            required: true,
          }),
          createParameter('state', 'string', 'PR state', {
            required: false,
            enum: ['open', 'closed', 'all'],
            default: 'open',
          }),
          CommonParameters.limit,
        ],
        { requiredScopes: ['pull_requests'] },
      ),
      async (params, context) => {
        const queryParams: any = {
          state: params.state || 'open',
          per_page: Math.min(params.limit || 30, 100),
        };

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/pulls`,
          { params: queryParams, timeout: 30000 },
        );

        return {
          pull_requests: data || [],
          count: data?.length || 0,
        };
      },
    );

    // Create pull request
    this.registerTool(
      createToolSchema(
        'github_create_pr',
        'github',
        'Create a new pull request',
        'POST',
        [
          createParameter('owner', 'string', 'Repository owner', {
            required: true,
          }),
          createParameter('repo', 'string', 'Repository name', {
            required: true,
          }),
          createParameter('title', 'string', 'PR title', { required: true }),
          createParameter('head', 'string', 'Head branch', { required: true }),
          createParameter('base', 'string', 'Base branch', { required: true }),
          createParameter('body', 'string', 'PR body', { required: false }),
          createParameter('draft', 'boolean', 'Whether PR is draft', {
            required: false,
            default: false,
          }),
        ],
        { requiredScopes: ['pull_requests'] },
      ),
      async (params, context) => {
        const body: any = {
          title: params.title,
          head: params.head,
          base: params.base,
          draft: params.draft || false,
        };

        if (params.body) body.body = params.body;

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/pulls`,
          { body, timeout: 30000 },
        );

        return data;
      },
    );

    // Update pull request
    this.registerTool(
      createToolSchema(
        'github_update_pr',
        'github',
        'Update a pull request',
        'PATCH',
        [
          createParameter('owner', 'string', 'Repository owner', {
            required: true,
          }),
          createParameter('repo', 'string', 'Repository name', {
            required: true,
          }),
          createParameter('pull_number', 'number', 'PR number', {
            required: true,
          }),
          createParameter('title', 'string', 'PR title', { required: false }),
          createParameter('body', 'string', 'PR body', { required: false }),
          createParameter('state', 'string', 'PR state', {
            required: false,
            enum: ['open', 'closed'],
          }),
        ],
        { requiredScopes: ['pull_requests'] },
      ),
      async (params, context) => {
        const { owner, repo, pull_number, ...updates } = params;

        const data = await this.makeRequest(
          context.connectionId,
          'PATCH',
          `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${pull_number}`,
          { body: updates, timeout: 30000 },
        );

        return data;
      },
    );

    // ===== BRANCH OPERATIONS =====

    // List branches
    this.registerTool(
      createToolSchema(
        'github_list_branches',
        'github',
        'List repository branches',
        'GET',
        [
          createParameter('owner', 'string', 'Repository owner', {
            required: true,
          }),
          createParameter('repo', 'string', 'Repository name', {
            required: true,
          }),
          CommonParameters.limit,
        ],
        { requiredScopes: ['repo'] },
      ),
      async (params, context) => {
        const queryParams: any = {
          per_page: Math.min(params.limit || 30, 100),
        };

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/branches`,
          { params: queryParams, timeout: 30000 },
        );

        return {
          branches: data || [],
          count: data?.length || 0,
        };
      },
    );

    // Create branch
    this.registerTool(
      createToolSchema(
        'github_create_branch',
        'github',
        'Create a new branch',
        'POST',
        [
          createParameter('owner', 'string', 'Repository owner', {
            required: true,
          }),
          createParameter('repo', 'string', 'Repository name', {
            required: true,
          }),
          createParameter('branch', 'string', 'New branch name', {
            required: true,
          }),
          createParameter('sha', 'string', 'SHA to branch from', {
            required: true,
          }),
        ],
        { requiredScopes: ['repo'] },
      ),
      async (params, context) => {
        const body = {
          ref: `refs/heads/${params.branch}`,
          sha: params.sha,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/git/refs`,
          { body, timeout: 30000 },
        );

        return data;
      },
    );

    // Delete branch
    this.registerTool(
      createToolSchema(
        'github_delete_branch',
        'github',
        'Delete a branch',
        'DELETE',
        [
          createParameter('owner', 'string', 'Repository owner', {
            required: true,
          }),
          createParameter('repo', 'string', 'Repository name', {
            required: true,
          }),
          createParameter('branch', 'string', 'Branch name', {
            required: true,
          }),
        ],
        {
          requiredScopes: ['repo:delete'],
          dangerous: true,
        },
      ),
      async (params, context) => {
        await this.makeRequest(
          context.connectionId,
          'DELETE',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repo}/git/refs/heads/${params.branch}`,
          { timeout: 30000 },
        );

        return {
          success: true,
          message: `Branch ${params.branch} deleted successfully`,
        };
      },
    );
  }

  /**
   * Create or update a file in a repository (GitHub Contents API).
   * Used by governed agent / file-by-file code generator.
   *
   * @param params.owner - Repository owner (use 'auto-detected' to resolve from user's connection)
   * @param params.repo - Repository name
   * @param params.path - File path in the repository
   * @param params.content - Raw file content (will be base64-encoded for API)
   * @param params.commitMessage - Commit message
   * @param params.userId - User ID (used to resolve GitHub connection and token)
   * @returns Commit URL and optional commit SHA
   */
  async createOrUpdateFile(params: {
    owner: string;
    repo: string;
    path: string;
    content: string;
    commitMessage: string;
    userId: string;
  }): Promise<{ commitUrl?: string; sha?: string }> {
    const { userId, path, content, commitMessage } = params;
    let owner = params.owner;
    const repo = params.repo;

    const connection = await this.githubConnectionModel
      .findOne({ userId, isActive: true })
      .select('_id githubUsername')
      .lean();

    if (!connection) {
      throw new Error(
        `No active GitHub connection found for user ${userId}. Please connect GitHub first.`,
      );
    }

    const connectionId = (connection as { _id: unknown })._id?.toString();
    if (!connectionId) {
      throw new Error('Invalid GitHub connection');
    }

    if (owner === 'auto-detected' || !owner.trim()) {
      const username = (connection as { githubUsername?: string })
        .githubUsername;
      if (!username) {
        throw new Error(
          'Repository owner could not be resolved. Ensure GitHub connection has githubUsername set.',
        );
      }
      owner = username;
    }

    const contentBase64 = Buffer.from(content, 'utf8').toString('base64');
    let existingSha: string | undefined;

    try {
      const existing = await this.makeRequest(
        connectionId,
        'GET',
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
        { timeout: 15000 },
      );
      if (existing?.sha) {
        existingSha = existing.sha;
      }
    } catch {
      // File does not exist; create new
    }

    const body: Record<string, string> = {
      message: commitMessage,
      content: contentBase64,
    };
    if (existingSha) {
      body.sha = existingSha;
    }

    const result = await this.makeRequest(
      connectionId,
      'PUT',
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
      { body, timeout: 30000 },
    );

    const commitSha = result?.commit?.sha;
    const commitUrl = commitSha
      ? `https://github.com/${owner}/${repo}/commit/${commitSha}`
      : undefined;

    return { commitUrl, sha: commitSha };
  }
}
