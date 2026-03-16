import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../common/cache/cache.service';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Dynamic imports for ES modules
let Octokit: any;

export interface GitHubAuthConfig {
  appId?: string;
  privateKey?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

export interface GitHubUser {
  id: number;
  login: string;
  avatar_url: string;
  name?: string;
  email?: string;
}

export interface RepositoryContent {
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  content?: string;
  encoding?: string;
}

export interface CreateBranchOptions {
  owner: string;
  repo: string;
  branchName: string;
  fromBranch?: string;
}

export interface CreateFileOptions {
  owner: string;
  repo: string;
  branch?: string;
  path: string;
  content: string;
  message: string;
}

export interface CreatePROptions {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
}

export interface UpdatePROptions {
  owner: string;
  repo: string;
  prNumber: number;
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
}

@Injectable()
export class GithubOAuthApiService {
  private readonly logger = new Logger(GithubOAuthApiService.name);
  private config: GitHubAuthConfig = {};
  private modulesLoaded = false;
  private initializationPromise: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {
    this.initializeConfig();
  }

  /**
   * Initialize GitHub service configuration
   */
  private initializeConfig(): void {
    this.config = {
      appId: this.configService.get<string>('GITHUB_APP_ID'),
      privateKey: this.configService.get<string>('GITHUB_APP_PRIVATE_KEY')
        ? Buffer.from(
            this.configService.get<string>('GITHUB_APP_PRIVATE_KEY')!,
            'base64',
          ).toString('utf-8')
        : undefined,
      clientId: this.configService.get<string>('GITHUB_CLIENT_ID'),
      clientSecret: this.configService.get<string>('GITHUB_CLIENT_SECRET'),
    };
  }

  /**
   * Initialize GitHub service modules
   */
  async initialize(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = this.loadOctokitModules();
    return this.initializationPromise;
  }

  private async loadOctokitModules(): Promise<void> {
    if (this.modulesLoaded) {
      return;
    }

    try {
      // Use dynamic import() for ES Module compatibility
      const octokitModule = await import('@octokit/rest');
      const { Octokit: OctokitClass } = octokitModule;

      Octokit = OctokitClass;
      this.modulesLoaded = true;
      this.logger.log('Octokit modules loaded successfully via dynamic import');
    } catch (error: any) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;

      this.logger.error('Failed to load Octokit modules', {
        error: errorMessage,
        stack: errorStack,
        name: errorName,
      });
      throw new Error(`Failed to load GitHub API modules: ${errorMessage}`);
    }
  }

  /**
   * Create authenticated Octokit instance from user's access token
   */
  private async createOctokitFromToken(accessToken: string): Promise<any> {
    await this.initialize();
    return new Octokit({
      auth: accessToken,
    });
  }

  /**
   * Create authenticated Octokit instance for GitHub App
   */
  private async createOctokitFromApp(installationId: string): Promise<any> {
    await this.initialize();

    if (!this.config.appId || !this.config.privateKey) {
      throw new Error('GitHub App configuration is missing');
    }

    try {
      // Create JWT token for GitHub App authentication
      const jwt = this.createJWT();

      // Create Octokit instance with app authentication
      const appOctokit = new Octokit({
        auth: jwt,
      });

      // Get installation access token
      const { data: installationData } =
        await appOctokit.rest.apps.createInstallationAccessToken({
          installation_id: parseInt(installationId),
        });

      // Create new Octokit instance with installation access token
      const octokit = new Octokit({
        auth: installationData.token,
      });

      this.logger.log('Created GitHub App Octokit instance', {
        installationId,
        appId: this.config.appId,
      });

      return octokit;
    } catch (error: any) {
      this.logger.error('Failed to create GitHub App Octokit instance', {
        installationId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Create JWT token for GitHub App authentication (consolidated method)
   * Uses jsonwebtoken library for reliability
   */
  private createJWT(): string {
    if (!this.config.appId || !this.config.privateKey) {
      throw new Error('GitHub App configuration is missing');
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60, // Issued at time (1 minute ago to account for clock skew)
      exp: now + 10 * 60, // Expires in 10 minutes
      iss: this.config.appId, // Issuer (App ID)
    };

    return jwt.sign(payload, this.config.privateKey, { algorithm: 'RS256' });
  }

  /**
   * Get Octokit instance from GitHub connection (with auto-refresh)
   */
  private async getOctokitFromConnection(connection: any): Promise<any> {
    try {
      // Check if OAuth token is expired and needs refresh
      if (connection.tokenType === 'oauth' && connection.expiresAt) {
        const now = new Date();
        const expiresAt = new Date(connection.expiresAt);

        // Refresh if expired or expiring in next 5 minutes
        if (expiresAt <= new Date(now.getTime() + 5 * 60 * 1000)) {
          this.logger.log(
            'OAuth token expired or expiring soon, attempting refresh',
            {
              userId: connection.userId,
              expiresAt: connection.expiresAt,
            },
          );

          const refreshed = await this.refreshAccessToken(connection);
          if (refreshed) {
            return this.createOctokitFromToken(refreshed);
          }
          // If refresh failed, try with existing token (might still work)
          this.logger.warn('Token refresh failed, using existing token', {
            userId: connection.userId,
          });
        }
      }

      const decryptedToken = connection.decryptToken();

      if (connection.tokenType === 'app' && connection.installationId) {
        return this.createOctokitFromApp(connection.installationId);
      }

      return this.createOctokitFromToken(decryptedToken);
    } catch (error: any) {
      this.logger.error('Failed to get Octokit from connection', {
        userId: connection.userId,
        error: error.message,
        hasAccessToken: !!connection.accessToken,
        tokenType: connection.tokenType,
      });
      throw new Error('Failed to authenticate with GitHub API');
    }
  }

  /**
   * Refresh OAuth access token
   */
  async refreshAccessToken(connection: any): Promise<string | null> {
    try {
      if (!connection.decryptRefreshToken) {
        this.logger.warn('No refresh token available for connection', {
          userId: connection.userId,
        });
        return null;
      }

      const refreshToken = connection.decryptRefreshToken();
      if (!refreshToken) {
        this.logger.warn('Refresh token is empty', {
          userId: connection.userId,
        });
        return null;
      }

      this.logger.log('Refreshing OAuth token', {
        userId: connection.userId,
      });

      const response = await fetch(
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
          }),
        },
      );

      const data = (await response.json()) as OAuthTokenResponse;

      if (!data.access_token) {
        this.logger.error(
          'OAuth token refresh failed - no access token returned',
          {
            userId: connection.userId,
          },
        );
        return null;
      }

      // Update connection with new tokens
      connection.accessToken = data.access_token;
      if (data.refresh_token) {
        connection.refreshToken = data.refresh_token;
      }
      if (data.expires_in) {
        connection.expiresAt = new Date(Date.now() + data.expires_in * 1000);
      }
      await connection.save();

      this.logger.log('OAuth token refreshed successfully', {
        userId: connection.userId,
        expiresAt: connection.expiresAt,
      });

      return data.access_token;
    } catch (error: any) {
      this.logger.error('Failed to refresh OAuth token', {
        userId: connection.userId,
        error: error.message,
        stack: error.stack,
      });
      return null;
    }
  }

  /**
   * Exchange OAuth code for access token
   */
  async exchangeCodeForToken(code: string): Promise<OAuthTokenResponse> {
    try {
      const response = await fetch(
        'https://github.com/login/oauth/access_token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            code: code,
          }),
        },
      );

      const data = (await response.json()) as OAuthTokenResponse;

      if (!data.access_token) {
        this.logger.error(
          'OAuth token exchange failed - no access token returned',
        );
        throw new Error('Failed to exchange OAuth code for token');
      }

      this.logger.log('OAuth token exchanged successfully');
      return data;
    } catch (error: any) {
      this.logger.error('Failed to exchange OAuth code', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get authenticated user information
   */
  async getAuthenticatedUser(accessToken: string): Promise<GitHubUser> {
    try {
      const octokit = await this.createOctokitFromToken(accessToken);
      const { data } = await octokit.rest.users.getAuthenticated();

      this.logger.log('Retrieved authenticated GitHub user', {
        username: data.login,
        userId: String(data.id),
      });

      return {
        id: data.id,
        login: data.login,
        avatar_url: data.avatar_url,
        name: data.name || undefined,
        email: data.email || undefined,
      };
    } catch (error: any) {
      this.logger.error('Failed to get authenticated user', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * List user's repositories
   */
  async listUserRepositories(connection: any): Promise<any[]> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);

      const { data } = await octokit.rest.repos.listForAuthenticatedUser({
        sort: 'updated',
        per_page: 100,
        type: 'all',
      });

      const repositories = data.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        defaultBranch: repo.default_branch || 'main',
        description: repo.description || undefined,
        language: repo.language || undefined,
        url: repo.html_url,
        createdAt: repo.created_at ? new Date(repo.created_at) : undefined,
        updatedAt: repo.updated_at ? new Date(repo.updated_at) : undefined,
      }));

      this.logger.log('Listed user repositories', {
        userId: connection.userId,
        count: repositories.length,
      });

      return repositories;
    } catch (error: any) {
      this.logger.error('Failed to list repositories', {
        userId: connection.userId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get repository details
   */
  async getRepository(connection: any, owner: string, repo: string) {
    try {
      const octokit = await this.getOctokitFromConnection(connection);
      const { data } = await octokit.rest.repos.get({ owner, repo });

      this.logger.log('Retrieved repository details', {
        repository: `${owner}/${repo}`,
      });

      return data;
    } catch (error: any) {
      this.logger.error('Failed to get repository', {
        repository: `${owner}/${repo}`,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get file content from repository
   */
  async getFileContent(
    connection: any,
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<string> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);

      const { data } = (await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref,
      })) as { data: RepositoryContent };

      if (data.type !== 'file' || !data.content) {
        throw new Error('Path does not point to a file');
      }

      const content = Buffer.from(data.content, 'base64').toString('utf-8');

      this.logger.log('Retrieved file content', {
        repository: `${owner}/${repo}`,
        path,
        size: data.size,
      });

      return content;
    } catch (error: any) {
      this.logger.error('Failed to get file content', {
        repository: `${owner}/${repo}`,
        path,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * List directory contents
   */
  async listDirectoryContents(
    connection: any,
    owner: string,
    repo: string,
    path: string = '',
    ref?: string,
  ): Promise<RepositoryContent[]> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);

      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      const contents = Array.isArray(data) ? data : [data];

      this.logger.log('Listed directory contents', {
        repository: `${owner}/${repo}`,
        path,
        itemCount: contents.length,
      });

      return contents as RepositoryContent[];
    } catch (error: any) {
      this.logger.error('Failed to list directory contents', {
        repository: `${owner}/${repo}`,
        path,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get all repository files recursively (excluding dependency folders)
   */
  async getAllRepositoryFiles(
    connection: any,
    owner: string,
    repo: string,
    ref?: string,
    options?: {
      maxFiles?: number;
      excludePatterns?: string[];
    },
  ): Promise<
    Array<{ path: string; size: number; type: 'file' | 'dir'; sha?: string }>
  > {
    const maxFiles = options?.maxFiles || 5000;
    const files: Array<{
      path: string;
      size: number;
      type: 'file' | 'dir';
      sha?: string;
    }> = [];

    // Default exclusion patterns for dependency folders
    const defaultExcludePatterns = [
      'node_modules',
      '__pycache__',
      '.venv',
      'venv',
      'env',
      '.env',
      'dist',
      'build',
      '.git',
      'coverage',
      '.next',
      '.nuxt',
      '.cache',
      '.pytest_cache',
      '.mypy_cache',
      '.tox',
      'target',
      'out',
      '.idea',
      '.vscode',
      '.vs',
      '*.min.js',
      '*.bundle.js',
      '*.chunk.js',
    ];

    const excludePatterns = options?.excludePatterns || defaultExcludePatterns;

    // Helper function to check if path should be excluded
    const shouldExclude = (path: string): boolean => {
      const pathParts = path.split('/');
      return excludePatterns.some((pattern) => {
        // Exact match
        if (pathParts.includes(pattern)) return true;
        // Wildcard match
        if (pattern.includes('*')) {
          const regex = new RegExp(pattern.replace(/\*/g, '.*'));
          return regex.test(path);
        }
        // Prefix match
        return pathParts.some((part) => part.startsWith(pattern));
      });
    };

    // Recursive function to traverse directory tree
    const traverseDirectory = async (
      currentPath: string = '',
    ): Promise<void> => {
      if (files.length >= maxFiles) {
        this.logger.warn('Reached max files limit', { maxFiles, currentPath });
        return;
      }

      try {
        const contents = await this.listDirectoryContents(
          connection,
          owner,
          repo,
          currentPath,
          ref,
        );

        for (const item of contents) {
          const fullPath = item.path;

          // Skip excluded paths
          if (shouldExclude(fullPath)) {
            continue;
          }

          if (item.type === 'file') {
            files.push({
              path: fullPath,
              size: item.size,
              type: 'file',
              sha: item.sha,
            });
          } else if (item.type === 'dir') {
            files.push({
              path: fullPath,
              size: 0,
              type: 'dir',
            });

            // Recursively traverse subdirectories
            await traverseDirectory(fullPath);

            // Add small delay to respect rate limits
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
      } catch (error: any) {
        // Log but continue - some directories might not be accessible
        this.logger.warn('Failed to traverse directory', {
          repository: `${owner}/${repo}`,
          path: currentPath,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    };

    try {
      await traverseDirectory('');

      this.logger.log('Retrieved all repository files', {
        repository: `${owner}/${repo}`,
        fileCount: files.length,
        maxFiles,
      });

      return files;
    } catch (error: any) {
      this.logger.error('Failed to get all repository files', {
        repository: `${owner}/${repo}`,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Create a new branch
   */
  async createBranch(
    connection: any,
    options: CreateBranchOptions,
  ): Promise<string> {
    try {
      // Verify we're using OAuth token, not App token
      if (connection.tokenType === 'app') {
        throw new Error(
          'Branch creation requires OAuth token, not GitHub App token',
        );
      }

      const octokit = await this.getOctokitFromConnection(connection);
      const { owner, repo, branchName, fromBranch } = options;

      // Get the ref of the base branch
      const baseBranch = fromBranch || 'main';
      const { data: refData } = await octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${baseBranch}`,
      });

      const sha = refData.object.sha;

      // Create new branch
      await octokit.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha,
      });

      this.logger.log('Created new branch', {
        repository: `${owner}/${repo}`,
        branchName,
        fromBranch: baseBranch,
        sha,
      });

      return branchName;
    } catch (error: any) {
      this.logger.error('Failed to create branch', {
        repository: `${options.owner}/${options.repo}`,
        branchName: options.branchName,
        error: error.message,
        status: error.status,
        tokenType: connection.tokenType,
        isActive: connection.isActive,
      });
      throw error;
    }
  }

  /**
   * Create or update a file in repository
   */
  async createOrUpdateFile(
    connection: any,
    options: CreateFileOptions,
  ): Promise<{ sha: string; commit: string }> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);
      const { owner, repo, branch, path, content, message } = options;

      // Check if file exists (only if branch is provided)
      let sha: string | undefined;
      if (branch) {
        try {
          const { data } = (await octokit.rest.repos.getContent({
            owner,
            repo,
            path,
            ref: branch,
          })) as { data: RepositoryContent };
          sha = data.sha;
        } catch (error: any) {
          // File doesn't exist, that's okay
          if (error.status !== 404) {
            throw error;
          }
        }
      }

      // Create or update file
      const { data } = await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message,
        content: Buffer.from(content).toString('base64'),
        ...(branch && { branch }), // Only include branch if provided
        ...(sha && { sha }), // Only include sha if we found the file
      });

      this.logger.log('Created/updated file in repository', {
        repository: `${owner}/${repo}`,
        path,
        branch: branch || 'default',
        sha: data.content?.sha,
      });

      return {
        sha: data.content?.sha || '',
        commit: data.commit.sha || '',
      };
    } catch (error: any) {
      this.logger.error('Failed to create/update file', {
        repository: `${options.owner}/${options.repo}`,
        path: options.path,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Create a pull request
   */
  async createPullRequest(
    connection: any,
    options: CreatePROptions,
  ): Promise<{ number: number; url: string; html_url: string }> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);
      const { owner, repo, title, body, head, base, draft = false } = options;

      const { data } = await octokit.rest.pulls.create({
        owner,
        repo,
        title,
        body,
        head,
        base,
        draft,
      });

      this.logger.log('Created pull request', {
        repository: `${owner}/${repo}`,
        prNumber: data.number,
        title,
        url: data.html_url,
      });

      return {
        number: data.number,
        url: data.url,
        html_url: data.html_url,
      };
    } catch (error: any) {
      this.logger.error('Failed to create pull request', {
        repository: `${options.owner}/${options.repo}`,
        title: options.title,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update a pull request
   */
  async updatePullRequest(
    connection: any,
    options: UpdatePROptions,
  ): Promise<void> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);
      const { owner, repo, prNumber, title, body, state } = options;

      await octokit.rest.pulls.update({
        owner,
        repo,
        pull_number: prNumber,
        title,
        body,
        state,
      });

      this.logger.log('Updated pull request', {
        repository: `${owner}/${repo}`,
        prNumber,
        title,
        state,
      });
    } catch (error: any) {
      this.logger.error('Failed to update pull request', {
        repository: `${options.owner}/${options.repo}`,
        prNumber: options.prNumber,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Add comment to pull request
   */
  async addPRComment(
    connection: any,
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<void> {
    try {
      const octokit = await this.getOctokitFromConnection(connection);

      await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      });

      this.logger.log('Added comment to pull request', {
        repository: `${owner}/${repo}`,
        prNumber,
      });
    } catch (error: any) {
      this.logger.error('Failed to add PR comment', {
        repository: `${owner}/${repo}`,
        prNumber,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get pull request details
   */
  async getPullRequest(
    connection: any,
    owner: string,
    repo: string,
    prNumber: number,
  ) {
    try {
      const octokit = await this.getOctokitFromConnection(connection);

      const { data } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      this.logger.log('Retrieved pull request', {
        repository: `${owner}/${repo}`,
        prNumber,
        state: data.state,
      });

      return data;
    } catch (error: any) {
      this.logger.error('Failed to get pull request', {
        repository: `${owner}/${repo}`,
        prNumber,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get GitHub App installation details
   */
  async getInstallation(installationId: string): Promise<any> {
    try {
      await this.initialize();

      // Create a temporary Octokit instance for app authentication
      const octokit = new Octokit({
        auth: await this.getAppToken(),
      });

      const { data } = await octokit.rest.apps.getInstallation({
        installation_id: parseInt(installationId),
      });

      this.logger.log('Retrieved GitHub App installation', {
        installationId,
        accountId: data.account?.id,
        accountLogin: data.account?.login,
      });

      return data;
    } catch (error: any) {
      this.logger.error('Failed to get GitHub App installation', {
        installationId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get app token for GitHub App authentication
   * Uses consolidated createJWT method
   */
  private async getAppToken(): Promise<string> {
    return this.createJWT();
  }

  /**
   * Verify webhook signature with proper null checks and error handling
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    // Validate inputs
    if (!signature || !payload) {
      this.logger.warn('Missing webhook signature or payload');
      return false;
    }

    const secret =
      this.configService.get<string>('GITHUB_WEBHOOK_SECRET') || '';
    if (!secret) {
      this.logger.error('GitHub webhook secret not configured');
      return false;
    }

    try {
      const hmac = crypto.createHmac('sha256', secret);
      const digest = 'sha256=' + hmac.update(payload).digest('hex');

      // Ensure both buffers are same length to prevent timing attacks
      if (digest.length !== signature.length) {
        this.logger.warn('Webhook signature length mismatch');
        return false;
      }

      return crypto.timingSafeEqual(
        Buffer.from(digest),
        Buffer.from(signature),
      );
    } catch (error: any) {
      this.logger.error('Webhook signature verification error', {
        error: error.message,
        stack: error.stack,
      });
      return false;
    }
  }
}
