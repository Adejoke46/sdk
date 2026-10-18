/**
 * Transaction History Normalizers
 *
 * Specialised normalisation for transaction history responses.
 */

import {
  Transaction,
  TransactionHistory,
  TransactionStats,
  TransactionWithDetails,
} from '../types/models';
import { ApiTransactionStatsSchema } from '../types/schemas';
import { normalizeTransaction, normalizeTransactions } from './normalizers';

/**
 * Normalize transaction history with pagination metadata.
 */
export function normalizeTransactionHistoryResponse(data: unknown): TransactionHistory {
  if (!data || typeof data !== 'object') {
    return {
      transactions: [],
      total: 0,
      page: 1,
      pageSize: 20,
    };
  }

  const obj = data as Record<string, unknown>;
  const transactions = Array.isArray(obj['transactions'])
    ? normalizeTransactions(obj['transactions'])
    : [];

  return {
    transactions,
    total: Number(obj['total'] ?? transactions.length),
    page: Number(obj['page'] ?? 1),
    pageSize: Number(obj['pageSize'] ?? 20),
  };
}

/**
 * Calculate pagination metadata.
 */
export function calculatePaginationMetadata(
  total: number,
  page: number,
  pageSize: number
): {
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  currentPage: number;
  pageSize: number;
} {
  const totalPages = Math.ceil(total / pageSize);
  return {
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
    currentPage: page,
    pageSize,
  };
}

/**
 * Normalize transaction with details (user + creator info).
 */
export function normalizeTransactionWithDetails(data: unknown): TransactionWithDetails {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid transaction details');
  }

  const obj = data as Record<string, unknown>;

  return {
    ...normalizeTransaction(data),
    fromUser: (obj['fromUser'] as TransactionWithDetails['fromUser']) ?? ({} as TransactionWithDetails['fromUser']),
    creator: (obj['creator'] as TransactionWithDetails['creator']) ?? ({} as TransactionWithDetails['creator']),
  };
}

/**
 * Normalize array of transactions with details.
 */
export function normalizeTransactionsWithDetails(data: unknown): TransactionWithDetails[] {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map(normalizeTransactionWithDetails);
}

/**
 * Calculate transaction statistics from transaction array.
 */
export function calculateTransactionStats(transactions: Transaction[]): TransactionStats {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return {
      totalTransactions: 0,
      totalAmount: 0,
      averageAmount: 0,
      lastTransactionDate: null,
    };
  }

  const totalAmount = transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const averageAmount = totalAmount / transactions.length;

  const sorted = [...transactions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return {
    totalTransactions: transactions.length,
    totalAmount,
    averageAmount: Math.round(averageAmount * 100) / 100,
    lastTransactionDate: sorted[0]?.createdAt ?? null,
  };
}

/**
 * Normalize raw transaction stats API response.
 * Validated via Zod before mapping.
 */
export function normalizeTransactionStats(data: unknown): TransactionStats {
  const parsed = ApiTransactionStatsSchema.parse(data);
  return {
    totalTransactions: parsed.totalTransactions,
    totalAmount: parsed.totalAmount,
    averageAmount: parsed.averageAmount,
    lastTransactionDate: parsed.lastTransactionDate ?? null,
  };
}

/**
 * Filter transactions by status.
 */
export function filterTransactionsByStatus(
  transactions: Transaction[],
  status: 'pending' | 'confirmed' | 'failed'
): Transaction[] {
  if (!Array.isArray(transactions)) {
    return [];
  }
  return transactions.filter((tx) => tx.status === status);
}

/**
 * Filter transactions by date range.
 */
export function filterTransactionsByDateRange(
  transactions: Transaction[],
  startDate: Date,
  endDate: Date
): Transaction[] {
  if (!Array.isArray(transactions)) {
    return [];
  }

  const start = startDate.getTime();
  const end = endDate.getTime();

  return transactions.filter((tx) => {
    const txTime = new Date(tx.createdAt).getTime();
    return txTime >= start && txTime <= end;
  });
}

/**
 * Group transactions by creator.
 */
export function groupTransactionsByCreator(
  transactions: Transaction[]
): Record<string, Transaction[]> {
  if (!Array.isArray(transactions)) {
    return {};
  }

  return transactions.reduce<Record<string, Transaction[]>>((acc, tx) => {
    const creatorId = tx.creatorId;
    if (!acc[creatorId]) {
      acc[creatorId] = [];
    }
    const bucket = acc[creatorId];
    if (bucket) {
      bucket.push(tx);
    }
    return acc;
  }, {});
}

/**
 * Enrich transaction history with computed fields.
 */
export function enrichTransactionHistory(history: TransactionHistory): TransactionHistory & {
  stats: TransactionStats;
  pagination: ReturnType<typeof calculatePaginationMetadata>;
} {
  const stats = calculateTransactionStats(history.transactions);
  const pagination = calculatePaginationMetadata(history.total, history.page, history.pageSize);

  return {
    ...history,
    stats,
    pagination,
  };
}
