/**
 * Balance Client Tests
 * Tests for balance and account summary SDK methods.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DorisioClient } from '../client';
import * as BalanceMethods from './balance';

describe('Balance Methods', () => {
  let client: DorisioClient;
  const mockRequest = vi.fn();

  beforeEach(() => {
    client = {
      request: mockRequest,
    } as any;

    client.getBalance = BalanceMethods.getBalance.bind(client);
    client.getWalletBalance = BalanceMethods.getWalletBalance.bind(client);
    client.getCreatorPendingPayout = BalanceMethods.getCreatorPendingPayout.bind(client);
    client.canPayout = BalanceMethods.canPayout.bind(client);
    client.getAccountSummary = BalanceMethods.getAccountSummary.bind(client);

    mockRequest.mockClear();
  });

  describe('getBalance', () => {
    it('fetches user total balance and calculates totals across wallets', async () => {
      const rawBalanceResponse = {
        total: 1000,
        available: 800,
        pending: 200,
        wallets: [
          {
            walletId: 'w-1',
            available: 500,
            pending: 100,
            currency: 'USDC',
          },
          {
            walletId: 'w-2',
            available: 300,
            pending: 100,
            currency: 'USDC',
          },
        ],
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: rawBalanceResponse,
      });

      const balance = await client.getBalance('user-123');

      expect(balance.total).toBe(1000);
      expect(balance.available).toBe(800);
      expect(balance.pending).toBe(200);
      expect(balance.wallets).toHaveLength(2);
      expect(balance.wallets[0]?.total).toBe(600); // 500 + 100
      expect(balance.wallets[1]?.total).toBe(400); // 300 + 100
      expect(mockRequest).toHaveBeenCalledWith('GET', '/users/user-123/balance');
    });

    it('throws error when balance fetch fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'User not found' },
      });

      await expect(client.getBalance('user-invalid')).rejects.toThrow(
        'Failed to fetch balance for user: user-invalid'
      );
    });

    it('throws error on network rejection', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.getBalance('user-123')).rejects.toThrow('Network error');
    });
  });

  describe('getWalletBalance', () => {
    it('fetches single wallet balance and calculates total', async () => {
      const rawWalletBalance = {
        available: 250,
        pending: 50,
        currency: 'USDC',
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: rawWalletBalance,
      });

      const result = await client.getWalletBalance('wallet-456');

      expect(result.walletId).toBe('wallet-456');
      expect(result.available).toBe(250);
      expect(result.pending).toBe(50);
      expect(result.total).toBe(300);
      expect(result.currency).toBe('USDC');
      expect(mockRequest).toHaveBeenCalledWith('GET', '/wallets/wallet-456/balance');
    });

    it('throws error when wallet balance fetch fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Wallet not found' },
      });

      await expect(client.getWalletBalance('wallet-missing')).rejects.toThrow(
        'Failed to fetch wallet balance: wallet-missing'
      );
    });
  });

  describe('getCreatorPendingPayout', () => {
    it('fetches creator pending payout details', async () => {
      const rawPayoutData = {
        pending: 150,
        nextPayoutDate: '2024-02-01T00:00:00Z',
        minimumThreshold: 50,
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: rawPayoutData,
      });

      const result = await client.getCreatorPendingPayout('creator-789');

      expect(result.pending).toBe(150);
      expect(result.nextPayoutDate).toBe('2024-02-01T00:00:00Z');
      expect(result.minimumThreshold).toBe(50);
      expect(mockRequest).toHaveBeenCalledWith('GET', '/creators/creator-789/payout-pending');
    });

    it('uses default minimumThreshold when not provided by API', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: { pending: 5 },
      });

      const result = await client.getCreatorPendingPayout('creator-789');

      expect(result.pending).toBe(5);
      expect(result.minimumThreshold).toBe(10); // schema default is 10
    });

    it('throws error when fetching pending payout fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Creator not found' },
      });

      await expect(client.getCreatorPendingPayout('invalid')).rejects.toThrow(
        'Failed to fetch pending payout for creator: invalid'
      );
    });
  });

  describe('canPayout', () => {
    it('returns true when creator is eligible for payout', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: true,
      });

      const eligible = await client.canPayout('creator-1');
      expect(eligible).toBe(true);
      expect(mockRequest).toHaveBeenCalledWith('GET', '/creators/creator-1/can-payout');
    });

    it('returns false when creator is not eligible', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: false,
      });

      const eligible = await client.canPayout('creator-1');
      expect(eligible).toBe(false);
    });

    it('throws error when eligibility check fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Server error' },
      });

      await expect(client.canPayout('creator-1')).rejects.toThrow(
        'Failed to check payout eligibility for creator: creator-1'
      );
    });
  });

  describe('getAccountSummary', () => {
    it('fetches full account summary with balances and stats', async () => {
      const summaryData = {
        userId: 'u-1',
        email: 'user@example.com',
        role: 'creator',
        balance: {
          total: 500,
          available: 400,
          pending: 100,
          wallets: [
            {
              walletId: 'w-1',
              available: 400,
              pending: 100,
              currency: 'USDC',
            },
          ],
        },
        totalTipsSent: 50,
        totalEarnings: 450,
        lastActivityDate: '2024-01-10T00:00:00Z',
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: summaryData,
      });

      const summary = await client.getAccountSummary();

      expect(summary.userId).toBe('u-1');
      expect(summary.email).toBe('user@example.com');
      expect(summary.role).toBe('creator');
      expect(summary.balance.total).toBe(500);
      expect(summary.balance.wallets[0]?.total).toBe(500);
      expect(summary.totalTipsSent).toBe(50);
      expect(summary.totalEarnings).toBe(450);
      expect(mockRequest).toHaveBeenCalledWith('GET', '/users/me/summary');
    });

    it('handles account summary with omitted balance object by providing defaults', async () => {
      const summaryData = {
        userId: 'u-2',
        email: 'user2@example.com',
        role: 'fan',
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: summaryData,
      });

      const summary = await client.getAccountSummary();

      expect(summary.userId).toBe('u-2');
      expect(summary.balance.total).toBe(0);
      expect(summary.balance.available).toBe(0);
      expect(summary.balance.wallets).toEqual([]);
    });

    it('throws error when fetching account summary fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Unauthorized' },
      });

      await expect(client.getAccountSummary()).rejects.toThrow(
        'Failed to fetch account summary'
      );
    });
  });
});
