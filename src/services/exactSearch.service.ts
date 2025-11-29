import { GitHubCodeChunkModel } from '../models/GitHubCodeChunk';
import { loggingService } from './logging.service';

export interface ExactSearchResult {
    chunkId: string;
    content: string;
    metadata: {
        repoFullName: string;
        filePath: string;
        startLine: number;
        endLine: number;
        commitSha: string;
        chunkType: string;
        language: string;
        symbolName?: string;
        symbolType?: 'function' | 'class' | 'method' | 'variable';
    };
}

export interface ExactSearchOptions {
    repoFullName?: string;
    language?: string;
    userId?: string;
    limit?: number;
}

/**
 * Exact search service for finding specific identifiers, TODOs, etc.
 * Uses symbol index and regex matching for precise lookups
 */
export class ExactSearchService {
    /**
     * Search for exact function/class names
     */
    static async searchSymbol(
        symbolName: string,
        symbolType: 'function' | 'class' | 'method',
        options: ExactSearchOptions = {}
    ): Promise<ExactSearchResult[]> {
        try {
            const limit = options.limit || 20;

            const query: Record<string, unknown> = {
                status: 'active'
            };

            if (options.repoFullName) {
                query.repoFullName = options.repoFullName;
            }

            if (options.language) {
                query.language = options.language;
            }

            if (options.userId) {
                query.userId = options.userId;
            }

            // Search in AST metadata
            if (symbolType === 'function') {
                query['astMetadata.functionName'] = symbolName;
            } else if (symbolType === 'class') {
                query['astMetadata.className'] = symbolName;
            } else if (symbolType === 'method') {
                query['astMetadata.methodName'] = symbolName;
            }

            const results = await GitHubCodeChunkModel.find(query)
                .limit(limit)
                .lean();

            return results.map((doc: any) => ({
                chunkId: doc._id.toString(),
                content: doc.content,
                metadata: {
                    repoFullName: doc.repoFullName,
                    filePath: doc.filePath,
                    startLine: doc.startLine,
                    endLine: doc.endLine,
                    commitSha: doc.commitSha,
                    chunkType: doc.chunkType,
                    language: doc.language,
                    symbolName,
                    symbolType
                }
            }));
        } catch (error) {
            loggingService.error('Symbol search failed', {
                component: 'ExactSearchService',
                symbolName,
                symbolType,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return [];
        }
    }

    /**
     * Search for TODOs, FIXMEs, etc.
     */
    static async searchTodos(
        options: ExactSearchOptions = {}
    ): Promise<ExactSearchResult[]> {
        try {
            const limit = options.limit || 50;
            const todoPattern = /(TODO|FIXME|XXX|HACK|NOTE|BUG):\s*(.+)/gi;

            const query: Record<string, unknown> = {
                status: 'active',
                content: todoPattern
            };

            if (options.repoFullName) {
                query.repoFullName = options.repoFullName;
            }

            if (options.language) {
                query.language = options.language;
            }

            if (options.userId) {
                query.userId = options.userId;
            }

            const results = await GitHubCodeChunkModel.find(query)
                .limit(limit)
                .lean();

            return results.map((doc: any) => ({
                chunkId: doc._id.toString(),
                content: doc.content,
                metadata: {
                    repoFullName: doc.repoFullName,
                    filePath: doc.filePath,
                    startLine: doc.startLine,
                    endLine: doc.endLine,
                    commitSha: doc.commitSha,
                    chunkType: doc.chunkType,
                    language: doc.language
                }
            }));
        } catch (error) {
            loggingService.error('TODO search failed', {
                component: 'ExactSearchService',
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return [];
        }
    }

    /**
     * Search for config keys (e.g., in .env, config files)
     */
    static async searchConfigKey(
        key: string,
        options: ExactSearchOptions = {}
    ): Promise<ExactSearchResult[]> {
        try {
            const limit = options.limit || 20;
            // Pattern: KEY=value or KEY: value or "KEY": value
            const keyPattern = new RegExp(`(^|\\s)${this.escapeRegex(key)}\\s*[=:]\\s*`, 'i');

            const query: Record<string, unknown> = {
                status: 'active',
                chunkType: 'config',
                content: keyPattern
            };

            if (options.repoFullName) {
                query.repoFullName = options.repoFullName;
            }

            if (options.userId) {
                query.userId = options.userId;
            }

            const results = await GitHubCodeChunkModel.find(query)
                .limit(limit)
                .lean();

            return results.map((doc: any) => ({
                chunkId: doc._id.toString(),
                content: doc.content,
                metadata: {
                    repoFullName: doc.repoFullName,
                    filePath: doc.filePath,
                    startLine: doc.startLine,
                    endLine: doc.endLine,
                    commitSha: doc.commitSha,
                    chunkType: doc.chunkType,
                    language: doc.language
                }
            }));
        } catch (error) {
            loggingService.error('Config key search failed', {
                component: 'ExactSearchService',
                key,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return [];
        }
    }

    /**
     * Search for hex IDs, UUIDs, etc. (exact pattern matching)
     */
    static async searchPattern(
        pattern: string,
        options: ExactSearchOptions = {}
    ): Promise<ExactSearchResult[]> {
        try {
            const limit = options.limit || 20;
            let regex: RegExp;

            try {
                regex = new RegExp(pattern, 'i');
            } catch (error) {
                loggingService.warn('Invalid regex pattern', {
                    component: 'ExactSearchService',
                    pattern
                });
                return [];
            }

            const query: Record<string, unknown> = {
                status: 'active',
                content: regex
            };

            if (options.repoFullName) {
                query.repoFullName = options.repoFullName;
            }

            if (options.language) {
                query.language = options.language;
            }

            if (options.userId) {
                query.userId = options.userId;
            }

            const results = await GitHubCodeChunkModel.find(query)
                .limit(limit)
                .lean();

            return results.map((doc: any) => ({
                chunkId: doc._id.toString(),
                content: doc.content,
                metadata: {
                    repoFullName: doc.repoFullName,
                    filePath: doc.filePath,
                    startLine: doc.startLine,
                    endLine: doc.endLine,
                    commitSha: doc.commitSha,
                    chunkType: doc.chunkType,
                    language: doc.language
                }
            }));
        } catch (error) {
            loggingService.error('Pattern search failed', {
                component: 'ExactSearchService',
                pattern,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return [];
        }
    }

    /**
     * Escape regex special characters
     */
    private static escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
}

