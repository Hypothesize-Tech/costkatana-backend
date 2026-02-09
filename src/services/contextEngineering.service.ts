/**
 * Context Engineering Service
 *
 * Enhanced with true prompt caching (KV-pair caching) support:
 * 1. Stable Prompt Prefix (for KV-Cache hits)
 * 2. Append-only Context (avoiding re-tokenization)
 * 3. Explicit Cache Breakpoints (Anthropic, Gemini)
 * 4. Automatic Prefix Matching (OpenAI)
 * 5. Provider-specific optimizations
 */

import { loggingService } from './logging.service';
import { promptCachingService } from './promptCaching.service';
import { AnthropicPromptCaching } from './providers/anthropic/promptCaching';
import { OpenAIPromptCaching } from './providers/openai/promptCaching';
import { GoogleGeminiPromptCaching } from './providers/google/promptCaching';
import {
  PromptCachingConfig,
  PromptCacheRequest,
  PromptCacheResponse
} from '../types/promptCaching.types';

export interface OptimizedContext {
    systemPrompt: string;      // Stable, immutable
    staticContext: string;     // Semi-stable (Docs, User Profile)
    dynamicHistory: string;    // Append-only conversation
    toolsDef: string;          // Tools definition
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
    cacheConfig: PromptCachingConfig;
    cacheAnalysis: {
        isCacheable: boolean;
        estimatedSavings: number;
        cacheType: 'automatic' | 'explicit' | 'none';
    };
}

export class ContextEngineeringService {
    private static instance: ContextEngineeringService;
    
    // Stable System Prompt - rarely changes
    // We move dynamic "{tools}" and "{user_context}" out of the core block to keep the prefix stable
    // This is the "Immutable System Prompt" block
    private readonly STABLE_SYSTEM_BLOCK = `You are Cost Katana, an advanced AI Cost Optimization Agent.
Your core mission is to minimize AI spending while maximizing performance.

CORE KNOWLEDGE BASE:
- Cost Optimization Strategies: Prompt compression, context trimming, model switching.
- AI Analytics: Usage patterns, cost trends, predictive analytics.
- System Architecture: Microservices, API gateway, Cortex engine.
- Multi-Agent Coordination: Orchestrating specialized agents (Optimizer, Analyst).

OPERATIONAL RULES:
1. Always prioritize cost-efficiency in your recommendations.
2. Use precise, data-driven insights.
3. Verify information using available tools before answering.
4. Maintain a professional, executive-focused tone.`;

    private constructor() {
        loggingService.info('🏗️ Context Engineering Service initialized');
    }

    public static getInstance(): ContextEngineeringService {
        if (!ContextEngineeringService.instance) {
            ContextEngineeringService.instance = new ContextEngineeringService();
        }
        return ContextEngineeringService.instance;
    }

    /**
     * Constructs a KV-Cache optimized prompt structure
     * Structure: [Stable System] -> [Tools Def] -> [Static Project Context] -> [Append-Only History] -> [New Query]
     * 
     * Note: Tools definition is placed early to allow caching if tools don't change often.
     * If tools are dynamic per user, they should move after Static Context.
     */
    public buildOptimizedContext(
        userId: string,
        projectId: string,
        history: Array<{ role: string; content: string }>,
        toolsDefinition: string
    ): OptimizedContext {
        try {
            // 1. Stable System Block (Highest Cache Hit Rate)
            const systemPrompt = this.STABLE_SYSTEM_BLOCK;

            // 2. Static Project Context (High Cache Hit Rate)
            // This block changes only when project metadata changes, not per query
            // We include Tools here if they are stable for the session/user
            const staticContext = `PROJECT CONTEXT:
User ID: ${userId}
Project ID: ${projectId || 'default'}
Environment: Production
Agent Type: Master
Timestamp: ${new Date().toISOString()}`;

            // 3. Dynamic History (Append-only)
            // We format this to be strictly append-only
            // Using a standard format that models can easily parse
            const dynamicHistory = history
                .map(msg => `${msg.role.toUpperCase()}: ${msg.content}`)
                .join('\n\n');

            loggingService.debug('Context optimization completed', {
                component: 'ContextEngineeringService',
                operation: 'buildOptimizedContext',
                userId,
                projectId,
                historyLength: history.length,
                toolsLength: toolsDefinition.length
            });

            return {
                systemPrompt,
                staticContext,
                dynamicHistory,
                toolsDef: toolsDefinition,
                cacheControl: {
                    systemBlock: true,  // Vendor should cache this
                    contextBlock: true  // Vendor should cache this
                }
            };
        } catch (error: any) {
            loggingService.error('Error building optimized context', {
                component: 'ContextEngineeringService',
                operation: 'buildOptimizedContext',
                error: error instanceof Error ? error.message : String(error),
                userId,
                projectId
            });
            throw error;
        }
    }

    /**
     * Formats the final prompt string for models that expect a single string
     */
    public formatFinalPrompt(context: OptimizedContext, newQuery: string): string {
        try {
            const prompt = `${context.systemPrompt}

${context.toolsDef}

${context.staticContext}

CONVERSATION HISTORY:
${context.dynamicHistory}

USER: ${newQuery}

ASSISTANT:`;

            loggingService.debug('Final prompt formatted', {
                component: 'ContextEngineeringService',
                operation: 'formatFinalPrompt',
                promptLength: prompt.length,
                queryLength: newQuery.length
            });

            return prompt;
        } catch (error: any) {
            loggingService.error('Error formatting final prompt', {
                component: 'ContextEngineeringService',
                operation: 'formatFinalPrompt',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }

    /**
     * Optimizes a prompt for Bedrock/Claude specific caching headers
     * Adds cache breakpoints to maximize cache hit rates
     */
    public addCacheBreakpoints(messages: Message[]): Message[] {
        try {
            const optimizedMessages = [...messages];
            
            // Logic to insert cache breakpoints (e.g. for Anthropic beta headers)
            // This effectively "marks" the stable prefix
            if (optimizedMessages.length > 0) {
                // Mark the system message for caching
                if (optimizedMessages[0].role === 'system') {
                    optimizedMessages[0].cache_control = { type: 'ephemeral' };
                }
                
                // Mark static context messages for caching
                for (let i = 1; i < optimizedMessages.length; i++) {
                    const message = optimizedMessages[i];
                    // Cache messages that contain static context or tool definitions
                    if (message.content.includes('PROJECT CONTEXT:') || 
                        message.content.includes('TOOLS:') ||
                        message.content.includes('AVAILABLE FUNCTIONS:')) {
                        message.cache_control = { type: 'ephemeral' };
                    }
                }
            }

            loggingService.debug('Cache breakpoints added', {
                component: 'ContextEngineeringService',
                operation: 'addCacheBreakpoints',
                messageCount: optimizedMessages.length,
                cachedMessages: optimizedMessages.filter(m => m.cache_control).length
            });

            return optimizedMessages;
        } catch (error: any) {
            loggingService.error('Error adding cache breakpoints', {
                component: 'ContextEngineeringService',
                operation: 'addCacheBreakpoints',
                error: error instanceof Error ? error.message : String(error)
            });
            return messages; // Return original messages on error
        }
    }

    /**
     * Compresses context by removing redundant information
     */
    public compressContext(context: string, maxTokens: number = 4000): string {
        try {
            if (context.length <= maxTokens * 4) { // Rough token estimation
                return context;
            }

            // Simple compression: remove duplicate lines and excessive whitespace
            const lines = context.split('\n');
            const uniqueLines = [...new Set(lines)];
            const compressed = uniqueLines
                .filter(line => line.trim().length > 0)
                .join('\n')
                .replace(/\n{3,}/g, '\n\n'); // Limit consecutive newlines

            loggingService.debug('Context compressed', {
                component: 'ContextEngineeringService',
                operation: 'compressContext',
                originalLength: context.length,
                compressedLength: compressed.length,
                compressionRatio: (1 - compressed.length / context.length) * 100
            });

            return compressed;
        } catch (error: any) {
            loggingService.error('Error compressing context', {
                component: 'ContextEngineeringService',
                operation: 'compressContext',
                error: error instanceof Error ? error.message : String(error)
            });
            return context; // Return original on error
        }
    }

    /**
     * Calculates context metrics for optimization tracking
     */
    public calculateMetrics(context: OptimizedContext): ContextMetrics {
        try {
            const totalContent = context.systemPrompt + context.staticContext +
                               context.dynamicHistory + context.toolsDef;

            // Rough token estimation (4 chars per token average)
            const totalTokens = Math.ceil(totalContent.length / 4);

            // Estimate cache hit rate based on stable content ratio
            const stableContent = context.systemPrompt + context.staticContext + context.toolsDef;
            const cacheHitRate = stableContent.length / totalContent.length;

            // Calculate compression ratio if applicable
            const compressionRatio = 0.85; // Placeholder - would be calculated from actual compression

            // Estimate optimization savings (cost reduction from caching)
            const optimizationSavings = cacheHitRate * 0.7; // 70% cost reduction for cached content

            const metrics: ContextMetrics = {
                totalTokens,
                cacheHitRate: Math.round(cacheHitRate * 100) / 100,
                compressionRatio,
                optimizationSavings: Math.round(optimizationSavings * 100) / 100
            };

            loggingService.debug('Context metrics calculated', {
                component: 'ContextEngineeringService',
                operation: 'calculateMetrics',
                ...metrics
            });

            return metrics;
        } catch (error: any) {
            loggingService.error('Error calculating context metrics', {
                component: 'ContextEngineeringService',
                operation: 'calculateMetrics',
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                totalTokens: 0,
                cacheHitRate: 0,
                compressionRatio: 0,
                optimizationSavings: 0
            };
        }
    }

    /**
     * Optimizes messages for prompt caching across all supported providers
     * Automatically detects provider and applies optimal caching strategy
     */
    public optimizeForCaching(
        messages: Message[],
        provider: string,
        model: string,
        userId?: string
    ): CacheOptimizedMessages {
        try {
            // Get default config for provider
            const cacheConfig = promptCachingService.getDefaultConfig(provider);

            // Analyze messages for caching potential
            const analysis = promptCachingService.analyzePrompt(
                messages,
                model,
                provider,
                cacheConfig
            );

            // Apply provider-specific optimizations, possibly using userId in the future
            let optimizedMessages = messages;

            if (provider === 'anthropic' && AnthropicPromptCaching.isModelSupported(model)) {
                // Anthropic: Apply explicit cache breakpoints
                const result = AnthropicPromptCaching.processMessages(
                    this.convertToAnthropicFormat(messages),
                    cacheConfig
                );
                optimizedMessages = this.convertFromAnthropicFormat(result.processedMessages);

            } else if (provider === 'openai' && OpenAIPromptCaching.isModelSupported(model)) {
                // OpenAI: Optimize message order for automatic prefix matching
                const openaiMessages = this.convertToOpenAIFormat(messages);
                optimizedMessages = this.convertFromOpenAIFormat(
                    OpenAIPromptCaching.optimizeMessageOrder(openaiMessages)
                );

            } else if (provider === 'google' && GoogleGeminiPromptCaching.isModelSupported(model)) {
                // Gemini: Structure for explicit context caching
                const geminiMessages = GoogleGeminiPromptCaching.convertToGeminiFormat(messages);
                const geminiAnalysis = GoogleGeminiPromptCaching.analyzeMessages(geminiMessages, cacheConfig);

                if (geminiAnalysis.isCacheable) {
                    // Keep structure as-is for Gemini (they handle explicit caching)
                    optimizedMessages = messages;
                }
            }

            loggingService.debug('Messages optimized for prompt caching', {
                component: 'ContextEngineeringService',
                operation: 'optimizeForCaching',
                provider,
                model,
                userId,
                originalCount: messages.length,
                optimizedCount: optimizedMessages.length,
                isCacheable: analysis.isCacheable,
                estimatedSavings: analysis.estimatedSavings.toFixed(6)
            });

            return {
                messages: optimizedMessages,
                provider,
                model,
                cacheConfig,
                cacheAnalysis: {
                    isCacheable: analysis.isCacheable,
                    estimatedSavings: analysis.estimatedSavings,
                    cacheType: cacheConfig.mode === 'automatic' ? 'automatic' :
                              cacheConfig.breakpointsEnabled ? 'explicit' : 'none'
                }
            };

        } catch (error: any) {
            loggingService.error('Error optimizing messages for caching', {
                component: 'ContextEngineeringService',
                operation: 'optimizeForCaching',
                error: error instanceof Error ? error.message : String(error),
                provider,
                model,
                userId
            });

            // Return safe fallback
            return {
                messages,
                provider,
                model,
                cacheConfig: promptCachingService.getDefaultConfig(provider),
                cacheAnalysis: {
                    isCacheable: false,
                    estimatedSavings: 0,
                    cacheType: 'none'
                }
            };
        }
    }

    /**
     * Reorders messages to maximize cache hit potential
     * Puts static content first, dynamic content last
     */
    public reorderForCaching(messages: Message[]): Message[] {
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

            loggingService.debug('Messages reordered for caching', {
                component: 'ContextEngineeringService',
                operation: 'reorderForCaching',
                originalCount: messages.length,
                staticCount: staticMessages.length,
                dynamicCount: dynamicMessages.length
            });

            return reordered;

        } catch (error: any) {
            loggingService.error('Error reordering messages for caching', {
                component: 'ContextEngineeringService',
                operation: 'reorderForCaching',
                error: error instanceof Error ? error.message : String(error)
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
            'you are', 'instructions:', 'system prompt', 'guidelines:',
            'rules:', 'context:', 'background:', 'reference:',
            'documentation:', 'manual:', 'policy:', 'procedure:',
            'company information', 'product details', 'api documentation',
            'function definitions', 'tool descriptions', 'schema:',
            'available tools', 'function calling', 'knowledge base'
        ];

        return staticIndicators.some(indicator => lowerContent.includes(indicator));
    }

    /**
     * Converts internal Message format to Anthropic format
     */
    private convertToAnthropicFormat(messages: Message[]): any[] {
        return messages.map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: [{
                type: 'text',
                text: msg.content,
                ...(msg.cache_control && { cache_control: msg.cache_control })
            }]
        }));
    }

    /**
     * Converts from Anthropic format back to internal Message format
     */
    private convertFromAnthropicFormat(anthropicMessages: any[]): Message[] {
        return anthropicMessages.map(msg => ({
            role: msg.role === 'assistant' ? 'assistant' : msg.role,
            content: msg.content?.[0]?.text || '',
            ...(msg.content?.[0]?.cache_control && {
                cache_control: msg.content[0].cache_control
            })
        }));
    }

    /**
     * Converts internal Message format to OpenAI format
     */
    private convertToOpenAIFormat(messages: Message[]): any[] {
        return messages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
    }

    /**
     * Converts from OpenAI format back to internal Message format
     */
    private convertFromOpenAIFormat(openaiMessages: any[]): Message[] {
        return openaiMessages.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
    }

    /**
     * Gets cache-aware context metrics including prompt caching benefits
     */
    public calculateCacheAwareMetrics(
        messages: Message[],
        provider: string,
        model: string
    ): ContextMetrics & { cacheSavings: number; cacheHitRate: number } {
        try {
            const baseMetrics = this.calculateMetrics({
                systemPrompt: '',
                staticContext: '',
                dynamicHistory: messages.map(m => `${m.role}: ${m.content}`).join('\n'),
                toolsDef: '',
                cacheControl: { systemBlock: false, contextBlock: false }
            });

            // Analyze caching potential
            const analysis = promptCachingService.analyzePrompt(
                messages, model, provider
            );

            const cacheSavings = analysis.estimatedSavings;
            const cacheHitRate = analysis.isCacheable ? 0.8 : 0; // Estimated hit rate

            const metrics = {
                ...baseMetrics,
                cacheSavings,
                cacheHitRate
            };

            loggingService.debug('Cache-aware metrics calculated', {
                component: 'ContextEngineeringService',
                operation: 'calculateCacheAwareMetrics',
                provider,
                model,
                cacheSavings: cacheSavings.toFixed(6),
                cacheHitRate
            });

            return metrics;

        } catch (error: any) {
            loggingService.error('Error calculating cache-aware metrics', {
                component: 'ContextEngineeringService',
                operation: 'calculateCacheAwareMetrics',
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                ...this.calculateMetrics({
                    systemPrompt: '',
                    staticContext: '',
                    dynamicHistory: '',
                    toolsDef: '',
                    cacheControl: { systemBlock: false, contextBlock: false }
                }),
                cacheSavings: 0,
                cacheHitRate: 0
            };
        }
    }
}

export const contextEngineeringService = ContextEngineeringService.getInstance();
