/**
 * DorisioClient RequestQueue, OfflineQueue, and Metrics Integration Tests
 * Issues #34, #35, #36
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DorisioClient } from '../src/client';

describe('DorisioClient Integration (Issues #34, #35, #36)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Issue #36: collects metrics on requests and calls metricsCallback', async () => {
    const metricsCallback = vi.fn();
    const client = new DorisioClient({
      baseUrl: 'https://api.dorisio.com',
      mode: 'sandbox',
      enableMetrics: true,
      metricsCallback,
    });

    // Perform sandbox calls
    await client.getCreator('creator-1');
    await client.getCreator('creator-2');

    const metrics = client.getMetrics();

    expect(metrics.requests).toBe(2);
    expect(metrics.errors).toBe(0);
    expect(metrics.errorRate).toBe(0);
    expect(metrics.methodStats['GET']).toBeDefined();
    expect(metrics.methodStats['GET']?.count).toBe(2);

    expect(metricsCallback).toHaveBeenCalledTimes(2);
    expect(metricsCallback).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requests: 2,
        successRate: 1,
      })
    );
  });

  it('Issue #35: queues mutations when offline, allows GETs to fail, and replays on online', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.dorisio.com',
      mode: 'sandbox',
      enableOfflineQueue: true,
    });

    const onlineListener = vi.fn();
    const offlineListener = vi.fn();
    const queueProcessedListener = vi.fn();

    client.on('online', onlineListener);
    client.on('offline', offlineListener);
    client.on('queue-processed', queueProcessedListener);

    expect(client.isOnline()).toBe(true);

    // Transition to offline
    client.setOnline(false);
    expect(client.isOnline()).toBe(false);
    expect(offlineListener).toHaveBeenCalledTimes(1);

    // Reads should fail immediately while offline
    await expect(client.getCreator('creator-1')).rejects.toThrow('while offline');

    // Mutations should be queued
    const mutationPromise = client.createTip({
      creatorId: 'c1',
      amount: 25,
    });

    expect(client.getOfflineQueueSize()).toBe(1);

    // Come back online
    client.setOnline(true);
    expect(client.isOnline()).toBe(true);
    expect(onlineListener).toHaveBeenCalledTimes(1);

    // Mutation should resolve once processed
    const tip = await mutationPromise;
    expect(tip).toBeDefined();
    expect(client.getOfflineQueueSize()).toBe(0);
    expect(queueProcessedListener).toHaveBeenCalledTimes(1);
  });

  it('Issue #34: request queue handles concurrent requests and throttles', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.dorisio.com',
      mode: 'sandbox',
      enableRequestQueue: true,
      maxConcurrentRequests: 2,
    });

    const reqQueue = client.getHttpClient().getRequestQueue();
    expect(reqQueue).toBeDefined();
    expect(reqQueue?.maxConcurrent).toBe(2);

    const [c1, c2, c3] = await Promise.all([
      client.getCreator('creator-1'),
      client.getCreator('creator-2'),
      client.getCreator('creator-3'),
    ]);

    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    expect(c3).toBeDefined();
    expect(reqQueue?.getQueueLength()).toBe(0);
  });
});
