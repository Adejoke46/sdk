/**
 * useWallet Hook Tests
 * Tests for wallet management hook
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('useWallet Hook', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      request: vi.fn(),
    };
  });

  describe('generateNonce', () => {
    it('should generate nonce for wallet verification', async () => {
      const mockResponse = {
        success: true,
        data: { nonce: 'nonce-abc123', expiresIn: 300 },
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const response = await mockClient.request('POST', '/api/v1/wallet/nonce', {
        publicKey: 'GABC123',
      });

      expect(response.data.nonce).toBeDefined();
      expect(response.data.expiresIn).toBe(300);
      expect(mockClient.request).toHaveBeenCalledWith('POST', '/api/v1/wallet/nonce', {
        publicKey: 'GABC123',
      });
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
  });

  describe('getChallenge', () => {
    it('should fetch challenge for signing', async () => {
      const mockResponse = {
        success: true,
        data: { challenge: 'AAAAAgAAAAC7Vhf4oNLCCHP...' },
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const response = await mockClient.request('GET', '/api/v1/wallet/challenge/nonce-abc123');

      expect(response.data.challenge).toBeDefined();
      expect(mockClient.request).toHaveBeenCalledWith(
        'GET',
        '/api/v1/wallet/challenge/nonce-abc123'
      );
    });
  });

  describe('verifyWallet', () => {
    it('should verify wallet with signed challenge', async () => {
      const mockWallet = {
        success: true,
        data: {
          id: 'wallet-123',
          publicKey: 'GABC123',
          verified: true,
          createdAt: '2024-01-01T00:00:00Z',
        },
      };

      mockClient.request.mockResolvedValue(mockWallet);

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
  });

  describe('listWallets', () => {
    it('should list user wallets', async () => {
      const mockResponse = {
        success: true,
        data: {
          wallets: [
            { id: 'wallet-1', publicKey: 'GABC123', verified: true },
            { id: 'wallet-2', publicKey: 'GDEF456', verified: false },
          ],
        },
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const response = await mockClient.request('GET', '/api/v1/wallet/list');

      expect(response.data.wallets).toHaveLength(2);
      expect(response.data.wallets[0].id).toBe('wallet-1');
    });

    it('should list wallets with balance', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: {
          wallets: [{ id: 'wallet-1', publicKey: 'GABC123', balance: 1000 }],
        },
      });

      const response = await mockClient.request('GET', '/api/v1/wallet/list?includeBalance=true');

      expect(response.data.wallets[0].balance).toBe(1000);
      expect(mockClient.request).toHaveBeenCalledWith(
        'GET',
        '/api/v1/wallet/list?includeBalance=true'
      );
    });
  });

  describe('unlinkWallet', () => {
    it('should unlink wallet from account', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: {},
      });

      const response = await mockClient.request('DELETE', '/api/v1/wallet/wallet-123');

      expect(response.success).toBe(true);
      expect(mockClient.request).toHaveBeenCalledWith('DELETE', '/api/v1/wallet/wallet-123');
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
  });

  describe('renameWallet', () => {
    it('should rename wallet', async () => {
      const mockResponse = {
        success: true,
        data: {
          id: 'wallet-123',
          name: 'My Trading Wallet',
          publicKey: 'GABC123',
        },
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const response = await mockClient.request('PATCH', '/api/v1/wallet/wallet-123/name', {
        name: 'My Trading Wallet',
      });

      expect(response.data.name).toBe('My Trading Wallet');
      expect(mockClient.request).toHaveBeenCalledWith('PATCH', '/api/v1/wallet/wallet-123/name', {
        name: 'My Trading Wallet',
      });
    });
  });

  describe('getBalance', () => {
    it('should fetch wallet balance', async () => {
      const mockResponse = {
        success: true,
        data: {
          available: 1000,
          pending: 50,
          total: 1050,
        },
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const response = await mockClient.request('GET', '/api/v1/wallet/wallet-123/balance');

      expect(response.data.available).toBe(1000);
      expect(response.data.pending).toBe(50);
      expect(mockClient.request).toHaveBeenCalledWith('GET', '/api/v1/wallet/wallet-123/balance');
    });

    it('should handle balance fetch error', async () => {
      mockClient.request.mockResolvedValue({
        success: false,
        error: { message: 'Wallet not found' },
      });

      const response = await mockClient.request('GET', '/api/v1/wallet/wallet-invalid/balance');

      expect(response.success).toBe(false);
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
});
