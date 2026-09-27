/**
 * HttpClient retry / idempotency / session-refresh tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpClient } from './http-client';
import { ApiError, DorisioError } from '../types';
import type { ErrorHandlerContext } from '../types/errors';

describe('HttpClient idempotent retries', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not retry POST /transactions/tip on 500 (non-idempotent)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error', code: 'INTERNAL' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', { retryAttempts: 3 });

    await expect(
      client.request('/api/v1/transactions/tip', {
        method: 'POST',
        body: { creatorId: 'c1', amount: 10 },
      })
    ).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry POST on 400 Duplicate tip', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Duplicate tip', code: 'DUPLICATE' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', { retryAttempts: 3 });

    await expect(
      client.request('/api/v1/transactions/tip', {
        method: 'POST',
        body: { creatorId: 'c1', amount: 10 },
      })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries GET on 500 up to maxAttempts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Server error' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', { retryAttempts: 3 });

    const promise = client.request('/api/v1/health', { method: 'GET' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries POST when isIdempotent is true', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'tip-1' }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', { retryAttempts: 3 });

    const promise = client.request('/api/v1/transactions/tip', {
      method: 'POST',
      body: { creatorId: 'c1', amount: 10 },
      isIdempotent: true,
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ id: 'tip-1' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries POST when Idempotency-Key header is present', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        json: async () => ({ error: 'Bad gateway' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'tip-2' }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', { retryAttempts: 3 });

    const promise = client.request('/api/v1/transactions/tip', {
      method: 'POST',
      body: { creatorId: 'c1', amount: 10 },
      headers: { 'Idempotency-Key': 'abc-123' },
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ id: 'tip-2' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry DELETE without isIdempotent flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', { retryAttempts: 3 });

    await expect(client.request('/api/v1/wallets/1', { method: 'DELETE' })).rejects.toBeInstanceOf(
      ApiError
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('honors an external abort signal and skips retries', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      capturedSignal = init?.signal;
      return new Promise((_resolve, reject) => {
        // Like a real fetch, an already-aborted signal rejects immediately —
        // listeners alone never fire retroactively.
        if (init?.signal?.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', { retryAttempts: 3 });
    const controller = new AbortController();
    const pending = client.request('/api/v1/transactions/history', {
      method: 'GET',
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(true);
  });
});

function unauthorized() {
  return {
    ok: false,
    status: 401,
    json: async () => ({ error: 'Unauthorized', code: 'UNAUTHORIZED' }),
  };
}

describe('HttpClient 401 session refresh', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('refreshes the session and replays the request with the new token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'user-1' }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com');
    client.setHeader('Authorization', 'Bearer stale');

    let refreshes = 0;
    client.setTokenRefresher(async () => {
      refreshes += 1;
      client.setHeader('Authorization', 'Bearer fresh');
    });

    await expect(client.request('/api/v1/users/me', { method: 'GET' })).resolves.toEqual({
      id: 'user-1',
    });

    expect(refreshes).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const replay = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect((replay.headers as Record<string, string>).Authorization).toBe('Bearer fresh');
  });

  it('surfaces the original 401 when the refresh fails, without looping', async () => {
    const fetchMock = vi.fn().mockResolvedValue(unauthorized());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com');
    client.setHeader('Authorization', 'Bearer stale');

    let refreshes = 0;
    client.setTokenRefresher(async () => {
      refreshes += 1;
      throw new Error('refresh rejected');
    });

    await expect(client.request('/api/v1/users/me', { method: 'GET' })).rejects.toMatchObject({
      statusCode: 401,
    });

    expect(refreshes).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when the endpoint is the refresh endpoint itself', async () => {
    const fetchMock = vi.fn().mockResolvedValue(unauthorized());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com');
    client.setHeader('Authorization', 'Bearer stale');

    let refreshes = 0;
    client.setTokenRefresher(async () => {
      refreshes += 1;
    });

    await expect(client.request('/auth/refresh', { method: 'POST' })).rejects.toMatchObject({
      statusCode: 401,
    });

    expect(refreshes).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not refresh a request that carries no credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(unauthorized());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com');

    let refreshes = 0;
    client.setTokenRefresher(async () => {
      refreshes += 1;
    });

    await expect(client.request('/api/v1/users/me', { method: 'GET' })).rejects.toMatchObject({
      statusCode: 401,
    });

    expect(refreshes).toBe(0);
  });

  it('shares a single refresh across concurrent 401s', async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call <= 2) return unauthorized();
      return { ok: true, json: async () => ({ call }) };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com');
    client.setHeader('Authorization', 'Bearer stale');

    let refreshes = 0;
    client.setTokenRefresher(async () => {
      refreshes += 1;
      await Promise.resolve();
      client.setHeader('Authorization', 'Bearer fresh');
    });

    const [a, b] = await Promise.all([
      client.request('/api/v1/alpha', { method: 'GET' }),
      client.request('/api/v1/beta', { method: 'GET' }),
    ]);

    expect(refreshes).toBe(1);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('replays a non-idempotent POST after a 401 (auth retry is exempt)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'tip-1' }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com');
    client.setHeader('Authorization', 'Bearer stale');
    client.setTokenRefresher(async () => {
      client.setHeader('Authorization', 'Bearer fresh');
    });

    await expect(
      client.request('/api/v1/transactions/tip', { method: 'POST', body: { amount: 10 } })
    ).resolves.toEqual({ id: 'tip-1' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('HttpClient diagnostics and request deduplication', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs sanitized request and response metadata when debug is enabled', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const logger = vi.fn();
    const client = new HttpClient('https://api.example.com', {
      debug: true,
      logger,
      retryAttempts: 1,
      headers: { Authorization: 'Bearer should-not-leak' },
    });

    await client.request('/api/v1/debug', {
      method: 'POST',
      body: { token: 'secret-token', value: 'safe' },
    });

    expect(logger).toHaveBeenCalledTimes(2);
    expect(logger.mock.calls[0]?.[0]).toBe('[DORISIO] request');
    expect(logger.mock.calls[0]?.[1]).toMatchObject({
      body: { token: '[REDACTED]', value: 'safe' },
      headers: { Authorization: '[REDACTED]' },
    });
    expect(logger.mock.calls[1]?.[0]).toBe('[DORISIO] response');
    expect(logger.mock.calls[1]?.[1]).toMatchObject({ status: 200, elapsedMs: expect.any(Number) });
  });

  it('shares identical in-flight requests and reuses the result within the window', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 1 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new HttpClient('https://api.example.com', {
      deduplicateRequests: true,
      deduplicationWindow: 1000,
      retryAttempts: 1,
    });

    const first = client.request('/api/v1/items', { method: 'GET' });
    const second = client.request('/api/v1/items', { method: 'GET' });
    await expect(Promise.all([first, second])).resolves.toEqual([{ id: 1 }, { id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not share requests with different bodies and clears rejected entries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 1 }) })
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 2 }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const client = new HttpClient('https://api.example.com', {
      deduplicateRequests: true,
      deduplicationWindow: 1000,
      retryAttempts: 1,
    });

    await client.request('/api/v1/items', { method: 'POST', body: { id: 1 } });
    await expect(
      client.request('/api/v1/items', { method: 'POST', body: { id: 2 } })
    ).rejects.toThrow('network down');
    await expect(
      client.request('/api/v1/items', { method: 'POST', body: { id: 2 } })
    ).resolves.toEqual({
      id: 2,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('HttpClient custom error handlers', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('calls error handler and retries with custom delay', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: 'Rate limited', code: 'RATE_LIMITED' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', {
      retryAttempts: 3,
      errorHandler: async (error: DorisioError) => {
        if (error.statusCode === 429) {
          return { action: 'retry', delayMs: 100 };
        }
        return { action: 'throw' };
      },
    });

    const promise = client.request('/api/v1/data', { method: 'GET' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('calls error handler and returns fallback value', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error', code: 'INTERNAL' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', {
      retryAttempts: 3,
      errorHandler: async (error: DorisioError) => {
        if (error.statusCode && error.statusCode >= 500) {
          return { action: 'fallback', fallbackValue: { cached: true } };
        }
        return { action: 'throw' };
      },
    });

    const result = await client.request('/api/v1/data', { method: 'GET' });

    expect(result).toEqual({ cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('calls error handler and throws when action is throw', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Bad request', code: 'BAD_REQUEST' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', {
      retryAttempts: 3,
      errorHandler: async () => {
        return { action: 'throw' };
      },
    });

    await expect(client.request('/api/v1/data', { method: 'GET' })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('provides error context to handler', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Rate limited' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    let capturedContext: ErrorHandlerContext = {
      method: 'GET',
      path: '',
    };
    const client = new HttpClient('https://api.example.com', {
      retryAttempts: 1,
      errorHandler: async (_error: DorisioError, context: ErrorHandlerContext) => {
        capturedContext = context;
        return { action: 'throw' };
      },
    });

    await expect(
      client.request('/api/v1/data', { method: 'POST', body: { test: 'value' } })
    ).rejects.toBeInstanceOf(ApiError);

    expect(capturedContext).toMatchObject({
      method: 'POST',
      path: '/api/v1/data',
      body: { test: 'value' },
      attempt: 1,
    });
    expect(capturedContext.requestId).toBeDefined();
  });

  it('handles async error handlers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: 'Rate limited' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', {
      retryAttempts: 3,
      errorHandler: async (error: DorisioError) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (error.statusCode === 429) {
          return { action: 'retry', delayMs: 50 };
        }
        return { action: 'throw' };
      },
    });

    const promise = client.request('/api/v1/data', { method: 'GET' });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to normal error handling when error handler throws', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Server error' }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', {
      retryAttempts: 1,
      errorHandler: async () => {
        throw new Error('Handler failed');
      },
    });

    await expect(client.request('/api/v1/data', { method: 'GET' })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
