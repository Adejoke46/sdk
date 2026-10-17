/**
 * useWallet Hook
 *
 * Hook for wallet management with challenge-response verification flow.
 * Handles wallet linking, verification, and unlinking.
 *
 * Dependency chain:
 * - All async actions depend only on stable `client` / context setters.
 * - Mutable challenge/nonce/wallet list state is updated via functional
 *   `setState` and mirrored in `stateRef` so helpers never read a stale snapshot.
 */

import { useState, useCallback, useRef, useEffect, useDebugValue } from 'react';
import { useDorisio } from './DorisioProvider';
import { Wallet } from '../types/models';
import { runSafely } from './safe-async';
import { formatDebugValue } from './debug-format';

export interface UseWalletState {
  wallets: Wallet[];
  selectedWallet?: Wallet;
  loading: boolean;
  error?: string;
  nonce?: string;
  challengeStep:
    'idle' | 'nonce-generated' | 'challenge-ready' | 'verifying' | 'verified' | 'error';
  balances: Record<string, { available: number; pending: number; total: number }>;
  lastRealtimeUpdate?: number;
}

export interface UseWalletActions {
  generateNonce: (publicKey: string) => Promise<{ nonce: string; expiresIn: number }>;
  getChallenge: (nonce: string) => Promise<string>;
  verifyWallet: (publicKey: string, nonce: string, signedTransaction: string) => Promise<Wallet>;
  listWallets: (includeBalance?: boolean) => Wallet[] | null | Promise<Wallet[] | null>;
  selectWallet: (wallet: Wallet) => void;
  unlinkWallet: (walletId: string) => Promise<void>;
  renameWallet: (walletId: string, name: string) => Promise<Wallet>;
  getBalance: (
    walletId: string
  ) =>
    | { available: number; pending: number; total: number }
    | null
    | Promise<{ available: number; pending: number; total: number } | null>;
  reset: () => void;
}

export interface UseWalletOptions {
  useSuspense?: boolean;
}

interface ListWalletsSuspenseEntry {
  data: Wallet[] | null;
  promise: Promise<Wallet[] | null>;
  resolved: boolean;
}

interface GetBalanceSuspenseEntry {
  data: { available: number; pending: number; total: number } | null;
  promise: Promise<{ available: number; pending: number; total: number } | null>;
  resolved: boolean;
}

const listWalletsSuspenseCache = new Map<string, ListWalletsSuspenseEntry>();
const getBalanceSuspenseCache = new Map<string, GetBalanceSuspenseEntry>();

/**
 * Hook for managing user wallets, challenge-response verification with Stellar/Freighter,
 * and fetching wallet balances.
 *
 * @returns State and action handlers for wallet management
 *
 * @debugValue Displays `{ loading, error, challengeStep, walletsCount, selectedWallet }` in React DevTools.
 *   - `loading` (boolean): whether a request is in flight
 *   - `error` (string | undefined): last error message, if any
 *   - `challengeStep` (string): current challenge-response flow step
 *   - `walletsCount` (number): number of linked wallets
 *   - `selectedWallet` (string | undefined): public key of the selected wallet, if any
 *
 * @example
 * ```tsx
 * import { useWallet } from 'dorisio-sdk/react';
 *
 * function WalletManager() {
 *   const { wallets, loading, error, listWallets, unlinkWallet } = useWallet();
 *
 *   useEffect(() => {
 *     listWallets();
 *   }, [listWallets]);
 *
 *   return (
 *     <div>
 *       {loading && <p>Loading wallets...</p>}
 *       {error && <p className="error">{error}</p>}
 *       {wallets.map((w) => (
 *         <div key={w.id}>
 *           <span>{w.publicKey}</span>
 *           <button onClick={() => unlinkWallet(w.id)}>Unlink</button>
 *         </div>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export { listWalletsSuspenseCache, getBalanceSuspenseCache };

export function useWallet(options: UseWalletOptions = {}): UseWalletState & UseWalletActions {
  const { useSuspense = false } = options;
  const { client, setError, setIsLoading } = useDorisio();
  const { realtime = false } = options;

  const [state, setState] = useState<UseWalletState>({
    wallets: [],
    loading: false,
    challengeStep: 'idle',
    balances: {},
  });

  const isMountedRef = useRef(true);
  const abortControllersRef = useRef<Set<AbortController>>(new Set());
  const realtimeSubscriptionRef = useRef<(() => void) | null>(null);

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

  const stateRef = useRef(state);
  stateRef.current = state;

  // Functional update that also mirrors the result into stateRef, so helpers never read a stale snapshot.
  const update = useCallback((fn: (s: UseWalletState) => UseWalletState): void => {
    if (!isMountedRef.current) return;
    setState((s) => {
      const next = fn(s);
      stateRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (!realtime) {
      const unsubscribe = realtimeSubscriptionRef.current;
      realtimeSubscriptionRef.current = null;
      if (unsubscribe) unsubscribe();
      return;
    }

    let mounted = true;

    const setup = async (): Promise<void> => {
      try {
        if (!client.getRealtime()) {
          await client.enableRealtime();
        }
      } catch {
        return;
      }
      if (!mounted) return;

      const unsubscribe = client.subscribeRealtime<WalletBalanceEvent>('balance', (event) => {
        if (!isMountedRef.current || !mounted) return;
        const { walletId, publicKey, balance, timestamp } = event.data;
        update((s) => {
          const nextWallets = s.wallets.map((w) => {
            const matches =
              (walletId && w.id === walletId) || (publicKey && w.publicKey === publicKey);
            if (!matches) return w;
            return { ...w, balance };
          });
          const nextBalances = { ...s.balances };
          if (walletId) nextBalances[walletId] = balance;
          return {
            ...s,
            wallets: nextWallets,
            balances: nextBalances,
            lastRealtimeUpdate: timestamp ?? Date.now(),
          };
        });
      });
      realtimeSubscriptionRef.current = unsubscribe;
    };

    setup();

    return () => {
      mounted = false;
      const unsubscribe = realtimeSubscriptionRef.current;
      realtimeSubscriptionRef.current = null;
      if (unsubscribe) unsubscribe();
    };
  }, [realtime, client, update]);

  const withAbort = <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    abortControllersRef.current.add(controller);
    return fn(controller.signal).finally(() => {
      abortControllersRef.current.delete(controller);
    });
  };

  const begin = useCallback(
    (extra: Partial<UseWalletState> = {}) =>
      () => update((s) => ({ ...s, loading: true, error: undefined, ...extra })),
    [update]
  );
  // Steps of the challenge flow also surface the failure in `challengeStep`.
  const failStep = useCallback(
    (error: string) => update((s) => ({ ...s, error, challengeStep: 'error', loading: false })),
    [update]
  );
  const fail = useCallback(
    (error: string) => update((s) => ({ ...s, error, loading: false })),
    [update]
  );

  const generateNonce = useCallback(
    (publicKey: string): Promise<{ nonce: string; expiresIn: number }> =>
      runSafely(
        { setError, setIsLoading },
        {
          code: 'NONCE_GENERATION_ERROR',
          fallbackMessage: 'Failed to generate nonce',
          onStart: begin(),
          onError: failStep,
          isMounted: () => isMountedRef.current,
        },
        () =>
          withAbort(async (signal) => {
            const response = await client.request<any>(
              'POST',
              '/api/v1/wallet/nonce',
              {
                publicKey,
              },
              { signal }
            );

            if (!response.success || !response.data) {
              throw new Error(response.error?.message || 'Failed to generate nonce');
            }

            const data = response.data;
            update((s) => ({
              ...s,
              nonce: data.nonce as string,
              challengeStep: 'nonce-generated',
              loading: false,
            }));

            return { nonce: data.nonce, expiresIn: data.expiresIn || 300 };
          })
      ),
    [client, setError, setIsLoading, begin, failStep, update]
  );

  const getChallenge = useCallback(
    (nonce: string): Promise<string> =>
      runSafely(
        { setError, setIsLoading },
        {
          code: 'CHALLENGE_ERROR',
          fallbackMessage: 'Failed to get challenge',
          onStart: begin(),
          onError: failStep,
          isMounted: () => isMountedRef.current,
        },
        () =>
          withAbort(async (signal) => {
            // Prefer explicit arg; fall back to latest generated nonce from ref.
            const resolvedNonce = nonce || stateRef.current.nonce;
            if (!resolvedNonce) {
              throw new Error('No nonce available for challenge');
            }

            const response = await client.request<any>(
              'GET',
              `/api/v1/wallet/challenge/${resolvedNonce}`,
              undefined,
              { signal }
            );

            if (!response.success || !response.data) {
              throw new Error(response.error?.message || 'Failed to get challenge');
            }

            const data = response.data;
            update((s) => ({ ...s, challengeStep: 'challenge-ready', loading: false }));

            return data.challenge || data;
          })
      ),
    [client, setError, setIsLoading, begin, failStep, update]
  );

  const verifyWallet = useCallback(
    (publicKey: string, nonce: string, signedTransaction: string): Promise<Wallet> =>
      runSafely(
        { setError, setIsLoading },
        {
          code: 'WALLET_VERIFICATION_ERROR',
          fallbackMessage: 'Failed to verify wallet',
          onStart: begin({ challengeStep: 'verifying' }),
          onError: failStep,
          isMounted: () => isMountedRef.current,
        },
        () =>
          withAbort(async (signal) => {
            const response = await client.request<Wallet>(
              'POST',
              '/api/v1/wallet/verify',
              {
                publicKey,
                nonce,
                signedTransaction,
              },
              { signal }
            );

            if (!response.success || !response.data) {
              throw new Error(response.error?.message || 'Failed to verify wallet');
            }

            const wallet = response.data;

            update((s) => ({
              ...s,
              wallets: [...s.wallets, wallet],
              selectedWallet: wallet,
              challengeStep: 'verified',
              loading: false,
              nonce: undefined,
            }));

            return wallet;
          })
      ),
    [client, setError, setIsLoading, begin, failStep, update]
  );

  const listWalletsTask = useCallback(
    (includeBalance: boolean): Promise<Wallet[]> =>
      runSafely(
        { setError, setIsLoading },
        {
          code: 'LIST_WALLETS_ERROR',
          fallbackMessage: 'Failed to list wallets',
          onStart: begin(),
          onError: fail,
          isMounted: () => isMountedRef.current,
        },
        () =>
          withAbort(async (signal) => {
            const query = includeBalance ? '?includeBalance=true' : '';
            const response = await client.request<{ wallets?: Wallet[] } | Wallet[]>(
              'GET',
              `/api/v1/wallet/list${query}`,
              undefined,
              { signal }
            );

            if (!response.success || !response.data) {
              throw new Error(response.error?.message || 'Failed to list wallets');
            }

            const data = response.data;
            const wallets: Wallet[] = Array.isArray(data)
              ? data
              : ((data as { wallets?: Wallet[] }).wallets ?? []);

            update((s) => ({ ...s, wallets, loading: false }));

            return wallets;
          })
      ),
    [client, setError, setIsLoading, begin, fail, update]
  );

  const listWallets = useCallback(
    (includeBalance = false): Wallet[] | null | Promise<Wallet[] | null> => {
      if (useSuspense) {
        const key = `list:${includeBalance}`;
        let entry = listWalletsSuspenseCache.get(key);
        if (entry?.resolved) {
          return entry.data;
        }
        if (entry?.promise && !entry.resolved) {
          throw entry.promise;
        }

        const base = withAbort(async (signal) => {
          const query = includeBalance ? '?includeBalance=true' : '';
          const response = await client.request<{ wallets?: Wallet[] } | Wallet[]>(
            'GET',
            `/api/v1/wallet/list${query}`,
            undefined,
            { signal }
          );

          if (!response.success || !response.data) {
            throw new Error(response.error?.message || 'Failed to list wallets');
          }

          const data = response.data;
          const wallets: Wallet[] = Array.isArray(data)
            ? data
            : ((data as { wallets?: Wallet[] }).wallets ?? []);

          return wallets;
        });

        entry = { data: null, promise: null as unknown as Promise<Wallet[] | null>, resolved: false };
        const promise = base.then(
          (data) => {
            entry.resolved = true;
            entry.data = data;
            return data;
          },
          () => {
            entry.resolved = true;
            entry.data = null;
            return null;
          }
        );
        entry.promise = promise;
        listWalletsSuspenseCache.set(key, entry);
        throw promise;
      }

      return listWalletsTask(includeBalance);
    },
    [useSuspense, listWalletsTask]
  );

  const selectWallet = useCallback((wallet: Wallet) => {
    setState((s) => {
      if (!isMountedRef.current) return s;
      const next = { ...s, selectedWallet: wallet };
      stateRef.current = next;
      return next;
    });
  }, []);

  const unlinkWallet = useCallback(
    (walletId: string): Promise<void> =>
      runSafely(
        { setError, setIsLoading },
        {
          code: 'UNLINK_WALLET_ERROR',
          fallbackMessage: 'Failed to unlink wallet',
          onStart: begin(),
          onError: fail,
          isMounted: () => isMountedRef.current,
        },
        () =>
          withAbort(async (signal) => {
            const response = await client.request(
              'DELETE',
              `/api/v1/wallet/${walletId}`,
              undefined,
              { signal }
            );

            if (!response.success) {
              throw new Error(response.error?.message || 'Failed to unlink wallet');
            }

            update((s) => ({
              ...s,
              wallets: s.wallets.filter((w) => w.id !== walletId),
              selectedWallet: s.selectedWallet?.id === walletId ? undefined : s.selectedWallet,
              loading: false,
            }));
          })
      ),
    [client, setError, setIsLoading, begin, fail, update]
  );

  const renameWallet = useCallback(
    (walletId: string, name: string): Promise<Wallet> =>
      runSafely(
        { setError, setIsLoading },
        {
          code: 'RENAME_WALLET_ERROR',
          fallbackMessage: 'Failed to rename wallet',
          onStart: begin(),
          onError: fail,
          isMounted: () => isMountedRef.current,
        },
        () =>
          withAbort(async (signal) => {
            const response = await client.request<Wallet>(
              'PATCH',
              `/api/v1/wallet/${walletId}/name`,
              {
                name,
              },
              { signal }
            );

            if (!response.success || !response.data) {
              throw new Error(response.error?.message || 'Failed to rename wallet');
            }

            const updatedWallet = response.data;

            update((s) => ({
              ...s,
              wallets: s.wallets.map((w) => (w.id === walletId ? updatedWallet : w)),
              selectedWallet: s.selectedWallet?.id === walletId ? updatedWallet : s.selectedWallet,
              loading: false,
            }));

            return updatedWallet;
          })
      ),
    [client, setError, setIsLoading, begin, fail, update]
  );

  const getBalanceTask = useCallback(
    (walletId: string): Promise<{ available: number; pending: number; total: number }> =>
      runSafely(
        { setError, setIsLoading },
        {
          code: 'GET_BALANCE_ERROR',
          fallbackMessage: 'Failed to fetch balance',
          onStart: begin(),
          onError: fail,
          isMounted: () => isMountedRef.current,
        },
        () =>
          withAbort(async (signal) => {
            const response = await client.request<{
              available: number;
              pending: number;
              total: number;
            }>('GET', `/api/v1/wallet/${walletId}/balance`, undefined, { signal });

            if (!response.success || !response.data) {
              throw new Error(response.error?.message || 'Failed to fetch balance');
            }

            update((s) => ({ ...s, loading: false }));
            return response.data;
          })
      ),
    [client, setError, setIsLoading, begin, fail, update]
  );

  const getBalance = useCallback(
    (walletId: string): { available: number; pending: number; total: number } | null | Promise<{ available: number; pending: number; total: number } | null> => {
      if (useSuspense) {
        let entry = getBalanceSuspenseCache.get(walletId);
        if (entry?.resolved) {
          return entry.data as { available: number; pending: number; total: number };
        }
        if (entry?.promise && !entry.resolved) {
          throw entry.promise as Promise<{ available: number; pending: number; total: number }>;
        }

        const base = withAbort(async (signal) => {
          const response = await client.request<{
            available: number;
            pending: number;
            total: number;
          }>('GET', `/api/v1/wallet/${walletId}/balance`, undefined, { signal });

          if (!response.success || !response.data) {
            throw new Error(response.error?.message || 'Failed to fetch balance');
          }

          return response.data;
        });

        entry = {
          data: null,
          promise: null as unknown as Promise<{ available: number; pending: number; total: number } | null>,
          resolved: false,
        };
        const promise = base.then(
          (data) => {
            entry.resolved = true;
            entry.data = data;
            return data;
          },
          () => {
            entry.resolved = true;
            entry.data = null;
            return null;
          }
        );
        entry.promise = promise;
        getBalanceSuspenseCache.set(walletId, entry);
        throw promise;
      }

      return getBalanceTask(walletId);
    },
    [useSuspense, getBalanceTask]
  );

  const reset = useCallback(() => {
    const initial: UseWalletState = {
      wallets: [],
      loading: false,
      challengeStep: 'idle',
      balances: {},
    };
    setState(initial);
    stateRef.current = initial;
  }, []);

  useDebugValue(
    formatDebugValue({
      loading: state.loading,
      error: state.error,
      challengeStep: state.challengeStep,
      walletsCount: state.wallets.length,
      selectedWallet: state.selectedWallet?.publicKey,
    })
  );

  return {
    ...state,
    generateNonce,
    getChallenge,
    verifyWallet,
    listWallets,
    selectWallet,
    unlinkWallet,
    renameWallet,
    getBalance,
    reset,
  };
}
