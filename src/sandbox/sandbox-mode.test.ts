/**
 * Sandbox / mock mode integration tests
 *
 * Verifies DorisioClient({ mode: 'sandbox' }) never hits the network,
 * returns deterministic mocks, records history, and supports mode toggle.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DorisioClient } from '../client';
import { createSandboxClient } from './sandbox-client';

describe('Sandbox mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates tips without calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const client = new DorisioClient({
      baseUrl: 'https://api.dorisio.com',
      token: 'test-token',
      mode: 'sandbox',
      sandboxSeed: 42,
    });

    const tip = await client.createTip({
      creatorId: 'mock-creator-123',
      amount: 50,
      message: 'Test tip',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(tip).toBeDefined();
    expect(tip.creatorId).toBe('mock-creator-123');
    expect(tip.amount).toBe(50);
    expect(tip.message).toBe('Test tip');
    expect(tip.id).toMatch(/^tip-/);
  });

  it('records sandbox request history', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.dorisio.com',
      mode: 'sandbox',
      sandboxSeed: 7,
    });

    await client.createTip({ creatorId: 'c1', amount: 10 });
    await client.getCurrentUser();

    const history = client.getSandboxHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0]?.method).toBe('POST');
    expect(history[0]?.path).toContain('transactions/tip');
    expect(history.some((h) => h.path.includes('/users/me'))).toBe(true);

    client.clearSandboxHistory();
    expect(client.getSandboxHistory()).toHaveLength(0);
  });

  it('returns deterministic mocks for the same seed', async () => {
    const a = new DorisioClient({
      baseUrl: 'https://api.dorisio.com',
      mode: 'sandbox',
      sandboxSeed: 99,
    });
    const b = new DorisioClient({
      baseUrl: 'https://api.dorisio.com',
      mode: 'sandbox',
      sandboxSeed: 99,
    });

    const tipA = await a.createTip({ creatorId: 'x', amount: 1 });
    const tipB = await b.createTip({ creatorId: 'x', amount: 1 });

    expect(tipA.id).toBe(tipB.id);
    expect(tipA.stellarTxHash).toBe(tipB.stellarTxHash);
  });

  it('toggles between sandbox and live without recreating the client', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: { id: 'live-user' } }),
    } as Response);

    const client = new DorisioClient({
      baseUrl: 'https://api.dorisio.com',
      mode: 'sandbox',
    });

    expect(client.isSandboxMode()).toBe(true);
    await client.getCurrentUser();
    expect(fetchSpy).not.toHaveBeenCalled();

    client.setMode('live');
    expect(client.isSandboxMode()).toBe(false);
    expect(client.getMode()).toBe('live');

    await client.request('GET', '/users/me');
    expect(fetchSpy).toHaveBeenCalled();

    client.setMode('sandbox');
    fetchSpy.mockClear();
    await client.getCurrentUser();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('covers auth, wallet, creator, and balance sandbox paths', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = createSandboxClient({ seed: 3, latency: 0 });

    await expect(client.getCreator('creator-1')).resolves.toBeDefined();
    await expect(client.listCreators()).resolves.toBeDefined();
    await expect(client.getWallet('wallet-1')).resolves.toBeDefined();
    await expect(client.getBalance('user-1')).resolves.toBeDefined();
    await expect(client.getTransactionStats()).resolves.toBeDefined();
    await expect(client.canPayout('creator-1')).resolves.toBe(true);
    await expect(client.refreshSession()).resolves.toBeDefined();
    await expect(client.getAccountSummary()).resolves.toBeDefined();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(client.getSandboxHistory().length).toBeGreaterThanOrEqual(8);
  });

  it('createSandboxClient defaults to sandbox mode', () => {
    const client = createSandboxClient();
    expect(client.isSandboxMode()).toBe(true);
    expect(client.getMode()).toBe('sandbox');
  });
});
