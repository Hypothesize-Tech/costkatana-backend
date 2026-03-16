import { Injectable, Logger } from '@nestjs/common';

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  jitter?: boolean;
  retryableErrors?: string[];
  onRetry?: (error: Error, attempt: number) => void;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDelay: number;
}

/**
 * NestJS Retry Service - Ported from Express RetryWithBackoff utility
 * Provides exponential backoff retry logic with circuit breaker pattern
 * Specialized for AWS Bedrock and other services
 */
@Injectable()
export class RetryService {
  private readonly logger = new Logger(RetryService.name);

  private readonly DEFAULT_OPTIONS: Required<RetryOptions> = {
    maxRetries: 5,
    baseDelay: 1000, // 1 second
    maxDelay: 30000, // 30 seconds
    backoffMultiplier: 2,
    jitter: true,
    retryableErrors: [
      'ThrottlingException',
      'TooManyRequestsException',
      'ServiceUnavailableException',
      'InternalServerException',
      'ModelNotReadyException',
      'ValidationException',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
    ],
    onRetry: () => {},
  };

  /**
   * Execute a function with exponential backoff retry
   */
  async execute<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {},
  ): Promise<RetryResult<T>> {
    const config = { ...this.DEFAULT_OPTIONS, ...options };
    let lastError: Error;
    let totalDelay = 0;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const result = await fn();
        return {
          success: true,
          result,
          attempts: attempt + 1,
          totalDelay,
        };
      } catch (error: any) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is retryable
        if (!this.isRetryableError(lastError, config.retryableErrors)) {
          return {
            success: false,
            error: lastError,
            attempts: attempt + 1,
            totalDelay,
          };
        }

        // If this was the last attempt, don't retry
        if (attempt === config.maxRetries) {
          break;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt, config);
        totalDelay += delay;

        this.logger.warn(
          `Attempt ${attempt + 1}/${config.maxRetries + 1} failed: ${lastError.message}. ` +
            `Retrying in ${delay}ms...`,
        );

        // Call retry callback if provided
        config.onRetry(lastError, attempt + 1);

        // Wait before retrying
        await this.sleep(delay);
      }
    }

    return {
      success: false,
      error: lastError!,
      attempts: config.maxRetries + 1,
      totalDelay,
    };
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: Error, retryableErrors: string[]): boolean {
    const errorMessage = error.message.toLowerCase();
    const errorName = error.name.toLowerCase();

    // Non-retryable errors that should fail immediately
    const nonRetryableErrors = [
      'malformed input request',
      'invalid request format',
      'bad request',
      'unauthorized',
      'forbidden',
      'not found',
    ];

    // Check if error is explicitly non-retryable
    const isNonRetryable = nonRetryableErrors.some(
      (nonRetryable) =>
        errorMessage.includes(nonRetryable) || errorName.includes(nonRetryable),
    );

    if (isNonRetryable) {
      return false;
    }

    return retryableErrors.some(
      (retryableError) =>
        errorMessage.includes(retryableError.toLowerCase()) ||
        errorName.includes(retryableError.toLowerCase()),
    );
  }

  /**
   * Calculate delay with exponential backoff and optional jitter
   */
  private calculateDelay(
    attempt: number,
    config: Required<RetryOptions>,
  ): number {
    // Exponential backoff: baseDelay * (backoffMultiplier ^ attempt)
    let delay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt);

    // Cap at max delay
    delay = Math.min(delay, config.maxDelay);

    // Add jitter to prevent thundering herd
    if (config.jitter) {
      // Add random jitter up to 25% of the delay
      const jitterAmount = delay * 0.25 * Math.random();
      delay += jitterAmount;
    }

    return Math.floor(delay);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a retry wrapper for AWS Bedrock specifically
   */
  createBedrockRetry(customOptions: RetryOptions = {}) {
    const bedrockOptions: RetryOptions = {
      maxRetries: 5,
      baseDelay: 2000, // Start with 2 seconds for Bedrock
      maxDelay: 60000, // Max 1 minute
      backoffMultiplier: 2.5, // Slightly more aggressive
      jitter: true,
      retryableErrors: [
        'ThrottlingException',
        'TooManyRequestsException',
        'ServiceUnavailableException',
        'InternalServerException',
        'ModelNotReadyException',
        'ValidationException',
      ],
      onRetry: (error: Error, attempt: number) => {
        this.logger.log(
          `🔄 Bedrock retry attempt ${attempt}: ${error.message}`,
        );
      },
      ...customOptions,
    };

    return <T>(fn: () => Promise<T>) => this.execute(fn, bedrockOptions);
  }

  /**
   * Create a circuit breaker pattern for frequent failures
   */
  createCircuitBreaker(
    failureThreshold: number = 5,
    resetTimeout: number = 60000, // 1 minute
  ) {
    let failures = 0;
    let lastFailureTime = 0;
    let state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

    return async <T>(fn: () => Promise<T>): Promise<T> => {
      const now = Date.now();

      // Check if we should reset the circuit breaker
      if (state === 'OPEN' && now - lastFailureTime > resetTimeout) {
        state = 'HALF_OPEN';
        this.logger.log('🔄 Circuit breaker moving to HALF_OPEN state');
      }

      // If circuit is open, reject immediately
      if (state === 'OPEN') {
        throw new Error(
          `Circuit breaker is OPEN. Too many failures. Try again in ${Math.ceil((resetTimeout - (now - lastFailureTime)) / 1000)}s`,
        );
      }

      try {
        const result = await fn();

        // Success - reset failure count and close circuit
        if (state === 'HALF_OPEN') {
          state = 'CLOSED';
          this.logger.log('✅ Circuit breaker reset to CLOSED state');
        }
        failures = 0;

        return result;
      } catch (error) {
        failures++;
        lastFailureTime = now;

        // Open circuit if threshold exceeded
        if (failures >= failureThreshold) {
          state = 'OPEN';
          this.logger.warn(
            `⚠️ Circuit breaker OPENED after ${failures} failures`,
          );
        }

        throw error;
      }
    };
  }
}

/**
 * Specialized retry configurations for different services
 */
export const RetryConfigs = {
  // AWS Bedrock specific configuration
  bedrock: {
    maxRetries: 5,
    baseDelay: 2000,
    maxDelay: 60000,
    backoffMultiplier: 2.5,
    jitter: true,
    retryableErrors: [
      'ThrottlingException',
      'TooManyRequestsException',
      'ServiceUnavailableException',
      'InternalServerException',
      'ModelNotReadyException',
    ] as string[],
  },

  // Database operations
  database: {
    maxRetries: 3,
    baseDelay: 500,
    maxDelay: 5000,
    backoffMultiplier: 2,
    jitter: true,
    retryableErrors: [
      'MongoNetworkError',
      'MongoTimeoutError',
      'ECONNRESET',
      'ETIMEDOUT',
    ] as string[],
  },

  // External API calls
  api: {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
    jitter: true,
    retryableErrors: [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
    ] as string[],
  },
} as const;
