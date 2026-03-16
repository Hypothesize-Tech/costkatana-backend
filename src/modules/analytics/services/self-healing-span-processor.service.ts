/**
 * Self-Healing Span Processor Service for NestJS
 *
 * Automatically detects and recovers from span processing issues in OpenTelemetry traces.
 * Implements circuit breaker patterns and automatic error recovery.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SpanProcessingError {
  spanId: string;
  traceId: string;
  operation: string;
  error: string;
  timestamp: number;
  retryCount: number;
}

export interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  lastFailureTime: number;
  nextRetryTime: number;
}

@Injectable()
export class SelfHealingSpanProcessorService implements OnModuleDestroy {
  private readonly logger = new Logger(SelfHealingSpanProcessorService.name);

  private processingErrors: SpanProcessingError[] = [];
  private circuitBreaker: CircuitBreakerState = {
    isOpen: false,
    failureCount: 0,
    lastFailureTime: 0,
    nextRetryTime: 0,
  };

  private readonly MAX_ERRORS = 100;
  private readonly CIRCUIT_BREAKER_THRESHOLD = 10;
  private readonly CIRCUIT_BREAKER_TIMEOUT = 60000; // 1 minute
  private readonly MAX_RETRY_ATTEMPTS = 3;

  private healthCheckInterval?: NodeJS.Timeout;
  private recoveryInterval?: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {
    this.startHealthMonitoring();
  }

  /**
   * Process a span and handle any errors
   */
  async processSpan(spanData: any): Promise<boolean> {
    try {
      // Check circuit breaker
      if (this.circuitBreaker.isOpen) {
        if (Date.now() < this.circuitBreaker.nextRetryTime) {
          this.logger.warn('Circuit breaker open, skipping span processing', {
            spanId: spanData.spanId,
            nextRetry: new Date(
              this.circuitBreaker.nextRetryTime,
            ).toISOString(),
          });
          return false;
        } else {
          // Try to close circuit breaker
          this.circuitBreaker.isOpen = false;
          this.logger.log('Circuit breaker attempting to close');
        }
      }

      // Process the span with OTLP export and validation
      const success = await this.attemptSpanProcessing(spanData);

      if (success) {
        // Reset circuit breaker on success
        this.circuitBreaker.failureCount = 0;
        return true;
      } else {
        this.recordProcessingError(spanData, 'Processing failed');
        return false;
      }
    } catch (error) {
      this.recordProcessingError(
        spanData,
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  /**
   * Attempt to process a span with validation, OTLP export, and exponential backoff retry
   */
  private async attemptSpanProcessing(
    spanData: any,
    attempt: number = 1,
  ): Promise<boolean> {
    try {
      if (!spanData || !spanData.spanId) {
        throw new Error('Invalid span data: missing spanId');
      }

      if (!spanData.traceId) {
        throw new Error('Invalid span data: missing traceId');
      }

      // Normalize span attributes — only scalar values are valid in OTLP
      const normalizedAttributes: Record<string, string | number | boolean> =
        {};
      if (spanData.attributes && typeof spanData.attributes === 'object') {
        for (const [key, value] of Object.entries(spanData.attributes)) {
          if (value === null || value === undefined) continue;
          if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          ) {
            normalizedAttributes[key] = value;
          } else {
            normalizedAttributes[key] = String(value);
          }
        }
      }

      // Build normalized OTLP-compatible span payload
      const normalizedSpan = {
        spanId: spanData.spanId,
        traceId: spanData.traceId,
        parentSpanId: spanData.parentSpanId ?? null,
        operationName: spanData.operation || spanData.name || 'unknown',
        startTime: spanData.startTime || spanData.timestamp || Date.now(),
        endTime: spanData.endTime || Date.now(),
        status: spanData.status || 'OK',
        attributes: normalizedAttributes,
        events: Array.isArray(spanData.events) ? spanData.events : [],
        links: Array.isArray(spanData.links) ? spanData.links : [],
      };

      // Export to OTLP endpoint when configured
      const otlpEndpoint = this.configService.get<string>('OTLP_ENDPOINT');
      if (otlpEndpoint) {
        const serviceName =
          this.configService.get<string>('SERVICE_NAME') ||
          'costkatana-backend';

        const response = await fetch(`${otlpEndpoint}/v1/traces`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resourceSpans: [
              {
                resource: {
                  attributes: [
                    {
                      key: 'service.name',
                      value: { stringValue: serviceName },
                    },
                  ],
                },
                scopeSpans: [
                  {
                    spans: [normalizedSpan],
                  },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          throw new Error(`OTLP export failed with HTTP ${response.status}`);
        }
      }

      this.logger.debug('Span processed successfully', {
        spanId: normalizedSpan.spanId,
        operation: normalizedSpan.operationName,
        attempt,
      });

      return true;
    } catch (error) {
      if (attempt < this.MAX_RETRY_ATTEMPTS) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff: 2s, 4s
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.attemptSpanProcessing(spanData, attempt + 1);
      }

      throw error;
    }
  }

  /**
   * Record a processing error
   */
  private recordProcessingError(spanData: any, error: string): void {
    const processingError: SpanProcessingError = {
      spanId: spanData.spanId || 'unknown',
      traceId: spanData.traceId || 'unknown',
      operation: spanData.operation || 'unknown',
      error,
      timestamp: Date.now(),
      retryCount: 0,
    };

    this.processingErrors.push(processingError);

    // Maintain error history limit
    if (this.processingErrors.length > this.MAX_ERRORS) {
      this.processingErrors.shift();
    }

    // Update circuit breaker
    this.circuitBreaker.failureCount++;
    this.circuitBreaker.lastFailureTime = Date.now();

    if (this.circuitBreaker.failureCount >= this.CIRCUIT_BREAKER_THRESHOLD) {
      this.openCircuitBreaker();
    }

    this.logger.warn('Span processing error recorded', {
      spanId: processingError.spanId,
      error: processingError.error,
      failureCount: this.circuitBreaker.failureCount,
    });
  }

  /**
   * Open the circuit breaker
   */
  private openCircuitBreaker(): void {
    this.circuitBreaker.isOpen = true;
    this.circuitBreaker.nextRetryTime =
      Date.now() + this.CIRCUIT_BREAKER_TIMEOUT;

    this.logger.warn('Circuit breaker opened', {
      failureCount: this.circuitBreaker.failureCount,
      nextRetry: new Date(this.circuitBreaker.nextRetryTime).toISOString(),
    });
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    // Health check every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000);

    // Error recovery attempt every 5 minutes
    this.recoveryInterval = setInterval(() => {
      this.attemptErrorRecovery();
    }, 300000);
  }

  /**
   * Perform health check
   */
  private async performHealthCheck(): Promise<void> {
    try {
      const recentErrors = this.processingErrors.filter(
        (error) => error.timestamp > Date.now() - 300000, // Last 5 minutes
      );

      const errorRate = recentErrors.length / 10; // Errors per minute approximation

      if (errorRate > 0.5) {
        // More than 0.5 errors per minute
        this.logger.warn('High error rate detected', {
          recentErrors: recentErrors.length,
          errorRate: errorRate.toFixed(2),
        });
      }

      // Auto-recover circuit breaker if errors have decreased
      if (this.circuitBreaker.isOpen && recentErrors.length < 2) {
        this.circuitBreaker.isOpen = false;
        this.circuitBreaker.failureCount = Math.max(
          0,
          this.circuitBreaker.failureCount - 1,
        );
        this.logger.log('Circuit breaker auto-recovered');
      }
    } catch (error) {
      this.logger.error('Health check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Attempt error recovery
   */
  private async attemptErrorRecovery(): Promise<void> {
    try {
      // Try to reprocess failed spans
      const failedSpans = this.processingErrors.filter(
        (error) =>
          error.timestamp > Date.now() - 3600000 && // Last hour
          error.retryCount < this.MAX_RETRY_ATTEMPTS,
      );

      let recoveredCount = 0;

      for (const failedSpan of failedSpans.slice(0, 10)) {
        // Process up to 10 at a time
        try {
          // Attempt recovery (simplified)
          const recovered = await this.attemptRecovery(failedSpan);

          if (recovered) {
            recoveredCount++;
            // Remove from error list
            const index = this.processingErrors.indexOf(failedSpan);
            if (index > -1) {
              this.processingErrors.splice(index, 1);
            }
          } else {
            failedSpan.retryCount++;
          }
        } catch (error) {
          failedSpan.retryCount++;
          this.logger.debug('Recovery attempt failed', {
            spanId: failedSpan.spanId,
            retryCount: failedSpan.retryCount,
          });
        }
      }

      if (recoveredCount > 0) {
        this.logger.log('Error recovery completed', {
          attempted: failedSpans.length,
          recovered: recoveredCount,
        });
      }
    } catch (error) {
      this.logger.error('Error recovery process failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Attempt to recover a failed span using error-type classification and reprocessing
   */
  private async attemptRecovery(
    failedSpan: SpanProcessingError,
  ): Promise<boolean> {
    try {
      const errorLower = failedSpan.error.toLowerCase();

      // Classify errors into recoverable vs permanent failure categories
      const permanentErrors = [
        'missing spanid',
        'missing traceid',
        'invalid span data',
        'unsupported encoding',
      ];

      const isPermanentFailure = permanentErrors.some((e) =>
        errorLower.includes(e),
      );
      if (isPermanentFailure) {
        this.logger.debug('Span has permanent failure, skipping recovery', {
          spanId: failedSpan.spanId,
          error: failedSpan.error,
        });
        return false;
      }

      // Transient errors (network, timeout, rate-limit) are retried with jitter
      const isTransientError =
        errorLower.includes('http 5') ||
        errorLower.includes('network') ||
        errorLower.includes('timeout') ||
        errorLower.includes('otlp export failed') ||
        errorLower.includes('processing failed');

      if (!isTransientError) {
        return false;
      }

      // Apply exponential backoff with jitter before retrying
      const baseDelay = Math.pow(2, failedSpan.retryCount) * 500;
      const jitter = Math.random() * 500;
      await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));

      // Reconstruct minimal span from the error record and retry processing
      const reconstructedSpan = {
        spanId: failedSpan.spanId,
        traceId: failedSpan.traceId,
        operation: failedSpan.operation,
        startTime: failedSpan.timestamp,
        endTime: Date.now(),
        status: 'ERROR',
        attributes: {
          'recovery.attempt': failedSpan.retryCount + 1,
          'original.error': failedSpan.error.substring(0, 255),
        },
        events: [],
        links: [],
      };

      const success = await this.attemptSpanProcessing(reconstructedSpan, 1);

      if (success) {
        this.logger.log('Span recovery successful', {
          spanId: failedSpan.spanId,
          totalRetries: failedSpan.retryCount + 1,
        });
        return true;
      }

      return false;
    } catch (error) {
      this.logger.debug('Recovery attempt threw an error', {
        spanId: failedSpan.spanId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Get processing statistics
   */
  getStats(): {
    totalErrors: number;
    recentErrors: number;
    circuitBreakerState: CircuitBreakerState;
    errorRate: number;
  } {
    const recentErrors = this.processingErrors.filter(
      (error) => error.timestamp > Date.now() - 300000, // Last 5 minutes
    );

    return {
      totalErrors: this.processingErrors.length,
      recentErrors: recentErrors.length,
      circuitBreakerState: { ...this.circuitBreaker },
      errorRate: recentErrors.length / 5, // Errors per minute
    };
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit: number = 10): SpanProcessingError[] {
    return this.processingErrors
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Manually reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.isOpen = false;
    this.circuitBreaker.failureCount = 0;
    this.circuitBreaker.nextRetryTime = 0;

    this.logger.log('Circuit breaker manually reset');
  }

  /**
   * Clear error history
   */
  clearErrorHistory(): void {
    this.processingErrors = [];
    this.logger.log('Error history cleared');
  }

  /**
   * Cleanup on module destroy
   */
  onModuleDestroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
    }
  }
}
