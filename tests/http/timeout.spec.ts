/**
 * Timeout Manager Tests
 *
 * Covers timeout normalisation (min/max clamping, defaults),
 * AbortSignal/controller creation, the original `executeWithTimeout`
 * behaviour (unchanged), and the new tiered timeout with graceful
 * degradation: request timeout, operation timeout, partial data, and
 * manual cancellation via AbortController.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TimeoutManager } from '../../src/http/timeout-manager';
import { TimeoutError } from '../../src/types/errors';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ─── normalizeTimeout ────────────────────────────────────────────────────────

describe('TimeoutManager.normalizeTimeout', () => {
  it('returns the default timeout when no value is provided', () => {
    const mgr = new TimeoutManager({ default: 30000 });
    expect(mgr.normalizeTimeout()).toBe(30000);
  });

  it('clamps to min when the provided value is too small', () => {
    const mgr = new TimeoutManager({ default: 30000, min: 1000, max: 300000 });
    expect(mgr.normalizeTimeout(0)).toBe(1000);
    expect(mgr.normalizeTimeout(500)).toBe(1000);
  });

  it('clamps to max when the provided value is too large', () => {
    const mgr = new TimeoutManager({ default: 30000, min: 1000, max: 300000 });
    expect(mgr.normalizeTimeout(999999)).toBe(300000);
  });

  it('applies sensible defaults when constructor receives no options', () => {
    const mgr = new TimeoutManager();
    expect(mgr.normalizeTimeout()).toBe(30000);
    expect(mgr.normalizeTimeout(0)).toBe(1000);
    expect(mgr.normalizeTimeout(999999)).toBe(300000);
  });
});

// ─── config ──────────────────────────────────────────────────────────────────

describe('TimeoutManager config', () => {
  it('getConfig returns request and operation tiers falling back to default', () => {
    const mgr = new TimeoutManager({ default: 10000 });
    expect(mgr.getConfig()).toEqual({
      default: 10000,
      request: 10000,
      operation: 10000,
      min: 1000,
      max: 300000,
    });
  });

  it('getConfig reflects explicitly configured tiers', () => {
    const mgr = new TimeoutManager({
      default: 30000,
      request: 5000,
      operation: 60000,
      min: 1000,
      max: 300000,
    });
    expect(mgr.getConfig()).toEqual({
      default: 30000,
      request: 5000,
      operation: 60000,
      min: 1000,
      max: 300000,
    });
  });

  it('setConfig partially updates the configuration', () => {
    const mgr = new TimeoutManager({
      default: 30000,
      min: 1000,
      max: 300000,
    });
    mgr.setConfig({ request: 2500 });
    expect(mgr.normalizeTimeout(1)).toBe(1000);
    expect(mgr.getConfig().request).toBe(2500);
  });
});

// ─── createAbortSignal ───────────────────────────────────────────────────────

describe('TimeoutManager.createAbortSignal', () => {
  it('calls AbortSignal.timeout with the normalised timeout', () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const mgr = new TimeoutManager({ default: 30000, min: 1000, max: 300000 });

    mgr.createAbortSignal(7500);

    expect(spy).toHaveBeenCalledWith(7500);
  });

  it('uses the default timeout when no value is given', () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const mgr = new TimeoutManager({ default: 12000 });

    mgr.createAbortSignal();

    expect(spy).toHaveBeenCalledWith(12000);
  });

  it('returns an AbortSignal instance', () => {
    const mgr = new TimeoutManager();
    const signal = mgr.createAbortSignal(5000);
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

// ─── createController ────────────────────────────────────────────────────────

describe('TimeoutManager.createController', () => {
  it('returns a controller whose signal is not aborted initially', () => {
    const mgr = new TimeoutManager({ default: 5000 });
    const controller = mgr.createController();
    expect(controller).toBeInstanceOf(AbortController);
    expect(controller.signal.aborted).toBe(false);
  });

  it('aborts automatically after the (normalised) timeout', async () => {
    const mgr = new TimeoutManager({ default: 5000, min: 1, max: 60000 });
    const controller = mgr.createController(5000);
    expect(controller.signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    expect(controller.signal.aborted).toBe(true);
  });

  it('manual abort clears the timer so it cannot fire after the fact', async () => {
    const mgr = new TimeoutManager({ default: 5000, min: 1, max: 60000 });
    const controller = mgr.createController(5000);
    controller.abort();
    expect(controller.signal.aborted).toBe(true);

    // Advance well past the original timeout: nothing should re-abort or throw.
    await vi.advanceTimersByTimeAsync(60000);
    expect(controller.signal.aborted).toBe(true);
  });

  it('exposes the signal to consumers for passing to operations', () => {
    const mgr = new TimeoutManager({ default: 5000 });
    const controller = mgr.createController();
    expect(controller.signal).toBeInstanceOf(AbortSignal);
    expect(controller.signal.aborted).toBe(false);
  });
});

// ─── executeWithTimeout (existing behaviour preserved) ───────────────────────

describe('TimeoutManager.executeWithTimeout', () => {
  it('resolves with the function result when it completes in time', async () => {
    const mgr = new TimeoutManager({ default: 5000 });
    const fn = vi.fn().mockResolvedValue('data');

    const result = await mgr.executeWithTimeout(fn, 5000);

    expect(result).toBe('data');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('rejects with a TimeoutError when the operation outlives the timeout', async () => {
    const mgr = new TimeoutManager({ default: 5000, min: 1, max: 60000 });
    const promise = mgr.executeWithTimeout(() => new Promise<string>(() => undefined), 5000);

    const rejection = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
  });

  it('aborts the signal it handed the operation when the timeout fires', async () => {
    const mgr = new TimeoutManager({ default: 5000, min: 1, max: 60000 });
    let observed: AbortSignal | undefined;
    const promise = mgr.executeWithTimeout((signal) => {
      observed = signal;
      return new Promise<string>(() => undefined);
    }, 5000);

    expect(observed?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(promise).rejects.toBeInstanceOf(TimeoutError);
    expect(observed?.aborted).toBe(true);
  });

  it('does not abort when the operation completes before the timeout', async () => {
    const mgr = new TimeoutManager({ default: 5000, min: 1, max: 60000 });
    let observed: AbortSignal | undefined;

    const result = await mgr.executeWithTimeout((signal) => {
      observed = signal;
      return Promise.resolve('done');
    }, 5000);

    expect(result).toBe('done');
    expect(observed?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(60000);
    expect(observed?.aborted).toBe(false);
  });
});

// ─── executeWithTieredTimeout ────────────────────────────────────────────────

describe('TimeoutManager.executeWithTieredTimeout', () => {
  it('returns full data when the operation completes before both deadlines', async () => {
    const mgr = new TimeoutManager({ default: 30000, min: 1, max: 300000 });
    const result = await mgr.executeWithTieredTimeout(
      (signal, reportPartial) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(signal.aborted).toBe(false);
        return Promise.resolve('done');
      },
      { requestTimeout: 10000, operationTimeout: 60000 }
    );

    expect(result).toEqual({ data: 'done', partial: false, timedOut: false });
  });

  it('invokes reportPartial with data and a live signal', async () => {
    const mgr = new TimeoutManager({ min: 1, max: 60000 });
    let observedSignal: AbortSignal | undefined;
    const reported: unknown[] = [];

    const result = await mgr.executeWithTieredTimeout(
      (signal, reportPartial) => {
        observedSignal = signal;
        reportPartial('first chunk');
        reportPartial('second chunk');
        reported.push('first chunk', 'second chunk');
        return Promise.resolve('done');
      },
      { requestTimeout: 10000, operationTimeout: 60000 }
    );

    expect(result.data).toBe('done');
    expect(result.partial).toBe(false);
    expect(observedSignal?.aborted).toBe(false);
    expect(reported).toEqual(['first chunk', 'second chunk']);
  });

  it('request timeout is respected and throws TimeoutError when no partial data', async () => {
    const mgr = new TimeoutManager({ default: 30000, min: 1, max: 300000 });
    const promise = mgr.executeWithTieredTimeout(
      () => new Promise<string>(() => undefined),
      { requestTimeout: 5000, operationTimeout: 60000 }
    );

    const rejection = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
  });

  it('returns partial data when the request deadline elapses after partial data arrived', async () => {
    const mgr = new TimeoutManager({ min: 1, max: 300000 });
    const promise = mgr.executeWithTieredTimeout(
      (signal, reportPartial) => {
        reportPartial('partial rows');
        return new Promise<string>(() => undefined); // never resolves
      },
      { requestTimeout: 5000, operationTimeout: 60000 }
    );

    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;
    expect(result).toEqual({
      data: 'partial rows',
      partial: true,
      timedOut: true,
    });
  });

  it('operation timeout fires when it is shorter than the request timeout', async () => {
    const mgr = new TimeoutManager({ min: 1, max: 300000 });
    const promise = mgr.executeWithTieredTimeout(
      () => new Promise<string>(() => undefined),
      { requestTimeout: 300000, operationTimeout: 5000 }
    );

    const rejection = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
  });

  it('returns partial data when the operation deadline elapses', async () => {
    const mgr = new TimeoutManager({ min: 1, max: 300000 });
    const promise = mgr.executeWithTieredTimeout(
      (signal, reportPartial) => {
        reportPartial('partial export');
        return new Promise<string>(() => undefined);
      },
      { requestTimeout: 300000, operationTimeout: 5000 }
    );

    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;
    expect(result).toEqual({
      data: 'partial export',
      partial: true,
      timedOut: true,
    });
  });

  it('request timeout is clamped to the minimum', async () => {
    const mgr = new TimeoutManager({ min: 1000, max: 300000 });
    const promise = mgr.executeWithTieredTimeout(
      () => new Promise<string>(() => undefined),
      { requestTimeout: 1, operationTimeout: 300000 }
    );

    const rejection = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
  });

  it('operation timeout is clamped to the maximum', async () => {
    const mgr = new TimeoutManager({ min: 1, max: 5000 });
    const promise = mgr.executeWithTieredTimeout(
      () => new Promise<string>(() => undefined),
      { requestTimeout: 5000, operationTimeout: 999999 }
    );

    const rejection = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
  });

  it('propagates the wrapped function error instead of a timeout', async () => {
    const mgr = new TimeoutManager({ min: 1, max: 60000 });
    await expect(
      mgr.executeWithTieredTimeout(
        () => Promise.reject(new Error('network down')),
        { requestTimeout: 5000, operationTimeout: 60000 }
      )
    ).rejects.toThrow('network down');
  });

  it('manual cancellation via AbortController rejects the operation', async () => {
    const mgr = new TimeoutManager({ min: 1, max: 300000 });
    const controller = mgr.createController(60000);
    const promise = mgr.executeWithTieredTimeout(
      () => new Promise<string>(() => undefined),
      { signal: controller.signal, requestTimeout: 60000, operationTimeout: 60000 }
    );

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('manual cancellation clears the deadline timers', async () => {
    const mgr = new TimeoutManager({ min: 1, max: 300000 });
    const controller = mgr.createController(60000);
    const promise = mgr.executeWithTieredTimeout(
      () => new Promise<string>(() => undefined),
      { signal: controller.signal, requestTimeout: 5000, operationTimeout: 60000 }
    );

    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });

    // No deadline should fire after cancellation.
    await vi.advanceTimersByTimeAsync(60000);
    expect(controller.signal.aborted).toBe(true);
  });

  it('manual cancellation with partial data still cancels (no graceful fallback)', async () => {
    const mgr = new TimeoutManager({ min: 1, max: 300000 });
    const controller = mgr.createController(60000);
    const promise = mgr.executeWithTieredTimeout(
      (signal, reportPartial) => {
        reportPartial('partial');
        return new Promise<string>(() => undefined);
      },
      { signal: controller.signal, requestTimeout: 60000, operationTimeout: 60000 }
    );

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('uses defaults when no timeouts are provided', async () => {
    const mgr = new TimeoutManager({ default: 5000, min: 1, max: 60000 });
    const promise = mgr.executeWithTieredTimeout(() => new Promise<string>(() => undefined));

    const rejection = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(5000);
    await rejection;
  });
});
