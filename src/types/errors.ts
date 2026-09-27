/**
 * Base error class for all SDK errors
 */
export class DorisioError extends Error {
  public readonly statusCode?: number;
  public readonly code?: string;

  constructor(message: string, statusCode?: number, code?: string) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Authentication-related errors
 */
export class AuthError extends DorisioError {
  constructor(message: string, statusCode?: number, code?: string) {
    super(message, statusCode, code);
    this.name = 'AuthError';
  }
}

/**
 * Wallet verification and linking errors
 */
export class WalletVerificationError extends DorisioError {
  public readonly challenge?: string;

  constructor(message: string, statusCode?: number, code?: string, challenge?: string) {
    super(message, statusCode, code);
    this.name = 'WalletVerificationError';
    this.challenge = challenge;
  }
}

/**
 * Payment processing errors
 */
export class PaymentError extends DorisioError {
  public readonly transactionHash?: string;

  constructor(message: string, statusCode?: number, code?: string, transactionHash?: string) {
    super(message, statusCode, code);
    this.name = 'PaymentError';
    this.transactionHash = transactionHash;
  }
}

/**
 * Validation errors for SDK inputs
 */
export class ValidationError extends DorisioError {
  public readonly details?: Record<string, any>;

  constructor(message: string, details?: Record<string, any>) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.details = details;
  }
}

/**
 * Rate limiting errors
 */
export class RateLimitError extends DorisioError {
  public readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message, 429, 'RATE_LIMITED');
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Network/timeout errors
 */
export class TimeoutError extends DorisioError {
  constructor(message: string = 'Request timeout', _timeoutMs?: number) {
    super(message, 408, 'TIMEOUT');
    this.name = 'TimeoutError';
  }
}

/**
 * Error handler context information
 */
export interface ErrorHandlerContext {
  /** The request method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The request path */
  path: string;
  /** The request body (if any) */
  body?: unknown;
  /** Request headers */
  headers?: Record<string, string>;
  /** Current retry attempt number */
  attempt?: number;
  /** Request ID for tracking */
  requestId?: string;
}

/**
 * Error handler action result
 */
export type ErrorHandlerAction =
  | { action: 'retry'; delayMs?: number }
  | { action: 'fallback'; fallbackValue: unknown }
  | { action: 'throw' };

/**
 * Error handler function signature
 */
export type ErrorHandler = (
  error: DorisioError,
  context: ErrorHandlerContext
) => ErrorHandlerAction | Promise<ErrorHandlerAction>;

/**
 * Middleware context for request/response transformation
 */
export interface MiddlewareContext {
  /** The request method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** The request path */
  path: string;
  /** The request body (if any) */
  body?: unknown;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request ID for tracking */
  requestId?: string;
}

/**
 * Middleware function signature for request/response transformation
 */
export type Middleware = (
  context: MiddlewareContext,
  next: () => Promise<unknown>
) => Promise<unknown>;

/**
 * Legacy error classes (for backward compatibility)
 */
export class ApiError extends DorisioError {
  public readonly retryAfter?: number;

  constructor(message: string, statusCode?: number, code?: string, retryAfter?: number) {
    super(message, statusCode, code);
    this.name = 'ApiError';
    this.retryAfter = retryAfter;
  }
}

export class AuthenticationError extends DorisioError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends DorisioError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends DorisioError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class NetworkError extends DorisioError {
  constructor(message: string = 'Network error') {
    super(message, 0, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }
}
