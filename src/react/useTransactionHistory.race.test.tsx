// @vitest-environment jsdom
/**
 * Issue #26: rapid page-size / fetch succession must not corrupt state.
 *
 * Renders the real `useTransactionHistory` inside the real DorisioProvider
 * with a deferred mock transport, so out-of-order resolutions, aborts and
 * the setPageSize debounce are exercised end to end.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { DorisioProvider } from './DorisioProvider';
import { useTransactionHistory } from './useTransactionHistory';

type Deferred = {
  promise: Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};

function deferred(): Deferred {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function pageData(pageSize: number, tag: string) {
  return {
    success: true,
    data: {
      transactions: [{ id: `tx-${tag}`, amount: 1, status: 'confirmed' }],
      total: 100,
      page: 1,
      pageSize,
    },
  };
}

type CallEntry = { url: string; signal?: AbortSignal; deferred: Deferred };

function makeClient(autoAbort = true) {
  const calls: CallEntry[] = [];
  const request = vi.fn((method: string, url: string, body?: unknown, opts?: { signal?: AbortSignal }) => {
    const d = deferred();
    if (autoAbort) {
      opts?.signal?.addEventListener('abort', () => {
        d.reject(new DOMException('Aborted', 'AbortError'));
      });
    }
    calls.push({ url, signal: opts?.signal, deferred: d });
    return d.promise;
  });
  const client = {
    createTip: vi.fn(),
    buildPaymentTransaction: vi.fn(),
    submitPaymentTransaction: vi.fn(),
    checkTransactionConfirmation: vi.fn(),
    request,
    setToken: vi.fn(),
    clearToken: vi.fn(),
  };
  return { client, calls };
}

function wrapperFor(client: ReturnType<typeof makeClient>['client']) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <DorisioProvider client={client as never} config={{} as never}>
        {children}
      </DorisioProvider>
    );
  };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useTransactionHistory race guard (#26)', () => {
  it('does not refetch continuously when auto-fetch receives a fresh options object', async () => {
    const { client, calls } = makeClient(false);
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useTransactionHistory({ page: 1, pageSize: 10 }, true);
    }, {
      wrapper: wrapperFor(client),
    });

    expect(calls).toHaveLength(1);
    const initialCall = calls.at(0);
    if (!initialCall) throw new Error('Expected the auto-fetch request');
    await act(async () => {
      initialCall.deferred.resolve(pageData(10, 'initial'));
      await Promise.resolve();
    });

    expect(result.current.transactions[0]?.id).toBe('tx-initial');
    expect(calls).toHaveLength(1);
    expect(renderCount).toBeLessThan(5);
  });

  it('uses the latest response when two fetches resolve out of order', async () => {
    // No auto-abort here so the stale request can resolve late like a slow
    // server beating a fast one — the generation guard must still ignore it.
    const { client, calls } = makeClient(false);
    const { result } = renderHook(() => useTransactionHistory(), {
      wrapper: wrapperFor(client),
    });

    let p1!: Promise<unknown>;
    let p2!: Promise<unknown>;
    act(() => {
      p1 = result.current.fetchHistory({ page: 1, pageSize: 10 });
      p2 = result.current.fetchHistory({ page: 1, pageSize: 30 });
    });
    expect(calls).toHaveLength(2);

    // Newest resolves first…
    const [staleCall, newestCall] = calls as [CallEntry, CallEntry];
    await act(async () => {
      newestCall.deferred.resolve(pageData(30, 'new'));
      await p2;
    });
    expect(result.current.pageSize).toBe(30);
    expect(result.current.transactions[0]?.id).toBe('tx-new');

    // …stale resolves late and must be ignored.
    await act(async () => {
      staleCall.deferred.resolve(pageData(10, 'stale'));
      await p1;
    });
    expect(result.current.pageSize).toBe(30);
    expect(result.current.transactions[0]?.id).toBe('tx-new');
    expect(result.current.error).toBeUndefined();
  });

  it('aborts the previous request and swallows its abort error', async () => {
    const { client, calls } = makeClient(true);
    const { result } = renderHook(() => useTransactionHistory(), {
      wrapper: wrapperFor(client),
    });

    let p1!: Promise<unknown>;
    let p2!: Promise<unknown>;
    act(() => {
      p1 = result.current.fetchHistory({ page: 1, pageSize: 10 });
      p2 = result.current.fetchHistory({ page: 1, pageSize: 20 });
    });

    // Starting the second fetch must cancel the first.
    const [firstCall, secondCall] = calls as [CallEntry, CallEntry];
    expect(firstCall.signal?.aborted).toBe(true);
    expect(secondCall.signal?.aborted).toBe(false);

    await act(async () => {
      secondCall.deferred.resolve(pageData(20, 'second'));
      await p2;
      await p1;
    });
    expect(result.current.pageSize).toBe(20);
    expect(result.current.error).toBeUndefined();
  });

  it('aborts the in-flight auto-fetch request when the options change', async () => {
    const { client, calls } = makeClient(true);
    const { rerender } = renderHook(
      ({ pageSize }: { pageSize: number }) => useTransactionHistory({ page: 1, pageSize }, true),
      { initialProps: { pageSize: 10 }, wrapper: wrapperFor(client) }
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal?.aborted).toBe(false);

    rerender({ pageSize: 20 });
    await act(async () => {
      await Promise.resolve();
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(calls[1]?.signal?.aborted).toBe(false);
  });

  it('collapses rapid setPageSize calls into one fetch for the latest size', async () => {
    vi.useFakeTimers();
    const { client, calls } = makeClient(true);
    const { result } = renderHook(() => useTransactionHistory(), {
      wrapper: wrapperFor(client),
    });

    let s1!: Promise<void>;
    let s2!: Promise<void>;
    let s3!: Promise<void>;
    act(() => {
      s1 = result.current.setPageSize(10);
      s2 = result.current.setPageSize(20);
      s3 = result.current.setPageSize(30);
    });
    expect(calls).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(calls).toHaveLength(1);
    const [onlyCall] = calls as [CallEntry];
    expect(onlyCall.url).toContain('pageSize=30');

    await act(async () => {
      onlyCall.deferred.resolve(pageData(30, 'debounced'));
      await Promise.all([s1, s2, s3]);
    });
    expect(result.current.pageSize).toBe(30);
    expect(result.current.page).toBe(1);
    expect(result.current.transactions[0]?.id).toBe('tx-debounced');
    expect(result.current.error).toBeUndefined();
  });
});
