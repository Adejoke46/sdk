/**
 * Analytics Tests (Issue #60)
 */

import { describe, it, expect, vi } from 'vitest';
import { Analytics, percentile } from './analytics';

describe('percentile', () => {
  it('uses nearest-rank on the retained samples', () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([10], 99)).toBe(10);
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 100)).toBe(5);
  });
});

describe('Analytics', () => {
  it('tracks call counts plus success and error rates', () => {
    const analytics = new Analytics({ enabled: true });

    analytics.record({ method: 'createTip', latency: 400, success: true });
    analytics.record({ method: 'createTip', latency: 500, success: true });
    analytics.record({ method: 'createTip', latency: 600, success: false, errorCode: 'TIMEOUT' });
    analytics.record({ method: 'getCreator', latency: 150, success: true });

    const snapshot = analytics.getSnapshot();
    expect(snapshot.calls).toBe(4);
    expect(snapshot.successes).toBe(3);
    expect(snapshot.errors).toBe(1);
    expect(snapshot.successRate).toBe(0.75);
    expect(snapshot.errorRate).toBe(0.25);

    expect(snapshot.methods['createTip']).toMatchObject({
      calls: 3,
      successes: 2,
      errors: 1,
      successRate: 0.667,
      errorRate: 0.333,
    });
    expect(snapshot.methods['getCreator']).toMatchObject({
      calls: 1,
      successes: 1,
      errors: 0,
      successRate: 1,
      errorRate: 0,
    });
  });

  it('calculates average, min, max and p50/p95/p99 latency', () => {
    const analytics = new Analytics({ enabled: true });

    for (const latency of [100, 120, 140, 160, 180, 200, 220, 240, 260, 300]) {
      analytics.record({ method: 'createTip', latency, success: true });
    }

    const stats = analytics.getMethodStats('createTip');
    expect(stats?.calls).toBe(10);
    expect(stats?.avgLatency).toBe(192);
    expect(stats?.minLatency).toBe(100);
    expect(stats?.maxLatency).toBe(300);
    expect(stats?.p50).toBe(180);
    expect(stats?.p95).toBe(300);
    expect(stats?.p99).toBe(300);

    expect(analytics.getMethodStats('neverCalled')).toBeUndefined();
    expect(analytics.getSnapshot().avgLatency).toBe(192);
  });

  it('bounds retained samples so percentiles stay cheap', () => {
    const analytics = new Analytics({ enabled: true, sampleSize: 3 });

    for (const latency of [10, 20, 30, 40, 50]) {
      analytics.record({ method: 'createTip', latency, success: true });
    }

    const stats = analytics.getMethodStats('createTip');
    // Only the last three samples survive, but counts are unaffected.
    expect(stats?.calls).toBe(5);
    expect(stats?.p50).toBe(40);
    expect(stats?.minLatency).toBe(10);
    expect(stats?.maxLatency).toBe(50);
  });

  it('groups failures into error patterns ordered by frequency', () => {
    const analytics = new Analytics({ enabled: true });

    analytics.record({ method: 'createTip', latency: 10, success: false, errorCode: 'NETWORK_ERROR' });
    analytics.record({ method: 'createTip', latency: 12, success: false, errorCode: 'NETWORK_ERROR' });
    analytics.record({ method: 'getCreator', latency: 5, success: false, statusCode: 500 });
    analytics.record({ method: 'getCreator', latency: 30, success: true });

    expect(analytics.getSnapshot().errorPatterns).toEqual([
      { method: 'createTip', reason: 'NETWORK_ERROR', count: 2 },
      { method: 'getCreator', reason: 'HTTP 500', count: 1 },
    ]);
  });

  it('streams events to subscribers and stops after unsubscribe', () => {
    const analytics = new Analytics({ enabled: true });
    const listener = vi.fn();
    const unsubscribe = analytics.subscribe(listener);

    analytics.record({ method: 'createTip', latency: 42, success: true });

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0];
    expect(event.type).toBe('request');
    expect(event.entry).toEqual({ method: 'createTip', latency: 42, success: true });
    expect(event.snapshot.calls).toBe(1);
    expect(typeof event.timestamp).toBe('string');

    unsubscribe();
    analytics.record({ method: 'createTip', latency: 10, success: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('supports a listener supplied through options', () => {
    const listener = vi.fn();
    const analytics = new Analytics({ enabled: true, onEvent: listener });

    analytics.record({ method: 'getCreator', latency: 5, success: true });

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps recording when a listener throws', () => {
    const analytics = new Analytics({ enabled: true });
    analytics.subscribe(() => {
      throw new Error('listener exploded');
    });
    analytics.subscribe(() => {
      // still attached
    });

    expect(() =>
      analytics.record({ method: 'createTip', latency: 10, success: true })
    ).not.toThrow();
    expect(analytics.getSnapshot().calls).toBe(1);
  });

  it('exports metrics as JSON and CSV', () => {
    const analytics = new Analytics({ enabled: true });
    analytics.record({ method: 'createTip', latency: 100, success: true });
    analytics.record({ method: 'createTip', latency: 200, success: false, errorCode: 'TIMEOUT' });

    const json = JSON.parse(analytics.exportMetrics('json'));
    expect(json.calls).toBe(2);
    expect(json.errors).toBe(1);
    expect(json.errorRate).toBe(0.5);
    expect(json.methods.createTip.calls).toBe(2);

    const lines = analytics.exportMetrics('csv').split('\n');
    expect(lines[0]).toContain('p99');
    expect(lines[1]).toContain('"createTip"');
    expect(lines[1]).toContain('0.5');
    // Default format is JSON.
    expect(() => JSON.parse(analytics.exportMetrics())).not.toThrow();
  });

  it('does not record while disabled and can be re-enabled', () => {
    const analytics = new Analytics({ enabled: false });
    analytics.record({ method: 'createTip', latency: 200, success: true });

    expect(analytics.isEnabled()).toBe(false);
    expect(analytics.getSnapshot().calls).toBe(0);
    expect(analytics.getSnapshot().methods).toEqual({});

    analytics.setEnabled(true);
    analytics.record({ method: 'createTip', latency: 200, success: true });
    expect(analytics.getSnapshot().calls).toBe(1);
  });

  it('resets all counters and drops error patterns', () => {
    const analytics = new Analytics({ enabled: true });
    analytics.record({ method: 'createTip', latency: 200, success: false, errorCode: 'BOOM' });
    expect(analytics.getSnapshot().calls).toBe(1);

    analytics.reset();

    const snapshot = analytics.getSnapshot();
    expect(snapshot.calls).toBe(0);
    expect(snapshot.successes).toBe(0);
    expect(snapshot.errors).toBe(0);
    expect(snapshot.avgLatency).toBe(0);
    expect(snapshot.methods).toEqual({});
    expect(snapshot.errorPatterns).toEqual([]);
  });

  it('normalises malformed latency values', () => {
    const analytics = new Analytics({ enabled: true });
    analytics.record({ method: 'createTip', latency: Number.NaN, success: true });
    analytics.record({ method: 'createTip', latency: -5, success: true });

    expect(analytics.getSnapshot().avgLatency).toBe(0);
    expect(analytics.getMethodStats('createTip')?.minLatency).toBe(0);
  });
});
