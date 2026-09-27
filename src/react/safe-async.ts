/**
 * Safe async helpers for React hooks
 *
 * Error-handling contract shared by every async hook operation:
 *  - the original error is always re-thrown to the caller (never replaced by a
 *    secondary failure from a reporting callback),
 *  - `setError` / `setIsLoading` failures are logged, never thrown,
 *  - loading cleanup in `finally` always runs.
 */

import type { DorisioContextValue } from './DorisioProvider';

type ErrorContext = Pick<DorisioContextValue, 'setError' | 'setIsLoading'>;

export interface SafeOperation {
  /** Machine-readable code passed to the provider's `setError`. */
  code: string;
  /** Message used when the thrown value carries none. */
  fallbackMessage: string;
  /** Runs inside the try block before the task (set local loading state here). */
  onStart?: () => void;
  /** Runs when the task fails (set local error state here). Receives the message. */
  onError?: (message: string) => void;
  /** Optional predicate to check if the caller component is still mounted. */
  isMounted?: () => boolean;
}

// Errors this module has already reported and re-thrown to a caller. Lets the provider
// recognise them if the caller forgot to catch, without touching unrelated app rejections.
const rethrown = new WeakSet<object>();

/** True if `reason` is an error a Dorisio hook reported and re-threw to its caller. */
export function isRethrownByHook(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && rethrown.has(reason);
}

/** Extract a human-readable message from anything that can be thrown. */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'string' && err) return err;
  if (err && typeof err === 'object') {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback;
}

/** Run a side effect that must never break the caller. Failures are logged. */
export function safely(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.error(`[dorisio] ${label} failed:`, err);
  }
}

/** Attach a logging handler to a fire-and-forget promise so it can't go unhandled. */
export function logRejection(promise: Promise<unknown>, label: string): void {
  promise.catch((err) => console.error(`[dorisio] ${label} failed:`, err));
}

/**
 * Run an async hook operation with guaranteed error reporting and cleanup.
 *
 * @example
 * ```ts
 * return runSafely(
 *   { setError, setIsLoading },
 *   {
 *     code: 'CREATE_TIP_ERROR',
 *     fallbackMessage: 'Failed to create tip',
 *     onStart: () => setState((s) => ({ ...s, loading: true, error: undefined })),
 *     onError: (error) => setState((s) => ({ ...s, error, loading: false })),
 *     isMounted: () => isMountedRef.current,
 *   },
 *   async () => client.createTip(data)
 * );
 * ```
 */
export async function runSafely<T>(
  { setError, setIsLoading }: ErrorContext,
  op: SafeOperation,
  task: () => Promise<T>
): Promise<T> {
  safely('setIsLoading(true)', () => setIsLoading(true));
  try {
    op.onStart?.();
    return await task();
  } catch (err) {
    const isStillMounted = op.isMounted ? op.isMounted() : true;
    if (isStillMounted) {
      const message = getErrorMessage(err, op.fallbackMessage);
      safely('onError', () => op.onError?.(message));
      safely('setError', () => setError({ message, code: op.code }));
    }
    if (typeof err === 'object' && err !== null) rethrown.add(err);
    throw err;
  } finally {
    safely('setIsLoading(false)', () => setIsLoading(false));
  }
}
