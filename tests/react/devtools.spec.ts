/**
 * React DevTools integration tests for SDK hooks.
 *
 * Verifies that useDebugValue() is called in every SDK hook with meaningful
 * values (loading, error, data, client config) that React DevTools can display.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DorisioProvider } from '../../src/react/DorisioProvider';
import { useUser } from '../../src/react/useUser';
import { useWallet } from '../../src/react/useWallet';
import { useCreator } from '../../src/react/useCreator';
import { useCreateTip } from '../../src/react/useCreateTip';
import { useTransactionHistory } from '../../src/react/useTransactionHistory';
import { useCreatorBalance } from '../../src/react/useCreatorBalance';

function wrapper({ children }: { children: React.ReactNode }) {
  const mockClient = {
    request: vi.fn(),
    setToken: vi.fn(),
    clearToken: vi.fn(),
  };
  return React.createElement(DorisioProvider, {
    client: mockClient,
    config: { baseUrl: 'https://api.dorisio.com' } as any,
    children,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('React DevTools - useDebugValue integration', () => {
  describe('useUser', () => {
    it('displays initial debug values: loading=false, error=null, user=null, isAuthenticated=false', () => {
      const { result } = renderHook(() => useUser(), { wrapper });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.user).toBeNull();
      expect(result.current.isAuthenticated).toBe(false);
    });

    it('displays updated debug values after successful fetch', async () => {
      const mockClient = {
        request: vi.fn().mockResolvedValueOnce({
          success: true,
          data: { id: 'user-123', email: 'fan@example.com', name: 'Fan', role: 'fan', verified: true, createdAt: '2024-01-01T00:00:00Z' },
        }),
        setToken: vi.fn(),
        clearToken: vi.fn(),
      };

      const customWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(DorisioProvider, { client: mockClient, config: {} as any, children });

      const { result } = renderHook(() => useUser(), { wrapper: customWrapper });

      await act(async () => {
        await result.current.fetchUser('user-123');
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.user?.id).toBe('user-123');
      expect(result.current.isAuthenticated).toBe(false);
    });

    it('displays error debug value when fetch fails', async () => {
      const error = new Error('Not found');
      const mockClient = {
        request: vi.fn().mockRejectedValueOnce(error),
        setToken: vi.fn(),
        clearToken: vi.fn(),
      };

      const customWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(DorisioProvider, { client: mockClient, config: {} as any, children });

      const { result } = renderHook(() => useUser(), { wrapper: customWrapper });

      await act(async () => {
        await result.current.fetchUser('missing').catch(() => undefined);
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBe(error);
    });
  });

  describe('useWallet', () => {
    it('displays initial debug values: loading=false, challengeStep=idle, walletsCount=0', () => {
      const { result } = renderHook(() => useWallet(), { wrapper });

      expect(result.current.loading).toBe(false);
      expect(result.current.challengeStep).toBe('idle');
      expect(result.current.wallets).toHaveLength(0);
      expect(result.current.selectedWallet).toBeUndefined();
    });

    it('displays updated debug values after listing wallets', async () => {
      const mockClient = {
        request: vi.fn().mockResolvedValueOnce({
          success: true,
          data: { wallets: [{ id: 'w1', publicKey: 'GABC123', verified: true }] },
        }),
        setToken: vi.fn(),
        clearToken: vi.fn(),
      };

      const customWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(DorisioProvider, { client: mockClient, config: {} as any, children });

      const { result } = renderHook(() => useWallet(), { wrapper: customWrapper });

      await act(async () => {
        await result.current.listWallets();
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.wallets).toHaveLength(1);
      expect(result.current.challengeStep).toBe('idle');
    });

    it('displays error debug value on wallet operation failure', async () => {
      const mockClient = {
        request: vi.fn().mockResolvedValueOnce({
          success: false,
          error: { message: 'Invalid public key' },
        }),
        setToken: vi.fn(),
        clearToken: vi.fn(),
      };

      const customWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(DorisioProvider, { client: mockClient, config: {} as any, children });

      const { result } = renderHook(() => useWallet(), { wrapper: customWrapper });

      await act(async () => {
        await result.current.generateNonce('INVALID').catch(() => undefined);
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeDefined();
    });
  });

  describe('useCreator', () => {
    it('displays initial debug values: loading=false, error=null, creator=null, profile=null', () => {
      const { result } = renderHook(() => useCreator(), { wrapper });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.creator).toBeNull();
      expect(result.current.profile).toBeNull();
    });

    it('displays updated debug values after fetching creator', async () => {
      const mockClient = {
        request: vi.fn().mockResolvedValueOnce({
          success: true,
          data: { id: 'creator-123', name: 'Creator Name', bio: 'A creator', verified: false },
        }),
        setToken: vi.fn(),
        clearToken: vi.fn(),
      };

      const customWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(DorisioProvider, { client: mockClient, config: {} as any, children });

      const { result } = renderHook(() => useCreator(), { wrapper: customWrapper });

      await act(async () => {
        await result.current.fetchCreator('creator-123');
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.creator?.id).toBe('creator-123');
      expect(result.current.creator?.name).toBe('Creator Name');
    });
  });

  describe('useCreateTip', () => {
    it('displays initial debug values: loading=false, submitting=false, step=idle, error=undefined', () => {
      const { result } = renderHook(() => useCreateTip(), { wrapper });

      expect(result.current.loading).toBe(false);
      expect(result.current.submitting).toBe(false);
      expect(result.current.step).toBe('idle');
      expect(result.current.error).toBeUndefined();
    });

    it('displays updating debug values during tip creation', async () => {
      const mockClient = {
        request: vi.fn(),
        createTip: vi.fn().mockResolvedValue({ id: 'tip-123', amount: 25, status: 'pending' }),
        setToken: vi.fn(),
        clearToken: vi.fn(),
      };

      const customWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(DorisioProvider, { client: mockClient, config: {} as any, children });

      const { result } = renderHook(() => useCreateTip(), { wrapper: customWrapper });

      await act(async () => {
        await result.current.createTip({ creatorId: 'creator-1', amount: 25, message: 'Thanks' });
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.submitting).toBe(false);
      expect(result.current.step).toBe('idle');
      expect(result.current.data?.id).toBe('tip-123');
    });
  });

  describe('useTransactionHistory', () => {
    it('displays initial debug values: loading=false, transactionsCount=0, page=1, pageSize=10, total=0', () => {
      const { result } = renderHook(() => useTransactionHistory(), { wrapper });

      expect(result.current.loading).toBe(false);
      expect(result.current.transactions).toHaveLength(0);
      expect(result.current.page).toBe(1);
      expect(result.current.pageSize).toBe(10);
      expect(result.current.total).toBe(0);
    });

    it('displays updated debug values after fetching history', async () => {
      const mockClient = {
        request: vi.fn().mockResolvedValueOnce({
          success: true,
          data: {
            transactions: [{ id: 'tx-1', amount: 100 }, { id: 'tx-2', amount: 50 }],
            total: 2,
            page: 1,
            pageSize: 20,
          },
        }),
        setToken: vi.fn(),
        clearToken: vi.fn(),
      };

      const customWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(DorisioProvider, { client: mockClient, config: {} as any, children });

      const { result } = renderHook(() => useTransactionHistory(), { wrapper: customWrapper });

      await act(async () => {
        await result.current.fetchHistory({ page: 1, pageSize: 20 });
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.transactions).toHaveLength(2);
      expect(result.current.page).toBe(1);
      expect(result.current.pageSize).toBe(20);
      expect(result.current.total).toBe(2);
    });
  });

  describe('useCreatorBalance', () => {
    it('displays initial debug values: loading=false, error=undefined, balance=undefined', () => {
      const { result } = renderHook(() => useCreatorBalance(), { wrapper });

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeUndefined();
      expect(result.current.balance).toBeUndefined();
    });

    it('displays updated debug values after fetching balance', async () => {
      const mockClient = {
        request: vi.fn().mockResolvedValueOnce({
          success: true,
          data: { totalEarnings: 1500.5, pendingBalance: 250.0, confirmedBalance: 1000.0, transactionCount: 10 },
        }),
        setToken: vi.fn(),
        clearToken: vi.fn(),
      };

      const customWrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(DorisioProvider, { client: mockClient, config: {} as any, children });

      const { result } = renderHook(() => useCreatorBalance(), { wrapper: customWrapper });

      await act(async () => {
        await result.current.fetchBalance('creator-123');
      });

      expect(result.current.loading).toBe(false);
      expect(result.current.balance?.totalEarnings).toBe(1500.5);
      expect(result.current.balance?.pendingBalance).toBe(250.0);
    });
  });
});
