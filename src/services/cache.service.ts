import { redisService } from './redis.service';
import { loggingService } from './logging.service';

/**
 * Unified Cache Service for Middleware
 * Provides Redis as primary cache with in-memory fallback
 */
export class CacheService {
    private static instance: CacheService;
    private inMemoryCache: Map<string, { value: any; expiry: number; metadata?: any }> = new Map();
    private cacheStats: Map<string, { hits: number; misses: number; sets: number }> = new Map();

    private constructor() {
        this.startCleanupInterval();
    }

    public static getInstance(): CacheService {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService();
        }
        return CacheService.instance;
    }

    /**
     * Set cache entry with Redis primary and in-memory fallback
     */
    public async set(
        key: string, 
        value: any, 
        ttl: number = 3600, 
        metadata?: any
    ): Promise<void> {
        const startTime = Date.now();
        
        loggingService.info('=== CACHE SET OPERATION STARTED ===', { value:  { 
            component: 'CacheService',
            operation: 'set',
            type: 'cache_set',
            key,
            ttl,
            hasMetadata: !!metadata
         } });

        try {
            // Try Redis first
            if (redisService.isConnected) {
                loggingService.info('Step 1: Attempting to set cache in Redis', { value:  { 
                    component: 'CacheService',
                    operation: 'set',
                    type: 'cache_set',
                    step: 'redis_set_attempt',
                    key,
                    ttl
                 } });

                await redisService.set(key, value, ttl);
                
                loggingService.info('Cache set in Redis successfully', {
                    component: 'CacheService',
                    operation: 'set',
                    type: 'cache_set',
                    step: 'redis_set_success',
                    key,
                    ttl,
                    redisTime: `${Date.now() - startTime}ms`
                });
            } else {
                loggingService.warn('Redis not connected, skipping Redis cache set', { value:  { component: 'CacheService',
                    operation: 'set',
                    type: 'cache_set',
                    step: 'redis_skip',
                    key,
                    reason: 'redis_not_connected'
                 } });
            }
        } catch (error) {
            loggingService.warn('Redis cache set failed, falling back to in-memory', { value:  { component: 'CacheService',
                operation: 'set',
                type: 'cache_set',
                step: 'redis_fallback',
                key,
                error: error instanceof Error ? error.message : 'Unknown error'
             } });
        }

        // Always set in in-memory cache as fallback
        loggingService.info('Step 2: Setting cache in in-memory fallback', { value:  { 
            component: 'CacheService',
            operation: 'set',
            type: 'cache_set',
            step: 'memory_set',
            key,
            ttl
         } });

        const expiry = Date.now() + (ttl * 1000);
        this.inMemoryCache.set(key, { value, expiry, metadata });
        this.updateStats(key, 'sets');

        loggingService.info('Cache set in in-memory fallback successfully', {
            component: 'CacheService',
            operation: 'set',
            type: 'cache_set',
            step: 'memory_set_success',
            key,
            expiry: new Date(expiry).toISOString(),
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== CACHE SET OPERATION COMPLETED ===', {
            component: 'CacheService',
            operation: 'set',
            type: 'cache_set',
            step: 'completed',
            key,
            totalTime: `${Date.now() - startTime}ms`
        });
    }

    /**
     * Get cache entry with Redis primary and in-memory fallback
     */
    public async get<T = any>(key: string): Promise<T | null> {
        const startTime = Date.now();
        
        loggingService.info('=== CACHE GET OPERATION STARTED ===', { value:  { 
            component: 'CacheService',
            operation: 'get',
            type: 'cache_get',
            key
         } });

        let value: T | null = null;
        let source: 'redis' | 'memory' | 'none' = 'none';

        // Try Redis first
        try {
            if (redisService.isConnected) {
                loggingService.info('Step 1: Attempting to get cache from Redis', { value:  { 
                    component: 'CacheService',
                    operation: 'get',
                    type: 'cache_get',
                    step: 'redis_get_attempt',
                    key
                 } });

                value = await redisService.get(key);
                
                if (value !== null) {
                    source = 'redis';
                    this.updateStats(key, 'hits');
                    
                    loggingService.info('Cache retrieved from Redis successfully', {
                        component: 'CacheService',
                        operation: 'get',
                        type: 'cache_get',
                        step: 'redis_get_success',
                        key,
                        hasValue: !!value,
                        redisTime: `${Date.now() - startTime}ms`
                    });
                    
                    // Update in-memory cache for faster subsequent access
                    const ttl = await redisService.getTTL(key);
                    if (ttl > 0) {
                        this.inMemoryCache.set(key, { 
                            value, 
                            expiry: Date.now() + (ttl * 1000),
                            metadata: { source: 'redis', originalTTL: ttl }
                        });
                    }
                    
                    loggingService.info('Cache updated in in-memory for faster access', { value:  { 
                        component: 'CacheService',
                        operation: 'get',
                        type: 'cache_get',
                        step: 'memory_update',
                        key,
                        ttl
                     } });
                } else {
                    loggingService.debug('Cache not found in Redis', { value:  { component: 'CacheService',
                        operation: 'get',
                        type: 'cache_get',
                        step: 'redis_miss',
                        key
                     } });
                }
            } else {
                loggingService.warn('Redis not connected, skipping Redis cache get', { value:  { component: 'CacheService',
                    operation: 'get',
                    type: 'cache_get',
                    step: 'redis_skip',
                    key,
                    reason: 'redis_not_connected'
                 } });
            }
        } catch (error) {
            loggingService.warn('Redis cache get failed, falling back to in-memory', { value:  { component: 'CacheService',
                operation: 'get',
                type: 'cache_get',
                step: 'redis_fallback',
                key,
                error: error instanceof Error ? error.message : 'Unknown error'
             } });
        }

        // If Redis failed or returned null, try in-memory cache
        if (value === null) {
            loggingService.info('Step 2: Attempting to get cache from in-memory fallback', { value:  { 
                component: 'CacheService',
                operation: 'get',
                type: 'cache_get',
                step: 'memory_get_attempt',
                key
             } });

            const memoryEntry = this.inMemoryCache.get(key);
            
            if (memoryEntry && memoryEntry.expiry > Date.now()) {
                value = memoryEntry.value;
                source = 'memory';
                this.updateStats(key, 'hits');
                
                loggingService.info('Cache retrieved from in-memory fallback successfully', {
                    component: 'CacheService',
                    operation: 'get',
                    type: 'cache_get',
                    step: 'memory_get_success',
                    key,
                    hasValue: !!value,
                    expiry: new Date(memoryEntry.expiry).toISOString(),
                    metadata: memoryEntry.metadata
                });
            } else if (memoryEntry && memoryEntry.expiry <= Date.now()) {
                // Clean up expired entry
                this.inMemoryCache.delete(key);
                loggingService.debug('Expired cache entry removed from in-memory', {
                    component: 'CacheService',
                    operation: 'get',
                    type: 'cache_get',
                    step: 'memory_cleanup',
                    key,
                    expiredAt: new Date(memoryEntry.expiry).toISOString()
                });
            } else {
                loggingService.debug('Cache not found in in-memory fallback', { value:  { component: 'CacheService',
                    operation: 'get',
                    type: 'cache_get',
                    step: 'memory_miss',
                    key
                 } });
            }
        }

        // Update stats
        if (value === null) {
            this.updateStats(key, 'misses');
        }

        loggingService.info('Cache get operation completed', {
            component: 'CacheService',
            operation: 'get',
            type: 'cache_get',
            step: 'completed',
            key,
            hasValue: !!value,
            source,
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== CACHE GET OPERATION COMPLETED ===', {
            component: 'CacheService',
            operation: 'get',
            type: 'cache_get',
            step: 'completed',
            key,
            source,
            totalTime: `${Date.now() - startTime}ms`
        });

        return value;
    }

    /**
     * Delete cache entry from both Redis and in-memory
     */
    public async delete(key: string): Promise<void> {
        const startTime = Date.now();
        
        loggingService.info('=== CACHE DELETE OPERATION STARTED ===', { value:  { 
            component: 'CacheService',
            operation: 'delete',
            type: 'cache_delete',
            key
         } });

        // Try Redis first
        try {
            if (redisService.isConnected) {
                loggingService.info('Step 1: Attempting to delete cache from Redis', { value:  { 
                    component: 'CacheService',
                    operation: 'delete',
                    type: 'cache_delete',
                    step: 'redis_delete_attempt',
                    key
                 } });

                await redisService.del(key);
                
                loggingService.info('Cache deleted from Redis successfully', {
                    component: 'CacheService',
                    operation: 'delete',
                    type: 'cache_delete',
                    step: 'redis_delete_success',
                    key,
                    redisTime: `${Date.now() - startTime}ms`
                });
            } else {
                loggingService.warn('Redis not connected, skipping Redis cache delete', { value:  { component: 'CacheService',
                    operation: 'delete',
                    type: 'cache_delete',
                    step: 'redis_skip',
                    key,
                    reason: 'redis_not_connected'
                 } });
            }
        } catch (error) {
            loggingService.warn('Redis cache delete failed, continuing with in-memory delete', { value:  { component: 'CacheService',
                operation: 'delete',
                type: 'cache_delete',
                step: 'redis_fallback',
                key,
                error: error instanceof Error ? error.message : 'Unknown error'
             } });
        }

        // Always delete from in-memory cache
        loggingService.info('Step 2: Deleting cache from in-memory fallback', { value:  { 
            component: 'CacheService',
            operation: 'delete',
            type: 'cache_delete',
            step: 'memory_delete',
            key
         } });

        const deleted = this.inMemoryCache.delete(key);
        
        loggingService.info('Cache delete from in-memory completed', {
            component: 'CacheService',
            operation: 'delete',
            type: 'cache_delete',
            step: 'memory_delete_complete',
            key,
            wasDeleted: deleted,
            totalTime: `${Date.now() - startTime}ms`
        });

        loggingService.info('=== CACHE DELETE OPERATION COMPLETED ===', {
            component: 'CacheService',
            operation: 'delete',
            type: 'cache_delete',
            step: 'completed',
            key,
            totalTime: `${Date.now() - startTime}ms`
        });
    }

    /**
     * Check if cache entry exists
     */
    public async exists(key: string): Promise<boolean> {
        const startTime = Date.now();
        
        loggingService.debug('=== CACHE EXISTS OPERATION STARTED ===', { value:  { component: 'CacheService',
            operation: 'exists',
            type: 'cache_exists',
            key
         } });

        let exists = false;
        let source: 'redis' | 'memory' | 'none' = 'none';

        // Try Redis first
        try {
            if (redisService.isConnected) {
                exists = await redisService.exists(key);
                if (exists) {
                    source = 'redis';
                }
            }
        } catch (error) {
            loggingService.debug('Redis exists check failed, falling back to in-memory', { value:  { component: 'CacheService',
                operation: 'exists',
                type: 'cache_exists',
                step: 'redis_fallback',
                key,
                error: error instanceof Error ? error.message : 'Unknown error'
             } });
        }

        // If Redis failed or returned false, check in-memory
        if (!exists) {
            const memoryEntry = this.inMemoryCache.get(key);
            if (memoryEntry && memoryEntry.expiry > Date.now()) {
                exists = true;
                source = 'memory';
            }
        }

        loggingService.debug('Cache exists operation completed', {
            component: 'CacheService',
            operation: 'exists',
            type: 'cache_exists',
            step: 'completed',
            key,
            exists,
            source,
            totalTime: `${Date.now() - startTime}ms`
        });

        return exists;
    }

    /**
     * Set cache entry with expiration (TTL)
     */
    public async setEx(key: string, ttl: number, value: any, metadata?: any): Promise<void> {
        return this.set(key, value, ttl, metadata);
    }

    /**
     * Get cache entry with TTL
     */
    public async getEx<T = any>(key: string): Promise<{ value: T | null; ttl: number }> {
        const startTime = Date.now();
        
        loggingService.debug('=== CACHE GETEX OPERATION STARTED ===', { value:  { component: 'CacheService',
            operation: 'getEx',
            type: 'cache_getex',
            key
         } });

        const value = await this.get<T>(key);
        let ttl = -1;

        // Try to get TTL from Redis
        try {
            if (redisService.isConnected) {
                ttl = await redisService.getTTL(key);
            }
        } catch (error) {
            loggingService.debug('Redis TTL check failed, using in-memory expiry', { value:  { component: 'CacheService',
                operation: 'getEx',
                type: 'cache_getex',
                step: 'redis_ttl_fallback',
                key,
                error: error instanceof Error ? error.message : 'Unknown error'
             } });
        }

        // If Redis TTL failed, calculate from in-memory expiry
        if (ttl === -1) {
            const memoryEntry = this.inMemoryCache.get(key);
            if (memoryEntry && memoryEntry.expiry > Date.now()) {
                ttl = Math.ceil((memoryEntry.expiry - Date.now()) / 1000);
            }
        }

        loggingService.debug('Cache getex operation completed', {
            component: 'CacheService',
            operation: 'getEx',
            type: 'cache_getex',
            step: 'completed',
            key,
            hasValue: !!value,
            ttl,
            totalTime: `${Date.now() - startTime}ms`
        });

        return { value, ttl };
    }

    /**
     * Increment cache counter
     */
    public async incr(key: string, amount: number = 1): Promise<number> {
        const startTime = Date.now();
        
        loggingService.debug('=== CACHE INCR OPERATION STARTED ===', { value:  { component: 'CacheService',
            operation: 'incr',
            type: 'cache_incr',
            key,
            amount
         } });

        let newValue = amount;

        // Try Redis first
        try {
            if (redisService.isConnected) {
                newValue = await redisService.incr(key, amount);
            }
        } catch (error) {
            loggingService.debug('Redis incr failed, falling back to in-memory', { value:  { component: 'CacheService',
                operation: 'incr',
                type: 'cache_incr',
                step: 'redis_fallback',
                key,
                error: error instanceof Error ? error.message : 'Unknown error'
             } });
        }

        // Fallback to in-memory
        const memoryEntry = this.inMemoryCache.get(key);
        if (memoryEntry && typeof memoryEntry.value === 'number') {
            newValue = memoryEntry.value + amount;
            this.inMemoryCache.set(key, { 
                ...memoryEntry, 
                value: newValue 
            });
        } else {
            this.inMemoryCache.set(key, { 
                value: newValue, 
                expiry: Date.now() + (3600 * 1000) // 1 hour default
            });
        }

        loggingService.debug('Cache incr operation completed', {
            component: 'CacheService',
            operation: 'incr',
            type: 'cache_incr',
            step: 'completed',
            key,
            newValue,
            totalTime: `${Date.now() - startTime}ms`
        });

        return newValue;
    }

    /**
     * Get cache statistics
     */
    public getStats(): { [key: string]: { hits: number; misses: number; sets: number } } {
        const stats: { [key: string]: { hits: number; misses: number; sets: number } } = {};
        
        for (const entry of Array.from(this.cacheStats.entries())) {
            const [key, value] = entry;
            stats[key] = { ...value };
        }
        
        return stats;
    }

    /**
     * Clear all cache entries
     */
    public async clear(): Promise<void> {
        loggingService.info('=== CACHE CLEAR OPERATION STARTED ===', { value:  { 
            component: 'CacheService',
            operation: 'clear',
            type: 'cache_clear',
            step: 'started'
         } });

        // Clear Redis cache
        try {
            if (redisService.isConnected) {
                await redisService.flushDB();
                loggingService.info('Redis cache cleared successfully', { value:  { 
                    component: 'CacheService',
                    operation: 'clear',
                    type: 'cache_clear',
                    step: 'redis_cleared'
                 } });
            }
        } catch (error) {
            loggingService.warn('Redis cache clear failed', { value:  { component: 'CacheService',
                operation: 'clear',
                type: 'cache_clear',
                step: 'redis_clear_failed',
                error: error instanceof Error ? error.message : 'Unknown error'
             } });
        }

        // Clear in-memory cache
        this.inMemoryCache.clear();
        this.cacheStats.clear();
        
        loggingService.info('In-memory cache cleared successfully', { value:  { 
            component: 'CacheService',
            operation: 'clear',
            type: 'cache_clear',
            step: 'memory_cleared'
         } });

        loggingService.info('=== CACHE CLEAR OPERATION COMPLETED ===', { value:  { 
            component: 'CacheService',
            operation: 'clear',
            type: 'cache_clear',
            step: 'completed'
         } });
    }

    /**
     * Get cache size information
     */
    public getSizeInfo(): { redis: boolean; memory: number; total: number } {
        return {
            redis: redisService.isConnected,
            memory: this.inMemoryCache.size,
            total: this.inMemoryCache.size
        };
    }

    /**
     * Update cache statistics
     */
    private updateStats(key: string, operation: 'hits' | 'misses' | 'sets'): void {
        if (!this.cacheStats.has(key)) {
            this.cacheStats.set(key, { hits: 0, misses: 0, sets: 0 });
        }
        
        const stats = this.cacheStats.get(key)!;
        stats[operation]++;
    }

    /**
     * Start cleanup interval for expired entries
     */
    private startCleanupInterval(): void {
        setInterval(() => {
            const now = Date.now();
            let cleanedCount = 0;
            
            for (const cacheEntry of Array.from(this.inMemoryCache.entries())) {
                const [key, entry] = cacheEntry;
                if (entry.expiry <= now) {
                    this.inMemoryCache.delete(key);
                    cleanedCount++;
                }
            }
            
            if (cleanedCount > 0) {
                loggingService.debug('Cache cleanup completed', { value:  { component: 'CacheService',
                    operation: 'cleanup',
                    type: 'cache_cleanup',
                    cleanedCount,
                    remainingEntries: this.inMemoryCache.size
                 } });
            }
        }, 60000); // Run every minute
    }
}

// Export singleton instance
export const cacheService = CacheService.getInstance();
