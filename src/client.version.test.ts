import { describe, it, expect, afterEach, vi } from 'vitest';
import { DorisioClient } from './client';

describe('DorisioClient API Version Detection & Auto-Migration', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('exposes api version and allows setting version', () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      apiVersion: 'v1',
      supportedApiVersions: ['v1', 'v2'],
    });

    expect(client.getApiVersion()).toBe('v1');
    client.setApiVersion('v2');
    expect(client.getApiVersion()).toBe('v2');
  });

  it('detects API-Version from response headers in live requests', async () => {
    const onApiVersionChange = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        'API-Version': 'v2',
      }),
      json: async () => ({ success: true, data: { id: 1 } }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      mode: 'live',
      apiVersion: 'v1',
      supportedApiVersions: ['v1', 'v2'],
      onApiVersionChange,
    });

    expect(client.getApiVersion()).toBe('v1');

    await client.request('GET', '/api/v1/users');

    expect(client.getApiVersion()).toBe('v2');
    expect(onApiVersionChange).toHaveBeenCalledWith('v1', 'v2');
  });

  it('detects deprecation from response headers and triggers onApiDeprecation', async () => {
    const onApiDeprecation = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        'API-Version': 'v1',
        Deprecation: 'true',
        Sunset: '2026-11-01',
      }),
      json: async () => ({ success: true, data: { status: 'ok' } }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      mode: 'live',
      onApiDeprecation,
    });

    await client.request('GET', '/api/v1/legacy-endpoint');

    expect(onApiDeprecation).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/legacy-endpoint',
        version: 'v1',
        sunsetDate: '2026-11-01',
      })
    );
  });

  it('warns on pre-configured deprecated endpoints when requested', async () => {
    const onApiDeprecation = vi.fn();
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      mode: 'sandbox',
      deprecatedEndpoints: [
        {
          endpoint: '/api/v1/creators/old-stats',
          alternative: '/api/v2/creators/stats',
        },
      ],
      onApiDeprecation,
    });

    await client.request('GET', '/api/v1/creators/old-stats');

    expect(onApiDeprecation).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: '/api/v1/creators/old-stats',
        alternative: '/api/v2/creators/stats',
      })
    );
  });

  it('auto-migrates request endpoint and attaches API-Version header', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    let capturedPath: string | undefined;

    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      mode: 'sandbox',
      apiVersion: 'v2',
      supportedApiVersions: ['v1', 'v2'],
    });

    client.getApiVersionHandler().registerMigration({
      fromVersion: 'v1',
      toVersion: 'v2',
      migrateRequest: (req) => ({
        ...req,
        path: req.path.replace('/api/v1/', '/api/v2/'),
      }),
    });

    client.use(async (ctx, next) => {
      capturedPath = ctx.path;
      capturedHeaders = ctx.headers;
      return next();
    });

    await client.request('GET', '/api/v1/transactions');

    expect(capturedPath).toBe('/api/v2/transactions');
    expect(capturedHeaders?.['API-Version']).toBe('v2');
  });

  it('falls back when server sends unsupported API version', async () => {
    const logger = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({
        'API-Version': 'v99.0.0',
      }),
      json: async () => ({ success: true, data: { ok: true } }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      mode: 'live',
      apiVersion: 'v1',
      supportedApiVersions: ['v1', 'v2'],
      fallbackApiVersion: 'v1',
      logger,
    });

    await client.request('GET', '/api/v1/check');

    expect(client.getApiVersion()).toBe('v1');
    expect(logger).toHaveBeenCalledWith(
      expect.stringContaining("API version 'v99.0.0' is not supported. Falling back to 'v1'.")
    );
  });
});
