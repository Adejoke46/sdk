import { beforeEach, describe, expect, it } from 'vitest';

import {
  CREATOR_FIXTURE,
  CreatorVerificationState,
  CreatorWorkflowStep,
  HttpMethod,
  apiFailure,
  apiSuccess,
  createCreatorEarningsResponse,
  createCreatorVerificationApprovedResponse,
  createCreatorVerificationPendingResponse,
  createIntegrationClient,
  createPayoutEligibilityResponse,
  type IntegrationClientBundle,
} from './helpers';

describe('creator workflow integration', () => {
  let bundle: IntegrationClientBundle;
  let verificationState: ReturnType<typeof createCreatorVerificationPendingResponse>;

  beforeEach(() => {
    bundle = createIntegrationClient();
    verificationState = createCreatorVerificationPendingResponse();
  });

  function registerHappyPathRoutes(): void {
    const { http } = bundle;

    http.on(
      HttpMethod.Post,
      `/creators/${CREATOR_FIXTURE.ID}/request-verification`,
      (_method, _path, body) => {
        const payload = body as
          | { documentType?: string; documentUrl?: string; description?: string }
          | undefined;

        if (payload?.documentType !== CREATOR_FIXTURE.DOCUMENT_TYPE) {
          return apiFailure('Invalid document type');
        }

        verificationState = createCreatorVerificationPendingResponse();
        return apiSuccess(verificationState);
      }
    );

    http.on(HttpMethod.Get, `/creators/${CREATOR_FIXTURE.ID}/verification-status`, () => {
      if (verificationState.status === CreatorVerificationState.Pending) {
        verificationState = createCreatorVerificationApprovedResponse();
      }

      return apiSuccess(verificationState);
    });

    http.on(HttpMethod.Get, `/creators/${CREATOR_FIXTURE.ID}/earnings`, () => {
      if (verificationState.status !== CreatorVerificationState.Verified) {
        return apiFailure('Creator is not verified');
      }

      return apiSuccess(createCreatorEarningsResponse());
    });

    http.on(HttpMethod.Get, `/creators/${CREATOR_FIXTURE.ID}/can-payout`, () =>
      apiSuccess(createPayoutEligibilityResponse(true))
    );

    http.on(HttpMethod.Get, `/creators/${CREATOR_FIXTURE.ID}/payout-pending`, () =>
      apiSuccess({
        pending: CREATOR_FIXTURE.PENDING_BALANCE,
        nextPayoutDate: '2026-02-01T00:00:00.000Z',
        minimumThreshold: CREATOR_FIXTURE.MINIMUM_THRESHOLD,
      })
    );
  }

  it('runs verification request → status → earnings → payout eligibility', async () => {
    registerHappyPathRoutes();
    const { client, http } = bundle;
    const completed: CreatorWorkflowStep[] = [];

    const requested = await client.requestCreatorVerification(CREATOR_FIXTURE.ID, {
      documentType: CREATOR_FIXTURE.DOCUMENT_TYPE,
      documentUrl: CREATOR_FIXTURE.DOCUMENT_URL,
      description: CREATOR_FIXTURE.DESCRIPTION,
    });
    completed.push(CreatorWorkflowStep.RequestVerification);

    expect(requested.verified).toBe(false);
    expect(requested.expiresAt).toBe('2026-12-31T00:00:00.000Z');

    const status = await client.getCreatorVerificationStatus(CREATOR_FIXTURE.ID);
    completed.push(CreatorWorkflowStep.VerificationStatus);

    expect(status.verified).toBe(true);
    expect(status.status).toBe(CreatorVerificationState.Verified);
    expect(status.verifiedAt).toBe('2026-01-02T00:00:00.000Z');

    const earnings = await client.getCreatorEarnings(CREATOR_FIXTURE.ID);
    completed.push(CreatorWorkflowStep.Earnings);

    expect(earnings.totalEarnings).toBe(CREATOR_FIXTURE.TOTAL_EARNINGS);
    expect(earnings.pendingBalance).toBe(CREATOR_FIXTURE.PENDING_BALANCE);
    expect(earnings.confirmedBalance).toBe(CREATOR_FIXTURE.CONFIRMED_BALANCE);
    expect(earnings.transactionCount).toBe(CREATOR_FIXTURE.TRANSACTION_COUNT);

    const eligible = await client.canPayout(CREATOR_FIXTURE.ID);
    const pendingPayout = await client.getCreatorPendingPayout(CREATOR_FIXTURE.ID);
    completed.push(CreatorWorkflowStep.PayoutEligibility);

    expect(eligible).toBe(true);
    expect(pendingPayout.pending).toBe(CREATOR_FIXTURE.PENDING_BALANCE);
    expect(pendingPayout.minimumThreshold).toBe(CREATOR_FIXTURE.MINIMUM_THRESHOLD);
    expect(completed).toEqual([
      CreatorWorkflowStep.RequestVerification,
      CreatorWorkflowStep.VerificationStatus,
      CreatorWorkflowStep.Earnings,
      CreatorWorkflowStep.PayoutEligibility,
    ]);

    http.assertCallOrder([
      `/creators/${CREATOR_FIXTURE.ID}/request-verification`,
      `/creators/${CREATOR_FIXTURE.ID}/verification-status`,
      `/creators/${CREATOR_FIXTURE.ID}/earnings`,
      `/creators/${CREATOR_FIXTURE.ID}/can-payout`,
      `/creators/${CREATOR_FIXTURE.ID}/payout-pending`,
    ]);
  });

  it('keeps creator id consistent across verification and earnings steps', async () => {
    registerHappyPathRoutes();
    const { client, http } = bundle;

    await client.requestCreatorVerification(CREATOR_FIXTURE.ID, {
      documentType: CREATOR_FIXTURE.DOCUMENT_TYPE,
      documentUrl: CREATOR_FIXTURE.DOCUMENT_URL,
    });
    await client.getCreatorVerificationStatus(CREATOR_FIXTURE.ID);
    await client.getCreatorEarnings(CREATOR_FIXTURE.ID);

    const paths = http.getPaths();
    expect(paths.every((path) => path.includes(CREATOR_FIXTURE.ID))).toBe(true);
  });

  it('stops the workflow when verification request fails before status', async () => {
    const { client, http } = bundle;
    let statusCalled = false;

    http.on(HttpMethod.Post, `/creators/${CREATOR_FIXTURE.ID}/request-verification`, () =>
      apiFailure('Document rejected')
    );
    http.on(HttpMethod.Get, `/creators/${CREATOR_FIXTURE.ID}/verification-status`, () => {
      statusCalled = true;
      return apiSuccess(createCreatorVerificationApprovedResponse());
    });

    await expect(
      client.requestCreatorVerification(CREATOR_FIXTURE.ID, {
        documentType: CREATOR_FIXTURE.DOCUMENT_TYPE,
      })
    ).rejects.toThrow(`Failed to request verification for creator: ${CREATOR_FIXTURE.ID}`);

    expect(statusCalled).toBe(false);
    expect(
      http.wasCalledWith(HttpMethod.Get, `/creators/${CREATOR_FIXTURE.ID}/verification-status`)
    ).toBe(false);
  });

  it('stops the workflow when status fails before earnings', async () => {
    const { client, http } = bundle;
    let earningsCalled = false;

    http.on(HttpMethod.Post, `/creators/${CREATOR_FIXTURE.ID}/request-verification`, () =>
      apiSuccess(createCreatorVerificationPendingResponse())
    );
    http.on(HttpMethod.Get, `/creators/${CREATOR_FIXTURE.ID}/verification-status`, () =>
      apiFailure('Status unavailable')
    );
    http.on(HttpMethod.Get, `/creators/${CREATOR_FIXTURE.ID}/earnings`, () => {
      earningsCalled = true;
      return apiSuccess(createCreatorEarningsResponse());
    });

    await client.requestCreatorVerification(CREATOR_FIXTURE.ID, {
      documentType: CREATOR_FIXTURE.DOCUMENT_TYPE,
    });

    await expect(client.getCreatorVerificationStatus(CREATOR_FIXTURE.ID)).rejects.toThrow(
      `Failed to fetch verification status for creator: ${CREATOR_FIXTURE.ID}`
    );

    expect(earningsCalled).toBe(false);
    expect(http.wasCalledWith(HttpMethod.Get, `/creators/${CREATOR_FIXTURE.ID}/earnings`)).toBe(
      false
    );
  });
});
