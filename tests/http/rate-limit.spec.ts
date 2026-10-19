// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../../src/http/http-client';
import { parseRateLimitHeaders, RetryManager } from '../../src/http/retry-manager';
import { ApiError, RateLimitError } from '../../src/types';

const now = Date.parse('2026-10-16T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('rate-limit header parsing', () => {
  it.each([
    ['60', 60],
    ['0', 0],
    [' 12 ', 12],
    ['Fri, 16 Oct 2026 12:00:45 GMT', 45],
    ['Fri, 16 Oct 2026 11:59:00 GMT', 0],
  ])('parses Retry-After %s as %s seconds', (value, expected) => {
    expect(parseRateLimitHeaders(new Headers({ 'retry-after': value })).retryAfter).toBe(expected);
  });

  it.each(['', '-1', '1.5', 'Infinity', 'NaN', '1e3', 'tomorrow', '9'.repeat(320)])(
    'ignores invalid Retry-After %s',
    (value) => {
      expect(
        parseRateLimitHeaders(new Headers({ 'Retry-After': value })).retryAfter
      ).toBeUndefined();
    }
  );

  it('preserves subsecond precision in date delays', () => {
    vi.setSystemTime(now + 250);
    expect(
      parseRateLimitHeaders(new Headers({ 'Retry-After': 'Fri, 16 Oct 2026 12:00:01 GMT' }))
        .retryAfter
    ).toBe(0.75);
  });

  it('handles missing headers', () => {
    expect(parseRateLimitHeaders().retryAfter).toBeUndefined();
  });

  it('parses X-RateLimit metadata and uses its Unix reset timestamp as a fallback', () => {
    expect(
      parseRateLimitHeaders(
        new Headers({
          'x-ratelimit-limit': '100',
          'x-ratelimit-remaining': '0',
          'x-ratelimit-reset': String(now / 1000 + 20),
        })
      )
    ).toEqual({
      retryAfter: 20,
      rateLimit: { limit: 100, remaining: 0, reset: now / 1000 + 20 },
    });
  });

  it('accepts a reset HTTP date when Retry-After is malformed', () => {
    expect(
      parseRateLimitHeaders(
        new Headers({
          'Retry-After': 'invalid',
          'X-RateLimit-Reset': 'Fri, 16 Oct 2026 12:00:15 GMT',
        })
      ).retryAfter
    ).toBe(15);
  });

  it('gives Retry-After precedence over X-RateLimit-Reset, including zero', () => {
    expect(
      parseRateLimitHeaders(
        new Headers({ 'Retry-After': '0', 'X-RateLimit-Reset': String(now / 1000 + 20) })
      ).retryAfter
    ).toBe(0);
  });

  it('clamps a past reset timestamp to zero', () => {
    expect(
      parseRateLimitHeaders(new Headers({ 'X-RateLimit-Reset': String(now / 1000 - 10) }))
        .retryAfter
    ).toBe(0);
  });

  it('ignores invalid X-RateLimit metadata', () => {
    const parsed = parseRateLimitHeaders(
      new Headers({
        'X-RateLimit-Limit': '-10',
        'X-RateLimit-Remaining': 'unknown',
        'X-RateLimit-Reset': 'Infinity',
      })
    );
    expect(parsed.retryAfter).toBeUndefined();
    expect(parsed.rateLimit).toEqual({ limit: undefined, remaining: undefined, reset: undefined });
  });
});

describe('RetryManager rate-limit scheduling', () => {
  it('waits exactly the server duration without jitter or the exponential cap', async () => {
    const manager = new RetryManager({ maxAttempts: 2, maxDelayMs: 1000 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RateLimitError('limited', 60))
      .mockResolvedValue('ok');
    const onRetry = vi.fn();
    const pending = manager.executeWithRetry(fn, { onRetry });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ delayMs: 60_000 }));
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not overflow long server waits into an immediate retry', async () => {
    const manager = new RetryManager({ maxAttempts: 2 });
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ApiError('limited', 429, undefined, 3_000_000))
      .mockResolvedValue('ok');
    const pending = manager.executeWithRetry(fn);
    await vi.advanceTimersByTimeAsync(2 ** 31);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000_000_000 - 2 ** 31);
    await expect(pending).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('honors a custom retry predicate even when the server supplies a delay', async () => {
    const manager = new RetryManager({ maxAttempts: 3 });
    const error = new ApiError('limited', 429, undefined, 60);
    const fn = vi.fn().mockRejectedValue(error);
    await expect(manager.executeWithRetry(fn, () => false)).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('keeps the configured exponential fallback when no valid delay is available', async () => {
    const manager = new RetryManager({
      maxAttempts: 3,
      initialDelayMs: 200,
      backoffMultiplier: 3,
      maxDelayMs: 500,
      jitter: false,
    });
    const fn = vi.fn().mockRejectedValue(new ApiError('limited', 429));
    const pending = manager.executeWithRetry(fn).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(199);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBeInstanceOf(ApiError);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([0, 1])('keeps fallback jitter within maxDelayMs with random value %s', (random) => {
    vi.spyOn(Math, 'random').mockReturnValue(random);
    const manager = new RetryManager({ initialDelayMs: 1000, maxDelayMs: 1000 });
    expect(manager.calculateDelay(5, new ApiError('limited', 429))).toBe(1000);
  });

  it.each([-1, Infinity, NaN])('ignores invalid error retryAfter %s', (delay) => {
    const manager = new RetryManager({ initialDelayMs: 250, jitter: false });
    expect(manager.calculateDelay(0, new ApiError('limited', 429, undefined, delay))).toBe(250);
  });

  it('does not use rate-limit delay hints for unrelated errors', () => {
    const manager = new RetryManager({ initialDelayMs: 250, jitter: false });
    expect(manager.calculateDelay(0, new ApiError('server error', 500, undefined, 60))).toBe(250);
  });
});

function mockFetch(headers: Record<string, string> = {}) {
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(
      async () => new Response('{"error":"limited"}', { status: 429, headers })
    )
    .mockImplementation(async () => new Response('{"ok":true}'));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('HttpClient rate-limit retries', () => {
  it('cancels a server wait immediately without issuing another request', async () => {
    const fetchMock = mockFetch({ 'Retry-After': '3600' });
    const controller = new AbortController();
    const client = new HttpClient('https://api.example.com', { retryAttempts: 2 });
    const pending = client
      .request('/items', { method: 'GET', signal: controller.signal })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    expect(await pending).toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('releases connection slots while rate-limited requests wait', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async (url: string) =>
          url.endsWith('/available')
            ? new Response('{"ok":true}')
            : new Response('{"error":"limited"}', {
                status: 429,
                headers: { 'Retry-After': '3600' },
              })
        )
    );
    const controller = new AbortController();
    const client = new HttpClient('https://api.example.com', { retryAttempts: 2 });
    const pending = Array.from({ length: 10 }, (_, i) =>
      client
        .request(`/limited/${i}`, { method: 'GET', signal: controller.signal })
        .catch((error: unknown) => error)
    );
    await vi.advanceTimersByTimeAsync(1);
    await expect(client.request('/available', { method: 'GET' })).resolves.toEqual({ ok: true });
    controller.abort();
    const errors = await Promise.all(pending);
    expect(errors.every((error) => error instanceof Error && error.name === 'AbortError')).toBe(
      true
    );
  });

  it.each([
    [{ 'Retry-After': '2' }, 2000],
    [{ 'Retry-After': 'Fri, 16 Oct 2026 12:00:03 GMT' }, 3000],
    [{ 'X-RateLimit-Reset': String(now / 1000 + 4) }, 4000],
  ])('waits for server headers %j before retrying', async (headers, delayMs) => {
    const fetchMock = mockFetch(headers);
    const client = new HttpClient('https://api.example.com', { retryAttempts: 2 });
    const pending = client.request('/items', { method: 'GET' });
    await vi.advanceTimersByTimeAsync(delayMs - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('preserves parsed headers on the final error without waiting after the final attempt', async () => {
    const fetchMock = mockFetch({
      'Retry-After': '60',
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(now / 1000 + 60),
    });
    const client = new HttpClient('https://api.example.com');
    await expect(client.request('/items', { method: 'GET', retries: 1 })).rejects.toMatchObject({
      name: 'RateLimitError',
      retryable: true,
      statusCode: 429,
      retryAfter: 60,
      rateLimit: { limit: 100, remaining: 0, reset: now / 1000 + 60 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('limits repeated 429 responses to the configured attempt count', async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response('{"error":"limited"}', { status: 429, headers: { 'Retry-After': '2' } })
      );
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpClient('https://api.example.com', { retryAttempts: 2 });
    const pending = client.request('/items', { method: 'GET' }).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toMatchObject({ statusCode: 429, retryAfter: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not automatically retry non-idempotent requests', async () => {
    const fetchMock = mockFetch({ 'Retry-After': '2' });
    const client = new HttpClient('https://api.example.com', { retryAttempts: 3 });
    await expect(client.request('/payments', { method: 'POST' })).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows rate-limit retries with an idempotency key', async () => {
    const fetchMock = mockFetch({ 'Retry-After': '2' });
    const client = new HttpClient('https://api.example.com', { retryAttempts: 2 });
    const pending = client.request('/payments', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'payment-1' },
    });
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses capped jittered backoff when Retry-After is invalid', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const fetchMock = mockFetch({ 'Retry-After': '-1' });
    const client = new HttpClient('https://api.example.com', { retryAttempts: 2, retryJitter: true });
    const pending = client.request('/items', { method: 'GET' });
    await vi.advanceTimersByTimeAsync(1099);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('preserves explicit custom retry delays', async () => {
    const fetchMock = mockFetch({ 'Retry-After': '60' });
    const client = new HttpClient('https://api.example.com', {
      retryAttempts: 2,
      errorHandler: () => ({ action: 'retry', delayMs: 25 }),
    });
    const pending = client.request('/items', { method: 'GET' });
    await vi.advanceTimersByTimeAsync(24);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('uses server hints when a custom retry handler does not specify a delay', async () => {
    const fetchMock = mockFetch({ 'Retry-After': '2' });
    const client = new HttpClient('https://api.example.com', {
      retryAttempts: 2,
      errorHandler: () => ({ action: 'retry' }),
    });
    const pending = client.request('/items', { method: 'GET' });
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('honors custom throw and fallback decisions', async () => {
    const fetchMock = mockFetch({ 'Retry-After': '2' });
    const throwingClient = new HttpClient('https://api.example.com', {
      errorHandler: () => ({ action: 'throw' }),
    });
    await expect(throwingClient.request('/items', { method: 'GET' })).rejects.toMatchObject({
      statusCode: 429,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    mockFetch({ 'Retry-After': '2' });
    const fallbackClient = new HttpClient('https://api.example.com', {
      errorHandler: () => ({ action: 'fallback', fallbackValue: { cached: true } }),
    });
    await expect(fallbackClient.request('/items', { method: 'GET' })).resolves.toEqual({
      cached: true,
    });
  });

  it('does not reuse an expired per-attempt timeout after a long server wait', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_url, options: RequestInit) => {
        const signal = options.signal as AbortSignal;
        signals.push(signal);
        signal.throwIfAborted();
        return signals.length === 1
          ? new Response('{"error":"limited"}', { status: 429, headers: { 'Retry-After': '60' } })
          : new Response('{"ok":true}');
      })
    );
    const client = new HttpClient('https://api.example.com', { timeout: 1000, retryAttempts: 2 });
    const pending = client.request('/items', { method: 'GET' });
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).resolves.toEqual({ ok: true });
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[1]?.aborted).toBe(false);
  });
});
