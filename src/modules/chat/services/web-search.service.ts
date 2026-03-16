import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { CacheService } from '../../../common/cache/cache.service';
import { LoggerService } from '../../../common/logger/logger.service';

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  displayUrl: string;
  metadata?: {
    publishedDate?: string;
    author?: string;
  };
  content?: ContentResult;
}

export interface ContentResult {
  title: string;
  content: string;
  url: string;
  extractedText: string;
  metadata: {
    scrapedAt: Date;
    wordCount: number;
    headings: string[];
  };
}

export interface SearchOptions {
  domains?: string[];
  maxResults?: number;
  deepContent?: boolean;
}

export interface WebSearchRequest {
  operation: 'search' | 'scrape' | 'extract';
  url?: string;
  query?: string;
  options?: {
    deepContent?: boolean;
    maxResults?: number;
    costDomains?: boolean;
    domains?: string[];
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
    searchResults?: SearchResult[];
    metadata?: {
      scrapedAt: Date;
      resultCount?: number;
      quotaUsed?: number;
      wordCount?: number;
      headings?: string[];
    };
    summary?: string;
    sources?: Array<{ title: string; url: string }>;
  };
  processingTime?: number;
  cached?: boolean;
  error?: string;
}

@Injectable()
export class WebSearchService {
  private readonly logger = new Logger(WebSearchService.name);
  private readonly apiKey: string;
  private readonly searchEngineId: string;
  private readonly quotaKey = 'google_search:quota:daily';
  private readonly maxResults = 10;
  private readonly deepContentPages = 3;

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggerService,
  ) {
    this.apiKey = process.env.GOOGLE_SEARCH_API_KEY || '';
    this.searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID || '';

    if (!this.apiKey || !this.searchEngineId) {
      this.logger.warn('Google Search API credentials not configured', {
        hasApiKey: !!this.apiKey,
        hasEngineId: !!this.searchEngineId,
      });
    }
  }

  /**
   * Check if the service is properly configured
   */
  isConfigured(): boolean {
    return !!(this.apiKey && this.searchEngineId);
  }

  /**
   * Health check for agent warmup and health endpoints
   */
  async checkHealth(): Promise<{
    healthy: boolean;
    configured?: boolean;
    quotaRemaining?: number;
    lastError?: string;
    lastUsed?: string;
  }> {
    try {
      const configured = this.isConfigured();
      if (!configured) {
        return { healthy: false, configured: false };
      }
      await this.checkQuota();
      const key = this.quotaKey;
      const used = await this.cacheService.get<number>(key);
      const dailyLimit = 100;
      const quotaRemaining = Math.max(0, dailyLimit - (used ?? 0));
      return {
        healthy: true,
        configured: true,
        quotaRemaining,
      };
    } catch (error) {
      return {
        healthy: false,
        configured: this.isConfigured(),
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Perform a web search using Google Custom Search API
   */
  async search(
    query: string,
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    if (!this.isConfigured()) {
      throw new Error(
        'Google Search API is not configured. Please set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID.',
      );
    }

    try {
      // Check quota
      await this.checkQuota();

      // Check cache first
      const cacheKey = this.getCacheKey(query, options);
      const cached = await this.getFromCache(cacheKey);
      if (cached) {
        this.loggingService.info('Google Search cache hit', { query, options });
        return cached;
      }

      // Apply domain filtering if specified
      let searchQuery = query;
      if (options.domains && options.domains.length > 0) {
        const domainFilter = options.domains
          .map((d) => `site:${d}`)
          .join(' OR ');
        searchQuery = `${query} (${domainFilter})`;
      }

      const maxResults = options.maxResults || this.maxResults;

      this.loggingService.info('Performing Google Search', {
        query: searchQuery,
        maxResults,
      });

      // Call Google Custom Search API
      const response = await axios.get(
        'https://www.googleapis.com/customsearch/v1',
        {
          params: {
            key: this.apiKey,
            cx: this.searchEngineId,
            q: searchQuery,
            num: Math.min(maxResults, 10), // Google API max is 10 per request
          },
          timeout: 10000,
        },
      );

      // Parse results
      const results: SearchResult[] = [];
      if (response.data.items && Array.isArray(response.data.items)) {
        for (const item of response.data.items) {
          results.push({
            title: item.title || '',
            snippet: item.snippet || '',
            url: item.link || '',
            displayUrl: item.displayLink || '',
            metadata: {
              publishedDate:
                item.pagemap?.metatags?.[0]?.['article:published_time'],
              author: item.pagemap?.metatags?.[0]?.author,
            },
          });
        }
      }

      // Track quota usage
      await this.trackQuota();

      // Cache results
      await this.saveToCache(cacheKey, results);

      this.loggingService.info('Google Search completed', {
        query,
        resultsCount: results.length,
      });

      // Fetch deep content if requested
      if (options.deepContent && results.length > 0) {
        const urls = results.slice(0, this.deepContentPages).map((r) => r.url);
        const contentResults = await this.getDeepContent(urls);

        // Merge content into results
        results.forEach((result) => {
          const content = contentResults.find((c) => c.url === result.url);
          if (content) {
            result.content = content;
          }
        });
      }

      return results;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 429) {
          throw new Error(
            'Google Search API quota exceeded. Please try again later.',
          );
        } else if (axiosError.response?.status === 403) {
          throw new Error(
            'Google Search API authentication failed. Please check your API key.',
          );
        }
      }

      this.loggingService.error('Google Search failed', {
        error: error instanceof Error ? error.message : String(error),
        query,
      });

      throw error;
    }
  }

  /**
   * Search with automatic domain filtering for cost-related queries
   */
  async searchWithDomains(
    query: string,
    domains: string[],
  ): Promise<SearchResult[]> {
    return this.search(query, { domains });
  }

  /**
   * Execute web search tool operation
   */
  async executeWebSearch(request: WebSearchRequest): Promise<WebSearchResult> {
    const startTime = Date.now();
    const processingTime = Date.now() - startTime;

    try {
      switch (request.operation) {
        case 'search':
          return await this.performSearch(request, processingTime);

        case 'scrape':
          return await this.performScrape(request, processingTime);

        case 'extract':
          return await this.performExtract(request, processingTime);

        default:
          throw new Error(`Unknown operation: ${request.operation}`);
      }
    } catch (error) {
      this.loggingService.error('Web search operation failed', {
        error: error instanceof Error ? error.message : String(error),
        operation: request.operation,
        processingTime,
      });

      return {
        success: false,
        operation: request.operation,
        data: {},
        processingTime,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Perform search operation
   */
  private async performSearch(
    request: WebSearchRequest,
    processingTime: number,
  ): Promise<WebSearchResult> {
    if (!request.query) {
      throw new Error('Query is required for search operation');
    }

    // Check cache if enabled
    let cached = false;
    if (request.cache?.enabled !== false) {
      const cacheKey =
        request.cache?.key || this.getCacheKey(request.query, request.options);
      const cachedResult = await this.getFromCache(cacheKey);
      if (cachedResult) {
        cached = true;
        return {
          success: true,
          operation: 'search',
          data: {
            query: request.query,
            searchResults: cachedResult,
            metadata: {
              scrapedAt: new Date(),
              resultCount: cachedResult.length,
            },
          },
          processingTime,
          cached,
        };
      }
    }

    // Perform search
    const domains = request.options?.costDomains
      ? ['aws.amazon.com', 'cloud.google.com', 'azure.microsoft.com', 'pricing']
      : request.options?.domains;

    const searchOptions: SearchOptions = {
      maxResults: request.options?.maxResults || this.maxResults,
      deepContent: request.options?.deepContent,
      domains,
    };

    const results = await this.search(request.query, searchOptions);

    // Cache results if enabled
    if (request.cache?.enabled !== false) {
      const cacheKey =
        request.cache?.key || this.getCacheKey(request.query, searchOptions);
      await this.saveToCache(cacheKey, results);
    }

    return {
      success: true,
      operation: 'search',
      data: {
        query: request.query,
        searchResults: results,
        metadata: {
          scrapedAt: new Date(),
          resultCount: results.length,
        },
      },
      processingTime,
      cached,
    };
  }

  /**
   * Perform scrape operation (direct URL content extraction)
   */
  private async performScrape(
    request: WebSearchRequest,
    processingTime: number,
  ): Promise<WebSearchResult> {
    if (!request.url) {
      throw new Error('URL is required for scrape operation');
    }

    const content = await this.scrapeUrl(request.url);

    return {
      success: true,
      operation: 'scrape',
      data: {
        url: request.url,
        title: content.title,
        content: content.content,
        extractedText: content.extractedText,
        metadata: {
          scrapedAt: new Date(),
          wordCount: content.metadata.wordCount,
        },
      },
      processingTime,
    };
  }

  /**
   * Perform extract operation (AI-powered content extraction)
   *
   */
  private async performExtract(
    request: WebSearchRequest,
    processingTime: number,
  ): Promise<WebSearchResult> {
    if (!request.url) {
      throw new Error('URL is required for extract operation');
    }

    // Scrape content
    const content = await this.scrapeUrl(request.url);

    // Extract summary using improved extractive method
    // Prioritize sentences by length and position for better summary quality
    const sentences = content.extractedText
      .split(/(?<=[.?!])\s+/)
      .filter(Boolean)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 10); // Filter out very short sentences

    // Score sentences by length (prefer longer, more informative sentences)
    // and position (prefer earlier sentences for context)
    const scoredSentences = sentences.map((sentence, index) => ({
      sentence,
      score: sentence.length * (1 / (index + 1)), // Length weighted by inverse position
    }));

    // Select top 3 sentences by score
    const topSentences = scoredSentences
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .sort(
        (a, b) => sentences.indexOf(a.sentence) - sentences.indexOf(b.sentence),
      ) // Maintain original order
      .map((item) => item.sentence);

    const summary = topSentences.join(' ');

    return {
      success: true,
      operation: 'extract',
      data: {
        url: request.url,
        title: content.title,
        extractedText: content.extractedText,
        summary,
        metadata: {
          scrapedAt: new Date(),
          wordCount: content.metadata.wordCount,
          headings: content.metadata.headings,
        },
      },
      processingTime,
    };
  }

  /**
   * Scrape content from a single URL
   */
  private async scrapeUrl(url: string): Promise<ContentResult> {
    try {
      this.loggingService.info('Scraping URL content', { url });

      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'CostKatana-WebScraper/1.0',
        },
      });

      const $ = cheerio.load(response.data);

      // Remove scripts, styles, and other non-content elements
      $(
        'script, style, nav, header, footer, aside, .ad, .advertisement',
      ).remove();

      // Extract title
      const title =
        $('title').text().trim() ||
        $('h1').first().text().trim() ||
        'Untitled Page';

      // Extract headings for structure
      const headings: string[] = [];
      $('h1, h2, h3, h4, h5, h6').each((_, element) => {
        const headingText = $(element).text().trim();
        if (headingText) {
          headings.push(headingText);
        }
      });

      // Extract main content
      const content = $('body').text().trim();
      const wordCount = content.split(/\s+/).length;

      const extractedText = content.substring(0, 10000); // Limit to 10k chars

      return {
        title,
        content,
        url,
        extractedText,
        metadata: {
          scrapedAt: new Date(),
          wordCount,
          headings,
        },
      };
    } catch (error) {
      this.loggingService.error('Failed to scrape URL', {
        error: error instanceof Error ? error.message : String(error),
        url,
      });
      throw new Error(`Failed to scrape content from ${url}`);
    }
  }

  /**
   * Get deep content from multiple URLs
   */
  private async getDeepContent(urls: string[]): Promise<ContentResult[]> {
    const results: ContentResult[] = [];

    for (const url of urls) {
      try {
        const content = await this.scrapeUrl(url);
        results.push(content);
      } catch (error) {
        this.loggingService.warn('Failed to get deep content for URL', {
          url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Check daily quota
   */
  private async checkQuota(): Promise<void> {
    try {
      // Using CacheService for quota tracking
      const quota = (await this.cacheService.get<number>(this.quotaKey)) || 0;
      const dailyLimit = parseInt(
        process.env.GOOGLE_SEARCH_DAILY_LIMIT || '100',
      );

      if (quota >= dailyLimit) {
        throw new Error('Daily search quota exceeded');
      }
    } catch (error) {
      this.loggingService.warn('Failed to check quota', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Track quota usage
   */
  private async trackQuota(): Promise<void> {
    try {
      const current = (await this.cacheService.get<number>(this.quotaKey)) || 0;
      await this.cacheService.set(this.quotaKey, current + 1, 86400); // 24 hours
    } catch (error) {
      this.loggingService.warn('Failed to track quota', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get quota status
   */
  async getQuotaStatus(): Promise<{ count: number; limit: number }> {
    const count = (await this.cacheService.get<number>(this.quotaKey)) || 0;
    const limit = parseInt(process.env.GOOGLE_SEARCH_DAILY_LIMIT || '100');
    return { count, limit };
  }

  /**
   * Get cache key for search query
   */
  private getCacheKey(query: string, options?: SearchOptions): string {
    const optionsStr = options ? JSON.stringify(options) : '';
    return `google_search:${Buffer.from(query + optionsStr)
      .toString('base64')
      .substring(0, 32)}`;
  }

  /**
   * Get result from cache
   */
  private async getFromCache(key: string): Promise<SearchResult[] | null> {
    try {
      return await this.cacheService.get<SearchResult[]>(key);
    } catch {
      return null;
    }
  }

  /**
   * Save result to cache
   */
  private async saveToCache(
    key: string,
    results: SearchResult[],
  ): Promise<void> {
    try {
      await this.cacheService.set(key, results, 3600); // 1 hour TTL
    } catch (error) {
      this.loggingService.warn('Failed to cache search results', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
