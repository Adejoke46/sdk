import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../../src/http/http-client';
import {
  parseCacheControl,
  ttlFromCacheControl,
  type CacheControl,
} from '../../src/http/cache-control';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function cachedResponse(
  value: unknown,
  cacheControl?: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...(cacheControl ? { 'Cache-Control': cacheControl } : {}),
      ...extraHeaders,
    },
  });
}

function makeHttpClient(cache: { enabled: boolean; ttl?: number } = { enabled: true }): HttpClient {
  const client = new HttpClient('https://api.example.com', {
    mode: 'live',
    retryAttempts: 1,
    enableMetrics: true,
    cache,
    deduplicateRequests: false,
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

function getOptions(methodName = 'getCounter'): Parameters<HttpClient['request']>[1] {
  return { method: 'GET' as const, methodName, cacheParams: ['counter'] };
}

describe('Cache-Control parsing', () => {
  it('parses max-age into seconds', () => {
    expect(parseCacheControl('max-age=3600')).toMatchObject<CacheControl>({ maxAge: 3600 });
  });

  it('parses multiple directives with whitespace and mixed casing', () => {
    const cc = parseCacheControl('  Max-Age = 60 ,  PUBLIC ,  private  ');
    expect(cc).toMatchObject<CacheControl>({ maxAge: 60, public: true, private: true });
  });

  it('parses no-store and no-cache flags', () => {
    expect(parseCacheControl('no-store')).toMatchObject<CacheControl>({ noStore: true });
    expect(parseCacheControl('no-cache')).toMatchObject<CacheControl>({ noCache: true });
  });

  it('returns an empty object for an empty or missing header', () => {
    expect(parseCacheControl('')).toEqual({});
    expect(parseCacheControl('   ')).toEqual({});
  });

  it('ignores malformed max-age values', () => {
    expect(parseCacheControl('max-age=not-a-number')).not.toHaveProperty('maxAge');
    expect(parseCacheControl('max-age=')).not.toHaveProperty('maxAge');
  });

  it('derives a TTL in milliseconds from max-age', () => {
    expect(ttlFromCacheControl(parseCacheControl('max-age=120'))).toBe(120_000);
  });

  it('returns 0 (do not store) for no-store and no-cache', () => {
    expect(ttlFromCacheControl(parseCacheControl('no-store'))).toBe(0);
    expect(ttlFromCacheControl(parseCacheControl('no-cache'))).toBe(0);
  });

  it('returns null when there is no explicit freshness information', () => {
    expect(ttlFromCacheControl(parseCacheControl('public'))).toBeNull();
    expect(ttlFromCacheControl(parseCacheControl(''))).toBeNull();
  });
});

describe('HttpClient response caching with Cache-Control', () => {
  it('serves a cached GET response within max-age and refetches after expiry', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cachedResponse({ count: 1 }, 'max-age=60'))
      .mockResolvedValueOnce(cachedResponse({ count: 2 }, 'max-age=60'));
    globalThis.fetch = fetchMock;
    const client = makeHttpClient();
    const options = getOptions();

    const first = await client.request('/api/v1/counter', options);
    const cached = await client.request('/api/v1/counter', options);

    expect(first).toEqual({ count: 1 });
    expect(cached).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_001);
    const refreshed = await client.request('/api/v1/counter', options);
    expect(refreshed).toEqual({ count: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('refetches immediately when max-age is 0', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cachedResponse({ count: 1 }, 'max-age=0'))
      .mockResolvedValueOnce(cachedResponse({ count: 2 }, 'max-age=0'));
    globalThis.fetch = fetchMock;
    const client = makeHttpClient();
    const options = getOptions();

    await expect(client.request('/api/v1/counter', options)).resolves.toEqual({ count: 1 });
    await expect(client.request('/api/v1/counter', options)).resolves.toEqual({ count: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not store responses with no-store', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cachedResponse({ count: 1 }, 'no-store'))
      .mockResolvedValueOnce(cachedResponse({ count: 2 }, 'no-store'));
    globalThis.fetch = fetchMock;
    const client = makeHttpClient();
    const options = getOptions();

    await expect(client.request('/api/v1/counter', options)).resolves.toEqual({ count: 1 });
    await expect(client.request('/api/v1/counter', options)).resolves.toEqual({ count: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not store responses with no-cache', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cachedResponse({ count: 1 }, 'no-cache'))
      .mockResolvedValueOnce(cachedResponse({ count: 2 }, 'no-cache'));
    globalThis.fetch = fetchMock;
    const client = makeHttpClient();
    const options = getOptions();

    await expect(client.request('/api/v1/counter', options)).resolves.toEqual({ count: 1 });
    await expect(client.request('/api/v1/counter', options)).resolves.toEqual({ count: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats private responses as cacheable by the client cache', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cachedResponse({ me: true }, 'private, max-age=60'))
      .mockResolvedValueOnce(cachedResponse({ me: false }, 'private, max-age=60'));
    globalThis.fetch = fetchMock;
    const client = makeHttpClient();
    const options = getOptions();

    const first = await client.request('/api/v1/me', options);
    const cached = await client.request('/api/v1/me', options);

    expect(first).toEqual({ me: true });
    expect(cached).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not override an explicitly configured TTL with response max-age', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cachedResponse({ v: 1 }, 'max-age=3600'))
      .mockResolvedValueOnce(cachedResponse({ v: 2 }, 'max-age=3600'));
    globalThis.fetch = fetchMock;
    const client = makeHttpClient({ enabled: true, ttl: 100 });
    const options = getOptions();

    await expect(client.request('/api/v1/counter', options)).resolves.toEqual({ v: 1 });
    vi.advanceTimersByTime(50);
    const stillCached = await client.request('/api/v1/counter', options);
    expect(stillCached).toEqual({ v: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60);
    const refetched = await client.request('/api/v1/counter', options);
    expect(refetched).toEqual({ v: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('falls back to the default TTL when no Cache-Control header is present', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cachedResponse({ count: 1 }))
      .mockResolvedValueOnce(cachedResponse({ count: 2 }));
    globalThis.fetch = fetchMock;
    const client = makeHttpClient();
    const options = getOptions();

    await expect(client.request('/api/v1/counter', options)).resolves.toEqual({ count: 1 });
    const cached = await client.request('/api/v1/counter', options);
    expect(cached).toEqual({ count: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    const refetched = await client.request('/api/v1/counter', options);
    expect(refetched).toEqual({ count: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('does not cache non-GET requests even with Cache-Control', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cachedResponse({ ok: 1 }, 'public, max-age=3600'))
      .mockResolvedValueOnce(cachedResponse({ ok: 2 }, 'public, max-age=3600'));
    globalThis.fetch = fetchMock;
    const client = makeHttpClient();

    await client.request('/api/v1/mutation', {
      method: 'POST',
      body: { value: 1 },
    });
    await client.request('/api/v1/mutation', {
      method: 'POST',
      body: { value: 1 },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('tracks cache hits and misses for cached responses', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cachedResponse({ id: 'tip-1' }, 'max-age=3600'))
      .mockResolvedValueOnce(cachedResponse({ id: 'tip-1', status: 'confirmed' }, 'max-age=3600'));
    globalThis.fetch = fetchMock;
    const client = makeHttpClient();
    const options = { method: 'GET' as const, methodName: 'getTipStatus', cacheParams: ['tip-1'] };

    await client.request('/api/v1/tips/tip-1', options);
    await client.request('/api/v1/tips/tip-1', options);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getMetrics()).toMatchObject({ cacheHits: 1, cacheMisses: 1 });
  });

  it('looks up the Cache-Control header case-insensitively', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(cachedResponse({ count: 1 }, 'max-age=60', { 'CACHE-CONTROL': 'max-age=60' }))
      .mockResolvedValueOnce(cachedResponse({ count: 2 }, 'max-age=60', { 'Cache-Control': 'max-age=60' }));
    globalThis.fetch = fetchMock;
    const client = makeHttpClient();
    const options = getOptions();

    await client.request('/api/v1/counter', options);
    await client.request('/api/v1/counter', options);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
