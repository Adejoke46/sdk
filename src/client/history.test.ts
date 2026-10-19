/**
 * History Client Tests
 * Tests for history SDK methods covering full transaction history with filters,
 * transaction statistics, creator earnings, and history export.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DorisioClient } from '../client';
import * as HistoryMethods from './history';

describe('History Methods', () => {
  let client: DorisioClient;
  const mockRequest = vi.fn();

  beforeEach(() => {
    client = {
      request: mockRequest,
    } as any;

    client.getFullTransactionHistory = HistoryMethods.getFullTransactionHistory.bind(client);
    client.getTransactionStats = HistoryMethods.getTransactionStats.bind(client);
    client.getCreatorEarnings = HistoryMethods.getCreatorEarnings.bind(client);
    // `bind` collapses the method's overloads; restore them for the fake client.
    client.exportTransactionHistory = HistoryMethods.exportTransactionHistory.bind(
      client
    ) as unknown as DorisioClient['exportTransactionHistory'];

    mockRequest.mockClear();
  });

  describe('getFullTransactionHistory', () => {
    it('fetches transaction history with pagination and status query params', async () => {
      const rawHistory = {
        transactions: [
          {
            id: 'tx-1',
            fromUserId: 'u-1',
            creatorId: 'c-1',
            amount: 50,
            status: 'confirmed',
            createdAt: '2024-01-10T12:00:00Z',
          },
          {
            id: 'tx-2',
            fromUserId: 'u-2',
            creatorId: 'c-1',
            amount: 100,
            status: 'completed', // should normalize to 'confirmed'
            createdAt: '2024-01-11T12:00:00Z',
          },
        ],
        total: 2,
        page: 1,
        pageSize: 10,
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: rawHistory,
      });

      const result = await client.getFullTransactionHistory({
        page: 1,
        pageSize: 10,
        status: 'confirmed',
      });

      expect(result.transactions).toHaveLength(2);
      expect(result.transactions[0]?.status).toBe('confirmed');
      expect(result.transactions[1]?.status).toBe('confirmed');
      expect(result.total).toBe(2);
      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        '/transactions?page=1&pageSize=10&status=confirmed'
      );
    });

    it('filters transactions by date range client-side when provided', async () => {
      const rawHistory = {
        transactions: [
          {
            id: 'tx-old',
            fromUserId: 'u-1',
            creatorId: 'c-1',
            amount: 10,
            status: 'confirmed',
            createdAt: '2024-01-01T00:00:00Z',
          },
          {
            id: 'tx-in-range',
            fromUserId: 'u-1',
            creatorId: 'c-1',
            amount: 20,
            status: 'confirmed',
            createdAt: '2024-01-15T00:00:00Z',
          },
          {
            id: 'tx-future',
            fromUserId: 'u-1',
            creatorId: 'c-1',
            amount: 30,
            status: 'confirmed',
            createdAt: '2024-02-01T00:00:00Z',
          },
        ],
        total: 3,
        page: 1,
        pageSize: 20,
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: rawHistory,
      });

      const startDate = new Date('2024-01-10T00:00:00Z');
      const endDate = new Date('2024-01-20T00:00:00Z');

      const result = await client.getFullTransactionHistory({
        startDate,
        endDate,
      });

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0]?.id).toBe('tx-in-range');
      expect(result.total).toBe(1);
    });

    it('throws error when fetching transaction history fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Unauthorized' },
      });

      await expect(client.getFullTransactionHistory()).rejects.toThrow(
        'Failed to fetch transaction history'
      );
    });
  });

  describe('getTransactionStats', () => {
    it('fetches transaction statistics without userId', async () => {
      const rawStats = {
        totalTransactions: 10,
        totalAmount: 500,
        averageAmount: 50,
        lastTransactionDate: '2024-01-20T00:00:00Z',
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: rawStats,
      });

      const stats = await client.getTransactionStats();

      expect(stats.totalTransactions).toBe(10);
      expect(stats.totalAmount).toBe(500);
      expect(stats.averageAmount).toBe(50);
      expect(stats.lastTransactionDate).toBe('2024-01-20T00:00:00Z');
      expect(mockRequest).toHaveBeenCalledWith('GET', '/transactions/stats');
    });

    it('fetches transaction statistics with userId parameter', async () => {
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: {
          totalTransactions: 3,
          totalAmount: 75,
          averageAmount: 25,
          lastTransactionDate: null,
        },
      });

      const stats = await client.getTransactionStats('user-456');

      expect(stats.totalTransactions).toBe(3);
      expect(stats.lastTransactionDate).toBeNull();
      expect(mockRequest).toHaveBeenCalledWith('GET', '/transactions/stats?userId=user-456');
    });

    it('throws error when fetching transaction stats fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Database failure' },
      });

      await expect(client.getTransactionStats()).rejects.toThrow(
        'Failed to fetch transaction statistics'
      );
    });
  });

  describe('getCreatorEarnings', () => {
    it('fetches earnings summary for a creator', async () => {
      const rawEarnings = {
        totalEarnings: 12000,
        pendingBalance: 1500,
        confirmedBalance: 10500,
        transactionCount: 85,
      };

      mockRequest.mockResolvedValueOnce({
        success: true,
        data: rawEarnings,
      });

      const earnings = await client.getCreatorEarnings('creator-1');

      expect(earnings.totalEarnings).toBe(12000);
      expect(earnings.pendingBalance).toBe(1500);
      expect(earnings.confirmedBalance).toBe(10500);
      expect(earnings.transactionCount).toBe(85);
      expect(mockRequest).toHaveBeenCalledWith('GET', '/creators/creator-1/earnings');
    });

    it('throws error when fetching creator earnings fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Creator not found' },
      });

      await expect(client.getCreatorEarnings('creator-invalid')).rejects.toThrow(
        'Failed to fetch earnings for creator: creator-invalid'
      );
    });
  });

  describe('exportTransactionHistory', () => {
    it('exports transaction history as JSON string by default', async () => {
      const mockExportData = JSON.stringify([{ id: 'tx-1', amount: 50 }]);
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: mockExportData,
      });

      const exported = await client.exportTransactionHistory();

      expect(exported).toBe(mockExportData);
      expect(mockRequest).toHaveBeenCalledWith('GET', '/transactions/export?format=json');
    });

    it('exports transaction history as CSV with date parameters', async () => {
      const mockCsv = 'id,amount,createdAt\ntx-1,50,2024-01-01T00:00:00.000Z';
      mockRequest.mockResolvedValueOnce({
        success: true,
        data: mockCsv,
      });

      const startDate = new Date('2024-01-01T00:00:00.000Z');
      const endDate = new Date('2024-01-31T00:00:00.000Z');

      const exported = await client.exportTransactionHistory({
        format: 'csv',
        startDate,
        endDate,
      });

      expect(exported).toBe(mockCsv);
      expect(mockRequest).toHaveBeenCalledWith(
        'GET',
        `/transactions/export?format=csv&startDate=${encodeURIComponent(
          startDate.toISOString()
        )}&endDate=${encodeURIComponent(endDate.toISOString())}`
      );
    });

    it('throws error when exporting transaction history fails', async () => {
      mockRequest.mockResolvedValueOnce({
        success: false,
        error: { message: 'Export failed' },
      });

      await expect(client.exportTransactionHistory()).rejects.toThrow(
        'Failed to export transaction history'
      );
    });
  });
});
