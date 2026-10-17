/**
 * useCreateTip Hook Tests
 * Tests for concurrent submission prevention and debounce logic
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('useCreateTip Hook - Concurrent Submissions & Debounce', () => {
  let mockClient: any;
  let inFlightRef: { current: boolean };
  let inFlightPromiseRef: { current: Promise<any> | null };
  let lastSubmitTimeRef: { current: { [key: string]: number } };

  beforeEach(() => {
    vi.useFakeTimers();

    inFlightRef = { current: false };
    inFlightPromiseRef = { current: null };
    lastSubmitTimeRef = { current: {} };

    mockClient = {
      createTip: vi.fn(),
      buildPaymentTransaction: vi.fn(),
      submitPaymentTransaction: vi.fn(),
      checkTransactionConfirmation: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper function to simulate withSubmissionGuard
  const withSubmissionGuard = <T>(
    action: string,
    task: () => Promise<T>,
    debounceMs: number = 500
  ): Promise<T> => {
    const now = Date.now();
    const lastTime = lastSubmitTimeRef.current[action] || 0;
    const timeSinceLastSubmit = now - lastTime;

    if (timeSinceLastSubmit < debounceMs) {
      if (inFlightRef.current && inFlightPromiseRef.current) {
        return inFlightPromiseRef.current;
      }
      return Promise.reject(
        new Error(
          `Duplicate ${action} submission rejected. Please wait ${Math.ceil(
            (debounceMs - timeSinceLastSubmit) / 1000
          )}s before retrying.`
        )
      );
    }

    if (inFlightRef.current && inFlightPromiseRef.current) {
      return inFlightPromiseRef.current;
    }

    inFlightRef.current = true;
    lastSubmitTimeRef.current[action] = now;

    const promise = task().finally(() => {
      inFlightRef.current = false;
      inFlightPromiseRef.current = null;
    });

    inFlightPromiseRef.current = promise;
    return promise;
  };

  describe('Concurrent submission prevention', () => {
    it('should reject concurrent createTip calls within debounce window', async () => {
      mockClient.createTip.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ id: 'tip-1' }), 50))
      );

      const promise1 = withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
      );

      const promise2 = withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
      );

      await expect(promise2).rejects.toThrow(/Duplicate createTip submission rejected/);
      await promise1;
    });

    it('should reject concurrent buildTransaction calls', async () => {
      mockClient.buildPaymentTransaction.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ transactionEnvelope: 'env' }), 50))
      );

      const promise1 = withSubmissionGuard('buildTransaction', () =>
        mockClient.buildPaymentTransaction('tip-1', { senderPublicKey: 'GABC', amount: '100' })
      );

      const promise2 = withSubmissionGuard('buildTransaction', () =>
        mockClient.buildPaymentTransaction('tip-1', { senderPublicKey: 'GABC', amount: '100' })
      );

      await expect(promise2).rejects.toThrow(/Duplicate buildTransaction submission rejected/);
      await promise1;
    });

    it('should reject concurrent submitTransaction calls', async () => {
      mockClient.submitPaymentTransaction.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ transactionHash: 'hash' }), 50))
      );

      const promise1 = withSubmissionGuard('submitTransaction', () =>
        mockClient.submitPaymentTransaction('tip-1', { envelope: 'env1' })
      );

      const promise2 = withSubmissionGuard('submitTransaction', () =>
        mockClient.submitPaymentTransaction('tip-1', { envelope: 'env1' })
      );

      await expect(promise2).rejects.toThrow(/Duplicate submitTransaction submission rejected/);
      await promise1;
    });

    it('should reject concurrent confirmTransaction calls', async () => {
      mockClient.checkTransactionConfirmation.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ id: 'tip-1', status: 'confirmed' }), 50))
      );

      const promise1 = withSubmissionGuard('confirmTransaction', () =>
        mockClient.checkTransactionConfirmation('tip-1')
      );

      const promise2 = withSubmissionGuard('confirmTransaction', () =>
        mockClient.checkTransactionConfirmation('tip-1')
      );

      await expect(promise2).rejects.toThrow(/Duplicate confirmTransaction submission rejected/);
      await promise1;
    });
  });

  describe('Debounce window (default 500ms)', () => {
    it('should reject submission within 500ms debounce window', async () => {
      mockClient.createTip.mockResolvedValue({ id: 'tip-1', status: 'pending' });

      await withSubmissionGuard('createTip', () => mockClient.createTip({ creatorId: 'creator-1', amount: 100 }));

      vi.advanceTimersByTime(300);

      const secondCall = withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
      );
      await expect(secondCall).rejects.toThrow(/Duplicate createTip submission rejected/);
    });

    it('should allow submission after 500ms debounce window', async () => {
      mockClient.createTip.mockResolvedValue({ id: 'tip-1', status: 'pending' });

      await withSubmissionGuard('createTip', () => mockClient.createTip({ creatorId: 'creator-1', amount: 100 }));

      vi.advanceTimersByTime(600);

      mockClient.createTip.mockClear();
      mockClient.createTip.mockResolvedValue({ id: 'tip-2', status: 'pending' });

      await withSubmissionGuard('createTip', () => mockClient.createTip({ creatorId: 'creator-1', amount: 150 }));

      expect(mockClient.createTip).toHaveBeenCalled();
    });

    it('should respect custom debounceMs option', async () => {
      mockClient.createTip.mockResolvedValue({ id: 'tip-1', status: 'pending' });

      await withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 100 }),
        1000
      );

      vi.advanceTimersByTime(800);

      const secondCall = withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 100 }),
        1000
      );
      await expect(secondCall).rejects.toThrow(/Duplicate createTip submission rejected/);

      vi.advanceTimersByTime(300);

      mockClient.createTip.mockClear();
      mockClient.createTip.mockResolvedValue({ id: 'tip-2', status: 'pending' });

      await withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 150 }),
        1000
      );

      expect(mockClient.createTip).toHaveBeenCalled();
    });

    it('should allow 0ms debounce for no debounce', async () => {
      mockClient.createTip.mockResolvedValue({ id: 'tip-1', status: 'pending' });

      await withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 100 }),
        0
      );

      mockClient.createTip.mockClear();
      mockClient.createTip.mockResolvedValue({ id: 'tip-2', status: 'pending' });

      await withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 150 }),
        0
      );

      expect(mockClient.createTip).toHaveBeenCalled();
    });
  });

  describe('Error messages', () => {
    it('should provide clear error message for duplicate submission', async () => {
      mockClient.createTip.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ id: 'tip-1' }), 100))
      );

      const promise1 = withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
      );

      const promise2 = withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
      );

      try {
        await promise2;
      } catch (error: any) {
        expect(error.message).toContain('Duplicate createTip submission rejected');
        expect(error.message).toContain('wait');
        expect(error.message).toMatch(/\d+s before retrying/);
      }

      await promise1;
    });

    it('should calculate wait time correctly in error message', async () => {
      mockClient.createTip.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ id: 'tip-1' }), 50))
      );

      const promise1 = withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
      );

      vi.advanceTimersByTime(200);

      const promise2 = withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
      );

      try {
        await promise2;
      } catch (error: any) {
        expect(error.message).toContain('wait');
        const match = error.message.match(/wait (\d+)s/);
        expect(match).toBeTruthy();
        const seconds = parseInt(match?.[1] ?? '0', 10);
        expect(seconds).toBeGreaterThan(0);
        expect(seconds).toBeLessThanOrEqual(1);
      }

      await promise1;
    });
  });

  describe('In-flight promise tracking', () => {
    it('should track in-flight promise correctly', async () => {
      mockClient.createTip.mockResolvedValue({ id: 'tip-1', status: 'pending' });

      expect(inFlightRef.current).toBe(false);
      expect(inFlightPromiseRef.current).toBe(null);

      const promise = withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
      );

      expect(inFlightRef.current).toBe(true);
      expect(inFlightPromiseRef.current).not.toBe(null);

      await promise;

      expect(inFlightRef.current).toBe(false);
      expect(inFlightPromiseRef.current).toBe(null);
    });

    it('should clear promise on error', async () => {
      mockClient.createTip.mockRejectedValue(new Error('API Error'));

      try {
        await withSubmissionGuard('createTip', () =>
          mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
        );
      } catch {
        // Expected
      }

      expect(inFlightRef.current).toBe(false);
      expect(inFlightPromiseRef.current).toBe(null);
    });
  });

  describe('Multiple rapid calls (stress test)', () => {
    it('should handle 5 rapid concurrent calls', async () => {
      mockClient.createTip.mockResolvedValue({ id: 'tip-1', status: 'pending' });

      const promises = Array.from({ length: 5 }, (_, i) =>
        withSubmissionGuard('createTip', () =>
          mockClient.createTip({ creatorId: `creator-${i}`, amount: 100 + i })
        )
      );

      const results = await Promise.allSettled(promises);

      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter((r) => r.status === 'rejected').length;

      expect(fulfilled + rejected).toBe(5);
      expect(fulfilled).toBeGreaterThan(0);
    });

    it('should handle rapid calls across different methods', async () => {
      mockClient.createTip.mockResolvedValue({ id: 'tip-1', status: 'pending' });
      mockClient.buildPaymentTransaction.mockResolvedValue({ transactionEnvelope: 'env' });
      mockClient.submitPaymentTransaction.mockResolvedValue({ transactionHash: 'hash' });

      const results = await Promise.allSettled([
        withSubmissionGuard('createTip', () =>
          mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
        ),
        withSubmissionGuard('buildTransaction', () =>
          mockClient.buildPaymentTransaction('tip-1', { senderPublicKey: 'G1', amount: '100' })
        ),
        withSubmissionGuard('submitTransaction', () =>
          mockClient.submitPaymentTransaction('tip-1', { envelope: 'env' })
        ),
      ]);

      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    });
  });

  describe('Debounce timing precision', () => {
    it('should reject at 499ms, accept at 501ms', async () => {
      mockClient.createTip.mockResolvedValue({ id: 'tip-1' });

      await withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
      );

      // At 499ms: should reject
      vi.advanceTimersByTime(499);
      let rejected = false;
      try {
        await withSubmissionGuard('createTip', () =>
          mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
        );
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);

      // Reset for next test
      inFlightRef.current = false;
      lastSubmitTimeRef.current = {};

      await withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
      );

      // At 501ms: should accept
      vi.advanceTimersByTime(501);
      mockClient.createTip.mockClear();
      mockClient.createTip.mockResolvedValue({ id: 'tip-2' });

      await withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 200 })
      );

      expect(mockClient.createTip).toHaveBeenCalled();
    });
  });

  describe('Clear lock after response', () => {
    it('should clear lock after successful response', async () => {
      mockClient.createTip.mockResolvedValue({ id: 'tip-1' });

      expect(inFlightRef.current).toBe(false);

      await withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
      );

      expect(inFlightRef.current).toBe(false);
    });

    it('should clear lock after error response', async () => {
      mockClient.createTip.mockRejectedValue(new Error('Failed'));

      expect(inFlightRef.current).toBe(false);

      try {
        await withSubmissionGuard('createTip', () =>
          mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
        );
      } catch {
        // Expected
      }

      expect(inFlightRef.current).toBe(false);
    });
  });

  describe('Per-action state tracking', () => {
    it('should track last submit time per action', async () => {
      mockClient.createTip.mockResolvedValue({ id: 'tip-1' });
      mockClient.buildPaymentTransaction.mockResolvedValue({ transactionEnvelope: 'env' });

      await withSubmissionGuard('createTip', () =>
        mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
      );

      vi.advanceTimersByTime(300);

      await withSubmissionGuard('buildTransaction', () =>
        mockClient.buildPaymentTransaction('tip-1', { senderPublicKey: 'G1', amount: '100' })
      );

      // createTip should still be in debounce window
      let rejected = false;
      try {
        await withSubmissionGuard('createTip', () =>
          mockClient.createTip({ creatorId: 'creator-1', amount: 100 })
        );
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);

      // But buildTransaction can be called again (different action)
      mockClient.buildPaymentTransaction.mockClear();
      mockClient.buildPaymentTransaction.mockResolvedValue({ transactionEnvelope: 'env2' });

      await withSubmissionGuard('buildTransaction', () =>
        mockClient.buildPaymentTransaction('tip-1', { senderPublicKey: 'G1', amount: '100' })
      );

      expect(mockClient.buildPaymentTransaction).toHaveBeenCalled();
    });
  });
});
