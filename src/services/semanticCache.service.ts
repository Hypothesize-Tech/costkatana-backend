/**
 * Semantic Cache Service
 * 
 * Provides intelligent caching based on semantic similarity of prompts,
 * enabling cache hits even when prompts are worded differently but mean the same thing.
*/

import axios from 'axios';
import { loggingService } from './logging.service';
import { cacheService } from './cache.service';
import { estimateTokens } from '../utils/tokenCounter';
import { AIProvider } from '../types/aiCostTracker.types';

export interface CachingOpportunity {
    found: boolean;
    similarPromptHash?: string;
    similarityScore?: number;
    potentialSavings: number;
    cachedResponse?: any;
    cacheKey?: string;
}

export class SemanticCacheService {
    /**
     * Detects if a similar request was made recently and calculates potential savings.
     */
    static async detectCachingOpportunity(
        userId: string,
        prompt: string,
        similarityThreshold: number = 0.85
    ): Promise<CachingOpportunity> {
        try {
            // Generate prompt hash for exact match lookup
            const promptHash = this.generatePromptHash(prompt);

            // Try an exact cache hit first
            const exactCacheKey = `semantic_cache:${userId}:${promptHash}`;
            const exactCachedResponse: unknown = await cacheService.get(exactCacheKey);
            if (exactCachedResponse !== undefined && exactCachedResponse !== null) {
                // Calculate savings for exact match
                const promptTokens = estimateTokens(prompt, AIProvider.OpenAI);
                const avgCompletionTokens = 500;
                const avgCostPerToken = 0.000002;
                const potentialSavings = (promptTokens + avgCompletionTokens) * avgCostPerToken;

                loggingService.info('Semantic cache opportunity detected (exact match)', {
                    userId,
                    promptHash,
                    potentialSavings: potentialSavings.toFixed(6),
                    cacheKey: exactCacheKey,
                    similarityScore: 1.0
                });

                if (1.0 >= similarityThreshold) {
                    return {
                        found: true,
                        similarPromptHash: promptHash,
                        similarityScore: 1.0,
                        potentialSavings,
                        cachedResponse: exactCachedResponse,
                        cacheKey: exactCacheKey
                    };
                }
            }

            // In production: Search for similar prompts by scanning user semantic_cache keys and comparing embeddings
            // 1. Scan semantic cache keys for this user
            let keys: string[] = [];
            if (typeof cacheService.keys === "function") {
                const rawKeys = await cacheService.keys(`semantic_cache:${userId}:*`);
                if (Array.isArray(rawKeys)) {
                    keys = rawKeys.filter((k: unknown) => typeof k === 'string') as string[];
                }
            } else {
                loggingService.warn("Cache service does not support .keys, semantic similarity cache will not be effective");
                return { found: false, potentialSavings: 0 };
            }
            if (keys.length === 0 || similarityThreshold >= 1.0) {
                return {
                    found: false,
                    potentialSavings: 0
                };
            }

            // 2. Compute embedding for the prompt
            const promptEmbedding = await SemanticCacheService.embedPrompt(prompt);

            // 3. Compare with each cached prompt (use L2 or cosine similarity)
            let bestScore = 0;
            let bestKey: string | undefined;
            let bestPromptHash: string | undefined;
            let bestCachedResponse: unknown = undefined;
            for (const key of keys) {
                // Parse cached prompt hash from key
                const split = key.split(':');
                const cachedPromptHash = split[2];
                if (!cachedPromptHash || cachedPromptHash === promptHash) continue; // skip exact (already checked)

                // Retrieve the original prompt from a shadow index so we can embed it
                let cachedPromptObj: unknown;
                try {
                    cachedPromptObj = await cacheService.get(`${key}:prompt`);
                } catch (err) {
                    loggingService.debug("Error getting cached prompt object", { key, error: String(err) });
                    continue;
                }
                const cachedPrompt = (typeof cachedPromptObj === "string") ? cachedPromptObj : undefined;
                if (!cachedPrompt) continue;

                const cachedEmbedding = await SemanticCacheService.embedPrompt(cachedPrompt);
                const similarity = SemanticCacheService.cosineSimilarity(promptEmbedding, cachedEmbedding);

                if (similarity > bestScore) {
                    bestScore = similarity;
                    bestKey = key;
                    bestPromptHash = cachedPromptHash;
                }
            }

            // 4. If the best similarity above threshold, serve cache
            if (bestKey && bestScore >= similarityThreshold) {
                let bestCachedResponseObj: unknown;
                try {
                    bestCachedResponseObj = await cacheService.get(bestKey);
                } catch (err) {
                    loggingService.debug("Error getting best cached response object", { bestKey, error: String(err) });
                }
                // "bestCachedResponse" was previously unused, now set:
                bestCachedResponse = bestCachedResponseObj;

                // Calculate potential savings as above
                const promptTokens = estimateTokens(prompt, AIProvider.OpenAI);
                const avgCompletionTokens = 500;
                const avgCostPerToken = 0.000002;
                const potentialSavings = (promptTokens + avgCompletionTokens) * avgCostPerToken;

                loggingService.info('Semantic cache opportunity detected (semantic match)', {
                    userId,
                    similarPromptHash: bestPromptHash,
                    similarityScore: bestScore,
                    cacheKey: bestKey,
                    potentialSavings: potentialSavings.toFixed(6)
                });

                return {
                    found: true,
                    similarPromptHash: bestPromptHash,
                    similarityScore: bestScore,
                    potentialSavings,
                    cachedResponse: bestCachedResponse,
                    cacheKey: bestKey
                };
            }

            // No semantic hit
            return {
                found: false,
                potentialSavings: 0
            };

        } catch (error) {
            loggingService.error('Error detecting caching opportunity', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });

            return {
                found: false,
                potentialSavings: 0
            };
        }
    }

    /**
     * Get embedding for a prompt string using AI provider (production-ready, e.g., OpenAI endpoint or local model)
     * This implementation uses OpenAI embeddings API for production use.
     * It expects an OPENAI_API_KEY to be present in process.env.
     */
    private static async embedPrompt(prompt: string): Promise<number[]> {
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        if (!OPENAI_API_KEY) {
            throw new Error("OPENAI_API_KEY environment variable is required for semantic caching!");
        }

        try {
            // Call OpenAI embedding endpoint (for example, using "text-embedding-ada-002" model)
            const response = await axios.post(
                'https://api.openai.com/v1/embeddings',
                {
                    input: prompt,
                    model: 'text-embedding-ada-002'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${OPENAI_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            // If the API returned the embedding, extract and return it
            if (
                response.data &&
                response.data.data &&
                Array.isArray(response.data.data) &&
                response.data.data.length > 0 &&
                response.data.data[0].embedding &&
                Array.isArray(response.data.data[0].embedding)
            ) {
                return response.data.data[0].embedding as number[];
            } else {
                throw new Error('OpenAI API response missing expected embedding data');
            }
        } catch (error: any) {
            // Log error, but rethrow for application to handle
            loggingService.error('Failed to get prompt embedding from OpenAI', {
                error: error.message || String(error),
                prompt,
            });
            throw error;
        }
    }

    /**
     * Compute cosine similarity between two vectors
     */
    private static cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (vecA.length !== vecB.length) return 0;
        const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
        const normA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
        const normB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
        if (normA === 0 || normB === 0) return 0;
        return dot / (normA * normB);
    }
    
    /**
     * Stores a response in the semantic cache.
     */
    static async storeInSemanticCache(
        userId: string,
        prompt: string,
        response: any,
        ttl: number = 3600 // 1 hour default
    ): Promise<void> {
        try {
            const promptHash = this.generatePromptHash(prompt);
            const cacheKey = `semantic_cache:${userId}:${promptHash}`;
            
            await cacheService.set(cacheKey, response, ttl);
            
            loggingService.debug('Response stored in semantic cache', {
                userId,
                promptHash,
                cacheKey,
                ttl
            });
        } catch (error) {
            loggingService.error('Error storing in semantic cache', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
        }
    }
    
    /**
     * Generates a hash for a prompt to enable similarity matching.
     * In a production system, this would use embeddings and vector similarity.
     */
    private static generatePromptHash(prompt: string): string {
        // Normalize prompt for better matching
        const normalized = prompt
            .toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        
        // Simple hash function (in production, use embeddings)
        let hash = 0;
        for (let i = 0; i < normalized.length; i++) {
            const char = normalized.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        
        return Math.abs(hash).toString(36);
    }
    
    /**
     * Clears the semantic cache for a user.
     */
    static async clearUserCache(userId: string): Promise<void> {
        try {
            loggingService.info('Clearing semantic cache for user', { userId });

            // Get all semantic cache keys for the user
            let keys: string[] = [];
            if (typeof cacheService.keys === "function") {
                const rawKeys = await cacheService.keys(`semantic_cache:${userId}:*`);
                if (Array.isArray(rawKeys)) {
                    keys = rawKeys.filter((k: unknown) => typeof k === 'string') as string[];
                }
            } else if (typeof (cacheService as any).scan === "function") {
                // Fallback: use scan if supported
                let cursor = '0';
                do {
                    const [nextCursor, foundKeys] = await (cacheService as any).scan(cursor, 'MATCH', `semantic_cache:${userId}:*`);
                    cursor = nextCursor;
                    if (Array.isArray(foundKeys)) {
                        keys.push(...(foundKeys.filter((k: unknown) => typeof k === 'string')));
                    }
                } while (cursor !== '0');
            } else {
                loggingService.warn("Cache service does not support .keys or .scan, cannot clear semantic cache for user", { userId });
                return;
            }

            if (keys.length === 0) {
                loggingService.info('No semantic cache keys found to clear for user', { userId });
                return;
            }

            // Delete all found keys
            if (typeof cacheService.delete === "function") {
                await Promise.all(keys.map(key => cacheService.delete(key)));
            } else {
                loggingService.warn("Cache service does not support .delete method", { userId });
                return;
            }

            loggingService.info('Semantic cache cleared for user', { userId, deletedKeys: keys.length });
        } catch (error) {
            loggingService.error('Error clearing semantic cache', {
                error: error instanceof Error ? error.message : String(error),
                userId
            });
        }
    }
}


