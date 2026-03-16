import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { firstValueFrom } from 'rxjs';
import { GitHubConnection } from '../../schemas/integration/github-connection.schema';
import { Integration } from '../../schemas/integration/integration.schema';
import { McpPermissionService } from '../mcp/services/mcp-permission.service';

interface GitHubUser {
  id: number;
  login: string;
  email: string | null;
  name: string | null;
  avatar_url: string;
  bio: string | null;
  company: string | null;
  location: string | null;
  html_url: string;
}

interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string | null;
  language: string | null;
  updated_at: string;
  size: number;
}

@Injectable()
export class GitHubIntegrationService {
  private readonly logger = new Logger(GitHubIntegrationService.name);

  constructor(
    private readonly httpService: HttpService,
    @InjectModel(GitHubConnection.name)
    private readonly githubConnectionModel: Model<GitHubConnection>,
    @InjectModel(Integration.name)
    private readonly integrationModel: Model<Integration>,
    private readonly mcpPermissionService: McpPermissionService,
  ) {}

  /**
   * Setup GitHub connection for user
   */
  async setupConnection(
    userId: string,
    accessToken: string,
    isLinkingFlow: boolean = false,
  ): Promise<{ connectionId: string; userInfo: GitHubUser }> {
    try {
      this.logger.debug(
        `Setting up GitHub connection for user: ${userId}, linking: ${isLinkingFlow}`,
      );

      // Get authenticated user info
      const userInfo = await this.getGitHubUserInfo(accessToken);

      // Upsert GitHub connection (encryption happens in pre-save hook)
      const connection = await this.githubConnectionModel.findOneAndUpdate(
        { userId },
        {
          $set: {
            githubId: userInfo.id,
            username: userInfo.login,
            email: userInfo.email,
            name: userInfo.name,
            avatarUrl: userInfo.avatar_url,
            bio: userInfo.bio,
            company: userInfo.company,
            location: userInfo.location,
            profileUrl: userInfo.html_url,
            accessToken, // Will be encrypted by pre-save hook
            isActive: true,
            lastSyncAt: new Date(),
            syncedAt: new Date(),
          },
          $setOnInsert: {
            userId,
            connectedAt: new Date(),
          },
        },
        {
          upsert: true,
          new: true,
          runValidators: true,
        },
      );

      this.logger.debug(`GitHub connection upserted: ${connection._id}`);

      // Sync repositories in background
      this.syncRepositories(connection._id.toString(), accessToken).catch(
        (error) => {
          this.logger.error(
            'Failed to sync GitHub repositories:',
            error instanceof Error ? error.message : String(error),
          );
        },
      );

      // Create/update integration record
      await this.integrationModel.findOneAndUpdate(
        { userId, type: 'github_oauth' },
        {
          $set: {
            name: 'GitHub',
            description: `Connected GitHub account @${userInfo.login}`,
            status: 'active',
            metadata: {
              githubId: userInfo.id,
              username: userInfo.login,
              profileUrl: userInfo.html_url,
              connectedAt: new Date(),
            },
            lastUsedAt: new Date(),
            updatedAt: new Date(),
          },
          $setOnInsert: {
            userId,
            type: 'github_oauth',
            createdAt: new Date(),
          },
        },
        { upsert: true, new: true },
      );

      // Grant MCP permissions
      await this.mcpPermissionService.grantPermissionsForNewConnection(
        userId,
        'github',
        connection._id.toString(),
      );

      this.logger.log(`GitHub connection setup completed for user: ${userId}`);

      return {
        connectionId: connection._id.toString(),
        userInfo,
      };
    } catch (error) {
      this.logger.error(
        'Error setting up GitHub connection:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Verify if user has an active GitHub connection
   */
  async verifyConnection(userId: string): Promise<boolean> {
    try {
      const connection = await this.githubConnectionModel.findOne({
        userId,
        isActive: true,
      });

      return !!connection;
    } catch (error) {
      this.logger.error(
        'Error verifying GitHub connection:',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  /**
   * Get GitHub user info from API
   */
  private async getGitHubUserInfo(accessToken: string): Promise<GitHubUser> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<GitHubUser>('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'User-Agent': 'CostKatana/1.0',
            Accept: 'application/vnd.github.v3+json',
          },
          timeout: 10000,
        }),
      );

      // If no email in user response, try to get it from emails endpoint
      let email = response.data.email;
      if (!email) {
        try {
          const emailsResponse = await firstValueFrom(
            this.httpService.get<
              Array<{ email: string; primary: boolean; verified: boolean }>
            >('https://api.github.com/user/emails', {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'User-Agent': 'CostKatana/1.0',
                Accept: 'application/vnd.github.v3+json',
              },
              timeout: 5000,
            }),
          );

          const primaryEmail = emailsResponse.data.find(
            (e) => e.primary && e.verified,
          );
          email = primaryEmail?.email || null;
        } catch (emailError) {
          this.logger.warn(
            'Failed to fetch GitHub user emails:',
            emailError instanceof Error
              ? emailError.message
              : String(emailError),
          );
        }
      }

      return {
        ...response.data,
        email,
      };
    } catch (error) {
      this.logger.error(
        'Error fetching GitHub user info:',
        error instanceof Error ? error.message : String(error),
      );
      throw new Error('Failed to fetch GitHub user information');
    }
  }

  /**
   * Sync GitHub repositories for a connection
   */
  private async syncRepositories(
    connectionId: string,
    accessToken: string,
  ): Promise<void> {
    try {
      this.logger.debug(`Syncing repositories for connection: ${connectionId}`);

      const response = await firstValueFrom(
        this.httpService.get<GitHubRepository[]>(
          'https://api.github.com/user/repos',
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'User-Agent': 'CostKatana/1.0',
              Accept: 'application/vnd.github.v3+json',
            },
            params: {
              sort: 'updated',
              direction: 'desc',
              per_page: 50, // Limit to recent repositories
            },
            timeout: 15000,
          },
        ),
      );

      const repositories = response.data.map((repo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        isPrivate: repo.private,
        url: repo.html_url,
        description: repo.description,
        language: repo.language,
        updatedAt: new Date(repo.updated_at),
        size: repo.size,
        syncedAt: new Date(),
      }));

      // Update connection with repositories
      await this.githubConnectionModel.findByIdAndUpdate(connectionId, {
        $set: {
          repositories,
          lastSyncAt: new Date(),
        },
      });

      this.logger.debug(
        `Synced ${repositories.length} repositories for connection: ${connectionId}`,
      );
    } catch (error) {
      this.logger.error(
        'Error syncing GitHub repositories:',
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }
}
