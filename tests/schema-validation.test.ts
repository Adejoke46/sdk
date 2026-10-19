import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { HttpClient } from '../src/http/http-client';
import { SchemaValidationError } from '../src/types/validation';

afterEach(() => vi.unstubAllGlobals());

describe('HTTP schema validation', () => {
  it('validates cached responses using each caller schema', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ amount: '8' })));
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpClient('https://example.com', { cache: { enabled: true } });
    await expect(client.request('/tips', { method: 'GET' })).resolves.toEqual({ amount: '8' });
    await expect(client.request('/tips', {
      method: 'GET', schemas: { response: z.object({ amount: z.coerce.number() }) },
    })).resolves.toEqual({ amount: 8 });
    await expect(client.request('/tips', {
      method: 'GET', schemas: { response: z.object({ amount: z.number() }) },
    })).rejects.toBeInstanceOf(SchemaValidationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('validates sandbox responses without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpClient('https://example.com', {
      mode: 'sandbox', schemas: { response: z.never() },
    });
    await expect(client.request('/api/v1/creators', { method: 'GET' })).rejects.toBeInstanceOf(SchemaValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('validates the final response after response interceptors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ amount: '8' }))));
    const client = new HttpClient('https://example.com', {
      schemas: { response: z.object({ amount: z.number() }) },
    });
    client.getInterceptors().addResponseInterceptor((value) => ({ amount: Number((value as { amount: string }).amount) }));
    await expect(client.request('/tips', { method: 'GET' })).resolves.toEqual({ amount: 8 });
  });

  it('transforms the request before sending and the response before returning', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ amount: '8' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpClient('https://example.com', {
      schemas: {
        request: z.object({ amount: z.coerce.number() }),
        response: z.object({ amount: z.coerce.number() }),
      },
    });

    const result = await client.request('/tips', { method: 'POST', body: { amount: '7' } });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ amount: 7 });
    expect(result).toEqual({ amount: 8 });
  });

  it('rejects invalid requests before fetch with field details and request ID', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpClient('https://example.com', {
      schemas: { request: z.object({ amount: z.number().positive() }) },
    });

    await expect(client.request('/tips', {
      method: 'POST', body: { amount: -1 }, requestId: 'validation-1',
    })).rejects.toMatchObject({
      name: 'SchemaValidationError', phase: 'request', requestId: 'validation-1',
      issues: [{ path: 'amount' }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates missing mutation bodies', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpClient('https://example.com', {
      schemas: { request: z.object({ amount: z.number() }) },
    });

    await expect(client.request('/tips', { method: 'POST' })).rejects.toBeInstanceOf(SchemaValidationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports invalid responses without retrying the HTTP call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => JSON.stringify({ amount: 'invalid' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpClient('https://example.com', {
      schemas: { response: z.object({ amount: z.number() }) },
    });

    await expect(client.request('/tips', { method: 'GET' })).rejects.toBeInstanceOf(SchemaValidationError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses Joi-style conversion and supports request-level schema overrides', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => JSON.stringify({ value: '4' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const joiLike = {
      validate(value: unknown) {
        return { value: { value: Number((value as { value: string }).value) } };
      },
    };
    const client = new HttpClient('https://example.com');

    const result = await client.request('/value', {
      method: 'POST', body: { value: '3' },
      schemas: { request: joiLike, response: joiLike },
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ value: 3 });
    expect(result).toEqual({ value: 4 });
  });

  it('includes Joi-style error paths and messages', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new HttpClient('https://example.com', {
      schemas: {
        request: {
          validate(value: unknown) {
            return {
              value,
              error: {
                message: 'Invalid amount',
                details: [{ path: ['payment', 'amount'], message: 'must be positive' }],
              },
            };
          },
        },
      },
    });

    await expect(client.request('/tips', { method: 'POST', body: {} })).rejects.toMatchObject({
      phase: 'request',
      issues: [{ path: 'payment.amount', message: 'must be positive' }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes values through when no schemas are configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, text: async () => JSON.stringify({ value: 'raw' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await new HttpClient('https://example.com').request('/value', { method: 'GET' });
    expect(result).toEqual({ value: 'raw' });
  });
});
