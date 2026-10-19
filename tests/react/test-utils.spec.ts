// @vitest-environment jsdom
/**
 * Tests for React testing utilities in `src/react/__mocks__/test-utils.tsx`.
 *
 * Verifies `renderWithDorisio`, `createMockClient`, and `waitForHookResult`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { renderWithDorisio, createMockClient, waitForHookResult } from '../../src/react/__mocks__/test-utils';
import { useUser } from '../../src/react/useUser';
import { useWallet } from '../../src/react/useWallet';
import { User } from '../../src/types/models';

describe('createMockClient', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('creates a client with a default request mock that resolves success', async () => {
    const { client, request } = createMockClient();

    expect(typeof client.request).toBe('function');
    expect(typeof client.setToken).toBe('function');
    expect(typeof client.clearToken).toBe('function');
    expect(typeof client.getConfig).toBe('function');

    const result = await client.request('GET', '/users/me');
    expect(result).toEqual({ success: true });
    expect(request.mock.calls).toHaveLength(1);
    expect(request.mock.calls[0][0]).toBe('GET');
    expect(request.mock.calls[0][1]).toBe('/users/me');
  });

  it('records arguments passed to request', async () => {
    const { request } = createMockClient();

    await request('POST', '/tips', { amount: 100 }, { timeout: 5000 });
    await request('PATCH', '/users/1', { name: 'a' });

    expect(request.mock.calls).toHaveLength(2);
    expect(request.mock.calls[1][0]).toBe('PATCH');
    expect(request.mock.calls[1][2]).toEqual({ name: 'a' });
  });

  it('accepts a custom vi.fn() request mock', async () => {
    const customRequest = vi.fn().mockResolvedValue({ success: true, data: { id: 'x' } });
    const { client, request } = createMockClient({ request: customRequest });

    const result = await client.request('GET', '/users/me');
    expect(result).toEqual({ success: true, data: { id: 'x' } });
    expect(customRequest).toHaveBeenCalled();
    expect(request).toBe(customRequest);
  });
});

describe('renderWithDorisio', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders hooks within DorisioProvider with a default mocked client', () => {
    const { wrapper, client } = renderWithDorisio();

    const { result } = renderHook(() => useUser(), { wrapper });

    expect(result.current.user).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(typeof client.request).toBe('function');
  });

  it('passes custom config and initialAuth to provider', () => {
    const { config } = renderWithDorisio({
      config: { baseUrl: 'https://custom.api', token: 'token-123' },
      initialAuth: { isAuthenticated: true, token: 'token-123', userId: 'u1', createdAt: 1 },
    });

    expect(config.baseUrl).toBe('https://custom.api');
    expect(config.token).toBe('token-123');
  });

  it('works with useWallet via renderHook', async () => {
    const { wrapper } = renderWithDorisio();
    const { result } = renderHook(() => useWallet(), { wrapper });

    expect(result.current.loading).toBe(false);
    expect(result.current.wallets).toEqual([]);
  });
});

describe('waitForHookResult', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('waits for a hook result to become non-null', async () => {
    const { wrapper, request } = renderWithDorisio();
    request.mockResolvedValueOnce({ success: true, data: { id: 'u1', email: 'a@b.com' } });

    const { result } = renderHook(() => useUser(), { wrapper });

    await act(async () => {
      await result.current.fetchCurrentUser();
    });

    const user = await waitForHookResult(() => result.current.user);
    expect(user).toEqual({ id: 'u1', email: 'a@b.com' });
  });

  it('respects a custom until predicate', async () => {
    const { wrapper, request } = renderWithDorisio();
    request.mockResolvedValueOnce({ success: true, data: { id: 'u2', email: 'b@b.com' } });

    const { result } = renderHook(() => useUser(), { wrapper });

    await act(async () => {
      await result.current.fetchCurrentUser();
    });

    const user = await waitForHookResult(
      () => result.current.user,
      { until: (u: User | null) => u?.id === 'u2' }
    );
    expect(user?.id).toBe('u2');
  });
});

describe('combined utility flow', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders a hook with mocked client and asserts async request', async () => {
    const { wrapper, request } = renderWithDorisio();
    request.mockResolvedValueOnce({
      success: true,
      data: { id: 'user-123', email: 'fan@example.com', name: 'Fan', role: 'fan', verified: true, createdAt: '2024-01-01T00:00:00Z' },
    });

    const { result } = renderHook(() => useUser(), { wrapper });

    await act(async () => {
      await result.current.fetchUser('user-123');
    });

    const user = await waitForHookResult(() => result.current.user);
    expect(user?.id).toBe('user-123');
    expect(request.mock.calls[0][0]).toBe('GET');
    expect(request.mock.calls[0][1]).toBe('/users/user-123');
  });

  it('supports onError from provider when hook fails', async () => {
    const onError = vi.fn();
    const { wrapper, client } = renderWithDorisio({ onError });
    client.request = vi.fn().mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => useUser(), { wrapper });

    await act(async () => {
      await result.current.fetchUser('bad').catch(() => undefined);
    });

    expect(onError).toHaveBeenCalled();
  });
});
