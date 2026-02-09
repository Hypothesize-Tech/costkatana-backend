/**
 * Google Gemini Context Caching Implementation
 *
 * Handles explicit context caching using Gemini's CachedContent API
 * for models like Gemini 2.5 Pro and Gemini 2.5 Flash
 */

import axios from 'axios';
import { loggingService } from '../../logging.service';
import { estimateTokens } from '../../../utils/tokenCounter';
import { AIProvider } from '../../../types/aiCostTracker.types';
import {
  PromptCachingConfig,
  CacheBreakpoint,
  PromptCacheMetrics
} from '../../../types/promptCaching.types';

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiPart {
  text?: string;
  inline_data?: {
    mime_type: string;
    data: string; // base64 encoded
  };
  function_call?: any;
  function_response?: any;
}

export interface GeminiCachedContent {
  name: string; // "cachedContents/abc123"
  displayName?: string;
  model: string;
  createTime: string;
  updateTime: string;
  expireTime: string;
  ttl: string; // Duration like "300s"
  contents: GeminiMessage[];
  usageMetadata?: {
    totalTokenCount: number;
  };
}

export interface GeminiCacheAnalysis {
  isCacheable: boolean;
  cacheableContent: GeminiMessage[];
  cacheableTokens: number;
  dynamicContent: GeminiMessage[];
  dynamicTokens: number;
  totalTokens: number;
  estimatedSavings: number;
  cacheTTL: string;
}

export class GoogleGeminiPromptCaching {
  private static readonly MIN_CACHE_TOKENS = 32768; // 32K minimum
  private static readonly DEFAULT_CACHE_TTL = '3600s'; // 1 hour
  private static readonly MAX_CACHE_TTL = '86400s'; // 24 hours

  // Models that support context caching
  private static readonly SUPPORTED_MODELS = [
    'gemini-2.5-pro', 'gemini-2.5-flash',
    'models/gemini-2.5-pro', 'models/gemini-2.5-flash'
  ];

  /**
   * Check if model supports context caching
   */
  public static isModelSupported(model: string): boolean {
    const normalizedModel = model.toLowerCase().replace(/[-_]/g, '');
    return this.SUPPORTED_MODELS.some(supported =>
      normalizedModel.includes(supported.toLowerCase().replace(/[-_]/g, ''))
    );
  }

  /**
   * Convert messages to Gemini format for caching
   */
  public static convertToGeminiFormat(messages: any[]): GeminiMessage[] {
    const geminiMessages: GeminiMessage[] = [];

    for (const message of messages) {
      if (this.isGeminiMessage(message)) {
        geminiMessages.push(message);
        continue;
      }

      // Convert from OpenAI format
      if (message.role && message.content) {
        const geminiMessage: GeminiMessage = {
          role: message.role === 'assistant' ? 'model' :
                message.role === 'system' ? 'user' : 'user',
          parts: []
        };

        // Handle content conversion
        if (typeof message.content === 'string') {
          geminiMessage.parts.push({
            text: message.content
          });
        } else if (Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part.type === 'text') {
              geminiMessage.parts.push({
                text: part.text
              });
            }
            // Handle other content types as needed
          }
        }

        geminiMessages.push(geminiMessage);
      }
    }

    return geminiMessages;
  }

  /**
   * Check if message is already in Gemini format
   */
  private static isGeminiMessage(message: any): message is GeminiMessage {
    return message &&
           typeof message === 'object' &&
           (message.role === 'user' || message.role === 'model') &&
           Array.isArray(message.parts);
  }

  /**
   * Analyze Gemini messages for caching potential
   */
  public static analyzeMessages(
    messages: GeminiMessage[],
    config: PromptCachingConfig
  ): GeminiCacheAnalysis {
    try {
      if (!config.enabled) {
        const totalTokens = this.estimateTotalTokens(messages);
        return {
          isCacheable: false,
          cacheableContent: [],
          cacheableTokens: 0,
          dynamicContent: messages,
          dynamicTokens: totalTokens,
          totalTokens,
          estimatedSavings: 0,
          cacheTTL: this.DEFAULT_CACHE_TTL
        };
      }

      // Separate cacheable and dynamic content
      const { cacheableContent, dynamicContent } = this.separateContent(messages);

      const cacheableTokens = this.estimateTotalTokens(cacheableContent);
      const dynamicTokens = this.estimateTotalTokens(dynamicContent);
      const totalTokens = cacheableTokens + dynamicTokens;

      // Check if meets minimum requirements
      const isCacheable = cacheableTokens >= this.MIN_CACHE_TOKENS &&
                         cacheableContent.length > 0;

      const estimatedSavings = this.calculateEstimatedSavings(cacheableTokens);

      loggingService.debug('Gemini cache analysis completed', {
        totalMessages: messages.length,
        cacheableMessages: cacheableContent.length,
        dynamicMessages: dynamicContent.length,
        cacheableTokens,
        dynamicTokens,
        totalTokens,
        isCacheable,
        estimatedSavings: estimatedSavings.toFixed(6)
      });

      return {
        isCacheable,
        cacheableContent,
        cacheableTokens,
        dynamicContent,
        dynamicTokens,
        totalTokens,
        estimatedSavings,
        cacheTTL: config.ttl ? `${config.ttl}s` : this.DEFAULT_CACHE_TTL
      };

    } catch (error) {
      loggingService.error('Error analyzing Gemini messages for caching', {
        error: error instanceof Error ? error.message : String(error),
        messageCount: messages.length
      });

      const totalTokens = this.estimateTotalTokens(messages);
      return {
        isCacheable: false,
        cacheableContent: [],
        cacheableTokens: 0,
        dynamicContent: messages,
        dynamicTokens: totalTokens,
        totalTokens,
        estimatedSavings: 0,
        cacheTTL: this.DEFAULT_CACHE_TTL
      };
    }
  }

  /**
   * Separate cacheable content from dynamic content
   */
  private static separateContent(messages: GeminiMessage[]): {
    cacheableContent: GeminiMessage[];
    dynamicContent: GeminiMessage[];
  } {
    const cacheableContent: GeminiMessage[] = [];
    const dynamicContent: GeminiMessage[] = [];

    for (const message of messages) {
      if (this.isContentCacheable(message)) {
        cacheableContent.push(message);
      } else {
        dynamicContent.push(message);
        // Once we hit dynamic content, everything after should be dynamic
        // (to maintain conversation flow)
        break;
      }
    }

    // Add remaining messages to dynamic content
    for (let i = cacheableContent.length; i < messages.length; i++) {
      dynamicContent.push(messages[i]);
    }

    return { cacheableContent, dynamicContent };
  }

  /**
   * Check if message content is suitable for caching
   */
  private static isContentCacheable(message: GeminiMessage): boolean {
    // Only user messages can be cached (system instructions, documents, etc.)
    if (message.role !== 'user') {
      return false;
    }

    // Check if content has static characteristics
    const textContent = this.extractTextContent(message);
    if (!textContent) return false;

    const lowerContent = textContent.toLowerCase();

    // Static content indicators
    const staticIndicators = [
      'you are', 'your role is', 'instructions:', 'system prompt',
      'guidelines:', 'rules:', 'context:', 'background:',
      'reference:', 'documentation:', 'manual:', 'policy:',
      'procedure:', 'company information', 'product details',
      'api documentation', 'function definitions', 'tool descriptions',
      'schema:', 'available tools', 'function calling',
      'knowledge base', 'reference material', 'training data'
    ];

    const hasStaticIndicators = staticIndicators.some(indicator =>
      lowerContent.includes(indicator)
    );

    // Check content length (must be substantial for caching)
    const isLongEnough = textContent.length > 1000;

    // Check for structured content
    const isStructured = lowerContent.includes('json') ||
                        lowerContent.includes('xml') ||
                        lowerContent.includes('schema') ||
                        lowerContent.includes('format:') ||
                        lowerContent.includes('structure:');

    return hasStaticIndicators || isLongEnough || isStructured;
  }

  /**
   * Extract text content from Gemini message
   */
  private static extractTextContent(message: GeminiMessage): string {
    return message.parts
      .filter(part => part.text)
      .map(part => part.text!)
      .join('\n');
  }

  /**
   * Estimate tokens in Gemini message
   */
  private static estimateMessageTokens(message: GeminiMessage): number {
    try {
      const textContent = this.extractTextContent(message);

      // Add tokens for message structure
      let tokens = 2; // Base tokens per message

      // Add tokens for content
      if (textContent) {
        tokens += estimateTokens(textContent, AIProvider.Google);
      }

      // Add tokens for other parts (images, function calls, etc.)
      for (const part of message.parts) {
        if (part.inline_data) {
          // Estimate tokens for images (rough approximation)
          tokens += 85; // ~85 tokens per image (varies by size/detail)
        } else if (part.function_call) {
          tokens += 10; // Function call overhead
        } else if (part.function_response) {
          tokens += 5; // Function response overhead
        }
      }

      return tokens;
    } catch (error) {
      loggingService.warn('Error estimating Gemini message tokens', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Estimate total tokens in messages array
   */
  private static estimateTotalTokens(messages: GeminiMessage[]): number {
    return messages.reduce((total, message) => total + this.estimateMessageTokens(message), 0);
  }

  /**
   * Calculate estimated savings from Gemini caching
   */
  private static calculateEstimatedSavings(cacheableTokens: number): number {
    // Gemini pricing: ~$1.25 per 1M tokens for input (cached content)
    // Storage cost: ~$1.00 per 1M tokens per hour
    // For simplicity, we'll focus on the input cost savings

    const regularCostPerToken = 1.25 / 1_000_000; // $1.25 per 1M input tokens
    const cachedCostPerToken = 0.10 / 1_000_000; // Estimated 90%+ discount for cached content

    const regularCost = cacheableTokens * regularCostPerToken;
    const cachedCost = cacheableTokens * cachedCostPerToken;

    return Math.max(0, regularCost - cachedCost);
  }

  /**
   * Create cached content via Gemini API
   */
  public static async createCachedContent(
    contents: GeminiMessage[],
    model: string,
    ttl: string = this.DEFAULT_CACHE_TTL,
    apiKey?: string
  ): Promise<GeminiCachedContent | null> {
    if (!apiKey) {
      loggingService.warn('No API key provided for Gemini caching');
      return null;
    }

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${apiKey}`,
        {
          model: model.startsWith('models/') ? model : `models/${model}`,
          contents,
          ttl
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      loggingService.info('Gemini cached content created', {
        cacheName: response.data.name,
        model,
        ttl,
        tokenCount: response.data.usageMetadata?.totalTokenCount
      });

      return response.data as GeminiCachedContent;

    } catch (error: any) {
      loggingService.error('Failed to create Gemini cached content', {
        error: error.response?.data || error.message,
        model,
        ttl,
        contentCount: contents.length
      });
      return null;
    }
  }

  /**
   * Get cached content information
   */
  public static async getCachedContent(
    cacheName: string,
    apiKey?: string
  ): Promise<GeminiCachedContent | null> {
    if (!apiKey) {
      loggingService.warn('No API key provided for Gemini caching');
      return null;
    }

    try {
      const response = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/${cacheName}?key=${apiKey}`
      );

      return response.data as GeminiCachedContent;

    } catch (error: any) {
      loggingService.error('Failed to get Gemini cached content', {
        error: error.response?.data || error.message,
        cacheName
      });
      return null;
    }
  }

  /**
   * Delete cached content
   */
  public static async deleteCachedContent(
    cacheName: string,
    apiKey?: string
  ): Promise<boolean> {
    if (!apiKey) {
      loggingService.warn('No API key provided for Gemini caching');
      return false;
    }

    try {
      await axios.delete(
        `https://generativelanguage.googleapis.com/v1beta/${cacheName}?key=${apiKey}`
      );

      loggingService.info('Gemini cached content deleted', { cacheName });
      return true;

    } catch (error: any) {
      loggingService.error('Failed to delete Gemini cached content', {
        error: error.response?.data || error.message,
        cacheName
      });
      return false;
    }
  }

  /**
   * Generate cache-related headers for Gemini responses
   */
  public static generateCacheHeaders(
    analysis: GeminiCacheAnalysis,
    cacheName?: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'x-gemini-cache-enabled': 'true',
      'x-gemini-cache-type': 'explicit',
      'x-gemini-cache-cacheable-tokens': analysis.cacheableTokens.toString(),
      'x-gemini-cache-dynamic-tokens': analysis.dynamicTokens.toString(),
      'x-gemini-cache-total-tokens': analysis.totalTokens.toString(),
      'x-gemini-cache-ttl': analysis.cacheTTL,
      'x-gemini-cache-estimated-savings': analysis.estimatedSavings.toFixed(6),
      'x-gemini-cache-hit-rate': '0.00' // Will be updated with actual usage
    };

    if (cacheName) {
      headers['x-gemini-cache-name'] = cacheName;
    }

    return headers;
  }

  /**
   * Validate Gemini cache configuration
   */
  public static validateConfig(config: PromptCachingConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.enabled) {
      return { valid: true, errors: [] }; // Disabled is valid
    }

    if (config.provider !== 'google') {
      errors.push('Provider must be google for Gemini caching');
    }

    if (config.minTokens < this.MIN_CACHE_TOKENS) {
      errors.push(`Minimum tokens must be at least ${this.MIN_CACHE_TOKENS}`);
    }

    if (config.mode !== 'explicit') {
      errors.push('Gemini requires explicit caching mode');
    }

    if (config.ttl && config.ttl > parseInt(this.MAX_CACHE_TTL)) {
      errors.push(`TTL cannot exceed ${this.MAX_CACHE_TTL} seconds`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get cache statistics for monitoring
   */
  public static getCacheStats(): {
    supportedModels: string[];
    minTokens: number;
    defaultTTL: string;
    maxTTL: string;
    cacheType: string;
  } {
    return {
      supportedModels: [...this.SUPPORTED_MODELS],
      minTokens: this.MIN_CACHE_TOKENS,
      defaultTTL: this.DEFAULT_CACHE_TTL,
      maxTTL: this.MAX_CACHE_TTL,
      cacheType: 'explicit'
    };
  }
}