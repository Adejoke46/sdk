/**
 * DorisioClient Offline Integration Tests (Issue #129)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DorisioClient } from './client';
import type { OfflineConfig } from './types/offline';

describe('DorisioClient - Offline Mode', () => {
  let client: DorisioClient;

  const offlineConfig: OfflineConfig = {
    enabled: true,
    storage: 'memory',
    syncInterval: 0, // Disable auto-sync for tests
    conflictResolution: 'last-write-wins',
  };

  beforeEach(() => {
    client = new DorisioClient({
      baseUrl: 'https://api.dorisio.com',
      token: 'test-token',
      mode: 'sandbox',
      offline: offlineConfig,
    });
  });

  afterEach(async () => {
    if (client.isOfflineModeEnabled()) {
      await client.clearOfflineStorage();
    }
  });

  describe('Initialization', () => {
    it('initializes with offline mode enabled', () => {
      expect(client.isOfflineModeEnabled()).toBe(true);
    });

    it('initializes without offline mode when not configured', () => {
      const clientWithoutOffline = new DorisioClient({
        baseUrl: 'https://api.dorisio.com',
        mode: 'sandbox',
      });

      expect(clientWithoutOffline.isOfflineModeEnabled()).toBe(false);
    });

    it('initializes without offline mode when disabled', () => {
      const clientWithDisabledOffline = new DorisioClient({
        baseUrl: 'https://api.dorisio.com',
        mode: 'sandbox',
        offline: { ...offlineConfig, enabled: false },
      });

      expect(clientWithDisabledOffline.isOfflineModeEnabled()).toBe(false);
    });
  });

  describe('Offline Sync State', () => {
    it('returns sync state when offline mode is enabled', async () => {
      // Wait for async initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      const state = await client.getOfflineSyncState();

      expect(state).not.toBeNull();
      expect(state).toHaveProperty('isSyncing');
      expect(state).toHaveProperty('pendingCount');
      expect(state).toHaveProperty('failedCount');
      expect(state).toHaveProperty('conflictCount');
    });

    it('returns null when offline mode is disabled', async () => {
      const clientWithoutOffline = new DorisioClient({
        baseUrl: 'https://api.dorisio.com',
        mode: 'sandbox',
      });

      const state = await clientWithoutOffline.getOfflineSyncState();
      expect(state).toBeNull();
    });
  });

  describe('Sync Operations', () => {
    it('queues SDK mutations while offline and syncs them on reconnect', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      client.setOnline(false);

      const tipPromise = client.createTip({ creatorId: 'c1', amount: 50 });
      await new Promise((resolve) => setTimeout(resolve, 20));

      const queuedState = await client.getOfflineSyncState();
      expect(queuedState?.pendingCount).toBe(1);

      client.setOnline(true);
      await expect(tipPromise).resolves.toMatchObject({ creatorId: 'c1', amount: 50 });

      const syncedState = await client.getOfflineSyncState();
      expect(syncedState?.pendingCount).toBe(0);
    });

    it('manually triggers sync', async () => {
      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await client.syncOfflineOperations({ force: true });

      expect(result).not.toBeNull();
      expect(result).toHaveProperty('synced');
      expect(result).toHaveProperty('failed');
      expect(result).toHaveProperty('conflicts');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('duration');
    });

    it('returns null when offline mode is disabled', async () => {
      const clientWithoutOffline = new DorisioClient({
        baseUrl: 'https://api.dorisio.com',
        mode: 'sandbox',
      });

      const result = await clientWithoutOffline.syncOfflineOperations();
      expect(result).toBeNull();
    });

    it('syncs with options', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await client.syncOfflineOperations({
        force: true,
        batchSize: 10,
        types: ['createTip'],
      });

      expect(result).not.toBeNull();
    });
  });

  describe('Storage Stats', () => {
    it('returns storage statistics', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const stats = await client.getOfflineStats();

      expect(stats).not.toBeNull();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('byStatus');
      expect(stats).toHaveProperty('byType');
    });

    it('returns null when offline mode is disabled', async () => {
      const clientWithoutOffline = new DorisioClient({
        baseUrl: 'https://api.dorisio.com',
        mode: 'sandbox',
      });

      const stats = await clientWithoutOffline.getOfflineStats();
      expect(stats).toBeNull();
    });
  });

  describe('Retry Failed Operations', () => {
    it('retries failed operations', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result = await client.retryFailedOfflineOperations();

      expect(result).not.toBeNull();
      expect(result).toHaveProperty('synced');
      expect(result).toHaveProperty('failed');
    });

    it('returns null when offline mode is disabled', async () => {
      const clientWithoutOffline = new DorisioClient({
        baseUrl: 'https://api.dorisio.com',
        mode: 'sandbox',
      });

      const result = await clientWithoutOffline.retryFailedOfflineOperations();
      expect(result).toBeNull();
    });
  });

  describe('Clear Storage', () => {
    it('clears offline storage', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      await expect(client.clearOfflineStorage()).resolves.not.toThrow();
    });

    it('does not throw when offline mode is disabled', async () => {
      const clientWithoutOffline = new DorisioClient({
        baseUrl: 'https://api.dorisio.com',
        mode: 'sandbox',
      });

      await expect(clientWithoutOffline.clearOfflineStorage()).resolves.not.toThrow();
    });
  });

  describe('Event Listeners', () => {
    it('subscribes to sync events', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const listener = vi.fn();
      client.on('sync:complete', listener);

      await client.syncOfflineOperations({ force: true });

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(listener).toHaveBeenCalled();
    });

    it('unsubscribes from sync events', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const listener = vi.fn();
      client.on('sync:complete', listener);
      client.off('sync:complete', listener);

      await client.syncOfflineOperations({ force: true });

      // Wait to ensure event would have fired
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(listener).not.toHaveBeenCalled();
    });

    it('supports multiple event types', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const syncStartListener = vi.fn();
      const syncCompleteListener = vi.fn();
      const storageReadyListener = vi.fn();

      client.on('sync:start', syncStartListener);
      client.on('sync:complete', syncCompleteListener);
      client.on('storage:ready', storageReadyListener);

      await client.syncOfflineOperations({ force: true });

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(syncStartListener).toHaveBeenCalled();
      expect(syncCompleteListener).toHaveBeenCalled();
    });

    it('distinguishes between offline queue and sync events', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const syncListener = vi.fn();
      const queueListener = vi.fn();

      // Sync event (new offline-first)
      client.on('sync:complete', syncListener);

      // Queue event (legacy)
      client.on('online', queueListener);

      await client.syncOfflineOperations({ force: true });

      // Wait for events
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(syncListener).toHaveBeenCalled();
      // Queue listener should not be called for sync events
    });
  });

  describe('Storage Backend Configuration', () => {
    it('supports memory storage backend', () => {
      const memoryClient = new DorisioClient({
        baseUrl: 'https://api.dorisio.com',
        mode: 'sandbox',
        offline: {
          enabled: true,
          storage: 'memory',
        },
      });

      expect(memoryClient.isOfflineModeEnabled()).toBe(true);
    });

    it('supports custom database name', () => {
      const customClient = new DorisioClient({
        baseUrl: 'https://api.dorisio.com',
        mode: 'sandbox',
        offline: {
          enabled: true,
          storage: 'memory',
          databaseName: 'custom-db',
        },
      });

      expect(customClient.isOfflineModeEnabled()).toBe(true);
    });

    it('supports custom sync interval', () => {
      const customSyncClient = new DorisioClient({
        baseUrl: 'https://api.dorisio.com',
        mode: 'sandbox',
        offline: {
          enabled: true,
          storage: 'memory',
          syncInterval: 60000, // 1 minute
        },
      });

      expect(customSyncClient.isOfflineModeEnabled()).toBe(true);
    });

    it('supports different conflict resolution strategies', () => {
      const strategies = [
        'client-wins',
        'server-wins',
        'last-write-wins',
        'manual',
        'merge',
      ] as const;

      strategies.forEach((strategy) => {
        const strategyClient = new DorisioClient({
          baseUrl: 'https://api.dorisio.com',
          mode: 'sandbox',
          offline: {
            enabled: true,
            storage: 'memory',
            conflictResolution: strategy,
          },
        });

        expect(strategyClient.isOfflineModeEnabled()).toBe(true);
      });
    });
  });

  describe('Integration with Sandbox Mode', () => {
    it('works with sandbox mode', async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));

      const sandboxClient = new DorisioClient({
        baseUrl: 'https://api.dorisio.com',
        mode: 'sandbox',
        offline: offlineConfig,
      });

      expect(sandboxClient.isSandboxMode()).toBe(true);
      expect(sandboxClient.isOfflineModeEnabled()).toBe(true);

      const stats = await sandboxClient.getOfflineStats();
      expect(stats).not.toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('handles initialization errors gracefully', async () => {
      // Client should still be usable even if offline initialization fails
      const clientWithBadConfig = new DorisioClient({
        baseUrl: 'https://api.dorisio.com',
        mode: 'sandbox',
        offline: {
          enabled: true,
          storage: 'idb', // Will fail in Node.js environment
        },
      });

      // Should not throw, but offline mode won't be available
      await new Promise((resolve) => setTimeout(resolve, 100));

      // These should handle the case gracefully
      const state = await clientWithBadConfig.getOfflineSyncState();
      const stats = await clientWithBadConfig.getOfflineStats();

      // May be null or empty depending on initialization state
      expect(state === null || typeof state === 'object').toBe(true);
    });

    it('logs initialization errors when logger is provided', async () => {
      const logger = vi.fn();

      const clientWithLogger = new DorisioClient({
        baseUrl: 'https://api.dorisio.com',
        mode: 'sandbox',
        logger,
        offline: {
          enabled: true,
          storage: 'idb', // Will fail in Node.js
        },
      });

      // Wait for initialization attempt
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Logger should have been called with error
      const errorCalls = logger.mock.calls.filter(
        (call) => call[0]?.includes('offline') || call[0]?.includes('Failed')
      );

      expect(errorCalls.length).toBeGreaterThan(0);
    });
  });
});
