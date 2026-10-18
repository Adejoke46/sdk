/**
 * TimeoutManager Tests
 *
 * Covers: timeout normalisation (min/max clamping, defaults),
 * AbortSignal creation, executeWithTimeout cleanup guarantee, and the
 * timeout itself actually firing (signal delivery, TimeoutError, no abort
 * after a fast operation).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TimeoutManager } from './timeout-manager';
import { TimeoutError } from '../types/errors';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

// ─── normalizeTimeout ─────────────────────────────────────────────────────────

describe('TimeoutManager.normalizeTimeout', () => {
  it('returns the default timeout when no value is provided', () => {
    const mgr = new TimeoutManager({ default: 30000 });
    expect(mgr.normalizeTimeout()).toBe(30000);
  });

  it('returns the provided timeout when within bounds', () => {
    const mgr = new TimeoutManager({ default: 30000, min: 1000, max: 300000 });
    expect(mgr.normalizeTimeout(5000)).toBe(5000);
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

  it('returns exactly min when the provided value equals min', () => {
    const mgr = new TimeoutManager({ min: 1000, max: 300000 });
    expect(mgr.normalizeTimeout(1000)).toBe(1000);
  });

  it('returns exactly max when the provided value equals max', () => {
    const mgr = new TimeoutManager({ min: 1000, max: 300000 });
    expect(mgr.normalizeTimeout(300000)).toBe(300000);
  });

  it('applies sensible defaults when constructor receives no options', () => {
    const mgr = new TimeoutManager();
    // Defaults: default=30000, min=1000, max=300000
    expect(mgr.normalizeTimeout()).toBe(30000);
    expect(mgr.normalizeTimeout(0)).toBe(1000);
    expect(mgr.normalizeTimeout(999999)).toBe(300000);
  });
});

// ─── getConfig / setConfig ────────────────────────────────────────────────────

describe('TimeoutManager config', () => {
  it('getConfig returns the current configuration', () => {
    const mgr = new TimeoutManager({ default: 5000, min: 500, max: 60000 });
    const cfg = mgr.getConfig();
    expect(cfg).toEqual({
      default: 5000,
      min: 500,
      max: 60000,
      request: 5000,
      operation: 5000,
    });
  });

  it('getConfig result is a copy – mutating it does not affect the manager', () => {
    const mgr = new TimeoutManager({ default: 5000 });
    const cfg = mgr.getConfig() as Record<string, number>;
    cfg['default'] = 99999;
    expect(mgr.normalizeTimeout()).toBe(5000);
  });

  it('setConfig partially updates the configuration', () => {
    const mgr = new TimeoutManager({ default: 30000, min: 1000, max: 300000 });
    mgr.setConfig({ default: 10000 });
    expect(mgr.normalizeTimeout()).toBe(10000);
    // min and max unchanged
    expect(mgr.normalizeTimeout(0)).toBe(1000);
    expect(mgr.normalizeTimeout(999999)).toBe(300000);
  });
});

// ─── createAbortSignal ────────────────────────────────────────────────────────

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

  it('clamps small values before passing to AbortSignal.timeout', () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const mgr = new TimeoutManager({ min: 1000, max: 300000 });

    mgr.createAbortSignal(1); // below min

    expect(spy).toHaveBeenCalledWith(1000);
  });

  it('returns an AbortSignal instance', () => {
    const mgr = new TimeoutManager();
    const signal = mgr.createAbortSignal(5000);
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

// ─── executeWithTimeout ───────────────────────────────────────────────────────

describe('TimeoutManager.executeWithTimeout', () => {
  it('resolves with the function result when it completes in time', async () => {
    const mgr = new TimeoutManager({ default: 5000 });
    const fn = vi.fn().mockResolvedValue('data');

    const result = await mgr.executeWithTimeout(fn, 5000);

    expect(result).toBe('data');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('clears the timeout after successful completion (no dangling timer)', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const mgr = new TimeoutManager({ default: 5000 });
    const fn = vi.fn().mockResolvedValue('ok');

    await mgr.executeWithTimeout(fn);

    expect(clearSpy).toHaveBeenCalled();
  });

  it('clears the timeout even when the function throws (finally guarantee)', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const mgr = new TimeoutManager({ default: 5000 });
    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    await mgr.executeWithTimeout(fn).catch(() => {/* expected */});

    expect(clearSpy).toHaveBeenCalled();
  });

  it('propagates the error thrown by the wrapped function', async () => {
    const mgr = new TimeoutManager({ default: 5000 });
    const fn = vi.fn().mockRejectedValue(new Error('network down'));

    await expect(mgr.executeWithTimeout(fn)).rejects.toThrow('network down');
  });

  it('uses the normalised (default) timeout when none is specified', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const mgr = new TimeoutManager({ default: 8000 });
    const fn = vi.fn().mockResolvedValue('ok');

    await mgr.executeWithTimeout(fn);

    // The first setTimeout call with ms >= 1000 should be the timeout guard
    const timeoutCall = setTimeoutSpy.mock.calls.find(
      ([, ms]) => typeof ms === 'number' && (ms as number) >= 1000
    );
    expect(timeoutCall?.[1]).toBe(8000);
  });

  it('hands the operation an AbortSignal that is not yet aborted', async () => {
    const mgr = new TimeoutManager({ default: 5000 });
    let observed: AbortSignal | undefined;
    const fn = vi.fn((signal: AbortSignal) => {
      observed = signal;
      return Promise.resolve('ok');
    });

    await mgr.executeWithTimeout(fn, 5000);

    expect(observed).toBeInstanceOf(AbortSignal);
    expect(observed?.aborted).toBe(false);
  });

  it('rejects with a TimeoutError when the operation outlives the timeout', async () => {
    const mgr = new TimeoutManager({ default: 5000, min: 1, max: 60000 });
    // Deliberately ignores the signal: the deadline must bound the wait anyway.
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

    const rejection = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    expect(observed?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(5000);
    await rejection;

    expect(observed?.aborted).toBe(true);
  });

  it('applies the normalised timeout to the deadline', async () => {
    const mgr = new TimeoutManager({ default: 5000, min: 1000, max: 60000 });
    const promise = mgr.executeWithTimeout(() => new Promise<string>(() => undefined), 1);

    const rejection = expect(promise).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await rejection;
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

    // A leftover timer would abort here; there must not be one.
    await vi.advanceTimersByTimeAsync(60000);
    expect(observed?.aborted).toBe(false);
  });

  it('propagates the operation error when the operation fails before the deadline', async () => {
    const mgr = new TimeoutManager({ default: 5000, min: 1, max: 60000 });

    await expect(
      mgr.executeWithTimeout(() => Promise.reject(new Error('boom')), 5000)
    ).rejects.toThrow('boom');
  });
});
