// @vitest-environment jsdom
/**
 * useUser Hook Tests
 * Tests for user profile operations covering idle, loading, success, and error states,
 * authentication transitions, race conditions, and unmount cleanup.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { DorisioProvider } from './DorisioProvider';
import { useUser, USER_CACHE_TTL_MS } from './useUser';
import { User, UpdateUserRequest } from '../types/models';
import { ApiError } from '../types/errors';

describe('useUser Hook', () => {
  let mockRequest: ReturnType<typeof vi.fn>;
  let mockClient: any;

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
      isOnline: vi.fn(() => true),
      setOnline: vi.fn(),
      getOfflineStats: vi.fn(() => null),
    };
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe('initial / idle state', () => {
    it('initializes with null user, null profile, loading false, error null, and isAuthenticated false', () => {
      const { result } = renderHook(() => useUser(), { wrapper });

      expect(result.current.user).toBeNull();
      expect(result.current.profile).toBeNull();
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  describe('fetchUser', () => {
    const mockUser: User = {
      id: 'user-123',
      email: 'fan@example.com',
      name: 'Fan Name',
      role: 'fan',
      verified: true,
      createdAt: '2024-01-01T00:00:00Z',
    };

    it('fetches user successfully and updates state', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: mockUser,
      });

      const { result } = renderHook(() => useUser(), { wrapper });

      let returnedUser: User | null = null;
      await act(async () => {
        returnedUser = await result.current.fetchUser('user-123');
      });

      expect(returnedUser).toEqual(mockUser);
      expect(result.current.user).toEqual(mockUser);
      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(mockRequest).toHaveBeenCalledWith('GET', '/users/user-123', undefined, {
        timeout: 10000,
      });
    });

    it('handles unsuccessful response from fetchUser', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'User not found' },
      });

      const { result } = renderHook(() => useUser(), { wrapper });

      let returnedUser: User | null = null;
      await act(async () => {
        returnedUser = await result.current.fetchUser('invalid-id');
      });

      expect(returnedUser).toBeNull();
      expect(result.current.user).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('sets error state when fetchUser throws ApiError', async () => {
      const error = new ApiError('Not found', 404);
      mockRequest.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useUser(), { wrapper });

      let returnedUser: User | null = null;
      await act(async () => {
        returnedUser = await result.current.fetchUser('user-123');
      });

      expect(returnedUser).toBeNull();
      expect(result.current.user).toBeNull();
      expect(result.current.error).toBe(error);
      expect(result.current.loading).toBe(false);
    });

    it('propagates error to parent DorisioProvider when fetchUser fails', async () => {
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

      const { result } = renderHook(() => useUser(), { wrapper: customWrapper });

      await act(async () => {
        await result.current.fetchUser('user-missing');
      });

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Not found', code: 'USER_ERROR' })
      );
    });
  });

  describe('fetchCurrentUser', () => {
    const mockCurrentUser: User = {
      id: 'current-user-1',
      email: 'current@example.com',
      name: 'Current User',
      role: 'fan',
      verified: true,
      createdAt: '2024-01-01T00:00:00Z',
    };

    it('fetches current user and sets isAuthenticated to true', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: mockCurrentUser,
      });

      const { result } = renderHook(() => useUser(), { wrapper });

      let returned: User | null = null;
      await act(async () => {
        returned = await result.current.fetchCurrentUser();
      });

      expect(returned).toEqual(mockCurrentUser);
      expect(result.current.user).toEqual(mockCurrentUser);
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.loading).toBe(false);
      expect(mockRequest).toHaveBeenCalledWith('GET', '/users/me', undefined, {
        timeout: 10000,
      });
    });

    it('sets isAuthenticated to false and error on failure', async () => {
      const error = new ApiError('Unauthorized', 401);
      mockRequest.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useUser(), { wrapper });

      let returned: User | null = null;
      await act(async () => {
        returned = await result.current.fetchCurrentUser();
      });

      expect(returned).toBeNull();
      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.error).toBe(error);
      expect(result.current.loading).toBe(false);
    });

    it('returns null on success: false response without data', async () => {
      mockRequest.mockResolvedValueOnce({ success: false });

      const { result } = renderHook(() => useUser(), { wrapper });

      let returned: User | null = null;
      await act(async () => {
        returned = await result.current.fetchCurrentUser();
      });

      expect(returned).toBeNull();
    });
  });

  describe('updateUser', () => {
    const updateData: UpdateUserRequest = {
      name: 'New Name',
    };

    it('updates user successfully and sets user state', async () => {
      const updatedUser: User = {
        id: 'user-123',
        email: 'fan@example.com',
        name: 'New Name',
        role: 'fan',
        verified: true,
        createdAt: '2024-01-01T00:00:00Z',
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: updatedUser,
      });

      const { result } = renderHook(() => useUser(), { wrapper });

      let res: User | null = null;
      await act(async () => {
        res = await result.current.updateUser('user-123', updateData);
      });

      expect(res).toEqual(updatedUser);
      expect(result.current.user).toEqual(updatedUser);
      expect(result.current.loading).toBe(false);
      expect(mockRequest).toHaveBeenCalledWith('PATCH', '/users/user-123', updateData, {
        timeout: 15000,
      });
    });

    it('handles updateUser failure', async () => {
      const error = new ApiError('Bad Request', 400);
      mockRequest.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useUser(), { wrapper });

      let res: User | null = null;
      await act(async () => {
        res = await result.current.updateUser('user-123', updateData);
      });

      expect(res).toBeNull();
      expect(result.current.error).toBe(error);
      expect(result.current.loading).toBe(false);
    });

    it('returns null on unsuccessful update response', async () => {
      mockRequest.mockResolvedValueOnce({ success: false });

      const { result } = renderHook(() => useUser(), { wrapper });

      let res: User | null = null;
      await act(async () => {
        res = await result.current.updateUser('user-123', updateData);
      });

      expect(res).toBeNull();
    });
  });

  describe('clearError', () => {
    it('resets error state to null', async () => {
      const error = new ApiError('Server error', 500);
      mockRequest.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useUser(), { wrapper });

      await act(async () => {
        await result.current.fetchUser('user-123');
      });
      expect(result.current.error).toBe(error);

      act(() => {
        result.current.clearError();
      });
      expect(result.current.error).toBeNull();
    });
  });

  describe('loading state, race conditions, and unmount cleanup', () => {
    it('sets loading state to true during request and false after resolution', async () => {
      let resolvePromise: (value: any) => void = () => undefined;
      const delayedPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockRequest.mockReturnValueOnce(delayedPromise);

      const { result } = renderHook(() => useUser(), { wrapper });

      let callPromise: Promise<User | null>;
      act(() => {
        callPromise = result.current.fetchUser('user-123');
      });

      expect(result.current.loading).toBe(true);

      await act(async () => {
        resolvePromise({
          success: true,
          data: { id: 'user-123', email: 'a@b.com' },
        });
        await callPromise;
      });

      expect(result.current.loading).toBe(false);
    });

    it('handles fast successive calls gracefully', async () => {
      const user1 = { id: 'u1', email: 'first@test.com' };
      const user2 = { id: 'u2', email: 'second@test.com' };

      let resolveFirst: (v: any) => void = () => undefined;
      let resolveSecond: (v: any) => void = () => undefined;

      mockRequest
        .mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }))
        .mockReturnValueOnce(new Promise((r) => { resolveSecond = r; }));

      const { result } = renderHook(() => useUser(), { wrapper });

      act(() => {
        result.current.fetchUser('u1');
      });
      act(() => {
        result.current.fetchUser('u2');
      });

      expect(result.current.loading).toBe(true);

      await act(async () => {
        resolveSecond({ success: true, data: user2 });
        resolveFirst({ success: true, data: user1 });
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.user).toBeDefined();
    });

    it('handles unmount during pending async request', async () => {
      let resolvePromise: (value: any) => void = () => undefined;
      const pendingPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockRequest.mockReturnValueOnce(pendingPromise);

      const { result, unmount } = renderHook(() => useUser(), { wrapper });

      act(() => {
        result.current.fetchUser('user-123');
      });

      expect(result.current.loading).toBe(true);

      unmount();

      await act(async () => {
        resolvePromise({ success: true, data: { id: 'user-123' } });
      });
    });
  });

  describe('offline fallback and cache flags', () => {
    const mockCurrentUser: User = {
      id: 'current-user-1',
      email: 'current@example.com',
      name: 'Current User',
      role: 'fan',
      verified: true,
      createdAt: '2024-01-01T00:00:00Z',
    };

    const offlineError = new ApiError('Network unreachable', 0);

    function goOffline() {
      mockClient.isOnline.mockReturnValue(false);
      mockRequest.mockRejectedValueOnce(offlineError);
    }

    function goOnline(data: User) {
      mockClient.isOnline.mockReturnValue(true);
      mockRequest.mockResolvedValueOnce({ success: true, data });
    }

    async function primeOnline(result: any, data: User) {
      goOnline(data);
      await act(async () => {
        await result.current.fetchCurrentUser();
      });
      expect(result.current.isCached).toBe(false);
      expect(result.current.user).toEqual(data);
    }

    it('returns cached user data with isCached: true when fetch fails offline (fetchCurrentUser)', async () => {
      const { result } = renderHook(() => useUser(), { wrapper });
      await primeOnline(result, mockCurrentUser);

      goOffline();
      await act(async () => {
        await result.current.fetchCurrentUser();
      });
      expect(result.current.user).toEqual(mockCurrentUser);
      expect(result.current.isCached).toBe(true);
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('returns cached user data with isCached: true when fetchUser fails offline', async () => {
      const user123 = { ...mockCurrentUser, id: 'user-123' };
      const { result } = renderHook(() => useUser(), { wrapper });

      goOnline(user123);
      await act(async () => {
        await result.current.fetchUser('user-123');
      });
      expect(result.current.isCached).toBe(false);

      goOffline();
      await act(async () => {
        await result.current.fetchUser('user-123');
      });

      expect(result.current.user).toEqual(user123);
      expect(result.current.isCached).toBe(true);
      expect(result.current.isAuthenticated).toBe(true);
    });

    it('isCached is false after a successful online fetch', async () => {
      goOnline(mockCurrentUser);

      const { result } = renderHook(() => useUser(), { wrapper });

      await act(async () => {
        await result.current.fetchCurrentUser();
      });

      expect(result.current.user).toEqual(mockCurrentUser);
      expect(result.current.isCached).toBe(false);
      expect(result.current.isAuthenticated).toBe(true);
    });

    it('refreshes cached data and clears isCached when back online (fetchCurrentUser)', async () => {
      const updatedUser = { ...mockCurrentUser, name: 'Updated Name' };
      const { result } = renderHook(() => useUser(), { wrapper });
      await primeOnline(result, mockCurrentUser);
      expect(result.current.isCached).toBe(false);

      goOffline();
      await act(async () => {
        await result.current.fetchCurrentUser();
      });
      expect(result.current.isCached).toBe(true);

      goOnline(updatedUser);
      await act(async () => {
        await result.current.fetchCurrentUser();
      });

      expect(result.current.user).toEqual(updatedUser);
      expect(result.current.isCached).toBe(false);
      expect(mockRequest).toHaveBeenLastCalledWith('GET', '/users/me', undefined, {
        timeout: 10000,
      });
    });

    it('refreshes cached data and clears isCached when back online (fetchUser)', async () => {
      const first = { ...mockCurrentUser, id: 'user-123' };
      const updated = { ...first, name: 'Updated Name' };
      const { result } = renderHook(() => useUser(), { wrapper });

      goOnline(first);
      await act(async () => {
        await result.current.fetchUser('user-123');
      });
      expect(result.current.isCached).toBe(false);

      goOffline();
      await act(async () => {
        await result.current.fetchUser('user-123');
      });
      expect(result.current.isCached).toBe(true);

      goOnline(updated);
      await act(async () => {
        await result.current.fetchUser('user-123');
      });

      expect(result.current.user).toEqual(updated);
      expect(result.current.isCached).toBe(false);
    });

    it('allowCached: false skips cache and returns null when offline with no fresh data', async () => {
      goOffline();

      const { result } = renderHook(() => useUser(), { wrapper });

      await act(async () => {
        await result.current.fetchCurrentUser({ allowCached: false });
      });

      expect(result.current.user).toBeNull();
      expect(result.current.isCached).toBe(false);
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.error).toBe(offlineError);
    });

    it('allowCached: false still succeeds online and returns fresh data', async () => {
      goOnline(mockCurrentUser);

      const { result } = renderHook(() => useUser(), { wrapper });

      await act(async () => {
        await result.current.fetchCurrentUser({ allowCached: false });
      });

      expect(result.current.user).toEqual(mockCurrentUser);
      expect(result.current.isCached).toBe(false);
      expect(result.current.isAuthenticated).toBe(true);
    });

    it('expired cache is not returned offline (TTL respected)', async () => {
      const now = Date.now();
      const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
      try {
        const { result } = renderHook(() => useUser(), { wrapper });
        await primeOnline(result, mockCurrentUser);

        // Advance time beyond TTL so the entry expires
        dateNowSpy.mockImplementation(() => now + USER_CACHE_TTL_MS + 1);

        goOffline();
        await act(async () => {
          await result.current.fetchCurrentUser();
        });

        expect(result.current.user).toBeNull();
        expect(result.current.isCached).toBe(false);
        expect(result.current.error).toBe(offlineError);
      } finally {
        dateNowSpy.mockRestore();
      }
    });

    it('returns non-expired cache when offline within TTL', async () => {
      const now = Date.now();
      const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
      try {
        const { result } = renderHook(() => useUser(), { wrapper });
        await primeOnline(result, mockCurrentUser);

        goOffline();
        await act(async () => {
          await result.current.fetchCurrentUser();
        });

        expect(result.current.user).toEqual(mockCurrentUser);
        expect(result.current.isCached).toBe(true);
      } finally {
        dateNowSpy.mockRestore();
      }
    });

    it('clears error when serving cached data offline', async () => {
      const staleUser = { ...mockCurrentUser, email: 'stale@example.com' };
      const { result } = renderHook(() => useUser(), { wrapper });
      await primeOnline(result, staleUser);

      goOffline();
      await act(async () => {
        await result.current.fetchCurrentUser();
      });
      expect(result.current.error).toBeNull();
      expect(result.current.user).toEqual(staleUser);
      expect(result.current.isCached).toBe(true);
    });
  });
});
