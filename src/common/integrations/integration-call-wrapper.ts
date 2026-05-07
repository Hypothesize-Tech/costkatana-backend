/**
 * Wraps third-party integration calls (GitHub, Vercel, Google, Slack, etc.)
 * with three guards:
 *
 *   1. **Timeout** — caller never blocks indefinitely.
 *   2. **Retry with exponential backoff + jitter** — transient failures auto-recover.
 *   3. **Per-key circuit breaker** — once an integration starts failing, stop
 *      hammering it and fail fast for `cooldownMs`.
 *
 * Every site that today does a bare `await integrationApi.x()` should wrap
 * it with `withIntegrationGuards` so a single slow integration cannot stall
 * the entire chat request.
 */
import { Logger } from '@nestjs/common';
import type {
  OAuthConnection,
  OAuthTokenManager,
} from './oauth-token-manager';

const logger = new Logger('IntegrationCallWrapper');

export interface IntegrationCallOptions {
  /** Stable identifier (e.g. `github:list-issues`) used in error logs. */
  name: string;
  /** Hard wall-clock cap. Default 10s. */
  timeoutMs?: number;
  /** Total attempts including the initial. Default 3. */
  retries?: number;
  /** Initial backoff delay between attempts; doubled each retry. Default 250ms. */
  baseDelayMs?: number;
  /**
   * Circuit-breaker bucket. Calls sharing the same key share open/closed
   * state — typically `${integration}:${userId}`. Defaults to `name`.
   */
  circuitBreakerKey?: string;
  /**
   * Predicate that decides whether an error is retryable. Defaults to
   * "any error that isn't an explicit 4xx HTTP error" — 5xx, network,
   * timeout, etc. retry; 401/403/404/422 do not.
   */
  isRetryable?: (err: unknown) => boolean;
  /**
   * Optional OAuth pre-flight. When `tokenManager` + `connection` are
   * supplied, the wrapper calls `tokenManager.ensureFresh(connection)`
   * BEFORE every attempt — refreshing the token if it's about to expire,
   * surfacing `requiresReconnection` cleanly when the refresh token is
   * dead. The refreshed connection is exposed to `fn` via the second
   * argument so the caller can use the new token.
   *
   * Existing per-service refresh code keeps working as-is; this is the
   * opt-in centralized path for new code.
   */
  tokenManager?: OAuthTokenManager;
  connection?: OAuthConnection;
  /** Required scopes the connection must hold for this call. */
  requiredScopes?: string[];
}

export class IntegrationCallError extends Error {
  constructor(
    public readonly code:
      | 'timeout'
      | 'circuit_open'
      | 'exhausted_retries'
      | 'non_retryable',
    public readonly integrationName: string,
    public readonly cause?: unknown,
    public readonly attempts: number = 0,
  ) {
    const detail =
      cause instanceof Error ? cause.message : cause ? String(cause) : '';
    super(`Integration ${integrationName} failed (${code})${detail ? ': ' + detail : ''}`);
    this.name = 'IntegrationCallError';
  }
}

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

const breakers = new Map<string, BreakerState>();
const FAILURE_THRESHOLD = 5;
const FAILURE_WINDOW_MS = 60_000;
const COOLDOWN_MS = 30_000;

function getBreaker(key: string): BreakerState {
  let s = breakers.get(key);
  if (!s) {
    s = { failures: 0, openedAt: null };
    breakers.set(key, s);
  }
  return s;
}

function isCircuitOpen(state: BreakerState): boolean {
  if (state.openedAt === null) return false;
  const elapsed = Date.now() - state.openedAt;
  if (elapsed >= COOLDOWN_MS) {
    // Half-open: reset the counter so a single probing call can recover the breaker.
    state.failures = 0;
    state.openedAt = null;
    return false;
  }
  return true;
}

function recordSuccess(state: BreakerState): void {
  state.failures = 0;
  state.openedAt = null;
}

function recordFailure(state: BreakerState): void {
  state.failures += 1;
  if (state.failures >= FAILURE_THRESHOLD) {
    state.openedAt = Date.now();
  }
}

function defaultIsRetryable(err: unknown): boolean {
  // axios errors: response.status 4xx (except 408/425/429) are not retryable
  const status =
    (err as { response?: { status?: number } } | undefined)?.response?.status ??
    (err as { status?: number } | undefined)?.status;
  if (typeof status === 'number') {
    if (status >= 500) return true;
    if (status === 408 || status === 425 || status === 429) return true;
    return false;
  }
  return true; // network / abort / unknown — retry
}

function jitteredDelay(base: number, attempt: number): number {
  const backoff = base * Math.pow(2, attempt);
  // ±25% jitter
  const jitter = backoff * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, backoff + jitter);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  name: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new IntegrationCallError('timeout', name));
    }, timeoutMs);
    fn()
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

/**
 * Run `fn` under timeout + retry + per-key circuit breaker. The returned
 * promise rejects with `IntegrationCallError` once retries are exhausted,
 * the call times out repeatedly, or the breaker is open.
 */
export async function withIntegrationGuards<T>(
  options: IntegrationCallOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const breakerKey = options.circuitBreakerKey ?? options.name;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;
  const breaker = getBreaker(breakerKey);

  if (isCircuitOpen(breaker)) {
    logger.warn('Circuit breaker open — rejecting call without dispatch', {
      name: options.name,
      breakerKey,
      cooldownRemainingMs: COOLDOWN_MS - (Date.now() - (breaker.openedAt ?? 0)),
    });
    throw new IntegrationCallError('circuit_open', options.name);
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const result = await withTimeout(fn, timeoutMs, options.name);
      recordSuccess(breaker);
      return result;
    } catch (err) {
      lastErr = err;
      const retryable = isRetryable(err);
      logger.debug('Integration call failed', {
        name: options.name,
        attempt: attempt + 1,
        retryable,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!retryable) {
        recordFailure(breaker);
        if (err instanceof IntegrationCallError) throw err;
        throw new IntegrationCallError(
          'non_retryable',
          options.name,
          err,
          attempt + 1,
        );
      }
      // Retryable — wait and try again unless out of attempts
      if (attempt < retries - 1) {
        await sleep(jitteredDelay(baseDelayMs, attempt));
      }
    }
  }
  recordFailure(breaker);
  // Forget per-call window after FAILURE_WINDOW_MS so transient blips don't
  // accumulate forever. Lazy reset: clear if last failure is far enough back.
  if (
    breaker.openedAt === null &&
    breaker.failures < FAILURE_THRESHOLD &&
    Date.now() - (breaker.openedAt ?? 0) > FAILURE_WINDOW_MS
  ) {
    breaker.failures = 0;
  }
  if (lastErr instanceof IntegrationCallError) throw lastErr;
  throw new IntegrationCallError(
    'exhausted_retries',
    options.name,
    lastErr,
    retries,
  );
}

/**
 * OAuth-aware variant. The wrapped `fn` receives the connection, which
 * may have been refreshed before the call — handlers should ALWAYS read
 * `accessToken` from the argument, never close over the original.
 *
 * Behaviour around the refresh:
 *   - `ensureFresh` runs once, before the first attempt. If the refresh
 *     token is dead, the resulting `OAuthTokenRefreshError` short-
 *     circuits the entire call (no retries, no breaker bump for the
 *     integration's own circuit — this is an auth problem, not a
 *     transport problem).
 *   - `requiredScopes` mismatch surfaces as `OAuthScopeError` and is
 *     also non-retryable.
 */
export async function withOAuthIntegrationGuards<T>(
  options: IntegrationCallOptions & {
    tokenManager: OAuthTokenManager;
    connection: OAuthConnection;
  },
  fn: (conn: OAuthConnection) => Promise<T>,
): Promise<T> {
  const fresh = await options.tokenManager.ensureFresh(
    options.connection,
    options.requiredScopes,
  );
  return withIntegrationGuards(options, () => fn(fresh));
}

/**
 * Test / ops helper — clear all circuit-breaker state.
 */
export function resetAllBreakers(): void {
  breakers.clear();
}
