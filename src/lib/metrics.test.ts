/**
 * MetricsCollector Tests (Issue #36)
 */

import { describe, it, expect, vi } from 'vitest';
import { MetricsCollector } from './metrics';

describe('MetricsCollector', () => {
  it('records request latency and aggregates method stats', () => {
    const metrics = new MetricsCollector({ enabled: true });

    metrics.record({ method: 'createTip', latency: 400, success: true });
    metrics.record({ method: 'createTip', latency: 500, success: true });
    metrics.record({ method: 'getCreator', latency: 150, success: true });

    const summary = metrics.getMetrics();
    expect(summary.requests).toBe(3);
    expect(summary.errors).toBe(0);
    expect(summary.errorRate).toBe(0);
    expect(summary.avgLatency).toBe(350); // (400+500+150)/3 = 350

    expect(summary.methodStats['createTip']).toEqual({
      count: 2,
      avgLatency: 450,
    });
    expect(summary.methodStats['getCreator']).toEqual({
      count: 1,
      avgLatency: 150,
    });
  });

  it('calculates error counts, errorRate, and rateLimit encounters', () => {
    const metrics = new MetricsCollector({ enabled: true });

    metrics.record({ method: 'createTip', latency: 100, success: true });
    metrics.record({ method: 'createTip', latency: 200, success: false, statusCode: 500 });
    metrics.record({ method: 'getCreator', latency: 300, success: false, statusCode: 429 });

    const summary = metrics.getMetrics();
    expect(summary.requests).toBe(3);
    expect(summary.errors).toBe(2);
    expect(summary.errorRate).toBe(0.667);
    expect(summary.rateLimitCount).toBe(1);
  });

  it('triggers metricsCallback with latency and successRate', () => {
    const callback = vi.fn();
    const metrics = new MetricsCollector({ enabled: true, callback });

    metrics.record({ method: 'createTip', latency: 250, success: true });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        requests: 1,
        errors: 0,
        latency: 250,
        successRate: 1,
      })
    );

    metrics.record({ method: 'createTip', latency: 350, success: false });

    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith(
      expect.objectContaining({
        requests: 2,
        errors: 1,
        latency: 350,
        successRate: 0.5,
      })
    );
  });

  it('does not record when disabled', () => {
    const metrics = new MetricsCollector({ enabled: false });

    metrics.record({ method: 'createTip', latency: 200, success: true });

    const summary = metrics.getMetrics();
    expect(summary.requests).toBe(0);
    expect(summary.methodStats).toEqual({});
  });

  it('resets metrics when reset() is called', () => {
    const metrics = new MetricsCollector({ enabled: true });

    metrics.record({ method: 'createTip', latency: 200, success: true });
    expect(metrics.getMetrics().requests).toBe(1);

    metrics.reset();
    expect(metrics.getMetrics().requests).toBe(0);
    expect(metrics.getMetrics().methodStats).toEqual({});
  });

  it('tracks cache hits and misses', () => {
    const metrics = new MetricsCollector({ enabled: true });

    metrics.record({ method: 'GET', latency: 0, success: true, cacheStatus: 'hit' });
    metrics.record({ method: 'GET', latency: 25, success: true, cacheStatus: 'miss' });

    expect(metrics.getMetrics()).toMatchObject({ cacheHits: 1, cacheMisses: 1 });
  });

  it('aggregates latency per request and per method', () => {
    const metrics = new MetricsCollector({ enabled: true });

    metrics.record({ method: 'getCreator', latency: 10, success: true });
    metrics.record({ method: 'getCreator', latency: 20, success: true });
    metrics.record({ method: 'createTip', latency: 90, success: true });

    const summary = metrics.getMetrics();
    expect(summary.requests).toBe(3);
    expect(summary.avgLatency).toBe(40); // (10 + 20 + 90) / 3
    expect(summary.methodStats['getCreator']).toEqual({ count: 2, avgLatency: 15 });
    expect(summary.methodStats['createTip']).toEqual({ count: 1, avgLatency: 90 });
  });

  it('computes cacheHitRate from hits and misses', () => {
    const metrics = new MetricsCollector({ enabled: true });

    metrics.record({ method: 'GET', latency: 5, success: true, cacheStatus: 'hit' });
    metrics.record({ method: 'GET', latency: 5, success: true, cacheStatus: 'hit' });
    metrics.record({ method: 'GET', latency: 5, success: true, cacheStatus: 'hit' });
    metrics.record({ method: 'GET', latency: 5, success: true, cacheStatus: 'miss' });

    expect(metrics.getMetrics().cacheHitRate).toBe(0.75);

    const empty = new MetricsCollector({ enabled: true });
    expect(empty.getMetrics().cacheHitRate).toBe(0);
  });

  it('exposes getPerformanceMetrics() with memory usage on Node', () => {
    const metrics = new MetricsCollector({ enabled: true });
    metrics.record({ method: 'getCreator', latency: 30, success: true });

    const snapshot = metrics.getPerformanceMetrics();
    expect(snapshot).toMatchObject({
      requests: 1,
      errors: 0,
      avgLatency: 30,
      cacheHitRate: 0,
      methodStats: { getCreator: { count: 1, avgLatency: 30 } },
    });
    expect(snapshot.memoryUsage).not.toBeNull();
    expect(typeof snapshot.memoryUsage?.heapUsed).toBe('number');
    expect(snapshot.memoryUsage?.heapUsed).toBeGreaterThan(0);
  });

  it('omits memory usage when process.memoryUsage is unavailable', () => {
    const metrics = new MetricsCollector({ enabled: true });
    const spy = vi.spyOn(process, 'memoryUsage').mockImplementation(() => {
      throw new Error('not available');
    });

    try {
      expect(metrics.getPerformanceMetrics().memoryUsage).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('includes cacheHitRate and memoryUsage in the per-request callback', () => {
    const callback = vi.fn();
    const metrics = new MetricsCollector({ enabled: true, callback });

    metrics.record({ method: 'GET', latency: 12, success: true, cacheStatus: 'hit' });

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        requests: 1,
        latency: 12,
        cacheHitRate: 1,
        successRate: 1,
      })
    );
    expect(callback.mock.calls[0]?.[0].memoryUsage).not.toBeNull();
  });

  it('skips aggregation but still fires callbacks when collectMetrics is false', () => {
    const callback = vi.fn();
    const metrics = new MetricsCollector({ enabled: true, collectMetrics: false, callback });

    metrics.record({ method: 'GET', latency: 12, success: true });

    expect(metrics.getMetrics().requests).toBe(0);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ latency: 12, requests: 0 }));
  });
});
