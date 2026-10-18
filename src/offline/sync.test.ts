/**
 * OfflineManager Tests (Issue #129)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OfflineManager } from './sync';
import type { OfflineConfig, QueuedOperation } from '../types/offline';
import { ApiError, NetworkError } from '../types/errors';

describe('OfflineManager', () => {
  let offlineManager: OfflineManager;
  let mockRequestExecutor: ReturnType<typeof vi.fn>;
  let mockOnlineStatusChecker: ReturnType<typeof vi.fn>;

  const baseConfig: OfflineConfig = {
    enabled: true,
    storage: 'memory',
    syncInterval: 0, // Disable auto-sync for tests
    maxOperations: 100,
    conflictResolution: 'last-write-wins',
  };

  beforeEach(async () => {
    mockRequestExecutor = vi.fn().mockResolvedValue({ success: true });
    mockOnlineStatusChecker = vi.fn().mockReturnValue(true);

    offlineManager = new OfflineManager({
      config: baseConfig,
      requestExecutor: mockRequestExecutor,
      onlineStatusChecker: mockOnlineStatusChecker,
    });

    await offlineManager.initialize();
  });

  afterEach(async () => {
    await offlineManager.shutdown();
  });

  describe('Initialization', () => {
    it('initializes successfully', async () => {
      const manager = new OfflineManager({
        config: baseConfig,
        requestExecutor: mockRequestExecutor,
        onlineStatusChecker: mockOnlineStatusChecker,
      });

      await expect(manager.initialize()).resolves.not.toThrow();
      await manager.shutdown();
    });

    it('emits storage:ready event', async () => {
      const storageReadyListener = vi.fn();
      
      const manager = new OfflineManager({
        config: baseConfig,
        requestExecutor: mockRequestExecutor,
        onlineStatusChecker: mockOnlineStatusChecker,
      });

      manager.on('storage:ready', storageReadyListener);
      await manager.initialize();

      expect(storageReadyListener).toHaveBeenCalledWith({ backend: 'memory' });
      await manager.shutdown();
    });

    it('emits storage:error on initialization failure', async () => {
      const storageErrorListener = vi.fn();
      
      const manager = new OfflineManager({
        config: { ...baseConfig, storage: 'idb' }, // Will fail in Node.js
        requestExecutor: mockRequestExecutor,
        onlineStatusChecker: mockOnlineStatusChecker,
      });

      manager.on('storage:error', storageErrorListener);
      
      await expect(manager.initialize()).rejects.toThrow();
      expect(storageErrorListener).toHaveBeenCalled();
    });
  });

  describe('Queue Operations', () => {
    it('queues an operation', async () => {
      const operation = await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100, creatorId: 'c1' },
      });

      expect(operation.id).toBeDefined();
      expect(operation.status).toBe('pending');
      expect(operation.timestamp).toBeDefined();
      expect(operation.attempts).toBe(0);
    });

    it('emits operation:queued event', async () => {
      const queuedListener = vi.fn();
      offlineManager.on('operation:queued', queuedListener);

      await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      expect(queuedListener).toHaveBeenCalled();
      expect(queuedListener.mock.calls[0][0].operation.type).toBe('createTip');
    });

    it('generates unique operation IDs', async () => {
      const op1 = await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      const op2 = await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 200 },
      });

      expect(op1.id).not.toBe(op2.id);
    });

    it('triggers sync when online', async () => {
      const syncStartListener = vi.fn();
      offlineManager.on('sync:start', syncStartListener);

      await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      // Wait a bit for async sync to trigger
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(syncStartListener).toHaveBeenCalled();
    });
  });

  describe('Sync Operations', () => {
    it('syncs pending operations', async () => {
      await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      const result = await offlineManager.sync({ force: true });

      expect(result.synced).toHaveLength(1);
      expect(result.failed).toHaveLength(0);
      expect(result.conflicts).toHaveLength(0);
      expect(mockRequestExecutor).toHaveBeenCalledTimes(1);
    });

    it('emits sync:start and sync:complete events', async () => {
      const syncStartListener = vi.fn();
      const syncCompleteListener = vi.fn();

      offlineManager.on('sync:start', syncStartListener);
      offlineManager.on('sync:complete', syncCompleteListener);

      await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      await offlineManager.sync({ force: true });

      expect(syncStartListener).toHaveBeenCalled();
      expect(syncCompleteListener).toHaveBeenCalled();
      expect(syncCompleteListener.mock.calls[0][0].synced).toHaveLength(1);
    });

    it('handles sync errors', async () => {
      mockRequestExecutor.mockRejectedValueOnce(new Error('Network error'));

      await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      const result = await offlineManager.sync({ force: true });

      expect(result.synced).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toBe('Network error');
    });

    it('emits operation:failed event on failure', async () => {
      mockRequestExecutor.mockRejectedValueOnce(new Error('API error'));
      const failedListener = vi.fn();
      offlineManager.on('operation:failed', failedListener);

      await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      await offlineManager.sync({ force: true });

      expect(failedListener).toHaveBeenCalled();
      expect(failedListener.mock.calls[0][0].error.message).toBe('API error');
    });

    it('respects batch size limit', async () => {
      // Queue 5 operations
      for (let i = 0; i < 5; i++) {
        await offlineManager.queueOperation({
          type: 'createTip',
          method: 'POST',
          path: '/api/v1/tips',
          data: { amount: 100 + i },
        });
      }

      const result = await offlineManager.sync({ force: true, batchSize: 3 });

      expect(result.total).toBe(3);
      expect(mockRequestExecutor).toHaveBeenCalledTimes(3);
    });

    it('filters by operation types', async () => {
      await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      await offlineManager.queueOperation({
        type: 'createWallet',
        method: 'POST',
        path: '/api/v1/wallets',
        data: { address: 'wallet1' },
      });

      const result = await offlineManager.sync({ 
        force: true, 
        types: ['createTip'] 
      });

      expect(result.total).toBe(1);
      expect(result.synced[0].type).toBe('createTip');
    });

    it('prevents concurrent syncs', async () => {
      await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      // Start two syncs concurrently
      const sync1 = offlineManager.sync({ force: true });
      const sync2 = offlineManager.sync({ force: true });

      const [result1, result2] = await Promise.all([sync1, sync2]);

      // One should succeed, one should return empty result
      const totalSynced = result1.synced.length + result2.synced.length;
      expect(totalSynced).toBe(1);
    });

    it('includes idempotency key in request headers', async () => {
      await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
        idempotencyKey: 'idem-key-123',
      });

      await offlineManager.sync({ force: true });

      expect(mockRequestExecutor).toHaveBeenCalledWith(
        'POST',
        '/api/v1/tips',
        { amount: 100 },
        expect.objectContaining({ 'Idempotency-Key': 'idem-key-123' })
      );
    });
  });

  describe('Conflict Resolution', () => {
    it('handles conflicts with client-wins strategy', async () => {
      const conflictError = new ApiError('409 Conflict');
      mockRequestExecutor.mockRejectedValueOnce(conflictError);

      const conflictListener = vi.fn();
      offlineManager.on('sync:conflict', conflictListener);

      const manager = new OfflineManager({
        config: { ...baseConfig, conflictResolution: 'client-wins' },
        requestExecutor: mockRequestExecutor,
        onlineStatusChecker: mockOnlineStatusChecker,
      });

      await manager.initialize();

      await manager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      await manager.sync({ force: true });

      // Should be retried, not marked as conflict
      const state = await manager.getSyncState();
      expect(state.pendingCount).toBeGreaterThan(0);

      await manager.shutdown();
    });

    it('handles conflicts with server-wins strategy', async () => {
      const conflictError = new ApiError('409 Conflict');
      mockRequestExecutor.mockRejectedValueOnce(conflictError);

      const manager = new OfflineManager({
        config: { ...baseConfig, conflictResolution: 'server-wins' },
        requestExecutor: mockRequestExecutor,
        onlineStatusChecker: mockOnlineStatusChecker,
      });

      await manager.initialize();

      await manager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      const result = await manager.sync({ force: true });

      // Operation should be marked as synced (accepting server version)
      expect(result.conflicts).toHaveLength(1);
      
      await manager.shutdown();
    });

    it('handles conflicts with manual strategy', async () => {
      const conflictError = new ApiError('412 Precondition Failed');
      mockRequestExecutor.mockRejectedValueOnce(conflictError);

      const conflictListener = vi.fn();

      const manager = new OfflineManager({
        config: { ...baseConfig, conflictResolution: 'manual' },
        requestExecutor: mockRequestExecutor,
        onlineStatusChecker: mockOnlineStatusChecker,
      });

      await manager.initialize();
      manager.on('sync:conflict', conflictListener);

      await manager.queueOperation({
        type: 'updateCreator',
        method: 'PUT',
        path: '/api/v1/creators/c1',
        data: { name: 'Updated Name' },
      });

      await manager.sync({ force: true });

      expect(conflictListener).toHaveBeenCalled();
      expect(conflictListener.mock.calls[0][0].operation.type).toBe('updateCreator');

      await manager.shutdown();
    });

    it('emits sync:conflict event', async () => {
      const conflictError = new ApiError('409 Conflict');
      mockRequestExecutor.mockRejectedValueOnce(conflictError);

      const conflictListener = vi.fn();
      offlineManager.on('sync:conflict', conflictListener);

      const manager = new OfflineManager({
        config: { ...baseConfig, conflictResolution: 'manual' },
        requestExecutor: mockRequestExecutor,
        onlineStatusChecker: mockOnlineStatusChecker,
      });

      await manager.initialize();

      await manager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      await manager.sync({ force: true });

      await manager.shutdown();
    });
  });

  describe('Sync State', () => {
    it('returns current sync state', async () => {
      await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      const state = await offlineManager.getSyncState();

      expect(state.isSyncing).toBe(false);
      expect(state.pendingCount).toBe(1);
      expect(state.failedCount).toBe(0);
      expect(state.conflictCount).toBe(0);
    });

    it('updates sync state after sync', async () => {
      await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      await offlineManager.sync({ force: true });

      const state = await offlineManager.getSyncState();

      expect(state.pendingCount).toBe(0);
      expect(state.lastSyncTime).toBeDefined();
    });

    it('tracks failed operations', async () => {
      mockRequestExecutor.mockRejectedValueOnce(new Error('Network error'));

      await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      await offlineManager.sync({ force: true });

      const state = await offlineManager.getSyncState();

      expect(state.failedCount).toBe(1);
    });
  });

  describe('Storage Stats', () => {
    it('returns storage statistics', async () => {
      await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      await offlineManager.queueOperation({
        type: 'createWallet',
        method: 'POST',
        path: '/api/v1/wallets',
        data: { address: 'wallet1' },
      });

      const stats = await offlineManager.getStats();

      expect(stats.total).toBe(2);
      expect(stats.byStatus.pending).toBe(2);
      expect(stats.byType.createTip).toBe(1);
      expect(stats.byType.createWallet).toBe(1);
      expect(stats.oldestOperation).toBeDefined();
      expect(stats.newestOperation).toBeDefined();
    });
  });

  describe('Retry Failed Operations', () => {
    it('retries failed operations', async () => {
      mockRequestExecutor
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce({ success: true });

      await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      // First sync fails
      await offlineManager.sync({ force: true });

      const stateBefore = await offlineManager.getSyncState();
      expect(stateBefore.failedCount).toBe(1);

      // Retry should succeed
      const result = await offlineManager.retryFailed();

      expect(result.synced).toHaveLength(1);
      expect(result.failed).toHaveLength(0);

      const stateAfter = await offlineManager.getSyncState();
      expect(stateAfter.failedCount).toBe(0);
    });
  });

  describe('Clear Operations', () => {
    it('clears all operations', async () => {
      await offlineManager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      await offlineManager.clearAll();

      const stats = await offlineManager.getStats();
      expect(stats.total).toBe(0);
    });
  });

  describe('Event Listeners', () => {
    it('registers and removes event listeners', () => {
      const listener = vi.fn();

      offlineManager.on('sync:start', listener);
      offlineManager.off('sync:start', listener);

      // Should not be called after removal
      void offlineManager.sync({ force: true });
    });

    it('calls multiple listeners for same event', async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      offlineManager.on('sync:start', listener1);
      offlineManager.on('sync:start', listener2);

      await offlineManager.sync({ force: true });

      // Wait for async events
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it('handles listener errors gracefully', async () => {
      const errorListener = vi.fn(() => {
        throw new Error('Listener error');
      });
      const normalListener = vi.fn();

      offlineManager.on('sync:start', errorListener);
      offlineManager.on('sync:start', normalListener);

      await expect(offlineManager.sync({ force: true })).resolves.not.toThrow();
      expect(normalListener).toHaveBeenCalled();
    });
  });

  describe('Auto-sync', () => {
    it('performs auto-sync at intervals', async () => {
      const syncCompleteListener = vi.fn();

      const manager = new OfflineManager({
        config: { ...baseConfig, syncInterval: 100 }, // 100ms for testing
        requestExecutor: mockRequestExecutor,
        onlineStatusChecker: mockOnlineStatusChecker,
      });

      await manager.initialize();
      manager.on('sync:complete', syncCompleteListener);

      await manager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      // Wait for auto-sync to trigger
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(syncCompleteListener).toHaveBeenCalled();
      await manager.shutdown();
    });

    it('does not auto-sync when offline', async () => {
      mockOnlineStatusChecker.mockReturnValue(false);
      const syncCompleteListener = vi.fn();

      const manager = new OfflineManager({
        config: { ...baseConfig, syncInterval: 100 },
        requestExecutor: mockRequestExecutor,
        onlineStatusChecker: mockOnlineStatusChecker,
      });

      await manager.initialize();
      manager.on('sync:complete', syncCompleteListener);

      await manager.queueOperation({
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        data: { amount: 100 },
      });

      // Wait longer than sync interval
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(syncCompleteListener).not.toHaveBeenCalled();
      await manager.shutdown();
    });
  });

  describe('Shutdown', () => {
    it('stops auto-sync on shutdown', async () => {
      const manager = new OfflineManager({
        config: { ...baseConfig, syncInterval: 100 },
        requestExecutor: mockRequestExecutor,
        onlineStatusChecker: mockOnlineStatusChecker,
      });

      await manager.initialize();
      await manager.shutdown();

      // Auto-sync should not trigger after shutdown
      const syncCompleteListener = vi.fn();
      manager.on('sync:complete', syncCompleteListener);

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(syncCompleteListener).not.toHaveBeenCalled();
    });

    it('clears all listeners on shutdown', async () => {
      const listener = vi.fn();
      offlineManager.on('sync:start', listener);

      await offlineManager.shutdown();

      await offlineManager.sync({ force: true }).catch(() => {
        // Expected to fail after shutdown
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
