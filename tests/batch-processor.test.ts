/**
 * Batch Processor Tests (Issue #62)
 *
 * Verifies that:
 * 1. Batch requests continue on partial failure.
 * 2. Results accurately report which items succeeded and failed with index/status metadata.
 * 3. Failed items can be selectively retried.
 * 4. Automatic retry per item works with exponential backoff.
 * 5. DorisioClient integration methods work properly.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  BatchProcessor,
  processBatch,
  retryBatchFailures,
} from '../src/http/batch-processor';
import { ApiError } from '../src/types/errors';
import { DorisioClient } from '../src/client';

describe('Batch Processor with Partial Failure Handling (Issue #62)', () => {
  it('processes all items successfully when no errors occur', async () => {
    const items = ['item1', 'item2', 'item3'];
    const result = await processBatch(items, async (item, index) => {
      return `${item}-processed-${index}`;
    });

    expect(result.total).toBe(3);
    expect(result.hasFailures).toBe(false);
    expect(result.successful).toHaveLength(3);
    expect(result.failed).toHaveLength(0);
    expect(result.successful[0]).toEqual({ item: 'item1', result: 'item1-processed-0', index: 0 });
    expect(result.successful[1]).toEqual({ item: 'item2', result: 'item2-processed-1', index: 1 });
    expect(result.successful[2]).toEqual({ item: 'item3', result: 'item3-processed-2', index: 2 });
  });

  it('continues processing remaining items when individual items fail', async () => {
    const items = ['valid1', 'fail', 'valid2', 'fail2'];
    const processor = new BatchProcessor<string, string>({ concurrency: 2 });

    const result = await processor.process(items, async (item) => {
      if (item.startsWith('fail')) {
        throw new ApiError(`Error on ${item}`, 404);
      }
      return `${item}-ok`;
    });

    expect(result.total).toBe(4);
    expect(result.hasFailures).toBe(true);
    expect(result.successful).toHaveLength(2);
    expect(result.failed).toHaveLength(2);

    expect(result.successful[0]?.item).toBe('valid1');
    expect(result.successful[0]?.result).toBe('valid1-ok');
    expect(result.successful[0]?.index).toBe(0);

    expect(result.successful[1]?.item).toBe('valid2');
    expect(result.successful[1]?.result).toBe('valid2-ok');
    expect(result.successful[1]?.index).toBe(2);

    expect(result.failed[0]?.item).toBe('fail');
    expect(result.failed[0]?.status).toBe(404);
    expect(result.failed[0]?.index).toBe(1);

    expect(result.failed[1]?.item).toBe('fail2');
    expect(result.failed[1]?.status).toBe(404);
    expect(result.failed[1]?.index).toBe(3);
  });

  it('supports selective retry of failed items via retryFailed', async () => {
    const items = ['a', 'b', 'c'];

    const processor = new BatchProcessor<string, string>();
    const initialResult = await processor.process(items, async (item) => {
      if (item === 'b') {
        throw new Error('temporary failure');
      }
      return `result-${item}`;
    });

    expect(initialResult.successful).toHaveLength(2);
    expect(initialResult.failed).toHaveLength(1);
    expect(initialResult.failed[0]?.item).toBe('b');

    // Retry only the failed item
    const retryResult = await processor.retryFailed(initialResult.failed, async (item) => {
      return `recovered-${item}`;
    });

    expect(retryResult.successful).toHaveLength(1);
    expect(retryResult.failed).toHaveLength(0);
    expect(retryResult.successful[0]?.item).toBe('b');
    expect(retryResult.successful[0]?.result).toBe('recovered-b');
    expect(retryResult.successful[0]?.index).toBe(1);
  });

  it('supports retryBatchFailures merging helper', async () => {
    const items = ['item1', 'item2', 'item3'];
    let shouldFail = true;

    const initialResult = await processBatch(items, async (item) => {
      if (item === 'item2' && shouldFail) {
        throw new Error('transient error');
      }
      return `ok-${item}`;
    });

    expect(initialResult.successful).toHaveLength(2);
    expect(initialResult.failed).toHaveLength(1);

    // Now fix condition and retry
    shouldFail = false;
    const mergedResult = await retryBatchFailures(initialResult, async (item) => {
      return `recovered-${item}`;
    });

    expect(mergedResult.hasFailures).toBe(false);
    expect(mergedResult.successful).toHaveLength(3);
    expect(mergedResult.successful.map((s) => s.item)).toEqual(['item1', 'item2', 'item3']);
    expect(mergedResult.successful[1]?.result).toBe('recovered-item2');
  });

  it('handles automatic retries within BatchProcessor', async () => {
    const attemptsMap = new Map<string, number>();
    const onRetry = vi.fn();

    const processor = new BatchProcessor<string, string>({
      retries: 2,
      retryDelayMs: 10,
      onRetry,
    });

    const result = await processor.process(['item-retry'], async (item) => {
      const attempts = (attemptsMap.get(item) ?? 0) + 1;
      attemptsMap.set(item, attempts);
      if (attempts < 3) {
        throw new Error(`fail-${attempts}`);
      }
      return `success-on-attempt-${attempts}`;
    });

    expect(result.successful).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.successful[0]?.result).toBe('success-on-attempt-3');
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('integrates with DorisioClient batch methods', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.dorisio.com',
      mode: 'sandbox',
    });

    const creatorsResult = await client.getCreatorsBatch(['creator-1', 'creator-2'], {
      concurrency: 2,
    });

    expect(creatorsResult.total).toBe(2);
    expect(creatorsResult.hasFailures).toBe(false);
    expect(creatorsResult.successful).toHaveLength(2);
  });
});
