/**
 * Throttle Manager
 *
 * Rate-limits outgoing requests to prevent overwhelming the API.
 * Supports global and per-endpoint rate limits with configurable windows.
 */

export interface ThrottleManagerOptions {
  /** Maximum requests per window (default: 10) */
  maxRequests?: number;
  /** Window duration in milliseconds (default: 1000) */
  windowMs?: number;
  /** Per-endpoint overrides: { '/path': { maxRequests, windowMs } } */
  endpointLimits?: Record<string, EndpointThrottleConfig>;
  /** Logger for diagnostics */
  logger?: (message: string, data?: unknown) => void;
}

export interface EndpointThrottleConfig {
  maxRequests: number;
  windowMs: number;
}

interface ThrottleBucket {
  count: number;
  resetAt: number;
}

export class ThrottleManager {
  private globalLimit: number;
  private globalWindow: number;
  private endpointLimits: Record<string, EndpointThrottleConfig>;
  private globalBucket: ThrottleBucket;
  private endpointBuckets = new Map<string, ThrottleBucket>();
  private waitQueue: Array<{ resolve: () => void; timer: ReturnType<typeof setTimeout> }> = [];
  private logger: (message: string, data?: unknown) => void;

  constructor(options?: ThrottleManagerOptions) {
    this.globalLimit = options?.maxRequests ?? 10;
    this.globalWindow = options?.windowMs ?? 1000;
    this.endpointLimits = options?.endpointLimits ?? {};
    this.logger = options?.logger ?? (() => {});
    this.globalBucket = this.createBucket(this.globalWindow);
  }

  /**
   * Check if a request to the given path is allowed.
   * If not, waits until the request can proceed.
   */
  async acquire(path: string): Promise<void> {
    const config = this.endpointLimits[path];
    const windowMs = config?.windowMs ?? this.globalWindow;

    if (config) {
      const bucket = this.getEndpointBucket(path, windowMs);
      if (bucket.count >= config.maxRequests) {
        const waitMs = bucket.resetAt - Date.now();
        if (waitMs > 0) {
          this.logger('[Throttle] Waiting for endpoint limit', { path, waitMs });
          await this.delay(waitMs);
        }
        this.resetBucket(bucket, windowMs);
      }
      bucket.count++;
    }

    if (this.globalBucket.count >= this.globalLimit) {
      const waitMs = this.globalBucket.resetAt - Date.now();
      if (waitMs > 0) {
        this.logger('[Throttle] Waiting for global limit', { waitMs });
        await this.delay(waitMs);
      }
      this.resetBucket(this.globalBucket, this.globalWindow);
    }
    this.globalBucket.count++;
  }

  /**
   * Release a permit (currently a no-op, kept for API symmetry).
   */
  release(): void {}

  /**
   * Get current throttle stats.
   */
  getStats(): { globalRemaining: number; globalWindowMs: number } {
    const now = Date.now();
    const remaining = Math.max(
      0,
      this.globalLimit -
        (this.globalBucket.resetAt > now ? this.globalBucket.count : 0)
    );
    return {
      globalRemaining: remaining,
      globalWindowMs: this.globalWindow,
    };
  }

  /**
   * Update limits at runtime.
   */
  configure(options: { maxRequests?: number; windowMs?: number }): void {
    if (options.maxRequests !== undefined) this.globalLimit = options.maxRequests;
    if (options.windowMs !== undefined) this.globalWindow = options.windowMs;
  }

  private getEndpointBucket(path: string, windowMs: number): ThrottleBucket {
    let bucket = this.endpointBuckets.get(path);
    if (!bucket || bucket.resetAt <= Date.now()) {
      bucket = this.createBucket(windowMs);
      this.endpointBuckets.set(path, bucket);
    }
    return bucket;
  }

  private createBucket(windowMs: number): ThrottleBucket {
    return { count: 0, resetAt: Date.now() + windowMs };
  }

  private resetBucket(bucket: ThrottleBucket, windowMs: number): void {
    bucket.count = 0;
    bucket.resetAt = Date.now() + windowMs;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.waitQueue.push({ resolve, timer });
    });
  }
}
