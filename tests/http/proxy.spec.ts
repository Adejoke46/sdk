/**
 * Proxy configuration, rotation, and bypass tests (Issue #195).
 *
 * Covers:
 * - ProxyConfig normalization (single URL vs array)
 * - Round-robin proxy selection
 * - Bypass rules (string and RegExp patterns)
 * - Proxy headers (Proxy-Authorization, Via)
 * - HttpClient header injection and bypass behaviour
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  normalizeProxyConfig,
  selectProxy,
  isBypassed,
  buildProxyHeaders,
  type ProxyConfig,
} from '../../src/http/proxy';
import { HttpClient } from '../../src/http/http-client';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue(response);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function capturedHeaders(fetchMock: ReturnType<typeof vi.fn>): Record<string, string> {
  const init = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]?.[1];
  return { ...((init?.headers as Record<string, string>) ?? {}) };
}

describe('normalizeProxyConfig', () => {
  it('wraps a single URL into a single-entry array', () => {
    const config: ProxyConfig = { url: 'http://proxy1:8080' };
    expect(normalizeProxyConfig(config)).toEqual([{ url: 'http://proxy1:8080' }]);
  });

  it('preserves an array of URLs in order', () => {
    const config: ProxyConfig = {
      url: ['http://proxy1:8080', 'http://proxy2:8080'],
    };
    expect(normalizeProxyConfig(config)).toEqual([
      { url: 'http://proxy1:8080' },
      { url: 'http://proxy2:8080' },
    ]);
  });

  it('copies shared auth into every proxy entry', () => {
    const config: ProxyConfig = {
      url: ['http://proxy1:8080', 'http://proxy2:8080'],
      username: 'user',
      password: 'pass',
      rejectUnauthorized: false,
    };
    const entries = normalizeProxyConfig(config);
    expect(entries[0].username).toBe('user');
    expect(entries[0].password).toBe('pass');
    expect(entries[0].rejectUnauthorized).toBe(false);
    expect(entries[1].username).toBe('user');
    expect(entries[1].password).toBe('pass');
  });
});

describe('selectProxy', () => {
  const proxies = [
    { url: 'http://proxy1:8080' },
    { url: 'http://proxy2:8080' },
    { url: 'http://proxy3:8080' },
  ];

  it('returns proxies in round-robin order', () => {
    expect(selectProxy(proxies, 0).url).toBe('http://proxy1:8080');
    expect(selectProxy(proxies, 1).url).toBe('http://proxy2:8080');
    expect(selectProxy(proxies, 2).url).toBe('http://proxy3:8080');
  });

  it('wraps around after the last proxy', () => {
    expect(selectProxy(proxies, 3).url).toBe('http://proxy1:8080');
    expect(selectProxy(proxies, 4).url).toBe('http://proxy2:8080');
    expect(selectProxy(proxies, 5).url).toBe('http://proxy3:8080');
  });
});

describe('isBypassed', () => {
  it('returns false when no bypass rules are configured', () => {
    expect(isBypassed('https://api.example.com/resource')).toBe(false);
    expect(isBypassed('https://api.example.com/resource', [])).toBe(false);
  });

  it('matches a string substring pattern', () => {
    expect(isBypassed('https://api.example.com/resource', ['api.example.com'])).toBe(true);
    expect(isBypassed('https://other.com/resource', ['api.example.com'])).toBe(false);
  });

  it('matches a RegExp pattern', () => {
    expect(
      isBypassed('https://api.example.com/resource', [/example\.com/])
    ).toBe(true);
    expect(isBypassed('https://api.example.com/resource', [/other\.com/])).toBe(false);
  });

  it('returns true if any bypass rule matches', () => {
    expect(
      isBypassed('https://api.example.com/resource', ['other.com', 'example.com'])
    ).toBe(true);
  });

  it('returns false when no rule matches', () => {
    expect(isBypassed('https://api.example.com/resource', ['other.com', 'third.net'])).toBe(
      false
    );
  });
});

describe('buildProxyHeaders', () => {
  it('adds Proxy-Authorization for basic auth', () => {
    const headers = buildProxyHeaders({
      url: 'http://proxy:8080',
      username: 'user',
      password: 'pass',
    });
    expect(headers['Proxy-Authorization']).toBe('Basic dXNlcjpwYXNz');
  });

  it('adds a Via header derived from the proxy host', () => {
    const headers = buildProxyHeaders({ url: 'http://proxy.example.com:8080' });
    expect(headers['Via']).toBe('1.1 proxy.example.com:8080');
  });

  it('returns empty headers when no auth is configured', () => {
    expect(buildProxyHeaders({ url: 'http://proxy:8080' })).toEqual({});
  });
});

describe('HttpClient proxy headers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds Proxy-Authorization and Via headers when a proxy is configured', async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue(null) },
      json: async () => ({ ok: true }),
    });
    const client = new HttpClient('https://api.example.com', {
      proxy: {
        url: 'http://proxy:8080',
        username: 'user',
        password: 'pass',
      },
    });

    await client.request('/api/v1/resource', { method: 'GET' });

    const headers = capturedHeaders(fetchMock);
    expect(headers['Proxy-Authorization']).toBe('Basic dXNlcjpwYXNz');
    expect(headers['Via']).toBe('1.1 proxy:8080');
  });

  it('skips proxy headers when the URL matches a bypass rule', async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue(null) },
      json: async () => ({ ok: true }),
    });
    const client = new HttpClient('https://api.example.com', {
      proxy: {
        url: 'http://proxy:8080',
        username: 'user',
        password: 'pass',
        bypass: ['api.example.com'],
      },
    });

    await client.request('/api/v1/resource', { method: 'GET' });

    const headers = capturedHeaders(fetchMock);
    expect(headers['Proxy-Authorization']).toBeUndefined();
    expect(headers['Via']).toBeUndefined();
  });

  it('skips proxy headers when the URL matches a RegExp bypass rule', async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue(null) },
      json: async () => ({ ok: true }),
    });
    const client = new HttpClient('https://api.example.com', {
      proxy: {
        url: 'http://proxy:8080',
        username: 'user',
        password: 'pass',
        bypass: [/example\.com/],
      },
    });

    await client.request('/api/v1/resource', { method: 'GET' });

    const headers = capturedHeaders(fetchMock);
    expect(headers['Proxy-Authorization']).toBeUndefined();
  });

  it('applies proxy headers for non-bypassed URLs alongside bypassed ones', async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue(null) },
      json: async () => ({ ok: true }),
    });
    const client = new HttpClient('https://api.example.com', {
      proxy: {
        url: 'http://proxy:8080',
        username: 'user',
        password: 'pass',
        bypass: ['localhost'],
      },
    });

    await client.request('/api/v1/resource', { method: 'GET' });

    let headers = capturedHeaders(fetchMock);
    expect(headers['Proxy-Authorization']).toBeDefined();

    // A second client pointed at localhost should bypass.
    const localClient = new HttpClient('http://localhost:3000', {
      proxy: {
        url: 'http://proxy:8080',
        username: 'user',
        password: 'pass',
        bypass: ['localhost'],
      },
    });
    await localClient.request('/api/v1/resource', { method: 'GET' });
    headers = capturedHeaders(fetchMock);
    expect(headers['Proxy-Authorization']).toBeUndefined();
  });

  it('rotates Proxy-Authorization across proxies in round-robin order', async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue(null) },
      json: async () => ({ ok: true }),
    });
    const client = new HttpClient('https://api.example.com', {
      proxy: {
        url: [
          'http://proxy1:8080',
          'http://proxy2:8080',
          'http://proxy3:8080',
        ],
        username: 'userA',
        password: 'passA',
      },
    });

    // To differentiate proxies, give each a distinct auth via separate clients
    // is not possible with shared auth; instead verify round-robin via a fresh
    // client per expected proxy and check the Via header rotates hosts.
    const headers1 = await proxyViaFor(client, fetchMock, '/a');
    expect(headers1['Via']).toBe('1.1 proxy1:8080');

    const headers2 = await proxyViaFor(client, fetchMock, '/b');
    expect(headers2['Via']).toBe('1.1 proxy2:8080');

    const headers3 = await proxyViaFor(client, fetchMock, '/c');
    expect(headers3['Via']).toBe('1.1 proxy3:8080');

    const headers4 = await proxyViaFor(client, fetchMock, '/d');
    expect(headers4['Via']).toBe('1.1 proxy1:8080');
  });

  it('does not add proxy headers when no proxy is configured', async () => {
    const fetchMock = mockFetch({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue(null) },
      json: async () => ({ ok: true }),
    });
    const client = new HttpClient('https://api.example.com');

    await client.request('/api/v1/resource', { method: 'GET' });

    const headers = capturedHeaders(fetchMock);
    expect(headers['Proxy-Authorization']).toBeUndefined();
    expect(headers['Via']).toBeUndefined();
  });
});

async function proxyViaFor(
  client: HttpClient,
  fetchMock: ReturnType<typeof vi.fn>,
  path: string
): Promise<Record<string, string>> {
  await client.request(path, { method: 'GET' });
  return capturedHeaders(fetchMock);
}
