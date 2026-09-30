/**
 * Priority Request Queue (Issue #134)
 *
 * A small, dependency-free request queue that:
 *  - caps the number of requests in flight (`maxConcurrent`),
 *  - serves higher priority requests first when `prioritize` is enabled,
 *  - keeps FIFO ordering within each priority level,
 *  - applies bounded backpressure, rejecting with a `QueueFullError` once the
 *    waiting queue reaches `maxQueueSize`.
 *
 * The queue is intentionally decoupled from the HTTP layer: callers enqueue a
 * task and receive the promise for its eventual result.
 */

import { QueueFullError } from '../types/errors';
import type { QueueStats, RequestPriority } from '../types/queue';

export interface PriorityRequestQueueOptions {
  /** Maximum number of requests allowed in flight at once (default: 5). */
  maxConcurrent?: number;
  /** Serve higher priority requests first (default: true). */
  prioritize?: boolean;
  /** Maximum number of waiting requests before backpressure kicks in (default: 1000). */
  maxQueueSize?: number;
}

interface QueueEntry {
  task: () => Promise<unknown>;
  priority: RequestPriority;
  sequence: number;
  enqueuedAt: number;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

const DEFAULT_MAX_CONCURRENT = 5;
const DEFAULT_MAX_QUEUE_SIZE = 1000;
const DEFAULT_PRIORITY: RequestPriority = 'normal';

export class PriorityRequestQueue {
  private readonly high: QueueEntry[] = [];
  private readonly normal: QueueEntry[] = [];
  private readonly low: QueueEntry[] = [];
  private readonly maxConcurrent: number;
  private readonly prioritize: boolean;
  private readonly maxQueueSize: number;
  private inFlight = 0;
  private sequence = 0;
  private processed = 0;
  private rejected = 0;
  private totalWaitTime = 0;
  private maxWaitTime = 0;

  constructor(options: PriorityRequestQueueOptions = {}) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
    this.prioritize = options.prioritize ?? true;
    this.maxQueueSize = Math.max(0, options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE);
  }

  /** Number of requests waiting for a slot. */
  get depth(): number {
    return this.high.length + this.normal.length + this.low.length;
  }

  /** Number of requests currently executing. */
  get inFlightCount(): number {
    return this.inFlight;
  }

  /**
   * Enqueue a task. Rejects immediately with {@link QueueFullError} when the
   * waiting queue is at capacity.
   */
  enqueue<T>(task: () => Promise<T>, priority: RequestPriority = DEFAULT_PRIORITY): Promise<T> {
    if (this.depth >= this.maxQueueSize) {
      this.rejected++;
      return Promise.reject(new QueueFullError(this.maxQueueSize));
    }

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry = {
        task: task as () => Promise<unknown>,
        priority,
        sequence: this.sequence++,
        enqueuedAt: Date.now(),
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      this.bucket(priority).push(entry);
      this.drain();
    });
  }

  /** Snapshot of queue depth, concurrency, throughput, and wait-time stats. */
  getStats(): QueueStats {
    return {
      queueDepth: this.depth,
      inFlight: this.inFlight,
      processed: this.processed,
      rejected: this.rejected,
      totalWaitTime: this.totalWaitTime,
      maxWaitTime: this.maxWaitTime,
      averageWaitTime: this.processed > 0 ? this.totalWaitTime / this.processed : 0,
    };
  }

  /** Discard all waiting requests, rejecting each with `reason`. */
  clear(reason: Error = new Error('Request queue cleared')): void {
    for (const bucket of [this.high, this.normal, this.low]) {
      for (const entry of bucket) {
        entry.reject(reason);
      }
      bucket.length = 0;
    }
  }

  private bucket(priority: RequestPriority): QueueEntry[] {
    if (priority === 'high') return this.high;
    if (priority === 'low') return this.low;
    return this.normal;
  }

  private dequeue(): QueueEntry | undefined {
    if (this.prioritize) {
      return this.high.shift() ?? this.normal.shift() ?? this.low.shift();
    }

    // Plain FIFO across every priority level: take the globally oldest entry.
    let oldest: QueueEntry | undefined;
    for (const head of [this.high[0], this.normal[0], this.low[0]]) {
      if (head && (!oldest || head.sequence < oldest.sequence)) {
        oldest = head;
      }
    }
    if (oldest) {
      this.bucket(oldest.priority).shift();
    }
    return oldest;
  }

  private drain(): void {
    while (this.inFlight < this.maxConcurrent) {
      const entry = this.dequeue();
      if (!entry) return;
      this.execute(entry);
    }
  }

  private execute(entry: QueueEntry): void {
    this.inFlight++;
    const waitTime = Date.now() - entry.enqueuedAt;
    this.totalWaitTime += waitTime;
    if (waitTime > this.maxWaitTime) {
      this.maxWaitTime = waitTime;
    }

    entry.task().then(
      (value) => {
        this.inFlight--;
        this.processed++;
        entry.resolve(value);
        this.drain();
      },
      (error: unknown) => {
        this.inFlight--;
        this.processed++;
        entry.reject(error);
        this.drain();
      }
    );
  }
}
