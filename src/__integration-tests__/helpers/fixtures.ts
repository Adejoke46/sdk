import {
  CREATOR_FIXTURE,
  HISTORY_FIXTURE,
  TIP_FIXTURE,
  WALLET_FIXTURE,
} from './constants';
import { CreatorVerificationState, TipLifecycleStatus } from './enums';

export function createPendingTipResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: TIP_FIXTURE.ID,
    fromUserId: TIP_FIXTURE.SENDER_ID,
    creatorId: TIP_FIXTURE.CREATOR_ID,
    amount: TIP_FIXTURE.AMOUNT,
    message: TIP_FIXTURE.MESSAGE,
    status: TipLifecycleStatus.Pending,
    stellarStatus: TipLifecycleStatus.Pending,
    stellarTxHash: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function createConfirmedTipResponse(overrides: Record<string, unknown> = {}) {
  return createPendingTipResponse({
    status: TipLifecycleStatus.Confirmed,
    stellarStatus: TipLifecycleStatus.Confirmed,
    stellarTxHash: TIP_FIXTURE.TX_HASH,
    updatedAt: '2026-01-01T00:05:00.000Z',
    ...overrides,
  });
}

export function createBuildTransactionResponse(overrides: Record<string, unknown> = {}) {
  return {
    tipId: TIP_FIXTURE.ID,
    transactionEnvelope: TIP_FIXTURE.ENVELOPE,
    fee: 100,
    ...overrides,
  };
}

export function createSubmitTransactionResponse(overrides: Record<string, unknown> = {}) {
  return {
    tipId: TIP_FIXTURE.ID,
    transactionHash: TIP_FIXTURE.TX_HASH,
    status: TipLifecycleStatus.Pending,
    ...overrides,
  };
}

export function createHistoryPage(page: number, pageSize: number = HISTORY_FIXTURE.PAGE_SIZE) {
  const start = (page - 1) * pageSize;
  const transactions = Array.from({ length: pageSize }, (_, index) => {
    const sequence = start + index + 1;
    if (sequence > HISTORY_FIXTURE.TOTAL) {
      return null;
    }

    return createConfirmedTipResponse({
      id: `tip-history-${sequence}`,
      amount: TIP_FIXTURE.AMOUNT + sequence,
    });
  }).filter(Boolean);

  return {
    transactions,
    total: HISTORY_FIXTURE.TOTAL,
    page,
    pageSize,
  };
}

export function createNonceResponse(overrides: Record<string, unknown> = {}) {
  return {
    nonce: WALLET_FIXTURE.NONCE,
    expiresIn: WALLET_FIXTURE.EXPIRES_IN,
    ...overrides,
  };
}

export function createChallengeResponse(overrides: Record<string, unknown> = {}) {
  return {
    challenge: WALLET_FIXTURE.CHALLENGE,
    expiresIn: WALLET_FIXTURE.EXPIRES_IN,
    ...overrides,
  };
}

export function createVerifiedWalletResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: WALLET_FIXTURE.ID,
    userId: WALLET_FIXTURE.USER_ID,
    publicKey: WALLET_FIXTURE.PUBLIC_KEY,
    name: 'Integration Wallet',
    verified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:01:00.000Z',
    ...overrides,
  };
}

export function createWalletBalanceResponse(overrides: Record<string, unknown> = {}) {
  return {
    available: WALLET_FIXTURE.AVAILABLE,
    pending: WALLET_FIXTURE.PENDING,
    currency: WALLET_FIXTURE.CURRENCY,
    ...overrides,
  };
}

export function createCreatorVerificationPendingResponse(
  overrides: Record<string, unknown> = {}
) {
  return {
    verified: false,
    status: CreatorVerificationState.Pending,
    expiresAt: '2026-12-31T00:00:00.000Z',
    ...overrides,
  };
}

export function createCreatorVerificationApprovedResponse(
  overrides: Record<string, unknown> = {}
) {
  return {
    verified: true,
    status: CreatorVerificationState.Verified,
    verifiedAt: '2026-01-02T00:00:00.000Z',
    expiresAt: '2027-01-02T00:00:00.000Z',
    ...overrides,
  };
}

export function createCreatorEarningsResponse(overrides: Record<string, unknown> = {}) {
  return {
    totalEarnings: CREATOR_FIXTURE.TOTAL_EARNINGS,
    pendingBalance: CREATOR_FIXTURE.PENDING_BALANCE,
    confirmedBalance: CREATOR_FIXTURE.CONFIRMED_BALANCE,
    transactionCount: CREATOR_FIXTURE.TRANSACTION_COUNT,
    ...overrides,
  };
}

export function createPayoutEligibilityResponse(canPayout = true) {
  return canPayout;
}

export function apiSuccess<T>(data: T) {
  return { success: true as const, data };
}

export function apiFailure(message: string) {
  return { success: false as const, error: { message } };
}
