// @vitest-environment jsdom
/**
 * useTransactionHistory Hook Tests
 *
 * Cursor-based pagination: `loadMore`, `cursor`, `hasNextPage`, `isLoadingMore`.
 * Renders the real hook inside the real DorisioProvider with a mock transport.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { DorisioProvider } from './DorisioProvider';
import { useTransactionHistory } from './useTransactionHistory';

type MockClient = {
  request: any;
  setToken: any;
  clearToken: any;
};

function makeClient(): MockClient {
  return {
    request: vi.fn(),
    setToken: vi.fn(),
    clearToken: vi.fn(),
  } as unknown as MockClient;
}

function wrapperFor(client: MockClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(DorisioProvider, {
      client: client as never,
      config: {} as never,
      children,
    });
  };
}

function page(
  transactions: any[],
  total: number,
  page: number,
  pageSize: number,
  cursor?: string,
  hasNextPage?: boolean
) {
  return {
    success: true,
    data: {
      transactions,
      total,
      page,
      pageSize,
      ...(cursor !== undefined ? { cursor } : {}),
      ...(hasNextPage !== undefined ? { hasNextPage } : {}),
    },
  };
}

describe('useTransactionHistory cursor pagination', () => {
  let client: MockClient;

  beforeEach(() => {
    client = makeClient();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('exposes pagination helpers with empty initial state', () => {
      const { result } = renderHook(() => useTransactionHistory({ page: 1, pageSize: 20 }), {
        wrapper: wrapperFor(client),
      });

      expect(result.current.transactions).toEqual([]);
      expect(result.current.cursor).toBeUndefined();
      expect(result.current.hasNextPage).toBe(false);
      expect(result.current.isLoadingMore).toBe(false);
      expect(result.current.loading).toBe(false);
      expect(typeof result.current.loadMore).toBe('function');
      expect(client.request).not.toHaveBeenCalled();
    });

    it('loadMore with no cursor is a no-op and makes no request', async () => {
      const { result } = renderHook(() => useTransactionHistory(), {
        wrapper: wrapperFor(client),
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(client.request).not.toHaveBeenCalled();
      expect(result.current.transactions).toEqual([]);
      expect(result.current.isLoadingMore).toBe(false);
      expect(result.current.hasNextPage).toBe(false);
    });
  });

  describe('pagination flow', () => {
    it('loadMore appends the next page instead of replacing transactions', async () => {
      client.request
        .mockResolvedValueOnce(page([{ id: 'a', amount: 10 }], 100, 1, 20, 'cursor-1'))
        .mockResolvedValueOnce(page([{ id: 'b', amount: 20 }], 100, 2, 20, 'cursor-2'));

      const { result } = renderHook(() => useTransactionHistory({ page: 1, pageSize: 20 }), {
        wrapper: wrapperFor(client),
      });

      await act(async () => {
        await result.current.fetchHistory({ page: 1, pageSize: 20 });
      });
      expect(result.current.transactions).toEqual([{ id: 'a', amount: 10 }]);

      await act(async () => {
        await result.current.loadMore();
      });

      expect(result.current.transactions).toEqual([
        { id: 'a', amount: 10 },
        { id: 'b', amount: 20 },
      ]);
      expect(result.current.cursor).toBe('cursor-2');
      expect(result.current.hasNextPage).toBe(true);
      expect(client.request).toHaveBeenLastCalledWith(
        'GET',
        expect.stringContaining('/api/v1/transactions/history?page=2&pageSize=20'),
        undefined,
        expect.anything()
      );
    });

    it('cursor is stored from the API response after each page', async () => {
      client.request
        .mockResolvedValueOnce(page([{ id: 'a' }], 100, 1, 20, 'cursor-1'))
        .mockResolvedValueOnce(page([{ id: 'b' }], 100, 2, 20, 'cursor-2'))
        .mockResolvedValueOnce(page([{ id: 'c' }], 100, 3, 20, undefined));

      const { result } = renderHook(() => useTransactionHistory({ page: 1, pageSize: 20 }), {
        wrapper: wrapperFor(client),
      });

      await act(async () => {
        await result.current.fetchHistory({ page: 1, pageSize: 20 });
      });
      expect(result.current.cursor).toBe('cursor-1');

      await act(async () => {
        await result.current.loadMore();
      });
      expect(result.current.cursor).toBe('cursor-2');

      await act(async () => {
        await result.current.loadMore();
      });
      expect(result.current.cursor).toBeUndefined();
    });

    it('hasNextPage is true while a cursor is present and false on the last page', async () => {
      client.request
        .mockResolvedValueOnce(page([{ id: 'a' }], 100, 1, 20, 'cursor-1'))
        .mockResolvedValueOnce(page([{ id: 'b' }], 100, 2, 20, undefined));

      const { result } = renderHook(() => useTransactionHistory({ page: 1, pageSize: 20 }), {
        wrapper: wrapperFor(client),
      });

      await act(async () => {
        await result.current.fetchHistory({ page: 1, pageSize: 20 });
      });
      expect(result.current.hasNextPage).toBe(true);

      await act(async () => {
        await result.current.loadMore();
      });
      expect(result.current.hasNextPage).toBe(false);
      // No cursor means further loadMore calls are no-ops.
      await act(async () => {
        await result.current.loadMore();
      });
      expect(client.request).toHaveBeenCalledTimes(2);
      expect(result.current.transactions).toHaveLength(2);
    });

    it('hasNextPage respects the explicit API hasNextPage signal over cursor presence', async () => {
      client.request.mockResolvedValueOnce(
        page([{ id: 'a' }], 100, 1, 20, 'cursor-1', false)
      );

      const { result } = renderHook(() => useTransactionHistory({ page: 1, pageSize: 20 }), {
        wrapper: wrapperFor(client),
      });

      await act(async () => {
        await result.current.fetchHistory({ page: 1, pageSize: 20 });
      });

      // Cursor present but API said no more pages.
      expect(result.current.hasNextPage).toBe(false);
      expect(result.current.cursor).toBe('cursor-1');

      // loadMore must not fetch when hasNextPage is false.
      await act(async () => {
        await result.current.loadMore();
      });
      expect(client.request).toHaveBeenCalledTimes(1);
      expect(result.current.transactions).toHaveLength(1);
    });

    it('loadMore does not replace existing transactions (append only)', async () => {
      client.request
        .mockResolvedValueOnce(page([{ id: 'a' }], 100, 1, 20, 'cursor-1'))
        .mockResolvedValueOnce(page([], 100, 2, 20, undefined));

      const { result } = renderHook(() => useTransactionHistory({ page: 1, pageSize: 20 }), {
        wrapper: wrapperFor(client),
      });

      await act(async () => {
        await result.current.fetchHistory({ page: 1, pageSize: 20 });
      });
      await act(async () => {
        await result.current.loadMore();
      });

      // Empty second page must not wipe the first page.
      expect(result.current.transactions).toEqual([{ id: 'a' }]);
      expect(result.current.transactions).toHaveLength(1);
    });

    it('does not append duplicate transactions across multiple loadMore calls', async () => {
      client.request
        .mockResolvedValueOnce(page([{ id: 'a' }], 100, 1, 20, 'cursor-1'))
        .mockResolvedValueOnce(page([{ id: 'b' }], 100, 2, 20, 'cursor-2'))
        .mockResolvedValueOnce(page([{ id: 'c' }], 100, 3, 20, undefined));

      const { result } = renderHook(() => useTransactionHistory({ page: 1, pageSize: 20 }), {
        wrapper: wrapperFor(client),
      });

      await act(async () => {
        await result.current.fetchHistory({ page: 1, pageSize: 20 });
      });
      await act(async () => {
        await result.current.loadMore();
      });
      await act(async () => {
        await result.current.loadMore();
      });

      const ids = result.current.transactions.map((t: any) => t.id);
      expect(ids).toEqual(['a', 'b', 'c']);
      expect(new Set(ids).size).toBe(ids.length);
      expect(result.current.hasNextPage).toBe(false);
    });

    it('loadMore ignores concurrent calls while one is already in flight', async () => {
      client.request
        .mockResolvedValueOnce(page([{ id: 'a' }], 100, 1, 20, 'cursor-1'));

      const { result } = renderHook(() => useTransactionHistory({ page: 1, pageSize: 20 }), {
        wrapper: wrapperFor(client),
      });

      await act(async () => {
        await result.current.fetchHistory({ page: 1, pageSize: 20 });
      });

      let resolvePage2: ((v: unknown) => void) | undefined;
      client.request.mockImplementation(() => new Promise((resolve) => { resolvePage2 = resolve; }));

      await act(async () => {
        const first = result.current.loadMore();
        const second = result.current.loadMore();
        // The synchronous `isLoadingMore` flag lags behind `loadingMoreRef`; the
        // guard is what matters here – the second call must not issue a request.
        const resolver = resolvePage2;
        if (!resolver) throw new Error('resolver not set');
        resolver(page([{ id: 'b' }], 100, 2, 20, undefined));
        await first;
        await second;
      });

      expect(result.current.isLoadingMore).toBe(false);
      expect(result.current.transactions).toEqual([{ id: 'a' }, { id: 'b' }]);
      expect(client.request).toHaveBeenCalledTimes(2);
    });

    it('sets isLoadingMore during a loadMore flight and clears it after', async () => {
      client.request
        .mockResolvedValueOnce(page([{ id: 'a' }], 100, 1, 20, 'cursor-1'));

      let resolvePage2: ((v: unknown) => void) | undefined;
      client.request.mockImplementation(() => new Promise((resolve) => { resolvePage2 = resolve; }));

      const { result } = renderHook(() => useTransactionHistory({ page: 1, pageSize: 20 }), {
        wrapper: wrapperFor(client),
      });

      await act(async () => {
        await result.current.fetchHistory({ page: 1, pageSize: 20 });
      });

      await act(async () => {
        result.current.loadMore();
      });
      // isLoadingMore should be observable while the flight is pending.
      expect(result.current.isLoadingMore).toBe(true);

      const resolver = resolvePage2;
      if (!resolver) throw new Error('resolver not set');
      await act(async () => {
        resolver(page([{ id: 'b' }], 100, 2, 20, undefined));
      });

      expect(result.current.isLoadingMore).toBe(false);
      expect(result.current.transactions).toEqual([{ id: 'a' }, { id: 'b' }]);
    });

    it('loadMore returns the newly fetched transactions', async () => {
      client.request
        .mockResolvedValueOnce(page([{ id: 'a' }], 100, 1, 20, 'cursor-1'))
        .mockResolvedValueOnce(page([{ id: 'b', amount: 7 }], 100, 2, 20, undefined));

      const { result } = renderHook(() => useTransactionHistory({ page: 1, pageSize: 20 }), {
        wrapper: wrapperFor(client),
      });

      await act(async () => {
        await result.current.fetchHistory({ page: 1, pageSize: 20 });
      });

      const appended = await act(async () => {
        return await result.current.loadMore();
      });

      expect(appended).toEqual([{ id: 'b', amount: 7 }]);
      expect(result.current.transactions).toEqual([{ id: 'a' }, { id: 'b', amount: 7 }]);
    });
  });

  describe('empty results', () => {
    it('empty first page yields no cursor and hasNextPage false', async () => {
      client.request.mockResolvedValueOnce(page([], 0, 1, 20, undefined));

      const { result } = renderHook(() => useTransactionHistory({ page: 1, pageSize: 20 }), {
        wrapper: wrapperFor(client),
      });

      await act(async () => {
        await result.current.fetchHistory({ page: 1, pageSize: 20 });
      });

      expect(result.current.transactions).toEqual([]);
      expect(result.current.total).toBe(0);
      expect(result.current.cursor).toBeUndefined();
      expect(result.current.hasNextPage).toBe(false);

      await act(async () => {
        await result.current.loadMore();
      });
      expect(client.request).toHaveBeenCalledTimes(1);
      expect(result.current.transactions).toEqual([]);
    });

    it('loadMore on an empty cursor does not request or duplicate', async () => {
      client.request.mockResolvedValueOnce(page([{ id: 'a' }], 100, 1, 20, 'cursor-1'));

      const { result } = renderHook(() => useTransactionHistory({ page: 1, pageSize: 20 }), {
        wrapper: wrapperFor(client),
      });

      await act(async () => {
        await result.current.fetchHistory({ page: 1, pageSize: 20 });
        await result.current.loadMore();
      });

      expect(result.current.transactions).toEqual([{ id: 'a' }]);
      expect(client.request).toHaveBeenCalledTimes(1);
    });

    it('fetchHistory replaces (does not append) so loadMore is the only append path', async () => {
      client.request
        .mockResolvedValueOnce(page([{ id: 'a' }], 100, 1, 20, 'cursor-1'))
        .mockResolvedValueOnce(page([{ id: 'b' }], 100, 1, 20, undefined));

      const { result } = renderHook(() => useTransactionHistory({ page: 1, pageSize: 20 }), {
        wrapper: wrapperFor(client),
      });

      await act(async () => {
        await result.current.fetchHistory({ page: 1, pageSize: 20 });
        await result.current.fetchHistory({ page: 1, pageSize: 20 });
      });

      expect(result.current.transactions).toEqual([{ id: 'b' }]);
      expect(result.current.transactions).toHaveLength(1);
      expect(result.current.cursor).toBeUndefined();
      expect(result.current.hasNextPage).toBe(false);
    });

    it('reset clears transactions, cursor, hasNextPage and isLoadingMore', async () => {
      client.request
        .mockResolvedValueOnce(page([{ id: 'a' }], 100, 1, 20, 'cursor-1'))
        .mockResolvedValueOnce(page([{ id: 'b' }], 100, 2, 20, undefined));

      const { result } = renderHook(() => useTransactionHistory({ page: 1, pageSize: 20 }), {
        wrapper: wrapperFor(client),
      });

      await act(async () => {
        await result.current.fetchHistory({ page: 1, pageSize: 20 });
      });
      await act(async () => {
        await result.current.loadMore();
      });
      expect(result.current.transactions).toHaveLength(2);
      expect(result.current.hasNextPage).toBe(false);

      act(() => {
        result.current.reset();
      });

      expect(result.current.transactions).toEqual([]);
      expect(result.current.total).toBe(0);
      expect(result.current.page).toBe(1);
      expect(result.current.cursor).toBeUndefined();
      expect(result.current.hasNextPage).toBe(false);
      expect(result.current.isLoadingMore).toBe(false);
    });
  });
});
