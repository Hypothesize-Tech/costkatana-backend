import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHmac, timingSafeEqual } from 'crypto';
import { sign } from 'jsonwebtoken';

import {
  GitHubConnection,
  GitHubConnectionDocument,
} from '../../schemas/integration/github-connection.schema';
import {
  OAuthTokenResponse,
  GitHubUser,
  RepositoryContent,
  CreateBranchOptions,
  CreateFileOptions,
  CreatePROptions,
  UpdatePROptions,
} from './interfaces/github.interfaces';
import {
  GitHubAuthError,
  GitHubRepositoryError,
  GitHubConfigurationError,
  fromGitHubError,
} from './utils/github-errors';

@Injectable()
export class GitHubService {
  private readonly logger = new Logger(GitHubService.name);
  private octokit: any = null;
  private _rateLimitRemaining = 5000;
  private _rateLimitReset = 0;

  constructor(
    private configService: ConfigService,
    @InjectModel(GitHubConnection.name)
    private gitHubConnectionModel: Model<GitHubConnectionDocument>,
  ) {}

  async initialize(): Promise<void> {
    try {
      // Dynamic import to avoid issues in environments without @octokit/rest
      const { Octokit } = await import('@octokit/rest');
      this.octokit = Octokit;
      this.logger.log('GitHub Octokit initialized');
    } catch (error) {
      this.logger.error('Failed to initialize GitHub Octokit', error);
      throw new GitHubConfigurationError('Failed to initialize GitHub client');
    }
  }

  async createOctokitFromToken(accessToken: string): Promise<any> {
    if (!this.octokit) {
      await this.initialize();
    }

    return new this.octokit({
      auth: accessToken,
      userAgent: 'CostKatana/1.0.0',
    });
  }

  async createOctokitFromApp(installationId: string): Promise<any> {
    if (!this.octokit) {
      await this.initialize();
    }

    const appId = this.configService.get<string>('GITHUB_APP_ID');
    const privateKey = this.configService.get<string>('GITHUB_APP_PRIVATE_KEY');

    if (!appId || !privateKey) {
      throw new GitHubConfigurationError(
        'GitHub App credentials not configured',
      );
    }

    // Create JWT for app authentication
    const jwt = this.createJWT(appId, privateKey);

    // Create app client
    const appClient = new this.octokit({
      auth: jwt,
      userAgent: 'CostKatana/1.0.0',
    });

    try {
      // Get installation token
      const { data } = await appClient.apps.createInstallationAccessToken({
        installation_id: parseInt(installationId),
      });

      return new this.octokit({
        auth: data.token,
        userAgent: 'CostKatana/1.0.0',
      });
    } catch (error) {
      this.logger.error('Failed to create installation token', error);
      throw fromGitHubError(error);
    }
  }

  createJWT(appId: string, privateKey: string): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now,
      exp: now + 10 * 60, // 10 minutes
      iss: appId,
    };

    return sign(payload, privateKey, {
      algorithm: 'RS256',
    });
  }

  async getOctokitFromConnection(
    connection: GitHubConnectionDocument,
  ): Promise<any> {
    try {
      // Check if token needs refresh (OAuth tokens expire)
      if (connection.tokenType === 'oauth' && connection.expiresAt) {
        const now = new Date();
        const expiresAt = new Date(connection.expiresAt);
        const timeToExpiry = expiresAt.getTime() - now.getTime();

        // Refresh if expiring within 5 minutes
        if (timeToExpiry < 5 * 60 * 1000) {
          await this.refreshAccessToken(connection);
        }
      }

      if (connection.tokenType === 'app' && connection.installationId) {
        return await this.createOctokitFromApp(connection.installationId);
      } else {
        const token = connection.decryptToken();
        return await this.createOctokitFromToken(token);
      }
    } catch (error) {
      this.logger.error('Failed to create Octokit from connection', error);
      throw fromGitHubError(error);
    }
  }

  async refreshAccessToken(
    connection: GitHubConnectionDocument,
  ): Promise<string | null> {
    const clientId = this.configService.get<string>('GITHUB_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GITHUB_CLIENT_SECRET');

    if (!clientId || !clientSecret || !connection.refreshToken) {
      return null;
    }

    try {
      const refreshToken = connection.decryptRefreshToken();
      if (!refreshToken) {
        return null;
      }

      const response = await fetch(
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const data: OAuthTokenResponse = await response.json();

      // Update connection with new tokens
      connection.accessToken = connection.encryptToken(data.access_token);
      if (data.refresh_token) {
        connection.refreshToken = connection.encryptToken(data.refresh_token);
      }
      if (data.expires_in) {
        connection.expiresAt = new Date(Date.now() + data.expires_in * 1000);
      }

      await connection.save();
      this.logger.log(`Refreshed OAuth token for user ${connection.userId}`);

      return data.access_token;
    } catch (error) {
      this.logger.error('Failed to refresh access token', error);
      return null;
    }
  }

  async exchangeCodeForToken(code: string): Promise<OAuthTokenResponse> {
    const clientId = this.configService.get<string>('GITHUB_CLIENT_ID');
    const clientSecret = this.configService.get<string>('GITHUB_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new GitHubConfigurationError(
        'GitHub OAuth credentials not configured',
      );
    }

    try {
      const response = await fetch(
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: code,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Code exchange failed: ${response.status}`);
      }

      const data: OAuthTokenResponse = await response.json();

      if (data.error) {
        throw new GitHubAuthError(data.error_description || data.error);
      }

      return data;
    } catch (error) {
      this.logger.error('Failed to exchange code for token', error);
      throw fromGitHubError(error);
    }
  }

  async getAuthenticatedUser(accessToken: string): Promise<GitHubUser> {
    try {
      const octokit = await this.createOctokitFromToken(accessToken);
      const { data } = await octokit.users.getAuthenticated();

      return {
        id: data.id,
        login: data.login,
        avatar_url: data.avatar_url,
        name: data.name,
        email: data.email,
      };
    } catch (error) {
      this.logger.error('Failed to get authenticated user', error);
      throw fromGitHubError(error);
    }
  }

  async listUserRepositories(
    connection: GitHubConnectionDocument,
  ): Promise<any[]> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);
      const { data } = await octokit.repos.listForAuthenticatedUser({
        sort: 'updated',
        per_page: 100,
      });

      return data.map(
        (repo: {
          id: number;
          name: string;
          full_name: string;
          private: boolean;
          default_branch: string;
          description: string | null;
          language: string | null;
          html_url: string;
          created_at: string;
          updated_at: string;
        }) => ({
          id: repo.id,
          name: repo.name,
          fullName: repo.full_name,
          private: repo.private,
          defaultBranch: repo.default_branch,
          description: repo.description,
          language: repo.language,
          url: repo.html_url,
          createdAt: repo.created_at,
          updatedAt: repo.updated_at,
        }),
      );
    } catch (error) {
      this.logger.error('Failed to list user repositories', error);
      throw fromGitHubError(error);
    }
  }

  async getRepository(
    connection: GitHubConnectionDocument,
    owner: string,
    repo: string,
  ): Promise<any> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);
      const { data } = await octokit.repos.get({ owner, repo });
      return data;
    } catch (error) {
      this.logger.error(`Failed to get repository ${owner}/${repo}`, error);
      throw fromGitHubError(error);
    }
  }

  async getFileContent(
    connection: GitHubConnectionDocument,
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      if (data.type !== 'file') {
        throw new GitHubRepositoryError('Path is not a file');
      }

      if (data.encoding !== 'base64') {
        throw new GitHubRepositoryError('Unsupported file encoding');
      }

      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch (error) {
      this.logger.error(
        `Failed to get file content ${owner}/${repo}/${path}`,
        error,
      );
      throw fromGitHubError(error);
    }
  }

  async listDirectoryContents(
    connection: GitHubConnectionDocument,
    owner: string,
    repo: string,
    path = '',
    ref?: string,
  ): Promise<RepositoryContent[]> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      return data.map(
        (item: {
          name: string;
          path: string;
          sha: string;
          size: number;
          url: string;
          html_url: string;
          git_url: string;
          download_url: string | null;
          type: string;
          content?: string;
          encoding?: string;
        }) => ({
          name: item.name,
          path: item.path,
          sha: item.sha,
          size: item.size,
          url: item.url,
          html_url: item.html_url,
          git_url: item.git_url,
          download_url: item.download_url,
          type: item.type as 'file' | 'dir' | 'symlink' | 'submodule',
          content: item.content,
          encoding: item.encoding,
        }),
      );
    } catch (error) {
      this.logger.error(
        `Failed to list directory contents ${owner}/${repo}/${path}`,
        error,
      );
      throw fromGitHubError(error);
    }
  }

  async getAllRepositoryFiles(
    connection: GitHubConnectionDocument,
    owner: string,
    repo: string,
    ref?: string,
    maxFiles = 5000,
  ): Promise<any[]> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);
      const files: any[] = [];

      const processDirectory = async (path = '') => {
        if (files.length >= maxFiles) return;

        const contents = await this.listDirectoryContents(
          connection,
          owner,
          repo,
          path,
          ref,
        );

        for (const item of contents) {
          if (files.length >= maxFiles) break;

          if (item.type === 'file') {
            // Check if file should be excluded
            if (!this.shouldExcludeFile(item.path)) {
              files.push(item);
            }
          } else if (item.type === 'dir') {
            // Recursively process subdirectories
            await processDirectory(item.path);
          }
        }
      };

      await processDirectory();
      return files;
    } catch (error) {
      this.logger.error(
        `Failed to get all repository files ${owner}/${repo}`,
        error,
      );
      throw fromGitHubError(error);
    }
  }

  async createBranch(
    connection: GitHubConnectionDocument,
    options: CreateBranchOptions,
  ): Promise<string> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);
      const { data: baseBranch } = await octokit.repos.getBranch({
        owner: options.owner,
        repo: options.repo,
        branch: options.baseBranch,
      });

      const { data: newBranch } = await octokit.git.createRef({
        owner: options.owner,
        repo: options.repo,
        ref: `refs/heads/${options.branchName}`,
        sha: baseBranch.commit.sha,
      });

      return newBranch.ref;
    } catch (error) {
      this.logger.error(`Failed to create branch ${options.branchName}`, error);
      throw fromGitHubError(error);
    }
  }

  async createOrUpdateFile(
    connection: GitHubConnectionDocument,
    options: CreateFileOptions,
  ): Promise<{ sha: string; commit: any }> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);

      const content = Buffer.from(options.content).toString('base64');

      const { data } = await octokit.repos.createOrUpdateFileContents({
        owner: options.owner,
        repo: options.repo,
        path: options.path,
        message: options.message,
        content,
        branch: options.branch,
      });

      return {
        sha: data.content.sha,
        commit: data.commit,
      };
    } catch (error) {
      this.logger.error(`Failed to create/update file ${options.path}`, error);
      throw fromGitHubError(error);
    }
  }

  async createPullRequest(
    connection: GitHubConnectionDocument,
    options: CreatePROptions,
  ): Promise<{ number: number; url: string; html_url: string }> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);

      const { data } = await octokit.pulls.create({
        owner: options.owner,
        repo: options.repo,
        title: options.title,
        head: options.head,
        base: options.base,
        body: options.body,
        draft: options.draft,
      });

      return {
        number: data.number,
        url: data.url,
        html_url: data.html_url,
      };
    } catch (error) {
      this.logger.error(`Failed to create pull request`, error);
      throw fromGitHubError(error);
    }
  }

  async updatePullRequest(
    connection: GitHubConnectionDocument,
    options: UpdatePROptions,
  ): Promise<void> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);

      await octokit.pulls.update({
        owner: options.owner,
        repo: options.repo,
        pull_number: options.pull_number,
        title: options.title,
        body: options.body,
        state: options.state,
      });
    } catch (error) {
      this.logger.error(
        `Failed to update pull request ${options.pull_number}`,
        error,
      );
      throw fromGitHubError(error);
    }
  }

  async addPRComment(
    connection: GitHubConnectionDocument,
    owner: string,
    repo: string,
    pull_number: number,
    body: string,
  ): Promise<void> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);

      await octokit.issues.createComment({
        owner,
        repo,
        issue_number: pull_number,
        body,
      });
    } catch (error) {
      this.logger.error(`Failed to add PR comment`, error);
      throw fromGitHubError(error);
    }
  }

  async getPullRequest(
    connection: GitHubConnectionDocument,
    owner: string,
    repo: string,
    pull_number: number,
  ): Promise<any> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);

      const { data } = await octokit.pulls.get({
        owner,
        repo,
        pull_number,
      });

      return data;
    } catch (error) {
      this.logger.error(`Failed to get pull request ${pull_number}`, error);
      throw fromGitHubError(error);
    }
  }

  async listRepositoryIssues(
    connection: GitHubConnectionDocument,
    owner: string,
    repo: string,
    options?: { state?: 'open' | 'closed' | 'all'; per_page?: number },
  ): Promise<Array<{ number: number; title: string; state: string; html_url: string; created_at: string; updated_at: string }>> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);
      const { data } = await octokit.issues.listForRepo({
        owner,
        repo,
        state: options?.state ?? 'open',
        per_page: options?.per_page ?? 50,
      });
      return data.map((issue: any) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        html_url: issue.html_url,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to list issues ${owner}/${repo}`,
        error,
      );
      throw fromGitHubError(error);
    }
  }

  async listRepositoryBranches(
    connection: GitHubConnectionDocument,
    owner: string,
    repo: string,
    options?: { per_page?: number },
  ): Promise<Array<{ name: string; protected: boolean; sha: string }>> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);
      const { data } = await octokit.repos.listBranches({
        owner,
        repo,
        per_page: options?.per_page ?? 50,
      });
      return data.map((branch: any) => ({
        name: branch.name,
        protected: branch.protected,
        sha: branch.commit?.sha ?? '',
      }));
    } catch (error) {
      this.logger.error(
        `Failed to list branches ${owner}/${repo}`,
        error,
      );
      throw fromGitHubError(error);
    }
  }

  async listRepositoryPullRequests(
    connection: GitHubConnectionDocument,
    owner: string,
    repo: string,
    options?: { state?: 'open' | 'closed' | 'all'; per_page?: number },
  ): Promise<
    Array<{
      number: number;
      title: string;
      state: string;
      html_url: string;
      created_at: string;
      updated_at: string;
    }>
  > {
    try {
      const octokit = await this.getOctokitFromConnection(connection);
      const { data } = await octokit.pulls.list({
        owner,
        repo,
        state: options?.state ?? 'open',
        per_page: options?.per_page ?? 50,
      });
      return data.map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        html_url: pr.html_url,
        created_at: pr.created_at,
        updated_at: pr.updated_at,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to list pull requests ${owner}/${repo}`,
        error,
      );
      throw fromGitHubError(error);
    }
  }

  async createIssue(
    connection: GitHubConnectionDocument,
    owner: string,
    repo: string,
    title: string,
    body?: string,
  ): Promise<{ number: number; html_url: string; title: string }> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);
      const { data } = await octokit.issues.create({
        owner,
        repo,
        title,
        body: body ?? '',
      });
      return {
        number: data.number,
        html_url: data.html_url ?? '',
        title: data.title ?? '',
      };
    } catch (error) {
      this.logger.error(
        `Failed to create issue ${owner}/${repo}`,
        error,
      );
      throw fromGitHubError(error);
    }
  }

  async getIssue(
    connection: GitHubConnectionDocument,
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<{
    number: number;
    title: string;
    state: string;
    html_url: string;
    body: string | null;
  } | null> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);
      const { data } = await octokit.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });
      return {
        number: data.number,
        title: data.title ?? '',
        state: data.state ?? 'open',
        html_url: data.html_url ?? '',
        body: data.body ?? null,
      };
    } catch (error: unknown) {
      const err = error as { status?: number; response?: { status?: number } };
      if (err?.status === 404 || err?.response?.status === 404) {
        return null;
      }
      this.logger.error(
        `Failed to get issue ${owner}/${repo}#${issueNumber}`,
        error,
      );
      throw fromGitHubError(error);
    }
  }

  async getInstallation(installationId: string): Promise<any> {
    try {
      const appId = this.configService.get<string>('GITHUB_APP_ID');
      const privateKey = this.configService.get<string>(
        'GITHUB_APP_PRIVATE_KEY',
      );

      if (!appId || !privateKey) {
        throw new GitHubConfigurationError(
          'GitHub App credentials not configured',
        );
      }

      const jwt = this.createJWT(appId, privateKey);
      const octokit = new this.octokit({
        auth: jwt,
        userAgent: 'CostKatana/1.0.0',
      });

      const { data } = await octokit.apps.getInstallation({
        installation_id: parseInt(installationId),
      });

      return data;
    } catch (error) {
      this.logger.error(`Failed to get installation ${installationId}`, error);
      throw fromGitHubError(error);
    }
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const secret = this.configService.get<string>('GITHUB_WEBHOOK_SECRET');

    if (!secret || !signature) {
      return false;
    }

    try {
      const expectedSignature = createHmac('sha256', secret)
        .update(payload, 'utf8')
        .digest('hex');

      const signatureParts = signature.split('=');
      if (signatureParts.length !== 2 || signatureParts[0] !== 'sha256') {
        return false;
      }

      const providedSignature = signatureParts[1];
      return timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(providedSignature, 'hex'),
      );
    } catch (error) {
      this.logger.error('Failed to verify webhook signature', error);
      return false;
    }
  }

  private shouldExcludeFile(filePath: string): boolean {
    const excludePatterns = [
      'node_modules/**',
      '__pycache__/**',
      '.venv/**',
      'venv/**',
      'env/**',
      '.env',
      '.env.local',
      '.env.development',
      '.env.test',
      '.env.production',
      'dist/**',
      'build/**',
      '.git/**',
      'coverage/**',
      '.next/**',
      '.nuxt/**',
      '.cache/**',
      '.pytest_cache/**',
      '.mypy_cache/**',
      '.tox/**',
      'target/**',
      'out/**',
      '.idea/**',
      '.vscode/**',
      '*.min.js',
      '*.bundle.js',
      '*.chunk.js',
    ];

    return excludePatterns.some((pattern) => {
      if (pattern.includes('**')) {
        const regexPattern = pattern
          .replace(/\*\*/g, '.*')
          .replace(/\*/g, '[^/]*')
          .replace(/\./g, '\\.');
        return new RegExp(`^${regexPattern}$`).test(filePath);
      }
      return filePath === pattern || filePath.endsWith(pattern);
    });
  }
}
