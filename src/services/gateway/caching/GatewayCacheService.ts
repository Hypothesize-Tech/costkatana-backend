import { Request } from 'express';
import { loggingService } from '../../logging.service';
import { redisService } from '../../redis.service';

interface CacheEntry {
    response: any;
    timestamp: number;
    headers: Record<string, string>;
    ttl?: number;
    userScope?: string;
}

const DEFAULT_CACHE_TTL = 604800; // 7 days in seconds for Redis

/**
 * GatewayCacheService - Handles all caching operations for the gateway
 * Provides Redis-based caching with semantic matching and deduplication
 */
export class GatewayCacheService {
    /**
     * Check if response exists in cache using Redis with semantic matching
     */
    static async checkCache(req: Request): Promise<CacheEntry | null> {
        const context = req.gatewayContext!;
        
        try {
            // Extract prompt from request body
            const prompt = GatewayCacheService.extractPromptFromRequest(req.body);
            if (!prompt) {
                loggingService.info('No prompt found in request, skipping cache', {
                    requestId: req.headers['x-request-id'] as string
                });
                return null;
            }
            
            // Check Redis cache with semantic matching
            // Check for opt-out header
            const disableSemanticCache = req.headers['costkatana-disable-semantic-cache'] === 'true';
            
            const cacheResult = await redisService.checkCache(prompt, {
                userId: context.cacheUserScope ? context.userId : undefined,
                model: req.body?.model,
                provider: context.provider,
                enableSemantic: !disableSemanticCache && context.semanticCacheEnabled !== false,
                enableDeduplication: context.deduplicationEnabled !== false,
                similarityThreshold: context.similarityThreshold || 0.85
            });
            
            if (cacheResult.hit) {
                loggingService.info('Redis cache hit', { 
                    strategy: cacheResult.strategy,
                    similarity: cacheResult.similarity,
                    userId: context.userId,
                    requestId: req.headers['x-request-id'] as string
                });
                
                // Convert to CacheEntry format
                return {
                    response: cacheResult.data,
                    timestamp: Date.now(),
                    headers: {},
                    ttl: context.cacheTTL || DEFAULT_CACHE_TTL,
                    userScope: context.userId
                };
            }
        } catch (error: any) {
            loggingService.error('Redis cache check failed', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                requestId: req.headers['x-request-id'] as string
            });
        }
        
        return null;
    }

    /**
     * Cache the response with Redis and metadata
     */
    static async cacheResponse(req: Request, response: any): Promise<void> {
        const context = req.gatewayContext!;
        
        try {
            // Extract prompt for Redis caching
            const prompt = GatewayCacheService.extractPromptFromRequest(req.body);
            
            if (prompt) {
                // Calculate tokens and cost for cache metadata
                const inputTokens = req.gatewayContext?.inputTokens || 0;
                const outputTokens = req.gatewayContext?.outputTokens || 0;
                const cost = req.gatewayContext?.cost || 0;
                
                // Store in Redis with semantic embedding
                // Check for opt-out header
                const disableSemanticCache = req.headers['costkatana-disable-semantic-cache'] === 'true';
                
                await redisService.storeCache(prompt, response, {
                    userId: context.cacheUserScope ? context.userId : undefined,
                    model: req.body?.model,
                    provider: context.provider,
                    ttl: context.cacheTTL || DEFAULT_CACHE_TTL,
                    tokens: inputTokens + outputTokens,
                    cost,
                    enableSemantic: !disableSemanticCache && context.semanticCacheEnabled !== false,
                    enableDeduplication: context.deduplicationEnabled !== false
                });
                
                loggingService.info('Response cached in Redis', { 
                    userId: context.userId,
                    model: req.body?.model,
                    provider: context.provider,
                    ttl: context.cacheTTL || DEFAULT_CACHE_TTL,
                    requestId: req.headers['x-request-id'] as string
                });
            }
        } catch (error: any) {
            loggingService.error('Failed to cache in Redis', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                requestId: req.headers['x-request-id'] as string
            });
        }
    }

    /**
     * Extract prompt text from various request formats
     */
    private static extractPromptFromRequest(requestBody: any): string | null {
        if (!requestBody) return null;

        try {
            // OpenAI format
            if (requestBody.messages && Array.isArray(requestBody.messages)) {
                return requestBody.messages
                    .map((msg: any) => msg.content || '')
                    .filter((content: string) => content.trim().length > 0)
                    .join('\n');
            }

            // Anthropic format
            if (requestBody.prompt && typeof requestBody.prompt === 'string') {
                return requestBody.prompt;
            }

            // Google AI format
            if (requestBody.contents && Array.isArray(requestBody.contents)) {
                return requestBody.contents
                    .flatMap((content: any) => content.parts || [])
                    .map((part: any) => part.text || '')
                    .filter((text: string) => text.trim().length > 0)
                    .join('\n');
            }

            // Cohere format
            if (requestBody.message && typeof requestBody.message === 'string') {
                return requestBody.message;
            }

            // Generic text field
            if (requestBody.text && typeof requestBody.text === 'string') {
                return requestBody.text;
            }

            // Input field
            if (requestBody.input && typeof requestBody.input === 'string') {
                return requestBody.input;
            }

            return null;

        } catch (error: any) {
            loggingService.error('Error extracting prompt from request', {
                error: error.message || 'Unknown error',
                stack: error.stack
            });
            return null;
        }
    }

    /**
     * Generate cache key for a request (used for debugging/logging)
     */
    static generateCacheKey(req: Request): string {
        const context = req.gatewayContext!;
        const prompt = this.extractPromptFromRequest(req.body);
        
        const keyComponents = [
            context.cacheUserScope ? context.userId : 'global',
            req.body?.model || 'default',
            context.provider || 'default',
            prompt || 'empty'
        ];
        
        return keyComponents.join(':');
    }

    /**
     * Invalidate cache entries matching filters
     */
    static async invalidateCache(filters: {
        userId?: string;
        model?: string;
        provider?: string;
    }): Promise<number> {
        try {
            const clearedCount = await redisService.clearCache(filters);
            
            loggingService.info('Cache invalidated', {
                filters,
                clearedCount
            });
            
            return clearedCount;
        } catch (error: any) {
            loggingService.error('Failed to invalidate cache', {
                error: error.message || 'Unknown error',
                stack: error.stack,
                filters
            });
            return 0;
        }
    }
}
