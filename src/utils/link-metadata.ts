import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as cheerio from 'cheerio';

@Injectable()
export class LinkMetadataService {
  private readonly logger = new Logger(LinkMetadataService.name);

  constructor(private readonly httpService: HttpService) {}

  extractUrlsFromText(text: string): string[] {
    const urlPattern =
      /(https?:\/\/[^\s<>"{}|\\^`[\]]+|www\.[^\s<>"{}|\\^`[\]]+)/gi;
    const matches = text.match(urlPattern);

    if (!matches) return [];

    return matches.map((url: string) => {
      // Add protocol if missing
      return url.startsWith('http') ? url : `https://${url}`;
    });
  }

  isValidUrl(urlString: string): boolean {
    try {
      new URL(urlString);
      return true;
    } catch {
      return false;
    }
  }

  async extractLinkMetadata(url: string): Promise<LinkMetadata> {
    try {
      // Validate URL
      const urlObj = new URL(url);

      // Fetch the page with a timeout
      const response = await firstValueFrom(
        this.httpService.get(url, {
          timeout: 10000,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (compatible; CostKatanaBot/1.0; +https://costkatana.com)',
            Accept:
              'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          maxRedirects: 5,
        }),
      );

      const html =
        typeof response.data === 'string'
          ? response.data
          : String(response.data);

      // Parse HTML for metadata using cheerio for robust HTML parsing
      const metadata = this.parseHtmlMetadata(html, url);

      return {
        url,
        title: metadata.title || urlObj.hostname.replace('www.', ''),
        description:
          metadata.description ||
          `Content from ${urlObj.hostname.replace('www.', '')}`,
        siteName: metadata.siteName || urlObj.hostname.replace('www.', ''),
        type: metadata.type || 'website',
        image: metadata.image,
      };
    } catch (error) {
      this.logger.warn(
        'Link metadata extraction failed, returning basic info',
        {
          url,
          error: error instanceof Error ? error.message : String(error),
        },
      );

      const urlObj = new URL(url);

      return {
        url,
        title: urlObj.hostname.replace('www.', ''),
        description: `Public link to ${urlObj.hostname.replace('www.', '')}`,
        siteName: urlObj.hostname.replace('www.', ''),
        type: 'website',
      };
    }
  }

  private parseHtmlMetadata(html: string, url: string): Partial<LinkMetadata> {
    const metadata: Partial<LinkMetadata> = {};

    try {
      const $ = cheerio.load(html);

      // Extract title (prefer OG title, fallback to regular title)
      const ogTitle = $('meta[property="og:title"]').attr('content');
      if (ogTitle) {
        metadata.title = ogTitle.trim();
      } else {
        const title = $('title').text();
        if (title) {
          metadata.title = title.trim();
        }
      }

      // Extract description (prefer OG description, fallback to meta description)
      const ogDesc = $('meta[property="og:description"]').attr('content');
      if (ogDesc) {
        metadata.description = ogDesc.trim();
      } else {
        const desc = $('meta[name="description"]').attr('content');
        if (desc) {
          metadata.description = desc.trim();
        }
      }

      // Extract Open Graph metadata
      metadata.image = $('meta[property="og:image"]').attr('content')?.trim();
      metadata.siteName = $('meta[property="og:site_name"]')
        .attr('content')
        ?.trim();
      metadata.type =
        $('meta[property="og:type"]').attr('content')?.trim() || 'website';

      // Extract Twitter Card metadata as fallback
      if (!metadata.image) {
        metadata.image =
          $('meta[name="twitter:image"]').attr('content')?.trim() ||
          $('meta[property="twitter:image"]').attr('content')?.trim();
      }

      if (!metadata.title) {
        metadata.title =
          $('meta[name="twitter:title"]').attr('content')?.trim() ||
          $('meta[property="twitter:title"]').attr('content')?.trim();
      }

      if (!metadata.description) {
        metadata.description =
          $('meta[name="twitter:description"]').attr('content')?.trim() ||
          $('meta[property="twitter:description"]').attr('content')?.trim();
      }
    } catch (cheerioError) {
      this.logger.warn('Cheerio not available, falling back to regex parsing', {
        error:
          cheerioError instanceof Error
            ? cheerioError.message
            : String(cheerioError),
      });

      // Fallback to simplified regex parsing (development only)
      this.fallbackRegexParsing(html, metadata);
    }

    return metadata;
  }

  /**
   * Fallback regex parsing when cheerio is not available (development only)
   */
  private fallbackRegexParsing(
    html: string,
    metadata: Partial<LinkMetadata>,
  ): void {
    // Simplified HTML parsing - extract basic meta tags (development fallback only)

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && !metadata.title) {
      metadata.title = titleMatch[1].trim();
    }

    // Extract meta description
    const descMatch = html.match(
      /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    );
    if (descMatch && !metadata.description) {
      metadata.description = descMatch[1].trim();
    }

    // Extract Open Graph tags as fallback
    if (!metadata.title) {
      const ogTitleMatch = html.match(
        /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      );
      if (ogTitleMatch) {
        metadata.title = ogTitleMatch[1].trim();
      }
    }

    if (!metadata.description) {
      const ogDescMatch = html.match(
        /<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      );
      if (ogDescMatch) {
        metadata.description = ogDescMatch[1].trim();
      }
    }

    if (!metadata.image) {
      const ogImageMatch = html.match(
        /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      );
      if (ogImageMatch) {
        metadata.image = ogImageMatch[1].trim();
      }
    }

    if (!metadata.siteName) {
      const ogSiteMatch = html.match(
        /<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      );
      if (ogSiteMatch) {
        metadata.siteName = ogSiteMatch[1].trim();
      }
    }

    if (!metadata.type) {
      const ogTypeMatch = html.match(
        /<meta[^>]*property=["']og:type["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      );
      if (ogTypeMatch) {
        metadata.type = ogTypeMatch[1].trim();
      }
    }
  }
}

export interface LinkMetadata {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
}
