/**
 * Transaction Methods
 *
 * SDK methods for transaction and tip operations.
 * Aligned with backend payment routes from /api/v1/transactions/*
 */

import { Transaction, TransactionHistory } from '../types/models';
import { normalizeTransaction, normalizeTransactionHistory } from '../utils/normalizers';
import { DorisioClient } from '../client';
import { RequestValidator } from '../utils/validators';
import type { RequestOptions } from '../http/http-client';

export interface CreateTipRequest {
  creatorId: string;
  amount: number;
  message?: string;
  /**
   * Idempotency key for safe retries (prevents double-charging)
   * Should be a unique UUID generated per transaction attempt
   * If the same key is reused, the API returns the previously created tip
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

export interface BuildTransactionRequest {
  senderPublicKey: string;
  creatorPublicKey: string;
  amount: string;
  assetCode?: string;
  assetIssuer?: string;
}

export interface SubmitTransactionRequest {
  transactionEnvelope: string;
}

export interface BuildTransactionResponse {
  transactionEnvelope: string;
  tipId: string;
  fee: number;
}

export interface SubmitTransactionResponse {
  tipId: string;
  transactionHash: string;
  status: string;
}

/**
 * Create a tip transaction (initial step before payment)
 * POST /api/v1/transactions/tip
 *
 * Creates a new tip record with optional idempotency support.
 * Idempotency keys ensure that retrying a request with the same key
 * returns the same tip instead of creating duplicates (preventing double-charging).
 *
 * Validates:
 * - Amount is positive
 * - Creator exists and is public and verified
 * - Sender has a verified wallet
 *
 * @param data - Tip creation request
 * @param data.creatorId - The creator receiving the tip (UUID)
 * @param data.amount - Tip amount in USD (must be > 0)
 * @param data.message - Optional message to include with the tip (max 500 chars)
 * @param data.idempotencyKey - Optional UUID for idempotent retries
 *
 * @returns The created tip transaction
 *
 * @throws Will throw if creator doesn't exist, amount is invalid, or wallet not verified
 *
 * @example
 * ```ts
 * import { v4 as uuidv4 } from 'uuid';
 *
 * // Safe to retry with same key
 * const idempotencyKey = uuidv4();
 *
 * const tip = await client.createTip({
 *   creatorId: '550e8400-e29b-41d4-a716-446655440000',
 *   amount: 50,
 *   message: 'Great content!',
 *   idempotencyKey,
 * });
 *
 * console.log(tip.id);
 * ```
 */
export async function createTip(
  this: DorisioClient,
  data: CreateTipRequest,
  options?: Partial<RequestOptions>
): Promise<Transaction> {
  RequestValidator.required(data, 'tip data');
  RequestValidator.required(data.creatorId, 'Creator ID');
  RequestValidator.nonEmptyString(data.creatorId, 'creatorId');
  RequestValidator.positiveNumber(data.amount, 'Tip amount');
  if (data.message !== undefined) RequestValidator.stringLength(data.message, 1, 500, 'message');

  const headers: Record<string, string> = {};
  if (data.idempotencyKey) {
    headers['Idempotency-Key'] = data.idempotencyKey;
  }

  const response = await this.request(
    'POST',
    '/api/v1/transactions/tip',
    {
      creatorId: data.creatorId,
      amount: data.amount,
      message: data.message || undefined,
      timezone: data.timezone,
      metadata: data.metadata,
      tags: data.tags,
    },
    { headers, methodName: 'createTip', ...options }
  );

  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Failed to create tip');
  }

  return normalizeTransaction(response.data);
}

/**
 * Get transaction status
 * GET /api/v1/transactions/:id
 *
 * Retrieves the current status of a tip transaction.
 *
 * @param transactionId - The transaction ID (UUID)
 * @returns The transaction details including status
 *
 * @throws Will throw if transaction not found or user doesn't have permission
 *
 * @example
 * ```ts
 * const transaction = await client.getTipStatus('tx-id-123');
 * console.log(transaction.status); // 'pending' | 'confirmed' | 'failed'
 * ```
 */
export async function getTipStatus(
  this: DorisioClient,
  transactionId: string
): Promise<Transaction> {
  RequestValidator.nonEmptyString(transactionId, 'transactionId');
  const response = await this.request('GET', `/api/v1/transactions/${transactionId}`);

  if (!response.success || !response.data) {
    throw new Error(response.error?.message || `Failed to fetch transaction: ${transactionId}`);
  }

  return normalizeTransaction(response.data);
}

/**
 * Get user's tip history (tips they sent)
 * GET /api/v1/transactions/history
 *
 * Retrieves paginated history of tips sent by the current user.
 *
 * @param options - Query options
 * @param options.page - Page number (1-indexed, default: 1)
 * @param options.pageSize - Results per page (default: 20, max: 100)
 *
 * @returns Paginated transaction history
 *
 * @example
 * ```ts
 * const history = await client.getTransactionHistory({
 *   page: 1,
 *   pageSize: 10,
 * });
 *
 * console.log(`Total tips sent: ${history.total}`);
 * history.transactions.forEach(tx => {
 *   console.log(`$${tx.amount} to creator ${tx.creatorId}`);
 * });
 * ```
 */
export async function getTransactionHistory(
  this: DorisioClient,
  options?: {
    page?: number;
    pageSize?: number;
  }
): Promise<TransactionHistory> {
  if (options?.page !== undefined && options.page < 1) throw new Error('page must be at least 1');
  if (options?.pageSize !== undefined && (options.pageSize < 1 || options.pageSize > 100)) {
    throw new Error('pageSize must be between 1 and 100');
  }
  const params = new URLSearchParams();

  if (options?.page) params.append('page', String(options.page));
  if (options?.pageSize) params.append('pageSize', String(options.pageSize));

  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await this.request('GET', `/api/v1/transactions/history${query}`);

  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Failed to fetch transaction history');
  }

  return normalizeTransactionHistory(response.data);
}

/**
 * Get tips received by a creator
 * GET /api/v1/transactions/creator/:creatorId
 */
export async function getCreatorTipsReceived(
  this: DorisioClient,
  creatorId: string,
  options?: {
    page?: number;
    pageSize?: number;
  }
): Promise<TransactionHistory> {
  const params = new URLSearchParams();
  if (options?.page) params.append('page', String(options.page));
  if (options?.pageSize) params.append('pageSize', String(options.pageSize));

  const query = params.toString() ? `?${params.toString()}` : '';
  const response = await this.request('GET', `/api/v1/transactions/creator/${creatorId}${query}`);

  if (!response.success || !response.data) {
    throw new Error(
      response.error?.message || `Failed to fetch tips received by creator: ${creatorId}`
    );
  }

  return normalizeTransactionHistory(response.data);
}

/**
 * Build a Stellar payment transaction for frontend signing
 * POST /api/v1/transactions/:id/build
 *
 * Constructs an unsigned Stellar transaction that the user signs with their wallet.
 * The transaction is returned as an XDR envelope string that can be signed by Freighter or other Stellar wallets.
 *
 * @param tipId - The tip transaction ID (UUID)
 * @param data - Transaction building parameters
 * @param data.senderPublicKey - The sender's Stellar public key
 * @param data.creatorPublicKey - The creator's Stellar public key
 * @param data.amount - Payment amount in XLM
 * @param data.assetCode - Optional: Custom asset code (default: native XLM)
 * @param data.assetIssuer - Optional: Custom asset issuer address
 *
 * @returns Unsigned transaction ready for signing
 *
 * @throws Will throw if tip not found or parameters invalid
 *
 * @example
 * ```ts
 * const built = await client.buildPaymentTransaction('tip-123', {
 *   senderPublicKey: userWalletAddress,
 *   creatorPublicKey: creatorWalletAddress,
 *   amount: '50.00',
 * });
 *
 * // User signs with Freighter wallet
 * const signed = await window.stellar.signTransaction(built.transactionEnvelope);
 * ```
 */
export async function buildPaymentTransaction(
  this: DorisioClient,
  tipId: string,
  data: BuildTransactionRequest,
  options?: Partial<RequestOptions>
): Promise<BuildTransactionResponse> {
  const response = await this.request(
    'POST',
    `/api/v1/transactions/${tipId}/build`,
    {
      senderPublicKey: data.senderPublicKey,
      creatorPublicKey: data.creatorPublicKey,
      amount: data.amount,
      assetCode: data.assetCode,
      assetIssuer: data.assetIssuer,
    },
    { methodName: 'buildPaymentTransaction', ...options }
  );

  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Failed to build payment transaction');
  }

  return response.data as BuildTransactionResponse;
}

/**
 * Submit a signed payment transaction to Stellar network
 * POST /api/v1/transactions/:id/submit
 *
 * Sends a user-signed transaction to the Stellar network through Horizon.
 * The transaction must be signed by the sender's wallet before calling this.
 *
 * @param tipId - The tip transaction ID (UUID)
 * @param data - Submission parameters
 * @param data.transactionEnvelope - The signed transaction XDR envelope
 *
 * @returns Submission response with transaction hash
 *
 * @throws Will throw if transaction is invalid, already submitted, or network fails
 *
 * @example
 * ```ts
 * const signed = await window.stellar.signTransaction(envelope);
 *
 * const result = await client.submitPaymentTransaction('tip-123', {
 *   transactionEnvelope: signed.xdr,
 * });
 *
 * console.log('Submitted to network:', result.transactionHash);
 * ```
 */
export async function submitPaymentTransaction(
  this: DorisioClient,
  tipId: string,
  data: SubmitTransactionRequest,
  options?: Partial<RequestOptions>
): Promise<SubmitTransactionResponse> {
  if (!data.transactionEnvelope) {
    throw new Error('Signed transaction envelope is required');
  }

  const response = await this.request(
    'POST',
    `/api/v1/transactions/${tipId}/submit`,
    {
      transactionEnvelope: data.transactionEnvelope,
    },
    { methodName: 'submitPaymentTransaction', ...options }
  );

  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Failed to submit payment transaction');
  }

  return response.data as SubmitTransactionResponse;
}

/**
 * Check transaction confirmation status
 * GET /api/v1/transactions/:id/confirm
 *
 * Polls Horizon to verify if transaction has been confirmed on the Stellar network.
 * Use this after submitting a transaction to confirm it was successfully processed.
 *
 * @param tipId - The tip transaction ID (UUID)
 * @returns The transaction with updated confirmation status
 *
 * @throws Will throw if transaction not found
 *
 * @example
 * ```ts
 * // After submitting transaction
 * const confirmed = await client.checkTransactionConfirmation('tip-123');
 *
 * if (confirmed.status === 'confirmed') {
 *   console.log('Payment successful!');
 * }
 * ```
 */
export async function checkTransactionConfirmation(
  this: DorisioClient,
  tipId: string,
  options?: Partial<RequestOptions>
): Promise<Transaction> {
  const response = options
    ? await this.request(
        'GET',
        `/api/v1/transactions/${tipId}/confirm`,
        undefined,
        { methodName: 'checkTransactionConfirmation', ...options }
      )
    : await this.request('GET', `/api/v1/transactions/${tipId}/confirm`);

  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Failed to check transaction confirmation');
  }

  return normalizeTransaction(response.data);
}

/**
 * Update tip status (typically used by backend confirmation service)
 * PATCH /api/v1/transactions/:id/status
 */
export async function updateTipStatus(
  this: DorisioClient,
  tipId: string,
  status: 'pending' | 'completed' | 'failed' | 'cancelled'
): Promise<Transaction> {
  const response = await this.request('PATCH', `/api/v1/transactions/${tipId}/status`, {
    status,
  });

  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Failed to update tip status');
  }

  return normalizeTransaction(response.data);
}
