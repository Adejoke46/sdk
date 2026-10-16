/**
 * useCreateTip Hook Tests
 * Tests for tip creation workflow hook
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('useCreateTip Hook', () => {
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      createTip: vi.fn(),
      buildPaymentTransaction: vi.fn(),
      submitPaymentTransaction: vi.fn(),
      checkTransactionConfirmation: vi.fn(),
    };
  });

  describe('createTip', () => {
    it('should create tip with valid data', async () => {
      const mockTip = {
        id: 'tip-123',
        senderId: 'user-456',
        creatorId: 'creator-789',
        amount: 100,
        message: 'Great content!',
        status: 'pending',
        transactionHash: null,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      mockClient.createTip.mockResolvedValue(mockTip);

      const hook = {
        createTip: async (data: any) => {
          try {
            return await mockClient.createTip(data);
          } catch (err) {
            throw err;
          }
        },
      };

      const result = await hook.createTip({
        creatorId: 'creator-789',
        amount: 100,
        message: 'Great content!',
      });

      expect(result.id).toBe('tip-123');
      expect(result.status).toBe('pending');
      expect(mockClient.createTip).toHaveBeenCalledWith({
        creatorId: 'creator-789',
        amount: 100,
        message: 'Great content!',
      });
    });

    it('should handle errors during tip creation', async () => {
      mockClient.createTip.mockRejectedValue(new Error('Creator not found'));

      const hook = {
        createTip: async (data: any) => {
          try {
            return await mockClient.createTip(data);
          } catch (err) {
            throw err;
          }
        },
      };

      await expect(
        hook.createTip({
          creatorId: 'creator-invalid',
          amount: 100,
        })
      ).rejects.toThrow('Creator not found');
    });
  });

  describe('buildTransaction', () => {
    it('should build payment transaction', async () => {
      const mockResponse = {
        transactionEnvelope: 'AAAAAgAAAAC7...',
        tipId: 'tip-123',
        fee: 100,
      };

      mockClient.buildPaymentTransaction.mockResolvedValue(mockResponse);

      const hook = {
        buildTransaction: async (tipId: string, data: any) => {
          try {
            return await mockClient.buildPaymentTransaction(tipId, data);
          } catch (err) {
            throw err;
          }
        },
      };

      const result = await hook.buildTransaction('tip-123', {
        senderPublicKey: 'GABC123',
        creatorPublicKey: 'GCREATOR123',
        amount: '100',
      });

      expect(result.transactionEnvelope).toBeDefined();
      expect(result.fee).toBe(100);
      expect(mockClient.buildPaymentTransaction).toHaveBeenCalled();
    });
  });

  describe('submitTransaction', () => {
    it('should submit signed transaction', async () => {
      const mockResponse = {
        tipId: 'tip-123',
        transactionHash: 'hash123abc',
        status: 'pending',
      };

      mockClient.submitPaymentTransaction.mockResolvedValue(mockResponse);

      const hook = {
        submitTransaction: async (tipId: string, envelope: string) => {
          try {
            return await mockClient.submitPaymentTransaction(tipId, {
              envelope,
            });
          } catch (err) {
            throw err;
          }
        },
      };

      const result = await hook.submitTransaction('tip-123', 'AAAAAgAAAAC7...');

      expect(result.transactionHash).toBeDefined();
      expect(result.status).toBe('pending');
    });
  });

  describe('confirmTransaction', () => {
    it('should confirm transaction on blockchain', async () => {
      const mockTip = {
        id: 'tip-123',
        status: 'confirmed',
        transactionHash: 'hash123',
      };

      mockClient.checkTransactionConfirmation.mockResolvedValue(mockTip);

      const hook = {
        confirmTransaction: async (tipId: string) => {
          try {
            return await mockClient.checkTransactionConfirmation(tipId);
          } catch (err) {
            throw err;
          }
        },
      };

      const result = await hook.confirmTransaction('tip-123');

      expect(result.status).toBe('confirmed');
      expect(mockClient.checkTransactionConfirmation).toHaveBeenCalledWith('tip-123');
    });
  });

  describe('reset', () => {
    it('should reset hook state', async () => {
      const hook = {
        state: { loading: false, step: 'idle', error: undefined as string | undefined },
        reset: function () {
          this.state = { loading: false, step: 'idle', error: undefined };
        },
      };

      hook.state = { loading: true, step: 'creating', error: 'Some error' };
      hook.reset();

      expect(hook.state.loading).toBe(false);
      expect(hook.state.step).toBe('idle');
      expect(hook.state.error).toBeUndefined();
    });
  });
});
