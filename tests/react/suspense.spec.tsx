// @vitest-environment jsdom
/**
 * React Suspense integration tests for SDK hooks (Issue #179).
 *
 * Covers the opt-in `useSuspense` flag on useCreator, useUser and useWallet:
 * promises are thrown during fetch, Suspense boundaries catch them, and data
 * is available once the thrown promise resolves.
 *
 * In Suspense mode the hook does not update local state while suspended
 * (setState during render would warn); data is read from the action's return
 * value after the thrown promise resolves and the boundary re-renders. The
 * default (no option) behavior is unchanged.
 */

import React, { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, render, cleanup, within } from '@testing-library/react';
import { DorisioProvider } from '../../src/react/DorisioProvider';
import { useCreator, creatorSuspenseCache } from '../../src/react/useCreator';
import { useUser, userSuspenseCache } from '../../src/react/useUser';
import { useWallet, listWalletsSuspenseCache, getBalanceSuspenseCache } from '../../src/react/useWallet';
import { Creator, User, Wallet } from '../../src/types/models';
import { ApiError } from '../../src/types/errors';

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

function makeMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-123',
    email: 'fan@example.com',
    name: 'Fan Name',
    role: 'fan',
    verified: true,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMockWallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: 'wallet-1',
    publicKey: 'GABC123',
    name: 'My Wallet',
    verified: true,
    ...overrides,
  };
}

interface Controllable<T = unknown> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function controllable<T = unknown>(): Controllable<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function buildWrapper(mockClient: any) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(DorisioProvider, {
      client: mockClient,
      config: {} as any,
      children,
    });
  };
}

describe('React Suspense integration (useSuspense)', () => {
  let mockRequest: ReturnType<typeof vi.fn>;
  let mockClient: any;

  beforeEach(() => {
    creatorSuspenseCache.clear();
    userSuspenseCache.clear();
    listWalletsSuspenseCache.clear();
    getBalanceSuspenseCache.clear();
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

  // ─── useCreator ─────────────────────────────────────────────────────────

  describe('useCreator with useSuspense', () => {
    it('throws a promise when fetchCreator is called', () => {
      const { promise } = controllable();
      mockRequest.mockReturnValueOnce(promise);

      const { result } = renderHook(() => useCreator({ useSuspense: true }), {
        wrapper: buildWrapper(mockClient),
      });

      let thrown: unknown;
      act(() => {
        try {
          result.current.fetchCreator('creator-123');
        } catch (p) {
          thrown = p;
        }
      });

      expect(thrown).toBeInstanceOf(Promise);
      expect(mockRequest).toHaveBeenCalledWith('GET', '/creators/creator-123', undefined, {
        timeout: 10000,
      });
    });

    it('makes creator data available after the thrown promise resolves', async () => {
      const mockCreator = makeMockCreator();
      const { promise, resolve } = controllable();
      mockRequest.mockReturnValueOnce(promise);

      const { result } = renderHook(() => useCreator({ useSuspense: true }), {
        wrapper: buildWrapper(mockClient),
      });

      let thrown: unknown;
      act(() => {
        try {
          result.current.fetchCreator('creator-123');
        } catch (p) {
          thrown = p;
        }
      });

      resolve({ success: true, data: mockCreator });
      await act(async () => {
        await thrown;
      });

      let data: Creator | null = null;
      await act(async () => {
        data = await result.current.fetchCreator('creator-123');
      });
      expect(data).toEqual(mockCreator);
    });

    it('returns cached data without re-fetching after the promise resolves', async () => {
      const mockCreator = makeMockCreator();
      const { promise, resolve } = controllable();
      mockRequest.mockReturnValueOnce(promise);

      const { result } = renderHook(() => useCreator({ useSuspense: true }), {
        wrapper: buildWrapper(mockClient),
      });

      let thrown: unknown;
      act(() => {
        try {
          result.current.fetchCreator('creator-123');
        } catch (p) {
          thrown = p;
        }
      });

      resolve({ success: true, data: mockCreator });
      await act(async () => {
        await thrown;
      });

      let data: Creator | null = null;
      await act(async () => {
        data = await result.current.fetchCreator('creator-123');
      });

      expect(data).toEqual(mockCreator);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('rethrows the same in-flight promise on repeated calls', () => {
      const { promise } = controllable();
      mockRequest.mockReturnValueOnce(promise);

      const { result } = renderHook(() => useCreator({ useSuspense: true }), {
        wrapper: buildWrapper(mockClient),
      });

      let first: unknown;
      let second: unknown;
      act(() => {
        try {
          result.current.fetchCreator('creator-123');
        } catch (p) {
          first = p;
        }
      });
      act(() => {
        try {
          result.current.fetchCreator('creator-123');
        } catch (p) {
          second = p;
        }
      });

      expect(first).toBe(second);
      expect(first).toBeInstanceOf(Promise);
    });

    it('resolves with null when the fetch fails in suspense mode', async () => {
      const error = new ApiError('Not found', 404);
      const { promise, reject } = controllable();
      mockRequest.mockReturnValueOnce(promise);

      const { result } = renderHook(() => useCreator({ useSuspense: true }), {
        wrapper: buildWrapper(mockClient),
      });

      let thrown: unknown;
      act(() => {
        try {
          result.current.fetchCreator('missing');
        } catch (p) {
          thrown = p;
        }
      });

      reject(error);
      await act(async () => {
        await thrown;
      });

      expect(await thrown).toBeNull();
      const data = await result.current.fetchCreator('missing');
      expect(data).toBeNull();
      expect(result.current.loading).toBe(false);
    });

    it('supports Suspense for fetchProfile', async () => {
      const { promise, resolve } = controllable();
      mockRequest.mockReturnValueOnce(promise);

      const { result } = renderHook(() => useCreator({ useSuspense: true }), {
        wrapper: buildWrapper(mockClient),
      });

      let thrown: unknown;
      act(() => {
        try {
          result.current.fetchProfile('alice');
        } catch (p) {
          thrown = p;
        }
      });

      expect(thrown).toBeInstanceOf(Promise);
      expect(mockRequest).toHaveBeenCalledWith('GET', '/creators/profile/alice', undefined, {
        timeout: 10000,
      });

      resolve({ success: true, data: makeMockCreator({ username: 'alice' }) });
      await act(async () => {
        await thrown;
      });

      const profile = await result.current.fetchProfile('alice');
      expect(profile).toEqual(expect.objectContaining({ username: 'alice' }));
    });
  });

  describe('useCreator without useSuspense (default)', () => {
    it('does not throw and returns a promise as before', async () => {
      const mockCreator = makeMockCreator();
      mockRequest.mockResolvedValueOnce({ success: true, data: mockCreator });

      const { result } = renderHook(() => useCreator(), {
        wrapper: buildWrapper(mockClient),
      });

      let returned: Creator | null = null;
      await act(async () => {
        returned = await result.current.fetchCreator('creator-123');
      });

      expect(returned).toEqual(mockCreator);
      expect(result.current.loading).toBe(false);
    });
  });

  // ─── useUser ────────────────────────────────────────────────────────────

  describe('useUser with useSuspense', () => {
    it('throws a promise when fetchUser is called', () => {
      const { promise } = controllable();
      mockRequest.mockReturnValueOnce(promise);

      const { result } = renderHook(() => useUser({ useSuspense: true }), {
        wrapper: buildWrapper(mockClient),
      });

      let thrown: unknown;
      act(() => {
        try {
          result.current.fetchUser('user-123');
        } catch (p) {
          thrown = p;
        }
      });

      expect(thrown).toBeInstanceOf(Promise);
    });

    it('makes user data available after the thrown promise resolves', async () => {
      const mockUser = makeMockUser();
      const { promise, resolve } = controllable();
      mockRequest.mockReturnValueOnce(promise);

      const { result } = renderHook(() => useUser({ useSuspense: true }), {
        wrapper: buildWrapper(mockClient),
      });

      let thrown: unknown;
      act(() => {
        try {
          result.current.fetchUser('user-123');
        } catch (p) {
          thrown = p;
        }
      });

      resolve({ success: true, data: mockUser });
      await act(async () => {
        await thrown;
      });

      const user = await result.current.fetchUser('user-123');
      expect(user).toEqual(mockUser);
    });

    it('supports Suspense for fetchCurrentUser', async () => {
      const mockUser = makeMockUser({ id: 'current-user-1' });
      const { promise, resolve } = controllable();
      mockRequest.mockReturnValueOnce(promise);

      const { result } = renderHook(() => useUser({ useSuspense: true }), {
        wrapper: buildWrapper(mockClient),
      });

      let thrown: unknown;
      act(() => {
        try {
          result.current.fetchCurrentUser();
        } catch (p) {
          thrown = p;
        }
      });

      expect(thrown).toBeInstanceOf(Promise);
      expect(mockRequest).toHaveBeenCalledWith('GET', '/users/me', undefined, { timeout: 10000 });

      resolve({ success: true, data: mockUser });
      await act(async () => {
        await thrown;
      });

      const user = await result.current.fetchCurrentUser();
      expect(user).toEqual(mockUser);
    });
  });

  describe('useUser without useSuspense (default)', () => {
    it('does not throw', async () => {
      mockRequest.mockResolvedValueOnce({ success: true, data: makeMockUser() });

      const { result } = renderHook(() => useUser(), {
        wrapper: buildWrapper(mockClient),
      });

      let thrown: unknown;
      let returned: User | null = null;
      await act(async () => {
        try {
          returned = await result.current.fetchUser('user-123');
        } catch (p) {
          thrown = p;
        }
      });

      expect(thrown).toBeUndefined();
      expect(returned).not.toBeNull();
    });
  });

  // ─── useWallet ─────────────────────────────────────────────────────────

  describe('useWallet with useSuspense', () => {
    it('throws a promise when listWallets is called', () => {
      const { promise } = controllable();
      mockRequest.mockReturnValueOnce(promise);

      const { result } = renderHook(() => useWallet({ useSuspense: true }), {
        wrapper: buildWrapper(mockClient),
      });

      let thrown: unknown;
      act(() => {
        try {
          result.current.listWallets();
        } catch (p) {
          thrown = p;
        }
      });

      expect(thrown).toBeInstanceOf(Promise);
    });

    it('makes wallets available after the thrown promise resolves', async () => {
      const wallets = [makeMockWallet(), makeMockWallet({ id: 'wallet-2' })];
      const { promise, resolve } = controllable();
      mockRequest.mockReturnValueOnce(promise);

      const { result } = renderHook(() => useWallet({ useSuspense: true }), {
        wrapper: buildWrapper(mockClient),
      });

      let thrown: unknown;
      act(() => {
        try {
          result.current.listWallets();
        } catch (p) {
          thrown = p;
        }
      });

      resolve({ success: true, data: { wallets } });
      await act(async () => {
        await thrown;
      });

      const data = await result.current.listWallets();
      expect(data).toHaveLength(2);
      expect(result.current.loading).toBe(false);
    });

    it('supports Suspense for getBalance', async () => {
      const balance = { available: 1000, pending: 50, total: 1050 };
      const { promise, resolve } = controllable();
      mockRequest.mockReturnValueOnce(promise);

      const { result } = renderHook(() => useWallet({ useSuspense: true }), {
        wrapper: buildWrapper(mockClient),
      });

      let thrown: unknown;
      act(() => {
        try {
          result.current.getBalance('wallet-1');
        } catch (p) {
          thrown = p;
        }
      });

      expect(thrown).toBeInstanceOf(Promise);
      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/api/v1/wallet/wallet-1/balance',
        undefined,
        expect.anything()
      );

      resolve({ success: true, data: balance });
      await act(async () => {
        await thrown;
      });

      const data = await result.current.getBalance('wallet-1');
      expect(data).toEqual(balance);
      expect(result.current.loading).toBe(false);
    });
  });

  describe('useWallet without useSuspense (default)', () => {
    it('does not throw and returns a promise as before', async () => {
      mockRequest.mockResolvedValueOnce({ success: true, data: { wallets: [makeMockWallet()] } });

      const { result } = renderHook(() => useWallet(), {
        wrapper: buildWrapper(mockClient),
      });

      let thrown: unknown;
      let returned: Wallet[] | null = null;
      await act(async () => {
        try {
          returned = await result.current.listWallets();
        } catch (p) {
          thrown = p;
        }
      });

      expect(thrown).toBeUndefined();
      expect(returned).toHaveLength(1);
    });
  });

  // ─── Suspense boundary (component-level) ───────────────────────────────

  function SuspendedCreator({ creatorId }: { creatorId: string }) {
    const { fetchCreator } = useCreator({ useSuspense: true });
    // During render this either throws a promise (Suspense catches it) or
    // returns the cached creator synchronously once the promise resolved.
    const creatorOrPromise = fetchCreator(creatorId);
    const creator = creatorOrPromise instanceof Promise ? null : creatorOrPromise;
    return creator ? (
      <div data-testid="creator-view">{creator.displayName}</div>
    ) : null;
  }

  const fallback = <div data-testid="suspense-fallback">Loading creator...</div>;

  describe('Suspense boundary', () => {
    it('displays the fallback while the promise is pending', async () => {
      const { promise } = controllable();
      mockRequest.mockReturnValueOnce(promise);

      const { container } = render(
        <Suspense fallback={fallback}>
          <SuspendedCreator creatorId="creator-123" />
        </Suspense>,
        { wrapper: buildWrapper(mockClient) }
      );

      expect(container.querySelector('[data-testid="suspense-fallback"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="creator-view"]')).toBeNull();
    });

    it('displays creator data once the thrown promise resolves', async () => {
      const { promise, resolve } = controllable();
      mockRequest.mockReturnValueOnce(promise);

      const { container, findByText } = render(
        <Suspense fallback={fallback}>
          <SuspendedCreator creatorId="creator-123" />
        </Suspense>,
        { wrapper: buildWrapper(mockClient) }
      );

      await act(async () => {
        resolve({ success: true, data: makeMockCreator({ displayName: 'Creator One' }) });
      });

      expect(await findByText('Creator One')).toBeDefined();
      expect(container.querySelector('[data-testid="suspense-fallback"]')).toBeNull();
    });

    it('has no errors on remount and shows data after resolution', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      const { promise } = controllable();
      mockRequest.mockReturnValueOnce(promise);
      const { unmount } = render(
        <Suspense fallback={fallback}>
          <SuspendedCreator creatorId="creator-123" />
        </Suspense>,
        { wrapper: buildWrapper(mockClient) }
      );
      unmount();

      // A remount must not reuse the previous mount's pending suspense entry.
      creatorSuspenseCache.clear();

      const { promise: second, resolve } = controllable();
      mockRequest.mockReturnValueOnce(second);
      const { container } = render(
        <Suspense fallback={fallback}>
          <SuspendedCreator creatorId="creator-123" />
        </Suspense>,
        { wrapper: buildWrapper(mockClient) }
      );

      expect(container.querySelector('[data-testid="suspense-fallback"]')).not.toBeNull();

      await act(async () => {
        resolve({ success: true, data: makeMockCreator({ displayName: 'After Remount' }) });
      });

      expect(
        errorSpy.mock.calls.some((call) =>
          String(call[0]).includes("update on an unmounted component")
        )
      ).toBe(false);
      expect(await within(container).findByText('After Remount')).toBeDefined();

      errorSpy.mockRestore();
    });
  });
});
