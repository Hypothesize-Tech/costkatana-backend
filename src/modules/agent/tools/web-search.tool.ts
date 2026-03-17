import { Injectable } from '@nestjs/common';
import { BaseAgentTool } from './base-agent.tool';
import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';

/**
 * Web Search Tool Service
 * Performs web searches for external information and current data
 * Ported from Express WebSearchTool with NestJS patterns
 */
@Injectable()
export class WebSearchToolService extends BaseAgentTool {
  constructor() {
    super(
      'web_search',
      `Search the web for external information and current data:
- search: Perform general web search
- scrape: Extract content from specific URLs
- extract: Extract structured data from web pages

Input should be a JSON string with:
{
  "operation": "search|scrape|extract",
  "query": "search query or URL",
  "options": {
    "deepContent": true/false,
    "maxResults": 10,
    "costDomains": true/false
  }
}`,
    );
  }

  protected async executeLogic(input: any): Promise<any> {
    try {
      const { operation, query, options = {} } = input;

      if (!query) {
        return this.createErrorResponse('web_search', 'Query is required');
      }

      switch (operation) {
        case 'search':
          return await this.performSearch(query, options);

        case 'scrape':
          return await this.scrapeContent(query, options);

        case 'extract':
          return await this.extractData(query, options);

        default:
          return this.createErrorResponse(
            'web_search',
            `Unsupported operation: ${operation}`,
          );
      }
    } catch (error: any) {
      this.logger.error('Web search operation failed', {
        error: error.message,
        input,
      });
      return this.createErrorResponse('web_search', error.message);
    }
  }

  private async performSearch(query: string, options: any): Promise<any> {
    try {
      const startTime = Date.now();
      const searchResults = await this.performGoogleCustomSearch(
        query,
        options,
      );
      const searchTime = (Date.now() - startTime) / 1000;

      // Filter by cost domains if requested
      let filteredResults = searchResults;
      if (options.costDomains) {
        filteredResults = searchResults.filter(
          (result) =>
            result.title.toLowerCase().includes('cost') ||
            result.snippet.toLowerCase().includes('cost') ||
            result.title.toLowerCase().includes('optimization') ||
            result.snippet.toLowerCase().includes('optimization') ||
            result.title.toLowerCase().includes('pricing') ||
            result.snippet.toLowerCase().includes('pricing'),
        );
      }

      const maxResults = Math.min(options.maxResults || 10, 20); // Google CSE limit
      const results = filteredResults.slice(0, maxResults);

      return this.createSuccessResponse('web_search', {
        operation: 'search',
        query,
        results: results.map((result) => ({
          ...result,
          searchEngine: 'google_custom_search',
        })),
        totalResults: filteredResults.length,
        filteredResults: options.costDomains ? results.length : undefined,
        searchTime,
        message: `Found ${results.length} results for "${query}"`,
      });
    } catch (error: any) {
      this.logger.error('Web search failed', { error: error.message, query });

      // CRITICAL: Do not fall back to simulated data in production
      // This provides fake results that could mislead users
      this.logger.error(
        'Web search unavailable - failing gracefully instead of providing simulated results',
      );
      return this.createErrorResponse(
        'web_search',
        'Web search is currently unavailable. Please try again later or contact support.',
      );
    }
  }

  private async performGoogleCustomSearch(
    query: string,
    options: any,
  ): Promise<any[]> {
    const apiKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
    const searchEngineId = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID;

    if (!apiKey || !searchEngineId) {
      throw new Error('Google Custom Search API credentials not configured');
    }

    const maxResults = Math.min(options.maxResults || 10, 10); // Google CSE allows max 10 per request
    const startIndex = 1; // Start from first result

    // Build search query with cost/optimization focus if requested
    let searchQuery = query;
    if (options.costDomains) {
      searchQuery = `${query} cost optimization pricing`;
    }

    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(searchQuery)}&num=${maxResults}&start=${startIndex}&safe=active`;

    try {
      const response: AxiosResponse = await axios.get(url, {
        timeout: 10000, // 10 second timeout
        headers: {
          'User-Agent': 'CostKatana-WebSearch/1.0',
        },
      });

      if (!response.data.items) {
        return [];
      }

      return response.data.items.map((item: any) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet,
        relevance: this.calculateGoogleRelevance(item, query),
        source: item.displayLink,
        pagemap: item.pagemap,
      }));
    } catch (error: any) {
      this.logger.error('Google Custom Search API error', {
        error: error.message,
        status: error.response?.status,
        query,
      });
      throw error;
    }
  }

  private calculateGoogleRelevance(item: any, query: string): number {
    // Google already provides relevance scoring, but we can enhance it
    let relevance = 0.8; // Base relevance for Google results

    const queryWords = query.toLowerCase().split(/\s+/);
    const title = item.title?.toLowerCase() || '';
    const snippet = item.snippet?.toLowerCase() || '';

    for (const word of queryWords) {
      if (title.includes(word)) relevance += 0.05;
      if (snippet.includes(word)) relevance += 0.03;
    }

    // Boost relevance for official documentation sites
    const officialDomains = [
      'aws.amazon.com',
      'anthropic.com',
      'openai.com',
      'google.com',
      'microsoft.com',
    ];
    if (officialDomains.some((domain) => item.displayLink?.includes(domain))) {
      relevance += 0.1;
    }

    return Math.min(relevance, 1.0);
  }

  private async scrapeContent(url: string, options: any): Promise<any> {
    try {
      const startTime = Date.now();

      // Perform real web scraping
      const scrapedContent = await this.performWebScraping(url, options);
      const scrapeTime = (Date.now() - startTime) / 1000;

      return this.createSuccessResponse('web_search', {
        operation: 'scrape',
        url,
        content: scrapedContent,
        scrapeTime,
        message: `Successfully scraped content from ${url}`,
      });
    } catch (error: any) {
      this.logger.error('Content scraping failed', {
        error: error.message,
        url,
      });

      // Do not fall back to simulated content in production - return error instead
      return this.createErrorResponse(
        'web_search',
        `Content scraping failed for ${url}: ${error.message}. Please try again later or use a different URL.`,
      );
    }
  }

  private async extractData(url: string, options: any): Promise<any> {
    try {
      const startTime = Date.now();

      // Perform real data extraction
      const extractedData = await this.performDataExtraction(url, options);
      const extractionTime = (Date.now() - startTime) / 1000;

      return this.createSuccessResponse('web_search', {
        operation: 'extract',
        url,
        extractedData,
        extractionTime,
        message: `Successfully extracted structured data from ${url}`,
      });
    } catch (error: any) {
      this.logger.error('Data extraction failed', {
        error: error.message,
        url,
      });

      // Do not fall back to simulated data in production - return error instead
      return this.createErrorResponse(
        'web_search',
        `Data extraction failed for ${url}: ${error.message}. Please try again later or use a different URL.`,
      );
    }
  }

  private async performWebScraping(url: string, options: any): Promise<any> {
    try {
      // Validate URL
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new Error('Invalid URL protocol');
      }

      // Make HTTP request with appropriate headers
      const response: AxiosResponse = await axios.get(url, {
        timeout: 15000, // 15 second timeout
        maxRedirects: 5,
        headers: {
          'User-Agent': 'CostKatana-WebScraper/1.0 (https://costkatana.com)',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          Connection: 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
      });

      if (!response.data || typeof response.data !== 'string') {
        throw new Error('Invalid response content');
      }

      // Parse HTML with cheerio
      const $ = cheerio.load(response.data);

      // Extract title
      const title =
        $('title').text().trim() ||
        $('h1').first().text().trim() ||
        'Untitled Page';

      // Remove script and style elements
      $('script, style, nav, header, footer, aside').remove();

      // Extract main content - try multiple selectors
      let content = '';
      const contentSelectors = [
        'main',
        '[role="main"]',
        '.content',
        '.main-content',
        'article',
        '.post-content',
        '.entry-content',
        '#content',
        '#main',
      ];

      for (const selector of contentSelectors) {
        const element = $(selector);
        if (element.length > 0 && element.text().trim().length > 100) {
          content = element.text().trim();
          break;
        }
      }

      // Fallback to body text if no main content found
      if (!content || content.length < 100) {
        content = $('body').text().trim();
      }

      // Clean up whitespace and normalize
      content = content.replace(/\s+/g, ' ').replace(/\n+/g, '\n').trim();

      // Limit content length for performance
      const maxLength = options.maxLength || 10000;
      if (content.length > maxLength) {
        content = content.substring(0, maxLength) + '...';
      }

      // Extract metadata
      const metaDescription =
        $('meta[name="description"]').attr('content') || '';
      const author =
        $('meta[name="author"]').attr('content') ||
        $('[class*="author"]').first().text().trim() ||
        'Unknown';
      const publishedDate =
        $('meta[property="article:published_time"]').attr('content') ||
        $('time').first().attr('datetime') ||
        '';

      // Calculate reading time (roughly 200 words per minute)
      const wordCount = content.split(/\s+/).length;
      const readingTime = Math.ceil(wordCount / 200);

      return {
        title,
        content,
        summary: metaDescription || content.substring(0, 200) + '...',
        metadata: {
          author,
          publishedDate,
          lastModified: response.headers['last-modified'] || '',
          wordCount,
          readingTime: `${readingTime} minute${readingTime !== 1 ? 's' : ''}`,
          contentType: response.headers['content-type'] || '',
          statusCode: response.status,
        },
      };
    } catch (error: any) {
      this.logger.error('Web scraping failed', {
        error: error.message,
        url,
        status: error.response?.status,
      });
      throw error;
    }
  }

  private generateScrapedContent(url: string, options: any): any {
    const urlContentMap: Record<string, any> = {
      'https://aws.amazon.com/bedrock/pricing/': {
        title: 'Amazon Bedrock Pricing',
        content: `Amazon Bedrock offers flexible pricing for AI models:

Nova Lite: $0.00015 per input token, $0.00015 per output token
Nova Pro: $0.0008 per input token, $0.0008 per output token
Claude 3 Haiku: $0.001 per input token, $0.001 per output token
Claude 3 Sonnet: $0.003 per input token, $0.003 per output token

Cost optimization strategies:
- Use Nova Lite for simple tasks to reduce costs by up to 95%
- Implement caching to avoid redundant requests
- Monitor usage patterns and set budget alerts
- Use provisioned throughput for predictable workloads`,
        metadata: {
          author: 'AWS Team',
          publishedDate: '2024-01-15',
          lastModified: '2024-03-01',
          wordCount: 2847,
          readingTime: '12 minutes',
        },
      },
      'https://www.anthropic.com/pricing': {
        title: 'Anthropic Claude Pricing',
        content: `Claude pricing structure and optimization tips:

Claude 3 Haiku: $0.001 per token (input and output combined)
Claude 3 Sonnet: $0.003 per token (input and output combined)

Cost optimization techniques:
- Optimize prompts to reduce token usage
- Use system prompts effectively
- Implement conversation context management
- Consider batch processing for multiple requests`,
        metadata: {
          author: 'Anthropic Team',
          publishedDate: '2024-02-01',
          wordCount: 1923,
          readingTime: '8 minutes',
        },
      },
    };

    // Return specific content for known URLs or generate generic content
    return (
      urlContentMap[url] || {
        title: `Content from ${url}`,
        content: `This is scraped content from ${url}. In a real implementation, this would contain the actual webpage content including headers, paragraphs, and other text elements.`,
        metadata: {
          author: 'Unknown',
          publishedDate: new Date().toISOString().split('T')[0],
          wordCount: this.generateDeterministicWordCount(url),
          readingTime: `${this.generateDeterministicReadingTime(url)} minutes`,
        },
      }
    );
  }

  private async performDataExtraction(url: string, options: any): Promise<any> {
    try {
      // First, scrape the webpage
      const scrapedContent = await this.performWebScraping(url, {
        ...options,
        maxLength: 50000,
      });

      if (!scrapedContent.content) {
        throw new Error('No content available for data extraction');
      }

      // Load HTML with cheerio for structured extraction
      const response = await axios.get(url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'CostKatana-DataExtractor/1.0 (https://costkatana.com)',
        },
      });

      const $ = cheerio.load(response.data);
      const extractedData: any = {
        extractedAt: new Date().toISOString(),
        url,
      };

      // Extract JSON-LD structured data
      const jsonLdScripts = $('script[type="application/ld+json"]');
      if (jsonLdScripts.length > 0) {
        extractedData.structuredData = [];
        jsonLdScripts.each((_, element) => {
          try {
            const jsonData = JSON.parse($(element).html() || '{}');
            extractedData.structuredData.push(jsonData);
          } catch (e) {
            // Skip invalid JSON-LD
          }
        });
      }

      // Extract pricing information
      const pricing = this.extractPricingData(
        $ as cheerio.CheerioAPI,
        scrapedContent.content,
      );
      if (pricing && Object.keys(pricing).length > 0) {
        extractedData.pricing = pricing;
      }

      // Extract features/lists
      const features = this.extractFeatures(
        $ as cheerio.CheerioAPI,
        scrapedContent.content,
      );
      if (features && features.length > 0) {
        extractedData.features = features;
      }

      // Extract contact information
      const contactInfo = this.extractContactInfo(
        $ as cheerio.CheerioAPI,
        scrapedContent.content,
      );
      if (contactInfo && Object.keys(contactInfo).length > 0) {
        extractedData.contact = contactInfo;
      }

      // Extract table data
      const tables = this.extractTableData($ as cheerio.CheerioAPI);
      if (tables && tables.length > 0) {
        extractedData.tables = tables;
      }

      // Extract metadata
      extractedData.metadata = {
        title: scrapedContent.title,
        description: $('meta[name="description"]').attr('content') || '',
        keywords: $('meta[name="keywords"]').attr('content') || '',
        author: $('meta[name="author"]').attr('content') || '',
        language:
          $('html').attr('lang') ||
          $('meta[http-equiv="content-language"]').attr('content') ||
          '',
        charset: $('meta[charset]').attr('charset') || '',
      };

      // Filter fields if options.fields is specified
      if (options && Array.isArray(options.fields)) {
        const filtered: any = {
          extractedAt: extractedData.extractedAt,
          url: extractedData.url,
        };
        options.fields.forEach((field: string) => {
          if (extractedData[field] !== undefined) {
            filtered[field] = extractedData[field];
          }
        });
        return filtered;
      }

      return extractedData;
    } catch (error: any) {
      this.logger.error('Data extraction failed', {
        error: error.message,
        url,
      });
      throw error;
    }
  }

  private extractPricingData($: cheerio.CheerioAPI, content: string): any {
    const pricing: any = {};

    // Look for pricing patterns in text
    const pricingPatterns = [
      /(\$[\d,]+(\.\d{2})?)\s*(?:per\s*(month|year|token|request))/gi,
      /(€[\d,]+(\.\d{2})?)\s*(?:per\s*(month|year|token|request))/gi,
      /(£[\d,]+(\.\d{2})?)\s*(?:per\s*(month|year|token|request))/gi,
    ];

    const foundPricing: any[] = [];
    pricingPatterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        foundPricing.push({
          amount: match[1],
          currency: match[1].charAt(0),
          period: match[3] || 'one-time',
          context: content.substring(
            Math.max(0, match.index - 50),
            match.index + 100,
          ),
        });
      }
    });

    if (foundPricing.length > 0) {
      pricing.found = foundPricing;
    }

    return pricing;
  }

  private extractFeatures($: cheerio.CheerioAPI, content: string): string[] {
    const features: string[] = [];

    // Extract from lists
    $('ul li, ol li').each((_, element) => {
      const text = $(element).text().trim();
      if (text.length > 10 && text.length < 200) {
        features.push(text);
      }
    });

    // Extract from definition lists
    $('dl dt').each((_, element) => {
      const term = $(element).text().trim();
      const definition = $(element).next('dd').text().trim();
      if (term && definition) {
        features.push(`${term}: ${definition}`);
      }
    });

    return features.slice(0, 20); // Limit to 20 features
  }

  private extractContactInfo($: cheerio.CheerioAPI, content: string): any {
    const contact: any = {};

    // Email patterns
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const emails = content.match(emailPattern);
    if (emails) {
      contact.emails = [...new Set(emails)]; // Remove duplicates
    }

    // Phone patterns
    const phonePattern =
      /(\+?\d{1,3}[-.\s]?)?\(?(\d{3})\)?[-.\s]?(\d{3})[-.\s]?(\d{4})/g;
    const phones = content.match(phonePattern);
    if (phones) {
      contact.phones = [...new Set(phones)];
    }

    return contact;
  }

  private extractTableData($: cheerio.CheerioAPI): any[] {
    const tables: any[] = [];

    $('table').each((tableIndex, tableElement) => {
      const table: any = {
        headers: [],
        rows: [],
      };

      // Extract headers
      $(tableElement)
        .find('th')
        .each((_, th) => {
          table.headers.push($(th).text().trim());
        });

      // Extract rows
      $(tableElement)
        .find('tr')
        .each((rowIndex, row) => {
          if (rowIndex === 0 && table.headers.length > 0) return; // Skip header row if already extracted

          const rowData: string[] = [];
          $(row)
            .find('td')
            .each((_, td) => {
              rowData.push($(td).text().trim());
            });

          if (rowData.length > 0) {
            table.rows.push(rowData);
          }
        });

      if (table.headers.length > 0 || table.rows.length > 0) {
        tables.push(table);
      }
    });

    return tables.slice(0, 5); // Limit to 5 tables
  }

  private generateExtractedData(url: string, options: any): any {
    const urlDataMap: Record<string, any> = {
      'https://aws.amazon.com/bedrock/pricing/': {
        pricing: {
          'amazon.nova-lite-v1:0': {
            input: 0.00015,
            output: 0.00015,
            unit: 'per token',
          },
          'amazon.nova-pro-v1:0': {
            input: 0.0008,
            output: 0.0008,
            unit: 'per token',
          },
          'anthropic.claude-3-haiku-20240307-v1:0': {
            input: 0.001,
            output: 0.001,
            unit: 'per token',
          },
          'anthropic.claude-3-sonnet-20240229-v1:0': {
            input: 0.003,
            output: 0.003,
            unit: 'per token',
          },
        },
        features: [
          'On-demand pricing',
          'Provisioned throughput',
          'Model customization',
          'Batch inference',
          'Cost allocation tags',
        ],
        regions: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'],
      },
      'https://www.anthropic.com/pricing': {
        pricing: {
          'claude-3-haiku': {
            input: 0.001,
            output: 0.001,
            unit: 'per token',
          },
          'claude-3-sonnet': {
            input: 0.003,
            output: 0.003,
            unit: 'per token',
          },
        },
        features: [
          'Pay-per-token',
          'No setup fees',
          'Global availability',
          'API access',
          'Batch processing',
        ],
        limits: {
          maxTokensPerRequest: 409600,
          maxRequestsPerMinute: 1000,
          maxRequestsPerDay: 10000,
        },
      },
    };

    let data = urlDataMap[url] || {
      pricing: {
        'generic-model': {
          input: this.generateDeterministicPricing(url, 'input'),
          output: this.generateDeterministicPricing(url, 'output'),
          unit: 'per token',
        },
      },
      features: ['API access', 'Usage tracking', 'Cost monitoring'],
      extractedAt: new Date().toISOString(),
    };

    // Allow filtering fields if options.fields is provided (e.g., ['pricing', 'features'])
    if (options && Array.isArray(options.fields)) {
      data = options.fields.reduce((filtered: any, field: string) => {
        if (data[field] !== undefined) {
          filtered[field] = data[field];
        }
        return filtered;
      }, {});
    }

    // Allow retrieving only the pricing for a specific model if options.model is provided
    if (
      options &&
      options.model &&
      data.pricing &&
      data.pricing[options.model]
    ) {
      // Return only the pricing for the chosen model
      return {
        pricing: {
          [options.model]: data.pricing[options.model],
        },
        ...(data.features ? { features: data.features } : {}),
        ...(data.regions ? { regions: data.regions } : {}),
        ...(data.limits ? { limits: data.limits } : {}),
      };
    }

    return data;
  }

  /**
   * Generate deterministic word count based on URL
   */
  private generateDeterministicWordCount(url: string): number {
    const hash = this.hashString(url);
    return 500 + (hash % 1000); // 500-1500 words
  }

  /**
   * Generate deterministic reading time based on URL
   */
  private generateDeterministicReadingTime(url: string): number {
    const hash = this.hashString(url);
    return 3 + (hash % 10); // 3-13 minutes
  }

  /**
   * Generate deterministic timing based on URL and operation
   */
  private generateDeterministicTiming(url: string, operation: string): number {
    const hash = this.hashString(url + operation);
    if (operation === 'scrape') {
      return 1 + (hash % 300) / 100; // 1-4 seconds
    } else if (operation === 'extract') {
      return 0.5 + (hash % 200) / 100; // 0.5-2.5 seconds
    }
    return 1.0;
  }

  /**
   * Generate deterministic pricing based on URL and type
   */
  private generateDeterministicPricing(
    url: string,
    type: 'input' | 'output',
  ): number {
    const hash = this.hashString(url + type);
    return (hash % 5000) / 1000000; // 0-0.005 per token
  }

  /**
   * Generate deterministic hash for consistent variance calculation
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}
