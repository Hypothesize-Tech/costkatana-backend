/**
 * Web Scraper Handler
 * Handles web search and scraping using Google Custom Search API
 */

import { HandlerRequest, HandlerResult } from './types/handler.types';
import { ConversationContext } from '../context';
import { loggingService } from '@services/logging.service';
import { ChatBedrockConverse } from '@langchain/aws';

export class WebScraperHandler {
    /**
     * Handle web scraper route
     */
    static async handle(
        request: HandlerRequest,
        context: ConversationContext,
        contextPreamble: string,
        recentMessages: any[]
    ): Promise<HandlerResult & { webSearchUsed?: boolean; quotaUsed?: number }> {
        
        loggingService.info('🌐 Routing to web scraper', {
            subject: context.currentSubject,
            domain: context.lastDomain,
            useWebSearch: request.useWebSearch,
            contextPreamble: contextPreamble.substring(0, 100) + '...',
            recentMessagesCount: recentMessages.length
        });
        
        try {
            const { WebSearchTool } = await import('../../../tools/webSearch.tool');
            const { googleSearchService } = await import('../../googleSearch.service');
            
            // Enhance query with context if available
            let enhancedQuery = request.message ?? '';
            if (contextPreamble && contextPreamble.trim()) {
                enhancedQuery = `${contextPreamble.trim()}\n\nQuery: ${enhancedQuery}`;
            }
            
            // Consider recent messages for context
            if (recentMessages && recentMessages.length > 0) {
                const recentContext = recentMessages
                    .slice(-2) // Last 2 messages for context
                    .map((msg: any) => msg.content || msg.message)
                    .filter(Boolean)
                    .join(' ');
                
                if (recentContext) {
                    enhancedQuery = `Previous context: ${recentContext}\n\n${enhancedQuery}`;
                }
            }
            
            // Directly call web search tool
            const webSearchTool = new WebSearchTool();
            const searchRequest = {
                operation: 'search' as const,
                query: enhancedQuery,
                options: {
                    deepContent: true,
                    costDomains: true
                },
                cache: {
                    enabled: true,
                    ttl: 3600
                }
            };
            
            loggingService.info('🔍 Performing direct web search', {
                query: request.message,
                enhancedQuery: enhancedQuery.substring(0, 200) + '...',
                operation: 'search'
            });
            
            const webSearchResultString = await webSearchTool._call(JSON.stringify(searchRequest));
            const webSearchResult = JSON.parse(webSearchResultString);
            
            // Get quota status
            let quotaUsed: number | undefined;
            if (googleSearchService.isConfigured()) {
                try {
                    const quotaStatus = await googleSearchService.getQuotaStatus();
                    quotaUsed = quotaStatus.count;
                } catch (error) {
                    loggingService.warn('Failed to get quota status', {
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
            
            if (!webSearchResult.success || !webSearchResult.data.searchResults || webSearchResult.data.searchResults.length === 0) {
                loggingService.warn('Web search returned no results', {
                    error: webSearchResult.error
                });
                
                return {
                    response: 'I was unable to find relevant information from web search. Please try rephrasing your query.',
                    agentPath: ['web_scraper', 'no_results'],
                    optimizationsApplied: ['web_search_attempted'],
                    cacheHit: false,
                    riskLevel: 'low',
                    webSearchUsed: false
                };
            }
            
            // Assess query complexity
            const queryComplexity = this.assessQueryComplexity(request.message ?? '');
            const hasGoodSnippets = webSearchResult.data.searchResults.some((r: any) => 
                r.snippet && r.snippet.length > 30
            );
            
            // For simple factual queries with good snippets, return direct results
            if (queryComplexity === 'simple' && hasGoodSnippets) {
                return this.formatDirectResults(
                    webSearchResult.data.searchResults,
                    request.message ?? '',
                    quotaUsed
                );
            }
            
            // For complex queries, use AI synthesis
            return await this.synthesizeWithAI(
                webSearchResult.data.searchResults,
                request.message ?? '',
                queryComplexity,
                quotaUsed
            );
            
        } catch (error) {
            loggingService.error('Web scraper route failed', {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            });
            
            return {
                response: 'I encountered an error while searching the web. Please try again.',
                agentPath: ['web_scraper', 'error'],
                optimizationsApplied: [],
                cacheHit: false,
                riskLevel: 'medium',
                webSearchUsed: false
            };
        }
    }

    /**
     * Format direct search results without AI processing
     */
    private static formatDirectResults(
        searchResults: any[],
        query: string,
        quotaUsed?: number
    ): HandlerResult & { webSearchUsed?: boolean; quotaUsed?: number } {
        loggingService.info('📊 Returning direct Google Search results', {
            query,
            resultsCount: searchResults.length,
            reason: 'Simple factual query with quality snippets'
        });
        
        const directResponse = searchResults
            .slice(0, 5)
            .map((result: any, index: number) => {
                let formatted = `**${index + 1}. ${result.title}**\n\n${result.snippet || 'No description available'}`;
                formatted += `\n\n🔗 Source: ${result.url}`;
                return formatted;
            })
            .join('\n\n---\n\n');
        
        return {
            response: directResponse,
            agentThinking: {
                title: 'Web Search',
                summary: `Retrieved ${searchResults.length} results from the web`,
                steps: [
                    {
                        step: 1,
                        description: 'Web Search',
                        reasoning: `Searched for: "${query}"`,
                        outcome: `Found ${searchResults.length} relevant results`
                    },
                    {
                        step: 2,
                        description: 'Results Compilation',
                        reasoning: 'Compiled search results with source attribution',
                        outcome: 'Direct search results with verified sources'
                    }
                ]
            },
            agentPath: ['web_scraper', 'direct_results'],
            optimizationsApplied: ['web_search', 'direct_results'],
            cacheHit: false,
            riskLevel: 'low',
            webSearchUsed: true,
            quotaUsed
        };
    }

    /**
     * Synthesize web search results using AI
     */
    private static async synthesizeWithAI(
        searchResults: any[],
        query: string,
        queryComplexity: string,
        quotaUsed?: number
    ): Promise<HandlerResult & { webSearchUsed?: boolean; quotaUsed?: number }> {
        loggingService.info('🤖 Using AI to synthesize web search results', {
            query,
            queryComplexity,
            reason: 'Complex query requires synthesis'
        });
        
        const llm = new ChatBedrockConverse({
            model: 'us.anthropic.claude-opus-4-1-20250805-v1:0',
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0, 
            maxTokens: 2000,
        });
        
        // Build prompt with web search results
        const searchResultsText = searchResults
            .map((result: any, index: number) => 
                `[${index + 1}] ${result.title}\nURL: ${result.url}\nContent: ${result.snippet || result.content || ''}`
            )
            .join('\n\n');
        
        const responsePrompt = `You are a factual AI assistant. The user asked: "${query}"

Web search results from Google Custom Search API:

${searchResultsText}

CRITICAL ACCURACY RULES - FOLLOW EXACTLY:
1. ONLY use information explicitly stated in the search results above
2. If information is NOT in the results, clearly state "The searched sources do not contain information about [specific topic]"
3. NEVER add information from your training data or make assumptions
4. Always cite specific sources with URLs when stating facts
5. If sources contradict each other, present both perspectives with their sources
6. For pricing queries: Quote exact numbers if found, or explicitly state "Pricing information not available in sources"
7. If you're uncertain, say so rather than guessing

Based ONLY on the search results above, provide a factual answer:`;
        
        const llmResponse = await llm.invoke(responsePrompt);
        const response = llmResponse.content.toString();
        
        loggingService.info('✅ Web search response generated', {
            query,
            resultsCount: searchResults.length,
            responseLength: response.length
        });
        
        return {
            response: response,
            agentThinking: {
                title: 'Web Search Analysis',
                summary: `Searched the web for "${query}" and analyzed ${searchResults.length} results.`,
                steps: [
                    {
                        step: 1,
                        description: 'Web Search',
                        reasoning: `Performed web search for: "${query}"`,
                        outcome: `Found ${searchResults.length} relevant results`
                    },
                    {
                        step: 2,
                        description: 'Content Analysis',
                        reasoning: 'Analyzed search results and synthesized key information',
                        outcome: 'Generated comprehensive response with source citations'
                    }
                ]
            },
            agentPath: ['web_scraper', 'ai_synthesis'],
            optimizationsApplied: ['web_search', 'ai_analysis'],
            cacheHit: false,
            riskLevel: 'low',
            webSearchUsed: true,
            quotaUsed
        };
    }

    /**
     * Assess query complexity
     */
    private static assessQueryComplexity(query: string): 'simple' | 'complex' {
        // Simple factual queries that can be answered with direct search snippets
        const simplePatterns = [
            /^what is the (price|pricing|cost)/i,
            /^how much (does|is|costs?)/i,
            /^what (is|are) the (price|cost|fee)/i,
            /pricing for/i,
            /cost of/i,
            /^when (was|is|did|does)/i,
            /^who (is|was|are)/i,
            /^where (is|was|are|can)/i,
            /^what does .+ mean/i,
            /^define /i,
            /^what happened on/i,
            /^when did/i
        ];
        
        // Check if query matches simple patterns
        const isSimple = simplePatterns.some(pattern => pattern.test(query));
        
        // Additional heuristics: short queries are often factual lookups
        const wordCount = query.trim().split(/\s+/).length;
        const isShortFactual = wordCount <= 8 && (
            query.includes('?') || 
            query.match(/^(what|when|where|who|how much|price|cost)/i)
        );
        
        return (isSimple || isShortFactual) ? 'simple' : 'complex';
    }
}
