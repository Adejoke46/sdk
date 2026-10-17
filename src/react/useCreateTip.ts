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

import { useState, useCallback, useRef, useEffect, useDebugValue } from 'react';
import { useDorisio } from './DorisioProvider';
import { Transaction } from '../types/models';
import { runSafely } from './safe-async';
import {
  tipFormReducer,
  initialTipFormState,
  type TipFormState,
  type TipFormAction,
} from './useCreateTip.reducer';
import type {
  CreateTipRequest,
  BuildTransactionRequest,
  BuildTransactionResponse,
  SubmitTransactionResponse,
} from '../client/transactions';
import { formatDebugValue } from './debug-format';

export interface UseCreateTipState extends TipFormState {}

export interface UseCreateTipActions {
  createTip: (data: CreateTipRequest, options?: { debounceMs?: number }) => Promise<Transaction>;
  buildTransaction: (
    tipId: string,
    data: BuildTransactionRequest,
    options?: { debounceMs?: number }
  ) => Promise<BuildTransactionResponse>;
  submitTransaction: (
    tipId: string,
    envelope: string,
    options?: { debounceMs?: number }
  ) => Promise<SubmitTransactionResponse>;
  confirmTransaction: (tipId: string, options?: { debounceMs?: number }) => Promise<Transaction>;
  reset: () => void;
}

/**
 * Hook for orchestrating the complete tip payment flow (create, build, submit, confirm).
 *
 * @returns State and action handlers for the tipping lifecycle
 *
 * @debugValue Displays `{ loading, submitting, step, error, dataId }` in React DevTools.
 *   - `loading` (boolean): whether any request is in flight
 *   - `submitting` (boolean): whether a transaction is being submitted
 *   - `step` (string): current tip lifecycle step (idle, creating, building, submitting, confirming, success, error)
 *   - `error` (string | undefined): last error message, if any
 *   - `dataId` (string | undefined): id of the created/confirmed transaction, if any
 *
 * @example
 * ```tsx
 * import { useCreateTip } from 'dorisio-sdk/react';
 *
 * function TipButton({ creatorId }: { creatorId: string }) {
 *   const { step, loading, error, createTip, reset } = useCreateTip();
 *
 *   const handleTip = async () => {
 *     try {
 *       const tip = await createTip({ creatorId, amount: 25, message: 'Thanks!' });
 *       console.log('Tip created:', tip.id);
 *     } catch (err) {
 *       console.error('Tip failed:', err);
 *     }
 *   };
 *
 *   return (
 *     <div>
 *       <button disabled={loading} onClick={handleTip}>
 *         {loading ? `Processing (${step})...` : 'Tip $25'}
 *       </button>
 *       {error && <p className="error">{error}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useCreateTip(): UseCreateTipState & UseCreateTipActions {
  const { client, setError, setIsLoading } = useDorisio();

  const [state, dispatch] = useReducer(tipFormReducer, initialTipFormState);

  const isMountedRef = useRef(true);
  const abortControllersRef = useRef<Set<AbortController>>(new Set());
  const inFlightRef = useRef(false);
  const inFlightPromiseRef = useRef<Promise<any> | null>(null);
  const lastSubmitTimeRef = useRef<{ [key: string]: number }>({});
  const debounceTimeoutRef = useRef<{ [key: string]: NodeJS.Timeout }>({});

  useEffect(() => {
    isMountedRef.current = true;
    const controllers = abortControllersRef.current;
    return () => {
      isMountedRef.current = false;
      for (const controller of controllers) {
        controller.abort();
      }
      controllers.clear();
      for (const timeout of Object.values(debounceTimeoutRef.current)) {
        clearTimeout(timeout);
      }
      debounceTimeoutRef.current = {};
    };
  }, []);

  const withAbort = <T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    abortControllersRef.current.add(controller);
    return fn(controller.signal).finally(() => {
      abortControllersRef.current.delete(controller);
    });
  };

  const safeDispatch = useCallback((action: TipFormAction) => {
    if (!isMountedRef.current) return;
    dispatch(action);
  }, [dispatch]);

  const withSubmissionGuard = useCallback(
    <T>(action: string, task: () => Promise<T>, debounceMs: number = 500): Promise<T> => {
      // Check if we're still in the debounce window
      const now = Date.now();
      const lastTime = lastSubmitTimeRef.current[action] || 0;
      const timeSinceLastSubmit = now - lastTime;

      if (timeSinceLastSubmit < debounceMs) {
        // Within debounce window
        if (inFlightRef.current && inFlightPromiseRef.current) {
          // Return the existing in-flight promise
          return inFlightPromiseRef.current;
        }
        // Reject: another submission within debounce window
        return Promise.reject(
          new Error(
            `Duplicate ${action} submission rejected. Please wait ${Math.ceil(
              (debounceMs - timeSinceLastSubmit) / 1000
            )}s before retrying.`
          )
        );
      }

      if (inFlightRef.current && inFlightPromiseRef.current) {
        // Return the existing in-flight promise
        return inFlightPromiseRef.current;
      }

      inFlightRef.current = true;
      lastSubmitTimeRef.current[action] = now;

      const promise = task().finally(() => {
        inFlightRef.current = false;
        inFlightPromiseRef.current = null;
      });

      inFlightPromiseRef.current = promise;
      return promise;
    },
    []
  );

  const start = useCallback(
    (step: TipFormState['step']) => () => safeDispatch({ type: 'START', step }),
    [safeDispatch]
  );
  const fail = useCallback(
    (error: string) => safeDispatch({ type: 'FAIL', error }),
    [safeDispatch]
  );

  const createTip = useCallback(
    (data: CreateTipRequest, options?: { debounceMs?: number }): Promise<Transaction> =>
      withSubmissionGuard(
        'createTip',
        () =>
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
                safeDispatch({ type: 'COMPLETE', data: tip, step: 'idle' });
                return tip;
              })
          ),
        options?.debounceMs ?? 500
      ),
    [client, setError, setIsLoading, safeDispatch, start, fail, withSubmissionGuard]
  );

  const buildTransaction = useCallback(
    (tipId: string, data: BuildTransactionRequest, options?: { debounceMs?: number }) =>
      withSubmissionGuard(
        'buildTransaction',
        () =>
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
                safeDispatch({ type: 'COMPLETE', step: 'idle' });
                return result;
              })
          ),
        options?.debounceMs ?? 500
      ),
    [client, setError, setIsLoading, safeDispatch, start, fail, withSubmissionGuard]
  );

  const submitTransaction = useCallback(
    (tipId: string, envelope: string, options?: { debounceMs?: number }) =>
      withSubmissionGuard(
        'submitTransaction',
        () =>
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
                    envelope,
                  },
                  { signal }
                );
                safeDispatch({ type: 'COMPLETE', step: 'idle' });
                return result;
              })
          ),
        options?.debounceMs ?? 500
      ),
    [client, setError, setIsLoading, safeDispatch, start, fail, withSubmissionGuard]
  );

  const confirmTransaction = useCallback(
    (tipId: string, options?: { debounceMs?: number }): Promise<Transaction> =>
      withSubmissionGuard(
        'confirmTransaction',
        () =>
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
                safeDispatch({ type: 'COMPLETE', data: tip, step: 'success' });
                return tip;
              })
          ),
        options?.debounceMs ?? 500
      ),
    [client, setError, setIsLoading, safeDispatch, start, fail, withSubmissionGuard]
  );

  const reset = useCallback(() => {
    inFlightRef.current = false;
    inFlightPromiseRef.current = null;
    lastSubmitTimeRef.current = {};
    safeDispatch({ type: 'RESET' });
  }, [safeDispatch]);

  useDebugValue(
    formatDebugValue({
      loading: state.loading,
      submitting: state.submitting,
      step: state.step,
      error: state.error,
      dataId: state.data?.id,
    })
  );

  return {
    ...state,
    createTip,
    buildTransaction,
    submitTransaction,
    confirmTransaction,
    reset,
  };
}
