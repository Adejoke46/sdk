/**
 * Dorisio SDK
 *
 * Client library for Dorisio payment infrastructure.
 * Provides type-safe API client and utilities for integrating Dorisio payments.
 */

export const SDK_VERSION = '0.1.0';

// Re-export client and utilities
export { DorisioClient, type ClientConfig } from './client';

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
  RequestInterceptor,
  ResponseInterceptor,
  ErrorInterceptor,
} from './http/interceptors';
export type { RequestOptions } from './http/http-client';
export { RequestQueue, type RequestQueueOptions } from './http/request-queue';
export { ConnectionPool, type ConnectionPoolOptions, type ConnectionPoolStats } from './http/connection-pool';
export {
  OfflineQueue,
  type OfflineQueueOptions,
  type OfflineEventType,
  type OfflineEventListener,
  type QueueProcessedResult,
} from './http/offline-queue';
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
} from './client/batch-operations';
export type { VerificationStatus } from './client/verification';
export type { SessionInfo } from './client/auth';
