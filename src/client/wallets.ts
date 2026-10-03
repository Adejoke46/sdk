/**
 * Wallet Methods
 *
 * SDK methods for wallet operations.
 */

import { Wallet, CreateWalletRequest, UpdateWalletRequest } from '../types/models';
import { normalizeWallet, normalizeWallets } from '../utils/normalizers';
import { DorisioClient } from '../client';
import { RequestValidator } from '../utils/validators';
import { RequestOptions } from '../http/http-client';

/**
 * Connect a wallet to user account
 * POST /wallets
 *
 * Connects a Stellar wallet public key to the authenticated user account.
 *
 * @param data - Wallet connection request details
 * @param data.publicKey - Stellar public key (G...)
 * @param data.nickname - Optional user-friendly nickname for the wallet
 * @param options - Optional request options including custom HTTP headers
 * @returns The connected wallet record
 *
 * @throws {Error} If publicKey is missing or request fails
 *
 * @example
 * ```ts
 * const wallet = await client.connectWallet(
 *   {
 *     publicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYEMPLJ3DPWFUBNKMMM',
 *     nickname: 'My Primary Wallet',
 *   },
 *   { headers: { 'X-Request-ID': 'connect-wallet-01' } }
 * );
 * console.log('Connected wallet:', wallet.id);
 * ```
 */
export async function connectWallet(
  this: DorisioClient,
  data: CreateWalletRequest,
  options?: Partial<RequestOptions>
): Promise<Wallet> {
  RequestValidator.required(data, 'wallet data');
  RequestValidator.nonEmptyString(data.publicKey, 'publicKey');
  const response = options
    ? await this.request('POST', '/wallets', data, options)
    : await this.request('POST', '/wallets', data);

  if (!response.success || !response.data) {
    throw new Error('Failed to connect wallet');
  }

  return normalizeWallet(response.data);
}

/**
 * Disconnect a wallet from user account
 * DELETE /wallets/:id
 *
 * Removes a connected wallet from the authenticated user's account.
 *
 * @param walletId - Unique wallet identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 *
 * @throws {Error} If walletId is empty or disconnection fails
 *
 * @example
 * ```ts
 * await client.disconnectWallet('wallet-123', {
 *   headers: { 'X-Audit-Reason': 'user-requested-removal' },
 * });
 * console.log('Wallet disconnected');
 * ```
 */
export async function disconnectWallet(
  this: DorisioClient,
  walletId: string,
  options?: Partial<RequestOptions>
): Promise<void> {
  RequestValidator.nonEmptyString(walletId, 'walletId');
  const response = options
    ? await this.request('DELETE', `/wallets/${walletId}`, undefined, options)
    : await this.request('DELETE', `/wallets/${walletId}`);

  if (!response.success) {
    throw new Error(`Failed to disconnect wallet: ${walletId}`);
  }
}

/**
 * Get user's wallets
 * GET /users/:userId/wallets
 *
 * Retrieves all connected wallets for a specified user ID.
 *
 * @param userId - Unique user identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 * @returns List of connected wallets
 *
 * @throws {Error} If userId is empty or request fails
 *
 * @example
 * ```ts
 * const wallets = await client.getWallets('user-456', {
 *   headers: { 'X-Custom-Client': 'dorisio-mobile' },
 * });
 * console.log(`User has ${wallets.length} wallets`);
 * ```
 */
export async function getWallets(
  this: DorisioClient,
  userId: string,
  options?: Partial<RequestOptions>
): Promise<Wallet[]> {
  RequestValidator.nonEmptyString(userId, 'userId');
  const response = options
    ? await this.request('GET', `/users/${userId}/wallets`, undefined, options)
    : await this.request('GET', `/users/${userId}/wallets`);

  if (!response.success || !response.data) {
    throw new Error(`Failed to fetch wallets for user: ${userId}`);
  }

  return normalizeWallets(Array.isArray(response.data) ? response.data : []);
}

/**
 * Get wallet by ID
 * GET /wallets/:id
 *
 * Retrieves a single wallet by its unique ID.
 *
 * @param walletId - Unique wallet identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 * @returns Wallet record
 *
 * @throws {Error} If walletId is empty or not found
 *
 * @example
 * ```ts
 * const wallet = await client.getWallet('wallet-123');
 * console.log(wallet.publicKey, wallet.isVerified);
 * ```
 */
export async function getWallet(
  this: DorisioClient,
  walletId: string,
  options?: Partial<RequestOptions>
): Promise<Wallet> {
  RequestValidator.nonEmptyString(walletId, 'walletId');
  const response = options
    ? await this.request('GET', `/wallets/${walletId}`, undefined, options)
    : await this.request('GET', `/wallets/${walletId}`);

  if (!response.success || !response.data) {
    throw new Error(`Failed to fetch wallet: ${walletId}`);
  }

  return normalizeWallet(response.data);
}

/**
 * Update wallet details
 * PATCH /wallets/:id
 *
 * Updates wallet attributes such as nickname or default status.
 *
 * @param walletId - Unique wallet identifier (UUID)
 * @param data - Attributes to update
 * @param options - Optional request options including custom HTTP headers
 * @returns Updated wallet record
 *
 * @throws {Error} If walletId is empty or update fails
 *
 * @example
 * ```ts
 * const updated = await client.updateWallet('wallet-123', {
 *   nickname: 'Secondary Hot Wallet',
 * });
 * console.log('Updated wallet nickname:', updated.nickname);
 * ```
 */
export async function updateWallet(
  this: DorisioClient,
  walletId: string,
  data: UpdateWalletRequest,
  options?: Partial<RequestOptions>
): Promise<Wallet> {
  RequestValidator.nonEmptyString(walletId, 'walletId');
  const response = options
    ? await this.request('PATCH', `/wallets/${walletId}`, data, options)
    : await this.request('PATCH', `/wallets/${walletId}`, data);

  if (!response.success || !response.data) {
    throw new Error(`Failed to update wallet: ${walletId}`);
  }

  return normalizeWallet(response.data);
}

/**
 * Verify wallet ownership (for Stellar wallets)
 * POST /wallets/:id/verify
 *
 * Triggers signature verification on a connected Stellar wallet.
 *
 * @param walletId - Unique wallet identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 * @returns Verified wallet record
 *
 * @throws {Error} If verification fails
 *
 * @example
 * ```ts
 * const verifiedWallet = await client.verifyWallet('wallet-123');
 * console.log('Wallet is verified:', verifiedWallet.isVerified);
 * ```
 */
export async function verifyWallet(
  this: DorisioClient,
  walletId: string,
  options?: Partial<RequestOptions>
): Promise<Wallet> {
  RequestValidator.nonEmptyString(walletId, 'walletId');
  const response = options
    ? await this.request('POST', `/wallets/${walletId}/verify`, undefined, options)
    : await this.request('POST', `/wallets/${walletId}/verify`);

  if (!response.success || !response.data) {
    throw new Error(`Failed to verify wallet: ${walletId}`);
  }

  return normalizeWallet(response.data);
}

/**
 * Get wallet balance
 * GET /wallets/:id/balance
 *
 * Retrieves the current balance for a specific wallet ID.
 *
 * @param walletId - Unique wallet identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 * @returns Balance numeric value
 *
 * @throws {Error} If wallet balance cannot be retrieved
 *
 * @example
 * ```ts
 * const balance = await client.getBalance('wallet-123');
 * console.log(`Current balance: $${balance}`);
 * ```
 */
export async function getBalance(
  this: DorisioClient,
  walletId: string,
  options?: Partial<RequestOptions>
): Promise<number> {
  const response = options
    ? await this.request('GET', `/wallets/${walletId}/balance`, undefined, options)
    : await this.request('GET', `/wallets/${walletId}/balance`);

  if (!response.success || response.data === undefined) {
    throw new Error(`Failed to fetch wallet balance: ${walletId}`);
  }

  return Number(response.data);
}
