/**
 * Creators Client Tests
 * Tests for creator-related SDK methods
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DorisioClient } from '../client';
import * as CreatorMethods from './creators';

describe('Creator Methods', () => {
  let client: DorisioClient;
  const mockRequest = vi.fn();

  beforeEach(() => {
    client = {
      request: mockRequest,
    } as any;

    // Bind methods
    client.getCreator = CreatorMethods.getCreator.bind(client);
    client.listCreators = CreatorMethods.listCreators.bind(client);
    client.getCreatorProfile = CreatorMethods.getCreatorProfile.bind(client);
    client.verifyCreator = CreatorMethods.verifyCreator.bind(client);

    mockRequest.mockClear();
  });

  describe('getCreator', () => {
    it('should fetch creator by ID', async () => {
      const mockCreator = {
        id: 'creator-123',
        userId: 'user-456',
        displayName: 'Alice',
        verified: true,
        createdAt: '2024-01-01T00:00:00Z',
      };

      mockRequest.mockResolvedValue({
        success: true,
        data: mockCreator,
      });

      const result = await client.getCreator('creator-123');

      expect(result).toBeDefined();
      expect(mockRequest).toHaveBeenCalledWith('GET', '/creators/creator-123');
    });

    it('should throw error if creator not found', async () => {
      mockRequest.mockResolvedValue({
        success: false,
        error: { message: 'Creator not found' },
      });

      await expect(client.getCreator('creator-invalid')).rejects.toThrow('Failed to fetch creator');
    });
  });

  describe('listCreators', () => {
    it('should list creators with default options', async () => {
      const mockResponse = {
        creators: [
          { id: 'creator-1', displayName: 'Alice', verified: true },
          { id: 'creator-2', displayName: 'Bob', verified: true },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      };

      mockRequest.mockResolvedValue({
        success: true,
        data: mockResponse,
      });

      const result = await client.listCreators();

      expect(result.creators).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(mockRequest).toHaveBeenCalledWith('GET', '/creators');
    });

    it('should list with pagination options', async () => {
      mockRequest.mockResolvedValue({
        success: true,
        data: { creators: [], total: 0, page: 2, pageSize: 10 },
      });

      await client.listCreators({ page: 2, pageSize: 10 });

      expect(mockRequest).toHaveBeenCalledWith('GET', '/creators?page=2&pageSize=10');
    });

    it('should filter by verified status', async () => {
      mockRequest.mockResolvedValue({
        success: true,
        data: { creators: [], total: 0 },
      });

      await client.listCreators({ verified: true });

      expect(mockRequest).toHaveBeenCalledWith('GET', '/creators?verified=true');
    });

    it('should combine pagination and filter', async () => {
      mockRequest.mockResolvedValue({
        success: true,
        data: { creators: [], total: 0 },
      });

      await client.listCreators({ page: 1, pageSize: 15, verified: true });

      expect(mockRequest).toHaveBeenCalledWith('GET', '/creators?page=1&pageSize=15&verified=true');
    });

    it('should throw error on failed request', async () => {
      mockRequest.mockResolvedValue({
        success: false,
        error: { message: 'Server error' },
      });

      await expect(client.listCreators()).rejects.toThrow('Failed to fetch creators list');
    });
  });

  describe('getCreatorProfile', () => {
    it('should fetch creator profile by username', async () => {
      const mockProfile = {
        id: 'creator-123',
        displayName: 'Alice',
        username: 'alice-creator',
        verified: true,
        stats: {
          totalTips: 150,
          averageTip: 75,
          lastTipDate: '2024-01-15T00:00:00Z',
        },
      };

      mockRequest.mockResolvedValue({
        success: true,
        data: mockProfile,
      });

      const result = await client.getCreatorProfile('alice-creator');

      expect(result).toBeDefined();
      expect(result.stats).toBeDefined();
      // stats is always set by getCreatorProfile — assert defined for type narrowing
      const stats = result.stats as NonNullable<typeof result.stats>;
      expect(stats.totalTips).toBe(150);
      expect(mockRequest).toHaveBeenCalledWith('GET', '/creators/profile/alice-creator');
    });

    it('should provide default stats if not included', async () => {
      const mockProfile = {
        id: 'creator-456',
        displayName: 'Bob',
        username: 'bob-creator',
        verified: false,
      };

      mockRequest.mockResolvedValue({
        success: true,
        data: mockProfile,
      });

      const result = await client.getCreatorProfile('bob-creator');

      expect(result.stats).toBeDefined();
      const stats = result.stats as NonNullable<typeof result.stats>;
      expect(stats.totalTips).toBe(0);
      expect(stats.averageTip).toBe(0);
      expect(stats.lastTipDate).toBeNull();
    });

    it('should throw error if profile not found', async () => {
      mockRequest.mockResolvedValue({
        success: false,
        error: { message: 'Profile not found' },
      });

      await expect(client.getCreatorProfile('invalid-username')).rejects.toThrow(
        'Failed to fetch creator profile'
      );
    });
  });

  describe('verifyCreator', () => {
    it('should verify creator', async () => {
      const mockCreator = {
        id: 'creator-123',
        displayName: 'Alice',
        verified: true,
      };

      mockRequest.mockResolvedValue({
        success: true,
        data: mockCreator,
      });

      const result = await (
        client.verifyCreator as (id: string, verified: boolean) => Promise<any>
      )('creator-123', true);

      expect(result.verified).toBe(true);
      expect(mockRequest).toHaveBeenCalledWith('PATCH', '/creators/creator-123/verify', {
        verified: true,
      });
    });

    it('should unverify creator', async () => {
      const mockCreator = {
        id: 'creator-123',
        displayName: 'Alice',
        verified: false,
      };

      mockRequest.mockResolvedValue({
        success: true,
        data: mockCreator,
      });

      const result = await (
        client.verifyCreator as (id: string, verified: boolean) => Promise<any>
      )('creator-123', false);

      expect(result.verified).toBe(false);
      expect(mockRequest).toHaveBeenCalledWith('PATCH', '/creators/creator-123/verify', {
        verified: false,
      });
    });

    it('should throw error on failed verification', async () => {
      mockRequest.mockResolvedValue({
        success: false,
        error: { message: 'Unauthorized' },
      });

      await expect(
        (client.verifyCreator as (id: string, verified: boolean) => Promise<any>)(
          'creator-123',
          true
        )
      ).rejects.toThrow('Failed to verify creator');
    });
  });
});
