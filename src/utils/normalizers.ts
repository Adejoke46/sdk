/**
 * Response Normalizers
 *
 * Ensures consistent data structure across SDK responses.
 * All raw API data is validated through Zod schemas before mapping
 * to SDK domain models, so shape mismatches surface at the boundary.
 */

import {
  Creator,
  CreatorProfile,
  Transaction,
  TransactionHistory,
  User,
  Wallet,
} from '../types/models';
import {
  ApiCreatorSchema,
  ApiListCreatorsSchema,
  ApiTransactionHistorySchema,
  ApiTransactionSchema,
  ApiUserSchema,
  ApiWalletSchema,
  PaymentSchemas,
  type CreateTipInput,
} from '../types/schemas';

/**
 * Normalize creator profile.
 * Ensures all optional fields have defaults and validates raw input if necessary.
 *
 * @param creator - Creator entity or raw creator data
 * @returns Normalized CreatorProfile
 *
 * @example
 * ```ts
 * import { normalizeCreatorProfile } from '@dorisio/sdk';
 *
 * const profile = normalizeCreatorProfile(creatorData);
 * ```
 */
export function normalizeCreatorProfile(creator: Creator | unknown): CreatorProfile {
  const isCreatorObj =
    creator !== null &&
    typeof creator === 'object' &&
    'id' in creator &&
    typeof (creator as Record<string, unknown>)['id'] === 'string';
  const normalized = isCreatorObj ? normalizeCreator(creator) : normalizeCreator(creator);

  return {
    ...normalized,
    displayName: normalized.displayName ?? '',
    bio: normalized.bio ?? '',
    avatar: normalized.avatar ?? null,
    stats: {
      totalTips: 0,
      averageTip: 0,
      lastTipDate: null,
    },
  };
}

/**
 * Normalize and validate create-tip input against PaymentSchemas.createTip.
 *
 * @param data - Raw create tip input data
 * @returns Validated CreateTipInput
 *
 * @example
 * ```ts
 * import { normalizeCreateTip } from '@dorisio/sdk';
 *
 * const validatedInput = normalizeCreateTip({
 *   amount: 25,
 *   currency: 'USD',
 *   creatorId: '550e8400-e29b-41d4-a716-446655440000',
 *   message: 'Awesome work!',
 * });
 * ```
 */
export function normalizeCreateTip(data: unknown): CreateTipInput {
  return PaymentSchemas.createTip.parse(data);
}

/**
 * Alias for normalizeCreateTip for explicit input naming.
 *
 * @param data - Raw create tip input data
 * @returns Validated CreateTipInput
 *
 * @example
 * ```ts
 * import { normalizeCreateTipInput } from '@dorisio/sdk';
 *
 * const validated = normalizeCreateTipInput(rawInput);
 * ```
 */
export function normalizeCreateTipInput(data: unknown): CreateTipInput {
  return PaymentSchemas.createTip.parse(data);
}

/**
 * Normalize creator from raw API response.
 * Validates against ApiCreatorSchema before mapping.
 */
export function normalizeCreator(data: unknown): Creator {
  const parsed = ApiCreatorSchema.parse(data);
  return {
    id: parsed.id,
    userId: parsed.userId,
    username: parsed.username,
    displayName: parsed.displayName ?? null,
    bio: parsed.bio ?? null,
    avatar: parsed.avatar ?? null,
    verified: parsed.verified,
    isPublic: parsed.isPublic,
    totalEarnings: parsed.totalEarnings,
    pendingBalance: parsed.pendingBalance,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
  };
}

/**
 * Normalize array of creators.
 */
export function normalizeCreators(data: unknown): Creator[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map(normalizeCreator);
}

/**
 * Normalize user from raw API response.
 * Validates against ApiUserSchema before mapping.
 */
export function normalizeUser(data: unknown): User {
  const parsed = ApiUserSchema.parse(data);
  return {
    id: parsed.id,
    email: parsed.email,
    name: parsed.name ?? null,
    role: parsed.role,
    verified: parsed.verified,
    avatar: parsed.avatar ?? null,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
  };
}

/**
 * Normalize wallet from raw API response.
 * Validates against ApiWalletSchema before mapping.
 */
export function normalizeWallet(data: unknown): Wallet {
  const parsed = ApiWalletSchema.parse(data);
  return {
    id: parsed.id,
    userId: parsed.userId,
    publicKey: parsed.publicKey,
    name: parsed.name ?? null,
    verified: parsed.verified,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
  };
}

/**
 * Normalize array of wallets.
 */
export function normalizeWallets(data: unknown): Wallet[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map(normalizeWallet);
}

/**
 * Normalize transaction from raw API response.
 * Validates against ApiTransactionSchema before mapping.
 */
export function normalizeTransaction(data: unknown): Transaction {
  const parsed = ApiTransactionSchema.parse(data);

  // Map 'completed' (used by updateTipStatus endpoint) to 'confirmed' for the domain model
  const rawStatus = parsed.stellarStatus ?? parsed.status ?? 'pending';
  const status = (rawStatus === 'completed' ? 'confirmed' : rawStatus) as
    | 'pending'
    | 'confirmed'
    | 'failed';

  return {
    id: parsed.id,
    fromUserId: parsed.fromUserId,
    creatorId: parsed.creatorId,
    amount: parsed.amount,
    message: parsed.message ?? null,
    status,
    stellarTxHash: parsed.stellarTxHash ?? null,
    createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt,
  };
}

/**
 * Normalize array of transactions.
 */
export function normalizeTransactions(data: unknown): Transaction[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map(normalizeTransaction);
}

/**
 * Normalize transaction history response.
 * Validates the entire envelope (including nested transactions) via Zod.
 */
export function normalizeTransactionHistory(data: unknown): TransactionHistory {
  const parsed = ApiTransactionHistorySchema.parse(data);
  return {
    transactions: parsed.transactions.map(normalizeTransaction),
    total: parsed.total,
    page: parsed.page,
    pageSize: parsed.pageSize,
  };
}

/**
 * Normalize paginated list-creators response.
 * Validates through ApiListCreatorsSchema before mapping.
 */
export function normalizeListCreatorsResponse(data: unknown): {
  creators: Creator[];
  total: number;
  page: number;
  pageSize: number;
} {
  const parsed = ApiListCreatorsSchema.parse(data);
  return {
    creators: parsed.creators.map(normalizeCreator),
    total: parsed.total,
    page: parsed.page,
    pageSize: parsed.pageSize,
  };
}
