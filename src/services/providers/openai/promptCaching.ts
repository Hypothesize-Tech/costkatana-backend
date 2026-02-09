/**
 * OpenAI Prompt Caching Implementation
 *
 * Handles automatic prefix matching for OpenAI models
 * (GPT-4o, GPT-4o-mini, o1, o1-mini, etc.)
 */

import { loggingService } from '../../logging.service';
import { estimateTokens } from '../../../utils/tokenCounter';
import { AIProvider } from '../../../types/aiCostTracker.types';
import {
  PromptCachingConfig,
  PromptCacheMetrics
} from '../../../types/promptCaching.types';

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | OpenAIMessageContent[];
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

export interface OpenAIMessageContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

export interface OpenAICacheAnalysis {
  isCacheable: boolean;
  cacheablePrefix: OpenAIMessage[];
  cacheableTokens: number;
  dynamicTokens: number;
  totalTokens: number;
  prefixRatio: number; // Percentage of prompt that is cacheable
  estimatedSavings: number;
}

export class OpenAIPromptCaching {
  private static readonly MIN_CACHEABLE_TOKENS = 1024;
  private static readonly CACHE_TTL_SECONDS = 600; // 10 minutes

  // Models that support prompt caching
  private static readonly SUPPORTED_MODELS = [
    'gpt-4o', 'gpt-4o-mini', 'gpt-4o-2024-08-06', 'gpt-4o-2024-05-13',
    'gpt-4o-mini-2024-07-18', 'o1', 'o1-mini', 'o1-preview',
    'gpt-4-turbo', 'gpt-4-turbo-2024-04-09', 'gpt-4-0125-preview',
    'gpt-4-1106-preview', 'gpt-3.5-turbo', 'gpt-3.5-turbo-0125'
  ];

  /**
   * Check if model supports prompt caching
   */
  public static isModelSupported(model: string): boolean {
    const normalizedModel = model.toLowerCase().replace(/[-_]/g, '');
    return this.SUPPORTED_MODELS.some(supported =>
      normalizedModel.includes(supported.toLowerCase().replace(/[-_]/g, ''))
    );
  }

  /**
   * Analyze OpenAI messages for caching potential
   */
  public static analyzeMessages(
    messages: OpenAIMessage[],
    config: PromptCachingConfig
  ): OpenAICacheAnalysis {
    try {
      if (!config.enabled) {
        return {
          isCacheable: false,
          cacheablePrefix: [],
          cacheableTokens: 0,
          dynamicTokens: 0,
          totalTokens: this.estimateTotalTokens(messages),
          prefixRatio: 0,
          estimatedSavings: 0
        };
      }

      // Calculate total tokens
      const totalTokens = this.estimateTotalTokens(messages);

      if (totalTokens < this.MIN_CACHEABLE_TOKENS) {
        return {
          isCacheable: false,
          cacheablePrefix: [],
          cacheableTokens: 0,
          dynamicTokens: totalTokens,
          totalTokens,
          prefixRatio: 0,
          estimatedSavings: 0
        };
      }

      // Find cacheable prefix
      const { cacheablePrefix, cacheableTokens, dynamicTokens } =
        this.findCacheablePrefix(messages);

      const prefixRatio = totalTokens > 0 ? (cacheableTokens / totalTokens) : 0;
      const isCacheable = cacheableTokens >= this.MIN_CACHEABLE_TOKENS;
      const estimatedSavings = this.calculateEstimatedSavings(cacheableTokens, dynamicTokens);

      loggingService.debug('OpenAI cache analysis completed', {
        totalMessages: messages.length,
        cacheableMessages: cacheablePrefix.length,
        cacheableTokens,
        dynamicTokens,
        totalTokens,
        prefixRatio: `${(prefixRatio * 100).toFixed(1)}%`,
        isCacheable,
        estimatedSavings: estimatedSavings.toFixed(6)
      });

      return {
        isCacheable,
        cacheablePrefix,
        cacheableTokens,
        dynamicTokens,
        totalTokens,
        prefixRatio,
        estimatedSavings
      };

    } catch (error) {
      loggingService.error('Error analyzing OpenAI messages for caching', {
        error: error instanceof Error ? error.message : String(error),
        messageCount: messages.length
      });

      return {
        isCacheable: false,
        cacheablePrefix: [],
        cacheableTokens: 0,
        dynamicTokens: this.estimateTotalTokens(messages),
        totalTokens: this.estimateTotalTokens(messages),
        prefixRatio: 0,
        estimatedSavings: 0
      };
    }
  }

  /**
   * Find the longest cacheable prefix in messages
   */
  private static findCacheablePrefix(messages: OpenAIMessage[]): {
    cacheablePrefix: OpenAIMessage[];
    cacheableTokens: number;
    dynamicTokens: number;
  } {
    const cacheablePrefix: OpenAIMessage[] = [];
    let cacheableTokens = 0;
    let dynamicTokens = 0;

    for (const message of messages) {
      const messageTokens = this.estimateMessageTokens(message);
      const isCacheable = this.isMessageCacheable(message);

      if (isCacheable) {
        cacheablePrefix.push(message);
        cacheableTokens += messageTokens;
      } else {
        dynamicTokens += messageTokens;
        // Once we hit a non-cacheable message, everything after is also non-cacheable
        // (OpenAI matches from the beginning)
        break;
      }
    }

    // Calculate remaining tokens
    for (let i = cacheablePrefix.length; i < messages.length; i++) {
      dynamicTokens += this.estimateMessageTokens(messages[i]);
    }

    return {
      cacheablePrefix,
      cacheableTokens,
      dynamicTokens
    };
  }

  /**
   * Check if a message is suitable for caching
   */
  private static isMessageCacheable(message: OpenAIMessage): boolean {
    // System messages are always cacheable (they rarely change)
    if (message.role === 'system') {
      return true;
    }

    // User messages with static content are cacheable
    if (message.role === 'user') {
      return this.isUserMessageCacheable(message);
    }

    // Assistant messages are generally not cacheable (responses vary)
    // unless they're tool calls with consistent parameters
    if (message.role === 'assistant') {
      return this.isAssistantMessageCacheable(message);
    }

    // Tool messages are not cacheable (results vary)
    return false;
  }

  /**
   * Check if user message is cacheable
   */
  private static isUserMessageCacheable(message: OpenAIMessage): boolean {
    // Check content for static indicators
    const content = this.extractTextContent(message);
    if (!content) return false;

    const lowerContent = content.toLowerCase();

    // Static content indicators
    const staticIndicators = [
      'you are', 'instructions:', 'system prompt', 'guidelines:',
      'rules:', 'context:', 'background:', 'reference:',
      'documentation:', 'manual:', 'policy:', 'procedure:',
      'company information', 'product details', 'api documentation',
      'function definitions', 'tool descriptions', 'schema:',
      'available tools', 'function calling'
    ];

    const hasStaticIndicators = staticIndicators.some(indicator =>
      lowerContent.includes(indicator)
    );

    // Check if content is long enough to be worth caching
    const isLongEnough = content.length > 500;

    // Check if content appears to be structured/configurable
    const isStructured = lowerContent.includes('json') ||
                        lowerContent.includes('xml') ||
                        lowerContent.includes('schema') ||
                        lowerContent.includes('format:') ||
                        lowerContent.includes('structure:');

    return hasStaticIndicators || isLongEnough || isStructured;
  }

  /**
   * Check if assistant message is cacheable
   */
  private static isAssistantMessageCacheable(message: OpenAIMessage): boolean {
    // Only cache assistant messages that are tool calls with consistent parameters
    if (message.tool_calls && Array.isArray(message.tool_calls)) {
      // Check if all tool calls are to well-known, parameter-less functions
      return message.tool_calls.every(call =>
        call.function &&
        typeof call.function.name === 'string' &&
        this.isWellKnownToolFunction(call.function.name)
      );
    }

    return false;
  }

  /**
   * Check if tool function is well-known and likely to have consistent parameters
   */
  private static isWellKnownToolFunction(functionName: string): boolean {
    const wellKnownFunctions = [
      'get_weather', 'get_time', 'get_date', 'get_current_time',
      'get_system_info', 'get_version', 'get_status', 'ping',
      'health_check', 'system_status', 'server_info'
    ];

    return wellKnownFunctions.includes(functionName.toLowerCase());
  }

  /**
   * Extract text content from OpenAI message
   */
  private static extractTextContent(message: OpenAIMessage): string {
    if (typeof message.content === 'string') {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      return message.content
        .filter(c => c.type === 'text' && c.text)
        .map(c => c.text!)
        .join('\n');
    }

    return '';
  }

  /**
   * Estimate tokens in OpenAI message
   */
  private static estimateMessageTokens(message: OpenAIMessage): number {
    try {
      const content = this.extractTextContent(message);

      // Add tokens for message structure and role
      let tokens = 4; // Base tokens for message

      // Add tokens for content
      if (content) {
        tokens += estimateTokens(content, AIProvider.OpenAI);
      }

      // Add tokens for tool calls if present
      if (message.tool_calls && Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          tokens += 3; // Base tokens per tool call
          if (call.function?.name) {
            tokens += estimateTokens(call.function.name, AIProvider.OpenAI);
          }
          if (call.function?.arguments) {
            tokens += estimateTokens(call.function.arguments, AIProvider.OpenAI);
          }
        }
      }

      return tokens;
    } catch (error) {
      loggingService.warn('Error estimating OpenAI message tokens', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Estimate total tokens in messages array
   */
  private static estimateTotalTokens(messages: OpenAIMessage[]): number {
    return messages.reduce((total, message) => total + this.estimateMessageTokens(message), 0);
  }

  /**
   * Calculate estimated savings from OpenAI caching
   */
  private static calculateEstimatedSavings(cacheableTokens: number, dynamicTokens: number): number {
    // OpenAI cache pricing: $1.50 per 1M tokens for cached input (50% discount)
    // Regular input pricing varies by model, we'll use GPT-4o pricing as reference
    const regularCostPerToken = 2.50 / 1_000_000; // ~$2.50 per 1M for GPT-4o input
    const cachedCostPerToken = 1.50 / 1_000_000; // $1.50 per 1M cached

    const regularCost = cacheableTokens * regularCostPerToken;
    const cachedCost = cacheableTokens * cachedCostPerToken;

    return Math.max(0, regularCost - cachedCost);
  }

  /**
   * Generate cache-related headers for OpenAI responses
   */
  public static generateCacheHeaders(
    analysis: OpenAICacheAnalysis
  ): Record<string, string> {
    return {
      'x-openai-cache-enabled': 'true',
      'x-openai-cache-type': 'automatic',
      'x-openai-cache-prefix-tokens': analysis.cacheableTokens.toString(),
      'x-openai-cache-dynamic-tokens': analysis.dynamicTokens.toString(),
      'x-openai-cache-total-tokens': analysis.totalTokens.toString(),
      'x-openai-cache-prefix-ratio': `${(analysis.prefixRatio * 100).toFixed(1)}%`,
      'x-openai-cache-ttl': this.CACHE_TTL_SECONDS.toString(),
      'x-openai-cache-estimated-savings': analysis.estimatedSavings.toFixed(6),
      'x-openai-cache-hit-rate': '0.00' // Will be updated with actual usage
    };
  }

  /**
   * Optimize message order for better caching
   */
  public static optimizeMessageOrder(messages: OpenAIMessage[]): OpenAIMessage[] {
    // Separate messages by cacheability
    const cacheableMessages: OpenAIMessage[] = [];
    const dynamicMessages: OpenAIMessage[] = [];

    for (const message of messages) {
      if (this.isMessageCacheable(message)) {
        cacheableMessages.push(message);
      } else {
        dynamicMessages.push(message);
      }
    }

    // Put cacheable messages first, then dynamic ones
    return [...cacheableMessages, ...dynamicMessages];
  }

  /**
   * Validate OpenAI cache configuration
   */
  public static validateConfig(config: PromptCachingConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.enabled) {
      return { valid: true, errors: [] }; // Disabled is valid
    }

    if (config.provider !== 'openai') {
      errors.push('Provider must be openai for OpenAI caching');
    }

    if (config.mode !== 'automatic') {
      errors.push('OpenAI only supports automatic caching mode');
    }

    if (config.breakpointsEnabled) {
      errors.push('OpenAI does not support explicit breakpoints - use automatic mode');
    }

    if (config.minTokens < this.MIN_CACHEABLE_TOKENS) {
      errors.push(`Minimum tokens must be at least ${this.MIN_CACHEABLE_TOKENS}`);
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
    ttl: number;
    cacheType: string;
  } {
    return {
      supportedModels: [...this.SUPPORTED_MODELS],
      minTokens: this.MIN_CACHEABLE_TOKENS,
      ttl: this.CACHE_TTL_SECONDS,
      cacheType: 'automatic'
    };
  }
}