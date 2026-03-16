import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../common/cache/cache.service';
import { LoggerService } from '../../../common/logger/logger.service';
import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';

export interface SearchResult {
  title: string;
  snippet: string;
  url: string;
  displayUrl?: string;
  metadata?: {
    publishedDate?: string;
    author?: string;
  };
}

export interface ContentResult {
  url: string;
  title: string;
  content: string;
  cleanedText: string;
  wordCount: number;
  summary?: string;
}

export interface SearchOptions {
  domains?: string[];
  maxResults?: number;
  deepContent?: boolean;
}

@Injectable()
export class GoogleSearchService {
  private readonly logger = new Logger(GoogleSearchService.name);
  private readonly apiKey: string;
  private readonly searchEngineId: string;
  private readonly quotaKey = 'google_search:quota:daily';

  // Configuration constants
  private readonly CACHE_TTL = 3600; // 1 hour
  private readonly MAX_RESULTS = 10;
  private readonly DAILY_QUOTA_LIMIT = 100;
  private readonly DEEP_CONTENT_PAGES = 5;
  private readonly CONTENT_TIMEOUT = 10000;
  private readonly MAX_CONTENT_LENGTH = 50000;
  private readonly QUOTA_WARNING_THRESHOLD = 0.8;
  private readonly QUOTA_BLOCK_THRESHOLD = 0.9;

  private readonly COST_DOMAINS = [
    'aws.amazon.com',
    'cloud.google.com',
    'learn.microsoft.com',
    'azure.microsoft.com',
    'pricing.aws.amazon.com',
    'azure.microsoft.com/pricing',
    'openai.com',
    'anthropic.com',
    'cohere.com',
    'ai.meta.com',
    'ai.google.dev',
    'mistral.ai',
    'huggingface.co',
    'replicate.com',
    'together.ai',
    'perplexity.ai',
    'claude.ai',
    'gemini.google.com',
  ];

  private readonly GOOGLE_SEARCH_API_URL =
    'https://www.googleapis.com/customsearch/v1';

  constructor(
    private configService: ConfigService,
    private cacheService: CacheService,
    private loggerService: LoggerService,
  ) {
    this.apiKey = this.configService.get<string>('GOOGLE_SEARCH_API_KEY') || '';
    this.searchEngineId =
      this.configService.get<string>('GOOGLE_SEARCH_ENGINE_ID') || '';

    if (!this.apiKey || !this.searchEngineId) {
      this.loggerService.warn('Google Search API credentials not configured', {
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
        this.loggerService.info('Google Search cache hit', { query, options });
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

      const maxResults = options.maxResults || this.MAX_RESULTS;

      this.loggerService.info('Performing Google Search', {
        query: searchQuery,
        maxResults,
      });

      // Call Google Custom Search API
      const response = await axios.get(this.GOOGLE_SEARCH_API_URL, {
        params: {
          key: this.apiKey,
          cx: this.searchEngineId,
          q: searchQuery,
          num: Math.min(maxResults, 10), // Google API max is 10 per request
        },
        timeout: 10000,
      });

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

      this.loggerService.info('Google Search completed', {
        query,
        resultsCount: results.length,
      });

      // Fetch deep content if requested
      if (options.deepContent && results.length > 0) {
        const urls = results
          .slice(0, this.DEEP_CONTENT_PAGES)
          .map((r) => r.url);
        const contentResults = await this.getDeepContent(urls);

        // Merge content into results
        results.forEach((result) => {
          const content = (result as any).content;
          const contentResult = contentResults.find(
            (c) => c.url === result.url,
          );
          if (contentResult) {
            (result as any).content = contentResult;
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

      this.loggerService.error('Google Search failed', {
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
   * Search with automatic cost domain filtering
   */
  async searchCostDomains(query: string): Promise<SearchResult[]> {
    return this.searchWithDomains(query, this.COST_DOMAINS);
  }

  /**
   * Fetch and parse full content from URLs
   */
  async getDeepContent(urls: string[]): Promise<ContentResult[]> {
    const results: ContentResult[] = [];

    for (const url of urls) {
      try {
        this.loggerService.info('Fetching deep content', { url });

        const response = await axios.get(url, {
          timeout: this.CONTENT_TIMEOUT,
          maxContentLength: this.MAX_CONTENT_LENGTH,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; CostKatana/1.0; +https://costkatana.com)',
          },
        });

        const html = response.data;
        const $ = cheerio.load(html);

        // Remove unwanted elements
        $(
          'script, style, nav, header, footer, aside, .advertisement, .ad, .cookie-banner',
        ).remove();

        // Extract title
        const title =
          $('title').text() ||
          $('h1').first().text() ||
          $('meta[property="og:title"]').attr('content') ||
          '';

        // Extract main content
        const contentSelectors = [
          'main article',
          'article',
          '.content',
          '.main-content',
          '.post-content',
          'main',
          '.article-body',
          '[role="main"]',
        ];

        let content = '';
        for (const selector of contentSelectors) {
          const element = $(selector);
          if (element.length > 0) {
            content = element.text();
            break;
          }
        }

        // Fallback to body if no content found
        if (!content) {
          content = $('body').text();
        }

        // Clean the text
        const cleanedText = content
          .replace(/\s+/g, ' ')
          .replace(/\n+/g, '\n')
          .trim();

        const wordCount = cleanedText.split(/\s+/).length;

        results.push({
          url,
          title: title.trim(),
          content: html,
          cleanedText,
          wordCount,
        });

        this.loggerService.info('Deep content extracted', {
          url,
          wordCount,
          titleLength: title.length,
        });
      } catch (error) {
        this.loggerService.warn('Failed to fetch deep content', {
          url,
          error: error instanceof Error ? error.message : String(error),
        });
        // Continue with other URLs
      }
    }

    return results;
  }

  /**
   * Check if we're within quota limits
   */
  private async checkQuota(): Promise<void> {
    try {
      const count = await this.getQuotaCount();

      if (count >= this.DAILY_QUOTA_LIMIT * this.QUOTA_BLOCK_THRESHOLD) {
        throw new Error(
          'Daily quota limit reached (90%). Search requests are blocked.',
        );
      }

      if (count >= this.DAILY_QUOTA_LIMIT * this.QUOTA_WARNING_THRESHOLD) {
        this.loggerService.warn('Approaching daily quota limit', {
          currentCount: count,
          limit: this.DAILY_QUOTA_LIMIT,
          percentage: ((count / this.DAILY_QUOTA_LIMIT) * 100).toFixed(1),
        });
      }
    } catch (error) {
      // If cache is unavailable, log but don't block
      this.loggerService.warn('Failed to check quota', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Track quota usage
   */
  private async trackQuota(): Promise<void> {
    try {
      const currentCount = await this.getQuotaCount();
      const newCount = currentCount + 1;

      // Set expiry to end of day if this is the first request
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const secondsUntilMidnight = Math.floor(
        (tomorrow.getTime() - now.getTime()) / 1000,
      );

      await this.cacheService.set(
        this.quotaKey,
        newCount,
        secondsUntilMidnight,
      );

      this.loggerService.info('Quota tracked', {
        currentCount: newCount,
        limit: this.DAILY_QUOTA_LIMIT,
      });
    } catch (error) {
      this.loggerService.warn('Failed to track quota', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get current quota count
   */
  private async getQuotaCount(): Promise<number> {
    try {
      const count = await this.cacheService.get<number>(this.quotaKey);
      return count || 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Generate cache key for a search query
   */
  private getCacheKey(query: string, options: SearchOptions): string {
    const optionsStr = JSON.stringify({
      domains: options.domains?.sort() || [],
      maxResults: options.maxResults || this.MAX_RESULTS,
    });
    return `google_search:${Buffer.from(query + optionsStr).toString('base64')}`;
  }

  /**
   * Get results from cache
   */
  private async getFromCache(key: string): Promise<SearchResult[] | null> {
    try {
      const cached = await this.cacheService.get<SearchResult[]>(key);
      return cached || null;
    } catch (error) {
      this.loggerService.warn('Cache read failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Save results to cache
   */
  private async saveToCache(
    key: string,
    results: SearchResult[],
  ): Promise<void> {
    try {
      await this.cacheService.set(key, results, this.CACHE_TTL);
    } catch (error) {
      this.loggerService.warn('Cache write failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get current quota status
   */
  async getQuotaStatus(): Promise<{
    count: number;
    limit: number;
    percentage: number;
  }> {
    const count = await this.getQuotaCount();
    return {
      count,
      limit: this.DAILY_QUOTA_LIMIT,
      percentage: (count / this.DAILY_QUOTA_LIMIT) * 100,
    };
  }
}
