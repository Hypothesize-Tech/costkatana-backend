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
}
