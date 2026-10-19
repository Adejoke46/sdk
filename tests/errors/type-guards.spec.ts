/**
 * Error type guards (Issue #167)
 *
 * Verifies that each guard accepts its own error class (including subclasses),
 * rejects every other SDK error class, handles null, undefined, primitives,
 * plain errors and plain objects, and recognises errors by name when
 * instanceof fails.
 */

import { describe, it, expect } from 'vitest';
import {
  isAuthError,
  isPaymentError,
  isValidationError,
  isRateLimitError,
  isNetworkError,
} from '../../src/lib/errors/type-guards';
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
import { SchemaValidationError } from '../../src/types/validation';
import * as sdk from '../../src';

type Guard = (e: unknown) => boolean;

const guards: Array<[string, Guard, DorisioError]> = [
  ['isAuthError', isAuthError, new AuthError('Invalid credentials', 401, 'UNAUTHORIZED')],
  ['isPaymentError', isPaymentError, new PaymentError('Payment declined', 402, 'DECLINED', 'tx-1')],
  ['isValidationError', isValidationError, new ValidationError('amount is required')],
  ['isRateLimitError', isRateLimitError, new RateLimitError('Too many requests', 30)],
  ['isNetworkError', isNetworkError, new NetworkError('Connection reset')],
];

const otherSdkErrors: Array<[string, DorisioError]> = [
  ['DorisioError', new DorisioError('Base error', 500, 'SERVER_ERROR')],
  [
    'WalletVerificationError',
    new WalletVerificationError('Bad signature', 400, 'INVALID_SIGNATURE', 'challenge-1'),
  ],
  ['QueueFullError', new QueueFullError(1000)],
  ['TimeoutError', new TimeoutError()],
  ['ApiError', new ApiError('Too many requests', 429, 'RATE_LIMITED')],
  ['AuthenticationError', new AuthenticationError()],
  ['AuthorizationError', new AuthorizationError()],
  ['NotFoundError', new NotFoundError()],
];

describe.each(guards)('%s', (name, guard, own) => {
  const siblings = guards
    .filter(([otherName]) => otherName !== name)
    .map(([, , error]): [string, DorisioError] => [error.name, error]);

  it('accepts its own error class', () => {
    expect(guard(own)).toBe(true);
  });

  it.each(siblings)('rejects %s', (_otherName, error) => {
    expect(guard(error)).toBe(false);
  });

  it.each(otherSdkErrors)('rejects %s', (_otherName, error) => {
    expect(guard(error)).toBe(false);
  });

  it('rejects null, undefined and primitives', () => {
    expect(guard(null)).toBe(false);
    expect(guard(undefined)).toBe(false);
    expect(guard(own.name)).toBe(false);
    expect(guard(42)).toBe(false);
  });

  it('rejects a plain Error and a plain object', () => {
    expect(guard(new Error('boom'))).toBe(false);
    expect(guard({})).toBe(false);
    expect(guard({ message: own.message })).toBe(false);
  });

  it('recognises an error of the same name that fails instanceof', () => {
    const foreign = new Error(own.message);
    foreign.name = own.name;
    expect(foreign instanceof DorisioError).toBe(false);
    expect(guard(foreign)).toBe(true);
  });

  it('recognises a plain object carrying the error name', () => {
    expect(guard({ name: own.name, message: own.message })).toBe(true);
  });
});

describe('error type guards', () => {
  it('isValidationError accepts the SchemaValidationError subclass', () => {
    const error = new SchemaValidationError('request', [{ path: 'amount', message: 'Required' }]);
    expect(error.name).toBe('SchemaValidationError');
    expect(isValidationError(error)).toBe(true);
  });

  it('isAuthError does not match AuthenticationError or AuthorizationError', () => {
    // Both extend DorisioError directly, not AuthError.
    expect(isAuthError(new AuthenticationError())).toBe(false);
    expect(isAuthError(new AuthorizationError())).toBe(false);
  });

  it('matches the error name exactly', () => {
    expect(isAuthError({ name: 'autherror' })).toBe(false);
    expect(isNetworkError({ name: 'NetworkErrorX' })).toBe(false);
    expect(isNetworkError({ name: ['NetworkError'] })).toBe(false);
    expect(isRateLimitError({ name: 'RateLimitError ' })).toBe(false);
  });

  it('narrows the type so class specific fields are accessible', () => {
    const errors: unknown[] = [
      new PaymentError('Payment declined', 402, 'DECLINED', 'tx-1'),
      new RateLimitError('Too many requests', 30),
      new ValidationError('amount is required', { amount: 'required' }),
      new NetworkError('Connection reset'),
      new AuthError('Invalid credentials', 401, 'UNAUTHORIZED'),
    ];

    const seen: string[] = [];
    for (const error of errors) {
      if (isPaymentError(error)) {
        seen.push(`payment:${error.transactionHash}`);
      } else if (isRateLimitError(error)) {
        seen.push(`rate-limit:${error.retryAfter}`);
      } else if (isValidationError(error)) {
        seen.push(`validation:${Object.keys(error.details ?? {}).join(',')}`);
      } else if (isNetworkError(error)) {
        seen.push(`network:${error.code}`);
      } else if (isAuthError(error)) {
        seen.push(`auth:${error.statusCode}`);
      }
    }

    expect(seen).toEqual([
      'payment:tx-1',
      'rate-limit:30',
      'validation:amount',
      'network:NETWORK_ERROR',
      'auth:401',
    ]);
  });

  it('re-exports every guard from the package entry point', () => {
    expect(sdk.isAuthError).toBe(isAuthError);
    expect(sdk.isPaymentError).toBe(isPaymentError);
    expect(sdk.isValidationError).toBe(isValidationError);
    expect(sdk.isRateLimitError).toBe(isRateLimitError);
    expect(sdk.isNetworkError).toBe(isNetworkError);
  });
});
