/**
 * E2E: edge cases — duplicates, deduplication and races (Issue #55)
 *
 * Backend behaviour that only shows up under concurrency: idempotent tip
 * creation, collapsed duplicate reads, parallel writes and replayed submits.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetConfig, setConfig } from '../config';
import type { DorisioClient } from '../client';
import { MockApiServer, apiError, envelope } from '../__mocks__/server';
import { TIP, apiTransaction, createE2eClient } from './helpers';

const TIP_PATH = '/api/v1/transactions/tip';
const SUBMIT_PATH = `/api/v1/transactions/${TIP.ID}/submit`;

describe('E2E: duplicate submissions, deduplication and races', () => {
  const server = new MockApiServer();
  let client: DorisioClient;
  let cachedClient: DorisioClient;
  let tipReads: number;

  beforeEach(() => {
    setConfig({ retryAttempts: 1 });
    tipReads = 0;
    server.reset();
    server.start();

    // Reads are counted so deduplication is observable.
    server.on('GET', `/api/v1/transactions/${TIP.ID}`, () => {
      tipReads += 1;
      return { status: 200, body: envelope(apiTransaction({ stellarStatus: 'pending' })) };
    });

    // Idempotent tip creation: the same key yields the same tip, once.
    const byKey = new Map<string, Record<string, unknown>>();
    const inFlight = new Map<string, Promise<{ status: number; body: unknown }>>();
    let sequence = 0;
    server.on('POST', TIP_PATH, async (request) => {
      const key = request.headers['idempotency-key'];
      if (!key) {
        sequence += 1;
        return {
          status: 201,
          body: envelope(apiTransaction({ id: `tip_no_key_${sequence}` })),
        };
      }

      const created = byKey.get(key);
      if (created) return { status: 200, body: envelope(created) };

      const pending = inFlight.get(key);
      if (pending) return pending;

      const work = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const tip = apiTransaction({ id: TIP.ID });
        byKey.set(key, tip);
        inFlight.delete(key);
        return { status: 201, body: envelope(tip) };
      })();
      inFlight.set(key, work);
      return work;
    });

    server.on('POST', SUBMIT_PATH, (request) => {
      const body = request.body ?? {};
      if (body.transactionEnvelope === TIP.SIGNED_ENVELOPE && request.attempt > 1) {
        return {
          status: 409,
          body: apiError('Transaction already submitted', 'ALREADY_SUBMITTED'),
        };
      }
      return {
        status: 200,
        body: envelope({ tipId: TIP.ID, transactionHash: TIP.TX_HASH, status: 'submitted' }),
      };
    });

    client = createE2eClient();
    cachedClient = createE2eClient({ deduplicateRequests: true, deduplicationWindow: 1000 });
  });

  afterEach(() => {
    server.stop();
    resetConfig();
  });

  it('collapses concurrent identical reads into a single request', async () => {
    const results = await Promise.all([
      cachedClient.getTipStatus(TIP.ID),
      cachedClient.getTipStatus(TIP.ID),
      cachedClient.getTipStatus(TIP.ID),
      cachedClient.getTipStatus(TIP.ID),
      cachedClient.getTipStatus(TIP.ID),
    ]);

    expect(results).toHaveLength(5);
    for (const tip of results) expect(tip.id).toBe(TIP.ID);
    expect(server.callCount('GET', `/api/v1/transactions/${TIP.ID}`)).toBe(1);
    expect(tipReads).toBe(1);

    // The window has not expired, so a follow-up read is still served from cache.
    await cachedClient.getTipStatus(TIP.ID);
    expect(server.callCount('GET', `/api/v1/transactions/${TIP.ID}`)).toBe(1);
  });

  it('does not collapse concurrent writes', async () => {
    const [first, second] = await Promise.all([
      cachedClient.createTip({ creatorId: 'creator_a', amount: 10 }),
      cachedClient.createTip({ creatorId: 'creator_b', amount: 20 }),
    ]);

    expect(first.id).not.toBe(second.id);
    expect(server.callCount('POST', TIP_PATH)).toBe(2);
  });

  it('returns the original tip when the same idempotency key is replayed', async () => {
    const first = await client.createTip({
      creatorId: TIP.CREATOR_ID,
      amount: TIP.AMOUNT,
      idempotencyKey: TIP.IDEMPOTENCY_KEY,
    });
    const replay = await client.createTip({
      creatorId: TIP.CREATOR_ID,
      amount: TIP.AMOUNT,
      idempotencyKey: TIP.IDEMPOTENCY_KEY,
    });

    expect(first.id).toBe(TIP.ID);
    expect(replay.id).toBe(TIP.ID);
    expect(server.callCount('POST', TIP_PATH)).toBe(2);
    expect(server.getCalls('POST', TIP_PATH)[1]?.headers['idempotency-key']).toBe(
      TIP.IDEMPOTENCY_KEY
    );
  });

  it('keeps concurrent replays of one idempotency key on a single tip', async () => {
    const [first, second] = await Promise.all([
      client.createTip({
        creatorId: TIP.CREATOR_ID,
        amount: TIP.AMOUNT,
        idempotencyKey: TIP.IDEMPOTENCY_KEY,
      }),
      client.createTip({
        creatorId: TIP.CREATOR_ID,
        amount: TIP.AMOUNT,
        idempotencyKey: TIP.IDEMPOTENCY_KEY,
      }),
    ]);

    expect(first.id).toBe(TIP.ID);
    expect(second.id).toBe(TIP.ID);
    expect(server.callCount('POST', TIP_PATH)).toBe(2);
  });

  it('surfaces a replayed submit as a 409 without retrying the POST', async () => {
    const first = await client.submitPaymentTransaction(TIP.ID, {
      transactionEnvelope: TIP.SIGNED_ENVELOPE,
    });
    expect(first.transactionHash).toBe(TIP.TX_HASH);

    await expect(
      client.submitPaymentTransaction(TIP.ID, { transactionEnvelope: TIP.SIGNED_ENVELOPE })
    ).rejects.toMatchObject({ statusCode: 409, code: 'ALREADY_SUBMITTED' });

    // Non-idempotent POSTs are never retried: two calls, two requests.
    expect(server.callCount('POST', SUBMIT_PATH)).toBe(2);
  });

  it('requires a signed envelope before contacting the network', async () => {
    await expect(
      client.submitPaymentTransaction(TIP.ID, { transactionEnvelope: '' })
    ).rejects.toThrow(/Signed transaction envelope is required/);

    expect(server.callCount('POST', SUBMIT_PATH)).toBe(0);
  });
});
