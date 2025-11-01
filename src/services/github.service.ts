import { IGitHubConnection, IGitHubRepository } from '../models';
import { loggingService } from './logging.service';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

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
    branch: string;
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

export class GitHubService {
    private static config: GitHubAuthConfig = {
        appId: process.env.GITHUB_APP_ID,
        privateKey: process.env.GITHUB_APP_PRIVATE_KEY 
            ? Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY, 'base64').toString('utf-8')
            : undefined,
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET
    };

    private static modulesLoaded = false;
    private static initializationPromise: Promise<void> | null = null;

    /**
     * Initialize GitHub service modules
     */
    static async initialize(): Promise<void> {
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = this.loadOctokitModules();
        return this.initializationPromise;
    }

    private static async loadOctokitModules(): Promise<void> {
        if (this.modulesLoaded) {
            return;
        }

        try {
            // Use dynamic import() for ES Module compatibility
            const octokitModule = await import('@octokit/rest');
            const { Octokit: OctokitClass } = octokitModule;
            
            Octokit = OctokitClass;
            // createAppAuth can be imported here in the future if needed for GitHub App auth
            
            this.modulesLoaded = true;
            loggingService.info('Octokit modules loaded successfully via dynamic import');
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorStack = error instanceof Error ? error.stack : undefined;
            const errorName = error instanceof Error ? error.name : undefined;
            
            loggingService.error('Failed to load Octokit modules', { 
                error: errorMessage,
                stack: errorStack,
                name: errorName
            });
            throw new Error(`Failed to load GitHub API modules: ${errorMessage}`);
        }
    }

    /**
     * Create authenticated Octokit instance from user's access token
     */
    private static async createOctokitFromToken(accessToken: string): Promise<any> {
        await this.initialize();
        return new Octokit({
            auth: accessToken
        });
    }

    /**
     * Create authenticated Octokit instance for GitHub App
     */
    private static async createOctokitFromApp(installationId: string): Promise<any> {
        await this.initialize();
        
        if (!this.config.appId || !this.config.privateKey) {
            throw new Error('GitHub App credentials not configured. Please set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY environment variables.');
        }

        try {
            // Create JWT token for GitHub App authentication
            const jwt = this.createJWT();
            
            // Create Octokit instance with app authentication
            const appOctokit = new Octokit({
                auth: jwt
            });

            // Get installation access token
            const { data: installationData } = await appOctokit.rest.apps.createInstallationAccessToken({
                installation_id: parseInt(installationId)
            });

            // Create new Octokit instance with installation access token
            const octokit = new Octokit({
                auth: installationData.token
            });

            loggingService.info('Created GitHub App Octokit instance', {
                installationId,
                appId: this.config.appId
            });

            return octokit;
        } catch (error: any) {
            loggingService.error('Failed to create GitHub App Octokit instance', {
                installationId,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Create JWT token for GitHub App authentication
     */
    private static createJWT(): string {
        if (!this.config.appId || !this.config.privateKey) {
            throw new Error('GitHub App credentials not configured');
        }

        const now = Math.floor(Date.now() / 1000);
        const payload = {
            iat: now - 60, // Issued at time (1 minute ago to account for clock skew)
            exp: now + (10 * 60), // Expires in 10 minutes
            iss: this.config.appId // Issuer (App ID)
        };

        const header = {
            alg: 'RS256',
            typ: 'JWT'
        };

        // Create JWT token manually since we don't have a JWT library
        const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
        const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
        
        const signature = crypto
            .createSign('RSA-SHA256')
            .update(`${encodedHeader}.${encodedPayload}`)
            .sign(this.config.privateKey, 'base64url');

        return `${encodedHeader}.${encodedPayload}.${signature}`;
    }

    /**
     * Get Octokit instance from GitHub connection
     */
    private static async getOctokitFromConnection(connection: IGitHubConnection & { decryptToken: () => string }): Promise<any> {
        try {
            const decryptedToken = connection.decryptToken();
            
            if (connection.tokenType === 'app' && connection.installationId) {
                return this.createOctokitFromApp(connection.installationId);
            }
            
            return this.createOctokitFromToken(decryptedToken);
        } catch (error: any) {
            loggingService.error('Failed to get Octokit from connection', {
                userId: connection.userId,
                error: error.message,
                hasAccessToken: !!connection.accessToken,
                tokenType: connection.tokenType
            });
            throw new Error(`Failed to authenticate with GitHub: ${error.message}`);
        }
    }

    /**
     * Exchange OAuth code for access token
     */
    static async exchangeCodeForToken(code: string): Promise<OAuthTokenResponse> {
        try {
            const response = await fetch('https://github.com/login/oauth/access_token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    client_id: this.config.clientId,
                    client_secret: this.config.clientSecret,
                    code: code
                })
            });

            const data = await response.json() as OAuthTokenResponse;
            
            if (!data.access_token) {
                throw new Error('Failed to obtain access token');
            }

            loggingService.info('OAuth token exchanged successfully');
            return data;
        } catch (error: any) {
            loggingService.error('Failed to exchange OAuth code', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Get authenticated user information
     */
    static async getAuthenticatedUser(accessToken: string): Promise<GitHubUser> {
        try {
            const octokit = await this.createOctokitFromToken(accessToken);
            const { data } = await octokit.rest.users.getAuthenticated();

            loggingService.info('Retrieved authenticated GitHub user', {
                username: data.login,
                userId: String(data.id)
            });

            return {
                id: data.id,
                login: data.login,
                avatar_url: data.avatar_url,
                name: data.name || undefined,
                email: data.email || undefined
            };
        } catch (error: any) {
            loggingService.error('Failed to get authenticated user', {
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * List user's repositories
     */
    static async listUserRepositories(connection: IGitHubConnection & { decryptToken: () => string }): Promise<IGitHubRepository[]> {
        try {
            const octokit = await this.getOctokitFromConnection(connection);
            
            const { data } = await octokit.rest.repos.listForAuthenticatedUser({
                sort: 'updated',
                per_page: 100,
                type: 'all'
            });

            const repositories: IGitHubRepository[] = data.map((repo: any) => ({
                id: repo.id,
                name: repo.name,
                fullName: repo.full_name,
                private: repo.private,
                defaultBranch: repo.default_branch || 'main',
                description: repo.description || undefined,
                language: repo.language || undefined,
                url: repo.html_url,
                createdAt: repo.created_at ? new Date(repo.created_at) : undefined,
                updatedAt: repo.updated_at ? new Date(repo.updated_at) : undefined
            }));

            loggingService.info('Listed user repositories', {
                userId: connection.userId,
                count: repositories.length
            });

            return repositories;
        } catch (error: any) {
            loggingService.error('Failed to list repositories', {
                userId: connection.userId,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Get repository details
     */
    static async getRepository(connection: IGitHubConnection & { decryptToken: () => string }, owner: string, repo: string) {
        try {
            const octokit = await this.getOctokitFromConnection(connection);
            const { data } = await octokit.rest.repos.get({ owner, repo });

            loggingService.info('Retrieved repository details', {
                repository: `${owner}/${repo}`
            });

            return data;
        } catch (error: any) {
            loggingService.error('Failed to get repository', {
                repository: `${owner}/${repo}`,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get file content from repository
     */
    static async getFileContent(
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string,
        path: string,
        ref?: string
    ): Promise<string> {
        try {
            const octokit = await this.getOctokitFromConnection(connection);
            
            const { data } = await octokit.rest.repos.getContent({
                owner,
                repo,
                path,
                ref
            }) as { data: RepositoryContent };

            if (data.type !== 'file' || !data.content) {
                throw new Error('Path does not point to a file');
            }

            const content = Buffer.from(data.content, 'base64').toString('utf-8');

            loggingService.info('Retrieved file content', {
                repository: `${owner}/${repo}`,
                path,
                size: data.size
            });

            return content;
        } catch (error: any) {
            loggingService.error('Failed to get file content', {
                repository: `${owner}/${repo}`,
                path,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * List directory contents
     */
    static async listDirectoryContents(
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string,
        path: string = '',
        ref?: string
    ): Promise<RepositoryContent[]> {
        try {
            const octokit = await this.getOctokitFromConnection(connection);
            
            const { data } = await octokit.rest.repos.getContent({
                owner,
                repo,
                path,
                ref
            });

            const contents = Array.isArray(data) ? data : [data];

            loggingService.info('Listed directory contents', {
                repository: `${owner}/${repo}`,
                path,
                itemCount: contents.length
            });

            return contents as RepositoryContent[];
        } catch (error: any) {
            loggingService.error('Failed to list directory contents', {
                repository: `${owner}/${repo}`,
                path,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get all repository files recursively (excluding dependency folders)
     */
    static async getAllRepositoryFiles(
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string,
        ref?: string,
        options?: {
            maxFiles?: number;
            excludePatterns?: string[];
        }
    ): Promise<Array<{ path: string; size: number; type: 'file' | 'dir'; sha?: string }>> {
        const maxFiles = options?.maxFiles || 5000;
        const files: Array<{ path: string; size: number; type: 'file' | 'dir'; sha?: string }> = [];
        
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
            '*.chunk.js'
        ];
        
        const excludePatterns = options?.excludePatterns || defaultExcludePatterns;
        
        // Helper function to check if path should be excluded
        const shouldExclude = (path: string): boolean => {
            const pathParts = path.split('/');
            return excludePatterns.some(pattern => {
                // Exact match
                if (pathParts.includes(pattern)) return true;
                // Wildcard match
                if (pattern.includes('*')) {
                    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
                    return regex.test(path);
                }
                // Prefix match
                return pathParts.some(part => part.startsWith(pattern));
            });
        };
        
        // Recursive function to traverse directory tree
        const traverseDirectory = async (currentPath: string = ''): Promise<void> => {
            if (files.length >= maxFiles) {
                loggingService.warn('Reached max files limit', { maxFiles, currentPath });
                return;
            }
            
            try {
                const contents = await this.listDirectoryContents(connection, owner, repo, currentPath, ref);
                
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
                            sha: item.sha
                        });
                    } else if (item.type === 'dir') {
                        files.push({
                            path: fullPath,
                            size: 0,
                            type: 'dir'
                        });
                        
                        // Recursively traverse subdirectories
                        await traverseDirectory(fullPath);
                        
                        // Add small delay to respect rate limits
                        await new Promise(resolve => setTimeout(resolve, 50));
                    }
                }
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                // Log but continue - some directories might not be accessible
                loggingService.warn('Failed to traverse directory', {
                    repository: `${owner}/${repo}`,
                    path: currentPath,
                    error: errorMessage
                });
            }
        };
        
        try {
            await traverseDirectory('');
            
            loggingService.info('Retrieved all repository files', {
                repository: `${owner}/${repo}`,
                fileCount: files.length,
                maxFiles
            });
            
            return files;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            loggingService.error('Failed to get all repository files', {
                repository: `${owner}/${repo}`,
                error: errorMessage
            });
            throw error;
        }
    }

    /**
     * Create a new branch
     */
    static async createBranch(
        connection: IGitHubConnection & { decryptToken: () => string },
        options: CreateBranchOptions
    ): Promise<string> {
        try {
            // Verify we're using OAuth token, not App token
            if (connection.tokenType === 'app') {
                throw new Error('GitHub App authentication detected. Please reconnect using OAuth flow for write access.');
            }

            const octokit = await this.getOctokitFromConnection(connection);
            const { owner, repo, branchName, fromBranch } = options;

            // Get the ref of the base branch
            const baseBranch = fromBranch || 'main';
            const { data: refData } = await octokit.rest.git.getRef({
                owner,
                repo,
                ref: `heads/${baseBranch}`
            });

            const sha = refData.object.sha;

            // Create new branch
            await octokit.rest.git.createRef({
                owner,
                repo,
                ref: `refs/heads/${branchName}`,
                sha
            });

            loggingService.info('Created new branch', {
                repository: `${owner}/${repo}`,
                branchName,
                fromBranch: baseBranch,
                sha
            });

            return branchName;
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            const errorStatus = (error as any)?.status;
            
            // Provide user-friendly error messages
            let userMessage = errorMessage;
            if (errorMessage.includes('Resource not accessible by integration')) {
                userMessage = 'GitHub token does not have write permissions. Please reconnect your GitHub account and grant all requested permissions.';
            } else if (errorMessage.includes('Bad credentials')) {
                userMessage = 'GitHub authentication failed. Please reconnect your GitHub account.';
            } else if (errorMessage.includes('Not Found')) {
                userMessage = 'Repository or branch not found. Please verify the repository exists and you have access.';
            }

            loggingService.error('Failed to create branch', {
                repository: `${options.owner}/${options.repo}`,
                branchName: options.branchName,
                error: errorMessage,
                status: errorStatus,
                tokenType: connection.tokenType,
                isActive: connection.isActive
            });
            
            // Throw error with user-friendly message
            const friendlyError = new Error(userMessage);
            (friendlyError as any).status = errorStatus;
            throw friendlyError;
        }
    }

    /**
     * Create or update a file in repository
     */
    static async createOrUpdateFile(
        connection: IGitHubConnection & { decryptToken: () => string },
        options: CreateFileOptions
    ): Promise<{ sha: string; commit: string }> {
        try {
            const octokit = await this.getOctokitFromConnection(connection);
            const { owner, repo, branch, path, content, message } = options;

            // Check if file exists
            let sha: string | undefined;
            try {
                const { data } = await octokit.rest.repos.getContent({
                    owner,
                    repo,
                    path,
                    ref: branch
                }) as { data: RepositoryContent };
                sha = data.sha;
            } catch (error: any) {
                // File doesn't exist, that's okay
                if (error.status !== 404) {
                    throw error;
                }
            }

            // Create or update file
            const { data } = await octokit.rest.repos.createOrUpdateFileContents({
                owner,
                repo,
                path,
                message,
                content: Buffer.from(content).toString('base64'),
                branch,
                sha
            });

            loggingService.info('Created/updated file in repository', {
                repository: `${owner}/${repo}`,
                path,
                branch,
                sha: data.content?.sha
            });

            return {
                sha: data.content?.sha || '',
                commit: data.commit.sha || ''
            };
        } catch (error: any) {
            loggingService.error('Failed to create/update file', {
                repository: `${options.owner}/${options.repo}`,
                path: options.path,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Create a pull request
     */
    static async createPullRequest(
        connection: IGitHubConnection & { decryptToken: () => string },
        options: CreatePROptions
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
                draft
            });

            loggingService.info('Created pull request', {
                repository: `${owner}/${repo}`,
                prNumber: data.number,
                title,
                url: data.html_url
            });

            return {
                number: data.number,
                url: data.url,
                html_url: data.html_url
            };
        } catch (error: any) {
            loggingService.error('Failed to create pull request', {
                repository: `${options.owner}/${options.repo}`,
                title: options.title,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Update a pull request
     */
    static async updatePullRequest(
        connection: IGitHubConnection & { decryptToken: () => string },
        options: UpdatePROptions
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
                state
            });

            loggingService.info('Updated pull request', {
                repository: `${owner}/${repo}`,
                prNumber,
                title,
                state
            });
        } catch (error: any) {
            loggingService.error('Failed to update pull request', {
                repository: `${options.owner}/${options.repo}`,
                prNumber: options.prNumber,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Add comment to pull request
     */
    static async addPRComment(
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string,
        prNumber: number,
        body: string
    ): Promise<void> {
        try {
            const octokit = await this.getOctokitFromConnection(connection);

            await octokit.rest.issues.createComment({
                owner,
                repo,
                issue_number: prNumber,
                body
            });

            loggingService.info('Added comment to pull request', {
                repository: `${owner}/${repo}`,
                prNumber
            });
        } catch (error: any) {
            loggingService.error('Failed to add PR comment', {
                repository: `${owner}/${repo}`,
                prNumber,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get pull request details
     */
    static async getPullRequest(
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string,
        prNumber: number
    ) {
        try {
            const octokit = await this.getOctokitFromConnection(connection);

            const { data } = await octokit.rest.pulls.get({
                owner,
                repo,
                pull_number: prNumber
            });

            loggingService.info('Retrieved pull request', {
                repository: `${owner}/${repo}`,
                prNumber,
                state: data.state
            });

            return data;
        } catch (error: any) {
            loggingService.error('Failed to get pull request', {
                repository: `${owner}/${repo}`,
                prNumber,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Get GitHub App installation details
     */
    static async getInstallation(installationId: string): Promise<any> {
        try {
            await this.initialize();
            
            // Create a temporary Octokit instance for app authentication
            const octokit = new Octokit({
                auth: await this.getAppToken()
            });

            const { data } = await octokit.rest.apps.getInstallation({
                installation_id: parseInt(installationId)
            });

            loggingService.info('Retrieved GitHub App installation', {
                installationId,
                accountId: data.account?.id,
                accountLogin: data.account?.login
            });

            return data;
        } catch (error: any) {
            loggingService.error('Failed to get GitHub App installation', {
                installationId,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Get app token for GitHub App authentication
     */
    private static async getAppToken(): Promise<string> {
        if (!this.config.appId || !this.config.privateKey) {
            throw new Error('GitHub App credentials not configured');
        }

        const now = Math.floor(Date.now() / 1000);
        const payload = {
            iat: now - 60,
            exp: now + 600, // 10 minutes
            iss: this.config.appId
        };

        const token = jwt.sign(payload, this.config.privateKey, { algorithm: 'RS256' });
        return token;
    }

    /**
     * Verify webhook signature
     */
    static verifyWebhookSignature(payload: string, signature: string): boolean {
        const secret = process.env.GITHUB_WEBHOOK_SECRET || '';
        const hmac = crypto.createHmac('sha256', secret);
        const digest = 'sha256=' + hmac.update(payload).digest('hex');
        
        return crypto.timingSafeEqual(
            Buffer.from(digest),
            Buffer.from(signature)
        );
    }
}

export default GitHubService;



