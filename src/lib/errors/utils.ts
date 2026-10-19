/**
 * Error Utilities
 *
 * Helpers for classifying SDK errors.
 */

/**
 * Check whether an error is safe to retry.
 *
 * Every `DorisioError` carries a `retryable` flag (see `src/types/errors.ts`).
 * This guard reads that flag from any value without throwing: it returns `true`
 * only when `err` is an object whose `retryable` property is strictly `true`.
 * `null`, `undefined`, primitives, plain `Error` instances and objects without
 * the flag all return `false`.
 *
 * @example
 * try {
 *   await client.createTip(input);
 * } catch (error) {
 *   if (isRetryableError(error)) {
 *     // RateLimitError or NetworkError: schedule another attempt
 *   }
 * }
 */
export function isRetryableError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }

  return (err as { retryable?: unknown }).retryable === true;
}
