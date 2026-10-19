import { describe, it, expect } from 'vitest';
import { RetryManager } from '../../src/http/retry-manager';

function noJitterConfig(overrides: Partial<Parameters<typeof RetryManager>[0]> = {}) {
  return new RetryManager({
    initialDelayMs: 1000,
    backoffMultiplier: 2,
    maxDelayMs: 30000,
    jitter: false,
    ...overrides,
  });
}

describe('exponential backoff (retry-backoff)', () => {
  it('uses baseDelay at attempt 0', () => {
    const manager = noJitterConfig({ initialDelayMs: 500 });
    expect(manager.calculateDelay(0)).toBe(500);
  });

  it('delay doubles each attempt (exponential growth)', () => {
    const manager = noJitterConfig({ initialDelayMs: 100 });
    expect(manager.calculateDelay(0)).toBe(100);
    expect(manager.calculateDelay(1)).toBe(200);
    expect(manager.calculateDelay(2)).toBe(400);
    expect(manager.calculateDelay(3)).toBe(800);
    expect(manager.calculateDelay(4)).toBe(1600);
  });

  it('implements delay = baseDelay * (2 ^ attempt)', () => {
    const manager = noJitterConfig({ initialDelayMs: 7 });
    const expected = (attempt: number) => 7 * Math.pow(2, attempt);
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(manager.calculateDelay(attempt)).toBe(expected(attempt));
    }
  });

  it('uses baseDelay * (backoffMultiplier ^ attempt) when multiplier differs from 2', () => {
    const manager = noJitterConfig({ initialDelayMs: 100, backoffMultiplier: 3 });
    expect(manager.calculateDelay(0)).toBe(100);
    expect(manager.calculateDelay(1)).toBe(300);
    expect(manager.calculateDelay(2)).toBe(900);
    expect(manager.calculateDelay(3)).toBe(2700);
  });

  it('caps the delay at maxDelayMs', () => {
    const manager = noJitterConfig({ initialDelayMs: 1000, backoffMultiplier: 10, maxDelayMs: 5000 });
    expect(manager.calculateDelay(5)).toBe(5000);
    expect(manager.calculateDelay(100)).toBe(5000);
  });

  it('never exceeds maxDelayMs regardless of attempt index', () => {
    const manager = noJitterConfig({ initialDelayMs: 1, backoffMultiplier: 100, maxDelayMs: 100 });
    for (let attempt = 0; attempt < 50; attempt++) {
      expect(manager.calculateDelay(attempt)).toBeLessThanOrEqual(100);
    }
  });

  it('caps attempt 0 when baseDelay already exceeds maxDelayMs', () => {
    const manager = noJitterConfig({ initialDelayMs: 5000, maxDelayMs: 1000 });
    expect(manager.calculateDelay(0)).toBe(1000);
  });

  it('scales all delays proportionally with baseDelay', () => {
    const a = noJitterConfig({ initialDelayMs: 100 });
    const b = noJitterConfig({ initialDelayMs: 400 });
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(b.calculateDelay(attempt)).toBe(4 * a.calculateDelay(attempt));
    }
  });

  it('delay is always non-negative', () => {
    const manager = noJitterConfig({ initialDelayMs: 0, maxDelayMs: 100 });
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(manager.calculateDelay(attempt)).toBeGreaterThanOrEqual(0);
    }
  });

  describe('jitter (random 0–100 ms)', () => {
    it('adds between 0 and 100 ms on top of the base delay', () => {
      const manager = new RetryManager({
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        maxDelayMs: 100000,
        jitter: true,
      });
      const samples = Array.from({ length: 200 }, () => manager.calculateDelay(0));
      samples.forEach((d) => {
        expect(d).toBeGreaterThanOrEqual(1000);
        expect(d).toBeLessThanOrEqual(1100);
      });
      // At least one sample exercised a non-zero jitter (astronomically unlikely otherwise).
      expect(samples.some((d) => d > 1000)).toBe(true);
      expect(samples.some((d) => d < 1100)).toBe(true);
    });

    it('jitter never pushes the delay above maxDelayMs', () => {
      const manager = new RetryManager({
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        maxDelayMs: 1050,
        jitter: true,
      });
      const delays = Array.from({ length: 200 }, () => manager.calculateDelay(0));
      delays.forEach((d) => {
        expect(d).toBeGreaterThanOrEqual(1000);
        expect(d).toBeLessThanOrEqual(1050);
      });
    });

    it('jitter produces varied results across repeated calls', () => {
      const manager = new RetryManager({
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        maxDelayMs: 100000,
        jitter: true,
      });
      const samples = Array.from({ length: 100 }, () => manager.calculateDelay(0));
      const unique = new Set(samples);
      expect(unique.size).toBeGreaterThan(1);
    });

    it('two identical clients do not retry in lockstep', () => {
      const a = new RetryManager({
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        maxDelayMs: 100000,
        jitter: true,
      });
      const b = new RetryManager({
        initialDelayMs: 1000,
        backoffMultiplier: 2,
        maxDelayMs: 100000,
        jitter: true,
      });
      const aSamples = Array.from({ length: 50 }, () => a.calculateDelay(0));
      const bSamples = Array.from({ length: 50 }, () => b.calculateDelay(0));
      const identical = aSamples.filter((d, i) => d === bSamples[i]).length;
      expect(identical / aSamples.length).toBeLessThan(0.9);
    });

    it('is deterministic when jitter is disabled', () => {
      const manager = noJitterConfig({ initialDelayMs: 1000 });
      const samples = Array.from({ length: 50 }, () => manager.calculateDelay(3));
      expect(new Set(samples).size).toBe(1);
      expect(samples[0]).toBe(8000);
    });

    it('is non-deterministic by default (jitter enabled)', () => {
      const manager = new RetryManager({ initialDelayMs: 1000, backoffMultiplier: 2 });
      const samples = Array.from({ length: 50 }, () => manager.calculateDelay(0));
      const unique = new Set(samples);
      expect(unique.size).toBeGreaterThan(1);
    });
  });

  describe('calculateDelay public API', () => {
    it('exposes calculateDelay matching the internal computation', () => {
      const manager = noJitterConfig({ initialDelayMs: 250, backoffMultiplier: 4 });
      expect(manager.calculateDelay(0)).toBe(250);
      expect(manager.calculateDelay(2)).toBe(4000);
    });
  });

  describe('isRetryableError integration', () => {
    it('retries default retryable status codes without options', () => {
      const manager = new RetryManager();
      for (const code of [408, 429, 500, 502, 503, 504]) {
        expect(manager.isRetryableError({ statusCode: code } as any)).toBe(true);
      }
      expect(manager.isRetryableError({ statusCode: 400 } as any)).toBe(false);
      expect(manager.isRetryableError({ statusCode: 404 } as any)).toBe(false);
    });

    it('static isRetryableError accepts an explicit code list', () => {
      expect(RetryManager.isRetryableError({ statusCode: 418 } as any, undefined, [418])).toBe(true);
      expect(RetryManager.isRetryableError({ statusCode: 500 } as any, undefined, [418])).toBe(false);
    });
  });
});
