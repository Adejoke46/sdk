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

import { useState, useCallback, useRef } from 'react';
import { useDorisio } from './DorisioProvider';
import { Wallet } from '../types/models';

export interface UseWalletState {
  wallets: Wallet[];
  selectedWallet?: Wallet;
  loading: boolean;
  error?: string;
  nonce?: string;
  challengeStep:
    'idle' | 'nonce-generated' | 'challenge-ready' | 'verifying' | 'verified' | 'error';
}

export interface UseWalletActions {
  generateNonce: (publicKey: string) => Promise<{ nonce: string; expiresIn: number }>;
  getChallenge: (nonce: string) => Promise<string>;
  verifyWallet: (publicKey: string, nonce: string, signedTransaction: string) => Promise<Wallet>;
  listWallets: (includeBalance?: boolean) => Promise<Wallet[]>;
  selectWallet: (wallet: Wallet) => void;
  unlinkWallet: (walletId: string) => Promise<void>;
  renameWallet: (walletId: string, name: string) => Promise<Wallet>;
  getBalance: (walletId: string) => Promise<any>;
  reset: () => void;
}

/**
 * useWallet
 *
 * Manages wallet operations including challenge-response verification with Freighter.
 */
export function useWallet(): UseWalletState & UseWalletActions {
  const { client, setError, setIsLoading } = useDorisio();

  const [state, setState] = useState<UseWalletState>({
    wallets: [],
    loading: false,
    challengeStep: 'idle',
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const generateNonce = useCallback(
    async (publicKey: string): Promise<{ nonce: string; expiresIn: number }> => {
      try {
        // Functional update avoids overwriting wallets/selection from a stale snapshot.
        setState((s) => ({ ...s, loading: true, error: undefined }));
        setIsLoading(true);

        const response = await client.request<any>('POST', '/api/v1/wallet/nonce', {
          publicKey,
        });

        if (!response.success || !response.data) {
          throw new Error(response.error?.message || 'Failed to generate nonce');
        }

        const data = response.data;
        setState((s) => {
          const next = {
            ...s,
            nonce: data.nonce as string,
            challengeStep: 'nonce-generated' as const,
            loading: false,
          };
          stateRef.current = next;
          return next;
        });

        return { nonce: data.nonce, expiresIn: data.expiresIn || 300 };
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Failed to generate nonce';
        setState((s) => {
          const next = { ...s, error, challengeStep: 'error' as const, loading: false };
          stateRef.current = next;
          return next;
        });
        setError({ message: error, code: 'NONCE_GENERATION_ERROR' });
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [client, setError, setIsLoading]
  );

  const getChallenge = useCallback(
    async (nonce: string): Promise<string> => {
      try {
        setState((s) => ({ ...s, loading: true, error: undefined }));
        setIsLoading(true);

        // Prefer explicit arg; fall back to latest generated nonce from ref.
        const resolvedNonce = nonce || stateRef.current.nonce;
        if (!resolvedNonce) {
          throw new Error('No nonce available for challenge');
        }

        const response = await client.request<any>(
          'GET',
          `/api/v1/wallet/challenge/${resolvedNonce}`
        );

        if (!response.success || !response.data) {
          throw new Error(response.error?.message || 'Failed to get challenge');
        }

        const data = response.data;
        setState((s) => {
          const next = {
            ...s,
            challengeStep: 'challenge-ready' as const,
            loading: false,
          };
          stateRef.current = next;
          return next;
        });

        return data.challenge || data;
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Failed to get challenge';
        setState((s) => {
          const next = { ...s, error, challengeStep: 'error' as const, loading: false };
          stateRef.current = next;
          return next;
        });
        setError({ message: error, code: 'CHALLENGE_ERROR' });
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [client, setError, setIsLoading]
  );

  const verifyWallet = useCallback(
    async (publicKey: string, nonce: string, signedTransaction: string): Promise<Wallet> => {
      try {
        setState((s) => ({ ...s, loading: true, error: undefined, challengeStep: 'verifying' }));
        setIsLoading(true);

        const response = await client.request<Wallet>('POST', '/api/v1/wallet/verify', {
          publicKey,
          nonce,
          signedTransaction,
        });

        if (!response.success || !response.data) {
          throw new Error(response.error?.message || 'Failed to verify wallet');
        }

        const wallet = response.data;

        setState((s) => {
          const next = {
            ...s,
            wallets: [...s.wallets, wallet],
            selectedWallet: wallet,
            challengeStep: 'verified' as const,
            loading: false,
            nonce: undefined,
          };
          stateRef.current = next;
          return next;
        });

        return wallet;
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Failed to verify wallet';
        setState((s) => {
          const next = { ...s, error, challengeStep: 'error' as const, loading: false };
          stateRef.current = next;
          return next;
        });
        setError({ message: error, code: 'WALLET_VERIFICATION_ERROR' });
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [client, setError, setIsLoading]
  );

  const listWallets = useCallback(
    async (includeBalance = false): Promise<Wallet[]> => {
      try {
        setState((s) => ({ ...s, loading: true, error: undefined }));
        setIsLoading(true);

        const query = includeBalance ? '?includeBalance=true' : '';
        const response = await client.request<any>('GET', `/api/v1/wallet/list${query}`);

        if (!response.success || !response.data) {
          throw new Error(response.error?.message || 'Failed to list wallets');
        }

        const data = response.data;
        const wallets = (data.wallets || data) as Wallet[];

        setState((s) => {
          const next = {
            ...s,
            wallets,
            loading: false,
          };
          stateRef.current = next;
          return next;
        });

        return wallets;
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Failed to list wallets';
        setState((s) => {
          const next = { ...s, error, loading: false };
          stateRef.current = next;
          return next;
        });
        setError({ message: error, code: 'LIST_WALLETS_ERROR' });
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [client, setError, setIsLoading]
  );

  const selectWallet = useCallback((wallet: Wallet) => {
    setState((s) => {
      const next = { ...s, selectedWallet: wallet };
      stateRef.current = next;
      return next;
    });
  }, []);

  const unlinkWallet = useCallback(
    async (walletId: string): Promise<void> => {
      try {
        setState((s) => ({ ...s, loading: true, error: undefined }));
        setIsLoading(true);

        const response = await client.request('DELETE', `/api/v1/wallet/${walletId}`);

        if (!response.success) {
          throw new Error(response.error?.message || 'Failed to unlink wallet');
        }

        setState((s) => {
          const next = {
            ...s,
            wallets: s.wallets.filter((w) => w.id !== walletId),
            selectedWallet: s.selectedWallet?.id === walletId ? undefined : s.selectedWallet,
            loading: false,
          };
          stateRef.current = next;
          return next;
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Failed to unlink wallet';
        setState((s) => {
          const next = { ...s, error, loading: false };
          stateRef.current = next;
          return next;
        });
        setError({ message: error, code: 'UNLINK_WALLET_ERROR' });
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [client, setError, setIsLoading]
  );

  const renameWallet = useCallback(
    async (walletId: string, name: string): Promise<Wallet> => {
      try {
        setState((s) => ({ ...s, loading: true, error: undefined }));
        setIsLoading(true);

        const response = await client.request<Wallet>('PATCH', `/api/v1/wallet/${walletId}/name`, {
          name,
        });

        if (!response.success || !response.data) {
          throw new Error(response.error?.message || 'Failed to rename wallet');
        }

        const updatedWallet = response.data;

        setState((s) => {
          const next = {
            ...s,
            wallets: s.wallets.map((w) => (w.id === walletId ? updatedWallet : w)),
            selectedWallet: s.selectedWallet?.id === walletId ? updatedWallet : s.selectedWallet,
            loading: false,
          };
          stateRef.current = next;
          return next;
        });

        return updatedWallet;
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Failed to rename wallet';
        setState((s) => {
          const next = { ...s, error, loading: false };
          stateRef.current = next;
          return next;
        });
        setError({ message: error, code: 'RENAME_WALLET_ERROR' });
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [client, setError, setIsLoading]
  );

  const getBalance = useCallback(
    async (walletId: string): Promise<any> => {
      try {
        setState((s) => ({ ...s, loading: true, error: undefined }));
        setIsLoading(true);

        const response = await client.request<any>('GET', `/api/v1/wallet/${walletId}/balance`);

        if (!response.success || !response.data) {
          throw new Error(response.error?.message || 'Failed to fetch balance');
        }

        setState((s) => {
          const next = { ...s, loading: false };
          stateRef.current = next;
          return next;
        });
        return response.data;
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Failed to fetch balance';
        setState((s) => {
          const next = { ...s, error, loading: false };
          stateRef.current = next;
          return next;
        });
        setError({ message: error, code: 'GET_BALANCE_ERROR' });
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [client, setError, setIsLoading]
  );

  const reset = useCallback(() => {
    const initial: UseWalletState = {
      wallets: [],
      loading: false,
      challengeStep: 'idle',
    };
    setState(initial);
    stateRef.current = initial;
  }, []);

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
