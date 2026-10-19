/**
 * Error Handler
 *
 * Utilities for handling and normalizing errors.
 */

import { DorisioError, ApiError, NetworkError, TimeoutError } from '../types/errors';
import { isNetworkError, isValidationError } from '../lib/errors/type-guards';
import { createErrorFromResponse } from '../http/error-factory';


export class ApiErrorHandler {
  /**
   * Handle and normalize API errors
   */
  static handle(error: unknown): Error {
    if (error instanceof DorisioError) {
      return error;
    }

    if (error instanceof ApiError) {
      return error;
    }

    if (isValidationError(error)) {
      return error;
    }

    if (isNetworkError(error)) {
      return error;
    }

    if (error instanceof Error) {
      return error;
    }

    // Normalize HTTP response-like errors through the error factory so that
    // all thrown errors are instances of SDK error classes.
    if (error && typeof error === 'object') {
      const candidate = error as { status?: number; statusCode?: number; body?: unknown; data?: unknown; requestId?: string; headers?: Record<string, string> };
      const status = candidate.status ?? candidate.statusCode;
      if (typeof status === 'number') {
        return createErrorFromResponse(
          status,
          candidate.body ?? candidate.data,
          candidate.requestId,
          candidate.headers,
        );
      }
    }

    return new Error(String(error));
  }

  /**
   * Check if error is retryable
   *
   * Note: no error class exposes a dedicated `retryable` property at
   * this time; retryability is derived from `statusCode`. See follow-up
   * issue for adding a first-class `retryable` flag.
   */
  static isRetryable(error: unknown): boolean {
    if (error instanceof DorisioError) {
      // Retry on server errors (5xx) and rate limits (429)
      return error.statusCode >= 500 || error.statusCode === 429;
    }

    if (error instanceof ApiError && error.statusCode) {
      return error.statusCode >= 500 || error.statusCode === 429;
    }

    if (isNetworkError(error)) {
      return true;
    }

    return false;
  }

  /**
   * @deprecated kept for backwards compatibility; see isRetryable above.
   */
  static _legacyIsRetryable(error: unknown): boolean {
    if (error instanceof DorisioError && error.statusCode) {
      // Retry on server errors (5xx) and rate limits (429)
      return error.statusCode >= 500 || error.statusCode === 429;
    }

    if (error instanceof ApiError && error.statusCode) {
      return error.statusCode >= 500 || error.statusCode === 429;
    }

    if (isNetworkError(error)) {
      return true;
    }

    return false;
  }

  /**
   * Placeholder to keep the class body balanced.
   */
  static noop(): void {
    // no-op
  }

  /**
   * Format error message for display
   */
  static format(error: unknown): string {
    const handled = this.handle(error);

    if (handled instanceof DorisioError) {
      const prefix = handled.code ? `${handled.code}: ` : '';
      return `${prefix}${handled.message}`;
    }

    return handled.message || 'An unknown error occurred';
  }
}