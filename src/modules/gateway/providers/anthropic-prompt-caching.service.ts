import { Injectable, Logger } from '@nestjs/common';

/**
 * Anthropic Prompt Caching Service - Handles Anthropic-specific prompt caching optimizations
 * Implements Anthropic's caching API for efficient token usage
 */
@Injectable()
export class AnthropicPromptCachingService {
  private readonly logger = new Logger(AnthropicPromptCachingService.name);

  private readonly SUPPORTED_MODELS = [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
  ];

  /**
   * Check if model supports prompt caching
   */
  static isModelSupported(model: string): boolean {
    return new AnthropicPromptCachingService().SUPPORTED_MODELS.includes(model);
  }

  /**
   * Process messages for Anthropic prompt caching
   */
  static processMessages(
    messages: any[],
    cacheConfig: any,
  ): {
    processedMessages: any[];
    breakpoints: any[];
    metrics: any;
  } {
    const service = new AnthropicPromptCachingService();
    return service.processMessages(messages, cacheConfig);
  }

  /**
   * Generate cache headers for Anthropic
   */
  static generateCacheHeaders(
    breakpoints: any[],
    regularTokens: number,
    cacheCreationTokens: number,
  ): Record<string, string> {
    const service = new AnthropicPromptCachingService();
    return service.generateCacheHeaders(
      breakpoints,
      regularTokens,
      cacheCreationTokens,
    );
  }

  /**
   * Process messages and identify caching opportunities
   */
  private processMessages(
    messages: any[],
    cacheConfig: any,
  ): {
    processedMessages: any[];
    breakpoints: any[];
    metrics: any;
  } {
    const processedMessages = [...messages];
    const breakpoints: any[] = [];
    let regularTokens = 0;
    let cacheCreationTokens = 0;

    try {
      // Analyze messages for caching opportunities
      for (let i = 0; i < processedMessages.length; i++) {
        const message = processedMessages[i];
        const tokenCount = this.estimateTokenCount(message);

        // Check if this message should be cached
        if (this.shouldCacheMessage(message, i, cacheConfig)) {
          // Add cache control to message
          message.cache_control = { type: 'ephemeral' };
          breakpoints.push({
            messageIndex: i,
            tokenCount,
            cacheType: 'ephemeral',
          });
          cacheCreationTokens += tokenCount;
        } else {
          regularTokens += tokenCount;
        }
      }

      this.logger.debug('Anthropic prompt caching processed', {
        totalMessages: messages.length,
        breakpoints: breakpoints.length,
        regularTokens,
        cacheCreationTokens,
        totalTokens: regularTokens + cacheCreationTokens,
      });
    } catch (error) {
      this.logger.error('Error processing messages for Anthropic caching', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Return original messages on error
      return {
        processedMessages: messages,
        breakpoints: [],
        metrics: {
          regularTokens: this.estimateTokenCount(messages),
          cacheCreationTokens: 0,
          totalTokens: this.estimateTokenCount(messages),
        },
      };
    }

    return {
      processedMessages,
      breakpoints,
      metrics: {
        regularTokens,
        cacheCreationTokens,
        totalTokens: regularTokens + cacheCreationTokens,
      },
    };
  }

  /**
   * Generate cache headers for Anthropic API
   */
  private generateCacheHeaders(
    breakpoints: any[],
    regularTokens: number,
    cacheCreationTokens: number,
  ): Record<string, string> {
    const headers: Record<string, string> = {};

    if (breakpoints.length > 0) {
      headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
      headers['anthropic-cache-breakpoints'] = breakpoints
        .map((bp) => bp.messageIndex)
        .join(',');
    }

    // Add token usage estimates
    headers['anthropic-estimated-cache-creation-tokens'] =
      cacheCreationTokens.toString();
    headers['anthropic-estimated-regular-tokens'] = regularTokens.toString();

    return headers;
  }

  /**
   * Determine if a message should be cached
   */
  private shouldCacheMessage(
    message: any,
    index: number,
    cacheConfig: any,
  ): boolean {
    // Cache assistant messages (responses) for reuse
    if (message.role === 'assistant') {
      return true;
    }

    // Cache system messages
    if (message.role === 'system') {
      return true;
    }

    // Cache user messages that are substantial
    if (message.role === 'user') {
      const content = Array.isArray(message.content)
        ? message.content.map((c: any) => c.text || '').join('')
        : message.content;

      // Only cache if content is substantial (>100 characters)
      return content.length > 100;
    }

    return false;
  }

  /**
   * Estimate token count for a message
   */
  private estimateTokenCount(message: any): number {
    try {
      let content = '';

      if (Array.isArray(message.content)) {
        content = message.content.map((c: any) => c.text || '').join('');
      } else if (typeof message.content === 'string') {
        content = message.content;
      }

      // Rough estimation: ~4 characters per token
      return Math.ceil(content.length / 4);
    } catch (error) {
      return 0;
    }
  }
}
