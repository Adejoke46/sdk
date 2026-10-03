/**
 * DorisioClient
 *
 * Main client for interacting with Dorisio backend API.
 * Handles authentication, request/response formatting, custom HTTP headers,
 * batch processing with partial failure handling, request fingerprinting,
 * performance metrics, offline/request queue management, and sandbox/mock mode.
 */

import {
  HttpClient,
  RequestOptions,
  type HttpClientMode,
  type ProxyConfig,
} from './http/http-client';
import { FailoverManager, type EndpointConfig } from './http/failover-manager';
import { ResponseNormalizer } from './http/response-normalizer';
import { getConfig } from './config';
import { localizeError } from './i18n';
import { ApiResponse } from './types/api';
import { Analytics, type AnalyticsOptions, type AnalyticsSnapshot, type AnalyticsExportFormat, type AnalyticsListener } from './lib/analytics';
import {
  Creator,
  CreatorProfile,
  Transaction,
  TransactionHistory,
  TransactionStats,
  User,
  Wallet,
} from './types/models';
import { BalanceInfo, AccountBalance } from './client/balance';
import { SessionInfo } from './client/auth';
import { VerificationStatus } from './client/verification';
import {
  BuildTransactionRequest,
  BuildTransactionResponse,
  CreateTipRequest,
  SubmitTransactionRequest,
  SubmitTransactionResponse,
} from './client/transactions';
import type { SandboxHistoryEntry } from './sandbox/mock-router';
import * as creatorMethods from './client/creators';
import * as walletMethods from './client/wallets';
import * as transactionMethods from './client/transactions';
import * as historyMethods from './client/history';
import * as balanceMethods from './client/balance';
import * as verificationMethods from './client/verification';
import * as authMethods from './client/auth';
import { CreateWalletRequest, UpdateWalletRequest } from './types/models';
import * as batchMethods from './client/batch-operations';
import { Batcher } from './utils/batch';
import { GraphQLClient } from './graphql/graphql-client';
import { BatchProcessorOptions, BatchResult } from './http/batch-processor';
import { ErrorHandler, Middleware } from './types/errors';
import type { QueueConfig, QueueStats } from './types/queue';
import type { PriorityRequestQueue } from './queue/request-queue';
import { TelemetryClient, type TelemetryConfig } from './telemetry';
import { PluginSystem, type Plugin } from './lib/plugin-system';
import { Analytics } from './lib/analytics';
import { initializeTracing, getTracingProvider } from './lib/telemetry';
import type { MetricsCallback, MetricsSummary } from './lib/metrics';
import type { OfflineEventType, OfflineEventListener } from './http/offline-queue';
import {
  ApiVersionHandler,
  type DeprecationWarning,
  type DeprecatedEndpointConfig,
} from './http/api-version-handler';
import type { ErrorReporter } from './lib/error-reporter';
import { HookManager, type HookRegistration } from './lib/hooks';
import { ThrottleManager } from './http/throttle-manager';
import type { ValidationSchemas } from './types/validation';
import { OfflineManager } from './offline/sync';
import type {
  OfflineConfig,
  OfflineSyncEventType,
  OfflineSyncEventListener,
  SyncState,
  SyncResult,
  SyncOptions,
  StorageStats,
} from './types/offline';

export type ClientMode = 'sandbox' | 'live' | 'production';

export interface ClientConfig {
  baseUrl: string;
  /** Zod or Joi schemas for request bodies and API responses. */
  schemas?: ValidationSchemas;
  token?: string;
  timeout?: number;
  /**
   * `sandbox` — all requests return deterministic mocks (no network).
   * `live` / `production` — real HTTP calls.
   */
  mode?: ClientMode;
  /** Seed for deterministic sandbox responses (default 42) */
  sandboxSeed?: number;
  /** Simulated sandbox latency in ms (default 0) */
  sandboxLatency?: number;
  /** Sandbox random error rate 0–1 (default 0) */
  sandboxErrorRate?: number;
  /** Emit sanitized request/response diagnostics through the configured logger */
  debug?: boolean;
  logger?: (message: string, data?: unknown) => void;
  deduplicateRequests?: boolean;
  deduplicationWindow?: number;
  /** Optional response cache configuration. */
  cache?: CacheOptions;
  /** Custom error handler for error recovery strategies */
  errorHandler?: ErrorHandler;
  /** Custom request ID generator for request fingerprinting */
  requestIdGenerator?: () => string;
  /** Enable request queue with concurrency control and automatic 429 backoff */
  enableRequestQueue?: boolean;
  /** Maximum concurrent requests in flight when request queue is enabled (default: 5) */
  maxConcurrentRequests?: number;
  /**
   * Priority request queue configuration. When enabled, requests are queued
   * with bounded concurrency and served by priority. Individual requests opt
   * into a priority via their request options (e.g. `{ priority: 'high' }`).
   */
  queue?: QueueConfig;
  /** Enable offline mutation queue */
  enableOfflineQueue?: boolean;
  /** Enable performance metrics collection */
  enableMetrics?: boolean;
  /** Optional callback invoked whenever a request metric is recorded */
  metricsCallback?: MetricsCallback;
  /** Error reporter instance for automatic error reporting */
  errorReporter?: ErrorReporter;
  /** Enable request throttling */
  enableThrottling?: boolean;
  /** Max requests per throttling window */
  throttleMaxRequests?: number;
  /** Throttling window in ms */
  throttleWindowMs?: number;
  /** Proxy configuration for corporate environments */
  proxy?: ProxyConfig;
  /** Compress serialized request bodies above the configured threshold (default 1 KiB). */
  compress?: RequestCompressionConfig;
  /** Telemetry configuration for usage analytics */
  telemetry?: TelemetryConfig;
  /** Offline-first storage and sync configuration */
  offline?: OfflineConfig;
}

function normalizeClientMode(mode?: ClientMode): 'live' | 'sandbox' {
  if (mode === 'sandbox') return 'sandbox';
  return 'live';
}

/**
 * DorisioClient provides a full suite of payment, wallet, creator, and transaction tools.
 *
 * @example
 * ```ts
 * import { DorisioClient } from 'dorisio-sdk';
 *
 * const client = new DorisioClient({
 *   baseUrl: 'https://api.dorisio.com',
 *   token: 'user_jwt_token',
 * });
 *
 * const creator = await client.getCreator('creator-123', {
 *   headers: { 'X-Custom-Header': 'custom-value' },
 * });
 * console.log(creator.name);
 * ```
 */
export class DorisioClient {
  public readonly graphql: GraphQLClient;
  public readonly cache: CacheManager;
  private config: ClientConfig & { timeout: number; mode: 'live' | 'sandbox' };
  private httpClient: HttpClient;
  private token?: string;
  private mode: 'live' | 'sandbox';
  private errorHandler?: ErrorHandler;
  private middleware: Middleware[] = [];
  private apiVersionHandler: ApiVersionHandler;
  private errorReporter?: ErrorReporter;
  private hookManager: HookManager;
  private telemetryClient?: TelemetryClient;
  private pluginSystem: PluginSystem;
  private offlineManager?: OfflineManager;

  constructor(config: ClientConfig) {
    const mode = normalizeClientMode(config.mode);

    this.config = {
      timeout: config.timeout || 30000,
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      schemas: config.schemas,
      token: config.token,
      mode,
      sandboxSeed: config.sandboxSeed,
      sandboxLatency: config.sandboxLatency,
      sandboxErrorRate: config.sandboxErrorRate,
      debug: config.debug,
      logger: config.logger,
      deduplicateRequests: config.deduplicateRequests,
      deduplicationWindow: config.deduplicationWindow,
      cache: config.cache,
      errorHandler: config.errorHandler,
      requestIdGenerator: config.requestIdGenerator,
      enableRequestQueue: config.enableRequestQueue,
      maxConcurrentRequests: config.maxConcurrentRequests,
      queue: config.queue,
      enableOfflineQueue: config.enableOfflineQueue,
      enableMetrics: config.enableMetrics,
      metricsCallback: config.metricsCallback,
      errorReporter: config.errorReporter,
      enableThrottling: config.enableThrottling,
      throttleMaxRequests: config.throttleMaxRequests,
      throttleWindowMs: config.throttleWindowMs,
      proxy: config.proxy,
      compress: config.compress,
    };

    this.token = config.token;
    this.mode = mode;
    this.errorHandler = config.errorHandler;
    this.errorReporter = config.errorReporter;
    this.hookManager = new HookManager();

    this.apiVersionHandler =
      config.apiVersionHandler ||
      new ApiVersionHandler({
        currentVersion: config.apiVersion || 'v1',
        supportedVersions: config.supportedApiVersions,
        fallbackVersion: config.fallbackApiVersion,
        autoMigrate: config.autoMigrateApiVersion ?? true,
        deprecatedEndpoints: config.deprecatedEndpoints,
        onVersionChange: config.onApiVersionChange,
        onDeprecation: config.onApiDeprecation,
        logger: config.logger,
      });

    this.analytics = new Analytics(
      config.analytics === false ? { enabled: false } : config.analytics
    );

    if (config.requestSigning) {
      this.requestSigner = new RequestSigner(config.requestSigning);
    }

    this.httpClient = new HttpClient(this.config.baseUrl, {
      schemas: config.schemas,
      timeout: this.config.timeout,
      retryAttempts: getConfig().retryAttempts,
      mode,
      sandboxSeed: config.sandboxSeed,
      sandboxLatency: config.sandboxLatency,
      sandboxErrorRate: config.sandboxErrorRate,
      debug: config.debug,
      logger: config.logger,
      deduplicateRequests: config.deduplicateRequests,
      deduplicationWindow: config.deduplicationWindow,
      cache: config.cache,
      errorHandler: this.errorHandler,
      requestIdGenerator: config.requestIdGenerator,
      enableRequestQueue: config.enableRequestQueue,
      maxConcurrentRequests: config.maxConcurrentRequests,
      queue: config.queue,
      enableOfflineQueue: config.enableOfflineQueue,
      enableMetrics: config.enableMetrics,
      metricsCallback: config.metricsCallback,
      enableThrottling: config.enableThrottling,
      throttleMaxRequests: config.throttleMaxRequests,
      throttleWindowMs: config.throttleWindowMs,
      hookManager: this.hookManager,
      proxy: config.proxy,
      onResponse: (response: Response) => {
        this.apiVersionHandler.checkResponseHeaders(response.headers);
      },
    });
    this.cache = this.httpClient.getCacheManager();

    this.graphql = new GraphQLClient({
      baseUrl: this.config.baseUrl,
      token: config.token,
      mode,
    });

    if (this.token) {
      this.httpClient.setHeader('Authorization', `Bearer ${this.token}`);
    }

    // Initialize failover manager if multiple endpoints provided
    if (config.endpoints && config.endpoints.length > 0) {
      const allEndpoints = [config.baseUrl, ...config.endpoints];
      this.failoverManager = new FailoverManager({
        endpoints: allEndpoints,
        healthCheckInterval: config.healthCheckInterval,
      });
    }

    this.bindMethods();

    // A 401 on any API call renews the session once and replays the request,
    // instead of bouncing the user to a logged-out state on a stale token.
    this.httpClient.setTokenRefresher(async () => {
      await this.refreshSession();
    });

    // Initialize telemetry if configured
    if (config.telemetry && config.telemetry.enabled) {
      this.telemetryClient = new TelemetryClient(config.telemetry);
    }

    // Initialize plugin system
    this.pluginSystem = new PluginSystem();

    // Initialize offline manager if configured
    if (config.offline && config.offline.enabled) {
      const offlineManager = new OfflineManager({
        config: config.offline,
        requestExecutor: async (method, path, data, headers) => {
          return this.request(method as 'POST' | 'PUT' | 'PATCH' | 'DELETE', path, data, {
            headers,
          });
        },
        onlineStatusChecker: () => this.isOnline(),
      });
      this.offlineManager = offlineManager;

      // Initialize async - errors are emitted via events
      void offlineManager.initialize().catch((error) => {
        if (this.offlineManager === offlineManager) {
          this.offlineManager = undefined;
        }
        if (this.config.logger) {
          this.config.logger('[DorisioClient] Failed to initialize offline manager', error);
        }
      });
    }

    this.graphql = new GraphQLClient({
      baseUrl: this.config.baseUrl,
      endpoint: '/graphql',
      token: this.token,
      mode: this.mode,
      sandboxSeed: config.sandboxSeed,
    });
  }

  /**
   * Bind all client methods
   */
  private bindMethods(): void {
    this.getCreator = creatorMethods.getCreator.bind(this);
    this.listCreators = creatorMethods.listCreators.bind(this);
    this.getCreatorProfile = creatorMethods.getCreatorProfile.bind(this);
    this.verifyCreator = creatorMethods.verifyCreator.bind(this);

    this.connectWallet = walletMethods.connectWallet.bind(this);
    this.disconnectWallet = walletMethods.disconnectWallet.bind(this);
    this.getWallets = walletMethods.getWallets.bind(this);
    this.getWallet = walletMethods.getWallet.bind(this);
    this.updateWallet = walletMethods.updateWallet.bind(this);
    this.verifyWallet = verificationMethods.verifyWallet.bind(this);
    this.getWalletBalance = balanceMethods.getWalletBalance.bind(this);

    this.createTip = transactionMethods.createTip.bind(this);
    this.getTipStatus = transactionMethods.getTipStatus.bind(this);
    this.getTransactionHistory = transactionMethods.getTransactionHistory.bind(this);
    this.getCreatorTipsReceived = transactionMethods.getCreatorTipsReceived.bind(this);
    this.buildPaymentTransaction = transactionMethods.buildPaymentTransaction.bind(this);
    this.submitPaymentTransaction = transactionMethods.submitPaymentTransaction.bind(this);
    this.checkTransactionConfirmation = transactionMethods.checkTransactionConfirmation.bind(this);
    this.updateTipStatus = transactionMethods.updateTipStatus.bind(this);

    this.getFullTransactionHistory = historyMethods.getFullTransactionHistory.bind(this);
    this.getTransactionStats = historyMethods.getTransactionStats.bind(this);
    this.getCreatorEarnings = historyMethods.getCreatorEarnings.bind(this);
    // `bind` collapses an overloaded function to its last signature, so the
    // streaming overload is restored through an explicit cast.
    this.exportTransactionHistory = historyMethods.exportTransactionHistory.bind(
      this
    ) as unknown as DorisioClient['exportTransactionHistory'];
    this.exportTransactionHistoryStream = historyMethods.exportTransactionHistoryStream.bind(this);

    this.getBalance = balanceMethods.getBalance.bind(this);
    this.getCreatorPendingPayout = balanceMethods.getCreatorPendingPayout.bind(this);
    this.canPayout = balanceMethods.canPayout.bind(this);
    this.getAccountSummary = balanceMethods.getAccountSummary.bind(this);

    this.requestCreatorVerification = verificationMethods.requestCreatorVerification.bind(this);
    this.getCreatorVerificationStatus = verificationMethods.getCreatorVerificationStatus.bind(this);
    this.getWalletVerificationStatus = verificationMethods.getWalletVerificationStatus.bind(this);
    this.requestWalletVerificationChallenge =
      verificationMethods.requestWalletVerificationChallenge.bind(this);
    this.isTransactionVerified = verificationMethods.isTransactionVerified.bind(this);

    this.refreshSession = authMethods.refreshSession.bind(this);
    this.validateSession = authMethods.validateSession.bind(this);
    this.getCurrentUser = authMethods.getCurrentUser.bind(this);
    this.logout = authMethods.logout.bind(this);
    this.isAuthenticated = authMethods.isAuthenticated.bind(this);
    this.extendSession = authMethods.extendSession.bind(this);
    this.getSessionExpiry = authMethods.getSessionExpiry.bind(this);

    this.getCreators = batchMethods.getCreators.bind(this);
    this.getAllTransactionHistory = batchMethods.getAllTransactionHistory.bind(this);
    this.getAllWalletBalances = batchMethods.getAllWalletBalances.bind(this);
    this.getCreatorsBatch = batchMethods.getCreatorsBatch.bind(this);
    this.getWalletBalancesBatch = batchMethods.getWalletBalancesBatch.bind(this);
    this.createTipsBatch = batchMethods.createTipsBatch.bind(this);
    this.processBatchWithRetry = batchMethods.processBatchWithRetry.bind(this) as any;
    this.retryBatch = batchMethods.retryBatch.bind(this) as any;

    this.bindLocalizedMethods();
  }

  private bindLocalizedMethods(): void {
    const clientFields = this as unknown as Record<string, unknown>;

    for (const name of Object.keys(clientFields)) {
      const method = clientFields[name];
      if (typeof method !== 'function') continue;

      const boundMethod = method as (...args: unknown[]) => unknown;
      clientFields[name] = (...args: unknown[]) =>
        Promise.resolve()
          .then(() => boundMethod(...args))
          .catch((error: unknown) => {
            throw localizeError(error, this.config.i18n);
          });
    }
  }

  /**
   * Set authentication token
   *
   * @param token - Bearer JWT or API token
   */
  setToken(token: string): void {
    this.token = token;
    this.config.token = token;
    this.httpClient.setHeader('Authorization', `Bearer ${token}`);
    this.graphql.setToken(token);
  }

  addRequestInterceptor(interceptor: RequestInterceptor): InterceptorId {
    return this.httpClient.getInterceptors().addRequestInterceptor(interceptor);
  }

  removeRequestInterceptor(id: InterceptorId): boolean {
    return this.httpClient.getInterceptors().removeRequestInterceptor(id);
  }

  addResponseInterceptor(interceptor: ResponseInterceptor): InterceptorId {
    return this.httpClient.getInterceptors().addResponseInterceptor(interceptor);
  }

  removeResponseInterceptor(id: InterceptorId): boolean {
    return this.httpClient.getInterceptors().removeResponseInterceptor(id);
  }

  addErrorInterceptor(interceptor: ErrorInterceptor): InterceptorId {
    return this.httpClient.getInterceptors().addErrorInterceptor(interceptor);
  }

  removeErrorInterceptor(id: InterceptorId): boolean {
    return this.httpClient.getInterceptors().removeErrorInterceptor(id);
  }

  /**
   * Clear authentication token
   */
  clearToken(): void {
    this.token = undefined;
    this.config.token = undefined;
    this.httpClient.removeHeader('Authorization');
    this.graphql.clearToken();
  }

  /**
   * Make request to backend API (mocked automatically in sandbox mode)
   */
  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    options?: Partial<RequestOptions>
  ): Promise<ApiResponse<T>> {
    if (this.offlineManager && !this.offlineManager.isOnline() && method !== 'GET') {
      return this.offlineManager.queueOperationAndWait({
        type: 'custom',
        method,
        path,
        data: body as Record<string, unknown> | undefined,
        headers: options?.headers,
        idempotencyKey: options?.headers?.['Idempotency-Key'],
        metadata: { clientTimestamp: Date.now() },
      }) as Promise<ApiResponse<T>>;
    }

    this.apiVersionHandler.checkEndpointDeprecation(path);
    const startedAt = Date.now();

    const initialHeaders = options?.headers ? { ...options.headers } : {};
    const migrated = this.apiVersionHandler.migrateRequest({
      method,
      path,
      body,
      headers: initialHeaders,
    });

    const requestBody = migrated.body;
    const requestPath = migrated.path;
    const requestMethod = (migrated.method || method) as
      'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

    // Sign the outgoing request when a signing secret is configured: the
    // signature covers the final method/path/body the transport will send.
    const requestHeaders = this.requestSigner
      ? this.requestSigner.signRequest(requestMethod, requestPath, migrated.headers ?? {}, requestBody)
      : migrated.headers;

    const mergedOptions: Partial<RequestOptions> = {
      ...options,
      headers: requestHeaders,
      onResponse: (response: Response) => {
        this.apiVersionHandler.checkResponseHeaders(response.headers, requestPath);
        options?.onResponse?.(response);
      },
    };

    // Execute middleware chain for request transformation
    const executeMiddleware = async (index: number): Promise<ApiResponse<T>> => {
      if (index >= this.middleware.length) {
        // All middleware executed, make the actual request
        return this.httpClient.request<ApiResponse<T>>(requestPath, {
          method: requestMethod,
          body: requestBody as Record<string, unknown>,
          headers: requestHeaders,
          ...mergedOptions,
        });
      }

      const middleware = this.middleware[index];
      if (!middleware) {
        return this.httpClient.request<ApiResponse<T>>(requestPath, {
          method: requestMethod,
          body: requestBody as Record<string, unknown>,
          headers: requestHeaders,
          ...mergedOptions,
        });
      }

      const result = await middleware(
        {
          method: requestMethod,
          path: requestPath,
          body: requestBody,
          headers: requestHeaders,
          requestId: options?.requestId,
        },
        () => executeMiddleware(index + 1)
      );

      return result as ApiResponse<T>;
    };

    const res = ResponseNormalizer.normalize<T>(await executeMiddleware(0));
    return this.apiVersionHandler.migrateResponse(
      res,
      this.apiVersionHandler.getCurrentVersion(),
      this.apiVersionHandler.getCurrentVersion(),
      { path: requestPath, method: requestMethod }
    );
  }

  private async executeWithFailover<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
    options?: Partial<RequestOptions>
  ): Promise<ApiResponse<T>> {
    if (!this.failoverManager) {
      return this.httpClient.request<ApiResponse<T>>(path, {
        method,
        body: body as Record<string, unknown>,
        headers,
        ...options,
      });
    }

    let lastError: Error | undefined;
    const endpoints = this.failoverManager.getEndpoints().map((e) => e.url);

    for (const endpointUrl of endpoints) {
      try {
        // Create a temporary httpClient pointed at this endpoint
        const tempClient = new HttpClient(endpointUrl, {
          schemas: this.config.schemas,
          timeout: this.config.timeout,
          retryAttempts: getConfig().retryAttempts,
          mode: this.mode,
        });
        if (this.token) {
          tempClient.setHeader('Authorization', `Bearer ${this.token}`);
        }
        const result = await tempClient.request<ApiResponse<T>>(path, {
          method,
          body: body as Record<string, unknown>,
          headers,
          ...options,
        });
        this.failoverManager.recordSuccess(endpointUrl);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.failoverManager.recordFailure(endpointUrl);
        if (endpointUrl === endpoints[endpoints.length - 1]) break;
      }
    }
    throw lastError ?? new Error('All endpoints failed');
  }

  /**
   * Get HTTP client instance (for advanced usage)
   */
  getHttpClient(): HttpClient {
    return this.httpClient;
  }

  /**
   * Get current config
   */
  getConfig(): Readonly<ClientConfig & { timeout: number; mode: 'live' | 'sandbox' }> {
    return { ...this.config };
  }

  /**
   * Start real-time sync over WebSocket.
   *
   * Uses `options` when given, otherwise `ClientConfig.websocket`. The client
   * token is passed to the socket unless the options already carry one, and the
   * returned {@link WebSocketClient} is reused by `subscribeRealtime()`.
   */
  async enableRealtime(options?: WebSocketClientOptions): Promise<WebSocketClient> {
    const resolved =
      options ?? (this.config.websocket === false ? undefined : this.config.websocket);
    if (!resolved || typeof resolved.url !== 'string' || resolved.url.length === 0) {
      throw new Error(
        'enableRealtime() requires a WebSocket url (pass one, or set ClientConfig.websocket)'
      );
    }

    if (this.realtime) this.disableRealtime();

    this.realtime = new WebSocketClient({ token: this.token, ...resolved });
    await this.realtime.connect();
    return this.realtime;
  }

  /** The real-time client, or `null` when real-time is not enabled. */
  getRealtime(): WebSocketClient | null {
    return this.realtime;
  }

  /** Current real-time state, or `disabled` when not enabled. */
  getRealtimeState(): WebSocketState | 'disabled' {
    return this.realtime ? this.realtime.getState() : 'disabled';
  }

  /**
   * Subscribe to a real-time channel. Requires {@link enableRealtime} (or a
   * `ClientConfig.websocket`) first. Returns an unsubscribe function.
   */
  subscribeRealtime<T = unknown>(
    channel: string,
    listener: RealtimeListener<T>,
    params?: Record<string, unknown>
  ): () => void {
    if (!this.realtime) {
      throw new Error(
        'Realtime is not enabled: call await enableRealtime() (or set ClientConfig.websocket) first'
      );
    }
    return this.realtime.subscribe(channel, listener, params);
  }

  /** Close the real-time connection and drop the client. */
  disableRealtime(): void {
    if (!this.realtime) return;
    this.realtime.disconnect();
    this.realtime = null;
  }

  /**
   * Get current mode (live or sandbox)
   */
  getMode(): 'live' | 'sandbox' {
    return this.mode;
  }

  /**
   * Toggle sandbox/live without recreating the client
   */
  setMode(mode: ClientMode): void {
    this.mode = normalizeClientMode(mode);
    this.config.mode = this.mode;
    this.httpClient.setMode(mode as HttpClientMode);
    this.graphql.setMode(this.mode);
  }

  /**
   * Check if in sandbox mode
   */
  isSandboxMode(): boolean {
    return this.mode === 'sandbox';
  }

  /**
   * Sandbox request history for debugging / test assertions
   */
  getSandboxHistory(): readonly SandboxHistoryEntry[] {
    return this.httpClient.getSandboxHistory();
  }

  /**
   * Clear recorded sandbox history
   */
  clearSandboxHistory(): void {
    this.httpClient.clearSandboxHistory();
  }

  /**
   * Configure sandbox latency / seed / error rate at runtime
   */
  configureSandbox(options: { seed?: number; latency?: number; errorRate?: number }): void {
    this.httpClient.configureSandbox(options);
  }

  /**
   * Register a custom error handler for error recovery strategies
   */
  onError(handler: ErrorHandler): void {
    this.errorHandler = handler;
    this.httpClient.setErrorHandler(handler);
  }

  /**
   * Register middleware for request/response transformation
   */
  use(middleware: Middleware): void {
    this.middleware.push(middleware);
  }

  /**
   * Register a lifecycle hook for deep request/response customization
   */
  registerHook(hook: HookRegistration): void {
    this.hookManager.register(hook);
  }

  /**
   * Unregister a lifecycle hook by name
   */
  unregisterHook(name: string): void {
    this.hookManager.unregister(name);
  }

  /**
   * Get the hook manager instance
   */
  getHookManager(): HookManager {
    return this.hookManager;
  }

  /**
   * Set error reporter for automatic error reporting
   */
  setErrorReporter(reporter: ErrorReporter): void {
    this.errorReporter = reporter;
  }

  /**
   * Get error reporter instance
   */
  getErrorReporter(): ErrorReporter | undefined {
    return this.errorReporter;
  }

  /**
   * Get throttle manager instance if enabled
   */
  getThrottleManager(): ThrottleManager | undefined {
    return this.httpClient.getThrottleManager();
  }

  /**
   * Get the priority request queue instance if enabled
   */
  getPriorityQueue(): PriorityRequestQueue | undefined {
    return this.httpClient.getPriorityQueue();
  }

  /**
   * Get a snapshot of priority request queue statistics, or `undefined` when
   * the queue is not enabled.
   */
  getQueueStats(): QueueStats | undefined {
    return this.httpClient.getQueueStats();
  }

  /**
   * Set proxy configuration
   */
  setProxy(proxy: ProxyConfig): void {
    this.config.proxy = proxy;
    this.httpClient.setProxy(proxy);
  }

  /**
   * Get current proxy configuration
   */
  getProxy(): ProxyConfig | undefined {
    return this.httpClient.getProxy();
  }

  /**
   * Subscribe to offline queue lifecycle events (legacy offline queue)
   */
  on(event: OfflineEventType, listener: OfflineEventListener): void;
  /**
   * Subscribe to offline sync events (new offline-first storage)
   */
  on(event: OfflineSyncEventType, listener: OfflineSyncEventListener<any>): void;
  on(event: OfflineEventType | OfflineSyncEventType, listener: any): void {
    // Try new offline manager first
    if (this.offlineManager && this.isOfflineSyncEvent(event)) {
      this.offlineManager.on(event as OfflineSyncEventType, listener);
      return;
    }

    // Fallback to legacy offline queue
    const queue = this.httpClient.getOfflineQueue();
    if (queue) {
      queue.on(event as OfflineEventType, listener);
    }
  }

  /**
   * Unsubscribe from offline queue lifecycle events (legacy offline queue)
   */
  off(event: OfflineEventType, listener: OfflineEventListener): void;
  /**
   * Unsubscribe from offline sync events (new offline-first storage)
   */
  off(event: OfflineSyncEventType, listener: OfflineSyncEventListener<any>): void;
  off(event: OfflineEventType | OfflineSyncEventType, listener: any): void {
    // Try new offline manager first
    if (this.offlineManager && this.isOfflineSyncEvent(event)) {
      this.offlineManager.off(event as OfflineSyncEventType, listener);
      return;
    }

    // Fallback to legacy offline queue
    const queue = this.httpClient.getOfflineQueue();
    if (queue) {
      queue.off(event as OfflineEventType, listener);
    }
  }

  /**
   * Check if an event is an offline sync event (vs legacy offline queue event)
   */
  private isOfflineSyncEvent(event: string): boolean {
    return (
      event.startsWith('sync:') || event.startsWith('storage:') || event.startsWith('operation:')
    );
  }

  /**
   * Get collected performance metrics summary
   */
  getMetrics(): MetricsSummary {
    return this.httpClient.getMetrics();
  }

  /**
   * Get metrics collector instance
   */
  getMetricsCollector(): MetricsCollector {
    return this.httpClient.getMetricsCollector();
  }

  /**
   * Check if client is currently in online state
   */
  isOnline(): boolean {
    return this.httpClient.isOnline();
  }

  /**
   * Set client online state (triggers queued mutation replay when returning to online)
   */
  setOnline(online: boolean): void {
    this.httpClient.setOnline(online);
    this.offlineManager?.setOnline(online);
  }

  /**
   * Get number of mutations waiting in offline queue
   */
  getOfflineQueueSize(): number {
    return this.httpClient.getOfflineQueueSize();
  }

  /**
   * Get offline sync state (new offline-first storage)
   */
  async getOfflineSyncState(): Promise<SyncState | null> {
    if (!this.offlineManager) {
      return null;
    }
    return this.offlineManager.getSyncState();
  }

  /**
   * Manually trigger offline sync (new offline-first storage)
   */
  async syncOfflineOperations(options?: SyncOptions): Promise<SyncResult | null> {
    if (!this.offlineManager) {
      return null;
    }
    return this.offlineManager.sync(options);
  }

  /**
   * Get offline storage statistics (new offline-first storage)
   */
  async getOfflineStats(): Promise<StorageStats | null> {
    if (!this.offlineManager) {
      return null;
    }
    return this.offlineManager.getStats();
  }

  /**
   * Retry all failed offline operations (new offline-first storage)
   */
  async retryFailedOfflineOperations(): Promise<SyncResult | null> {
    if (!this.offlineManager) {
      return null;
    }
    return this.offlineManager.retryFailed();
  }

  /**
   * Clear all offline operations (use with caution)
   */
  async clearOfflineStorage(): Promise<void> {
    if (this.offlineManager) {
      await this.offlineManager.clearAll();
    }
  }

  /**
   * Check if offline-first mode is enabled
   */
  isOfflineModeEnabled(): boolean {
    return this.offlineManager !== undefined;
  }

  // ---------------------------------------------------------------------------
  // Creator methods
  // ---------------------------------------------------------------------------
  declare getCreator: (creatorId: string, options?: Partial<RequestOptions>) => Promise<Creator>;
  declare listCreators: (
    queryOptions?: {
      page?: number;
      pageSize?: number;
      verified?: boolean;
    },
    options?: Partial<RequestOptions>
  ) => Promise<{ creators: Creator[]; total: number; page: number; pageSize: number }>;
  declare getCreatorProfile: (
    username: string,
    options?: Partial<RequestOptions>
  ) => Promise<CreatorProfile>;
  declare verifyCreator: (
    creatorId: string,
    verified: boolean,
    options?: Partial<RequestOptions>
  ) => Promise<Creator>;

  // ---------------------------------------------------------------------------
  // Wallet methods
  // ---------------------------------------------------------------------------
  declare connectWallet: (
    data: CreateWalletRequest,
    options?: Partial<RequestOptions>
  ) => Promise<Wallet>;
  declare disconnectWallet: (walletId: string, options?: Partial<RequestOptions>) => Promise<void>;
  declare getWallets: (userId: string, options?: Partial<RequestOptions>) => Promise<Wallet[]>;
  declare getWallet: (walletId: string, options?: Partial<RequestOptions>) => Promise<Wallet>;
  declare updateWallet: (
    walletId: string,
    data: UpdateWalletRequest,
    options?: Partial<RequestOptions>
  ) => Promise<Wallet>;
  declare verifyWallet: (
    walletId: string,
    proof?: string,
    options?: Partial<RequestOptions>
  ) => Promise<Wallet>;
  declare getWalletBalance: (
    walletId: string,
    options?: Partial<RequestOptions>
  ) => Promise<BalanceInfo>;

  // ---------------------------------------------------------------------------
  // Transaction methods
  // ---------------------------------------------------------------------------
  declare createTip: (
    data: CreateTipRequest,
    options?: Partial<RequestOptions>
  ) => Promise<Transaction>;
  declare getTipStatus: (
    transactionId: string,
    options?: Partial<RequestOptions>
  ) => Promise<Transaction>;
  declare getTransactionHistory: (
    queryOptions?: {
      page?: number;
      pageSize?: number;
    },
    options?: Partial<RequestOptions>
  ) => Promise<TransactionHistory>;
  declare getCreatorTipsReceived: (
    creatorId: string,
    queryOptions?: { page?: number; pageSize?: number },
    options?: Partial<RequestOptions>
  ) => Promise<TransactionHistory>;
  declare buildPaymentTransaction: (
    tipId: string,
    data: BuildTransactionRequest,
    options?: Partial<RequestOptions>
  ) => Promise<BuildTransactionResponse>;
  declare submitPaymentTransaction: (
    tipId: string,
    data: SubmitTransactionRequest,
    options?: Partial<RequestOptions>
  ) => Promise<SubmitTransactionResponse>;
  declare checkTransactionConfirmation: (
    tipId: string,
    options?: Partial<RequestOptions>
  ) => Promise<Transaction>;
  declare updateTipStatus: (
    tipId: string,
    status: 'pending' | 'completed' | 'failed' | 'cancelled',
    options?: Partial<RequestOptions>
  ) => Promise<Transaction>;

  // ---------------------------------------------------------------------------
  // History methods
  // ---------------------------------------------------------------------------
  declare getFullTransactionHistory: (
    queryOptions?: {
      page?: number;
      pageSize?: number;
      startDate?: Date;
      endDate?: Date;
      status?: 'pending' | 'confirmed' | 'failed';
    },
    options?: Partial<RequestOptions>
  ) => Promise<TransactionHistory>;
  declare getTransactionStats: (
    userId?: string,
    options?: Partial<RequestOptions>
  ) => Promise<TransactionStats>;
  declare getCreatorEarnings: (
    creatorId: string,
    options?: Partial<RequestOptions>
  ) => Promise<{
    totalEarnings: number;
    pendingBalance: number;
    confirmedBalance: number;
    transactionCount: number;
  }>;
  declare exportTransactionHistory: {
    (
      exportOptions: historyMethods.TransactionExportOptions & { stream: true },
      streamOptions?: StreamRequestOptions
    ): Promise<StreamedResponse>;
    (
      exportOptions?: historyMethods.TransactionExportOptions,
      options?: Partial<RequestOptions>
    ): Promise<string>;
  };
  declare exportTransactionHistoryStream: (
    exportOptions?: historyMethods.TransactionExportOptions,
    streamOptions?: StreamRequestOptions
  ) => Promise<StreamedResponse>;

  // ---------------------------------------------------------------------------
  // Balance methods
  // ---------------------------------------------------------------------------
  declare getBalance: (
    userId: string,
    options?: Partial<RequestOptions>
  ) => Promise<AccountBalance>;
  declare getCreatorPendingPayout: (
    creatorId: string,
    options?: Partial<RequestOptions>
  ) => Promise<{
    pending: number;
    nextPayoutDate?: string;
    minimumThreshold: number;
  }>;
  declare canPayout: (creatorId: string, options?: Partial<RequestOptions>) => Promise<boolean>;
  declare getAccountSummary: (options?: Partial<RequestOptions>) => Promise<{
    userId: string;
    email: string;
    role: string;
    balance: AccountBalance;
    totalTipsSent?: number;
    totalEarnings?: number;
    lastActivityDate?: string;
  }>;

  // ---------------------------------------------------------------------------
  // Verification methods
  // ---------------------------------------------------------------------------
  declare requestCreatorVerification: (
    creatorId: string,
    data: { documentType: string; documentUrl?: string; description?: string },
    options?: Partial<RequestOptions>
  ) => Promise<VerificationStatus>;
  declare getCreatorVerificationStatus: (
    creatorId: string,
    options?: Partial<RequestOptions>
  ) => Promise<VerificationStatus & { status: string }>;
  declare getWalletVerificationStatus: (
    walletId: string,
    options?: Partial<RequestOptions>
  ) => Promise<VerificationStatus>;
  declare requestWalletVerificationChallenge: (
    walletId: string,
    options?: Partial<RequestOptions>
  ) => Promise<{ challenge: string; expiresIn: number }>;
  declare isTransactionVerified: (
    transactionId: string,
    options?: Partial<RequestOptions>
  ) => Promise<boolean>;

  // ---------------------------------------------------------------------------
  // Auth methods
  // ---------------------------------------------------------------------------
  declare refreshSession: (options?: Partial<RequestOptions>) => Promise<SessionInfo>;
  declare validateSession: (options?: Partial<RequestOptions>) => Promise<User>;
  declare getCurrentUser: (options?: Partial<RequestOptions>) => Promise<User>;
  declare logout: (options?: Partial<RequestOptions>) => Promise<void>;
  declare isAuthenticated: (options?: Partial<RequestOptions>) => Promise<boolean>;
  declare extendSession: (options?: Partial<RequestOptions>) => Promise<SessionInfo>;
  declare getSessionExpiry: (options?: Partial<RequestOptions>) => Promise<{
    expiresAt: string;
    expiresIn: number;
    isExpired: boolean;
  }>;

  // ---------------------------------------------------------------------------
  // Batch operations
  // ---------------------------------------------------------------------------
  declare getCreators: (
    creatorIds: string[],
    concurrency?: number,
    options?: Partial<RequestOptions>
  ) => Promise<Creator[]>;
  declare getAllTransactionHistory: (
    pageSize?: number,
    options?: Partial<RequestOptions>
  ) => Promise<TransactionHistory>;
  declare getAllWalletBalances: (
    walletIds: string[],
    concurrency?: number,
    options?: Partial<RequestOptions>
  ) => Promise<BalanceInfo[]>;
  declare getCreatorsBatch: (
    creatorIds: string[],
    options?: BatchProcessorOptions
  ) => Promise<BatchResult<string, Creator>>;
  declare getWalletBalancesBatch: (
    walletIds: string[],
    options?: BatchProcessorOptions
  ) => Promise<BatchResult<string, BalanceInfo>>;
  declare createTipsBatch: (
    tips: CreateTipRequest[],
    options?: BatchProcessorOptions
  ) => Promise<BatchResult<CreateTipRequest, Transaction>>;
  declare processBatchWithRetry: <T, R>(
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    options?: BatchProcessorOptions
  ) => Promise<BatchResult<T, R>>;
  declare retryBatch: <T, R>(
    batchResult: BatchResult<T, R>,
    fn: (item: T, index: number) => Promise<R>,
    options?: BatchProcessorOptions
  ) => Promise<BatchResult<T, R>>;

  batch<T = unknown>(): Batcher<T> {
    return new Batcher<T>();
  }

  // ---------------------------------------------------------------------------

  // Telemetry methods
  // ---------------------------------------------------------------------------


  /**
   * Get telemetry client instance
   */
  getTelemetryClient(): TelemetryClient | undefined {
    return this.telemetryClient;
  }

  /**
   * Enable telemetry collection
   */
  enableTelemetry(): void {
    if (this.telemetryClient) {
      this.telemetryClient.enable();
    }
  }

  /**
   * Disable telemetry collection
   */
  disableTelemetry(): void {
    if (this.telemetryClient) {
      this.telemetryClient.disable();
    }
  }

  /**
   * Flush pending telemetry events
   */
  async flushTelemetry(): Promise<void> {
    if (this.telemetryClient) {
      await this.telemetryClient.flush();
    }
  }

  /**
   * Shutdown telemetry client
   */
  async shutdownTelemetry(): Promise<void> {
    if (this.telemetryClient) {
      await this.telemetryClient.shutdown();
    }
  }

  // ---------------------------------------------------------------------------
  // Plugin system methods
  // ---------------------------------------------------------------------------

  /**
   * Install a plugin
   */
  async installPlugin(plugin: Plugin): Promise<void> {
    await this.pluginSystem.install(plugin);
  }

  /**
   * Uninstall a plugin
   */
  async uninstallPlugin(pluginName: string): Promise<void> {
    await this.pluginSystem.uninstall(pluginName);
  }

  /**
   * Get installed plugin by name
   */
  getPlugin(name: string): Plugin | undefined {
    return this.pluginSystem.getPlugin(name);
  }

  /**
   * Get all installed plugins
   */
  getPlugins(): Plugin[] {
    return this.pluginSystem.getPlugins();
  }

  /**
   * Check if plugin is installed
   */
  isPluginInstalled(name: string): boolean {
    return this.pluginSystem.isPluginInstalled(name);
  }

  /**
   * Get plugin system instance for advanced operations
   */
  getPluginSystem(): PluginSystem {
    return this.pluginSystem;
  }

  // ---------------------------------------------------------------------------
  // Distributed Tracing methods
  // ---------------------------------------------------------------------------

  /**
   * Initialize OpenTelemetry tracer provider for distributed tracing
   *
   * @param tracerProvider - OpenTelemetry TracerProvider instance
   */
  initializeDistributedTracing(tracerProvider: any): void {
    initializeTracing(tracerProvider);
    this.log('Distributed tracing initialized', { tracerProvider: 'OpenTelemetry' });
  }

  /**
   * Get tracing provider instance
   *
   * @returns Distributed tracing provider
   */
  getTracingProvider() {
    return getTracingProvider();
  }

  /**
   * Stream any GET endpoint as decoded text chunks without buffering the
   * response in memory. Chunks arrive as the server sends them; reading
   * applies backpressure so memory stays constant regardless of size.
   *
   * @param path - Request path including query string
   * @param options - Streaming options (signal, progress, highWaterMark)
   * @returns A live `ReadableStream<string>` plus transfer stats and abort
   *
   * @example
   * ```ts
   * const { stream } = await client.streamText('/transactions/export?format=csv&stream=true');
 *   const reader = stream.getReader();
 *   for (;;) {
 *     const { done, value } = await reader.read();
 *     if (done) break;
 *     processChunk(value);
 *   }
 *   ```
   */
  streamText(path: string, options?: StreamRequestOptions): Promise<StreamedResponse> {
    return this.httpClient.requestTextStream(path, options);
  }

  /**
   * Get the API version handler instance (for registering migrations)
   */
  getApiVersionHandler(): ApiVersionHandler {
    return this.apiVersionHandler;
  }

  /** Get the currently active API version. */
  getApiVersion(): string {
    return this.apiVersionHandler.getCurrentVersion();
  }

  /** Switch the active API version (e.g. after a migration decision). */
  setApiVersion(version: string): void {
    this.apiVersionHandler.setCurrentVersion(version);
  }

  /** Set or replace the request signing configuration. */
  setRequestSigning(options: RequestSignerOptions): void {
    this.requestSigner = new RequestSigner(options);
  }

  /** Get the analytics collector instance. */
  getAnalytics(): Analytics {
    return this.analytics;
  }

  /** Aggregated per-operation analytics snapshot. */
  getAnalyticsSnapshot(): AnalyticsSnapshot {
    return this.analytics.getSnapshot();
  }

  /** Export collected analytics as JSON (`'json'`) or CSV (`'csv'`). */
  exportAnalytics(format: AnalyticsExportFormat = 'json'): string {
    return this.analytics.exportMetrics(format);
  }

  /** Subscribe to analytics events; returns an unsubscribe function. */
  onAnalyticsEvent(listener: AnalyticsListener): () => void {
    return this.analytics.subscribe(listener);
  }

  /**
   * Emit a debug diagnostic through the configured logger (no-op unless `debug` is set).
   */
  private log(message: string, data?: unknown): void {
    if (this.config.debug && this.config.logger) {
      this.config.logger(message, data);
    }
  }

  /**
   * Make a traced HTTP request
   *
   * @param path - Request path
   * @param options - Request options
   * @returns Promise with traced response
   */
  async requestWithTracing<T>(path: string, options: Partial<RequestOptions> = {}): Promise<T> {
    return this.httpClient.requestWithTracing<T>(path, {
      method: 'GET',
      ...options,
    } as RequestOptions);
  }
}
