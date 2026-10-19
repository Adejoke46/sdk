/**
 * Performance Metrics Collection (Issue #36, enhanced by Issue #133)
 *
 * Tracks request latency, error rates, per-method stats, rate-limit encounters,
 * cache hit-rate, and process memory usage. All collection is opt-in so the
 * feature adds zero overhead to callers who do not enable it.
 */

export interface MethodStat {
  count: number;
  avgLatency: number;
}

export interface MetricsSummary {
  requests: number;
  errors: number;
  errorRate: number;
  avgLatency: number;
  rateLimitCount: number;
  cacheHits: number;
  cacheMisses: number;
  /** Ratio of cache hits to total cache lookups (0 - 1); 0 when no lookups. */
  cacheHitRate: number;
  methodStats: Record<string, MethodStat>;
}

/**
 * A memory snapshot. Mirrors the shape of `process.memoryUsage()` so callers can
 * read `heapUsed` and friends directly. `null` when `process` is unavailable
 * (e.g. browser builds), keeping the SDK safe outside Node.
 */
export interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
}

/**
 * Snapshot returned by {@link MetricsCollector.getPerformanceMetrics}. Extends
 * the aggregate summary with a graceful memory reading.
 */
export interface PerformanceMetrics extends MetricsSummary {
  memoryUsage: MemoryUsage | null;
}

export interface MetricRecord {
  /** Method name (e.g. 'createTip', 'getCreator', or HTTP method) */
  method: string;
  /** Request path */
  path?: string;
  /** Elapsed time in milliseconds */
  latency: number;
  /** Whether the request succeeded */
  success: boolean;
  /** HTTP status code */
  statusCode?: number;
  /** Whether a 429 rate limit was encountered */
  rateLimited?: boolean;
  /** Whether an enabled response cache served or missed this request. */
  cacheStatus?: 'hit' | 'miss';
}

export interface CallbackMetrics extends PerformanceMetrics {
  /** Latency of the request that triggered the callback */
  latency: number;
  /** Overall success rate (0 - 1) */
  successRate: number;
}

export type MetricsCallback = (metrics: CallbackMetrics) => void;

export interface MetricsCollectorOptions {
  enabled?: boolean;
  /**
   * Whether to keep aggregated counters for snapshots (default: true).
   * When false, callbacks still fire per request but the aggregate counters
   * are not retained.
   */
  collectMetrics?: boolean;
  callback?: MetricsCallback;
}

/**
 * Opt-in performance monitoring configuration for the client.
 *
 * @example
 * ```ts
 * const client = new DorisioClient({
 *   baseUrl: 'https://api.dorisio.com',
 *   monitoring: {
 *     enabled: true,
 *     collectMetrics: true,
 *     onMetrics: (m) => console.log(m.avgLatency, m.cacheHitRate),
 *   },
 * });
 * const stats = client.getPerformanceMetrics();
 * ```
 */
export interface MonitoringConfig {
  /** Master switch. Disabled by default so monitoring is fully opt-in. */
  enabled?: boolean;
  /** Retain aggregated counters for snapshots (default: true). */
  collectMetrics?: boolean;
  /** Invoked after every recorded request with the aggregated snapshot. */
  onMetrics?: MetricsCallback;
}

export class MetricsCollector {
  private enabled: boolean;
  private collecting: boolean;
  private callback?: MetricsCallback;
  private totalRequests: number = 0;
  private totalErrors: number = 0;
  private totalLatency: number = 0;
  private rateLimitCount: number = 0;
  private cacheHits: number = 0;
  private cacheMisses: number = 0;
  private methodData: Map<string, { count: number; totalLatency: number }> = new Map();

  constructor(options?: MetricsCollectorOptions) {
    this.enabled = options?.enabled ?? false;
    this.collecting = options?.collectMetrics ?? true;
    this.callback = options?.callback;
  }

  /**
   * Check if metrics collection is currently active.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable or disable metrics collection.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Set or remove the callback function.
   */
  setCallback(callback?: MetricsCallback): void {
    this.callback = callback;
  }

  /**
   * Record a completed HTTP request.
   */
  record(entry: MetricRecord): void {
    if (!this.enabled) {
      return;
    }

    if (this.collecting) {
      this.totalRequests++;
      if (!entry.success) {
        this.totalErrors++;
      }
      this.totalLatency += entry.latency;

      if (entry.rateLimited || entry.statusCode === 429) {
        this.rateLimitCount++;
      }
      if (entry.cacheStatus === 'hit') {
        this.cacheHits++;
      } else if (entry.cacheStatus === 'miss') {
        this.cacheMisses++;
      }

      const currentMethod = this.methodData.get(entry.method) || { count: 0, totalLatency: 0 };
      currentMethod.count++;
      currentMethod.totalLatency += entry.latency;
      this.methodData.set(entry.method, currentMethod);
    }

    if (this.callback) {
      const snapshot = this.getPerformanceMetrics();
      const successRate = this.collecting
        ? this.totalRequests > 0
          ? (this.totalRequests - this.totalErrors) / this.totalRequests
          : 1
        : entry.success
          ? 1
          : 0;

      try {
        this.callback({
          ...snapshot,
          latency: entry.latency,
          successRate,
        });
      } catch (err) {
        console.error('[MetricsCollector] Error in metricsCallback:', err);
      }
    }
  }

  /**
   * Get an aggregate summary of performance metrics.
   */
  getMetrics(): MetricsSummary {
    const errorRate =
      this.totalRequests > 0
        ? Math.round((this.totalErrors / this.totalRequests) * 1000) / 1000
        : 0;
    const avgLatency =
      this.totalRequests > 0
        ? Math.round(this.totalLatency / this.totalRequests)
        : 0;

    const methodStats: Record<string, MethodStat> = {};
    for (const [method, data] of this.methodData.entries()) {
      methodStats[method] = {
        count: data.count,
        avgLatency: data.count > 0 ? Math.round(data.totalLatency / data.count) : 0,
      };
    }

    const cacheLookups = this.cacheHits + this.cacheMisses;
    const cacheHitRate =
      cacheLookups > 0 ? Math.round((this.cacheHits / cacheLookups) * 1000) / 1000 : 0;

    return {
      requests: this.totalRequests,
      errors: this.totalErrors,
      errorRate,
      avgLatency,
      rateLimitCount: this.rateLimitCount,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      cacheHitRate,
      methodStats,
    };
  }

  /**
   * Get a full performance snapshot: aggregate metrics plus a memory reading.
   * `memoryUsage` is `null` when `process.memoryUsage()` is unavailable, so the
   * SDK stays safe in browser/edge runtimes.
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return {
      ...this.getMetrics(),
      memoryUsage: this.getMemoryUsage(),
    };
  }

  /**
   * Read `process.memoryUsage()` defensively. Returns `null` outside Node or if
   * the call throws.
   */
  private getMemoryUsage(): MemoryUsage | null {
    const proc = (
      globalThis as {
        process?: { memoryUsage?: () => MemoryUsage };
      }
    ).process;
    if (!proc || typeof proc.memoryUsage !== 'function') {
      return null;
    }
    try {
      const usage = proc.memoryUsage();
      return {
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        rss: usage.rss,
        external: usage.external,
      };
    } catch {
      return null;
    }
  }

  /**
   * Reset all recorded metrics.
   */
  reset(): void {
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.totalLatency = 0;
    this.rateLimitCount = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.methodData.clear();
  }
}
