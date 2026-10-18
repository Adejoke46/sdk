// @vitest-environment jsdom
/**
 * Error-handling tests for the React hooks and provider.
 *
 * These render the real hooks inside the real DorisioProvider (unlike the older
 * *.test.ts files, which re-implement hook logic inline) so every error path is
 * exercised end to end: hook state, provider error channel, re-thrown error and cleanup.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import {
  renderHook,
  render,
  act,
  waitFor,
  screen,
  fireEvent,
  cleanup,
} from '@testing-library/react';
import { DorisioProvider } from './DorisioProvider';
import { DorisioBoundary } from './DorisioBoundary';
import { useCreateTip } from './useCreateTip';
import { AuthError, PaymentError, ValidationError, RateLimitError, ServerError } from '../types/errors';
import { useWallet } from './useWallet';
import { useCreatorBalance } from './useCreatorBalance';
import { useTransactionHistory } from './useTransactionHistory';
import { getErrorMessage, isRethrownByHook, runSafely } from './safe-async';

let consoleError: MockInstance<any[], any>;
let consoleWarn: MockInstance<any[], any>;

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup(); // vitest globals are off, so RTL's auto-cleanup isn't registered
  consoleError.mockRestore();
  consoleWarn.mockRestore();
});

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

function wrapperFor(client: ReturnType<typeof makeClient>, props: Record<string, unknown> = {}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <DorisioProvider client={client as any} config={{} as any} {...props}>
        {children}
      </DorisioProvider>
    );
  };
}

/** Invoke a hook action that is expected to reject; returns the rejection. */
async function rejection(action: () => Promise<unknown>): Promise<unknown> {
  let caught: unknown = 'did not reject';
  await act(async () => {
    try {
      await action();
    } catch (err) {
      caught = err;
    }
  });
  return caught;
}

// ---------------------------------------------------------------------------
// runSafely / helpers
// ---------------------------------------------------------------------------

describe('runSafely', () => {
  const ctx = () => ({ setError: vi.fn(), setIsLoading: vi.fn() });
  const op = { code: 'X_ERROR', fallbackMessage: 'Failed to x' };

  it('returns the result and toggles loading on then off', async () => {
    const c = ctx();
    await expect(runSafely(c, op, async () => 42)).resolves.toBe(42);
    expect(c.setIsLoading.mock.calls).toEqual([[true], [false]]);
    expect(c.setError).not.toHaveBeenCalled();
  });

  it('re-throws the original error, reports it, and runs cleanup', async () => {
    const c = ctx();
    const onError = vi.fn();
    const boom = new Error('boom');
    await expect(
      runSafely(c, { ...op, onError }, async () => {
        throw boom;
      })
    ).rejects.toBe(boom);
    expect(onError).toHaveBeenCalledWith('boom');
    expect(c.setError).toHaveBeenCalledWith({ message: 'boom', code: 'X_ERROR' });
    expect(c.setIsLoading).toHaveBeenLastCalledWith(false);
  });

  it('does not let a throwing setError replace the original error, and still cleans up', async () => {
    const c = ctx();
    c.setError.mockImplementation(() => {
      throw new Error('setError exploded');
    });
    const boom = new Error('boom');
    await expect(
      runSafely(c, op, async () => {
        throw boom;
      })
    ).rejects.toBe(boom);
    expect(c.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('setError failed'),
      expect.any(Error)
    );
  });

  it('does not let a throwing local onError handler skip global reporting', async () => {
    const c = ctx();
    await expect(
      runSafely(
        c,
        {
          ...op,
          onError: () => {
            throw new Error('state exploded');
          },
        },
        async () => {
          throw new Error('boom');
        }
      )
    ).rejects.toThrow('boom');
    expect(c.setError).toHaveBeenCalledTimes(1);
  });

  it('survives setIsLoading throwing on success and on failure', async () => {
    const c = ctx();
    c.setIsLoading.mockImplementation(() => {
      throw new Error('loading exploded');
    });
    await expect(runSafely(c, op, async () => 'ok')).resolves.toBe('ok');
    await expect(
      runSafely(c, op, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });

  it('treats a throwing onStart as a failed operation and still cleans up', async () => {
    const c = ctx();
    await expect(
      runSafely(
        c,
        {
          ...op,
          onStart: () => {
            throw new Error('start failed');
          },
        },
        async () => 'never'
      )
    ).rejects.toThrow('start failed');
    expect(c.setError).toHaveBeenCalledWith({ message: 'start failed', code: 'X_ERROR' });
    expect(c.setIsLoading).toHaveBeenLastCalledWith(false);
  });

  it('re-throws non-Error values unchanged and derives a message', async () => {
    const c = ctx();
    await expect(
      runSafely(c, op, async () => {
        throw 'plain string';
      })
    ).rejects.toBe('plain string');
    expect(c.setError).toHaveBeenLastCalledWith({ message: 'plain string', code: 'X_ERROR' });

    await expect(
      runSafely(c, op, async () => {
        throw undefined;
      })
    ).rejects.toBeUndefined();
    expect(c.setError).toHaveBeenLastCalledWith({ message: 'Failed to x', code: 'X_ERROR' });
  });

  it('marks re-thrown errors so unhandled ones can be recognised', async () => {
    const c = ctx();
    const err = await runSafely(c, op, async () => {
      throw new Error('boom');
    }).catch((e) => e);
    expect(isRethrownByHook(err)).toBe(true);
    expect(isRethrownByHook(new Error('unrelated'))).toBe(false);
    expect(isRethrownByHook('string')).toBe(false);
  });
});

describe('getErrorMessage', () => {
  it('handles Errors, strings, message-bearing objects and junk', () => {
    expect(getErrorMessage(new Error('a'), 'fb')).toBe('a');
    expect(getErrorMessage('b', 'fb')).toBe('b');
    expect(getErrorMessage({ message: 'c' }, 'fb')).toBe('c');
    expect(getErrorMessage(new Error(''), 'fb')).toBe('fb');
    expect(getErrorMessage({ message: 5 }, 'fb')).toBe('fb');
    expect(getErrorMessage(null, 'fb')).toBe('fb');
  });
});

// ---------------------------------------------------------------------------
// useCreateTip
// ---------------------------------------------------------------------------

describe('useCreateTip error paths', () => {
  const cases = [
    [
      'createTip',
      (c: any) => c.createTip,
      (h: any) => h.createTip({ creatorId: 'c', amount: 1 }),
      'CREATE_TIP_ERROR',
      'creating',
    ],
    [
      'buildTransaction',
      (c: any) => c.buildPaymentTransaction,
      (h: any) => h.buildTransaction('t', {}),
      'BUILD_TRANSACTION_ERROR',
      'building',
    ],
    [
      'submitTransaction',
      (c: any) => c.submitPaymentTransaction,
      (h: any) => h.submitTransaction('t', 'env'),
      'SUBMIT_TRANSACTION_ERROR',
      'submitting',
    ],
    [
      'confirmTransaction',
      (c: any) => c.checkTransactionConfirmation,
      (h: any) => h.confirmTransaction('t'),
      'CONFIRM_TRANSACTION_ERROR',
      'confirming',
    ],
  ] as const;

  it.each(cases)(
    '%s: sets error state, reports to provider, re-throws',
    async (_n, method, call, code) => {
      const client = makeClient();
      const original = new Error('network down');
      method(client).mockRejectedValue(original);
      const onError = vi.fn();
      const { result } = renderHook(() => useCreateTip(), {
        wrapper: wrapperFor(client, { onError }),
      });

      expect(await rejection(() => call(result.current))).toBe(original);

      expect(result.current.error).toBe('network down');
      expect(result.current.step).toBe('error');
      expect(result.current.loading).toBe(false);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code, message: 'network down' })
      );
    }
  );

  it.each(cases)(
    '%s: a throwing provider onError does not mask the real error',
    async (_n, method, call) => {
      const client = makeClient();
      const original = new Error('network down');
      method(client).mockRejectedValue(original);
      const onError = vi.fn(() => {
        throw new Error('app onError bug');
      });
      const { result } = renderHook(() => useCreateTip(), {
        wrapper: wrapperFor(client, { onError }),
      });

      expect(await rejection(() => call(result.current))).toBe(original);
      expect(result.current.error).toBe('network down');
      expect(result.current.loading).toBe(false);
      expect(onError).toHaveBeenCalled();
    }
  );

  it('uses the fallback message for non-Error rejections and clears the error on retry', async () => {
    const client = makeClient();
    client.createTip.mockRejectedValueOnce(undefined).mockResolvedValueOnce({ id: 'tip-1' });
    const { result } = renderHook(() => useCreateTip(), { wrapper: wrapperFor(client) });

    await rejection(() => result.current.createTip({ creatorId: 'c', amount: 1 } as any));
    expect(result.current.error).toBe('Failed to create tip');

    await act(async () => {
      await result.current.createTip({ creatorId: 'c', amount: 1 } as any);
    });
    expect(result.current.error).toBeUndefined();
    expect(result.current.data).toEqual({ id: 'tip-1' });
    expect(result.current.step).toBe('idle');
  });
});

// ---------------------------------------------------------------------------
// useWallet
// ---------------------------------------------------------------------------

describe('useWallet error paths', () => {
  const cases = [
    ['generateNonce', (h: any) => h.generateNonce('GKEY'), 'NONCE_GENERATION_ERROR', true],
    ['getChallenge', (h: any) => h.getChallenge('nonce'), 'CHALLENGE_ERROR', true],
    [
      'verifyWallet',
      (h: any) => h.verifyWallet('GKEY', 'n', 'xdr'),
      'WALLET_VERIFICATION_ERROR',
      true,
    ],
    ['listWallets', (h: any) => h.listWallets(), 'LIST_WALLETS_ERROR', false],
    ['unlinkWallet', (h: any) => h.unlinkWallet('w1'), 'UNLINK_WALLET_ERROR', false],
    ['renameWallet', (h: any) => h.renameWallet('w1', 'n'), 'RENAME_WALLET_ERROR', false],
    ['getBalance', (h: any) => h.getBalance('w1'), 'GET_BALANCE_ERROR', false],
  ] as const;

  it.each(cases)('%s: rejected request', async (_n, call, code, isChallengeStep) => {
    const client = makeClient();
    const original = new Error('boom');
    client.request.mockRejectedValue(original);
    const onError = vi.fn();
    const { result } = renderHook(() => useWallet(), { wrapper: wrapperFor(client, { onError }) });

    expect(await rejection(() => call(result.current))).toBe(original);

    expect(result.current.error).toBe('boom');
    expect(result.current.loading).toBe(false);
    if (isChallengeStep) expect(result.current.challengeStep).toBe('error');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code, message: 'boom' }));
  });

  it.each(cases)('%s: API failure response surfaces its message', async (_n, call, code) => {
    const client = makeClient();
    client.request.mockResolvedValue({ success: false, error: { message: 'API says no' } });
    const onError = vi.fn();
    const { result } = renderHook(() => useWallet(), { wrapper: wrapperFor(client, { onError }) });

    await rejection(() => call(result.current));

    expect(result.current.error).toBe('API says no');
    expect(result.current.loading).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code, message: 'API says no' }));
  });

  it.each(cases)('%s: throwing onError does not mask the real error', async (_n, call) => {
    const client = makeClient();
    const original = new Error('boom');
    client.request.mockRejectedValue(original);
    const { result } = renderHook(() => useWallet(), {
      wrapper: wrapperFor(client, {
        onError: () => {
          throw new Error('app bug');
        },
      }),
    });

    expect(await rejection(() => call(result.current))).toBe(original);
    expect(result.current.loading).toBe(false);
  });

  it('a failed unlink leaves existing wallets untouched', async () => {
    const client = makeClient();
    client.request
      .mockResolvedValueOnce({ success: true, data: { wallets: [{ id: 'w1' }] } })
      .mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(() => useWallet(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.listWallets();
    });
    await rejection(() => result.current.unlinkWallet('w1'));
    expect(result.current.wallets).toEqual([{ id: 'w1' }]);
  });
});

// ---------------------------------------------------------------------------
// useCreatorBalance / useTransactionHistory
// ---------------------------------------------------------------------------

describe('useCreatorBalance error paths', () => {
  it('manual fetch: sets error, reports, re-throws', async () => {
    const client = makeClient();
    const original = new Error('down');
    client.request.mockRejectedValue(original);
    const onError = vi.fn();
    const { result } = renderHook(() => useCreatorBalance(undefined, false), {
      wrapper: wrapperFor(client, { onError }),
    });

    expect(await rejection(() => result.current.fetchBalance('c1'))).toBe(original);
    expect(result.current.error).toBe('down');
    expect(result.current.loading).toBe(false);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'FETCH_BALANCE_ERROR', message: 'down' })
    );
  });

  it('auto-fetch failure is logged and exposed via state, not left as an unhandled rejection', async () => {
    const client = makeClient();
    client.request.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useCreatorBalance('c1'), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.error).toBe('down'));
    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('useCreatorBalance auto-fetch failed'),
        expect.any(Error)
      )
    );
    expect(result.current.loading).toBe(false);
  });

  it('a failing optional wallet balance does not fail the earnings fetch', async () => {
    const client = makeClient();
    client.request
      .mockResolvedValueOnce({ success: true, data: { totalEarnings: 5, pendingBalance: 1 } })
      .mockRejectedValueOnce(new Error('wallet down'));
    const { result } = renderHook(() => useCreatorBalance(undefined, false), {
      wrapper: wrapperFor(client),
    });

    await act(async () => {
      await result.current.fetchBalance('c1', 'w1');
    });
    expect(result.current.balance).toMatchObject({ totalEarnings: 5, pendingBalance: 1 });
    expect(result.current.error).toBeUndefined();
    expect(consoleWarn).toHaveBeenCalled();
  });
});

describe('useTransactionHistory error paths', () => {
  it('manual fetch: sets error, reports, re-throws, keeps prior data', async () => {
    const client = makeClient();
    client.request
      .mockResolvedValueOnce({ success: true, data: { tips: [{ id: 't1' }], total: 1 } })
      .mockResolvedValueOnce({ success: false, error: { message: 'API says no' } });
    const onError = vi.fn();
    const { result } = renderHook(() => useTransactionHistory(), {
      wrapper: wrapperFor(client, { onError }),
    });

    await act(async () => {
      await result.current.fetchHistory();
    });
    await rejection(() => result.current.fetchHistory());

    expect(result.current.error).toBe('API says no');
    expect(result.current.loading).toBe(false);
    expect(result.current.transactions).toEqual([{ id: 't1' }]);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'FETCH_HISTORY_ERROR', message: 'API says no' })
    );
  });

  it('auto-fetch failure is logged and exposed via state, not left as an unhandled rejection', async () => {
    const client = makeClient();
    client.request.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useTransactionHistory({ page: 1 }, true), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => expect(result.current.error).toBe('down'));
    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('useTransactionHistory auto-fetch failed'),
        expect.any(Error)
      )
    );
  });

  it('pagination helpers propagate failures to the caller', async () => {
    const client = makeClient();
    client.request
      .mockResolvedValueOnce({ success: true, data: { tips: [], total: 50, page: 1 } })
      .mockRejectedValueOnce(new Error('page 2 failed'));
    const { result } = renderHook(() => useTransactionHistory(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await result.current.fetchHistory({ page: 1, pageSize: 10 });
    });
    const err = await rejection(() => result.current.nextPage());
    expect((err as Error).message).toBe('page 2 failed');
    expect(result.current.page).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// DorisioProvider
// ---------------------------------------------------------------------------

describe('DorisioProvider error handling', () => {
  function Boom({ explode }: { explode: boolean }) {
    if (explode) throw new Error('render exploded');
    return <p>healthy</p>;
  }

  it('shows fallback UI for render errors and reports them to onError', () => {
    const onError = vi.fn();
    render(
      <DorisioProvider client={makeClient() as any} config={{} as any} onError={onError}>
        <Boom explode />
      </DorisioProvider>
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RENDER_ERROR', message: 'render exploded' })
    );
  });

  it('a throwing onError does not break the boundary fallback', () => {
    render(
      <DorisioProvider
        client={makeClient() as any}
        config={{} as any}
        onError={() => {
          throw new Error('app bug');
        }}
      >
        <Boom explode />
      </DorisioProvider>
    );
    expect(screen.getByText('render exploded')).toBeTruthy();
  });

  it('supports a custom fallback with a working reset', () => {
    const flag = { explode: true };
    function Flaky() {
      return <Boom explode={flag.explode} />; // read at render time, so reset re-evaluates it
    }
    render(
      <DorisioProvider
        client={makeClient() as any}
        config={{} as any}
        fallback={(err, reset) => <button onClick={reset}>custom fallback: {err?.message}</button>}
      >
        <Flaky />
      </DorisioProvider>
    );
    flag.explode = false;
    fireEvent.click(screen.getByText('custom fallback: render exploded'));
    expect(screen.getByText('healthy')).toBeTruthy();
  });

  describe('unhandled rejection logging', () => {
    const fire = (reason: unknown) =>
      window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));
    const ctx = () => ({ setError: vi.fn(), setIsLoading: vi.fn() });
    const mount = (props: Record<string, unknown> = {}) =>
      render(
        <DorisioProvider client={makeClient() as any} config={{} as any} {...props}>
          <p>child</p>
        </DorisioProvider>
      );

    it('logs rejections that came from hook actions', async () => {
      mount();
      const err = await runSafely(ctx(), { code: 'X', fallbackMessage: 'x' }, async () => {
        throw new Error('forgot to catch');
      }).catch((e) => e);
      fire(err);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('Unhandled promise rejection from a Dorisio hook action'),
        err
      );
    });

    it('ignores unrelated app rejections', () => {
      mount();
      fire(new Error('not ours'));
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('can be turned off, and the listener is removed on unmount', async () => {
      const err = await runSafely(ctx(), { code: 'X', fallbackMessage: 'x' }, async () => {
        throw new Error('e');
      }).catch((e) => e);

      const off = mount({ captureUnhandledRejections: false });
      fire(err);
      expect(consoleError).not.toHaveBeenCalled();
      off.unmount();

      const on = mount();
      on.unmount();
      fire(err);
      expect(consoleError).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// DorisioBoundary
// ---------------------------------------------------------------------------

describe('DorisioBoundary', () => {
  function ThrowOnRender({ error }: { error: unknown }) {
    throw error;
    return null;
  }

  it('renders children when no error occurs', () => {
    render(
      <DorisioBoundary>
        <p>healthy</p>
      </DorisioBoundary>
    );
    expect(screen.getByText('healthy')).toBeTruthy();
  });

  it('renders the default fallback when a DorisioError is thrown during render', () => {
    render(
      <DorisioBoundary>
        <ThrowOnRender error={new AuthError('auth failed', 401)} />
      </DorisioBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('auth failed')).toBeTruthy();
  });

  it('catches non-SDK errors and still renders the fallback UI', () => {
    render(
      <DorisioBoundary>
        <ThrowOnRender error={new Error('plain runtime error')} />
      </DorisioBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('plain runtime error')).toBeTruthy();
  });

  it('wraps non-Error thrown values in an Error and renders the fallback', () => {
    render(
      <DorisioBoundary>
        <ThrowOnRender error='string error' />
      </DorisioBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('string error')).toBeTruthy();
  });

  it('invokes onError with the DorisioError when an SDK error is caught', () => {
    const onError = vi.fn();
    const err = new AuthError('auth failed', 401, 'UNAUTHORIZED');
    render(
      <DorisioBoundary onError={onError}>
        <ThrowOnRender error={err} />
      </DorisioBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe(err);
    expect(onError.mock.calls[0]?.[0]?.message).toBe('auth failed');
    expect(onError.mock.calls[0]?.[0]?.code).toBe('UNAUTHORIZED');
  });

  it('passes React error info to onError', () => {
    const onError = vi.fn();
    render(
      <DorisioBoundary onError={onError}>
        <ThrowOnRender error={new PaymentError('pay failed')} />
      </DorisioBoundary>
    );
    expect(onError).toHaveBeenCalledTimes(1);
    const [, info] = onError.mock.calls[0] ?? [];
    expect(info?.componentStack).toContain('ThrowOnRender');
  });

  it('does not invoke onError for non-SDK errors', () => {
    const onError = vi.fn();
    render(
      <DorisioBoundary onError={onError}>
        <ThrowOnRender error={new Error('plain')} />
      </DorisioBoundary>
    );
    expect(onError).not.toHaveBeenCalled();
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('renders a custom fallback function receiving the error and a reset function', () => {
    render(
      <DorisioBoundary
        fallback={(error, reset) => (
          <div>
            <span>{error?.message}</span>
            <button onClick={reset}>reset</button>
          </div>
        )}
      >
        <ThrowOnRender error={new ValidationError('bad input')} />
      </DorisioBoundary>
    );
    expect(screen.getByText('bad input')).toBeTruthy();
    expect(screen.getByText('reset')).toBeTruthy();
  });

  it('renders a static custom fallback', () => {
    render(
      <DorisioBoundary fallback={<div>custom fallback</div>}>
        <ThrowOnRender error={new Error('boom')} />
      </DorisioBoundary>
    );
    expect(screen.getByText('custom fallback')).toBeTruthy();
  });

  it('resets the boundary and re-renders children on explicit reset only', () => {
    const flag = { explode: true };
    function Flaky() {
      if (flag.explode) throw new Error('render exploded');
      return <p>healthy</p>;
    }
    render(
      <DorisioBoundary>
        <Flaky />
      </DorisioBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    flag.explode = false;
    act(() => {
      fireEvent.click(screen.getByText('Try again'));
    });
    expect(screen.getByText('healthy')).toBeTruthy();
  });

  const sdkCases = [
    ['AuthError', new AuthError('auth failed', 401), 'auth failed'],
    ['PaymentError', new PaymentError('pay failed'), 'pay failed'],
    ['ValidationError', new ValidationError('bad input'), 'bad input'],
    ['RateLimitError', new RateLimitError('slow down', 30), 'slow down'],
  ];

  sdkCases.forEach(([name, error, message]) => {
    it(`renders the fallback for ${name}`, () => {
      render(
        <DorisioBoundary>
          <ThrowOnRender error={error} />
        </DorisioBoundary>
      );
      expect(screen.getByText('Something went wrong')).toBeTruthy();
      expect(screen.getByText(message)).toBeTruthy();
    });
  });

  it('does not propagate the caught error to the caller', () => {
    let renderError: unknown;
    try {
      render(
        <DorisioBoundary>
          <ThrowOnRender error={new ServerError('server down', 500)} />
        </DorisioBoundary>
      );
    } catch (err) {
      renderError = err;
    }
    expect(renderError).toBeUndefined();
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });
});
