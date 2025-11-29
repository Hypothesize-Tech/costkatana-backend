import { GitHubCodeChunkModel } from '../models/GitHubCodeChunk';
import { loggingService } from './logging.service';

export interface PrivacySettings {
    includePaths?: string[];
    excludePaths?: string[];
    includeBranches?: string[];
    excludeBranches?: string[];
    includeLanguages?: string[];
    excludeLanguages?: string[];
    retentionDays?: number;
}

export interface PurgeResult {
    chunksDeleted: number;
    chunksArchived: number;
    errors: string[];
}

/**
 * Integration privacy and data governance service
 */
export class IntegrationPrivacyService {
    private static readonly DEFAULT_EXCLUDE_PATTERNS = [
        'node_modules',
        'dist',
        'build',
        '.next',
        '.nuxt',
        '.cache',
        'coverage',
        '.env',
        '.env.local',
        '.env.test',
        '*.log',
        '*.tmp'
    ];

    /**
     * Check if file path should be excluded
     */
    static shouldExcludeFile(
        filePath: string,
        settings?: PrivacySettings
    ): boolean {
        // Check default exclusions
        for (const pattern of this.DEFAULT_EXCLUDE_PATTERNS) {
            if (pattern.includes('*')) {
                const regex = new RegExp(pattern.replace('*', '.*'));
                if (regex.test(filePath)) {
                    return true;
                }
            } else if (filePath.includes(pattern)) {
                return true;
            }
        }

        // Check custom exclusions
        if (settings?.excludePaths) {
            for (const pattern of settings.excludePaths) {
                if (filePath.includes(pattern) || new RegExp(pattern).test(filePath)) {
                    return true;
                }
            }
        }

        // Check custom includes (if specified, only include these)
        if (settings?.includePaths && settings.includePaths.length > 0) {
            const matches = settings.includePaths.some(pattern =>
                filePath.includes(pattern) || new RegExp(pattern).test(filePath)
            );
            if (!matches) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if branch should be indexed
     */
    static shouldIndexBranch(
        branch: string,
        settings?: PrivacySettings
    ): boolean {
        // Check exclusions
        if (settings?.excludeBranches) {
            if (settings.excludeBranches.includes(branch)) {
                return false;
            }
        }

        // Check includes (if specified, only include these)
        if (settings?.includeBranches && settings.includeBranches.length > 0) {
            return settings.includeBranches.includes(branch);
        }

        return true;
    }

    /**
     * Check if language should be indexed
     */
    static shouldIndexLanguage(
        language: string,
        settings?: PrivacySettings
    ): boolean {
        // Check exclusions
        if (settings?.excludeLanguages) {
            if (settings.excludeLanguages.includes(language)) {
                return false;
            }
        }

        // Check includes (if specified, only include these)
        if (settings?.includeLanguages && settings.includeLanguages.length > 0) {
            return settings.includeLanguages.includes(language);
        }

        return true;
    }

    /**
     * Purge all indexed data for a repository
     */
    static async purgeRepositoryData(
        userId: string,
        repoFullName: string
    ): Promise<PurgeResult> {
        const result: PurgeResult = {
            chunksDeleted: 0,
            chunksArchived: 0,
            errors: []
        };

        try {
            // Delete all chunks for this repo
            const deleteResult = await GitHubCodeChunkModel.deleteMany({
                userId,
                repoFullName
            });

            result.chunksDeleted = deleteResult.deletedCount || 0;

            loggingService.info('Repository data purged', {
                component: 'IntegrationPrivacyService',
                userId,
                repoFullName,
                chunksDeleted: result.chunksDeleted
            });

            return result;
        } catch (error) {
            const errorMsg = `Failed to purge repository data: ${error instanceof Error ? error.message : 'Unknown error'}`;
            result.errors.push(errorMsg);
            loggingService.error('Repository data purge failed', {
                component: 'IntegrationPrivacyService',
                userId,
                repoFullName,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return result;
        }
    }

    /**
     * Archive old chunks based on retention policy
     */
    static async archiveOldChunks(
        userId: string,
        retentionDays: number = 90
    ): Promise<number> {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

            const result = await GitHubCodeChunkModel.updateMany(
                {
                    userId,
                    status: 'active',
                    indexedAt: { $lt: cutoffDate },
                    lastAccessedAt: { $lt: cutoffDate }
                },
                {
                    $set: {
                        status: 'archived'
                    }
                }
            );

            loggingService.info('Old chunks archived', {
                component: 'IntegrationPrivacyService',
                userId,
                chunksArchived: result.modifiedCount
            });

            return result.modifiedCount || 0;
        } catch (error) {
            loggingService.error('Archive old chunks failed', {
                component: 'IntegrationPrivacyService',
                userId,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return 0;
        }
    }
}

