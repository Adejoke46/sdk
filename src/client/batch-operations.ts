/**
 * Batch Operations
 *
 * Batch processing utilities with concurrency control, partial failure isolation,
 * error reporting, and selective retry support.
 */

import { DorisioClient } from '../client';
import { Creator, Transaction, TransactionHistory } from '../types/models';
import { BalanceInfo } from './balance';
import { CreateTipRequest } from './transactions';
import {
  BatchProcessor,
  BatchProcessorOptions,
  BatchResult,
  processBatch,
  retryBatchFailures,
} from '../http/batch-processor';
import { RequestOptions } from '../http/http-client';

export type { BatchResult, BatchSuccess, BatchFailure, BatchProcessorOptions } from '../http/batch-processor';

/**
 * Fetch multiple creators concurrently with fail-fast semantics
 *
 * @param creatorIds - Array of creator IDs to fetch
 * @param concurrency - Maximum concurrent requests (default: 4)
 * @param options - Optional request options including custom HTTP headers
 * @returns Array of creators
 *
 * @throws {Error} If any creator request fails
 *
 * @example
 * ```ts
 * const creators = await client.getCreators(['c1', 'c2', 'c3'], 4, {
 *   headers: { 'X-Request-ID': 'batch-creators-01' },
 * });
 * console.log(`Fetched ${creators.length} creators`);
 * ```
 */
export async function getCreators(
  this: DorisioClient,
  creatorIds: string[],
  concurrency = 4,
  options?: Partial<RequestOptions>
): Promise<Creator[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be at least 1');
  }
  const results = new Array<Creator>(creatorIds.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < creatorIds.length) {
      const index = next++;
      const id = creatorIds[index];
      if (id === undefined) continue;
      results[index] = await this.getCreator(id, options);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, creatorIds.length) }, () => worker())
  );
  return results;
}

/**
 * Fetch multiple creators with partial failure isolation and retry capability
 *
 * @param creatorIds - Array of creator IDs to fetch
 * @param options - Batch processor options (concurrency, retries, onProgress, etc.)
 * @returns BatchResult with successful and failed results
 *
 * @example
 * ```ts
 * const result = await client.getCreatorsBatch(['c1', 'c2', 'invalid-id'], {
 *   concurrency: 4,
 *   retries: 2,
 * });
 *
 * console.log(`Succeeded: ${result.successful.length}`);
 * console.log(`Failed: ${result.failed.length}`);
 *
 * if (result.hasFailures) {
 *   // Retry failed items
 *   const retried = await client.retryBatchFailures(result, (id) => client.getCreator(id));
 *   console.log(`Recovered: ${retried.successful.length}`);
 * }
 * ```
 */
export async function getCreatorsBatch(
  this: DorisioClient,
  creatorIds: string[],
  options?: BatchProcessorOptions
): Promise<BatchResult<string, Creator>> {
  const processor = new BatchProcessor<string, Creator>(options);
  return processor.process(creatorIds, (id) => this.getCreator(id));
}

/**
 * Fetch multiple wallet balances concurrently with fail-fast semantics
 *
 * @param walletIds - Array of wallet IDs to fetch
 * @param concurrency - Maximum concurrent requests (default: 4)
 * @param options - Optional request options including custom HTTP headers
 * @returns Array of BalanceInfo objects
 *
 * @throws {Error} If any balance query fails
 *
 * @example
 * ```ts
 * const balances = await client.getAllWalletBalances(['w1', 'w2'], 4);
 * balances.forEach(b => console.log(b.walletId, b.total));
 * ```
 */
export async function getAllWalletBalances(
  this: DorisioClient,
  walletIds: string[],
  concurrency = 4,
  options?: Partial<RequestOptions>
): Promise<BalanceInfo[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be at least 1');
  }
  const results = new Array<BalanceInfo>(walletIds.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < walletIds.length) {
      const index = next++;
      const id = walletIds[index];
      if (id === undefined) continue;
      results[index] = await this.getWalletBalance(id, options);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, walletIds.length) }, () => worker())
  );
  return results;
}

/**
 * Fetch multiple wallet balances with partial failure handling
 *
 * @param walletIds - Array of wallet IDs to fetch
 * @param options - Batch processor options
 * @returns BatchResult with successful and failed balances
 *
 * @example
 * ```ts
 * const result = await client.getWalletBalancesBatch(['w1', 'w2', 'w3'], { concurrency: 3 });
 * result.successful.forEach(({ item, result }) => console.log(item, result.available));
 * ```
 */
export async function getWalletBalancesBatch(
  this: DorisioClient,
  walletIds: string[],
  options?: BatchProcessorOptions
): Promise<BatchResult<string, BalanceInfo>> {
  const processor = new BatchProcessor<string, BalanceInfo>(options);
  return processor.process(walletIds, (id) => this.getWalletBalance(id));
}

/**
 * Create multiple tips in batch with partial failure handling and retry
 *
 * @param tips - Array of tip creation requests
 * @param options - Batch processor options
 * @returns BatchResult with successfully created tips and failed requests
 *
 * @example
 * ```ts
 * const result = await client.createTipsBatch([
 *   { creatorId: 'c1', amount: 10 },
 *   { creatorId: 'c2', amount: 20 },
 * ], { retries: 1 });
 *
 * console.log(`Created ${result.successful.length} tips`);
 * ```
 */
export async function createTipsBatch(
  this: DorisioClient,
  tips: CreateTipRequest[],
  options?: BatchProcessorOptions
): Promise<BatchResult<CreateTipRequest, Transaction>> {
  const processor = new BatchProcessor<CreateTipRequest, Transaction>(options);
  return processor.process(tips, (tip) => this.createTip(tip));
}

/**
 * Generic batch executor with partial failure handling and optional retry
 *
 * @param items - Array of items to process
 * @param fn - Asynchronous processor function
 * @param options - Batch processor options
 * @returns BatchResult containing success and failure arrays
 *
 * @example
 * ```ts
 * const result = await client.processBatchWithRetry(
 *   ['c1', 'c2'],
 *   (id) => client.getCreator(id),
 *   { concurrency: 2, retries: 1 }
 * );
 * ```
 */
export async function processBatchWithRetry<T, R>(
  this: DorisioClient,
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  options?: BatchProcessorOptions
): Promise<BatchResult<T, R>> {
  return processBatch(items, fn, options);
}

/**
 * Retry failed items from a previous batch result
 *
 * @param batchResult - Prior BatchResult containing failed items
 * @param fn - Processor function to re-execute for failed items
 * @param options - Batch processor options
 * @returns Updated BatchResult with merged successes and remaining failures
 *
 * @example
 * ```ts
 * const updatedResult = await client.retryBatch(initialResult, (id) => client.getCreator(id));
 * ```
 */
export async function retryBatch<T, R>(
  this: DorisioClient,
  batchResult: BatchResult<T, R>,
  fn: (item: T, index: number) => Promise<R>,
  options?: BatchProcessorOptions
): Promise<BatchResult<T, R>> {
  return retryBatchFailures(batchResult, fn, options);
}

/**
 * Paginate and collect entire transaction history across all pages
 *
 * @param pageSize - Page size per fetch (1-100, default: 100)
 * @param options - Optional request options including custom HTTP headers
 * @returns Consolidated TransactionHistory with all transactions
 *
 * @throws {Error} If pageSize is invalid or request fails
 *
 * @example
 * ```ts
 * const fullHistory = await client.getAllTransactionHistory(100, {
 *   headers: { 'X-Request-ID': 'all-history-query' },
 * });
 * console.log(`Total transactions retrieved: ${fullHistory.transactions.length}`);
 * ```
 */
export async function getAllTransactionHistory(
  this: DorisioClient,
  pageSize = 100,
  options?: Partial<RequestOptions>
): Promise<TransactionHistory> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error('pageSize must be between 1 and 100');
  }
  const transactions: Transaction[] = [];
  let page = 1;
  let total = 0;
  let hasMore = true;
  while (hasMore) {
    const result = await this.getTransactionHistory({ page, pageSize }, options);
    transactions.push(...result.transactions);
    total = result.total;
    hasMore = !(
      result.transactions.length === 0 ||
      transactions.length >= total ||
      result.transactions.length < pageSize
    );
    page += 1;
  }
  return { transactions, total, page: 1, pageSize: transactions.length || pageSize };
}
