/**
 * Batch Processor
 *
 * Provides batch execution with concurrency control, partial failure isolation,
 * error tracking, and selective retry functionality.
 */

import { ApiError, DorisioError } from '../types/errors';

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
}

/**
 * Aggregated result of a batch operation
 */
export interface BatchResult<T, R> {
  successful: BatchSuccess<T, R>[];
  failed: BatchFailure<T>[];
  total: number;
  hasFailures: boolean;
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
}

export class BatchProcessor<T, R> {
  private options: Required<Omit<BatchProcessorOptions<T>, 'onProgress' | 'onRetry'>> & {
    onProgress?: BatchProcessorOptions<T>['onProgress'];
    onRetry?: BatchProcessorOptions<T>['onRetry'];
  };

  constructor(options?: BatchProcessorOptions<T>) {
    const concurrency = options?.concurrency ?? 4;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('concurrency must be an integer greater than or equal to 1');
    }

    this.options = {
      concurrency,
      retries: options?.retries ?? 0,
      retryDelayMs: options?.retryDelayMs ?? 500,
      backoffMultiplier: options?.backoffMultiplier ?? 2,
      onProgress: options?.onProgress,
      onRetry: options?.onRetry,
    };
  }

  /**
   * Process a batch of items with concurrency control and partial failure handling
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
      };
    }

    const successful: BatchSuccess<T, R>[] = [];
    const failed: BatchFailure<T>[] = [];
    let completed = 0;
    let nextIndex = 0;

    const executeItemWithRetry = async (item: T, index: number): Promise<void> => {
      let attempts = 0;
      const maxAttempts = (this.options.retries ?? 0) + 1;

      while (attempts < maxAttempts) {
        attempts++;
        try {
          const result = await fn(item, index);
          successful.push({ item, result, index });
          return;
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          if (attempts < maxAttempts) {
            this.options.onRetry?.(item, attempts, error);
            const delay = this.options.retryDelayMs * Math.pow(this.options.backoffMultiplier, attempts - 1);
            await new Promise((resolve) => setTimeout(resolve, delay));
          } else {
            let status: number | undefined;
            if (err instanceof ApiError && err.statusCode !== undefined) {
              status = err.statusCode;
            } else if (err instanceof DorisioError && err.statusCode !== undefined) {
              status = err.statusCode;
            } else if (typeof (err as Record<string, unknown>)?.status === 'number') {
              status = (err as Record<string, unknown>).status as number;
            } else if (typeof (err as Record<string, unknown>)?.statusCode === 'number') {
              status = (err as Record<string, unknown>).statusCode as number;
            }

            failed.push({
              item,
              error,
              status,
              statusCode: status,
              index,
            });
          }
        }
      }
    };

    const worker = async (): Promise<void> => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        const item = items[index];
        if (item === undefined) continue;

        await executeItemWithRetry(item, index);
        completed++;

        this.options.onProgress?.({
          completed,
          total: items.length,
          successful: successful.length,
          failed: failed.length,
        });
      }
    };

    const workers = Array.from(
      { length: Math.min(this.options.concurrency, items.length) },
      () => worker()
    );

    await Promise.all(workers);

    // Sort by original index for consistent ordering
    successful.sort((a, b) => a.index - b.index);
    failed.sort((a, b) => a.index - b.index);

    return {
      successful,
      failed,
      total: items.length,
      hasFailures: failed.length > 0,
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
  };
}
