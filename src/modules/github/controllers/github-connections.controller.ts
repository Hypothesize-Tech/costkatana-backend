import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  UseGuards,
  Header,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { GithubOAuthApiService } from '../services/github-oauth-api.service';
import { GithubCacheInvalidationService } from '../services/github-cache-invalidation.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GitHubConnection } from '../../../schemas/integration/github-connection.schema';

@Controller('api/github')
export class GithubConnectionsController {
  private readonly logger = new Logger(GithubConnectionsController.name);

  constructor(
    @InjectModel(GitHubConnection.name)
    private readonly connectionModel: Model<GitHubConnection>,
    private readonly githubOAuthApiService: GithubOAuthApiService,
    private readonly githubCacheInvalidationService: GithubCacheInvalidationService,
  ) {}

  /**
   * List user's GitHub connections
   * GET /api/github/connections
   * Cache-Control prevents stale data after disconnect
   */
  @Get('connections')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  @UseGuards(JwtAuthGuard)
  async listConnections(@CurrentUser() user: any) {
    try {
      this.logger.log('Listing GitHub connections', { userId: user.id });

      const connections = await this.connectionModel
        .find({ userId: user.id, isActive: true })
        .select('-accessToken -refreshToken') // Exclude sensitive data
        .sort({ createdAt: -1 })
        .exec();

      const formattedConnections = connections.map((conn) => ({
        id: conn._id.toString(),
        type: conn.tokenType,
        username: conn.githubUsername ?? conn.login ?? conn.username,
        avatarUrl: conn.avatarUrl,
        installationId: conn.installationId,
        scopes: conn.scope ? [conn.scope] : [], // Convert scope string to array
        isActive: conn.isActive,
        lastUsed: conn.updatedAt, // Use updatedAt as lastUsed approximation
        createdAt: conn.createdAt,
        updatedAt: conn.updatedAt,
      }));

      this.logger.log('GitHub connections listed successfully', {
        userId: user.id,
        count: formattedConnections.length,
      });

      return {
        success: true,
        data: formattedConnections,
        count: formattedConnections.length,
      };
    } catch (error: any) {
      this.logger.error('Failed to list GitHub connections', {
        userId: user.id,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get repositories for a specific connection
   * GET /api/github/connections/:connectionId/repositories
   */
  @Get('connections/:connectionId/repositories')
  @UseGuards(JwtAuthGuard)
  async getRepositories(
    @CurrentUser() user: any,
    @Param('connectionId') connectionId: string,
    @Query('refresh') refresh?: string,
  ) {
    try {
      this.logger.log('Getting repositories for connection', {
        userId: user.id,
        connectionId,
      });

      // Find the connection
      const connection = await this.connectionModel.findOne({
        _id: connectionId,
        userId: user.id,
        isActive: true,
      });

      if (!connection) {
        throw new NotFoundException('GitHub connection not found');
      }

      let repositories: any[] = connection.repositories || [];

      // Optionally refresh repositories from GitHub
      if (refresh === 'true') {
        try {
          this.logger.log('Refreshing repositories from GitHub', {
            userId: user.id,
            connectionId,
          });

          const freshRepositories =
            await this.githubOAuthApiService.listUserRepositories(connection);

          // Update connection with fresh repository data
          connection.repositories = freshRepositories;
          connection.lastSyncedAt = new Date();
          await connection.save();

          repositories = freshRepositories;

          // Invalidate repository caches since we have fresh data
          if (freshRepositories.length > 0) {
            const repositoriesForCache = freshRepositories.map((repo: any) => ({
              fullName: repo.fullName || repo.name,
              branch: repo.defaultBranch || 'main',
            }));

            try {
              await this.githubCacheInvalidationService.invalidateRepositoriesCache(
                repositoriesForCache,
              );
              this.logger.log('Invalidated repository caches after refresh', {
                userId: user.id,
                connectionId,
                repositoryCount: repositoriesForCache.length,
              });
            } catch (cacheError: any) {
              // Log but don't fail the request
              this.logger.warn(
                'Failed to invalidate repository caches after refresh',
                {
                  userId: user.id,
                  connectionId,
                  error: cacheError.message,
                },
              );
            }
          }

          this.logger.log('Successfully refreshed repositories from GitHub', {
            userId: user.id,
            connectionId,
            repositoryCount: freshRepositories.length,
          });
        } catch (refreshError: any) {
          this.logger.error('Failed to refresh repositories from GitHub', {
            userId: user.id,
            connectionId,
            error: refreshError.message,
          });

          // Continue with cached repositories if refresh fails
          repositories = connection.repositories || [];

          this.logger.log('Using cached repositories due to refresh failure', {
            userId: user.id,
            connectionId,
            cachedRepositoryCount: repositories.length,
          });
        }
      }

      // Update last used timestamp
      await this.connectionModel.findByIdAndUpdate(connectionId, {
        updatedAt: new Date(),
      });

      this.logger.log('Repositories retrieved successfully', {
        userId: user.id,
        connectionId,
        repositoryCount: repositories.length,
      });

      return {
        connection: {
          id: connection._id.toString(),
          username:
            connection.githubUsername ??
            connection.login ??
            connection.username,
          type: connection.tokenType,
        },
        repositories,
        total: repositories.length,
        lastSynced: connection.lastSyncedAt,
        refreshed: refresh === 'true',
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error('Failed to get repositories for connection', {
        userId: user.id,
        connectionId,
        error: error.message,
        stack: error.stack,
      });

      // Check if it's an authentication error
      if (
        error.message?.includes('Bad credentials') ||
        error.message?.includes('token') ||
        error.status === 401
      ) {
        // Mark connection as inactive
        await this.connectionModel.findByIdAndUpdate(connectionId, {
          isActive: false,
          lastError: error.message,
        });

        throw new Error(
          'GitHub connection is no longer valid. Please reconnect your account.',
        );
      }

      throw error;
    }
  }

  /**
   * Disconnect a GitHub connection
   * DELETE /api/github/connections/:connectionId
   */
  @Delete('connections/:connectionId')
  @UseGuards(JwtAuthGuard)
  async disconnectConnection(
    @CurrentUser() user: any,
    @Param('connectionId') connectionId: string,
  ) {
    try {
      this.logger.log('Disconnecting GitHub connection', {
        userId: user.id,
        connectionId,
      });

      // Find and update the connection
      const connection = await this.connectionModel.findOneAndUpdate(
        {
          _id: connectionId,
          userId: user.id,
          isActive: true,
        },
        {
          isActive: false,
          updatedAt: new Date(),
        },
        { new: true },
      );

      if (!connection) {
        throw new NotFoundException('GitHub connection not found');
      }

      // If it's a GitHub App installation, we might want to revoke it on GitHub's side
      // This would require additional API calls to GitHub

      // Invalidate related caches
      try {
        // Invalidate user cache
        await this.githubCacheInvalidationService.invalidateUserCache(user.id);

        // Invalidate caches for all repositories that were accessible through this connection
        if (
          connection.repositories &&
          Array.isArray(connection.repositories) &&
          connection.repositories.length > 0
        ) {
          const repositories = connection.repositories.map((repo: any) => ({
            fullName: repo.fullName || repo.name,
            branch: repo.defaultBranch || 'main',
          }));

          await this.githubCacheInvalidationService.invalidateRepositoriesCache(
            repositories,
          );

          this.logger.log(
            'Invalidated repository caches for disconnected connection',
            {
              userId: user.id,
              connectionId,
              repositoryCount: repositories.length,
            },
          );
        }
      } catch (cacheError: any) {
        // Log cache invalidation errors but don't fail the disconnection
        this.logger.warn('Failed to invalidate caches during disconnection', {
          userId: user.id,
          connectionId,
          error: cacheError.message,
        });
      }

      this.logger.log('GitHub connection disconnected successfully', {
        userId: user.id,
        connectionId,
        username: connection.githubUsername ?? connection.username,
        type: connection.tokenType,
      });

      return {
        success: true,
        message: 'GitHub connection disconnected successfully',
        connection: {
          id: connection._id.toString(),
          username:
            connection.githubUsername ??
            connection.login ??
            connection.username,
          type: connection.tokenType,
          disconnectedAt: connection.updatedAt,
        },
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error('Failed to disconnect GitHub connection', {
        userId: user.id,
        connectionId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Get connection details
   * GET /api/github/connections/:connectionId
   */
  @Get('connections/:connectionId')
  @UseGuards(JwtAuthGuard)
  async getConnection(
    @CurrentUser() user: any,
    @Param('connectionId') connectionId: string,
  ) {
    try {
      this.logger.log('Getting GitHub connection details', {
        userId: user.id,
        connectionId,
      });

      const connection = await this.connectionModel
        .findOne({
          _id: connectionId,
          userId: user.id,
        })
        .select('-accessToken -refreshToken'); // Exclude sensitive data

      if (!connection) {
        throw new NotFoundException('GitHub connection not found');
      }

      this.logger.log('GitHub connection details retrieved', {
        userId: user.id,
        connectionId,
        username: connection.githubUsername ?? connection.username,
        type: connection.tokenType,
        isActive: connection.isActive,
      });

      return {
        connection: {
          id: connection._id.toString(),
          type: connection.tokenType,
          username:
            connection.githubUsername ??
            connection.login ??
            connection.username,
          avatarUrl: connection.avatarUrl,
          installationId: connection.installationId,
          scopes: connection.scope ? [connection.scope] : [],
          isActive: connection.isActive,
          lastUsed: connection.updatedAt,
          lastError: null, // Not available in schema
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
          disconnectedAt: connection.updatedAt,
        },
      };
    } catch (error: any) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error('Failed to get GitHub connection details', {
        userId: user.id,
        connectionId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }
}
