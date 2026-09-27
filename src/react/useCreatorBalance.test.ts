// @vitest-environment jsdom
/**
 * useCreatorBalance Hook Tests
 * Tests for creator earnings and balance hook covering idle, loading, success,
 * error paths, context propagation (setError), race conditions, and unmount cleanup.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { DorisioProvider } from './DorisioProvider';
import { useCreatorBalance } from './useCreatorBalance';

describe('useCreatorBalance Hook', () => {
  let mockRequest: ReturnType<typeof vi.fn>;
  let mockClient: any;
  let consoleError: MockInstance<any[], any>;
  let consoleWarn: MockInstance<any[], any>;

  function wrapperFor(props: Record<string, unknown> = {}) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return React.createElement(
        DorisioProvider,
        { client: mockClient, config: {} as any, children, ...props }
      );
    };
  }

  beforeEach(() => {
    mockRequest = vi.fn();
    mockClient = {
      request: mockRequest,
      setToken: vi.fn(),
      clearToken: vi.fn(),
    };
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('initializes with loading false and undefined balance without autoFetch', () => {
      const { result } = renderHook(() => useCreatorBalance(undefined, false), {
        wrapper: wrapperFor(),
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.balance).toBeUndefined();
      expect(result.current.error).toBeUndefined();
      expect(result.current.lastUpdated).toBeUndefined();
    });
  });

  describe('fetchBalance happy paths', () => {
    it('fetches creator earnings and updates balance state', async () => {
      const earningsData = {
        totalEarnings: 5000,
        pendingBalance: 500,
        confirmedBalance: 4500,
        transactionCount: 25,
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: earningsData,
      });

      const { result } = renderHook(() => useCreatorBalance(undefined, false), {
        wrapper: wrapperFor(),
      });

      let balanceResult: any;
      await act(async () => {
        balanceResult = await result.current.fetchBalance('creator-123');
      });

      expect(balanceResult).toEqual({
        totalEarnings: 5000,
        pendingBalance: 500,
      });
      expect(result.current.balance).toEqual({
        totalEarnings: 5000,
        pendingBalance: 500,
      });
      expect(result.current.loading).toBe(false);
      expect(result.current.lastUpdated).toBeDefined();
      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/api/v1/creators/creator-123/earnings',
        undefined,
        expect.any(Object)
      );
    });

    it('fetches balance with specific wallet and includes wallet assets', async () => {
      mockRequest
        .mockResolvedValueOnce({
          success: true,
          data: { totalEarnings: 5000, pendingBalance: 500 },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { lumens: '150.5', usdc: '500.0' },
        });

      const { result } = renderHook(() => useCreatorBalance(undefined, false), {
        wrapper: wrapperFor(),
      });

      await act(async () => {
        await result.current.fetchBalance('creator-123', 'wallet-456');
      });

      expect(result.current.balance).toEqual({
        totalEarnings: 5000,
        pendingBalance: 500,
        lumens: '150.5',
        usdc: '500.0',
      });
      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/api/v1/creators/creator-123/earnings',
        undefined,
        expect.any(Object)
      );
      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/api/v1/wallet/wallet-456/balance',
        undefined,
        expect.any(Object)
      );
    });

    it('recovers gracefully when optional wallet balance fetch fails', async () => {
      mockRequest
        .mockResolvedValueOnce({
          success: true,
          data: { totalEarnings: 2000, pendingBalance: 100 },
        })
        .mockRejectedValueOnce(new Error('Wallet service unavailable'));

      const { result } = renderHook(() => useCreatorBalance(undefined, false), {
        wrapper: wrapperFor(),
      });

      await act(async () => {
        await result.current.fetchBalance('creator-123', 'wallet-456');
      });

      expect(result.current.balance).toEqual({
        totalEarnings: 2000,
        pendingBalance: 100,
      });
      expect(result.current.error).toBeUndefined();
      expect(consoleWarn).toHaveBeenCalledWith(
        'Failed to fetch wallet balance:',
        expect.any(Error)
      );
    });

    it('handles zero balances correctly', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: { totalEarnings: 0, pendingBalance: 0 },
      });

      const { result } = renderHook(() => useCreatorBalance(undefined, false), {
        wrapper: wrapperFor(),
      });

      await act(async () => {
        await result.current.fetchBalance('creator-new');
      });

      expect(result.current.balance?.totalEarnings).toBe(0);
      expect(result.current.balance?.pendingBalance).toBe(0);
    });
  });

  describe('error paths and context propagation', () => {
    it('propagates error to DorisioProvider context and rejects on manual fetch failure', async () => {
      const originalError = new Error('Creator not found');
      mockRequest.mockRejectedValueOnce(originalError);

      const onError = vi.fn();
      const { result } = renderHook(() => useCreatorBalance(undefined, false), {
        wrapper: wrapperFor({ onError }),
      });

      let caughtError: any;
      await act(async () => {
        try {
          await result.current.fetchBalance('creator-invalid');
        } catch (err) {
          caughtError = err;
        }
      });

      expect(caughtError).toBe(originalError);
      expect(result.current.error).toBe('Creator not found');
      expect(result.current.loading).toBe(false);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'FETCH_BALANCE_ERROR',
          message: 'Creator not found',
        })
      );
    });

    it('handles API response with success: false', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Earnings unavailable' },
      });

      const onError = vi.fn();
      const { result } = renderHook(() => useCreatorBalance(undefined, false), {
        wrapper: wrapperFor({ onError }),
      });

      await act(async () => {
        try {
          await result.current.fetchBalance('creator-1');
        } catch {
          // Expected rejection
        }
      });

      expect(result.current.error).toBe('Earnings unavailable');
      expect(result.current.loading).toBe(false);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'FETCH_BALANCE_ERROR',
          message: 'Earnings unavailable',
        })
      );
    });

    it('auto-fetch failure updates state and logs without unhandled promise rejection', async () => {
      mockRequest.mockRejectedValue(new Error('Network offline'));

      const { result } = renderHook(() => useCreatorBalance('creator-auto', true), {
        wrapper: wrapperFor(),
      });

      await waitFor(() => {
        expect(result.current.error).toBe('Network offline');
      });
      expect(result.current.loading).toBe(false);
      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('useCreatorBalance auto-fetch failed'),
          expect.any(Error)
        );
      });
    });
  });

  describe('refetch and reset', () => {
    it('refetches latest balance using stored creatorId and walletId', async () => {
      mockRequest
        .mockResolvedValueOnce({
          success: true,
          data: { totalEarnings: 100, pendingBalance: 10 },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { lumens: '10' },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { totalEarnings: 150, pendingBalance: 0 },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { lumens: '15' },
        });

      const { result } = renderHook(() => useCreatorBalance(undefined, false), {
        wrapper: wrapperFor(),
      });

      await act(async () => {
        await result.current.fetchBalance('creator-1', 'wallet-1');
      });

      expect(result.current.balance?.totalEarnings).toBe(100);

      await act(async () => {
        await result.current.refetch();
      });

      expect(result.current.balance?.totalEarnings).toBe(150);
      expect(mockRequest).toHaveBeenCalledTimes(4);
    });

    it('resets balance, loading, and tracking refs', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: { totalEarnings: 100, pendingBalance: 10 },
      });

      const { result } = renderHook(() => useCreatorBalance(undefined, false), {
        wrapper: wrapperFor(),
      });

      await act(async () => {
        await result.current.fetchBalance('creator-1');
      });

      expect(result.current.balance).toBeDefined();

      act(() => {
        result.current.reset();
      });

      expect(result.current.balance).toBeUndefined();
      expect(result.current.loading).toBe(false);
      expect(result.current.lastUpdated).toBeUndefined();

      // refetch after reset does not trigger a request
      mockRequest.mockClear();
      await act(async () => {
        await result.current.refetch();
      });
      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

  describe('race conditions and cleanup', () => {
    it('handles rapid successive calls maintaining latest creator filter', async () => {
      mockRequest
        .mockResolvedValueOnce({
          success: true,
          data: { totalEarnings: 100, pendingBalance: 10 },
        })
        .mockResolvedValueOnce({
          success: true,
          data: { totalEarnings: 200, pendingBalance: 20 },
        });

      const { result } = renderHook(() => useCreatorBalance(undefined, false), {
        wrapper: wrapperFor(),
      });

      await act(async () => {
        const p1 = result.current.fetchBalance('creator-1');
        const p2 = result.current.fetchBalance('creator-2');
        await Promise.all([p1, p2]);
      });

      expect(result.current.balance?.totalEarnings).toBe(200);

      // refetch now fetches creator-2
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: { totalEarnings: 250, pendingBalance: 20 },
      });

      await act(async () => {
        await result.current.refetch();
      });

      expect(mockRequest).toHaveBeenLastCalledWith(
        'GET',
        '/api/v1/creators/creator-2/earnings',
        undefined,
        expect.any(Object)
      );
    });

    it('handles unmount mid-request without error', async () => {
      let resolvePromise: (value: any) => void = () => undefined;
      const delayedPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockRequest.mockReturnValueOnce(delayedPromise);

      const { result, unmount } = renderHook(() => useCreatorBalance(undefined, false), {
        wrapper: wrapperFor(),
      });

      act(() => {
        result.current.fetchBalance('creator-123');
      });

      expect(result.current.loading).toBe(true);

      unmount();

      await act(async () => {
        resolvePromise({
          success: true,
          data: { totalEarnings: 100, pendingBalance: 0 },
        });
      });
    });
  });
});
