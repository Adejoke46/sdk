/**
 * Shared fixtures and helpers for the E2E suite (Issue #55)
 */

import { DorisioClient, type ClientConfig } from '../client';

export const API_BASE = 'https://api.e2e.test';

export const TIP = {
  ID: 'tip_e2e_001',
  CREATOR_ID: 'creator_e2e_001',
  SENDER_ID: 'user_e2e_001',
  AMOUNT: 25,
  MESSAGE: 'E2E tip',
  UNSIGNED_ENVELOPE: 'AAAAAgAAAABunsigned-e2e-envelope',
  SIGNED_ENVELOPE: 'AAAAAgAAAABsigned-e2e-envelope',
  TX_HASH: 'e2e000000000000000000000000000000000000000000000000000000000000001',
  SENDER_PUBLIC_KEY: 'GSENDERKEYE2E000000000000000000000000000000000000000000000',
  CREATOR_PUBLIC_KEY: 'GCREATORKEYE2E0000000000000000000000000000000000000000000',
  IDEMPOTENCY_KEY: 'e2e-idempotency-key-0001',
} as const;

/** Build a real client pointed at the mock server. */
export const createE2eClient = (config: Partial<ClientConfig> = {}): DorisioClient =>
  new DorisioClient({
    baseUrl: API_BASE,
    token: 'e2e_access_token',
    ...config,
  });

/** Raw backend transaction payload, as the API returns it. */
export const apiTransaction = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id: TIP.ID,
  fromUserId: TIP.SENDER_ID,
  creatorId: TIP.CREATOR_ID,
  amount: TIP.AMOUNT,
  message: TIP.MESSAGE,
  stellarStatus: 'pending',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

/** Raw backend session payload for `/auth/refresh`. */
export const apiSession = (token: string): Record<string, unknown> => ({
  userId: TIP.SENDER_ID,
  email: 'sender@e2e.test',
  token,
  expiresAt: '2026-01-01T01:00:00.000Z',
  expiresIn: 3600,
});

/** Poll until `predicate` is true, or fail the test. */
export const waitFor = async (
  predicate: () => boolean,
  timeout = 1000,
  message = 'condition not met'
): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
};
