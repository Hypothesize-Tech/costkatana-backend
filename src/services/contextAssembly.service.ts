import { HybridSearchResult } from './hybridSearch.service';
import { loggingService } from './logging.service';

export interface ContextAssemblyOptions {
    maxTokens?: number; // Maximum tokens in assembled context
    prioritizeIntegrationPoints?: boolean;
    includeProvenance?: boolean; // Include file path, lines, commit SHA
    preserveFunctionBoundaries?: boolean; // Don't truncate in middle of function
}

export interface AssembledContext {
    content: string;
    chunks: Array<{
        chunkId: string;
        filePath: string;
        startLine: number;
        endLine: number;
        commitSha: string;
        score: number;
    }>;
    totalTokens: number; // Estimated
    truncated: boolean;
}

/**
 * Smart context assembly service
 * Assembles search results into optimized context for LLM prompts
 */
export class ContextAssemblyService {
    private static readonly DEFAULT_MAX_TOKENS = 8000; // Conservative default
    private static readonly TOKENS_PER_CHAR = 0.25; // Rough estimate: 4 chars per token

    /**
     * Assemble context from search results
     */
    static assemble(
        results: HybridSearchResult[],
        options: ContextAssemblyOptions = {}
    ): AssembledContext {
        const maxTokens = options.maxTokens || this.DEFAULT_MAX_TOKENS;
        const includeProvenance = options.includeProvenance !== false;
        const preserveBoundaries = options.preserveFunctionBoundaries !== false;

        const chunks: AssembledContext['chunks'] = [];
        let assembledContent = '';
        let totalTokens = 0;
        let truncated = false;

        // Sort by score (should already be sorted, but ensure)
        const sortedResults = [...results].sort((a, b) => b.score - a.score);

        for (const result of sortedResults) {
            const chunkContent = result.content;
            const chunkTokens = this.estimateTokens(chunkContent);

            // Check if adding this chunk would exceed limit
            if (totalTokens + chunkTokens > maxTokens) {
                if (preserveBoundaries) {
                    // Try to include partial chunk if it's a function/class
                    const partialContent = this.truncateToBoundary(
                        chunkContent,
                        maxTokens - totalTokens
                    );
                    const partialTokens = this.estimateTokens(partialContent);

                    if (partialTokens > 0 && totalTokens + partialTokens <= maxTokens) {
                        assembledContent += this.formatChunk(
                            partialContent,
                            result,
                            includeProvenance,
                            true // isPartial
                        );
                        chunks.push({
                            chunkId: result.chunkId,
                            filePath: result.metadata.filePath,
                            startLine: result.metadata.startLine,
                            endLine: result.metadata.endLine,
                            commitSha: result.metadata.commitSha,
                            score: result.score
                        });
                        totalTokens += partialTokens;
                    }
                }
                truncated = true;
                break;
            }

            // Add full chunk
            assembledContent += this.formatChunk(
                chunkContent,
                result,
                includeProvenance,
                false
            );
            chunks.push({
                chunkId: result.chunkId,
                filePath: result.metadata.filePath,
                startLine: result.metadata.startLine,
                endLine: result.metadata.endLine,
                commitSha: result.metadata.commitSha,
                score: result.score
            });
            totalTokens += chunkTokens;
        }

        loggingService.info('Context assembled', {
            component: 'ContextAssemblyService',
            chunksCount: chunks.length,
            totalTokens,
            truncated
        });

        return {
            content: assembledContent,
            chunks,
            totalTokens,
            truncated
        };
    }

    /**
     * Format a chunk with provenance information
     */
    private static formatChunk(
        content: string,
        result: HybridSearchResult,
        includeProvenance: boolean,
        isPartial: boolean
    ): string {
        let formatted = '';

        if (includeProvenance) {
            const provenance = `\n=== FILE: ${result.metadata.filePath} (lines ${result.metadata.startLine}-${result.metadata.endLine}, commit: ${result.metadata.commitSha.substring(0, 7)}) ===\n`;
            formatted += provenance;

            // Add AST metadata if available
            if (result.metadata.astMetadata) {
                const astInfo: string[] = [];
                if (result.metadata.astMetadata.functionName) {
                    astInfo.push(`Function: ${result.metadata.astMetadata.functionName}`);
                }
                if (result.metadata.astMetadata.className) {
                    astInfo.push(`Class: ${result.metadata.astMetadata.className}`);
                }
                if (result.metadata.astMetadata.signature) {
                    astInfo.push(`Signature: ${result.metadata.astMetadata.signature}`);
                }
                if (astInfo.length > 0) {
                    formatted += `[${astInfo.join(', ')}]\n`;
                }
            }
        }

        formatted += content;

        if (isPartial) {
            formatted += '\n[... truncated ...]';
        }

        formatted += '\n\n';

        return formatted;
    }

    /**
     * Truncate content to function/class boundary
     */
    private static truncateToBoundary(
        content: string,
        maxTokens: number
    ): string {
        const maxChars = Math.floor(maxTokens / this.TOKENS_PER_CHAR);
        
        if (content.length <= maxChars) {
            return content;
        }

        // Try to find a good truncation point (end of function, class, or statement)
        const lines = content.split('\n');
        let truncated = '';
        let currentTokens = 0;

        for (const line of lines) {
            const lineTokens = this.estimateTokens(line);
            if (currentTokens + lineTokens > maxTokens) {
                break;
            }
            truncated += line + '\n';
            currentTokens += lineTokens;
        }

        return truncated.trim();
    }

    /**
     * Estimate token count (rough approximation)
     */
    private static estimateTokens(text: string): number {
        return Math.ceil(text.length * this.TOKENS_PER_CHAR);
    }
}

