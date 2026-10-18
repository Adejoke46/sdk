/**
 * E2E: error handling and recovery against the mock backend (Issue #55)
 *
 * Covers server failures, client errors, rate limiting, an unreachable network
 * and the transparent 401 → session refresh → replay path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetConfig, setConfig } from '../config';
import type { DorisioClient } from '../client';
import { MockApiServer, apiError, envelope } from '../__mocks__/server';
import { TIP, apiSession, apiTransaction, createE2eClient } from './helpers';

const CONFIRM_PATH = `/api/v1/transactions/${TIP.ID}/confirm`;

describe('E2E: error scenarios and recovery', () => {
  const server = new MockApiServer();
  let client: DorisioClient;

  beforeEach(() => {
    setConfig({ retryAttempts: 1 });
    server.reset();
    server.start();
    client = createE2eClient();
  });

  afterEach(() => {
    server.stop();
    resetConfig();
  });

  it('recovers from a 503 through the error handler', async () => {
    server.sequence('GET', CONFIRM_PATH, [
      { status: 503, body: apiError('Service unavailable', 'UNAVAILABLE') },
      {
        status: 200,
        body: envelope(apiTransaction({ stellarStatus: 'confirmed' })),
      },
    ]);

    const retries: number[] = [];
    client.onError((error, context) => {
      retries.push(context.attempt ?? 0);
      return error.statusCode === 503 ? { action: 'retry', delayMs: 0 } : { action: 'throw' };
    });

    const confirmed = await client.checkTransactionConfirmation(TIP.ID, { retries: 2 });

    expect(confirmed.status).toBe('confirmed');
    expect(server.callCount('GET', CONFIRM_PATH)).toBe(2);
    expect(retries).toEqual([1]);
  });

  it('does not retry a 4xx and surfaces it as ApiError', async () => {
    server.on('GET', CONFIRM_PATH, () => ({
      status: 404,
      body: apiError('Transaction not found', 'NOT_FOUND'),
    }));

    await expect(client.checkTransactionConfirmation(TIP.ID)).rejects.toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Transaction not found',
    });
    expect(server.callCount('GET', CONFIRM_PATH)).toBe(1);
  });

  it('surfaces rate limits together with Retry-After', async () => {
    server.on('GET', CONFIRM_PATH, () => ({
      status: 429,
      body: apiError('Too many requests', 'RATE_LIMITED'),
      headers: { 'Retry-After': '30' },
    }));

    await expect(client.checkTransactionConfirmation(TIP.ID)).rejects.toMatchObject({
      statusCode: 429,
      retryAfter: 30,
    });
    expect(server.callCount('GET', CONFIRM_PATH)).toBe(1);
  });

  it('fails fast when the network is unreachable and recovers once it is back', async () => {
    server.on('GET', CONFIRM_PATH, () => ({
      status: 200,
      body: envelope(apiTransaction({ stellarStatus: 'confirmed' })),
    }));

    server.goOffline();
    await expect(
      client.checkTransactionConfirmation(TIP.ID, { retries: 1 })
    ).rejects.toThrow(/fetch failed/);
    expect(server.callCount('GET', CONFIRM_PATH)).toBe(1);

    server.goOnline();
    const confirmed = await client.checkTransactionConfirmation(TIP.ID, { retries: 1 });

    expect(confirmed.status).toBe('confirmed');
    expect(server.callCount('GET', CONFIRM_PATH)).toBe(2);
  });

  it('refreshes an expired session once and replays the request', async () => {
    let refreshCalls = 0;

    server.on('POST', '/auth/refresh', () => {
      refreshCalls += 1;
      return { status: 200, body: envelope(apiSession('fresh_access_token')) };
    });
    server.on('GET', CONFIRM_PATH, (request) => {
      if (request.headers.authorization !== 'Bearer fresh_access_token') {
        return { status: 401, body: apiError('Token expired', 'TOKEN_EXPIRED') };
      }
      return {
        status: 200,
        body: envelope(apiTransaction({ stellarStatus: 'confirmed', stellarTxHash: TIP.TX_HASH })),
      };
    });

    const confirmed = await client.checkTransactionConfirmation(TIP.ID);

    expect(confirmed.status).toBe('confirmed');
    expect(refreshCalls).toBe(1);
    expect(server.requestedPaths()).toEqual(['GET ' + CONFIRM_PATH, 'POST /auth/refresh', 'GET ' + CONFIRM_PATH]);
    expect(server.getCalls('GET', CONFIRM_PATH)[0]?.headers.authorization).toBe(
      'Bearer e2e_access_token'
    );
    expect(server.getCalls('GET', CONFIRM_PATH)[1]?.headers.authorization).toBe(
      'Bearer fresh_access_token'
    );
    expect(client.getConfig().token).toBe('fresh_access_token');
  });

  it('reports the failure once a retryable endpoint is exhausted', async () => {
    server.on('GET', CONFIRM_PATH, () => ({
      status: 500,
      body: apiError('Boom', 'INTERNAL'),
    }));

    await expect(client.checkTransactionConfirmation(TIP.ID, { retries: 2 })).rejects.toMatchObject({
      statusCode: 500,
    });
    expect(server.callCount('GET', CONFIRM_PATH)).toBe(2);
  });

  it('stops retrying when the request is aborted', async () => {
    const controller = new AbortController();
    server.on('GET', CONFIRM_PATH, () => {
      controller.abort();
      return { status: 200, body: envelope(apiTransaction()) };
    });

    await expect(
      client.checkTransactionConfirmation(TIP.ID, {
        retries: 2,
        signal: controller.signal,
      })
    ).rejects.toBeTruthy();
    expect(server.callCount('GET', CONFIRM_PATH)).toBe(1);
  });
});
