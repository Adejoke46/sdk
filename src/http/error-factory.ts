/**
 * API Error Factory
 *
 * Creates and normalizes API errors.
 */

import {
  ApiError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  NetworkError,
  TimeoutError,
} from '../types';
import { isValidationError } from '../lib/errors/type-guards';

export interface ErrorResponse {
  error?: string;
  code?: string;
  details?: Record<string, string>;
  message?: string;
}

export class ApiErrorFactory {
  /**
   * Create error from HTTP status and response
   */
  static fromHttpError(status: number, response?: ErrorResponse): ApiError {
    switch (status) {
      case 400:
        return new ValidationError(
          response?.error || response?.message || 'Bad request',
          response?.details
        ) as unknown as ApiError;
      case 401:
        return new AuthenticationError(response?.error || response?.message);
      case 403:
        return new AuthorizationError(response?.error || response?.message);
      case 404:
        return new NotFoundError(response?.error || 'Resource');
      case 408:
        return new TimeoutError(response?.error || 'Request timeout') as unknown as ApiError;
      case 429:
        return new ApiError(response?.error || 'Too many requests', 429, 'RATE_LIMITED');
      case 500:
      case 502:
      case 503:
      case 504:
        return new ApiError(
          response?.error || 'Server error',
          status,
          response?.code || 'SERVER_ERROR'
        );
      default:
        return new ApiError(response?.error || 'API error', status, response?.code || 'API_ERROR');
    }
  }

  /**
   * Create error from network error
   */
  static fromNetworkError(error: Error): Error {
    if (error.message.includes('timeout') || error.message.includes('AbortError')) {
      return new TimeoutError(error.message || 'Request timeout');
    }

    if (error.message.includes('fetch') || error.message.includes('network')) {
      return new NetworkError(error.message);
    }

    return error;
  }

  /**
   * Normalize any error to ApiError or Error
   */
  static normalize(error: unknown): ApiError | Error {
    if (error instanceof ApiError || isValidationError(error)) {
      return error;
    }

    if (error instanceof Error) {
      return this.fromNetworkError(error);
    }

    return new Error(String(error));
  }

  /**
   * Format error for logging
   */
  static format(error: unknown): string {
    const normalized = this.normalize(error);

    if (normalized instanceof ApiError) {
      return `[${normalized.code}] (${normalized.statusCode}) ${normalized.message}`;
    }

    if (isValidationError(normalized)) {
      const details = normalized.details ? ` - ${JSON.stringify(normalized.details)}` : '';
      return `${normalized.message}${details}`;
    }

    return normalized.message;
  }
}
