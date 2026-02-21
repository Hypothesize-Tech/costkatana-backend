/**
 * Anthropic Claude Prompt Caching Implementation
 *
 * Handles explicit cache breakpoints using cache_control headers
 * for Claude models (Sonnet 4.5, Haiku 4.5, Opus 4.5/4.6, etc.)
 */

import { loggingService } from '../../logging.service';
import { estimateTokens } from '../../../utils/tokenCounter';
import { AIProvider } from '../../../types/aiCostTracker.types';
import {
  PromptCachingConfig,
  CacheBreakpoint,
  PromptCacheMetrics,
  PromptCacheRequest,
  PromptCacheResponse
} from '../../../types/promptCaching.types';

export interface ClaudeCacheBreakpoint {
  position: number;
  tokenCount: number;
  contentType: 'system' | 'tools' | 'documents' | 'context';
  cacheControl: {
    type: 'ephemeral';
  };
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: ClaudeMessageContent[];
}

export interface ClaudeMessageContent {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  cache_control?: {
    type: 'ephemeral';
  };
  // Other content types...
}

export class AnthropicPromptCaching {
  private static readonly MIN_CACHE_BREAKPOINT_TOKENS = 1024;
  private static readonly MAX_CACHE_BREAKPOINTS = 4;
  private static readonly CACHE_TTL_SECONDS = 300; // 5 minutes

  /**
   * Check if model supports prompt caching
   */
  public static isModelSupported(model: string): boolean {
    const supportedModels = [
      // Claude 4.6 series
      'claude-sonnet-4-6',

      // Claude 4.5 series
      'claude-sonnet-4-5', 'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5', 'claude-haiku-4-5-20251001',
      'claude-opus-4-5', 'claude-opus-4-5-20251101',
      'claude-opus-4-6', 'claude-opus-4-6-v1',

      // Claude 3.7 series (legacy)
      'claude-3-7-sonnet-20250219',

      // Claude 3.5 series (legacy)
      'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'
    ];

    const normalizedModel = model.toLowerCase().replace(/[-_]/g, '');
    return supportedModels.some(supported =>
      normalizedModel.includes(supported.toLowerCase().replace(/[-_]/g, ''))
    );
  }

  /**
   * Process messages for Claude prompt caching
   */
  public static processMessages(
    messages: any[],
    config: PromptCachingConfig
  ): {
    processedMessages: ClaudeMessage[];
    breakpoints: ClaudeCacheBreakpoint[];
    metrics: Partial<PromptCacheMetrics>;
  } {
    try {
      // Convert messages to Claude format if needed
      const claudeMessages = this.convertToClaudeFormat(messages);

      // Analyze for cache breakpoints
      const analysis = this.analyzeForBreakpoints(claudeMessages, config);

      // Apply cache controls
      const processedMessages = this.applyCacheControls(claudeMessages, analysis.breakpoints);

      const metrics: Partial<PromptCacheMetrics> = {
        cacheCreationTokens: analysis.totalCacheableTokens,
        cacheReadTokens: 0,
        regularTokens: analysis.totalTokens - analysis.totalCacheableTokens,
        cacheHits: 0,
        cacheMisses: 1
      };

      loggingService.debug('Claude prompt caching processed', {
        originalMessages: messages.length,
        processedMessages: processedMessages.length,
        breakpoints: analysis.breakpoints.length,
        cacheableTokens: analysis.totalCacheableTokens,
        totalTokens: analysis.totalTokens
      });

      return {
        processedMessages,
        breakpoints: analysis.breakpoints,
        metrics
      };

    } catch (error) {
      loggingService.error('Error processing Claude messages for caching', {
        error: error instanceof Error ? error.message : String(error),
        messageCount: messages.length
      });

      // Return safe fallback
      return {
        processedMessages: this.convertToClaudeFormat(messages),
        breakpoints: [],
        metrics: {
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          regularTokens: this.estimateTotalTokens(messages),
          cacheHits: 0,
          cacheMisses: 1
        }
      };
    }
  }

  /**
   * Convert various message formats to Claude format
   */
  private static convertToClaudeFormat(messages: any[]): ClaudeMessage[] {
    const claudeMessages: ClaudeMessage[] = [];

    for (const message of messages) {
      if (this.isClaudeMessage(message)) {
        claudeMessages.push(message);
        continue;
      }

      // Convert from OpenAI format
      if (message.role && message.content) {
        const claudeMessage: ClaudeMessage = {
          role: message.role === 'assistant' ? 'assistant' :
                message.role === 'system' ? 'user' : 'user', // System messages become user messages with instructions
          content: []
        };

        // Handle content conversion
        if (typeof message.content === 'string') {
          claudeMessage.content.push({
            type: 'text',
            text: message.content
          });
        } else if (Array.isArray(message.content)) {
          for (const part of message.content) {
            if (part.type === 'text') {
              claudeMessage.content.push({
                type: 'text',
                text: part.text
              });
            }
            // Handle other content types as needed
          }
        }

        claudeMessages.push(claudeMessage);
      }
    }

    return claudeMessages;
  }

  /**
   * Check if message is already in Claude format
   */
  private static isClaudeMessage(message: any): message is ClaudeMessage {
    return message &&
           typeof message === 'object' &&
           (message.role === 'user' || message.role === 'assistant') &&
           Array.isArray(message.content) &&
           message.content.every((item: any) =>
             item.type && (item.type === 'text' || item.type === 'image' || item.type === 'tool_use' || item.type === 'tool_result')
           );
  }

  /**
   * Analyze messages for potential cache breakpoints
   */
  private static analyzeForBreakpoints(
    messages: ClaudeMessage[],
    config: PromptCachingConfig
  ): {
    breakpoints: ClaudeCacheBreakpoint[];
    totalCacheableTokens: number;
    totalTokens: number;
  } {
    const breakpoints: ClaudeCacheBreakpoint[] = [];
    let totalCacheableTokens = 0;
    let totalTokens = 0;

    for (let i = 0; i < messages.length && breakpoints.length < this.MAX_CACHE_BREAKPOINTS; i++) {
      const message = messages[i];
      const messageTokens = this.estimateMessageTokens(message);
      totalTokens += messageTokens;

      // Check if this message qualifies for caching
      const contentType = this.detectContentType(message);
      const isCacheable = this.isContentCacheable(message, contentType, config);

      if (isCacheable && messageTokens >= this.MIN_CACHE_BREAKPOINT_TOKENS) {
        breakpoints.push({
          position: i,
          tokenCount: messageTokens,
          contentType,
          cacheControl: { type: 'ephemeral' }
        });

        totalCacheableTokens += messageTokens;
      }
    }

    return {
      breakpoints,
      totalCacheableTokens,
      totalTokens
    };
  }

  /**
   * Apply cache controls to identified breakpoints
   */
  private static applyCacheControls(
    messages: ClaudeMessage[],
    breakpoints: ClaudeCacheBreakpoint[]
  ): ClaudeMessage[] {
    const processedMessages = [...messages];

    for (const breakpoint of breakpoints) {
      const message = processedMessages[breakpoint.position];
      if (!message || !Array.isArray(message.content)) continue;

      // Find the last text content to add cache control
      for (let i = message.content.length - 1; i >= 0; i--) {
        const content = message.content[i];
        if (content.type === 'text' && content.text) {
          content.cache_control = breakpoint.cacheControl;
          break;
        }
      }
    }

    return processedMessages;
  }

  /**
   * Detect content type for caching classification
   */
  private static detectContentType(message: ClaudeMessage): ClaudeCacheBreakpoint['contentType'] {
    if (!message.content || !Array.isArray(message.content)) {
      return 'context';
    }

    const textContent = message.content
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text!)
      .join(' ')
      .toLowerCase();

    // System-like content
    if (textContent.includes('you are') || textContent.includes('your role') ||
        textContent.includes('instructions') || textContent.includes('always respond')) {
      return 'system';
    }

    // Tool definitions
    if (textContent.includes('function') || textContent.includes('tool') ||
        textContent.includes('available functions') || textContent.includes('api')) {
      return 'tools';
    }

    // Document content
    if (textContent.includes('document') || textContent.includes('manual') ||
        textContent.includes('reference') || textContent.includes('knowledge') ||
        textContent.length > 2000) { // Large text blocks likely documents
      return 'documents';
    }

    return 'context';
  }

  /**
   * Check if content is suitable for caching
   */
  private static isContentCacheable(
    message: ClaudeMessage,
    contentType: ClaudeCacheBreakpoint['contentType'],
    config: PromptCachingConfig
  ): boolean {
    // Must be enabled in config
    if (!config.enabled || !config.breakpointsEnabled) {
      return false;
    }

    // Only cache user messages (system instructions in user messages)
    if (message.role !== 'user') {
      return false;
    }

    // Content type must be cacheable
    const cacheableTypes: ClaudeCacheBreakpoint['contentType'][] = ['system', 'tools', 'documents'];
    return cacheableTypes.includes(contentType);
  }

  /**
   * Estimate tokens in Claude message
   */
  private static estimateMessageTokens(message: ClaudeMessage): number {
    try {
      let totalText = '';

      for (const content of message.content) {
        if (content.type === 'text' && content.text) {
          totalText += content.text + '\n';
        }
        // Other content types would need different handling
      }

      return estimateTokens(totalText, AIProvider.Anthropic);
    } catch (error) {
      loggingService.warn('Error estimating Claude message tokens', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }

  /**
   * Estimate total tokens in messages array
   */
  private static estimateTotalTokens(messages: any[]): number {
    try {
      let totalText = '';

      for (const message of messages) {
        if (typeof message === 'string') {
          totalText += message + '\n';
        } else if (message.content) {
          if (typeof message.content === 'string') {
            totalText += message.content + '\n';
          } else if (Array.isArray(message.content)) {
            for (const part of message.content) {
              if (part.text) {
                totalText += part.text + '\n';
              }
            }
          }
        }
      }

      return estimateTokens(totalText, AIProvider.Anthropic);
    } catch {
      return 0;
    }
  }

  /**
   * Generate cache-related headers for Claude responses
   */
  public static generateCacheHeaders(
    breakpoints: ClaudeCacheBreakpoint[],
    totalTokens: number,
    cacheableTokens: number
  ): Record<string, string> {
    const savings = this.calculateEstimatedSavings(cacheableTokens);

    return {
      'x-anthropic-cache-enabled': 'true',
      'x-anthropic-cache-breakpoints': breakpoints.length.toString(),
      'x-anthropic-cache-creation-tokens': cacheableTokens.toString(),
      'x-anthropic-cache-total-tokens': totalTokens.toString(),
      'x-anthropic-cache-ttl': this.CACHE_TTL_SECONDS.toString(),
      'x-anthropic-cache-estimated-savings': savings.toFixed(6),
      'x-anthropic-cache-hit-rate': '0.00', // Will be updated with actual usage
      'x-anthropic-cache-types': breakpoints.map(b => b.contentType).join(',')
    };
  }

  /**
   * Calculate estimated savings from Claude caching
   */
  private static calculateEstimatedSavings(cacheableTokens: number): number {
    // Claude cache pricing: $0.30 per 1M tokens for both write and read (90% discount)
    const regularCostPerToken = 3.00 / 1_000_000; // $3.00 per 1M for Sonnet input
    const cachedCostPerToken = 0.30 / 1_000_000; // $0.30 per 1M cached

    const regularCost = cacheableTokens * regularCostPerToken;
    const cachedCost = cacheableTokens * cachedCostPerToken;

    return Math.max(0, regularCost - cachedCost);
  }

  /**
   * Validate Claude cache configuration
   */
  public static validateConfig(config: PromptCachingConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.enabled) {
      return { valid: true, errors: [] }; // Disabled is valid
    }

    if (config.provider !== 'anthropic') {
      errors.push('Provider must be anthropic for Claude caching');
    }

    if (config.minTokens < this.MIN_CACHE_BREAKPOINT_TOKENS) {
      errors.push(`Minimum tokens must be at least ${this.MIN_CACHE_BREAKPOINT_TOKENS}`);
    }

    if (config.breakpointsEnabled && config.mode !== 'explicit') {
      errors.push('Breakpoints require explicit caching mode');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}