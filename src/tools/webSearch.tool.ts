import { Tool } from "@langchain/core/tools";
import { loggingService } from '../services/logging.service';
import { ChatBedrockConverse } from "@langchain/aws";
import { googleSearchService } from '../services/googleSearch.service';
import { SEARCH_CONFIG } from '../config/search.config';
import axios from 'axios';
import * as cheerio from 'cheerio';

export interface WebSearchRequest {
    operation: 'search' | 'scrape' | 'extract';
    url?: string;
    query?: string;
    options?: {
        deepContent?: boolean;
        maxResults?: number;
        costDomains?: boolean; // Auto-filter to cost intelligence domains
    };
    cache?: {
        enabled?: boolean;
        key?: string;
    };
}

export interface WebSearchResult {
    success: boolean;
    operation?: string;
    data: {
        url?: string;
        query?: string;
        title?: string;
        content?: string;
        extractedText?: string;
        searchResults?: Array<{
            title: string;
            snippet: string;
            url: string;
            content?: any;
        }>;
        metadata?: {
            scrapedAt: Date;
            resultCount?: number;
            quotaUsed?: number;
        };
        summary?: string;
        sources?: Array<{ title: string; url: string }>;
    };
    processingTime?: number;
    cached?: boolean;
    error?: string;
}

export class WebSearchTool extends Tool {
    name = "web_search";
    description = `Enterprise-safe web search and content extraction tool powered by Google Custom Search API.
    
    This tool can:
    - Search the web for up-to-date information with automatic caching
    - Extract deep content from search results (top 3-5 pages)
    - Automatically filter to trusted domains for cost/pricing queries
    - Summarize search results using AI
    - Track quota usage and enforce limits
    
    Input should be a JSON string with:
    {
        "operation": "search|scrape|extract",
        "query": "latest AWS pricing changes",  // For search operation
        "url": "https://example.com",          // For scrape operation (direct URL fetch)
        "options": {
            "deepContent": true,               // Fetch and parse full content from top results
            "maxResults": 10,                   // Max search results (default: 10)
            "costDomains": true                 // Auto-filter to AWS/GCP/Azure domains
        },
        "cache": {
            "enabled": true,                    // Use Redis caching (default: true)
            "key": "custom_cache_key"           // Optional custom cache key
        }
    }
    
    Examples:
    - Cost intelligence: {"operation": "search", "query": "AWS Bedrock pricing", "options": {"costDomains": true, "deepContent": true}}
    - General search: {"operation": "search", "query": "latest AI trends"}
    - Direct URL: {"operation": "scrape", "url": "https://aws.amazon.com/pricing"}
    `;

    private summarizer: ChatBedrockConverse;

    constructor() {
        super();
        
        // Initialize AI summarizer
        this.summarizer = new ChatBedrockConverse({
            model: "amazon.nova-pro-v1:0",
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.3,
            maxTokens: 2000,
        });
    }

    async _call(input: string): Promise<string> {
        const startTime = Date.now();
        
        try {
            let request: WebSearchRequest;
            
            // Try to parse input as JSON
            try {
                request = JSON.parse(input);
            } catch (parseError) {
                // If parsing fails, treat input as a simple search query
                loggingService.warn('WebSearchTool received non-JSON input, treating as search query', {
                    input: input.substring(0, 200)
                });
                request = {
                    operation: 'search',
                    query: input
                };
            }
            
            // Validate and set default operation if missing
            if (!request.operation) {
                loggingService.warn('WebSearchTool operation missing, defaulting to search', {
                    input: input.substring(0, 200)
                });
                request.operation = 'search';
                request.query = request.query || input;
            }
            
            loggingService.info('Web search operation initiated', {
                operation: request.operation,
                query: request.query,
                url: request.url,
                options: request.options
            });

            let result: WebSearchResult;

            switch (request.operation) {
                case 'search':
                    result = await this.performSearch(request);
                    break;
                case 'scrape':
                    result = await this.scrapeUrl(request);
                    break;
                case 'extract':
                    result = await this.extractWithSearch(request);
                    break;
                default:
                    throw new Error(`Invalid operation: ${request.operation}`);
            }

            result.processingTime = Date.now() - startTime;

            loggingService.info('Web search operation completed', {
                operation: request.operation,
                success: result.success,
                processingTime: result.processingTime
            });

            return JSON.stringify(result);

        } catch (error) {
            loggingService.error('Web search operation failed', {
                error: error instanceof Error ? error.message : String(error),
                errorStack: error instanceof Error ? error.stack : undefined
            });
            
            return JSON.stringify({
                success: false,
                operation: 'unknown',
                data: {},
                error: error instanceof Error ? error.message : 'Unknown error',
                processingTime: Date.now() - startTime
            });
        }
    }

    /**
     * Perform web search using Google Custom Search API
     */
    private async performSearch(request: WebSearchRequest): Promise<WebSearchResult> {
        if (!request.query) {
            throw new Error('Query is required for search operation');
        }

        if (!googleSearchService.isConfigured()) {
            return {
                success: false,
                operation: 'search',
                data: {},
                error: 'Google Search API is not configured. Please set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID environment variables.'
            };
        }

        try {
            const searchOptions = {
                maxResults: request.options?.maxResults || SEARCH_CONFIG.MAX_RESULTS,
                deepContent: request.options?.deepContent || false,
                domains: request.options?.costDomains ? SEARCH_CONFIG.COST_DOMAINS : undefined
            };

            // Perform search
            const searchResults = await googleSearchService.search(request.query, searchOptions);

            // Extract text from results
            let extractedText = searchResults.map(r => 
                `${r.title}\n${r.snippet}\n`
            ).join('\n');

            // If deep content is enabled, add content from fetched pages
            if (request.options?.deepContent) {
                searchResults.forEach(result => {
                    if ((result as any).content) {
                        const content = (result as any).content;
                        extractedText += `\n\n--- ${content.title} ---\n${content.cleanedText.substring(0, 2000)}\n`;
                    }
                });
            }

            // Get quota status
            const quotaStatus = await googleSearchService.getQuotaStatus();

            return {
                success: true,
                operation: 'search',
                data: {
                    query: request.query,
                    searchResults: searchResults.map(r => ({
                        title: r.title,
                        snippet: r.snippet,
                        url: r.url,
                        content: (r as any).content || undefined
                    })),
                    extractedText,
                    metadata: {
                        scrapedAt: new Date(),
                        resultCount: searchResults.length,
                        quotaUsed: quotaStatus.count
                    },
                    sources: searchResults.map(r => ({
                        title: r.title,
                        url: r.url
                    }))
                }
            };

        } catch (error) {
            loggingService.error('Search operation failed', {
                query: request.query,
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                success: false,
                operation: 'search',
                data: {
                    query: request.query
                },
                error: error instanceof Error ? error.message : 'Search failed'
            };
        }
    }

    /**
     * Scrape a specific URL directly (no search)
     */
    private async scrapeUrl(request: WebSearchRequest): Promise<WebSearchResult> {
        if (!request.url) {
            throw new Error('URL is required for scrape operation');
        }

        try {
            loggingService.info('Scraping URL directly', { url: request.url });

            const response = await axios.get(request.url, {
                timeout: SEARCH_CONFIG.CONTENT_TIMEOUT,
                maxContentLength: SEARCH_CONFIG.MAX_CONTENT_LENGTH,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; CostKatana/1.0; +https://costkatana.com)',
                }
            });

            const html = response.data;
            const $ = cheerio.load(html);

            // Remove unwanted elements
            $('script, style, nav, header, footer, aside, .advertisement, .ad').remove();

            // Extract title
            const title = $('title').text() || 
                         $('h1').first().text() || 
                         $('meta[property="og:title"]').attr('content') || 
                         '';

            // Extract main content
            const contentSelectors = [
                'main article',
                'article',
                '.content',
                '.main-content',
                'main',
                '[role="main"]'
            ];

            let content = '';
            for (const selector of contentSelectors) {
                const element = $(selector);
                if (element.length > 0) {
                    content = element.text();
                    break;
                }
            }

            if (!content) {
                content = $('body').text();
            }

            // Clean text
            const extractedText = content
                .replace(/\s+/g, ' ')
                .replace(/\n+/g, '\n')
                .trim();

            return {
                success: true,
                operation: 'scrape',
                data: {
                    url: request.url,
                    title: title.trim(),
                    content: html,
                    extractedText,
                    metadata: {
                        scrapedAt: new Date()
                    }
                }
            };

        } catch (error) {
            loggingService.error('URL scraping failed', {
                url: request.url,
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                success: false,
                operation: 'scrape',
                data: {
                    url: request.url
                },
                error: error instanceof Error ? error.message : 'Scraping failed'
            };
        }
    }

    /**
     * Extract content using search (find relevant pages first, then extract)
     */
    private async extractWithSearch(request: WebSearchRequest): Promise<WebSearchResult> {
        if (!request.query) {
            throw new Error('Query is required for extract operation');
        }

        // Perform search with deep content enabled
        request.options = {
            ...request.options,
            deepContent: true,
            maxResults: 5 // Limit to top 5 for extraction
        };

        return this.performSearch(request);
    }
}

// Helper function to get instance
export function getWebSearchInstance(): WebSearchTool {
    return new WebSearchTool();
}
