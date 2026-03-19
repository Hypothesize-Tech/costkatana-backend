/**
 * Reranker Service for NestJS
 * Improves search result relevance using cross-encoder style scoring or LLM-based reranking
 */

import { Injectable, Logger } from '@nestjs/common';
import { BedrockService } from '../../bedrock/bedrock.service';
import { HybridSearchResult } from './hybrid-search.service';

export interface RerankOptions {
  topK?: number; // Number of top results to return
  useLLM?: boolean; // Use LLM-based reranking (slower but more accurate)
}

@Injectable()
export class RerankerService {
  private readonly logger = new Logger(RerankerService.name);
  private static readonly DEFAULT_TOP_K = 50;
  private static readonly MAX_CANDIDATES_FOR_LLM = 100;

  constructor(private readonly bedrockService: BedrockService) {}

  /**
   * Rerank search results using relevance scoring
   */
  async rerank(
    query: string,
    candidates: HybridSearchResult[],
    options: RerankOptions = {},
  ): Promise<HybridSearchResult[]> {
    const topK = options.topK || RerankerService.DEFAULT_TOP_K;

    if (candidates.length === 0) {
      return [];
    }

    if (candidates.length <= topK && !options.useLLM) {
      // No need to rerank if we have fewer candidates than requested
      return candidates;
    }

    try {
      if (
        options.useLLM &&
        candidates.length <= RerankerService.MAX_CANDIDATES_FOR_LLM
      ) {
        return await this.rerankWithLLM(query, candidates, topK);
      } else {
        return await this.rerankWithScoring(query, candidates, topK);
      }
    } catch (error) {
      this.logger.error('Reranking failed, returning original order', {
        error: error instanceof Error ? error.message : String(error),
      });
      return candidates.slice(0, topK);
    }
  }

  /**
   * Rerank using LLM-based relevance scoring (more accurate but slower)
   */
  private async rerankWithLLM(
    query: string,
    candidates: HybridSearchResult[],
    topK: number,
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
        className: candidate.metadata.astMetadata?.className,
      }));

      const prompt = `You are a code search relevance scorer. Given a user query and candidate code snippets, score each candidate's relevance to the query.

User Query: "${query}"

Candidates:
${candidateSummaries
  .map(
    (c, i) => `
${i + 1}. File: ${c.filePath} (lines ${c.startLine}-${c.endLine})
   ${c.functionName ? `Function: ${c.functionName}` : ''}
   ${c.className ? `Class: ${c.className}` : ''}
   Preview: ${c.preview}...
`,
  )
  .join('\n')}

Return a JSON array of scores (0-1) for each candidate, where 1.0 is most relevant:
[0.95, 0.87, 0.72, ...]

Return ONLY the JSON array, no other text.`;

      const response = await BedrockService.invokeModel(
        prompt,
        'anthropic.claude-3-5-sonnet-20241022-v2:0',
        { useSystemPrompt: false },
      );

      let scores: number[] = [];
      const responseText = typeof response === 'string' ? response.trim() : '';
      if (responseText) {
        const jsonMatch = responseText.match(/\[[\d.,\s]+\]/);
        if (jsonMatch) {
          try {
            scores = JSON.parse(jsonMatch[0]) as number[];
          } catch (parseError) {
            this.logger.warn('Failed to parse LLM scores, using fallback', {
              parseError,
            });
          }
        }
      }

      if (scores.length === candidates.length) {
        // Combine scores with candidates
        const scoredCandidates = candidates.map((candidate, index) => ({
          ...candidate,
          score: scores[index] || candidate.score,
        }));

        // Sort by new score and return top K
        return scoredCandidates
          .sort((a, b) => b.score - a.score)
          .slice(0, topK);
      }
    } catch (error) {
      this.logger.warn('LLM reranking failed, falling back to scoring', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback to scoring-based reranking
    return this.rerankWithScoring(query, candidates, topK);
  }

  /**
   * Rerank using heuristic scoring (faster)
   */
  private async rerankWithScoring(
    query: string,
    candidates: HybridSearchResult[],
    topK: number,
  ): Promise<HybridSearchResult[]> {
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 2);

    const scoredCandidates = candidates.map((candidate) => {
      let score = candidate.score; // Start with original hybrid score

      const content = candidate.content.toLowerCase();
      const filePath = candidate.metadata.filePath.toLowerCase();

      // Boost score based on query term frequency in content
      let termFrequency = 0;
      queryTerms.forEach((term) => {
        const matches = (content.match(new RegExp(term, 'g')) || []).length;
        termFrequency += matches;
      });

      // Normalize term frequency boost
      const termBoost = Math.min(termFrequency / (queryTerms.length * 10), 0.3);
      score += termBoost;

      // Boost if query terms appear in file path
      const pathMatches = queryTerms.filter((term) =>
        filePath.includes(term),
      ).length;
      if (pathMatches > 0) {
        score += 0.2 * (pathMatches / queryTerms.length);
      }

      // Boost exact function/class name matches
      if (candidate.metadata.astMetadata) {
        const funcName =
          candidate.metadata.astMetadata.functionName?.toLowerCase();
        const className =
          candidate.metadata.astMetadata.className?.toLowerCase();

        queryTerms.forEach((term) => {
          if (funcName === term || className === term) {
            score += 0.5; // Strong boost for exact symbol match
          }
        });
      }

      // Recency boost: newer chunks get a small score boost (time-decay over 90 days)
      if (candidate.metadata?.indexedAt) {
        const indexedAt =
          typeof candidate.metadata.indexedAt === 'number'
            ? candidate.metadata.indexedAt
            : new Date(candidate.metadata.indexedAt).getTime();
        const ageMs = Date.now() - indexedAt;
        const ageDays = ageMs / (24 * 60 * 60 * 1000);
        const halfLifeDays = 90;
        const recencyBoost =
          0.15 * Math.max(0, Math.exp(-ageDays / halfLifeDays));
        score += recencyBoost;
      }

      return {
        ...candidate,
        score: Math.min(score, 1.0), // Cap at 1.0
      };
    });

    // Sort by new score and return top K
    return scoredCandidates.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
