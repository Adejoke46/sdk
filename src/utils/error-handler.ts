/**
 * Error Handler
 *
 * Utilities for handling and normalizing errors.
 */

import {
  DorisioError,
} from '../types/errors';


export class ApiErrorHandler {
  /**
   * Handle and normalize API errors
   */
  static handle(error: unknown): Error {
    if (error instanceof DorisioError) {
      return error;
    }

    if (error instanceof Error) {
      return error;
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
