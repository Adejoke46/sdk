import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from './http-client';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function makeHttpClient(cache: { enabled: boolean; ttl?: number } = { enabled: true }): HttpClient {
  const client = new HttpClient('https://api.example.com', {
    mode: 'live',
    retryAttempts: 1,
    enableMetrics: true,
    cache,
  });
  Object.defineProperty(client, 'connectionPool', {
    value: { acquire: async () => () => undefined },
  });
  Object.defineProperty(client, 'serializer', {
    value: {
      serialize: JSON.stringify,
      deserialize: <T>(text: string) => JSON.parse(text) as T,
    },
  });
  return client;
}

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('HttpClient response caching', () => {
  it('serves cached GET responses, tracks hits, and supports manual invalidation', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ id: 'tip-1', status: 'pending' }))
      .mockResolvedValueOnce(response({ id: 'tip-1', status: 'confirmed' }));
    globalThis.fetch = fetchMock;
    const client = makeHttpClient();
    const options = {
      method: 'GET' as const,
      methodName: 'getTipStatus',
      cacheParams: ['tip-1'],
    };

    const first = await client.request('/api/v1/tips/tip-1', options);
    const cached = await client.request('/api/v1/tips/tip-1', options);

    expect(first).toEqual({ id: 'tip-1', status: 'pending' });
    expect(cached).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getMetrics()).toMatchObject({ cacheHits: 1, cacheMisses: 1 });

    expect(client.getCacheManager().invalidate('getTipStatus', 'tip-1')).toBe(true);
    const refreshed = await client.request('/api/v1/tips/tip-1', options);

    expect(refreshed).toEqual({ id: 'tip-1', status: 'confirmed' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache non-GET requests or reuse responses across authorization headers', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response({ ok: true }));
    globalThis.fetch = fetchMock;
    const client = makeHttpClient();

    await client.request('/api/v1/private', {
      method: 'GET',
      headers: { Authorization: 'Bearer first' },
    });
    await client.request('/api/v1/private', {
      method: 'GET',
      headers: { Authorization: 'Bearer second' },
    });
    await client.request('/api/v1/mutation', { method: 'POST', body: { value: 1 } });
    await client.request('/api/v1/mutation', { method: 'POST', body: { value: 1 } });

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('refetches after the configured TTL expires', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => response({ count: 1 }))
      .mockImplementationOnce(async () => response({ count: 2 }));
    globalThis.fetch = fetchMock;
    const client = makeHttpClient({ enabled: true, ttl: 100 });
    const options = { method: 'GET' as const, methodName: 'getCounter' };

    await expect(client.request('/api/v1/counter', options)).resolves.toEqual({ count: 1 });
    vi.advanceTimersByTime(101);
    await expect(client.request('/api/v1/counter', options)).resolves.toEqual({ count: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps mutating response interceptors from modifying the cached value', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response({ id: 'tip-1' }));
    globalThis.fetch = fetchMock;
    const client = makeHttpClient();
    client.getInterceptors().addResponseInterceptor((value) => {
      const mutableValue = value as { intercepted?: number };
      mutableValue.intercepted = (mutableValue.intercepted ?? 0) + 1;
      return mutableValue;
    });

    const first = await client.request('/api/v1/tips/tip-1', {
      method: 'GET',
      methodName: 'getTipStatus',
      cacheParams: ['tip-1'],
    });
    const cached = await client.request('/api/v1/tips/tip-1', {
      method: 'GET',
      methodName: 'getTipStatus',
      cacheParams: ['tip-1'],
    });

    expect(first).toMatchObject({ intercepted: 1 });
    expect(cached).toMatchObject({ intercepted: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});