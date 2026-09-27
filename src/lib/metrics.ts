/**
 * Performance Metrics Collection (Issue #36)
 *
 * Tracks request latency, error rates, per-method stats, and rate-limit encounters.
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
  methodStats: Record<string, MethodStat>;
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
}

export interface CallbackMetrics extends MetricsSummary {
  /** Latency of the request that triggered the callback */
  latency: number;
  /** Overall success rate (0 - 1) */
  successRate: number;
}

export type MetricsCallback = (metrics: CallbackMetrics) => void;

export interface MetricsCollectorOptions {
  enabled?: boolean;
  callback?: MetricsCallback;
}

export class MetricsCollector {
  private enabled: boolean;
  private callback?: MetricsCallback;
  private totalRequests: number = 0;
  private totalErrors: number = 0;
  private totalLatency: number = 0;
  private rateLimitCount: number = 0;
  private methodData: Map<string, { count: number; totalLatency: number }> = new Map();

  constructor(options?: MetricsCollectorOptions) {
    this.enabled = options?.enabled ?? false;
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

    this.totalRequests++;
    if (!entry.success) {
      this.totalErrors++;
    }
    this.totalLatency += entry.latency;

    if (entry.rateLimited || entry.statusCode === 429) {
      this.rateLimitCount++;
    }

    const currentMethod = this.methodData.get(entry.method) || { count: 0, totalLatency: 0 };
    currentMethod.count++;
    currentMethod.totalLatency += entry.latency;
    this.methodData.set(entry.method, currentMethod);

    if (this.callback) {
      const summary = this.getMetrics();
      const successRate =
        this.totalRequests > 0
          ? (this.totalRequests - this.totalErrors) / this.totalRequests
          : 1;

      try {
        this.callback({
          ...summary,
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

    return {
      requests: this.totalRequests,
      errors: this.totalErrors,
      errorRate,
      avgLatency,
      rateLimitCount: this.rateLimitCount,
      methodStats,
    };
  }

  /**
   * Reset all recorded metrics.
   */
  reset(): void {
    this.totalRequests = 0;
    this.totalErrors = 0;
    this.totalLatency = 0;
    this.rateLimitCount = 0;
    this.methodData.clear();
  }
}
