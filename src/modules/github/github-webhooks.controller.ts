import {
  Controller,
  Post,
  Body,
  Headers,
  Logger,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { IncrementalIndexService } from './incremental-index.service';
import { GitHubService } from './github.service';
import {
  GitHubConnection,
  GitHubConnectionDocument,
} from '../../schemas/integration/github-connection.schema';
import {
  GitHubIntegration,
  GitHubIntegrationDocument,
} from '../../schemas/integration/github-integration.schema';
import { GithubPRIntegrationService } from './services/github-pr-integration.service';
import { GithubCacheInvalidationService } from './services/github-cache-invalidation.service';
import { GitHubWebhookSignatureError } from './utils/github-errors';

@Controller('api/github')
export class GitHubWebhooksController {
  private readonly logger = new Logger(GitHubWebhooksController.name);

  constructor(
    private incrementalIndexService: IncrementalIndexService,
    private gitHubService: GitHubService,
    private githubPRIntegrationService: GithubPRIntegrationService,
    private githubCacheInvalidationService: GithubCacheInvalidationService,
    @InjectModel(GitHubConnection.name)
    private gitHubConnectionModel: Model<GitHubConnectionDocument>,
    @InjectModel(GitHubIntegration.name)
    private gitHubIntegrationModel: Model<GitHubIntegrationDocument>,
  ) {}

  @Post('webhooks')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() payload: any,
    @Body() rawBody: Buffer,
    @Headers('x-github-event') eventType: string,
    @Headers('x-github-delivery') deliveryId: string,
    @Headers('x-hub-signature-256') signature: string,
    @Headers('x-github-hook-id') hookId?: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    try {
      // Validate required headers
      if (!eventType || !deliveryId) {
        this.logger.warn('Missing required webhook headers', {
          eventType,
          deliveryId,
        });
        return { success: false, message: 'Missing required headers' };
      }

      // Verify user agent is from GitHub
      if (!userAgent || !userAgent.includes('GitHub-Hookshot')) {
        this.logger.warn('Invalid user agent', { userAgent });
        return { success: false, message: 'Invalid user agent' };
      }

      this.logger.log(
        `Received webhook event: ${eventType}, delivery: ${deliveryId}`,
      );

      // Verify webhook signature
      if (
        !this.gitHubService.verifyWebhookSignature(
          rawBody.toString(),
          signature,
        )
      ) {
        throw new GitHubWebhookSignatureError();
      }

      // Handle different event types
      switch (eventType) {
        case 'push':
          await this.handlePushEvent(payload, deliveryId);
          break;

        case 'pull_request':
          await this.handlePullRequestEvent(payload);
          break;

        case 'installation':
          await this.handleInstallationEvent(payload);
          break;

        case 'ping':
          this.logger.log('Received ping event from GitHub webhook');
          break;

        default:
          this.logger.log(`Unhandled webhook event type: ${eventType}`);
      }

      return { success: true, message: 'Webhook processed successfully' };
    } catch (error) {
      this.logger.error(`Webhook processing failed: ${error.message}`, {
        eventType,
        deliveryId,
        hookId,
        userAgent,
        error: error.stack,
      });

      // For signature verification errors, return 401
      if (error instanceof GitHubWebhookSignatureError) {
        return {
          success: false,
          message: 'Invalid webhook signature',
          error: 'UNAUTHORIZED',
        };
      }

      // For other errors, return success to prevent GitHub from retrying
      // Log the error for monitoring and manual investigation
      return {
        success: false,
        message: 'Webhook processing failed',
        error: error.message,
        deliveryId, // Include for debugging
      };
    }
  }

  /**
   * Handle GitHub push webhook events
   *
   * Process flow:
   * 1. Validate webhook payload structure
   * 2. Extract repository information and changed files
   * 3. Find all users/orgs with access to this repository
   * 4. Trigger incremental indexing for each user/org
   * 5. Handle errors gracefully without failing the webhook
   */
  private async handlePushEvent(
    payload: any,
    deliveryId?: string,
  ): Promise<void> {
    try {
      const { repository, commits, ref, sender } = payload;

      if (!repository || !commits || !Array.isArray(commits) || !ref) {
        this.logger.warn('Invalid push event payload structure', {
          hasRepository: !!repository,
          hasCommits: !!commits,
          commitsIsArray: Array.isArray(commits),
          hasRef: !!ref,
        });
        return;
      }

      // Only process pushes to main branches or specific branches
      const branch = ref.replace('refs/heads/', '');
      const repoFullName = repository.full_name;

      // Validate repository data
      if (!repoFullName || !repository.owner) {
        this.logger.warn('Invalid repository data in push event');
        return;
      }

      this.logger.log(
        `Processing push event for ${repoFullName} on branch ${branch}`,
        {
          commitsCount: commits.length,
          repositoryId: repository.id,
          sender: sender?.login,
          deliveryId: deliveryId,
        },
      );

      // Basic duplicate prevention - log delivery ID for monitoring
      // In production, you might want to store processed delivery IDs in Redis/cache

      // Collect all changed files from all commits
      const changedFiles = new Set<string>();

      for (const commit of commits) {
        // Collect all file changes from this commit
        if (commit.modified && Array.isArray(commit.modified)) {
          commit.modified.forEach((file: string) => changedFiles.add(file));
        }
        if (commit.added && Array.isArray(commit.added)) {
          commit.added.forEach((file: string) => changedFiles.add(file));
        }
        if (commit.removed && Array.isArray(commit.removed)) {
          // Include removed files so they can be marked as deprecated in indexing
          commit.removed.forEach((file: string) => changedFiles.add(file));
        }
      }

      // Validate we have a valid commit SHA
      const latestCommitSha = commits[0]?.id || payload.after;
      if (!latestCommitSha) {
        this.logger.warn('No valid commit SHA found in push event');
        return;
      }

      if (changedFiles.size === 0) {
        this.logger.log('No changed files in push event');
        return;
      }

      const changedFilesArray = Array.from(changedFiles);

      this.logger.log(
        `Found ${changedFilesArray.length} changed files: ${changedFilesArray.slice(0, 5).join(', ')}${changedFilesArray.length > 5 ? '...' : ''}`,
      );

      // Find all users/organizations that have access to this repository
      const usersWithAccess =
        await this.findUsersWithRepositoryAccess(repoFullName);

      // Process indexing for each user/org with rate limiting
      const indexingPromises = usersWithAccess.map(async (user, index) => {
        // Add small delay between users to prevent overwhelming the system
        if (index > 0) {
          await new Promise((resolve) => setTimeout(resolve, 100 * index));
        }

        try {
          const result = await this.incrementalIndexService.indexChangedFiles({
            repoFullName,
            commitSha: latestCommitSha,
            branch,
            changedFiles: changedFilesArray,
            userId: user.userId,
            organizationId: user.organizationId,
          });

          this.logger.log(
            `Incremental indexing completed for user ${user.userId}: ${result.filesIndexed} files, ${result.totalChunksCreated} chunks created, ${result.totalChunksUpdated} updated`,
          );

          if (result.errors.length > 0) {
            this.logger.error(
              `Indexing errors for user ${user.userId}:`,
              result.errors,
            );
          }

          return result;
        } catch (error) {
          this.logger.error(
            `Failed to index changes for user ${user.userId}: ${error.message}`,
            {
              userId: user.userId,
              repoFullName,
              branch,
              commitSha: commits[0]?.id || payload.after,
              error: error.stack,
            },
          );
          throw error;
        }
      });

      // Execute all indexing operations
      try {
        await Promise.allSettled(indexingPromises);
      } catch (error) {
        // Log but don't throw - we don't want webhook failures to prevent GitHub retries
        this.logger.error('Some indexing operations failed', error);
      }
    } catch (error) {
      this.logger.error(`Failed to handle push event: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Find all users/organizations that have access to a repository
   */
  private async findUsersWithRepositoryAccess(
    repoFullName: string,
  ): Promise<Array<{ userId: string; organizationId?: string }>> {
    try {
      // Find all active GitHub connections that include this repository
      const connections = await this.gitHubConnectionModel.find({
        isActive: true,
        repositories: {
          $elemMatch: {
            fullName: repoFullName,
          },
        },
      });

      // Extract user IDs (organizationId not available in current schema)
      const usersWithAccess = connections.map((connection) => ({
        userId: connection.userId,
        // organizationId: connection.organizationId // Not available in schema
      }));

      this.logger.log(
        `Found ${usersWithAccess.length} users/organizations with access to ${repoFullName}`,
      );

      return usersWithAccess;
    } catch (error) {
      this.logger.error(
        `Failed to find users with repository access for ${repoFullName}`,
        error,
      );
      return [];
    }
  }

  /**
   * Handle GitHub pull request webhook events
   *
   * Process flow:
   * 1. Validate webhook payload structure
   * 2. Find related integrations for this repository
   * 3. Update integration status based on PR state
   * 4. Invalidate relevant caches
   */
  private async handlePullRequestEvent(payload: any): Promise<void> {
    try {
      const { action, pull_request, repository, sender } = payload;

      if (!pull_request || !repository || !action) {
        this.logger.warn('Invalid pull request event payload structure', {
          hasPullRequest: !!pull_request,
          hasRepository: !!repository,
          hasAction: !!action,
        });
        return;
      }

      const repoFullName = repository.full_name;
      const prNumber = pull_request.number;
      const prState = pull_request.state;
      const merged = pull_request.merged;
      const mergedBy = pull_request.merged_by?.login;

      this.logger.log(
        `Processing pull request event: ${action} for ${repoFullName}#${prNumber}`,
        {
          prState,
          merged,
          mergedBy,
          sender: sender?.login,
        },
      );

      // Find integrations that match this PR
      const relatedIntegrations = await this.gitHubIntegrationModel.find({
        repositoryFullName: repoFullName,
        prNumber: prNumber,
        status: { $in: ['draft', 'open', 'updating'] },
      });

      if (relatedIntegrations.length === 0) {
        this.logger.log(
          `No active integrations found for ${repoFullName}#${prNumber}`,
        );
        return;
      }

      this.logger.log(
        `Found ${relatedIntegrations.length} related integrations for PR ${repoFullName}#${prNumber}`,
      );

      // Update integration status based on PR action
      for (const integration of relatedIntegrations) {
        try {
          let newStatus: string;
          const updateData: any = { lastActivityAt: new Date() };

          switch (action) {
            case 'opened':
              newStatus = 'open';
              break;

            case 'closed':
              if (merged) {
                newStatus = 'merged';
                updateData.mergedAt = new Date();
                updateData.mergedBy = mergedBy;
              } else {
                newStatus = 'closed';
                updateData.closedAt = new Date();
              }
              break;

            case 'reopened':
              newStatus = 'open';
              break;

            case 'synchronize':
              // PR was updated with new commits
              newStatus = integration.status; // Keep current status
              break;

            default:
              // For other actions, don't change status
              continue;
          }

          if (newStatus && newStatus !== integration.status) {
            updateData.status = newStatus;
            await this.gitHubIntegrationModel.findByIdAndUpdate(
              integration._id,
              updateData,
            );

            this.logger.log(
              `Updated integration ${integration._id} status to ${newStatus}`,
              {
                integrationId: integration._id.toString(),
                prNumber,
                action,
                merged,
              },
            );

            // Invalidate caches for this repository
            await this.githubCacheInvalidationService.invalidateRepositoryCache(
              repoFullName,
              integration.branchName,
            );
          }
        } catch (error) {
          this.logger.error(
            `Failed to update integration ${integration._id} for PR event`,
            {
              integrationId: integration._id.toString(),
              prNumber,
              action,
              error: error.message,
            },
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle pull request event: ${error.message}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Handle GitHub installation webhook events
   *
   * Process flow:
   * 1. Validate webhook payload structure
   * 2. Handle different installation actions (created/deleted/suspended/unsuspended/permissions)
   * 3. Update connection status and invalidate caches
   */
  private async handleInstallationEvent(payload: any): Promise<void> {
    try {
      const { action, installation, repositories, sender } = payload;

      if (!installation || !action) {
        this.logger.warn('Invalid installation event payload structure', {
          hasInstallation: !!installation,
          hasAction: !!action,
        });
        return;
      }

      const installationId = installation.id;
      const account = installation.account;
      const accountLogin = account?.login;
      const accountId = account?.id;

      this.logger.log(
        `Processing installation event: ${action} for installation ${installationId}`,
        {
          accountLogin,
          accountId,
          sender: sender?.login,
          repositoriesCount: repositories?.length || 0,
        },
      );

      // Find the connection for this installation
      const connection = await this.gitHubConnectionModel.findOne({
        installationId: installationId.toString(),
        isActive: true,
      });

      if (!connection) {
        this.logger.log(
          `No active connection found for installation ${installationId}`,
        );
        return;
      }

      let shouldDeactivate = false;
      let shouldInvalidateCache = false;

      switch (action) {
        case 'created':
          // Installation was created - connection should already be active
          this.logger.log(
            `Installation ${installationId} created for account ${accountLogin}`,
          );
          shouldInvalidateCache = true;
          break;

        case 'deleted':
          // Installation was deleted - deactivate the connection
          this.logger.log(
            `Installation ${installationId} deleted for account ${accountLogin}`,
          );
          shouldDeactivate = true;
          shouldInvalidateCache = true;
          break;

        case 'suspended':
          // Installation was suspended - deactivate the connection
          this.logger.log(
            `Installation ${installationId} suspended for account ${accountLogin}`,
          );
          shouldDeactivate = true;
          shouldInvalidateCache = true;
          break;

        case 'unsuspended':
          // Installation was unsuspended - reactivate if it was suspended
          this.logger.log(
            `Installation ${installationId} unsuspended for account ${accountLogin}`,
          );
          await this.gitHubConnectionModel.findByIdAndUpdate(connection._id, {
            isActive: true,
            suspendedAt: null,
            lastError: null,
          });
          shouldInvalidateCache = true;
          break;

        case 'new_permissions_accepted':
          // New permissions were accepted - update connection
          this.logger.log(
            `New permissions accepted for installation ${installationId}`,
          );
          // Could update permissions in connection record here
          break;

        default:
          this.logger.log(`Unhandled installation action: ${action}`);
      }

      // Deactivate connection if needed
      if (shouldDeactivate) {
        await this.gitHubConnectionModel.findByIdAndUpdate(connection._id, {
          isActive: false,
          disconnectedAt: new Date(),
          lastError: `Installation ${action}`,
        });
      }

      // Invalidate caches if needed
      if (shouldInvalidateCache) {
        // Invalidate user cache
        await this.githubCacheInvalidationService.invalidateUserCache(
          connection.userId,
        );

        // If we have repositories, invalidate their caches too
        if (repositories && Array.isArray(repositories)) {
          for (const repo of repositories) {
            try {
              await this.githubCacheInvalidationService.invalidateRepositoryCache(
                repo.full_name,
                'main', // Default branch, could be improved
              );
            } catch (error) {
              this.logger.warn(
                `Failed to invalidate cache for repository ${repo.full_name}`,
                {
                  error: error.message,
                },
              );
            }
          }
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle installation event: ${error.message}`,
        error,
      );
      throw error;
    }
  }
}
