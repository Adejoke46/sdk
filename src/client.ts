/**
 * DorisioClient
 *
 * Main client for interacting with Dorisio backend API.
 * Handles authentication, request/response handling, and error management.
 * Supports sandbox/mock mode for offline testing without network calls.
 */

import { HttpClient, RequestOptions, type HttpClientMode } from './http/http-client';
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
import {
  WebSocketClient,
  type RealtimeListener,
  type WebSocketClientOptions,
  type WebSocketState,
} from './websocket/websocket-client';

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
  /**
   * Real-time transport used by {@link DorisioClient.subscribeRealtime}.
   * Pass `false` to disable real-time support entirely.
   */
  websocket?: WebSocketClientOptions | false;
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
  private realtime: WebSocketClient | null = null;

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
      websocket: config.websocket,
    };

    this.token = config.token;
    this.mode = mode;
    this.errorHandler = config.errorHandler;

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
    });

    if (this.token) {
      this.httpClient.setHeader('Authorization', `Bearer ${this.token}`);
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
    const requestBody = body;
    const requestHeaders = options?.headers;

    // Execute middleware chain for request transformation
    const executeMiddleware = async (index: number): Promise<ApiResponse<T>> => {
      if (index >= this.middleware.length) {
        // All middleware executed, make the actual request
        return this.httpClient.request<ApiResponse<T>>(path, {
          method,
          body: requestBody as Record<string, unknown>,
          headers: requestHeaders,
          ...options,
        });
      }

      const middleware = this.middleware[index];
      if (!middleware) {
        return this.httpClient.request<ApiResponse<T>>(path, {
          method,
          body: requestBody as Record<string, unknown>,
          headers: requestHeaders,
          ...options,
        });
      }

      const result = await middleware(
        {
          method,
          path,
          body: requestBody,
          headers: requestHeaders,
          requestId: options?.requestId,
        },
        () => executeMiddleware(index + 1)
      );

      return result as ApiResponse<T>;
    };

    return executeMiddleware(0);
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
