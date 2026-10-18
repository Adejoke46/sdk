/**
 * Custom Headers Tests (Issue #61)
 *
 * Verifies that:
 * 1. Custom HTTP headers can be supplied per request.
 * 2. Custom headers properly merge with default client headers.
 * 3. Custom headers can override default client headers.
 * 4. Custom headers are supported across all major DorisioClient methods.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DorisioClient } from '../src/client';
import { HttpClient } from '../src/http/http-client';

describe('Custom HTTP Headers per Request (Issue #61)', () => {
  let capturedHeaders: Record<string, string> = {};

  beforeEach(() => {
    capturedHeaders = {};
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedHeaders = { ...(init?.headers as Record<string, string>) };
      const isList = url.includes('/creators?') || url.endsWith('/creators');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: isList
            ? {
                creators: [
                  {
                    id: 'creator-123',
                    name: 'Alice Creator',
                    bio: 'Artist',
                    verified: true,
                    createdAt: '2024-01-01T00:00:00Z',
                    updatedAt: '2024-01-01T00:00:00Z',
                  },
                ],
                total: 1,
                page: 1,
                pageSize: 20,
              }
            : {
                id: 'creator-123',
                name: 'Alice Creator',
                bio: 'Artist',
                verified: true,
                createdAt: '2024-01-01T00:00:00Z',
                updatedAt: '2024-01-01T00:00:00Z',
              },
        }),
      };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends custom headers per request via HttpClient', async () => {
    const client = new HttpClient('https://api.example.com', {
      headers: { 'X-Default-Header': 'default-val' },
    });

    await client.request('/test', {
      method: 'GET',
      headers: {
        'X-Request-ID': 'custom-req-001',
        'X-Custom-Header': 'custom-val',
      },
    });

    expect(capturedHeaders['X-Default-Header']).toBe('default-val');
    expect(capturedHeaders['X-Custom-Header']).toBe('custom-val');
    expect(capturedHeaders['X-Request-ID']).toBe('custom-req-001');
  });

  it('allows request headers to override default client headers', async () => {
    const client = new HttpClient('https://api.example.com', {
      headers: {
        'Content-Type': 'application/json',
        'X-App-Version': '1.0.0',
      },
    });

    await client.request('/test', {
      method: 'POST',
      body: { key: 'value' },
      headers: {
        'X-App-Version': '2.0.0',
        'X-Tenant-ID': 'tenant-abc',
      },
    });

    expect(capturedHeaders['X-App-Version']).toBe('2.0.0');
    expect(capturedHeaders['X-Tenant-ID']).toBe('tenant-abc');
  });

  it('supports custom headers in DorisioClient.getCreator', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      token: 'jwt-auth-token',
    });

    await client.getCreator('creator-123', {
      headers: {
        'X-Request-ID': 'get-creator-trace-01',
        'X-Custom-Trace': 'trace-xyz',
      },
    });

    expect(capturedHeaders['Authorization']).toBe('Bearer jwt-auth-token');
    expect(capturedHeaders['X-Custom-Trace']).toBe('trace-xyz');
    expect(capturedHeaders['X-Request-ID']).toBe('get-creator-trace-01');
  });

  it('supports custom headers in DorisioClient.listCreators', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
    });

    await client.listCreators(
      { page: 1, pageSize: 20 },
      { headers: { 'X-Client-Feature': 'beta-creators' } }
    );

    expect(capturedHeaders['X-Client-Feature']).toBe('beta-creators');
  });

  it('supports custom headers in DorisioClient.createTip', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
    });

    await client.createTip(
      {
        creatorId: 'creator-123',
        amount: 50,
        message: 'Awesome work!',
        idempotencyKey: 'idem-key-999',
      },
      {
        headers: {
          'X-Affiliate-ID': 'aff-456',
        },
      }
    );

    expect(capturedHeaders['Idempotency-Key']).toBe('idem-key-999');
    expect(capturedHeaders['X-Affiliate-ID']).toBe('aff-456');
  });

  it('supports custom headers in DorisioClient.connectWallet and getWallet', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
    });

    await client.connectWallet(
      {
        publicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYEMPLJ3DPWFUBNKMMM',
        nickname: 'Test Wallet',
      },
      { headers: { 'X-Wallet-Source': 'freighter' } }
    );
    expect(capturedHeaders['X-Wallet-Source']).toBe('freighter');

    await client.getWallet('wallet-123', {
      headers: { 'X-Audit-Reason': 'balance-check' },
    });
    expect(capturedHeaders['X-Audit-Reason']).toBe('balance-check');
  });
});
