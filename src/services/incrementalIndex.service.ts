import { GitHubIndexingService, ChunkMetadata, IndexingResult } from './githubIndexing.service';
import { TreeSitterService, ASTAnalysis } from './treeSitter.service';
import { GitHubService } from './github.service';
import { IGitHubConnection } from '../models';
import { loggingService } from './logging.service';
import * as path from 'path';

export interface IncrementalIndexOptions {
    repoFullName: string;
    commitSha: string;
    branch: string;
    changedFiles: string[]; // List of file paths that changed
    userId: string;
    organizationId?: string;
}

export interface IncrementalIndexResult {
    filesIndexed: number;
    filesSkipped: number;
    totalChunksCreated: number;
    totalChunksUpdated: number;
    errors: string[];
    warnings: string[];
}

/**
 * Incremental indexing service for processing changed files only
 */
export class IncrementalIndexService {
    /**
     * Index only changed files from a commit
     */
    static async indexChangedFiles(
        connection: IGitHubConnection & { decryptToken: () => string },
        options: IncrementalIndexOptions
    ): Promise<IncrementalIndexResult> {
        const result: IncrementalIndexResult = {
            filesIndexed: 0,
            filesSkipped: 0,
            totalChunksCreated: 0,
            totalChunksUpdated: 0,
            errors: [],
            warnings: []
        };

        try {
            loggingService.info('Starting incremental indexing', {
                component: 'IncrementalIndexService',
                repoFullName: options.repoFullName,
                commitSha: options.commitSha,
                changedFilesCount: options.changedFiles.length
            });

            const [owner, repo] = options.repoFullName.split('/');

            // Process files in batches to avoid overwhelming the system
            const batchSize = 10;
            for (let i = 0; i < options.changedFiles.length; i += batchSize) {
                const batch = options.changedFiles.slice(i, i + batchSize);

                await Promise.allSettled(
                    batch.map(async (filePath) => {
                        try {
                            const fileResult = await this.indexFile(
                                connection,
                                owner,
                                repo,
                                filePath,
                                options
                            );

                            if (fileResult) {
                                result.filesIndexed++;
                                result.totalChunksCreated += fileResult.chunksCreated;
                                result.totalChunksUpdated += fileResult.chunksUpdated;
                                result.errors.push(...fileResult.errors);
                                result.warnings.push(...fileResult.warnings);
                            } else {
                                result.filesSkipped++;
                            }
                        } catch (error) {
                            const errorMsg = `Failed to index ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`;
                            result.errors.push(errorMsg);
                            result.filesSkipped++;
                            loggingService.error('File indexing failed in batch', {
                                component: 'IncrementalIndexService',
                                filePath,
                                error: error instanceof Error ? error.message : 'Unknown'
                            });
                        }
                    })
                );

                // Small delay between batches to respect rate limits
                if (i + batchSize < options.changedFiles.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            loggingService.info('Incremental indexing completed', {
                component: 'IncrementalIndexService',
                repoFullName: options.repoFullName,
                filesIndexed: result.filesIndexed,
                filesSkipped: result.filesSkipped,
                totalChunksCreated: result.totalChunksCreated
            });

            return result;
        } catch (error) {
            loggingService.error('Incremental indexing failed', {
                component: 'IncrementalIndexService',
                repoFullName: options.repoFullName,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            throw error;
        }
    }

    /**
     * Index a single file
     */
    private static async indexFile(
        connection: IGitHubConnection & { decryptToken: () => string },
        owner: string,
        repo: string,
        filePath: string,
        options: IncrementalIndexOptions
    ): Promise<IndexingResult | null> {
        try {
            // Get file content
            const content = await GitHubService.getFileContent(
                connection,
                owner,
                repo,
                filePath,
                options.branch
            );

            if (!content) {
                loggingService.warn('File content not found', {
                    component: 'IncrementalIndexService',
                    filePath
                });
                return null;
            }

            // Determine language from file extension
            const fileExt = path.extname(filePath).toLowerCase();
            const language = this.getLanguageFromExtension(fileExt);

            // Parse AST if it's a code file
            let astAnalysis: ASTAnalysis | undefined;
            if (this.isCodeFile(fileExt)) {
                try {
                    TreeSitterService.initialize();
                    astAnalysis = TreeSitterService.parseCode(content, language, filePath);
                } catch (error) {
                    loggingService.warn('AST parsing failed, continuing without AST', {
                        component: 'IncrementalIndexService',
                        filePath,
                        language,
                        error: error instanceof Error ? error.message : 'Unknown'
                    });
                }
            }

            // Prepare metadata
            const metadata: ChunkMetadata = {
                repoFullName: options.repoFullName,
                filePath,
                commitSha: options.commitSha,
                branch: options.branch,
                language,
                fileType: fileExt,
                userId: options.userId,
                organizationId: options.organizationId
            };

            // Index the file
            return await GitHubIndexingService.indexFile(content, metadata, astAnalysis);
        } catch (error) {
            loggingService.error('Failed to index file', {
                component: 'IncrementalIndexService',
                filePath,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            throw error;
        }
    }

    /**
     * Get language from file extension
     */
    private static getLanguageFromExtension(ext: string): string {
        const languageMap: Record<string, string> = {
            '.ts': 'typescript',
            '.tsx': 'typescript',
            '.js': 'javascript',
            '.jsx': 'javascript',
            '.py': 'python',
            '.java': 'java',
            '.go': 'go',
            '.rs': 'rust',
            '.cpp': 'cpp',
            '.cxx': 'cpp',
            '.cc': 'cpp',
            '.c': 'c',
            '.h': 'c',
            '.hpp': 'cpp',
            '.rb': 'ruby',
            '.php': 'php',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.md': 'markdown',
            '.txt': 'text',
            '.json': 'json',
            '.yaml': 'yaml',
            '.yml': 'yaml'
        };

        return languageMap[ext] || 'unknown';
    }

    /**
     * Check if file is a code file
     */
    private static isCodeFile(ext: string): boolean {
        const codeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.cpp', '.c', '.rb', '.php', '.swift', '.kt'];
        return codeExtensions.includes(ext);
    }
}

