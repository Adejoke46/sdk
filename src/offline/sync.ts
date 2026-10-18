/**
 * Offline Sync Manager (Issue #129)
 *
 * Manages synchronization of offline operations with the server.
 * Handles auto-sync intervals, conflict resolution, retry logic,
 * and event emissions for sync state changes.
 */

import type {
  IStorageBackend,
  OfflineConfig,
  QueuedOperation,
  OperationStatus,
  SyncState,
  SyncResult,
  SyncConflict,
  OfflineSyncEventType,
  OfflineSyncEventListener,
  SyncEventData,
  SyncOptions,
  ConflictResolutionStrategy,
  StorageStats,
} from '../types/offline';
import { createStorageBackend } from './storage';
import { ApiError, NetworkError } from '../types/errors';

/**
 * Request executor function type
 * This will be provided by the HTTP client to execute actual API requests
 */
export type RequestExecutor = (
  method: string,
  path: string,
  data?: Record<string, unknown>,
  headers?: Record<string, string>
) => Promise<unknown>;

/**
 * Online status checker function type
 */
export type OnlineStatusChecker = () => boolean;

export interface OfflineManagerOptions {
  config: OfflineConfig;
  requestExecutor: RequestExecutor;
  onlineStatusChecker: OnlineStatusChecker;
}

/**
 * OfflineManager coordinates storage, sync, and conflict resolution
 */
export class OfflineManager {
  private storage: IStorageBackend;
  private config: OfflineConfig;
  private requestExecutor: RequestExecutor;
  private onlineStatusChecker: OnlineStatusChecker;
  private syncTimer?: NodeJS.Timeout | number;
  private deferredSyncTimer?: ReturnType<typeof setTimeout>;
  private isSyncing = false;
  private lastSyncTime?: number;
  private online: boolean;
  private initialization?: Promise<void>;
  private readonly waiters = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: unknown) => void;
    }
  >();
  private windowOnlineHandler?: () => void;
  private windowOfflineHandler?: () => void;
  private listeners: Map<OfflineSyncEventType, Set<OfflineSyncEventListener<any>>> = new Map();

  constructor(options: OfflineManagerOptions) {
    this.config = {
      syncInterval: 30000,
      maxOperations: 1000,
      maxOperationAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      conflictResolution: 'last-write-wins',
      databaseName: 'dorisio-offline',
      ...options.config,
    };

    this.storage = createStorageBackend(this.config.storage, {
      databaseName: this.config.databaseName,
      maxOperations: this.config.maxOperations,
    });

    this.requestExecutor = options.requestExecutor;
    this.onlineStatusChecker = options.onlineStatusChecker;
    this.online = options.onlineStatusChecker();
  }

  /**
   * Initialize the offline manager and storage backend
   */
  async initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    this.initialization = this.initializeStorage();
    return this.initialization;
  }

  private async initializeStorage(): Promise<void> {
    try {
      await this.storage.initialize();
      const interrupted = await this.storage.getOperations({ status: 'syncing' });
      for (const operation of interrupted) {
        await this.storage.updateOperation(operation.id, { status: 'pending' });
      }
      this.emit('storage:ready', { backend: this.config.storage });

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        this.windowOnlineHandler = () => this.setOnline(true);
        this.windowOfflineHandler = () => this.setOnline(false);
        window.addEventListener('online', this.windowOnlineHandler);
        window.addEventListener('offline', this.windowOfflineHandler);
      }

      // Start auto-sync if enabled
      if (this.config.syncInterval && this.config.syncInterval > 0) {
        this.startAutoSync();
      }

      // Clean up stale operations
      await this.cleanupStaleOperations();

      if (this.isOnline()) this.scheduleSync();
    } catch (error) {
      this.emit('storage:error', {
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /**
   * Queue an operation for later sync
   */
  async queueOperation(
    operation: Omit<QueuedOperation, 'id' | 'status' | 'timestamp' | 'attempts'>,
    deferSync = false
  ): Promise<QueuedOperation> {
    await this.initialize();
    const queuedOp: QueuedOperation = {
      id: this.generateOperationId(),
      status: 'pending',
      timestamp: Date.now(),
      attempts: 0,
      ...operation,
    };

    await this.storage.saveOperation(queuedOp);
    this.emit('operation:queued', { operation: queuedOp });

    // Try to sync immediately if online
    if (!deferSync && this.isOnline() && !this.isSyncing) {
      // Let an explicit caller sync first; otherwise run in the background.
      this.scheduleSync();
    }

    return queuedOp;
  }

  /** Queue a mutation durably and settle its caller when replay completes. */
  async queueOperationAndWait(
    operation: Omit<QueuedOperation, 'id' | 'status' | 'timestamp' | 'attempts'>
  ): Promise<unknown> {
    const queued = await this.queueOperation(operation, true);
    const result = new Promise((resolve, reject) => {
      this.waiters.set(queued.id, { resolve, reject });
    });
    if (this.isOnline() && !this.isSyncing) void this.sync({ force: true });
    return result;
  }

  /** Replay pending operations as soon as connectivity returns. */
  setOnline(online: boolean): void {
    const reconnected = online && !this.online;
    this.online = online;
    if (reconnected) this.scheduleSync();
  }

  isOnline(): boolean {
    return this.online && this.onlineStatusChecker();
  }

  /**
   * Manually trigger a sync operation
   */
  async sync(options?: SyncOptions): Promise<SyncResult> {
    // Prevent concurrent syncs
    if (this.isSyncing) {
      return {
        synced: [],
        failed: [],
        conflicts: [],
        total: 0,
        duration: 0,
      };
    }

    if (!this.isOnline()) {
      return { synced: [], failed: [], conflicts: [], total: 0, duration: 0 };
    }

    // Check if we should skip sync
    if (!options?.force && this.lastSyncTime) {
      const timeSinceLastSync = Date.now() - this.lastSyncTime;
      const minInterval = this.config.syncInterval || 30000;
      if (timeSinceLastSync < minInterval) {
        return {
          synced: [],
          failed: [],
          conflicts: [],
          total: 0,
          duration: 0,
        };
      }
    }

    const startTime = Date.now();
    this.isSyncing = true;

    try {
      this.emit('sync:start', { timestamp: startTime });

      // Get pending operations
      const operations = await this.storage.getOperations({
        status: 'pending',
        sortBy: 'timestamp',
        sortOrder: 'asc',
        limit: options?.batchSize,
      });

      // Filter by operation types if specified
      const opsToSync = options?.types
        ? operations.filter((op) => options.types!.includes(op.type))
        : operations;

      const synced: QueuedOperation[] = [];
      const failed: QueuedOperation[] = [];
      const conflicts: QueuedOperation[] = [];

      // Sync each operation
      for (const operation of opsToSync) {
        try {
          // Update status to syncing
          await this.storage.updateOperation(operation.id, {
            status: 'syncing',
            attempts: operation.attempts + 1,
          });

          // Execute the request
          const result = await this.executeOperation(operation);

          // Mark as synced
          await this.storage.updateOperation(operation.id, {
            status: 'synced',
          });

          synced.push({ ...operation, status: 'synced' });
          this.emit('operation:synced', { operation: { ...operation, status: 'synced' } });
          this.waiters.get(operation.id)?.resolve(result);
          this.waiters.delete(operation.id);
        } catch (error) {
          // Check if it's a conflict
          const isConflict = this.isConflictError(error);

          if (isConflict) {
            await this.handleConflict(operation, error);
            conflicts.push(operation);
            this.waiters.get(operation.id)?.reject(error);
            this.waiters.delete(operation.id);
          } else {
            // Mark as failed
            const errorMessage = error instanceof Error ? error.message : String(error);
            const wentOffline = !this.isOnline();
            await this.storage.updateOperation(operation.id, {
              status: wentOffline ? 'pending' : 'failed',
              error: errorMessage,
            });

            if (wentOffline) break;

            const failedOperation = {
              ...operation,
              status: 'failed' as const,
              error: errorMessage,
            };
            failed.push(failedOperation);
            this.emit('operation:failed', {
              operation: failedOperation,
              error: error instanceof Error ? error : new Error(String(error)),
            });
            this.waiters.get(operation.id)?.reject(error);
            this.waiters.delete(operation.id);
          }
        }
      }

      // Clean up successfully synced operations after a delay
      // Keep them for a bit in case of rollback needs
      const syncedIds = synced.map((op) => op.id);
      if (syncedIds.length > 0) {
        setTimeout(() => {
          void this.storage.deleteOperations(syncedIds);
        }, 60000); // Delete after 1 minute
      }

      const duration = Date.now() - startTime;
      const result: SyncResult = {
        synced,
        failed,
        conflicts,
        total: opsToSync.length,
        duration,
      };

      this.lastSyncTime = Date.now();
      this.emit('sync:complete', result);

      return result;
    } catch (error) {
      this.emit('sync:error', {
        error: error instanceof Error ? error : new Error(String(error)),
        timestamp: Date.now(),
      });
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Get current sync state
   */
  async getSyncState(): Promise<SyncState> {
    const pendingCount = await this.storage.getCount({ status: 'pending' });
    const failedCount = await this.storage.getCount({ status: 'failed' });
    const conflictCount = await this.storage.getCount({ status: 'conflict' });

    return {
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime,
      pendingCount,
      failedCount,
      conflictCount,
      nextSyncTime: this.getNextSyncTime(),
    };
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<StorageStats> {
    const allOps = await this.storage.getOperations();

    const byStatus: Record<OperationStatus, number> = {
      pending: 0,
      syncing: 0,
      synced: 0,
      failed: 0,
      conflict: 0,
    };

    const byType: Record<string, number> = {};
    let oldestTimestamp: number | undefined;
    let newestTimestamp: number | undefined;

    for (const op of allOps) {
      byStatus[op.status]++;
      byType[op.type] = (byType[op.type] || 0) + 1;

      if (!oldestTimestamp || op.timestamp < oldestTimestamp) {
        oldestTimestamp = op.timestamp;
      }
      if (!newestTimestamp || op.timestamp > newestTimestamp) {
        newestTimestamp = op.timestamp;
      }
    }

    return {
      total: allOps.length,
      byStatus,
      byType: byType as any,
      oldestOperation: oldestTimestamp,
      newestOperation: newestTimestamp,
    };
  }

  /**
   * Retry failed operations
   */
  async retryFailed(): Promise<SyncResult> {
    // Reset failed operations to pending
    const failedOps = await this.storage.getOperations({ status: 'failed' });

    for (const op of failedOps) {
      await this.storage.updateOperation(op.id, {
        status: 'pending',
        error: undefined,
      });
    }

    // Trigger sync
    return this.sync({ force: true });
  }

  /**
   * Clear all operations (use with caution)
   */
  async clearAll(): Promise<void> {
    await this.storage.clearAll();
  }

  /**
   * Register an event listener
   */
  on<T extends OfflineSyncEventType>(event: T, listener: OfflineSyncEventListener<T>): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  /**
   * Remove an event listener
   */
  off<T extends OfflineSyncEventType>(event: T, listener: OfflineSyncEventListener<T>): void {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
  }

  /**
   * Shutdown the offline manager
   */
  async shutdown(): Promise<void> {
    this.stopAutoSync();
    if (this.deferredSyncTimer) {
      clearTimeout(this.deferredSyncTimer);
      this.deferredSyncTimer = undefined;
    }
    if (typeof window !== 'undefined') {
      if (this.windowOnlineHandler) window.removeEventListener('online', this.windowOnlineHandler);
      if (this.windowOfflineHandler)
        window.removeEventListener('offline', this.windowOfflineHandler);
    }
    await this.storage.close();
    this.listeners.clear();
  }

  /**
   * Start automatic syncing
   */
  private startAutoSync(): void {
    if (this.syncTimer) return;

    const interval = this.config.syncInterval || 30000;

    this.syncTimer = setInterval(() => {
      if (this.isOnline() && !this.isSyncing) {
        void this.sync().catch(() => undefined);
      }
    }, interval) as any;
  }

  /**
   * Stop automatic syncing
   */
  private stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer as any);
      this.syncTimer = undefined;
    }
  }

  private scheduleSync(): void {
    if (this.deferredSyncTimer) return;
    this.deferredSyncTimer = setTimeout(() => {
      this.deferredSyncTimer = undefined;
      if (this.isOnline() && !this.isSyncing) {
        void this.sync({ force: true }).catch(() => undefined);
      }
    }, 0);
  }

  /**
   * Execute an operation by calling the request executor
   */
  private async executeOperation(operation: QueuedOperation): Promise<unknown> {
    // Add idempotency key if available
    const headers = {
      ...operation.headers,
    };

    if (operation.idempotencyKey) {
      headers['Idempotency-Key'] = operation.idempotencyKey;
    }

    return this.requestExecutor(operation.method, operation.path, operation.data, headers);
  }

  /**
   * Check if an error represents a conflict
   */
  private isConflictError(error: unknown): boolean {
    if (error instanceof ApiError) {
      // HTTP 409 Conflict or 412 Precondition Failed
      return error.message.includes('409') || error.message.includes('412');
    }
    return false;
  }

  /**
   * Handle a conflict according to the configured strategy
   */
  private async handleConflict(operation: QueuedOperation, error: unknown): Promise<void> {
    const conflict: SyncConflict = {
      operation,
      reason: error instanceof Error ? error.message : String(error),
      suggestedResolution: this.config.conflictResolution,
    };

    const strategy = this.config.conflictResolution || 'last-write-wins';

    switch (strategy) {
      case 'client-wins':
        // Force the client version - retry the operation
        await this.storage.updateOperation(operation.id, {
          status: 'pending',
          attempts: operation.attempts + 1,
        });
        break;

      case 'server-wins':
        // Accept server version - mark as synced and delete
        await this.storage.updateOperation(operation.id, {
          status: 'synced',
        });
        setTimeout(() => {
          void this.storage.deleteOperation(operation.id);
        }, 5000);
        break;

      case 'last-write-wins':
        // Compare timestamps if available
        const serverTime = this.extractServerTimestamp(error);
        const clientTime = operation.metadata?.clientTimestamp || operation.timestamp;

        if (serverTime && clientTime > serverTime) {
          // Client is newer - retry
          await this.storage.updateOperation(operation.id, {
            status: 'pending',
            attempts: operation.attempts + 1,
          });
        } else {
          // Server is newer or equal - accept server version
          await this.storage.updateOperation(operation.id, {
            status: 'synced',
          });
        }
        break;

      case 'manual':
        // Mark as conflict and emit event for manual resolution
        await this.storage.updateOperation(operation.id, {
          status: 'conflict',
        });
        this.emit('sync:conflict', conflict);
        break;

      case 'merge':
        // Attempt to merge - for now, treat as manual
        await this.storage.updateOperation(operation.id, {
          status: 'conflict',
        });
        this.emit('sync:conflict', conflict);
        break;
    }
  }

  /**
   * Extract server timestamp from error (if available)
   */
  private extractServerTimestamp(error: unknown): number | null {
    // This is a simple implementation - in reality, you'd parse the server response
    // to extract timestamp information
    if (error instanceof Error && error.message) {
      const match = error.message.match(/timestamp[:\s]+(\d+)/i);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }
    return null;
  }

  /**
   * Clean up operations older than maxOperationAge
   */
  private async cleanupStaleOperations(): Promise<void> {
    if (!this.config.maxOperationAge) return;

    const cutoff = Date.now() - this.config.maxOperationAge;
    const staleOps = await this.storage.getOperations({
      before: cutoff,
      status: ['synced', 'failed'],
    });

    const staleIds = staleOps.map((op) => op.id);
    if (staleIds.length > 0) {
      await this.storage.deleteOperations(staleIds);
    }
  }

  /**
   * Generate a unique operation ID
   */
  private generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
  }

  /**
   * Get the next scheduled sync time
   */
  private getNextSyncTime(): number | undefined {
    if (!this.config.syncInterval || !this.lastSyncTime) {
      return undefined;
    }
    return this.lastSyncTime + this.config.syncInterval;
  }

  /**
   * Emit an event to all registered listeners
   */
  private emit<T extends OfflineSyncEventType>(event: T, data: SyncEventData[T]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const listener of set) {
        try {
          listener(data);
        } catch (error) {
          console.error(`[OfflineManager] Error in ${event} listener:`, error);
        }
      }
    }
  }
}
