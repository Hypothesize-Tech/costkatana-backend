import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../../common/cache/cache.service';

@Injectable()
export class GithubCacheInvalidationService {
  private readonly logger = new Logger(GithubCacheInvalidationService.name);

  constructor(private readonly cacheService: CacheService) {}

  /**
   * Invalidate repository cache for a specific repository and branch
   */
  async invalidateRepositoryCache(
    repositoryFullName: string,
    branch: string,
  ): Promise<void> {
    try {
      this.logger.log('Invalidating repository cache', {
        repository: repositoryFullName,
        branch,
      });

      // Generate cache keys that need to be invalidated
      const cacheKeys = this.generateRepositoryCacheKeys(
        repositoryFullName,
        branch,
      );

      // Delete each cache key
      const deletePromises = cacheKeys.map((key) => this.cacheService.del(key));

      await Promise.all(deletePromises);

      this.logger.log('Repository cache invalidated successfully', {
        repository: repositoryFullName,
        branch,
        keysInvalidated: cacheKeys.length,
      });
    } catch (error: any) {
      this.logger.error('Failed to invalidate repository cache', {
        repository: repositoryFullName,
        branch,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Invalidate cache for multiple repositories
   */
  async invalidateRepositoriesCache(
    repositories: Array<{ fullName: string; branch: string }>,
  ): Promise<void> {
    try {
      this.logger.log('Invalidating cache for multiple repositories', {
        count: repositories.length,
      });

      const allKeys: string[] = [];

      // Collect all cache keys to invalidate
      for (const repo of repositories) {
        const keys = this.generateRepositoryCacheKeys(
          repo.fullName,
          repo.branch,
        );
        allKeys.push(...keys);
      }

      // Batch delete all keys
      if (allKeys.length > 0) {
        const deletePromises = allKeys.map((key) => this.cacheService.del(key));
        await Promise.all(deletePromises);
      }

      this.logger.log('Multiple repositories cache invalidated successfully', {
        repositoriesCount: repositories.length,
        keysInvalidated: allKeys.length,
      });
    } catch (error: any) {
      this.logger.error('Failed to invalidate multiple repositories cache', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Invalidate user-specific cache (when user disconnects or changes settings)
   */
  async invalidateUserCache(userId: string): Promise<void> {
    try {
      this.logger.log('Invalidating user cache', { userId });

      // Generate user-specific cache keys
      const cacheKeys = this.generateUserCacheKeys(userId);

      // Delete cache keys
      const deletePromises = cacheKeys.map((key) => this.cacheService.del(key));
      await Promise.all(deletePromises);

      this.logger.log('User cache invalidated successfully', {
        userId,
        keysInvalidated: cacheKeys.length,
      });
    } catch (error: any) {
      this.logger.error('Failed to invalidate user cache', {
        userId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Invalidate cache after integration changes
   */
  async invalidateIntegrationCache(
    integrationId: string,
    repositoryFullName: string,
    branch: string,
  ): Promise<void> {
    try {
      this.logger.log('Invalidating integration cache', {
        integrationId,
        repository: repositoryFullName,
        branch,
      });

      // Invalidate repository cache
      await this.invalidateRepositoryCache(repositoryFullName, branch);

      // Generate integration-specific cache keys
      const cacheKeys = this.generateIntegrationCacheKeys(integrationId);

      // Delete integration-specific keys
      const deletePromises = cacheKeys.map((key) => this.cacheService.del(key));
      await Promise.all(deletePromises);

      this.logger.log('Integration cache invalidated successfully', {
        integrationId,
        repository: repositoryFullName,
        branch,
        keysInvalidated: cacheKeys.length,
      });
    } catch (error: any) {
      this.logger.error('Failed to invalidate integration cache', {
        integrationId,
        repository: repositoryFullName,
        branch,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Generate repository-specific cache keys
   */
  private generateRepositoryCacheKeys(
    repositoryFullName: string,
    branch: string,
  ): string[] {
    const keys: string[] = [];

    // Repository info cache
    keys.push(`github:repo:${repositoryFullName}`);
    keys.push(`github:repo:${repositoryFullName}:${branch}`);

    // Repository files cache
    keys.push(`github:files:${repositoryFullName}`);
    keys.push(`github:files:${repositoryFullName}:${branch}`);

    // Repository structure cache
    keys.push(`github:structure:${repositoryFullName}`);
    keys.push(`github:structure:${repositoryFullName}:${branch}`);

    // Repository analysis cache
    keys.push(`github:analysis:${repositoryFullName}`);
    keys.push(`github:analysis:${repositoryFullName}:${branch}`);

    // Repository contents cache (various paths)
    keys.push(`github:contents:${repositoryFullName}:*`);
    keys.push(`github:contents:${repositoryFullName}:${branch}:*`);

    // Branch information cache
    keys.push(`github:branches:${repositoryFullName}`);

    // Repository metadata cache
    keys.push(`github:metadata:${repositoryFullName}`);

    return keys;
  }

  /**
   * Generate user-specific cache keys
   */
  private generateUserCacheKeys(userId: string): string[] {
    const keys: string[] = [];

    // User repositories cache
    keys.push(`github:user:${userId}:repos`);

    // User connections cache
    keys.push(`github:user:${userId}:connections`);

    // User integrations cache
    keys.push(`github:user:${userId}:integrations`);

    // User settings cache
    keys.push(`github:user:${userId}:settings`);

    return keys;
  }

  /**
   * Generate integration-specific cache keys
   */
  private generateIntegrationCacheKeys(integrationId: string): string[] {
    const keys: string[] = [];

    // Integration status cache
    keys.push(`github:integration:${integrationId}`);
    keys.push(`github:integration:${integrationId}:status`);

    // Integration workflow cache
    keys.push(`github:integration:${integrationId}:workflow`);

    // Integration progress cache
    keys.push(`github:integration:${integrationId}:progress`);

    return keys;
  }

  /**
   * Clear all GitHub-related cache (use with caution)
   */
  /**
   * Clear all GitHub-related cache (use with caution)
   *
   * This method attempts to delete all cache keys related to GitHub integration.
   * It scans for all matching patterns and issues delete commands on matched keys using the cache service.
   */
  async clearAllGithubCache(): Promise<void> {
    try {
      this.logger.warn('Clearing all GitHub cache - this is a heavy operation');

      // Patterns of GitHub-related cache keys
      const patterns = [
        'github:repo:*',
        'github:files:*',
        'github:structure:*',
        'github:analysis:*',
        'github:contents:*',
        'github:branches:*',
        'github:metadata:*',
        'github:user:*:repos',
        'github:user:*:connections',
        'github:user:*:integrations',
        'github:user:*:settings',
        'github:integration:*',
      ];

      // If using Redis, we can scan for keys for each pattern, then delete them
      // If using another backend, adapt this section as needed
      let deletedKeysCount = 0;
      for (const pattern of patterns) {
        // scanKeys should return all keys matching this pattern
        // For performance, consider using cursor-based SCAN in production if you expect many keys.
        const keys: string[] = await this.cacheService.scanKeys(pattern);
        if (keys.length > 0) {
          const numDeleted = await this.cacheService.delMany(keys);
          deletedKeysCount += numDeleted;
          this.logger.log(
            `Cleared ${numDeleted} keys for pattern '${pattern}'.`,
          );
        } else {
          this.logger.log(`No keys found for pattern '${pattern}'.`);
        }
      }

      this.logger.log('All GitHub cache clearing completed.', {
        patternsAttempted: patterns.length,
        totalKeysDeleted: deletedKeysCount,
      });
    } catch (error) {
      // It's safer to type error as unknown and guard before property access
      let errorMessage = 'Unknown error';
      let errorStack: string | undefined = undefined;

      if (error instanceof Error) {
        errorMessage = error.message;
        errorStack = error.stack;
      }

      this.logger.error('Failed to clear all GitHub cache', {
        error: errorMessage,
        stack: errorStack,
      });
      throw error;
    }
  }

  /**
   * Warm up cache for a repository (pre-load commonly accessed data)
   */
  /**
   * Warm up cache for a repository (pre-load commonly accessed data).
   * Typically used after cache clearing or on repo onboarding to accelerate follow-up GitHub requests.
   *
   * Loads:
   *  - Repository metadata
   *  - Default branch file tree (if available)
   *  - List of branches
   *  - User integrations (if relevant)
   */
  async warmupRepositoryCache(
    repositoryFullName: string,
    branch: string,
  ): Promise<void> {
    try {
      this.logger.log('Warming up repository cache', {
        repository: repositoryFullName,
        branch,
      });

      // Metadata
      await this.cacheService.cacheGitHubRepositoryMetadata(repositoryFullName);

      // Branches info
      await this.cacheService.cacheGitHubBranches(repositoryFullName);

      // File tree for the given branch
      await this.cacheService.cacheGitHubFileTree(repositoryFullName, branch);

      // Optionally: user integrations, settings, etc. (skip if not relevant)
      // await this.cacheService.cacheGitHubUserIntegrationsForRepo(repositoryFullName);

      this.logger.log('Repository cache warmup completed', {
        repository: repositoryFullName,
        branch,
      });
    } catch (error) {
      // It's safer to type error as unknown and guard before property access
      let errorMessage = 'Unknown error';
      let errorStack: string | undefined = undefined;

      if (error instanceof Error) {
        errorMessage = error.message;
        errorStack = error.stack;
      }

      this.logger.error('Failed to warmup repository cache', {
        repository: repositoryFullName,
        branch,
        error: errorMessage,
        stack: errorStack,
      });
      throw error;
    }
  }
}
