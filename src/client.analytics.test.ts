/**
 * DorisioClient analytics wiring tests (Issue #60)
 *
 * These drive `DorisioClient.request()` through a middleware that answers the
 * call locally, so no network traffic is involved.
 */

import { describe, it, expect, vi } from 'vitest';
import { DorisioClient, type ClientConfig } from './client';
import type { Middleware } from './types/errors';

const okMiddleware = (data: unknown): Middleware => {
  return async () => ({
    success: true,
    data,
    timestamp: new Date(0).toISOString(),
  });
};

const failingMiddleware =
  (message: string, code?: string): Middleware =>
  async () => {
    const error = new Error(message) as Error & { code?: string };
    if (code) error.code = code;
    throw error;
  };

const createClient = (config: Partial<ClientConfig> = {}): DorisioClient =>
  new DorisioClient({ baseUrl: 'https://analytics.test', ...config });

describe('DorisioClient analytics', () => {
  it('records successful operations', async () => {
    const client = createClient();
    client.use(okMiddleware({ id: 'creator_1' }));

    const response = await client.request<{ id: string }>('GET', '/creators/creator_1');
    expect(response.data?.id).toBe('creator_1');

    const snapshot = client.getAnalyticsSnapshot();
    expect(snapshot.calls).toBe(1);
    expect(snapshot.successes).toBe(1);
    expect(snapshot.errors).toBe(0);
    expect(snapshot.successRate).toBe(1);
    expect(snapshot.methods['GET /creators/creator_1']).toMatchObject({
      calls: 1,
      successes: 1,
      errors: 0,
    });
  });

  it('records failures and surfaces the error message as a pattern', async () => {
    const client = createClient();
    client.use(failingMiddleware('upstream exploded'));

    await expect(client.request('POST', '/tips')).rejects.toThrow('upstream exploded');

    const snapshot = client.getAnalyticsSnapshot();
    expect(snapshot.calls).toBe(1);
    expect(snapshot.errors).toBe(1);
    expect(snapshot.errorRate).toBe(1);
    expect(snapshot.methods['POST /tips']).toMatchObject({ calls: 1, errors: 1 });
    expect(snapshot.errorPatterns[0]).toEqual({
      method: 'POST /tips',
      reason: 'upstream exploded',
      count: 1,
    });
  });

  it('uses the machine-readable error code when one is present', async () => {
    const client = createClient();
    client.use(failingMiddleware('network down', 'NETWORK_ERROR'));

    await expect(client.request('GET', '/wallets')).rejects.toThrow('network down');

    expect(client.getAnalyticsSnapshot().errorPatterns[0]?.reason).toBe('NETWORK_ERROR');
  });

  it('streams events to listeners registered on the client', async () => {
    const client = createClient();
    const listener = vi.fn();
    const unsubscribe = client.onAnalyticsEvent(listener);

    client.use(okMiddleware({ ok: true }));
    await client.request('GET', '/balance');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0].entry.method).toBe('GET /balance');

    unsubscribe();
    await client.request('GET', '/balance');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('exports and clears collected metrics', async () => {
    const client = createClient();
    client.use(okMiddleware({ ok: true }));
    await client.request('GET', '/creators');

    expect(JSON.parse(client.exportAnalytics()).calls).toBe(1);
    expect(client.exportAnalytics('csv')).toContain('"GET /creators"');

    client.getAnalytics().reset();
    expect(client.getAnalyticsSnapshot().calls).toBe(0);
  });

  it('can be switched off through the client config', async () => {
    const client = createClient({ analytics: false });
    client.use(okMiddleware({ ok: true }));

    await client.request('GET', '/creators');

    expect(client.getAnalytics().isEnabled()).toBe(false);
    expect(client.getAnalyticsSnapshot().calls).toBe(0);
  });
});
