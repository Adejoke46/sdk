import { BatchProcessor } from '../http/batch-processor';

export type BatchOperationResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: Error };

export interface BatchExecuteOptions {
  concurrency?: number;
  retries?: number;
  retryDelayMs?: number;
  backoffMultiplier?: number;
  onProgress?: (current: number, total: number) => void;
}

/** Collects async operations and runs them with bounded concurrency. */
export class Batcher<T = unknown> {
  private readonly operations: Array<() => Promise<T>> = [];

  add<Result extends T>(operation: () => Promise<Result>): this {
    this.operations.push(operation);
    return this;
  }

  async execute(options: BatchExecuteOptions = {}): Promise<BatchOperationResult<T>[]> {
    const { onProgress, ...processorOptions } = options;
    const processor = new BatchProcessor<() => Promise<T>, T>({
      ...processorOptions,
      onProgress: ({ completed, total }) => onProgress?.(completed, total),
    });
    const batch = await processor.process(this.operations, (operation) => operation());
    const results = new Array<BatchOperationResult<T>>(this.operations.length);

    for (const { index, result } of batch.successful) {
      results[index] = { status: 'fulfilled', value: result };
    }
    for (const { index, error } of batch.failed) {
      results[index] = { status: 'rejected', reason: error };
    }

    return results;
  }
}