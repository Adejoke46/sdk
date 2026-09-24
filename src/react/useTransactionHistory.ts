/**
 * useTransactionHistory Hook
 *
 * Hook for fetching and managing transaction history with pagination support.
 *
 * Dependency chain (stable callbacks → refs for mutable reads):
 * - `fetchHistory` depends only on `client` / context setters (stable identity).
 * - Pagination helpers (`goToPage`, `nextPage`, `prevPage`, `setPageSize`, `refetch`)
 *   call `fetchHistory` and read latest page/pageSize/creatorId/lastOptions via refs,
 *   so they never capture stale closures or form circular dep loops with state.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useDorisio } from './DorisioProvider';
import { Transaction } from '../types/models';

export interface TransactionHistoryOptions {
  page?: number;
  pageSize?: number;
}

export interface UseTransactionHistoryState {
  transactions: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
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
  reset: () => void;
}

/**
 * useTransactionHistory
 *
 * Manages transaction history with built-in pagination support.
 * Can fetch user's tip history or creator's received tips.
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
    loading: false,
  });

  const [creatorId, setCreatorId] = useState<string | undefined>();
  const [lastOptions, setLastOptions] = useState(initialOptions);

  // Refs hold latest mutable values so callbacks stay stable and never go stale.
  const stateRef = useRef(state);
  stateRef.current = state;
  const creatorIdRef = useRef(creatorId);
  creatorIdRef.current = creatorId;
  const lastOptionsRef = useRef(lastOptions);
  lastOptionsRef.current = lastOptions;

  const fetchHistory = useCallback(
    async (options?: TransactionHistoryOptions, creator?: string): Promise<Transaction[]> => {
      try {
        setState((s) => ({ ...s, loading: true, error: undefined }));
        setIsLoading(true);

        const current = stateRef.current;
        const page = options?.page ?? current.page;
        const pageSize = options?.pageSize ?? current.pageSize;
        // Explicit `undefined` clears creator filter; omit to keep last creatorId.
        const resolvedCreator = creator !== undefined ? creator : creatorIdRef.current;
        const endpoint = resolvedCreator
          ? `/api/v1/transactions/creator/${resolvedCreator}`
          : '/api/v1/transactions/history';
        const query = `?page=${page}&pageSize=${pageSize}`;

        const response = await client.request('GET', `${endpoint}${query}`);

        if (!response.success || !response.data) {
          throw new Error(response.error?.message || 'Failed to fetch transaction history');
        }

        setState((s) => {
          const d = response.data as any;
          return {
            ...s,
            transactions: d.tips || [],
            total: d.total || 0,
            page: d.page || page,
            pageSize: d.pageSize || pageSize,
            lastUpdated: Date.now(),
            loading: false,
          };
        });

        const nextOptions = { page, pageSize };
        setLastOptions(nextOptions);
        lastOptionsRef.current = nextOptions;
        setCreatorId(resolvedCreator);
        creatorIdRef.current = resolvedCreator;

        return (response.data as any).tips || [];
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Failed to fetch history';
        setState((s) => ({ ...s, error, loading: false }));
        setError({ message: error, code: 'FETCH_HISTORY_ERROR' });
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [client, setError, setIsLoading]
  );

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

  const setPageSize = useCallback(
    async (size: number): Promise<void> => {
      if (size > 0 && size <= 100) {
        // Page-size changes always reset to page 1 and keep the current creator.
        await fetchHistory({ page: 1, pageSize: size }, creatorIdRef.current);
      }
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
      loading: false,
    };
    setState(initial);
    stateRef.current = initial;
    setCreatorId(undefined);
    creatorIdRef.current = undefined;
    setLastOptions(undefined);
    lastOptionsRef.current = undefined;
  }, []);

  // Auto-fetch on mount
  useEffect(() => {
    if (autoFetch) {
      void fetchHistory(initialOptions);
    }
    // Intentionally mount-only; callers can refetch when inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only autoFetch
  }, []);

  return {
    ...state,
    fetchHistory,
    goToPage,
    nextPage,
    prevPage,
    setPageSize,
    refetch,
    reset,
  };
}
