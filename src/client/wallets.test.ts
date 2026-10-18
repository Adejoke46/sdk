/**
 * Wallets Client Tests
 * Tests for wallet-related SDK methods covering connect, disconnect, fetch, update,
 * verify, and balance retrieval.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DorisioClient } from '../client';
import * as WalletMethods from './wallets';
import { CreateWalletRequest, UpdateWalletRequest } from '../types/models';

describe('Wallet Methods', () => {
  let client: DorisioClient;
  const mockRequest = vi.fn();

  beforeEach(() => {
    client = {
      request: mockRequest,
    } as any;

    client.connectWallet = WalletMethods.connectWallet.bind(client);
    client.disconnectWallet = WalletMethods.disconnectWallet.bind(client);
    client.getWallets = WalletMethods.getWallets.bind(client);
    client.getWallet = WalletMethods.getWallet.bind(client);
    client.updateWallet = WalletMethods.updateWallet.bind(client);
    client.verifyWallet = WalletMethods.verifyWallet.bind(client as any) as any;
    (client as any).getBalance = WalletMethods.getBalance.bind(client as any);

    mockRequest.mockClear();
  });

  describe('connectWallet', () => {
    it('connects a wallet successfully and returns normalized wallet', async () => {
      const rawWallet = {
        id: 'wallet-123',
        userId: 'user-456',
        publicKey: 'GABC1234567890',
        name: 'Main Wallet',
        verified: true,
        createdAt: '2024-01-01T00:00:00Z',
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: rawWallet,
      });

      const connectData: CreateWalletRequest = {
        publicKey: 'GABC1234567890',
        name: 'Main Wallet',
      };

      const result = await client.connectWallet(connectData);

      expect(result).toBeDefined();
      expect(result.id).toBe('wallet-123');
      expect(result.publicKey).toBe('GABC1234567890');
      expect(result.verified).toBe(true);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/wallets', connectData);
    });

    it('throws error when connecting wallet fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Invalid public key' },
      });

      await expect(
        client.connectWallet({ publicKey: 'INVALID' })
      ).rejects.toThrow('Failed to connect wallet');
    });

    it('throws on network failure', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        client.connectWallet({ publicKey: 'GABC' })
      ).rejects.toThrow('Network error');
    });
  });

  describe('disconnectWallet', () => {
    it('disconnects a wallet successfully', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: null,
      });

      await expect(client.disconnectWallet('wallet-123')).resolves.toBeUndefined();
      expect(mockRequest).toHaveBeenCalledWith('DELETE', '/wallets/wallet-123');
    });

    it('throws error when disconnecting wallet fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Wallet not found' },
      });

      await expect(client.disconnectWallet('wallet-invalid')).rejects.toThrow(
        'Failed to disconnect wallet: wallet-invalid'
      );
    });

    it('throws when network error occurs on disconnect', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Connection timed out'));

      await expect(client.disconnectWallet('wallet-123')).rejects.toThrow('Connection timed out');
    });
  });

  describe('getWallets', () => {
    it('fetches user wallets and normalizes the list', async () => {
      const rawWallets = [
        {
          id: 'w1',
          userId: 'u1',
          publicKey: 'G1',
          name: 'Wallet 1',
          verified: true,
          createdAt: '2024-01-01T00:00:00Z',
        },
        {
          id: 'w2',
          userId: 'u1',
          publicKey: 'G2',
          name: 'Wallet 2',
          verified: false,
          createdAt: '2024-01-02T00:00:00Z',
        },
      ];

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: rawWallets,
      });

      const result = await client.getWallets('u1');

      expect(result).toHaveLength(2);
      expect(result[0]?.id).toBe('w1');
      expect(result[1]?.id).toBe('w2');
      expect(mockRequest).toHaveBeenCalledWith('GET', '/users/u1/wallets');
    });

    it('returns empty array when response data is not an array', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: {},
      });

      const result = await client.getWallets('u1');
      expect(result).toEqual([]);
    });

    it('throws error when fetching wallets fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'User not found' },
      });

      await expect(client.getWallets('u-invalid')).rejects.toThrow(
        'Failed to fetch wallets for user: u-invalid'
      );
    });
  });

  describe('getWallet', () => {
    it('fetches a single wallet by id', async () => {
      const rawWallet = {
        id: 'w-42',
        userId: 'u-42',
        publicKey: 'GKEY42',
        name: 'Savings',
        verified: true,
        createdAt: '2024-01-01T00:00:00Z',
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: rawWallet,
      });

      const result = await client.getWallet('w-42');

      expect(result.id).toBe('w-42');
      expect(result.name).toBe('Savings');
      expect(mockRequest).toHaveBeenCalledWith('GET', '/wallets/w-42');
    });

    it('throws error when wallet is not found', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Not found' },
      });

      await expect(client.getWallet('w-missing')).rejects.toThrow(
        'Failed to fetch wallet: w-missing'
      );
    });
  });

  describe('updateWallet', () => {
    it('updates wallet details and returns normalized wallet', async () => {
      const updatedWallet = {
        id: 'w-1',
        userId: 'u-1',
        publicKey: 'GKEY',
        name: 'New Name',
        verified: true,
        createdAt: '2024-01-01T00:00:00Z',
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: updatedWallet,
      });

      const updateData: UpdateWalletRequest = { name: 'New Name' };
      const result = await client.updateWallet('w-1', updateData);

      expect(result.name).toBe('New Name');
      expect(mockRequest).toHaveBeenCalledWith('PATCH', '/wallets/w-1', updateData);
    });

    it('throws error on failed update', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Update failed' },
      });

      await expect(client.updateWallet('w-1', { name: 'Fail' })).rejects.toThrow(
        'Failed to update wallet: w-1'
      );
    });
  });

  describe('verifyWallet', () => {
    it('verifies wallet and returns normalized wallet', async () => {
      const verifiedWallet = {
        id: 'w-1',
        userId: 'u-1',
        publicKey: 'GKEY',
        verified: true,
        createdAt: '2024-01-01T00:00:00Z',
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: verifiedWallet,
      });

      const result = await (client.verifyWallet as any)('w-1');

      expect(result.verified).toBe(true);
      expect(mockRequest).toHaveBeenCalledWith('POST', '/wallets/w-1/verify');
    });

    it('throws error when verification fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Verification rejected' },
      });

      await expect((client.verifyWallet as any)('w-1')).rejects.toThrow(
        'Failed to verify wallet: w-1'
      );
    });
  });

  describe('getBalance', () => {
    it('fetches numeric balance for a wallet', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: 1250.75,
      });

      const balance = await (client.getBalance as any)('w-1');

      expect(balance).toBe(1250.75);
      expect(mockRequest).toHaveBeenCalledWith('GET', '/wallets/w-1/balance');
    });

    it('throws error when balance fetch fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Balance unavailable' },
      });

      await expect((client.getBalance as any)('w-1')).rejects.toThrow(
        'Failed to fetch wallet balance: w-1'
      );
    });
  });
});
