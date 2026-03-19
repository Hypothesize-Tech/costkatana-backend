/**
 * Shared circuit breaker state store.
 * Used by BaseService and ErrorBoundaryMiddleware to maintain a single circuit state.
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerEntry {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
}

const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_RESET_TIMEOUT_MS = 60000;
const DEFAULT_WINDOW_MS = 300000; // 5 minutes for middleware-style check

/**
 * Singleton store for circuit breaker state shared across the application.
 */
class CircuitBreakerStoreImpl {
  private readonly store = new Map<string, CircuitBreakerEntry>();

  getState(component: string): CircuitBreakerEntry | undefined {
    return this.store.get(component);
  }

  recordFailure(
    component: string,
    options: {
      maxFailures?: number;
      resetTimeoutMs?: number;
      windowMs?: number;
    } = {},
  ): void {
    const {
      maxFailures = DEFAULT_MAX_FAILURES,
      resetTimeoutMs = DEFAULT_RESET_TIMEOUT_MS,
    } = options;
    const now = Date.now();
    let entry = this.store.get(component);

    if (!entry) {
      entry = {
        state: 'closed',
        failureCount: 0,
        lastFailureTime: 0,
      };
      this.store.set(component, entry);
    }

    // Reset if half-open and enough time has passed
    if (
      entry.state === 'half-open' &&
      now - entry.lastFailureTime > resetTimeoutMs
    ) {
      entry.state = 'closed';
      entry.failureCount = 0;
    }

    // Reset closed state if it's been long enough since last failure
    if (
      entry.state === 'closed' &&
      entry.failureCount > 0 &&
      now - entry.lastFailureTime > resetTimeoutMs
    ) {
      entry.failureCount = 0;
    }

    entry.failureCount++;
    entry.lastFailureTime = now;

    if (entry.failureCount >= maxFailures) {
      entry.state = 'open';
    }
  }

  recordSuccess(component: string): void {
    const entry = this.store.get(component);
    if (entry) {
      if (entry.state === 'half-open') {
        entry.state = 'closed';
      }
      entry.failureCount = 0;
    }
  }

  transitionToHalfOpen(
    component: string,
    resetTimeoutMs: number = DEFAULT_RESET_TIMEOUT_MS,
  ): void {
    const entry = this.store.get(component);
    if (entry && entry.state === 'open') {
      const now = Date.now();
      if (now - entry.lastFailureTime > resetTimeoutMs) {
        entry.state = 'half-open';
        entry.failureCount = 0;
      }
    }
  }

  /**
   * Check if circuit is open for a component (BaseService-compatible logic).
   */
  isOpen(
    component: string,
    resetTimeoutMs: number = DEFAULT_RESET_TIMEOUT_MS,
  ): boolean {
    const entry = this.store.get(component);
    if (!entry) return false;
    if (entry.state === 'closed' || entry.state === 'half-open') return false;
    if (entry.state === 'open') {
      const now = Date.now();
      if (now - entry.lastFailureTime > resetTimeoutMs) {
        this.transitionToHalfOpen(component, resetTimeoutMs);
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Check if circuit is open using window-based count (middleware-style: N failures in M ms).
   * Window resets when no failures for windowMs, or when outside the current window.
   */
  isOpenByWindow(
    component: string,
    options: { maxFailures?: number; windowMs?: number } = {},
  ): boolean {
    const { maxFailures = 50, windowMs = DEFAULT_WINDOW_MS } = options;
    const entry = this.store.get(component);
    if (!entry) return false;
    const now = Date.now();
    // Consider stale if last failure was more than windowMs ago
    if (now - entry.lastFailureTime > windowMs) {
      this.store.delete(component);
      return false;
    }
    return entry.failureCount >= maxFailures || entry.state === 'open';
  }

  /**
   * Record failure for middleware-style window tracking (used by ErrorBoundaryMiddleware).
   */
  recordFailureForWindow(
    component: string,
    options: { maxFailures?: number; windowMs?: number } = {},
  ): void {
    const { maxFailures = 50, windowMs = DEFAULT_WINDOW_MS } = options;
    const now = Date.now();
    let entry = this.store.get(component);

    if (!entry) {
      entry = {
        state: 'closed',
        failureCount: 0,
        lastFailureTime: 0,
      };
      this.store.set(component, entry);
    }

    // Reset window if we're outside it
    if (now - entry.lastFailureTime > windowMs) {
      entry.failureCount = 0;
    }

    entry.failureCount++;
    entry.lastFailureTime = now;

    if (entry.failureCount >= maxFailures) {
      entry.state = 'open';
    }
  }

  getAllEntries(): Map<string, CircuitBreakerEntry> {
    return new Map(this.store);
  }

  reset(component?: string): void {
    if (component) {
      this.store.delete(component);
    } else {
      this.store.clear();
    }
  }
}

export const circuitBreakerStore = new CircuitBreakerStoreImpl();
