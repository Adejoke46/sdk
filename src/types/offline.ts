/**
 * Offline-First Storage and Sync Types (Issue #129)
 *
 * Type definitions for offline storage backends, operation queuing,
 * sync state management, and conflict resolution.
 */

/**
 * Storage backend types supported by the SDK
 */
export type StorageBackendType = 'sqlite' | 'idb' | 'memory';

/**
 * Offline configuration for the client
 */
export interface OfflineConfig {
  /** Enable offline-first mode */
  enabled: boolean;
  /** Storage backend to use */
  storage: StorageBackendType;
  /** Auto-sync interval in milliseconds (0 to disable auto-sync) */
  syncInterval?: number;
  /** Maximum number of operations to keep in storage */
  maxOperations?: number;
  /** Maximum age of operations in milliseconds before they're considered stale */
  maxOperationAge?: number;
  /** Conflict resolution strategy */
  conflictResolution?: ConflictResolutionStrategy;
  /** Custom database name for storage backends */
  databaseName?: string;
}

/**
 * Operation status in the queue
 */
export type OperationStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'conflict';

/**
 * Operation types that can be queued
 */
export type OperationType = 
  | 'createTip'
  | 'createCreator'
  | 'updateCreator'
  | 'createWallet'
  | 'updateWallet'
  | 'updateUser'
  | 'deleteWallet'
  | 'custom';

/**
 * A queued operation waiting to be synced
 */
export interface QueuedOperation {
  /** Unique identifier for this operation */
  id: string;
  /** Type of operation */
  type: OperationType;
  /** HTTP method */
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** API endpoint path */
  path: string;
  /** Request payload */
  data?: Record<string, unknown>;
  /** Request headers */
  headers?: Record<string, string>;
  /** Current status */
  status: OperationStatus;
  /** Timestamp when operation was created */
  timestamp: number;
  /** Number of sync attempts */
  attempts: number;
  /** Last error message if failed */
  error?: string;
  /** Idempotency key for safe retries */
  idempotencyKey?: string;
  /** Priority for ordering (higher = more urgent) */
  priority?: number;
  /** Metadata for conflict resolution */
  metadata?: OperationMetadata;
}

/**
 * Metadata attached to operations for conflict resolution
 */
export interface OperationMetadata {
  /** Entity ID being modified (e.g., creator ID, wallet ID) */
  entityId?: string;
  /** Entity type */
  entityType?: string;
  /** Version or ETag for optimistic locking */
  version?: string | number;
  /** User ID who initiated the operation */
  userId?: string;
  /** Client-side timestamp for ordering */
  clientTimestamp: number;
  /** Custom metadata */
  [key: string]: unknown;
}

/**
 * Conflict resolution strategies
 */
export type ConflictResolutionStrategy = 
  | 'client-wins'    // Always use client version
  | 'server-wins'    // Always use server version
  | 'last-write-wins' // Use most recent timestamp
  | 'manual'         // Emit event for manual resolution
  | 'merge';         // Attempt to merge changes

/**
 * Sync state for tracking synchronization progress
 */
export interface SyncState {
  /** Whether sync is currently in progress */
  isSyncing: boolean;
  /** Timestamp of last successful sync */
  lastSyncTime?: number;
  /** Number of operations pending sync */
  pendingCount: number;
  /** Number of operations that failed to sync */
  failedCount: number;
  /** Number of conflicts detected */
  conflictCount: number;
  /** Next scheduled sync time */
  nextSyncTime?: number;
}

/**
 * Result of a sync operation
 */
export interface SyncResult {
  /** Operations successfully synced */
  synced: QueuedOperation[];
  /** Operations that failed */
  failed: QueuedOperation[];
  /** Operations with conflicts */
  conflicts: QueuedOperation[];
  /** Total operations processed */
  total: number;
  /** Sync duration in milliseconds */
  duration: number;
}

/**
 * Conflict detected during sync
 */
export interface SyncConflict {
  /** The queued operation */
  operation: QueuedOperation;
  /** Server response or state */
  serverData?: unknown;
  /** Conflict reason */
  reason: string;
  /** Suggested resolution */
  suggestedResolution?: ConflictResolutionStrategy;
}

/**
 * Events emitted by the offline manager
 */
export type OfflineSyncEventType =
  | 'sync:start'
  | 'sync:complete'
  | 'sync:error'
  | 'sync:conflict'
  | 'storage:ready'
  | 'storage:error'
  | 'operation:queued'
  | 'operation:synced'
  | 'operation:failed';

/**
 * Event data for sync events
 */
export interface SyncEventData {
  'sync:start': { timestamp: number };
  'sync:complete': SyncResult;
  'sync:error': { error: Error; timestamp: number };
  'sync:conflict': SyncConflict;
  'storage:ready': { backend: StorageBackendType };
  'storage:error': { error: Error };
  'operation:queued': { operation: QueuedOperation };
  'operation:synced': { operation: QueuedOperation };
  'operation:failed': { operation: QueuedOperation; error: Error };
}

/**
 * Event listener for offline sync events
 */
export type OfflineSyncEventListener<T extends OfflineSyncEventType> = (
  data: SyncEventData[T]
) => void;

/**
 * Storage backend interface that all implementations must follow
 */
export interface IStorageBackend {
  /** Initialize the storage backend */
  initialize(): Promise<void>;
  
  /** Save an operation to storage */
  saveOperation(operation: QueuedOperation): Promise<void>;
  
  /** Get an operation by ID */
  getOperation(id: string): Promise<QueuedOperation | null>;
  
  /** Get all operations matching criteria */
  getOperations(filter?: OperationFilter): Promise<QueuedOperation[]>;
  
  /** Update an operation's status or data */
  updateOperation(id: string, updates: Partial<QueuedOperation>): Promise<void>;
  
  /** Delete an operation from storage */
  deleteOperation(id: string): Promise<void>;
  
  /** Delete multiple operations */
  deleteOperations(ids: string[]): Promise<void>;
  
  /** Clear all operations (use with caution) */
  clearAll(): Promise<void>;
  
  /** Get total count of operations */
  getCount(filter?: OperationFilter): Promise<number>;
  
  /** Close/cleanup the storage backend */
  close(): Promise<void>;
}

/**
 * Filter criteria for querying operations
 */
export interface OperationFilter {
  /** Filter by status */
  status?: OperationStatus | OperationStatus[];
  /** Filter by operation type */
  type?: OperationType | OperationType[];
  /** Filter operations after this timestamp */
  after?: number;
  /** Filter operations before this timestamp */
  before?: number;
  /** Limit number of results */
  limit?: number;
  /** Sort order */
  sortBy?: 'timestamp' | 'priority' | 'attempts';
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Storage backend factory options
 */
export interface StorageBackendOptions {
  /** Database name */
  databaseName?: string;
  /** Maximum operations to store */
  maxOperations?: number;
  /** Auto-cleanup old operations */
  autoCleanup?: boolean;
  /** Cleanup interval in milliseconds */
  cleanupInterval?: number;
}

/**
 * Sync options for manual sync triggers
 */
export interface SyncOptions {
  /** Force sync even if recently synced */
  force?: boolean;
  /** Only sync specific operation types */
  types?: OperationType[];
  /** Maximum operations to sync in one batch */
  batchSize?: number;
  /** Timeout for sync operation */
  timeout?: number;
}

/**
 * Statistics about offline storage
 */
export interface StorageStats {
  /** Total operations in storage */
  total: number;
  /** Operations by status */
  byStatus: Record<OperationStatus, number>;
  /** Operations by type */
  byType: Record<OperationType, number>;
  /** Oldest operation timestamp */
  oldestOperation?: number;
  /** Newest operation timestamp */
  newestOperation?: number;
  /** Storage size estimate in bytes (if available) */
  sizeBytes?: number;
}
