import { HybridSearchService, HybridSearchOptions, HybridSearchResult } from './hybridSearch.service';
import { RerankerService } from './reranker.service';
import { ContextAssemblyService, AssembledContext } from './contextAssembly.service';
import { ExactSearchService } from './exactSearch.service';
import { loggingService } from './logging.service';

export interface GitHubRetrievalOptions extends HybridSearchOptions {
    rerank?: boolean;
    rerankTopK?: number;
    useLLMReranking?: boolean;
    maxContextTokens?: number;
    includeProvenance?: boolean;
    prioritizeIntegrationPoints?: boolean;
}

export interface GitHubRetrievalResult {
    assembledContext: AssembledContext;
    rawResults: HybridSearchResult[];
    rerankedResults?: HybridSearchResult[];
    exactMatches?: Array<{
        chunkId: string;
        filePath: string;
        startLine: number;
        endLine: number;
        symbolName?: string;
        symbolType?: string;
    }>;
    metadata: {
        query: string;
        totalCandidates: number;
        rerankedCount?: number;
        assemblyTime: number;
        searchTime: number;
    };
}

/**
 * Unified retrieval service for GitHub code
 * Orchestrates: hybrid search → rerank → context assembly
 */
export class GitHubRetrievalService {
    /**
     * Retrieve code context for a query
     */
    static async retrieve(
        query: string,
        options: GitHubRetrievalOptions = {}
    ): Promise<GitHubRetrievalResult> {
        const startTime = Date.now();
        const searchStartTime = Date.now();

        try {
            loggingService.info('Starting GitHub retrieval', {
                component: 'GitHubRetrievalService',
                query: query.substring(0, 100),
                options
            });

            // Step 1: Hybrid search (sparse + dense)
            const hybridResults = await HybridSearchService.search(query, {
                repoFullName: options.repoFullName,
                language: options.language,
                chunkType: options.chunkType,
                filePath: options.filePath,
                userId: options.userId,
                limit: options.limit || 200, // Get more for reranking
                sparseWeight: options.sparseWeight,
                denseWeight: options.denseWeight
            });

            const searchTime = Date.now() - searchStartTime;

            // Step 2: Extract identifiers for exact matching
            const identifiers = this.extractIdentifiers(query);
            let exactMatches: GitHubRetrievalResult['exactMatches'] = [];

            if (identifiers.length > 0) {
                try {
                    const exactResults = await ExactSearchService.searchSymbol(
                        identifiers[0],
                        'function', // Default to function, could be enhanced
                        {
                            repoFullName: options.repoFullName,
                            language: options.language,
                            userId: options.userId,
                            limit: 5
                        }
                    );

                    exactMatches = exactResults.map(result => ({
                        chunkId: result.chunkId,
                        filePath: result.metadata.filePath,
                        startLine: result.metadata.startLine,
                        endLine: result.metadata.endLine,
                        symbolName: result.metadata.symbolName,
                        symbolType: result.metadata.symbolType
                    }));
                } catch (error) {
                    loggingService.warn('Exact search failed', {
                        component: 'GitHubRetrievalService',
                        error: error instanceof Error ? error.message : 'Unknown'
                    });
                }
            }

            // Step 3: Rerank if requested
            let rerankedResults: HybridSearchResult[] | undefined;
            if (options.rerank !== false && hybridResults.length > (options.rerankTopK || 50)) {
                rerankedResults = await RerankerService.rerank(
                    query,
                    hybridResults,
                    {
                        topK: options.rerankTopK || 50,
                        useLLM: options.useLLMReranking
                    }
                );
            } else {
                rerankedResults = hybridResults.slice(0, options.rerankTopK || 50);
            }

            // Step 4: Assemble context
            const assemblyStartTime = Date.now();
            const assembledContext = ContextAssemblyService.assemble(
                rerankedResults,
                {
                    maxTokens: options.maxContextTokens,
                    prioritizeIntegrationPoints: options.prioritizeIntegrationPoints,
                    includeProvenance: options.includeProvenance !== false,
                    preserveFunctionBoundaries: true
                }
            );
            const assemblyTime = Date.now() - assemblyStartTime;

            const totalTime = Date.now() - startTime;

            loggingService.info('GitHub retrieval completed', {
                component: 'GitHubRetrievalService',
                query: query.substring(0, 100),
                totalCandidates: hybridResults.length,
                rerankedCount: rerankedResults.length,
                assembledChunks: assembledContext.chunks.length,
                totalTime
            });

            return {
                assembledContext,
                rawResults: hybridResults,
                rerankedResults,
                exactMatches: exactMatches.length > 0 ? exactMatches : undefined,
                metadata: {
                    query,
                    totalCandidates: hybridResults.length,
                    rerankedCount: rerankedResults.length,
                    assemblyTime,
                    searchTime
                }
            };
        } catch (error) {
            loggingService.error('GitHub retrieval failed', {
                component: 'GitHubRetrievalService',
                query: query.substring(0, 100),
                error: error instanceof Error ? error.message : 'Unknown'
            });
            throw error;
        }
    }

    /**
     * Extract identifiers from query for exact matching
     */
    private static extractIdentifiers(query: string): string[] {
        // Simple identifier extraction (PascalCase, camelCase, UPPER_CASE)
        const patterns = [
            /[A-Z][a-zA-Z0-9]{2,}/g, // PascalCase
            /[a-z][a-zA-Z0-9]{2,}/g, // camelCase
            /[A-Z_][A-Z0-9_]{2,}/g // UPPER_CASE
        ];

        const identifiers = new Set<string>();

        for (const pattern of patterns) {
            const matches = query.match(pattern);
            if (matches) {
                matches.forEach(match => {
                    if (match.length >= 3 && match.length < 50) {
                        identifiers.add(match);
                    }
                });
            }
        }

        return Array.from(identifiers);
    }
}

