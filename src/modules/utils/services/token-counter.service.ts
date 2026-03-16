/**
 * Token Counter Service
 *
 * Provides accurate token counting and estimation for various AI models using
 * proper tokenizer libraries (gpt-tokenizer for OpenAI, approximations for others).
 * Handles different tokenization schemes and provides caching for performance.
 */

import { Injectable, Logger } from '@nestjs/common';
import { encode as gptEncode, encodeChat } from 'gpt-tokenizer';

export interface TokenCountResult {
  /** Total number of tokens */
  tokens: number;

  /** Breakdown by token types */
  breakdown: {
    text: number;
    code: number;
    markup: number;
    whitespace: number;
  };

  /** Character count */
  characters: number;

  /** Word count */
  words: number;

  /** Lines count */
  lines: number;

  /** Estimated reading time in minutes */
  estimatedReadingTime: number;

  /** Model-specific information */
  modelSpecific?: {
    maxContextLength: number;
    remainingTokens: number;
    chunksNeeded: number;
  };
}

export interface TokenEstimationOptions {
  /** Model to estimate for (affects tokenization) */
  model?: string;

  /** Include model-specific limits and chunking info */
  includeModelLimits?: boolean;

  /** Preprocessing options */
  preprocessing?: {
    /** Remove extra whitespace */
    normalize?: boolean;
    /** Remove markdown formatting */
    stripMarkdown?: boolean;
    /** Truncate to max length */
    truncate?: number;
  };
}

@Injectable()
export class TokenCounterService {
  private readonly logger = new Logger(TokenCounterService.name);

  // Model-specific context limits (in tokens)
  private readonly MODEL_LIMITS: Record<string, number> = {
    'anthropic.claude-3-opus-20240229-v1:0': 200000,
    'anthropic.claude-3-5-sonnet-20240620-v1:0': 200000,
    'anthropic.claude-3-haiku-20240307-v1:0': 200000,
    'global.anthropic.claude-haiku-4-5-20251001-v1:0': 200000,
    'openai.gpt-4o-2024-08-06': 128000,
    'openai.gpt-4o-mini-2024-07-18': 128000,
    'openai.gpt-4-turbo-2024-04-09': 128000,
    'google.gemini-pro-1.5': 2097152, // 2M tokens
    'google.gemini-flash-1.5': 1048576, // 1M tokens
    'meta.llama3-70b-instruct-v1:0': 8192,
    'meta.llama3-8b-instruct-v1:0': 8192,
    'cohere.command-r-plus-v1:0': 128000,
    'cohere.command-r-v1:0': 128000,
  };

  // Cache for tokenization results
  private readonly tokenCache = new Map<string, TokenCountResult>();

  // Maximum cache size
  private readonly MAX_CACHE_SIZE = 10000;

  // Cache hit/miss tracking
  private cacheHits = 0;
  private cacheMisses = 0;

  /**
   * Count tokens in text with detailed analysis
   */
  countTokens(
    text: string,
    options: TokenEstimationOptions = {},
  ): TokenCountResult {
    if (!text) {
      return this.createEmptyResult();
    }

    // Check cache first
    const cacheKey = this.generateCacheKey(text, options);
    const cached = this.tokenCache.get(cacheKey);
    if (cached) {
      this.cacheHits++;
      return { ...cached };
    }

    // Cache miss
    this.cacheMisses++;

    // Preprocess text if requested
    let processedText = text;
    if (options.preprocessing) {
      processedText = this.preprocessText(text, options.preprocessing);
    }

    // Perform token counting
    const result = this.performTokenCounting(processedText, options);

    // Add model-specific information if requested
    if (options.includeModelLimits && options.model) {
      result.modelSpecific = this.addModelSpecificInfo(
        result.tokens,
        options.model,
      );
    }

    // Cache the result
    this.cacheResult(cacheKey, result);

    return result;
  }

  /**
   * Async version of token counting (useful for large texts)
   * Uses a worker thread to offload the computation for large texts.
   * For small texts, falls back to sync method directly to avoid overhead.
   */
  async countTokensAsync(
    text: string,
    options: TokenEstimationOptions = {},
  ): Promise<TokenCountResult> {
    // Heuristic: use worker for large texts (>20k characters), else sync
    const LARGE_TEXT_THRESHOLD = 20000;

    if (!text || text.length < LARGE_TEXT_THRESHOLD) {
      // Small text: use sync to reduce overhead
      return this.countTokens(text, options);
    }

    // Offload to a worker thread for large texts
    // Note: Avoiding circular deps, so require only if needed
    const { Worker } = await import('worker_threads');

    const workerScript = `
      const { parentPort } = require('worker_threads');
      parentPort.on('message', ({ text, options }) => {
        // Import only what's needed to minimize dependencies
        const estimate = (${this.countTokens.toString()});
        const result = estimate(text, options);
        parentPort.postMessage(result);
      });
    `;

    return new Promise<TokenCountResult>((resolve, reject) => {
      const worker = new Worker(workerScript, {
        eval: true,
      });

      worker.on('message', (result: TokenCountResult) => {
        resolve(result);
        worker.terminate();
      });

      worker.on('error', (err) => {
        reject(err);
        worker.terminate();
      });

      worker.postMessage({
        text,
        options,
      });
    });
  }

  /**
   * Estimate tokens without full analysis (faster for bulk operations)
   */
  estimateTokens(text: string, model?: string): number {
    if (!text) return 0;

    // Use different estimation strategies based on model
    const strategy = this.getEstimationStrategy(model);

    switch (strategy) {
      case 'characters_per_token':
        return Math.ceil(text.length / 4); // Rough approximation
      case 'words_per_token':
        return Math.ceil(text.split(/\s+/).length / 0.75);
      case 'precise':
        return this.countTokens(text, { model }).tokens;
      default:
        return Math.ceil(text.length / 4);
    }
  }

  /**
   * Async token estimation
   */
  async estimateTokensAsync(text: string, model?: string): Promise<number> {
    return this.estimateTokens(text, model);
  }

  /**
   * Check if text fits within model context limits
   */
  fitsInContext(text: string, model: string): boolean {
    const limit = this.MODEL_LIMITS[model];
    if (!limit) return true; // Unknown model, assume it fits

    const tokens = this.estimateTokens(text, model);
    return tokens <= limit;
  }

  /**
   * Split text into chunks that fit within model context
   */
  splitIntoChunks(
    text: string,
    model: string,
    overlap: number = 200,
  ): string[] {
    const limit = this.MODEL_LIMITS[model] || 4096;
    const chunks: string[] = [];

    if (this.fitsInContext(text, model)) {
      return [text];
    }

    const sentences = text.split(/[.!?]+/).filter((s) => s.trim());
    let currentChunk = '';
    let currentTokens = 0;

    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokens(sentence, model);

      if (currentTokens + sentenceTokens > limit - overlap && currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
        currentTokens = sentenceTokens;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence;
        currentTokens += sentenceTokens;
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Get token statistics for multiple texts
   */
  getBatchStatistics(
    texts: string[],
    model?: string,
  ): {
    totalTokens: number;
    averageTokens: number;
    minTokens: number;
    maxTokens: number;
    totalTexts: number;
    model?: string;
  } {
    if (texts.length === 0) {
      return {
        totalTokens: 0,
        averageTokens: 0,
        minTokens: 0,
        maxTokens: 0,
        totalTexts: 0,
        model,
      };
    }

    const tokenCounts = texts.map((text) => this.estimateTokens(text, model));
    const totalTokens = tokenCounts.reduce((sum, count) => sum + count, 0);

    return {
      totalTokens,
      averageTokens: totalTokens / texts.length,
      minTokens: Math.min(...tokenCounts),
      maxTokens: Math.max(...tokenCounts),
      totalTexts: texts.length,
      model,
    };
  }

  /**
   * Clear token cache
   */
  clearCache(): void {
    this.tokenCache.clear();
    this.logger.log('Token cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
  } {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = totalRequests > 0 ? this.cacheHits / totalRequests : 0;

    return {
      size: this.tokenCache.size,
      maxSize: this.MAX_CACHE_SIZE,
      hitRate: hitRate,
    };
  }

  /**
   * Perform the actual token counting
   */
  private performTokenCounting(
    text: string,
    options: TokenEstimationOptions,
  ): TokenCountResult {
    const characters = text.length;
    const words = text.split(/\s+/).filter((word) => word.length > 0).length;
    const lines = text.split('\n').length;

    // Estimate reading time (words per minute)
    const estimatedReadingTime = Math.max(0.1, words / 200);

    // Rough token estimation using different strategies
    const tokens = this.estimateTokenCount(text, options.model);

    // Breakdown (simplified - in reality would use proper tokenization)
    const breakdown = this.analyzeTokenBreakdown(text);

    return {
      tokens,
      breakdown,
      characters,
      words,
      lines,
      estimatedReadingTime,
    };
  }

  /**
   * Estimate token count using model-specific strategies with actual tokenizers
   */
  private estimateTokenCount(text: string, model?: string): number {
    if (!text) return 0;

    // Use proper tokenizer for OpenAI models
    if (model && this.isOpenAIModel(model)) {
      try {
        const tokens = gptEncode(text);
        return tokens.length;
      } catch (error) {
        this.logger.warn(
          'Failed to use GPT tokenizer, falling back to heuristic',
          error,
        );
      }
    }

    // For Claude models, use similar tokenization to GPT (close approximation)
    if (model && this.isAnthropicModel(model)) {
      try {
        const tokens = gptEncode(text);
        // Claude tokenization is very similar to GPT, typically within 5%
        return Math.ceil(tokens.length * 1.02);
      } catch (error) {
        this.logger.warn('Failed to tokenize for Claude, using fallback');
      }
    }

    // For other models, use strategy-based estimation
    const strategy = this.getEstimationStrategy(model);

    switch (strategy) {
      case 'characters_per_token':
        // Most models: ~4 characters per token
        return Math.ceil(text.length / 4);

      case 'words_per_token':
        // Some models tokenize differently
        const words = text.split(/\s+/).filter((word) => word.length > 0);
        return Math.ceil(words.length / 0.75);

      case 'code_aware':
        // Code has different tokenization patterns
        return this.estimateCodeTokens(text);

      default:
        return Math.ceil(text.length / 4);
    }
  }

  /**
   * Check if model is an OpenAI model
   */
  private isOpenAIModel(model: string): boolean {
    return model.includes('gpt') || model.includes('openai');
  }

  /**
   * Check if model is an Anthropic model
   */
  private isAnthropicModel(model: string): boolean {
    return model.includes('claude') || model.includes('anthropic');
  }

  /**
   * Get estimation strategy based on model
   */
  private getEstimationStrategy(
    model?: string,
  ): 'characters_per_token' | 'words_per_token' | 'code_aware' | 'precise' {
    if (!model) return 'characters_per_token';

    // Code-focused models
    if (model.includes('codellama') || model.includes('starcoder')) {
      return 'code_aware';
    }

    // High-precision models
    if (model.includes('gpt-4') || model.includes('claude-3-opus')) {
      return 'precise';
    }

    // Default strategy
    return 'characters_per_token';
  }

  /**
   * Estimate tokens for code (more complex tokenization)
   */
  private estimateCodeTokens(code: string): number {
    // Code typically has more tokens per character due to keywords, symbols, etc.
    const lines = code.split('\n');
    let totalTokens = 0;

    for (const line of lines) {
      // Keywords and symbols add tokens
      const keywordMatches = line.match(
        /\b(function|class|if|for|while|return|import|export|const|let|var)\b/g,
      );
      const symbolMatches = line.match(/[{}();,.=+\-*/<>!&|[\]]/g);

      const baseTokens = Math.ceil(line.length / 3); // Code is more token-dense
      const keywordTokens = keywordMatches ? keywordMatches.length : 0;
      const symbolTokens = symbolMatches ? symbolMatches.length : 0;

      totalTokens += baseTokens + keywordTokens + symbolTokens;
    }

    return Math.ceil(totalTokens * 1.2); // Add 20% buffer
  }

  /**
   * Analyze token breakdown by content type using proper tokenization
   * Now uses gpt-tokenizer for accurate token counting with pattern-based classification
   */
  private analyzeTokenBreakdown(text: string): TokenCountResult['breakdown'] {
    // Use proper tokenizer to get actual token array
    let tokenArray: number[] = [];
    try {
      tokenArray = gptEncode(text);
    } catch (error) {
      this.logger.warn('Failed to tokenize text, using heuristic breakdown');
      return this.heuristicTokenBreakdown(text);
    }

    // Pattern-based classification with actual token positions
    const codePatterns = [
      /```[\s\S]*?```/g, // Code blocks
      /`[^`\n]+`/g, // Inline code
      /\b(function|class|const|let|var|import|export|async|await|try|catch|for|while|if|else|return|throw)\b\s+\w+/g,
      /\b\d+\.\d+|\b\d+\b/g, // Numbers
    ];

    const markupPatterns = [
      /^#{1,6}\s.*$/gm, // Headers
      /^>\s.*$/gm, // Blockquotes
      /\*\*[^*]+\*\*/g, // Bold
      /\*[^*]+\*/g, // Italic
      /_.*?_/g, // Underlined/italic
      /^[-*+]\s.*$/gm, // List items
      /^\d+\.\s.*$/gm, // Numbered lists
      /\[([^\]]+)\]\(([^)]+)\)/g, // Links
      /\|[^\n]*\|/g, // Tables
    ];

    // Calculate character positions for each pattern type
    const codeRanges = this.extractPatternRanges(text, codePatterns);
    const markupRanges = this.extractPatternRanges(text, markupPatterns);

    // Count tokens by type based on character positions
    let codeTokens = 0;
    let markupTokens = 0;
    let whitespaceTokens = 0;
    let textTokens = 0;

    // Tokenize by segments for accurate classification
    const segments = this.segmentTextByRanges(text, codeRanges, markupRanges);

    for (const segment of segments) {
      try {
        const segmentTokens = gptEncode(segment.text);
        const tokenCount = segmentTokens.length;

        switch (segment.type) {
          case 'code':
            codeTokens += tokenCount;
            break;
          case 'markup':
            markupTokens += tokenCount;
            break;
          case 'whitespace':
            whitespaceTokens += tokenCount;
            break;
          default:
            textTokens += tokenCount;
        }
      } catch (error) {
        // Fallback to character-based estimation for problematic segments
        const estimatedTokens = Math.ceil(segment.text.length / 4);
        textTokens += estimatedTokens;
      }
    }

    return {
      text: textTokens,
      code: codeTokens,
      markup: markupTokens,
      whitespace: whitespaceTokens,
    };
  }

  /**
   * Heuristic token breakdown fallback (when tokenizer fails)
   */
  private heuristicTokenBreakdown(text: string): TokenCountResult['breakdown'] {
    const codePatterns = [
      /```[\s\S]*?```/g,
      /`[^`\n]+`/g,
      /\b(function|class|const|let|var|import|export|async|await|try|catch|for|while|if|else|return|throw)\b\s+\w+/g,
      /\b\d+\.\d+|\b\d+\b/g,
    ];

    const markupPatterns = [
      /^#{1,6}\s.*$/gm,
      /^>\s.*$/gm,
      /\*\*[^*]+\*\*/g,
      /\*[^*]+\*/g,
      /_.*?_/g,
      /^[-*+]\s.*$/gm,
      /^\d+\.\s.*$/gm,
      /\[([^\]]+)\]\(([^)]+)\)/g,
      /\|[^\n]*\|/g,
    ];

    const whitespacePatterns = /\s+/g;

    let codeTokens = 0;
    let markupTokens = 0;

    // Calculate code tokens
    codePatterns.forEach((pattern) => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          codeTokens += Math.ceil(match.length / 2.5);
        });
      }
    });

    // Calculate markup tokens
    markupPatterns.forEach((pattern) => {
      const matches = text.match(pattern);
      if (matches) {
        matches.forEach((match) => {
          const complexity =
            match.includes('[') || match.includes('|') ? 1.5 : 1.0;
          markupTokens += Math.ceil((match.length / 3.5) * complexity);
        });
      }
    });

    // Calculate whitespace tokens
    const whitespaceMatches = text.match(whitespacePatterns);
    const whitespaceTokens = whitespaceMatches
      ? Math.ceil(whitespaceMatches.join('').length / 4)
      : 0;

    // Calculate remaining text tokens
    const specialContentLength =
      codePatterns.concat(markupPatterns).reduce((total, pattern) => {
        const matches = text.match(pattern);
        return (
          total +
          (matches ? matches.reduce((sum, match) => sum + match.length, 0) : 0)
        );
      }, 0) + (whitespaceMatches ? whitespaceMatches.join('').length : 0);

    const plainTextLength = text.length - specialContentLength;
    const textTokens = Math.max(0, Math.ceil(plainTextLength / 4));

    return {
      text: textTokens,
      code: codeTokens,
      markup: markupTokens,
      whitespace: whitespaceTokens,
    };
  }

  /**
   * Extract character ranges for pattern matches
   */
  private extractPatternRanges(
    text: string,
    patterns: RegExp[],
  ): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];

    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match.index !== undefined) {
          ranges.push({
            start: match.index,
            end: match.index + match[0].length,
          });
        }
      }
    }

    // Sort and merge overlapping ranges
    return this.mergeRanges(ranges);
  }

  /**
   * Merge overlapping ranges
   */
  private mergeRanges(
    ranges: Array<{ start: number; end: number }>,
  ): Array<{ start: number; end: number }> {
    if (ranges.length === 0) return [];

    ranges.sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [ranges[0]];

    for (let i = 1; i < ranges.length; i++) {
      const current = ranges[i];
      const last = merged[merged.length - 1];

      if (current.start <= last.end) {
        last.end = Math.max(last.end, current.end);
      } else {
        merged.push(current);
      }
    }

    return merged;
  }

  /**
   * Segment text by ranges into classified segments
   */
  private segmentTextByRanges(
    text: string,
    codeRanges: Array<{ start: number; end: number }>,
    markupRanges: Array<{ start: number; end: number }>,
  ): Array<{ text: string; type: 'code' | 'markup' | 'text' | 'whitespace' }> {
    const segments: Array<{
      text: string;
      type: 'code' | 'markup' | 'text' | 'whitespace';
      start: number;
      end: number;
    }> = [];

    // Add code segments
    for (const range of codeRanges) {
      segments.push({
        text: text.substring(range.start, range.end),
        type: 'code',
        start: range.start,
        end: range.end,
      });
    }

    // Add markup segments
    for (const range of markupRanges) {
      // Check if this range overlaps with code ranges
      const overlapsCode = codeRanges.some(
        (cr) =>
          (range.start >= cr.start && range.start < cr.end) ||
          (range.end > cr.start && range.end <= cr.end),
      );

      if (!overlapsCode) {
        segments.push({
          text: text.substring(range.start, range.end),
          type: 'markup',
          start: range.start,
          end: range.end,
        });
      }
    }

    // Sort segments by position
    segments.sort((a, b) => a.start - b.start);

    // Fill in gaps with text or whitespace
    const result: Array<{
      text: string;
      type: 'code' | 'markup' | 'text' | 'whitespace';
    }> = [];
    let lastEnd = 0;

    for (const segment of segments) {
      // Add gap before this segment
      if (segment.start > lastEnd) {
        const gapText = text.substring(lastEnd, segment.start);
        const isWhitespace = /^\s+$/.test(gapText);
        result.push({
          text: gapText,
          type: isWhitespace ? 'whitespace' : 'text',
        });
      }

      result.push({
        text: segment.text,
        type: segment.type,
      });

      lastEnd = segment.end;
    }

    // Add any remaining text
    if (lastEnd < text.length) {
      const remainingText = text.substring(lastEnd);
      const isWhitespace = /^\s+$/.test(remainingText);
      result.push({
        text: remainingText,
        type: isWhitespace ? 'whitespace' : 'text',
      });
    }

    return result;
  }

  /**
   * Preprocess text based on options
   */
  private preprocessText(
    text: string,
    preprocessing: TokenEstimationOptions['preprocessing'],
  ): string {
    let processed = text;

    if (preprocessing?.normalize) {
      // Normalize whitespace
      processed = processed.replace(/\s+/g, ' ').trim();
    }

    if (preprocessing?.stripMarkdown) {
      // Remove markdown formatting (simplified)
      processed = processed
        .replace(/#{1,6}\s.*$/gm, '') // Headers
        .replace(/\*\*([^*]+)\*\*/g, '$1') // Bold
        .replace(/\*([^*]+)\*/g, '$1') // Italic
        .replace(/`([^`]+)`/g, '$1') // Inline code
        .replace(/```[\s\S]*?```/g, '') // Code blocks
        .replace(/^\s*[-*+]\s/gm, '') // Lists
        .replace(/^\s*\d+\.\s/gm, ''); // Numbered lists
    }

    if (preprocessing?.truncate) {
      processed = processed.substring(0, preprocessing.truncate);
    }

    return processed;
  }

  /**
   * Add model-specific information to result
   */
  private addModelSpecificInfo(
    tokens: number,
    model: string,
  ): TokenCountResult['modelSpecific'] {
    const maxContextLength = this.MODEL_LIMITS[model] || 4096;
    const remainingTokens = Math.max(0, maxContextLength - tokens);
    const chunksNeeded = Math.ceil(tokens / maxContextLength);

    return {
      maxContextLength,
      remainingTokens,
      chunksNeeded,
    };
  }

  /**
   * Generate cache key
   */
  private generateCacheKey(
    text: string,
    options: TokenEstimationOptions,
  ): string {
    const hash = this.simpleHash(text.substring(0, 100) + text.length); // Simple hash of text prefix and length
    return `${hash}_${JSON.stringify(options)}`;
  }

  /**
   * Simple hash function for caching
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Cache a result
   */
  private cacheResult(key: string, result: TokenCountResult): void {
    if (this.tokenCache.size >= this.MAX_CACHE_SIZE) {
      // Simple LRU: remove oldest entries when cache is full
      const firstKey = this.tokenCache.keys().next().value;
      this.tokenCache.delete(firstKey);
    }
    this.tokenCache.set(key, { ...result });
  }

  /**
   * Create empty result
   */
  private createEmptyResult(): TokenCountResult {
    return {
      tokens: 0,
      breakdown: {
        text: 0,
        code: 0,
        markup: 0,
        whitespace: 0,
      },
      characters: 0,
      words: 0,
      lines: 0,
      estimatedReadingTime: 0,
    };
  }
}
