/**
 * OfflineQueue Tests (Issue #35)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OfflineQueue } from './offline-queue';
import { NetworkError, ApiError } from '../types/errors';

describe('OfflineQueue', () => {
  let queue: OfflineQueue;

  beforeEach(() => {
    queue = new OfflineQueue({ initialOnline: true, autoListen: false });
  });

  it('detects online and offline status correctly', () => {
    expect(queue.isOnline()).toBe(true);

    queue.setOnline(false);
    expect(queue.isOnline()).toBe(false);

    queue.setOnline(true);
    expect(queue.isOnline()).toBe(true);
  });

  it('emits online and offline events on transitions', () => {
    const onOnline = vi.fn();
    const onOffline = vi.fn();

    queue.on('online', onOnline);
    queue.on('offline', onOffline);

    queue.setOnline(false);
    expect(onOffline).toHaveBeenCalledTimes(1);
    expect(onOnline).not.toHaveBeenCalled();

    queue.setOnline(true);
    expect(onOnline).toHaveBeenCalledTimes(1);
  });

  it('executes requests directly when online', async () => {
    const task = vi.fn().mockResolvedValue({ id: '123' });
    const result = await queue.handleRequest('POST', '/api/v1/tips', task);

    expect(result).toEqual({ id: '123' });
    expect(task).toHaveBeenCalledTimes(1);
    expect(queue.getQueueSize()).toBe(0);
  });

  it('allows reads (GET) to fail immediately when offline', async () => {
    queue.setOnline(false);

    const task = vi.fn().mockResolvedValue({ data: 'something' });

    await expect(
      queue.handleRequest('GET', '/api/v1/transactions/history', task)
    ).rejects.toThrow(NetworkError);

    expect(task).not.toHaveBeenCalled();
    expect(queue.getQueueSize()).toBe(0);
  });

  it('queues mutations (POST/PUT/PATCH/DELETE) when offline', async () => {
    queue.setOnline(false);

    const task1 = vi.fn().mockResolvedValue({ success: true, method: 'POST' });
    const task2 = vi.fn().mockResolvedValue({ success: true, method: 'PUT' });
    const task3 = vi.fn().mockResolvedValue({ success: true, method: 'PATCH' });
    const task4 = vi.fn().mockResolvedValue({ success: true, method: 'DELETE' });

    const p1 = queue.handleRequest('POST', '/api/v1/tip', task1);
    const p2 = queue.handleRequest('PUT', '/api/v1/wallet/1', task2);
    const p3 = queue.handleRequest('PATCH', '/api/v1/wallet/1/name', task3);
    const p4 = queue.handleRequest('DELETE', '/api/v1/wallet/1', task4);

    expect(queue.getQueueSize()).toBe(4);
    expect(task1).not.toHaveBeenCalled();
    expect(task2).not.toHaveBeenCalled();
    expect(task3).not.toHaveBeenCalled();
    expect(task4).not.toHaveBeenCalled();

    // Come back online: should process and resolve all
    const onProcessed = vi.fn();
    queue.on('queue-processed', onProcessed);

    queue.setOnline(true);

    const [r1, r2, r3, r4] = await Promise.all([p1, p2, p3, p4]);

    expect(r1).toEqual({ success: true, method: 'POST' });
    expect(r2).toEqual({ success: true, method: 'PUT' });
    expect(r3).toEqual({ success: true, method: 'PATCH' });
    expect(r4).toEqual({ success: true, method: 'DELETE' });

    expect(queue.getQueueSize()).toBe(0);
    expect(onProcessed).toHaveBeenCalledWith({
      processedCount: 4,
      successCount: 4,
      failureCount: 0,
    });
  });

  it('retries queue in FIFO order when back online', async () => {
    queue.setOnline(false);

    const executionOrder: number[] = [];

    const task1 = vi.fn().mockImplementation(async () => {
      executionOrder.push(1);
      return 1;
    });
    const task2 = vi.fn().mockImplementation(async () => {
      executionOrder.push(2);
      return 2;
    });
    const task3 = vi.fn().mockImplementation(async () => {
      executionOrder.push(3);
      return 3;
    });

    const p1 = queue.handleRequest('POST', '/1', task1);
    const p2 = queue.handleRequest('POST', '/2', task2);
    const p3 = queue.handleRequest('POST', '/3', task3);

    expect(queue.getQueueSize()).toBe(3);

    queue.setOnline(true);

    await Promise.all([p1, p2, p3]);

    expect(executionOrder).toEqual([1, 2, 3]);
  });

  it('handles rejected items during replay without blocking the rest of the queue', async () => {
    queue.setOnline(false);

    const p1 = queue.handleRequest('POST', '/1', async () => {
      throw new ApiError('Validation error', 400);
    });
    const p2 = queue.handleRequest('POST', '/2', async () => ({ ok: true }));

    queue.setOnline(true);

    await expect(p1).rejects.toThrow('Validation error');
    await expect(p2).resolves.toEqual({ ok: true });
    expect(queue.getQueueSize()).toBe(0);
  });

  it('supports clearQueue() to reject pending items', async () => {
    queue.setOnline(false);

    const p1 = queue.handleRequest('POST', '/item', async () => 'data');
    expect(queue.getQueueSize()).toBe(1);

    queue.clearQueue(new Error('User cancelled'));

    await expect(p1).rejects.toThrow('User cancelled');
    expect(queue.getQueueSize()).toBe(0);
  });
});
