/**
 * History Methods
 *
 * SDK methods for fetching transaction and activity history.
 */

import { TransactionHistory, TransactionStats } from '../types/models';
import {
  ApiCreatorEarningsSchema,
  ApiTransactionHistorySchema,
} from '../types/schemas';
import { filterTransactionsByDateRange, normalizeTransactionStats } from '../utils/transaction-normalizers';
import { DorisioClient } from '../client';
import { RequestOptions, type StreamedResponse } from '../http/http-client';
import type { StreamRequestOptions } from '../types/stream';

/**
 * Get full transaction history with filters
 * GET /transactions
 *
 * Retrieves transaction records across creators and users with optional date filtering.
 *
 * @param queryOptions - Pagination, status, and date range filters
 * @param queryOptions.page - Page number (1-indexed)
 * @param queryOptions.pageSize - Page size limit
 * @param queryOptions.startDate - Filter transactions on or after this date
 * @param queryOptions.endDate - Filter transactions on or before this date
 * @param queryOptions.status - Filter by transaction status ('pending' | 'confirmed' | 'failed')
 * @param options - Optional request options including custom HTTP headers
 * @returns TransactionHistory record
 *
 * @throws {Error} If request fails
 *
 * @example
 * ```ts
 * const history = await client.getFullTransactionHistory(
 *   {
 *     page: 1,
 *     pageSize: 50,
 *     status: 'confirmed',
 *     startDate: new Date('2024-01-01'),
 *   },
 *   { headers: { 'X-Request-ID': 'history-export-01' } }
 * );
 * console.log(`Fetched ${history.transactions.length} confirmed transactions`);
 * ```
 */
export async function getFullTransactionHistory(
  this: DorisioClient,
  queryOptions?: {
    page?: number;
    pageSize?: number;
    startDate?: Date;
    endDate?: Date;
    status?: 'pending' | 'confirmed' | 'failed';
  },
  options?: Partial<RequestOptions>
): Promise<TransactionHistory> {
  const params = new URLSearchParams();

  if (queryOptions?.page) params.append('page', String(queryOptions.page));
  if (queryOptions?.pageSize) params.append('pageSize', String(queryOptions.pageSize));
  if (queryOptions?.status) params.append('status', queryOptions.status);

  const query = params.toString() ? `?${params.toString()}` : '';
  const response = options
    ? await this.request('GET', `/transactions${query}`, undefined, options)
    : await this.request('GET', `/transactions${query}`);

  if (!response.success || !response.data) {
    throw new Error('Failed to fetch transaction history');
  }

  const parsed = ApiTransactionHistorySchema.parse(response.data);
  const history: TransactionHistory = {
    transactions: parsed.transactions.map((tx) => {
      const rawStatus = tx.stellarStatus ?? tx.status ?? 'pending';
      const status = (rawStatus === 'completed' ? 'confirmed' : rawStatus) as
        | 'pending'
        | 'confirmed'
        | 'failed';
      return {
        id: tx.id,
        fromUserId: tx.fromUserId,
        creatorId: tx.creatorId,
        amount: tx.amount,
        message: tx.message ?? null,
        status,
        stellarTxHash: tx.stellarTxHash ?? null,
        createdAt: tx.createdAt,
        updatedAt: tx.updatedAt,
      };
    }),
    total: parsed.total,
    page: parsed.page,
    pageSize: parsed.pageSize,
  };

  // Apply date range filter client-side if provided
  if (queryOptions?.startDate && queryOptions?.endDate) {
    const filtered = filterTransactionsByDateRange(
      history.transactions,
      queryOptions.startDate,
      queryOptions.endDate
    );
    return { ...history, transactions: filtered, total: filtered.length };
  }

  return history;
}

/**
 * Get transaction statistics
 * GET /transactions/stats
 *
 * @param userId - Optional user ID to scope statistics
 * @param options - Optional request options including custom HTTP headers
 * @returns Aggregated transaction stats
 *
 * @throws {Error} If request fails
 *
 * @example
 * ```ts
 * const stats = await client.getTransactionStats('user-123');
 * console.log('Total Volume:', stats.totalVolume, 'Average Tip:', stats.averageTip);
 * ```
 */
export async function getTransactionStats(
  this: DorisioClient,
  userId?: string,
  options?: Partial<RequestOptions>
): Promise<TransactionStats> {
  const params = userId ? `?userId=${encodeURIComponent(userId)}` : '';
  const response = options
    ? await this.request('GET', `/transactions/stats${params}`, undefined, options)
    : await this.request('GET', `/transactions/stats${params}`);

  if (!response.success || !response.data) {
    throw new Error('Failed to fetch transaction statistics');
  }

  return normalizeTransactionStats(response.data);
}

/**
 * Get creator earnings summary
 * GET /creators/:creatorId/earnings
 *
 * @param creatorId - Unique creator identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 * @returns Summary of confirmed and pending earnings
 *
 * @throws {Error} If creatorId is invalid or request fails
 *
 * @example
 * ```ts
 * const earnings = await client.getCreatorEarnings('creator-123');
 * console.log(`Total earnings: $${earnings.totalEarnings}, Confirmed: $${earnings.confirmedBalance}`);
 * ```
 */
export async function getCreatorEarnings(
  this: DorisioClient,
  creatorId: string,
  options?: Partial<RequestOptions>
): Promise<{
  totalEarnings: number;
  pendingBalance: number;
  confirmedBalance: number;
  transactionCount: number;
}> {
  const response = options
    ? await this.request('GET', `/creators/${creatorId}/earnings`, undefined, options)
    : await this.request('GET', `/creators/${creatorId}/earnings`);

  if (!response.success || !response.data) {
    throw new Error(`Failed to fetch earnings for creator: ${creatorId}`);
  }

  const parsed = ApiCreatorEarningsSchema.parse(response.data);
  return {
    totalEarnings: parsed.totalEarnings,
    pendingBalance: parsed.pendingBalance,
    confirmedBalance: parsed.confirmedBalance,
    transactionCount: parsed.transactionCount,
  };
}

/**
 * Options accepted by {@link exportTransactionHistory} and
 * {@link exportTransactionHistoryStream}.
 */
export interface TransactionExportOptions {
  format?: 'csv' | 'json';
  startDate?: Date;
  endDate?: Date;
  /**
   * Stream the export instead of buffering it (Issue #120).
   *
   * When `true` the call resolves to a {@link StreamedResponse}
   * (`stream` / `stats` / `abort`) instead of the exported string, and the
   * second argument is interpreted as {@link StreamRequestOptions}. Memory
   * stays O(chunk) regardless of export size.
   */
  stream?: boolean;
}

/**
 * Export transaction history (CSV or JSON)
 * GET /transactions/export
 *
 * @param exportOptions - Export formatting, range filters and streaming flag
 * @param exportOptions.format - Output format ('csv' or 'json', default: 'json')
 * @param exportOptions.startDate - Optional start date
 * @param exportOptions.endDate - Optional end date
 * @param exportOptions.stream - Stream the response instead of buffering it
 * @param options - Optional request options (or {@link StreamRequestOptions}
 *   when `stream: true`)
 * @returns Raw exported data string, or a {@link StreamedResponse} when
 *   `stream: true`
 *
 * @throws {Error} If export fails
 *
 * @example
 * ```ts
 * const csvData = await client.exportTransactionHistory({
 *   format: 'csv',
 *   startDate: new Date('2024-01-01'),
 * });
 * console.log(csvData);
 *
 * // Large exports: stream instead of buffering the whole response.
 * const { stream, stats } = await client.exportTransactionHistory({
 *   format: 'csv',
 *   stream: true,
 * });
 * const reader = stream.getReader();
 * while (true) {
 *   const { done, value } = await reader.read();
 *   if (done) break;
 *   processChunk(value);
 * }
 * console.log(`streamed ${stats.totalBytes} bytes in ${stats.chunks} chunks`);
 * ```
 */
export function exportTransactionHistory(
  this: DorisioClient,
  exportOptions: TransactionExportOptions & { stream: true },
  streamOptions?: StreamRequestOptions
): Promise<StreamedResponse>;

export function exportTransactionHistory(
  this: DorisioClient,
  exportOptions?: TransactionExportOptions & { stream?: false },
  options?: Partial<RequestOptions>
): Promise<string>;

export async function exportTransactionHistory(
  this: DorisioClient,
  exportOptions?: TransactionExportOptions,
  options?: Partial<RequestOptions> | StreamRequestOptions
): Promise<string | StreamedResponse> {
  if (exportOptions?.stream) {
    return exportTransactionHistoryStream.call(
      this,
      exportOptions,
      options as StreamRequestOptions | undefined
    );
  }

  const format = exportOptions?.format ?? 'json';
  const params = new URLSearchParams();
  params.append('format', format);

  if (exportOptions?.startDate) {
    params.append('startDate', exportOptions.startDate.toISOString());
  }
  if (exportOptions?.endDate) {
    params.append('endDate', exportOptions.endDate.toISOString());
  }

  const query = params.toString() ? `?${params.toString()}` : '';
  const response = options
    ? await this.request('GET', `/transactions/export${query}`, undefined, options)
    : await this.request('GET', `/transactions/export${query}`);

  if (!response.success || !response.data) {
    throw new Error('Failed to export transaction history');
  }

  return String(response.data);
}

/**
 * Export transaction history as a stream (CSV or JSON)
 * GET /transactions/export?stream=true
 *
 * Streaming variant of {@link exportTransactionHistory} for large exports.
 * The response is consumed incrementally: chunks are decoded and delivered
 * to the consumer as they arrive, with reader-driven backpressure, so SDK
 * memory stays constant (O(chunk size)) no matter how large the export is.
 *
 * @param exportOptions - Export formatting and range filters
 * @param exportOptions.format - Output format ('csv' or 'json', default: 'csv')
 * @param exportOptions.startDate - Optional start date
 * @param exportOptions.endDate - Optional end date
 * @param streamOptions - Streaming options (signal, progress, backpressure)
 * @returns A live `ReadableStream<string>` of text chunks plus transfer stats
 *   and an `abort()` handle
 *
 * @example
 * ```ts
 * const { stream } = await client.exportTransactionHistoryStream({
 *   format: 'csv',
 *   startDate: new Date('2024-01-01'),
 * });
 *
 * const reader = stream.getReader();
 * for (;;) {
 *   const { done, value } = await reader.read();
 *   if (done) break;
 *   processChunk(value); // incremental processing — memory stays flat
 * }
 * ```
 */
export async function exportTransactionHistoryStream(
  this: DorisioClient,
  exportOptions?: TransactionExportOptions,
  streamOptions?: StreamRequestOptions
) {
  const format = exportOptions?.format ?? 'csv';
  const params = new URLSearchParams();
  params.append('format', format);
  params.append('stream', 'true');

  if (exportOptions?.startDate) {
    params.append('startDate', exportOptions.startDate.toISOString());
  }
  if (exportOptions?.endDate) {
    params.append('endDate', exportOptions.endDate.toISOString());
  }

  return this.getHttpClient().requestTextStream(
    `/transactions/export?${params.toString()}`,
    streamOptions
  );
}
