// @vitest-environment jsdom
/**
 * Unmount Cleanup Tests for React Hooks (Issue #27)
 *
 * Verifies that useWallet, useCreateTip, useTransactionHistory, and useCreatorBalance:
 * 1. Cancel in-flight HTTP requests via AbortController when unmounted.
 * 2. Do not invoke setState after the component is unmounted.
 * 3. Emit no React unmounted state update console warnings.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { DorisioProvider } from './DorisioProvider';
import { useWallet } from './useWallet';
import { useCreateTip } from './useCreateTip';
import { useTransactionHistory } from './useTransactionHistory';
import { useCreatorBalance } from './useCreatorBalance';
import type { DorisioClient, ClientConfig } from '../client';

let consoleError: MockInstance<any[], any>;
let consoleWarn: MockInstance<any[], any>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

function makeMockClient() {
  let capturedSignals: AbortSignal[] = [];

  const request = vi.fn(
    (
      _method: string,
      _path: string,
      _body?: unknown,
      options?: { signal?: AbortSignal }
    ) => {
      if (options?.signal) {
        capturedSignals.push(options.signal);
      }
      return new Promise((resolve, reject) => {
        if (options?.signal?.aborted) {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
          return;
        }
        options?.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
  );

  const createTip = vi.fn(
    (_data: unknown, options?: { signal?: AbortSignal }) => {
      if (options?.signal) {
        capturedSignals.push(options.signal);
      }
      return new Promise((resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
  );

  const buildPaymentTransaction = vi.fn(
    (_tipId: string, _data: unknown, options?: { signal?: AbortSignal }) => {
      if (options?.signal) {
        capturedSignals.push(options.signal);
      }
      return new Promise((resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
  );

  const submitPaymentTransaction = vi.fn(
    (_tipId: string, _data: unknown, options?: { signal?: AbortSignal }) => {
      if (options?.signal) {
        capturedSignals.push(options.signal);
      }
      return new Promise((resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
  );

  const checkTransactionConfirmation = vi.fn(
    (_tipId: string, options?: { signal?: AbortSignal }) => {
      if (options?.signal) {
        capturedSignals.push(options.signal);
      }
      return new Promise((resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
  );

  return {
    request,
    createTip,
    buildPaymentTransaction,
    submitPaymentTransaction,
    checkTransactionConfirmation,
    setToken: vi.fn(),
    clearToken: vi.fn(),
    getSignals: () => capturedSignals,
    clearSignals: () => {
      capturedSignals = [];
    },
  };
}

function createWrapper(client: ReturnType<typeof makeMockClient>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <DorisioProvider
        client={client as unknown as DorisioClient}
        config={{} as unknown as ClientConfig}
      >
        {children}
      </DorisioProvider>
    );
  };
}

describe('Hook Unmount Cleanup (Issue #27)', () => {
  describe('useWallet', () => {
    it('cancels in-flight generateNonce and does not update state on unmount', async () => {
      const client = makeMockClient();
      const wrapper = createWrapper(client);
      const { result, unmount } = renderHook(() => useWallet(), { wrapper });

      let promise: Promise<unknown> = Promise.resolve();
      act(() => {
        promise = result.current.generateNonce('GABC123');
      });

      const signals = client.getSignals();
      expect(signals.length).toBe(1);
      expect(signals[0]?.aborted).toBe(false);

      // Unmount while request is pending
      unmount();

      expect(signals[0]?.aborted).toBe(true);
      await expect(promise).rejects.toThrow();
      expect(consoleError).not.toHaveBeenCalledWith(
        expect.stringContaining("Can't perform a React state update on an unmounted component")
      );
    });

    it('cancels in-flight getChallenge on unmount', async () => {
      const client = makeMockClient();
      const wrapper = createWrapper(client);
      const { result, unmount } = renderHook(() => useWallet(), { wrapper });

      let promise: Promise<unknown> = Promise.resolve();
      act(() => {
        promise = result.current.getChallenge('test-nonce');
      });

      const signals = client.getSignals();
      expect(signals.length).toBe(1);
      expect(signals[0]?.aborted).toBe(false);

      unmount();

      expect(signals[0]?.aborted).toBe(true);
      await expect(promise).rejects.toThrow();
    });

    it('cancels in-flight verifyWallet on unmount', async () => {
      const client = makeMockClient();
      const wrapper = createWrapper(client);
      const { result, unmount } = renderHook(() => useWallet(), { wrapper });

      let promise: Promise<unknown> = Promise.resolve();
      act(() => {
        promise = result.current.verifyWallet('GABC', 'nonce', 'signedTx');
      });

      const signals = client.getSignals();
      expect(signals.length).toBe(1);
      expect(signals[0]?.aborted).toBe(false);

      unmount();

      expect(signals[0]?.aborted).toBe(true);
      await expect(promise).rejects.toThrow();
    });

    it('cancels in-flight listWallets on unmount', async () => {
      const client = makeMockClient();
      const wrapper = createWrapper(client);
      const { result, unmount } = renderHook(() => useWallet(), { wrapper });

      let promise: Promise<unknown> = Promise.resolve();
      act(() => {
        promise = result.current.listWallets();
      });

      const signals = client.getSignals();
      expect(signals.length).toBe(1);
      expect(signals[0]?.aborted).toBe(false);

      unmount();

      expect(signals[0]?.aborted).toBe(true);
      await expect(promise).rejects.toThrow();
    });

    it('cancels in-flight getBalance on unmount', async () => {
      const client = makeMockClient();
      const wrapper = createWrapper(client);
      const { result, unmount } = renderHook(() => useWallet(), { wrapper });

      let promise: Promise<unknown> = Promise.resolve();
      act(() => {
        promise = result.current.getBalance('wallet-1');
      });

      const signals = client.getSignals();
      expect(signals.length).toBe(1);
      expect(signals[0]?.aborted).toBe(false);

      unmount();

      expect(signals[0]?.aborted).toBe(true);
      await expect(promise).rejects.toThrow();
    });
  });

  describe('useCreateTip', () => {
    it('cancels in-flight createTip on unmount and triggers no state update', async () => {
      const client = makeMockClient();
      const wrapper = createWrapper(client);
      const { result, unmount } = renderHook(() => useCreateTip(), { wrapper });

      let promise: Promise<unknown> = Promise.resolve();
      act(() => {
        promise = result.current.createTip({ creatorId: 'c-1', amount: 50 });
      });

      const signals = client.getSignals();
      expect(signals.length).toBe(1);
      expect(signals[0]?.aborted).toBe(false);

      unmount();

      expect(signals[0]?.aborted).toBe(true);
      await expect(promise).rejects.toThrow();
      expect(consoleError).not.toHaveBeenCalledWith(
        expect.stringContaining("Can't perform a React state update on an unmounted component")
      );
    });

    it('cancels in-flight buildTransaction on unmount', async () => {
      const client = makeMockClient();
      const wrapper = createWrapper(client);
      const { result, unmount } = renderHook(() => useCreateTip(), { wrapper });

      let promise: Promise<unknown> = Promise.resolve();
      act(() => {
        promise = result.current.buildTransaction('tip-1', {
          senderPublicKey: 'G1',
          creatorPublicKey: 'G2',
          amount: '10',
        });
      });

      const signals = client.getSignals();
      expect(signals.length).toBe(1);
      expect(signals[0]?.aborted).toBe(false);

      unmount();

      expect(signals[0]?.aborted).toBe(true);
      await expect(promise).rejects.toThrow();
    });

    it('cancels in-flight submitTransaction on unmount', async () => {
      const client = makeMockClient();
      const wrapper = createWrapper(client);
      const { result, unmount } = renderHook(() => useCreateTip(), { wrapper });

      let promise: Promise<unknown> = Promise.resolve();
      act(() => {
        promise = result.current.submitTransaction('tip-1', 'xdr-envelope');
      });

      const signals = client.getSignals();
      expect(signals.length).toBe(1);
      expect(signals[0]?.aborted).toBe(false);

      unmount();

      expect(signals[0]?.aborted).toBe(true);
      await expect(promise).rejects.toThrow();
    });

    it('cancels in-flight confirmTransaction on unmount', async () => {
      const client = makeMockClient();
      const wrapper = createWrapper(client);
      const { result, unmount } = renderHook(() => useCreateTip(), { wrapper });

      let promise: Promise<unknown> = Promise.resolve();
      act(() => {
        promise = result.current.confirmTransaction('tip-1');
      });

      const signals = client.getSignals();
      expect(signals.length).toBe(1);
      expect(signals[0]?.aborted).toBe(false);

      unmount();

      expect(signals[0]?.aborted).toBe(true);
      await expect(promise).rejects.toThrow();
    });
  });

  describe('useTransactionHistory', () => {
    it('cancels in-flight fetchHistory on unmount', async () => {
      const client = makeMockClient();
      const wrapper = createWrapper(client);
      const { result, unmount } = renderHook(() => useTransactionHistory(undefined, false), {
        wrapper,
      });

      let promise: Promise<unknown> = Promise.resolve();
      act(() => {
        promise = result.current.fetchHistory();
      });

      const signals = client.getSignals();
      expect(signals.length).toBe(1);
      expect(signals[0]?.aborted).toBe(false);

      unmount();

      expect(signals[0]?.aborted).toBe(true);
      await expect(promise).rejects.toThrow();
      expect(consoleError).not.toHaveBeenCalledWith(
        expect.stringContaining("Can't perform a React state update on an unmounted component")
      );
    });
  });

  describe('useCreatorBalance', () => {
    it('cancels in-flight fetchBalance on unmount', async () => {
      const client = makeMockClient();
      const wrapper = createWrapper(client);
      const { result, unmount } = renderHook(() => useCreatorBalance(undefined, false), {
        wrapper,
      });

      let promise: Promise<unknown> = Promise.resolve();
      act(() => {
        promise = result.current.fetchBalance('creator-1');
      });

      const signals = client.getSignals();
      expect(signals.length).toBe(1);
      expect(signals[0]?.aborted).toBe(false);

      unmount();

      expect(signals[0]?.aborted).toBe(true);
      await expect(promise).rejects.toThrow();
      expect(consoleError).not.toHaveBeenCalledWith(
        expect.stringContaining("Can't perform a React state update on an unmounted component")
      );
    });
  });
});
