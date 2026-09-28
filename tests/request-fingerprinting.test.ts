/**
 * Request Fingerprinting Tests (Issue #63)
 *
 * Verifies that:
 * 1. A unique request ID is generated automatically for all outbound requests.
 * 2. The request ID is included in the X-Request-ID header.
 * 3. Custom request ID / custom generator formats are supported.
 * 4. Request IDs are attached to error objects (ApiError, DorisioError) and available in error handlers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpClient } from '../src/http/http-client';
import { DorisioClient } from '../src/client';
import { ApiError } from '../src/types/errors';

describe('Request Fingerprinting (Issue #63)', () => {
  let capturedHeaders: Record<string, string> = {};

  beforeEach(() => {
    capturedHeaders = {};
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates unique request ID automatically on every request', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedHeaders = { ...(init?.headers as Record<string, string>) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: {} }),
      };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com');
    await client.request('/test', { method: 'GET' });

    expect(capturedHeaders['X-Request-Id']).toBeDefined();
    expect(capturedHeaders['X-Request-Id'].length).toBeGreaterThan(0);
  });

  it('honors custom request ID supplied in RequestOptions', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedHeaders = { ...(init?.headers as Record<string, string>) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: {} }),
      };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com');
    await client.request('/test', {
      method: 'GET',
      requestId: 'custom-fingerprint-12345',
    });

    expect(capturedHeaders['X-Request-Id']).toBe('custom-fingerprint-12345');
  });

  it('supports custom request ID generator in ClientConfig / HttpClientOptions', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      capturedHeaders = { ...(init?.headers as Record<string, string>) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            id: 'creator-c1',
            name: 'Creator 1',
            bio: 'Bio',
            verified: true,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          },
        }),
      };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    let count = 100;
    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      requestIdGenerator: () => `dorisio-custom-${count++}`,
    });

    await client.getCreator('c1');
    expect(capturedHeaders['X-Request-Id']).toBe('dorisio-custom-100');

    await client.getCreator('c2');
    expect(capturedHeaders['X-Request-Id']).toBe('dorisio-custom-101');
  });

  it('attaches requestId to ApiError on HTTP failures', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Creator not found', code: 'NOT_FOUND' }),
      };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com');

    try {
      await client.request('/creators/invalid-id', {
        method: 'GET',
        requestId: 'trace-error-req-99',
      });
      expect.unreachable('Should have thrown ApiError');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.statusCode).toBe(404);
      expect(apiErr.requestId).toBe('trace-error-req-99');
    }
  });

  it('provides requestId to custom error handlers', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      return {
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    let receivedRequestId: string | undefined;

    const client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      errorHandler: async (_error, context) => {
        receivedRequestId = context.requestId;
        return { action: 'fallback', fallbackValue: { success: true, data: { fallback: true } } };
      },
    });

    await client.request('GET', '/test', undefined, {
      requestId: 'error-handler-trace-77',
    });

    expect(receivedRequestId).toBe('error-handler-trace-77');
  });
});
