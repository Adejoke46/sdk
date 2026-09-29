/**
 * API Types
 *
 * Shared types for API requests and responses.
 */

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    message: string;
    code: string;
  };
  timestamp: string;
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> extends ApiResponse<T> {
  meta?: PaginationMeta;
}

/**
 * User entity
 */
export interface User {
  id: string;
  email: string;
  name: string | null;
  role: string;
  verified: boolean;
  createdAt: string;
}

/**
 * Creator entity
 */
export interface Creator {
  id: string;
  userId: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatar: string | null;
  verified: boolean;
  isPublic: boolean;
  totalEarnings: number;
  pendingBalance: number;
  createdAt: string;
}

/**
 * Transaction entity
 */
export interface Transaction {
  id: string;
  fromUserId: string;
  creatorId: string;
  amount: number;
  message: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Wallet entity
 */
export interface Wallet {
  id: string;
  userId: string;
  publicKey: string;
  name: string | null;
  verified: boolean;
  createdAt: string;
}

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before the circuit opens. Defaults to 5. */
  failureThreshold?: number;
  /** Time in milliseconds to wait before attempting recovery. Defaults to 60000. */
  resetTimeout?: number;
  /** Number of successful requests required in half-open state to close the circuit. Defaults to 1. */
  halfOpenRequests?: number;
}

/**
 * Circuit breaker state
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';
