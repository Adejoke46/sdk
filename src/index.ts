/**
 * Dorisio SDK
 *
 * Client library for Dorisio payment infrastructure.
 * Provides type-safe API client and utilities for integrating Dorisio payments.
 */

export const SDK_VERSION = '0.1.0';

// Re-export client and utilities
export { DorisioClient, type ClientConfig } from './client';
export type { CompressionAlgorithm, RequestCompressionConfig } from './http/compress';

// Re-export GraphQL client and queries
export {
  GraphQLClient,
  GraphQLCache,
  GraphQLError,
  type GraphQLClientConfig,
  type GraphQLRequestOptions,
  type GraphQLResponse,
  type GraphQLErrorItem,
  type GraphQMErrorLocation,
  type GraphQLCacheOptions,
  type CacheEntry,
} from './graphql/graphql-client';
export {
  GET_CREATOR,
  GET_CREATOR_WITH_USER,
  LIST_CREATORS,
  GET_CREATOR_PROFILE,
  GET_TRANSACTION,
  GET_TRANSACTION_WITH_DETAILS,
  GET_TRANSACTION_HISTORY,
  GET_WALLET,
  GET_WALLETS,
  CREATE_TIP,
  buildCreatorQuery,
  buildListCreatorsQuery,
  buildTransactionQuery,
  buildTransactionHistoryQuery,
  buildCustomQuery,
} from './graphql/queries';

// Re-export HTTP interceptors (public API for custom middleware)
export {
  ApiVersionHandler,
  type ApiVersionHandlerOptions,
  type DeprecationWarning,
  type DeprecatedEndpointConfig,
  type RequestMigrationContext,
  type VersionMigration,
} from './http/api-version-handler';
export { InterceptorManager } from './http/interceptors';
export type {
  InterceptorId,
  RequestInterceptor,
  ResponseInterceptor,
  ErrorInterceptor,
} from './types/interceptors';
export type { RequestOptions, HttpClientOptions, HttpClientMode } from './http/http-client';
export type { StreamedResponse } from './http/http-client';
export { HttpClient } from './http/http-client';
export { validateSchema } from './validation/schema-validator';
export { SchemaValidationError } from './types/validation';
export type { ValidationSchema, ValidationSchemas, SchemaValidationIssue } from './types/validation';
export { CacheManager } from './cache/cache-manager';
export type { CacheOptions, CacheStats, CacheStrategy } from './types/cache';
export { RequestQueue, type RequestQueueOptions } from './http/request-queue';
export {
  PriorityRequestQueue,
  type PriorityRequestQueueOptions,
} from './queue/request-queue';
export type { QueueConfig, QueueStats, RequestPriority } from './types/queue';
export { Batcher, type BatchExecuteOptions, type BatchOperationResult } from './utils/batch';
export { RequestSigner, type RequestSignerOptions } from './http/request-signer';
export { ConnectionPool, type ConnectionPoolOptions, type ConnectionPoolStats } from './http/connection-pool';
export {
  OfflineQueue,
  type OfflineQueueOptions,
  type OfflineEventType,
  type OfflineEventListener,
  type QueueProcessedResult,
} from './http/offline-queue';

// Re-export offline-first storage and sync (Issue #129)
export { OfflineManager } from './offline/sync';
export {
  MemoryStorage,
  IndexedDBStorage,
  SQLiteStorage,
  createStorageBackend,
} from './offline/storage';
export type {
  OfflineConfig,
  StorageBackendType,
  QueuedOperation,
  OperationStatus,
  OperationType,
  SyncState,
  SyncResult,
  SyncConflict,
  OfflineSyncEventType,
  OfflineSyncEventListener,
  SyncOptions,
  StorageStats,
  ConflictResolutionStrategy,
  IStorageBackend,
  OperationFilter,
  OperationMetadata,
  SyncEventData,
  StorageBackendOptions,
} from './types/offline';
export {
  FailoverManager,
  type EndpointConfig,
  type FailoverManagerOptions,
} from './http/failover-manager';
export {
  JsonSerializer,
  type Serializer,
} from './http/serializer';
export {
  MetricsCollector,
  type MetricsCollectorOptions,
  type MetricsSummary,
  type MethodStat,
  type MetricRecord,
  type CallbackMetrics,
  type MetricsCallback,
} from './lib/metrics';

// Re-export error reporter
export {
  ConsoleErrorReporter,
  NoopErrorReporter,
  createErrorReporter,
  type ErrorReporter,
  type ErrorReporterOptions,
  type ErrorReportEvent,
  type UserContext,
} from './lib/error-reporter';

// Re-export hook system
export {
  HookManager,
  type HookContext,
  type ResponseContext,
  type BeforeRequestHook,
  type AfterRequestHook,
  type BeforeResponseHook,
  type AfterResponseHook,
  type HookRegistration,
} from './lib/hooks';

// Re-export throttle manager
export {
  ThrottleManager,
  type ThrottleManagerOptions,
  type EndpointThrottleConfig,
} from './http/throttle-manager';

// Re-export proxy config type
export type { ProxyConfig } from './http/http-client';

// Re-export Sentry integration
export {
  SentryErrorReporter,
  HttpSentryTransport,
  createSentryReporter,
  type SentryTransport,
  type SentryEvent,
} from './integrations/sentry';

// Re-export circuit breaker
export {
  CircuitBreaker,
  CircuitBreakerOpenError,
  type CircuitBreakerOptions,
  type CircuitState,
  type CircuitBreakerStats,
} from './http/circuit-breaker';

// Re-export real-time sync (Issue #58)
export {
  WebSocketClient,
  ALL_CHANNELS,
  type WebSocketClientOptions,
  type WebSocketState,
  type WebSocketLike,
  type WebSocketFactory,
  type RealtimeEvent,
  type RealtimeListener,
  type RealtimeFrame,
  type RealtimeSource,
  type RealtimeStateListener,
  type PollingFallbackOptions,
} from './websocket/websocket-client';

// Re-export types
export type { ApiResponse, PaginationMeta, PaginatedResponse } from './types/api';
export {
  ApiError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  NetworkError,
  TimeoutError,
  DorisioError,
  AuthError,
  WalletVerificationError,
  PaymentError,
  RateLimitError,
  QueueFullError,
} from './types/errors';
export type {
  ErrorHandler,
  ErrorHandlerAction,
  ErrorHandlerContext,
  Middleware,
  MiddlewareContext,
} from './types/errors';

// Re-export domain models
export type {
  User,
  UserProfile,
  UpdateUserRequest,
  Wallet,
  CreateWalletRequest,
  UpdateWalletRequest,
  Creator,
  CreatorWithUser,
  CreatorProfile,
  CreateCreatorRequest,
  UpdateCreatorRequest,
  Transaction,
  TransactionWithDetails,
  TransactionHistory,
  TransactionStats,
  CreatorListResponse,
  WalletListResponse,
  CreatorEarningsResponse,
  TipRequest,
  CreateTipRequest,
  Tip,
} from './types';

// Re-export utils
export { ApiErrorHandler, RequestValidator } from './utils';

// Re-export idempotency manager
export {
  IdempotencyManager,
  getIdempotencyManager,
  type IdempotencyManagerOptions,
  type IdempotencyRecord,
} from './utils/idempotency-manager';

// Re-export webhook utilities
export {
  verifyWebhookSignature,
  parseWebhookPayload,
  WebhookEventType,
  type WebhookPayload,
  type WebhookVerificationOptions,
  type WebhookEventHandler,
} from './utils/webhook-verifier';
export {
  createWebhookMiddleware,
  createNextWebhookHandler,
  createNextApiWebhookHandler,
  type WebhookMiddlewareOptions,
} from './http/webhook-middleware';
export { WebhookPayloadSchema } from './utils/validation-schemas';

// Re-export validation schemas for consumer use
export {
  Schemas,
  AuthSchemas,
  PaymentSchemas,
  CreatorSchemas,
  WalletSchemas,
  ApiUserSchema,
  ApiCreatorSchema,
  ApiWalletSchema,
  ApiTransactionSchema,
  ApiListCreatorsSchema,
  ApiTransactionHistorySchema,
  ApiTransactionStatsSchema,
  ApiSessionSchema,
  ApiSessionExpirySchema,
  ApiBalanceInfoSchema,
  ApiAccountBalanceSchema,
  ApiCreatorEarningsSchema,
  ApiCreatorPendingPayoutSchema,
  ApiAccountSummarySchema,
  ApiVerificationStatusSchema,
  ApiWalletChallengeSchema,
  type LoginInput,
  type RegisterInput,
  type WalletChallengeInput,
  type WalletVerificationInput,
  type CreateTipInput,
  type TransactionDetails,
  type PaymentHistoryFilterInput,
  type CreatorProfileInput,
  type CreatorVerificationInput,
  type CreatorPayoutInput,
  type WalletInfo,
  type LinkWalletInput,
  type ApiUser,
  type ApiCreator,
  type ApiWallet,
  type ApiTransaction,
  type ApiListCreators,
  type ApiTransactionHistory,
  type ApiTransactionStats,
  type ApiSession,
  type ApiSessionExpiry,
  type ApiBalanceInfo,
  type ApiAccountBalance,
  type ApiCreatorEarnings,
  type ApiCreatorPendingPayout,
  type ApiAccountSummary,
  type ApiVerificationStatus,
  type ApiWalletChallenge,
} from './types/schemas';

// Re-export sandbox utilities
export { SandboxClient, createSandboxClient, type SandboxConfig } from './sandbox/sandbox-client';
export * as MockData from './sandbox/mock-data';
export { MockRouter, type SandboxHistoryEntry } from './sandbox/mock-router';
export type { ClientMode } from './client';

// Re-export query utilities
export {
  buildQueryString,
  parsePaginationMeta,
  listTips,
  listCreators,
  listCreatorTips,
  listVerifiedCreators,
  createPaginator,
  encodeCursor,
  decodeCursor,
  Paginator,
  type QueryOptions,
  type PaginationResult,
  type PageFetcher,
  type PageItem,
  type ListClient,
} from './lib/query-builder';

// Re-export mappers
export {
  CreatorMapper,
  UserMapper,
  TransactionMapper,
  WalletMapper,
  ResponseMapper,
} from './utils/mappers';

// Re-export normalizers
export {
  normalizeCreatorProfile,
  normalizeCreator,
  normalizeCreators,
  normalizeUser,
  normalizeWallet,
  normalizeWallets,
  normalizeTransaction,
  normalizeTransactions,
  normalizeCreateTip,
  normalizeCreateTipInput,
} from './utils/normalizers';

// Re-export transaction normalizers
export {
  normalizeTransactionHistoryResponse,
  calculatePaginationMetadata,
  normalizeTransactionWithDetails,
  normalizeTransactionsWithDetails,
  calculateTransactionStats,
  filterTransactionsByStatus,
  filterTransactionsByDateRange,
  groupTransactionsByCreator,
  enrichTransactionHistory,
} from './utils/transaction-normalizers';

// Re-export client method types
export type { BalanceInfo, AccountBalance } from './client/balance';
export {
  getCreators,
  getAllTransactionHistory,
  getAllWalletBalances,
  getCreatorsBatch,
  getWalletBalancesBatch,
  createTipsBatch,
  processBatchWithRetry,
  retryBatch,
} from './client/batch-operations';
export type { VerificationStatus } from './client/verification';
export type { SessionInfo } from './client/auth';

// Re-export plugin system (Issue #137)
export {
  PluginSystem,
  PluginHook,
  createPlugin,
  composePlugins,
  type Plugin,
  type PluginHookContext,
  type PluginHookHandler,
  type InstalledPlugin,
  type PluginCompositionResult,
  type PluginStatEntry,
} from './lib/plugin-system';
