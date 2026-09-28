/**
 * DorisioClient
 *
 * Main client for interacting with Dorisio backend API.
 * Handles authentication, request/response formatting, custom HTTP headers,
 * batch processing with partial failure handling, request fingerprinting,
 * performance metrics, offline/request queue management, and sandbox/mock mode.
 */

import { HttpClient, RequestOptions, type HttpClientMode, type ProxyConfig } from './http/http-client';
import { FailoverManager, type EndpointConfig } from './http/failover-manager';
import { getConfig } from './config';
import { ApiResponse } from './types/api';
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
import {
  BatchProcessorOptions,
  BatchResult,
} from './http/batch-processor';
import {
  ErrorHandler,
  Middleware,
} from './types/errors';
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

export type ClientMode = 'sandbox' | 'live' | 'production';

export interface ClientConfig {
  baseUrl: string;
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
  /** Custom error handler for error recovery strategies */
  errorHandler?: ErrorHandler;
  /** Custom request ID generator for request fingerprinting */
  requestIdGenerator?: () => string;
  /** Enable request queue with concurrency control and automatic 429 backoff */
  enableRequestQueue?: boolean;
  /** Maximum concurrent requests in flight when request queue is enabled (default: 5) */
  maxConcurrentRequests?: number;
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
  private config: ClientConfig & { timeout: number; mode: 'live' | 'sandbox' };
  private httpClient: HttpClient;
  private token?: string;
  private mode: 'live' | 'sandbox';
  private errorHandler?: ErrorHandler;
  private middleware: Middleware[] = [];
  private apiVersionHandler: ApiVersionHandler;
  private errorReporter?: ErrorReporter;
  private hookManager: HookManager;

  constructor(config: ClientConfig) {
    const mode = normalizeClientMode(config.mode);

    this.config = {
      timeout: config.timeout || 30000,
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      token: config.token,
      mode,
      sandboxSeed: config.sandboxSeed,
      sandboxLatency: config.sandboxLatency,
      sandboxErrorRate: config.sandboxErrorRate,
      debug: config.debug,
      logger: config.logger,
      deduplicateRequests: config.deduplicateRequests,
      deduplicationWindow: config.deduplicationWindow,
      errorHandler: config.errorHandler,
      requestIdGenerator: config.requestIdGenerator,
      enableRequestQueue: config.enableRequestQueue,
      maxConcurrentRequests: config.maxConcurrentRequests,
      enableOfflineQueue: config.enableOfflineQueue,
      enableMetrics: config.enableMetrics,
      metricsCallback: config.metricsCallback,
      errorReporter: config.errorReporter,
      enableThrottling: config.enableThrottling,
      throttleMaxRequests: config.throttleMaxRequests,
      throttleWindowMs: config.throttleWindowMs,
      proxy: config.proxy,
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

    this.httpClient = new HttpClient(this.config.baseUrl, {
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
      errorHandler: this.errorHandler,
      requestIdGenerator: config.requestIdGenerator,
      enableRequestQueue: config.enableRequestQueue,
      maxConcurrentRequests: config.maxConcurrentRequests,
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
    this.exportTransactionHistory = historyMethods.exportTransactionHistory.bind(this);

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
  }

  /**
   * Clear authentication token
   */
  clearToken(): void {
    this.token = undefined;
    this.config.token = undefined;
    this.httpClient.removeHeader('Authorization');
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
    this.apiVersionHandler.checkEndpointDeprecation(path);

    const initialHeaders = options?.headers ? { ...options.headers } : {};
    const migrated = this.apiVersionHandler.migrateRequest({
      method,
      path,
      body,
      headers: initialHeaders,
    });

    const requestBody = migrated.body;
    const requestHeaders = migrated.headers;
    const requestPath = migrated.path;
    const requestMethod = (migrated.method || method) as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

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

    const res = await executeMiddleware(0);
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
   * Get currently active API version
   */
  on(event: OfflineEventType, listener: OfflineEventListener): void {
    const queue = this.httpClient.getOfflineQueue();
    if (queue) {
      queue.on(event, listener);
    }
  }

  /**
   * Unsubscribe from offline queue lifecycle events
   */
  off(event: OfflineEventType, listener: OfflineEventListener): void {
    const queue = this.httpClient.getOfflineQueue();
    if (queue) {
      queue.off(event, listener);
    }
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
  }

  /**
   * Get number of mutations waiting in offline queue
   */
  getOfflineQueueSize(): number {
    return this.httpClient.getOfflineQueueSize();
  }

  // ---------------------------------------------------------------------------
  // Creator methods
  // ---------------------------------------------------------------------------
  declare getCreator: (
    creatorId: string,
    options?: Partial<RequestOptions>
  ) => Promise<Creator>;
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
  declare disconnectWallet: (
    walletId: string,
    options?: Partial<RequestOptions>
  ) => Promise<void>;
  declare getWallets: (
    userId: string,
    options?: Partial<RequestOptions>
  ) => Promise<Wallet[]>;
  declare getWallet: (
    walletId: string,
    options?: Partial<RequestOptions>
  ) => Promise<Wallet>;
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
  declare exportTransactionHistory: (
    exportOptions?: {
      format?: 'csv' | 'json';
      startDate?: Date;
      endDate?: Date;
    },
    options?: Partial<RequestOptions>
  ) => Promise<string>;

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
  declare canPayout: (
    creatorId: string,
    options?: Partial<RequestOptions>
  ) => Promise<boolean>;
  declare getAccountSummary: (
    options?: Partial<RequestOptions>
  ) => Promise<{
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
  declare refreshSession: (
    options?: Partial<RequestOptions>
  ) => Promise<SessionInfo>;
  declare validateSession: (
    options?: Partial<RequestOptions>
  ) => Promise<User>;
  declare getCurrentUser: (
    options?: Partial<RequestOptions>
  ) => Promise<User>;
  declare logout: (
    options?: Partial<RequestOptions>
  ) => Promise<void>;
  declare isAuthenticated: (
    options?: Partial<RequestOptions>
  ) => Promise<boolean>;
  declare extendSession: (
    options?: Partial<RequestOptions>
  ) => Promise<SessionInfo>;
  declare getSessionExpiry: (
    options?: Partial<RequestOptions>
  ) => Promise<{
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
}
