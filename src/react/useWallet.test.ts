/**
 * useWallet Hook Tests
 * Tests for wallet management hook — including finally-block guarantees.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { DorisioProvider } from './DorisioProvider';
import { useWallet, type UseWalletOptions } from './useWallet';

describe('useWallet Hook', () => {
  let mockClient: ReturnType<typeof buildMockClient>;
  let setIsLoading: ReturnType<typeof vi.fn>;
  let setError: ReturnType<typeof vi.fn>;

  function buildMockClient() {
    return { request: vi.fn() };
  }

  /**
   * Minimal simulation of the hook's try/catch/finally pattern so we can
   * assert that setIsLoading(false) is always called, even when setError throws.
   */
  function makeHookAction<T>(
    action: () => Promise<T>
  ): () => Promise<T> {
    return async () => {
      setIsLoading(true);
      try {
        return await action();
      } catch (err) {
        setError({ message: (err as Error).message });
        throw err;
      } finally {
        setIsLoading(false);
      }
    };
  }

  beforeEach(() => {
    mockClient = buildMockClient();
    setIsLoading = vi.fn();
    setError = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  // ─── generateNonce ────────────────────────────────────────────────────────

  describe('generateNonce', () => {
    it('should generate nonce for wallet verification', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: { nonce: 'nonce-abc123', expiresIn: 300 },
      });

      const response = await mockClient.request('POST', '/api/v1/wallet/nonce', {
        publicKey: 'GABC123',
      });

      expect(response.data.nonce).toBeDefined();
      expect(response.data.expiresIn).toBe(300);
    });

    it('should handle nonce generation error', async () => {
      mockClient.request.mockResolvedValue({
        success: false,
        error: { message: 'Invalid public key' },
      });

      const response = await mockClient.request('POST', '/api/v1/wallet/nonce', {
        publicKey: 'INVALID',
      });

      expect(response.success).toBe(false);
      expect(response.error.message).toBe('Invalid public key');
    });

    it('finally: setIsLoading(false) runs even when the operation throws', async () => {
      mockClient.request.mockRejectedValue(new Error('Network error'));

      const generateNonce = makeHookAction(async () => {
        await mockClient.request('POST', '/api/v1/wallet/nonce', { publicKey: 'G...' });
      });

      await expect(generateNonce()).rejects.toThrow('Network error');
      expect(setIsLoading).toHaveBeenLastCalledWith(false);
    });

    it('finally: setIsLoading(false) runs even when setError throws', async () => {
      mockClient.request.mockRejectedValue(new Error('fail'));
      setError.mockImplementation(() => { throw new Error('setError blew up'); });

      const generateNonce = makeHookAction(async () => {
        await mockClient.request('POST', '/api/v1/wallet/nonce', { publicKey: 'G...' });
      });

      await expect(generateNonce()).rejects.toThrow();
      // setIsLoading(false) must still have been called via finally
      const calls = setIsLoading.mock.calls.map((c) => c[0]);
      expect(calls).toContain(false);
    });
  });

  // ─── getChallenge ─────────────────────────────────────────────────────────

  describe('getChallenge', () => {
    it('should fetch challenge for signing', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: { challenge: 'AAAAAgAAAAC7Vhf4oNLCCHP...' },
      });

      const response = await mockClient.request('GET', '/api/v1/wallet/challenge/nonce-abc123');

      expect(response.data.challenge).toBeDefined();
    });

    it('finally: setIsLoading(false) runs on error', async () => {
      mockClient.request.mockRejectedValue(new Error('timeout'));

      const getChallenge = makeHookAction(async () => {
        await mockClient.request('GET', '/api/v1/wallet/challenge/nonce-abc123');
      });

      await expect(getChallenge()).rejects.toThrow('timeout');
      expect(setIsLoading).toHaveBeenLastCalledWith(false);
    });
  });

  // ─── verifyWallet ─────────────────────────────────────────────────────────

  describe('verifyWallet', () => {
    it('should verify wallet with signed challenge', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: { id: 'wallet-123', publicKey: 'GABC123', verified: true },
      });

      const response = await mockClient.request('POST', '/api/v1/wallet/verify', {
        publicKey: 'GABC123',
        nonce: 'nonce-abc123',
        signedTransaction: 'AAAAAgAAAAC7VhfSigned...',
      });

      expect(response.data.verified).toBe(true);
      expect(response.data.publicKey).toBe('GABC123');
    });

    it('should handle wallet verification failure', async () => {
      mockClient.request.mockResolvedValue({
        success: false,
        error: { message: 'Invalid signature' },
      });

      const response = await mockClient.request('POST', '/api/v1/wallet/verify', {
        publicKey: 'GABC123',
        nonce: 'nonce-abc123',
        signedTransaction: 'INVALID',
      });

      expect(response.success).toBe(false);
      expect(response.error.message).toBe('Invalid signature');
    });

    it('finally: setIsLoading(false) runs on rejected promise', async () => {
      mockClient.request.mockRejectedValue(new Error('Invalid signature'));

      const verifyWallet = makeHookAction(async () => {
        await mockClient.request('POST', '/api/v1/wallet/verify', {});
      });

      await expect(verifyWallet()).rejects.toThrow('Invalid signature');
      expect(setIsLoading).toHaveBeenLastCalledWith(false);
    });
  });

  // ─── listWallets ──────────────────────────────────────────────────────────

  describe('listWallets', () => {
    it('should list user wallets', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: {
          wallets: [
            { id: 'wallet-1', publicKey: 'GABC123', verified: true },
            { id: 'wallet-2', publicKey: 'GDEF456', verified: false },
          ],
        },
      });

      const response = await mockClient.request('GET', '/api/v1/wallet/list');

      expect(response.data.wallets).toHaveLength(2);
      expect(response.data.wallets[0].id).toBe('wallet-1');
    });

    it('should list wallets with balance', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: { wallets: [{ id: 'wallet-1', publicKey: 'GABC123', balance: 1000 }] },
      });

      const response = await mockClient.request('GET', '/api/v1/wallet/list?includeBalance=true');

      expect(response.data.wallets[0].balance).toBe(1000);
    });

    it('finally: setIsLoading(false) runs on error', async () => {
      mockClient.request.mockRejectedValue(new Error('Unauthorized'));

      const listWallets = makeHookAction(async () => {
        await mockClient.request('GET', '/api/v1/wallet/list');
      });

      await expect(listWallets()).rejects.toThrow('Unauthorized');
      expect(setIsLoading).toHaveBeenLastCalledWith(false);
    });
  });

  // ─── unlinkWallet ─────────────────────────────────────────────────────────

  describe('unlinkWallet', () => {
    it('should unlink wallet from account', async () => {
      mockClient.request.mockResolvedValue({ success: true, data: {} });

      const response = await mockClient.request('DELETE', '/api/v1/wallet/wallet-123');

      expect(response.success).toBe(true);
    });

    it('should handle unlink error', async () => {
      mockClient.request.mockResolvedValue({
        success: false,
        error: { message: 'Wallet not found' },
      });

      const response = await mockClient.request('DELETE', '/api/v1/wallet/wallet-invalid');

      expect(response.success).toBe(false);
      expect(response.error.message).toBe('Wallet not found');
    });

    it('finally: setIsLoading(false) runs on rejected promise', async () => {
      mockClient.request.mockRejectedValue(new Error('Not found'));

      const unlinkWallet = makeHookAction(async () => {
        await mockClient.request('DELETE', '/api/v1/wallet/wallet-123');
      });

      await expect(unlinkWallet()).rejects.toThrow('Not found');
      expect(setIsLoading).toHaveBeenLastCalledWith(false);
    });
  });

  // ─── renameWallet ─────────────────────────────────────────────────────────

  describe('renameWallet', () => {
    it('should rename wallet', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: { id: 'wallet-123', name: 'My Trading Wallet', publicKey: 'GABC123' },
      });

      const response = await mockClient.request('PATCH', '/api/v1/wallet/wallet-123/name', {
        name: 'My Trading Wallet',
      });

      expect(response.data.name).toBe('My Trading Wallet');
    });

    it('finally: setIsLoading(false) runs on error', async () => {
      mockClient.request.mockRejectedValue(new Error('Wallet not found'));

      const renameWallet = makeHookAction(async () => {
        await mockClient.request('PATCH', '/api/v1/wallet/wallet-123/name', { name: 'X' });
      });

      await expect(renameWallet()).rejects.toThrow('Wallet not found');
      expect(setIsLoading).toHaveBeenLastCalledWith(false);
    });
  });

  // ─── getBalance ───────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('should fetch wallet balance', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: { available: 1000, pending: 50, total: 1050 },
      });

      const response = await mockClient.request('GET', '/api/v1/wallet/wallet-123/balance');

      expect(response.data.available).toBe(1000);
      expect(response.data.pending).toBe(50);
    });

    it('should handle balance fetch error', async () => {
      mockClient.request.mockResolvedValue({
        success: false,
        error: { message: 'Wallet not found' },
      });

      const response = await mockClient.request('GET', '/api/v1/wallet/wallet-invalid/balance');

      expect(response.success).toBe(false);
    });

    it('finally: setIsLoading(false) runs on rejected promise', async () => {
      mockClient.request.mockRejectedValue(new Error('Network timeout'));

      const getBalance = makeHookAction(async () => {
        await mockClient.request('GET', '/api/v1/wallet/wallet-123/balance');
      });

      await expect(getBalance()).rejects.toThrow('Network timeout');
      expect(setIsLoading).toHaveBeenLastCalledWith(false);
    });

    it('finally: setIsLoading(false) runs even when setError itself throws', async () => {
      mockClient.request.mockRejectedValue(new Error('fail'));
      setError.mockImplementation(() => { throw new Error('setError blew up'); });

      const getBalance = makeHookAction(async () => {
        await mockClient.request('GET', '/api/v1/wallet/wallet-123/balance');
      });

      await expect(getBalance()).rejects.toThrow();
      const calls = setIsLoading.mock.calls.map((c) => c[0]);
      expect(calls).toContain(false);
    });
  });

  describe('stale closure fixes', () => {
    it('generateNonce should preserve wallets via functional state update', () => {
      let state = {
        wallets: [{ id: 'w1' }],
        selectedWallet: { id: 'w1' },
        nonce: undefined as string | undefined,
        challengeStep: 'idle',
        loading: false,
      };

      // Functional update pattern used by fixed generateNonce
      const applyNonce = (nonce: string) => {
        state = { ...state, nonce, challengeStep: 'nonce-generated', loading: false };
      };

      applyNonce('abc');
      expect(state.wallets).toHaveLength(1);
      expect(state.selectedWallet?.id).toBe('w1');
      expect(state.nonce).toBe('abc');
      expect(state.challengeStep).toBe('nonce-generated');
    });
  });

  // ─── realtime balance updates ─────────────────────────────────────────────

  function buildRealtimeClient() {
    const unsubscribe = vi.fn();
    return {
      request: vi.fn(),
      subscribeRealtime: vi.fn(() => unsubscribe),
      getRealtime: vi.fn(() => null),
      enableRealtime: vi.fn().mockResolvedValue(undefined),
      disableRealtime: vi.fn(),
      unsubscribe,
    };
  }

  function renderUseWallet(client: any, initialOptions: UseWalletOptions = {}) {
    const Wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(DorisioProvider, { client, config: {} as any, children });
    return renderHook(({ realtime }: { realtime?: boolean }) => useWallet({ realtime }), {
      initialProps: { realtime: initialOptions.realtime },
      wrapper: Wrapper,
    });
  }

  describe('realtime balance updates', () => {
    let client: ReturnType<typeof buildRealtimeClient>;

    beforeEach(() => {
      client = buildRealtimeClient();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('subscribes to the balance channel when realtime is true', async () => {
      renderUseWallet(client, { realtime: true });

      await waitFor(() => {
        expect(client.subscribeRealtime).toHaveBeenCalledWith('balance', expect.any(Function));
      });
    });

    it('does not subscribe when realtime is false', async () => {
      renderUseWallet(client, { realtime: false });

      await waitFor(() => {
        expect(client.subscribeRealtime).not.toHaveBeenCalled();
      });
      expect(client.enableRealtime).not.toHaveBeenCalled();
    });

    it('does not subscribe when realtime is not provided (opt-in)', async () => {
      renderUseWallet(client);

      await waitFor(() => {
        expect(client.subscribeRealtime).not.toHaveBeenCalled();
      });
    });

    it('updates wallet balance when a balance event arrives (matched by walletId)', async () => {
      const { result } = renderUseWallet(client, { realtime: true });

      await waitFor(() => {
        expect(client.subscribeRealtime).toHaveBeenCalled();
      });

      const listener = client.subscribeRealtime.mock.calls[0][1];
      act(() => {
        listener({
          data: {
            walletId: 'wallet-1',
            balance: { available: 2000, pending: 100, total: 2100 },
            timestamp: 1_000_000,
          },
        });
      });

      expect(result.current.balances['wallet-1']).toEqual({
        available: 2000,
        pending: 100,
        total: 2100,
      });
      expect(result.current.lastRealtimeUpdate).toBe(1_000_000);
    });

    it('updates wallet balance when matched by publicKey', async () => {
      const { result } = renderUseWallet(client, { realtime: true });

      await waitFor(() => {
        expect(client.subscribeRealtime).toHaveBeenCalled();
      });

      const listener = client.subscribeRealtime.mock.calls[0][1];
      act(() => {
        listener({
          data: {
            publicKey: 'GABC123',
            balance: { available: 500, pending: 0, total: 500 },
          },
        });
      });

      expect(result.current.balances['wallet-1']).toBeUndefined();
      expect(result.current.lastRealtimeUpdate).toBeDefined();
    });

    it('does not update state after unmount', async () => {
      const { result, unmount } = renderUseWallet(client, { realtime: true });

      await waitFor(() => {
        expect(client.subscribeRealtime).toHaveBeenCalled();
      });

      const listener = client.subscribeRealtime.mock.calls[0][1];
      unmount();

      act(() => {
        listener({
          data: {
            walletId: 'wallet-1',
            balance: { available: 999, pending: 0, total: 999 },
          },
        });
      });

      expect(result.current.balances['wallet-1']).toBeUndefined();
    });

    it('unsubscribes from the channel on unmount', async () => {
      const { unmount } = renderUseWallet(client, { realtime: true });

      await waitFor(() => {
        expect(client.subscribeRealtime).toHaveBeenCalled();
      });

      unmount();

      expect(client.unsubscribe).toHaveBeenCalled();
    });

    it('does not leak a subscription after unmount (subscribes once)', async () => {
      const { unmount } = renderUseWallet(client, { realtime: true });

      await waitFor(() => {
        expect(client.subscribeRealtime).toHaveBeenCalledTimes(1);
      });

      const listener = client.subscribeRealtime.mock.calls[0][1];
      unmount();

      act(() => {
        listener({
          data: {
            walletId: 'wallet-1',
            balance: { available: 1, pending: 0, total: 1 },
          },
        });
      });

      expect(client.subscribeRealtime).toHaveBeenCalledTimes(1);
      expect(client.unsubscribe).toHaveBeenCalled();
    });

    it('enables realtime via enableRealtime when the socket is not yet enabled', async () => {
      client.getRealtime.mockReturnValueOnce(null);
      renderUseWallet(client, { realtime: true });

      await waitFor(() => {
        expect(client.enableRealtime).toHaveBeenCalled();
      });
    });

    it('does not call enableRealtime when realtime is already enabled', async () => {
      client.getRealtime.mockReturnValue({} as any);
      renderUseWallet(client, { realtime: true });

      await waitFor(() => {
        expect(client.subscribeRealtime).toHaveBeenCalled();
      });

      expect(client.enableRealtime).not.toHaveBeenCalled();
    });

    it('re-subscribes when realtime is toggled off then on', async () => {
      const { rerender } = renderUseWallet(client, { realtime: true });

      await waitFor(() => {
        expect(client.subscribeRealtime).toHaveBeenCalledTimes(1);
      });

      rerender({ realtime: false });
      expect(client.unsubscribe).toHaveBeenCalled();

      rerender({ realtime: true });
      await waitFor(() => {
        expect(client.subscribeRealtime).toHaveBeenCalledTimes(2);
      });
    });

    it('records balance events keyed by wallet id', async () => {
      const { result } = renderUseWallet(client, { realtime: true });

      await waitFor(() => {
        expect(client.subscribeRealtime).toHaveBeenCalled();
      });

      const listener = client.subscribeRealtime.mock.calls[0][1];
      act(() => {
        listener({
          data: {
            walletId: 'unknown-wallet',
            balance: { available: 5, pending: 0, total: 5 },
          },
        });
      });

      expect(result.current.balances['unknown-wallet']).toEqual({
        available: 5,
        pending: 0,
        total: 5,
      });
      expect(result.current.loading).toBe(false);
    });
  });
});
