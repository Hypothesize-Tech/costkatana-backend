import { loggingService } from '../services/logging.service';

/**
 * AWS Bedrock specific retry configuration
 * @deprecated Use RetryWithBackoff and RetryConfigs from retryWithBackoff.ts instead
 * @see RetryWithBackoff
 * @see RetryConfigs
 */
export interface BedrockRetryConfig {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    jitterFactor: number;
    backoffMultiplier: number;
    retryableErrors: string[];
    nonRetryableErrors: string[];
}

/**
 * Default retry configuration for AWS Bedrock
 */
export const DEFAULT_BEDROCK_RETRY_CONFIG: BedrockRetryConfig = {
    maxRetries: 5,
    baseDelay: 1000, // 1 second
    maxDelay: 30000, // 30 seconds
    jitterFactor: 0.25, // ±25% jitter
    backoffMultiplier: 2, // Exponential backoff multiplier
    retryableErrors: [
        'ThrottlingException',
        'TooManyRequestsException',
        'RequestTimeoutException',
        'InternalServerException',
        'ServiceUnavailableException',
        'RequestThrottledException',
        'Throttling',
        'RateExceeded',
        'TooManyRequests',
        'RequestTimeout',
        'InternalServerError',
        'ServiceUnavailable'
    ],
    nonRetryableErrors: [
        'ValidationException',
        'AccessDeniedException',
        'ResourceNotFoundException',
        'InvalidParameterException',
        'UnsupportedOperationException',
        'InvalidRequestException',
        'BadRequest',
        'Unauthorized',
        'Forbidden',
        'NotFound'
    ]
};

/**
 * Enhanced exponential backoff with jitter for AWS Bedrock
 * @deprecated Use RetryWithBackoff.createBedrockRetry() or ServiceHelper.withRetry() instead
 * @see RetryWithBackoff.createBedrockRetry
 * @see ServiceHelper.withRetry
 */
export class BedrockRetry {
    private config: BedrockRetryConfig;

    constructor(config: Partial<BedrockRetryConfig> = {}) {
        this.config = { ...DEFAULT_BEDROCK_RETRY_CONFIG, ...config };
    }

    /**
     * Calculate delay with exponential backoff and jitter
     */
    private calculateDelay(attempt: number): number {
        // Exponential backoff: baseDelay * (backoffMultiplier ^ attempt)
        let delay = this.config.baseDelay * Math.pow(this.config.backoffMultiplier, attempt);
        
        // Cap at maxDelay
        delay = Math.min(delay, this.config.maxDelay);
        
        // Add jitter to prevent thundering herd
        const jitter = delay * this.config.jitterFactor * (Math.random() - 0.5);
        delay = Math.max(0, delay + jitter);
        
        return delay;
    }

    /**
     * Check if error is retryable
     */
    private isRetryableError(error: any): boolean {
        const errorName = error.name || error.code || '';
        const errorMessage = error.message || '';
        const statusCode = error.statusCode || error.$metadata?.httpStatusCode;

        // Check non-retryable errors first
        for (const nonRetryable of this.config.nonRetryableErrors) {
            if (errorName.includes(nonRetryable) || errorMessage.includes(nonRetryable)) {
                return false;
            }
        }

        // Check retryable errors
        for (const retryable of this.config.retryableErrors) {
            if (errorName.includes(retryable) || errorMessage.includes(retryable)) {
                return true;
            }
        }

        // Check HTTP status codes
        if (statusCode) {
            // Retry on 429 (Too Many Requests), 500, 502, 503, 504
            if ([429, 500, 502, 503, 504].includes(statusCode)) {
                return true;
            }
            // Don't retry on 4xx errors (except 429)
            if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
                return false;
            }
        }

        // Default to retryable for network errors
        return true;
    }

    /**
     * Enhanced retry function with detailed logging and metrics
     */
    async execute<T>(
        operation: () => Promise<T>,
        context: {
            modelId?: string;
            operation?: string;
            requestId?: string;
        } = {}
    ): Promise<T> {
        let lastError: any;
        const startTime = Date.now();

        for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
            try {
                const result = await operation();
                
                // Log success on retry
                if (attempt > 0) {
                    loggingService.info('Bedrock operation succeeded after retry', {
                        attempt,
                        totalAttempts: attempt + 1,
                        duration: Date.now() - startTime,
                        modelId: context.modelId,
                        operation: context.operation,
                        requestId: context.requestId
                    });
                }
                
                return result;
            } catch (error: any) {
                lastError = error;
                
                // Check if error is retryable
                if (!this.isRetryableError(error)) {
                    loggingService.warn('Non-retryable Bedrock error', {
                        error: error.name || error.code,
                        message: error.message,
                        modelId: context.modelId,
                        operation: context.operation,
                        requestId: context.requestId
                    });
                    throw error;
                }

                // If this is the last attempt, throw the error
                if (attempt === this.config.maxRetries) {
                    loggingService.error('Bedrock operation failed after all retries', {
                        totalAttempts: attempt + 1,
                        duration: Date.now() - startTime,
                        error: error.name || error.code,
                        message: error.message,
                        modelId: context.modelId,
                        operation: context.operation,
                        requestId: context.requestId
                    });
                    throw error;
                }

                // Calculate delay for next attempt
                const delay = this.calculateDelay(attempt);
                
                loggingService.info('Bedrock operation failed, retrying', {
                    attempt: attempt + 1,
                    totalAttempts: this.config.maxRetries + 1,
                    delay: Math.round(delay),
                    error: error.name || error.code,
                    message: error.message,
                    modelId: context.modelId,
                        operation: context.operation,
                        requestId: context.requestId
                });

                // Wait before retrying
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    /**
     * Create a retry instance with custom configuration
     */
    static withConfig(config: Partial<BedrockRetryConfig>): BedrockRetry {
        return new BedrockRetry(config);
    }

    /**
     * Create a retry instance optimized for high-frequency operations
     */
    static forHighFrequency(): BedrockRetry {
        return new BedrockRetry({
            maxRetries: 3,
            baseDelay: 500, // Start with 500ms
            maxDelay: 10000, // Cap at 10 seconds
            backoffMultiplier: 1.5 // Less aggressive backoff
        });
    }

    /**
     * Create a retry instance optimized for critical operations
     */
    static forCriticalOperations(): BedrockRetry {
        return new BedrockRetry({
            maxRetries: 8,
            baseDelay: 2000, // Start with 2 seconds
            maxDelay: 60000, // Cap at 1 minute
            backoffMultiplier: 2.5 // More aggressive backoff
        });
    }
}

/**
 * Convenience function for one-off retry operations
 * @deprecated Use ServiceHelper.withRetry() or RetryWithBackoff.execute() instead
 * @see ServiceHelper.withRetry
 * @see RetryWithBackoff.execute
 */
export async function retryBedrockOperation<T>(
  operation: () => Promise<T>,
  config: Partial<BedrockRetryConfig> = {},
  context: { modelId?: string; operation?: string; requestId?: string } = {}
): Promise<T> {
  const retry = new BedrockRetry(config);
  return retry.execute(operation, context);
}