/**
 * HTTP Client
 *
 * Base HTTP client for making requests to the backend API.
 * Handles request/response formatting, retries, error handling,
 * and sandbox/mock mode for offline testing.
 */

import { ApiError, DorisioError, ErrorHandler, ErrorHandlerContext } from '../types';
import { InterceptorManager } from './interceptors';
import { generateRequestId, isRequestIdempotent, RetryConflictError } from './retry-manager';
import { MockRouter, type SandboxHistoryEntry } from '../sandbox/mock-router';
import { RequestQueue } from './request-queue';
import { OfflineQueue } from './offline-queue';
import { MetricsCollector, type MetricsSummary, type MetricsCallback } from '../lib/metrics';

export type HttpClientMode = 'live' | 'sandbox' | 'production';

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  timeout?: number;
  retries?: number;
  /**
   * Opt a non-idempotent request (POST / DELETE) into retries. A request that
   * carries an `Idempotency-Key` header is treated as retryable as well.
   */
  isIdempotent?: boolean;
  /**
   * Caller-provided abort signal (e.g. a hook superseding a stale request).
   * Combined with the timeout signal — aborting this cancels the fetch and
   * skips retries. Aborted requests reject instead of retrying.
   */
  signal?: AbortSignal;
  /**
   * Stable id for this logical request. All retry attempts reuse it (sent to
   * the server as `X-Request-Id` when the caller did not already set one) and
   * concurrent requests must use distinct ids. Generated automatically when
   * omitted.
   */
  requestId?: string;
  /** Hook called with raw Response object when live fetch completes. */
  onResponse?: (response: Response) => void;
  /** Method name for metrics tracking */
  methodName?: string;
}

export interface HttpClientOptions {
  timeout?: number;
  retryAttempts?: number;
  headers?: Record<string, string>;
  /**
   * `sandbox` bypasses fetch and returns deterministic mocks.
   * `live` / `production` hit the real network.
   */
  mode?: HttpClientMode;
  sandboxSeed?: number;
  sandboxLatency?: number;
  sandboxErrorRate?: number;
  /** Emit sanitized request/response diagnostics through the configured logger. */
  debug?: boolean;
  logger?: (message: string, data?: unknown) => void;
  /** Reuse an in-flight or recently completed identical request. */
  deduplicateRequests?: boolean;
  deduplicationWindow?: number;
  /** Custom error handler for error recovery strategies */
  errorHandler?: ErrorHandler;
  /** Hook called with raw Response object when live fetch completes. */
  onResponse?: (response: Response) => void;
  enableRequestQueue?: boolean;
  maxConcurrentRequests?: number;
  enableOfflineQueue?: boolean;
  enableMetrics?: boolean;
  metricsCallback?: MetricsCallback;
}

function normalizeMode(mode?: HttpClientMode): 'live' | 'sandbox' {
  if (mode === 'sandbox') return 'sandbox';
  return 'live';
}

/**
 * Endpoints that establish the session itself. They are excluded from the
 * automatic refresh: a 401 from one of them is a bad credential, not an
 * expired access token, so refreshing would just loop.
 */
const AUTH_ENDPOINTS = ['/auth/refresh', '/auth/login', '/auth/register'] as const;

function isAuthEndpoint(path: string): boolean {
  const clean = path.split('?')[0] || '';
  return AUTH_ENDPOINTS.some((endpoint) => clean.includes(endpoint));
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

/**
 * Attach the logical request id to the outgoing headers so retries and server
 * logs can be correlated. Callers who set their own `X-Request-Id` win.
 */
function withRequestIdHeader(
  headers: Record<string, string> | undefined,
  requestId: string
): Record<string, string> {
  const next: Record<string, string> = { ...headers };
  if (!hasHeader(next, 'x-request-id')) {
    next['X-Request-Id'] = requestId;
  }
  return next;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function sanitize(value: unknown, key = ''): unknown {
  if (/authorization|cookie|token|secret|password|private.?key|api.?key/i.test(key)) {
    return '[REDACTED]';
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitize(entryValue, entryKey),
      ])
    );
  }
  return value;
}

type CachedRequest = {
  promise: Promise<unknown>;
  expiresAt: number;
};

export class HttpClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private timeout: number;
  private retryAttempts: number;
  private interceptors: InterceptorManager;
  private mode: 'live' | 'sandbox';
  private mockRouter: MockRouter;
  /** Registered by the client so a 401 can be recovered from transparently. */
  private tokenRefresher?: () => Promise<void>;
  /** In-flight refresh, shared so concurrent 401s refresh exactly once. */
  private refreshPromise?: Promise<void>;
  /** Logical request ids currently executing a retry sequence. */
  private readonly inFlightRequests = new Set<string>();
  private debug: boolean;
  private logger: (message: string, data?: unknown) => void;
  private deduplicateRequests: boolean;
  private deduplicationWindow: number;
  private deduplicationCache = new Map<string, CachedRequest>();
  private errorHandler?: ErrorHandler;
  private onResponse?: (response: Response) => void;
  private requestQueue?: RequestQueue;
  private offlineQueue?: OfflineQueue;
  private metricsCollector: MetricsCollector;

  constructor(baseUrl: string, options?: HttpClientOptions) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = options?.timeout || 30000;
    this.retryAttempts = options?.retryAttempts || 3;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };
    this.interceptors = new InterceptorManager();
    this.mode = normalizeMode(options?.mode);
    this.mockRouter = new MockRouter({
      seed: options?.sandboxSeed ?? 42,
      latency: options?.sandboxLatency ?? 0,
      errorRate: options?.sandboxErrorRate ?? 0,
    });
    this.debug = options?.debug ?? false;
    this.logger = options?.logger ?? ((message, data) => console.debug(message, data));
    this.deduplicateRequests = options?.deduplicateRequests ?? false;
    this.deduplicationWindow = options?.deduplicationWindow ?? 1000;
    this.errorHandler = options?.errorHandler;
    this.onResponse = options?.onResponse;
    if (this.deduplicationWindow < 0) {
      throw new Error('deduplicationWindow must be greater than or equal to zero');
    }

    if (options?.enableRequestQueue) {
      this.requestQueue = new RequestQueue({
        maxConcurrentRequests: options.maxConcurrentRequests,
      });
    }

    if (options?.enableOfflineQueue) {
      this.offlineQueue = new OfflineQueue();
    }

    this.metricsCollector = new MetricsCollector({
      enabled: options?.enableMetrics ?? false,
      callback: options?.metricsCallback,
    });
  }

  /**
   * Emit sanitized request/response diagnostics through the configured logger.
   */
  private log(message: string, data?: unknown): void {
    if (!this.debug) return;
    this.logger(message, data);
  }

  /**
   * Get interceptor manager
   */
  getInterceptors(): InterceptorManager {
    return this.interceptors;
  }

  /**
   * Register the callback used to renew the session when a request comes back
   * `401 Unauthorized`. The callback is expected to install the new token
   * (e.g. via {@link HttpClient.setHeader}). Without one, 401s surface
   * unchanged.
   */
  setTokenRefresher(refresher: () => Promise<void>): void {
    this.tokenRefresher = refresher;
  }

  /**
   * Register a custom error handler for error recovery strategies
   */
  setErrorHandler(handler: ErrorHandler): void {
    this.errorHandler = handler;
  }

  /**
   * Register a callback for raw fetch responses (used for version detection and header inspection)
   */
  setOnResponse(handler?: (response: Response) => void): void {
    this.onResponse = handler;
  }

  /**
   * Set default header
   */
  setHeader(key: string, value: string): void {
    this.defaultHeaders[key] = value;
  }

  /**
   * Remove default header
   */
  removeHeader(key: string): void {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.defaultHeaders[key];
  }

  /**
   * Switch between sandbox and live without recreating the client
   */
  setMode(mode: HttpClientMode): void {
    this.mode = normalizeMode(mode);
  }

  getMode(): 'live' | 'sandbox' {
    return this.mode;
  }

  isSandboxMode(): boolean {
    return this.mode === 'sandbox';
  }

  /** Number of logical requests currently in flight. */
  getInFlightRequestCount(): number {
    return this.inFlightRequests.size;
  }

  /** Ids of the logical requests currently in flight. */
  getInFlightRequestIds(): string[] {
    return [...this.inFlightRequests];
  }

  getConnectionPoolStats() {
    return this.connectionPool.stats();
  }

  configureSandbox(options: {
    seed?: number;
    latency?: number;
    errorRate?: number;
  }): void {
    if (options.seed !== undefined) this.mockRouter.setSeed(options.seed);
    if (options.latency !== undefined) this.mockRouter.setLatency(options.latency);
    if (options.errorRate !== undefined) this.mockRouter.setErrorRate(options.errorRate);
  }

  getSandboxHistory(): readonly SandboxHistoryEntry[] {
    return this.mockRouter.getHistory();
  }

  clearSandboxHistory(): void {
    this.mockRouter.clearHistory();
  }

  /**
   * Make HTTP request (or mock when in sandbox mode)
   *
   * Routes through OfflineQueue and RequestQueue when configured,
   * records performance metrics, and supports 401 token refresh.
   */
  async request<T>(path: string, options: RequestOptions): Promise<T> {
    const startTime = Date.now();
    const methodName = options.methodName || options.method;
    let success = false;
    let statusCode: number | undefined;
    let rateLimited = false;

    const executeInternal = async (): Promise<T> => {
      const requestId = options.requestId ?? generateRequestId('http');

      // One logical request may only run one retry sequence at a time. Two
      // concurrent callers reusing an id would otherwise double-submit the same
      // work (and could exceed the intended retry budget), so reject the
      // duplicate instead of racing it.
      if (this.inFlightRequests.has(requestId)) {
        throw new RetryConflictError(requestId);
      }
      this.inFlightRequests.add(requestId);

      try {
        const seeded: RequestOptions = {
          ...options,
          requestId,
          headers: withRequestIdHeader(options.headers, requestId),
        };
        const finalOptions = await this.interceptors.executeRequestInterceptors(seeded);

        const key = `${finalOptions.method}:${path}:${stableSerialize(finalOptions.body ?? null)}`;
        if (this.deduplicateRequests) {
          const cached = this.deduplicationCache.get(key);
          if (cached && cached.expiresAt > Date.now()) return cached.promise as Promise<T>;
          if (cached) this.deduplicationCache.delete(key);
        }

        const result = await this.executeDeduplication<T>(key, async () => {
          if (this.mode === 'sandbox') {
            const mocked = await this.mockRouter.handle(finalOptions.method, path, finalOptions.body);
            return (await this.interceptors.executeResponseInterceptors(mocked)) as T;
          }
          try {
            return await this.sendWithRetries<T>(path, finalOptions);
          } catch (error) {
            if (!this.canRecoverFrom(error, path, finalOptions)) throw error;
            try {
              await this.refreshSessionOnce();
            } catch {
              throw error;
            }
            return await this.sendWithRetries<T>(path, finalOptions);
          }
        });
        return result;
      } finally {
        this.inFlightRequests.delete(requestId);
      }
    };

    const executeWithQueue = (): Promise<T> => {
      if (this.requestQueue) {
        return this.requestQueue.enqueue(executeInternal);
      }
      return executeInternal();
    };

    const executeWithOffline = (): Promise<T> => {
      if (this.offlineQueue) {
        return this.offlineQueue.handleRequest(options.method, path, executeWithQueue);
      }
      return executeWithQueue();
    };

    try {
      const result = await executeWithOffline();
      success = true;
      statusCode = 200;
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.statusCode !== undefined) {
        statusCode = error.statusCode;
        if (error.statusCode === 429) {
          rateLimited = true;
        }
      }
      throw error;
    } finally {
      if (this.metricsCollector?.isEnabled()) {
        const latency = Date.now() - startTime;
        this.metricsCollector.record({
          method: methodName,
          path,
          latency,
          success,
          statusCode,
          rateLimited,
        });
      }
    }
  }

  private async executeDeduplication<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (!this.deduplicateRequests) return fn();
    const promise = fn();
    const cachedRequest: CachedRequest = {
      promise,
      expiresAt: Date.now() + this.deduplicationWindow,
    };
    this.deduplicationCache.set(key, cachedRequest);
    promise.catch(() => {
      if (this.deduplicationCache.get(key) === cachedRequest) this.deduplicationCache.delete(key);
    });
    if (this.deduplicationWindow > 0) {
      setTimeout(() => {
        if (this.deduplicationCache.get(key) === cachedRequest) this.deduplicationCache.delete(key);
      }, this.deduplicationWindow);
    }
    return promise;
  }

  /**
   * Whether a failed request is worth a token refresh + replay.
   */
  private canRecoverFrom(
    error: unknown,
    path: string,
    options: RequestOptions
  ): boolean {
    if (!this.tokenRefresher) {
      return false;
    }
    if (!(error instanceof ApiError) || error.statusCode !== 401) {
      return false;
    }
    if (isAuthEndpoint(path)) {
      return false;
    }
    // Without credentials there is nothing to refresh.
    return hasHeader({ ...this.defaultHeaders, ...options.headers }, 'authorization');
  }

  /**
   * Run the registered refresh callback, collapsing concurrent callers onto a
   * single in-flight refresh so a burst of 401s renews the session only once.
   */
  private refreshSessionOnce(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = Promise.resolve()
        .then(() => this.tokenRefresher?.())
        .then(() => undefined)
        .finally(() => {
          this.refreshPromise = undefined;
        });
    }
    return this.refreshPromise;
  }

  private log(message: string, data?: unknown): void {
    if (this.debug) {
      this.logger(message, data);
    }
  }

  /**
   * Retry loop for a single attempt to reach the API.
   *
   * Client errors are never retried. Server-side failures are retried only for
   * idempotent requests, so a POST that may already have been applied is not
   * replayed unless the caller opted in with `isIdempotent` or an
   * `Idempotency-Key` header.
   */
  private async sendWithRetries<T>(path: string, options: RequestOptions): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = { ...this.defaultHeaders, ...options.headers };

    let lastError: Error | null = null;
    const attempts = options.retries ?? this.retryAttempts;
    const canRetry = isRequestIdempotent({
      method: options.method,
      isIdempotent: options.isIdempotent,
      headers,
    });

    for (let attempt = 0; attempt < attempts; attempt++) {
      let release: (() => void) | undefined;
      try {
        release = await this.connectionPool.acquire(options.signal);
        const startedAt = Date.now();
        this.logger('[DORISIO] request', {
          method: options.method,
          path,
          body: sanitize(options.body),
          headers: sanitize(headers),
          attempt: attempt + 1,
        });
        const response = await fetch(url, {
          method: options.method,
          headers,
          body: options.body ? this.serializer.serialize(options.body) : undefined,
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeout ?? this.timeout)])
            : AbortSignal.timeout(options.timeout ?? this.timeout),
        });
        options.onResponse?.(response);
        this.onResponse?.(response);
        this.log('[DORISIO] response', {
          method: options.method,
          path,
          status: response.status,
          elapsedMs: Date.now() - startedAt,
          attempt: attempt + 1,
        });

        if (!response.ok) {
          let error: Record<string, unknown> = {};
          try {
            const errorText = await response.text();
            error = errorText ? this.serializer.deserialize<Record<string, unknown>>(errorText) : {};
          } catch {
            // Fallback for mocks that only implement json()
            try {
              error = await (response as { json?: () => Promise<Record<string, unknown>> }).json?.() ?? {};
            } catch {
              // ignore
            }
          }
          const retryAfterHeader = response.headers?.get?.('Retry-After');
          let retryAfter: number | undefined;
          if (retryAfterHeader) {
            const parsedSeconds = Number(retryAfterHeader);
            if (!Number.isNaN(parsedSeconds)) {
              retryAfter = parsedSeconds;
            } else {
              const parsedDate = Date.parse(retryAfterHeader);
              if (!Number.isNaN(parsedDate)) {
                retryAfter = Math.max(0, Math.ceil((parsedDate - Date.now()) / 1000));
              }
            }
          }
          throw new ApiError(
            String(error.error) || 'Request failed',
            response.status,
            error.code as string | undefined,
            retryAfter
          );
        }

        let data: T;
        try {
          const text = await response.text();
          data = this.serializer.deserialize<T>(text);
        } catch {
          // Fallback for mocks that only implement json()
          data = await (response as { json?: () => Promise<T> }).json?.() ?? (undefined as T);
        }

        return await this.interceptors.executeResponseInterceptors(data);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await this.interceptors.executeErrorInterceptors(lastError);

        // Don't retry requests the caller cancelled (superseded hook
        // requests) — retrying an aborted fetch just burns attempts.
        if (
          options.signal?.aborted ||
          lastError.name === 'AbortError' ||
          (lastError as { code?: number }).code === 20
        ) {
          throw lastError;
        }

        // Call custom error handler if registered
        if (this.errorHandler && lastError instanceof DorisioError) {
          const context: ErrorHandlerContext = {
            method: options.method,
            path,
            body: options.body,
            headers: options.headers,
            attempt: attempt + 1,
            requestId: options.requestId,
          };

          try {
            const action = await this.errorHandler(lastError, context);

            if (action.action === 'retry') {
              const delay = action.delayMs ?? Math.pow(2, attempt) * 1000;
              if (attempt < attempts - 1) {
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
              }
            } else if (action.action === 'fallback') {
              return action.fallbackValue as T;
            }
            // action === 'throw' falls through to throw error
          } catch (handlerError) {
            // If error handler itself fails, log and continue with normal error handling
            this.logger('[DORISIO] error handler failed', { error: handlerError });
          }
        }

        if (
          error instanceof ApiError &&
          error.statusCode !== undefined &&
          error.statusCode >= 400 &&
          error.statusCode < 500
        ) {
          throw error;
        }

        const idempotent = isRequestIdempotent({
          method: options.method,
          isIdempotent: options.isIdempotent,
          headers: options.headers,
        });
        if (!idempotent) {
          throw error;
        }

        // Never retry non-idempotent calls (avoids duplicate tips/charges)
        if (!canRetry) {
          throw lastError;
        }

        if (attempt < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      } finally {
        release?.();
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  private log(message: string, data?: unknown): void {
    if (this.debug) this.logger(message, data);
  }

  /**
   * Get performance metrics summary
   */
  getMetrics(): MetricsSummary {
    return this.metricsCollector.getMetrics();
  }

  /**
   * Get metrics collector instance
   */
  getMetricsCollector(): MetricsCollector {
    return this.metricsCollector;
  }

  /**
   * Get request queue instance if enabled
   */
  getRequestQueue(): RequestQueue | undefined {
    return this.requestQueue;
  }

  /**
   * Get offline queue instance if enabled
   */
  getOfflineQueue(): OfflineQueue | undefined {
    return this.offlineQueue;
  }

  /**
   * Check if client considers itself online
   */
  isOnline(): boolean {
    return this.offlineQueue ? this.offlineQueue.isOnline() : true;
  }

  /**
   * Set online status (triggers queue processing when switching from false to true)
   */
  setOnline(online: boolean): void {
    if (this.offlineQueue) {
      this.offlineQueue.setOnline(online);
    }
  }

  /**
   * Get number of mutations currently queued offline
   */
  getOfflineQueueSize(): number {
    return this.offlineQueue ? this.offlineQueue.getQueueSize() : 0;
  }
}
