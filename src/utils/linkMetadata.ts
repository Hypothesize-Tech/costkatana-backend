import axios from 'axios';
import * as cheerio from 'cheerio';

export interface LinkMetadata {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
}

/**
 * Extract metadata from a URL using Open Graph tags and HTML meta tags
 * Works for any public link that can be accessed
 */
export async function extractLinkMetadata(url: string): Promise<LinkMetadata> {
  try {
    // Validate URL
    const urlObj = new URL(url);
    
    // Fetch the page with a timeout for any public link
    const response = await axios.get(url, {
      timeout: 5000,
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
    };

    return metadata;
  } catch (error) {
    // Fallback to basic URL info if fetch fails (network error, timeout, etc.)
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

