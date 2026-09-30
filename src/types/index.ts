/**
 * Dorisio SDK Types
 *
 * Public type exports for SDK consumers.
 * Re-exports all domain models and request/response types.
 */

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
} from './models';

import type { Transaction as TransactionModel } from './models';

/** A tip is a transaction. */
export type Tip = TransactionModel;

export type {
  Paginator,
  PageFetcher,
  PageItem,
  PaginationResult,
  QueryOptions,
} from '../lib/query-builder';

export type { TipRequest, CreateTipRequest } from './requests';
export type { CacheOptions, CacheStats, CacheStrategy } from './cache';
export type { ApiResponse, PaginationMeta, PaginatedResponse } from './api';
export type { QueueConfig, QueueStats, RequestPriority } from './queue';
export {
  DorisioError,
  AuthError,
  WalletVerificationError,
  PaymentError,
  ValidationError,
  RateLimitError,
  QueueFullError,
  TimeoutError,
  ApiError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  NetworkError,
} from './errors';
export type {
  ErrorHandler,
  ErrorHandlerAction,
  ErrorHandlerContext,
  Middleware,
  MiddlewareContext,
} from './errors';

export type {
  BatchResult,
  BatchSuccess,
  BatchFailure,
  BatchProcessorOptions,
} from '../http/batch-processor';
export { BatchProcessor, processBatch, retryBatchFailures } from '../http/batch-processor';

export type {
  LogLevel,
  LogEntry,
  LogHandler,
  LoggerOptions,
} from '../lib/logger';
export { Logger, createLogger } from '../lib/logger';

// Offline-first storage and sync exports
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
} from './offline';

// Schema exports for consumer validation
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
  type CreatorProfile as CreatorProfileSchema,
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
} from './schemas';
