/**
 * DorisioClient Priority Request Queue Integration Tests (Issue #134)
 *
 * Verifies the `queue` client option creates the priority queue, that
 * per-request `priority` flows through the HTTP layer, and that the queue is
 * a zero-overhead pass-through when disabled.
 */

import { describe, it, expect } from 'vitest';
import { DorisioClient } from '../src/client';
import { PriorityRequestQueue } from '../src';

describe('DorisioClient priority request queue (Issue #134)', () => {
  it('creates the queue from client config and routes requests through it', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.dorisio.com',
      mode: 'sandbox',
      queue: { enabled: true, maxConcurrent: 3, prioritize: true },
    });

    const queue = client.getPriorityQueue();
    expect(queue).toBeInstanceOf(PriorityRequestQueue);
    expect(client.getQueueStats()?.queueDepth).toBe(0);

    const http = client.getHttpClient();
    await http.request('/api/v1/creators/creator-1', { method: 'GET', priority: 'high' });
    await http.request('/api/v1/creators/creator-2', { method: 'GET', priority: 'low' });

    const stats = client.getQueueStats();
    expect(stats?.queueDepth).toBe(0);
    expect(stats?.inFlight).toBe(0);
    expect(stats?.processed).toBe(2);
    expect(stats?.rejected).toBe(0);
  });

  it('is a zero-overhead pass-through when the queue is disabled', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.dorisio.com',
      mode: 'sandbox',
    });

    expect(client.getPriorityQueue()).toBeUndefined();
    expect(client.getQueueStats()).toBeUndefined();

    const result = await client
      .getHttpClient()
      .request('/api/v1/creators/creator-1', { method: 'GET' });
    expect(result).toBeDefined();
  });
});
