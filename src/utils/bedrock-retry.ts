/**
 * Retry helper for Bedrock/AWS calls with exponential backoff.
 */
export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryable?: (error: unknown) => boolean;
}

const DEFAULT_RETRYABLE = (e: unknown): boolean => {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes('Throttling') ||
    msg.includes('ServiceUnavailable') ||
    msg.includes('InternalServerException') ||
    msg.includes('RequestLimitExceeded') ||
    msg.includes('TooManyRequests')
  );
};

export async function withBedrockRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    retryable = DEFAULT_RETRYABLE,
  } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt === maxAttempts - 1 || !retryable(e)) throw e;
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
