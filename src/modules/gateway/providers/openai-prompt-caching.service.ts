import { Injectable, Logger } from '@nestjs/common';

/**
 * OpenAI Prompt Caching Service - Handles OpenAI-specific prompt caching optimizations
 * Implements OpenAI's prompt caching for efficient token usage
 */
@Injectable()
export class OpenAIPromptCachingService {
  private readonly logger = new Logger(OpenAIPromptCachingService.name);

  private readonly SUPPORTED_MODELS = [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4-turbo-preview',
    'gpt-4-0125-preview',
    'gpt-4-1106-preview',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-0125',
  ];

  /**
   * Check if model supports prompt caching
   */
  static isModelSupported(model: string): boolean {
    return new OpenAIPromptCachingService().SUPPORTED_MODELS.some(
      (supported) => model.includes(supported) || supported.includes(model),
    );
  }

  /**
   * Analyze messages for prompt caching opportunities
   */
  static analyzeMessages(
    messages: any[],
    cacheConfig: any,
  ): {
    cacheable: boolean;
    cacheType: string;
    estimatedSavings: number;
    recommendations: any[];
  } {
    const service = new OpenAIPromptCachingService();
    return service.analyzeMessages(messages, cacheConfig);
  }

  /**
   * Optimize message order for caching
   */
  static optimizeMessageOrder(messages: any[]): any[] {
    const service = new OpenAIPromptCachingService();
    return service.optimizeMessageOrder(messages);
  }

  /**
   * Generate cache headers for OpenAI
   */
  static generateCacheHeaders(analysis: any): Record<string, string> {
    const service = new OpenAIPromptCachingService();
    return service.generateCacheHeaders(analysis);
  }

  /**
   * Analyze messages for caching opportunities
   */
  private analyzeMessages(
    messages: any[],
    cacheConfig: any,
  ): {
    cacheable: boolean;
    cacheType: string;
    estimatedSavings: number;
    recommendations: any[];
  } {
    try {
      const recommendations: any[] = [];
      let totalTokens = 0;
      let cacheableTokens = 0;

      // Analyze each message for caching potential
      for (let i = 0; i < messages.length; i++) {
        const message = messages[i];
        const tokenCount = this.estimateTokenCount(message);
        totalTokens += tokenCount;

        // Check if message can be cached
        if (this.isCacheableMessage(message, i, messages.length)) {
          cacheableTokens += tokenCount;
          recommendations.push({
            messageIndex: i,
            type: 'cache',
            reason: this.getCacheReason(message),
            estimatedTokens: tokenCount,
          });
        }
      }

      const cacheRatio = cacheableTokens / totalTokens;
      const estimatedSavings = cacheableTokens * 0.5; // Assume 50% savings on cached content

      const result = {
        cacheable: cacheRatio > 0.3, // Cacheable if >30% can be cached
        cacheType:
          cacheRatio > 0.7 ? 'full' : cacheRatio > 0.3 ? 'partial' : 'none',
        estimatedSavings,
        recommendations,
      };

      this.logger.debug('OpenAI prompt caching analysis completed', {
        totalMessages: messages.length,
        totalTokens,
        cacheableTokens,
        cacheRatio: `${(cacheRatio * 100).toFixed(1)}%`,
        cacheType: result.cacheType,
        estimatedSavings: result.estimatedSavings.toFixed(2),
      });

      return result;
    } catch (error) {
      this.logger.error('Error analyzing messages for OpenAI caching', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return {
        cacheable: false,
        cacheType: 'none',
        estimatedSavings: 0,
        recommendations: [],
      };
    }
  }

  /**
   * Optimize message order for better caching
   */
  private optimizeMessageOrder(messages: any[]): any[] {
    // For OpenAI, maintain conversation order but ensure system messages are first
    const systemMessages = messages.filter((m) => m.role === 'system');
    const otherMessages = messages.filter((m) => m.role !== 'system');

    return [...systemMessages, ...otherMessages];
  }

  /**
   * Generate cache headers for OpenAI API
   */
  private generateCacheHeaders(analysis: any): Record<string, string> {
    const headers: Record<string, string> = {};

    if (analysis.cacheable) {
      headers['openai-cache-type'] = analysis.cacheType;
      headers['openai-estimated-savings'] =
        analysis.estimatedSavings.toFixed(2);
      headers['openai-cache-recommendations'] =
        analysis.recommendations.length.toString();
    }

    return headers;
  }

  /**
   * Check if a message can be cached
   */
  private isCacheableMessage(
    message: any,
    index: number,
    totalMessages: number,
  ): boolean {
    // System messages are always cacheable
    if (message.role === 'system') {
      return true;
    }

    // Assistant messages (responses) are cacheable
    if (message.role === 'assistant') {
      return true;
    }

    // User messages can be cached if they're substantial and not the last message
    if (message.role === 'user') {
      const content = message.content;
      const isSubstantial = typeof content === 'string' && content.length > 50;
      const notLastMessage = index < totalMessages - 1;

      return isSubstantial && notLastMessage;
    }

    return false;
  }

  /**
   * Get reason why message should be cached
   */
  private getCacheReason(message: any): string {
    switch (message.role) {
      case 'system':
        return 'System instructions are static and reusable';
      case 'assistant':
        return 'Assistant responses can be reused for similar queries';
      case 'user':
        return 'Substantial user input can be cached for context';
      default:
        return 'Message type supports caching';
    }
  }

  /**
   * Estimate token count for a message
   */
  private estimateTokenCount(message: any): number {
    try {
      let content = '';

      if (typeof message.content === 'string') {
        content = message.content;
      } else if (Array.isArray(message.content)) {
        content = message.content
          .map((c: any) => c.text || c.content || '')
          .join('');
      }

      // Rough estimation: ~4 characters per token for English text
      return Math.ceil(content.length / 4);
    } catch (error) {
      return 0;
    }
  }
}
