import axios, { AxiosResponse, AxiosError } from 'axios';
import { loggingService } from '../../logging.service';

// Smart Retry defaults (as per documentation)
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_RETRY_FACTOR = 2;
const DEFAULT_RETRY_MIN_TIMEOUT = 1000; // 1 second
const DEFAULT_RETRY_MAX_TIMEOUT = 10000; // 10 seconds

/**
 * GatewayRetryService - Handles retry logic with exponential backoff
 * Provides configurable retry mechanisms for failed requests
 */
export class GatewayRetryService {
    /**
     * Make request with configurable retry logic and exponential backoff
     */
    static async executeWithRetry(
        requestConfig: any,
        retryConfig?: {
            retryCount?: number;
            retryFactor?: number;
            retryMinTimeout?: number;
            retryMaxTimeout?: number;
        }
    ): Promise<{ response: AxiosResponse; retryAttempts: number }> {
        // Get retry configuration or use defaults
        const maxRetries = retryConfig?.retryCount ?? DEFAULT_RETRY_COUNT;
        const retryFactor = retryConfig?.retryFactor ?? DEFAULT_RETRY_FACTOR;
        const minTimeout = retryConfig?.retryMinTimeout ?? DEFAULT_RETRY_MIN_TIMEOUT;
        const maxTimeout = retryConfig?.retryMaxTimeout ?? DEFAULT_RETRY_MAX_TIMEOUT;
        
        let lastError: Error;
        let retryAttempts = 0;
        
        loggingService.info('Starting request with retry configuration', {
            maxRetries,
            retryFactor,
            minTimeout,
            maxTimeout
        });
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // Log attempt
                if (attempt > 0) {
                    loggingService.info(`Retry attempt ${attempt}/${maxRetries}`);
                }
                
                const response = await axios(requestConfig);
                
                // Log successful response after retries
                if (attempt > 0) {
                    loggingService.info(`Request succeeded after ${attempt} retry attempts`, {
                        status: response.status,
                        totalAttempts: attempt + 1
                    });
                }
                
                // Return successful responses or client errors (don't retry 4xx except 429)
                if (response.status < 400 || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
                    return { response, retryAttempts };
                }
                
                // For 429 (rate limit) and 5xx errors, retry if we have attempts left
                if (attempt < maxRetries) {
                    retryAttempts++;
                    const delay = GatewayRetryService.calculateBackoff(attempt, retryFactor, minTimeout, maxTimeout);
                    
                    loggingService.warn(`Request failed with status ${response.status}, retrying in ${delay}ms`, {
                        attempt: attempt + 1,
                        maxRetries: maxRetries + 1,
                        status: response.status,
                        delay
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                
                // If this was the last attempt, return the response (even if it's an error)
                return { response, retryAttempts };
                
            } catch (error) {
                lastError = error as Error;
                
                if (axios.isAxiosError(error)) {
                    const axiosError = error as AxiosError;
                    
                    // Determine if we should retry based on error type
                    const shouldRetry = GatewayRetryService.shouldRetry(axiosError);
                    
                    if (shouldRetry && attempt < maxRetries) {
                        retryAttempts++;
                        const delay = GatewayRetryService.calculateBackoff(attempt, retryFactor, minTimeout, maxTimeout);
                        
                        const errorInfo = axiosError.response 
                            ? `HTTP ${axiosError.response.status}` 
                            : axiosError.code || 'Network Error';
                        
                        loggingService.warn(`Request failed with ${errorInfo}, retrying in ${delay}ms`, {
                            attempt: attempt + 1,
                            maxRetries: maxRetries + 1,
                            error: errorInfo,
                            delay
                        });
                        
                        await new Promise(resolve => setTimeout(resolve, delay));
                        continue;
                    }
                }
                
                // If we can't or shouldn't retry, throw the error
                if (attempt === maxRetries) {
                    loggingService.error(`Request failed after ${maxRetries + 1} attempts`, {
                        totalAttempts: maxRetries + 1,
                        retryAttempts,
                        error: lastError.message
                    });
                    throw lastError;
                }
            }
        }
        
        throw lastError!;
    }

    /**
     * Calculate retry delay with exponential backoff and jitter
     */
    static calculateBackoff(
        attempt: number, 
        factor: number, 
        minTimeout: number, 
        maxTimeout: number
    ): number {
        // Calculate exponential backoff: minTimeout * (factor ^ attempt)
        let delay = minTimeout * Math.pow(factor, attempt);
        
        // Cap at maximum timeout
        delay = Math.min(delay, maxTimeout);
        
        // Add jitter (±25% randomness) to avoid thundering herd
        const jitter = delay * 0.25 * (Math.random() - 0.5);
        delay = Math.max(minTimeout, delay + jitter);
        
        return Math.round(delay);
    }

    /**
     * Determine if an error should trigger a retry
     */
    static shouldRetry(error: AxiosError): boolean {
        // Network/connection errors - always retry
        if (error.code === 'ECONNRESET' ||
            error.code === 'ENOTFOUND' ||
            error.code === 'ETIMEDOUT' ||
            error.code === 'ECONNREFUSED' ||
            error.code === 'ECONNABORTED') {
            return true;
        }
        
        // HTTP status-based retries
        if (error.response) {
            const status = error.response.status;
            
            // Rate limiting - always retry
            if (status === 429) {
                return true;
            }
            
            // Server errors - retry
            if (status >= 500) {
                return true;
            }
            
            // Client errors - don't retry (except 429 handled above)
            if (status >= 400 && status < 500) {
                return false;
            }
        }
        
        // Default: retry for unknown errors
        return true;
    }

    /**
     * Check if a status code should be retried
     */
    static shouldRetryStatus(statusCode: number): boolean {
        // Retry on rate limits
        if (statusCode === 429) {
            return true;
        }
        
        // Retry on server errors
        if (statusCode >= 500) {
            return true;
        }
        
        // Don't retry client errors (4xx)
        if (statusCode >= 400 && statusCode < 500) {
            return false;
        }
        
        // Retry by default for other status codes
        return true;
    }

    /**
     * Get default retry configuration
     */
    static getDefaultConfig(): {
        retryCount: number;
        retryFactor: number;
        retryMinTimeout: number;
        retryMaxTimeout: number;
    } {
        return {
            retryCount: DEFAULT_RETRY_COUNT,
            retryFactor: DEFAULT_RETRY_FACTOR,
            retryMinTimeout: DEFAULT_RETRY_MIN_TIMEOUT,
            retryMaxTimeout: DEFAULT_RETRY_MAX_TIMEOUT
        };
    }

    /**
     * Validate retry configuration
     */
    static validateRetryConfig(config: {
        retryCount?: number;
        retryFactor?: number;
        retryMinTimeout?: number;
        retryMaxTimeout?: number;
    }): {
        isValid: boolean;
        errors: string[];
    } {
        const errors: string[] = [];

        if (config.retryCount !== undefined) {
            if (config.retryCount < 0 || config.retryCount > 10) {
                errors.push('retryCount must be between 0 and 10');
            }
        }

        if (config.retryFactor !== undefined) {
            if (config.retryFactor < 1 || config.retryFactor > 5) {
                errors.push('retryFactor must be between 1 and 5');
            }
        }

        if (config.retryMinTimeout !== undefined) {
            if (config.retryMinTimeout < 100 || config.retryMinTimeout > 30000) {
                errors.push('retryMinTimeout must be between 100ms and 30000ms');
            }
        }

        if (config.retryMaxTimeout !== undefined) {
            if (config.retryMaxTimeout < 1000 || config.retryMaxTimeout > 60000) {
                errors.push('retryMaxTimeout must be between 1000ms and 60000ms');
            }
        }

        if (config.retryMinTimeout !== undefined && config.retryMaxTimeout !== undefined) {
            if (config.retryMinTimeout >= config.retryMaxTimeout) {
                errors.push('retryMinTimeout must be less than retryMaxTimeout');
            }
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}
