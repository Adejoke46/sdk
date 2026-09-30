/**
 * Response Normalizer
 *
 * Normalizes and transforms API responses into a consistent format.
 */

import { ApiResponse } from '../types';

export class ResponseNormalizer {
  /**
   * Normalize API response
   */
  static normalize<T>(response: unknown): ApiResponse<T> {
    if (!response || typeof response !== 'object') {
      return {
        success: false,
        error: {
          message: 'Invalid response format',
          code: 'INVALID_RESPONSE',
        },
        timestamp: new Date().toISOString(),
      };
    }

    const obj = response as Record<string, unknown>;

    // Already normalized
    if ('success' in obj && 'timestamp' in obj) {
      return obj as unknown as ApiResponse<T>;
    }

    // Assume data if no success field
    return {
      success: true,
      data: obj as T,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Extract data from response
   */
  static extractData<T>(response: ApiResponse<T> | null | undefined): T {
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response format');
    }

    if (!response.success) {
      throw new Error(response.error?.message || 'Response failed');
    }

    if (response.data == null) {
      throw new Error('No data in response');
    }

    return response.data;
  }

  /**
   * Check if response indicates success
   */
  static isSuccess(response: unknown): boolean {
    if (typeof response === 'object' && response !== null) {
      const obj = response as Record<string, unknown>;
      return obj.success === true || !('success' in obj);
    }

    return false;
  }
}
