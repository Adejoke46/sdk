import { beforeEach, describe, expect, it } from 'vitest';

import {
  HISTORY_FIXTURE,
  HttpMethod,
  TIP_FIXTURE,
  TipLifecycleStatus,
  TipWorkflowStep,
  apiFailure,
  apiSuccess,
  createBuildTransactionResponse,
  createConfirmedTipResponse,
  createHistoryPage,
  createIntegrationClient,
  createPendingTipResponse,
  createSubmitTransactionResponse,
  type IntegrationClientBundle,
} from './helpers';

describe('tip workflow integration', () => {
  let bundle: IntegrationClientBundle;
  let tipState: ReturnType<typeof createPendingTipResponse>;

  beforeEach(() => {
    bundle = createIntegrationClient();
    tipState = createPendingTipResponse();
  });

  function registerHappyPathRoutes(): void {
    const { http } = bundle;

    http.on(HttpMethod.Post, '/api/v1/transactions/tip', () => {
      tipState = createPendingTipResponse();
      return apiSuccess(tipState);
    });

    http.on(HttpMethod.Post, `/api/v1/transactions/${TIP_FIXTURE.ID}/build`, () =>
      apiSuccess(createBuildTransactionResponse())
    );

    http.on(HttpMethod.Post, `/api/v1/transactions/${TIP_FIXTURE.ID}/submit`, () => {
      tipState = createPendingTipResponse({
        stellarTxHash: TIP_FIXTURE.TX_HASH,
      });
      return apiSuccess(createSubmitTransactionResponse());
    });

    http.on(HttpMethod.Get, `/api/v1/transactions/${TIP_FIXTURE.ID}/confirm`, () => {
      tipState = createConfirmedTipResponse();
      return apiSuccess(tipState);
    });

    http.on(HttpMethod.Get, /^\/api\/v1\/transactions\/history/, (_method, path) => {
      const url = new URL(path, 'https://dorisio.test');
      const page = Number(url.searchParams.get('page') ?? '1');
      const pageSize = Number(
        url.searchParams.get('pageSize') ?? String(HISTORY_FIXTURE.PAGE_SIZE)
      );
      return apiSuccess(createHistoryPage(page, pageSize));
    });
  }

  it('runs create → build → submit → confirm with consistent tip state', async () => {
    registerHappyPathRoutes();
    const { client, http } = bundle;
    const completed: TipWorkflowStep[] = [];

    const tip = await client.createTip({
      creatorId: TIP_FIXTURE.CREATOR_ID,
      amount: TIP_FIXTURE.AMOUNT,
      message: TIP_FIXTURE.MESSAGE,
    });
    completed.push(TipWorkflowStep.Create);

    expect(tip.id).toBe(TIP_FIXTURE.ID);
    expect(tip.creatorId).toBe(TIP_FIXTURE.CREATOR_ID);
    expect(tip.amount).toBe(TIP_FIXTURE.AMOUNT);
    expect(tip.status).toBe(TipLifecycleStatus.Pending);

    const built = await client.buildPaymentTransaction(tip.id, {
      senderPublicKey: TIP_FIXTURE.SENDER_PUBLIC_KEY,
      creatorPublicKey: TIP_FIXTURE.CREATOR_PUBLIC_KEY,
      amount: String(TIP_FIXTURE.AMOUNT),
    });
    completed.push(TipWorkflowStep.Build);

    expect(built.tipId).toBe(tip.id);
    expect(built.transactionEnvelope).toBe(TIP_FIXTURE.ENVELOPE);

    const submitted = await client.submitPaymentTransaction(tip.id, {
      transactionEnvelope: TIP_FIXTURE.SIGNED_ENVELOPE,
    });
    completed.push(TipWorkflowStep.Submit);

    expect(submitted.tipId).toBe(tip.id);
    expect(submitted.transactionHash).toBe(TIP_FIXTURE.TX_HASH);

    const confirmed = await client.checkTransactionConfirmation(tip.id);
    completed.push(TipWorkflowStep.Confirm);

    expect(confirmed.id).toBe(tip.id);
    expect(confirmed.status).toBe(TipLifecycleStatus.Confirmed);
    expect(confirmed.stellarTxHash).toBe(TIP_FIXTURE.TX_HASH);
    expect(completed).toEqual([
      TipWorkflowStep.Create,
      TipWorkflowStep.Build,
      TipWorkflowStep.Submit,
      TipWorkflowStep.Confirm,
    ]);

    http.assertCallOrder([
      '/api/v1/transactions/tip',
      `/api/v1/transactions/${TIP_FIXTURE.ID}/build`,
      `/api/v1/transactions/${TIP_FIXTURE.ID}/submit`,
      `/api/v1/transactions/${TIP_FIXTURE.ID}/confirm`,
    ]);
  });

  it('paginates transaction history after a confirmed tip', async () => {
    registerHappyPathRoutes();
    const { client } = bundle;

    await client.createTip({
      creatorId: TIP_FIXTURE.CREATOR_ID,
      amount: TIP_FIXTURE.AMOUNT,
    });
    await client.buildPaymentTransaction(TIP_FIXTURE.ID, {
      senderPublicKey: TIP_FIXTURE.SENDER_PUBLIC_KEY,
      creatorPublicKey: TIP_FIXTURE.CREATOR_PUBLIC_KEY,
      amount: String(TIP_FIXTURE.AMOUNT),
    });
    await client.submitPaymentTransaction(TIP_FIXTURE.ID, {
      transactionEnvelope: TIP_FIXTURE.SIGNED_ENVELOPE,
    });
    await client.checkTransactionConfirmation(TIP_FIXTURE.ID);

    const pageOne = await client.getTransactionHistory({
      page: 1,
      pageSize: HISTORY_FIXTURE.PAGE_SIZE,
    });
    const pageTwo = await client.getTransactionHistory({
      page: 2,
      pageSize: HISTORY_FIXTURE.PAGE_SIZE,
    });
    const pageThree = await client.getTransactionHistory({
      page: 3,
      pageSize: HISTORY_FIXTURE.PAGE_SIZE,
    });

    expect(pageOne.page).toBe(1);
    expect(pageOne.pageSize).toBe(HISTORY_FIXTURE.PAGE_SIZE);
    expect(pageOne.total).toBe(HISTORY_FIXTURE.TOTAL);
    expect(pageOne.transactions).toHaveLength(HISTORY_FIXTURE.PAGE_SIZE);

    expect(pageTwo.page).toBe(2);
    expect(pageTwo.transactions).toHaveLength(HISTORY_FIXTURE.PAGE_SIZE);
    expect(pageTwo.transactions[0]?.id).not.toBe(pageOne.transactions[0]?.id);

    expect(pageThree.page).toBe(3);
    expect(pageThree.transactions).toHaveLength(1);
    expect(
      pageOne.transactions.length + pageTwo.transactions.length + pageThree.transactions.length
    ).toBe(HISTORY_FIXTURE.TOTAL);
  });

  it('stops the workflow when create tip fails before build', async () => {
    const { client, http } = bundle;
    let buildCalled = false;

    http.on(HttpMethod.Post, '/api/v1/transactions/tip', () =>
      apiFailure('Creator not found')
    );
    http.on(HttpMethod.Post, `/api/v1/transactions/${TIP_FIXTURE.ID}/build`, () => {
      buildCalled = true;
      return apiSuccess(createBuildTransactionResponse());
    });

    await expect(
      client.createTip({
        creatorId: TIP_FIXTURE.CREATOR_ID,
        amount: TIP_FIXTURE.AMOUNT,
      })
    ).rejects.toThrow('Creator not found');

    expect(buildCalled).toBe(false);
    expect(http.wasCalledWith(HttpMethod.Post, `/api/v1/transactions/${TIP_FIXTURE.ID}/build`)).toBe(
      false
    );
  });

  it('stops the workflow when build fails before submit', async () => {
    const { client, http } = bundle;
    let submitCalled = false;

    http.on(HttpMethod.Post, '/api/v1/transactions/tip', () =>
      apiSuccess(createPendingTipResponse())
    );
    http.on(HttpMethod.Post, `/api/v1/transactions/${TIP_FIXTURE.ID}/build`, () =>
      apiFailure('Invalid wallet')
    );
    http.on(HttpMethod.Post, `/api/v1/transactions/${TIP_FIXTURE.ID}/submit`, () => {
      submitCalled = true;
      return apiSuccess(createSubmitTransactionResponse());
    });

    const tip = await client.createTip({
      creatorId: TIP_FIXTURE.CREATOR_ID,
      amount: TIP_FIXTURE.AMOUNT,
    });

    await expect(
      client.buildPaymentTransaction(tip.id, {
        senderPublicKey: TIP_FIXTURE.SENDER_PUBLIC_KEY,
        creatorPublicKey: TIP_FIXTURE.CREATOR_PUBLIC_KEY,
        amount: String(TIP_FIXTURE.AMOUNT),
      })
    ).rejects.toThrow('Invalid wallet');

    expect(submitCalled).toBe(false);
    expect(
      http.wasCalledWith(HttpMethod.Post, `/api/v1/transactions/${TIP_FIXTURE.ID}/submit`)
    ).toBe(false);
  });

  it('stops the workflow when submit fails before confirmation', async () => {
    const { client, http } = bundle;
    let confirmCalled = false;

    http.on(HttpMethod.Post, '/api/v1/transactions/tip', () =>
      apiSuccess(createPendingTipResponse())
    );
    http.on(HttpMethod.Post, `/api/v1/transactions/${TIP_FIXTURE.ID}/build`, () =>
      apiSuccess(createBuildTransactionResponse())
    );
    http.on(HttpMethod.Post, `/api/v1/transactions/${TIP_FIXTURE.ID}/submit`, () =>
      apiFailure('Network rejected transaction')
    );
    http.on(HttpMethod.Get, `/api/v1/transactions/${TIP_FIXTURE.ID}/confirm`, () => {
      confirmCalled = true;
      return apiSuccess(createConfirmedTipResponse());
    });

    const tip = await client.createTip({
      creatorId: TIP_FIXTURE.CREATOR_ID,
      amount: TIP_FIXTURE.AMOUNT,
    });
    await client.buildPaymentTransaction(tip.id, {
      senderPublicKey: TIP_FIXTURE.SENDER_PUBLIC_KEY,
      creatorPublicKey: TIP_FIXTURE.CREATOR_PUBLIC_KEY,
      amount: String(TIP_FIXTURE.AMOUNT),
    });

    await expect(
      client.submitPaymentTransaction(tip.id, {
        transactionEnvelope: TIP_FIXTURE.SIGNED_ENVELOPE,
      })
    ).rejects.toThrow('Network rejected transaction');

    expect(confirmCalled).toBe(false);
    expect(
      http.wasCalledWith(HttpMethod.Get, `/api/v1/transactions/${TIP_FIXTURE.ID}/confirm`)
    ).toBe(false);
  });
});
