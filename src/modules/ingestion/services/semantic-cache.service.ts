/**
 * Semantic Cache Service for NestJS
 *
 * Provides intelligent caching based on semantic similarity of prompts,
 * enabling cache hits even when prompts are worded differently but mean the same thing.
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as crypto from 'crypto';
import { SafeBedrockEmbeddingsService } from './safe-bedrock-embeddings.service';
import { ConfigService } from '@nestjs/config';

export interface CachingOpportunity {
  found: boolean;
  similarPromptHash?: string;
  similarityScore?: number;
  potentialSavings: number;
  cachedResponse?: any;
  cacheKey?: string;
}

interface SemanticCacheEntry {
  prompt: string;
  response: any;
  embedding: number[];
  timestamp: number;
  ttl: number;
}

@Injectable()
export class SemanticCacheService {
  private readonly logger = new Logger(SemanticCacheService.name);
  private readonly enableSemanticCache: boolean;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly embeddingsService: SafeBedrockEmbeddingsService,
    private readonly configService: ConfigService,
  ) {
    this.enableSemanticCache = this.configService.get<boolean>(
      'ENABLE_SEMANTIC_CACHE',
      false,
    );
  }

  /**
   * Detects if a similar request was made recently and calculates potential savings.
   */
  async detectCachingOpportunity(
    userId: string,
    prompt: string,
    similarityThreshold: number = 0.85,
  ): Promise<CachingOpportunity> {
    try {
      if (!this.enableSemanticCache) {
        return { found: false, potentialSavings: 0 };
      }

      // Generate prompt hash for exact match lookup
      const promptHash = this.generateExactMatchHash(prompt);

      // Try an exact cache hit first
      const exactCacheKey = `semantic_cache:${userId}:${promptHash}`;
      const exactCacheEntry: SemanticCacheEntry | undefined =
        await this.cacheManager.get<SemanticCacheEntry>(exactCacheKey);
      if (
        exactCacheEntry &&
        exactCacheEntry.response !== undefined &&
        exactCacheEntry.response !== null
      ) {
        // Check if expired
        if (
          Date.now() >
          exactCacheEntry.timestamp + exactCacheEntry.ttl * 1000
        ) {
          // Clean up expired entry
          await this.cacheManager.del(exactCacheKey);
        } else {
          // Calculate savings for exact match
          const promptTokens = this.estimateTokens(prompt);
          const avgCompletionTokens = 500;
          const avgCostPerToken = 0.000002;
          const potentialSavings =
            (promptTokens + avgCompletionTokens) * avgCostPerToken;

          this.logger.log('Semantic cache opportunity detected (exact match)', {
            userId,
            promptHash,
            potentialSavings: potentialSavings.toFixed(6),
            cacheKey: exactCacheKey,
            similarityScore: 1.0,
          });

          if (1.0 >= similarityThreshold) {
            return {
              found: true,
              similarPromptHash: promptHash,
              similarityScore: 1.0,
              potentialSavings,
              cachedResponse: exactCacheEntry.response,
              cacheKey: exactCacheKey,
            };
          }
        }
      }

      // Search for similar prompts using semantic similarity
      const semanticResult = await this.findSemanticMatch(
        userId,
        prompt,
        similarityThreshold,
        promptHash,
      );
      if (semanticResult.found) {
        return semanticResult;
      }

      // No semantic hit
      return {
        found: false,
        potentialSavings: 0,
      };
    } catch (error) {
      this.logger.error('Error detecting caching opportunity', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });

      return {
        found: false,
        potentialSavings: 0,
      };
    }
  }

  /**
   * Find semantic match by comparing embeddings
   */
  private async findSemanticMatch(
    userId: string,
    prompt: string,
    similarityThreshold: number,
    promptHash: string,
  ): Promise<CachingOpportunity> {
    try {
      // Generate embedding for the current prompt
      const promptEmbedding = await this.embeddingsService.embedQuery(prompt);

      // Get semantic cache index for this user
      const indexKey = `semantic_cache_index:${userId}`;
      const indexData = (await this.cacheManager.get(indexKey)) || [];

      let bestMatch: CachingOpportunity | null = null;

      // Compare with all cached entries for this user
      for (const entryKey of indexData as string[]) {
        try {
          const entry: SemanticCacheEntry | undefined =
            await this.cacheManager.get<SemanticCacheEntry>(entryKey);
          if (!entry || !entry.embedding) continue;

          // Skip if expired
          if (Date.now() > entry.timestamp + entry.ttl * 1000) {
            // Clean up expired entry
            await this.cacheManager.del(entryKey);
            continue;
          }

          // Calculate cosine similarity
          const similarity = this.cosineSimilarity(
            promptEmbedding,
            entry.embedding,
          );

          if (similarity >= similarityThreshold) {
            // Calculate potential savings
            const promptTokens = this.estimateTokens(prompt);
            const avgCompletionTokens = 500;
            const avgCostPerToken = 0.000002;
            const potentialSavings =
              (promptTokens + avgCompletionTokens) * avgCostPerToken;

            // Keep the best match
            if (!bestMatch || similarity > (bestMatch.similarityScore || 0)) {
              bestMatch = {
                found: true,
                similarPromptHash: entryKey.split(':').pop(),
                similarityScore: similarity,
                potentialSavings,
                cachedResponse: entry.response,
                cacheKey: entryKey,
              };
            }
          }
        } catch (entryError) {
          // Skip malformed entries
          this.logger.debug('Skipping malformed cache entry', { entryKey });
        }
      }

      if (bestMatch) {
        this.logger.log(
          'Semantic cache opportunity detected (semantic match)',
          {
            userId,
            similarPromptHash: bestMatch.similarPromptHash,
            similarityScore: bestMatch.similarityScore?.toFixed(3),
            cacheKey: bestMatch.cacheKey,
            potentialSavings: bestMatch.potentialSavings.toFixed(6),
          },
        );
        return bestMatch;
      }

      return { found: false, potentialSavings: 0 };
    } catch (error) {
      this.logger.warn('Semantic similarity search failed', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return { found: false, potentialSavings: 0 };
    }
  }

  /**
   * Stores a response in the semantic cache with embeddings.
   */
  async storeInSemanticCache(
    userId: string,
    prompt: string,
    response: any,
    ttl: number = 3600, // 1 hour default
  ): Promise<void> {
    try {
      if (!this.enableSemanticCache) {
        return;
      }

      const promptHash = this.generateExactMatchHash(prompt);
      const cacheKey = `semantic_cache:${userId}:${promptHash}`;

      // Generate embedding for the prompt using the new embeddings method
      const embedding = await this.generatePromptEmbeddings(prompt);

      // Create semantic cache entry
      const cacheEntry: SemanticCacheEntry = {
        prompt,
        response,
        embedding,
        timestamp: Date.now(),
        ttl,
      };

      // Store the entry
      await this.cacheManager.set(cacheKey, cacheEntry, ttl);

      // Update the user's semantic cache index
      await this.updateUserIndex(userId, cacheKey, ttl);

      this.logger.debug('Response stored in semantic cache with embeddings', {
        userId,
        promptHash,
        cacheKey,
        embeddingDimensions: embedding.length,
        ttl,
      });
    } catch (error) {
      this.logger.error('Error storing in semantic cache', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
    }
  }

  /**
   * Clears the semantic cache for a user.
   */
  async clearUserCache(userId: string): Promise<void> {
    try {
      if (!this.enableSemanticCache) {
        return;
      }

      this.logger.log('Clearing semantic cache for user', { userId });

      const indexKey = `semantic_cache_index:${userId}`;
      const indexData = (await this.cacheManager.get(indexKey)) || [];

      let deletedCount = 0;
      for (const entryKey of indexData as string[]) {
        await this.cacheManager.del(entryKey);
        deletedCount++;
      }

      await this.cacheManager.del(indexKey);

      const globalIndexKey = 'semantic_cache_user_ids';
      const userIds = (await this.cacheManager.get(globalIndexKey)) as
        | string[]
        | undefined;
      if (userIds && userIds.length > 0) {
        const next = userIds.filter((id: string) => id !== userId);
        if (next.length === 0) {
          await this.cacheManager.del(globalIndexKey);
        } else {
          await this.cacheManager.set(globalIndexKey, next, 86400 * 7 * 1000);
        }
      }

      this.logger.log('Semantic cache cleared for user', {
        userId,
        deletedEntries: deletedCount,
      });
    } catch (error) {
      this.logger.error('Error clearing semantic cache', {
        error: error instanceof Error ? error.message : String(error),
        userId,
      });
    }
  }

  /**
   * Clean up expired entries across all users (maintenance method).
   * Uses a global index of user IDs that have semantic cache entries.
   */
  async cleanupExpiredEntries(): Promise<{
    cleanedCount: number;
    checkedCount: number;
  }> {
    let cleanedCount = 0;
    let checkedCount = 0;

    try {
      this.logger.log('Starting semantic cache cleanup');

      const globalIndexKey = 'semantic_cache_user_ids';
      const userIds = (await this.cacheManager.get(globalIndexKey)) as
        | string[]
        | undefined;

      if (!userIds || userIds.length === 0) {
        this.logger.log(
          'Semantic cache cleanup completed (no users with cache)',
          {
            cleanedCount: 0,
            checkedCount: 0,
          },
        );
        return { cleanedCount: 0, checkedCount: 0 };
      }

      const remainingUserIds: string[] = [];

      for (const userId of userIds) {
        const indexKey = `semantic_cache_index:${userId}`;
        const indexData = (await this.cacheManager.get(indexKey)) as
          | string[]
          | undefined;

        if (!indexData || indexData.length === 0) {
          await this.cacheManager.del(indexKey);
          continue;
        }

        const validEntryKeys: string[] = [];

        for (const entryKey of indexData) {
          checkedCount++;
          try {
            const entry: SemanticCacheEntry | undefined =
              await this.cacheManager.get<SemanticCacheEntry>(entryKey);
            if (!entry) {
              continue;
            }
            const expiresAt = entry.timestamp + entry.ttl * 1000;
            if (Date.now() > expiresAt) {
              await this.cacheManager.del(entryKey);
              cleanedCount++;
            } else {
              validEntryKeys.push(entryKey);
            }
          } catch {
            // Invalid or missing entry, treat as cleaned
            await this.cacheManager.del(entryKey).catch(() => {});
            cleanedCount++;
          }
        }

        if (validEntryKeys.length === 0) {
          await this.cacheManager.del(indexKey);
        } else {
          await this.cacheManager.set(
            indexKey,
            validEntryKeys,
            86400 * 7 * 1000,
          );
          remainingUserIds.push(userId);
        }
      }

      await this.cacheManager.set(
        globalIndexKey,
        remainingUserIds,
        86400 * 7 * 1000,
      );

      this.logger.log('Semantic cache cleanup completed', {
        cleanedCount,
        checkedCount,
      });

      return { cleanedCount, checkedCount };
    } catch (error) {
      this.logger.error('Error during semantic cache cleanup', {
        error: error instanceof Error ? error.message : String(error),
      });

      return { cleanedCount: 0, checkedCount: 0 };
    }
  }

  /**
   * Generates a hash for a prompt to enable similarity matching.
   * In a production system, this would use embeddings and vector similarity.
   */
  /**
   * Generates embeddings for a prompt to enable semantic similarity matching.
   * Uses vector embeddings for production-grade semantic caching.
   */
  private async generatePromptEmbeddings(prompt: string): Promise<number[]> {
    try {
      // Use the embeddings service for semantic similarity
      const embeddings = await this.embeddingsService.embedQuery(prompt);
      return embeddings;
    } catch (error) {
      this.logger.error('Failed to generate embeddings for prompt', {
        error: error instanceof Error ? error.message : String(error),
        promptLength: prompt.length,
      });
      // Fallback to simple hash if embeddings fail
      return this.fallbackHashToVector(prompt);
    }
  }

  /**
   * Fallback method when Bedrock embeddings fail.
   * Returns 1024-dim vector (matches Titan v2) so similarity comparisons work.
   * Uses SHA-256 spread across dimensions - not semantically meaningful but dimension-compatible.
   */
  private fallbackHashToVector(prompt: string): number[] {
    const normalized = prompt
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const hash = crypto.createHash('sha256').update(normalized).digest();
    const embedding: number[] = [];
    for (let i = 0; i < 1024; i++) {
      embedding.push(hash[i % hash.length] / 255);
    }
    return embedding;
  }

  /**
   * Generates a hash for exact matching (for cache keys)
   */
  private generateExactMatchHash(prompt: string): string {
    const normalized = prompt
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Estimate tokens in a prompt (simple approximation)
   */
  private estimateTokens(prompt: string): number {
    // Rough approximation: ~4 characters per token for English text
    return Math.ceil(prompt.length / 4);
  }

  /**
   * Update the user's semantic cache index
   */
  private async updateUserIndex(
    userId: string,
    entryKey: string,
    ttl: number,
  ): Promise<void> {
    const indexKey = `semantic_cache_index:${userId}`;
    const globalIndexKey = 'semantic_cache_user_ids';

    try {
      const indexData = (await this.cacheManager.get(indexKey)) || [];
      const indexSet = new Set(indexData as string[]);

      if (!indexSet.has(entryKey)) {
        indexSet.add(entryKey);
        await this.cacheManager.set(indexKey, Array.from(indexSet), ttl);
      }

      // Register this user in the global index for cleanup iteration
      const userIds = (await this.cacheManager.get(globalIndexKey)) as
        | string[]
        | undefined;
      const idSet = new Set<string>(userIds || []);
      if (!idSet.has(userId)) {
        idSet.add(userId);
        await this.cacheManager.set(
          globalIndexKey,
          Array.from(idSet),
          86400 * 7 * 1000,
        ); // 7 days TTL for index
      }
    } catch (error) {
      this.logger.warn('Failed to update user semantic cache index', {
        userId,
        entryKey,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get cache statistics for a user
   */
  async getCacheStats(userId: string): Promise<{
    totalEntries: number;
    totalSizeBytes: number;
    avgSimilarity: number;
  }> {
    try {
      const indexKey = `semantic_cache_index:${userId}`;
      const indexData = (await this.cacheManager.get(indexKey)) || [];

      let totalSizeBytes = 0;
      const totalSimilarity = 0;
      let validEntries = 0;

      for (const entryKey of indexData as string[]) {
        try {
          const entry: SemanticCacheEntry | undefined =
            await this.cacheManager.get<SemanticCacheEntry>(entryKey);
          if (entry) {
            // Rough size estimation
            totalSizeBytes += JSON.stringify(entry).length;
            validEntries++;
          }
        } catch (error) {
          // Skip invalid entries
        }
      }

      return {
        totalEntries: validEntries,
        totalSizeBytes,
        avgSimilarity: validEntries > 0 ? totalSimilarity / validEntries : 0,
      };
    } catch (error) {
      this.logger.warn('Failed to get cache stats', {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        totalEntries: 0,
        totalSizeBytes: 0,
        avgSimilarity: 0,
      };
    }
  }

  /**
   * Compute cosine similarity between two vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;
    const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    if (normA === 0 || normB === 0) return 0;
    return dot / (normA * normB);
  }
}
