/**
 * Error Type Guards
 *
 * Predicates that narrow an unknown value to one of the SDK error classes
 * defined in `src/types/errors.ts`.
 *
 * Each guard checks `instanceof` first. When that fails it falls back to the
 * error `name`, so an error created by another copy of the SDK (a duplicated
 * bundle, an iframe or a worker realm) is still recognised.
 */

import {
  AuthError,
  NetworkError,
  PaymentError,
  RateLimitError,
  ValidationError,
} from '../../types/errors';

/**
 * Name based fallback for values that did not pass the `instanceof` check.
 */
function hasErrorName(value: unknown, name: string): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return (value as { name?: unknown }).name === name;
}

/**
 * Check whether `e` is an `AuthError` (generic authentication failure).
 */
export function isAuthError(e: unknown): e is AuthError {
  return e instanceof AuthError || hasErrorName(e, 'AuthError');
}

/**
 * Check whether `e` is a `PaymentError` (payment processing failure).
 */
export function isPaymentError(e: unknown): e is PaymentError {
  return e instanceof PaymentError || hasErrorName(e, 'PaymentError');
}

/**
 * Check whether `e` is a `ValidationError`, including subclasses such as
 * `SchemaValidationError`.
 */
export function isValidationError(e: unknown): e is ValidationError {
  return e instanceof ValidationError || hasErrorName(e, 'ValidationError');
}

/**
 * Check whether `e` is a `RateLimitError` (HTTP 429 with an optional `retryAfter`).
 */
export function isRateLimitError(e: unknown): e is RateLimitError {
  return e instanceof RateLimitError || hasErrorName(e, 'RateLimitError');
}

/**
 * Check whether `e` is a `NetworkError` (the request never reached the API).
 */
export function isNetworkError(e: unknown): e is NetworkError {
  return e instanceof NetworkError || hasErrorName(e, 'NetworkError');
}
