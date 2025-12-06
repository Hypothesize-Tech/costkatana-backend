import { createClient, RedisClientType } from 'redis';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';
import { loggingService } from './logging.service';
import { ChatBedrockConverse } from '@langchain/aws';
import { resolveRedisUrl, getRedisOptions, getRedisErrorDiagnostic } from '../config/redis';
import { LRUCache } from 'lru-cache';

dotenv.config();

interface CacheEntry {
    key: string;
    value: any;
    metadata: {
        userId?: string;
        model?: string;
        provider?: string;
        timestamp: number;
        ttl: number;
        hits: number;
        lastAccessed: number;
        tokens?: number;
        cost?: number;
        semanticHash?: string;
        deduplicationHash?: string;
    };
}

interface SemanticCacheEntry extends CacheEntry {
    embedding?: number[];
    similarityScore?: number;
}

interface CacheStats {
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

export class RedisService {
    private static instance: RedisService;
    public client!: RedisClientType;
    private readerClient!: RedisClientType;
    private embeddingModel: ChatBedrockConverse;
    private _isConnected: boolean = false;
    private inMemoryCache: LRUCache<string, { value: string; expiry: number }>;
    private isLocalDev: boolean = false;
    private connectionInProgress: boolean = false;
    
    // Cache prefixes
    private readonly CACHE_PREFIX = 'cache:';
    private readonly SEMANTIC_PREFIX = 'semantic:';
    private readonly EMBEDDING_PREFIX = 'embedding:';
    private readonly DEDUP_PREFIX = 'dedup:';
    private readonly STATS_PREFIX = 'stats:';
    private readonly USER_PREFIX = 'user:';
    
    // Default TTLs (in seconds)
    private readonly DEFAULT_TTL = 3600; // 1 hour
    private readonly SEMANTIC_TTL = 86400; // 24 hours
    private readonly DEDUP_TTL = 300; // 5 minutes
    
    private constructor() {
        // Initialize in-memory cache with LRU limits
        this.inMemoryCache = new LRUCache({
            max: 10000, // Maximum 10,000 cache entries
            ttl: this.DEFAULT_TTL * 1000, // Convert seconds to milliseconds
            updateAgeOnGet: true,
            allowStale: false
        });

        // Always use in-memory cache in development unless explicitly configured for Redis
        this.isLocalDev = process.env.NODE_ENV === 'development' && !process.env.REDIS_HOST;
        
        if (this.isLocalDev) {
            loggingService.info('🔧 Redis: Local development mode - using in-memory cache (no Redis required)');
            this.client = this.createMockClient();
            this.readerClient = this.createMockClient();
            this._isConnected = true;
        } else {
            loggingService.info('🔧 Redis: Production mode - attempting Redis connection');
            // Only create Redis clients if we have Redis configuration
            this.setupRedisClients();
        }

        // Initialize embedding model for semantic caching
        this.embeddingModel = new ChatBedrockConverse({
            model: 'amazon.nova-micro-v1:0',
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0,
            maxTokens: 100,
        });

        this.setupEventHandlers();
    }

    private setupEventHandlers(): void {
        if (!this.isLocalDev) {
            this.client.on('error', (err: any) => {
                // Reduce error logging severity for timeout errors which are common
                if (err && err.message && err.message.includes('Connection timeout')) {
                    loggingService.warn('Redis client timeout error - will retry automatically');
                } else {
                    loggingService.error('Redis Client Error:', err);
                }
                // Only set to disconnected for non-timeout errors
                if (!(err && err.message && err.message.includes('Connection timeout'))) {
                    this._isConnected = false;
                }
            });

            this.client.on('connect', () => {
                loggingService.info('Redis Client Connected');
                this._isConnected = true;
            });

            this.client.on('ready', () => {
                loggingService.info('Redis Client Ready');
            });

            this.readerClient.on('error', (err: any) => {
                // Reduce error logging severity for timeout errors which are common
                if (err && err.message && err.message.includes('Connection timeout')) {
                    loggingService.warn('Redis reader client timeout error - will retry automatically');
                } else {
                    loggingService.error('Redis Reader Client Error:', err);
                }
            });
        }
    }

    /**
     * Create a mock Redis client for local development
     */
    private createMockClient(): any {
        return {
            get: async (key: string) => {
                const entry = this.inMemoryCache.get(key);
                if (entry && entry.expiry > Date.now()) {
                    return entry.value;
                }
                if (entry) {
                    this.inMemoryCache.delete(key);
                }
                return null;
            },
            set: async (key: string, value: string, options?: any) => {
                const ttl = options?.EX ? options.EX * 1000 : this.DEFAULT_TTL * 1000;
                this.inMemoryCache.set(key, {
                    value,
                    expiry: Date.now() + ttl
                });
                return 'OK';
            },
            del: async (key: string) => {
                return this.inMemoryCache.delete(key) ? 1 : 0;
            },
            exists: async (key: string) => {
                const entry = this.inMemoryCache.get(key);
                if (entry && entry.expiry > Date.now()) {
                    return 1;
                }
                if (entry) {
                    this.inMemoryCache.delete(key);
                }
                return 0;
            },
            flushAll: async () => {
                this.inMemoryCache.clear();
                return 'OK';
            },
            keys: async (pattern: string) => {
                // Simple pattern matching for development
                const keys = Array.from(this.inMemoryCache.keys());
                if (pattern === '*') return keys;
                
                const regex = new RegExp(pattern.replace(/\*/g, '.*'));
                return keys.filter(key => regex.test(key));
            },
            connect: async () => {},
            disconnect: async () => {},
            isOpen: true,
            isReady: true,
            on: () => {},
            setEx: async (key: string, ttl: number, value: string) => {
                this.inMemoryCache.set(key, {
                    value,
                    expiry: Date.now() + ttl * 1000
                });
                return 'OK';
            },
            ttl: async (key: string) => {
                const entry = this.inMemoryCache.get(key);
                if (entry && entry.expiry > Date.now()) {
                    return Math.floor((entry.expiry - Date.now()) / 1000);
                }
                return -2; // Key does not exist
            },
            hGet: async () => null,
            hGetAll: async () => ({}),
            hIncrBy: async () => 0,
            hIncrByFloat: async () => 0,
            expire: async () => 1,
            quit: async () => {},
            info: async () => '',
            scan: async (cursor: string, matchOption: string, pattern: string) => {
                // In-memory scan implementation
                const allKeys = Array.from(this.inMemoryCache.keys());
                
                // Parse cursor to determine starting position
                const startIndex = parseInt(cursor) || 0;
                
                // Apply pattern matching if provided
                let keysToScan = allKeys;
                if (matchOption === 'MATCH' && pattern) {
                    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
                    keysToScan = allKeys.filter((key: string) => regex.test(key));
                }
                
                // Return subset of keys based on cursor position
                return keysToScan.slice(startIndex);
            }
        };
    }

    public static getInstance(): RedisService {
        if (!RedisService.instance) {
            RedisService.instance = new RedisService();
        }
        return RedisService.instance;
    }

    /**
     * Check if Redis is connected
     */
    public get isConnected(): boolean {
        return this._isConnected;
    }

    /**
     * Setup Redis clients with proper error handling
     */
    private setupRedisClients(): void {
        try {
            // Get Redis URL and options from centralized configuration
            const redisUrl = resolveRedisUrl();
            const redisOptions = getRedisOptions(false);
            
            // Convert to node-redis format
            const nodeRedisConfig = {
                url: redisUrl,
                socket: {
                    reconnectStrategy: (retries: number) => {
                        if (retries > 3) return false; // Allow up to 3 retries
                        return Math.min(retries * 1000, 3000); // Exponential backoff with max 3s
                    },
                    connectTimeout: redisOptions.connectTimeout || 5000,
                    // Fix the TLS type issue - must be boolean or undefined for node-redis
                    tls: redisOptions.tls ? true : undefined
                },
                password: redisOptions.password,
                username: redisOptions.username,
                database: parseInt(process.env.REDIS_DB || '0'),
            };

            this.client = createClient(nodeRedisConfig);
            this.readerClient = createClient({
                ...nodeRedisConfig,
                readonly: true,
            });

            // Handle connection errors - fallback immediately
            this.client.on('error', (err: any) => {
                const diagnostic = getRedisErrorDiagnostic(err);
                loggingService.warn(`Redis client error: ${diagnostic}`);
                this.fallbackToInMemory();
            });

            this.readerClient.on('error', (err: any) => {
                const diagnostic = getRedisErrorDiagnostic(err);
                loggingService.warn(`Redis reader client error: ${diagnostic}`);
            });

            // Handle successful connections
            this.client.on('connect', () => {
                loggingService.info('✅ Redis client connected');
            });

            this.readerClient.on('connect', () => {
                loggingService.info('✅ Redis reader client connected');
            });

        } catch (error) {
            const diagnostic = getRedisErrorDiagnostic(error);
            loggingService.warn(`Failed to setup Redis clients: ${diagnostic}`);
            loggingService.warn('Falling back to in-memory cache');
            this.fallbackToInMemory();
        }
    }

    /**
     * Fallback to in-memory cache when Redis fails
     */
    private fallbackToInMemory(): void {
        if (!this.isLocalDev) {
            loggingService.info('🔄 Switching to in-memory cache mode');
            
            // Attempt to gracefully close existing clients if they exist
            try {
                // Remove all event listeners to prevent late errors from showing up
                if (this.client) {
                    this.client.removeAllListeners();
                    
                    if (typeof this.client.quit === 'function') {
                        this.client.quit().catch(err => 
                            loggingService.debug('Error while closing Redis client:', { error: err instanceof Error ? err.message : String(err) })
                        );
                    }
                }
                
                if (this.readerClient) {
                    this.readerClient.removeAllListeners();
                    
                    if (typeof this.readerClient.quit === 'function') {
                        this.readerClient.quit().catch(err => 
                            loggingService.debug('Error while closing Redis reader client:', { error: err instanceof Error ? err.message : String(err) })
                        );
                    }
                }
            } catch (err) {
                loggingService.debug('Error during Redis client cleanup:', { error: err instanceof Error ? err.message : String(err) });
            }
            
            // Switch to in-memory mode
            this.isLocalDev = true;
            this.client = this.createMockClient();
            this.readerClient = this.createMockClient();
            this._isConnected = true;
            
            // Log success message
            loggingService.info('✅ Successfully switched to in-memory cache mode');
        }
    }

    public async connect(): Promise<void> {
        if (this.isLocalDev) {
            loggingService.info('✅ Redis: Using in-memory cache for local development');
            return;
        }

        // Prevent multiple concurrent connection attempts
        if (this.connectionInProgress) {
            loggingService.info('Redis connection already in progress, skipping duplicate attempt');
            return;
        }

        try {
            this.connectionInProgress = true;

            // Get Redis URL from centralized configuration
            const redisUrl = resolveRedisUrl();
            const maskedUrl = redisUrl.replace(/\/\/([^@]*@)?/, '//');
            loggingService.info(`🔌 Connecting to Redis at ${maskedUrl}`);

            // Simplified connection approach - let node-redis handle retries
            const connectIfNeeded = async (client: any, name: string) => {
                if (client.isOpen) {
                    loggingService.info(`${name} is already open`);
                    return;
                }
                
                if (client.isReady) {
                    loggingService.info(`${name} is already ready`);
                    return;
                }
                
                loggingService.info(`Connecting to ${name}...`);
                
                try {
                    // Let node-redis manage retry internally
                    await client.connect();
                    loggingService.info(`✅ ${name} connected successfully`);
                } catch (error) {
                    const connectErr = error as Error;
                    if (connectErr && connectErr.message && connectErr.message.includes('Socket already opened')) {
                        loggingService.info(`${name} socket already opened, considering connected`);
                        return;
                    }
                    throw error;
                }
            };

            // Connect clients sequentially
            await connectIfNeeded(this.client, 'Redis client');
            await connectIfNeeded(this.readerClient, 'Redis reader');
            
            this._isConnected = true;
            loggingService.info('✅ Redis connected successfully');
        } catch (error) {
            const diagnostic = getRedisErrorDiagnostic(error);
            loggingService.warn(`❌ Redis connection failed: ${diagnostic}`);
            loggingService.warn('Falling back to in-memory cache');
            this.fallbackToInMemory();
        } finally {
            this.connectionInProgress = false;
        }
    }

    public async disconnect(): Promise<void> {
        try {
            if (!this.isLocalDev) {
                await this.client.quit();
                await this.readerClient.quit();
            } else {
                this.inMemoryCache.clear();
            }
            this._isConnected = false;
            loggingService.info('Redis disconnected');
        } catch (error) {
            loggingService.error('Error disconnecting from Redis:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Generate a cache key with multiple strategies
     */
    private generateCacheKey(
        content: string,
        options: {
            userId?: string;
            model?: string;
            provider?: string;
            useSemanticHash?: boolean;
        } = {}
    ): string {
        const { userId, model, provider } = options;
        
        // Basic hash of content
        const contentHash = crypto
            .createHash('sha256')
            .update(content)
            .digest('hex')
            .substring(0, 16);

        // Build key components
        const components = [
            this.CACHE_PREFIX,
            provider || 'unknown',
            model || 'unknown',
            userId || 'anonymous',
            contentHash
        ];

        return components.join(':');
    }

    /**
     * Generate embedding for semantic caching
     */
    private async generateEmbedding(text: string): Promise<number[]> {
        try {
            // Check if we have a cached embedding
            const embeddingKey = `${this.EMBEDDING_PREFIX}${crypto.createHash('md5').update(text).digest('hex')}`;
            const cachedEmbedding = await this.readerClient.get(embeddingKey);
            
            if (cachedEmbedding) {
                return JSON.parse(cachedEmbedding);
            }

            // Try to use AWS Bedrock embedding model first
            let embedding: number[] = [];
            
            try {
                if (this.embeddingModel && process.env.AWS_ACCESS_KEY_ID) {
                    // Use AWS Bedrock for embeddings (simplified approach)
                    const response = await this.embeddingModel.invoke(text);
                    // For now, create a deterministic embedding from the response
                    const responseText = JSON.stringify(response);
                    const hash = crypto.createHash('sha256').update(responseText).digest();
                    
                    for (let i = 0; i < 384; i++) {
                        embedding.push(hash[i % hash.length] / 255);
                    }
                } else {
                    throw new Error('AWS Bedrock not available');
                }
            } catch (awsError) {
                loggingService.warn('AWS Bedrock embedding failed, using fallback:', { error: awsError instanceof Error ? awsError.message : String(awsError) });
                
                // Fallback: Using a simple hash-based pseudo-embedding
                const hash = crypto.createHash('sha256').update(text).digest();
                
                for (let i = 0; i < 384; i++) {
                    embedding.push(hash[i % hash.length] / 255);
                }
            }
            
            // Cache the embedding for future use
            await this.client.setEx(embeddingKey, 86400, JSON.stringify(embedding)); // 24 hour cache
            
            return embedding;
        } catch (error) {
            loggingService.error('Failed to generate embedding:', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    /**
     * Calculate cosine similarity between embeddings
     */
    private cosineSimilarity(a: number[], b: number[]): number {
        if (a.length !== b.length) return 0;
        
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        
        normA = Math.sqrt(normA);
        normB = Math.sqrt(normB);
        
        if (normA === 0 || normB === 0) return 0;
        
        return dotProduct / (normA * normB);
    }

    /**
     * Check cache with multiple strategies
     */
    public async checkCache(
        prompt: string,
        options: {
            userId?: string;
            model?: string;
            provider?: string;
            enableSemantic?: boolean;
            enableDeduplication?: boolean;
            similarityThreshold?: number;
        } = {}
    ): Promise<{ hit: boolean; data?: any; strategy?: string; similarity?: number }> {
        try {
            const { 
                userId, 
                model, 
                provider, 
                enableSemantic = true, 
                enableDeduplication = true,
                similarityThreshold = 0.85
            } = options;

            // Update stats
            await this.incrementStat('totalRequests');

            // Strategy 1: Exact match cache
            const exactKey = this.generateCacheKey(prompt, { userId, model, provider });
            const exactMatch = await this.readerClient.get(exactKey);
            
            if (exactMatch) {
                await this.incrementStat('hits');
                await this.incrementStat('exactMatches');
                const data = JSON.parse(exactMatch);
                await this.updateCacheMetadata(exactKey, { hits: 1, lastAccessed: Date.now() });
                loggingService.info('Cache hit (exact match)', { key: exactKey.substring(0, 20) });
                return { hit: true, data, strategy: 'exact' };
            }

            // Strategy 2: Deduplication (check for recent identical requests)
            if (enableDeduplication) {
                const dedupKey = `${this.DEDUP_PREFIX}${crypto.createHash('md5').update(prompt).digest('hex')}`;
                const dedupData = await this.readerClient.get(dedupKey);
                
                if (dedupData) {
                    await this.incrementStat('hits');
                    await this.incrementStat('deduplicationCount');
                    loggingService.info('Cache hit (deduplication)', { key: dedupKey.substring(0, 20) });
                    return { hit: true, data: JSON.parse(dedupData), strategy: 'deduplication' };
                }
            }

            // Strategy 3: Semantic similarity cache
            // Enabled by default, can be disabled via enableSemantic parameter or env var
            const semanticEnabled = enableSemantic && process.env.ENABLE_SEMANTIC_CACHE !== 'false';
            if (semanticEnabled) {
                const embedding = await this.generateEmbedding(prompt);
                const semanticResults = await this.findSemanticMatches(
                    embedding,
                    { userId, model, provider },
                    similarityThreshold
                );
                
                if (semanticResults.length > 0) {
                    const bestMatch = semanticResults[0];
                    await this.incrementStat('hits');
                    await this.incrementStat('semanticMatches');
                    loggingService.info('Cache hit (semantic)', { value:  {  
                        similarity: bestMatch.similarity,
                        threshold: similarityThreshold 
                     } });
                    return { 
                        hit: true, 
                        data: bestMatch.data, 
                        strategy: 'semantic',
                        similarity: bestMatch.similarity
                    };
                }
            }

            // Cache miss
            await this.incrementStat('misses');
            loggingService.info('Cache miss', { prompt: prompt.substring(0, 50) });
            return { hit: false };

        } catch (error) {
            loggingService.error('Cache check failed:', { error: error instanceof Error ? error.message : String(error) });
            return { hit: false };
        }
    }

    /**
     * Find semantic matches using embedding similarity
     */
    private async findSemanticMatches(
        embedding: number[],
        filters: { userId?: string; model?: string; provider?: string },
        threshold: number = 0.85
    ): Promise<{ data: any; similarity: number }[]> {
        try {
            const pattern = `${this.SEMANTIC_PREFIX}*`;
            const keys = await this.readerClient.keys(pattern);
            const matches: { data: any; similarity: number }[] = [];

            for (const key of keys) {
                const entry = await this.readerClient.get(key);
                if (!entry) continue;

                const cached = JSON.parse(entry) as SemanticCacheEntry;
                
                // Apply filters
                if (filters.userId && cached.metadata.userId !== filters.userId) continue;
                if (filters.model && cached.metadata.model !== filters.model) continue;
                if (filters.provider && cached.metadata.provider !== filters.provider) continue;

                // Calculate similarity
                if (cached.embedding) {
                    const similarity = this.cosineSimilarity(embedding, cached.embedding);
                    if (similarity >= threshold) {
                        matches.push({ data: cached.value, similarity });
                    }
                }
            }

            // Sort by similarity (highest first)
            matches.sort((a, b) => b.similarity - a.similarity);
            return matches.slice(0, 5); // Return top 5 matches

        } catch (error) {
            loggingService.error('Semantic match search failed:', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    /**
     * Store response in cache with multiple strategies
     */
    public async storeCache(
        prompt: string,
        response: any,
        options: {
            userId?: string;
            model?: string;
            provider?: string;
            ttl?: number;
            tokens?: number;
            cost?: number;
            enableSemantic?: boolean;
            enableDeduplication?: boolean;
        } = {}
    ): Promise<void> {
        try {
            const { 
                userId, 
                model, 
                provider, 
                ttl = this.DEFAULT_TTL,
                tokens,
                cost,
                enableSemantic = true,
                enableDeduplication = true
            } = options;

            const metadata: CacheEntry['metadata'] = {
                userId,
                model,
                provider,
                timestamp: Date.now(),
                ttl,
                hits: 0,
                lastAccessed: Date.now(),
                tokens,
                cost
            };

            // Store exact match cache
            const exactKey = this.generateCacheKey(prompt, { userId, model, provider });
            const cacheEntry: CacheEntry = {
                key: exactKey,
                value: response,
                metadata
            };
            
            await this.client.setEx(
                exactKey,
                ttl,
                JSON.stringify(cacheEntry)
            );

            // Store deduplication cache
            if (enableDeduplication) {
                const dedupKey = `${this.DEDUP_PREFIX}${crypto.createHash('md5').update(prompt).digest('hex')}`;
                await this.client.setEx(
                    dedupKey,
                    this.DEDUP_TTL,
                    JSON.stringify(response)
                );
            }

            // Store semantic cache
            // Enabled by default, can be disabled via enableSemantic parameter or env var
            const semanticEnabled = enableSemantic && process.env.ENABLE_SEMANTIC_CACHE !== 'false';
            if (semanticEnabled) {
                const embedding = await this.generateEmbedding(prompt);
                const semanticKey = `${this.SEMANTIC_PREFIX}${exactKey}`;
                const semanticEntry: SemanticCacheEntry = {
                    ...cacheEntry,
                    embedding
                };
                
                await this.client.setEx(
                    semanticKey,
                    this.SEMANTIC_TTL,
                    JSON.stringify(semanticEntry)
                );
            }

            // Update user stats
            if (userId) {
                await this.updateUserStats(userId, { requests: 1, tokens, cost });
            }

            loggingService.info('Cache stored successfully', { 
                key: exactKey.substring(0, 20),
                ttl,
                strategies: ['exact', enableDeduplication && 'dedup', enableSemantic && 'semantic'].filter(Boolean)
            });

        } catch (error) {
            loggingService.error('Failed to store cache:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Get cache statistics
     */
    public async getCacheStats(): Promise<CacheStats> {
        try {
            const stats = await this.readerClient.hGetAll(`${this.STATS_PREFIX}global`);
            
            const hits = parseInt(stats.hits || '0');
            const misses = parseInt(stats.misses || '0');
            const totalRequests = parseInt(stats.totalRequests || '0');
            const semanticMatches = parseInt(stats.semanticMatches || '0');
            const deduplicationCount = parseInt(stats.deduplicationCount || '0');
            
            // Get cache size
            const info = await this.readerClient.info('memory');
            const usedMemory = info.match(/used_memory:(\d+)/)?.[1] || '0';
            
            // Get top models and users
            const modelStats = await this.getTopModels();
            const userStats = await this.getTopUsers();
            
            return {
                hits,
                misses,
                totalRequests,
                hitRate: totalRequests > 0 ? (hits / totalRequests) * 100 : 0,
                avgResponseTime: parseFloat(stats.avgResponseTime || '0'),
                costSaved: parseFloat(stats.costSaved || '0'),
                tokensSaved: parseInt(stats.tokens || '0'),
                deduplicationCount,
                semanticMatches,
                cacheSize: parseInt(usedMemory),
                topModels: modelStats,
                topUsers: userStats
            };
        } catch (error) {
            loggingService.error('Failed to get cache stats:', { error: error instanceof Error ? error.message : String(error) });
            return {
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
                topUsers: []
            };
        }
    }

    /**
     * Clear cache with optional filters
     */
    public async clearCache(options: {
        userId?: string;
        model?: string;
        provider?: string;
        pattern?: string;
    } = {}): Promise<number> {
        try {
            let pattern = this.CACHE_PREFIX;
            
            if (options.pattern) {
                pattern = options.pattern;
            } else {
                const parts = [this.CACHE_PREFIX];
                if (options.provider) parts.push(options.provider);
                else parts.push('*');
                if (options.model) parts.push(options.model);
                else parts.push('*');
                if (options.userId) parts.push(options.userId);
                else parts.push('*');
                parts.push('*');
                pattern = parts.join(':');
            }
            
            const keys = await this.client.keys(pattern);
            
            if (keys.length > 0) {
                await this.client.del(keys);
                loggingService.info(`Cleared ${keys.length} cache entries`, { pattern });
            }
            
            return keys.length;
        } catch (error) {
            loggingService.error('Failed to clear cache:', { error: error instanceof Error ? error.message : String(error) });
            return 0;
        }
    }

    /**
     * Increment a statistic
     */
    private async incrementStat(stat: string, value: number = 1): Promise<void> {
        try {
            await this.client.hIncrBy(`${this.STATS_PREFIX}global`, stat, value);
        } catch (error) {
            loggingService.error(`Failed to increment stat ${stat}:`, { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Update cache metadata
     */
    private async updateCacheMetadata(key: string, updates: Partial<CacheEntry['metadata']>): Promise<void> {
        try {
            const entry = await this.client.get(key);
            if (entry) {
                const data = JSON.parse(entry) as CacheEntry;
                data.metadata = { ...data.metadata, ...updates };
                const ttl = await this.client.ttl(key);
                if (ttl > 0) {
                    await this.client.setEx(key, ttl, JSON.stringify(data));
                }
            }
        } catch (error) {
            loggingService.error('Failed to update cache metadata:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Update user statistics
     */
    private async updateUserStats(userId: string, stats: {
        requests?: number;
        tokens?: number;
        cost?: number;
    }): Promise<void> {
        try {
            const userKey = `${this.USER_PREFIX}${userId}`;
            if (stats.requests) await this.client.hIncrBy(userKey, 'requests', stats.requests);
            if (stats.tokens) await this.client.hIncrBy(userKey, 'tokens', stats.tokens);
            if (stats.cost) await this.client.hIncrByFloat(userKey, 'cost', stats.cost);
            
            // Set expiry to 30 days
            await this.client.expire(userKey, 30 * 24 * 3600);
        } catch (error) {
            loggingService.error('Failed to update user stats:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Get top models by cache hits
     */
    private async getTopModels(limit: number = 5): Promise<{ model: string; hits: number }[]> {
        try {
            const pattern = `${this.CACHE_PREFIX}*`;
            const keys = await this.readerClient.keys(pattern);
            const modelCounts = new Map<string, number>();
            
            for (const key of keys) {
                const parts = key.split(':');
                const model = parts[2]; // Assuming format cache:provider:model:user:hash
                if (model && model !== 'unknown') {
                    modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
                }
            }
            
            return Array.from(modelCounts.entries())
                .map(([model, hits]) => ({ model, hits }))
                .sort((a, b) => b.hits - a.hits)
                .slice(0, limit);
        } catch (error) {
            loggingService.error('Failed to get top models:', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    /**
     * Get top users by cache hits
     */
    private async getTopUsers(limit: number = 5): Promise<{ userId: string; hits: number }[]> {
        try {
            const pattern = `${this.USER_PREFIX}*`;
            const keys = await this.readerClient.keys(pattern);
            const userStats: { userId: string; hits: number }[] = [];
            
            for (const key of keys) {
                const userId = key.replace(this.USER_PREFIX, '');
                const requests = await this.readerClient.hGet(key, 'requests');
                if (requests) {
                    userStats.push({ userId, hits: parseInt(requests) });
                }
            }
            
            return userStats
                .sort((a, b) => b.hits - a.hits)
                .slice(0, limit);
        } catch (error) {
            loggingService.error('Failed to get top users:', { error: error instanceof Error ? error.message : String(error) });
            return [];
        }
    }

    /**
     * Warmup cache with common queries
     */
    public async warmupCache(queries: { prompt: string; response: any; metadata?: any }[]): Promise<void> {
        try {
            loggingService.info(`Warming up cache with ${queries.length} entries`);
            
            for (const query of queries) {
                await this.storeCache(query.prompt, query.response, query.metadata);
            }
            
            loggingService.info('Cache warmup completed');
        } catch (error) {
            loggingService.error('Cache warmup failed:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Export cache for backup
     */
    public async exportCache(): Promise<{ entries: CacheEntry[]; stats: CacheStats }> {
        try {
            const pattern = `${this.CACHE_PREFIX}*`;
            const keys = await this.readerClient.keys(pattern);
            const entries: CacheEntry[] = [];
            
            for (const key of keys) {
                const data = await this.readerClient.get(key);
                if (data) {
                    entries.push(JSON.parse(data));
                }
            }
            
            const stats = await this.getCacheStats();
            
            return { entries, stats };
        } catch (error) {
            loggingService.error('Failed to export cache:', { error: error instanceof Error ? error.message : String(error) });
            return { entries: [], stats: await this.getCacheStats() };
        }
    }

    /**
     * Import cache from backup
     */
    public async importCache(data: { entries: CacheEntry[] }): Promise<void> {
        try {
            loggingService.info(`Importing ${data.entries.length} cache entries`);
            
            for (const entry of data.entries) {
                await this.client.setEx(
                    entry.key,
                    entry.metadata.ttl,
                    JSON.stringify(entry)
                );
            }
            
            loggingService.info('Cache import completed');
        } catch (error) {
            loggingService.error('Failed to import cache:', { error: error instanceof Error ? error.message : String(error) });
        }
    }

    /**
     * Basic Redis operations for middleware caching
     */
    
    /**
     * Set a key with value and TTL
     */
    public async set(key: string, value: any, ttl: number = 3600): Promise<void> {
        try {
            if (this.isLocalDev) {
                // In-memory fallback for development
                this.inMemoryCache.set(key, {
                    value: JSON.stringify(value),
                    expiry: Date.now() + (ttl * 1000)
                });
                return;
            }

            if (this.client && this._isConnected) {
                await this.client.setEx(key, ttl, JSON.stringify(value));
            }
        } catch (error) {
            loggingService.warn('Redis set failed, using in-memory fallback:', { error: error instanceof Error ? error.message : String(error) });
            // Fallback to in-memory
            this.inMemoryCache.set(key, {
                value: JSON.stringify(value),
                expiry: Date.now() + (ttl * 1000)
            });
        }
    }

    /**
     * Get a value by key
     */
    public async get(key: string): Promise<any | null> {
        try {
            if (this.isLocalDev) {
                // In-memory fallback for development
                const entry = this.inMemoryCache.get(key);
                if (entry && entry.expiry > Date.now()) {
                    return JSON.parse(entry.value);
                }
                return null;
            }

            if (this.readerClient && this._isConnected) {
                const value = await this.readerClient.get(key);
                if (value) {
                    return JSON.parse(value);
                }
            }
        } catch (error) {
            loggingService.warn('Redis get failed, trying in-memory fallback:', { error: error instanceof Error ? error.message : String(error) });
        }

        // Fallback to in-memory
        try {
            const entry = this.inMemoryCache.get(key);
            if (entry && entry.expiry > Date.now()) {
                return JSON.parse(entry.value);
            }
        } catch (error) {
            loggingService.warn('In-memory fallback also failed:', { error: error instanceof Error ? error.message : String(error) });
        }

        return null;
    }

    /**
     * Delete a key
     */
    public async del(key: string): Promise<void> {
        try {
            if (this.isLocalDev) {
                this.inMemoryCache.delete(key);
                return;
            }

            if (this.client && this._isConnected) {
                await this.client.del(key);
            }
        } catch (error) {
            loggingService.warn('Redis del failed, using in-memory fallback:', { error: error instanceof Error ? error.message : String(error) });
        }

        // Always delete from in-memory as fallback
        this.inMemoryCache.delete(key);
    }

    /**
     * Scan keys matching a pattern
     * Returns array of matching keys
     */
    public async scanKeys(pattern: string): Promise<string[]> {
        try {
            if (this.isLocalDev) {
                // In-memory implementation
                const allKeys = Array.from(this.inMemoryCache.keys());
                const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
                return allKeys.filter(key => regex.test(key));
            }

            if (this.readerClient && this._isConnected) {
                // Use Redis SCAN command
                const keys: string[] = [];
                let cursor = 0;
                
                do {
                    const result = await this.readerClient.scan(cursor, {
                        MATCH: pattern,
                        COUNT: 100
                    });
                    cursor = result.cursor;
                    keys.push(...result.keys);
                } while (cursor !== 0);
                
                return keys;
            }
        } catch (error) {
            loggingService.warn('Redis scan failed, using in-memory fallback:', { error: error instanceof Error ? error.message : String(error) });
        }

        // Fallback to in-memory
        const allKeys = Array.from(this.inMemoryCache.keys());
        const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
        return allKeys.filter(key => regex.test(key));
    }

    /**
     * Check if a key exists
     */
    public async exists(key: string): Promise<boolean> {
        try {
            if (this.isLocalDev) {
                return this.inMemoryCache.has(key) && 
                       this.inMemoryCache.get(key)!.expiry > Date.now();
            }

            if (this.readerClient && this._isConnected) {
                const exists = await this.readerClient.exists(key);
                return exists === 1;
            }
        } catch (error) {
            loggingService.warn('Redis exists failed, using in-memory fallback:', { error: error instanceof Error ? error.message : String(error) });
        }

        // Fallback to in-memory
        const entry = this.inMemoryCache.get(key);
        return !!(entry && entry.expiry > Date.now());
    }

    /**
     * Get TTL for a key
     */
    public async getTTL(key: string): Promise<number> {
        try {
            if (this.isLocalDev) {
                const entry = this.inMemoryCache.get(key);
                if (entry && entry.expiry > Date.now()) {
                    return Math.ceil((entry.expiry - Date.now()) / 1000);
                }
                return -1;
            }

            if (this.readerClient && this._isConnected) {
                return await this.readerClient.ttl(key);
            }
        } catch (error) {
            loggingService.warn('Redis TTL failed, using in-memory fallback:', { error: error instanceof Error ? error.message : String(error) });
        }

        // Fallback to in-memory
        const entry = this.inMemoryCache.get(key);
        if (entry && entry.expiry > Date.now()) {
            return Math.ceil((entry.expiry - Date.now()) / 1000);
        }
        return -1;
    }

    /**
     * Increment a counter
     */
    public async incr(key: string, amount: number = 1): Promise<number> {
        try {
            if (this.isLocalDev) {
                const entry = this.inMemoryCache.get(key);
                let currentValue = 0;
                
                if (entry && entry.expiry > Date.now()) {
                    try {
                        currentValue = parseInt(entry.value) || 0;
                    } catch (error) {
                        currentValue = 0;
                    }
                }
                
                const newValue = currentValue + amount;
                this.inMemoryCache.set(key, {
                    value: newValue.toString(),
                    expiry: Date.now() + (3600 * 1000) // 1 hour default
                });
                
                return newValue;
            }

            if (this.client && this._isConnected) {
                if (amount === 1) {
                    return await this.client.incr(key);
                } else {
                    return await this.client.incrBy(key, amount);
                }
            }
        } catch (error) {
            loggingService.warn('Redis incr failed, using in-memory fallback:', { error: error instanceof Error ? error.message : String(error) });
        }

        // Fallback to in-memory
        const entry = this.inMemoryCache.get(key);
        let currentValue = 0;
        
        if (entry && entry.expiry > Date.now()) {
            try {
                currentValue = parseInt(entry.value) || 0;
            } catch (error) {
                currentValue = 0;
            }
        }
        
        const newValue = currentValue + amount;
        this.inMemoryCache.set(key, {
            value: newValue.toString(),
            expiry: Date.now() + (3600 * 1000) // 1 hour default
        });
        
        return newValue;
    }

    /**
     * Flush all keys in current database
     */
    public async flushDB(): Promise<void> {
        try {
            if (this.isLocalDev) {
                this.inMemoryCache.clear();
                return;
            }

            if (this.client && this._isConnected) {
                await this.client.flushDb();
            }
        } catch (error) {
            loggingService.warn('Redis flushDB failed, using in-memory fallback:', { error: error instanceof Error ? error.message : String(error) });
        }

        // Always clear in-memory as fallback
        this.inMemoryCache.clear();
    }
}

// Export singleton instance
export const redisService = RedisService.getInstance();
