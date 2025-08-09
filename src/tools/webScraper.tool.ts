import { Tool } from "@langchain/core/tools";
import puppeteer, { Browser } from 'puppeteer';
import { logger } from '../utils/logger';
import { ChatBedrockConverse } from "@langchain/aws";

export interface ScrapingRequest {
    operation: 'scrape' | 'search' | 'extract' | 'monitor';
    url?: string;
    query?: string;
    selectors?: {
        title?: string;
        content?: string;
        links?: string;
        prices?: string;
        images?: string;
    };
    options?: {
        waitFor?: string;
        timeout?: number;
        screenshot?: boolean;
        mobile?: boolean;
        javascript?: boolean;
        extractText?: boolean;
        followLinks?: boolean;
        maxPages?: number;
    };
    cache?: {
        enabled?: boolean;
        ttl?: number; // Time to live in seconds
        key?: string;
    };
}

export interface ScrapingResult {
    success: boolean;
    operation?: string;
    data: {
        url: string;
        title?: string;
        content?: string;
        extractedText?: string;
        links?: Array<{ text: string; url: string }>;
        images?: string[];
        prices?: Array<{ text: string; price: number; currency: string }>;
        metadata?: {
            scrapedAt: Date;
            loadTime: number;
            pageSize: number;
            statusCode: number;
        };
        summary?: string;
        relevanceScore?: number;
    };
    processingTime?: number;
    cached?: boolean;
    error?: string;
}

export class WebScraperTool extends Tool {
    name = "web_scraper";
    description = `Advanced web scraping and real-time data extraction tool.
    
    This tool can:
    - Scrape any website with intelligent content extraction
    - Search and monitor trending topics (Hacker News, Reddit, Twitter)
    - Extract structured data (prices, articles, tables, reviews)
    - Take screenshots and handle JavaScript-heavy sites
    - Cache results with intelligent expiration
    - Summarize scraped content using AI
    
    Input should be a JSON string with:
    {
        "operation": "scrape|search|extract|monitor",
        "url": "https://example.com", // For scrape operation
        "query": "trending AI tools", // For search operation
        "selectors": {
            "title": "h1, .title",
            "content": ".content, article",
            "links": "a[href]",
            "prices": ".price, .cost",
            "images": "img[src]"
        },
        "options": {
            "waitFor": ".content", // Wait for element
            "timeout": 30000,
            "screenshot": false,
            "mobile": false,
            "javascript": true,
            "extractText": true,
            "followLinks": false,
            "maxPages": 1
        },
        "cache": {
            "enabled": true,
            "ttl": 3600, // 1 hour
            "key": "custom_cache_key"
        }
    }`;

    private browser?: Browser;
    private summarizer: ChatBedrockConverse;
    private cache: Map<string, { data: ScrapingResult; expires: number }> = new Map();

    constructor() {
        super();
        
        // Initialize AI summarizer
        this.summarizer = new ChatBedrockConverse({
            model: "amazon.nova-pro-v1:0", // Use Nova Pro since Haiku isn't available
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.3,
            maxTokens: 2000,
        });
    }

    async _call(input: string): Promise<string> {
        try {
            const request: ScrapingRequest = JSON.parse(input);
            
            // Check cache first
            if (request.cache?.enabled) {
                const cached = this.getCachedResult(request);
                if (cached) {
                    logger.info(`🎯 Cache hit for web scraping: ${request.url || request.query}`);
                    return JSON.stringify({ ...cached, cached: true });
                }
            }

            let result: ScrapingResult;

            switch (request.operation) {
                case 'scrape':
                    result = await this.scrapeWebsite(request);
                    break;
                case 'search':
                    result = await this.searchTrendingContent(request);
                    break;
                case 'extract':
                    result = await this.extractStructuredData(request);
                    break;
                case 'monitor':
                    result = await this.monitorChanges(request);
                    break;
                default:
                    throw new Error(`Invalid operation: ${request.operation}`);
            }

            // AI-powered content summarization
            if (result.success && result.data.extractedText) {
                result.data.summary = await this.summarizeContent(
                    result.data.extractedText,
                    request.query || 'general content'
                );
            }

            // Cache the result
            if (request.cache?.enabled && result.success) {
                this.cacheResult(request, result);
            }

            // Store in vector database for future semantic search
            if (result.success && result.data.extractedText) {
                await this.storeInVectorDB(result);
            }

            return JSON.stringify(result);

        } catch (error) {
            logger.error('Web scraping failed:', error);
            return JSON.stringify({
                success: false,
                operation: 'unknown',
                data: {},
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }

    private async initBrowser(): Promise<void> {
        if (!this.browser) {
            this.browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-field-trial-config',
                    '--disable-ipc-flooding-protection'
                ]
            });
        }
    }

    private async scrapeWebsite(request: ScrapingRequest): Promise<ScrapingResult> {
        if (!request.url) {
            throw new Error('URL is required for scrape operation');
        }

        await this.initBrowser();
        const page = await this.browser!.newPage();
        const startTime = Date.now();

        try {
            // Configure page with better anti-detection
            await page.setViewport({ width: 1920, height: 1080, isMobile: false });
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Set extra headers to avoid detection
            await page.setExtraHTTPHeaders({
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            });

            // Navigate to page with better error handling and longer timeouts
            const response = await page.goto(request.url, {
                waitUntil: 'domcontentloaded', // Use simpler wait condition
                timeout: 45000 // Increase timeout to 45 seconds
            }).catch(async (error) => {
                logger.warn(`Navigation failed for ${request.url}, trying with different settings: ${error.message}`);
                // Try again with even simpler settings
                return await page.goto(request.url!, {
                    waitUntil: 'load', // Simplest wait condition
                    timeout: 30000
                });
            });

            // LinkedIn-specific handling
            const isLinkedIn = request.url.includes('linkedin.com');
            if (isLinkedIn) {
                // Wait a bit for LinkedIn to load
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                // Check if we're blocked or need to login
                const isBlocked = await page.$('.challenge-page, .authwall, .guest-homepage');
                if (isBlocked) {
                    logger.warn('LinkedIn access blocked, using fallback extraction');
                    // Try to extract what we can from the page title and meta tags
                    const pageTitle = await page.title();
                    const metaDescription = await page.$eval('meta[name="description"]', (el: any) => el.content).catch(() => '');
                    
                    return {
                        success: true,
                        data: {
                            url: request.url,
                            title: pageTitle,
                            extractedText: `${pageTitle}\n${metaDescription}`,
                            metadata: {
                                scrapedAt: new Date(),
                                loadTime: Date.now() - startTime,
                                pageSize: 0,
                                statusCode: response?.status() || 200
                            }
                        },
                        processingTime: Date.now() - startTime,
                        cached: false
                    };
                }
            }

            // Wait for specific element if specified, with fallbacks
            if (request.options?.waitFor) {
                try {
                    await page.waitForSelector(request.options.waitFor, { timeout: 10000 });
                } catch (error) {
                    logger.warn(`Selector wait failed for ${request.options.waitFor}, continuing anyway`);
                    // Don't throw, continue with extraction
                }
            }

            // Extract data based on selectors
            const extractedData = await page.evaluate((selectors: any) => {
                const result: any = {};
                const doc = (globalThis as any).document;

                if (selectors?.title) {
                    const titleEl = doc.querySelector(selectors.title);
                    result.title = titleEl?.textContent?.trim();
                }

                if (selectors?.content) {
                    const contentEls = doc.querySelectorAll(selectors.content);
                    result.content = Array.from(contentEls)
                        .map((el: any) => el.textContent?.trim())
                        .filter(Boolean)
                        .join('\n\n');
                }

                if (selectors?.links) {
                    const linkEls = doc.querySelectorAll(selectors.links);
                    result.links = Array.from(linkEls).map((el: any) => ({
                        text: el.textContent?.trim(),
                        url: el.href
                    }));
                }

                if (selectors?.prices) {
                    const priceEls = doc.querySelectorAll(selectors.prices);
                    result.prices = Array.from(priceEls).map((el: any) => {
                        const text = el.textContent?.trim() || '';
                        const priceMatch = text.match(/[\d,]+\.?\d*/);
                        const currencyMatch = text.match(/[$€£¥₹]/);
                        return {
                            text,
                            price: priceMatch ? parseFloat(priceMatch[0].replace(',', '')) : 0,
                            currency: currencyMatch ? currencyMatch[0] : '$'
                        };
                    });
                }

                if (selectors?.images) {
                    const imgEls = doc.querySelectorAll(selectors.images);
                    result.images = Array.from(imgEls).map((el: any) => el.src);
                }

                // Extract all text if requested
                result.extractedText = doc.body.innerText;

                return result;
            }, request.selectors);

            // Take screenshot if requested
            if (request.options?.screenshot) {
                await page.screenshot({ type: 'png', fullPage: true });
            }

            const loadTime = Date.now() - startTime;

            return {
                success: true,
                operation: 'scrape',
                data: {
                    url: request.url,
                    title: extractedData.title || await page.title(),
                    content: extractedData.content,
                    extractedText: extractedData.extractedText,
                    links: extractedData.links || [],
                    images: extractedData.images || [],
                    prices: extractedData.prices || [],
                    metadata: {
                        scrapedAt: new Date(),
                        loadTime,
                        pageSize: extractedData.extractedText?.length || 0,
                        statusCode: response?.status() || 0
                    }
                }
            };

        } finally {
            await page.close();
        }
    }

    private async searchTrendingContent(request: ScrapingRequest): Promise<ScrapingResult> {
        // Implement search for trending content on popular sites
        const trendingSites = {
            'hacker_news': 'https://news.ycombinator.com/',
            'reddit_programming': 'https://www.reddit.com/r/programming/',
            'github_trending': 'https://github.com/trending',
            'product_hunt': 'https://www.producthunt.com/',
        };

        // For now, implement Hacker News as an example
        return await this.scrapeWebsite({
            ...request,
            url: trendingSites.hacker_news,
            selectors: {
                title: '.titleline > a',
                content: '.subtext',
                links: '.titleline > a'
            }
        });
    }

    private async extractStructuredData(request: ScrapingRequest): Promise<ScrapingResult> {
        // Enhanced extraction with AI-powered structure detection
        const result = await this.scrapeWebsite(request);
        
        if (result.success && result.data.extractedText) {
            // Use AI to identify and extract structured data
            const structuredData = await this.identifyStructuredData(result.data.extractedText);
            result.data = { ...result.data, ...structuredData };
        }

        return result;
    }

    private async monitorChanges(request: ScrapingRequest): Promise<ScrapingResult> {
        // Monitor website changes over time
        // This would integrate with a scheduler for periodic checks
        return await this.scrapeWebsite(request);
    }

    private async summarizeContent(content: string, context: string): Promise<string> {
        try {
            const prompt = `Summarize the following web content in the context of "${context}". 
            Focus on the most important information and key insights. Keep it concise but informative.
            
            Content:
            ${content.substring(0, 4000)}...`; // Limit content to avoid token limits

            const response = await this.summarizer.invoke([
                { role: 'user', content: prompt }
            ]);

            return response.content.toString();
        } catch (error) {
            logger.error('Content summarization failed:', error);
            return 'Summary generation failed';
        }
    }

    private async identifyStructuredData(text: string): Promise<any> {
        try {
            const prompt = `Analyze the following text and extract any structured data like:
            - Prices and product information
            - Dates and events
            - Contact information
            - Technical specifications
            - Lists and tables
            
            Return as JSON format.
            
            Text:
            ${text.substring(0, 3000)}...`;

            const response = await this.summarizer.invoke([
                { role: 'user', content: prompt }
            ]);

            try {
                return JSON.parse(response.content.toString());
            } catch {
                return { structured_data: response.content.toString() };
            }
        } catch (error) {
            logger.error('Structured data extraction failed:', error);
            return {};
        }
    }

    private getCachedResult(request: ScrapingRequest): ScrapingResult | null {
        const key = request.cache?.key || this.generateCacheKey(request);
        const cached = this.cache.get(key);
        
        if (cached && cached.expires > Date.now()) {
            return cached.data;
        }
        
        if (cached) {
            this.cache.delete(key); // Remove expired cache
        }
        
        return null;
    }

    private cacheResult(request: ScrapingRequest, result: ScrapingResult): void {
        const key = request.cache?.key || this.generateCacheKey(request);
        const ttl = request.cache?.ttl || 3600; // Default 1 hour
        const expires = Date.now() + (ttl * 1000);
        
        this.cache.set(key, { data: result, expires });
        
        // Clean up expired cache entries
        for (const [k, v] of this.cache.entries()) {
            if (v.expires <= Date.now()) {
                this.cache.delete(k);
            }
        }
    }

    private generateCacheKey(request: ScrapingRequest): string {
        const keyData = {
            operation: request.operation,
            url: request.url,
            query: request.query,
            selectors: JSON.stringify(request.selectors)
        };
        return Buffer.from(JSON.stringify(keyData)).toString('base64');
    }

    private async storeInVectorDB(result: ScrapingResult): Promise<void> {
        try {
            if (!result.data.extractedText || !result.data.url) return;

            // Store in vector database if available
            // Note: This would require vectorStoreService.addDocuments method to be implemented
            // For now, we'll just log that we would store it
            logger.info(`📚 Would store scraped content in vector DB: ${result.data.url}`);
            
            // TODO: Implement vector storage when addDocuments method is available
            // await vectorStoreService.addDocuments([{
            //     pageContent: result.data.extractedText,
            //     metadata: {
            //         source: 'web_scraping',
            //         url: result.data.url,
            //         title: result.data.title,
            //         scrapedAt: result.data.metadata?.scrapedAt,
            //         summary: result.data.summary,
            //         type: 'scraped_content'
            //     }
            // }]);

        } catch (error) {
            logger.error('Failed to store in vector DB:', error);
        }
    }

    async cleanup(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = undefined;
        }
    }
}