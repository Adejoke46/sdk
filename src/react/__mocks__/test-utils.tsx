// @vitest-environment jsdom
/**
 * React testing utilities for Dorisio SDK hooks.
 *
 * Provides `renderWithDorisio`, `createMockClient`, and `waitForHookResult` to
 * reduce boilerplate when testing hooks that depend on `DorisioProvider` and a
 * `DorisioClient`. These utilities are intended for test files only and import
 * `vi` from `vitest` for the default mock client.
 *
 * @example
 * ```tsx
 * import { renderHook, act } from '@testing-library/react';
 * import { createMockClient, renderWithDorisio, waitForHookResult } from 'dorisio-sdk/react/test-utils';
 * import { useUser } from 'dorisio-sdk/react';
 *
 * const { client, request } = createMockClient();
 * request.mockResolvedValueOnce({ success: true, data: { id: 'u1', email: 'a@b.com' } });
 *
 * const { result } = renderHook(() => useUser(), {
 *   wrapper: renderWithDorisio({ client }).wrapper,
 * });
 *
 * await act(async () => {
 *   await result.current.fetchCurrentUser();
 * });
 *
 * const user = await waitForHookResult(() => result.current.user);
 * expect(user?.id).toBe('u1');
 * ```
 */

import React, { ReactNode } from 'react';
import { waitFor, type WaitForOptions } from '@testing-library/react';
import { vi } from 'vitest';
import {
  DorisioProvider,
  DorisioProviderProps,
  type DorisioContextValue,
  type AuthState,
  type ErrorState,
} from '../DorisioProvider';
import { DorisioClient, type ClientConfig } from '../client';

/**
 * A mock `request` implementation. Records every call and resolves with a
 * successful response by default. Tests that need vitest-specific mock behavior
 * (`mockResolvedValueOnce`, `mockRejectedValueOnce`, etc.) can use `request.mock.calls`
 * to inspect recorded calls, or pass their own `vi.fn()` via `createMockClient({ request })`.
 */
export interface MockRequest extends ReturnType<typeof vi.fn> {
  (
    method: string,
    path: string,
    body?: unknown,
    options?: unknown
  ): Promise<{ success: boolean; data?: unknown }>;
}

export interface CreateMockClientOptions {
  request?: MockRequest;
}

export interface CreateMockClientReturn {
  client: DorisioClient;
  request: MockRequest;
}

/**
 * Creates a mock DorisioClient for use in hook tests.
 *
 * The returned client satisfies `DorisioProvider` (it exposes `request`,
 * `setToken`, `clearToken`, and `getConfig`). By default `request` resolves with
 * `{ success: true }` and records every call (inspect via `request.mock.calls`).
 *
 * @example
 * ```tsx
 * import { createMockClient } from 'dorisio-sdk/react/test-utils';
 * import { vi } from 'vitest';
 *
 * const { client, request } = createMockClient();
 * request.mockResolvedValueOnce({ success: true, data: { id: 'u1' } });
 * // or pass your own mock:
 * const { client: custom } = createMockClient({ request: vi.fn() });
 * ```
 */
export function createMockClient(options: CreateMockClientOptions = {}): CreateMockClientReturn {
  const request = vi.fn(async (_method, _path, _body, _requestOptions) => {
    return { success: true };
  }) as MockRequest;

  const client = {
    request: options.request || request,
    setToken: () => undefined,
    clearToken: () => undefined,
    getConfig: () => ({} as ClientConfig),
  } as unknown as DorisioClient;

  return { client, request: client.request };
}

export interface RenderWithDorisioOptions {
  client?: DorisioClient;
  config?: ClientConfig;
  initialAuth?: AuthState;
  onError?: (error: ErrorState) => void;
  fallback?: DorisioProviderProps['fallback'];
  captureUnhandledRejections?: boolean;
}

export interface RenderWithDorisioReturn {
  wrapper: React.ComponentType<{ children: ReactNode }>;
  client: DorisioClient;
  config: ClientConfig;
  /** The mock `request` function (same reference as `client.request`). */
  request: MockRequest;
}

/**
 * Renders a hook within a `DorisioProvider` backed by a mocked client.
 *
 * Returns a `wrapper` component suitable for `@testing-library/react`'s
 * `renderHook` `wrapper` option, plus the resolved client and config.
 *
 * @example
 * ```tsx
 * import { renderHook, act } from '@testing-library/react';
 * import { renderWithDorisio } from 'dorisio-sdk/react/test-utils';
 * import { useWallet } from 'dorisio-sdk/react';
 *
 * const { wrapper, client } = renderWithDorisio();
 *
 * const { result } = renderHook(() => useWallet(), { wrapper });
 *
 * await act(async () => {
 *   await result.current.listWallets();
 * });
 * ```
 */
export function renderWithDorisio(options: RenderWithDorisioOptions = {}): RenderWithDorisioReturn {
  let client = options.client;
  let request: MockRequest;
  if (!client) {
    const created = createMockClient();
    client = created.client;
    request = created.request;
  } else {
    request = client.request as unknown as MockRequest;
  }
  const config =
    options.config ??
    (typeof (client as { getConfig?: () => ClientConfig }).getConfig === 'function'
      ? (client as { getConfig: () => ClientConfig }).getConfig()
      : ({} as ClientConfig));

  const wrapper: React.ComponentType<{ children: ReactNode }> = ({ children }) =>
    React.createElement(DorisioProvider, {
      client,
      config,
      initialAuth: options.initialAuth,
      onError: options.onError,
      fallback: options.fallback,
      captureUnhandledRejections: options.captureUnhandledRejections,
      children,
    });

  return { wrapper, client, config, request };
}

export interface WaitForHookResultOptions<T> {
  /**
   * Predicate that determines when the result is ready. Defaults to waiting
   * until the callback returns a non-null value.
   */
  until?: (value: T) => boolean;
  timeout?: WaitForOptions['timeout'];
  interval?: WaitForOptions['interval'];
}

/**
 * Waits for a hook's async result to settle and returns it.
 *
 * Wraps `@testing-library/react`'s `waitFor` with sensible defaults for SDK
 * hooks. The callback is re-invoked until `until(value)` returns true (default:
 * value is not null), then the last value is returned.
 *
 * @example
 * ```tsx
 * import { waitForHookResult } from 'dorisio-sdk/react/test-utils';
 *
 * const { result } = renderHook(() => useUser(), { wrapper });
 * await act(async () => { await result.current.fetchCurrentUser(); });
 *
 * const user = await waitForHookResult(() => result.current.user);
 * expect(user).toBeDefined();
 * ```
 */
export async function waitForHookResult<T>(
  cb: () => T,
  options: WaitForHookResultOptions<T> = {}
): Promise<T> {
  const { until = ((value: unknown) => value != null) as (value: T) => boolean, ...waitOptions } =
    options;
  let value: T;
  await waitFor(() => {
    value = cb();
    if (!until(value)) {
      throw new Error('waitForHookResult: condition not met');
    }
  }, waitOptions);
  return value;
}

export type { DorisioContextValue };
