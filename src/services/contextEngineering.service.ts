/**
 * Context Engineering Service
 * 
 * 
 * 1. Stable Prompt Prefix (for KV-Cache hits)
 * 2. Append-only Context (avoiding re-tokenization)
 * 3. Explicit Cache Breakpoints
 * 4. Constrained Decoding support
 */

import { loggingService } from './logging.service';

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
}

export const contextEngineeringService = ContextEngineeringService.getInstance();
