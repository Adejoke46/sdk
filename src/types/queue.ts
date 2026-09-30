/**
 * Request Queue Types (Issue #134)
 *
 * Public types for the priority request queue. The queue bounds how many
 * requests may run concurrently, optionally serves higher priority requests
 * first, and applies backpressure when it is full.
 */

/**
 * Relative priority of a request. Higher priority requests are served before
 * lower priority ones when `prioritize` is enabled.
 */
export type RequestPriority = 'high' | 'normal' | 'low';

export interface QueueConfig {
  /**
   * Enable the priority request queue. Disabled by default, in which case
   * requests pass straight through with zero queueing overhead.
   */
  enabled?: boolean;
  /** Maximum number of requests allowed in flight at once. Defaults to 5. */
  maxConcurrent?: number;
  /**
   * When `true` (default) higher priority requests are dequeued before lower
   * priority ones. When `false` the queue is plain FIFO, still respecting
   * `maxConcurrent`.
   */
  prioritize?: boolean;
  /**
   * Maximum number of requests allowed to wait before new requests are
   * rejected with a {@link QueueFullError}. Defaults to 1000.
   */
  maxQueueSize?: number;
}

export interface QueueStats {
  /** Requests currently waiting in the queue. */
  queueDepth: number;
  /** Requests currently executing. */
  inFlight: number;
  /** Requests that have left the queue (resolved or rejected). */
  processed: number;
  /** Requests rejected because the queue was full. */
  rejected: number;
  /** Sum of every request's wait time in milliseconds. */
  totalWaitTime: number;
  /** Longest any single request waited before it started, in milliseconds. */
  maxWaitTime: number;
  /** Mean wait time per processed request, in milliseconds. */
  averageWaitTime: number;
}
