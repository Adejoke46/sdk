/**
 * Request Schemas
 *
 * Request payload types for API operations.
 */

/**
 * Authentication requests
 */
export interface SignupRequest {
  email: string;
  password: string;
  name?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Tip/Payment requests
 */
export interface CreateTipRequest {
  creatorId: string;
  amount: number;
  message?: string;
  /**
   * Idempotency key for safe retries (prevents double-charging).
   * Should be a unique UUID generated per transaction attempt.
   */
  idempotencyKey?: string;
  /**
   * IANA timezone string for the sender (e.g. "America/New_York").
   * Used for accurate date/time display in receipts.
   */
  timezone?: string;
  /**
   * Arbitrary key-value metadata to attach to the transaction.
   */
  metadata?: Record<string, string>;
  /**
   * Tags for categorising the transaction (e.g. ["birthday", "milestone"]).
   */
  tags?: string[];
}

export interface TipRequest extends CreateTipRequest {
  // Alias for clarity
}

/**
 * Pagination requests
 */
export interface PaginatedRequest {
  page?: number;
  pageSize?: number;
}

/**
 * Search/Filter requests
 */
export interface SearchCreatorRequest extends PaginatedRequest {
  query?: string;
  verified?: boolean;
  isPublic?: boolean;
}

export interface GetTransactionsRequest extends PaginatedRequest {
  status?: 'pending' | 'confirmed' | 'failed';
  creatorId?: string;
}

/**
 * Batch requests
 */
export interface BatchTipRequest {
  tips: CreateTipRequest[];
}
