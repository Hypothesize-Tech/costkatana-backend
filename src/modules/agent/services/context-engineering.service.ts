import { Injectable, Logger } from '@nestjs/common';

export interface OptimizedContext {
  systemPrompt: string; // Stable, immutable
  staticContext: string; // Semi-stable (Docs, User Profile)
  dynamicHistory: string; // Append-only conversation
  toolsDef: string; // Tools definition
  cacheControl: {
    systemBlock: boolean;
    contextBlock: boolean;
  };
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  cache_control?: {
    type: 'ephemeral';
  };
}

export interface ContextMetrics {
  totalTokens: number;
  cacheHitRate: number;
  compressionRatio: number;
  optimizationSavings: number;
}

export interface CacheOptimizedMessages {
  messages: Message[];
  provider: string;
  model: string;
  cacheConfig: any;
  cacheAnalysis: {
    isCacheable: boolean;
    estimatedSavings: number;
    cacheType: 'automatic' | 'explicit' | 'none';
  };
}

/**
 * Context Engineering Service
 * Optimized prompt caching and context management for AI agents
 * Ported from Express ContextEngineeringService with NestJS patterns
 */
@Injectable()
export class ContextEngineeringService {
  private readonly logger = new Logger(ContextEngineeringService.name);

  // Stable System Prompt - rarely changes
  // This is the "Immutable System Prompt" block for KV-cache optimization
  private readonly STABLE_SYSTEM_BLOCK = `You are Cost Katana, an advanced AI Cost Optimization Agent.
Your core mission is to minimize AI spending while maximizing performance.

CORE KNOWLEDGE BASE:
- Cost Optimization Strategies: Prompt compression, context trimming, model switching.
- AI Analytics: Usage patterns, cost trends, predictive analytics.
- System Architecture: Microservices, API gateway, Cortex engine.
- Multi-Agent Coordination: Orchestrating specialized agents (Optimizer, Analyst).
- Security & Compliance: Authentication, authorization, data protection.
- Integration APIs: Vercel, AWS, MongoDB, external service connections.

OPERATIONAL RULES:
1. Always prioritize cost-efficiency in your recommendations.
2. Use precise, data-driven insights.
3. Verify information using available tools before answering.
4. Maintain a professional, executive-focused tone.`;

  /**
   * Constructs a KV-Cache optimized prompt structure
   * Structure: [Stable System] -> [Tools Def] -> [Static Project Context] -> [Append-Only History] -> [New Query]
   */
  buildOptimizedContext(
    userId: string,
    projectId: string,
    history: Array<{ role: string; content: string }>,
    toolsDefinition: string,
  ): OptimizedContext {
    try {
      // 1. Stable System Block (Highest Cache Hit Rate)
      const systemPrompt = this.STABLE_SYSTEM_BLOCK;

      // 2. Static Project Context (High Cache Hit Rate)
      // This block changes only when project metadata changes, not per query
      const staticContext = `PROJECT CONTEXT:
User ID: ${userId}
Project ID: ${projectId || 'default'}
Environment: Production
Agent Type: Master
Timestamp: ${new Date().toISOString()}`;

      // 3. Dynamic History (Append-only)
      // Using a standard format that models can easily parse
      const dynamicHistory = history
        .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join('\n\n');

      this.logger.debug('Context optimization completed', {
        userId,
        projectId,
        historyLength: history.length,
        toolsLength: toolsDefinition.length,
      });

      return {
        systemPrompt,
        staticContext,
        dynamicHistory,
        toolsDef: toolsDefinition,
        cacheControl: {
          systemBlock: true, // Vendor should cache this
          contextBlock: true, // Vendor should cache this
        },
      };
    } catch (error: any) {
      this.logger.error('Error building optimized context', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        projectId,
      });
      throw error;
    }
  }

  /**
   * Formats the final prompt string for models that expect a single string
   */
  formatFinalPrompt(context: OptimizedContext, newQuery: string): string {
    try {
      const prompt = `${context.systemPrompt}

${context.toolsDef}

${context.staticContext}

CONVERSATION HISTORY:
${context.dynamicHistory}

USER: ${newQuery}

ASSISTANT:`;

      this.logger.debug('Final prompt formatted', {
        promptLength: prompt.length,
        queryLength: newQuery.length,
      });

      return prompt;
    } catch (error: any) {
      this.logger.error('Error formatting final prompt', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Optimizes a prompt for Bedrock/Claude specific caching headers
   * Adds cache breakpoints to maximize cache hit rates
   */
  addCacheBreakpoints(messages: Message[]): Message[] {
    try {
      const optimizedMessages = [...messages];

      // Logic to insert cache breakpoints
      if (optimizedMessages.length > 0) {
        // Mark the system message for caching
        if (optimizedMessages[0].role === 'system') {
          optimizedMessages[0].cache_control = { type: 'ephemeral' };
        }

        // Mark static context messages for caching
        for (let i = 1; i < optimizedMessages.length; i++) {
          const message = optimizedMessages[i];
          // Cache messages that contain static context or tool definitions
          if (
            message.content.includes('PROJECT CONTEXT:') ||
            message.content.includes('TOOLS:') ||
            message.content.includes('AVAILABLE FUNCTIONS:')
          ) {
            message.cache_control = { type: 'ephemeral' };
          }
        }
      }

      this.logger.debug('Cache breakpoints added', {
        messageCount: optimizedMessages.length,
        cachedMessages: optimizedMessages.filter((m) => m.cache_control).length,
      });

      return optimizedMessages;
    } catch (error: any) {
      this.logger.error('Error adding cache breakpoints', {
        error: error instanceof Error ? error.message : String(error),
      });
      return messages; // Return original messages on error
    }
  }

  /**
   * Compresses context by removing redundant information
   */
  compressContext(context: string, maxTokens: number = 4000): string {
    try {
      if (context.length <= maxTokens * 4) {
        // Rough token estimation
        return context;
      }

      // Simple compression: remove duplicate lines and excessive whitespace
      const lines = context.split('\n');
      const uniqueLines = [...new Set(lines)];
      const compressed = uniqueLines
        .filter((line) => line.trim().length > 0)
        .join('\n')
        .replace(/\n{3,}/g, '\n\n'); // Limit consecutive newlines

      this.logger.debug('Context compressed', {
        originalLength: context.length,
        compressedLength: compressed.length,
        compressionRatio: (1 - compressed.length / context.length) * 100,
      });

      return compressed;
    } catch (error: any) {
      this.logger.error('Error compressing context', {
        error: error instanceof Error ? error.message : String(error),
      });
      return context; // Return original on error
    }
  }

  /**
   * Calculates context metrics for optimization tracking
   */
  calculateMetrics(context: OptimizedContext): ContextMetrics {
    try {
      const totalContent =
        context.systemPrompt +
        context.staticContext +
        context.dynamicHistory +
        context.toolsDef;

      // Rough token estimation (4 chars per token average)
      const totalTokens = Math.ceil(totalContent.length / 4);

      // Estimate cache hit rate based on stable content ratio
      const stableContent =
        context.systemPrompt + context.staticContext + context.toolsDef;
      const cacheHitRate = stableContent.length / totalContent.length;

      // Calculate compression ratio from actual compression
      const originalLength = totalContent.length;
      const compressedContent = this.compressContext(totalContent);
      const compressionRatio = compressedContent.length / originalLength;

      // Estimate optimization savings (cost reduction from caching)
      const optimizationSavings = cacheHitRate * 0.7; // 70% cost reduction for cached content

      const metrics: ContextMetrics = {
        totalTokens,
        cacheHitRate: Math.round(cacheHitRate * 100) / 100,
        compressionRatio,
        optimizationSavings: Math.round(optimizationSavings * 100) / 100,
      };

      this.logger.debug('Context metrics calculated', metrics);

      return metrics;
    } catch (error: any) {
      this.logger.error('Error calculating context metrics', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        totalTokens: 0,
        cacheHitRate: 0,
        compressionRatio: 0,
        optimizationSavings: 0,
      };
    }
  }

  /**
   * Optimizes messages for prompt caching
   * Simplified version - full provider-specific optimizations can be added later
   */
  optimizeForCaching(
    messages: Message[],
    provider: string,
    model: string,
    userId?: string,
  ): CacheOptimizedMessages {
    try {
      // Basic analysis for caching potential
      const isCacheable = this.isMessageCacheable(messages);
      const estimatedSavings = isCacheable ? 0.3 : 0; // 30% estimated savings

      let optimizedMessages = messages;

      // Apply basic cache breakpoints for supported providers
      if (provider === 'anthropic') {
        optimizedMessages = this.addCacheBreakpoints(messages);
      }

      this.logger.debug('Messages optimized for prompt caching', {
        provider,
        model,
        userId,
        originalCount: messages.length,
        optimizedCount: optimizedMessages.length,
        isCacheable,
        estimatedSavings,
      });

      return {
        messages: optimizedMessages,
        provider,
        model,
        cacheConfig: { mode: 'basic' },
        cacheAnalysis: {
          isCacheable,
          estimatedSavings,
          cacheType: isCacheable ? 'explicit' : 'none',
        },
      };
    } catch (error: any) {
      this.logger.error('Error optimizing messages for caching', {
        error: error instanceof Error ? error.message : String(error),
        provider,
        model,
        userId,
      });

      // Return safe fallback
      return {
        messages,
        provider,
        model,
        cacheConfig: { mode: 'basic' },
        cacheAnalysis: {
          isCacheable: false,
          estimatedSavings: 0,
          cacheType: 'none',
        },
      };
    }
  }

  /**
   * Reorders messages to maximize cache hit potential
   * Puts static content first, dynamic content last
   */
  reorderForCaching(messages: Message[]): Message[] {
    try {
      const staticMessages: Message[] = [];
      const dynamicMessages: Message[] = [];

      for (const message of messages) {
        if (this.isMessageStatic(message)) {
          staticMessages.push(message);
        } else {
          dynamicMessages.push(message);
        }
      }

      const reordered = [...staticMessages, ...dynamicMessages];

      this.logger.debug('Messages reordered for caching', {
        originalCount: messages.length,
        staticCount: staticMessages.length,
        dynamicCount: dynamicMessages.length,
      });

      return reordered;
    } catch (error: any) {
      this.logger.error('Error reordering messages for caching', {
        error: error instanceof Error ? error.message : String(error),
      });
      return messages; // Return original on error
    }
  }

  /**
   * Determines if a message contains static/cacheable content
   */
  private isMessageStatic(message: Message): boolean {
    if (!message.content) return false;

    const lowerContent = message.content.toLowerCase();

    // System messages are typically static
    if (message.role === 'system') return true;

    // Check for static content indicators
    const staticIndicators = [
      'you are',
      'instructions:',
      'system prompt',
      'guidelines:',
      'rules:',
      'context:',
      'background:',
      'reference:',
      'documentation:',
      'manual:',
      'policy:',
      'procedure:',
      'company information',
      'product details',
      'api documentation',
      'function definitions',
      'tool descriptions',
      'schema:',
      'available tools',
      'function calling',
      'knowledge base',
    ];

    return staticIndicators.some((indicator) =>
      lowerContent.includes(indicator),
    );
  }

  /**
   * Determines if messages can be cached
   */
  private isMessageCacheable(messages: Message[]): boolean {
    if (messages.length === 0) return false;

    // Check if there's substantial static content
    const staticContent = messages.filter((m) => this.isMessageStatic(m));
    const staticRatio = staticContent.length / messages.length;

    return staticRatio > 0.5; // More than 50% static content
  }

  /**
   * Gets cache-aware context metrics
   */
  calculateCacheAwareMetrics(
    messages: Message[],
    provider: string,
    model: string,
  ): ContextMetrics & { cacheSavings: number; cacheHitRate: number } {
    try {
      const baseMetrics = this.calculateMetrics({
        systemPrompt: '',
        staticContext: '',
        dynamicHistory: messages
          .map((m) => `${m.role}: ${m.content}`)
          .join('\n'),
        toolsDef: '',
        cacheControl: { systemBlock: false, contextBlock: false },
      });

      const isCacheable = this.isMessageCacheable(messages);
      const cacheSavings = isCacheable ? 0.3 : 0; // Estimated savings
      const cacheHitRate = isCacheable ? 0.8 : 0; // Estimated hit rate

      const metrics = {
        ...baseMetrics,
        cacheSavings,
        cacheHitRate,
      };

      this.logger.debug('Cache-aware metrics calculated', {
        provider,
        model,
        cacheSavings,
        cacheHitRate,
      });

      return metrics;
    } catch (error: any) {
      this.logger.error('Error calculating cache-aware metrics', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        ...this.calculateMetrics({
          systemPrompt: '',
          staticContext: '',
          dynamicHistory: '',
          toolsDef: '',
          cacheControl: { systemBlock: false, contextBlock: false },
        }),
        cacheSavings: 0,
        cacheHitRate: 0,
      };
    }
  }
}
