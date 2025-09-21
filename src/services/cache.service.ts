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
    private readonly MAX_STATS_ENTRIES = 10000; // Prevent memory leaks
    private readonly ENABLE_DEBUG_LOGS = process.env.CACHE_DEBUG === 'true'; // Set CACHE_DEBUG=true for detailed cache logs

    private constructor() {
        this.startCleanupInterval();
        this.startStatsCleanupInterval();
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
        let redisSuccess = false;
        
        if (this.ENABLE_DEBUG_LOGS) {
            loggingService.debug('Cache set operation started', { key, ttl });
        }

        // Streamlined Redis operation with single try-catch
        if (redisService.isConnected) {
            try {
                await redisService.set(key, value, ttl);
                redisSuccess = true;
                if (this.ENABLE_DEBUG_LOGS) {
                    loggingService.debug('Cache set in Redis', { key, time: `${Date.now() - startTime}ms` });
                }
            } catch (error) {
                // Only log Redis errors if they're not connection-related
                if (this.ENABLE_DEBUG_LOGS || !(error instanceof Error && error.message.includes('connection'))) {
                    loggingService.warn('Redis cache set failed', { 
                        key, 
                        error: error instanceof Error ? error.message : 'Unknown error' 
                    });
                }
            }
        }

        // Always set in in-memory cache as fallback
        const expiry = Date.now() + (ttl * 1000);
        this.inMemoryCache.set(key, { value, expiry, metadata });
        this.updateStats(key, 'sets');

        if (this.ENABLE_DEBUG_LOGS) {
            loggingService.debug('Cache set completed', {
                key,
                redisSuccess,
                totalTime: `${Date.now() - startTime}ms`
            });
        }
    }

    /**
     * Get cache entry with Redis primary and in-memory fallback
     */
    public async get<T = any>(key: string): Promise<T | null> {
        const startTime = Date.now();
        let value: T | null = null;
        let source: 'redis' | 'memory' | 'none' = 'none';

        if (this.ENABLE_DEBUG_LOGS) {
            loggingService.debug('Cache get operation started', { key });
        }

        // Streamlined Redis operation
        if (redisService.isConnected) {
            try {
                value = await redisService.get(key);
                if (value !== null) {
                    source = 'redis';
                    this.updateStats(key, 'hits');
                    
                    // Efficiently update in-memory cache without additional Redis call
                    // Use a reasonable default TTL for memory cache
                    this.inMemoryCache.set(key, { 
                        value, 
                        expiry: Date.now() + (3600 * 1000), // 1 hour default
                        metadata: { source: 'redis' }
                    });
                    
                    if (this.ENABLE_DEBUG_LOGS) {
                        loggingService.debug('Cache hit from Redis', { key, time: `${Date.now() - startTime}ms` });
                    }
                }
            } catch (error) {
                if (this.ENABLE_DEBUG_LOGS || !(error instanceof Error && error.message.includes('connection'))) {
                    loggingService.warn('Redis cache get failed', { 
                        key, 
                        error: error instanceof Error ? error.message : 'Unknown error' 
                    });
                }
            }
        }

        // Fallback to in-memory cache
        if (value === null) {
            const memoryEntry = this.inMemoryCache.get(key);
            
            if (memoryEntry && memoryEntry.expiry > Date.now()) {
                value = memoryEntry.value;
                source = 'memory';
                this.updateStats(key, 'hits');
                
                if (this.ENABLE_DEBUG_LOGS) {
                    loggingService.debug('Cache hit from memory', { key });
                }
            } else if (memoryEntry && memoryEntry.expiry <= Date.now()) {
                // Clean up expired entry
                this.inMemoryCache.delete(key);
            }
        }

        // Update miss stats
        if (value === null) {
            this.updateStats(key, 'misses');
        }

        if (this.ENABLE_DEBUG_LOGS) {
            loggingService.debug('Cache get completed', {
                key,
                source,
                hasValue: !!value,
                totalTime: `${Date.now() - startTime}ms`
            });
        }

        return value;
    }

    /**
     * Delete cache entry from both Redis and in-memory
     */
    public async delete(key: string): Promise<void> {
        if (this.ENABLE_DEBUG_LOGS) {
            loggingService.debug('Cache delete operation started', { key });
        }

        // Streamlined Redis delete
        if (redisService.isConnected) {
            try {
                await redisService.del(key);
            } catch (error) {
                if (this.ENABLE_DEBUG_LOGS) {
                    loggingService.warn('Redis cache delete failed', { 
                        key, 
                        error: error instanceof Error ? error.message : 'Unknown error' 
                    });
                }
            }
        }

        // Always delete from in-memory cache
        this.inMemoryCache.delete(key);
        
        if (this.ENABLE_DEBUG_LOGS) {
            loggingService.debug('Cache delete completed', { key });
        }
    }

    /**
     * Check if cache entry exists
     */
    public async exists(key: string): Promise<boolean> {
        let exists = false;

        // Try Redis first
        if (redisService.isConnected) {
            try {
                exists = await redisService.exists(key);
            } catch (error) {
                // Silently fall back to memory check
            }
        }

        // If Redis failed or returned false, check in-memory
        if (!exists) {
            const memoryEntry = this.inMemoryCache.get(key);
            exists = !!(memoryEntry && memoryEntry.expiry > Date.now());
        }

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
        const value = await this.get<T>(key);
        let ttl = -1;

        // Try to get TTL from Redis
        if (redisService.isConnected && value !== null) {
            try {
                ttl = await redisService.getTTL(key);
            } catch (error) {
                // Fall back to in-memory TTL calculation
            }
        }

        // If Redis TTL failed, calculate from in-memory expiry
        if (ttl === -1) {
            const memoryEntry = this.inMemoryCache.get(key);
            if (memoryEntry && memoryEntry.expiry > Date.now()) {
                ttl = Math.ceil((memoryEntry.expiry - Date.now()) / 1000);
            }
        }

        return { value, ttl };
    }

    /**
     * Increment cache counter
     */
    public async incr(key: string, amount: number = 1): Promise<number> {
        let newValue = amount;

        // Try Redis first
        if (redisService.isConnected) {
            try {
                newValue = await redisService.incr(key, amount);
            } catch (error) {
                // Fall back to in-memory increment
            }
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

        return newValue;
    }

    /**
     * Get cache statistics
     */
    public getStats(): { [key: string]: { hits: number; misses: number; sets: number } } {
        const stats: { [key: string]: { hits: number; misses: number; sets: number } } = {};
        
        for (const [key, value] of this.cacheStats.entries()) {
            stats[key] = { ...value };
        }
        
        return stats;
    }

    /**
     * Clear all cache entries
     */
    public async clear(): Promise<void> {
        if (this.ENABLE_DEBUG_LOGS) {
            loggingService.debug('Cache clear operation started');
        }

        // Clear Redis cache
        if (redisService.isConnected) {
            try {
                await redisService.flushDB();
                if (this.ENABLE_DEBUG_LOGS) {
                    loggingService.debug('Redis cache cleared');
                }
            } catch (error) {
                loggingService.warn('Redis cache clear failed', { 
                    error: error instanceof Error ? error.message : 'Unknown error' 
                });
            }
        }

        // Clear in-memory cache
        this.inMemoryCache.clear();
        this.cacheStats.clear();
        
        if (this.ENABLE_DEBUG_LOGS) {
            loggingService.debug('Cache clear completed');
        }
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
     * Update cache statistics with memory leak prevention
     */
    private updateStats(key: string, operation: 'hits' | 'misses' | 'sets'): void {
        // Prevent memory leaks by limiting stats entries
        if (this.cacheStats.size >= this.MAX_STATS_ENTRIES && !this.cacheStats.has(key)) {
            // Remove oldest entry (first entry in Map)
            const firstKey = this.cacheStats.keys().next().value;
            if (firstKey) {
                this.cacheStats.delete(firstKey);
            }
        }
        
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
            
            for (const [key, entry] of this.inMemoryCache.entries()) {
                if (entry.expiry <= now) {
                    this.inMemoryCache.delete(key);
                    cleanedCount++;
                }
            }
            
            if (cleanedCount > 0 && this.ENABLE_DEBUG_LOGS) {
                loggingService.debug('Cache cleanup completed', {
                    cleanedCount,
                    remainingEntries: this.inMemoryCache.size
                });
            }
        }, 60000); // Run every minute
    }

    /**
     * Start stats cleanup interval to prevent memory leaks
     */
    private startStatsCleanupInterval(): void {
        setInterval(() => {
            // If stats map is getting too large, clean up entries with low activity
            if (this.cacheStats.size > this.MAX_STATS_ENTRIES * 0.8) {
                const entries = Array.from(this.cacheStats.entries());
                
                // Sort by total activity (hits + misses + sets) and keep most active
                entries.sort((a, b) => {
                    const totalA = a[1].hits + a[1].misses + a[1].sets;
                    const totalB = b[1].hits + b[1].misses + b[1].sets;
                    return totalB - totalA;
                });
                
                // Keep top 80% most active entries
                const keepCount = Math.floor(this.MAX_STATS_ENTRIES * 0.8);
                const toRemove = entries.slice(keepCount);
                
                for (const [key] of toRemove) {
                    this.cacheStats.delete(key);
                }
                
                if (toRemove.length > 0 && this.ENABLE_DEBUG_LOGS) {
                    loggingService.debug('Stats cleanup completed', {
                        removedEntries: toRemove.length,
                        remainingEntries: this.cacheStats.size
                    });
                }
            }
        }, 300000); // Run every 5 minutes
    }
}

// Export singleton instance
export const cacheService = CacheService.getInstance();
