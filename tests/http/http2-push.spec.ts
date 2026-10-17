import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Http2PushManager } from '../../src/http/http2-push';
import { HttpClient } from '../../src/http/http-client';

describe('Http2PushManager detection', () => {
  const originalProcess = globalThis.process;

  afterEach(() => {
    globalThis.process = originalProcess;
    vi.restoreAllMocks();
  });

  it('detects HTTP/2 as available in Node.js', () => {
    globalThis.process = { versions: { node: '20.0.0' } } as unknown as NodeJS.Process;
    const manager = new Http2PushManager();
    expect(manager.isHttp2Available()).toBe(true);
    expect(manager.isEnabled()).toBe(true);
  });

  it('detects HTTP/2 as available in browser-like environments', () => {
    globalThis.process = undefined as unknown as NodeJS.Process;
    const manager = new Http2PushManager();
    expect(manager.isHttp2Available()).toBe(true);
  });

  it('is disabled when explicitly configured', () => {
    globalThis.process = { versions: { node: '20.0.0' } } as unknown as NodeJS.Process;
    const manager = new Http2PushManager({ enabled: false });
    expect(manager.isEnabled()).toBe(false);
    expect(manager.isHttp2Available()).toBe(true);
  });
});

describe('Http2PushManager caching', () => {
  const originalProcess = globalThis.process;

  beforeEach(() => {
    globalThis.process = { versions: { node: '20.0.0' } } as unknown as NodeJS.Process;
  });

  afterEach(() => {
    globalThis.process = originalProcess;
    vi.restoreAllMocks();
  });

  it('caches and retrieves a pushed resource', () => {
    const manager = new Http2PushManager();
    manager.cachePushedResource('https://api.example.com/style.css', { css: 'body {}' }, { 'content-type': 'text/css' });

    expect(manager.hasPushedResource('https://api.example.com/style.css')).toBe(true);
    const entry = manager.getPushedResource('https://api.example.com/style.css');
    expect(entry).toBeDefined();
    expect(entry?.data).toEqual({ css: 'body {}' });
    expect(entry?.method).toBe('GET');
    expect(entry?.headers['content-type']).toBe('text/css');
  });

  it('consumes a cached pushed resource', () => {
    const manager = new Http2PushManager();
    manager.cachePushedResource('https://api.example.com/app.js', 'console.log("hi");');

    const data = manager.consumePushedResource('https://api.example.com/app.js');
    expect(data).toBe('console.log("hi");');
  });

  it('returns undefined when consuming a non-cached resource', () => {
    const manager = new Http2PushManager();
    expect(manager.consumePushedResource('https://api.example.com/missing.js')).toBeUndefined();
    expect(manager.hasPushedResource('https://api.example.com/missing.js')).toBe(false);
  });

  it('expires pushed resources after TTL', () => {
    vi.useFakeTimers();
    const manager = new Http2PushManager({ ttl: 1000 });
    manager.cachePushedResource('https://api.example.com/data.json', { value: 42 });

    expect(manager.hasPushedResource('https://api.example.com/data.json')).toBe(true);

    vi.advanceTimersByTime(1001);
    expect(manager.hasPushedResource('https://api.example.com/data.json')).toBe(false);
    expect(manager.consumePushedResource('https://api.example.com/data.json')).toBeUndefined();

    vi.useRealTimers();
  });

  it('evicts oldest resource when max size is reached', () => {
    const manager = new Http2PushManager({ maxPushedResources: 2 });
    manager.cachePushedResource('https://api.example.com/a.js', 'a');
    manager.cachePushedResource('https://api.example.com/b.js', 'b');
    manager.cachePushedResource('https://api.example.com/c.js', 'c');

    expect(manager.hasPushedResource('https://api.example.com/a.js')).toBe(false);
    expect(manager.hasPushedResource('https://api.example.com/b.js')).toBe(true);
    expect(manager.hasPushedResource('https://api.example.com/c.js')).toBe(true);
  });

  it('registers and invokes push handlers', () => {
    const manager = new Http2PushManager();
    const handler = vi.fn();
    manager.registerPushHandler(handler);

    manager.cachePushedResource('https://api.example.com/push.json', { pushed: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].url).toBe('https://api.example.com/push.json');
    expect(handler.mock.calls[0][0].data).toEqual({ pushed: true });
  });

  it('unregisters push handlers', () => {
    const manager = new Http2PushManager();
    const handler = vi.fn();
    manager.registerPushHandler(handler);
    manager.unregisterPushHandler(handler);

    manager.cachePushedResource('https://api.example.com/push.json', { pushed: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('clears all cached pushed resources', () => {
    const manager = new Http2PushManager();
    manager.cachePushedResource('https://api.example.com/a.js', 'a');
    manager.cachePushedResource('https://api.example.com/b.js', 'b');

    manager.clear();
    expect(manager.hasPushedResource('https://api.example.com/a.js')).toBe(false);
    expect(manager.hasPushedResource('https://api.example.com/b.js')).toBe(false);
    expect(manager.getStats().size).toBe(0);
  });

  it('returns cache statistics', () => {
    const manager = new Http2PushManager({ maxPushedResources: 10, ttl: 1000 });
    manager.cachePushedResource('https://api.example.com/a.js', 'a');
    manager.cachePushedResource('https://api.example.com/b.js', 'b');

    const stats = manager.getStats();
    expect(stats.size).toBe(2);
    expect(stats.maxSize).toBe(10);
    expect(stats.urls).toContain('https://api.example.com/a.js');
    expect(stats.urls).toContain('https://api.example.com/b.js');
    expect(stats.http2Available).toBe(true);
    expect(stats.enabled).toBe(true);
  });
});

describe('HttpClient HTTP/2 push integration', () => {
  const originalFetch = globalThis.fetch;
  const originalProcess = globalThis.process;

  beforeEach(() => {
    globalThis.process = { versions: { node: '20.0.0' } } as unknown as NodeJS.Process;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.process = originalProcess;
    vi.restoreAllMocks();
  });

  it('consumes pushed resource instead of fetching', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', {
      http2Push: { enabled: true },
    });
    const manager = client.getHttp2PushManager();
    expect(manager).toBeDefined();
    (manager as Http2PushManager).cachePushedResource(
      'https://api.example.com/api/data',
      { pushed: true },
      { 'content-type': 'application/json' }
    );

    const result = await client.request('/api/data', { method: 'GET' });
    expect(result).toEqual({ pushed: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches normally when no pushed resource is cached', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn().mockReturnValue(null) },
      json: async () => ({ fetched: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', {
      http2Push: { enabled: true },
    });

    const result = await client.request('/api/data', { method: 'GET' });
    expect(result).toEqual({ fetched: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exposes the HTTP/2 push manager', () => {
    const client = new HttpClient('https://api.example.com', { http2Push: { enabled: true } });
    const manager = client.getHttp2PushManager();
    expect(manager).toBeInstanceOf(Http2PushManager);
    expect(manager?.isEnabled()).toBe(true);
  });

  it('does not create push manager when http2Push is false', () => {
    const client = new HttpClient('https://api.example.com', { http2Push: false });
    expect(client.getHttp2PushManager()).toBeUndefined();
  });

  it('creates disabled push manager when http2Push enabled is false', () => {
    const client = new HttpClient('https://api.example.com', { http2Push: { enabled: false } });
    const manager = client.getHttp2PushManager();
    expect(manager).toBeDefined();
    expect(manager?.isEnabled()).toBe(false);
  });

  it('push manager is disabled outside Node.js', () => {
    globalThis.process = undefined as unknown as NodeJS.Process;
    const client = new HttpClient('https://api.example.com', { http2Push: { enabled: true } });
    const manager = client.getHttp2PushManager();
    expect(manager).toBeDefined();
    expect(manager?.isHttp2Available()).toBe(true);
    expect(manager?.isEnabled()).toBe(true);
  });
});
