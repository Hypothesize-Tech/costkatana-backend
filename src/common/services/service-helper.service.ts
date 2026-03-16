import { Injectable, Logger } from '@nestjs/common';
import mongoose, { ClientSession } from 'mongoose';
import { LoggingService } from './logging.service';

export interface CircuitBreakerConfig {
  maxFailures?: number;
  resetTimeout?: number;
  operationName?: string;
}

@Injectable()
export class ServiceHelper {
  private static readonly logger = new Logger(ServiceHelper.name);
  private static circuitBreakers = new Map<
    string,
    {
      failureCount: number;
      lastFailureTime: number;
      state: 'closed' | 'open' | 'half-open';
    }
  >();

  private static cache = new Map<
    string,
    {
      value: any;
      expiresAt: number;
    }
  >();

  constructor(private readonly loggingService: LoggingService) {}

  /**
   * Execute operation within a MongoDB transaction
   * Handles session creation, transaction commit/abort, and cleanup automatically
   *
   * @param operation - Async function to execute within transaction
   * @param operationName - Name of operation for logging purposes
   * @returns Promise resolving to operation result
   * @throws Error if transaction fails
   */
  static async withTransaction<T>(
    operation: (session: ClientSession) => Promise<T>,
    operationName: string = 'transaction',
  ): Promise<T> {
    const session = await mongoose.startSession();

    try {
      let result: T;

      await session.withTransaction(async () => {
        result = await operation(session);
      });

      return result!;
    } catch (error) {
      ServiceHelper.logger.error(`Transaction failed: ${operationName}`, error);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Execute operation with standardized error handling
   * Logs errors with context and re-throws for upstream handling
   *
   * @param operation - Async function to execute
   * @param context - Context object with operationName and additional metadata
   * @returns Promise resolving to operation result
   * @throws Original error after logging
   */
  async withErrorHandling<T>(
    operation: () => Promise<T>,
    context: {
      operationName: string;
      userId?: string;
      [key: string]: any;
    },
  ): Promise<T> {
    try {
      this.loggingService.debug(
        `Starting operation: ${context.operationName}`,
        context,
      );

      const result = await operation();

      this.loggingService.debug(
        `Operation completed: ${context.operationName}`,
        context,
      );

      return result;
    } catch (error) {
      this.loggingService.error(`Operation failed: ${context.operationName}`, {
        ...context,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  /**
   * Execute operation with fallback value on error
   * Does not re-throw errors, returns fallback value instead
   *
   * @param operation - Async function to execute
   * @param fallback - Value to return if operation fails
   * @param context - Context object with operationName and additional metadata
   * @returns Promise resolving to operation result or fallback
   */
  static async withFallback<T>(
    operation: () => Promise<T>,
    fallback: T,
    context: {
      operationName: string;
      [key: string]: any;
    },
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      ServiceHelper.logger.warn(
        `Operation failed, using fallback: ${context.operationName}`,
        {
          ...context,
          error: error instanceof Error ? error.message : String(error),
          fallbackValue: fallback,
        },
      );
      return fallback;
    }
  }

  /**
   * Validate ObjectId format
   *
   * @param id - ID string to validate
   * @param fieldName - Name of field for error message (default: 'id')
   * @throws Error if ID format is invalid
   */
  static validateObjectId(id: string, fieldName: string = 'id'): void {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new Error(`Invalid ${fieldName} format`);
    }
  }

  /**
   * Validate multiple ObjectIds
   *
   * @param ids - Array of ID strings to validate
   * @param fieldName - Name of field for error message (default: 'ids')
   * @throws Error if any ID format is invalid
   */
  static validateObjectIds(ids: string[], fieldName: string = 'ids'): void {
    for (const id of ids) {
      this.validateObjectId(id, fieldName);
    }
  }

  /**
   * Safe JSON parse with fallback
   */
  static safeJsonParse<T>(json: string, fallback: T): T {
    try {
      return JSON.parse(json);
    } catch (error) {
      ServiceHelper.logger.warn('JSON parse failed, using fallback', {
        error: error instanceof Error ? error.message : String(error),
        fallbackType: typeof fallback,
      });
      return fallback;
    }
  }

  /**
   * Truncate string to max length
   */
  static truncateString(
    str: string,
    maxLength: number,
    suffix: string = '...',
  ): string {
    if (str.length <= maxLength) {
      return str;
    }
    return str.substring(0, maxLength - suffix.length) + suffix;
  }

  /**
   * Calculate estimated token count
   */
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Format timestamp for display
   */
  static formatTimestamp(date: Date): string {
    return date.toISOString();
  }

  /**
   * Check if value is defined and not null
   */
  static isDefined<T>(value: T | undefined | null): value is T {
    return value !== undefined && value !== null;
  }

  /**
   * Safely get nested property
   */
  static getNestedProperty(
    obj: any,
    path: string,
    defaultValue: any = undefined,
  ): any {
    const keys = path.split('.');
    let result = obj;

    for (const key of keys) {
      if (result == null) {
        return defaultValue;
      }
      result = result[key];
    }

    return result ?? defaultValue;
  }

  /**
   * Retry operation with exponential backoff
   */
  static async withRetry<T>(
    operation: () => Promise<T>,
    options: {
      maxRetries?: number;
      delayMs?: number;
      backoffMultiplier?: number;
      shouldRetry?: (error: any) => boolean;
      onRetry?: (error: any, attempt: number) => void;
    } = {},
  ): Promise<T> {
    const { RetryWithBackoff } = await import('../utils/retry-with-backoff');

    const result = await RetryWithBackoff.execute(operation, {
      maxRetries: options.maxRetries ?? 3,
      baseDelay: options.delayMs ?? 1000,
      maxDelay: (options.delayMs ?? 1000) * 10,
      backoffMultiplier: options.backoffMultiplier ?? 2,
      jitter: true,
      onRetry: options.onRetry
        ? (error: Error, attempt: number) => {
            options.onRetry!(error, attempt);
          }
        : undefined,
    });

    if (result.success) {
      return result.result!;
    } else {
      throw result.error;
    }
  }

  /**
   * Execute operation with circuit breaker pattern
   * Prevents cascading failures by tracking failure rates
   *
   * @param operation - Async function to execute
   * @param config - Circuit breaker configuration
   * @returns Promise resolving to operation result
   * @throws Error if circuit is open or operation fails
   */
  static async withCircuitBreaker<T>(
    operation: () => Promise<T>,
    config: CircuitBreakerConfig = {},
  ): Promise<T> {
    const {
      maxFailures = 5,
      resetTimeout = 300000, // 5 minutes
      operationName = 'operation',
    } = config;

    // Get or create circuit breaker state
    let breaker = this.circuitBreakers.get(operationName);
    if (!breaker) {
      breaker = {
        failureCount: 0,
        lastFailureTime: 0,
        state: 'closed',
      };
      this.circuitBreakers.set(operationName, breaker);
    }

    // Check if circuit should reset (timeout expired)
    const now = Date.now();
    if (
      breaker.state === 'open' &&
      now - breaker.lastFailureTime >= resetTimeout
    ) {
      breaker.state = 'half-open';
      breaker.failureCount = 0;
      ServiceHelper.logger.log(`Circuit breaker entering half-open state`, {
        operationName,
      });
    }

    // Reject if circuit is open
    if (breaker.state === 'open') {
      ServiceHelper.logger.warn(
        `Circuit breaker is open, rejecting operation`,
        {
          operationName,
          failureCount: breaker.failureCount,
          timeSinceLastFailure: now - breaker.lastFailureTime,
        },
      );
      throw new Error(`Circuit breaker is open for ${operationName}`);
    }

    try {
      const result = await operation();

      // Success - reset failure count if in half-open state
      if (breaker.state === 'half-open') {
        breaker.state = 'closed';
        breaker.failureCount = 0;
        ServiceHelper.logger.log(`Circuit breaker recovered`, {
          operationName,
        });
      }

      return result;
    } catch (error) {
      // Failure - increment counter
      breaker.failureCount++;
      breaker.lastFailureTime = now;

      if (breaker.failureCount >= maxFailures) {
        breaker.state = 'open';
        ServiceHelper.logger.error(
          `Circuit breaker opened after ${maxFailures} failures`,
          {
            operationName,
            failureCount: breaker.failureCount,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      } else {
        ServiceHelper.logger.warn(`Circuit breaker failure recorded`, {
          operationName,
          failureCount: breaker.failureCount,
          maxFailures,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      throw error;
    }
  }

  /**
   * Execute operation with caching
   * Caches result for specified TTL (time-to-live)
   *
   * @param key - Cache key
   * @param operation - Async function to execute if not cached
   * @param ttl - Time-to-live in milliseconds
   * @returns Promise resolving to cached or fresh result
   */
  static async withCache<T>(
    key: string,
    operation: () => Promise<T>,
    ttl: number,
  ): Promise<T> {
    const now = Date.now();

    // Check cache
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      ServiceHelper.logger.debug(`Cache hit`, { key });
      return cached.value as T;
    }

    // Cache miss - execute operation
    ServiceHelper.logger.debug(`Cache miss`, { key });
    const result = await operation();

    // Store in cache
    this.cache.set(key, {
      value: result,
      expiresAt: now + ttl,
    });

    return result;
  }

  /**
   * Clear cache entry or entire cache
   *
   * @param key - Optional cache key to clear (clears all if not provided)
   */
  static clearCache(key?: string): void {
    if (key) {
      this.cache.delete(key);
      ServiceHelper.logger.debug(`Cache cleared`, { key });
    } else {
      this.cache.clear();
      ServiceHelper.logger.debug(`All cache cleared`);
    }
  }

  /**
   * Bulk operation helper with batching
   * Processes items in batches to avoid overwhelming the system
   *
   * @param items - Array of items to process
   * @param operation - Async function to execute for each item
   * @param batchSize - Number of items to process in parallel
   * @param operationName - Name for logging
   * @returns Promise resolving when all items are processed
   */
  static async bulkOperation<T>(
    items: T[],
    operation: (item: T) => Promise<void>,
    batchSize: number = 10,
    operationName: string = 'bulkOperation',
  ): Promise<void> {
    const totalItems = items.length;
    ServiceHelper.logger.log(`Starting bulk operation`, {
      operationName,
      totalItems,
      batchSize,
    });

    for (let i = 0; i < totalItems; i += batchSize) {
      const batch = items.slice(i, Math.min(i + batchSize, totalItems));
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(totalItems / batchSize);

      ServiceHelper.logger.debug(
        `Processing batch ${batchNumber}/${totalBatches}`,
        {
          operationName,
          batchSize: batch.length,
        },
      );

      try {
        await Promise.all(batch.map((item) => operation(item)));
      } catch (error) {
        ServiceHelper.logger.error(`Bulk operation batch failed`, {
          operationName,
          batchNumber,
          totalBatches,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    ServiceHelper.logger.log(`Bulk operation completed`, {
      operationName,
      totalItems,
    });
  }

  /**
   * Bulk operation with error tolerance
   * Continues processing even if some items fail
   *
   * @param items - Array of items to process
   * @param operation - Async function to execute for each item
   * @param batchSize - Number of items to process in parallel
   * @param operationName - Name for logging
   * @returns Promise resolving to { successes, failures } counts
   */
  static async bulkOperationWithErrors<T>(
    items: T[],
    operation: (item: T) => Promise<void>,
    batchSize: number = 10,
    operationName: string = 'bulkOperation',
  ): Promise<{ successes: number; failures: number; errors: Error[] }> {
    const totalItems = items.length;
    let successes = 0;
    let failures = 0;
    const errors: Error[] = [];

    ServiceHelper.logger.log(`Starting bulk operation with error tolerance`, {
      operationName,
      totalItems,
      batchSize,
    });

    for (let i = 0; i < totalItems; i += batchSize) {
      const batch = items.slice(i, Math.min(i + batchSize, totalItems));
      const batchNumber = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(totalItems / batchSize);

      ServiceHelper.logger.debug(
        `Processing batch ${batchNumber}/${totalBatches}`,
        {
          operationName,
          batchSize: batch.length,
        },
      );

      const results = await Promise.allSettled(
        batch.map((item) => operation(item)),
      );

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          successes++;
        } else {
          failures++;
          errors.push(result.reason);
          ServiceHelper.logger.warn(`Bulk operation item failed`, {
            operationName,
            batchNumber,
            itemIndex: i + index,
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          });
        }
      });
    }

    ServiceHelper.logger.log(`Bulk operation completed with errors`, {
      operationName,
      totalItems,
      successes,
      failures,
      successRate: `${((successes / totalItems) * 100).toFixed(2)}%`,
    });

    return { successes, failures, errors };
  }
}
