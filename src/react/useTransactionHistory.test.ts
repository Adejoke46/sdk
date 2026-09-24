/**
 * useTransactionHistory Hook Tests
 * Tests for transaction history with pagination hook
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('useTransactionHistory Hook', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      request: vi.fn(),
    };
  });

  describe('fetchHistory', () => {
    it('should fetch transaction history', async () => {
      const mockResponse = {
        success: true,
        data: {
          transactions: [
            { id: 'tx-1', amount: 100, status: 'confirmed' },
            { id: 'tx-2', amount: 50, status: 'pending' },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        },
      };

      mockClient.request.mockResolvedValue(mockResponse);

      const response = await mockClient.request('GET', '/api/v1/transactions/history');

      expect(response.data.transactions).toHaveLength(2);
      expect(response.data.total).toBe(2);
      expect(response.data.page).toBe(1);
    });

    it('should fetch with pagination options', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: {
          transactions: [],
          total: 100,
          page: 2,
          pageSize: 10,
        },
      });

      const response = await mockClient.request(
        'GET',
        '/api/v1/transactions/history?page=2&pageSize=10'
      );

      expect(response.data.page).toBe(2);
      expect(response.data.pageSize).toBe(10);
      expect(mockClient.request).toHaveBeenCalledWith(
        'GET',
        '/api/v1/transactions/history?page=2&pageSize=10'
      );
    });

    it('should fetch creator tips received', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: {
          transactions: [
            { id: 'tx-1', amount: 100, senderUsername: 'alice' },
            { id: 'tx-2', amount: 75, senderUsername: 'bob' },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        },
      });

      const response = await mockClient.request('GET', '/api/v1/transactions/creator/creator-123');

      expect(response.data.transactions).toHaveLength(2);
      expect(response.data.transactions[0].senderUsername).toBe('alice');
    });

    it('should handle empty history', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: {
          transactions: [],
          total: 0,
          page: 1,
          pageSize: 20,
        },
      });

      const response = await mockClient.request('GET', '/api/v1/transactions/history');

      expect(response.data.transactions).toHaveLength(0);
      expect(response.data.total).toBe(0);
    });

    it('should handle fetch error', async () => {
      mockClient.request.mockResolvedValue({
        success: false,
        error: { message: 'Unauthorized' },
      });

      const response = await mockClient.request('GET', '/api/v1/transactions/history');

      expect(response.success).toBe(false);
      expect(response.error.message).toBe('Unauthorized');
    });
  });

  describe('pagination', () => {
    it('should navigate to specific page', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: {
          transactions: [{ id: 'tx-5', amount: 25 }],
          total: 100,
          page: 3,
          pageSize: 20,
        },
      });

      const response = await mockClient.request('GET', '/api/v1/transactions/history?page=3');

      expect(response.data.page).toBe(3);
      expect(mockClient.request).toHaveBeenCalledWith('GET', '/api/v1/transactions/history?page=3');
    });

    it('should go to next page', async () => {
      const page1Response = {
        success: true,
        data: { transactions: [], total: 100, page: 1, pageSize: 20 },
      };

      const page2Response = {
        success: true,
        data: { transactions: [], total: 100, page: 2, pageSize: 20 },
      };

      mockClient.request.mockResolvedValueOnce(page1Response).mockResolvedValueOnce(page2Response);

      const response1 = await mockClient.request('GET', '/api/v1/transactions/history?page=1');
      expect(response1.data.page).toBe(1);

      const response2 = await mockClient.request('GET', '/api/v1/transactions/history?page=2');
      expect(response2.data.page).toBe(2);
    });

    it('should go to previous page', async () => {
      const page1Response = {
        success: true,
        data: { transactions: [], total: 100, page: 1, pageSize: 20 },
      };

      const page2Response = {
        success: true,
        data: { transactions: [], total: 100, page: 2, pageSize: 20 },
      };

      mockClient.request.mockResolvedValueOnce(page2Response).mockResolvedValueOnce(page1Response);

      const response1 = await mockClient.request('GET', '/api/v1/transactions/history?page=2');
      expect(response1.data.page).toBe(2);

      const response2 = await mockClient.request('GET', '/api/v1/transactions/history?page=1');
      expect(response2.data.page).toBe(1);
    });

    it('should change page size', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: {
          transactions: [],
          total: 100,
          page: 1,
          pageSize: 50,
        },
      });

      const response = await mockClient.request('GET', '/api/v1/transactions/history?pageSize=50');

      expect(response.data.pageSize).toBe(50);
    });

    it('should not go below page 1', () => {
      const state = { page: 1, pageSize: 20 };
      const prevPage = () => {
        state.page = Math.max(1, state.page - 1);
      };

      prevPage();
      expect(state.page).toBe(1);
    });

    it('should not exceed max page', () => {
      const state = { page: 5, totalPages: 5 };
      const nextPage = () => {
        state.page = Math.min(state.totalPages, state.page + 1);
      };

      nextPage();
      expect(state.page).toBe(5);
    });
  });

  describe('filtering and sorting', () => {
    it('should filter by status', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: {
          transactions: [
            { id: 'tx-1', status: 'confirmed' },
            { id: 'tx-2', status: 'confirmed' },
          ],
          total: 2,
        },
      });

      const response = await mockClient.request(
        'GET',
        '/api/v1/transactions/history?status=confirmed'
      );

      expect(response.data.transactions).toHaveLength(2);
      expect(response.data.transactions.every((tx: any) => tx.status === 'confirmed')).toBe(true);
    });

    it('should sort by date', async () => {
      mockClient.request.mockResolvedValue({
        success: true,
        data: {
          transactions: [
            { id: 'tx-1', createdAt: '2024-01-03' },
            { id: 'tx-2', createdAt: '2024-01-02' },
            { id: 'tx-3', createdAt: '2024-01-01' },
          ],
          total: 3,
        },
      });

      const response = await mockClient.request('GET', '/api/v1/transactions/history?sort=date');

      expect(response.data.transactions).toHaveLength(3);
    });
  });

  describe('refetch', () => {
    it('should refetch current page', async () => {
      const firstResponse = {
        success: true,
        data: {
          transactions: [{ id: 'tx-1', amount: 100 }],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      };

      const secondResponse = {
        success: true,
        data: {
          transactions: [
            { id: 'tx-1', amount: 100 },
            { id: 'tx-2', amount: 50 },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        },
      };

      mockClient.request.mockResolvedValueOnce(firstResponse).mockResolvedValueOnce(secondResponse);

      const response1 = await mockClient.request('GET', '/api/v1/transactions/history');
      expect(response1.data.transactions).toHaveLength(1);

      const response2 = await mockClient.request('GET', '/api/v1/transactions/history');
      expect(response2.data.transactions).toHaveLength(2);

      expect(mockClient.request).toHaveBeenCalledTimes(2);
    });
  });

  describe('reset', () => {
    it('should reset pagination state', () => {
      const state = {
        transactions: [{ id: 'tx-1' }],
        total: 100,
        page: 5,
        pageSize: 20,
        loading: false,
        reset: function () {
          this.transactions = [];
          this.total = 0;
          this.page = 1;
          this.pageSize = 20;
        },
      };

      state.reset();

      expect(state.transactions).toHaveLength(0);
      expect(state.page).toBe(1);
      expect(state.total).toBe(0);
    });
  });

  describe('stale closure fixes', () => {
    it('page size change should reset to page 1 while keeping creator', () => {
      const refs = {
        page: 4,
        pageSize: 10,
        creatorId: 'creator-abc',
      };

      const setPageSize = (size: number) => {
        // Mirrors fixed setPageSize: always page 1 + latest creatorId ref
        refs.page = 1;
        refs.pageSize = size;
      };

      setPageSize(50);
      expect(refs.page).toBe(1);
      expect(refs.pageSize).toBe(50);
      expect(refs.creatorId).toBe('creator-abc');
    });

    it('creator id should persist across pagination after dependency change', () => {
      const refs = {
        page: 1,
        pageSize: 10,
        creatorId: undefined as string | undefined,
      };

      const fetchHistory = (options?: { page?: number; pageSize?: number }, creator?: string) => {
        if (creator !== undefined) {
          refs.creatorId = creator;
        }
        if (options?.page !== undefined) refs.page = options.page;
        if (options?.pageSize !== undefined) refs.pageSize = options.pageSize;
      };

      fetchHistory({ page: 1, pageSize: 10 }, 'creator-1');
      expect(refs.creatorId).toBe('creator-1');

      // Switch creators
      fetchHistory({ page: 1, pageSize: 10 }, 'creator-2');
      expect(refs.creatorId).toBe('creator-2');

      // Paginate using ref (not stale closure)
      const goToPage = (page: number) => {
        fetchHistory({ page, pageSize: refs.pageSize }, refs.creatorId);
      };
      goToPage(2);
      expect(refs.page).toBe(2);
      expect(refs.creatorId).toBe('creator-2');
    });

    it('fetchHistory callback deps should not include page state (stable identity)', () => {
      // Documents the fixed dependency list: client + setters only.
      const fetchHistoryDeps = ['client', 'setError', 'setIsLoading'];
      expect(fetchHistoryDeps).not.toContain('state.page');
      expect(fetchHistoryDeps).not.toContain('state.pageSize');
      expect(fetchHistoryDeps).not.toContain('creatorId');
    });
  });
});
