// @ts-nocheck
/**
 * API Error Factory
 *
 * Creates and normalizes API errors.
 *
 * HTTP status -> error class mapping:
 *  - 400 -> ValidationError (code: VALIDATION_ERROR)
 *  - 401 -> AuthenticationError (code: UNDEFINED)
 *  - 403 -> AuthorizationError (code: FORBIDDEN)
 *  - 404 -> NotFoundError (code: NOT_FOUND)
 *  - 408 -> TimeoutError (code: TIMEOUT)
 *  - 429 -> RateLimitError (code: RATE_LIMITED)
 *  - 500/502/503/504 -> ApiError (code: SERVER_ERROR)
 *  - other -> ApiError (code: API_ERROR)
 *
 * Note: All error classes extend DorisioError, so consumers can catch
 * the base class or any specific subclass.
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import {
  DorisioError,
  ApiError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  NetworkError,
  TimeoutError,
  RateLimitError,
} from '../types/errors';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface ErrorResponse {
  error?: string;
  code?: string;
  details?: Record<string, string>;
  message?: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class ApiErrorFactory {
  /**
   * Create error from HTTP status and response
   */
  static fromHttpError(status: number, response?: ErrorResponse): DorisioError {
    switch (status) {
      case 400:
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return new ValidationError(
          response?.error || response?.message || 'Bad request',
          response?.details
        );
      case 401:
        return new AuthenticationError(response?.error || response?.message);
      case 403:
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return new AuthorizationError(response?.error || response?.message);
      case 404:
        return new NotFoundError(response?.error || response?.message);
      case 408:
        return new TimeoutError(response?.error || response?.message || 'Request timeout');
      case 429:
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        return new RateLimitError(response?.error || response?.message || 'Too many requests');
      case 500:
      case 502:
      case 503:
      case 504:
        return new ApiError(
          response?.error || response?.message || 'Server error',
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          status,
          response?.code || 'SERVER_ERROR'
        );
      default:
        return new ApiError(
          response?.error || response?.message || 'API error',
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          status,
          response?.code || 'API_ERROR'
        );
    }
  }

  /**
   * Create error from network error
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static fromNetworkError(error: Error): DorisioError {
    if (error.message.includes('timeout') || error.message.includes('AbortError')) {
      return new TimeoutError(error.message || 'Request timeout');
    }

    if (error.message.includes('fetch') || error.message.includes('network')) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      return new NetworkError(error.message);
    }

    if (error instanceof DorisioError) {
      return error;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return new ApiError(error.message, 0, 'UNKNOWN_ERROR');
  }

  /**
   * Normalize any error to a DorisioError or Error
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static normalize(error: unknown): DorisioError | Error {
    if (error instanceof DorisioError) {
      return error;
    }

    if (error instanceof Error) {
      return this.fromNetworkError(error);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return new Error(String(error));
  }

  /**
   * Format error for logging
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static format(error: unknown): string {
    const normalized = this.normalize(error);

    if (normalized instanceof DorisioError) {
      const code = normalized.code ? `[${normalized.code}]` : '';
      const status = normalized.statusCode !== undefined ? `(${normalized.statusCode})` : '';
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      return `${code}${status} ${normalized.message}`.trim();
    }

    return normalized.message;
  }
}

// @ts-nocheck
