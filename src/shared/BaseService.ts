import { EventEmitter } from 'events';
import { loggingService } from '../services/logging.service';
import { LRUCache } from 'lru-cache';

/**
 * Base service class with common patterns and utilities
 * Provides standardized error handling, caching, and circuit breaker patterns
 */
export abstract class BaseService extends EventEmitter {
    protected readonly serviceName: string;
    protected cache?: LRUCache<string, any>;
    protected circuitBreakerState: 'closed' | 'open' | 'half-open' = 'closed';
    protected failureCount = 0;
    protected lastFailureTime = 0;
    
    // Circuit breaker configuration
    protected readonly maxFailures = 5;
    protected readonly resetTimeout = 60000; // 1 minute
    protected readonly halfOpenMaxCalls = 3;
    
    constructor(serviceName: string, cacheConfig?: {
        max: number;
        ttl: number;
    }) {
        super();
        this.serviceName = serviceName;
        
        // Initialize cache if configuration provided
        if (cacheConfig) {
            this.cache = new LRUCache({
                max: cacheConfig.max,
                ttl: cacheConfig.ttl,
                updateAgeOnGet: true,
                allowStale: false
            });
        }
        
        // Increase EventEmitter limits to prevent warnings
        this.setMaxListeners(20);
    }

    /**
     * Execute operation with circuit breaker protection
     */
    protected async executeWithCircuitBreaker<T>(
        operation: () => Promise<T>,
        operationName: string
    ): Promise<T> {
        // Check circuit breaker state
        if (this.circuitBreakerState === 'open') {
            if (Date.now() - this.lastFailureTime > this.resetTimeout) {
                this.circuitBreakerState = 'half-open';
                this.failureCount = 0;
                loggingService.info(`Circuit breaker half-open for ${this.serviceName}.${operationName}`);
            } else {
                throw new ServiceError(
                    `Circuit breaker is open for ${this.serviceName}.${operationName}`,
                    'CIRCUIT_BREAKER_OPEN',
                    503
                );
            }
        }

        try {
            const result = await operation();
            
            // Success - reset circuit breaker
            if (this.circuitBreakerState === 'half-open') {
                this.circuitBreakerState = 'closed';
                this.failureCount = 0;
                loggingService.info(`Circuit breaker closed for ${this.serviceName}.${operationName}`);
            }
            
            return result;
        } catch (error) {
            this.handleFailure(operationName, error);
            throw error;
        }
    }

    /**
     * Handle operation failure and update circuit breaker state
     */
    private handleFailure(operationName: string, error: any): void {
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.failureCount >= this.maxFailures) {
            this.circuitBreakerState = 'open';
            loggingService.warn(
                `Circuit breaker opened for ${this.serviceName}.${operationName} after ${this.failureCount} failures`,
                {
                    component: this.serviceName,
                    operation: operationName,
                    error: error instanceof Error ? error.message : String(error),
                    failureCount: this.failureCount
                }
            );
        }

        loggingService.error(`Operation failed in ${this.serviceName}.${operationName}`, {
            component: this.serviceName,
            operation: operationName,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            failureCount: this.failureCount,
            circuitBreakerState: this.circuitBreakerState
        });
    }

    /**
     * Execute operation with timeout protection
     */
    protected async executeWithTimeout<T>(
        operation: () => Promise<T>,
        timeoutMs: number,
        operationName: string
    ): Promise<T> {
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
                reject(new ServiceError(
                    `Operation ${operationName} timed out after ${timeoutMs}ms`,
                    'OPERATION_TIMEOUT',
                    408
                ));
            }, timeoutMs);
        });

        return Promise.race([operation(), timeoutPromise]);
    }

    /**
     * Get cached value or execute operation and cache result
     */
    protected async getCachedOrExecute<T>(
        key: string,
        operation: () => Promise<T>,
        ttl?: number
    ): Promise<T> {
        if (!this.cache) {
            return operation();
        }

        // Try to get from cache
        const cached = this.cache.get(key);
        if (cached !== undefined) {
            return cached as T;
        }

        // Execute operation and cache result
        const result = await operation();
        
        if (ttl) {
            this.cache.set(key, result, { ttl });
        } else {
            this.cache.set(key, result);
        }

        return result;
    }

    /**
     * Clear cache entries matching pattern
     */
    protected clearCachePattern(pattern: string): void {
        if (!this.cache) return;

        const regex = new RegExp(pattern);
        for (const key of this.cache.keys()) {
            if (regex.test(key)) {
                this.cache.delete(key);
            }
        }
    }

    /**
     * Get service health status
     */
    public getHealthStatus(): ServiceHealthStatus {
        return {
            serviceName: this.serviceName,
            circuitBreakerState: this.circuitBreakerState,
            failureCount: this.failureCount,
            lastFailureTime: this.lastFailureTime,
            cacheSize: this.cache?.size ?? 0,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage()
        };
    }

    /**
     * Graceful shutdown - cleanup resources
     */
    public async shutdown(): Promise<void> {
        try {
            this.cache?.clear();
            this.removeAllListeners();
            loggingService.info(`${this.serviceName} service shutdown completed`);
        } catch (error) {
            loggingService.error(`Error during ${this.serviceName} service shutdown`, {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }
}

/**
 * Standardized service error class
 */
export class ServiceError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly statusCode: number = 500,
        public readonly context?: any
    ) {
        super(message);
        this.name = 'ServiceError';
        
        // Maintain proper stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ServiceError);
        }
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            code: this.code,
            statusCode: this.statusCode,
            context: this.context,
            stack: this.stack
        };
    }
}

/**
 * Service health status interface
 */
export interface ServiceHealthStatus {
    serviceName: string;
    circuitBreakerState: 'closed' | 'open' | 'half-open';
    failureCount: number;
    lastFailureTime: number;
    cacheSize: number;
    uptime: number;
    memoryUsage: NodeJS.MemoryUsage;
}

/**
 * Common service configuration interface
 */
export interface ServiceConfig {
    maxRetries?: number;
    timeoutMs?: number;
    cacheConfig?: {
        max: number;
        ttl: number;
    };
    circuitBreakerConfig?: {
        maxFailures: number;
        resetTimeout: number;
    };
}
