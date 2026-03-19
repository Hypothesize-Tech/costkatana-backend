import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { BedrockService } from '../../bedrock/bedrock.service';
import { firstValueFrom, catchError, timeout } from 'rxjs';

/**
 * TrendingDetectorService - Advanced trend detection with external API integration
 *
 * Environment Variables Required:
 * - SERP_API_KEY: For Google Trends data via SerpApi
 * - NEWS_API_KEY: For news trends via NewsAPI
 * - TWITTER_API_KEY: For Twitter trends (optional)
 * - TWITTER_API_SECRET: For Twitter API authentication (optional)
 *
 * Features:
 * - Multi-source trend aggregation (Google Trends, News, Twitter)
 * - Intelligent scoring based on recency, reputation, and relevance
 * - Caching to reduce API calls and improve performance
 * - Fallback mechanisms when APIs are unavailable
 * - Cross-source validation for higher confidence
 */

interface TrendData {
  topic: string;
  score: number;
  timestamp: Date;
  source: 'google' | 'twitter' | 'news' | 'reddit';
  region?: string;
  category?: string;
}

interface TrendAnalysis {
  isTrending: boolean;
  confidence: number;
  trends: TrendData[];
  recommendedSearch: boolean;
  reasoning: string;
}

interface CachedTrend {
  data: TrendAnalysis;
  timestamp: number;
  ttl: number;
}

@Injectable()
export class TrendingDetectorService {
  private readonly logger = new Logger(TrendingDetectorService.name);

  // Basic keyword list for quick checks
  private readonly trendingKeywords = [
    'trending',
    'news',
    'current',
    'latest',
    'real-time',
    'happening',
    'today',
    'this week',
    'breaking',
    'hot',
    'viral',
    "what's new",
    "what's happening",
    'recent',
    'now',
    'live',
    'update',
    'fresh',
    'newest',
    'upcoming',
  ];

  // Time-based keywords that suggest temporal relevance
  private readonly temporalKeywords = [
    'today',
    'this week',
    'this month',
    'recently',
    'lately',
    'now',
    'current',
    'latest',
    'breaking',
    'just now',
    'right now',
  ];

  // Question words that often indicate interest in current information
  private readonly questionKeywords = [
    "what's",
    'what is',
    'what are',
    'what happened',
    "what's happening",
    "what's going on",
    "what's new",
    "what's trending",
  ];

  // Cache for trend data
  private trendCache = new Map<string, CachedTrend>();
  private readonly CACHE_TTL = 15 * 60 * 1000; // 15 minutes
  private readonly API_TIMEOUT = 5000; // 5 seconds

  constructor(private readonly httpService: HttpService) {
    // Clean up cache periodically
    setInterval(() => this.cleanupCache(), 10 * 60 * 1000); // Every 10 minutes
  }

  /**
   * Quick heuristic check to determine if a message is asking about trending or current topics
   * that would benefit from web search before AI generation.
   *
   * @param message The user message to analyze
   * @returns true if the message contains trending/current topic keywords
   */
  quickCheck(message: string): boolean {
    if (!message) return false;

    const lowerMessage = message.toLowerCase();

    // Check for trending keywords
    return this.trendingKeywords.some((keyword) =>
      lowerMessage.includes(keyword.toLowerCase()),
    );
  }

  /**
   * Advanced trend detection with external API integration
   *
   * @param message The user message to analyze
   * @param options Additional options for trend detection
   * @returns Comprehensive trend analysis
   */
  async analyzeTrends(
    message: string,
    options: {
      region?: string;
      category?: string;
      maxResults?: number;
      includeExternal?: boolean;
    } = {},
  ): Promise<TrendAnalysis> {
    const cacheKey = `${message}_${options.region || 'global'}_${options.category || 'all'}`;

    // Check cache first
    const cached = this.trendCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < cached.ttl) {
      return cached.data;
    }

    try {
      const analysis = await this.performTrendAnalysis(message, options);

      // Cache the result
      this.trendCache.set(cacheKey, {
        data: analysis,
        timestamp: Date.now(),
        ttl: this.CACHE_TTL,
      });

      return analysis;
    } catch (error) {
      this.logger.error('Failed to analyze trends', {
        error: error instanceof Error ? error.message : String(error),
        message: message.substring(0, 100),
      });

      // Return basic keyword-based analysis as fallback
      return this.fallbackAnalysis(message);
    }
  }

  /**
   * Extract trending topics from a message using NLP techniques
   *
   * @param message The message to analyze
   * @returns Array of potential trending topics
   */
  extractTrendingTopics(message: string): string[] {
    if (!message) return [];

    // Extract potential topics using various heuristics
    const topics: string[] = [];

    // Look for quoted phrases (often specific topics)
    const quotedMatches = message.match(/"([^"]+)"/g);
    if (quotedMatches) {
      topics.push(...quotedMatches.map((match) => match.slice(1, -1)));
    }

    // Look for hashtags
    const hashtagMatches = message.match(/#(\w+)/g);
    if (hashtagMatches) {
      topics.push(...hashtagMatches.map((match) => match.slice(1)));
    }

    // Extract nouns and proper nouns (simplified approach)
    const words = message.split(/\s+/);
    for (const word of words) {
      // Skip common words, punctuation, and very short words
      if (word.length < 3 || /^[a-z]/i.test(word) === false) continue;
      if (this.isCommonWord(word.toLowerCase())) continue;

      // Capitalized words are likely proper nouns/topics
      if (/^[A-Z]/.test(word)) {
        topics.push(word);
      }
    }

    // Remove duplicates and limit results
    return [...new Set(topics)].slice(0, 5);
  }

  /**
   * Check if message contains temporal indicators
   *
   * @param message The message to check
   * @returns true if message has temporal relevance
   */
  hasTemporalRelevance(message: string): boolean {
    if (!message) return false;

    const lowerMessage = message.toLowerCase();
    return this.temporalKeywords.some((keyword) =>
      lowerMessage.includes(keyword.toLowerCase()),
    );
  }

  /**
   * Check if message is a question about current events
   *
   * @param message The message to check
   * @returns true if message appears to be asking about current events
   */
  isCurrentEventsQuestion(message: string): boolean {
    if (!message) return false;

    const lowerMessage = message.toLowerCase();

    // Check for question words combined with temporal keywords
    return this.questionKeywords.some((qWord) =>
      this.temporalKeywords.some(
        (tWord) =>
          lowerMessage.includes(qWord.toLowerCase()) &&
          lowerMessage.includes(tWord.toLowerCase()),
      ),
    );
  }

  /**
   * Get trending topics from external APIs
   *
   * @param options Configuration for trend fetching
   * @returns Array of current trending topics
   */
  private async fetchExternalTrends(
    options: {
      region?: string;
      category?: string;
      maxResults?: number;
    } = {},
  ): Promise<TrendData[]> {
    const trends: TrendData[] = [];

    try {
      // Try Google Trends API (requires API key)
      const googleTrends = await this.fetchGoogleTrends(options);
      trends.push(...googleTrends);
    } catch (error) {
      this.logger.warn('Failed to fetch Google Trends', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      // Try News API for current news
      const newsTrends = await this.fetchNewsTrends(options);
      trends.push(...newsTrends);
    } catch (error) {
      this.logger.warn('Failed to fetch news trends', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      // Try Twitter/X trends for social media buzz
      const twitterTrends = await this.fetchTwitterTrends(options);
      trends.push(...twitterTrends);
    } catch (error) {
      this.logger.warn('Failed to fetch Twitter trends', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Sort by score and limit results
    return trends
      .sort((a, b) => b.score - a.score)
      .slice(0, options.maxResults || 10);
  }

  /**
   * Fetch trends from Google Trends API
   */
  private async fetchGoogleTrends(options: {
    region?: string;
    category?: string;
  }): Promise<TrendData[]> {
    try {
      const trends: TrendData[] = [];

      // Use SerpApi or similar service for Google Trends data
      const serpApiKey = process.env.SERP_API_KEY;
      if (!serpApiKey) {
        throw new InternalServerErrorException(
          'SERP_API_KEY not configured. Trending data requires SerpApi; set SERP_API_KEY in environment.',
        );
      }

      // Google Trends doesn't have an official API, so we use SerpApi
      const serpApiUrl = 'https://serpapi.com/search.json';

      const params = new URLSearchParams({
        engine: 'google_trends',
        q: options.category || 'all',
        geo: this.mapRegionToGeo(options.region),
        api_key: serpApiKey,
        data_type: 'TIMESERIES',
      });

      const response = await firstValueFrom(
        this.httpService.get(`${serpApiUrl}?${params}`).pipe(
          timeout(this.API_TIMEOUT),
          catchError((error) => {
            this.logger.warn('SerpApi request failed', {
              error: error instanceof Error ? error.message : String(error),
            });
            throw new InternalServerErrorException(
              `SerpApi request failed: ${error instanceof Error ? error.message : String(error)}. Trending data unavailable.`,
            );
          }),
        ),
      );

      if (response?.data?.trending_searches) {
        // Parse SerpApi Google Trends response
        const trendingSearches = response.data.trending_searches;

        for (const search of trendingSearches.slice(0, 10)) {
          if (search.query && search.traffic) {
            trends.push({
              topic: search.query,
              score: this.normalizeTrafficScore(search.traffic),
              timestamp: new Date(),
              source: 'google',
              region: options.region,
              category: options.category,
            });
          }
        }
      }

      // If no trends found from API, fail rather than returning mock data
      if (trends.length === 0) {
        throw new InternalServerErrorException(
          'No trending data returned from SerpApi. Trending data unavailable.',
        );
      }

      return trends;
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.warn('Google Trends API failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InternalServerErrorException(
        `Google Trends API failed: ${error instanceof Error ? error.message : String(error)}. Set SERP_API_KEY for trending data.`,
      );
    }
  }

  /**
   * Get fallback trend data when APIs are unavailable
   */
  private getFallbackTrends(options: {
    region?: string;
    category?: string;
  }): TrendData[] {
    const fallbackTrends = [
      {
        topic: 'Artificial Intelligence',
        score: 85,
        timestamp: new Date(),
        source: 'google' as const,
        region: options.region || 'global',
        category: 'technology',
      },
      {
        topic: 'Climate Change',
        score: 72,
        timestamp: new Date(),
        source: 'google' as const,
        region: options.region || 'global',
        category: 'environment',
      },
      {
        topic: 'Cryptocurrency',
        score: 68,
        timestamp: new Date(),
        source: 'google' as const,
        region: options.region || 'global',
        category: 'finance',
      },
      {
        topic: 'Electric Vehicles',
        score: 65,
        timestamp: new Date(),
        source: 'google' as const,
        region: options.region || 'global',
        category: 'automotive',
      },
      {
        topic: 'Remote Work',
        score: 58,
        timestamp: new Date(),
        source: 'google' as const,
        region: options.region || 'global',
        category: 'business',
      },
    ];

    // Filter by category if specified
    if (options.category && options.category !== 'all') {
      return fallbackTrends.filter(
        (trend) =>
          trend.category?.toLowerCase() === options.category?.toLowerCase(),
      );
    }

    return fallbackTrends;
  }

  /**
   * Map region codes to Google Trends geo codes
   */
  private mapRegionToGeo(region?: string): string {
    if (!region || region === 'global') return '';

    const regionMap: Record<string, string> = {
      us: 'US',
      uk: 'GB',
      de: 'DE',
      fr: 'FR',
      jp: 'JP',
      ca: 'CA',
      au: 'AU',
      in: 'IN',
      br: 'BR',
      mx: 'MX',
      es: 'ES',
      it: 'IT',
      nl: 'NL',
      se: 'SE',
      no: 'NO',
      dk: 'DK',
      fi: 'FI',
      ru: 'RU',
      cn: 'CN',
      kr: 'KR',
      sg: 'SG',
      my: 'MY',
      th: 'TH',
      id: 'ID',
      ph: 'PH',
      vn: 'VN',
      za: 'ZA',
      eg: 'EG',
      ng: 'NG',
      ke: 'KE',
      gh: 'GH',
    };

    return regionMap[region.toLowerCase()] || '';
  }

  /**
   * Calculate news article score based on various factors
   */
  private calculateNewsScore(
    article: any,
    options: {
      region?: string;
      category?: string;
    },
  ): number {
    let score = 50; // Base score

    // Factor 1: Recency (newer articles get higher scores)
    const publishedDate = new Date(article.publishedAt);
    const hoursSincePublished =
      (Date.now() - publishedDate.getTime()) / (1000 * 60 * 60);

    if (hoursSincePublished < 1)
      score += 25; // Less than 1 hour
    else if (hoursSincePublished < 6)
      score += 20; // Less than 6 hours
    else if (hoursSincePublished < 24)
      score += 15; // Less than 24 hours
    else if (hoursSincePublished < 72)
      score += 10; // Less than 3 days
    else if (hoursSincePublished < 168) score += 5; // Less than 1 week
    // Older than 1 week gets no recency bonus

    // Factor 2: Source reputation (major news sources get higher scores)
    const reputableSources = [
      'bbc',
      'cnn',
      'reuters',
      'ap',
      'associated press',
      'nyt',
      'new york times',
      'wsj',
      'wall street journal',
      'guardian',
      'washington post',
      'bloomberg',
      'forbes',
      'techcrunch',
      'wired',
      'arstechnica',
    ];

    const sourceName = (article.source?.name || '').toLowerCase();
    if (reputableSources.some((source) => sourceName.includes(source))) {
      score += 15;
    }

    // Factor 3: Title quality (shorter, more descriptive titles get higher scores)
    const titleLength = article.title?.length || 0;
    if (titleLength > 0 && titleLength < 100) score += 10;
    else if (titleLength < 150) score += 5;

    // Factor 4: Content availability (articles with descriptions get bonus)
    if (article.description && article.description.length > 50) {
      score += 5;
    }

    // Factor 5: Category relevance
    if (options.category && options.category !== 'general') {
      // This would require more sophisticated category matching
      // For now, give a small bonus if category is specified
      score += 5;
    }

    // Factor 6: Regional relevance
    if (options.region && options.region !== 'us') {
      // Articles from the specified region get a bonus
      // This is a simplified check - in reality you'd check article source location
      score += 5;
    }

    return Math.min(Math.max(score, 0), 100);
  }

  /**
   * Clean and normalize article titles
   */
  private cleanArticleTitle(title: string): string {
    if (!title) return '';

    // Remove common prefixes/suffixes that clutter titles
    let cleaned = title
      .replace(/^(Breaking|URGENT|EXCLUSIVE|UPDATE):\s*/i, '')
      .replace(
        /\s*-\s*(BBC|CNN|Reuters|AP|Associated Press|NYT|WSJ|Guardian|Washington Post)$/i,
        '',
      )
      .replace(
        /\s*\|\s*(BBC|CNN|Reuters|AP|Associated Press|NYT|WSJ|Guardian|Washington Post)$/i,
        '',
      )
      .trim();

    // Limit length to prevent overly long titles
    if (cleaned.length > 150) {
      cleaned = cleaned.substring(0, 147) + '...';
    }

    return cleaned;
  }

  /**
   * Normalize traffic scores from different formats
   */
  private normalizeTrafficScore(traffic: string | number): number {
    if (typeof traffic === 'number') {
      return Math.min(Math.max(traffic, 0), 100);
    }

    if (typeof traffic === 'string') {
      // Handle formats like "+1,000%", "1K+", "<5", etc.
      const cleanTraffic = traffic.replace(/[+,K,%]/g, '').trim();

      if (cleanTraffic.includes('<')) {
        return parseInt(cleanTraffic.replace('<', '')) || 10;
      }

      const numValue = parseInt(cleanTraffic);
      if (!isNaN(numValue)) {
        // Scale large numbers down to 0-100 range
        if (numValue > 100) {
          return Math.min(Math.log10(numValue) * 20, 100);
        }
        return numValue;
      }
    }

    // Default score for unrecognized formats
    return 50;
  }

  /**
   * Fetch trends from news APIs
   */
  private async fetchNewsTrends(options: {
    region?: string;
    category?: string;
  }): Promise<TrendData[]> {
    try {
      // Use a free news API like NewsAPI.org
      const apiKey = process.env.NEWS_API_KEY;
      if (!apiKey) {
        throw new Error('News API key not configured');
      }

      const response = await firstValueFrom(
        this.httpService
          .get('https://newsapi.org/v2/top-headlines', {
            params: {
              apiKey,
              country: options.region || 'us',
              category: options.category || 'general',
              pageSize: 20,
            },
          })
          .pipe(
            timeout(this.API_TIMEOUT),
            catchError((error) => {
              throw new Error(`News API error: ${error.message}`);
            }),
          ),
      );

      const trends: TrendData[] = [];
      if (response.data.articles) {
        // Sort articles by published date (newest first)
        const sortedArticles = response.data.articles
          .filter((article: any) => article.title && article.publishedAt)
          .sort(
            (a: any, b: any) =>
              new Date(b.publishedAt).getTime() -
              new Date(a.publishedAt).getTime(),
          );

        for (const article of sortedArticles.slice(0, 10)) {
          const score = this.calculateNewsScore(article, options);
          trends.push({
            topic: this.cleanArticleTitle(article.title),
            score,
            timestamp: new Date(article.publishedAt),
            source: 'news',
            region: options.region,
            category: options.category,
          });
        }
      }

      return trends;
    } catch (error) {
      throw new Error(
        `News API error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Map region to Twitter WOEID (Where On Earth ID)
   */
  private mapRegionToWoeid(region?: string): number {
    const woeidMap: Record<string, number> = {
      global: 1,
      worldwide: 1,
      us: 23424977,
      uk: 23424975,
      gb: 23424975,
      de: 23424829,
      fr: 23424819,
      jp: 23424856,
      ca: 23424775,
      au: 23424748,
      in: 23424848,
      br: 23424768,
      mx: 23424900,
      es: 23424950,
      it: 23424853,
    };
    if (!region || region === 'global') return 1;
    return woeidMap[region.toLowerCase()] ?? 1;
  }

  /**
   * Fetch trends from Twitter/X API (legacy trends/place endpoint, supports Bearer token)
   * Throws when TWITTER_BEARER_TOKEN is unset or API fails - no fabricated mock data in production.
   */
  private async fetchTwitterTrends(options: {
    region?: string;
    category?: string;
  }): Promise<TrendData[]> {
    const bearerToken =
      process.env.TWITTER_BEARER_TOKEN || process.env.TWITTER_API_KEY;

    if (!bearerToken) {
      this.logger.error(
        'Twitter trends unavailable: TWITTER_BEARER_TOKEN or TWITTER_API_KEY not configured',
      );
      throw new InternalServerErrorException(
        'Twitter trends are not available. Configure TWITTER_BEARER_TOKEN or TWITTER_API_KEY to enable trend detection.',
      );
    }

    if (process.env.USE_MOCK_TWITTER === 'true') {
      this.logger.warn(
        'USE_MOCK_TWITTER=true is deprecated; returning empty trends. Configure TWITTER_BEARER_TOKEN for real data.',
      );
      return [];
    }

    try {
      const woeid = this.mapRegionToWoeid(options.region);
      const response = await firstValueFrom(
        this.httpService
          .get(`https://api.twitter.com/1.1/trends/place.json`, {
            params: { id: woeid },
            headers: {
              Authorization: `Bearer ${bearerToken}`,
            },
          })
          .pipe(
            timeout(this.API_TIMEOUT),
            catchError((error) => {
              this.logger.warn('Twitter trends API failed', {
                error: error?.response?.data || error?.message,
              });
              throw error;
            }),
          ),
      );

      const trends: TrendData[] = [];
      const data = Array.isArray(response.data)
        ? response.data[0]
        : response.data;
      if (data?.trends && Array.isArray(data.trends)) {
        for (const trend of data.trends.slice(0, 10)) {
          const tweetVolume = trend.tweet_volume ?? 0;
          const score = Math.min(100, Math.log10(tweetVolume + 1) * 15) || 50;
          trends.push({
            topic: trend.name || '',
            score,
            timestamp: new Date(),
            source: 'twitter',
            region: options.region,
            category: options.category,
          });
        }
      }

      return trends;
    } catch (error) {
      this.logger.error('Twitter API failed, cannot return fabricated trends', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new InternalServerErrorException(
        'Twitter trends API is temporarily unavailable. Please try again later.',
        { cause: error instanceof Error ? error : undefined },
      );
    }
  }

  /**
   * Perform comprehensive trend analysis
   */
  private async performTrendAnalysis(
    message: string,
    options: {
      region?: string;
      category?: string;
      maxResults?: number;
      includeExternal?: boolean;
    },
  ): Promise<TrendAnalysis> {
    const topics = this.extractTrendingTopics(message);
    const hasTemporal = this.hasTemporalRelevance(message);
    const isQuestion = this.isCurrentEventsQuestion(message);
    const keywordMatch = this.quickCheck(message);

    let confidence = 0;
    let reasoning = '';

    // Calculate confidence based on various factors
    if (keywordMatch) confidence += 30;
    if (hasTemporal) confidence += 25;
    if (isQuestion) confidence += 20;
    if (topics.length > 0) confidence += topics.length * 5;

    // Fetch external trends if requested and confidence is high enough
    let externalTrends: TrendData[] = [];
    if (options.includeExternal && confidence > 40) {
      try {
        externalTrends = await this.fetchExternalTrends({
          region: options.region,
          category: options.category,
          maxResults: options.maxResults || 5,
        });
      } catch (error) {
        this.logger.warn(
          'External trend fetching failed, continuing with analysis',
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    // Build comprehensive reasoning
    const reasons = [];
    if (keywordMatch) reasons.push('contains trending keywords');
    if (hasTemporal) reasons.push('has temporal relevance');
    if (isQuestion) reasons.push('is a current events question');
    if (topics.length > 0)
      reasons.push(`extracted ${topics.length} potential topics`);

    // Analyze external trends
    if (externalTrends.length > 0) {
      const sources = [...new Set(externalTrends.map((t) => t.source))];
      reasons.push(
        `found ${externalTrends.length} trends from ${sources.join(', ')}`,
      );

      // Check for cross-source consensus
      const topicCounts: Record<string, number> = {};
      externalTrends.forEach((trend) => {
        topicCounts[trend.topic] = (topicCounts[trend.topic] || 0) + 1;
      });

      const consensusTopics = Object.entries(topicCounts)
        .filter(([, count]) => count > 1)
        .map(([topic]) => topic);

      if (consensusTopics.length > 0) {
        reasons.push(
          `${consensusTopics.length} topics appear in multiple sources`,
        );
        confidence += 10; // Bonus for cross-source validation
      }
    }

    reasoning = reasons.join(', ') || 'basic keyword analysis';

    const isTrending = confidence > 50 || externalTrends.length > 0;
    const recommendedSearch =
      isTrending && (confidence > 60 || externalTrends.length > 2);

    return {
      isTrending,
      confidence: Math.min(confidence, 100),
      trends: externalTrends,
      recommendedSearch,
      reasoning,
    };
  }

  /**
   * Fallback analysis when external APIs fail
   */
  private fallbackAnalysis(message: string): TrendAnalysis {
    const keywordMatch = this.quickCheck(message);
    const hasTemporal = this.hasTemporalRelevance(message);
    const isQuestion = this.isCurrentEventsQuestion(message);

    let confidence = 0;
    if (keywordMatch) confidence += 40;
    if (hasTemporal) confidence += 30;
    if (isQuestion) confidence += 30;

    return {
      isTrending: confidence > 50,
      confidence,
      trends: [],
      recommendedSearch: confidence > 70,
      reasoning: 'fallback keyword analysis (external APIs unavailable)',
    };
  }

  /**
   * Check if a word is a common word that shouldn't be considered a topic
   */
  private isCommonWord(word: string): boolean {
    const commonWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'from',
      'up',
      'about',
      'into',
      'through',
      'during',
      'before',
      'after',
      'above',
      'below',
      'between',
      'among',
      'this',
      'that',
      'these',
      'those',
      'i',
      'me',
      'my',
      'myself',
      'we',
      'our',
      'ours',
      'ourselves',
      'you',
      'your',
      'yours',
      'yourself',
      'yourselves',
      'he',
      'him',
      'his',
      'himself',
      'she',
      'her',
      'hers',
      'herself',
      'it',
      'its',
      'itself',
      'they',
      'them',
      'their',
      'theirs',
      'themselves',
      'what',
      'which',
      'who',
      'whom',
      'whose',
      'this',
      'that',
      'these',
      'those',
      'am',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'having',
      'do',
      'does',
      'did',
      'doing',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'shall',
      'can',
      'ought',
    ]);

    return commonWords.has(word);
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.trendCache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.trendCache.delete(key);
      }
    }
  }

  // ============================================================================
  // EXPRESS QUERY CLASSIFICATION PIPELINE (Added for chat flow compatibility)
  // ============================================================================

  /**
   * Main query classification method (Express parity)
   * Used by multiAgentFlow for routing decisions
   */
  async analyzeQuery(query: string): Promise<{
    intent: string;
    confidence: number;
    requiresWebSearch: boolean;
    searchReason?: string;
  }> {
    try {
      // AI-powered classification using Bedrock (Express approach)
      const classification = await this.classifyWithAI(query);

      return {
        intent: classification.intent,
        confidence: classification.confidence,
        requiresWebSearch: classification.requiresWebSearch,
        searchReason: classification.searchReason,
      };
    } catch (error) {
      this.logger.warn('AI classification failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Fallback to pattern-based detection
      return this.getFallbackClassification(query);
    }
  }

  /**
   * AI-powered query classification using Bedrock
   */
  private async classifyWithAI(query: string): Promise<{
    intent: string;
    confidence: number;
    requiresWebSearch: boolean;
    searchReason?: string;
  }> {
    const systemPrompt = `You are a query classifier for an AI cost optimization platform. Classify the user query into one of: cost_analysis, model_comparison, api_configuration, web_search, conversational.
Return only valid JSON with keys: intent (string), confidence (0-1), requiresWebSearch (boolean), searchReason (string, optional).
Example: {"intent":"cost_analysis","confidence":0.9,"requiresWebSearch":false}`;

    const userPrompt = `Classify this query: "${query}"`;

    try {
      const response = await BedrockService.invokeModel(
        `${systemPrompt}\n\n${userPrompt}`,
        process.env.CORTEX_CORE_MODEL || 'us.amazon.nova-lite-v1:0',
      );

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          intent?: string;
          confidence?: number;
          requiresWebSearch?: boolean;
          searchReason?: string;
        };
        return {
          intent: parsed.intent ?? 'conversational',
          confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.6)),
          requiresWebSearch: Boolean(parsed.requiresWebSearch),
          searchReason: parsed.searchReason,
        };
      }
    } catch (error) {
      this.logger.warn(
        'Bedrock classification failed, using heuristic fallback',
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    // Fallback to heuristic when Bedrock fails or returns unparseable JSON
    if (this.isCostKatanaQuery(query)) {
      return {
        intent: 'cost_analysis',
        confidence: 0.9,
        requiresWebSearch: false,
      };
    }
    const queryType = this.determineQueryType(query);
    const requiresWebSearch = this.shouldUseWebSearch(query);
    return {
      intent: queryType.intent,
      confidence: queryType.confidence,
      requiresWebSearch,
      searchReason: requiresWebSearch
        ? 'Query contains time-sensitive or external information needs'
        : undefined,
    };
  }

  /**
   * Determine query type from pattern analysis (Express parity)
   */
  private determineQueryType(query: string): {
    intent: string;
    confidence: number;
  } {
    const lowerQuery = query.toLowerCase();

    // Cost & pricing queries
    if (
      lowerQuery.includes('cost') ||
      lowerQuery.includes('price') ||
      lowerQuery.includes('expensive')
    ) {
      return { intent: 'cost_analysis', confidence: 0.9 };
    }

    // Model comparison queries
    if (
      lowerQuery.includes('vs') ||
      lowerQuery.includes('versus') ||
      lowerQuery.includes('compare')
    ) {
      return { intent: 'model_comparison', confidence: 0.85 };
    }

    // API configuration queries
    if (
      lowerQuery.includes('api') ||
      lowerQuery.includes('integration') ||
      lowerQuery.includes('connect')
    ) {
      return { intent: 'api_configuration', confidence: 0.8 };
    }

    // Web search queries
    if (
      lowerQuery.includes('latest') ||
      lowerQuery.includes('news') ||
      lowerQuery.includes('current')
    ) {
      return { intent: 'web_search', confidence: 0.75 };
    }

    // Default conversational
    return { intent: 'conversational', confidence: 0.6 };
  }

  /**
   * Get suggested sources for a query type (Express parity)
   */
  getSuggestedSources(queryType: string): string[] {
    const sourceMap: { [key: string]: string[] } = {
      cost_analysis: [
        'internal_analytics',
        'model_pricing_api',
        'usage_database',
      ],
      model_comparison: [
        'model_specs',
        'benchmark_data',
        'performance_metrics',
      ],
      api_configuration: ['integration_docs', 'api_references', 'setup_guides'],
      web_search: ['google_custom_search', 'news_apis', 'tech_sites'],
      conversational: ['knowledge_base', 'general_assistance'],
    };

    return sourceMap[queryType] || ['general_search'];
  }

  /**
   * Create extraction strategy for web scraping (Express parity)
   */
  createExtractionStrategy(queryType: string, sources: string[]): any {
    return {
      queryType,
      sources,
      extractionRules: {
        cost_data: {
          selectors: ['.pricing', '.cost', '.price'],
          patterns: ['\\$\\d+', '\\d+\\.\\d+', 'per (token|request|month)'],
        },
        model_info: {
          selectors: ['.model-specs', '.performance', '.benchmarks'],
          patterns: ['gpt', 'claude', 'gemini', 'llama'],
        },
        api_docs: {
          selectors: ['.api-docs', '.integration-guide', '.setup'],
          patterns: ['api', 'integration', 'webhook', 'oauth'],
        },
      },
      priority: sources.length > 1 ? 'parallel' : 'sequential',
    };
  }

  /**
   * Create caching strategy for query results (Express parity)
   */
  createCacheStrategy(queryType: string): any {
    const cacheStrategies: { [key: string]: any } = {
      cost_analysis: { ttl: 3600000, scope: 'user' }, // 1 hour
      model_comparison: { ttl: 86400000, scope: 'global' }, // 24 hours
      api_configuration: { ttl: 604800000, scope: 'global' }, // 1 week
      web_search: { ttl: 1800000, scope: 'global' }, // 30 minutes
      conversational: { ttl: 3600000, scope: 'user' }, // 1 hour
    };

    return cacheStrategies[queryType] || { ttl: 3600000, scope: 'user' };
  }

  /**
   * Get site-specific scraping templates (Express parity)
   */
  getScrapingTemplate(site: string): any {
    const templates: { [key: string]: any } = {
      'anthropic.com': {
        selectors: ['.pricing-table', '.model-comparison'],
        waitFor: '.pricing',
        extract: ['pricing', 'model_specs'],
      },
      'openai.com': {
        selectors: ['.pricing', '.api-pricing'],
        waitFor: '.pricing-section',
        extract: ['pricing', 'rate_limits'],
      },
      'docs.github.com': {
        selectors: ['.api-docs', '.integration-guide'],
        waitFor: '.content',
        extract: ['api_reference', 'examples'],
      },
    };

    return (
      templates[site] || {
        selectors: ['body'],
        waitFor: 'body',
        extract: ['content'],
      }
    );
  }

  /**
   * Check if query is CostKatana-specific (Express parity)
   */
  private isCostKatanaQuery(query: string): boolean {
    const lowerQuery = query.toLowerCase();
    const costKatanaTerms = [
      'costkatana',
      'cost katana',
      'ai cost',
      'model cost',
      'llm pricing',
      'token cost',
      'api billing',
    ];

    return costKatanaTerms.some((term) => lowerQuery.includes(term));
  }

  /**
   * Calculate pattern score for query classification (Express parity)
   */
  private calculatePatternScore(query: string, patterns: string[]): number {
    const lowerQuery = query.toLowerCase();
    let score = 0;

    for (const pattern of patterns) {
      if (lowerQuery.includes(pattern.toLowerCase())) {
        score += 1;
      }
    }

    return Math.min(score / patterns.length, 1.0);
  }

  /**
   * Determine if query should use web search (Express parity)
   */
  private shouldUseWebSearch(query: string): boolean {
    const lowerQuery = query.toLowerCase();

    // Time-sensitive keywords
    const timeKeywords = [
      'latest',
      'current',
      'recent',
      'today',
      'now',
      '2024',
      '2023',
    ];
    const hasTimeSensitivity = timeKeywords.some((keyword) =>
      lowerQuery.includes(keyword),
    );

    // Market/pricing keywords
    const marketKeywords = [
      'price',
      'cost',
      'pricing',
      'market',
      'trending',
      'popular',
    ];
    const hasMarketData = marketKeywords.some((keyword) =>
      lowerQuery.includes(keyword),
    );

    // External information keywords
    const externalKeywords = [
      'news',
      'breaking',
      'update',
      'announcement',
      'release',
    ];
    const hasExternalInfo = externalKeywords.some((keyword) =>
      lowerQuery.includes(keyword),
    );

    return hasTimeSensitivity || hasMarketData || hasExternalInfo;
  }

  /**
   * Fallback classification when AI fails (Express parity)
   */
  private getFallbackClassification(query: string): {
    intent: string;
    confidence: number;
    requiresWebSearch: boolean;
    searchReason?: string;
  } {
    const lowerQuery = query.toLowerCase();

    // Simple keyword-based classification
    if (lowerQuery.includes('cost') || lowerQuery.includes('price')) {
      return {
        intent: 'cost_analysis',
        confidence: 0.7,
        requiresWebSearch: false,
      };
    }

    if (lowerQuery.includes('latest') || lowerQuery.includes('news')) {
      return {
        intent: 'web_search',
        confidence: 0.6,
        requiresWebSearch: true,
        searchReason: 'Query appears to need current information',
      };
    }

    return {
      intent: 'conversational',
      confidence: 0.5,
      requiresWebSearch: false,
    };
  }
}
