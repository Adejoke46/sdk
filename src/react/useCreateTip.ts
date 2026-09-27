/**
 * useCreateTip Hook
 *
 * Hook for creating and submitting tips with Stellar transaction support.
 * Handles the full tip lifecycle: create, build transaction, submit, and confirm.
 *
 * Error handling: every operation resolves with its result or rejects with the
 * original error. Failures also set `error`/`step: 'error'` on the hook and are
 * reported through the provider's `setError`; a throwing `onError` handler or
 * `setError` never masks the original error, and loading state is always cleared.
 * Always `await` the actions inside try/catch (or `.catch()`) in event handlers.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useDorisio } from './DorisioProvider';
import { Transaction } from '../types/models';
import { runSafely } from './safe-async';
import type {
  CreateTipRequest,
  BuildTransactionRequest,
  BuildTransactionResponse,
  SubmitTransactionResponse,
} from '../client/transactions';

export interface UseCreateTipState {
  data?: Transaction;
  loading: boolean;
  error?: string;
  step: 'idle' | 'creating' | 'building' | 'submitting' | 'confirming' | 'success' | 'error';
}

export interface UseCreateTipActions {
  createTip: (data: CreateTipRequest) => Promise<Transaction>;
  buildTransaction: (
    tipId: string,
    data: BuildTransactionRequest
  ) => Promise<BuildTransactionResponse>;
  submitTransaction: (tipId: string, envelope: string) => Promise<SubmitTransactionResponse>;
  confirmTransaction: (tipId: string) => Promise<Transaction>;
  reset: () => void;
}

/**
 * useCreateTip
 *
 * Manages the tip creation workflow including Stellar transaction building and submission.
 */
export function useCreateTip(): UseCreateTipState & UseCreateTipActions {
  const { client, setError, setIsLoading } = useDorisio();

  const [state, setState] = useState<UseCreateTipState>({
    loading: false,
    step: 'idle',
  });

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

  const withAbort = <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    abortControllersRef.current.add(controller);
    return fn(controller.signal).finally(() => {
      abortControllersRef.current.delete(controller);
    });
  };

  const safeSetState = useCallback((fn: React.SetStateAction<UseCreateTipState>) => {
    if (!isMountedRef.current) return;
    setState(fn);
  }, []);

  const start = (step: UseCreateTipState['step']) => () =>
    safeSetState((s) => ({ ...s, loading: true, step, error: undefined }));
  const fail = (error: string) =>
    safeSetState((s) => ({ ...s, error, step: 'error', loading: false }));

  const createTip = useCallback(
    (data: CreateTipRequest): Promise<Transaction> =>
      runSafely(
        { setError, setIsLoading },
        {
          code: 'CREATE_TIP_ERROR',
          fallbackMessage: 'Failed to create tip',
          onStart: start('creating'),
          onError: fail,
          isMounted: () => isMountedRef.current,
        },
        () =>
          withAbort(async (signal) => {
            const tip = await client.createTip(data, { signal });
            safeSetState((s) => ({ ...s, data: tip, step: 'idle', loading: false }));
            return tip;
          })
      ),
    [client, setError, setIsLoading, safeSetState]
  );

  const buildTransaction = useCallback(
    (tipId: string, data: BuildTransactionRequest) =>
      runSafely(
        { setError, setIsLoading },
        {
          code: 'BUILD_TRANSACTION_ERROR',
          fallbackMessage: 'Failed to build transaction',
          onStart: start('building'),
          onError: fail,
          isMounted: () => isMountedRef.current,
        },
        () =>
          withAbort(async (signal) => {
            const result = await client.buildPaymentTransaction(tipId, data, { signal });
            safeSetState((s) => ({ ...s, step: 'idle', loading: false }));
            return result;
          })
      ),
    [client, setError, setIsLoading, safeSetState]
  );

  const submitTransaction = useCallback(
    (tipId: string, envelope: string) =>
      runSafely(
        { setError, setIsLoading },
        {
          code: 'SUBMIT_TRANSACTION_ERROR',
          fallbackMessage: 'Failed to submit transaction',
          onStart: start('submitting'),
          onError: fail,
          isMounted: () => isMountedRef.current,
        },
        () =>
          withAbort(async (signal) => {
            const result = await client.submitPaymentTransaction(
              tipId,
              {
                transactionEnvelope: envelope,
              },
              { signal }
            );
            safeSetState((s) => ({ ...s, step: 'idle', loading: false }));
            return result;
          })
      ),
    [client, setError, setIsLoading, safeSetState]
  );

  const confirmTransaction = useCallback(
    (tipId: string): Promise<Transaction> =>
      runSafely(
        { setError, setIsLoading },
        {
          code: 'CONFIRM_TRANSACTION_ERROR',
          fallbackMessage: 'Failed to confirm transaction',
          onStart: start('confirming'),
          onError: fail,
          isMounted: () => isMountedRef.current,
        },
        () =>
          withAbort(async (signal) => {
            const tip = await client.checkTransactionConfirmation(tipId, { signal });
            safeSetState((s) => ({ ...s, data: tip, step: 'success', loading: false }));
            return tip;
          })
      ),
    [client, setError, setIsLoading, safeSetState]
  );

  const reset = useCallback(() => {
    safeSetState({
      loading: false,
      step: 'idle',
    });
  }, [safeSetState]);

  return {
    ...state,
    createTip,
    buildTransaction,
    submitTransaction,
    confirmTransaction,
    reset,
  };
}
