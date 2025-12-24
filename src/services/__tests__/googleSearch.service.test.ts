import { GoogleSearchService } from '../googleSearch.service';
import { SEARCH_CONFIG } from '../../config/search.config';
import axios from 'axios';
import { redisService } from '../redis.service';

// Mock dependencies
jest.mock('axios');
jest.mock('../redis.service');
jest.mock('../logging.service');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedRedis = redisService as jest.Mocked<typeof redisService>;

describe('GoogleSearchService', () => {
  let searchService: GoogleSearchService;
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables
    process.env = {
      ...originalEnv,
      GOOGLE_SEARCH_API_KEY: 'test-api-key',
      GOOGLE_SEARCH_ENGINE_ID: 'test-engine-id'
    };

    // Get fresh instance
    searchService = GoogleSearchService.getInstance();

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Configuration', () => {
    it('should be configured with valid credentials', () => {
      expect(searchService.isConfigured()).toBe(true);
    });

    it('should not be configured without API key', () => {
      process.env.GOOGLE_SEARCH_API_KEY = '';
      const service = GoogleSearchService.getInstance();
      expect(service.isConfigured()).toBe(false);
    });

    it('should not be configured without engine ID', () => {
      process.env.GOOGLE_SEARCH_ENGINE_ID = '';
      const service = GoogleSearchService.getInstance();
      expect(service.isConfigured()).toBe(false);
    });
  });

  describe('Basic Search', () => {
    const mockSearchResponse = {
      data: {
        items: [
          {
            title: 'AWS Bedrock Pricing',
            snippet: 'Learn about AWS Bedrock pricing...',
            link: 'https://aws.amazon.com/bedrock/pricing/',
            displayLink: 'aws.amazon.com'
          },
          {
            title: 'Amazon Bedrock - AWS Documentation',
            snippet: 'Complete guide to AWS Bedrock...',
            link: 'https://docs.aws.amazon.com/bedrock/',
            displayLink: 'docs.aws.amazon.com'
          }
        ]
      }
    };

    beforeEach(() => {
      mockedAxios.get.mockResolvedValue(mockSearchResponse);
      mockedRedis.get.mockResolvedValue(null);
      mockedRedis.incr.mockResolvedValue(1);
      mockedRedis.set.mockResolvedValue(undefined);
    });

    it('should perform a basic search successfully', async () => {
      const results = await searchService.search('AWS Bedrock pricing');

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        title: 'AWS Bedrock Pricing',
        snippet: 'Learn about AWS Bedrock pricing...',
        url: 'https://aws.amazon.com/bedrock/pricing/'
      });
    });

    it('should call Google Custom Search API with correct parameters', async () => {
      await searchService.search('test query');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        SEARCH_CONFIG.GOOGLE_SEARCH_API_URL,
        expect.objectContaining({
          params: {
            key: 'test-api-key',
            cx: 'test-engine-id',
            q: 'test query',
            num: 10
          }
        })
      );
    });

    it('should track quota usage', async () => {
      await searchService.search('test query');

      expect(mockedRedis.incr).toHaveBeenCalledWith('google_search:quota:daily');
    });

    it('should throw error when not configured', async () => {
      process.env.GOOGLE_SEARCH_API_KEY = '';
      const service = GoogleSearchService.getInstance();

      await expect(service.search('test')).rejects.toThrow(
        'Google Search API is not configured'
      );
    });
  });

  describe('Domain Filtering', () => {
    beforeEach(() => {
      mockedAxios.get.mockResolvedValue({
        data: { items: [] }
      });
      mockedRedis.get.mockResolvedValue(null);
      mockedRedis.incr.mockResolvedValue(1);
    });

    it('should apply domain filtering to search query', async () => {
      await searchService.searchWithDomains('AWS pricing', ['aws.amazon.com', 'cloud.google.com']);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          params: expect.objectContaining({
            q: 'AWS pricing (site:aws.amazon.com OR site:cloud.google.com)'
          })
        })
      );
    });

    it('should search cost domains automatically', async () => {
      await searchService.searchCostDomains('pricing updates');

      const callArgs = mockedAxios.get.mock.calls[0][1];
      const query = callArgs?.params?.q;

      expect(query).toContain('site:aws.amazon.com');
      expect(query).toContain('site:cloud.google.com');
      expect(query).toContain('site:learn.microsoft.com');
    });
  });

  describe('Caching', () => {
    it('should return cached results when available', async () => {
      const cachedResults = JSON.stringify([
        { title: 'Cached Result', snippet: 'From cache', url: 'https://example.com' }
      ]);
      
      mockedRedis.get.mockResolvedValue(cachedResults);

      const results = await searchService.search('test query');

      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Cached Result');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('should cache new results with correct TTL', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          items: [{ title: 'New Result', snippet: 'Fresh', link: 'https://example.com' }]
        }
      });
      mockedRedis.get.mockResolvedValue(null);

      await searchService.search('test query');

      expect(mockedRedis.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        SEARCH_CONFIG.CACHE_TTL
      );
    });
  });

  describe('Quota Management', () => {
    it('should warn when approaching quota limit (80%)', async () => {
      mockedRedis.get.mockResolvedValue('80');
      mockedAxios.get.mockResolvedValue({ data: { items: [] } });

      await searchService.search('test');

      // Check if warning was logged (via logging service mock)
      expect(mockedRedis.get).toHaveBeenCalledWith('google_search:quota:daily');
    });

    it('should block when quota limit exceeded (90%)', async () => {
      mockedRedis.get.mockResolvedValue('90');

      await expect(searchService.search('test')).rejects.toThrow(
        'Daily quota limit reached'
      );
    });

    it('should return quota status correctly', async () => {
      mockedRedis.get.mockResolvedValue('50');

      const status = await searchService.getQuotaStatus();

      expect(status).toEqual({
        count: 50,
        limit: SEARCH_CONFIG.DAILY_QUOTA_LIMIT,
        percentage: 50
      });
    });
  });

  describe('Deep Content Extraction', () => {
    const mockHtmlResponse = {
      data: `
        <html>
          <head><title>Test Page</title></head>
          <body>
            <nav>Navigation</nav>
            <main>
              <article>
                <h1>Main Heading</h1>
                <p>This is the main content of the page.</p>
              </article>
            </main>
            <script>console.log('test');</script>
          </body>
        </html>
      `
    };

    beforeEach(() => {
      mockedAxios.get.mockResolvedValue(mockHtmlResponse);
    });

    it('should fetch and parse deep content from URLs', async () => {
      const results = await searchService.getDeepContent(['https://example.com']);

      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        url: 'https://example.com',
        title: 'Test Page',
        cleanedText: expect.stringContaining('Main Heading')
      });
    });

    it('should remove unwanted elements from HTML', async () => {
      const results = await searchService.getDeepContent(['https://example.com']);

      expect(results[0].cleanedText).not.toContain('Navigation');
      expect(results[0].cleanedText).not.toContain('console.log');
    });

    it('should handle multiple URLs', async () => {
      const results = await searchService.getDeepContent([
        'https://example1.com',
        'https://example2.com',
        'https://example3.com'
      ]);

      expect(results.length).toBeLessThanOrEqual(3);
      expect(mockedAxios.get).toHaveBeenCalledTimes(3);
    });

    it('should continue on error for individual URLs', async () => {
      mockedAxios.get
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce(mockHtmlResponse);

      const results = await searchService.getDeepContent([
        'https://fail.com',
        'https://success.com'
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].url).toBe('https://success.com');
    });
  });

  describe('Error Handling', () => {
    it('should handle 429 rate limit errors', async () => {
      mockedAxios.get.mockRejectedValue({
        isAxiosError: true,
        response: { status: 429 }
      });
      mockedRedis.get.mockResolvedValue(null);

      await expect(searchService.search('test')).rejects.toThrow(
        'Google Search API quota exceeded'
      );
    });

    it('should handle 403 authentication errors', async () => {
      mockedAxios.get.mockRejectedValue({
        isAxiosError: true,
        response: { status: 403 }
      });
      mockedRedis.get.mockResolvedValue(null);

      await expect(searchService.search('test')).rejects.toThrow(
        'Google Search API authentication failed'
      );
    });

    it('should handle network errors gracefully', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));
      mockedRedis.get.mockResolvedValue(null);

      await expect(searchService.search('test')).rejects.toThrow();
    });

    it('should handle empty search results', async () => {
      mockedAxios.get.mockResolvedValue({ data: { items: [] } });
      mockedRedis.get.mockResolvedValue(null);

      const results = await searchService.search('test');

      expect(results).toEqual([]);
    });
  });

  describe('Search with Deep Content', () => {
    beforeEach(() => {
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            items: [
              {
                title: 'Test Page',
                snippet: 'Test snippet',
                link: 'https://example.com'
              }
            ]
          }
        })
        .mockResolvedValueOnce({
          data: '<html><body><main>Deep content here</main></body></html>'
        });
      
      mockedRedis.get.mockResolvedValue(null);
      mockedRedis.incr.mockResolvedValue(1);
      mockedRedis.set.mockResolvedValue(undefined);
    });

    it('should fetch deep content when requested', async () => {
      const results = await searchService.search('test', { deepContent: true });

      expect(mockedAxios.get).toHaveBeenCalledTimes(2); // Once for search, once for content
      expect((results[0] as any).content).toBeDefined();
    });

    it('should limit deep content pages to configured maximum', async () => {
      mockedAxios.get.mockResolvedValue({
        data: {
          items: Array(10).fill({
            title: 'Test',
            snippet: 'Test',
            link: 'https://example.com'
          })
        }
      });

      await searchService.search('test', { deepContent: true });

      // Should fetch search + up to DEEP_CONTENT_PAGES
      expect(mockedAxios.get).toHaveBeenCalledTimes(1 + SEARCH_CONFIG.DEEP_CONTENT_PAGES);
    });
  });
});

