/**
 * Retry Manager
 *
 * Manages retry logic for failed requests.
 *
 * Every call to {@link RetryManager.executeWithRetry} owns a private
 * {@link RetryContext}: the attempt counter, timing and last error live on that
 * per-call context and never on the manager instance. A single `RetryManager`
 * can therefore be shared by any number of concurrent requests without one
 * request's retries leaking into another's. The manager additionally rejects a
 * second concurrent run that reuses the *same* request id, so a logical request
 * can never be retried twice in parallel.
 */

import { ApiError } from '../types';

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  /** When true (default), adds ±10% random jitter to prevent thundering herd. */
  jritter?: boolean;
  /**
   * HTTP status codes that trigger a retry.
   * Defaults to [408, 429, 500, 502, 503, 504].
   */
  retryableStatusCodes?: number[];
}

export type IdempotencyOptions = {
  method?: string;
  isIdempotent?: boolean;
  headers?: Record<string, string>;
};

/**
 * Immutable, per-request snapshot of a retry sequence. Created inside
 * {@link RetryManager.executeWithRetry} so concurrent requests never share
 * retry state.
 */
export interface RetryContext {
  /** Stable id shared by every attempt of one logical request. */
  requestId: string;
  /** Maximum number of attempts allowed for this logical request. */
  maxAttempts: number;
  /** Epoch milliseconds when the retry sequence started. */
  startedAt: number;
}

/** Details handed to the optional `onRetry` callback before each backoff. */
export interface RetryAttemptInfo {
  requestId: string;
  /** 0-based index of the attempt that just failed. */
  attempt: number;
  maxAttempts: number;
  /** Milliseconds the manager will wait before the next attempt. */
  delayMs: number;
  error: Error;
}

/** Options for {@link RetryManager.executeWithRetry}. */
export interface ExecuteWithRetryOptions {
  /**
   * Stable id for one logical request. Retries of the same logical request must
   * reuse the id; distinct concurrent requests must use distinct ids. Generated
   * automatically when omitted.
   */
  requestId?: string;
  /** Predicate deciding whether a thrown error should be retried. */
  isRetryable?: (error: unknown) => boolean;
  /** Called before each backoff sleep, for logging/metrics. */
  onRetry?: (info: RetryAttemptInfo) => void;
}

/**
 * Thrown when the same logical request (same `requestId`) is already executing
 * its retry sequence. This guards against duplicate concurrent retries of one
 * request, which is the shared-state failure this module is meant to prevent.
 */
export class RetryConflictError extends Error {
  readonly requestId: string;
  readonly code = 'RETRY_CONFLICT';

  constructor(requestId: string) {
    super(`Request ${requestId} already has an in-flight retry sequence`);
    this.name = 'RetryConflictError';
    this.requestId = requestId;
  }
}

let requestCounter = 0;

/**
 * Generate a process-unique request id.
 *
 * The monotonic counter disambiguates calls made within the same millisecond,
 * so two concurrent requests can never collide even under heavy load.
 */
export function generateRequestId(prefix = 'req'): string {
  requestCounter = (requestCounter + 1) >>> 0;
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${requestCounter.toString(36)}-${random}`;
}

/**
 * Detect Idempotency-Key header (case-insensitive).
 */
export function hasIdempotencyKey(headers?: Record<string, string>): boolean {
  if (!headers) {
    return false;
  }
  return Object.keys(headers).some((key) => key.toLowerCase() === 'idempotency-key');
}

/**
 * Determine whether a request is safe to retry.
 *
 * - GET / HEAD: always idempotent
 * - POST / PUT / PATCH / DELETE: only when `isIdempotent: true` or Idempotency-Key is set
 */
export function isRequestIdempotent(options: IdempotencyOptions): boolean {
  const method = (options.method || 'GET').toUpperCase();

  if (method === 'GET' || method === 'HEAD') {
    return true;
  }

  if (options.isIdempotent === true) {
    return true;
  }

  if (hasIdempotencyKey(options.headers)) {
    return true;
  }

  return false;
}

const DEFAULT_RETRYABLE_STATUS_CODES: readonly number[] = [408, 429, 500, 502, 503, 504];

export class RetryManager {
  private config: Required<RetryConfig>;
  /** Ids of logical requests currently inside {@link executeWithRetry}. */
  private readonly inFlight = new Set<string>();

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = {
      maxAttempts: config.maxAttempts ?? 3,
      initialDelayMs: config.initialDelayMs ?? 1000,
      maxDelayMs: config.maxDelayMs ?? 30000,
      backoffMultiplier: config.backoffMultiplier ?? 2,
      jritter: config.jritter ?? true,
      retryableStatusCodes: config.retryableStatusCodes ?? [...DEFAULT_RETRYABLE_STATUS_CODES],
    };
  }

  /** Number of logical requests currently running a retry sequence. */
  getInFlightCount(): number {
    return this.inFlight.size;
  }

  /** Ids of the logical requests currently running a retry sequence. */
  getInFlightRequestIds(): string[] {
    return [...this.inFlight];
  }

  /**
   * Execute `fn` with retry logic.
   *
   * Retry counters are held on a per-call {@link RetryContext}, so concurrent
   * invocations are fully isolated: each request enforces `maxAttempts` for
   * itself and never observes another request's attempts. Passing the same
   * `requestId` twice concurrently throws {@link RetryConflictError} instead of
   * retrying one logical request twice.
   *
   * Accepts either an options object or, for backwards compatibility, the bare
   * isRetryable predicate.
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    options?: ExecuteWithRetryOptions | ((error: unknown) => boolean)
  ): Promise<T> {
    const opts: ExecuteWithRetryOptions =
      typeof options === 'function' ? { isRetryable: options } : options ?? {};

    const requestId = opts.requestId ?? generateRequestId('retry');
    const context: RetryContext = {
      requestId,
      maxAttempts: this.config.maxAttempts,
      startedAt: Date.now(),
    };

    if (this.inFlight.has(requestId)) {
      throw new RetryConflictError(requestId);
    }
    this.inFlight.add(requestId);

    let lastError: Error | null = null;
    try {
      for (let attempt = 0; attempt < context.maxAttempts; attempt++) {
        try {
          return await fn();
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          // Check if retryable
          if (opts.isRetryable && !opts.isRetryable(error)) {
            throw error;
          }

          // Don't wait after last attempt
          if (attempt < context.maxAttempts - 1) {
            const delay = this.calculateDelay(attempt);
            opts.onRetry?.({
              requestId,
              attempt,
              maxAttempts: context.maxAttempts,
              delayMs: delay,
              error: lastError,
            });
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      throw lastError || new Error('Operation failed after retries');
    } finally {
      // Release the id even if the caller's fn threw a non-retryable error, so
      // the same logical request can be retried again later.
      this.inFlight.delete(requestId);
    }
  }

  /**
   * Calculate exponential backoff delay with optional jitter.
   */
  calculateDelay(attempt: number): number {
    const exponentialDelay =
      this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attempt);
    const delay = Math.min(exponentialDelay, this.config.maxDelayMs);
    if (!this.config.jritter) {
      return delay;
    }
    // ±10% jitter to prevent thundering herd
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    return Math.max(0, delay + jitter);
  }

  /**
   * Determine if an error should trigger a retry based on this instance's
   * configured retryableStatusCodes. When method/idempotency options are
   * provided, non-idempotent calls never retry.
   */
  isRetryableError(error: unknown, options?: IdempotencyOptions): boolean {
    return RetryManager.isRetryableError(error, options, this.config.retryableStatusCodes);
  }

  /**
   * Static convenience — uses the default retryable codes unless overridden.
   */
  static isRetryableError(
    error: unknown,
    options?: IdempotencyOptions,
    retryableStatusCodes: readonly number[] = DEFAULT_RETRYABLE_STATUS_CODES,
  ): boolean {
    if (options && !isRequestIdempotent(options)) {
      return false;
    }

    if (error instanceof ApiError && error.statusCode) {
      return retryableStatusCodes.includes(error.statusCode);
    }

    if (error instanceof Error) {
      // Retry on network/timeout errors
      return (
        error.message.includes('network') ||
        error.message.includes('timeout') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('ENOTFOUND')
      );
    }

    return false;
  }
}
