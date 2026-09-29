/**
 * Circuit Breaker Pattern
 *
 * Prevents cascading failures by failing fast when an endpoint
 * is experiencing outages. Implements the classic three-state
 * circuit breaker: closed, OPEN, and HALF-OPEN.
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  failureThreshold?: number;
  /** Time in milliseconds to wait before transitioning to half-open. Default: 60000 */
  resetTimeout?: number;
  /** Number of test requests allowed in half-open state. Default: 1 */
  halfOpenRequests?: number;
  /** Number of successes in half-open before closing. Default: 1 */
  successThreshold?: number;
  /** Optional callback invoked on every state transition. */
  onStateChange?: (from: CircuitState, to: CircuitState, key: string) => void;
  /** Optional clock injection for testing. Defaults to Date.now. */
  now?: () => number;
}

export interface CircuitBreakerStatus {
  key: string;
  state: CircucuitState;
  failures: number;
  successes: number;
  lastFailureAt?: number;
  openedAt?: number;
}

export class CircuitBreakerOpenError extends Error {
  readonly code = 'CIRCUIT_BREAKER_OPEN';
  readonly key: string;
  readonly retryAfter: number;

  constructor(key: string, retryAfter: number) {
    super(
      `Circuit breaker is open for "${key}". Retry after ${retryAfter}ms.`,
    );
    this.name = 'CircuitBreakerOpenError';
    this.key = key;
    this.retryAfter = retryAfter;
  }
}

interface CircuitEntry {
  state: CircuitState;
  failures: number;
  successes: number;
  halfOpenInFlight: number;
  lastFailureAt?: number;
  openedAt?: number;
}

/**
 * Per-endpoint circuit breaker.
 *
 * Tracks failures and successes per key (typically an endpoint
 * path) and transitions between closed, open, and half-open states.
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly halfOpenRequests: number;
  private readonly successThreshold: number;
  private readonly onStateChange?: (
    from: CircuitState,
    to: CircuitState,
    key: string,
  ) => void;
  private readonly clock: () => number;
  private readonly entries = new Map<string, CircuitEntry>();

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 60_000;
    this.halfOpenRequests = options.halfOpenRequests ?? 1;
    this.successThreshold = options.successThreshold ?? 1;
    this.onStateChange = options.onStateChange;
    this.clock = options.now ?? (() => Date.now());

    if (this.failureThreshold < 1) {
      throw new Error('failureThreshold must be greater than 0');
    }
    if (this.resetTimeout < 0) {
      throw new Error('resetTimeout must be >= 0');
    }
    if (this.halfOpenRequests < 1) {
      throw new Error('halfOpenRequests must be greater than 0');
    }
  }

  /** Returns true if a request for the key may proceed. */
  canAttempt(key: string): boolean {
    const entry = this.getOrCreateEntry(key);
    this.maybeTransitionToHalfOpen(key, entry);

    if (entry.state === 'closed') {
      return true;
    }

    if (entry.state === 'open') {
      return false;
    }

    // half-open: allow up to halfOpenRequests in-flight test requests
    if (entry.halfOpenInFlight < this.halfOpenRequests) {
      entry.halfOpenInFlight += 1;
      return true;
    }
    return false;
  }

  /** Throws a CircuitBreakerOpenError if the circuit is open. */
  assertCanAttempt(key: string): void {
    if (!this.canAttempt(key)) {
      throw new CircuitBreakerOpenError(key, this.remainingResetTime(key));
    }
  }

  /** Record a successful call for the key. */
  recordSuccess(key: string): void {
    const entry = this.getOrCreateEntry(key);
    this.maybeTransitionToHalfOpen(key, entry);

    if (entry.state === 'half-open') {
      entry.successes += 1;
      if (entry.halfOpenInFlight > 0) {
        entry.halfOpenInFlight -= 1;
      }
      if (entry.successes >= this.successThreshold) {
        this.transition(key, entry, 'closed');
        entry.failures = 0;
        entry.successes = 0;
        entry.openedAt = undefined;
      }
      return;
    }

    // closed: reset failure counter
    entry.failures = 0;
    entry.successes += 1;
  }

  /** Record a failed call for the key. */
  recordFailure(key: string): void {
    const entry = this.getOrCreateEntry(key);
    this.maybeTransitionToHalfOpen(key, entry);

    entry.lastFailureAt = this.clock();

    if (entry.state === 'half-open') {
      if (entry.halfOpenInFlight > 0) {
        entry.halfOpenInFlight -= 1;
      }
      // Any failure in half-open reopens the circuit.
      this.open(key, entry);
      return;
    }

    entry.failures += 1;
    if (entry.failures >= this.failureThreshold) {
      this.open(key, entry);
    }
  }

  /** Return the current state for a key. */
  getState(key: string): CircuitState {
    const entry = this.getOrCreateEntry(key);
    this.maybeTransitionToHalfOpen(key, entry);
    return entry.state;
  }

  /** Snapshot of all tracked keys. */
  getStatuses(): CircuitBreakerStatus[] {
    const result: CircuitBreakerStatus[] = [];
    for (const [key, entry] of this.entries) {
      this.maybeTransitionToHalfOpen(key, entry);
      result.push({
        key,
        state: entry.state,
        failures: entry.failures,
        successes: entry.successes,
        lastFailureAt: entry.lastFailureAt,
        openedAt: entry.openedAt,
      });
    }
    return result;
  }

  /** Milliseconds remaining until the circuit may half-open. 0 if not open. */
  remainingResetTime(key: string): number {
    const entry = this.entries.get(key);
    if (!entry || entry.state !== 'open' || entry.openedAt === undefined) {
      return 0;
    }
    const elapsed = this.clock() - entry.openedAt;
    return Math.max(0, this.resetTimeout - elapsed);
  }

  /** Reset a single key to the closed state. */
  reset(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    if (entry.state !== 'closed') {
      this.transition(key, entry, 'closed');
    }
    entry.failures = 0;
    entry.successes = 0;
    entry.halfOpenInFlight = 0;
    entry.openedAt = undefined;
  }

  /** Reset all tracked keys. */
  resetAll(): void {
    for (const key of Array.from(this.entries.keys())) {
      this.reset(key);
    }
  }

  private getOrCreateEntry(key: string): CircuitEntry {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        state: 'closed',
        failures: 0,
        successes: 0,
        halfOpenInFlight: 0,
      };
      this.entries.set(key, entry);
    }
    return entry;
  }

  private maybeTransitionToHalfOpen(key: string, entry: CircuitEntry): void {
    if (entry.state !== 'open' || entry.openedAt === undefined) {
      return;
    }
    if (this.clock() - entry.openedAt >= this.resetTimeout) {
      this.transition(key, entry, 'half-open');
      entry.successes = 0;
      entry.halfOpenInFlight = 0;
    }
  }

  private open(key: string, entry: CircuitEntry): void {
    this.transition(key, entry, 'open');
    entry.openedAt = this.clock();
    entry.successes = 0;
    entry.halfOpenInFlight = 0;
  }

  private transition(key: string, entry: CircuitEntry, next: CircuitState): void {
    if (entry.state === next) {
      return;
    }
    const prev = entry.state;
    entry.state = next;
    if (this.onStateChange) {
      try {
        this.onStateChange(prev, next, key);
      } catch {
        // ignore observer errors
      }
    }
  }
}
