import { HybridSearchResult } from './hybridSearch.service';
import { AIRouterService } from './aiRouter.service';
import { loggingService } from './logging.service';

export interface RerankOptions {
    topK?: number; // Number of top results to return
    useLLM?: boolean; // Use LLM-based reranking (slower but more accurate)
}

/**
 * Reranker service for improving search result relevance
 * Uses cross-encoder style scoring or LLM-based reranking
 */
export class RerankerService {
    private static readonly DEFAULT_TOP_K = 50;
    private static readonly MAX_CANDIDATES_FOR_LLM = 100;

    /**
     * Rerank search results using relevance scoring
     */
    static async rerank(
        query: string,
        candidates: HybridSearchResult[],
        options: RerankOptions = {}
    ): Promise<HybridSearchResult[]> {
        const topK = options.topK || this.DEFAULT_TOP_K;

        if (candidates.length === 0) {
            return [];
        }

        if (candidates.length <= topK && !options.useLLM) {
            // No need to rerank if we have fewer candidates than requested
            return candidates;
        }

        try {
            if (options.useLLM && candidates.length <= this.MAX_CANDIDATES_FOR_LLM) {
                return await this.rerankWithLLM(query, candidates, topK);
            } else {
                return await this.rerankWithScoring(query, candidates, topK);
            }
        } catch (error) {
            loggingService.error('Reranking failed, returning original order', {
                component: 'RerankerService',
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return candidates.slice(0, topK);
        }
    }

    /**
     * Rerank using LLM-based relevance scoring (more accurate but slower)
     */
    private static async rerankWithLLM(
        query: string,
        candidates: HybridSearchResult[],
        topK: number
    ): Promise<HybridSearchResult[]> {
        try {
            // Prepare candidate summaries for LLM
            const candidateSummaries = candidates.map((candidate, index) => ({
                index,
                filePath: candidate.metadata.filePath,
                startLine: candidate.metadata.startLine,
                endLine: candidate.metadata.endLine,
                preview: candidate.content.substring(0, 200),
                functionName: candidate.metadata.astMetadata?.functionName,
                className: candidate.metadata.astMetadata?.className
            }));

            const prompt = `You are a code search relevance scorer. Given a user query and candidate code snippets, score each candidate's relevance to the query.

User Query: "${query}"

Candidates:
${candidateSummaries.map((c, i) => `
${i + 1}. File: ${c.filePath} (lines ${c.startLine}-${c.endLine})
   ${c.functionName ? `Function: ${c.functionName}` : ''}
   ${c.className ? `Class: ${c.className}` : ''}
   Preview: ${c.preview}...
`).join('\n')}

Return a JSON array of scores (0-1) for each candidate, where 1.0 is most relevant:
[0.95, 0.87, 0.72, ...]

Return ONLY the JSON array, no other text.`;

            const response = await AIRouterService.invokeModel(
                prompt,
                'amazon.nova-pro-v1:0'
            );

            // Parse scores
            const jsonMatch = response.match(/\[[\d.,\s]+\]/);
            if (jsonMatch) {
                const scores = JSON.parse(jsonMatch[0]) as number[];

                // Combine scores with candidates
                const scoredCandidates = candidates.map((candidate, index) => ({
                    ...candidate,
                    score: scores[index] || candidate.score
                }));

                // Sort by new score and return top K
                return scoredCandidates
                    .sort((a, b) => b.score - a.score)
                    .slice(0, topK);
            }
        } catch (error) {
            loggingService.warn('LLM reranking failed, falling back to scoring', {
                component: 'RerankerService',
                error: error instanceof Error ? error.message : 'Unknown'
            });
        }

        // Fallback to scoring-based reranking
        return this.rerankWithScoring(query, candidates, topK);
    }

    /**
     * Rerank using heuristic scoring (faster)
     */
    private static async rerankWithScoring(
        query: string,
        candidates: HybridSearchResult[],
        topK: number
    ): Promise<HybridSearchResult[]> {
        const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);

        const scoredCandidates = candidates.map(candidate => {
            let score = candidate.score; // Start with original hybrid score

            const content = candidate.content.toLowerCase();
            const filePath = candidate.metadata.filePath.toLowerCase();

            // Boost score based on query term frequency in content
            let termFrequency = 0;
            queryTerms.forEach(term => {
                const matches = (content.match(new RegExp(term, 'g')) || []).length;
                termFrequency += matches;
            });

            // Normalize term frequency boost
            const termBoost = Math.min(termFrequency / (queryTerms.length * 10), 0.3);
            score += termBoost;

            // Boost if query terms appear in file path
            const pathMatches = queryTerms.filter(term => filePath.includes(term)).length;
            if (pathMatches > 0) {
                score += 0.2 * (pathMatches / queryTerms.length);
            }

            // Boost exact function/class name matches
            if (candidate.metadata.astMetadata) {
                const funcName = candidate.metadata.astMetadata.functionName?.toLowerCase();
                const className = candidate.metadata.astMetadata.className?.toLowerCase();

                queryTerms.forEach(term => {
                    if (funcName === term || className === term) {
                        score += 0.5; // Strong boost for exact symbol match
                    }
                });
            }

            // Boost recent chunks (if we have indexedAt in metadata)
            // This would require adding indexedAt to HybridSearchResult metadata

            return {
                ...candidate,
                score: Math.min(score, 1.0) // Cap at 1.0
            };
        });

        // Sort by new score and return top K
        return scoredCandidates
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);
    }
}

