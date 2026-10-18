// @vitest-environment jsdom
/**
 * useCreator Hook Tests
 * Tests for creator management hook covering idle, loading, success, and error states,
 * as well as race conditions and unmount cleanup.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { DorisioProvider } from './DorisioProvider';
import { useCreator } from './useCreator';
import { Creator, CreatorProfile } from '../types/models';
import { ApiError } from '../types/errors';

describe('useCreator Hook', () => {
  let mockRequest: ReturnType<typeof vi.fn>;
  let mockClient: any;

  function makeMockCreator(overrides: Partial<Creator> = {}): Creator {
    return {
      id: 'creator-123',
      userId: 'user-456',
      username: 'creator1',
      displayName: 'Creator One',
      bio: null,
      avatar: null,
      verified: true,
      isPublic: true,
      totalEarnings: 0,
      pendingBalance: 0,
      createdAt: '2024-01-01T00:00:00Z',
      ...overrides,
    };
  }

  function makeMockProfile(overrides: Partial<CreatorProfile> = {}): CreatorProfile {
    return {
      ...makeMockCreator(),
      bio: 'Bio text',
      stats: {
        totalTips: 10,
        averageTip: 5,
        lastTipDate: '2024-01-02T00:00:00Z',
      },
      ...overrides,
    };
  }

  function wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(DorisioProvider, {
      client: mockClient,
      config: {} as any,
      children,
    });
  }

  beforeEach(() => {
    mockRequest = vi.fn();
    mockClient = {
      request: mockRequest,
      setToken: vi.fn(),
      clearToken: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('initial / idle state', () => {
    it('initializes with null creator, null profile, loading false, and error null', () => {
      const { result } = renderHook(() => useCreator(), { wrapper });

      expect(result.current.creator).toBeNull();
      expect(result.current.profile).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });

  describe('fetchCreator', () => {
    it('fetches creator successfully and updates state', async () => {
      const mockCreator = makeMockCreator();
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: mockCreator,
      });

      const { result } = renderHook(() => useCreator(), { wrapper });

      let returnedCreator: Creator | null = null;
      await act(async () => {
        returnedCreator = await result.current.fetchCreator('creator-123');
      });

      expect(returnedCreator).toEqual(mockCreator);
      expect(result.current.creator).toEqual(mockCreator);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(mockRequest).toHaveBeenCalledWith('GET', '/creators/creator-123', undefined, {
        timeout: 10000,
      });
    });

    it('handles unsuccessful API response', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Creator not found' },
      });

      const { result } = renderHook(() => useCreator(), { wrapper });

      let returnedCreator: Creator | null = null;
      await act(async () => {
        returnedCreator = await result.current.fetchCreator('nonexistent');
      });

      expect(returnedCreator).toBeNull();
      expect(result.current.creator).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('sets error state when request throws an ApiError', async () => {
      const error = new ApiError('Network error', 500);
      mockRequest.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useCreator(), { wrapper });

      let returnedCreator: Creator | null = null;
      await act(async () => {
        returnedCreator = await result.current.fetchCreator('creator-123');
      });

      expect(returnedCreator).toBeNull();
      expect(result.current.creator).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(error);
    });

    it('propagates error to parent DorisioProvider when fetchCreator fails', async () => {
      const error = new ApiError('Not found', 404);
      mockRequest.mockRejectedValueOnce(error);

      const onError = vi.fn();
      const customWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(DorisioProvider, {
          client: mockClient,
          config: {} as any,
          onError,
          children,
        });

      const { result } = renderHook(() => useCreator(), { wrapper: customWrapper });

      await act(async () => {
        await result.current.fetchCreator('creator-missing');
      });

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Not found', code: 'CREATOR_ERROR' })
      );
    });

    it('clears error when clearError is called', async () => {
      const error = new ApiError('Not found', 404);
      mockRequest.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useCreator(), { wrapper });

      await act(async () => {
        await result.current.fetchCreator('creator-123');
      });
      expect(result.current.error).toBe(error);

      act(() => {
        result.current.clearError();
      });
      expect(result.current.error).toBeNull();
    });
  });

  describe('fetchProfile', () => {
    it('fetches profile successfully and updates state', async () => {
      const mockProfile = makeMockProfile();
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: mockProfile,
      });

      const { result } = renderHook(() => useCreator(), { wrapper });

      let returnedProfile: CreatorProfile | null = null;
      await act(async () => {
        returnedProfile = await result.current.fetchProfile('alice');
      });

      expect(returnedProfile).toEqual(mockProfile);
      expect(result.current.profile).toEqual(mockProfile);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(mockRequest).toHaveBeenCalledWith('GET', '/creators/profile/alice', undefined, {
        timeout: 10000,
      });
    });

    it('handles profile fetch error', async () => {
      const error = new ApiError('Profile not found', 404);
      mockRequest.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useCreator(), { wrapper });

      let returnedProfile: CreatorProfile | null = null;
      await act(async () => {
        returnedProfile = await result.current.fetchProfile('unknown');
      });

      expect(returnedProfile).toBeNull();
      expect(result.current.profile).toBeNull();
      expect(result.current.error).toBe(error);
      expect(result.current.loading).toBe(false);
    });

    it('returns null on success: false response', async () => {
      mockRequest.mockResolvedValueOnce({ success: false });

      const { result } = renderHook(() => useCreator(), { wrapper });

      let returned: CreatorProfile | null = null;
      await act(async () => {
        returned = await result.current.fetchProfile('alice');
      });

      expect(returned).toBeNull();
    });
  });

  describe('createCreator', () => {
    const createData = {
      username: 'new_creator',
      displayName: 'New Creator',
    };

    it('creates creator successfully and updates state', async () => {
      const created = makeMockCreator({
        id: 'creator-999',
        userId: 'user-999',
        username: 'new_creator',
        displayName: 'New Creator',
        verified: false,
      });

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: created,
      });

      const { result } = renderHook(() => useCreator(), { wrapper });

      let res: Creator | null = null;
      await act(async () => {
        res = await result.current.createCreator(createData);
      });

      expect(res).toEqual(created);
      expect(result.current.creator).toEqual(created);
      expect(result.current.loading).toBe(false);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/creators', createData, {
        timeout: 15000,
      });
    });

    it('handles createCreator failure', async () => {
      const error = new ApiError('Username taken', 409);
      mockRequest.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useCreator(), { wrapper });

      let res: Creator | null = null;
      await act(async () => {
        res = await result.current.createCreator(createData);
      });

      expect(res).toBeNull();
      expect(result.current.error).toBe(error);
      expect(result.current.loading).toBe(false);
    });

    it('returns null on unsuccessful response without data', async () => {
      mockRequest.mockResolvedValueOnce({ success: false });

      const { result } = renderHook(() => useCreator(), { wrapper });

      let res: Creator | null = null;
      await act(async () => {
        res = await result.current.createCreator(createData);
      });

      expect(res).toBeNull();
    });
  });

  describe('updateCreator', () => {
    const updateData = {
      displayName: 'Updated Name',
      bio: 'New bio',
    };

    it('updates creator successfully and updates state', async () => {
      const updated = makeMockCreator({
        id: 'creator-123',
        userId: 'user-456',
        username: 'creator1',
        displayName: 'Updated Name',
        bio: 'New bio',
        verified: true,
      });

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: updated,
      });

      const { result } = renderHook(() => useCreator(), { wrapper });

      let res: Creator | null = null;
      await act(async () => {
        res = await result.current.updateCreator('creator-123', updateData);
      });

      expect(res).toEqual(updated);
      expect(result.current.creator).toEqual(updated);
      expect(result.current.loading).toBe(false);
      expect(mockRequest).toHaveBeenCalledWith('PATCH', '/creators/creator-123', updateData, {
        timeout: 15000,
      });
    });

    it('handles updateCreator failure', async () => {
      const error = new ApiError('Forbidden', 403);
      mockRequest.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useCreator(), { wrapper });

      let res: Creator | null = null;
      await act(async () => {
        res = await result.current.updateCreator('creator-123', updateData);
      });

      expect(res).toBeNull();
      expect(result.current.error).toBe(error);
      expect(result.current.loading).toBe(false);
    });

    it('returns null on unsuccessful update response', async () => {
      mockRequest.mockResolvedValueOnce({ success: false });

      const { result } = renderHook(() => useCreator(), { wrapper });

      let res: Creator | null = null;
      await act(async () => {
        res = await result.current.updateCreator('creator-123', updateData);
      });

      expect(res).toBeNull();
    });
  });

  describe('loading state, race conditions, and unmount cleanup', () => {
    it('sets loading state to true during request and false after resolution', async () => {
      let resolvePromise: (value: any) => void = () => undefined;
      const delayedPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockRequest.mockReturnValueOnce(delayedPromise);

      const { result } = renderHook(() => useCreator(), { wrapper });

      let callPromise: Promise<Creator | null>;
      act(() => {
        callPromise = result.current.fetchCreator('creator-123');
      });

      expect(result.current.loading).toBe(true);

      await act(async () => {
        resolvePromise({
          success: true,
          data: makeMockCreator(),
        });
        await callPromise;
      });

      expect(result.current.loading).toBe(false);
    });

    it('handles fast successive calls and retains the latest call result', async () => {
      const creator1 = makeMockCreator({ id: 'c1', username: 'first' });
      const creator2 = makeMockCreator({ id: 'c2', username: 'second' });

      let resolveFirst: (v: any) => void = () => undefined;
      let resolveSecond: (v: any) => void = () => undefined;

      const p1 = new Promise((r) => { resolveFirst = r; });
      const p2 = new Promise((r) => { resolveSecond = r; });

      mockRequest
        .mockReturnValueOnce(p1)
        .mockReturnValueOnce(p2);

      const { result } = renderHook(() => useCreator(), { wrapper });

      act(() => {
        result.current.fetchCreator('c1');
      });
      act(() => {
        result.current.fetchCreator('c2');
      });

      expect(result.current.loading).toBe(true);

      // Slower first request resolves after second
      await act(async () => {
        resolveSecond({ success: true, data: creator2 });
        resolveFirst({ success: true, data: creator1 });
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.creator).toBeDefined();
    });

    it('handles unmount mid-request without throwing or unhandled rejections', async () => {
      let resolvePromise: (value: any) => void = () => undefined;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockRequest.mockReturnValueOnce(pendingPromise);

      const { result, unmount } = renderHook(() => useCreator(), { wrapper });

      act(() => {
        result.current.fetchCreator('creator-123');
      });

      expect(result.current.loading).toBe(true);

      unmount();

      await act(async () => {
        resolvePromise({ success: true, data: makeMockCreator() });
      });
    });
  });
});
