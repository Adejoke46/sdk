// @vitest-environment jsdom
/**
 * useAsync Hook Tests
 * Covers data fetching, error handling, dependency re-fetches, and unmount /
 * dependency-change cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useAsync, type UseAsyncState } from '../../src/react/useAsync';

function hookFor<T>(fn: () => Promise<T>, deps?: unknown[]) {
  return renderHook(() => useAsync(fn, deps), {});
}

describe('useAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('initial state', () => {
    it('starts with null data, no error, and begins loading immediately on mount', () => {
      const { result } = hookFor(() => Promise.resolve('data'));

      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(true);
    });
  });

  describe('data fetching', () => {
    it('transitions loading -> success and returns data', async () => {
      const { result } = hookFor(() => Promise.resolve({ id: '1', name: 'Doris' }));

      expect(result.current.loading).toBe(true);

      await act(async () => {});

      expect(result.current.data).toEqual({ id: '1', name: 'Doris' });
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it('calls fn once on mount when no deps are provided', async () => {
      const fn = vi.fn(() => Promise.resolve('once'));
      hookFor(fn);

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('refetches when dependencies change', async () => {
      const fn = vi.fn(async (id: string) => `data-${id}`);
      const { result, rerender } = renderHook(
        ({ id }) => useAsync(() => fn(id), [id]),
        { initialProps: { id: 'a' } }
      );

      await act(async () => {});
      expect(result.current.data).toBe('data-a');
      expect(fn).toHaveBeenLastCalledWith('a');

      rerender({ id: 'b' });
      expect(fn).toHaveBeenLastCalledWith('b');
      expect(result.current.loading).toBe(true);
      expect(result.current.data).toBe('data-a'); // stale until new resolve

      await act(async () => {});
      expect(result.current.data).toBe('data-b');
      expect(result.current.loading).toBe(false);
    });

    it('returns null data and error null on success with undefined result', async () => {
      const { result } = hookFor(async () => {
        const v: undefined = undefined;
        return v;
      });

      await act(async () => {});

      expect(result.current.data).toBeUndefined();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('error handling', () => {
    it('transitions loading -> error and returns the thrown error', async () => {
      const error = new Error('network failure');
      const { result } = hookFor(async () => {
        throw error;
      });

      expect(result.current.loading).toBe(true);

      await act(async () => {});

      expect(result.current.error).toBe(error);
      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('network failure');
      expect(result.current.data).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('wraps non-Error thrown values in an Error', async () => {
      const { result } = hookFor(async () => {
        throw 'string error';
      });

      await act(async () => {});

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('string error');
    });

    it('clears error before a new attempt and reports only the latest failure', async () => {
      const first = new Error('first');
      const second = new Error('second');
      const fn = vi.fn(async (attempt: number) => {
        if (attempt === 1) throw first;
        throw second;
      });
      const { result, rerender } = renderHook(
        ({ attempt }) => useAsync(() => fn(attempt), [attempt]),
        { initialProps: { attempt: 1 } }
      );

      await act(async () => {});
      expect(result.current.error).toBe(first);

      rerender({ attempt: 2 });
      await act(async () => {});
      expect(result.current.error).toBe(second);
      expect(result.current.error).not.toBe(first);
    });
  });

  describe('cleanup (unmount / dependency change)', () => {
    it('does not update state after unmount', async () => {
      let resolve: (value: string) => void = () => undefined;
      const pending = new Promise<string>((r) => {
        resolve = r;
      });

      const { result, unmount } = hookFor(() => pending);

      expect(result.current.loading).toBe(true);
      unmount();

      // Resolving after unmount must not throw or set state on an unmounted hook.
      await act(async () => {
        resolve('resolved-after-unmount');
      });
      await act(async () => {});

      expect(result.current.loading).toBe(true);
      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('ignores a stale response when dependencies change mid-request', async () => {
      let resolveFirst: (value: string) => void = () => undefined;
      let resolveSecond: (value: string) => void = () => undefined;
      const first = new Promise<string>((r) => {
        resolveFirst = r;
      });
      const second = new Promise<string>((r) => {
        resolveSecond = r;
      });

      const fn = vi.fn(async (n: number) => (n === 1 ? await first : await second));
      const { result, rerender } = renderHook(
        ({ n }) => useAsync(() => fn(n), [n]),
        { initialProps: { n: 1 } }
      );

      rerender({ n: 2 });
      expect(fn).toHaveBeenCalledTimes(2);

      // Stale first request resolves last; it must be ignored.
      await act(async () => {
        resolveFirst('stale');
      });
      await act(async () => {});
      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(true);

      await act(async () => {
        resolveSecond('fresh');
      });
      await act(async () => {});
      expect(result.current.data).toBe('fresh');
      expect(result.current.loading).toBe(false);
    });

    it('stops tracking a cancelled in-flight promise without unhandled rejection', async () => {
      let resolve: (value: string) => void = () => undefined;
      const pending = new Promise<string>((r) => {
        resolve = r;
      });
      const { unmount } = hookFor(() => pending);

      unmount();

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await act(async () => {
        resolve('late');
      });
      await act(async () => {});

      const unmountedWarnings = errorSpy.mock.calls.filter(([msg]) =>
        typeof msg === 'string' && msg.includes('unmounted')
      );
      expect(unmountedWarnings).toHaveLength(0);
      errorSpy.mockRestore();
    });
  });
});
