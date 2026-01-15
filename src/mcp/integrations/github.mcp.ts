/**
 * GitHub MCP Server
 * Full CRUD operations for GitHub integration
 */

import { BaseIntegrationMCP } from './base-integration.mcp';
import { createToolSchema, createParameter, CommonParameters } from '../registry/tool-metadata';

const GITHUB_API_BASE = 'https://api.github.com';

export class GitHubMCP extends BaseIntegrationMCP {
  constructor() {
    super('github', '1.0.0');
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
          createParameter('type', 'string', 'Repository type (all, owner, member)', {
            required: false,
            enum: ['all', 'owner', 'member'],
            default: 'all',
          }),
          createParameter('sort', 'string', 'Sort by (created, updated, pushed, full_name)', {
            required: false,
            enum: ['created', 'updated', 'pushed', 'full_name'],
            default: 'updated',
          }),
          createParameter('visibility', 'string', 'Repository visibility (all, public, private)', {
            required: false,
            enum: ['all', 'public', 'private'],
            default: 'all',
          }),
          CommonParameters.limit,
        ],
        { requiredScopes: ['repo'] }
      ),
      async (params, context) => {
        const queryParams: any = {
          type: params.type || 'all',
          sort: params.sort || 'updated',
          per_page: params.limit || 30, // Default to 30 repos
          direction: 'desc', // Most recent first
        };

        // Only add visibility if explicitly set (not all APIs support it)
        if (params.visibility && params.visibility !== 'all') {
          queryParams.visibility = params.visibility;
        }

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${GITHUB_API_BASE}/user/repos`,
          { params: queryParams, timeout: 300000 } // 5 minute timeout for listing repos
        );

        return {
          repositories: data.map((repo: any) => ({
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            owner: repo.owner.login,
            private: repo.private,
            description: repo.description,
            url: repo.html_url,
            created_at: repo.created_at,
            updated_at: repo.updated_at,
            pushed_at: repo.pushed_at,
            size: repo.size,
            stargazers_count: repo.stargazers_count,
            language: repo.language,
            default_branch: repo.default_branch,
          })),
          count: data.length,
          total: data.length,
        };
      }
    );

    // Create repository
    this.registerTool(
      createToolSchema(
        'github_create_repo',
        'github',
        'Create a new repository',
        'POST',
        [
          createParameter('name', 'string', 'Repository name', { required: true }),
          CommonParameters.description,
          createParameter('private', 'boolean', 'Make repository private', { default: false }),
          createParameter('autoInit', 'boolean', 'Initialize with README', { default: false }),
        ],
        { requiredScopes: ['repo'] }
      ),
      async (params, context) => {
        const body: any = {
          name: params.name,
          private: params.private || false,
          auto_init: params.autoInit || false,
        };

        if (params.description) {
          body.description = params.description;
        }

        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${GITHUB_API_BASE}/user/repos`,
          { body, timeout: 300000 }
        );

        return data;
      }
    );

    // ===== ISSUE OPERATIONS =====

    // List issues
    this.registerTool(
      createToolSchema(
        'github_list_issues',
        'github',
        'List issues in a repository',
        'GET',
        [
          createParameter('owner', 'string', 'Repository owner', { required: true }),
          CommonParameters.repoName,
          CommonParameters.state,
          CommonParameters.limit,
        ],
        { requiredScopes: ['repo'] }
      ),
      async (params, context) => {
        const queryParams: any = {
          state: params.state || 'open',
          per_page: params.limit || 20,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repoName}/issues`,
          { params: queryParams, timeout: 300000 } // 5 minutes
        );

        return {
          issues: data,
          count: data.length,
        };
      }
    );

    // Get issue
    this.registerTool(
      createToolSchema(
        'github_get_issue',
        'github',
        'Get details of a specific issue',
        'GET',
        [
          createParameter('owner', 'string', 'Repository owner', { required: true }),
          CommonParameters.repoName,
          CommonParameters.issueNumber,
        ],
        { requiredScopes: ['repo'] }
      ),
      async (params, context) => {
        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repoName}/issues/${params.issueNumber}`,
          { timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Create issue
    this.registerTool(
      createToolSchema(
        'github_create_issue',
        'github',
        'Create a new issue',
        'POST',
        [
          createParameter('owner', 'string', 'Repository owner', { required: true }),
          CommonParameters.repoName,
          CommonParameters.title,
          createParameter('body', 'string', 'Issue body', { required: false }),
          createParameter('labels', 'array', 'Issue labels', { required: false }),
          createParameter('assignees', 'array', 'Issue assignees', { required: false }),
        ],
        { requiredScopes: ['repo'] }
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
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repoName}/issues`,
          { body, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Update issue
    this.registerTool(
      createToolSchema(
        'github_update_issue',
        'github',
        'Update an existing issue',
        'PATCH',
        [
          createParameter('owner', 'string', 'Repository owner', { required: true }),
          CommonParameters.repoName,
          CommonParameters.issueNumber,
          createParameter('title', 'string', 'New title', { required: false }),
          createParameter('body', 'string', 'New body', { required: false }),
          createParameter('state', 'string', 'Issue state', {
            required: false,
            enum: ['open', 'closed'],
          }),
          createParameter('labels', 'array', 'Issue labels', { required: false }),
        ],
        { requiredScopes: ['repo'] }
      ),
      async (params, context) => {
        const { owner, repoName, issueNumber, ...updates } = params;

        const data = await this.makeRequest(
          context.connectionId,
          'PATCH',
          `${GITHUB_API_BASE}/repos/${owner}/${repoName}/issues/${issueNumber}`,
          { body: updates, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Close issue
    this.registerTool(
      createToolSchema(
        'github_close_issue',
        'github',
        'Close an issue',
        'PATCH',
        [
          createParameter('owner', 'string', 'Repository owner', { required: true }),
          CommonParameters.repoName,
          CommonParameters.issueNumber,
        ],
        { requiredScopes: ['repo'] }
      ),
      async (params, context) => {
        const data = await this.makeRequest(
          context.connectionId,
          'PATCH',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repoName}/issues/${params.issueNumber}`,
          { body: { state: 'closed' }, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // ===== PULL REQUEST OPERATIONS =====

    // List pull requests
    this.registerTool(
      createToolSchema(
        'github_list_prs',
        'github',
        'List pull requests in a repository',
        'GET',
        [
          createParameter('owner', 'string', 'Repository owner', { required: true }),
          CommonParameters.repoName,
          CommonParameters.state,
          CommonParameters.limit,
        ],
        { requiredScopes: ['repo'] }
      ),
      async (params, context) => {
        const queryParams: any = {
          state: params.state || 'open',
          per_page: params.limit || 20,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repoName}/pulls`,
          { params: queryParams, timeout: 300000 } // 5 minutes
        );

        return {
          pullRequests: data,
          count: data.length,
        };
      }
    );

    // Create pull request
    this.registerTool(
      createToolSchema(
        'github_create_pr',
        'github',
        'Create a new pull request',
        'POST',
        [
          createParameter('owner', 'string', 'Repository owner', { required: true }),
          CommonParameters.repoName,
          CommonParameters.title,
          createParameter('head', 'string', 'Branch to merge from', { required: true }),
          createParameter('base', 'string', 'Branch to merge into', { required: true }),
          createParameter('body', 'string', 'PR description', { required: false }),
          createParameter('draft', 'boolean', 'Create as draft PR', { default: false }),
        ],
        { requiredScopes: ['repo'] }
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
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repoName}/pulls`,
          { body, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Update pull request
    this.registerTool(
      createToolSchema(
        'github_update_pr',
        'github',
        'Update an existing pull request',
        'PATCH',
        [
          createParameter('owner', 'string', 'Repository owner', { required: true }),
          CommonParameters.repoName,
          createParameter('pullNumber', 'number', 'Pull request number', { required: true }),
          createParameter('title', 'string', 'New title', { required: false }),
          createParameter('body', 'string', 'New body', { required: false }),
          createParameter('state', 'string', 'PR state', {
            required: false,
            enum: ['open', 'closed'],
          }),
        ],
        { requiredScopes: ['repo'] }
      ),
      async (params, context) => {
        const { owner, repoName, pullNumber, ...updates } = params;

        const data = await this.makeRequest(
          context.connectionId,
          'PATCH',
          `${GITHUB_API_BASE}/repos/${owner}/${repoName}/pulls/${pullNumber}`,
          { body: updates, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // Merge pull request
    this.registerTool(
      createToolSchema(
        'github_merge_pr',
        'github',
        'Merge a pull request',
        'PUT',
        [
          createParameter('owner', 'string', 'Repository owner', { required: true }),
          CommonParameters.repoName,
          createParameter('pullNumber', 'number', 'Pull request number', { required: true }),
          createParameter('commitMessage', 'string', 'Merge commit message', { required: false }),
          createParameter('mergeMethod', 'string', 'Merge method', {
            required: false,
            enum: ['merge', 'squash', 'rebase'],
            default: 'merge',
          }),
        ],
        { requiredScopes: ['repo'] }
      ),
      async (params, context) => {
        const body: any = {
          merge_method: params.mergeMethod || 'merge',
        };

        if (params.commitMessage) {
          body.commit_message = params.commitMessage;
        }

        const data = await this.makeRequest(
          context.connectionId,
          'PUT',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repoName}/pulls/${params.pullNumber}/merge`,
          { body, timeout: 300000 } // 5 minutes
        );

        return data;
      }
    );

    // ===== BRANCH OPERATIONS =====

    // List branches
    this.registerTool(
      createToolSchema(
        'github_list_branches',
        'github',
        'List branches in a repository',
        'GET',
        [
          createParameter('owner', 'string', 'Repository owner', { required: true }),
          CommonParameters.repoName,
          CommonParameters.limit,
        ],
        { requiredScopes: ['repo'] }
      ),
      async (params, context) => {
        const queryParams: any = {
          per_page: params.limit || 20,
        };

        const data = await this.makeRequest(
          context.connectionId,
          'GET',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repoName}/branches`,
          { params: queryParams, timeout: 300000 } // 5 minutes
        );

        return {
          branches: data,
          count: data.length,
        };
      }
    );

    // Create branch
    this.registerTool(
      createToolSchema(
        'github_create_branch',
        'github',
        'Create a new branch',
        'POST',
        [
          createParameter('owner', 'string', 'Repository owner', { required: true }),
          CommonParameters.repoName,
          createParameter('branchName', 'string', 'New branch name', { required: true }),
          createParameter('fromBranch', 'string', 'Source branch', { default: 'main' }),
        ],
        { requiredScopes: ['repo'] }
      ),
      async (params, context) => {
        // First get the SHA of the source branch
        const refData = await this.makeRequest(
          context.connectionId,
          'GET',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repoName}/git/ref/heads/${params.fromBranch || 'main'}`,
          { timeout: 300000 } // 5 minutes
        );

        const sha = refData.object.sha;

        // Create new branch
        const data = await this.makeRequest(
          context.connectionId,
          'POST',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repoName}/git/refs`,
          {
            body: {
              ref: `refs/heads/${params.branchName}`,
              sha,
            },
            timeout: 300000, // 5 minutes
          }
        );

        return data;
      }
    );

    // Delete branch
    this.registerTool(
      createToolSchema(
        'github_delete_branch',
        'github',
        'Delete a branch',
        'DELETE',
        [
          createParameter('owner', 'string', 'Repository owner', { required: true }),
          CommonParameters.repoName,
          createParameter('branchName', 'string', 'Branch name to delete', { required: true }),
        ],
        {
          requiredScopes: ['repo:delete'],
          dangerous: true,
        }
      ),
      async (params, context) => {
        await this.makeRequest(
          context.connectionId,
          'DELETE',
          `${GITHUB_API_BASE}/repos/${params.owner}/${params.repoName}/git/refs/heads/${params.branchName}`,
          { timeout: 300000 } // 5 minutes
        );

        return {
          success: true,
          message: `Branch ${params.branchName} deleted successfully`,
        };
      }
    );
  }
}

// Initialize and register GitHub tools
export function initializeGitHubMCP(): void {
  const githubMCP = new GitHubMCP();
  githubMCP.registerTools();
}
