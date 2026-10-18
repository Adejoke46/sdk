/**
 * Creator Methods
 *
 * SDK methods for creator operations.
 */

import { Creator, CreatorProfile } from '../types/models';
import { normalizeCreator, normalizeListCreatorsResponse } from '../utils/normalizers';
import { DorisioClient } from '../client';
import { RequestValidator } from '../utils/validators';
import { RequestOptions } from '../http/http-client';

/**
 * Get creator by ID
 * GET /creators/:id
 *
 * Retrieves details for a specific creator by their ID.
 *
 * @param creatorId - Unique creator identifier (UUID)
 * @param options - Optional request options including custom HTTP headers
 * @returns The creator model
 *
 * @throws {Error} If creatorId is empty or request fails
 *
 * @example
 * ```ts
 * const creator = await client.getCreator('550e8400-e29b-41d4-a716-446655440000', {
 *   headers: {
 *     'X-Request-ID': 'req-creator-lookup',
 *     'X-Custom-Header': 'custom-value',
 *   },
 * });
 * console.log(creator.name, creator.bio);
 * ```
 */
export async function getCreator(
  this: DorisioClient,
  creatorId: string,
  options?: Partial<RequestOptions>
): Promise<Creator> {
  RequestValidator.nonEmptyString(creatorId, 'creatorId');
  const response = options
    ? await this.request('GET', `/creators/${creatorId}`, undefined, options)
    : await this.request('GET', `/creators/${creatorId}`);

  if (!response.success || !response.data) {
    throw new Error(`Failed to fetch creator: ${creatorId}`);
  }

  return normalizeCreator(response.data);
}

/**
 * List creators with pagination
 * GET /creators
 *
 * Retrieves a paginated list of creators, optionally filtered by verification status.
 *
 * @param queryOptions - Pagination and filter parameters
 * @param queryOptions.page - Page number (1-indexed, default: 1)
 * @param queryOptions.pageSize - Results per page (default: 20)
 * @param queryOptions.verified - Filter by verified creator status
 * @param options - Optional request options including custom HTTP headers
 * @returns Paginated creator list with metadata
 *
 * @throws {Error} If request fails
 *
 * @example
 * ```ts
 * const result = await client.listCreators(
 *   { page: 1, pageSize: 10, verified: true },
 *   { headers: { 'X-Correlation-ID': 'cor-123' } }
 * );
 * console.log(`Total creators: ${result.total}`);
 * result.creators.forEach((creator) => console.log(creator.name));
 * ```
 */
export async function listCreators(
  this: DorisioClient,
  queryOptions?: {
    page?: number;
    pageSize?: number;
    verified?: boolean;
  },
  options?: Partial<RequestOptions>
): Promise<{ creators: Creator[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();

  if (queryOptions?.page) params.append('page', String(queryOptions.page));
  if (queryOptions?.pageSize) params.append('pageSize', String(queryOptions.pageSize));
  if (queryOptions?.verified !== undefined) params.append('verified', String(queryOptions.verified));

  const query = params.toString() ? `?${params.toString()}` : '';
  const response = options
    ? await this.request('GET', `/creators${query}`, undefined, options)
    : await this.request('GET', `/creators${query}`);

  if (!response.success || !response.data) {
    throw new Error('Failed to fetch creators list');
  }

  return normalizeListCreatorsResponse(response.data);
}

/**
 * Get public creator profile by username
 * GET /creators/profile/:username
 *
 * Retrieves the public profile and engagement statistics for a creator by username.
 *
 * @param username - The creator username (1-100 characters)
 * @param options - Optional request options including custom HTTP headers
 * @returns The creator profile including tipping statistics
 *
 * @throws {Error} If username is invalid or profile is not found
 *
 * @example
 * ```ts
 * const profile = await client.getCreatorProfile('alice', {
 *   headers: { 'X-Custom-Client': 'dorisio-web' },
 * });
 * console.log(`Tips received: ${profile.stats.totalTips}, Average: ${profile.stats.averageTip}`);
 * ```
 */
export async function getCreatorProfile(
  this: DorisioClient,
  username: string,
  options?: Partial<RequestOptions>
): Promise<CreatorProfile> {
  RequestValidator.nonEmptyString(username, 'username');
  RequestValidator.stringLength(username, 1, 100, 'username');
  const response = options
    ? await this.request('GET', `/creators/profile/${username}`, undefined, options)
    : await this.request('GET', `/creators/profile/${username}`);

  if (!response.success || !response.data) {
    throw new Error(`Failed to fetch creator profile: ${username}`);
  }

  const data = response.data as Record<string, unknown>;
  const creator = normalizeCreator(data);

  const rawStats = data['stats'];
  const stats =
    rawStats && typeof rawStats === 'object'
      ? (rawStats as { totalTips?: number; averageTip?: number; lastTipDate?: string | null })
      : undefined;

  return {
    ...creator,
    stats: {
      totalTips: stats?.totalTips ?? 0,
      averageTip: stats?.averageTip ?? 0,
      lastTipDate: stats?.lastTipDate ?? null,
    },
  };
}

/**
 * Verify creator identity (admin only)
 * PATCH /creators/:id/verify
 *
 * Updates the verification status for a creator account.
 *
 * @param creatorId - Unique creator identifier
 * @param verified - Target verification state
 * @param options - Optional request options including custom HTTP headers
 * @returns Updated creator record
 *
 * @throws {Error} If creator is not found or unauthorized
 *
 * @example
 * ```ts
 * const verifiedCreator = await client.verifyCreator('creator-123', true, {
 *   headers: { 'X-Admin-Audit': 'audit-event-789' },
 * });
 * console.log('Creator verified:', verifiedCreator.verified);
 * ```
 */
export async function verifyCreator(
  this: DorisioClient,
  creatorId: string,
  verified: boolean,
  options?: Partial<RequestOptions>
): Promise<Creator> {
  const response = options
    ? await this.request('PATCH', `/creators/${creatorId}/verify`, {
        verified,
      }, options)
    : await this.request('PATCH', `/creators/${creatorId}/verify`, {
        verified,
      });

  if (!response.success || !response.data) {
    throw new Error(`Failed to verify creator: ${creatorId}`);
  }

  return normalizeCreator(response.data);
}
