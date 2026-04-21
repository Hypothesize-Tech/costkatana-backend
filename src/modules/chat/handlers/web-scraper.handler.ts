/**
 * Web Scraper Handler
 * Handles web search and scraping using Google Custom Search API
 */

import { Injectable, Logger } from '@nestjs/common';
import { HandlerRequest, HandlerResult } from './types/handler.types';
import { ConversationContext } from '../context';
import { WebSearchService } from '../services/web-search.service';
import { BedrockService } from '../../bedrock/bedrock.service';

@Injectable()
export class WebScraperHandler {
  private readonly logger = new Logger(WebScraperHandler.name);

  constructor(
    private readonly webSearchService: WebSearchService,
    private readonly bedrockService: BedrockService,
  ) {}

  /**
   * Handle web scraper route
   */
  async handle(
    request: HandlerRequest,
    context: ConversationContext,
    contextPreamble: string,
    recentMessages: any[],
  ): Promise<HandlerResult & { webSearchUsed?: boolean; quotaUsed?: number }> {
    this.logger.log('🌐 Routing to web scraper', {
      subject: context.currentSubject,
      domain: context.lastDomain,
      useWebSearch: request.useWebSearch,
      contextPreamble: contextPreamble.substring(0, 100) + '...',
      recentMessagesCount: recentMessages.length,
    });

    try {
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
      const searchRequest = {
        operation: 'search' as const,
        query: enhancedQuery,
        options: {
          deepContent: true,
          costDomains: true,
        },
        cache: {
          enabled: true,
          ttl: 3600,
        },
      };

      this.logger.log('🔍 Performing direct web search', {
        query: request.message,
        enhancedQuery: enhancedQuery.substring(0, 200) + '...',
        operation: 'search',
      });

      const webSearchResult = await this.webSearchService.executeWebSearch({
        operation: 'search',
        query: enhancedQuery,
        options: {
          deepContent: true,
          costDomains: true,
        },
        cache: {
          enabled: true,
        },
      });

      if (
        !webSearchResult.success ||
        !webSearchResult.data.searchResults ||
        webSearchResult.data.searchResults.length === 0
      ) {
        this.logger.warn('Web search returned no results', {
          error: webSearchResult.error,
        });

        return {
          response:
            'I was unable to find relevant information from web search. Please try rephrasing your query.',
          agentPath: ['web_scraper', 'no_results'],
          optimizationsApplied: ['web_search_attempted'],
          cacheHit: false,
          riskLevel: 'low',
          webSearchUsed: false,
        };
      }

      const searchResults = webSearchResult.data.searchResults;
      const quotaUsed = webSearchResult.data.metadata?.quotaUsed;
      const queryComplexity = this.assessQueryComplexity(request.message ?? '');
      const hasGoodSnippets = searchResults.some(
        (r: { snippet?: string }) => r.snippet && r.snippet.length > 30,
      );

      // For simple factual queries with good snippets, return direct results
      if (queryComplexity === 'simple' && hasGoodSnippets) {
        return this.formatDirectResults(
          searchResults,
          request.message ?? '',
          quotaUsed,
        );
      }

      // For complex queries, use AI synthesis
      return await this.synthesizeWithAI(
        request.modelId,
        searchResults,
        request.message ?? '',
        queryComplexity,
        quotaUsed,
      );
    } catch (error) {
      this.logger.error('Web scraper route failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      return {
        response:
          'I encountered an error while searching the web. Please try again.',
        agentPath: ['web_scraper', 'error'],
        optimizationsApplied: [],
        cacheHit: false,
        riskLevel: 'medium',
        webSearchUsed: false,
      };
    }
  }

  /**
   * Format direct search results without AI processing
   */
  private formatDirectResults(
    searchResults: any[],
    query: string,
    quotaUsed?: number,
  ): HandlerResult & { webSearchUsed?: boolean; quotaUsed?: number } {
    this.logger.log('📊 Returning direct Google Search results', {
      query,
      resultsCount: searchResults.length,
      reason: 'Simple factual query with quality snippets',
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
            outcome: `Found ${searchResults.length} relevant results`,
          },
          {
            step: 2,
            description: 'Results Compilation',
            reasoning: 'Compiled search results with source attribution',
            outcome: 'Direct search results with verified sources',
          },
        ],
      },
      agentPath: ['web_scraper', 'direct_results'],
      optimizationsApplied: ['web_search', 'direct_results'],
      cacheHit: false,
      riskLevel: 'low',
      webSearchUsed: true,
      quotaUsed,
    };
  }

  /**
   * Synthesize web search results using AI
   */
  private async synthesizeWithAI(
    modelId: string,
    searchResults: any[],
    query: string,
    queryComplexity: string,
    quotaUsed?: number,
  ): Promise<HandlerResult & { webSearchUsed?: boolean; quotaUsed?: number }> {
    this.logger.log('🤖 Using AI to synthesize web search results', {
      query,
      queryComplexity,
      reason: 'Complex query requires synthesis',
    });

    // Build prompt with web search results
    const searchResultsText = searchResults
      .map(
        (result: any, index: number) =>
          `[${index + 1}] ${result.title}\nURL: ${result.url}\nContent: ${result.snippet || result.content || ''}`,
      )
      .join('\n\n');

    const responsePrompt = `You are a factual AI assistant. Based ONLY on the provided web search results, answer the user's question accurately.

<accuracy_rules>
1. ONLY use information explicitly stated in the search results
2. If information is NOT in the results, clearly state "The searched sources do not contain information about [specific topic]"
3. NEVER add information from your training data or make assumptions
4. Always cite specific sources with URLs when stating facts
5. If sources contradict each other, present both perspectives with their sources
6. For pricing queries: Quote exact numbers if found, or explicitly state "Pricing information not available in sources"
7. If you're uncertain, say so rather than guessing
</accuracy_rules>

Here is an example input with an ideal response:

<sample_input>
<user_question>What is the price of Claude 3.5 Sonnet per million tokens?</user_question>
<web_search_results>
[1] Anthropic Pricing Page
URL: https://www.anthropic.com/pricing
Content: Claude 3.5 Sonnet costs $3.00 per million input tokens and $15.00 per million output tokens as of June 2025.
</web_search_results>
</sample_input>

<ideal_output>
According to Anthropic's pricing page (https://www.anthropic.com/pricing), Claude 3.5 Sonnet costs **$3.00 per million input tokens** and **$15.00 per million output tokens** as of June 2025.
</ideal_output>

This response is ideal because it quotes exact numbers directly from the source, includes the URL, and does not add any information not present in the search result.

Now answer the actual question:

<user_question>
${query}
</user_question>

<web_search_results>
${searchResultsText}
</web_search_results>

Answer:`;

    // === Implement AI synthesis using Bedrock service ===
    let aiResponse: string;
    try {
      // Use injected BedrockService for AI synthesis
      const bedrockResult = await BedrockService.invokeModelDirectly(modelId, {
        prompt: responsePrompt,
        max_tokens: 600,
        temperature: 0.3,
        stop_sequences: [],
      });
      aiResponse = bedrockResult.response?.trim() || '';
    } catch (bedrockError) {
      this.logger.warn(
        'Bedrock AI synthesis failed, falling back to snippet render',
        {
          error:
            bedrockError instanceof Error
              ? bedrockError.message
              : String(bedrockError),
        },
      );
      // Fallback if Bedrock service is not available
      aiResponse =
        `Based on web search results for "${query}":\n\n` +
        searchResults
          .slice(0, 3)
          .map(
            (r, i) =>
              `${i + 1}. ${r.title} - ${(r as { snippet?: string }).snippet}`,
          )
          .join('\n\n');
    }

    this.logger.log('✅ Web search response generated', {
      query,
      resultsCount: searchResults.length,
      responseLength: aiResponse.length,
    });

    // Determine AI web search decision
    const aiWebSearchDecision =
      this.assessQueryComplexity(query) === 'complex'
        ? 'Web search required for complex query requiring synthesis and analysis'
        : 'Web search performed for factual/current information lookup';

    return {
      response: aiResponse,
      agentThinking: {
        title: 'Web Search Analysis',
        summary: `Searched the web for "${query}" and analyzed ${searchResults.length} results.`,
        steps: [
          {
            step: 1,
            description: 'Web Search',
            reasoning: `Performed web search for: "${query}"`,
            outcome: `Found ${searchResults.length} relevant results`,
          },
          {
            step: 2,
            description: 'Content Analysis',
            reasoning:
              'Analyzed search results and synthesized key information',
            outcome: 'Generated comprehensive response with source citations',
          },
        ],
      },
      agentPath: ['web_scraper', 'ai_synthesis'],
      optimizationsApplied: ['web_search', 'ai_analysis'],
      cacheHit: false,
      riskLevel: 'low',
      webSearchUsed: true,
      aiWebSearchDecision,
      quotaUsed,
    };
  }

  /**
   * Assess query complexity
   */
  private assessQueryComplexity(query: string): 'simple' | 'complex' {
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
      /^when did/i,
    ];

    // Check if query matches simple patterns
    const isSimple = simplePatterns.some((pattern) => pattern.test(query));

    // Additional heuristics: short queries are often factual lookups
    const wordCount = query.trim().split(/\s+/).length;
    const isShortFactual =
      wordCount <= 8 &&
      (query.includes('?') ||
        query.match(/^(what|when|where|who|how much|price|cost)/i));

    return isSimple || isShortFactual ? 'simple' : 'complex';
  }
}
