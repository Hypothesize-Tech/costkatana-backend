import axios, { AxiosError } from 'axios';
import * as cheerio from 'cheerio';
import { loggingService } from './logging.service';
import { redisService } from './redis.service';
import { SEARCH_CONFIG, SearchResult, ContentResult, SearchOptions } from '../config/search.config';

export class GoogleSearchService {
    private static instance: GoogleSearchService;
    private apiKey: string;
    private searchEngineId: string;
    private quotaKey = 'google_search:quota:daily';

    private constructor() {
        this.apiKey = process.env.GOOGLE_SEARCH_API_KEY || '';
        this.searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID || '';

        if (!this.apiKey || !this.searchEngineId) {
            loggingService.warn('Google Search API credentials not configured', {
                hasApiKey: !!this.apiKey,
                hasEngineId: !!this.searchEngineId
            });
        }
    }

    public static getInstance(): GoogleSearchService {
        if (!GoogleSearchService.instance) {
            GoogleSearchService.instance = new GoogleSearchService();
        }
        return GoogleSearchService.instance;
    }

    /**
     * Check if the service is properly configured
     */
    public isConfigured(): boolean {
        return !!(this.apiKey && this.searchEngineId);
    }

    /**
     * Perform a web search using Google Custom Search API
     */
    public async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
        if (!this.isConfigured()) {
            throw new Error('Google Search API is not configured. Please set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID.');
        }

        try {
            // Check quota
            await this.checkQuota();

            // Check cache first
            const cacheKey = this.getCacheKey(query, options);
            const cached = await this.getFromCache(cacheKey);
            if (cached) {
                loggingService.info('Google Search cache hit', { query, options });
                return cached;
            }

            // Apply domain filtering if specified
            let searchQuery = query;
            if (options.domains && options.domains.length > 0) {
                const domainFilter = options.domains.map(d => `site:${d}`).join(' OR ');
                searchQuery = `${query} (${domainFilter})`;
            }

            const maxResults = options.maxResults || SEARCH_CONFIG.MAX_RESULTS;

            loggingService.info('Performing Google Search', { query: searchQuery, maxResults });

            // Call Google Custom Search API
            const response = await axios.get(SEARCH_CONFIG.GOOGLE_SEARCH_API_URL, {
                params: {
                    key: this.apiKey,
                    cx: this.searchEngineId,
                    q: searchQuery,
                    num: Math.min(maxResults, 10), // Google API max is 10 per request
                },
                timeout: 10000
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
                            publishedDate: item.pagemap?.metatags?.[0]?.['article:published_time'],
                            author: item.pagemap?.metatags?.[0]?.author
                        }
                    });
                }
            }

            // Track quota usage
            await this.trackQuota();

            // Cache results
            await this.saveToCache(cacheKey, results);

            loggingService.info('Google Search completed', {
                query,
                resultsCount: results.length
            });

            // Fetch deep content if requested
            if (options.deepContent && results.length > 0) {
                const urls = results.slice(0, SEARCH_CONFIG.DEEP_CONTENT_PAGES).map(r => r.url);
                const contentResults = await this.getDeepContent(urls);
                
                // Merge content into results
                results.forEach(result => {
                    const content = contentResults.find(c => c.url === result.url);
                    if (content) {
                        (result as any).content = content;
                    }
                });
            }

            return results;

        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                if (axiosError.response?.status === 429) {
                    throw new Error('Google Search API quota exceeded. Please try again later.');
                } else if (axiosError.response?.status === 403) {
                    throw new Error('Google Search API authentication failed. Please check your API key.');
                }
            }

            loggingService.error('Google Search failed', {
                error: error instanceof Error ? error.message : String(error),
                query
            });

            throw error;
        }
    }

    /**
     * Search with automatic domain filtering for cost-related queries
     */
    public async searchWithDomains(query: string, domains: string[]): Promise<SearchResult[]> {
        return this.search(query, { domains });
    }

    /**
     * Search with automatic cost domain filtering
     */
    public async searchCostDomains(query: string): Promise<SearchResult[]> {
        return this.searchWithDomains(query, SEARCH_CONFIG.COST_DOMAINS);
    }

    /**
     * Fetch and parse full content from URLs
     */
    public async getDeepContent(urls: string[]): Promise<ContentResult[]> {
        const results: ContentResult[] = [];

        for (const url of urls) {
            try {
                loggingService.info('Fetching deep content', { url });

                const response = await axios.get(url, {
                    timeout: SEARCH_CONFIG.CONTENT_TIMEOUT,
                    maxContentLength: SEARCH_CONFIG.MAX_CONTENT_LENGTH,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; CostKatana/1.0; +https://costkatana.com)',
                    }
                });

                const html = response.data;
                const $ = cheerio.load(html);

                // Remove unwanted elements
                $('script, style, nav, header, footer, aside, .advertisement, .ad, .cookie-banner').remove();

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
                    '.post-content',
                    'main',
                    '.article-body',
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
                    wordCount
                });

                loggingService.info('Deep content extracted', {
                    url,
                    wordCount,
                    titleLength: title.length
                });

            } catch (error) {
                loggingService.warn('Failed to fetch deep content', {
                    url,
                    error: error instanceof Error ? error.message : String(error)
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
            
            if (count >= SEARCH_CONFIG.DAILY_QUOTA_LIMIT * SEARCH_CONFIG.QUOTA_BLOCK_THRESHOLD) {
                throw new Error('Daily quota limit reached (90%). Search requests are blocked.');
            }

            if (count >= SEARCH_CONFIG.DAILY_QUOTA_LIMIT * SEARCH_CONFIG.QUOTA_WARNING_THRESHOLD) {
                loggingService.warn('Approaching daily quota limit', {
                    currentCount: count,
                    limit: SEARCH_CONFIG.DAILY_QUOTA_LIMIT,
                    percentage: (count / SEARCH_CONFIG.DAILY_QUOTA_LIMIT * 100).toFixed(1)
                });
            }
        } catch (error) {
            // If Redis is unavailable, log but don't block
            loggingService.warn('Failed to check quota', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Track quota usage
     */
    private async trackQuota(): Promise<void> {
        try {
            const count = await redisService.incr(this.quotaKey);
            
            // Set expiry to end of day if this is the first request
            if (count === 1) {
                const now = new Date();
                const tomorrow = new Date(now);
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(0, 0, 0, 0);
                const secondsUntilMidnight = Math.floor((tomorrow.getTime() - now.getTime()) / 1000);
                
                // Use set with TTL instead of expire
                await redisService.set(this.quotaKey, count.toString(), secondsUntilMidnight);
            }

            loggingService.info('Quota tracked', {
                currentCount: count,
                limit: SEARCH_CONFIG.DAILY_QUOTA_LIMIT
            });
        } catch (error) {
            loggingService.warn('Failed to track quota', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get current quota count
     */
    private async getQuotaCount(): Promise<number> {
        try {
            const count = await redisService.get(this.quotaKey);
            return count ? parseInt(count, 10) : 0;
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
            maxResults: options.maxResults || SEARCH_CONFIG.MAX_RESULTS
        });
        return `google_search:${Buffer.from(query + optionsStr).toString('base64')}`;
    }

    /**
     * Get results from cache
     */
    private async getFromCache(key: string): Promise<SearchResult[] | null> {
        try {
            const cached = await redisService.get(key);
            if (cached) {
                return JSON.parse(cached);
            }
        } catch (error) {
            loggingService.warn('Cache read failed', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
        return null;
    }

    /**
     * Save results to cache
     */
    private async saveToCache(key: string, results: SearchResult[]): Promise<void> {
        try {
            await redisService.set(key, JSON.stringify(results), SEARCH_CONFIG.CACHE_TTL);
        } catch (error) {
            loggingService.warn('Cache write failed', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Get current quota status
     */
    public async getQuotaStatus(): Promise<{ count: number; limit: number; percentage: number }> {
        const count = await this.getQuotaCount();
        return {
            count,
            limit: SEARCH_CONFIG.DAILY_QUOTA_LIMIT,
            percentage: (count / SEARCH_CONFIG.DAILY_QUOTA_LIMIT) * 100
        };
    }
}

// Export singleton instance
export const googleSearchService = GoogleSearchService.getInstance();

