import { beforeEach, describe, expect, it } from 'vitest';

import {
  HttpMethod,
  WALLET_FIXTURE,
  WalletWorkflowStep,
  apiFailure,
  apiSuccess,
  createChallengeResponse,
  createIntegrationClient,
  createNonceResponse,
  createVerifiedWalletResponse,
  createWalletBalanceResponse,
  type IntegrationClientBundle,
} from './helpers';

describe('wallet workflow integration', () => {
  let bundle: IntegrationClientBundle;

  beforeEach(() => {
    bundle = createIntegrationClient();
  });

  function registerClientMethodRoutes(): void {
    const { http } = bundle;

    http.on(
      HttpMethod.Post,
      `/wallets/${WALLET_FIXTURE.ID}/verification-challenge`,
      () => apiSuccess(createChallengeResponse())
    );

    http.on(HttpMethod.Post, `/wallets/${WALLET_FIXTURE.ID}/verify`, (_method, _path, body) => {
      const proof = (body as { proof?: string } | undefined)?.proof;
      if (proof !== WALLET_FIXTURE.PROOF) {
        return apiFailure('Invalid proof');
      }

      return apiSuccess(createVerifiedWalletResponse());
    });

    http.on(HttpMethod.Get, `/wallets/${WALLET_FIXTURE.ID}/balance`, () =>
      apiSuccess(createWalletBalanceResponse())
    );
  }

  function registerNonceChallengeRoutes(): void {
    const { http } = bundle;

    http.on(HttpMethod.Post, '/api/v1/wallet/nonce', (_method, _path, body) => {
      const publicKey = (body as { publicKey?: string } | undefined)?.publicKey;
      if (publicKey !== WALLET_FIXTURE.PUBLIC_KEY) {
        return apiFailure('Unknown public key');
      }

      return apiSuccess(createNonceResponse());
    });

    http.on(
      HttpMethod.Get,
      `/api/v1/wallet/challenge/${WALLET_FIXTURE.NONCE}`,
      () => apiSuccess(createChallengeResponse())
    );

    http.on(HttpMethod.Post, '/api/v1/wallet/verify', (_method, _path, body) => {
      const payload = body as
        | { publicKey?: string; nonce?: string; signedTransaction?: string }
        | undefined;

      if (
        payload?.publicKey !== WALLET_FIXTURE.PUBLIC_KEY ||
        payload?.nonce !== WALLET_FIXTURE.NONCE ||
        payload?.signedTransaction !== WALLET_FIXTURE.SIGNED_TRANSACTION
      ) {
        return apiFailure('Wallet verification failed');
      }

      return apiSuccess(createVerifiedWalletResponse());
    });

    http.on(HttpMethod.Get, `/wallets/${WALLET_FIXTURE.ID}/balance`, () =>
      apiSuccess(createWalletBalanceResponse())
    );
  }

  it('runs challenge → verify → balance with consistent wallet state', async () => {
    registerClientMethodRoutes();
    const { client, http } = bundle;
    const completed: WalletWorkflowStep[] = [];

    const challenge = await client.requestWalletVerificationChallenge(WALLET_FIXTURE.ID);
    completed.push(WalletWorkflowStep.GetChallenge);

    expect(challenge.challenge).toBe(WALLET_FIXTURE.CHALLENGE);
    expect(challenge.expiresIn).toBe(WALLET_FIXTURE.EXPIRES_IN);

    const wallet = await client.verifyWallet(WALLET_FIXTURE.ID, WALLET_FIXTURE.PROOF);
    completed.push(WalletWorkflowStep.Verify);

    expect(wallet.id).toBe(WALLET_FIXTURE.ID);
    expect(wallet.publicKey).toBe(WALLET_FIXTURE.PUBLIC_KEY);
    expect(wallet.verified).toBe(true);

    const balance = await client.getWalletBalance(wallet.id);
    completed.push(WalletWorkflowStep.Balance);

    expect(balance.walletId).toBe(wallet.id);
    expect(balance.available).toBe(WALLET_FIXTURE.AVAILABLE);
    expect(balance.pending).toBe(WALLET_FIXTURE.PENDING);
    expect(balance.total).toBe(WALLET_FIXTURE.AVAILABLE + WALLET_FIXTURE.PENDING);
    expect(balance.currency).toBe(WALLET_FIXTURE.CURRENCY);
    expect(completed).toEqual([
      WalletWorkflowStep.GetChallenge,
      WalletWorkflowStep.Verify,
      WalletWorkflowStep.Balance,
    ]);

    http.assertCallOrder([
      `/wallets/${WALLET_FIXTURE.ID}/verification-challenge`,
      `/wallets/${WALLET_FIXTURE.ID}/verify`,
      `/wallets/${WALLET_FIXTURE.ID}/balance`,
    ]);
  });

  it('runs generateNonce → getChallenge → verify → balance via request orchestration', async () => {
    registerNonceChallengeRoutes();
    const { client, http } = bundle;
    const completed: WalletWorkflowStep[] = [];

    const nonceResponse = await client.request<{ nonce: string; expiresIn: number }>(
      HttpMethod.Post,
      '/api/v1/wallet/nonce',
      { publicKey: WALLET_FIXTURE.PUBLIC_KEY }
    );
    completed.push(WalletWorkflowStep.GenerateNonce);

    expect(nonceResponse.success).toBe(true);
    expect(nonceResponse.data?.nonce).toBe(WALLET_FIXTURE.NONCE);

    const challengeResponse = await client.request<{ challenge: string; expiresIn: number }>(
      HttpMethod.Get,
      `/api/v1/wallet/challenge/${nonceResponse.data?.nonce}`
    );
    completed.push(WalletWorkflowStep.GetChallenge);

    expect(challengeResponse.success).toBe(true);
    expect(challengeResponse.data?.challenge).toBe(WALLET_FIXTURE.CHALLENGE);

    const verifyResponse = await client.request<{
      id: string;
      publicKey: string;
      verified: boolean;
    }>(HttpMethod.Post, '/api/v1/wallet/verify', {
      publicKey: WALLET_FIXTURE.PUBLIC_KEY,
      nonce: nonceResponse.data?.nonce,
      signedTransaction: WALLET_FIXTURE.SIGNED_TRANSACTION,
    });
    completed.push(WalletWorkflowStep.Verify);

    expect(verifyResponse.success).toBe(true);
    expect(verifyResponse.data?.id).toBe(WALLET_FIXTURE.ID);
    expect(verifyResponse.data?.verified).toBe(true);

    const verifiedWalletId = verifyResponse.data?.id ?? WALLET_FIXTURE.ID;
    const balance = await client.getWalletBalance(verifiedWalletId);
    completed.push(WalletWorkflowStep.Balance);

    expect(balance.walletId).toBe(WALLET_FIXTURE.ID);
    expect(balance.available).toBe(WALLET_FIXTURE.AVAILABLE);
    expect(completed).toEqual([
      WalletWorkflowStep.GenerateNonce,
      WalletWorkflowStep.GetChallenge,
      WalletWorkflowStep.Verify,
      WalletWorkflowStep.Balance,
    ]);

    http.assertCallOrder([
      '/api/v1/wallet/nonce',
      `/api/v1/wallet/challenge/${WALLET_FIXTURE.NONCE}`,
      '/api/v1/wallet/verify',
      `/wallets/${WALLET_FIXTURE.ID}/balance`,
    ]);
  });

  it('stops the workflow when challenge generation fails before verify', async () => {
    const { client, http } = bundle;
    let verifyCalled = false;

    http.on(
      HttpMethod.Post,
      `/wallets/${WALLET_FIXTURE.ID}/verification-challenge`,
      () => apiFailure('Challenge generation failed')
    );
    http.on(HttpMethod.Post, `/wallets/${WALLET_FIXTURE.ID}/verify`, () => {
      verifyCalled = true;
      return apiSuccess(createVerifiedWalletResponse());
    });

    await expect(
      client.requestWalletVerificationChallenge(WALLET_FIXTURE.ID)
    ).rejects.toThrow(`Failed to request verification challenge for wallet: ${WALLET_FIXTURE.ID}`);

    expect(verifyCalled).toBe(false);
    expect(http.wasCalledWith(HttpMethod.Post, `/wallets/${WALLET_FIXTURE.ID}/verify`)).toBe(false);
  });

  it('stops the workflow when verify fails before balance', async () => {
    const { client, http } = bundle;
    let balanceCalled = false;

    http.on(
      HttpMethod.Post,
      `/wallets/${WALLET_FIXTURE.ID}/verification-challenge`,
      () => apiSuccess(createChallengeResponse())
    );
    http.on(HttpMethod.Post, `/wallets/${WALLET_FIXTURE.ID}/verify`, () =>
      apiFailure('Invalid proof')
    );
    http.on(HttpMethod.Get, `/wallets/${WALLET_FIXTURE.ID}/balance`, () => {
      balanceCalled = true;
      return apiSuccess(createWalletBalanceResponse());
    });

    await client.requestWalletVerificationChallenge(WALLET_FIXTURE.ID);

    await expect(client.verifyWallet(WALLET_FIXTURE.ID, 'bad-proof')).rejects.toThrow(
      `Failed to verify wallet: ${WALLET_FIXTURE.ID}`
    );

    expect(balanceCalled).toBe(false);
    expect(http.wasCalledWith(HttpMethod.Get, `/wallets/${WALLET_FIXTURE.ID}/balance`)).toBe(false);
  });
});
