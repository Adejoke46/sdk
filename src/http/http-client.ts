/**
 * HTTP Client
 *
 * Base HTTP client for making requests to the backend API.
 * Handles request/response formatting, retries, error handling,
 * request fingerprinting, custom headers, and sandbox/mock mode for offline testing.
 */

import { ApiError, DorisioError, ErrorHandler, ErrorHandlerContext, TimeoutError } from '../types';
import type { CacheOptions } from '../types/cache';
import type { QueueConfig, QueueStats, RequestPriority } from '../types/queue';
import { CacheManager } from '../cache/cache-manager';
import { InterceptorManager } from './interceptors';
import { generateRequestId, isRequestIdempotent, RetryConflictError } from './retry-manager';
import { CircuitBreaker, type CircuitBreakerConfig, CircuitOpenError } from './circuit-breaker';
import { MockRouter, type SandboxHistoryEntry } from '../sandbox/mock-router';
import { RequestQueue } from './request-queue';
import { PriorityRequestQueue } from '../queue/request-queue';
import { OfflineQueue } from './offline-queue';
import { ConnectionPool } from './connection-pool';
import { JsonSerializer } from './serializer';
import { MetricsCollector, type MetricsSummary, type MetricsCallback } from '../lib/metrics';
import { ThrottleManager } from './throttle-manager';
import { HookManager, type HookContext, type ResponseContext } from '../lib/hooks';
import {
  StreamHandler,
  type StreamOptions,
  type StreamResult,
  isLargeResponse,
} from './stream-handler';
import { getTracingProvider, SpanStatus } from '../lib/telemetry';
import { validateSchema } from '../validation/schema-validator';
import type { ValidationSchemas } from '../types/validation';
import { prepareRequestBody, type RequestCompressionConfig } from './compress';

export type HttpClientMode = 'live' | 'sandbox' | 'production';

export interface RequestOptions {
  /** Override the client's schemas for this request. */
  schemas?: ValidationSchemas;
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
  /** Callback invoked after the response is received but before middleware processing. */
  onResponse?: (response: Response) => void;
  /**
   * Stable id for this logical request. All retry attempts reuse it (sent to
   * the server as `X-Request-Id` when the caller did not already set one) and
   * concurrent requests must use distinct ids. Generated automatically when
   * omitted.
   */
  requestId?: string;
  /**
   * Optional name of the calling SDK method for logging / diagnostics.
   */
  methodName?: string;
  /** Parameters used with methodName for cache lookup and invalidation. */
  cacheParams?: readonly unknown[];
  /**
   * Enable streaming mode for large responses. Allows processing chunks
   * without loading entire response into memory.
   */
  streaming?: boolean;
  /**
   * Streaming options for chunk handling and progress tracking
   */
  streamOptions?: StreamOptions;
  /**
   * Relative priority for the priority request queue. Only meaningful when
   * the queue is enabled; defaults to `'normal'`.
   */
  priority?: RequestPriority;
}

export interface HttpClientOptions {
  /** Validate and transform request bodies and responses. */
  schemas?: ValidationSchemas;
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
  /** Optional response cache configuration. */
  cache?: CacheOptions;
  /** Custom error handler for error recovery strategies */
  errorHandler?: ErrorHandler;
  /** Custom request ID generator function */
  requestIdGenerator?: () => string;
  /**
   * Enable request queue with concurrency control and automatic 429 backoff.
   */
  enableRequestQueue?: boolean;
  /**
   * Maximum concurrent requests in flight when request queue is enabled (default: 5).
   */
  maxConcurrentRequests?: number;
  /**
   * Enable offline mutation queue.
   */
  enableOfflineQueue?: boolean;
  /**
   * Enable performance metrics collection.
   */
  enableMetrics?: boolean;
  /**
   * Optional callback invoked whenever a request metric is recorded.
   */
  metricsCallback?: MetricsCallback;
  /** Enable request throttling */
  enableThrottling?: boolean;
  /** Max requests per throttling window */
  throttleMaxRequests?: number;
  /** Throttling window in ms */
  throttleWindowMs?: number;
  /** Hook manager for request/response lifecycle hooks */
  hookManager?: HookManager;
  /** Proxy configuration */
  proxy?: ProxyConfig;
  /** Circuit breaker configuration for failing endpoints */
  circuitBreaker?: CircuitBreakerConfig;
  /**
   * Priority request queue configuration. When `enabled` is true, requests
   * are routed through a bounded concurrency queue that honours per-request
   * `priority`. Takes precedence over the legacy `enableRequestQueue` flag.
   */
  queue?: QueueConfig;
}

export interface ProxyConfig {
  /** Proxy URL (e.g. 'http://proxy:8080') */
  url: string;
  /** Proxy auth username */
  username?: string;
  /** Proxy auth password */
  password?: string;
  /** Whether to reject unauthorized SSL certificates */
  rejectUnauthorized?: boolean;
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
 * logs can be correlated. Callers who set their own `X-Request-Id` or `X-Request-ID` win.
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
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`
      )
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function cloneCachedValue<T>(value: T): T {
  if (typeof structuredClone !== 'function') {
    return value;
  }
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
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
  private readonly schemas?: ValidationSchemas;
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
  private cacheManager: CacheManager;
  private errorHandler?: ErrorHandler;
  private requestIdGenerator?: () => string;
  private requestQueue?: RequestQueue;
  private priorityQueue?: PriorityRequestQueue;
  private offlineQueue?: OfflineQueue;
  private connectionPool: ConnectionPool;
  private serializer: JsonSerializer;
  private metricsCollector: MetricsCollector;
  private throttleManager?: ThrottleManager;
  private hookManager?: HookManager;
  private proxy?: ProxyConfig;
  private onResponse?: (response: Response) => void;
  private compression?: RequestCompressionConfig;
  private streamHandler: StreamHandler;
  private circuitBreaker?: CircuitBreaker;

  constructor(baseUrl: string, options?: HttpClientOptions) {
    this.schemas = options?.schemas;
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
    this.cacheManager = new CacheManager(options?.cache);
    this.errorHandler = options?.errorHandler;
    this.requestIdGenerator = options?.requestIdGenerator;

    if (options?.enableRequestQueue) {
      this.requestQueue = new RequestQueue({
        maxConcurrentRequests: options.maxConcurrentRequests,
      });
    }

    if (options?.queue?.enabled) {
      this.priorityQueue = new PriorityRequestQueue({
        maxConcurrent: options.queue.maxConcurrent,
        prioritize: options.queue.prioritize,
        maxQueueSize: options.queue.maxQueueSize,
      });
    }

    if (options?.enableOfflineQueue) {
      this.offlineQueue = new OfflineQueue();
    }

    this.metricsCollector = new MetricsCollector({
      enabled: options?.enableMetrics ?? false,
      callback: options?.metricsCallback,
    });

    if (this.deduplicationWindow < 0) {
      throw new Error('deduplicationWindow must be greater than or equal to zero');
    }

    if (options?.enableThrottling) {
      this.throttleManager = new ThrottleManager({
        maxRequests: options.throttleMaxRequests,
        windowMs: options.throttleWindowMs,
      });
    }

    this.connectionPool = new ConnectionPool();
    this.serializer = new JsonSerializer();
    this.hookManager = options?.hookManager;
    this.proxy = options?.proxy;
    this.onResponse = options?.onResponse;
    this.compression = options?.compress;
    this.streamHandler = new StreamHandler();

    if (options?.circuitBreaker) {
      this.circuitBreaker = new CircuitBreaker(options.circuitBreaker);
    }
  }

  /**
   * Emit sanitized request/response diagnostics through the configured logger.
   */
  private log(message: string, data?: unknown): void {
    if (this.debug) {
      this.logger(message, data);
    }
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
   * Set custom request ID generator
   */
  setRequestIdGenerator(generator: () => string): void {
    this.requestIdGenerator = generator;
  }

  /**
   * Set default header
   */
  setHeader(key: string, value: string): void {
    this.defaultHeaders[key] = value;
    if (key.toLowerCase() === 'authorization') {
      this.cacheManager.clear();
    }
  }

  /**
   * Remove default header
   */
  removeHeader(key: string): void {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.defaultHeaders[key];
    if (key.toLowerCase() === 'authorization') {
      this.cacheManager.clear();
    }
  }

  getCacheManager(): CacheManager {
    return this.cacheManager;
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

  configureSandbox(options: { seed?: number; latency?: number; errorRate?: number }): void {
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
    const methodName = options.methodName ?? options.method;
    let success = false;
    let statusCode: number | undefined;
    let rateLimited = false;
    let cacheStatus: 'hit' | 'miss' | undefined;

    const requestId =
      options.requestId ??
      (this.requestIdGenerator ? this.requestIdGenerator() : generateRequestId('http'));

    // One logical request may only run one retry sequence at a time. Two
    // concurrent callers reusing an id would otherwise double-submit the same
    // work (and could exceed the intended retry budget), so reject the
    // duplicate instead of racing it.
    if (this.inFlightRequests.has(requestId)) {
      throw new RetryConflictError(requestId);
    }
    this.inFlightRequests.add(requestId);

    const executeInternal = async (): Promise<T> => {
      try {
        // Throttle before making request
        if (this.throttleManager) {
          await this.throttleManager.acquire(path);
        }

        // Execute beforeRequest hooks
        let hookCtx: HookContext = {
          method: options.method,
          path,
          body: options.body,
          headers: options.headers,
          requestId,
          state: {},
        };
        if (this.hookManager) {
          hookCtx = await this.hookManager.executeBeforeRequest(hookCtx);
          options = {
            ...options,
            body: hookCtx.body as Record<string, unknown>,
            headers: hookCtx.headers,
          };
        }

        const seeded: RequestOptions = {
          ...options,
          requestId,
          headers: withRequestIdHeader(options.headers, requestId),
        };
        const finalOptions = await this.interceptors.executeRequestInterceptors(seeded);
        const schemas = finalOptions.schemas ?? this.schemas;
        if (
          schemas?.request &&
          (finalOptions.body !== undefined ||
            finalOptions.method === 'POST' ||
            finalOptions.method === 'PUT' ||
            finalOptions.method === 'PATCH')
        ) {
          finalOptions.body = validateSchema(
            schemas.request, finalOptions.body, 'request', requestId
          ) as Record<string, unknown>;
        }
        const validateResponse = async (value: T): Promise<T> => {
          const response = await this.interceptors.executeResponseInterceptors(value);
          return schemas?.response
            ? validateSchema(schemas.response, response, 'response', requestId) as T
            : response as T;
        };

        // Execute afterRequest hooks
        if (this.hookManager) {
          await this.hookManager.executeAfterRequest(hookCtx);
        }

        const cacheMethod = finalOptions.methodName ?? finalOptions.method;
        const cacheBaseParams = finalOptions.cacheParams ?? [path, finalOptions.body ?? null];
        const cacheHeaders = Object.fromEntries(
          Object.entries({ ...this.defaultHeaders, ...finalOptions.headers })
            .filter(([header]) => header.toLowerCase() !== 'x-request-id')
            .sort(([left], [right]) => left.localeCompare(right))
        );
        const cacheParams = [...cacheBaseParams, cacheHeaders];
        const key = `${finalOptions.method}:${path}:${stableSerialize(finalOptions.body ?? null)}:${stableSerialize(cacheHeaders)}`;
        const isCacheable = finalOptions.method === 'GET' && this.cacheManager.isEnabled();

        if (isCacheable) {
          const cached = this.cacheManager.get<T>(cacheMethod, cacheParams);
          if (cached !== undefined) {
            cacheStatus = 'hit';
            return validateResponse(cloneCachedValue(cached));
          }
          cacheStatus = 'miss';
        }

        const result = await this.executeDeduplication<T>(key, async () => {
          let response: T;
          if (this.mode === 'sandbox') {
            const mocked = await this.mockRouter.handle(
              finalOptions.method,
              path,
              finalOptions.body
            );
            response = mocked as T;
          } else {
            try {
              response = await this.sendWithRetries<T>(path, finalOptions);
            } catch (error) {
              if (this.circuitBreaker && !(error instanceof CircuitOpenError)) {
                if (error instanceof ApiError && error.statusCode !== undefined && error.statusCode < 500) {
                  this.circuitBreaker.recordSuccess(path);
                } else {
                  this.circuitBreaker.recordFailure(path);
                }
              }
              if (!this.canRecoverFrom(error, path, finalOptions)) throw error;
              try {
                await this.refreshSessionOnce();
              } catch {
                throw error;
              }
              response = await this.sendWithRetries<T>(path, finalOptions);
            }
          }

          if (isCacheable) {
            this.cacheManager.set(cacheMethod, cacheParams, cloneCachedValue(response));
          }
          return response;
        });
        if (this.circuitBreaker) {
          this.circuitBreaker.recordSuccess(path);
        }
        return validateResponse(result);
      } finally {
        this.inFlightRequests.delete(requestId);
      }
    };

    const executeWithQueue = (): Promise<T> => {
      if (this.priorityQueue) {
        return this.priorityQueue.enqueue(executeInternal, options.priority ?? 'normal');
      }
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
      this.inFlightRequests.delete(requestId);
      if (this.metricsCollector.isEnabled()) {
        const latency = Date.now() - startTime;
        this.metricsCollector.record({
          method: methodName,
          path,
          latency,
          success,
          statusCode,
          rateLimited,
          cacheStatus,
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
  private canRecoverFrom(error: unknown, path: string, options: RequestOptions): boolean {
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
    let headers = { ...this.defaultHeaders, ...options.headers };
    const serializedBody = options.body ? this.serializer.serialize(options.body) : undefined;
    let requestBody: BodyInit | undefined;
    if (serializedBody !== undefined) {
      const preparedBody = await prepareRequestBody(serializedBody, headers, this.compression);
      headers = preparedBody.headers;
      requestBody = preparedBody.body;
    }

    // Apply proxy configuration if set
    const fetchOptions: RequestInit = {
      method: options.method,
      headers,
      body: requestBody,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeout ?? this.timeout)])
        : AbortSignal.timeout(options.timeout ?? this.timeout),
    };

    // If proxy is configured, try to use undici ProxyAgent (Node.js only)
    if (this.proxy?.url && typeof globalThis.process !== 'undefined') {
      try {
        // Dynamic import to avoid bundling undici in browser builds
        const undici = await (Function('return import("undici")')() as Promise<
          typeof import('undici')
        >);
        (fetchOptions as Record<string, unknown>).dispatcher = new undici.ProxyAgent({
          uri: this.proxy.url,
          requestTls: { rejectUnauthorized: this.proxy.rejectUnauthorized ?? true },
        });
      } catch {
        // undici not available, fall through to direct fetch
      }
    }

    let lastError: Error | null = null;
    let interceptedError: unknown;
    let hasInterceptedError = false;
    const attempts = options.retries ?? this.retryAttempts;
    const canRetry = isRequestIdempotent({
      method: options.method,
      isIdempotent: options.isIdempotent,
      headers,
    });

    for (let attempt = 0; attempt < attempts; attempt++) {
      let release: (() => void) | undefined;
      try {
        release = await this.connectionPool.acquire();
        const startedAt = Date.now();
        this.logger('[DORISIO] request', {
          method: options.method,
          path,
          body: sanitize(options.body),
          headers: sanitize(headers),
          attempt: attempt + 1,
          requestId: options.requestId,
        });
        const response = await fetch(url, fetchOptions);
        options.onResponse?.(response);
        this.onResponse?.(response);
        this.log('[DORISIO] response', {
          method: options.method,
          path,
          status: response.status,
          elapsedMs: Date.now() - startedAt,
          attempt: attempt + 1,
          requestId: options.requestId,
        });

        if (!response.ok) {
          let error: Record<string, unknown> = {};
          try {
            const errorText = await response.text();
            error = errorText
              ? this.serializer.deserialize<Record<string, unknown>>(errorText)
              : {};
          } catch {
            // Fallback for mocks that only implement json()
            try {
              error =
                (await (response as { json?: () => Promise<Record<string, unknown>> }).json?.()) ??
                {};
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
          const errorCode = typeof error.code === 'string' ? error.code : undefined;
          throw new ApiError(
            String(error.error) || 'Request failed',
            response.status,
            errorCode,
            retryAfter,
            options.requestId
          );
        }

        let data: T;
        try {
          const text = await response.text();
          data = this.serializer.deserialize<T>(text);
        } catch {
          // Fallback for mocks that only implement json()
          data = (await (response as { json?: () => Promise<T> }).json?.()) ?? (undefined as T);
        }

        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (lastError instanceof DorisioError && !lastError.requestId && options.requestId) {
          lastError.requestId = options.requestId;
        }
        interceptedError = await this.interceptors.executeErrorInterceptors(lastError);
        hasInterceptedError = true;

        // Don't retry requests the caller cancelled (superseded hook
        // requests) — retrying an aborted fetch just burns attempts.
        if (
          options.signal?.aborted ||
          lastError.name === 'AbortError' ||
          (lastError as { code?: number }).code === 20
        ) {
          throw interceptedError;
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
          throw interceptedError;
        }

        // Never retry non-idempotent calls (avoids duplicate tips/charges)
        if (!canRetry) {
          throw interceptedError;
        }

        if (attempt < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      } finally {
        release?.();
      }
    }

    throw hasInterceptedError
      ? interceptedError
      : lastError ?? new Error('Request failed after retries');
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
   * Get the priority request queue instance if enabled
   */
  getPriorityQueue(): PriorityRequestQueue | undefined {
    return this.priorityQueue;
  }

  /**
   * Get a snapshot of priority request queue statistics
   */
  getQueueStats(): QueueStats | undefined {
    return this.priorityQueue?.getStats();
  }

  /**
   * Get offline queue instance if enabled
   */
  getOfflineQueue(): OfflineQueue | undefined {
    return this.offlineQueue;
  }

  /**
   * Get throttle manager instance if enabled
   */
  getThrottleManager(): ThrottleManager | undefined {
    return this.throttleManager;
  }

  /**
   * Get hook manager instance if set
   */
  getHookManager(): HookManager | undefined {
    return this.hookManager;
  }

  /**
   * Set hook manager
   */
  setHookManager(manager: HookManager): void {
    this.hookManager = manager;
  }

  /**
   * Set proxy configuration
   */
  setProxy(proxy: ProxyConfig): void {
    this.proxy = proxy;
  }

  /**
   * Get proxy configuration
   */
  getProxy(): ProxyConfig | undefined {
    return this.proxy;
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

  /**
   * Make a streaming HTTP request and return the body as a `ReadableStream`
   * of decoded text chunks (Issue #120).
   *
   * The response is **never buffered**: each network chunk is decoded with a
   * streaming `TextDecoder` (multi-byte characters spanning chunks are
   * stitched) and enqueued on the returned stream. Reading pauses and
   * resumes with the consumer — a slow reader naturally applies
   * backpressure — so memory stays O(chunkSize) regardless of export size.
   *
   * Works in Node.js >= 18 and modern browsers (global `ReadableStream`).
   *
   * @param path - Request path (query string included)
   * @param options - Streaming request options
   * @returns The stream plus transfer metadata and an abort handle
   */
  async requestTextStream(
    path: string,
    options: StreamRequestOptions = {}
  ): Promise<StreamedResponse> {
    const startTime = Date.now();
    const requestId =
      options.requestId ??
      (this.requestIdGenerator ? this.requestIdGenerator() : generateRequestId('stream'));
    const controller = new AbortController();

    // Streaming transfer state, shared by the fetch phase and the body-read
    // phase that follows it.
    let aborted = false;
    let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let activeController: ReadableStreamDefaultController<string> | undefined;

    const abortError = () => {
      const error = new Error('Streaming request aborted');
      error.name = 'AbortError';
      return error;
    };

    // Error the consumer-facing controller directly so caller aborts and
    // mid-stream failures reject pending reads rather than quietly closing.
    const fail = (error: unknown) => {
      if (!activeController) return;
      try {
        activeController.error(error);
      } catch {
        // already closed or errored — nothing left to do
      }
    };

    const onExternalAbort = () => {
      aborted = true;
      controller.abort();
      fail(abortError());
      void upstreamReader?.cancel().catch(() => undefined);
    };
    options.signal?.addEventListener('abort', onExternalAbort, { once: true });

    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...options.headers,
      'X-Request-Id': requestId,
    };

    const timeoutMs = options.timeout ?? this.timeout;
    const signal = controller.signal;

    // The timeout only covers time-to-headers. Once a response exists the
    // transfer is governed by the consumer and by the abort signal — keeping a
    // timer armed for the whole transfer would kill legitimate long exports.
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers,
        signal,
      });
    } catch (error) {
      clearTimeout(timeoutHandle);
      options.signal?.removeEventListener('abort', onExternalAbort);
      if (timedOut) {
        throw new TimeoutError(`Streaming request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }
    clearTimeout(timeoutHandle);

    this.onResponse?.(response);
    this.log('[DORISIO] stream response', {
      method: 'GET',
      path,
      status: response.status,
      requestId,
    });

    if (!response.ok) {
      options.signal?.removeEventListener('abort', onExternalAbort);
      let error: Record<string, unknown> = {};
      try {
        const text = await response.text();
        error = text ? this.serializer.deserialize<Record<string, unknown>>(text) : {};
      } catch {
        // ignore body parse failures — status is the primary signal
      }
      const errorCode = typeof error.code === 'string' ? error.code : undefined;
      throw new ApiError(
        String(error.error) || `Streaming request failed with status ${response.status}`,
        response.status,
        errorCode,
        undefined,
        requestId
      );
    }

    const body = response.body;
    if (!body) {
      options.signal?.removeEventListener('abort', onExternalAbort);
      throw new ApiError('Streaming is not supported by this runtime', 502, undefined, undefined, requestId);
    }

    const contentLength = response.headers?.get?.('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : undefined;
    const decoder = new TextDecoder();
    const highWaterMark = Math.max(1, options.highWaterMark ?? 4);

    let bytesReceived = 0;
    let chunksDelivered = 0;

    const detach = () => options.signal?.removeEventListener('abort', onExternalAbort);

    const stream = new ReadableStream<string>(
      {
        // Pull-driven: the body is read one chunk at a time, and only while
        // the consumer is asking for data, up to `highWaterMark` chunks ahead.
        // That is what keeps memory constant for arbitrarily large exports and
        // lets a slow consumer throttle the transfer instead of buffering it.
        async pull(controller) {
          activeController = controller;
          try {
            if (aborted) throw abortError();
            upstreamReader ??= body.getReader();
            const result = await upstreamReader.read();
            const chunk = result.value;
            if (aborted) throw abortError();

            if (result.done || !chunk) {
              const tail = decoder.decode();
              if (tail) controller.enqueue(tail);
              detach();
              controller.close();
              return;
            }

            bytesReceived += chunk.byteLength;
            chunksDelivered += 1;

            if (options.onProgress) {
              options.onProgress({
                bytesReceived,
                totalBytes,
                chunkSize: chunk.byteLength,
                percentComplete:
                  totalBytes && totalBytes > 0
                    ? Math.min(100, (bytesReceived / totalBytes) * 100)
                    : undefined,
              });
            }

            // `stream: true` holds an incomplete multi-byte sequence back until
            // the bytes that finish it arrive in a following chunk.
            const text = decoder.decode(chunk, { stream: true });
            if (text) controller.enqueue(text);
          } catch (error) {
            detach();
            // Rejecting pull() errors the readable stream, so a mid-stream
            // network failure surfaces on the consumer's pending read().
            throw error;
          }
        },
        async cancel(reason) {
          detach();
          aborted = true;
          await upstreamReader?.cancel(reason);
        },
      },
      { highWaterMark }
    );

    return {
      stream,
      stats: {
        get totalBytes() {
          return bytesReceived;
        },
        get chunks() {
          return chunksDelivered;
        },
        get durationMs() {
          return Date.now() - startTime;
        },
      },
      abort: onExternalAbort,
    };
  }

  /**
   * Make a streaming HTTP request
   *
   * Processes large responses in chunks to reduce memory usage.
   * Useful for large file downloads or streaming APIs.
   *
   * @param path - Request path
   * @param options - Request options with streaming configuration
   * @returns Promise resolving to stream result
   */
  async requestStreaming(
    path: string,
    options: RequestOptions & { streamOptions: StreamOptions }
  ): Promise<StreamResult> {
    if (!options.streamOptions) {
      throw new Error('streamOptions is required for streaming requests');
    }

    const methodName = options.methodName || 'requestStreaming';
    this.log(`${methodName}: ${options.method} ${path}`, { streaming: true });

    try {
      // Build full URL
      const url = `${this.baseUrl}${path}`;
      const headers = {
        ...this.defaultHeaders,
        ...options.headers,
      };

      // Make the actual fetch request
      const response = await fetch(url, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      });

      // Check if response is ok
      if (!response.ok) {
        throw new ApiError(
          `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          await response.text()
        );
      }

      // Determine if we should use streaming based on response size
      const shouldStream = options.streaming !== false && isLargeResponse(response);

      if (!shouldStream) {
        this.log(`${methodName}: Response below streaming threshold, using standard processing`);
      }

      // Process the streaming response
      const result = await this.streamHandler.processStream(response, options.streamOptions);

      this.log(`${methodName}: Streaming completed`, {
        totalBytes: result.totalBytes,
        chunksProcessed: result.chunksProcessed,
        durationMs: result.duration,
      });

      return result;
    } catch (error) {
      this.log(`${methodName}: Streaming failed`, { error: String(error) });
      throw error;
    }
  }

  /**
   * Make a traced HTTP request with OpenTelemetry support
   *
   * Wraps the standard request with distributed tracing spans.
   *
   * @param path - Request path
   * @param options - Request options
   * @returns Promise with traced response
   */
  async requestWithTracing<T>(path: string, options: RequestOptions): Promise<T> {
    const tracingProvider = getTracingProvider();
    const operationName = `${options.method} ${path}`;
    const span = tracingProvider.startSpan(operationName, {
      'http.method': options.method,
      'http.url': path,
      'span.kind': 'client',
    });

    try {
      const startTime = Date.now();
      const result = await this.request<T>(path, options);

      const duration = Date.now() - startTime;
      span.setAttributes({
        'http.response.body.size': JSON.stringify(result).length,
        'http.client.duration': duration,
        'span.status': 'success',
      });
      span.setStatus(SpanStatus.Ok);

      return result;
    } catch (error) {
      span.setStatus(SpanStatus.Error, error instanceof Error ? error.message : String(error));
      if (error instanceof Error) {
        span.recordException(error);
      }
      throw error;
    } finally {
      tracingProvider.endSpan(span);
    }
  }

  /**
   * Get tracing provider instance
   */
  getTracingProvider() {
    return getTracingProvider();
  }
}
