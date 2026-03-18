/**
 * OpenAI Prompt Caching Service
 *
 * Handles OpenAI-specific prompt caching implementation using automatic caching.
 * OpenAI uses automatic caching for the initial portion of prompts that remain static.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface OpenAICacheAnalysis {
  cacheablePrefix: string;
  cacheableTokens: number;
  cacheHit: boolean;
  cacheKey?: string;
}

@Injectable()
export class OpenAIPromptCachingService {
  private readonly logger = new Logger(OpenAIPromptCachingService.name);

  // Cache for tracking cache keys and hit rates
  private readonly cacheKeys = new Map<
    string,
    {
      content: string;
      tokens: number;
      createdAt: Date;
      lastUsed: Date;
      usageCount: number;
    }
  >();

  // Hit rate tracking
  private totalRequests = 0;
  private cacheHits = 0;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Analyze prompt for OpenAI automatic caching
   * OpenAI automatically caches the initial static portion of prompts.
   * Cache hit status is unknown at analysis time - use recordResponseUsage()
   * when the actual OpenAI API response is received to track real cache hits.
   */
  analyzeCaching(messages: any[]): OpenAICacheAnalysis {
    const cacheableContent = this.extractCacheablePrefix(messages);
    const cacheableTokens = this.estimateTokens(cacheableContent);
    const cacheKey = this.generateCacheKey(cacheableContent);

    // Cache hit is determined from actual API response usage.prompt_tokens_details.cached_tokens
    return {
      cacheablePrefix: cacheableContent,
      cacheableTokens,
      cacheHit: false, // Unknown until response received - call recordResponseUsage() with actual usage
      cacheKey,
    };
  }

  /**
   * Record actual cache usage from an OpenAI API response.
   * Call this when the response is received to track real cache hit rates.
   */
  recordResponseUsage(usage: {
    prompt_tokens_details?: { cached_tokens?: number };
  }): void {
    this.totalRequests++;
    const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
    if (cachedTokens > 0) {
      this.cacheHits++;
    }
  }

  /**
   * Extract the cacheable prefix from messages
   * OpenAI caches from the beginning until dynamic content appears
   */
  private extractCacheablePrefix(messages: any[]): string {
    let cacheableContent = '';
    let foundDynamic = false;

    for (const message of messages) {
      if (foundDynamic) break;

      const content = this.extractMessageContent(message);
      if (!content) continue;

      // Check if this message contains dynamic content
      if (this.isDynamicContent(message, content)) {
        foundDynamic = true;
        // Include a portion of dynamic content if it's minimal
        if (this.isMinimalDynamicContent(content)) {
          cacheableContent += content + '\n';
        }
        break;
      }

      cacheableContent += content + '\n';
    }

    return cacheableContent.trim();
  }

  /**
   * Extract text content from a message
   */
  private extractMessageContent(message: any): string {
    if (typeof message.content === 'string') {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      return message.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text || '')
        .join(' ');
    }

    return '';
  }

  /**
   * Check if message content is dynamic (not cacheable)
   */
  private isDynamicContent(message: any, content: string): boolean {
    // System messages are typically static
    if (message.role === 'system') {
      return false;
    }

    // Check for dynamic indicators
    const dynamicIndicators = [
      'user input',
      'query:',
      'question:',
      'input:',
      'request:',
      'current time',
      'today',
      'now',
      'date:',
      'timestamp',
      'random',
      'generate',
      'create',
      'new',
      'unique',
    ];

    const lowerContent = content.toLowerCase();
    return dynamicIndicators.some((indicator) =>
      lowerContent.includes(indicator),
    );
  }

  /**
   * Check if dynamic content is minimal enough to include in cache
   */
  private isMinimalDynamicContent(content: string): boolean {
    // Include short dynamic content (less than 100 characters)
    return content.length < 100;
  }

  /**
   * Generate a deterministic cache key for content
   */
  private generateCacheKey(content: string): string {
    const crypto = require('crypto');
    return crypto
      .createHash('sha256')
      .update(content)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Estimate token count for content
   */
  private estimateTokens(content: string): number {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(content.length / 4);
  }

  /**
   * Store cache entry for tracking
   */
  storeCacheEntry(cacheKey: string, content: string, tokens: number): void {
    this.cacheKeys.set(cacheKey, {
      content,
      tokens,
      createdAt: new Date(),
      lastUsed: new Date(),
      usageCount: 1,
    });

    // Limit cache size to prevent memory issues
    if (this.cacheKeys.size > 1000) {
      // Remove oldest entries (simple LRU approximation)
      const entries = Array.from(this.cacheKeys.entries());
      entries.sort((a, b) => a[1].lastUsed.getTime() - b[1].lastUsed.getTime());
      const toRemove = entries.slice(0, 100); // Remove 10% oldest
      toRemove.forEach(([key]) => this.cacheKeys.delete(key));
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalEntries: number;
    totalTokens: number;
    hitRate: number;
    averageUsage: number;
  } {
    const entries = Array.from(this.cacheKeys.values());
    const totalEntries = entries.length;
    const totalTokens = entries.reduce((sum, entry) => sum + entry.tokens, 0);
    const totalUsage = entries.reduce(
      (sum, entry) => sum + entry.usageCount,
      0,
    );
    const averageUsage = totalEntries > 0 ? totalUsage / totalEntries : 0;

    // Calculate hit rate from actual usage data
    const hitRate =
      this.totalRequests > 0 ? this.cacheHits / this.totalRequests : 0;

    return {
      totalEntries,
      totalTokens,
      hitRate,
      averageUsage,
    };
  }

  /**
   * Clear old cache entries
   */
  clearOldEntries(maxAgeHours: number = 24): number {
    const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000);
    let removed = 0;

    for (const [key, entry] of this.cacheKeys.entries()) {
      if (entry.lastUsed < cutoff) {
        this.cacheKeys.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.log(`Cleared ${removed} old cache entries`);
    }

    return removed;
  }

  /**
   * Get caching configuration for OpenAI
   */
  getCachingConfig(): {
    supported: boolean;
    automatic: boolean;
    minTokens: number;
    ttl: number;
    pricing: {
      writePrice: number;
      readPrice: number;
    };
  } {
    return {
      supported: true,
      automatic: true, // OpenAI uses automatic caching
      minTokens: 1024,
      ttl: 600, // 10 minutes
      pricing: {
        writePrice: 1.5, // $1.50 per 1M tokens
        readPrice: 1.5, // $1.50 per 1M tokens (50% discount)
      },
    };
  }

  /**
   * Validate OpenAI caching configuration
   */
  validateCachingConfig(config: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (config.minTokens && config.minTokens < 1024) {
      errors.push('OpenAI requires minimum 1024 tokens for caching');
    }

    // OpenAI doesn't support explicit breakpoints - only automatic
    if (config.breakpointsEnabled) {
      errors.push(
        'OpenAI uses automatic caching, explicit breakpoints not supported',
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
