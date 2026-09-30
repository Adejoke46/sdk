/**
 * InterceptorManager tests — lifecycle, execution, and cleanup (#48).
 */

import { describe, it, expect, vi } from 'vitest';
import { InterceptorManager } from './interceptors';
import { HttpClient } from './http-client';
import { DorisioClient } from '../client';
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
    manager.addResponseInterceptor((r) => ({ ...(r as object), a: 1 } as any));
    manager.addResponseInterceptor((r) => ({ ...(r as object), b: 2 } as any));

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

  it('preserves the error when an interceptor only observes it', async () => {
    const manager = new InterceptorManager();
    const error = new Error('original');
    manager.addErrorInterceptor(() => undefined);

    await expect(manager.executeErrorInterceptors(error)).resolves.toBe(error);
  });

  it('returns the original options when no request interceptors are registered', async () => {
    const manager = new InterceptorManager();
    const opts = makeRequestOptions({ method: 'POST' });
    expect(await manager.executeRequestInterceptors(opts)).toBe(opts);
  });

  it('removes a registered interceptor without affecting later registrations', async () => {
    const manager = new InterceptorManager();
    const log: string[] = [];
    const removedId = manager.addRequestInterceptor((options) => {
      log.push('removed');
      return options;
    });
    manager.addRequestInterceptor((options) => {
      log.push('retained');
      return options;
    });

    expect(manager.removeRequestInterceptor(removedId)).toBe(true);
    expect(manager.removeRequestInterceptor(removedId)).toBe(false);
    await manager.executeRequestInterceptors(makeRequestOptions());

    expect(log).toEqual(['retained']);
  });

  it('removes response and error interceptors by id', () => {
    const manager = new InterceptorManager();
    const responseId = manager.addResponseInterceptor((response) => response);
    const errorId = manager.addErrorInterceptor((error) => error);

    expect(manager.removeResponseInterceptor(responseId)).toBe(true);
    expect(manager.removeErrorInterceptor(errorId)).toBe(true);
    expect(manager.getCount()).toEqual({ request: 0, response: 0, error: 0 });
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

describe('Client interceptor pipeline', () => {
  function makeClientFacade(httpClient: HttpClient): DorisioClient {
    const client = Object.create(DorisioClient.prototype) as DorisioClient;
    Object.defineProperty(client, 'httpClient', { value: httpClient });
    return client;
  }

  function stubConnectionPool(httpClient: HttpClient): void {
    Object.defineProperty(httpClient, 'connectionPool', {
      value: { acquire: async () => () => undefined },
    });
    Object.defineProperty(httpClient, 'serializer', {
      value: {
        serialize: JSON.stringify,
        deserialize: <T>(text: string) => JSON.parse(text) as T,
      },
    });
  }

  it('runs async request and response interceptors once, in order, and allows removal', async () => {
    const originalFetch = globalThis.fetch;
    const httpClient = new HttpClient('https://api.example.com', {
      mode: 'live',
      retryAttempts: 1,
    });
    stubConnectionPool(httpClient);
    const client = makeClientFacade(httpClient);
    const order: string[] = [];
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ data: { value: 1 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    globalThis.fetch = fetchMock;

    try {
      const requestInterceptorId = client.addRequestInterceptor(async (options) => {
        await Promise.resolve();
        order.push('request-1');
        return {
          ...options,
          headers: { ...options.headers, 'X-Custom-Header': 'value' },
        };
      });
      client.addRequestInterceptor((options) => {
        order.push('request-2');
        return options;
      });
      const responseInterceptorId = client.addResponseInterceptor(async (response) => {
        await Promise.resolve();
        order.push('response');
        return { ...(response as object), intercepted: true };
      });

      const result = await httpClient.request('/api/v1/data', { method: 'GET' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['request-1', 'request-2', 'response']);
      expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
        'X-Custom-Header': 'value',
      });
      expect(result).toMatchObject({ intercepted: true });
      expect(client.removeRequestInterceptor(requestInterceptorId)).toBe(true);
      expect(client.removeResponseInterceptor(responseInterceptorId)).toBe(true);
      expect(client.removeResponseInterceptor(responseInterceptorId)).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('propagates errors transformed by error interceptors', async () => {
    const originalFetch = globalThis.fetch;
    const httpClient = new HttpClient('https://api.example.com', {
      mode: 'live',
      retryAttempts: 1,
    });
    stubConnectionPool(httpClient);
    const client = makeClientFacade(httpClient);
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'original error' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    ) as typeof fetch;

    try {
      const errorInterceptorId = client.addErrorInterceptor(async (error) => {
        await Promise.resolve();
        const original = error as Error;
        return new Error(`${original.message} transformed`);
      });

      await expect(
        httpClient.request('/api/v1/data', { method: 'GET' })
      ).rejects.toThrow('transformed');
      expect(client.removeErrorInterceptor(errorInterceptorId)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
