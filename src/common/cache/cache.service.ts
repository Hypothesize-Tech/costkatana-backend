import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Redis from 'ioredis';
import { isRedisEnabled } from '../../config/redis';

/** Redis key prefixes used by Express redis.service for cache stats (parity). */
const STATS_PREFIX = 'stats:';
const CACHE_PREFIX = 'cache:';
const USER_PREFIX = 'user:';

/** Default TTL in seconds (1 hour) - parity with Express redis.service */
const DEFAULT_CACHE_TTL = 3600;

/** GitHub cache key prefix and TTL (aligned with github-cache-invalidation.service). */
const GITHUB_PREFIX = 'github:';
const GITHUB_CACHE_TTL = 3600; // 1 hour
const GITHUB_WARMUP_PLACEHOLDER_TTL = 120; // 2 min placeholder when no data passed

/** Options for gateway cache keys: hash includes keyMaterial (sorted) when present. */
export interface BuildCacheKeyOptions {
  userId?: string;
  model?: string;
  provider?: string;
  /** Semantically significant request fields (messages, tools, temperature, etc.) */
  keyMaterial?: Record<string, unknown>;
}

/**
 * Recursively sort object keys for deterministic JSON.stringify (cache key stability).
 */
export function sortObjectKeysDeep(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectKeysDeep(item));
  }
  if (typeof value === 'object' && value.constructor === Object) {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortObjectKeysDeep(obj[key]);
    }
    return sorted;
  }
  return value;
}

export interface CacheStats {
  hits: number;
  misses: number;
  totalRequests: number;
  hitRate: number;
  avgResponseTime: number;
  costSaved: number;
  tokensSaved: number;
  deduplicationCount: number;
  semanticMatches: number;
  cacheSize: number;
  topModels: { model: string; hits: number }[];
  topUsers: { userId: string; hits: number }[];
}

/** Cache entry shape for export/import and warmup - parity with Express redis.service CacheEntry */
export interface CacheEntryMetadata {
  userId?: string;
  model?: string;
  provider?: string;
  timestamp: number;
  ttl: number;
  hits: number;
  lastAccessed: number;
  tokens?: number;
  cost?: number;
}

export interface CacheEntry {
  key: string;
  value: unknown;
  metadata: CacheEntryMetadata;
}

export interface ClearCacheOptions {
  userId?: string;
  model?: string;
  provider?: string;
}

export interface WarmupQuery {
  prompt: string;
  response: unknown;
  metadata?: {
    userId?: string;
    model?: string;
    provider?: string;
    ttl?: number;
  };
}

const EMPTY_CACHE_STATS: CacheStats = {
  hits: 0,
  misses: 0,
  totalRequests: 0,
  hitRate: 0,
  avgResponseTime: 0,
  costSaved: 0,
  tokensSaved: 0,
  deduplicationCount: 0,
  semanticMatches: 0,
  cacheSize: 0,
  topModels: [],
  topUsers: [],
};

let cacheServiceInstance: CacheService | null = null;

/** Get singleton for use outside DI (e.g. cortex, middleware). */
export function getCacheService(): CacheService {
  if (!cacheServiceInstance) {
    throw new Error(
      'CacheService not initialized. Ensure CacheModule is imported.',
    );
  }
  return cacheServiceInstance;
}

/**
 * Unified cache service: Redis primary with in-memory fallback.
 * Used for gateway rate limiting and other cache needs.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private redis: Redis | null = null;
  private inMemoryCache = new Map<string, { value: string; expiry: number }>();
  private isConnected = false;

  constructor(private configService: ConfigService) {
    cacheServiceInstance = this;
    if (!isRedisEnabled()) {
      this.logger.log('Redis disabled - using in-memory cache only');
      this.redis = null;
    } else {
      const host = this.configService.get<string>('REDIS_HOST', 'localhost');
      const port = this.configService.get<number>('REDIS_PORT', 6379);
      const password = this.configService.get<string>('REDIS_PASSWORD');
      const redisUrl = this.configService.get<string>('REDIS_URL');

      try {
        if (redisUrl) {
          this.redis = new Redis(redisUrl, {
            lazyConnect: true,
            retryStrategy: (times) => Math.min(times * 100, 3000),
            maxRetriesPerRequest: 3,
          });
        } else {
          this.redis = new Redis({
            host,
            port,
            password: password || undefined,
            db: parseInt(this.configService.get<string>('REDIS_DB') || '0', 10),
            lazyConnect: true,
            retryStrategy: (times) => Math.min(times * 100, 3000),
            maxRetriesPerRequest: 3,
          });
        }

        this.redis.on('error', (err) => {
          this.logger.warn('Redis error', { error: err.message });
          this.isConnected = false;
        });

        this.redis.on('connect', () => {
          this.isConnected = true;
          this.logger.debug('Redis connected');
        });
      } catch (error) {
        this.logger.warn('Redis initialization failed', {
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        this.redis = null;
      }
    }

    // Periodic cleanup of expired in-memory entries
    setInterval(() => this.cleanupMemoryCache(), 60000);
  }

  private cleanupMemoryCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.inMemoryCache.entries()) {
      if (entry.expiry <= now) {
        this.inMemoryCache.delete(key);
      }
    }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    if (this.redis) {
      try {
        const raw = await this.redis.get(key);
        if (raw === null) return null;
        try {
          return JSON.parse(raw) as T;
        } catch {
          return raw as T;
        }
      } catch (error) {
        this.logger.debug('Redis get failed, trying memory', {
          key,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const entry = this.inMemoryCache.get(key);
    if (!entry || entry.expiry <= Date.now()) {
      if (entry) this.inMemoryCache.delete(key);
      return null;
    }
    try {
      return JSON.parse(entry.value) as T;
    } catch {
      return entry.value as T;
    }
  }

  async set(
    key: string,
    value: unknown,
    ttlSeconds: number,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    void metadata; // reserved for future cache metadata (API compatibility)
    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value);
    const expiry = Date.now() + ttlSeconds * 1000;

    if (this.redis) {
      try {
        await this.redis.setex(key, ttlSeconds, serialized);
        return;
      } catch (error) {
        this.logger.debug('Redis set failed, using memory', {
          key,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.inMemoryCache.set(key, { value: serialized, expiry });
  }

  /**
   * Delete a cache entry by key.
   * Redis: uses DEL command. In-memory: removes from Map.
   */
  async del(key: string): Promise<number> {
    if (this.redis) {
      try {
        return await this.redis.del(key);
      } catch (error) {
        this.logger.debug('Redis del failed, trying memory', {
          key,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // For in-memory, return 1 if deleted, 0 if not found
    const deleted = this.inMemoryCache.delete(key);
    return deleted ? 1 : 0;
  }

  /** Alias for del (API compatibility). */
  async delete(key: string): Promise<number> {
    return this.del(key);
  }

  /**
   * Set key only if it does not exist, with TTL (atomic SET NX EX).
   * Returns true if key was set, false if key already existed.
   */
  async setIfNotExists(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    if (this.redis) {
      try {
        const result = await this.redis.set(key, value, 'EX', ttlSeconds, 'NX');
        return result === 'OK';
      } catch (error) {
        this.logger.debug('Redis set NX failed, using memory', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const entry = this.inMemoryCache.get(key);
    if (entry && entry.expiry > Date.now()) return false;
    this.inMemoryCache.set(key, {
      value,
      expiry: Date.now() + ttlSeconds * 1000,
    });
    return true;
  }

  /**
   * Delete all keys matching a pattern (e.g. 'agent:*').
   * Uses keys(pattern) then delMany. Returns number of keys deleted.
   */
  async deleteByPattern(pattern: string): Promise<number> {
    const keyList = await this.keys(pattern);
    if (keyList.length === 0) return 0;
    return this.delMany(keyList);
  }

  /**
   * Ping Redis to check connectivity. Returns true if Redis responds.
   */
  async ping(): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * List keys matching a pattern using Redis SCAN cursor (non-blocking).
   * Prefer this over keys() in production to avoid blocking Redis.
   * Falls back to keys() for in-memory cache.
   */
  async scanKeys(pattern: string): Promise<string[]> {
    if (this.redis) {
      try {
        const keys: string[] = [];
        let cursor = '0';
        do {
          const [nextCursor, foundKeys] = await this.redis.scan(
            cursor,
            'MATCH',
            pattern,
            'COUNT',
            100,
          );
          cursor = nextCursor;
          keys.push(...(foundKeys as string[]));
        } while (cursor !== '0');
        return keys;
      } catch (error) {
        this.logger.debug('Redis scan failed, falling back to keys', {
          pattern,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return this.keys(pattern);
  }

  /**
   * Delete multiple keys. Returns total number of keys removed.
   */
  async delMany(keys: string[]): Promise<number> {
    if (!keys.length) return 0;
    if (this.redis) {
      try {
        return await this.redis.del(...keys);
      } catch (error) {
        this.logger.debug('Redis delMany failed', {
          count: keys.length,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    let deleted = 0;
    for (const key of keys) {
      deleted += this.inMemoryCache.delete(key) ? 1 : 0;
    }
    return deleted;
  }

  /**
   * Simple cache check by prompt key (no semantic matching).
   * Returns hit with data when key exists; otherwise { hit: false }.
   */
  async checkCache(
    prompt: string,
    options?: {
      userId?: string;
      model?: string;
      provider?: string;
      keyMaterial?: Record<string, unknown>;
      enableSemantic?: boolean;
      enableDeduplication?: boolean;
      similarityThreshold?: number;
    },
  ): Promise<{
    hit: boolean;
    data?: unknown;
    strategy?: string;
    similarity?: number;
  }> {
    const key = this.buildCacheKey(prompt, {
      userId: options?.userId,
      model: options?.model,
      provider: options?.provider,
      keyMaterial: options?.keyMaterial,
    });
    const value = await this.get(key);
    if (value != null) {
      return {
        hit: true,
        data: value,
        strategy: 'exact',
        similarity: 1,
      };
    }
    return { hit: false };
  }

  /**
   * Store prompt/response in cache (exact key, no semantic indexing).
   */
  async storeCache(
    prompt: string,
    response: unknown,
    options?: {
      userId?: string;
      model?: string;
      provider?: string;
      ttl?: number;
      tokens?: number;
      cost?: number;
      keyMaterial?: Record<string, unknown>;
      enableSemantic?: boolean;
      enableDeduplication?: boolean;
    },
  ): Promise<void> {
    const key = this.buildCacheKey(prompt, {
      userId: options?.userId,
      model: options?.model,
      provider: options?.provider,
      keyMaterial: options?.keyMaterial,
    });
    const ttl = options?.ttl ?? DEFAULT_CACHE_TTL;
    await this.set(key, response, ttl);
  }

  // --- Redis sorted set / set helpers (no-op when Redis unavailable) ---

  async zcard(key: string): Promise<number> {
    if (!this.redis) return 0;
    try {
      return await this.redis.zcard(key);
    } catch {
      return 0;
    }
  }

  async scard(key: string): Promise<number> {
    if (!this.redis) return 0;
    try {
      return await this.redis.scard(key);
    } catch {
      return 0;
    }
  }

  async zcount(key: string, min: number, max: number): Promise<number> {
    if (!this.redis) return 0;
    try {
      return await this.redis.zcount(key, min, max);
    } catch {
      return 0;
    }
  }

  async zrange(
    key: string,
    start: number,
    stop: number,
    withScores?: 'WITHSCORES',
  ): Promise<string[]> {
    if (!this.redis) return [];
    try {
      if (withScores === 'WITHSCORES') {
        const rows = await this.redis.zrange(key, start, stop, 'WITHSCORES');
        return Array.isArray(rows) ? rows : [];
      }
      const rows = await this.redis.zrange(key, start, stop);
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    if (!this.redis) return 0;
    try {
      return await this.redis.zadd(key, score, member);
    } catch {
      return 0;
    }
  }

  async zrem(key: string, ...members: string[]): Promise<number> {
    if (!this.redis) return 0;
    try {
      return await this.redis.zrem(key, ...members);
    } catch {
      return 0;
    }
  }

  /**
   * Remove sorted set members by score range (min <= score <= max).
   * Returns number of members removed. No-op when Redis unavailable.
   */
  async zremrangebyscore(
    key: string,
    min: number,
    max: number,
  ): Promise<number> {
    if (!this.redis) return 0;
    try {
      return await this.redis.zremrangebyscore(key, min, max);
    } catch {
      return 0;
    }
  }

  /**
   * Set TTL for a key in seconds. No-op when Redis unavailable.
   */
  async expire(key: string, seconds: number): Promise<boolean> {
    if (!this.redis) return false;
    try {
      const result = await this.redis.expire(key, seconds);
      return result === 1;
    } catch {
      return false;
    }
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    if (!this.redis) return 0;
    try {
      return await this.redis.sadd(key, ...members);
    } catch {
      return 0;
    }
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    if (!this.redis) return 0;
    try {
      return await this.redis.srem(key, ...members);
    } catch {
      return 0;
    }
  }

  async smembers(key: string): Promise<string[]> {
    if (!this.redis) return [];
    try {
      return (await this.redis.smembers(key)) as string[];
    } catch {
      return [];
    }
  }

  /**
   * Store or warm repository metadata cache.
   * Key: github:metadata:{repositoryFullName}
   * When `data` is provided, stores it with GITHUB_CACHE_TTL.
   * When omitted (e.g. from warmupRepositoryCache), stores a short-lived placeholder
   * so the key exists; callers with GitHub API access should replace with real data via set() or by calling this again with data.
   */
  async cacheGitHubRepositoryMetadata(
    repositoryFullName: string,
    data?: unknown,
  ): Promise<void> {
    const key = `${GITHUB_PREFIX}metadata:${repositoryFullName}`;
    const payload =
      data !== undefined
        ? data
        : {
            _warmup: true as const,
            repositoryFullName,
            at: new Date().toISOString(),
          };
    const ttl =
      data !== undefined ? GITHUB_CACHE_TTL : GITHUB_WARMUP_PLACEHOLDER_TTL;
    await this.set(key, payload, ttl);
    this.logger.debug('GitHub repository metadata cache updated', {
      key,
      hasData: data !== undefined,
      ttl,
    });
  }

  /**
   * Store or warm branches list cache.
   * Key: github:branches:{repositoryFullName}
   */
  async cacheGitHubBranches(
    repositoryFullName: string,
    data?: unknown,
  ): Promise<void> {
    const key = `${GITHUB_PREFIX}branches:${repositoryFullName}`;
    const payload =
      data !== undefined
        ? data
        : {
            _warmup: true as const,
            repositoryFullName,
            at: new Date().toISOString(),
          };
    const ttl =
      data !== undefined ? GITHUB_CACHE_TTL : GITHUB_WARMUP_PLACEHOLDER_TTL;
    await this.set(key, payload, ttl);
    this.logger.debug('GitHub branches cache updated', {
      key,
      hasData: data !== undefined,
      ttl,
    });
  }

  /**
   * Store or warm file tree / structure cache for a branch.
   * Keys: github:structure:{repositoryFullName}:{branch}, github:files:{repositoryFullName}:{branch}
   * Both are set so invalidation (which clears both) stays consistent.
   */
  async cacheGitHubFileTree(
    repositoryFullName: string,
    branch: string,
    data?: unknown,
  ): Promise<void> {
    const structureKey = `${GITHUB_PREFIX}structure:${repositoryFullName}:${branch}`;
    const filesKey = `${GITHUB_PREFIX}files:${repositoryFullName}:${branch}`;
    const payload =
      data !== undefined
        ? data
        : {
            _warmup: true as const,
            repositoryFullName,
            branch,
            at: new Date().toISOString(),
          };
    const ttl =
      data !== undefined ? GITHUB_CACHE_TTL : GITHUB_WARMUP_PLACEHOLDER_TTL;
    await Promise.all([
      this.set(structureKey, payload, ttl),
      this.set(filesKey, payload, ttl),
    ]);
    this.logger.debug('GitHub file tree cache updated', {
      structureKey,
      filesKey,
      hasData: data !== undefined,
      ttl,
    });
  }

  /**
   * List cache keys matching a pattern (e.g. 'workflow:template:*').
   * Redis: uses KEYS command. In-memory: filters by regex from pattern.
   */
  async keys(pattern: string): Promise<string[]> {
    if (this.redis) {
      try {
        return await this.redis.keys(pattern);
      } catch (error) {
        this.logger.debug('Redis keys failed, trying memory', {
          pattern,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    );
    return Array.from(this.inMemoryCache.keys()).filter((k) => regex.test(k));
  }

  /**
   * Build cache key from content and options (parity with Express redis.service generateCacheKey).
   * When `keyMaterial` is provided, the hash includes a deterministic JSON serialization of
   * provider, model, user scope, keyMaterial, and prompt text (temperature, tools, etc.).
   * Format: cache:provider:model:userId:contentHash
   */
  buildCacheKey(
    content: string,
    options: BuildCacheKeyOptions = {},
  ): string {
    const { userId, model, provider, keyMaterial } = options;
    const hashPayload =
      keyMaterial && Object.keys(keyMaterial).length > 0
        ? sortObjectKeysDeep({
            provider: provider ?? 'unknown',
            model: model ?? 'unknown',
            userScope: userId ?? 'anonymous',
            keyMaterial,
            promptFingerprint: content,
          })
        : sortObjectKeysDeep({
            provider: provider ?? 'unknown',
            model: model ?? 'unknown',
            userScope: userId ?? 'anonymous',
            content,
          });
    const serialized = JSON.stringify(hashPayload);
    const contentHash = crypto
      .createHash('sha256')
      .update(serialized)
      .digest('hex')
      .substring(0, 16);
    const components = [
      CACHE_PREFIX,
      provider ?? 'unknown',
      model ?? 'unknown',
      userId ?? 'anonymous',
      contentHash,
    ];
    return components.join(':');
  }

  /**
   * Clear cache entries by optional filters (parity with Express redis.service clearCache).
   */
  async clearCache(options: ClearCacheOptions = {}): Promise<number> {
    const parts = [CACHE_PREFIX];
    parts.push(options.provider ?? '*');
    parts.push(options.model ?? '*');
    parts.push(options.userId ?? '*');
    parts.push('*');
    const pattern = parts.join(':');
    const keyList = await this.keys(pattern);
    if (keyList.length === 0) {
      return 0;
    }
    let deleted = 0;
    for (const key of keyList) {
      const n = await this.del(key);
      deleted += n;
    }
    this.logger.log(`Cleared ${deleted} cache entries`, { pattern });
    return deleted;
  }

  /**
   * Export cache data for backup (parity with Express redis.service exportCache).
   */
  async exportCache(): Promise<{ entries: CacheEntry[]; stats: CacheStats }> {
    const pattern = `${CACHE_PREFIX}*`;
    const keyList = await this.keys(pattern);
    const entries: CacheEntry[] = [];
    for (const key of keyList) {
      const raw = await this.get<CacheEntry>(key);
      if (raw && typeof raw === 'object' && 'key' in raw && 'metadata' in raw) {
        entries.push(raw);
      }
    }
    const stats = await this.getCacheStats();
    return { entries, stats };
  }

  /**
   * Import cache data from backup (parity with Express redis.service importCache).
   */
  async importCache(data: { entries: CacheEntry[] }): Promise<void> {
    const { entries } = data;
    if (!entries || !Array.isArray(entries)) {
      throw new Error('Invalid cache data format');
    }
    for (const entry of entries) {
      const ttl =
        typeof entry.metadata?.ttl === 'number' && entry.metadata.ttl > 0
          ? entry.metadata.ttl
          : DEFAULT_CACHE_TTL;
      await this.set(entry.key, entry, ttl);
    }
    this.logger.log(`Imported ${entries.length} cache entries`);
  }

  /**
   * Warmup cache with predefined queries (parity with Express redis.service warmupCache).
   */
  async warmupCache(queries: WarmupQuery[]): Promise<void> {
    if (!queries || !Array.isArray(queries)) {
      throw new Error('Invalid warmup data format');
    }
    for (const query of queries) {
      const key = this.buildCacheKey(query.prompt, {
        userId: query.metadata?.userId,
        model: query.metadata?.model,
        provider: query.metadata?.provider,
      });
      const ttl =
        typeof query.metadata?.ttl === 'number' && query.metadata.ttl > 0
          ? query.metadata.ttl
          : DEFAULT_CACHE_TTL;
      const metadata: CacheEntryMetadata = {
        userId: query.metadata?.userId,
        model: query.metadata?.model,
        provider: query.metadata?.provider,
        timestamp: Date.now(),
        ttl,
        hits: 0,
        lastAccessed: Date.now(),
      };
      const entry: CacheEntry = {
        key,
        value: query.response,
        metadata,
      };
      await this.set(key, entry, ttl);
    }
    this.logger.log(`Warmed up cache with ${queries.length} entries`);
  }

  /**
   * Get cache statistics from Redis (parity with Express redis.service).
   * Reads stats:global hash, INFO memory, and aggregates top models/users.
   * Returns empty stats when Redis is unavailable or on error.
   */
  async getCacheStats(): Promise<CacheStats> {
    if (!this.redis) {
      return { ...EMPTY_CACHE_STATS };
    }
    try {
      const statsKey = `${STATS_PREFIX}global`;
      const stats = await this.redis.hgetall(statsKey);

      const hits = parseInt(stats.hits ?? '0', 10);
      const misses = parseInt(stats.misses ?? '0', 10);
      const totalRequests = parseInt(stats.totalRequests ?? '0', 10);
      const semanticMatches = parseInt(stats.semanticMatches ?? '0', 10);
      const deduplicationCount = parseInt(stats.deduplicationCount ?? '0', 10);

      let cacheSize = 0;
      try {
        const info = await this.redis.info('memory');
        const match = info.match(/used_memory:(\d+)/);
        cacheSize = match ? parseInt(match[1], 10) : 0;
      } catch {
        // ignore
      }

      const [topModels, topUsers] = await Promise.all([
        this.getTopModels(5),
        this.getTopUsers(5),
      ]);

      return {
        hits,
        misses,
        totalRequests,
        hitRate: totalRequests > 0 ? (hits / totalRequests) * 100 : 0,
        avgResponseTime: parseFloat(stats.avgResponseTime ?? '0'),
        costSaved: parseFloat(stats.costSaved ?? '0'),
        tokensSaved: parseInt(stats.tokens ?? '0', 10),
        deduplicationCount,
        semanticMatches,
        cacheSize,
        topModels,
        topUsers,
      };
    } catch (error) {
      this.logger.warn('Failed to get cache stats', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { ...EMPTY_CACHE_STATS };
    }
  }

  private async getTopModels(
    limit: number,
  ): Promise<{ model: string; hits: number }[]> {
    if (!this.redis) return [];
    try {
      const pattern = `${CACHE_PREFIX}*`;
      const keys = await this.redis.keys(pattern);
      const modelCounts = new Map<string, number>();
      for (const key of keys) {
        const parts = key.split(':');
        const model = parts[2];
        if (model && model !== 'unknown') {
          modelCounts.set(model, (modelCounts.get(model) ?? 0) + 1);
        }
      }
      return Array.from(modelCounts.entries())
        .map(([model, hits]) => ({ model, hits }))
        .sort((a, b) => b.hits - a.hits)
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  private async getTopUsers(
    limit: number,
  ): Promise<{ userId: string; hits: number }[]> {
    if (!this.redis) return [];
    try {
      const pattern = `${USER_PREFIX}*`;
      const keys = await this.redis.keys(pattern);
      const userStats: { userId: string; hits: number }[] = [];
      for (const key of keys) {
        const userId = key.replace(USER_PREFIX, '');
        const requests = await this.redis.hget(key, 'requests');
        if (requests) {
          userStats.push({ userId, hits: parseInt(requests, 10) });
        }
      }
      return userStats.sort((a, b) => b.hits - a.hits).slice(0, limit);
    } catch {
      return [];
    }
  }

  /** Alias for clearCache() - clears all cache entries. Used by cortex. */
  async clear(): Promise<number> {
    return this.clearCache({});
  }

  async onModuleDestroy(): Promise<void> {
    cacheServiceInstance = null;
    if (!this.redis) return;
    try {
      const r = this.redis as Redis & { status?: string };
      if (
        r.status === 'ready' ||
        r.status === 'connecting' ||
        r.status === 'reconnecting'
      ) {
        await this.redis.quit();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg !== 'Connection is closed.' &&
        !msg.includes('ETIMEDOUT') &&
        !msg.includes('max retries')
      ) {
        this.logger.warn('Redis quit on destroy', { error: msg });
      }
    } finally {
      this.redis = null;
      this.isConnected = false;
    }
  }
}
