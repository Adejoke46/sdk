/**
 * useTransactionHistory Hook
 *
 * Hook for fetching and managing transaction history with pagination support.
 * Auto-fetch failures are exposed via `error` and logged rather than raised as unhandled
 * rejections; manual calls reject with the original error.
 *
 * Dependency chain (stable callbacks → refs for mutable reads):
 * - `fetchHistory` depends only on `client` / context setters (stable identity).
 * - Pagination helpers (`goToPage`, `nextPage`, `prevPage`, `setPageSize`, `refetch`)
 *   call `fetchHistory` and read latest page/pageSize/creatorId/lastOptions via refs,
 *   so they never capture stale closures or form circular dep loops with state.
 */

import { useState, useCallback, useEffect, useRef, useDebugValue } from 'react';
import { useDorisio } from './DorisioProvider';
import { getErrorMessage, logRejection, runSafely } from './safe-async';
import { Transaction } from '../types/models';
import { formatDebugValue } from './debug-format';

export interface TransactionHistoryOptions {
  page?: number;
  pageSize?: number;
}

export interface UseTransactionHistoryState {
  transactions: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  cursor?: string;
  hasNextPage: boolean;
  loading: boolean;
  isLoadingMore: boolean;
  error?: string;
  lastUpdated?: number;
}

export interface UseTransactionHistoryActions {
  fetchHistory: (options?: TransactionHistoryOptions, creatorId?: string) => Promise<Transaction[]>;
  goToPage: (page: number) => Promise<void>;
  nextPage: () => Promise<void>;
  prevPage: () => Promise<void>;
  setPageSize: (size: number) => Promise<void>;
  refetch: () => Promise<void>;
  loadMore: () => Promise<Transaction[]>;
  reset: () => void;
}

/**
 * useTransactionHistory
 *
 * Manages transaction history with built-in pagination support.
 * Can fetch user's tip history or creator's received tips.
 *
 * @debugValue Displays `{ loading, error, transactionsCount, page, pageSize, total }` in React DevTools.
 *   - `loading` (boolean): whether a request is in flight
 *   - `error` (string | undefined): last error message, if any
 *   - `transactionsCount` (number): number of transactions on the current page
 *   - `page` (number): current page number
 *   - `pageSize` (number): items per page
 *   - `total` (number): total number of transactions available
 *
 * @example
 * ```tsx
 * function TransactionList() {
 *   const { transactions, total, page, fetchHistory, nextPage, prevPage, loading } =
 *     useTransactionHistory();
 *
 *   useEffect(() => {
 *     fetchHistory({ page: 1, pageSize: 10 });
 *   }, []);
 *
 *   return (
 *     <div>
 *       {transactions.map((tx) => (
 *         <div key={tx.id}>
 *           {tx.amount} - {tx.status}
 *         </div>
 *       ))}
 *       <button onClick={prevPage}>Previous</button>
 *       <span>Page {page}</span>
 *       <button onClick={nextPage}>Next</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useTransactionHistory(
  initialOptions?: TransactionHistoryOptions,
  autoFetch = false
): UseTransactionHistoryState & UseTransactionHistoryActions {
  const { client, setError, setIsLoading } = useDorisio();

  const [state, setState] = useState<UseTransactionHistoryState>({
    transactions: [],
    total: 0,
    page: initialOptions?.page || 1,
    pageSize: initialOptions?.pageSize || 10,
    cursor: undefined,
    hasNextPage: false,
    loading: false,
    isLoadingMore: false,
  });

  const [creatorId, setCreatorId] = useState<string | undefined>();
  const [lastOptions, setLastOptions] = useState(initialOptions);

  const isMountedRef = useRef(true);
  const abortControllersRef = useRef<Set<AbortController>>(new Set());

  useEffect(() => {
    isMountedRef.current = true;
    const controllers = abortControllersRef.current;
    return () => {
      isMountedRef.current = false;
      for (const controller of controllers) {
        controller.abort();
      }
      controllers.clear();
    };
  }, []);

  const safeSetState = useCallback(
    (fn: React.SetStateAction<UseTransactionHistoryState>) => {
      if (!isMountedRef.current) return;
      setState(fn);
    },
    []
  );

  // Refs hold latest mutable values so callbacks stay stable and never go stale.
  const stateRef = useRef(state);
  stateRef.current = state;
  const creatorIdRef = useRef(creatorId);
  creatorIdRef.current = creatorId;
  const lastOptionsRef = useRef(lastOptions);
  lastOptionsRef.current = lastOptions;

  // Issue #26: guards against the setPageSize/fetchHistory race. Every fetch
  // claims a generation number; only the latest generation may touch state,
  // and starting a new fetch aborts the previous in-flight request.
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const loadingMoreRef = useRef(false);

  // Trailing debounce for setPageSize so rapid successive calls collapse
  // into a single fetch for the latest size; all callers share the outcome.
  const pageSizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageSizePendingRef = useRef<Array<{
    resolve: () => void;
    reject: (err: unknown) => void;
  }>>([]);

  // Core page fetch shared by `fetchHistory` and `loadMore`. Handles request
  // cancellation / staleness (Issue #26) and applies a single page of results.
  // `append` appends instead of replacing. `setLoading` toggles `loading`
  // (fetchHistory yes; loadMore owns `isLoadingMore` itself).
  const fetchPage = useCallback(
    async (
      opts: { page?: number; pageSize?: number; append?: boolean },
      creator: string | undefined,
      setLoading: boolean
    ): Promise<Transaction[]> => {
      // Claim this fetch's generation up front and cancel whatever is
      // still in flight — its response (or abort error) is stale by
      // definition and must never touch state.
      const requestId = ++requestIdRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      abortControllersRef.current.add(controller);
      const isStale = () => requestId !== requestIdRef.current;

      const current = stateRef.current;
      const page = opts.page ?? current.page;
      const pageSize = opts.pageSize ?? current.pageSize;
      // Explicit `undefined` clears creator filter; omit to keep last creatorId.
      const resolvedCreator = creator !== undefined ? creator : creatorIdRef.current;
      const endpoint = resolvedCreator
        ? `/api/v1/transactions/creator/${resolvedCreator}`
        : '/api/v1/transactions/history';
      const query = `?page=${page}&pageSize=${pageSize}`;

      let response;
      try {
        response = await client.request('GET', `${endpoint}${query}`, undefined, {
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted && !isMountedRef.current) {
          throw err;
        }
        // A superseded request's failure (including its own abort) is
        // not an error — silently keep current state.
        if (isStale()) return stateRef.current.transactions;
        throw err;
      } finally {
        abortControllersRef.current.delete(controller);
      }
      if (isMountedRef.current && isStale()) return stateRef.current.transactions;

      if (!response.success || !response.data) {
        throw new Error(response.error?.message || 'Failed to fetch transaction history');
      }

      const d = response.data as {
        tips?: unknown[];
        transactions?: unknown[];
        total?: number;
        page?: number;
        pageSize?: number;
        cursor?: string;
        hasNextPage?: boolean;
      };
      const transactions = (d.tips ?? d.transactions ?? []) as Transaction[];
      const append = opts.append === true;
      setState((s) => ({
        ...s,
        transactions: append ? [...s.transactions, ...transactions] : transactions,
        total: d.total ?? (append ? s.total : 0),
        page: d.page ?? page,
        pageSize: d.pageSize ?? pageSize,
        cursor: d.cursor ?? undefined,
        hasNextPage: d.hasNextPage ?? !!d.cursor,
        ...(setLoading ? { loading: false } : {}),
        lastUpdated: Date.now(),
      }));

      const nextOptions = { page, pageSize };
      setLastOptions(nextOptions);
      lastOptionsRef.current = nextOptions;
      setCreatorId(resolvedCreator);
      creatorIdRef.current = resolvedCreator;

      return transactions;
    },
    [client]
  );

  const fetchHistory = useCallback(
    (options?: TransactionHistoryOptions, creator?: string): Promise<Transaction[]> =>
      runSafely(
        { setError, setIsLoading },
        {
          code: 'FETCH_HISTORY_ERROR',
          fallbackMessage: 'Failed to fetch history',
          onStart: () => safeSetState((s) => ({ ...s, loading: true, error: undefined })),
          onError: (error) => safeSetState((s) => ({ ...s, error, loading: false })),
          isMounted: () => isMountedRef.current,
        },
        async () => fetchPage({ page: options?.page, pageSize: options?.pageSize }, creator, true)
      ),
    [setError, setIsLoading, safeSetState, fetchPage]
  );

  /**
   * Load the next page of transactions and append it to the current list.
   * Uses the cursor stored from the previous response to signal pagination.
   * Returns the newly fetched transactions (never replaces existing ones).
   */
  const loadMore = useCallback(async (): Promise<Transaction[]> => {
    const current = stateRef.current;
    if (loadingMoreRef.current || !current.cursor || !current.hasNextPage) {
      return current.transactions;
    }
    loadingMoreRef.current = true;
    safeSetState((s) => ({ ...s, isLoadingMore: true, error: undefined }));
    try {
      return await fetchPage(
        { page: current.page + 1, pageSize: current.pageSize, append: true },
        creatorIdRef.current,
        false
      );
    } catch (err) {
      safeSetState((s) => ({
        ...s,
        error: getErrorMessage(err, 'Failed to load more transactions'),
        isLoadingMore: false,
      }));
      throw err;
    } finally {
      loadingMoreRef.current = false;
      safeSetState((s) => ({ ...s, isLoadingMore: false }));
    }
  }, [fetchPage, safeSetState]);

  const goToPage = useCallback(
    async (page: number): Promise<void> => {
      if (page < 1) return;
      await fetchHistory({ page, pageSize: stateRef.current.pageSize }, creatorIdRef.current);
    },
    [fetchHistory]
  );

  const nextPage = useCallback(async (): Promise<void> => {
    const { page, pageSize, total } = stateRef.current;
    const hasMore = page * pageSize < total;
    if (hasMore) {
      await goToPage(page + 1);
    }
  }, [goToPage]);

  const prevPage = useCallback(async (): Promise<void> => {
    const { page } = stateRef.current;
    if (page > 1) {
      await goToPage(page - 1);
    }
  }, [goToPage]);

  const SET_PAGE_SIZE_DEBOUNCE_MS = 150;

  const setPageSize = useCallback(
    async (size: number): Promise<void> => {
      if (!(size > 0 && size <= 100)) return;
      // Page-size changes always reset to page 1 and keep the current creator.
      // Rapid calls collapse: only the latest size fetches, every caller
      // shares its outcome.
      return new Promise<void>((resolve, reject) => {
        pageSizePendingRef.current.push({ resolve, reject });
        if (pageSizeTimerRef.current) clearTimeout(pageSizeTimerRef.current);
        pageSizeTimerRef.current = setTimeout(() => {
          pageSizeTimerRef.current = null;
          const pending = pageSizePendingRef.current;
          pageSizePendingRef.current = [];
          fetchHistory({ page: 1, pageSize: size }, creatorIdRef.current).then(
            () => pending.forEach((p) => p.resolve()),
            (err: unknown) => pending.forEach((p) => p.reject(err))
          );
        }, SET_PAGE_SIZE_DEBOUNCE_MS);
      });
    },
    [fetchHistory]
  );

  const refetch = useCallback(async (): Promise<void> => {
    await fetchHistory(lastOptionsRef.current, creatorIdRef.current);
  }, [fetchHistory]);

  const reset = useCallback((): void => {
    const initial: UseTransactionHistoryState = {
      transactions: [],
      total: 0,
      page: 1,
      pageSize: 10,
      cursor: undefined,
      hasNextPage: false,
      loading: false,
      isLoadingMore: false,
    };
    safeSetState(initial);
    stateRef.current = initial;
    if (isMountedRef.current) {
      setCreatorId(undefined);
      setLastOptions(undefined);
    }
    creatorIdRef.current = undefined;
    lastOptionsRef.current = undefined;
    loadingMoreRef.current = false;
  }, [safeSetState]);

  const initialPage = initialOptions?.page;
  const initialPageSize = initialOptions?.pageSize;

  // Depend on scalar options so callers may safely pass a fresh options object.
  useEffect(() => {
    if (autoFetch) {
      // Error is already reflected in hook state; just make sure it can't go unhandled.
      logRejection(fetchHistory({ page: initialPage, pageSize: initialPageSize }), 'useTransactionHistory auto-fetch');
    }
  }, [autoFetch, fetchHistory, initialPage, initialPageSize]);

  // Tear down in-flight work on unmount: no debounced fetch or late
  // response may touch state after this hook is gone.
  useEffect(
    () => () => {
      if (pageSizeTimerRef.current) clearTimeout(pageSizeTimerRef.current);
      pageSizePendingRef.current = [];
      abortRef.current?.abort();
      requestIdRef.current += 1;
    },
    []
  );

  useDebugValue(
    formatDebugValue({
      loading: state.loading,
      error: state.error,
      transactionsCount: state.transactions.length,
      page: state.page,
      pageSize: state.pageSize,
      total: state.total,
    })
  );

  return {
    ...state,
    fetchHistory,
    goToPage,
    nextPage,
    prevPage,
    setPageSize,
    refetch,
    loadMore,
    reset,
  };
}
