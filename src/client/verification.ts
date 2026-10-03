/**
 * Verification Methods
 *
 * SDK methods for creator and wallet verification.
 */

import { Creator, Wallet } from '../types/models';
import {
  ApiVerificationStatusSchema,
  ApiWalletChallengeSchema,
} from '../types/schemas';
import { normalizeCreator, normalizeWallet } from '../utils/normalizers';
import { DorisioClient } from '../client';
import { RequestOptions } from '../http/http-client';

export interface VerificationStatus {
  verified: boolean;
  verifiedAt?: string;
  expiresAt?: string;
}

/**
 * Verify creator identity (requires proof/admin approval)
 * POST /creators/:creatorId/verify
 *
 * @param creatorId - Unique creator identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 * @returns Verified Creator record
 *
 * @throws {Error} If creator verification fails
 *
 * @example
 * ```ts
 * const creator = await client.verifyCreator('creator-123', {
 *   headers: { 'X-Admin-Token': 'admin-secret' },
 * });
 * console.log('Creator verified:', creator.verified);
 * ```
 */
export async function verifyCreator(
  this: DorisioClient,
  creatorId: string,
  options?: Partial<RequestOptions>
): Promise<Creator> {
  const response = options
    ? await this.request('POST', `/creators/${creatorId}/verify`, undefined, options)
    : await this.request('POST', `/creators/${creatorId}/verify`);

  if (!response.success || !response.data) {
    throw new Error(`Failed to verify creator: ${creatorId}`);
  }

  return normalizeCreator(response.data);
}

/**
 * Request creator verification (submits for review)
 * POST /creators/:creatorId/request-verification
 *
 * @param creatorId - Unique creator identifier (UUID)
 * @param data - Verification application payload
 * @param data.documentType - Type of verification document
 * @param data.documentUrl - Optional URL to document upload
 * @param data.description - Optional description or notes
 * @param options - Optional request options including custom HTTP headers
 * @returns VerificationStatus with pending/submitted review details
 *
 * @throws {Error} If request fails
 *
 * @example
 * ```ts
 * const status = await client.requestCreatorVerification('creator-123', {
 *   documentType: 'passport',
 *   documentUrl: 'https://storage.example.com/docs/passport.pdf',
 *   description: 'Passport verification submission',
 * });
 * console.log('Verification submitted:', status.verified);
 * ```
 */
export async function requestCreatorVerification(
  this: DorisioClient,
  creatorId: string,
  data: {
    documentType: string;
    documentUrl?: string;
    description?: string;
  },
  options?: Partial<RequestOptions>
): Promise<VerificationStatus> {
  const response = options
    ? await this.request(
        'POST',
        `/creators/${creatorId}/request-verification`,
        data,
        options
      )
    : await this.request(
        'POST',
        `/creators/${creatorId}/request-verification`,
        data
      );

  if (!response.success || !response.data) {
    throw new Error(`Failed to request verification for creator: ${creatorId}`);
  }

  const parsed = ApiVerificationStatusSchema.parse(response.data);
  return {
    verified: parsed.verified,
    verifiedAt: parsed.verifiedAt,
    expiresAt: parsed.expiresAt,
  };
}

/**
 * Get creator verification status
 * GET /creators/:creatorId/verification-status
 *
 * @param creatorId - Unique creator identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 * @returns Verification status and status state string
 *
 * @throws {Error} If request fails
 *
 * @example
 * ```ts
 * const status = await client.getCreatorVerificationStatus('creator-123');
 * console.log(`Creator status: ${status.status}, isVerified: ${status.verified}`);
 * ```
 */
export async function getCreatorVerificationStatus(
  this: DorisioClient,
  creatorId: string,
  options?: Partial<RequestOptions>
): Promise<VerificationStatus & { status: string }> {
  const response = options
    ? await this.request(
        'GET',
        `/creators/${creatorId}/verification-status`,
        undefined,
        options
      )
    : await this.request(
        'GET',
        `/creators/${creatorId}/verification-status`
      );

  if (!response.success || !response.data) {
    throw new Error(`Failed to fetch verification status for creator: ${creatorId}`);
  }

  const parsed = ApiVerificationStatusSchema.parse(response.data);
  return {
    verified: parsed.verified,
    verifiedAt: parsed.verifiedAt,
    expiresAt: parsed.expiresAt,
    status: parsed.status ?? 'unverified',
  };
}

/**
 * Verify wallet ownership (challenge/response)
 * POST /wallets/:walletId/verify
 *
 * @param walletId - Unique wallet identifier (UUID)
 * @param proof - Cryptographic signature proof
 * @param options - Optional request options including custom HTTP headers
 * @returns Verified Wallet record
 *
 * @throws {Error} If verification proof is invalid
 *
 * @example
 * ```ts
 * const wallet = await client.verifyWallet('wallet-123', 'signed-challenge-proof');
 * console.log('Wallet verified successfully:', wallet.isVerified);
 * ```
 */
export async function verifyWallet(
  this: DorisioClient,
  walletId: string,
  proof?: string,
  options?: Partial<RequestOptions>
): Promise<Wallet> {
  const body = proof !== undefined ? { proof } : undefined;
  const response = options
    ? await this.request(
        'POST',
        `/wallets/${walletId}/verify`,
        body,
        options
      )
    : (body !== undefined
        ? await this.request('POST', `/wallets/${walletId}/verify`, body)
        : await this.request('POST', `/wallets/${walletId}/verify`));

  if (!response.success || !response.data) {
    throw new Error(`Failed to verify wallet: ${walletId}`);
  }

  return normalizeWallet(response.data);
}

/**
 * Get wallet verification status
 * GET /wallets/:walletId/verification-status
 *
 * @param walletId - Unique wallet identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 * @returns Current verification state of the wallet
 *
 * @throws {Error} If request fails
 *
 * @example
 * ```ts
 * const status = await client.getWalletVerificationStatus('wallet-123');
 * console.log('Wallet is verified:', status.verified);
 * ```
 */
export async function getWalletVerificationStatus(
  this: DorisioClient,
  walletId: string,
  options?: Partial<RequestOptions>
): Promise<VerificationStatus> {
  const response = options
    ? await this.request(
        'GET',
        `/wallets/${walletId}/verification-status`,
        undefined,
        options
      )
    : await this.request(
        'GET',
        `/wallets/${walletId}/verification-status`
      );

  if (!response.success || !response.data) {
    throw new Error(`Failed to fetch verification status for wallet: ${walletId}`);
  }

  const parsed = ApiVerificationStatusSchema.parse(response.data);
  return {
    verified: parsed.verified,
    verifiedAt: parsed.verifiedAt,
    expiresAt: parsed.expiresAt,
  };
}

/**
 * Request wallet verification challenge
 * POST /wallets/:walletId/verification-challenge
 *
 * @param walletId - Unique wallet identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 * @returns Challenge string and expiration duration in seconds
 *
 * @throws {Error} If challenge request fails
 *
 * @example
 * ```ts
 * const { challenge, expiresIn } = await client.requestWalletVerificationChallenge('wallet-123');
 * console.log(`Sign challenge "${challenge}" within ${expiresIn}s`);
 * ```
 */
export async function requestWalletVerificationChallenge(
  this: DorisioClient,
  walletId: string,
  options?: Partial<RequestOptions>
): Promise<{ challenge: string; expiresIn: number }> {
  const response = options
    ? await this.request(
        'POST',
        `/wallets/${walletId}/verification-challenge`,
        undefined,
        options
      )
    : await this.request(
        'POST',
        `/wallets/${walletId}/verification-challenge`
      );

  if (!response.success || !response.data) {
    throw new Error(`Failed to request verification challenge for wallet: ${walletId}`);
  }

  const parsed = ApiWalletChallengeSchema.parse(response.data);
  return {
    challenge: parsed.challenge,
    expiresIn: parsed.expiresIn,
  };
}

/**
 * Check if transaction requires verification
 * GET /transactions/:transactionId/verified
 *
 * @param transactionId - Unique transaction identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 * @returns True if transaction is verified
 *
 * @throws {Error} If request fails
 *
 * @example
 * ```ts
 * const isVerified = await client.isTransactionVerified('tx-123');
 * console.log('Transaction verified:', isVerified);
 * ```
 */
export async function isTransactionVerified(
  this: DorisioClient,
  transactionId: string,
  options?: Partial<RequestOptions>
): Promise<boolean> {
  const response = options
    ? await this.request(
        'GET',
        `/transactions/${transactionId}/verified`,
        undefined,
        options
      )
    : await this.request(
        'GET',
        `/transactions/${transactionId}/verified`
      );

  if (!response.success || response.data === undefined) {
    throw new Error(`Failed to check verification status for transaction: ${transactionId}`);
  }

  return Boolean(response.data);
}
