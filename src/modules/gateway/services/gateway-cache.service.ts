import { Injectable, Logger } from '@nestjs/common';
import { CacheService } from '../../../common/cache/cache.service';
import { CacheEntry } from '../interfaces/gateway.interfaces';

const DEFAULT_CACHE_TTL = 604800; // 7 days in seconds for Redis

/**
 * Gateway Cache Service - Handles all caching operations for the gateway
 * Provides Redis-based caching with semantic matching and deduplication
 */
@Injectable()
export class GatewayCacheService {
  private readonly logger = new Logger(GatewayCacheService.name);

  constructor(private cacheService: CacheService) {}

  /**
   * Check if response exists in cache using Redis with semantic matching
   */
  async checkCache(request: any): Promise<CacheEntry | null> {
    const context = request.gatewayContext;

    try {
      // Extract prompt from request body
      const prompt = this.extractPromptFromRequest(request.body);
      if (!prompt) {
        this.logger.log('No prompt found in request, skipping cache', {
          component: 'GatewayCacheService',
          operation: 'checkCache',
          type: 'cache_check_no_prompt',
          requestId: request.headers['x-request-id'] as string,
        });
        return null;
      }

      // Check Redis cache with semantic matching
      // Check for opt-out header
      const disableSemanticCache =
        request.headers['costkatana-disable-semantic-cache'] === 'true';

      const keyMaterial = this.extractCacheKeyMaterial(request.body);

      const cacheResult = await this.cacheService.checkCache(prompt, {
        userId: context.cacheUserScope ? context.userId : undefined,
        model: request.body?.model,
        provider: context.provider,
        keyMaterial,
        enableSemantic:
          !disableSemanticCache && context.semanticCacheEnabled !== false,
        enableDeduplication: context.deduplicationEnabled !== false,
        similarityThreshold: context.similarityThreshold || 0.85,
      });

      if (cacheResult.hit) {
        this.logger.log('Redis cache hit', {
          component: 'GatewayCacheService',
          operation: 'checkCache',
          type: 'cache_hit',
          strategy: cacheResult.strategy,
          similarity: cacheResult.similarity,
          userId: context.userId,
          requestId: request.headers['x-request-id'] as string,
        });

        // Convert to CacheEntry format
        return {
          response: cacheResult.data,
          timestamp: Date.now(),
          headers: {},
          ttl: context.cacheTTL || DEFAULT_CACHE_TTL,
          userScope: context.userId,
        };
      }
    } catch (error: any) {
      this.logger.error('Redis cache check failed', {
        component: 'GatewayCacheService',
        operation: 'checkCache',
        type: 'cache_check_error',
        error: error.message || 'Unknown error',
        stack: error.stack,
        requestId: request.headers['x-request-id'] as string,
      });
    }

    return null;
  }

  /**
   * Cache the response with Redis and metadata
   */
  async cacheResponse(request: any, response: any): Promise<void> {
    const context = request.gatewayContext;

    try {
      // Extract prompt for Redis caching
      const prompt = this.extractPromptFromRequest(request.body);

      if (prompt) {
        // Calculate tokens and cost for cache metadata
        const inputTokens = request.gatewayContext?.inputTokens || 0;
        const outputTokens = request.gatewayContext?.outputTokens || 0;
        const cost = request.gatewayContext?.cost || 0;

        // Store in Redis with semantic embedding
        // Check for opt-out header
        const disableSemanticCache =
          request.headers['costkatana-disable-semantic-cache'] === 'true';

        const keyMaterial = this.extractCacheKeyMaterial(request.body);

        await this.cacheService.storeCache(prompt, response, {
          userId: context.cacheUserScope ? context.userId : undefined,
          model: request.body?.model,
          provider: context.provider,
          ttl: context.cacheTTL || DEFAULT_CACHE_TTL,
          tokens: inputTokens + outputTokens,
          cost,
          keyMaterial,
          enableSemantic:
            !disableSemanticCache && context.semanticCacheEnabled !== false,
          enableDeduplication: context.deduplicationEnabled !== false,
        });

        this.logger.log('Response cached in Redis', {
          component: 'GatewayCacheService',
          operation: 'cacheResponse',
          type: 'cache_store',
          userId: context.userId,
          model: request.body?.model,
          provider: context.provider,
          ttl: context.cacheTTL || DEFAULT_CACHE_TTL,
          requestId: request.headers['x-request-id'] as string,
        });
      }
    } catch (error: any) {
      this.logger.error('Failed to cache in Redis', {
        component: 'GatewayCacheService',
        operation: 'cacheResponse',
        type: 'cache_store_error',
        error: error.message || 'Unknown error',
        stack: error.stack,
        requestId: request.headers['x-request-id'] as string,
      });
    }
  }

  /**
   * Fields that affect model output and must participate in the cache key
   * (deterministic JSON via CacheService.sortObjectKeysDeep).
   */
  private extractCacheKeyMaterial(
    requestBody: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> {
    if (!requestBody || typeof requestBody !== 'object') {
      return {};
    }
    const b = requestBody;
    const material: Record<string, unknown> = {};
    const copyIfDefined = (key: string) => {
      if (b[key] !== undefined) {
        material[key] = b[key];
      }
    };
    copyIfDefined('messages');
    copyIfDefined('system');
    copyIfDefined('prompt');
    copyIfDefined('contents');
    copyIfDefined('temperature');
    copyIfDefined('top_p');
    copyIfDefined('top_k');
    copyIfDefined('max_tokens');
    copyIfDefined('max_completion_tokens');
    copyIfDefined('tools');
    copyIfDefined('tool_choice');
    copyIfDefined('response_format');
    copyIfDefined('prompt_cache_key');
    copyIfDefined('frequency_penalty');
    copyIfDefined('presence_penalty');
    copyIfDefined('seed');
    copyIfDefined('stop');
    copyIfDefined('n');
    return material;
  }

  /**
   * Extract prompt text from various request formats
   */
  private extractPromptFromRequest(requestBody: any): string | null {
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
      this.logger.error('Error extracting prompt from request', {
        component: 'GatewayCacheService',
        operation: 'extractPromptFromRequest',
        type: 'prompt_extraction_error',
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      return null;
    }
  }

  /**
   * Generate cache key for a request (used for debugging/logging)
   */
  generateCacheKey(request: any): string {
    const context = request.gatewayContext;
    const prompt = this.extractPromptFromRequest(request.body);

    const keyComponents = [
      context.cacheUserScope ? context.userId : 'global',
      request.body?.model || 'default',
      context.provider || 'default',
      prompt || 'empty',
    ];

    return keyComponents.join(':');
  }

  /**
   * Invalidate cache entries matching filters
   */
  async invalidateCache(filters: {
    userId?: string;
    model?: string;
    provider?: string;
  }): Promise<number> {
    try {
      const clearedCount = await this.cacheService.clearCache(filters);

      this.logger.log('Cache invalidated', {
        component: 'GatewayCacheService',
        operation: 'invalidateCache',
        type: 'cache_invalidation',
        filters,
        clearedCount,
      });

      return clearedCount;
    } catch (error: any) {
      this.logger.error('Failed to invalidate cache', {
        component: 'GatewayCacheService',
        operation: 'invalidateCache',
        type: 'cache_invalidation_error',
        error: error.message || 'Unknown error',
        stack: error.stack,
        filters,
      });
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<any> {
    try {
      return await this.cacheService.getCacheStats();
    } catch (error: any) {
      this.logger.error('Failed to get cache stats', {
        component: 'GatewayCacheService',
        operation: 'getCacheStats',
        type: 'cache_stats_error',
        error: error.message || 'Unknown error',
        stack: error.stack,
      });
      return {};
    }
  }
}
