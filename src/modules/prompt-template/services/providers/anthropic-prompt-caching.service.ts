/**
 * Anthropic Prompt Caching Service
 *
 * Handles Anthropic-specific prompt caching implementation using cache_control.
 * Supports ephemeral caching for system messages, tools, and context.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface AnthropicCacheControl {
  type: 'ephemeral';
}

export interface AnthropicMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | AnthropicMessageContent[];
  cache_control?: AnthropicCacheControl;
}

export interface AnthropicMessageContent {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  cache_control?: AnthropicCacheControl;
  [key: string]: any;
}

export interface AnthropicCacheBreakpoint {
  position: number;
  type: 'system' | 'tools' | 'documents' | 'context';
  tokens: number;
}

@Injectable()
export class AnthropicPromptCachingService {
  private readonly logger = new Logger(AnthropicPromptCachingService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Apply Anthropic-specific caching to messages
   */
  applyCaching(
    messages: any[],
    breakpoints: AnthropicCacheBreakpoint[],
  ): AnthropicMessage[] {
    const cachedMessages: AnthropicMessage[] = [...messages];

    for (const breakpoint of breakpoints) {
      const message = cachedMessages[breakpoint.position];
      if (!message) continue;

      // Apply cache control based on message structure
      if (this.isTextMessage(message)) {
        this.applyTextCaching(message);
      } else if (this.isStructuredMessage(message)) {
        this.applyStructuredCaching(message);
      }
    }

    return cachedMessages;
  }

  /**
   * Check if message is a simple text message
   */
  private isTextMessage(message: any): boolean {
    return typeof message.content === 'string';
  }

  /**
   * Check if message has structured content array
   */
  private isStructuredMessage(message: any): boolean {
    return Array.isArray(message.content);
  }

  /**
   * Apply caching to simple text messages
   */
  private applyTextCaching(message: AnthropicMessage): void {
    if (typeof message.content !== 'string') return;

    // Convert to structured format with cache control
    message.content = [
      {
        type: 'text',
        text: message.content,
        cache_control: { type: 'ephemeral' },
      },
    ];
  }

  /**
   * Apply caching to structured messages (with content arrays)
   */
  private applyStructuredCaching(message: AnthropicMessage): void {
    if (!Array.isArray(message.content)) return;

    // Add cache control to the last text content block
    for (let i = message.content.length - 1; i >= 0; i--) {
      const contentBlock = message.content[i];
      if (contentBlock.type === 'text') {
        contentBlock.cache_control = { type: 'ephemeral' };
        break; // Only cache the last text block
      }
    }
  }

  /**
   * Analyze messages for Anthropic-specific caching opportunities
   */
  analyzeForCaching(messages: any[]): {
    breakpoints: AnthropicCacheBreakpoint[];
    totalCacheableTokens: number;
    recommendedStructure: boolean;
  } {
    const breakpoints: AnthropicCacheBreakpoint[] = [];
    let totalCacheableTokens = 0;
    let needsRestructuring = false;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      const analysis = this.analyzeMessageForCaching(message, i);

      if (analysis.canCache) {
        breakpoints.push({
          position: i,
          type: analysis.type,
          tokens: analysis.tokens,
        });
        totalCacheableTokens += analysis.tokens;

        // Limit to Anthropic's maximum breakpoints (4)
        if (breakpoints.length >= 4) {
          break;
        }
      }
    }

    // Check if messages need restructuring for optimal caching
    if (breakpoints.length > 0) {
      needsRestructuring = this.needsRestructuring(messages, breakpoints);
    }

    return {
      breakpoints,
      totalCacheableTokens,
      recommendedStructure: needsRestructuring,
    };
  }

  /**
   * Analyze individual message for caching potential
   */
  private analyzeMessageForCaching(
    message: any,
    position: number,
  ): {
    canCache: boolean;
    type: 'system' | 'tools' | 'documents' | 'context';
    tokens: number;
  } {
    const content = this.extractMessageContent(message);
    if (!content) {
      return { canCache: false, type: 'context', tokens: 0 };
    }

    const tokens = this.estimateTokens(content);
    const lowerContent = content.toLowerCase();

    // System messages are always cacheable
    if (message.role === 'system') {
      return { canCache: tokens >= 1024, type: 'system', tokens };
    }

    // Check for tool definitions
    if (this.containsToolDefinitions(lowerContent)) {
      return { canCache: tokens >= 1024, type: 'tools', tokens };
    }

    // Check for document/context content
    if (this.containsDocumentContent(lowerContent)) {
      return { canCache: tokens >= 1024, type: 'documents', tokens };
    }

    // Check for static context (instructions, guidelines, etc.)
    if (this.containsStaticContext(lowerContent)) {
      return { canCache: tokens >= 1024, type: 'context', tokens };
    }

    return { canCache: false, type: 'context', tokens };
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
        .map((block: any) => block.text)
        .join(' ');
    }

    return '';
  }

  /**
   * Estimate token count for content
   */
  private estimateTokens(content: string): number {
    // Rough estimation: ~4 characters per token for English text
    return Math.ceil(content.length / 4);
  }

  /**
   * Check if content contains tool definitions
   */
  private containsToolDefinitions(content: string): boolean {
    const toolIndicators = [
      'function',
      'tool',
      'api',
      'endpoint',
      'method',
      'parameters',
      'schema',
      'definition',
    ];
    return toolIndicators.some((indicator) => content.includes(indicator));
  }

  /**
   * Check if content contains document/information content
   */
  private containsDocumentContent(content: string): boolean {
    const docIndicators = [
      'document',
      'manual',
      'guide',
      'reference',
      'information',
      'data',
      'content',
      'knowledge',
      'documentation',
    ];
    return docIndicators.some((indicator) => content.includes(indicator));
  }

  /**
   * Check if content contains static context/instructions
   */
  private containsStaticContext(content: string): boolean {
    const contextIndicators = [
      'you are',
      'your role is',
      'instructions:',
      'system prompt',
      'always respond',
      'you must',
      'guidelines:',
      'rules:',
      'context:',
      'background:',
      'company policy',
      'manual:',
      'documentation:',
      'reference:',
      'knowledge base',
    ];
    return contextIndicators.some((indicator) => content.includes(indicator));
  }

  /**
   * Check if messages need restructuring for optimal caching
   */
  private needsRestructuring(
    messages: any[],
    breakpoints: AnthropicCacheBreakpoint[],
  ): boolean {
    // If we have multiple breakpoints, check if they're optimally positioned
    if (breakpoints.length < 2) return false;

    // Check if breakpoints are at the beginning of the conversation
    const positions = breakpoints.map((bp) => bp.position);
    const maxPosition = Math.max(...positions);

    // If breakpoints are spread throughout the conversation, restructuring might help
    return maxPosition > messages.length * 0.7; // Breakpoints in last 30% of messages
  }

  /**
   * Restructure messages for optimal caching
   */
  restructureForCaching(messages: any[]): any[] {
    const cacheableMessages: any[] = [];
    const dynamicMessages: any[] = [];

    // Separate cacheable from dynamic content
    for (const message of messages) {
      const analysis = this.analyzeMessageForCaching(message, 0);
      if (analysis.canCache) {
        cacheableMessages.push(message);
      } else {
        dynamicMessages.push(message);
      }
    }

    // Return cacheable messages first, then dynamic
    return [...cacheableMessages, ...dynamicMessages];
  }

  /**
   * Get caching statistics for monitoring
   */
  getCachingStats(): {
    supported: boolean;
    minTokens: number;
    maxBreakpoints: number;
    cacheTypes: string[];
  } {
    return {
      supported: true,
      minTokens: 1024,
      maxBreakpoints: 4,
      cacheTypes: ['ephemeral'],
    };
  }

  /**
   * Validate Anthropic caching configuration
   */
  validateCachingConfig(config: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (config.minTokens && config.minTokens < 1024) {
      errors.push('Anthropic requires minimum 1024 tokens for caching');
    }

    if (config.maxBreakpoints && config.maxBreakpoints > 4) {
      errors.push('Anthropic supports maximum 4 cache breakpoints');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
