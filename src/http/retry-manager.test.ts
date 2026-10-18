/**
 * RetryManager idempotency tests
 */

import { describe, it, expect } from 'vitest';
import { RetryManager, isRequestIdempotent } from './retry-manager';
import { ApiError } from '../types';

describe('isRequestIdempotent', () => {
  it('treats GET and HEAD as always idempotent', () => {
    expect(isRequestIdempotent({ method: 'GET' })).toBe(true);
    expect(isRequestIdempotent({ method: 'HEAD' })).toBe(true);
  });

  it('treats POST as non-idempotent by default', () => {
    expect(isRequestIdempotent({ method: 'POST' })).toBe(false);
  });

  it('allows POST when isIdempotent or Idempotency-Key is set', () => {
    expect(isRequestIdempotent({ method: 'POST', isIdempotent: true })).toBe(true);
    expect(
      isRequestIdempotent({ method: 'POST', headers: { 'idempotency-key': 'k1' } })
    ).toBe(true);
  });

  it('requires explicit flag for DELETE/PUT/PATCH', () => {
    expect(isRequestIdempotent({ method: 'DELETE' })).toBe(false);
    expect(isRequestIdempotent({ method: 'PUT' })).toBe(false);
    expect(isRequestIdempotent({ method: 'PATCH' })).toBe(false);
    expect(isRequestIdempotent({ method: 'DELETE', isIdempotent: true })).toBe(true);
  });
});

describe('RetryManager.isRetryableError', () => {
  it('returns false for POST without idempotency even on 500', () => {
    const error = new ApiError('fail', 500);
    expect(RetryManager.isRetryableError(error, { method: 'POST' })).toBe(false);
  });

  it('returns true for GET on 500', () => {
    const error = new ApiError('fail', 500);
    expect(RetryManager.isRetryableError(error, { method: 'GET' })).toBe(true);
  });

  it('returns true for POST with isIdempotent on 503', () => {
    const error = new ApiError('fail', 503);
    expect(
      RetryManager.isRetryableError(error, { method: 'POST', isIdempotent: true })
    ).toBe(true);
  });

  it('returns false for 400 even when idempotent', () => {
    const error = new ApiError('Duplicate tip', 400);
    expect(
      RetryManager.isRetryableError(error, { method: 'POST', isIdempotent: true })
    ).toBe(false);
  });

  it('preserves prior behavior when options omitted', () => {
    expect(RetryManager.isRetryableError(new ApiError('fail', 500))).toBe(true);
    expect(RetryManager.isRetryableError(new ApiError('fail', 400))).toBe(false);
  });
});

// ── #42 — jitter config and retryableStatusCodes ──────────────────────────────

describe('RetryManager jitter config (#42)', () => {
  it('returns a deterministic delay when jitter is disabled', () => {
    const manager = new RetryManager({ initialDelayMs: 1000, backoffMultiplier: 2, jitter: false });
    // attempt 0 → 1000ms, attempt 1 → 2000ms, attempt 2 → 4000ms
    expect(manager.calculateDelay(0)).toBe(1000);
    expect(manager.calculateDelay(1)).toBe(2000);
    expect(manager.calculateDelay(2)).toBe(4000);
  });

  it('caps the delay at maxDelayMs regardless of jitter setting', () => {
    const manager = new RetryManager({
      initialDelayMs: 1000,
      backoffMultiplier: 10,
      maxDelayMs: 5000,
      jitter: false,
    });
    expect(manager.calculateDelay(5)).toBe(5000);
  });

  it('adds jitter when enabled (result differs from base delay)', () => {
    // Run enough times that at least one sample won't equal the base exactly.
    const manager = new RetryManager({ initialDelayMs: 1000, backoffMultiplier: 2, jitter: true });
    const base = 1000;
    const samples = Array.from({ length: 20 }, () => manager.calculateDelay(0));
    expect(samples.every((d) => d === base)).toBe(false);
    // All samples must stay within the ±10% window
    samples.forEach((d) => {
      expect(d).toBeGreaterThanOrEqual(base * 0.9);
      expect(d).toBeLessThanOrEqual(base * 1.1);
    });
  });

  it('enables jitter by default', () => {
    const manager = new RetryManager({ initialDelayMs: 1000, backoffMultiplier: 2 });
    const base = 1000;
    const samples = Array.from({ length: 20 }, () => manager.calculateDelay(0));
    expect(samples.every((d) => d === base)).toBe(false);
  });
});

describe('RetryManager retryableStatusCodes config (#42)', () => {
  it('retries only the configured status codes', () => {
    const manager = new RetryManager({ retryableStatusCodes: [503] });
    expect(manager.isRetryableError(new ApiError('fail', 503))).toBe(true);
    expect(manager.isRetryableError(new ApiError('fail', 500))).toBe(false);
    expect(manager.isRetryableError(new ApiError('fail', 429))).toBe(false);
  });

  it('uses the default set [408,429,500,502,503,504] when not configured', () => {
    const manager = new RetryManager();
    for (const code of [408, 429, 500, 502, 503, 504]) {
      expect(manager.isRetryableError(new ApiError('fail', code))).toBe(true);
    }
    expect(manager.isRetryableError(new ApiError('fail', 400))).toBe(false);
    expect(manager.isRetryableError(new ApiError('fail', 404))).toBe(false);
  });

  it('still respects idempotency when checking instance retryability', () => {
    const manager = new RetryManager({ retryableStatusCodes: [500] });
    expect(manager.isRetryableError(new ApiError('fail', 500), { method: 'POST' })).toBe(false);
    expect(manager.isRetryableError(new ApiError('fail', 500), { method: 'GET' })).toBe(true);
  });

  it('passes custom codes through the static helper', () => {
    expect(RetryManager.isRetryableError(new ApiError('fail', 418), undefined, [418])).toBe(true);
    expect(RetryManager.isRetryableError(new ApiError('fail', 500), undefined, [418])).toBe(false);
  });
});
