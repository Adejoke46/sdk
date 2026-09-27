/**
 * InterceptorManager tests — lifecycle, execution, and cleanup (#48).
 */

import { describe, it, expect, vi } from 'vitest';
import { InterceptorManager } from './interceptors';
import type { RequestOptions } from './http-client';

function makeRequestOptions(overrides: Partial<RequestOptions> = {}): RequestOptions {
  return { method: 'GET', ...overrides };
}

describe('InterceptorManager — registration and execution', () => {
  it('executes request interceptors in order', async () => {
    const manager = new InterceptorManager();
    const log: string[] = [];

    manager.addRequestInterceptor((opts) => { log.push('A'); return opts; });
    manager.addRequestInterceptor((opts) => { log.push('B'); return opts; });

    await manager.executeRequestInterceptors(makeRequestOptions());
    expect(log).toEqual(['A', 'B']);
  });

  it('chains request interceptor mutations', async () => {
    const manager = new InterceptorManager();
    manager.addRequestInterceptor((opts) => ({ ...opts, timeout: 1000 }));
    manager.addRequestInterceptor((opts) => ({ ...opts, timeout: (opts.timeout ?? 0) + 500 }));

    const result = await manager.executeRequestInterceptors(makeRequestOptions());
    expect(result.timeout).toBe(1500);
  });

  it('executes response interceptors in order', async () => {
    const manager = new InterceptorManager();
    manager.addResponseInterceptor(<T>(r: T): T => ({ ...(r as object), a: 1 } as T));
    manager.addResponseInterceptor(<T>(r: T): T => ({ ...(r as object), b: 2 } as T));

    const result = await manager.executeResponseInterceptors({});
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('executes error interceptors in order', async () => {
    const manager = new InterceptorManager();
    const log: number[] = [];
    manager.addErrorInterceptor((e) => { log.push(1); return e; });
    manager.addErrorInterceptor((e) => { log.push(2); return e; });

    await manager.executeErrorInterceptors(new Error('oops'));
    expect(log).toEqual([1, 2]);
  });

  it('returns the original options when no request interceptors are registered', async () => {
    const manager = new InterceptorManager();
    const opts = makeRequestOptions({ method: 'POST' });
    expect(await manager.executeRequestInterceptors(opts)).toBe(opts);
  });
});

// ── #48 — cleanup() releases interceptor references ──────────────────────────

describe('InterceptorManager cleanup (#48)', () => {
  it('getCount reflects additions before cleanup', () => {
    const manager = new InterceptorManager();
    manager.addRequestInterceptor((o) => o);
    manager.addRequestInterceptor((o) => o);
    manager.addResponseInterceptor((r) => r);
    manager.addErrorInterceptor((e) => e);

    expect(manager.getCount()).toEqual({ request: 2, response: 1, error: 1 });
  });

  it('cleanup() removes all registered interceptors', () => {
    const manager = new InterceptorManager();
    manager.addRequestInterceptor((o) => o);
    manager.addResponseInterceptor((r) => r);
    manager.addErrorInterceptor((e) => e);

    manager.cleanup();

    expect(manager.getCount()).toEqual({ request: 0, response: 0, error: 0 });
  });

  it('no-ops after cleanup — executing interceptors returns unchanged values', async () => {
    const manager = new InterceptorManager();
    const spy = vi.fn((o: RequestOptions) => o);
    manager.addRequestInterceptor(spy);

    manager.cleanup();

    const opts = makeRequestOptions();
    const result = await manager.executeRequestInterceptors(opts);
    expect(result).toBe(opts);
    expect(spy).not.toHaveBeenCalled();
  });

  it('can register new interceptors after cleanup', async () => {
    const manager = new InterceptorManager();
    manager.addRequestInterceptor((o) => o);
    manager.cleanup();

    const newSpy = vi.fn((o: RequestOptions) => ({ ...o, timeout: 999 }));
    manager.addRequestInterceptor(newSpy);

    const result = await manager.executeRequestInterceptors(makeRequestOptions());
    expect(result.timeout).toBe(999);
    expect(newSpy).toHaveBeenCalledTimes(1);
  });

  it('repeated cleanup() calls are safe', () => {
    const manager = new InterceptorManager();
    manager.addRequestInterceptor((o) => o);
    manager.cleanup();
    expect(() => manager.cleanup()).not.toThrow();
    expect(manager.getCount()).toEqual({ request: 0, response: 0, error: 0 });
  });

  it('closure references inside interceptors are released after cleanup', () => {
    const manager = new InterceptorManager();
    let capturedToken: string | null = 'secret-token';

    manager.addRequestInterceptor((opts) => ({
      ...opts,
      headers: { Authorization: `Bearer ${capturedToken}` },
    }));

    expect(manager.getCount().request).toBe(1);
    manager.cleanup();

    // After cleanup the manager no longer holds the closure; the local
    // variable can now be GC'd. We verify indirectly: the count is zero
    // and calling capturedToken = null doesn't throw.
    capturedToken = null;
    expect(manager.getCount().request).toBe(0);
  });
});
