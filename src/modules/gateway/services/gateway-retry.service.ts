import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosResponse, AxiosError } from 'axios';
import { RetryConfig } from '../interfaces/gateway.interfaces';

/** Resolved config with defaults applied (all required) */
interface ResolvedRetryConfig {
  retryCount: number;
  retryFactor: number;
  retryMinTimeout: number;
  retryMaxTimeout: number;
}

@Injectable()
export class GatewayRetryService {
  private readonly logger = new Logger(GatewayRetryService.name);

  /**
   * Execute request with retry logic and exponential backoff
   */
  async executeWithRetry(
    request: any,
    config: RetryConfig,
  ): Promise<{ response: AxiosResponse; retryAttempts: number }> {
    const startTime = Date.now();
    let lastError: AxiosError | null = null;
    let retryAttempts = 0;

    // Default retry configuration (resolve so all fields are defined)
    const retryConfig: ResolvedRetryConfig = {
      retryCount: config.retryCount ?? 3,
      retryFactor: config.retryFactor ?? 2,
      retryMinTimeout: config.retryMinTimeout ?? 1000,
      retryMaxTimeout: config.retryMaxTimeout ?? 10000,
    };

    this.logger.log('Starting retry execution', {
      component: 'GatewayRetryService',
      operation: 'executeWithRetry',
      type: 'retry_start',
      maxRetries: retryConfig.retryCount,
      initialTimeout: retryConfig.retryMinTimeout,
    });

    // Initial attempt (attempt 0)
    try {
      this.logger.debug('Attempting initial request', {
        component: 'GatewayRetryService',
        operation: 'executeWithRetry',
        type: 'retry_attempt',
        attempt: 0,
        url: request.url,
        method: request.method,
      });

      const response = await axios(request);
      return { response, retryAttempts: 0 };
    } catch (error) {
      lastError = error as AxiosError;
      this.logger.warn('Initial request failed, starting retries', {
        component: 'GatewayRetryService',
        operation: 'executeWithRetry',
        type: 'retry_initial_failure',
        error: lastError.message,
        status: lastError.response?.status,
      });
    }

    // Retry attempts
    for (let attempt = 1; attempt <= retryConfig.retryCount; attempt++) {
      try {
        // Calculate backoff delay
        const delay = this.calculateBackoffDelay(attempt, retryConfig);

        this.logger.log(`Waiting ${delay}ms before retry attempt ${attempt}`, {
          component: 'GatewayRetryService',
          operation: 'executeWithRetry',
          type: 'retry_wait',
          attempt,
          delay,
          totalTime: `${Date.now() - startTime}ms`,
        });

        // Wait before retry
        await this.sleep(delay);

        this.logger.debug(`Executing retry attempt ${attempt}`, {
          component: 'GatewayRetryService',
          operation: 'executeWithRetry',
          type: 'retry_attempt',
          attempt,
          url: request.url,
          method: request.method,
        });

        const response = await axios(request);
        retryAttempts = attempt;

        this.logger.log('Retry successful', {
          component: 'GatewayRetryService',
          operation: 'executeWithRetry',
          type: 'retry_success',
          attempt,
          totalTime: `${Date.now() - startTime}ms`,
          status: response.status,
        });

        return { response, retryAttempts };
      } catch (error) {
        const axiosError = error as AxiosError;
        lastError = axiosError;

        this.logger.warn(`Retry attempt ${attempt} failed`, {
          component: 'GatewayRetryService',
          operation: 'executeWithRetry',
          type: 'retry_attempt_failed',
          attempt,
          error: axiosError.message,
          status: axiosError.response?.status,
          totalTime: `${Date.now() - startTime}ms`,
        });

        // Check if we should retry this error
        if (!this.shouldRetry(axiosError, attempt, retryConfig)) {
          this.logger.warn('Error is not retryable or max attempts reached', {
            component: 'GatewayRetryService',
            operation: 'executeWithRetry',
            type: 'retry_not_retryable',
            attempt,
            status: axiosError.response?.status,
            maxRetries: retryConfig.retryCount,
          });
          break;
        }
      }
    }

    // All retries failed
    this.logger.error('All retry attempts failed', {
      component: 'GatewayRetryService',
      operation: 'executeWithRetry',
      type: 'retry_all_failed',
      attempts: retryConfig.retryCount,
      totalTime: `${Date.now() - startTime}ms`,
      finalError: lastError?.message,
      finalStatus: lastError?.response?.status,
    });

    throw lastError || new Error('All retry attempts failed');
  }

  /**
   * Calculate backoff delay using exponential backoff with jitter
   */
  private calculateBackoffDelay(
    attempt: number,
    config: ResolvedRetryConfig,
  ): number {
    const baseDelay =
      config.retryMinTimeout * Math.pow(config.retryFactor, attempt - 1);
    const maxDelay = Math.min(baseDelay, config.retryMaxTimeout);

    // Add jitter (±25% randomization)
    const jitter = maxDelay * 0.25 * (Math.random() * 2 - 1);
    const finalDelay = Math.max(config.retryMinTimeout, maxDelay + jitter);

    return Math.floor(finalDelay);
  }

  /**
   * Determine if an error should be retried
   */
  private shouldRetry(
    error: AxiosError,
    attempt: number,
    config: ResolvedRetryConfig,
  ): boolean {
    // Don't retry if we've exceeded max attempts
    if (attempt >= config.retryCount) {
      return false;
    }

    // Don't retry client errors (4xx) except for specific cases
    if (error.response?.status) {
      const status = error.response.status;

      // Retry 408 (Request Timeout), 429 (Too Many Requests), 5xx errors
      if (status === 408 || status === 429 || status >= 500) {
        return true;
      }

      // Don't retry other 4xx errors
      if (status >= 400 && status < 500) {
        return false;
      }

      // Retry network errors and other cases
      return true;
    }

    // Retry network errors (no response)
    if (!error.response) {
      return true;
    }

    // Default: don't retry
    return false;
  }

  /**
   * Check if a specific status code should be retried
   */
  shouldRetryStatus(status: number): boolean {
    // Retry 408 (Request Timeout), 429 (Too Many Requests), 5xx errors
    return status === 408 || status === 429 || status >= 500;
  }

  /**
   * Get default retry configuration
   */
  getDefaultConfig(): RetryConfig {
    return {
      retryCount: 3,
      retryFactor: 2,
      retryMinTimeout: 1000,
      retryMaxTimeout: 10000,
    };
  }

  /**
   * Validate retry configuration
   */
  validateRetryConfig(config: RetryConfig): boolean {
    const count = config.retryCount ?? 3;
    const factor = config.retryFactor ?? 2;
    const minT = config.retryMinTimeout ?? 1000;
    const maxT = config.retryMaxTimeout ?? 10000;
    return (
      count >= 0 &&
      count <= 10 &&
      factor >= 1 &&
      factor <= 5 &&
      minT >= 100 &&
      minT <= 60000 &&
      maxT >= 1000 &&
      maxT <= 300000 &&
      minT <= maxT
    );
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
