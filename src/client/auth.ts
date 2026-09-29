/**
 * Authentication Methods
 *
 * SDK methods for session and token management.
 */

import { User } from '../types/models';
import { ApiSessionExpirySchema, ApiSessionSchema } from '../types/schemas';
import { normalizeUser } from '../utils/normalizers';
import { DorisioClient } from '../client';
import { RequestOptions } from '../http/http-client';

export interface SessionInfo {
  userId: string;
  email: string;
  token: string;
  expiresAt: string;
  expiresIn: number;
}

/**
 * Refresh user session and get new token
 * POST /auth/refresh
 *
 * @param options - Optional request options including custom HTTP headers
 * @returns SessionInfo with renewed authentication token
 *
 * @throws {Error} If session refresh fails or token is revoked
 *
 * @example
 * ```ts
 * const session = await client.refreshSession({
 *   headers: { 'X-Request-ID': 'session-refresh-01' },
 * });
 * console.log(`Session refreshed. Expires in: ${session.expiresIn}s`);
 * ```
 */
export async function refreshSession(
  this: DorisioClient,
  options?: Partial<RequestOptions>
): Promise<SessionInfo> {
  const response = options
    ? await this.request('POST', '/auth/refresh', undefined, options)
    : await this.request('POST', '/auth/refresh');

  if (!response.success || !response.data) {
    throw new Error('Failed to refresh session');
  }

  const parsed = ApiSessionSchema.parse(response.data);

  if (parsed.token) {
    this.setToken(parsed.token);
  }

  return {
    userId: parsed.userId,
    email: parsed.email,
    token: parsed.token,
    expiresAt: parsed.expiresAt,
    expiresIn: parsed.expiresIn,
  };
}

/**
 * Validate current session
 * GET /auth/validate
 *
 * @param options - Optional request options including custom HTTP headers
 * @returns Current authenticated User record
 *
 * @throws {Error} If session is invalid or expired
 *
 * @example
 * ```ts
 * try {
 *   const user = await client.validateSession();
 *   console.log('Session valid for:', user.email);
 * } catch (err) {
 *   console.error('Session expired, please log in again');
 * }
 * ```
 */
export async function validateSession(
  this: DorisioClient,
  options?: Partial<RequestOptions>
): Promise<User> {
  const response = options
    ? await this.request('GET', '/auth/validate', undefined, options)
    : await this.request('GET', '/auth/validate');

  if (!response.success || !response.data) {
    throw new Error('Invalid or expired session');
  }

  return normalizeUser(response.data);
}

/**
 * Get current user info
 * GET /users/me
 *
 * @param options - Optional request options including custom HTTP headers
 * @returns Authenticated user's profile details
 *
 * @throws {Error} If not authenticated or request fails
 *
 * @example
 * ```ts
 * const user = await client.getCurrentUser({
 *   headers: { 'X-Custom-Client': 'dorisio-web' },
 * });
 * console.log(`Current user: ${user.name} (${user.email})`);
 * ```
 */
export async function getCurrentUser(
  this: DorisioClient,
  options?: Partial<RequestOptions>
): Promise<User> {
  const response = options
    ? await this.request('GET', '/users/me', undefined, options)
    : await this.request('GET', '/users/me');

  if (!response.success || !response.data) {
    throw new Error('Failed to fetch current user');
  }

  return normalizeUser(response.data);
}

/**
 * Logout and invalidate session
 * POST /auth/logout
 *
 * @param options - Optional request options including custom HTTP headers
 *
 * @example
 * ```ts
 * await client.logout();
 * console.log('Successfully logged out and cleared token');
 * ```
 */
export async function logout(
  this: DorisioClient,
  options?: Partial<RequestOptions>
): Promise<void> {
  try {
    if (options) {
      await this.request('POST', '/auth/logout', undefined, options);
    } else {
      await this.request('POST', '/auth/logout');
    }
  } finally {
    this.clearToken();
  }
}

/**
 * Check if user is authenticated
 *
 * @param options - Optional request options including custom HTTP headers
 * @returns True if session is valid and active, false otherwise
 *
 * @example
 * ```ts
 * const loggedIn = await client.isAuthenticated();
 * if (!loggedIn) {
 *   router.push('/login');
 * }
 * ```
 */
export async function isAuthenticated(
  this: DorisioClient,
  options?: Partial<RequestOptions>
): Promise<boolean> {
  try {
    await this.validateSession(options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extend session expiry (keep-alive)
 * POST /auth/extend
 *
 * @param options - Optional request options including custom HTTP headers
 * @returns Updated SessionInfo with new expiry timestamp
 *
 * @throws {Error} If session extension fails
 *
 * @example
 * ```ts
 * const session = await client.extendSession();
 * console.log(`Session extended to: ${session.expiresAt}`);
 * ```
 */
export async function extendSession(
  this: DorisioClient,
  options?: Partial<RequestOptions>
): Promise<SessionInfo> {
  const response = options
    ? await this.request('POST', '/auth/extend', undefined, options)
    : await this.request('POST', '/auth/extend');

  if (!response.success || !response.data) {
    throw new Error('Failed to extend session');
  }

  const parsed = ApiSessionSchema.parse(response.data);

  if (parsed.token) {
    this.setToken(parsed.token);
  }

  return {
    userId: parsed.userId,
    email: parsed.email,
    token: parsed.token,
    expiresAt: parsed.expiresAt,
    expiresIn: parsed.expiresIn,
  };
}

/**
 * Get session expiry time
 * GET /auth/expiry
 *
 * @param options - Optional request options including custom HTTP headers
 * @returns Expiry details and expiration boolean
 *
 * @throws {Error} If session expiry lookup fails
 *
 * @example
 * ```ts
 * const { expiresIn, isExpired } = await client.getSessionExpiry();
 * if (expiresIn < 300) {
 *   await client.refreshSession();
 * }
 * ```
 */
export async function getSessionExpiry(
  this: DorisioClient,
  options?: Partial<RequestOptions>
): Promise<{
  expiresAt: string;
  expiresIn: number;
  isExpired: boolean;
}> {
  const response = options
    ? await this.request('GET', '/auth/expiry', undefined, options)
    : await this.request('GET', '/auth/expiry');

  if (!response.success || !response.data) {
    throw new Error('Failed to fetch session expiry');
  }

  const parsed = ApiSessionExpirySchema.parse(response.data);
  const expiresIn = Math.max(0, parsed.expiresIn);

  return {
    expiresAt: parsed.expiresAt,
    expiresIn,
    isExpired: expiresIn === 0,
  };
}
