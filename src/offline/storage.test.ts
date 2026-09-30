/**
 * Storage Backend Tests (Issue #129)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStorage, IndexedDBStorage, SQLiteStorage, createStorageBackend } from './storage';
import type { QueuedOperation } from '../types/offline';

describe('MemoryStorage', () => {
  let storage: MemoryStorage;

  beforeEach(async () => {
    storage = new MemoryStorage({ maxOperations: 10 });
    await storage.initialize();
  });

  it('initializes successfully', async () => {
    const newStorage = new MemoryStorage();
    await expect(newStorage.initialize()).resolves.not.toThrow();
  });

  it('saves and retrieves operations', async () => {
    const operation: QueuedOperation = {
      id: 'op1',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      data: { amount: 100 },
      status: 'pending',
      timestamp: Date.now(),
      attempts: 0,
    };

    await storage.saveOperation(operation);
    const retrieved = await storage.getOperation('op1');

    expect(retrieved).toEqual(operation);
  });

  it('updates operations', async () => {
    const operation: QueuedOperation = {
      id: 'op1',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'pending',
      timestamp: Date.now(),
      attempts: 0,
    };

    await storage.saveOperation(operation);
    await storage.updateOperation('op1', { status: 'synced', attempts: 1 });

    const updated = await storage.getOperation('op1');
    expect(updated?.status).toBe('synced');
    expect(updated?.attempts).toBe(1);
  });

  it('deletes operations', async () => {
    const operation: QueuedOperation = {
      id: 'op1',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'pending',
      timestamp: Date.now(),
      attempts: 0,
    };

    await storage.saveOperation(operation);
    await storage.deleteOperation('op1');

    const retrieved = await storage.getOperation('op1');
    expect(retrieved).toBeNull();
  });

  it('filters operations by status', async () => {
    await storage.saveOperation({
      id: 'op1',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'pending',
      timestamp: Date.now(),
      attempts: 0,
    });

    await storage.saveOperation({
      id: 'op2',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'synced',
      timestamp: Date.now(),
      attempts: 1,
    });

    const pending = await storage.getOperations({ status: 'pending' });
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('op1');
  });

  it('filters operations by type', async () => {
    await storage.saveOperation({
      id: 'op1',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'pending',
      timestamp: Date.now(),
      attempts: 0,
    });

    await storage.saveOperation({
      id: 'op2',
      type: 'createWallet',
      method: 'POST',
      path: '/api/v1/wallets',
      status: 'pending',
      timestamp: Date.now(),
      attempts: 0,
    });

    const tips = await storage.getOperations({ type: 'createTip' });
    expect(tips).toHaveLength(1);
    expect(tips[0].type).toBe('createTip');
  });

  it('sorts operations by timestamp', async () => {
    const now = Date.now();

    await storage.saveOperation({
      id: 'op1',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'pending',
      timestamp: now - 1000,
      attempts: 0,
    });

    await storage.saveOperation({
      id: 'op2',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'pending',
      timestamp: now,
      attempts: 0,
    });

    const ascending = await storage.getOperations({
      sortBy: 'timestamp',
      sortOrder: 'asc',
    });
    expect(ascending[0].id).toBe('op1');
    expect(ascending[1].id).toBe('op2');

    const descending = await storage.getOperations({
      sortBy: 'timestamp',
      sortOrder: 'desc',
    });
    expect(descending[0].id).toBe('op2');
    expect(descending[1].id).toBe('op1');
  });

  it('limits results', async () => {
    for (let i = 0; i < 5; i++) {
      await storage.saveOperation({
        id: `op${i}`,
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        status: 'pending',
        timestamp: Date.now(),
        attempts: 0,
      });
    }

    const limited = await storage.getOperations({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it('enforces max operations limit', async () => {
    // Storage has maxOperations: 10
    for (let i = 0; i < 12; i++) {
      await storage.saveOperation({
        id: `op${i}`,
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        status: 'pending',
        timestamp: Date.now() + i, // Ensure different timestamps
        attempts: 0,
      });
    }

    const count = await storage.getCount();
    expect(count).toBeLessThanOrEqual(10);
  });

  it('returns correct count', async () => {
    await storage.saveOperation({
      id: 'op1',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'pending',
      timestamp: Date.now(),
      attempts: 0,
    });

    await storage.saveOperation({
      id: 'op2',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'synced',
      timestamp: Date.now(),
      attempts: 1,
    });

    const totalCount = await storage.getCount();
    expect(totalCount).toBe(2);

    const pendingCount = await storage.getCount({ status: 'pending' });
    expect(pendingCount).toBe(1);
  });

  it('clears all operations', async () => {
    await storage.saveOperation({
      id: 'op1',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'pending',
      timestamp: Date.now(),
      attempts: 0,
    });

    await storage.clearAll();
    const count = await storage.getCount();
    expect(count).toBe(0);
  });

  it('throws error when not initialized', async () => {
    const uninitializedStorage = new MemoryStorage();

    await expect(
      uninitializedStorage.saveOperation({
        id: 'op1',
        type: 'createTip',
        method: 'POST',
        path: '/api/v1/tips',
        status: 'pending',
        timestamp: Date.now(),
        attempts: 0,
      })
    ).rejects.toThrow('not initialized');
  });

  it('closes successfully', async () => {
    await storage.close();
    await expect(storage.getCount()).rejects.toThrow('not initialized');
  });
});

describe('IndexedDBStorage', () => {
  // Mock IndexedDB
  const mockDB = {
    close: vi.fn(),
    objectStoreNames: { contains: vi.fn(() => false) },
    transaction: vi.fn(),
  };

  const mockTransaction = {
    objectStore: vi.fn(),
  };

  const mockStore = {
    put: vi.fn(() => ({ onsuccess: null, onerror: null })),
    get: vi.fn(() => ({ onsuccess: null, onerror: null, result: null })),
    getAll: vi.fn(() => ({ onsuccess: null, onerror: null, result: [] })),
    delete: vi.fn(() => ({ onsuccess: null, onerror: null })),
    clear: vi.fn(() => ({ onsuccess: null, onerror: null })),
    count: vi.fn(() => ({ onsuccess: null, onerror: null, result: 0 })),
    createIndex: vi.fn(),
  };

  beforeEach(() => {
    mockTransaction.objectStore.mockReturnValue(mockStore);
    mockDB.transaction.mockReturnValue(mockTransaction);
  });

  it('throws error when IndexedDB is not available', async () => {
    const storage = new IndexedDBStorage();
    await expect(storage.initialize()).rejects.toThrow('IndexedDB is not available');
  });
});

describe('SQLiteStorage', () => {
  it('persists queued operations after reopening the database', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dorisio-offline-'));
    const databaseName = join(directory, 'offline.sqlite');
    const operation: QueuedOperation = {
      id: 'persisted-operation',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/transactions/tip',
      data: { creatorId: 'c1', amount: 50 },
      status: 'pending',
      timestamp: Date.now(),
      attempts: 0,
    };

    try {
      const firstStorage = new SQLiteStorage({ databaseName });
      await firstStorage.initialize();
      await firstStorage.saveOperation(operation);
      await firstStorage.close();

      const reopenedStorage = new SQLiteStorage({ databaseName });
      await reopenedStorage.initialize();
      await expect(reopenedStorage.getOperation(operation.id)).resolves.toEqual(operation);
      await reopenedStorage.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('createStorageBackend', () => {
  it('creates MemoryStorage', () => {
    const storage = createStorageBackend('memory');
    expect(storage).toBeInstanceOf(MemoryStorage);
  });

  it('creates IndexedDBStorage', () => {
    const storage = createStorageBackend('idb');
    expect(storage).toBeInstanceOf(IndexedDBStorage);
  });

  it('throws error for unknown backend type', () => {
    expect(() => createStorageBackend('unknown' as any)).toThrow('Unknown storage backend type');
  });

  it('passes options to storage backend', () => {
    const storage = createStorageBackend('memory', {
      databaseName: 'test-db',
      maxOperations: 500,
    });
    expect(storage).toBeInstanceOf(MemoryStorage);
  });
});

describe('Storage filtering and sorting', () => {
  let storage: MemoryStorage;

  beforeEach(async () => {
    storage = new MemoryStorage();
    await storage.initialize();
  });

  it('filters by timestamp range', async () => {
    const now = Date.now();

    await storage.saveOperation({
      id: 'op1',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'pending',
      timestamp: now - 2000,
      attempts: 0,
    });

    await storage.saveOperation({
      id: 'op2',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'pending',
      timestamp: now - 1000,
      attempts: 0,
    });

    await storage.saveOperation({
      id: 'op3',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'pending',
      timestamp: now,
      attempts: 0,
    });

    const filtered = await storage.getOperations({
      after: now - 1500,
      before: now - 500,
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('op2');
  });

  it('sorts by priority', async () => {
    await storage.saveOperation({
      id: 'op1',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'pending',
      timestamp: Date.now(),
      attempts: 0,
      priority: 1,
    });

    await storage.saveOperation({
      id: 'op2',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'pending',
      timestamp: Date.now(),
      attempts: 0,
      priority: 10,
    });

    await storage.saveOperation({
      id: 'op3',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'pending',
      timestamp: Date.now(),
      attempts: 0,
      priority: 5,
    });

    const sorted = await storage.getOperations({
      sortBy: 'priority',
      sortOrder: 'desc',
    });

    expect(sorted[0].id).toBe('op2');
    expect(sorted[1].id).toBe('op3');
    expect(sorted[2].id).toBe('op1');
  });

  it('filters by multiple statuses', async () => {
    await storage.saveOperation({
      id: 'op1',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'pending',
      timestamp: Date.now(),
      attempts: 0,
    });

    await storage.saveOperation({
      id: 'op2',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'synced',
      timestamp: Date.now(),
      attempts: 1,
    });

    await storage.saveOperation({
      id: 'op3',
      type: 'createTip',
      method: 'POST',
      path: '/api/v1/tips',
      status: 'failed',
      timestamp: Date.now(),
      attempts: 3,
    });

    const filtered = await storage.getOperations({
      status: ['pending', 'failed'],
    });

    expect(filtered).toHaveLength(2);
    expect(filtered.map((op) => op.id).sort()).toEqual(['op1', 'op3']);
  });
});
