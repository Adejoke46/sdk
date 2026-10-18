/**
 * Balance Methods
 *
 * SDK methods for balance and account queries.
 */

import { DorisioClient } from '../client';
import { RequestValidator } from '../utils/validators';
import {
  ApiAccountBalanceSchema,
  ApiAccountSummarySchema,
  ApiBalanceInfoSchema,
  ApiCreatorPendingPayoutSchema,
} from '../types/schemas';
import { RequestOptions } from '../http/http-client';

export interface BalanceInfo {
  walletId: string;
  available: number;
  pending: number;
  total: number;
  currency: string;
}

export interface AccountBalance {
  total: number;
  available: number;
  pending: number;
  wallets: BalanceInfo[];
}

/**
 * Get user's total balance across all wallets
 * GET /users/:userId/balance
 *
 * @param userId - Unique user identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 * @returns AccountBalance object summarizing wallet balances
 *
 * @throws {Error} If userId is empty or request fails
 *
 * @example
 * ```ts
 * const balance = await client.getBalance('user-123', {
 *   headers: { 'X-Request-ID': 'balance-check-01' },
 * });
 * console.log(`Total available balance: $${balance.available}`);
 * ```
 */
export async function getBalance(
  this: DorisioClient,
  userId: string,
  options?: Partial<RequestOptions>
): Promise<AccountBalance> {
  RequestValidator.nonEmptyString(userId, 'userId');
  const response = options
    ? await this.request('GET', `/users/${userId}/balance`, undefined, options)
    : await this.request('GET', `/users/${userId}/balance`);

  if (!response.success || !response.data) {
    throw new Error(`Failed to fetch balance for user: ${userId}`);
  }

  const parsed = ApiAccountBalanceSchema.parse(response.data);
  return {
    total: parsed.total,
    available: parsed.available,
    pending: parsed.pending,
    wallets: parsed.wallets.map((w) => ({
      walletId: w.walletId,
      available: w.available,
      pending: w.pending,
      total: w.available + w.pending,
      currency: w.currency,
    })),
  };
}

/**
 * Get single wallet balance
 * GET /wallets/:walletId/balance
 *
 * @param walletId - Unique wallet identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 * @returns BalanceInfo for the specified wallet
 *
 * @throws {Error} If walletId is empty or request fails
 *
 * @example
 * ```ts
 * const walletBalance = await client.getWalletBalance('wallet-abc', {
 *   headers: { 'X-Custom-Source': 'mobile-app' },
 * });
 * console.log(`Wallet ${walletBalance.walletId} total: $${walletBalance.total}`);
 * ```
 */
export async function getWalletBalance(
  this: DorisioClient,
  walletId: string,
  options?: Partial<RequestOptions>
): Promise<BalanceInfo> {
  RequestValidator.nonEmptyString(walletId, 'walletId');
  const response = options
    ? await this.request('GET', `/wallets/${walletId}/balance`, undefined, options)
    : await this.request('GET', `/wallets/${walletId}/balance`);

  if (!response.success || !response.data) {
    throw new Error(`Failed to fetch wallet balance: ${walletId}`);
  }

  const parsed = ApiBalanceInfoSchema.parse(
    // The balance endpoint may return an object without walletId; inject it.
    { walletId, ...(response.data as object) }
  );

  return {
    walletId: parsed.walletId,
    available: parsed.available,
    pending: parsed.pending,
    total: parsed.available + parsed.pending,
    currency: parsed.currency,
  };
}

/**
 * Get creator's pending payout
 * GET /creators/:creatorId/payout-pending
 *
 * @param creatorId - Unique creator identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 * @returns Pending payout amount, threshold, and next payout date
 *
 * @throws {Error} If creatorId is empty or request fails
 *
 * @example
 * ```ts
 * const payout = await client.getCreatorPendingPayout('creator-123');
 * console.log(`Pending: $${payout.pending}, Threshold: $${payout.minimumThreshold}`);
 * ```
 */
export async function getCreatorPendingPayout(
  this: DorisioClient,
  creatorId: string,
  options?: Partial<RequestOptions>
): Promise<{
  pending: number;
  nextPayoutDate?: string;
  minimumThreshold: number;
}> {
  RequestValidator.nonEmptyString(creatorId, 'creatorId');
  const response = options
    ? await this.request(
        'GET',
        `/creators/${creatorId}/payout-pending`,
        undefined,
        options
      )
    : await this.request(
        'GET',
        `/creators/${creatorId}/payout-pending`
      );

  if (!response.success || !response.data) {
    throw new Error(`Failed to fetch pending payout for creator: ${creatorId}`);
  }

  const parsed = ApiCreatorPendingPayoutSchema.parse(response.data);
  return {
    pending: parsed.pending,
    nextPayoutDate: parsed.nextPayoutDate,
    minimumThreshold: parsed.minimumThreshold,
  };
}

/**
 * Check if minimum payout threshold is reached
 * GET /creators/:creatorId/can-payout
 *
 * @param creatorId - Unique creator identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 * @returns True if payout threshold is reached
 *
 * @throws {Error} If request fails
 *
 * @example
 * ```ts
 * const eligible = await client.canPayout('creator-123');
 * if (eligible) {
 *   console.log('Creator is eligible for payout');
 * }
 * ```
 */
export async function canPayout(
  this: DorisioClient,
  creatorId: string,
  options?: Partial<RequestOptions>
): Promise<boolean> {
  RequestValidator.nonEmptyString(creatorId, 'creatorId');
  const response = options
    ? await this.request(
        'GET',
        `/creators/${creatorId}/can-payout`,
        undefined,
        options
      )
    : await this.request(
        'GET',
        `/creators/${creatorId}/can-payout`
      );

  if (!response.success || response.data === undefined) {
    throw new Error(`Failed to check payout eligibility for creator: ${creatorId}`);
  }

  return Boolean(response.data);
}

/**
 * Get account summary with balance and stats
 * GET /users/me/summary
 *
 * @param options - Optional request options including custom HTTP headers
 * @returns Full account profile, role, balance, and tipping statistics
 *
 * @throws {Error} If account summary cannot be fetched
 *
 * @example
 * ```ts
 * const summary = await client.getAccountSummary({
 *   headers: { 'X-Request-ID': 'summary-req-01' },
 * });
 * console.log(`Logged in as ${summary.email}, total earnings: $${summary.totalEarnings}`);
 * ```
 */
export async function getAccountSummary(
  this: DorisioClient,
  options?: Partial<RequestOptions>
): Promise<{
  userId: string;
  email: string;
  role: string;
  balance: AccountBalance;
  totalTipsSent?: number;
  totalEarnings?: number;
  lastActivityDate?: string;
}> {
  const response = options
    ? await this.request('GET', '/users/me/summary', undefined, options)
    : await this.request('GET', '/users/me/summary');

  if (!response.success || !response.data) {
    throw new Error('Failed to fetch account summary');
  }

  const parsed = ApiAccountSummarySchema.parse(response.data);
  const balanceRaw = parsed.balance ?? { total: 0, available: 0, pending: 0, wallets: [] };

  return {
    userId: parsed.userId,
    email: parsed.email,
    role: parsed.role,
    balance: {
      total: balanceRaw.total,
      available: balanceRaw.available,
      pending: balanceRaw.pending,
      wallets: balanceRaw.wallets.map((w) => ({
        walletId: w.walletId,
        available: w.available,
        pending: w.pending,
        total: w.available + w.pending,
        currency: w.currency,
      })),
    },
    totalTipsSent: parsed.totalTipsSent,
    totalEarnings: parsed.totalEarnings,
    lastActivityDate: parsed.lastActivityDate,
  };
}
