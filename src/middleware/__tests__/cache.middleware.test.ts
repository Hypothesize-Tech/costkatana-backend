import request from 'supertest';
import express, { Request, Response } from 'express';
import { cacheMiddleware } from '../cache.middleware';
import { redisService } from '../../services/redis.service';

// Mock the redisService with its high-level methods
jest.mock('../../services/redis.service', () => ({
  redisService: {
    checkCache: jest.fn(),
    storeCache: jest.fn(),
  },
}));

const mockedRedisService = redisService as jest.Mocked<typeof redisService>;

const app = express();
app.use(express.json());
// The middleware intercepts the response, so we need a final handler
app.post('/test', cacheMiddleware, (_req: Request, res: Response) => {
  res.status(200).json({ message: 'original response' });
});

describe('cacheMiddleware', () => {
  beforeEach(() => {
    // Reset mocks before each test
    mockedRedisService.checkCache.mockReset();
    mockedRedisService.storeCache.mockReset();
  });

  it('should return from cache if hit', async () => {
    // Arrange: Mock a cache hit
    mockedRedisService.checkCache.mockResolvedValue({
      hit: true,
      strategy: 'exact',
      data: { message: 'cached response' },
    });

    // Act
    const response = await request(app)
      .post('/test')
      .send({ prompt: 'hello' });

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'cached response' });
    expect(response.headers['x-cache']).toBe('HIT');
    expect(response.headers['x-cache-type']).toBe('EXACT');
    expect(mockedRedisService.checkCache).toHaveBeenCalledWith('hello', { model: undefined });
    expect(mockedRedisService.storeCache).not.toHaveBeenCalled();
  });

  it('should miss cache, call next, and then cache the response', async () => {
    // Arrange: Mock a cache miss
    mockedRedisService.checkCache.mockResolvedValue({ hit: false });

    // Act
    const response = await request(app)
      .post('/test')
      .send({ model: 'test-model', prompt: 'new prompt' });

    // Assert: The original response is returned
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'original response' });
    expect(response.headers['x-cache']).toBe('MISS');

    // Assert: The middleware attempted to cache the new response
    // Use process.nextTick to allow the async cache operation to be called
    await new Promise(process.nextTick);
    expect(mockedRedisService.storeCache).toHaveBeenCalledWith(
      'new prompt',
      { message: 'original response' },
      { model: 'test-model', ttl: 3600 }
    );
  });

  it('should bypass cache if no-cache header is present', async () => {
    // Act
    const response = await request(app)
      .post('/test')
      .set('Cache-Control', 'no-cache')
      .send({ prompt: 'any prompt' });

    // Assert
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'original response' });
    expect(response.headers['x-cache']).toBe('BYPASS');
    expect(mockedRedisService.checkCache).not.toHaveBeenCalled();
    expect(mockedRedisService.storeCache).not.toHaveBeenCalled();
  });

  it('should use ttl from max-age header when caching', async () => {
    // Arrange
    mockedRedisService.checkCache.mockResolvedValue({ hit: false });

    // Act
    await request(app)
      .post('/test')
      .set('Cache-Control', 'max-age=600')
      .send({ model: 'ttl-model', prompt: 'ttl test' });

    // Assert
    await new Promise(process.nextTick);
    expect(mockedRedisService.storeCache).toHaveBeenCalledWith(
      'ttl test',
      { message: 'original response' },
      { model: 'ttl-model', ttl: 600 }
    );
  });
});
