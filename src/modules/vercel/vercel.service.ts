import {
  Injectable,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  VercelConnection,
  IVercelProject,
} from '../../schemas/integration/vercel-connection.schema';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { CacheService } from '../../common/cache/cache.service';
import { LoggerService } from '../../common/logger/logger.service';
import { McpPermissionService } from '../mcp/services/mcp-permission.service';
import { VercelProjectResponseDto } from './dto/vercel.dto';
import crypto from 'crypto';

// Vercel API base URL
const VERCEL_API_BASE = 'https://api.vercel.com';
const VERCEL_OAUTH_BASE = 'https://vercel.com';

// Redis key prefix for Vercel OAuth state tokens (legacy cache-backed state)
const VERCEL_STATE_KEY_PREFIX = 'vercel:oauth:state:';

/** TTL for OAuth state (cache and JWT) - 10 minutes */
const OAUTH_STATE_TTL_SECONDS = 600;

// OAuth configuration interface
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
  state:
    | 'BUILDING'
    | 'ERROR'
    | 'INITIALIZING'
    | 'QUEUED'
    | 'READY'
    | 'CANCELED';
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

@Injectable()
export class VercelService {
  private readonly config: VercelOAuthConfig;

  constructor(
    @InjectModel(VercelConnection.name)
    private readonly vercelConnectionModel: Model<VercelConnection>,
    private readonly encryptionService: EncryptionService,
    private readonly cacheService: CacheService,
    private readonly jwtService: JwtService,
    private readonly loggerService: LoggerService,
    private readonly configService: ConfigService,
    private readonly mcpPermissionService: McpPermissionService,
  ) {
    this.config = {
      clientId: this.configService.get<string>('VERCEL_CLIENT_ID') ?? '',
      clientSecret:
        this.configService.get<string>('VERCEL_CLIENT_SECRET') ?? '',
      callbackUrl:
        this.configService.getOrThrow<string>('VERCEL_CALLBACK_URL'),
    };
  }

  /**
   * Generate OAuth authorization URL with state token.
   * Uses signed JWT as primary state (works without Redis). Also stores in cache when Redis
   * is available for one-time invalidation and backward compatibility.
   *
   * For Vercel Integrations, we use the standard OAuth authorize endpoint
   * with client_id, redirect_uri, and state parameters.
   */
  async initiateOAuth(userId: string): Promise<string> {
    // Primary: signed JWT state - works without Redis, supports multi-instance deployments
    const statePayload = {
      userId,
      nonce: crypto.randomBytes(16).toString('hex'),
    };
    const jwtSecret = this.configService.getOrThrow<string>('JWT_SECRET');
    const state = this.jwtService.sign(statePayload, {
      secret: jwtSecret,
      expiresIn: OAUTH_STATE_TTL_SECONDS,
    });

    // Optional: store in cache for one-time use when Redis is available
    const stateData = { userId, createdAt: Date.now() };
    await this.cacheService
      .set(
        `${VERCEL_STATE_KEY_PREFIX}${state}`,
        stateData,
        OAUTH_STATE_TTL_SECONDS,
      )
      .catch(() => {
        // Ignore cache failures - JWT fallback will work
      });

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.callbackUrl,
      state: state,
    });

    const authUrl = `${VERCEL_OAUTH_BASE}/integrations/${this.config.clientId}/new?${params.toString()}`;

    this.loggerService.info('Generated Vercel OAuth URL', {
      userId,
      statePrefix: state.substring(0, 12) + '...',
      clientId: this.config.clientId,
      redirectUri: this.config.callbackUrl,
    });

    return authUrl;
  }

  /**
   * Handle OAuth callback - exchange code for token.
   * Validates state via: (1) Cache when Redis works, (2) Signed JWT fallback when cache fails.
   */
  async handleCallback(code: string, state: string): Promise<VercelConnection> {
    let userId: string | null = null;

    // 1. Try cache first (when Redis works - supports one-time invalidation)
    const stateData = await this.cacheService
      .get<{
        userId: string;
        createdAt: number;
      }>(`${VERCEL_STATE_KEY_PREFIX}${state}`)
      .catch(() => null);

    if (stateData?.userId) {
      userId = stateData.userId;
      await this.cacheService.del(`${VERCEL_STATE_KEY_PREFIX}${state}`);
    }

    // 2. Fallback: verify state as signed JWT (works when Redis is down or cache miss)
    if (!userId) {
      const jwtSecret =
        this.configService.getOrThrow<string>('JWT_SECRET');
      try {
        const payload = this.jwtService.verify<{
          userId: string;
          nonce?: string;
        }>(state, { secret: jwtSecret });
        if (payload?.userId) {
          userId = payload.userId;
        }
      } catch {
        // JWT invalid or expired - fall through to error
      }
    }

    if (!userId) {
      this.loggerService.error('Vercel OAuth state validation failed', {
        statePrefix: state?.substring(0, 12) + '...',
        reason: 'State not found in cache and JWT verification failed',
      });
      throw new BadRequestException(
        'Invalid or expired state token. Please try connecting again from the integrations page.',
      );
    }

    try {
      // Exchange code for access token
      const tokenResponse = await fetch(
        `${VERCEL_API_BASE}/v2/oauth/access_token`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            code: code,
            redirect_uri: this.config.callbackUrl,
          }).toString(),
        },
      );

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        this.loggerService.error('Failed to exchange Vercel OAuth code', {
          status: tokenResponse.status,
          error: errorText,
        });
        throw new InternalServerErrorException(
          'Failed to exchange authorization code for access token',
        );
      }

      const tokenData =
        (await tokenResponse.json()) as VercelOAuthTokenResponse;

      // Get user information
      const userInfo = await this.getUserInfo(tokenData.access_token);

      // Get team information if team_id is present
      let teamInfo: VercelTeam | undefined;
      if (tokenData.team_id) {
        teamInfo = await this.getTeamInfo(
          tokenData.access_token,
          tokenData.team_id,
        );
      }

      const connectionName = this.deriveVercelConnectionName(
        userInfo,
        teamInfo,
      );

      // Check for existing connection
      let connection = await this.vercelConnectionModel
        .findOne({
          userId,
          vercelUserId: userInfo.id,
        })
        .select('+encryptedAccessToken');

      if (connection) {
        // Update existing connection
        // Encrypt token using GCM
        const encryptedToken = this.encryptionService.encryptGCM(
          tokenData.access_token,
        );

        connection.encryptedAccessToken = `${encryptedToken.iv}:${encryptedToken.authTag}:${encryptedToken.encrypted}`;
        connection.tokenType = tokenData.token_type;
        connection.name = connectionName;
        connection.vercelUsername = userInfo.username;
        connection.vercelEmail = userInfo.email;
        connection.avatarUrl = userInfo.avatar;
        connection.teamId = tokenData.team_id;
        connection.teamSlug = teamInfo?.slug;
        connection.teamName = teamInfo?.name;
        connection.team = teamInfo
          ? {
              id: teamInfo.id,
              slug: teamInfo.slug,
              name: teamInfo.name,
              avatar: teamInfo.avatar,
            }
          : undefined;
        connection.status = 'active';
        connection.lastSyncedAt = new Date();
        await connection.save();

        this.loggerService.info('Updated existing Vercel connection', {
          userId,
          vercelUsername: userInfo.username,
          connectionId: connection._id.toString(),
        });
      } else {
        // Create new connection
        const encryptedToken = this.encryptionService.encryptGCM(
          tokenData.access_token,
        );

        connection = new this.vercelConnectionModel({
          userId,
          name: connectionName,
          encryptedAccessToken: `${encryptedToken.iv}:${encryptedToken.authTag}:${encryptedToken.encrypted}`,
          tokenType: tokenData.token_type,
          vercelUserId: userInfo.id,
          vercelUsername: userInfo.username,
          vercelEmail: userInfo.email,
          avatarUrl: userInfo.avatar,
          teamId: tokenData.team_id,
          teamSlug: teamInfo?.slug,
          teamName: teamInfo?.name,
          team: teamInfo
            ? {
                id: teamInfo.id,
                slug: teamInfo.slug,
                name: teamInfo.name,
                avatar: teamInfo.avatar,
              }
            : undefined,
          status: 'active',
          lastSyncedAt: new Date(),
        });
        await connection.save();

        this.loggerService.info('Created new Vercel connection', {
          userId,
          vercelUsername: userInfo.username,
          connectionId: connection._id.toString(),
        });

        // Auto-grant MCP permissions for new connection
        await this.mcpPermissionService.grantPermissionsForNewConnection(
          userId,
          'vercel',
          connection._id.toString(),
        );
      }

      // Sync projects
      await this.syncProjects(connection._id.toString());

      return connection;
    } catch (error: any) {
      this.loggerService.error('Vercel OAuth callback failed', {
        userId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Display name for the stored connection (schema requires `name`).
   */
  private deriveVercelConnectionName(
    userInfo: VercelUser,
    teamInfo?: VercelTeam,
  ): string {
    if (teamInfo?.name?.trim()) {
      return teamInfo.name.trim();
    }
    const fromUser =
      [userInfo.name, userInfo.username].find(
        (s) => typeof s === 'string' && s.trim().length > 0,
      ) ||
      userInfo.email?.split('@')[0] ||
      '';
    return fromUser || 'Vercel';
  }

  /**
   * Get user information from Vercel
   */
  private async getUserInfo(accessToken: string): Promise<VercelUser> {
    const response = await fetch(`${VERCEL_API_BASE}/v2/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        'Failed to fetch Vercel user information',
      );
    }

    const data = (await response.json()) as {
      user: {
        id: string;
        email: string;
        name: string;
        username: string;
        avatar?: string;
      };
    };
    return {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      username: data.user.username,
      avatar: data.user.avatar,
    };
  }

  /**
   * Get team information from Vercel
   */
  private async getTeamInfo(
    accessToken: string,
    teamId: string,
  ): Promise<VercelTeam> {
    const response = await fetch(`${VERCEL_API_BASE}/v2/teams/${teamId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        'Failed to fetch Vercel team information',
      );
    }

    const data = (await response.json()) as {
      id: string;
      slug: string;
      name: string;
      avatar?: string;
    };
    return {
      id: data.id,
      slug: data.slug,
      name: data.name,
      avatar: data.avatar,
    };
  }

  /**
   * Get decrypted access token from connection
   */
  private async getAccessToken(connectionId: string): Promise<string> {
    const connection = await this.vercelConnectionModel
      .findById(connectionId)
      .select('+encryptedAccessToken');
    if (!connection) {
      throw new NotFoundException('Vercel connection not found');
    }
    if (
      connection.status !== 'active' &&
      connection.status !== 'pending_verification'
    ) {
      throw new BadRequestException('Vercel connection is not active');
    }

    const token = connection.encryptedAccessToken;
    if (!token || typeof token !== 'string') {
      this.loggerService.error('Vercel connection has no access token', {
        connectionId,
      });
      throw new InternalServerErrorException(
        'Vercel connection has no access token. Please reconnect your Vercel account.',
      );
    }

    const parts = token.split(':');
    if (parts.length !== 3) {
      throw new InternalServerErrorException('Invalid access token format');
    }

    const [iv, authTag, encrypted] = parts;
    return this.encryptionService.decryptGCM(encrypted, iv, authTag);
  }

  /**
   * Make authenticated API request to Vercel
   */
  private async apiRequest<T>(
    connectionId: string,
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const accessToken = await this.getAccessToken(connectionId);

    const connection = await this.vercelConnectionModel.findById(connectionId);
    const teamParam = connection?.teamId ? `?teamId=${connection.teamId}` : '';
    const separator = endpoint.includes('?') ? '&' : '';
    const teamQuery = connection?.teamId
      ? `${separator}teamId=${connection.teamId}`
      : '';

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

    this.loggerService.info('Making Vercel API request', {
      connectionId,
      endpoint,
      url,
      method: options.method || 'GET',
      hasToken: !!accessToken,
      teamId: connection?.teamId,
    });

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.loggerService.error('Vercel API request failed', {
        endpoint: url,
        status: response.status,
        error: errorText,
      });
      throw new InternalServerErrorException(
        `Vercel API error: ${response.status} - ${errorText}`,
      );
    }

    const data = (await response.json()) as T;

    this.loggerService.info('Vercel API response received', {
      connectionId,
      endpoint,
      status: response.status,
      dataKeys: Object.keys(data as any),
      projectsLength: (data as any).projects?.length,
    });

    return data;
  }

  /**
   * List user's connections
   */
  async listConnections(userId: string): Promise<VercelConnection[]> {
    return this.vercelConnectionModel.find({ userId, isActive: true });
  }

  /**
   * Get connection by ID
   */
  async getConnection(
    connectionId: string,
    userId: string,
  ): Promise<VercelConnection | null> {
    return this.vercelConnectionModel.findOne({ _id: connectionId, userId });
  }

  /**
   * Disconnect Vercel account
   * Uses updateOne to avoid Mongoose validation on the full document,
   * which can fail when required fields (encryptedAccessToken, name) are
   * missing in corrupted or legacy connection records.
   */
  async disconnectConnection(
    connectionId: string,
    userId: string,
  ): Promise<void> {
    const result = await this.vercelConnectionModel.updateOne(
      { _id: connectionId, userId },
      { $set: { isActive: false } },
    );

    if (result.matchedCount === 0) {
      throw new NotFoundException('Vercel connection not found');
    }

    this.loggerService.info('Disconnected Vercel connection', {
      userId,
      connectionId,
    });
  }

  /**
   * Sync projects from Vercel
   */
  async syncProjects(connectionId: string): Promise<IVercelProject[]> {
    this.loggerService.info('Starting Vercel project sync', { connectionId });

    const data = await this.apiRequest<{ projects: VercelProject[] }>(
      connectionId,
      '/v9/projects',
    );

    this.loggerService.info('Received Vercel API response', {
      connectionId,
      projectCount: data.projects?.length || 0,
      firstProject: data.projects?.[0]
        ? {
            id: data.projects[0].id,
            name: data.projects[0].name,
            framework: data.projects[0].framework,
          }
        : null,
    });

    const projects: IVercelProject[] = data.projects.map((p) => ({
      id: p.id,
      name: p.name,
      framework: p.framework,
      latestDeployment: p.latestDeployments?.[0]
        ? {
            id: p.latestDeployments[0].uid,
            url: p.latestDeployments[0].url,
            state: p.latestDeployments[0].state,
            createdAt: new Date(p.latestDeployments[0].createdAt),
          }
        : undefined,
      targets: p.targets,
      createdAt: new Date(p.createdAt),
      updatedAt: new Date(p.updatedAt),
    }));

    // Update cached projects
    await this.vercelConnectionModel.findByIdAndUpdate(
      connectionId,
      {
        projects,
        lastSyncedAt: new Date(),
      },
      { new: true },
    );

    this.loggerService.info('Synced Vercel projects', {
      connectionId,
      projectCount: projects.length,
      projectNames: projects.map((p) => p.name),
    });

    return projects;
  }

  /**
   * Get all projects
   */
  async getProjects(
    connectionId: string,
    refresh = false,
  ): Promise<IVercelProject[]> {
    if (refresh) {
      const syncedProjects = await this.syncProjects(connectionId);
      this.loggerService.info('getProjects after sync', {
        connectionId,
        refresh: true,
        projectCount: syncedProjects.length,
        projectNames: syncedProjects.map((p) => p.name),
      });
      return syncedProjects;
    }

    const connection = await this.vercelConnectionModel.findById(connectionId);
    if (!connection) {
      throw new NotFoundException('Vercel connection not found');
    }

    // If projects are stale (older than 5 minutes), refresh
    if (
      !connection.lastSyncedAt ||
      Date.now() - connection.lastSyncedAt.getTime() > 5 * 60 * 1000
    ) {
      return this.syncProjects(connectionId);
    }

    return connection.projects;
  }

  /**
   * Get project details
   */
  async getProject(
    connectionId: string,
    projectId: string,
  ): Promise<VercelProjectResponseDto> {
    const project = await this.apiRequest<VercelProject>(
      connectionId,
      `/v9/projects/${projectId}`,
    );

    // Convert to match the expected response DTO format
    return {
      ...project,
      createdAt: new Date(project.createdAt),
      updatedAt: new Date(project.updatedAt),
      latestDeployment: project.latestDeployments?.[0]
        ? {
            id: project.latestDeployments[0].uid,
            url: project.latestDeployments[0].url,
            state: project.latestDeployments[0].state,
            createdAt: new Date(project.latestDeployments[0].createdAt),
          }
        : undefined,
    };
  }

  /**
   * Get deployments for a project
   */
  async getDeployments(
    connectionId: string,
    projectId: string,
    limit = 20,
  ): Promise<VercelDeployment[]> {
    const data = await this.apiRequest<{ deployments: VercelDeployment[] }>(
      connectionId,
      `/v6/deployments?projectId=${projectId}&limit=${limit}`,
    );
    return data.deployments;
  }

  /**
   * Get deployment details
   */
  async getDeployment(
    connectionId: string,
    deploymentId: string,
  ): Promise<VercelDeployment> {
    return this.apiRequest<VercelDeployment>(
      connectionId,
      `/v13/deployments/${deploymentId}`,
    );
  }

  /**
   * Get deployment logs
   */
  async getDeploymentLogs(
    connectionId: string,
    deploymentId: string,
  ): Promise<string[]> {
    const data = await this.apiRequest<{
      logs: Array<{ text: string; created: number }>;
    }>(connectionId, `/v2/deployments/${deploymentId}/events`);
    return data.logs.map((log) => log.text);
  }

  /**
   * Trigger a new deployment
   */
  async triggerDeployment(
    connectionId: string,
    projectId: string,
    options?: DeploymentOptions,
  ): Promise<VercelDeployment> {
    const project = await this.getProject(connectionId, projectId);

    const body: any = {
      name: options?.name || project.name,
      target: options?.target || 'preview',
    };

    if (options?.gitSource) {
      body.gitSource = options.gitSource;
    }

    return this.apiRequest<VercelDeployment>(connectionId, '/v13/deployments', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Promote deployment to production
   */
  async promoteDeployment(
    connectionId: string,
    deploymentId: string,
  ): Promise<VercelDeployment> {
    const deployment = await this.getDeployment(connectionId, deploymentId);

    return this.apiRequest<VercelDeployment>(
      connectionId,
      `/v10/projects/${deployment.name}/promote/${deploymentId}`,
      { method: 'POST' },
    );
  }

  /**
   * Rollback to a previous deployment
   */
  async rollbackDeployment(
    connectionId: string,
    projectId: string,
    deploymentId: string,
  ): Promise<VercelDeployment> {
    // Get the deployment to rollback to
    const deployment = await this.getDeployment(connectionId, deploymentId);

    // Use projectId: Fetch project info for demonstration/logging (even though not strictly needed for Vercel promote, but to use argument)
    const project = await this.getProject(connectionId, projectId);

    this.loggerService.info('Rolling back deployment', {
      connectionId,
      projectId,
      deploymentId,
      deploymentName: deployment.name,
      projectName: project.name,
    });

    // Create a new deployment that promotes the old one
    return this.promoteDeployment(connectionId, deploymentId);
  }

  /**
   * Cancel a deployment
   */
  async cancelDeployment(
    connectionId: string,
    deploymentId: string,
  ): Promise<void> {
    await this.apiRequest(
      connectionId,
      `/v12/deployments/${deploymentId}/cancel`,
      { method: 'PATCH' },
    );

    this.loggerService.info('Cancelled Vercel deployment', {
      connectionId,
      deploymentId,
    });
  }

  /**
   * Get domains for a project
   */
  async getDomains(
    connectionId: string,
    projectId: string,
  ): Promise<VercelDomain[]> {
    const data = await this.apiRequest<{ domains: VercelDomain[] }>(
      connectionId,
      `/v9/projects/${projectId}/domains`,
    );
    return data.domains;
  }

  /**
   * Add domain to a project
   */
  async addDomain(
    connectionId: string,
    projectId: string,
    domain: string,
  ): Promise<VercelDomain> {
    const result = await this.apiRequest<VercelDomain>(
      connectionId,
      `/v10/projects/${projectId}/domains`,
      {
        method: 'POST',
        body: JSON.stringify({ name: domain }),
      },
    );

    this.loggerService.info('Added domain to Vercel project', {
      connectionId,
      projectId,
      domain,
    });

    return result;
  }

  /**
   * Remove domain from a project
   */
  async removeDomain(
    connectionId: string,
    projectId: string,
    domain: string,
  ): Promise<void> {
    await this.apiRequest(
      connectionId,
      `/v9/projects/${projectId}/domains/${domain}`,
      { method: 'DELETE' },
    );

    this.loggerService.info('Removed domain from Vercel project', {
      connectionId,
      projectId,
      domain,
    });
  }

  /**
   * Get environment variables for a project (names only, not values)
   */
  async getEnvVars(
    connectionId: string,
    projectId: string,
  ): Promise<VercelEnvVar[]> {
    const data = await this.apiRequest<{ envs: VercelEnvVar[] }>(
      connectionId,
      `/v9/projects/${projectId}/env`,
    );
    // Strip values for security
    return data.envs.map((env) => ({
      ...env,
      value: undefined,
    }));
  }

  /**
   * Set environment variable
   */
  async setEnvVar(
    connectionId: string,
    projectId: string,
    key: string,
    value: string,
    target: Array<'production' | 'preview' | 'development'> = [
      'production',
      'preview',
      'development',
    ],
    type: 'plain' | 'secret' | 'encrypted' | 'system' = 'encrypted',
  ): Promise<VercelEnvVar> {
    // Check if env var exists
    const existingEnvs = await this.apiRequest<{ envs: VercelEnvVar[] }>(
      connectionId,
      `/v9/projects/${projectId}/env`,
    );
    const existing = existingEnvs.envs.find((e) => e.key === key);

    if (existing) {
      // Update existing
      return this.apiRequest<VercelEnvVar>(
        connectionId,
        `/v9/projects/${projectId}/env/${existing.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ value, target, type }),
        },
      );
    } else {
      // Create new
      return this.apiRequest<VercelEnvVar>(
        connectionId,
        `/v10/projects/${projectId}/env`,
        {
          method: 'POST',
          body: JSON.stringify({ key, value, target, type }),
        },
      );
    }
  }

  /**
   * Delete environment variable
   */
  async deleteEnvVar(
    connectionId: string,
    projectId: string,
    envVarId: string,
  ): Promise<void> {
    await this.apiRequest(
      connectionId,
      `/v9/projects/${projectId}/env/${envVarId}`,
      { method: 'DELETE' },
    );

    this.loggerService.info('Deleted environment variable', {
      connectionId,
      projectId,
      envVarId,
    });
  }

  /**
   * Get usage analytics
   */
  async getUsage(connectionId: string): Promise<any> {
    return this.apiRequest(connectionId, '/v1/usage');
  }

  /**
   * Validate state token (for testing)
   * Now uses CacheService instead of in-memory storage
   */
  async validateStateToken(state: string): Promise<{ userId: string } | null> {
    const stateData = await this.cacheService.get<{
      userId: string;
      createdAt: number;
    }>(`${VERCEL_STATE_KEY_PREFIX}${state}`);
    if (!stateData) {
      return null;
    }
    return { userId: stateData.userId };
  }
}
