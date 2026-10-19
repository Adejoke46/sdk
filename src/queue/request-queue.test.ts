/**
 * PriorityRequestQueue Tests (Issue #134)
 *
 * Covers priority ordering, FIFO within a level, the maxConcurrent cap,
 * bounded backpressure, prioritize:false FIFO, and queue statistics.
 */

import { describe, it, expect, vi } from 'vitest';
import { PriorityRequestQueue } from './request-queue';
import { QueueFullError } from '../types/errors';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('PriorityRequestQueue', () => {
  it('executes higher priority requests before lower priority ones', async () => {
    const queue = new PriorityRequestQueue({ maxConcurrent: 1 });
    const order: string[] = [];

    const gate = deferred();
    const blocker = queue.enqueue(async () => {
      order.push('blocker');
      await gate.promise;
    });

    expect(queue.inFlightCount).toBe(1);

    const low = queue.enqueue(async () => {
      order.push('low');
    }, 'low');
    const high = queue.enqueue(async () => {
      order.push('high');
    }, 'high');
    const normal = queue.enqueue(async () => {
      order.push('normal');
    });

    gate.resolve();
    await Promise.all([blocker, low, high, normal]);

    expect(order).toEqual(['blocker', 'high', 'normal', 'low']);
  });

  it('preserves FIFO ordering within a single priority level', async () => {
    const queue = new PriorityRequestQueue({ maxConcurrent: 1 });
    const order: string[] = [];

    const gate = deferred();
    const blocker = queue.enqueue(async () => {
      await gate.promise;
    });

    const first = queue.enqueue(async () => {
      order.push('first');
    });
    const second = queue.enqueue(async () => {
      order.push('second');
    });
    const third = queue.enqueue(async () => {
      order.push('third');
    });

    gate.resolve();
    await Promise.all([blocker, first, second, third]);

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('never runs more than maxConcurrent requests at once', async () => {
    const queue = new PriorityRequestQueue({ maxConcurrent: 2 });
    const gates: Array<() => void> = [];
    let active = 0;
    let peak = 0;
    let completed = 0;

    const tasks = Array.from({ length: 6 }, (_, index) =>
      queue.enqueue(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => gates.push(resolve));
        active--;
        completed++;
        return index;
      })
    );

    await flush();
    expect(active).toBe(2);
    expect(queue.inFlightCount).toBe(2);

    while (completed < 6) {
      expect(active).toBeLessThanOrEqual(2);
      expect(gates.length).toBeGreaterThan(0);
      gates.shift()?.();
      await flush();
    }

    await Promise.all(tasks);
    expect(peak).toBe(2);
    expect(completed).toBe(6);
    expect(queue.inFlightCount).toBe(0);
    expect(queue.depth).toBe(0);
  });

  it('rejects with QueueFullError when the waiting queue is at capacity', async () => {
    const queue = new PriorityRequestQueue({ maxConcurrent: 1, maxQueueSize: 2 });

    const gate = deferred();
    const running = queue.enqueue(() => gate.promise);
    const queued1 = queue.enqueue(async () => undefined);
    const queued2 = queue.enqueue(async () => undefined);

    expect(queue.depth).toBe(2);

    await expect(queue.enqueue(async () => undefined)).rejects.toBeInstanceOf(QueueFullError);
    expect(queue.getStats().rejected).toBe(1);

    gate.resolve();
    await Promise.all([running, queued1, queued2]);
  });

  it('prioritize:false behaves as plain FIFO regardless of priority', async () => {
    const queue = new PriorityRequestQueue({ maxConcurrent: 1, prioritize: false });
    const order: string[] = [];

    const gate = deferred();
    const blocker = queue.enqueue(async () => {
      await gate.promise;
    });

    const low = queue.enqueue(async () => {
      order.push('low');
    }, 'low');
    const high = queue.enqueue(async () => {
      order.push('high');
    }, 'high');

    gate.resolve();
    await Promise.all([blocker, low, high]);

    expect(order).toEqual(['low', 'high']);
  });

  it('reports queue depth and wait-time statistics', async () => {
    vi.useFakeTimers();
    try {
      const queue = new PriorityRequestQueue({ maxConcurrent: 1 });

      const gate = deferred();
      const running = queue.enqueue(() => gate.promise);
      const waiting = queue.enqueue(async () => 'ok', 'high');

      expect(queue.depth).toBe(1);
      expect(queue.getStats().queueDepth).toBe(1);
      expect(queue.getStats().inFlight).toBe(1);

      vi.advanceTimersByTime(50);
      gate.resolve();
      await running;
      await waiting;

      const stats = queue.getStats();
      expect(stats.queueDepth).toBe(0);
      expect(stats.inFlight).toBe(0);
      expect(stats.processed).toBe(2);
      expect(stats.rejected).toBe(0);
      expect(stats.maxWaitTime).toBeGreaterThanOrEqual(50);
      expect(stats.averageWaitTime).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clear() rejects every waiting request', async () => {
    const queue = new PriorityRequestQueue({ maxConcurrent: 1 });
    const gate = deferred();
    const running = queue.enqueue(() => gate.promise);
    const queued = queue.enqueue(async () => undefined, 'high');

    queue.clear(new Error('nope'));
    await expect(queued).rejects.toThrow('nope');

    gate.resolve();
    await running;
    expect(queue.depth).toBe(0);
  });
});
