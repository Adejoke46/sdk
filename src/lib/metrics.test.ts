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
});
