import { VercelConnection, IVercelConnection, IVercelProject } from '../models/VercelConnection';
import { loggingService } from './logging.service';
import { redisService } from './redis.service';
import crypto from 'crypto';

/**
 * Vercel Service
 * 
 * ARCHITECTURE:
 * - Uses Vercel's Official MCP Server for READ operations (list projects, get logs, etc.)
 * - Uses Direct Vercel REST API for WRITE operations (deploy, set env vars, etc.)
 * 
 * MCP Server: https://mcp.vercel.com
 * Vercel API: https://api.vercel.com
 */

// Vercel API base URL
const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_OAUTH_BASE = 'https://vercel.com';

// Redis key prefix for Vercel OAuth state tokens
const VERCEL_STATE_KEY_PREFIX = 'vercel:oauth:state:';

// OAuth configuration
export interface VercelOAuthConfig {
    clientId: string;
    clientSecret: string;
    callbackUrl: string;
}

// OAuth token response
export interface VercelOAuthTokenResponse {
    access_token: string;
    token_type: string;
    user_id: string;
    team_id?: string;
}

// Vercel user response
export interface VercelUser {
    id: string;
    email: string;
    name?: string;
    username: string;
    avatar?: string;
}

// Vercel team response
export interface VercelTeam {
    id: string;
    slug: string;
    name: string;
    avatar?: string;
}

// Vercel project response
export interface VercelProject {
    id: string;
    name: string;
    framework?: string;
    latestDeployments?: VercelDeployment[];
    targets?: {
        production?: {
            url: string;
        };
    };
    createdAt: number;
    updatedAt: number;
}

// Vercel deployment response
export interface VercelDeployment {
    uid: string;
    name: string;
    url: string;
    state: 'BUILDING' | 'ERROR' | 'INITIALIZING' | 'QUEUED' | 'READY' | 'CANCELED';
    readyState?: string;
    createdAt: number;
    buildingAt?: number;
    ready?: number;
    meta?: {
        githubCommitRef?: string;
        githubCommitSha?: string;
        githubCommitMessage?: string;
    };
    target?: 'production' | 'preview';
    creator?: {
        uid: string;
        username: string;
    };
}

// Vercel domain response
export interface VercelDomain {
    name: string;
    apexName: string;
    projectId: string;
    verified: boolean;
    verification?: Array<{
        type: string;
        domain: string;
        value: string;
    }>;
    createdAt: number;
    updatedAt: number;
}

// Vercel environment variable
export interface VercelEnvVar {
    id: string;
    key: string;
    value?: string; // Only returned if decrypted
    type: 'plain' | 'secret' | 'encrypted' | 'system';
    target: Array<'production' | 'preview' | 'development'>;
    createdAt: number;
    updatedAt: number;
}

// Deployment options
export interface DeploymentOptions {
    gitSource?: {
        ref?: string;
        repoId?: string;
        type?: 'github' | 'gitlab' | 'bitbucket';
    };
    target?: 'production' | 'preview';
    name?: string;
}

export class VercelService {
    private static config: VercelOAuthConfig = {
        clientId: process.env.VERCEL_CLIENT_ID ?? '',
        clientSecret: process.env.VERCEL_CLIENT_SECRET ?? '',
        callbackUrl: process.env.VERCEL_CALLBACK_URL ?? 'http://localhost:8000/api/vercel/callback'
    };

    /**
     * Generate OAuth authorization URL with state token
     * Uses Redis for state storage to support distributed deployments
     * 
     * For Vercel Integrations, we use the standard OAuth authorize endpoint
     * with client_id, redirect_uri, and state parameters
     */
    static async initiateOAuth(userId: string): Promise<string> {
        // Generate secure state token
        const state = crypto.randomBytes(32).toString('hex');
        
        // Store state token in Redis with 10 minute expiration
        const stateData = {
            userId,
            createdAt: Date.now()
        };
        
        await redisService.set(
            `${VERCEL_STATE_KEY_PREFIX}${state}`,
            stateData,
            600 // 10 minutes TTL
        );

        // Use the standard Vercel OAuth authorize endpoint
        // This properly handles state parameter passthrough
        const params = new URLSearchParams({
            client_id: this.config.clientId,
            redirect_uri: this.config.callbackUrl,
            state: state,
        });

        // For Vercel Integrations, use the integration-specific OAuth URL
        const authUrl = `${VERCEL_OAUTH_BASE}/integrations/${this.config.clientId}/new?${params.toString()}`;

        loggingService.info('Generated Vercel OAuth URL', {
            userId,
            state: state.substring(0, 8) + '...',
            clientId: this.config.clientId,
            redirectUri: this.config.callbackUrl
        });

        return authUrl;
    }

    /**
     * Handle OAuth callback - exchange code for token
     * Retrieves state from Redis for distributed deployment support
     */
    static async handleCallback(code: string, state: string): Promise<IVercelConnection> {
        // Validate state token from Redis
        const stateData = await redisService.get(`${VERCEL_STATE_KEY_PREFIX}${state}`) as { userId: string; createdAt: number } | null;
        
        if (!stateData) {
            loggingService.error('Vercel OAuth state validation failed', {
                state: state.substring(0, 8) + '...',
                reason: 'State not found in Redis'
            });
            throw new Error('Invalid or expired state token');
        }

        const userId: string = stateData.userId;
        
        // Delete the state token after use (one-time use)
        await redisService.del(`${VERCEL_STATE_KEY_PREFIX}${state}`);

        try {
            // Exchange code for access token
            const tokenResponse = await fetch(`${VERCEL_API_BASE}/v2/oauth/access_token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    client_id: this.config.clientId,
                    client_secret: this.config.clientSecret,
                    code: code,
                    redirect_uri: this.config.callbackUrl
                }).toString()
            });

            if (!tokenResponse.ok) {
                const errorText = await tokenResponse.text();
                loggingService.error('Failed to exchange Vercel OAuth code', {
                    status: tokenResponse.status,
                    error: errorText
                });
                throw new Error('Failed to exchange authorization code for access token');
            }

            const tokenData = await tokenResponse.json() as VercelOAuthTokenResponse;

            // Get user information
            const userInfo = await this.getUserInfo(tokenData.access_token);

            // Get team information if team_id is present
            let teamInfo: VercelTeam | undefined;
            if (tokenData.team_id) {
                teamInfo = await this.getTeamInfo(tokenData.access_token, tokenData.team_id);
            }

            // Check for existing connection
            let connection = await VercelConnection.findOne({
                userId,
                vercelUserId: userInfo.id
            }).select('+accessToken +refreshToken');

            if (connection) {
                // Update existing connection
                connection.accessToken = tokenData.access_token;
                connection.tokenType = tokenData.token_type;
                connection.vercelUsername = userInfo.username;
                connection.vercelEmail = userInfo.email;
                connection.avatarUrl = userInfo.avatar;
                connection.teamId = tokenData.team_id;
                connection.teamSlug = teamInfo?.slug;
                connection.team = teamInfo ? {
                    id: teamInfo.id,
                    slug: teamInfo.slug,
                    name: teamInfo.name,
                    avatar: teamInfo.avatar
                } : undefined;
                connection.isActive = true;
                connection.lastSyncedAt = new Date();
                await connection.save();

                loggingService.info('Updated existing Vercel connection', {
                    userId,
                    vercelUsername: userInfo.username,
                    connectionId: connection._id.toString()
                });
            } else {
                // Create new connection
                connection = new VercelConnection({
                    userId,
                    accessToken: tokenData.access_token,
                    tokenType: tokenData.token_type,
                    vercelUserId: userInfo.id,
                    vercelUsername: userInfo.username,
                    vercelEmail: userInfo.email,
                    avatarUrl: userInfo.avatar,
                    teamId: tokenData.team_id,
                    teamSlug: teamInfo?.slug,
                    team: teamInfo ? {
                        id: teamInfo.id,
                        slug: teamInfo.slug,
                        name: teamInfo.name,
                        avatar: teamInfo.avatar
                    } : undefined,
                    isActive: true,
                    lastSyncedAt: new Date()
                });
                await connection.save();

                loggingService.info('Created new Vercel connection', {
                    userId,
                    vercelUsername: userInfo.username,
                    connectionId: connection._id.toString()
                });

                // Auto-grant MCP permissions for new connection
                const { AutoGrantMCPPermissions } = await import('../mcp/permissions/auto-grant.service');
                await AutoGrantMCPPermissions.grantPermissionsForNewConnection(
                    userId,
                    'vercel',
                    connection._id.toString()
                );
            }

            // Sync projects
            await this.syncProjects(connection._id.toString());

            return connection;
        } catch (error: any) {
            loggingService.error('Vercel OAuth callback failed', {
                userId,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Get user information from Vercel
     */
    private static async getUserInfo(accessToken: string): Promise<VercelUser> {
        const response = await fetch(`${VERCEL_API_BASE}/v2/user`, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch Vercel user information');
        }

        const data = await response.json() as { user: { id: string; email: string; name: string; username: string; avatar?: string } };
        return {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name,
            username: data.user.username,
            avatar: data.user.avatar
        };
    }

    /**
     * Get team information from Vercel
     */
    private static async getTeamInfo(accessToken: string, teamId: string): Promise<VercelTeam> {
        const response = await fetch(`${VERCEL_API_BASE}/v2/teams/${teamId}`, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch Vercel team information');
        }

        const data = await response.json() as { id: string; slug: string; name: string; avatar?: string };
        return {
            id: data.id,
            slug: data.slug,
            name: data.name,
            avatar: data.avatar
        };
    }

    /**
     * Get decrypted access token from connection
     */
    private static async getAccessToken(connectionId: string): Promise<string> {
        const connection = await VercelConnection.findById(connectionId).select('+accessToken');
        if (!connection) {
            throw new Error('Vercel connection not found');
        }
        if (!connection.isActive) {
            throw new Error('Vercel connection is not active');
        }
        return connection.decryptToken();
    }

    /**
     * Make authenticated API request to Vercel
     */
    private static async apiRequest<T>(
        connectionId: string,
        endpoint: string,
        options: RequestInit = {}
    ): Promise<T> {
        const accessToken = await this.getAccessToken(connectionId);

        const connection = await VercelConnection.findById(connectionId);
        const teamParam = connection?.teamId ? `?teamId=${connection.teamId}` : '';
        const separator = endpoint.includes('?') ? '&' : '';
        const teamQuery = connection?.teamId ? `${separator}teamId=${connection.teamId}` : '';

        // Use teamParam if endpoint does not have any parameters, otherwise teamQuery
        let url: string;
        if (connection?.teamId) {
            if (endpoint.includes('?')) {
                url = `${VERCEL_API_BASE}${endpoint}${teamQuery}`;
            } else {
                url = `${VERCEL_API_BASE}${endpoint}${teamParam}`;
            }
        } else {
            url = `${VERCEL_API_BASE}${endpoint}`;
        }
        
        loggingService.info('Making Vercel API request', {
            connectionId,
            endpoint,
            url,
            method: options.method || 'GET',
            hasToken: !!accessToken,
            teamId: connection?.teamId
        });

        const response = await fetch(url, {
            ...options,
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                ...options.headers
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            loggingService.error('Vercel API request failed', {
                endpoint: url,
                status: response.status,
                error: errorText
            });
            throw new Error(`Vercel API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json() as T;
        
        loggingService.info('Vercel API response received', {
            connectionId,
            endpoint,
            status: response.status,
            dataKeys: Object.keys(data as any),
            projectsLength: (data as any).projects?.length
        });

        return data;
    }

    /**
     * List user's connections
     */
    static async listConnections(userId: string): Promise<IVercelConnection[]> {
        return VercelConnection.find({ userId, isActive: true });
    }

    /**
     * Get connection by ID
     */
    static async getConnection(connectionId: string, userId: string): Promise<IVercelConnection | null> {
        return VercelConnection.findOne({ _id: connectionId, userId });
    }

    /**
     * Disconnect Vercel account
     */
    static async disconnectConnection(connectionId: string, userId: string): Promise<void> {
        const connection = await VercelConnection.findOne({ _id: connectionId, userId });
        if (!connection) {
            throw new Error('Vercel connection not found');
        }

        // Mark as inactive (soft delete)
        connection.isActive = false;
        await connection.save();

        loggingService.info('Disconnected Vercel connection', {
            userId,
            connectionId,
            vercelUsername: connection.vercelUsername
        });
    }

    /**
     * Sync projects from Vercel
     */
    static async syncProjects(connectionId: string): Promise<IVercelProject[]> {
        loggingService.info('Starting Vercel project sync', { connectionId });
        
        const data = await this.apiRequest<{ projects: VercelProject[] }>(
            connectionId,
            '/v9/projects'
        );

        loggingService.info('Received Vercel API response', {
            connectionId,
            projectCount: data.projects?.length || 0,
            firstProject: data.projects?.[0] ? {
                id: data.projects[0].id,
                name: data.projects[0].name,
                framework: data.projects[0].framework
            } : null
        });

        const projects: IVercelProject[] = data.projects.map(p => ({
            id: p.id,
            name: p.name,
            framework: p.framework,
            latestDeployment: p.latestDeployments?.[0] ? {
                id: p.latestDeployments[0].uid,
                url: p.latestDeployments[0].url,
                state: p.latestDeployments[0].state,
                createdAt: new Date(p.latestDeployments[0].createdAt)
            } : undefined,
            targets: p.targets,
            createdAt: new Date(p.createdAt),
            updatedAt: new Date(p.updatedAt)
        }));

        // Update cached projects
        await VercelConnection.findByIdAndUpdate(connectionId, {
            projects,
            lastSyncedAt: new Date()
        }, { new: true });

        loggingService.info('Synced Vercel projects', {
            connectionId,
            projectCount: projects.length,
            projectNames: projects.map(p => p.name)
        });

        return projects;
    }

    /**
     * Get all projects
     */
    static async getProjects(connectionId: string, refresh = false): Promise<IVercelProject[]> {
        if (refresh) {
            const syncedProjects = await this.syncProjects(connectionId);
            loggingService.info('getProjects after sync', {
                connectionId,
                refresh: true,
                projectCount: syncedProjects.length,
                projectNames: syncedProjects.map(p => p.name)
            });
            return syncedProjects;
        }

        const connection = await VercelConnection.findById(connectionId);
        if (!connection) {
            throw new Error('Vercel connection not found');
        }

        // If projects are stale (older than 5 minutes), refresh
        if (!connection.lastSyncedAt || 
            Date.now() - connection.lastSyncedAt.getTime() > 5 * 60 * 1000) {
            return this.syncProjects(connectionId);
        }

        return connection.projects;
    }

    /**
     * Get project details
     */
    static async getProject(connectionId: string, projectId: string): Promise<VercelProject> {
        return this.apiRequest<VercelProject>(connectionId, `/v9/projects/${projectId}`);
    }

    /**
     * Get deployments for a project
     */
    static async getDeployments(
        connectionId: string,
        projectId: string,
        limit = 20
    ): Promise<VercelDeployment[]> {
        const data = await this.apiRequest<{ deployments: VercelDeployment[] }>(
            connectionId,
            `/v6/deployments?projectId=${projectId}&limit=${limit}`
        );
        return data.deployments;
    }

    /**
     * Get deployment details
     */
    static async getDeployment(connectionId: string, deploymentId: string): Promise<VercelDeployment> {
        return this.apiRequest<VercelDeployment>(connectionId, `/v13/deployments/${deploymentId}`);
    }

    /**
     * Get deployment logs
     */
    static async getDeploymentLogs(connectionId: string, deploymentId: string): Promise<string[]> {
        const data = await this.apiRequest<{ logs: Array<{ text: string; created: number }> }>(
            connectionId,
            `/v2/deployments/${deploymentId}/events`
        );
        return data.logs.map(log => log.text);
    }

    /**
     * Trigger a new deployment
     */
    static async triggerDeployment(
        connectionId: string,
        projectId: string,
        options?: DeploymentOptions
    ): Promise<VercelDeployment> {
        const project = await this.getProject(connectionId, projectId);
        
        const body: any = {
            name: options?.name || project.name,
            target: options?.target || 'preview'
        };

        if (options?.gitSource) {
            body.gitSource = options.gitSource;
        }

        return this.apiRequest<VercelDeployment>(
            connectionId,
            '/v13/deployments',
            {
                method: 'POST',
                body: JSON.stringify(body)
            }
        );
    }

    /**
     * Promote deployment to production
     */
    static async promoteDeployment(connectionId: string, deploymentId: string): Promise<VercelDeployment> {
        const deployment = await this.getDeployment(connectionId, deploymentId);
        
        return this.apiRequest<VercelDeployment>(
            connectionId,
            `/v10/projects/${deployment.name}/promote/${deploymentId}`,
            { method: 'POST' }
        );
    }

    /**
     * Rollback to a previous deployment
     */
    static async rollbackDeployment(
        connectionId: string,
        projectId: string,
        deploymentId: string
    ): Promise<VercelDeployment> {
        // Get the deployment to rollback to
        const deployment = await this.getDeployment(connectionId, deploymentId);
        
        // Use projectId: Fetch project info for demonstration/logging (even though not strictly needed for Vercel promote, but to use argument)
        const project = await this.getProject(connectionId, projectId);

        loggingService.info('Rolling back deployment', {
            connectionId,
            projectId,
            deploymentId,
            deploymentName: deployment.name,
            projectName: project.name
        });

        // Create a new deployment that promotes the old one
        return this.promoteDeployment(connectionId, deploymentId);
    }

    /**
     * Cancel a deployment
     */
    static async cancelDeployment(connectionId: string, deploymentId: string): Promise<void> {
        await this.apiRequest(
            connectionId,
            `/v12/deployments/${deploymentId}/cancel`,
            { method: 'PATCH' }
        );

        loggingService.info('Cancelled Vercel deployment', {
            connectionId,
            deploymentId
        });
    }

    /**
     * Get domains for a project
     */
    static async getDomains(connectionId: string, projectId: string): Promise<VercelDomain[]> {
        const data = await this.apiRequest<{ domains: VercelDomain[] }>(
            connectionId,
            `/v9/projects/${projectId}/domains`
        );
        return data.domains;
    }

    /**
     * Add domain to a project
     */
    static async addDomain(
        connectionId: string,
        projectId: string,
        domain: string
    ): Promise<VercelDomain> {
        const result = await this.apiRequest<VercelDomain>(
            connectionId,
            `/v10/projects/${projectId}/domains`,
            {
                method: 'POST',
                body: JSON.stringify({ name: domain })
            }
        );

        loggingService.info('Added domain to Vercel project', {
            connectionId,
            projectId,
            domain
        });

        return result;
    }

    /**
     * Remove domain from a project
     */
    static async removeDomain(
        connectionId: string,
        projectId: string,
        domain: string
    ): Promise<void> {
        await this.apiRequest(
            connectionId,
            `/v9/projects/${projectId}/domains/${domain}`,
            { method: 'DELETE' }
        );

        loggingService.info('Removed domain from Vercel project', {
            connectionId,
            projectId,
            domain
        });
    }

    /**
     * Get environment variables for a project (names only, not values)
     */
    static async getEnvVars(connectionId: string, projectId: string): Promise<VercelEnvVar[]> {
        const data = await this.apiRequest<{ envs: VercelEnvVar[] }>(
            connectionId,
            `/v9/projects/${projectId}/env`
        );
        // Strip values for security
        return data.envs.map(env => ({
            ...env,
            value: undefined
        }));
    }

    /**
     * Set environment variable
     */
    static async setEnvVar(
        connectionId: string,
        projectId: string,
        key: string,
        value: string,
        target: Array<'production' | 'preview' | 'development'> = ['production', 'preview', 'development'],
        type: 'plain' | 'secret' | 'encrypted' = 'encrypted'
    ): Promise<VercelEnvVar> {
        // Check if env var exists
        const existingEnvs = await this.apiRequest<{ envs: VercelEnvVar[] }>(
            connectionId,
            `/v9/projects/${projectId}/env`
        );
        const existing = existingEnvs.envs.find(e => e.key === key);

        if (existing) {
            // Update existing
            return this.apiRequest<VercelEnvVar>(
                connectionId,
                `/v9/projects/${projectId}/env/${existing.id}`,
                {
                    method: 'PATCH',
                    body: JSON.stringify({ value, target, type })
                }
            );
        } else {
            // Create new
            return this.apiRequest<VercelEnvVar>(
                connectionId,
                `/v10/projects/${projectId}/env`,
                {
                    method: 'POST',
                    body: JSON.stringify({ key, value, target, type })
                }
            );
        }
    }

    /**
     * Delete environment variable
     */
    static async deleteEnvVar(
        connectionId: string,
        projectId: string,
        envVarId: string
    ): Promise<void> {
        await this.apiRequest(
            connectionId,
            `/v9/projects/${projectId}/env/${envVarId}`,
            { method: 'DELETE' }
        );

        loggingService.info('Deleted environment variable', {
            connectionId,
            projectId,
            envVarId
        });
    }

    /**
     * Get usage analytics
     */
    static async getUsage(connectionId: string): Promise<any> {
        return this.apiRequest(connectionId, '/v1/usage');
    }

    /**
     * Validate state token (for testing)
     * Now uses Redis instead of in-memory storage
     */
    static async validateStateToken(state: string): Promise<{ userId: string } | null> {
        const stateData = await redisService.get(`${VERCEL_STATE_KEY_PREFIX}${state}`) as { userId: string; createdAt: number } | null;
        if (!stateData) {
            return null;
        }
        return { userId: stateData.userId };
    }
}

export default VercelService;
