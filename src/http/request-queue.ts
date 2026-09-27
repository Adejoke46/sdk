/**
 * Request Queue
 *
 * FIFO request queue with concurrency control and automatic 429 rate limit backoff.
 */

import { ApiError } from '../types/errors';

export interface RequestQueueOptions {
  /** Maximum number of concurrent requests in flight (default: 5) */
  maxConcurrentRequests?: number;
  /** Initial backoff delay in ms when rate limited without Retry-After (default: 1000) */
  initialBackoffMs?: number;
  /** Maximum backoff delay in ms (default: 30000) */
  maxBackoffMs?: number;
  /** Maximum retry attempts per request upon 429 (default: 3) */
  maxRetries?: number;
}

interface QueuedItem {
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  retries: number;
}

export class RequestQueue {
  private queue: QueuedItem[] = [];
  private inFlight: number = 0;
  private paused: boolean = false;
  private pauseTimer?: ReturnType<typeof setTimeout>;

  public readonly maxConcurrent: number;
  public readonly initialBackoff: number;
  public readonly maxBackoff: number;
  public readonly maxRetries: number;

  constructor(options?: RequestQueueOptions) {
    this.maxConcurrent = options?.maxConcurrentRequests ?? 5;
    this.initialBackoff = options?.initialBackoffMs ?? 1000;
    this.maxBackoff = options?.maxBackoffMs ?? 30000;
    this.maxRetries = options?.maxRetries ?? 3;
  }

  /**
   * Enqueue a request to be executed according to FIFO and concurrency limits.
   */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        task: task as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        retries: 0,
      });
      this.processQueue();
    });
  }

  /**
   * Number of items currently queued waiting for execution.
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Number of requests currently executing in flight.
   */
  getInFlightCount(): number {
    return this.inFlight;
  }

  /**
   * Whether the queue is currently paused (e.g., during rate-limit backoff).
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Explicitly pause queue processing.
   */
  pause(): void {
    this.paused = true;
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = undefined;
    }
  }

  /**
   * Resume queue processing and process queued items.
   */
  resume(): void {
    this.paused = false;
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = undefined;
    }
    this.processQueue();
  }

  /**
   * Clear all pending items from the queue, rejecting them.
   */
  clear(rejectReason: Error = new Error('Queue cleared')): void {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = undefined;
    }
    const pending = [...this.queue];
    this.queue = [];
    for (const item of pending) {
      item.reject(rejectReason);
    }
  }

  /**
   * Process the next item(s) in the queue if capacity permits and not paused.
   */
  private processQueue(): void {
    if (this.paused) {
      return;
    }

    while (this.inFlight < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;
      this.executeItem(item);
    }
  }

  /**
   * Execute an individual queued request.
   */
  private async executeItem(item: QueuedItem): Promise<void> {
    this.inFlight++;

    try {
      const result = await item.task();
      this.inFlight--;
      item.resolve(result);
      this.processQueue();
    } catch (error) {
      this.inFlight--;

      const is429 = this.isRateLimitError(error);

      if (is429 && item.retries < this.maxRetries) {
        item.retries++;
        const backoffMs = this.computeBackoff(error, item.retries);

        // Put the task back at the front of the queue to maintain FIFO order
        this.queue.unshift(item);
        this.paused = true;

        this.pauseTimer = setTimeout(() => {
          this.paused = false;
          this.pauseTimer = undefined;
          this.processQueue();
        }, backoffMs);

        return;
      }

      item.reject(error);
      this.processQueue();
    }
  }

  /**
   * Determine whether an error represents a 429 Too Many Requests response.
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof ApiError && error.statusCode === 429) {
      return true;
    }
    if (typeof error === 'object' && error !== null) {
      const code = (error as { statusCode?: number; status?: number }).statusCode ??
        (error as { statusCode?: number; status?: number }).status;
      if (code === 429) return true;
    }
    return false;
  }

  /**
   * Calculate backoff duration in milliseconds, honoring Retry-After when available.
   */
  private computeBackoff(error: unknown, retryCount: number): number {
    if (error instanceof ApiError && typeof error.retryAfter === 'number' && error.retryAfter > 0) {
      return Math.min(this.maxBackoff, error.retryAfter * 1000);
    }
    if (typeof error === 'object' && error !== null && 'retryAfter' in error) {
      const retryAfter = (error as { retryAfter?: number }).retryAfter;
      if (typeof retryAfter === 'number' && retryAfter > 0) {
        return Math.min(this.maxBackoff, retryAfter * 1000);
      }
    }
    const exponential = this.initialBackoff * Math.pow(2, retryCount - 1);
    return Math.min(this.maxBackoff, exponential);
  }
}
