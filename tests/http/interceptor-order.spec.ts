/**
 * Interceptor execution order — Issue #194
 *
 * Verifies that every interceptor phase runs FIFO in registration order,
 * that removal by id works, and that reordering is achievable via remove
 * then re-add (the interceptor then runs last in its phase).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InterceptorManager } from '../../src/http/interceptors';
import { HttpClient } from '../../src/http/http-client';
import type { RequestOptions } from '../../src/http/http-client';

function requestOptions(overrides: Partial<RequestOptions> = {}): RequestOptions {
  return { method: 'GET', ...overrides };
}

function stubClientInternals(httpClient: HttpClient): void {
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

// ── Phase ordering (FIFO within each phase) ──────────────────────────────

describe('InterceptorManager — FIFO order within each phase', () => {
  it('executes request interceptors in registration order (pre-request)', async () => {
    const manager = new InterceptorManager();
    const log: string[] = [];

    manager.addRequestInterceptor(() => { log.push('first'); return requestOptions(); });
    manager.addRequestInterceptor(() => { log.push('second'); return requestOptions(); });
    manager.addRequestInterceptor(() => { log.push('third'); return requestOptions(); });

    await manager.executeRequestInterceptors(requestOptions());
    expect(log).toEqual(['first', 'second', 'third']);
  });

  it('executes response interceptors in registration order (pre-response)', async () => {
    const manager = new InterceptorManager();
    const log: string[] = [];

    manager.addResponseInterceptor(() => { log.push('first'); return 'x'; });
    manager.addResponseInterceptor(() => { log.push('second'); return 'x'; });
    manager.addResponseInterceptor(() => { log.push('third'); return 'x'; });

    await manager.executeResponseInterceptors('x');
    expect(log).toEqual(['first', 'second', 'third']);
  });

  it('executes error interceptors in registration order', async () => {
    const manager = new InterceptorManager();
    const log: string[] = [];

    manager.addErrorInterceptor(() => { log.push('first'); return 'x'; });
    manager.addErrorInterceptor(() => { log.push('second'); return 'x'; });
    manager.addErrorInterceptor(() => { log.push('third'); return 'x'; });

    await manager.executeErrorInterceptors(new Error('boom'));
    expect(log).toEqual(['first', 'second', 'third']);
  });

  it('keeps request and response phase ordering independent', async () => {
    const manager = new InterceptorManager();
    const requestLog: string[] = [];
    const responseLog: string[] = [];

    manager.addResponseInterceptor(() => { responseLog.push('resp-a'); return 'x'; });
    manager.addRequestInterceptor(() => { requestLog.push('req-a'); return requestOptions(); });
    manager.addResponseInterceptor(() => { responseLog.push('resp-b'); return 'x'; });
    manager.addRequestInterceptor(() => { requestLog.push('req-b'); return requestOptions(); });

    await manager.executeRequestInterceptors(requestOptions());
    await manager.executeResponseInterceptors('x');

    expect(requestLog).toEqual(['req-a', 'req-b']);
    expect(responseLog).toEqual(['resp-a', 'resp-b']);
  });

  it('awaits async interceptors in order, one at a time', async () => {
    const manager = new InterceptorManager();
    const startLog: string[] = [];
    const endLog: string[] = [];

    const slow = (label: string) => async () => {
      startLog.push(label);
      await new Promise((resolve) => setTimeout(resolve, 10));
      endLog.push(label);
      return requestOptions();
    };

    manager.addRequestInterceptor(slow('a'));
    manager.addRequestInterceptor(slow('b'));
    manager.addRequestInterceptor(slow('c'));

    await manager.executeRequestInterceptors(requestOptions());

    expect(startLog).toEqual(['a', 'b', 'c']);
    expect(endLog).toEqual(['a', 'b', 'c']);
  });

  it('passes values through unchanged when no interceptors are registered', async () => {
    const manager = new InterceptorManager();
    const opts = requestOptions({ method: 'POST' });

    await expect(manager.executeRequestInterceptors(opts)).resolves.toBe(opts);
    await expect(manager.executeResponseInterceptors({ data: 1 })).resolves.toEqual({
      data: 1,
    });
  });

  it('execution order is stable across repeated executions', async () => {
    const manager = new InterceptorManager();
    const log: string[] = [];

    manager.addRequestInterceptor(() => { log.push('a'); return requestOptions(); });
    manager.addRequestInterceptor(() => { log.push('b'); return requestOptions(); });

    await manager.executeRequestInterceptors(requestOptions());
    await manager.executeRequestInterceptors(requestOptions());
    await manager.executeRequestInterceptors(requestOptions());

    expect(log).toEqual(['a', 'b', 'a', 'b', 'a', 'b']);
  });
});

// ── Removal by id ────────────────────────────────────────────────────────

describe('InterceptorManager — removal by id', () => {
  it('removes a request interceptor without affecting the others', async () => {
    const manager = new InterceptorManager();
    const log: string[] = [];

    const removedId = manager.addRequestInterceptor(() => { log.push('removed'); return requestOptions(); });
    const keepId = manager.addRequestInterceptor(() => { log.push('kept'); return requestOptions(); });

    expect(manager.removeRequestInterceptor(removedId)).toBe(true);
    expect(manager.removeRequestInterceptor(removedId)).toBe(false);
    expect(manager.removeRequestInterceptor(keepId)).toBe(true);

    await manager.executeRequestInterceptors(requestOptions());
    expect(log).toEqual([]);
    expect(manager.getCount().request).toBe(0);
  });

  it('removes a response interceptor by id', async () => {
    const manager = new InterceptorManager();
    const log: string[] = [];

    const removedId = manager.addResponseInterceptor(() => { log.push('removed'); return 'x'; });
    manager.addResponseInterceptor(() => { log.push('kept'); return 'x'; });

    expect(manager.removeResponseInterceptor(removedId)).toBe(true);

    await manager.executeResponseInterceptors('x');
    expect(log).toEqual(['kept']);
  });

  it('removes an error interceptor by id', async () => {
    const manager = new InterceptorManager();
    const log: string[] = [];

    const removedId = manager.addErrorInterceptor(() => { log.push('removed'); return 'x'; });
    manager.addErrorInterceptor(() => { log.push('kept'); return 'x'; });

    expect(manager.removeErrorInterceptor(removedId)).toBe(true);

    await manager.executeErrorInterceptors(new Error('boom'));
    expect(log).toEqual(['kept']);
  });

  it('remove*Interceptor returns false for unknown ids', () => {
    const manager = new InterceptorManager();

    expect(manager.removeRequestInterceptor(9999)).toBe(false);
    expect(manager.removeResponseInterceptor(9999)).toBe(false);
    expect(manager.removeErrorInterceptor(9999)).toBe(false);
  });

  it('removing a middle interceptor preserves the order of the rest', async () => {
    const manager = new InterceptorManager();
    const ids: number[] = [];
    const log: string[] = [];

    ids.push(manager.addRequestInterceptor(() => { log.push('a'); return requestOptions(); }));
    ids.push(manager.addRequestInterceptor(() => { log.push('b'); return requestOptions(); }));
    ids.push(manager.addRequestInterceptor(() => { log.push('c'); return requestOptions(); }));

    expect(manager.removeRequestInterceptor(ids[1])).toBe(true);

    await manager.executeRequestInterceptors(requestOptions());
    expect(log).toEqual(['a', 'c']);
  });
});

// ── Reordering via remove + re-add ───────────────────────────────────────

describe('InterceptorManager — reordering via remove + re-add', () => {
  it('re-adding a removed interceptor runs it last in its phase', async () => {
    const manager = new InterceptorManager();
    const log: string[] = [];

    const id = manager.addRequestInterceptor(() => { log.push('moved'); return requestOptions(); });
    manager.addRequestInterceptor(() => { log.push('a'); return requestOptions(); });
    manager.addRequestInterceptor(() => { log.push('b'); return requestOptions(); });

    expect(manager.removeRequestInterceptor(id)).toBe(true);
    manager.addRequestInterceptor(() => { log.push('moved'); return requestOptions(); });

    await manager.executeRequestInterceptors(requestOptions());
    expect(log).toEqual(['a', 'b', 'moved']);
  });

  it('ids are unique and monotonic across phases', () => {
    const manager = new InterceptorManager();

    const req1 = manager.addRequestInterceptor(() => requestOptions());
    const res1 = manager.addResponseInterceptor(() => 'x');
    const req2 = manager.addRequestInterceptor(() => requestOptions());
    const err1 = manager.addErrorInterceptor(() => 'x');

    const ids = [req1, res1, req2, err1];
    expect(new Set(ids).size).toBe(4);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(ids[0] + 1).toBe(ids[1]);
    expect(ids[1] + 1).toBe(ids[2]);
    expect(ids[2] + 1).toBe(ids[3]);
  });
});

// ── Client pipeline — phases around fetch ────────────────────────────────

describe('Client pipeline — request interceptors before fetch, response interceptors after', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('runs all request interceptors before fetch and all response interceptors after fetch', async () => {
    const order: string[] = [];
    const httpClient = new HttpClient('https://api.example.com', {
      mode: 'live',
      retryAttempts: 1,
    });
    stubClientInternals(httpClient);

    const fetchMock = vi.fn<typeof fetch>(async () => {
      order.push('fetch');
      return new Response(JSON.stringify({ value: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = fetchMock;

    try {
      httpClient
        .getInterceptors()
        .addRequestInterceptor(async (options) => {
          order.push('request-1');
          await Promise.resolve();
          return { ...options, headers: { ...options.headers, 'X-First': 'yes' } };
        });
      httpClient
        .getInterceptors()
        .addRequestInterceptor((options) => {
          order.push('request-2');
          return options;
        });
      httpClient
        .getInterceptors()
        .addResponseInterceptor(async (response) => {
          order.push('response-1');
          await Promise.resolve();
          return { ...(response as object), first: true };
        });
      httpClient
        .getInterceptors()
        .addResponseInterceptor((response) => {
          order.push('response-2');
          return response;
        });

      const result = await httpClient.request('/api/v1/data', { method: 'GET' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['request-1', 'request-2', 'fetch', 'response-1', 'response-2']);
      expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-First': 'yes' });
      expect(result).toMatchObject({ first: true });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
