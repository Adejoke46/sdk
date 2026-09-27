/**
 * RequestQueue Tests (Issue #34)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestQueue } from './request-queue';
import { ApiError } from '../types/errors';

describe('RequestQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes requests immediately when under concurrency limit', async () => {
    const queue = new RequestQueue({ maxConcurrentRequests: 2 });
    const fn1 = vi.fn().mockResolvedValue('res1');
    const fn2 = vi.fn().mockResolvedValue('res2');

    const p1 = queue.enqueue(fn1);
    const p2 = queue.enqueue(fn2);

    expect(queue.getInFlightCount()).toBe(2);
    expect(queue.getQueueLength()).toBe(0);

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('res1');
    expect(r2).toBe('res2');
    expect(queue.getInFlightCount()).toBe(0);
  });

  it('queues requests in FIFO order when concurrency limit is reached', async () => {
    const queue = new RequestQueue({ maxConcurrentRequests: 2 });

    let resolve1: (v: string) => void = () => {};
    let resolve2: (v: string) => void = () => {};
    let resolve3: (v: string) => void = () => {};

    const p1 = queue.enqueue(() => new Promise<string>((r) => (resolve1 = r)));
    const p2 = queue.enqueue(() => new Promise<string>((r) => (resolve2 = r)));
    const p3 = queue.enqueue(() => new Promise<string>((r) => (resolve3 = r)));

    expect(queue.getInFlightCount()).toBe(2);
    expect(queue.getQueueLength()).toBe(1);

    // Resolve first request
    resolve1('one');
    await expect(p1).resolves.toBe('one');

    // Third request should now be picked up from queue
    expect(queue.getInFlightCount()).toBe(2);
    expect(queue.getQueueLength()).toBe(0);

    resolve2('two');
    resolve3('three');
    await expect(p2).resolves.toBe('two');
    await expect(p3).resolves.toBe('three');

    expect(queue.getInFlightCount()).toBe(0);
  });

  it('pauses and automatically retries with backoff on 429 Too Many Requests', async () => {
    const queue = new RequestQueue({
      maxConcurrentRequests: 1,
      initialBackoffMs: 500,
    });

    let attempts = 0;
    const task = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw new ApiError('Rate limit exceeded', 429);
      }
      return 'success after backoff';
    });

    const promise = queue.enqueue(task);

    // After first failure, queue is paused
    await vi.advanceTimersByTimeAsync(10);
    expect(queue.isPaused()).toBe(true);
    expect(queue.getQueueLength()).toBe(1); // unshifted back to queue

    // Advance through the initial backoff (500ms)
    await vi.advanceTimersByTimeAsync(500);

    const result = await promise;
    expect(result).toBe('success after backoff');
    expect(attempts).toBe(2);
    expect(queue.isPaused()).toBe(false);
  });

  it('respects Retry-After header / property when computing backoff', async () => {
    const queue = new RequestQueue({
      maxConcurrentRequests: 1,
      initialBackoffMs: 100,
    });

    let attempts = 0;
    const task = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw new ApiError('Too many requests', 429, 'RATE_LIMIT', 3); // 3 seconds retryAfter
      }
      return 'done';
    });

    const promise = queue.enqueue(task);

    await vi.advanceTimersByTimeAsync(10);
    expect(queue.isPaused()).toBe(true);

    // 2500ms is not enough (needs 3000ms)
    await vi.advanceTimersByTimeAsync(2500);
    expect(attempts).toBe(1);

    // Advance the remaining 500ms
    await vi.advanceTimersByTimeAsync(500);

    const result = await promise;
    expect(result).toBe('done');
    expect(attempts).toBe(2);
  });

  it('exponentially increases backoff for consecutive 429s', async () => {
    const queue = new RequestQueue({
      maxConcurrentRequests: 1,
      initialBackoffMs: 200,
      maxRetries: 3,
    });

    let attempts = 0;
    const task = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts <= 2) {
        throw new ApiError('Rate limited', 429);
      }
      return 'third time is the charm';
    });

    const promise = queue.enqueue(task);

    // First attempt fails immediately, waits 200ms
    await vi.advanceTimersByTimeAsync(10);
    expect(attempts).toBe(1);

    await vi.advanceTimersByTimeAsync(200);
    // Second attempt executed and fails, now waits 200 * 2 = 400ms
    expect(attempts).toBe(2);

    await vi.advanceTimersByTimeAsync(400);
    // Third attempt succeeds
    const res = await promise;
    expect(res).toBe('third time is the charm');
    expect(attempts).toBe(3);
  });

  it('rejects if maxRetries exceeded on 429', async () => {
    const queue = new RequestQueue({
      maxConcurrentRequests: 1,
      initialBackoffMs: 100,
      maxRetries: 2,
    });

    let attempts = 0;
    const task = vi.fn().mockImplementation(async () => {
      attempts++;
      throw new ApiError('Still rate limited', 429);
    });

    const promise = queue.enqueue(task);
    const rejectionPromise = expect(promise).rejects.toThrow('Still rate limited');

    // Attempt 1 -> fails -> wait 100ms
    await vi.advanceTimersByTimeAsync(10);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(100);

    // Attempt 2 -> fails -> wait 200ms
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(200);

    // Attempt 3 -> exceeds maxRetries (2) -> rejects
    expect(attempts).toBe(3);
    await rejectionPromise;
    expect(queue.isPaused()).toBe(false);
  });

  it('does not retry non-429 errors and rejects immediately', async () => {
    const queue = new RequestQueue({ maxConcurrentRequests: 2 });
    const task = vi.fn().mockRejectedValue(new Error('Server error'));

    await expect(queue.enqueue(task)).rejects.toThrow('Server error');
    expect(task).toHaveBeenCalledTimes(1);
    expect(queue.getInFlightCount()).toBe(0);
  });

  it('supports explicit pause(), resume(), and clear()', async () => {
    const queue = new RequestQueue({ maxConcurrentRequests: 1 });
    queue.pause();
    expect(queue.isPaused()).toBe(true);

    const task1 = vi.fn().mockResolvedValue('task1');
    const p1 = queue.enqueue(task1);

    expect(queue.getInFlightCount()).toBe(0);
    expect(queue.getQueueLength()).toBe(1);
    expect(task1).not.toHaveBeenCalled();

    queue.resume();
    expect(queue.isPaused()).toBe(false);
    expect(task1).toHaveBeenCalled();
    await expect(p1).resolves.toBe('task1');

    // Test clear
    queue.pause();
    const task2 = vi.fn().mockResolvedValue('task2');
    const p2 = queue.enqueue(task2);
    queue.clear(new Error('Queue aborted'));

    await expect(p2).rejects.toThrow('Queue aborted');
    expect(queue.getQueueLength()).toBe(0);
  });
});
