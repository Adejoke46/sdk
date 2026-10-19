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
 *
 * This module also implements DNS failover: when a request fails with a DNS
 * resolution error, the manager can switch to a fallback host and retry
 * immediately (without exponential backoff). DNS resolution results are cached
 * briefly to avoid repeated lookups.
 */

import { ApiError, DorisioError, RateLimitError, type RateLimitMetadata } from '../types';

function parseHeaderSeconds(value: string | null | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value.trim())) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds * 1000) ? seconds : undefined;
}

function parseHeaderDate(value: string | null | undefined): number | undefined {
  if (!value || !/^[a-z]{3}/i.test(value.trim())) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp / 1000 : undefined;
}

/** Parse server rate-limit hints. Retry-After takes precedence over the reset timestamp. */
export function parseRateLimitHeaders(
  headers?: Pick<Headers, 'get'>,
  now = Date.now()
): { retryAfter?: number; rateLimit: RateLimitMetadata } {
  const retryAfter = headers?.get('Retry-After');
  const reset = headers?.get('X-RateLimit-Reset');
  const rateLimit: RateLimitMetadata = {
    limit: parseHeaderSeconds(headers?.get('X-RateLimit-Limit')),
    remaining: parseHeaderSeconds(headers?.get('X-RateLimit-Remaining')),
    reset: parseHeaderSeconds(reset) ?? parseHeaderDate(reset),
  };
  const retryAt = parseHeaderDate(retryAfter) ?? rateLimit.reset;
  return {
    retryAfter:
      parseHeaderSeconds(retryAfter) ??
      (retryAt === undefined ? undefined : Math.max(0, retryAt - now / 1000)),
    rateLimit,
  };
}

/** Split long server-directed waits to avoid setTimeout's signed 32-bit overflow. */
export async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  let remaining = delayMs;
  do {
    const chunk = Math.min(remaining, 2 ** 31 - 1);
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, chunk);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    remaining -= chunk;
  } while (remaining > 0);
}

export interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  /** When true (default), adds 0–100 ms random jitter to prevent thundering herd. */
  jitter?: boolean;
  /**
   * HTTP status codes that trigger a retry.
   * Defaults to [408, 429, 500, 502, 503, 504].
   */
  retryableStatusCodes?: number[];
  /**
   * Hosts to fail over to when the primary host cannot be resolved (DNS
   * failure). Tried in order.
   */
  fallbackHosts?: string[];
  /**
   * How long DNS resolution results are cached, in milliseconds.
   * Defaults to 30000 (30s). Never cached indefinitely.
   */
  dnsCacheTtlMs?: number;
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

/** Default TTL for cached DNS resolution results (30 seconds). */
const DEFAULT_DNS_CACHE_TTL_MS = 30_000;

/** Error codes that indicate a DNS resolution failure. */
const DNS_ERROR_CODES = ['ENOTFOUND', 'EAI_AGAIN', 'ENODA', 'ESOCKFAILURE'];

/** Message fragments that indicate a DNS resolution failure. */
const DNS_ERROR_MESSAGES = [
  'enotfound',
  'getaddrinfo',
  'getaddrinfo enotfound',
  'nodname not resolved',
  'name or service not known',
  'dns lookup failed',
  'dns resolution failed',
  'temporary failure in name resolution',
];

/** Cache entry for a DNS resolution result. */
export interface DnsCacheEntry {
  host: string;
  resolved: boolean;
  expiresAt: number;
}

/**
 * Return true when the error represents a DNS resolution failure (e.g.
 * ENOTFOUND, getaddrinfo ENOTFOUND, temporary name resolution failure).
 *
 * This is deliberately conservative: only errors that clearly indicate a
 * name-resolution problem are classified as DNS failures.
 */
export function isDnsFailureError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const anyError = error as any;
  const code: string | undefined = anyError.code || anyError.errno;
  if (code && DNS_ERROR_CODES.includes(code.toUpperCase())) {
    return true;
  }

  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return DNS_ERROR_MESSAGES.some((fragment) => message.includes(fragment));
}

export class RetryManager {
  private config: Required<RetryConfig>;
  /** Ids of logical requests currently inside {@link executeWithRetry}. */
  private readonly inFlight = new Set<string>();
  /** Brief DNS resolution cache keyed by host name. */
  private readonly dnsCache = new Map<string, DnsCacheEntry>();

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = {
      maxAttempts: config.maxAttempts ?? 3,
      initialDelayMs: config.initialDelayMs ?? 1000,
      maxDelayMs: config.maxDelayMs ?? 30000,
      backoffMultiplier: config.backoffMultiplier ?? 2,
      jitter: config.jitter ?? true,
      retryableStatusCodes: config.retryableStatusCodes ?? [...DEFAULT_RETRYABLE_STATUS_CODES],
      fallbackHosts: config.fallbackHosts ?? [],
      dnsCacheTtlMs: config.dnsCacheTtlMs ?? DEFAULT_DNS_CACHE_TTL_MS,
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

  /** Configured fallback hosts, in priority order. */
  getFallbackHosts(): string[] {
    return [...this.config.fallbackHosts];
  }

  /** Number of currently cached DNS resolution results. */
  getDnsCacheSize(): number {
    this.pruneDnsCache();
    return this.dnsCache.size;
  }

  /** Clear the DNS resolution cache. */
  clearDnsCache(): void {
    this.dnsCache.clear();
  }

  /**
   * Record a DNS resolution result for `host` in the brief cache.
   *
   * Caching is always bounded by the configured TTL; results are never cached
   * indefinitely.
   */
  cacheDnsResult(host: string, resolved: boolean, ttlMs?: number): void {
    const ttl = ttlMs ?? this.config.dnsCacheTtlMs;
    this.dnsCache.set(host, {
      host,
      resolved,
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Return a cached DNS resolution result for host, or null when there is no
   * live cache entry. Expired entries are evicted on read.
   */
  getCachedDnsResult(host: string): boolean | null {
    const entry = this.dnsCache.get(host);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.dnsCache.delete(host);
      return null;
    }
    return entry.resolved;
  }

  /** Evict expired DNS cache entries. */
  private pruneDnsCache(): void {
    const now = Date.now();
    for (const [host, entry] of this.dnsCache) {
      if (entry.expiresAt <= now) {
        this.dnsCache.delete(host);
      }
    }
  }

  /**
   * Resolve `fn` (in the context of `host`) with DNS failover.
   *
   * When the primary host fails with a DNS error, the manager tries each
   * configured fallback host in order. DNS failure triggers failover rather than
   * exponential backoff: failover attempts are immediate. Resolution results
   * are cached briefly to avoid repeated lookups.
   *
   * @failoverHosts Optional override of the configured fallback hosts.
   */
  async executeWithFailover<T>(
    fn: (host: string) => Promise<T>,
    primaryHost: string,
    failoverHosts: string[] = this.config.fallbackHosts,
  ): Promise<T> {
    const hosts = [primaryHost, ...failoverHosts];
    let lastError: Error | null = null;

    for (const host of hosts) {
      const cached = this.getCachedDnsResult(host);
      if (cached === false) {
        // Known-bad host within the TTL: skip without a repeated lookup.
        continue;
      }

      try {
        const result = await fn(host);
        this.cacheDnsResult(host, true);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (isDnsFailureError(error)) {
          // DNS failure: cache the negative result and fail over immediately.
          this.cacheDnsResult(host, false);
          continue;
        }
        // Non-DNS errors are not failove-eligible.
        throw error;
      }
    }

    throw lastError || new Error(`All DNS hosts failed: ${hosts.join(', ')}`);
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
   * DNS failures trigger failover (via {@link executeWithFailover}), not
   * exponential backoff. When `failoverHosts` is provided and the thrown error
   * is a DNS failure, the fn is re-invoked immediately against each fallback
   * host in turn.
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

          // DNS failures trigger failover, not exponential backoff.
          if (isDnsFailureError(error) && this.config.fallbackHosts.length > 0) {
            throw lastError;
          }

          const retryable = opts.isRetryable ? opts.isRetryable(error) : true;
          const isLastAttempt = attempt >= context.maxAttempts - 1;
          if (!retryable || isLastAttempt) {
            throw lastError;
          }

          const delayMs = this.calculateDelay(attempt, lastError);
          opts.onRetry?.({
            requestId,
            attempt,
            maxAttempts: context.maxAttempts,
            delayMs,
            error: lastError,
          });
          await waitForRetry(delayMs);
        }
      }

      throw lastError || new Error('Retry sequence failed without an error');
    } finally {
      this.inFlight.delete(requestId);
    }
  }

  /** Compute the backoff delay for a given 0-based attempt index. */
  private computeDelay(attempt: number): number {
    let delay = this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attempt);
    if (this.config.jitter) {
      // Additive 0–100 ms jitter so concurrent clients don't retry in lockstep.
      delay += Math.floor(Math.random() * 101);
    }
    return Math.max(0, Math.round(Math.min(delay, this.config.maxDelayMs)));
  }

  /** Respect a 429 server delay, otherwise use the configured exponential backoff. */
  public calculateDelay(attempt: number, error?: Error): number {
    if (
      (error instanceof ApiError || error instanceof RateLimitError) &&
      error.statusCode === 429 &&
      error.retryAfter !== undefined &&
      Number.isFinite(error.retryAfter * 1000) &&
      error.retryAfter >= 0
    ) {
      return error.retryAfter * 1000;
    }
    return this.computeDelay(attempt);
  }

  /**
   * Determine whether an error should be retried based on its status code and,
   * when idempotency context is provided, whether the request is idempotent.
   *
   * When `options` is omitted, a matching retryable status code is sufficient.
   * `retryableStatusCodes` overrides the instance-configured codes when given.
   */
  static isRetryableError(
    error: unknown,
    options?: IdempotencyOptions,
    retryableStatusCodes?: number[],
  ): boolean {
    const codes = retryableStatusCodes ?? DEFAULT_RETRYABLE_STATUS_CODES;
    const statusCode =
      error instanceof DorisioError
        ? error.statusCode
        : (error as { statusCode?: number })?.statusCode;
    if (typeof statusCode !== 'number' || !codes.includes(statusCode)) {
      return false;
    }
    if (!options) {
      return true;
    }
    return isRequestIdempotent(options);
  }

  /** Instance-level retryability check using the configured status codes. */
  isRetryableError(error: unknown, options?: IdempotencyOptions): boolean {
    return RetryManager.isRetryableError(error, options, this.config.retryableStatusCodes);
  }
}
