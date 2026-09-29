/**
 * E2E: full tip workflow against the mock backend (Issue #55)
 *
 * Drives the real `DorisioClient` — real HTTP layer, real fetch, real
 * normalizers — through tip creation, payment build, submission, confirmation
 * and history, asserting both the results and the requests that were sent.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetConfig, setConfig } from '../config';
import type { DorisioClient } from '../client';
import { MockApiServer, envelope } from '../__mocks__/server';
import { TIP, apiTransaction, createE2eClient } from './helpers';

interface StoredTip {
  idempotencyKey?: string;
  transaction: Record<string, unknown>;
  submitted: boolean;
}

describe('E2E: tip creation → submission → confirmation', () => {
  const server = new MockApiServer();
  let client: DorisioClient;
  let stored: StoredTip[];

  beforeEach(() => {
    setConfig({ retryAttempts: 1 });
    stored = [];
    server.reset();
    server.start();

    // POST /api/v1/transactions/tip — create (or replay) a tip
    server.on('POST', '/api/v1/transactions/tip', (request) => {
      const idempotencyKey = request.headers['idempotency-key'];
      const duplicate = idempotencyKey
        ? stored.find((tip) => tip.idempotencyKey === idempotencyKey)
        : undefined;
      if (duplicate) {
        return { status: 200, body: envelope(duplicate.transaction) };
      }

      const tip = apiTransaction({
        amount: typeof request.body?.amount === 'number' ? request.body.amount : TIP.AMOUNT,
        message: typeof request.body?.message === 'string' ? request.body.message : null,
      });
      stored.push({ idempotencyKey, transaction: tip, submitted: false });
      return { status: 201, body: envelope(tip) };
    });

    // POST /api/v1/transactions/:id/build — unsigned Stellar envelope
    server.on('POST', `/api/v1/transactions/${TIP.ID}/build`, () => ({
      status: 200,
      body: envelope({
        transactionEnvelope: TIP.UNSIGNED_ENVELOPE,
        tipId: TIP.ID,
        fee: 100,
      }),
    }));

    // POST /api/v1/transactions/:id/submit — send the signed envelope
    server.on('POST', `/api/v1/transactions/${TIP.ID}/submit`, (request) => {
      const entry = stored[0];
      if (entry && entry.submitted) {
        return {
          status: 409,
          body: { error: 'Transaction already submitted', code: 'ALREADY_SUBMITTED' },
        };
      }
      if (entry) entry.submitted = true;
      const body = request.body ?? {};
      if (body.transactionEnvelope !== TIP.SIGNED_ENVELOPE) {
        return { status: 400, body: { error: 'Unsigned envelope', code: 'INVALID_ENVELOPE' } };
      }
      return {
        status: 200,
        body: envelope({ tipId: TIP.ID, transactionHash: TIP.TX_HASH, status: 'submitted' }),
      };
    });

    // GET /api/v1/transactions/:id/confirm — Horizon confirmation
    server.on('GET', `/api/v1/transactions/${TIP.ID}/confirm`, () => ({
      status: 200,
      body: envelope(
        apiTransaction({ stellarStatus: 'confirmed', stellarTxHash: TIP.TX_HASH })
      ),
    }));

    // GET /api/v1/transactions/history
    server.on('GET', '/api/v1/transactions/history', () => ({
      status: 200,
      body: envelope({
        transactions: stored.map((entry) => ({
          ...entry.transaction,
          stellarStatus: entry.submitted ? 'confirmed' : 'pending',
          stellarTxHash: entry.submitted ? TIP.TX_HASH : null,
        })),
        total: stored.length,
        page: 1,
        pageSize: 20,
      }),
    }));

    client = createE2eClient();
  });

  afterEach(() => {
    server.stop();
    resetConfig();
  });

  it('creates, builds, submits, confirms and lists a tip', async () => {
    const tip = await client.createTip({
      creatorId: TIP.CREATOR_ID,
      amount: TIP.AMOUNT,
      message: TIP.MESSAGE,
      idempotencyKey: TIP.IDEMPOTENCY_KEY,
    });

    expect(tip).toMatchObject({
      id: TIP.ID,
      creatorId: TIP.CREATOR_ID,
      amount: TIP.AMOUNT,
      message: TIP.MESSAGE,
      status: 'pending',
    });

    const built = await client.buildPaymentTransaction(TIP.ID, {
      senderPublicKey: TIP.SENDER_PUBLIC_KEY,
      creatorPublicKey: TIP.CREATOR_PUBLIC_KEY,
      amount: '25.00',
    });
    expect(built.transactionEnvelope).toBe(TIP.UNSIGNED_ENVELOPE);
    expect(built.tipId).toBe(TIP.ID);
    expect(built.fee).toBe(100);

    const submitted = await client.submitPaymentTransaction(TIP.ID, {
      transactionEnvelope: TIP.SIGNED_ENVELOPE,
    });
    expect(submitted).toEqual({
      tipId: TIP.ID,
      transactionHash: TIP.TX_HASH,
      status: 'submitted',
    });

    const confirmed = await client.checkTransactionConfirmation(TIP.ID);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.stellarTxHash).toBe(TIP.TX_HASH);

    const history = await client.getTransactionHistory({ page: 1, pageSize: 20 });
    expect(history.total).toBe(1);
    expect(history.transactions).toHaveLength(1);
    expect(history.transactions[0]).toMatchObject({
      id: TIP.ID,
      status: 'confirmed',
      stellarTxHash: TIP.TX_HASH,
    });

    expect(server.requestedPaths()).toEqual([
      'POST /api/v1/transactions/tip',
      `POST /api/v1/transactions/${TIP.ID}/build`,
      `POST /api/v1/transactions/${TIP.ID}/submit`,
      `GET /api/v1/transactions/${TIP.ID}/confirm`,
      'GET /api/v1/transactions/history',
    ]);
  });

  it('sends the documented payloads and headers', async () => {
    await client.createTip({
      creatorId: TIP.CREATOR_ID,
      amount: TIP.AMOUNT,
      message: TIP.MESSAGE,
      idempotencyKey: TIP.IDEMPOTENCY_KEY,
    });
    await client.buildPaymentTransaction(TIP.ID, {
      senderPublicKey: TIP.SENDER_PUBLIC_KEY,
      creatorPublicKey: TIP.CREATOR_PUBLIC_KEY,
      amount: '25.00',
    });
    await client.submitPaymentTransaction(TIP.ID, {
      transactionEnvelope: TIP.SIGNED_ENVELOPE,
    });

    const create = server.lastCall('POST', '/api/v1/transactions/tip');
    expect(create?.headers['idempotency-key']).toBe(TIP.IDEMPOTENCY_KEY);
    expect(create?.headers.authorization).toBe('Bearer e2e_access_token');
    expect(create?.body).toEqual({
      creatorId: TIP.CREATOR_ID,
      amount: TIP.AMOUNT,
      message: TIP.MESSAGE,
    });

    expect(server.lastCall('POST', `/api/v1/transactions/${TIP.ID}/build`)?.body).toEqual({
      senderPublicKey: TIP.SENDER_PUBLIC_KEY,
      creatorPublicKey: TIP.CREATOR_PUBLIC_KEY,
      amount: '25.00',
    });

    expect(server.lastCall('POST', `/api/v1/transactions/${TIP.ID}/submit`)?.body).toEqual({
      transactionEnvelope: TIP.SIGNED_ENVELOPE,
    });
  });

  it('rejects a tip for an invalid amount before touching the network', async () => {
    await expect(
      client.createTip({ creatorId: TIP.CREATOR_ID, amount: 0 })
    ).rejects.toThrow();

    expect(server.callCount('POST', '/api/v1/transactions/tip')).toBe(0);
  });

  it('propagates backend validation failures as ApiError', async () => {
    server.on('POST', '/api/v1/transactions/tip', () => ({
      status: 422,
      body: { error: 'Creator is not verified', code: 'CREATOR_NOT_VERIFIED' },
    }));

    await expect(
      client.createTip({ creatorId: TIP.CREATOR_ID, amount: TIP.AMOUNT })
    ).rejects.toMatchObject({ statusCode: 422, code: 'CREATOR_NOT_VERIFIED' });
  });
});
