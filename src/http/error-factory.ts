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
  AuthError,
  ValidationError,
  NotFoundError,
  RateLimitError,
  ServerError,
  NetworkError,
  TimeoutError,
} from '../types/errors';
import { isValidationError } from '../lib/errors/type-guards';
import { parseRateLimitHeaders } from './retry-manager';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface ErrorResponse {
  error?: string;
  code?: string;
  details?: Record<string, string>;
  message?: string;
}

export interface ErrorFactoryOptions {
  status: number;
  body?: ErrorResponse | string | null;
  requestId?: string;
  headers?: Headers | Record<string, string>;
}

export class ApiErrorFactory {
  /**
   * Create an SDK error from an HTTP status code, response body, and optional
   * request ID/headers.
   *
   * Mapping:
   * - 400 -> ValidationError
   * - 401 -> AuthError
   * - 403 -> AuthError
   * - 404 -> NotFoundError
   * - 408 -> TimeoutError
   * - 429 -> RateLimitError (parses Retry-After)
   * - 5xx -> ServerError
   * - any other -> NetworkError
   */
  static fromHttpError(
    status: number,
    response?: ErrorResponse | string | null,
    requestId?: string,
    headers?: Headers | Record<string, string>
  ): DorisioError {
    const body = this.normalizeBody(response);
    const message = body?.error || body?.message || this.defaultMessage(status);
    const code = body?.code;

    switch (status) {
      case 400:
        return new ValidationError(message, body?.details, requestId);
      case 401:
      case 403:
        return new AuthError(
          message,
          status,
          code || (status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN'),
          requestId
        );
      case 404:
        return new NotFoundError(message, requestId);
      case 408:
        return new TimeoutError(message, undefined, requestId);
      case 429: {
        const { retryAfter, rateLimit } = parseRateLimitHeaders(
          headers ? new Headers(headers) : undefined
        );
        return new RateLimitError(message, retryAfter, requestId, rateLimit);
      }
      default:
        if (status >= 500 && status < 600) {
          return new ServerError(message, status, code || 'SERVER_ERROR', requestId);
        }
        return new NetworkError(message, requestId);
    }
  }

  /**
   * Create error from network error.
   */
  static fromNetworkError(error: Error, requestId?: string): Error {
    if (error.message.includes('timeout') || error.message.includes('AbortError')) {
      return new TimeoutError(error.message || 'Request timeout', undefined, requestId);
    }

    if (error.message.includes('fetch') || error.message.includes('network')) {
      return new NetworkError(error.message, requestId);
    }

    if (error instanceof DorisioError) {
      return error;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return new ApiError(error.message, 0, 'UNKNOWN_ERROR');
  }

  /**
   * Normalize any error to an SDK error or Error.
   */
  static normalize(error: unknown, requestId?: string): DorisioError | Error {
    if (error instanceof DorisioError) {
      return error;
    }

    if (isValidationError(error)) {
      return error as unknown as DorisioError;
    }

    if (error instanceof Error) {
      return this.fromNetworkError(error, requestId);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return new Error(String(error));
  }

  /**
   * Format error for logging.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static format(error: unknown): string {
    const normalized = this.normalize(error);

    if (normalized instanceof DorisioError) {
      const prefix = normalized.code ? `[${normalized.code}] ` : '';
      const status = normalized.statusCode !== undefined ? `(${normalized.statusCode}) ` : '';
      return `${prefix}${status}${normalized.message}`;
    }

    if (isValidationError(normalized)) {
      const details = normalized.details ? ` - ${JSON.stringify(normalized.details)}` : '';
      return `${normalized.message}${details}`;
    }

    return normalized.message;
  }

  private static normalizeBody(response?: ErrorResponse | string | null): ErrorResponse | undefined {
    if (!response) {
      return undefined;
    }

    if (typeof response === 'string') {
      try {
        const parsed = JSON.parse(response);
        if (parsed && typeof parsed === 'object') {
          return parsed as ErrorResponse;
        }
        return { error: response };
      } catch {
        return { error: response };
      }
    }

    return response;
  }

  private static defaultMessage(status: number): string {
    switch (status) {
      case 400:
        return 'Bad request';
      case 401:
        return 'Authentication required';
      case 403:
        return 'Insufficient permissions';
      case 404:
        return 'Resource not found';
      case 408:
        return 'Request timeout';
      case 429:
        return 'Too many requests';
      default:
        return status >= 500 ? 'Server error' : 'API error';
    }
  }
}

export function createHttpError(options: ErrorFactoryOptions): DorisioError {
  return ApiErrorFactory.fromHttpError(
    options.status,
    options.body,
    options.requestId,
    options.headers
  );
}

// @ts-nocheck