/**
 * Batch Processor
 *
 * Provides batch execution with concurrency control, partial failure isolation,
 * error tracking, chunking for large batches, and selective retry functionality.
 *
 * Retry logic is delegated to the {@link RetryManager} when one is supplied; the
 * processor itself never implements custom retry strategies.
 */

import { ApiError, DorisioError } from '../types/errors';
import { RetryManager, type RetryConfig } from './retry-manager';

/**
 * Result for a successfully processed batch item
 */
export interface BatchSuccess<T, R> {
  item: T;
  result: R;
  index: number;
}

/**
 * Result for a failed batch item
 */
export interface BatchFailure<T> {
  item: T;
  error: Error;
  status?: number;
  statusCode?: number;
  index: number;
  /** Number of attempts made for this item (including the first). */
  attempts?: number;
}

/**
 * Aggregated result of a batch operation
 */
export interface BatchResult<T, R> {
  successful: BatchSuccess<T, R> [];
  failed: BatchFailure<T> [];
  total: number;
  hasFailures: boolean;
  /** Number of items that succeeded after at least one retry. */
  partiallyRecovered?: number;
}

/**
 * Options for configuring batch processing
 */
export interface BatchProcessorOptions<T = any> {
  /**
   * Maximum number of concurrent requests (default: 4)
   */
  concurrency?: number;
  /**
   * Maximum number of items sent in a single chunk (default: 50).
   * Batches larger than this are split into chunks and executed sequentially.
   */
  chunkSize?: number;
  /**
   * Number of automatic retry attempts for failed items before recording a failure (default: 0)
   */
  retries?: number;
  /**
   * Initial retry delay in milliseconds (default: 500)
   */
  retryDelayMs?: number;
  /**
   * Exponential backoff multiplier for retries (default: 2)
   */
  backoffMultiplier?: number;
  /**
   * Optional callback triggered on each completed item (success or failure)
   */
  onProgress?: (progress: { completed: number; total: number; successful: number; failed: number }) => void;
  /**
   * Optional callback triggered when an item retry occurs
   */
  onRetry?: (item: T, attempt: number, error: Error) => void;
  /**
   * Optional RetryManager instance. When provided, retries are delegated to it
   * instead of the built-in exponential backoff loop.
   */
  retryManager?: RetryManager;
  /**
   * Optional predicate to decide whether an error is retryable when using a
   * RetryManager.
   */
  isRetryable?: (error: unknown) => boolean;
}

export class BatchProcessor<T, R> {
  private options: Required<Omit<BatchProcessorOptions<T>, 'onItemComplete' | 'onProgress' | 'onRetry' | 'retryManager' | 'isRetryable'>> & {
    onProgress?: BatchProcessorOptions<T>['onProgress'];
    onRetry?: BatchProcessorOptions<T>['onRetry'];
    retryManager?: RetryManager;
    isRetryable?: BatchProcessorOptions<T>['isRetryable'];
  };

  constructor(options?: BatchProcessorOptions<T>) {
    const concurrency = options?.concurrency ?? 4;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('concurrency must be an integer greater than or equal to 1');
    }

    const chunkSize = options?.chunkSize ?? 50;
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
      throw new Error('chunkSize must be an integer greater than or equal to 1');
    }

    const retries = options?.retries ?? 0;
    if (!Number.isInteger(retries) || retries < 0) {
      throw new Error('retries must be a non-negative integer');
    }

    this.options = {
      concurrency,
      chunkSize,
      retries,
      retryDelayMs: options?.retryDelayMs ?? 500,
      backoffMultiplier: options?.backoffMultiplier ?? 2,
      onProgress: options?.onProgress,
      onRetry: options?.onRetry,
      retryManager: options?.retryManager,
      isRetryable: options?.isRetryable,
    };
  }

  /**
   * Process a batch of items with concurrency control and partial failure handling
   *
   * When the number of items exceeds {@link BatchProcessorOptions.chunkSize} the batch is
   * split into chunks that are executed sequentially, while items within a chunk are
   * processed with the configured concurrency.
   *
   * @param items - Array of items to process
   * @param fn - Processing function to execute for each item
   * @returns BatchResult with successful and failed items
   *
   * @example
   * ```ts
   * const processor = new BatchProcessor<string, Creator>({ concurrency: 4 });
   * const result = await processor.process(creatorIds, (id) => client.getCreator(id));
   *
   * console.log(`Succeeded: ${result.successful.length}, Failed: ${result.failed.length}`);
   * ```
   */
  async process(
    items: T[],
    fn: (item: T, index: number) => Promise<R>
  ): Promise<BatchResult<T, R>> {
    if (!items || items.length === 0) {
      return {
        successful: [],
        failed: [],
        total: 0,
        hasFailures: false,
        partiallyRecovered: 0,
      };
    }

    const successful: BatchSuccess<T, R> [] = [];
    const failed: BatchFailure<T>[] = [];
    let completed = 0;
    let partiallyRecovered = 0;

    const executeItemWithRetry = async (item: T, index: number): Promise<void> => {
      const maxAttempts = (this.options.retries ?? 0) + 1;
      let attempts = 0;

      const attemptFn = async (): Promise<R> => {
        attempts++;
        return fn (item, index);
      };

      try {
        let result: R;
        if (maxAttempts > 1 && this.options.retryManager) {
          // Delegate retry logic to the RetryManager.
          const manager = this.options.retryManager;
          const retryConfig: RetryConfig = {
            maxAttempts: maxAttempts,
            initialDelayMs: this.options.retryDelayMs,
            maxDelayMs: this.options.retryDelayMs * Math.pow(this.options.backoffMultiplier, maxAttempts),
            backoffMultiplier: this.options.backoffMultiplier,
          };
          void retryConfig;
          result = await manager.executeWithRetry(attemptFn, {
            isRetryable: this.options.isRetryable,
            onRetry: (info) => {
              this.options.onRetry?.(item, info.attempt + 1, info.error);
            },
          });
        } else {
          // Built-in exponential backoff loop (used when no RetryManager is supplied).
          while (attempts < maxAttempts) {
            try {
              result = await attemptFn();
              break;
            } catch (err) {
              const error = err instanceof Error ? err : new Error(String(err));
              if (attempts < maxAttempts) {
                this.options.onRetry?.(item, attempts, error);
                const delay =
                  this.options.retryDelayMs *
                  Math.pow(this.options.backoffMultiplier, attempts - 1);
                await new Promise((resolve) => setTimeout(resolve, delay));
              } else {
                throw error;
              }
            }
          }
        }

        successful.push({ item, result: result!, index });
        if (attempts > 1) {
          partiallyRecovered++;
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const status = extractStatus(err);
        failed.push({
          item,
          error,
          status,
          statusCode: status,
          index,
          attempts,
        });
      }
    };

    const chunkSize = this.options.chunkSize;
    const total = items.length;

    for (let chunkStart = 0; chunkStart < total; chunkStart += chunkSize) {
      const chunkEnd = Math.min(chunkStart + chunkSize, total);
      const chunkItems = items.slice(chunkStart, chunkEnd);
      let nextIndex = 0;

      const worker = async (): Promise<void> => {
        while (nextIndex < chunkItems.length) {
          const localIndex = nextIndex++;
          const item = chunkItems[localIndex];
          if (item === undefined) continue;

          const globalIndex = chunkStart + localIndex;
          await executeItemWithRetry(item, globalIndex);
          completed++;

          this.options.onProgress?.({
            completed,
            total,
            successful: successful.length,
            failed: failed.length,
          });
        }
      };

      const workers = Array.from(
        { length: Math.min(this.options.concurrency, chunkItems.length) },
        () => worker()
      );

      await Promise.all(workers);
    }

    // Sort by original index for consistent ordering
    successful.sort((a, b) => a.index - b.index);
    failed.sort((a, b) => a.index - b.index);

    return {
      successful,
      failed,
      total,
      hasFailures: failed.length > 0,
      partiallyRecovered,
    };
  }

  /**
   * Retry previously failed items from a batch operation
   *
   * @param failures - Array of failed items from a previous BatchResult
   * @param fn - Processing function to execute for retrying
   * @returns BatchResult of the retry attempt
   *
   * @example
   * ```ts
   * const processor = new BatchProcessor<string, Creator>();
   * const initialResult = await processor.process(creatorIds, (id) => client.getCreator(id));
   *
   * if (initialResult.hasFailures) {
   *   const retryResult = await processor.retryFailed(initialResult.failed, (id) => client.getCreator(id));
   *   console.log(`Recovered ${retryResult.successful.length} failed items`);
   * }
   * ```
   */
  async retryFailed(
    failures: BatchFailure<T>[],
    fn: (item: T, index: number) => Promise<R>
  ): Promise<BatchResult<T, R>> {
    if (!failures || failures.length === 0) {
      return {
        successful: [],
        failed: [],
        total: 0,
        hasFailures: false,
        partiallyRecovered: 0,
      };
    }

    const items = failures.map((f) => f.item);
    const result = await this.process(items, (item, i) => {
      const originalIndex = failures[i]?.index ?? i;
      return fn(item, originalIndex);
    });

    // Map the indices back to the original failure indices
    result.successful.forEach((s, i) => {
      s.index = failures[i]?.index ?? s.index;
    });
    result.failed.forEach((f, i) => {
      f.index = failures[i]?.index ?? f.index;
    });

    return result;
  }
}

/**
 * Extract an HTTP-like status code from an arbitrary error object.
 */
function extractStatus(err: unknown): number | undefined {
  if (err instanceof ApiError && err.statusCode !== undefined) {
    return err.statusCode;
  }
  if (err instanceof DorisioError && err.statusCode !== undefined) {
    return err.statusCode;
  }
  if (typeof (err as Record<string, unknown>)?.status === 'number') {
    return (err as Record<string, unknown>).status as number;
  }
  if (typeof (err as Record<string, unknown>)?.statusCode === 'number') {
    return (err as Record<string, unknown>).statusCode as number;
  }
  return undefined;
}

/**
 * Standalone batch processing function
 */
export async function processBatch<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  options?: BatchProcessorOptions
 ): Promise<BatchResult<T, R>> {
  const processor = new BatchProcessor<T, R>(options);
  return processor.process(items, fn);
}

/**
 * Retry all failed items from a BatchResult and merge results
 */
export async function retryBatchFailures<T, R>(
  batchResult: BatchResult<T, R>,
  fn: (item: T, index: number) => Promise<R>,
  options?: BatchProcessorOptions
 ): Promise<BatchResult<T, R>> {
  if (!batchResult.hasFailures || batchResult.failed.length === 0) {
    return batchResult;
  }

  const processor = new BatchProcessor<T, R>(options);
  const retryResult = await processor.retryFailed(batchResult.failed, fn);

  const combinedSuccessful = [...batchResult.successful, ...retryResult.successful].sort(
    (a, b) => a.index - b.index
  );

  return {
    successful: combinedSuccessful,
    failed: retryResult.failed,
    total: batchResult.total,
    hasFailures: retryResult.failed.length > 0,
    partiallyRecovered: retryResult.partiallyRecovered,
  };
}
