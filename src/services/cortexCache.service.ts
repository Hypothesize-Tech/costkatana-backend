import { createHash } from 'crypto';
import { loggingService } from './logging.service';

/**
 * Semantic Cache for Cortex optimizations
 * Stores optimization results to avoid redundant AI processing
 */

interface CachedCortexResult {
    originalPrompt: string;
    optimizedPrompt: string;
    cortexMetadata: any;
    tokenReduction: {
        originalTokens: number;
        cortexTokens: number;
        reductionPercentage: number;
    };
    semanticHash: string;
    createdAt: Date;
    accessCount: number;
    lastAccessed: Date;
}

interface SemanticCacheConfig {
    enabled: boolean;
    ttl: number; // Time to live in seconds
    maxEntries: number;
    similarityThreshold: number; // 0-1, minimum similarity for cache hit
    useRedis: boolean;
}

export class CortexCacheService {
    private static cache = new Map<string, CachedCortexResult>();
    private static config: SemanticCacheConfig = {
        enabled: process.env.CORTEX_CACHE_ENABLED !== 'false',
        ttl: parseInt(process.env.CORTEX_CACHE_TTL || '3600'), // 1 hour
        maxEntries: parseInt(process.env.CORTEX_CACHE_MAX_ENTRIES || '1000'),
        similarityThreshold: parseFloat(process.env.CORTEX_CACHE_SIMILARITY_THRESHOLD || '0.85'),
        useRedis: process.env.REDIS_URL !== undefined
    };

    /**
     * Generate a semantic hash for a prompt
     * Uses content-based hashing to identify similar prompts
     */
    private static generateSemanticHash(prompt: string): string {
        // Normalize the prompt for better semantic matching
        const normalized = prompt
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ') // Remove punctuation
            .replace(/\s+/g, ' ')      // Normalize spaces
            .trim();

        // Create hash of normalized content
        return createHash('sha256')
            .update(normalized)
            .digest('hex')
            .substring(0, 16); // Use first 16 chars for shorter keys
    }

    /**
     * Calculate semantic similarity between two prompts
     * Uses simple word overlap similarity (can be enhanced with embeddings)
     */
    private static calculateSimilarity(prompt1: string, prompt2: string): number {
        const words1 = new Set(prompt1.toLowerCase().split(/\s+/));
        const words2 = new Set(prompt2.toLowerCase().split(/\s+/));
        
        const intersection = new Set([...words1].filter(word => words2.has(word)));
        const union = new Set([...words1, ...words2]);
        
        return intersection.size / union.size; // Jaccard similarity
    }

    /**
     * Check if we have a cached result for a similar prompt
     */
    static async getCachedResult(prompt: string): Promise<CachedCortexResult | null> {
        if (!this.config.enabled) {
            return null;
        }

        const semanticHash = this.generateSemanticHash(prompt);
        
        // First, try exact hash match
        let cached = this.cache.get(semanticHash);
        if (cached) {
            // Check if cache entry is still valid
            const age = Date.now() - cached.createdAt.getTime();
            if (age > this.config.ttl * 1000) {
                this.cache.delete(semanticHash);
                loggingService.debug('Cache entry expired', { semanticHash, age });
                return null;
            }

            // Update access statistics
            cached.accessCount++;
            cached.lastAccessed = new Date();
            
            loggingService.info('🎯 Cortex cache HIT (exact)', {
                semanticHash,
                accessCount: cached.accessCount,
                ageMinutes: Math.round(age / 60000)
            });
            
            return cached;
        }

        // If no exact match, try semantic similarity matching
        for (const [hash, entry] of this.cache.entries()) {
            const similarity = this.calculateSimilarity(prompt, entry.originalPrompt);
            
            if (similarity >= this.config.similarityThreshold) {
                // Check if entry is still valid
                const age = Date.now() - entry.createdAt.getTime();
                if (age > this.config.ttl * 1000) {
                    this.cache.delete(hash);
                    continue;
                }

                // Update access statistics
                entry.accessCount++;
                entry.lastAccessed = new Date();
                
                loggingService.info('🎯 Cortex cache HIT (semantic)', {
                    originalHash: hash,
                    queriedHash: semanticHash,
                    similarity: similarity.toFixed(3),
                    accessCount: entry.accessCount,
                    ageMinutes: Math.round(age / 60000)
                });
                
                return entry;
            }
        }

        loggingService.debug('🔍 Cortex cache MISS', {
            semanticHash,
            cacheSize: this.cache.size,
            prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : '')
        });

        return null;
    }

    /**
     * Store a Cortex optimization result in the cache
     */
    static async setCachedResult(
        originalPrompt: string,
        optimizedPrompt: string,
        cortexMetadata: any,
        tokenReduction: {
            originalTokens: number;
            cortexTokens: number;
            reductionPercentage: number;
        }
    ): Promise<void> {
        if (!this.config.enabled) {
            return;
        }

        const semanticHash = this.generateSemanticHash(originalPrompt);
        
        // Implement LRU eviction if cache is full
        if (this.cache.size >= this.config.maxEntries) {
            this.evictLRUEntry();
        }

        const cachedResult: CachedCortexResult = {
            originalPrompt,
            optimizedPrompt,
            cortexMetadata,
            tokenReduction,
            semanticHash,
            createdAt: new Date(),
            accessCount: 1,
            lastAccessed: new Date()
        };

        this.cache.set(semanticHash, cachedResult);

        loggingService.info('💾 Cortex result cached', {
            semanticHash,
            originalLength: originalPrompt.length,
            optimizedLength: optimizedPrompt.length,
            reductionPercentage: tokenReduction.reductionPercentage.toFixed(1),
            cacheSize: this.cache.size
        });
    }

    /**
     * Evict the least recently used cache entry
     */
    private static evictLRUEntry(): void {
        let oldestEntry: { key: string; lastAccessed: Date } | null = null;
        
        for (const [key, entry] of this.cache.entries()) {
            if (!oldestEntry || entry.lastAccessed < oldestEntry.lastAccessed) {
                oldestEntry = { key, lastAccessed: entry.lastAccessed };
            }
        }

        if (oldestEntry) {
            this.cache.delete(oldestEntry.key);
            loggingService.debug('🗑️ Cache LRU eviction', {
                evictedKey: oldestEntry.key,
                newSize: this.cache.size
            });
        }
    }

    /**
     * Get cache statistics
     */
    static getCacheStats(): {
        enabled: boolean;
        size: number;
        maxEntries: number;
        hitRate?: number;
        config: SemanticCacheConfig;
    } {
        const stats = {
            enabled: this.config.enabled,
            size: this.cache.size,
            maxEntries: this.config.maxEntries,
            config: this.config,
            hitRate: 0 as number
        };

        // Calculate hit rate if we have entries
        if (this.cache.size > 0) {
            let totalAccess = 0;
            let totalHits = 0;
            
            for (const entry of this.cache.values()) {
                totalAccess += entry.accessCount;
                totalHits += entry.accessCount - 1; // First access is not a "hit"
            }
            
            stats.hitRate = totalAccess > 0 ? totalHits / totalAccess : 0;
        }

        return stats;
    }

    /**
     * Clear all cached entries
     */
    static clearCache(): void {
        const size = this.cache.size;
        this.cache.clear();
        loggingService.info('🧹 Cortex cache cleared', { entriesRemoved: size });
    }

    /**
     * Remove expired entries from cache
     */
    static cleanupExpiredEntries(): number {
        const now = Date.now();
        let removed = 0;

        for (const [key, entry] of this.cache.entries()) {
            const age = now - entry.createdAt.getTime();
            if (age > this.config.ttl * 1000) {
                this.cache.delete(key);
                removed++;
            }
        }

        if (removed > 0) {
            loggingService.info('🧹 Cache cleanup completed', {
                entriesRemoved: removed,
                remainingEntries: this.cache.size
            });
        }

        return removed;
    }
}
