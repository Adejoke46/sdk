/**
 * Client-side Analytics Tracking (Issue #60)
 *
 * Records every operation the SDK performs and exposes the observability the
 * client was missing:
 *
 * - method call counts (per operation)
 * - success / error rates
 * - performance metrics (avg, min, max and p50/p95/p99 latency)
 * - error patterns (which operation fails, and why)
 * - event streaming, so a host app can forward events to its backend
 * - exportable snapshots (JSON / CSV)
 *
 * The tracker is intentionally dependency free and side-effect free: it only
 * aggregates what it is told, so it can be used from `.request()` without
 * changing request behaviour.
 */

export interface AnalyticsOptions {
  /** Record operations. Defaults to `true`. */
  enabled?: boolean;
  /** Latency samples retained per operation for percentile math. Defaults to `500`. */
  sampleSize?: number;
  /** Listener registered immediately on construction. */
  onEvent?: AnalyticsListener;
}

export interface AnalyticsEntry {
  /** Operation label, e.g. `POST /tips`. */
  method: string;
  /** Wall-clock duration of the operation in milliseconds. */
  latency: number;
  /** Whether the operation completed without throwing. */
  success: boolean;
  /** HTTP status code when the failure carried one. */
  statusCode?: number;
  /** Machine-readable error code, e.g. `NETWORK_ERROR`. */
  errorCode?: string;
  /** Human readable error message. */
  errorMessage?: string;
}

export interface MethodAnalytics {
  calls: number;
  successes: number;
  errors: number;
  successRate: number;
  errorRate: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface ErrorPattern {
  method: string;
  reason: string;
  count: number;
}

export interface AnalyticsSnapshot {
  startedAt: string;
  updatedAt: string;
  calls: number;
  successes: number;
  errors: number;
  successRate: number;
  errorRate: number;
  avgLatency: number;
  methods: Record<string, MethodAnalytics>;
  errorPatterns: ErrorPattern[];
}

export interface AnalyticsEvent {
  type: 'request';
  timestamp: string;
  entry: AnalyticsEntry;
  snapshot: AnalyticsSnapshot;
}

export type AnalyticsListener = (event: AnalyticsEvent) => void;

export type AnalyticsExportFormat = 'json' | 'csv';

interface MethodBucket {
  calls: number;
  successes: number;
  errors: number;
  totalLatency: number;
  minLatency: number;
  maxLatency: number;
  samples: number[];
}

const DEFAULT_SAMPLE_SIZE = 500;

function round(value: number, decimals = 3): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function rate(part: number, total: number): number {
  if (total <= 0) return 0;
  return round(part / total);
}

/**
 * Nearest-rank percentile over the retained latency samples.
 * Returns `0` for an empty sample set.
 */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const clamped = Math.min(100, Math.max(0, p));
  const rank = Math.ceil((clamped / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}

export class Analytics {
  private enabled: boolean;

  private readonly sampleSize: number;

  private startedAt: number;

  private updatedAt: number;

  private calls = 0;

  private successes = 0;

  private errors = 0;

  private totalLatency = 0;

  private readonly methods = new Map<string, MethodBucket>();

  private readonly errorPatterns = new Map<string, ErrorPattern>();

  private readonly listeners = new Set<AnalyticsListener>();

  constructor(options: AnalyticsOptions = {}) {
    this.enabled = options.enabled !== false;

    const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE;
    this.sampleSize =
      Number.isFinite(sampleSize) && sampleSize > 0
        ? Math.floor(sampleSize)
        : DEFAULT_SAMPLE_SIZE;

    const now = Date.now();
    this.startedAt = now;
    this.updatedAt = now;

    if (options.onEvent) this.listeners.add(options.onEvent);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Record one completed operation. Never throws: listeners are isolated and
   * malformed numbers are normalised so tracking cannot break a request.
   */
  record(entry: AnalyticsEntry): void {
    if (!this.enabled) return;

    const latency =
      Number.isFinite(entry.latency) && entry.latency >= 0 ? entry.latency : 0;
    const method = entry.method || 'unknown';

    this.calls += 1;
    this.totalLatency += latency;
    this.updatedAt = Date.now();
    if (entry.success) {
      this.successes += 1;
    } else {
      this.errors += 1;
    }

    const bucket = this.methods.get(method) ?? {
      calls: 0,
      successes: 0,
      errors: 0,
      totalLatency: 0,
      minLatency: latency,
      maxLatency: latency,
      samples: [],
    };

    bucket.calls += 1;
    bucket.totalLatency += latency;
    if (entry.success) {
      bucket.successes += 1;
    } else {
      bucket.errors += 1;
    }
    bucket.minLatency = Math.min(bucket.minLatency, latency);
    bucket.maxLatency = Math.max(bucket.maxLatency, latency);
    bucket.samples.push(latency);
    if (bucket.samples.length > this.sampleSize) {
      bucket.samples.shift();
    }
    this.methods.set(method, bucket);

    if (!entry.success) {
      const reason =
        entry.errorCode ??
        entry.errorMessage ??
        'HTTP ' + String(entry.statusCode ?? 'ERROR');
      const key = `${method}:${reason}`;
      const pattern = this.errorPatterns.get(key);
      if (pattern) {
        pattern.count += 1;
      } else {
        this.errorPatterns.set(key, { method, reason, count: 1 });
      }
    }

    const recorded: AnalyticsEntry = { ...entry, method, latency };
    this.emit({
      type: 'request',
      timestamp: new Date().toISOString(),
      entry: recorded,
      snapshot: this.getSnapshot(),
    });
  }

  /**
   * Subscribe to live events. Returns an unsubscribe function.
   */
  subscribe(listener: AnalyticsListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Aggregated stats for a single operation, or `undefined` if it never ran.
   */
  getMethodStats(method: string): MethodAnalytics | undefined {
    const bucket = this.methods.get(method);
    return bucket ? this.toMethodAnalytics(bucket) : undefined;
  }

  getSnapshot(): AnalyticsSnapshot {
    const methods: Record<string, MethodAnalytics> = {};
    for (const [method, bucket] of this.methods) {
      methods[method] = this.toMethodAnalytics(bucket);
    }

    return {
      startedAt: new Date(this.startedAt).toISOString(),
      updatedAt: new Date(this.updatedAt).toISOString(),
      calls: this.calls,
      successes: this.successes,
      errors: this.errors,
      successRate: rate(this.successes, this.calls),
      errorRate: rate(this.errors, this.calls),
      avgLatency: round(this.calls > 0 ? this.totalLatency / this.calls : 0),
      methods,
      errorPatterns: [...this.errorPatterns.values()]
        .map((pattern) => ({ ...pattern }))
        .sort((a, b) => b.count - a.count || a.method.localeCompare(b.method)),
    };
  }

  /**
   * Export the current snapshot as pretty JSON or CSV (one row per operation).
   */
  exportMetrics(format: AnalyticsExportFormat = 'json'): string {
    const snapshot = this.getSnapshot();
    if (format === 'csv') return this.toCsv(snapshot);
    return JSON.stringify(snapshot, null, 2);
  }

  /**
   * Drop everything recorded so far, keeping subscribers attached.
   */
  reset(): void {
    const now = Date.now();
    this.startedAt = now;
    this.updatedAt = now;
    this.calls = 0;
    this.successes = 0;
    this.errors = 0;
    this.totalLatency = 0;
    this.methods.clear();
    this.errorPatterns.clear();
  }

  private toMethodAnalytics(bucket: MethodBucket): MethodAnalytics {
    return {
      calls: bucket.calls,
      successes: bucket.successes,
      errors: bucket.errors,
      successRate: rate(bucket.successes, bucket.calls),
      errorRate: rate(bucket.errors, bucket.calls),
      avgLatency: round(
        bucket.calls > 0 ? bucket.totalLatency / bucket.calls : 0
      ),
      minLatency: bucket.minLatency,
      maxLatency: bucket.maxLatency,
      p50: percentile(bucket.samples, 50),
      p95: percentile(bucket.samples, 95),
      p99: percentile(bucket.samples, 99),
    };
  }

  private toCsv(snapshot: AnalyticsSnapshot): string {
    const header = [
      'method',
      'calls',
      'successes',
      'errors',
      'successRate',
      'errorRate',
      'avgLatency',
      'p50',
      'p95',
      'p99',
      'minLatency',
      'maxLatency',
    ].join(',');

    const rows = Object.entries(snapshot.methods)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([method, stats]) =>
        [
          `"${method.replace(/"/g, '""')}"`,
          stats.calls,
          stats.successes,
          stats.errors,
          stats.successRate,
          stats.errorRate,
          stats.avgLatency,
          stats.p50,
          stats.p95,
          stats.p99,
          stats.minLatency,
          stats.maxLatency,
        ].join(',')
      );

    return [header, ...rows].join('\n');
  }

  private emit(event: AnalyticsEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A misbehaving listener must never break the SDK call path.
      }
    }
  }
}
