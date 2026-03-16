/**
 * Standalone retry with exponential backoff for use outside Nest DI.
 * Used by ServiceHelper and other modules that need retry without injecting RetryService.
 */

export interface RetryWithBackoffOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  jitter?: boolean;
  onRetry?: (error: Error, attempt: number) => void;
}

export interface RetryWithBackoffResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
}

const DEFAULT_RETRYABLE = [
  'ThrottlingException',
  'TooManyRequestsException',
  'ServiceUnavailableException',
  'InternalServerException',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
];

function isRetryable(error: Error, retryableErrors: string[]): boolean {
  const msg = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  return retryableErrors.some(
    (e) => msg.includes(e.toLowerCase()) || name.includes(e.toLowerCase()),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  backoffMultiplier: number,
  jitter: boolean,
): number {
  let delay = baseDelay * Math.pow(backoffMultiplier, attempt);
  delay = Math.min(delay, maxDelay);
  if (jitter) {
    delay += delay * 0.25 * Math.random();
  }
  return Math.floor(delay);
}

export const RetryWithBackoff = {
  async execute<T>(
    operation: () => Promise<T>,
    options: RetryWithBackoffOptions = {},
  ): Promise<RetryWithBackoffResult<T>> {
    const maxRetries = options.maxRetries ?? 3;
    const baseDelay = options.baseDelay ?? 1000;
    const maxDelay = options.maxDelay ?? baseDelay * 10;
    const backoffMultiplier = options.backoffMultiplier ?? 2;
    const jitter = options.jitter ?? true;
    const onRetry = options.onRetry;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        return { success: true, result };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (
          !isRetryable(lastError, DEFAULT_RETRYABLE) ||
          attempt === maxRetries
        ) {
          return { success: false, error: lastError };
        }
        const delay = calculateDelay(
          attempt,
          baseDelay,
          maxDelay,
          backoffMultiplier,
          jitter,
        );
        onRetry?.(lastError, attempt + 1);
        await sleep(delay);
      }
    }
    return { success: false, error: lastError! };
  },
};
