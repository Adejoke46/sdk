// @vitest-environment jsdom
/**
 * DorisioProvider type-safety and lifecycle tests.
 *
 * Covers context safety plus the initialization lifecycle (Issue #176):
 *  - onInit callback invoked after client creation, before children render
 *  - children stay unmounted until init settles
 *  - global error listener registered and removed on unmount
 *  - offline/online listeners registered via the client and removed on unmount
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import {
  render,
  renderHook,
  act,
  cleanup,
  waitFor,
  screen,
} from '@testing-library/react';
import type { ClientConfig } from '../client';
import { DorisioClient } from '../client';
import {
  DorisioProvider,
  isDorisioContext,
  requireDorisioContext,
  useDorisio,
} from './DorisioProvider';

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

const config: ClientConfig = { baseUrl: 'https://example.test', mode: 'sandbox' };

/** Mock client that records the listeners registered via `on`/`off`. */
function makeInitClient() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const client = {
    request: vi.fn(),
    setToken: vi.fn(),
    clearToken: vi.fn(),
    getConfig: (): ClientConfig => ({ baseUrl: 'https://example.test', mode: 'sandbox' }),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      const set = listeners.get(event);
      if (set) set.add(listener);
    }),
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    }),
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.forEach((listener) => listener(...args));
    },
  };
  return { client, listeners };
}

function wrapper(client: ReturnType<typeof makeInitClient>['client'], extra: Record<string, unknown> = {}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <DorisioProvider client={client as unknown as DorisioClient} config={config} {...extra}>
        {children}
      </DorisioProvider>
    );
  };
}

describe('DorisioProvider context safety', () => {
  it('throws a clear error when a hook is rendered outside the provider', () => {
    expect(() => renderHook(() => useDorisio())).toThrow('useDorisio must be used within DorisioProvider');
  });
  it('provides a non-null, narrowed context to consumers', () => {
    const client = new DorisioClient({ baseUrl: 'https://example.test', mode: 'sandbox' });
    const { result } = renderHook(() => useDorisio(), { wrapper: ({ children }) => <DorisioProvider client={client} config={client.getConfig()}>{children}</DorisioProvider> });
    expect(isDorisioContext(result.current)).toBe(true);
    expect(requireDorisioContext(result.current).client).toBe(client);
  });
});

describe('DorisioProvider initialization', () => {
  it('calls onInit after client creation, before children render', async () => {
    const onInit = vi.fn(async (_client: DorisioClient) => {});
    const { client } = makeInitClient();
    render(
      <DorisioProvider
        client={client as unknown as DorisioClient}
        config={config}
        onInit={onInit}
      >
        <p data-testid="child">child</p>
      </DorisioProvider>
    );
    expect(onInit).toHaveBeenCalledTimes(1);
    expect(onInit).toHaveBeenCalledWith(client);
    expect(screen.queryByTestId('child')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('child')).toBeTruthy());
  });

  it('renders children immediately when onInit is omitted', () => {
    const { client } = makeInitClient();
    render(
      <DorisioProvider client={client as unknown as DorisioClient} config={config}>
        <p>child</p>
      </DorisioProvider>
    );
    expect(screen.getByText('child')).toBeTruthy();
  });

  it('reports an onInit rejection through the provider error channel', async () => {
    const onError = vi.fn();
    const onInit = vi.fn(async () => {
      throw new Error('init failed');
    });
    const { client } = makeInitClient();
    render(
      <DorisioProvider
        client={client as unknown as DorisioClient}
        config={config}
        onInit={onInit}
        onError={onError}
      >
        <p>child</p>
      </DorisioProvider>
    );
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INIT_ERROR', message: 'init failed' })
      )
    );
    await waitFor(() => expect(screen.getByText('child')).toBeTruthy());
  });

  it('exposes the init error through context after rejection', async () => {
    const onInit = vi.fn(async () => {
      throw new Error('init failed');
    });
    const { client } = makeInitClient();
    const { result } = renderHook(() => useDorisio(), {
      wrapper: wrapper(client, { onInit }),
    });
    await waitFor(() =>
      expect(result.current.error).toMatchObject({ code: 'INIT_ERROR', message: 'init failed' })
    );
  });

  it('keeps children unmounted when init never resolves', async () => {
    const onInit = vi.fn(async () => {
      await new Promise<void>(() => {
        // never resolves
      });
    });
    const { client } = makeInitClient();
    render(
      <DorisioProvider
        client={client as unknown as DorisioClient}
        config={config}
        onInit={onInit}
      >
        <p data-testid="child">child</p>
      </DorisioProvider>
    );
    expect(screen.queryByTestId('child')).toBeNull();
    await act(async () => {});
    expect(screen.queryByTestId('child')).toBeNull();
  });

  it('calls onInit exactly once across provider re-renders', async () => {
    const onInit = vi.fn(async () => {});
    const { client } = makeInitClient();
    const { rerender } = render(
      <DorisioProvider
        client={client as unknown as DorisioClient}
        config={config}
        onInit={onInit}
      >
        <p>child</p>
      </DorisioProvider>
    );
    await waitFor(() => expect(screen.getByText('child')).toBeTruthy());
    rerender(
      <DorisioProvider
        client={client as unknown as DorisioClient}
        config={config}
        onInit={onInit}
      >
        <p>child</p>
      </DorisioProvider>
    );
    expect(onInit).toHaveBeenCalledTimes(1);
  });

  it('does not update state after unmount while initializing', async () => {
    let release!: () => void;
    const onInit = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    const { client } = makeInitClient();
    const { unmount } = render(
      <DorisioProvider
        client={client as unknown as DorisioClient}
        config={config}
        onInit={onInit}
      >
        <p>child</p>
      </DorisioProvider>
    );
    unmount();
    release();
    await act(async () => {});
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining("Can't perform a React state update on an unmounted component")
    );
  });
});

describe('DorisioProvider listeners', () => {
  it('registers offline and online listeners on the client', () => {
    const { client } = makeInitClient();
    render(
      <DorisioProvider client={client as unknown as DorisioClient} config={config}>
        <p>child</p>
      </DorisioProvider>
    );
    expect(client.on).toHaveBeenCalledWith('offline', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('online', expect.any(Function));
  });

  it('propagates offline events to the provider error channel', () => {
    const onError = vi.fn();
    const { client } = makeInitClient();
    render(
      <DorisioProvider
        client={client as unknown as DorisioClient}
        config={config}
        onError={onError}
      >
        <p>child</p>
      </DorisioProvider>
    );
    act(() => {
      client.emit('offline');
    });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'OFFLINE', message: 'Device went offline' })
    );
  });

  it('clears the error on online events', () => {
    const { client } = makeInitClient();
    const { result } = renderHook(() => useDorisio(), {
      wrapper: wrapper(client),
    });
    act(() => {
      client.emit('offline');
    });
    expect(result.current.error).toMatchObject({ code: 'OFFLINE' });
    act(() => {
      client.emit('online');
    });
    expect(result.current.error).toBeUndefined();
  });

  it('unregisters offline and online listeners on unmount', () => {
    const { client } = makeInitClient();
    const { unmount } = render(
      <DorisioProvider client={client as unknown as DorisioClient} config={config}>
        <p>child</p>
      </DorisioProvider>
    );
    unmount();
    expect(client.off).toHaveBeenCalledWith('offline', expect.any(Function));
    expect(client.off).toHaveBeenCalledWith('online', expect.any(Function));
    expect(client.off).toHaveBeenCalledTimes(2);
  });

  it('does not accumulate listeners across mount/unmount cycles', () => {
    const { client } = makeInitClient();
    const { unmount: unmountFirst } = render(
      <DorisioProvider client={client as unknown as DorisioClient} config={config}>
        <p>child</p>
      </DorisioProvider>
    );
    const { unmount: unmountSecond } = render(
      <DorisioProvider client={client as unknown as DorisioClient} config={config}>
        <p>child</p>
      </DorisioProvider>
    );
    unmountFirst();
    unmountSecond();
    expect(client.on).toHaveBeenCalledTimes(4);
    expect(client.off).toHaveBeenCalledTimes(4);
  });
});

describe('DorisioProvider global error handling', () => {
  it('registers a global error listener on window', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const { client } = makeInitClient();
    render(
      <DorisioProvider client={client as unknown as DorisioClient} config={config}>
        <p>child</p>
      </DorisioProvider>
    );
    expect(addSpy).toHaveBeenCalledWith('error', expect.any(Function));
    addSpy.mockRestore();
  });

  it('reports global window errors through onError', async () => {
    const onError = vi.fn();
    const { client } = makeInitClient();
    render(
      <DorisioProvider
        client={client as unknown as DorisioClient}
        config={config}
        onError={onError}
      >
        <p>child</p>
      </DorisioProvider>
    );
    await act(async () => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'global boom' }));
    });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'GLOBAL_ERROR', message: 'global boom' })
    );
  });

  it('removes the global error listener on unmount', async () => {
    const onError = vi.fn();
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { client } = makeInitClient();
    const { unmount } = render(
      <DorisioProvider
        client={client as unknown as DorisioClient}
        config={config}
        onError={onError}
      >
        <p>child</p>
      </DorisioProvider>
    );
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('error', expect.any(Function));
    removeSpy.mockRestore();
    await act(async () => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'after unmount' }));
    });
    expect(onError).not.toHaveBeenCalled();
  });
});
