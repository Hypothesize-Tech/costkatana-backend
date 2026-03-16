import { Injectable, Logger } from '@nestjs/common';

/**
 * Google Gemini Prompt Caching Service - Handles Google AI-specific prompt caching optimizations
 * Implements Google's context caching for efficient token usage
 */
@Injectable()
export class GoogleGeminiPromptCachingService {
  private readonly logger = new Logger(GoogleGeminiPromptCachingService.name);

  private readonly SUPPORTED_MODELS = [
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-pro',
    'gemini-flash',
  ];

  /**
   * Check if model supports prompt caching
   */
  static isModelSupported(model: string): boolean {
    return new GoogleGeminiPromptCachingService().SUPPORTED_MODELS.some(
      (supported) =>
        model.includes(supported) ||
        supported.includes(model.replace('models/', '')),
    );
  }

  /**
   * Convert internal message format to Gemini format
   */
  static convertToGeminiFormat(messages: any[]): any {
    const service = new GoogleGeminiPromptCachingService();
    return service.convertToGeminiFormat(messages);
  }

  /**
   * Analyze messages for caching opportunities
   */
  static analyzeMessages(
    geminiMessages: any,
    cacheConfig: any,
  ): {
    cacheable: boolean;
    cacheType: string;
    estimatedSavings: number;
    recommendations: any[];
  } {
    const service = new GoogleGeminiPromptCachingService();
    return service.analyzeMessages(geminiMessages, cacheConfig);
  }

  /**
   * Generate cache headers for Google AI API
   */
  static generateCacheHeaders(analysis: any): Record<string, string> {
    const service = new GoogleGeminiPromptCachingService();
    return service.generateCacheHeaders(analysis);
  }

  /**
   * Convert internal message format to Gemini format
   */
  private convertToGeminiFormat(messages: any[]): any {
    // Gemini expects contents array with parts
    const contents = messages.map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [
        {
          text: message.content,
        },
      ],
    }));

    return { contents };
  }

  /**
   * Analyze messages for caching opportunities
   */
  private analyzeMessages(
    geminiMessages: any,
    cacheConfig: any,
  ): {
    cacheable: boolean;
    cacheType: string;
    estimatedSavings: number;
    recommendations: any[];
  } {
    try {
      const contents = geminiMessages.contents || [];
      const recommendations: any[] = [];
      let totalTokens = 0;
      let cacheableTokens = 0;

      // Analyze each content for caching potential
      for (let i = 0; i < contents.length; i++) {
        const content = contents[i];
        const tokenCount = this.estimateTokenCount(content);
        totalTokens += tokenCount;

        // Check if content can be cached
        if (this.isCacheableContent(content, i, contents.length)) {
          cacheableTokens += tokenCount;
          recommendations.push({
            contentIndex: i,
            type: 'cache',
            reason: this.getCacheReason(content),
            estimatedTokens: tokenCount,
          });
        }
      }

      const cacheRatio = cacheableTokens / totalTokens;
      const estimatedSavings = cacheableTokens * 0.6; // Assume 60% savings on cached content

      const result = {
        cacheable: cacheRatio > 0.2, // Cacheable if >20% can be cached
        cacheType:
          cacheRatio > 0.6 ? 'full' : cacheRatio > 0.2 ? 'partial' : 'none',
        estimatedSavings,
        recommendations,
      };

      this.logger.debug('Google Gemini prompt caching analysis completed', {
        totalContents: contents.length,
        totalTokens,
        cacheableTokens,
        cacheRatio: `${(cacheRatio * 100).toFixed(1)}%`,
        cacheType: result.cacheType,
        estimatedSavings: result.estimatedSavings.toFixed(2),
      });

      return result;
    } catch (error) {
      this.logger.error('Error analyzing messages for Google Gemini caching', {
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
   * Generate cache headers for Google AI API
   */
  private generateCacheHeaders(analysis: any): Record<string, string> {
    const headers: Record<string, string> = {};

    if (analysis.cacheable) {
      headers['google-cache-type'] = analysis.cacheType;
      headers['google-estimated-savings'] =
        analysis.estimatedSavings.toFixed(2);
      headers['google-cache-recommendations'] =
        analysis.recommendations.length.toString();
    }

    return headers;
  }

  /**
   * Check if content can be cached
   */
  private isCacheableContent(
    content: any,
    index: number,
    totalContents: number,
  ): boolean {
    // Model responses (assistant messages) are cacheable
    if (content.role === 'model') {
      return true;
    }

    // User messages can be cached if they're substantial and not the last message
    if (content.role === 'user') {
      const text = content.parts?.[0]?.text || '';
      const isSubstantial = text.length > 50;
      const notLastMessage = index < totalContents - 1;

      return isSubstantial && notLastMessage;
    }

    return false;
  }

  /**
   * Get reason why content should be cached
   */
  private getCacheReason(content: any): string {
    switch (content.role) {
      case 'model':
        return 'Model responses can be reused for similar queries';
      case 'user':
        return 'Substantial user input can be cached for context';
      default:
        return 'Content type supports caching';
    }
  }

  /**
   * Estimate token count for content
   */
  private estimateTokenCount(content: any): number {
    try {
      let text = '';

      if (content.parts && Array.isArray(content.parts)) {
        text = content.parts.map((part: any) => part.text || '').join('');
      } else if (content.text) {
        text = content.text;
      }

      // Rough estimation: ~4 characters per token for English text
      return Math.ceil(text.length / 4);
    } catch (error) {
      return 0;
    }
  }
}
