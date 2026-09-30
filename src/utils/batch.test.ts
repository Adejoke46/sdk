import { describe, expect, it, vi } from 'vitest';
import { Batcher } from './batch';

describe('Batcher', () => {
  it('runs operations with bounded concurrency and returns outcomes in registration order', async () => {
    const batcher = new Batcher<number>();
    let active = 0;
    let maximumActive = 0;

    for (const value of [1, 2, 3, 4]) {
      batcher.add(async () => {
        active++;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, value === 1 ? 10 : 1));
        active--;
        return value;
      });
    }

    const results = await batcher.execute({ concurrency: 2 });

    expect(maximumActive).toBe(2);
    expect(results).toEqual([
      { status: 'fulfilled', value: 1 },
      { status: 'fulfilled', value: 2 },
      { status: 'fulfilled', value: 3 },
      { status: 'fulfilled', value: 4 },
    ]);
  });

  it('reports progress as each operation completes', async () => {
    const onProgress = vi.fn();
    const batcher = new Batcher<string>()
      .add(async () => 'one')
      .add(async () => 'two')
      .add(async () => 'three');

    await batcher.execute({ concurrency: 2, onProgress });

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls.map(([current, total]) => [current, total])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('keeps an individual failure in its position and continues other operations', async () => {
    const laterOperation = vi.fn(async () => 'completed');
    const batcher = new Batcher<string>()
      .add(async () => 'first')
      .add(async () => {
        throw new Error('operation failed');
      })
      .add(laterOperation);

    const results = await batcher.execute({ concurrency: 1 });

    expect(results).toEqual([
      { status: 'fulfilled', value: 'first' },
      { status: 'rejected', reason: new Error('operation failed') },
      { status: 'fulfilled', value: 'completed' },
    ]);
    expect(laterOperation).toHaveBeenCalledOnce();
  });

  it('returns an empty result for an empty batch', async () => {
    await expect(new Batcher().execute()).resolves.toEqual([]);
  });
});