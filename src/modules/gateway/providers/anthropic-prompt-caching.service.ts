import { Injectable, Logger } from '@nestjs/common';

/** Max cache breakpoints Anthropic allows per request */
const MAX_CACHE_BREAKPOINTS = 4;

/** Minimum characters for a user block to be treated as cacheable static document context */
const MIN_USER_DOC_CHARS = 512;

/**
 * Anthropic Prompt Caching Service - Handles Anthropic-specific prompt caching optimizations
 * Places `cache_control: { type: 'ephemeral' }` on stable prefix blocks only (system, tools,
 * large non-final user content), never on the last message turn.
 */
@Injectable()
export class AnthropicPromptCachingService {
  private readonly logger = new Logger(AnthropicPromptCachingService.name);

  /**
   * Check if model supports prompt caching (prefix match — new model ids ship without code changes).
   */
  static isModelSupported(model: string): boolean {
    const m = (model || '').toLowerCase();
    return (
      m.includes('claude-3') ||
      m.includes('claude-4') ||
      m.includes('claude-opus') ||
      m.includes('claude-sonnet') ||
      m.includes('claude-haiku') ||
      m.includes('anthropic.claude')
    );
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
   * Process messages and place up to 4 cache breakpoints on stable content only.
   * Never marks the last message in the array (current user turn).
   */
  private processMessages(
    messages: any[],
    cacheConfig: any,
  ): {
    processedMessages: any[];
    breakpoints: any[];
    metrics: any;
  } {
    const processedMessages = Array.isArray(messages)
      ? messages.map((m) => (m && typeof m === 'object' ? { ...m } : m))
      : [];
    const breakpoints: any[] = [];
    let regularTokens = 0;
    let cacheCreationTokens = 0;

    try {
      const lastIndex = processedMessages.length - 1;

      for (let i = 0; i < processedMessages.length; i++) {
        const message = processedMessages[i];
        const tokenCount = this.estimateTokenCount(message);

        if (breakpoints.length >= MAX_CACHE_BREAKPOINTS) {
          regularTokens += tokenCount;
          continue;
        }

        if (i === lastIndex) {
          // Never cache the final turn — it is usually the live user query
          regularTokens += tokenCount;
          continue;
        }

        if (this.shouldCacheMessage(message, i, lastIndex, cacheConfig)) {
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

    headers['anthropic-estimated-cache-creation-tokens'] =
      cacheCreationTokens.toString();
    headers['anthropic-estimated-regular-tokens'] = regularTokens.toString();

    return headers;
  }

  /**
   * Cache system messages; cache user messages only when they look like static documents
   * (large text). Skip assistant turns — not stable for prefix caching in typical flows.
   */
  private shouldCacheMessage(
    message: any,
    index: number,
    lastIndex: number,
    _cacheConfig: any,
  ): boolean {
    if (index === lastIndex) {
      return false;
    }

    if (message.role === 'system') {
      return true;
    }

    if (message.role === 'assistant') {
      return false;
    }

    if (message.role === 'user') {
      const content = Array.isArray(message.content)
        ? message.content.map((c: any) => c.text || '').join('')
        : String(message.content || '');
      return content.length >= MIN_USER_DOC_CHARS;
    }

    return false;
  }

  /**
   * Estimate token count for a message
   */
  private estimateTokenCount(message: any): number {
    try {
      if (Array.isArray(message)) {
        return message.reduce(
          (sum, m) => sum + this.estimateTokenCount(m),
          0,
        );
      }
      let content = '';

      if (Array.isArray(message?.content)) {
        content = message.content.map((c: any) => c.text || '').join('');
      } else if (typeof message?.content === 'string') {
        content = message.content;
      }

      return Math.ceil(content.length / 4);
    } catch {
      return 0;
    }
  }
}
