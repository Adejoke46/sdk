// @vitest-environment jsdom
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DorisioProvider } from './DorisioProvider';
import { useCreateTip } from './useCreateTip';

function makeClient() {
  return {
    createTip: vi.fn(),
    buildPaymentTransaction: vi.fn(),
    submitPaymentTransaction: vi.fn(),
    checkTransactionConfirmation: vi.fn(),
    request: vi.fn(),
    setToken: vi.fn(),
    clearToken: vi.fn(),
  };
}

function wrapperFor(client: ReturnType<typeof makeClient>) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <DorisioProvider client={client as any} config={{} as any}>
        {children}
      </DorisioProvider>
    );
  };
}

describe('useCreateTip concurrent submissions', () => {
  it('rejects a second submission while the first is still in flight', async () => {
    const client = makeClient();
    let resolveFirst: ((value: unknown) => void) | undefined;

    client.createTip.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );

    const { result } = renderHook(() => useCreateTip(), { wrapper: wrapperFor(client) });

    const firstPromise = result.current.createTip({ creatorId: 'c', amount: 1 } as any);
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.submitting).toBe(true);

    await act(async () => {
      await expect(
        (async () => result.current.createTip({ creatorId: 'c', amount: 2 } as any))()
      ).rejects.toThrow('createTip already in progress');
    });

    expect(client.createTip).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolveFirst?.({ id: 'tip-1' });
      await firstPromise;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.submitting).toBe(false);
    expect(result.current.data).toEqual({ id: 'tip-1' });
  });
});
