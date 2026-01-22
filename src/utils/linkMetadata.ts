import axios from 'axios';
import * as cheerio from 'cheerio';
import { WebSearchTool, type WebSearchRequest, type WebSearchResult } from '../tools/webSearch.tool';
import { loggingService } from '../services/logging.service';

// Singleton instance for web scraper
let webSearchInstance: WebSearchTool | null = null;

function getWebSearchInstance(): WebSearchTool {
  if (!webSearchInstance) {
    webSearchInstance = new WebSearchTool();
  }
  return webSearchInstance;
}

export interface LinkMetadata {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
  fullContent?: string; // Scraped full page content
  codeBlocks?: Array<{ language?: string; code: string }>; // Extracted code blocks
  images?: string[]; // All images on the page
  summary?: string; // AI-generated summary from WebScraperTool
  structuredData?: Record<string, unknown>; // Structured data extracted by AI
  relevanceScore?: number; // Relevance score from AI
  scrapingMethod?: 'axios-cheerio' | 'google-search-api' | 'puppeteer-ai'; // Which method was used
}

/**
 * Use Google Search API to find and extract content from URL
 * Fallback method when direct scraping is needed for complex sites
 */
async function extractWithWebScraperTool(url: string): Promise<LinkMetadata> {
  try {
    const webSearchTool = getWebSearchInstance();
    
    // Use direct URL scraping (no Puppeteer, just axios + cheerio)
    const searchRequest: WebSearchRequest = {
      operation: 'scrape', // Direct URL fetch
      url,
      cache: {
        enabled: true,
        key: `link_metadata_${Buffer.from(url).toString('base64').substring(0, 50)}`
      }
    };

    loggingService.info('Using WebScraperTool for link extraction', {
      url,
      method: 'google-search-api'
    });

    // Call the web scraper tool
    const resultString = await webSearchTool._call(JSON.stringify(searchRequest));
    const result: WebSearchResult = JSON.parse(resultString);

    if (!result.success) {
      throw new Error(result.error || 'Web scraping failed');
    }

    // Extract code blocks from the content
    const codeBlocks: Array<{ language?: string; code: string }> = [];
    if (result.data.extractedText) {
      // Look for code patterns in the extracted text
      const codePatterns = [
        /```(\w+)?\n([\s\S]*?)```/g, // Markdown code blocks
        /<pre><code(?:\s+class="language-(\w+)")?>([\s\S]*?)<\/code><\/pre>/g, // HTML code blocks
        /<code(?:\s+class="language-(\w+)")?>([\s\S]*?)<\/code>/g, // Inline code
      ];

      for (const pattern of codePatterns) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(result.data.extractedText)) !== null) {
          const language = match[1];
          const code = match[2];
          if (code && code.trim().length > 10) {
            codeBlocks.push({ 
              language, 
              code: code.trim().substring(0, 2000) 
            });
          }
        }
      }
    }

    const urlObj = new URL(url);
    
    return {
      url,
      title: result.data.title ?? urlObj.hostname.replace('www.', ''),
      description: result.data.summary ?? result.data.extractedText?.substring(0, 300),
      fullContent: result.data.extractedText?.substring(0, 15000),
      codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
      siteName: urlObj.hostname.replace('www.', ''),
      type: 'website',
      summary: result.data.summary, // AI-generated summary
      scrapingMethod: 'google-search-api',
    };
  } catch (error) {
    loggingService.error('Web scraping failed', {
      url,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error; // Re-throw to fallback to cheerio method
  }
}

/**
 * Extract metadata from a URL using Open Graph tags and HTML meta tags
 * Works for any public link that can be accessed
 * Also scrapes full content including text, code blocks, and images
 * 
 * Strategy:
 * 1. Use fast axios + cheerio approach as default
 * 2. Fallback to WebScraperTool if cheerio fails
 */
export async function extractLinkMetadata(url: string, useAdvancedScraping: boolean = false): Promise<LinkMetadata> {
  // Try web scraper tool if explicitly requested
  if (useAdvancedScraping) {
    try {
      loggingService.debug('Using web scraper tool', {
        url,
        reason: 'explicitly requested'
      });
      return await extractWithWebScraperTool(url);
    } catch (error) {
      loggingService.warn('Web scraper failed, falling back to cheerio', {
        url,
        error: error instanceof Error ? error.message : String(error)
      });
      // Continue to fallback method
    }
  }

  // Fallback to fast axios + cheerio method
  try {
    // Validate URL
    const urlObj = new URL(url);
    
    // Fetch the page with a timeout for any public link
    const response = await axios.get(url, {
      timeout: 10000, // Increased timeout for content-heavy pages
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CostKatanaBot/1.0; +https://costkatana.com)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      maxRedirects: 5,
      validateStatus: (status) => status < 400, // Accept any status < 400
    });

    const html = typeof response.data === 'string' ? response.data : String(response.data);
    const $ = cheerio.load(html);

    // Extract Open Graph tags (preferred - most modern sites use these)
    const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
    const ogDescription = $('meta[property="og:description"]').attr('content')?.trim();
    const ogImage = $('meta[property="og:image"]').attr('content')?.trim();
    const ogSiteName = $('meta[property="og:site_name"]').attr('content')?.trim();
    const ogType = $('meta[property="og:type"]').attr('content')?.trim();

    // Fallback to Twitter Card tags
    const twitterTitle = $('meta[name="twitter:title"]').attr('content')?.trim();
    const twitterDescription = $('meta[name="twitter:description"]').attr('content')?.trim();
    const twitterImage = $('meta[name="twitter:image"]').attr('content')?.trim();

    // Fallback to standard HTML meta tags
    const metaDescription = $('meta[name="description"]').attr('content')?.trim();
    const htmlTitle = $('title').text()?.trim();
    
    // Try to get h1 as additional fallback
    const h1Text = $('h1').first().text()?.trim();

    // EXTRACT FULL CONTENT
    // Remove unwanted elements
    $('script, style, nav, header, footer, .nav, .navbar, .header, .footer, .sidebar, .cookie-banner, .ad, .advertisement, .social-share, .comments').remove();
    
    // Extract main content - try multiple selectors
    let fullContent = '';
    const contentSelectors = ['main', 'article', '.content', '.main-content', '.post-content', '.article-content', 'body'];
    
    for (const selector of contentSelectors) {
      const element = $(selector).first();
      if (element.length > 0) {
        fullContent = element.text();
        break;
      }
    }
    
    // Fallback to body if no specific content area found
    if (!fullContent || fullContent.length < 100) {
      fullContent = $('body').text();
    }
    
    // Clean up the content
    fullContent = fullContent
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .replace(/\n\s*\n/g, '\n')  // Remove empty lines
      .trim()
      .substring(0, 15000); // Limit to 15000 chars to avoid token limits

    // EXTRACT CODE BLOCKS
    const codeBlocks: Array<{ language?: string; code: string }> = [];
    
    // Look for code in pre/code tags
    $('pre code, pre, code.block, .code-block').each((_i, elem) => {
      const $elem = $(elem);
      const code = $elem.text().trim();
      
      if (code && code.length > 10) { // Only include meaningful code blocks
        // Try to detect language from class names
        const classes = $elem.attr('class') ?? '';
        const langMatch = classes.match(/language-(\w+)|lang-(\w+)|(\w+)-code/);
        const language = langMatch ? (langMatch[1] || langMatch[2] || langMatch[3]) : undefined;
        
        codeBlocks.push({ language, code: code.substring(0, 2000) }); // Limit each code block
      }
    });

    // EXTRACT ALL IMAGES
    const images: string[] = [];
    $('img').each((_i, elem) => {
      const src = $(elem).attr('src');
      if (src) {
        // Make relative URLs absolute
        try {
          const absoluteUrl = new URL(src, url).href;
          images.push(absoluteUrl);
        } catch {
          // Skip invalid URLs
        }
      }
    });

    // For GitHub repositories, extract repository info
    if (urlObj.hostname.includes('github.com')) {
      const pathParts = urlObj.pathname.split('/').filter(p => p);
      if (pathParts.length >= 2) {
        const owner = pathParts[0];
        const repo = pathParts[1];
        const repoPath = `${owner}/${repo}`;
        
        // Try to extract description from meta tags or use default
        const repoDescription = ogDescription ?? twitterDescription ?? metaDescription ?? 
          `GitHub repository: ${repoPath}. This is a code repository hosted on GitHub.`;
        
        return {
          url,
          title: ogTitle ?? twitterTitle ?? htmlTitle ?? `${owner}/${repo}`,
          description: repoDescription,
          image: ogImage ?? twitterImage,
          siteName: 'GitHub',
          type: 'repository',
          fullContent, // Include scraped content
          codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
          images: images.length > 0 ? images.slice(0, 10) : undefined, // Limit to 10 images
        };
      }
    }

    // For YouTube videos, extract video ID and construct metadata
    if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
      const videoId = extractYouTubeVideoId(url);
      if (videoId) {
        return {
          url,
          title: ogTitle ?? twitterTitle ?? htmlTitle ?? 'YouTube Video',
          description: ogDescription ?? twitterDescription ?? metaDescription,
          image: ogImage ?? twitterImage ?? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          siteName: 'YouTube',
          type: 'video',
          fullContent: fullContent.length > 100 ? fullContent : undefined,
          images: images.length > 0 ? images.slice(0, 5) : undefined,
        };
      }
    }

    // Build metadata object with fallbacks for any public link
    // This works for all public websites that can be accessed
    const metadata: LinkMetadata = {
      url,
      title: ogTitle ?? twitterTitle ?? htmlTitle ?? h1Text ?? urlObj.hostname.replace('www.', ''),
      description: ogDescription ?? twitterDescription ?? metaDescription ?? 
        `Content from ${urlObj.hostname.replace('www.', '')}. This is a public link that can be accessed.`,
      image: ogImage ?? twitterImage,
      siteName: ogSiteName ?? urlObj.hostname.replace('www.', ''),
      type: ogType ?? 'website',
      fullContent: fullContent.length > 100 ? fullContent : undefined, // Only include if we got meaningful content
      codeBlocks: codeBlocks.length > 0 ? codeBlocks : undefined,
      images: images.length > 0 ? images.slice(0, 10) : undefined, // Limit to 10 images
      scrapingMethod: 'axios-cheerio',
    };

    return metadata;
  } catch (error) {
    // Fallback to basic URL info if fetch fails (network error, timeout, etc.)
    loggingService.warn('Cheerio-based scraping failed, returning basic metadata', {
      url,
      error: error instanceof Error ? error.message : String(error)
    });
    
    const urlObj = new URL(url);
    
    // Try to extract meaningful info from URL path
    const pathParts = urlObj.pathname.split('/').filter(p => p);
    const lastPathPart = pathParts[pathParts.length - 1];
    
    return {
      url,
      title: lastPathPart ? `${urlObj.hostname.replace('www.', '')} - ${lastPathPart}` : urlObj.hostname.replace('www.', ''),
      description: `Public link to ${urlObj.hostname.replace('www.', '')}. Metadata extraction failed, but this is a public link.`,
      siteName: urlObj.hostname.replace('www.', ''),
      type: 'website',
      scrapingMethod: 'axios-cheerio',
    };
  }
}
 
/**
 * Extract YouTube video ID from various YouTube URL formats
 */
function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/,
    /youtube\.com\/v\/([^&?/]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Validate if a string is a valid URL
 */
export function isValidUrl(urlString: string): boolean {
  try {
    new URL(urlString);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract all URLs from a text string
 */
export function extractUrlsFromText(text: string): string[] {
  const urlPattern = /(https?:\/\/[^\s<>"{}|\\^`[\]]+|www\.[^\s<>"{}|\\^`[\]]+)/gi;
  const matches = text.match(urlPattern);
  
  if (!matches) return [];
  
  return matches.map((url: string) => {
    // Add protocol if missing
    return url.startsWith('http') ? url : `https://${url}`;
  });
}

