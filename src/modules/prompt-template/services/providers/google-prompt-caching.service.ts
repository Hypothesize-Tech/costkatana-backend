/**
 * Google Gemini Prompt Caching Service
 *
 * Handles Google Gemini-specific prompt caching implementation.
 * Gemini supports explicit cached content blocks with TTL-based pricing.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import axios from 'axios';
import {
  GeminiCache,
  GeminiCacheDocument,
} from '../../../../schemas/prompt-template/gemini-cache.schema';

export interface GeminiCacheContent {
  role: 'user' | 'model';
  parts: Array<{
    text?: string;
    inline_data?: {
      mime_type: string;
      data: string;
    };
  }>;
}

export interface GeminiCachedContent {
  name: string;
  displayName?: string;
  model: string;
  createTime: string;
  updateTime: string;
  expireTime: string;
  content: GeminiCacheContent;
  usageMetadata?: {
    totalTokenCount: number;
  };
}

export interface GeminiCacheAnalysis {
  canCache: boolean;
  cacheableContent: GeminiCacheContent[];
  totalTokens: number;
  estimatedCost: number;
  ttlHours: number;
}

/** Shape of GeminiCache when read with .lean() (schema uses modelName) */
interface GeminiCacheLeanDoc {
  id: string;
  content: unknown;
  modelName: string;
  displayName?: string;
  createdAt: Date;
  expiresAt: Date;
  metadata?: { totalTokenCount: number };
}

@Injectable()
export class GooglePromptCachingService {
  private readonly logger = new Logger(GooglePromptCachingService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(GeminiCache.name)
    private readonly geminiCacheModel: Model<GeminiCacheDocument>,
  ) {}

  /**
   * Analyze conversation for Gemini caching opportunities
   */
  analyzeForCaching(messages: any[]): GeminiCacheAnalysis {
    const cacheableContent: GeminiCacheContent[] = [];
    let totalTokens = 0;

    // Gemini requires minimum 32K tokens for caching
    const MIN_TOKENS = 32768;

    for (const message of messages) {
      if (this.isCacheableMessage(message)) {
        const geminiMessage = this.convertToGeminiFormat(message);
        cacheableContent.push(geminiMessage);
        totalTokens += this.estimateMessageTokens(message);
      } else {
        // Stop at first non-cacheable message
        break;
      }
    }

    const canCache = totalTokens >= MIN_TOKENS && cacheableContent.length > 0;
    const estimatedCost = canCache
      ? this.calculateCacheCost(totalTokens, 1)
      : 0; // 1 hour default

    return {
      canCache,
      cacheableContent,
      totalTokens,
      estimatedCost,
      ttlHours: 1, // Default 1 hour
    };
  }

  /**
   * Check if a message can be cached
   */
  private isCacheableMessage(message: any): boolean {
    // Only user and model messages can be cached
    if (
      message.role !== 'user' &&
      message.role !== 'assistant' &&
      message.role !== 'model'
    ) {
      return false;
    }

    const content = this.extractMessageContent(message);
    if (!content) return false;

    // Check if content appears static/cacheable
    return this.isStaticContent(content);
  }

  /**
   * Convert message to Gemini cache format
   */
  private convertToGeminiFormat(message: any): GeminiCacheContent {
    const role = message.role === 'assistant' ? 'model' : message.role;
    const parts: GeminiCacheContent['parts'] = [];

    if (typeof message.content === 'string') {
      parts.push({ text: message.content });
    } else if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.type === 'text') {
          parts.push({ text: block.text });
        }
        // Note: Images and other media types could be supported here
      }
    }

    return {
      role: role as 'user' | 'model',
      parts,
    };
  }

  /**
   * Extract text content from message
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
   * Check if content appears to be static/cacheable
   */
  private isStaticContent(content: string): boolean {
    const lowerContent = content.toLowerCase();

    // Static content indicators
    const staticIndicators = [
      'system prompt',
      'instructions',
      'guidelines',
      'rules',
      'you are',
      'your role',
      'context:',
      'background:',
      'company policy',
      'documentation',
      'reference',
      'knowledge base',
      'manual',
      'guide',
    ];

    return staticIndicators.some((indicator) =>
      lowerContent.includes(indicator),
    );
  }

  /**
   * Estimate token count for a message
   */
  private estimateMessageTokens(message: any): number {
    const content = this.extractMessageContent(message);
    // Rough estimation: ~4 characters per token
    return Math.ceil(content.length / 4);
  }

  /**
   * Calculate cache storage cost
   */
  private calculateCacheCost(tokenCount: number, ttlHours: number): number {
    // Gemini pricing: $1.00 per 1M tokens per hour
    const costPerMillionTokensPerHour = 1.0;
    return (tokenCount * costPerMillionTokensPerHour * ttlHours) / 1_000_000;
  }

  /**
   * Calculate cache read cost
   */
  calculateReadCost(tokenCount: number): number {
    // Gemini pricing: $1.25 per 1M tokens for reads
    const costPerMillionTokens = 1.25;
    return (tokenCount * costPerMillionTokens) / 1_000_000;
  }

  /**
   * Create cached content via the real Gemini cachedContents API.
   * Calls POST https://generativelanguage.googleapis.com/v1beta/cachedContents
   */
  async createCachedContent(
    content: GeminiCacheContent[],
    model: string,
    ttlHours: number = 1,
  ): Promise<GeminiCachedContent> {
    const apiKey = this.configService.get<string>('GOOGLE_AI_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'GOOGLE_AI_API_KEY not configured - cannot create real Gemini cache',
      );
      return this.createCachedContentFallback(content, model, ttlHours);
    }

    const modelName = model.startsWith('models/') ? model : `models/${model}`;
    const ttlSeconds = Math.min(
      Math.max(ttlHours * 3600, 300),
      86400,
    ); // 5 min - 24h
    const displayName = `Cache-${Date.now()}`;

    const requestBody = {
      model: modelName,
      displayName,
      contents: content,
      ttl: `${ttlSeconds}s`,
    };

    try {
      const response = await axios.post<{
        name?: string;
        displayName?: string;
        model?: string;
        createTime?: string;
        updateTime?: string;
        expireTime?: string;
        usageMetadata?: { totalTokenCount?: number };
      }>(
        `https://generativelanguage.googleapis.com/v1beta/cachedContents`,
        requestBody,
        {
          params: { key: apiKey },
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,
        },
      );

      const data = response.data;
      const name = data.name || '';
      const cacheId = name.replace('cachedContents/', '');

      const cachedContent: GeminiCachedContent = {
        name,
        displayName: data.displayName || displayName,
        model: data.model || model,
        createTime: data.createTime || new Date().toISOString(),
        updateTime: data.updateTime || data.createTime || new Date().toISOString(),
        expireTime: data.expireTime || new Date(Date.now() + ttlHours * 3600 * 1000).toISOString(),
        content: content[0],
        usageMetadata: data.usageMetadata,
      };

      try {
        await this.geminiCacheModel.create({
          id: cacheId,
          content: Array.isArray(cachedContent.content)
            ? cachedContent.content
            : [cachedContent.content],
          modelName: cachedContent.model,
          displayName: cachedContent.displayName,
          createdAt: new Date(),
          expiresAt: new Date(cachedContent.expireTime),
          usageCount: 0,
          metadata: cachedContent.usageMetadata,
        });
      } catch (dbError) {
        this.logger.warn('Failed to persist cache metadata to DB', {
          cacheId,
          error: dbError instanceof Error ? dbError.message : String(dbError),
        });
      }

      this.logger.log(
        `Created Gemini cached content via API: ${name}, ${data.usageMetadata?.totalTokenCount ?? 0} tokens`,
      );

      return cachedContent;
    } catch (error: unknown) {
      this.logger.error('Gemini cachedContents API call failed', {
        model,
        error: error instanceof Error ? error.message : String(error),
        response: axios.isAxiosError(error) ? error.response?.data : undefined,
      });
      return this.createCachedContentFallback(content, model, ttlHours);
    }
  }

  /**
   * Fallback when API is unavailable - stores locally and returns shape compatible with generateContent.
   * Callers should handle that cached content may not be recognized by Gemini in this case.
   */
  private async createCachedContentFallback(
    content: GeminiCacheContent[],
    model: string,
    ttlHours: number,
  ): Promise<GeminiCachedContent> {
    const cacheId = this.generateCacheId();
    const now = new Date();
    const expireTime = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
    let totalTokens = 0;
    for (const msg of content) {
      for (const part of msg.parts) {
        if (part.text) totalTokens += Math.ceil(part.text.length / 4);
      }
    }

    const cachedContent: GeminiCachedContent = {
      name: `cachedContents/${cacheId}`,
      displayName: `Cache-${cacheId}`,
      model,
      createTime: now.toISOString(),
      updateTime: now.toISOString(),
      expireTime: expireTime.toISOString(),
      content: content[0],
      usageMetadata: { totalTokenCount: totalTokens },
    };

    await this.geminiCacheModel.create({
      id: cacheId,
      content: Array.isArray(cachedContent.content)
        ? cachedContent.content
        : [cachedContent.content],
      modelName: cachedContent.model,
      displayName: cachedContent.displayName,
      createdAt: now,
      expiresAt: expireTime,
      usageCount: 0,
      metadata: cachedContent.usageMetadata,
    });

    this.logger.warn(
      `Used fallback cache creation (not recognized by Gemini): ${cacheId}`,
    );
    return cachedContent;
  }

  /**
   * Get cached content by ID
   */
  async getCachedContent(cacheId: string): Promise<GeminiCachedContent | null> {
    try {
      const cacheDoc = await this.geminiCacheModel
        .findOne({
          id: cacheId,
          expiresAt: { $gt: new Date() }, // Only return non-expired caches
        })
        .lean();

      if (!cacheDoc) {
        return null;
      }

      // Update usage statistics
      await this.geminiCacheModel.updateOne(
        { id: cacheId },
        {
          $inc: { usageCount: 1 },
          $set: { lastUsed: new Date() },
        },
      );

      // Convert back to the expected format (schema uses modelName)
      const doc = cacheDoc as GeminiCacheLeanDoc;
      const contentItem = Array.isArray(doc.content)
        ? doc.content[0]
        : doc.content;
      return {
        name: `cachedContents/${doc.id}`,
        displayName: doc.displayName,
        model: doc.modelName,
        createTime: doc.createdAt.toISOString(),
        updateTime: doc.createdAt.toISOString(),
        expireTime: doc.expiresAt.toISOString(),
        content: contentItem as GeminiCacheContent,
        usageMetadata: doc.metadata,
      };
    } catch (error) {
      this.logger.error('Failed to get cached content from database', {
        cacheId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * List all cached content
   */
  async listCachedContent(): Promise<GeminiCachedContent[]> {
    try {
      const cacheDocs = await this.geminiCacheModel
        .find({
          expiresAt: { $gt: new Date() },
        })
        .lean();

      return cacheDocs.map((doc) => {
        const d = doc as GeminiCacheLeanDoc;
        const contentItem = Array.isArray(d.content) ? d.content[0] : d.content;
        return {
          name: `cachedContents/${d.id}`,
          displayName: d.displayName,
          model: d.modelName,
          createTime: d.createdAt.toISOString(),
          updateTime: d.createdAt.toISOString(),
          expireTime: d.expiresAt.toISOString(),
          content: contentItem as GeminiCacheContent,
          usageMetadata: d.metadata,
        };
      });
    } catch (error) {
      this.logger.error('Failed to list cached content from database', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Delete cached content
   */
  async deleteCachedContent(cacheId: string): Promise<boolean> {
    try {
      const result = await this.geminiCacheModel.deleteOne({ id: cacheId });
      const deleted = result.deletedCount > 0;

      if (deleted) {
        this.logger.log(`Deleted cached content: ${cacheId}`);
      }

      return deleted;
    } catch (error) {
      this.logger.error('Failed to delete cached content from database', {
        cacheId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Clean up expired cache entries
   * Note: MongoDB TTL indexes automatically remove expired documents,
   * so this method primarily exists for monitoring/logging purposes
   */
  async cleanupExpiredCache(): Promise<number> {
    try {
      // Count expired entries (TTL index handles actual deletion)
      const expiredCount = await this.geminiCacheModel.countDocuments({
        expiresAt: { $lt: new Date() },
      });

      if (expiredCount > 0) {
        this.logger.log(
          `Found ${expiredCount} expired cache entries (TTL index will remove them automatically)`,
        );
      }

      return expiredCount;
    } catch (error) {
      this.logger.error('Failed to check expired cache entries', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Generate unique cache ID
   */
  private generateCacheId(): string {
    const crypto = require('crypto');
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Get caching configuration for Google Gemini
   */
  getCachingConfig(): {
    supported: boolean;
    explicit: boolean;
    minTokens: number;
    maxContentBlocks: number;
    defaultTTL: number;
    pricing: {
      storagePrice: number; // per 1M tokens per hour
      readPrice: number; // per 1M tokens
    };
  } {
    return {
      supported: true,
      explicit: true, // Gemini requires explicit cache creation
      minTokens: 32768, // 32K minimum
      maxContentBlocks: 1, // One cached content block
      defaultTTL: 3600, // 1 hour default
      pricing: {
        storagePrice: 1.0, // $1.00 per 1M tokens per hour
        readPrice: 1.25, // $1.25 per 1M tokens
      },
    };
  }

  /**
   * Validate Gemini caching configuration
   */
  validateCachingConfig(config: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (config.minTokens && config.minTokens < 32768) {
      errors.push('Gemini requires minimum 32,768 tokens for caching');
    }

    if (config.maxBreakpoints && config.maxBreakpoints > 1) {
      errors.push('Gemini supports maximum 1 cached content block');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalEntries: number;
    totalTokens: number;
    expiredEntries: number;
    storageCost: number;
  }> {
    try {
      const now = new Date();

      // Get all entries (including expired for stats)
      const allEntries = await this.geminiCacheModel.find({}).lean();
      const activeEntries = allEntries.filter((entry) => entry.expiresAt > now);

      const totalEntries = activeEntries.length;
      const totalTokens = activeEntries.reduce(
        (sum, entry) => sum + (Number(entry.metadata?.totalTokenCount) || 0),
        0,
      );

      const expiredEntries = allEntries.filter(
        (entry) => entry.expiresAt <= now,
      ).length;

      // Calculate storage cost (simplified - assumes 1 hour TTL)
      const storageCost = activeEntries.reduce((sum, entry) => {
        const tokens = Number(entry.metadata?.totalTokenCount) || 0;
        return sum + (tokens * 1.0 * 1) / 1_000_000; // $1 per 1M tokens per hour
      }, 0);

      return {
        totalEntries,
        totalTokens,
        expiredEntries,
        storageCost,
      };
    } catch (error) {
      this.logger.error('Failed to get cache stats from database', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        totalEntries: 0,
        totalTokens: 0,
        expiredEntries: 0,
        storageCost: 0,
      };
    }
  }
}
