import { redisService } from './redis.service';
import { loggingService } from './logging.service';
import { MultiRepoIntelligenceService } from './multiRepoIntelligence.service';
import { MultiRepoIndex } from '../models/MultiRepoIndex';

/**
 * Cache Invalidation Service
 * Handles smart cache invalidation with webhook-based triggers
 */
export class CacheInvalidationService {
    private static readonly REDIS_CACHE_PREFIX = 'repo_index:';
    private static readonly INVALIDATION_THROTTLE = 5 * 60 * 1000; // 5 minutes
    private static readonly lastInvalidation = new Map<string, number>();

    /**
     * Invalidate caches for a specific repository
     */
    static async invalidateRepo(repoFullName: string, branch?: string): Promise<void> {
        try {
            const now = Date.now();
            const cacheKey = `${repoFullName}:${branch || 'default'}`;
            
            // Throttle: Don't invalidate more than once per 5 minutes
            const lastInvalidated = this.lastInvalidation.get(cacheKey);
            if (lastInvalidated && (now - lastInvalidated) < this.INVALIDATION_THROTTLE) {
                loggingService.info('Cache invalidation throttled', {
                    repoFullName,
                    branch,
                    timeSinceLastInvalidation: now - lastInvalidated
                });
                return;
            }

            // Invalidate Redis cache (hot cache)
            const redisKey = `${this.REDIS_CACHE_PREFIX}${repoFullName}:${branch || 'default'}`;
            await redisService.client.del(redisKey);

            // Invalidate in-memory cache (GitHubChatAgentService cache)
            // This will be handled by the service itself when it checks cache

            // Mark as invalidated
            this.lastInvalidation.set(cacheKey, now);

            loggingService.info('Repository cache invalidated', {
                repoFullName,
                branch,
                cacheKey: redisKey
            });

            // Schedule background reindex
            await MultiRepoIntelligenceService.scheduleReindex(repoFullName);
        } catch (error) {
            loggingService.error('Cache invalidation failed', {
                repoFullName,
                branch,
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }
    }

    /**
     * Invalidate caches for multiple repositories (cascade invalidation)
     */
    static async invalidateRepos(repoFullNames: string[], branch?: string): Promise<void> {
        const promises = repoFullNames.map(repo => this.invalidateRepo(repo, branch));
        await Promise.allSettled(promises);

        loggingService.info('Bulk cache invalidation completed', {
            repoCount: repoFullNames.length,
            branch
        });
    }

    /**
     * Invalidate dependent repositories (repos that depend on the invalidated repo)
     */
    static async invalidateDependents(
        repoFullName: string,
        userId: string
    ): Promise<void> {
        try {
            loggingService.info('Dependent repos invalidation requested', {
                repoFullName,
                userId
            });

            // Query MultiRepoIndex to find repos that depend on this one
            const multiRepoIndex = await MultiRepoIndex.findOne({ userId });
            if (!multiRepoIndex) {
                loggingService.info('No multi-repo index found for user', {
                    userId,
                    repoFullName
                });
                return;
            }

            const dependentRepos = new Set<string>();

            // Find repos that have cross-repo dependencies on this repo
            // A dependency where toRepo === repoFullName means another repo depends on this one
            const crossRepoDependents = multiRepoIndex.crossRepoDependencies
                .filter(dep => dep.toRepo === repoFullName)
                .map(dep => dep.fromRepo);

            for (const dependentRepo of crossRepoDependents) {
                dependentRepos.add(dependentRepo);
            }

            // Find repos that use shared utilities from this repo
            // If a utility from this repo is used in other repos, those repos depend on this one
            const sharedUtilityDependents = multiRepoIndex.sharedUtilities
                .filter(utility => utility.repoFullName === repoFullName)
                .flatMap(utility => utility.usedInRepos || []);

            for (const dependentRepo of sharedUtilityDependents) {
                if (dependentRepo !== repoFullName) {
                    dependentRepos.add(dependentRepo);
                }
            }

            if (dependentRepos.size === 0) {
                loggingService.info('No dependent repositories found', {
                    repoFullName,
                    userId
                });
                return;
            }

            // Invalidate caches for all dependent repos
            const dependentReposArray = Array.from(dependentRepos);
            await this.invalidateRepos(dependentReposArray);

            loggingService.info('Dependent repositories cache invalidated', {
                repoFullName,
                userId,
                dependentReposCount: dependentRepos.size,
                dependentRepos: dependentReposArray,
                crossRepoDependentsCount: crossRepoDependents.length,
                sharedUtilityDependentsCount: sharedUtilityDependents.length
            });
        } catch (error) {
            loggingService.error('Dependent repos invalidation failed', {
                repoFullName,
                userId,
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }
    }

    /**
     * Clear all caches for a user (useful for account changes)
     */
    static async clearUserCaches(userId: string): Promise<void> {
        try {
            loggingService.info('User cache clear requested', { userId });

            // Get all repositories for this user from MultiRepoIndex
            const multiRepoIndex = await MultiRepoIndex.findOne({ userId });
            if (!multiRepoIndex || multiRepoIndex.repositories.length === 0) {
                loggingService.info('No repositories found for user cache clear', { userId });
                return;
            }

            // Clear caches for all user repositories
            const repoFullNames = multiRepoIndex.repositories.map(repo => repo.fullName);
            const clearedCount = await this.clearReposCaches(repoFullNames);

            // Also clear any Redis keys matching the user pattern
            const pattern = `${this.REDIS_CACHE_PREFIX}*`;
            const keys = await redisService.client.keys(pattern);
            let redisClearedCount = 0;
            
            for (const key of keys) {
                // Check if key belongs to any of the user's repos
                const keyRepo = key.replace(this.REDIS_CACHE_PREFIX, '').split(':')[0];
                if (repoFullNames.some(repo => keyRepo.includes(repo.split('/')[1]))) {
                    await redisService.client.del(key);
                    redisClearedCount++;
                }
            }

            // Clear in-memory invalidation timestamps
            for (const repoFullName of repoFullNames) {
                this.lastInvalidation.delete(`${repoFullName}:default`);
                this.lastInvalidation.delete(`${repoFullName}:main`);
                this.lastInvalidation.delete(`${repoFullName}:master`);
            }

            loggingService.info('User cache clear completed', {
                userId,
                repoCount: repoFullNames.length,
                clearedCount,
                redisClearedCount
            });
        } catch (error) {
            loggingService.error('User cache clear failed', {
                userId,
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }
    }

    /**
     * Clear caches for multiple repositories
     */
    private static async clearReposCaches(repoFullNames: string[]): Promise<number> {
        let clearedCount = 0;
        
        for (const repoFullName of repoFullNames) {
            try {
                // Clear for common branches
                const branches = ['default', 'main', 'master'];
                for (const branch of branches) {
                    const redisKey = `${this.REDIS_CACHE_PREFIX}${repoFullName}:${branch}`;
                    const deleted = await redisService.client.del(redisKey);
                    if (deleted > 0) {
                        clearedCount++;
                    }
                    
                    // Clear invalidation timestamp
                    const cacheKey = `${repoFullName}:${branch}`;
                    this.lastInvalidation.delete(cacheKey);
                }
            } catch (error) {
                loggingService.warn('Failed to clear cache for repo', {
                    repoFullName,
                    error: error instanceof Error ? error.message : 'Unknown'
                });
            }
        }
        
        return clearedCount;
    }

    /**
     * Get cache status for a repository
     */
    static async getCacheStatus(repoFullName: string, branch?: string): Promise<{
        exists: boolean;
        lastInvalidated?: number;
        age?: number;
    }> {
        try {
            const redisKey = `${this.REDIS_CACHE_PREFIX}${repoFullName}:${branch || 'default'}`;
            const exists = await redisService.client.exists(redisKey);
            const cacheKey = `${repoFullName}:${branch || 'default'}`;
            const lastInvalidated = this.lastInvalidation.get(cacheKey);

            return {
                exists: exists === 1,
                lastInvalidated,
                age: lastInvalidated ? Date.now() - lastInvalidated : undefined
            };
        } catch (error) {
            loggingService.error('Cache status check failed', {
                repoFullName,
                branch,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return { exists: false };
        }
    }
}

