/**
 * Concurrency / race-condition coverage for retry-state isolation (#43).
 *
 * These tests model many requests failing at the same instant and assert that:
 *  - each logical request owns its retry counter (no global/shared counter),
 *  - the retry budget is enforced per request,
 *  - the same logical request can never be retried twice concurrently,
 *  - ids are unique and correlated (X-Request-Id) across retries.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { RetryManager, RetryConflictError, generateRequestId } from './retry-manager';
import { HttpClient } from './http-client';
import { ApiError } from '../types';

describe('RetryManager concurrency isolation (#43)', () => {
  it('generates a unique request id under rapid, back-to-back calls', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => generateRequestId('t')));
    expect(ids.size).toBe(5000);
  });

  it('isolates retry state across 120 concurrent requests', async () => {
    const manager = new RetryManager({ maxAttempts: 3, initialDelayMs: 0, jitter: false });
    const attempts = new Map<string, number>();

    const tasks = Array.from({ length: 120 }, (_, i) => {
      const requestId = `concurrent-${i}`;
      return manager.executeWithRetry<string>(
        async () => {
          const n = (attempts.get(requestId) ?? 0) + 1;
          attempts.set(requestId, n);
          if (n < 3) {
            throw new ApiError('transient', 503);
          }
          return `ok-${requestId}`;
        },
        { requestId }
      );
    });

    const results = await Promise.all(tasks);

    expect(results).toHaveLength(120);
    results.forEach((result, i) => expect(result).toBe(`ok-concurrent-${i}`));
    // Every request used exactly its own maxAttempts — never a shared counter.
    attempts.forEach((n) => expect(n).toBe(3));
    expect(attempts.size).toBe(120);
    expect(manager.getInFlightCount()).toBe(0);
  });

  it('enforces the retry budget per request, not globally', async () => {
    const manager = new RetryManager({ maxAttempts: 2, initialDelayMs: 0, jitter: false });
    let failingAttempts = 0;

    const failing = manager.executeWithRetry(
      async () => {
        failingAttempts += 1;
        throw new ApiError('boom', 500);
      },
      { requestId: 'always-fails' }
    );
    const succeeding = manager.executeWithRetry(async () => 'done', {
      requestId: 'succeeds',
    });

    await expect(failing).rejects.toBeInstanceOf(ApiError);
    await expect(succeeding).resolves.toBe('done');
    expect(failingAttempts).toBe(2);
  });

  it('rejects a duplicate concurrent retry of the same request id', async () => {
    const manager = new RetryManager({ maxAttempts: 3, initialDelayMs: 10, jitter: false });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = manager.executeWithRetry(
      async () => {
        await gate;
        return 'first';
      },
      { requestId: 'dup' }
    );

    await expect(
      manager.executeWithRetry(async () => 'second', { requestId: 'dup' })
    ).rejects.toBeInstanceOf(RetryConflictError);

    release();
    await expect(first).resolves.toBe('first');
    expect(manager.getInFlightCount()).toBe(0);
  });

  it('reports in-flight ids while a retry sequence runs', async () => {
    const manager = new RetryManager({ maxAttempts: 1, initialDelayMs: 0 });
    let seen: string[] = [];

    await manager.executeWithRetry(
      async () => {
        seen = manager.getInFlightRequestIds();
        return 1;
      },
      { requestId: 'visible' }
    );

    expect(seen).toContain('visible');
    expect(manager.getInFlightRequestIds()).not.toContain('visible');
  });

  it('still supports the legacy isRetryable function signature', async () => {
    const manager = new RetryManager({ maxAttempts: 2, initialDelayMs: 0, jitter: false });
    let calls = 0;

    await expect(
      manager.executeWithRetry(
        async () => {
          calls += 1;
          throw new Error('nope');
        },
        () => false
      )
    ).rejects.toThrow('nope');

    expect(calls).toBe(1);
  });

  it('invokes onRetry with per-request attempt metadata', async () => {
    const manager = new RetryManager({ maxAttempts: 3, initialDelayMs: 0, jitter: false });
    const seen: Array<{ requestId: string; attempt: number }> = [];

    await manager.executeWithRetry(
      async () => {
        if (seen.length < 2) {
          throw new ApiError('transient', 500);
        }
        return 'ok';
      },
      {
        requestId: 'meta',
        onRetry: ({ requestId, attempt }) => seen.push({ requestId, attempt }),
      }
    );

    expect(seen).toEqual([
      { requestId: 'meta', attempt: 0 },
      { requestId: 'meta', attempt: 1 },
    ]);
  });
});

describe('HttpClient concurrent request isolation (#43)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('tags each logical request with a distinct X-Request-Id', async () => {
    const seen: string[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      seen.push(headers['X-Request-Id'] ?? '');
      return { ok: true, json: async () => ({ ok: true }) };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com');
    await Promise.all(
      Array.from({ length: 50 }, () => client.request('/api/v1/health', { method: 'GET' }))
    );

    expect(seen).toHaveLength(50);
    expect(new Set(seen).size).toBe(50);
    expect(seen.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
    expect(client.getInFlightRequestCount()).toBe(0);
  });

  it('keeps one request id across retries of the same logical request', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const headersOf = (init?: RequestInit) => init?.headers as Record<string, string>;

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        seen.push(headersOf(init)['X-Request-Id'] ?? '');
        return { ok: false, status: 500, json: async () => ({ error: 'x' }) };
      })
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        seen.push(headersOf(init)['X-Request-Id'] ?? '');
        return { ok: true, json: async () => ({ ok: true }) };
      });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', { retryAttempts: 3 });
    const pending = client.request('/api/v1/health', { method: 'GET', requestId: 'stable-id' });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual({ ok: true });
    expect(seen).toEqual(['stable-id', 'stable-id']);
  });

  it('honours a caller-supplied X-Request-Id header instead of overwriting it', async () => {
    let header: string | undefined;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      header = (init?.headers as Record<string, string>)['X-Request-Id'];
      return { ok: true, json: async () => ({ ok: true }) };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com');
    await client.request('/api/v1/health', {
      method: 'GET',
      headers: { 'X-Request-Id': 'caller-owned' },
    });

    expect(header).toBe('caller-owned');
  });

  it('rejects two concurrent requests that reuse the same request id', async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
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

    const client = new HttpClient('https://api.example.com');
    const controller = new AbortController();
    const first = client.request('/api/v1/a', {
      method: 'GET',
      requestId: 'same',
      signal: controller.signal,
    });

    await expect(
      client.request('/api/v1/b', { method: 'GET', requestId: 'same' })
    ).rejects.toBeInstanceOf(RetryConflictError);
    expect(client.getInFlightRequestIds()).toContain('same');

    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    expect(client.getInFlightRequestIds()).not.toContain('same');
  });

  it('retries concurrent 500s independently without exceeding the per-request budget', async () => {
    vi.useFakeTimers();
    const calls = new Map<string, number>();
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const id = (init?.headers as Record<string, string>)['X-Request-Id'] ?? '';
      calls.set(id, (calls.get(id) ?? 0) + 1);
      return { ok: false, status: 500, json: async () => ({ error: 'x' }) };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', { retryAttempts: 3 });
    const pending = Array.from({ length: 12 }, (_, i) =>
      client
        .request('/api/v1/health', { method: 'GET', requestId: `r-${i}` })
        .catch((error: unknown) => error)
    );
    await vi.runAllTimersAsync();
    await Promise.all(pending);

    expect(calls.size).toBe(12);
    calls.forEach((n) => expect(n).toBe(3));
    expect(client.getInFlightRequestCount()).toBe(0);
  });
});
