/**
 * Retryable error classification (Issue #162)
 *
 * Verifies that every SDK error class exposes a `retryable` flag, that only
 * RateLimitError and NetworkError set it to true, and that isRetryableError
 * reads the flag safely from any value.
 */

import { describe, it, expect } from 'vitest';
import {
  DorisioError,
  AuthError,
  WalletVerificationError,
  PaymentError,
  ValidationError,
  RateLimitError,
  QueueFullError,
  TimeoutError,
  ApiError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  NetworkError,
} from '../../src/types/errors';
import { isRetryableError } from '../../src/lib/errors/utils';
import { isRetryableError as isRetryableErrorFromIndex } from '../../src';

const retryableErrors: Array<[string, DorisioError]> = [
  ['RateLimitError', new RateLimitError('Too many requests', 30)],
  ['NetworkError', new NetworkError('Connection reset')],
];

const nonRetryableErrors: Array<[string, DorisioError]> = [
  ['DorisioError', new DorisioError('Base error', 500, 'SERVER_ERROR')],
  ['AuthError', new AuthError('Invalid credentials', 401, 'UNAUTHORIZED')],
  [
    'WalletVerificationError',
    new WalletVerificationError('Bad signature', 400, 'INVALID_SIGNATURE', 'challenge-1'),
  ],
  ['PaymentError', new PaymentError('Payment declined', 402, 'DECLINED', 'tx-hash')],
  ['ValidationError', new ValidationError('amount is required', { amount: 'required' })],
  ['QueueFullError', new QueueFullError(1000)],
  ['TimeoutError', new TimeoutError('Request timeout', 30000)],
  ['ApiError', new ApiError('Server error', 503, 'SERVER_ERROR')],
  ['AuthenticationError', new AuthenticationError()],
  ['AuthorizationError', new AuthorizationError()],
  ['NotFoundError', new NotFoundError()],
];

describe('retryable flag on SDK error classes', () => {
  it.each([...retryableErrors, ...nonRetryableErrors])(
    '%s exposes a boolean retryable property',
    (_name, error) => {
      expect(Object.prototype.hasOwnProperty.call(error, 'retryable')).toBe(true);
      expect(typeof error.retryable).toBe('boolean');
    }
  );

  it.each(retryableErrors)('%s is retryable', (_name, error) => {
    expect(error.retryable).toBe(true);
  });

  it.each(nonRetryableErrors)('%s is not retryable', (_name, error) => {
    expect(error.retryable).toBe(false);
  });

  it('defaults to false on the base class', () => {
    expect(new DorisioError('plain').retryable).toBe(false);
  });

  it('can be set through the base constructor', () => {
    const error = new DorisioError('Service unavailable', 503, 'UNAVAILABLE', 'req-1', true);
    expect(error.retryable).toBe(true);
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('UNAVAILABLE');
    expect(error.requestId).toBe('req-1');
  });

  it('keeps the existing fields of RateLimitError and NetworkError', () => {
    const rateLimited = new RateLimitError('Too many requests', 30, 'req-2');
    expect(rateLimited.statusCode).toBe(429);
    expect(rateLimited.code).toBe('RATE_LIMITED');
    expect(rateLimited.retryAfter).toBe(30);
    expect(rateLimited.requestId).toBe('req-2');

    const network = new NetworkError('Connection reset', 'req-3');
    expect(network.statusCode).toBe(0);
    expect(network.code).toBe('NETWORK_ERROR');
    expect(network.requestId).toBe('req-3');
  });
});

describe('isRetryableError', () => {
  it.each(retryableErrors)('returns true for %s', (_name, error) => {
    expect(isRetryableError(error)).toBe(true);
  });

  it.each(nonRetryableErrors)('returns false for %s', (_name, error) => {
    expect(isRetryableError(error)).toBe(false);
  });

  it('returns false for null and undefined', () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });

  it('returns false for a plain Error', () => {
    expect(isRetryableError(new Error('boom'))).toBe(false);
    expect(isRetryableError(new TypeError('fetch failed'))).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isRetryableError('NetworkError')).toBe(false);
    expect(isRetryableError(429)).toBe(false);
    expect(isRetryableError(true)).toBe(false);
  });

  it('returns false for objects without a retryable flag', () => {
    expect(isRetryableError({})).toBe(false);
    expect(isRetryableError([])).toBe(false);
    expect(isRetryableError(Object.create(null))).toBe(false);
    expect(isRetryableError({ statusCode: 429, code: 'RATE_LIMITED' })).toBe(false);
  });

  it('only accepts a retryable flag that is strictly true', () => {
    expect(isRetryableError({ retryable: true })).toBe(true);
    expect(isRetryableError({ retryable: false })).toBe(false);
    expect(isRetryableError({ retryable: 'true' })).toBe(false);
    expect(isRetryableError({ retryable: 1 })).toBe(false);
    expect(isRetryableError({ retryable: null })).toBe(false);
  });

  it('honours a retryable flag set through the base constructor', () => {
    const error = new DorisioError('Service unavailable', 503, undefined, undefined, true);
    expect(isRetryableError(error)).toBe(true);
  });

  it('is re-exported from the package entry point', () => {
    expect(isRetryableErrorFromIndex).toBe(isRetryableError);
  });
});
