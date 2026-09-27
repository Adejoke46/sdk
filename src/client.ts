/**
 * DorisioClient
 *
 * Main client for interacting with Dorisio backend API.
 * Handles authentication, request/response handling, and error management.
 * Supports sandbox/mock mode for offline testing without network calls.
 */

import { HttpClient, RequestOptions, type HttpClientMode } from './http/http-client';
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
  debug?: boolean;
  logger?: (message: string, data?: unknown) => void;
  deduplicateRequests?: boolean;
  deduplicationWindow?: number;
  /** Custom error handler for error recovery strategies */
  errorHandler?: ErrorHandler;
  /** Target or default API version (e.g. 'v1', 'v2') */
  apiVersion?: string;
  /** Supported API versions for validation and fallback */
  supportedApiVersions?: string[];
  /** Fallback API version when an unsupported version is encountered */
  fallbackApiVersion?: string;
  /** Automatically migrate requests/responses across versions (default true) */
  autoMigrateApiVersion?: boolean;
  /** Pre-configured deprecated endpoints */
  deprecatedEndpoints?: DeprecatedEndpointConfig[];
  /** Custom ApiVersionHandler instance */
  apiVersionHandler?: ApiVersionHandler;
  /** Callback invoked when a version change is detected from response headers */
  onApiVersionChange?: (oldVersion: string, newVersion: string) => void;
  /** Callback invoked when a deprecated endpoint is accessed or deprecation header received */
  onApiDeprecation?: (warning: DeprecationWarning) => void;
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
}

function normalizeClientMode(mode?: ClientMode): 'live' | 'sandbox' {
  if (mode === 'sandbox') return 'sandbox';
  return 'live';
}

export class DorisioClient {
  private config: ClientConfig & { timeout: number; mode: 'live' | 'sandbox' };
  private httpClient: HttpClient;
  private token?: string;
  private mode: 'live' | 'sandbox';
  private errorHandler?: ErrorHandler;
  private middleware: Middleware[] = [];
  private apiVersionHandler: ApiVersionHandler;

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
      apiVersion: config.apiVersion,
      supportedApiVersions: config.supportedApiVersions,
      fallbackApiVersion: config.fallbackApiVersion,
      autoMigrateApiVersion: config.autoMigrateApiVersion,
      deprecatedEndpoints: config.deprecatedEndpoints,
      apiVersionHandler: config.apiVersionHandler,
      onApiVersionChange: config.onApiVersionChange,
      onApiDeprecation: config.onApiDeprecation,
      enableRequestQueue: config.enableRequestQueue,
      maxConcurrentRequests: config.maxConcurrentRequests,
      enableOfflineQueue: config.enableOfflineQueue,
      enableMetrics: config.enableMetrics,
      metricsCallback: config.metricsCallback,
    };

    this.token = config.token;
    this.mode = mode;
    this.errorHandler = config.errorHandler;

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
      enableRequestQueue: config.enableRequestQueue,
      maxConcurrentRequests: config.maxConcurrentRequests,
      enableOfflineQueue: config.enableOfflineQueue,
      enableMetrics: config.enableMetrics,
      metricsCallback: config.metricsCallback,
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
    this.verifyCreator = verificationMethods.verifyCreator.bind(this);

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
  }

  /**
   * Set authentication token
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
   * Get currently active API version
   */
  getApiVersion(): string {
    return this.apiVersionHandler.getCurrentVersion();
  }

  /**
   * Set active API version
   */
  setApiVersion(version: string): void {
    this.apiVersionHandler.setCurrentVersion(version);
  }

  /**
   * Get API version handler instance
   */
  getApiVersionHandler(): ApiVersionHandler {
    return this.apiVersionHandler;
  }

  /**
   * Detect API version from headers
   */
  detectApiVersion(
    headers?: Record<string, string | string[] | undefined> | Headers
  ): string | undefined {
    return this.apiVersionHandler.detectVersionFromHeaders(headers);
  }

  /**
   * Get performance metrics summary
   */
  getMetrics(): MetricsSummary {
    return this.httpClient.getMetrics();
  }

  /**
   * Check if client considers itself online
   */
  isOnline(): boolean {
    return this.httpClient.isOnline();
  }

  /**
   * Set online status (triggers offline queue replay when switching to true)
   */
  setOnline(online: boolean): void {
    this.httpClient.setOnline(online);
  }

  /**
   * Get number of mutations currently queued offline
   */
  getOfflineQueueSize(): number {
    return this.httpClient.getOfflineQueueSize();
  }

  /**
   * Listen to offline events ('online', 'offline', 'queue-processed')
   */
  on(event: OfflineEventType, listener: OfflineEventListener): this {
    this.httpClient.getOfflineQueue()?.on(event, listener);
    return this;
  }

  /**
   * Remove an offline event listener
   */
  off(event: OfflineEventType, listener: OfflineEventListener): this {
    this.httpClient.getOfflineQueue()?.off(event, listener);
    return this;
  }

  // ---------------------------------------------------------------------------
  // Creator methods
  // ---------------------------------------------------------------------------
  declare getCreator: (creatorId: string) => Promise<Creator>;
  declare listCreators: (options?: {
    page?: number;
    pageSize?: number;
    verified?: boolean;
  }) => Promise<{ creators: Creator[]; total: number; page: number; pageSize: number }>;
  declare getCreatorProfile: (username: string) => Promise<CreatorProfile>;
  declare verifyCreator: (creatorId: string, verified: boolean) => Promise<Creator>;

  // ---------------------------------------------------------------------------
  // Wallet methods
  // ---------------------------------------------------------------------------
  declare connectWallet: (data: CreateWalletRequest) => Promise<Wallet>;
  declare disconnectWallet: (walletId: string) => Promise<void>;
  declare getWallets: (userId: string) => Promise<Wallet[]>;
  declare getWallet: (walletId: string) => Promise<Wallet>;
  declare updateWallet: (walletId: string, data: UpdateWalletRequest) => Promise<Wallet>;
  declare verifyWallet: (walletId: string, proof: string) => Promise<Wallet>;
  declare getWalletBalance: (walletId: string) => Promise<BalanceInfo>;

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
    options?: {
      page?: number;
      pageSize?: number;
    },
    requestOptions?: Partial<RequestOptions>
  ) => Promise<TransactionHistory>;
  declare getCreatorTipsReceived: (
    creatorId: string,
    options?: { page?: number; pageSize?: number },
    requestOptions?: Partial<RequestOptions>
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
  declare getFullTransactionHistory: (options?: {
    page?: number;
    pageSize?: number;
    startDate?: Date;
    endDate?: Date;
    status?: 'pending' | 'confirmed' | 'failed';
  }) => Promise<TransactionHistory>;
  declare getTransactionStats: (userId?: string) => Promise<TransactionStats>;
  declare getCreatorEarnings: (creatorId: string) => Promise<{
    totalEarnings: number;
    pendingBalance: number;
    confirmedBalance: number;
    transactionCount: number;
  }>;
  declare exportTransactionHistory: (options?: {
    format?: 'csv' | 'json';
    startDate?: Date;
    endDate?: Date;
  }) => Promise<string>;

  // ---------------------------------------------------------------------------
  // Balance methods
  // ---------------------------------------------------------------------------
  declare getBalance: (userId: string) => Promise<AccountBalance>;
  declare getCreatorPendingPayout: (creatorId: string) => Promise<{
    pending: number;
    nextPayoutDate?: string;
    minimumThreshold: number;
  }>;
  declare canPayout: (creatorId: string) => Promise<boolean>;
  declare getAccountSummary: () => Promise<{
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
    data: { documentType: string; documentUrl?: string; description?: string }
  ) => Promise<VerificationStatus>;
  declare getCreatorVerificationStatus: (
    creatorId: string
  ) => Promise<VerificationStatus & { status: string }>;
  declare getWalletVerificationStatus: (walletId: string) => Promise<VerificationStatus>;
  declare requestWalletVerificationChallenge: (
    walletId: string
  ) => Promise<{ challenge: string; expiresIn: number }>;
  declare isTransactionVerified: (transactionId: string) => Promise<boolean>;

  // ---------------------------------------------------------------------------
  // Auth methods
  // ---------------------------------------------------------------------------
  declare refreshSession: () => Promise<SessionInfo>;
  declare validateSession: () => Promise<User>;
  declare getCurrentUser: () => Promise<User>;
  declare logout: () => Promise<void>;
  declare isAuthenticated: () => Promise<boolean>;
  declare extendSession: () => Promise<SessionInfo>;
  declare getSessionExpiry: () => Promise<{
    expiresAt: string;
    expiresIn: number;
    isExpired: boolean;
  }>;

  declare getCreators: (creatorIds: string[], concurrency?: number) => Promise<Creator[]>;
  declare getAllTransactionHistory: (pageSize?: number) => Promise<TransactionHistory>;
  declare getAllWalletBalances: (
    walletIds: string[],
    concurrency?: number
  ) => Promise<BalanceInfo[]>;
}
