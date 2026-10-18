import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { gzipSync, brotliCompressSync, gunzipSync, brotliDecompressSync } from 'node:zlib';
import {
  compressRequestBody,
  prepareRequestBody,
  decompressResponseBody,
} from '../../src/http/compress';
import { HttpClient } from '../../src/http/http-client';

const largeBody = JSON.stringify({
  items: Array.from({ length: 500 }, (_, i) => ({ id: i, name: `item-${i}`, value: i * 1.5 })),
});

function gzipBuffer(text: string): ArrayBuffer {
  const compressed = gzipSync(text);
  return Buffer.from(compressed).buffer.slice(
    compressed.byteOffset,
    compressed.byteOffset + compressed.byteLength,
  );
}

function brotliBuffer(text: string): ArrayBuffer {
  const compressed = brotliCompressSync(text);
  return Buffer.from(compressed).buffer.slice(
    compressed.byteOffset,
    compressed.byteOffset + compressed.byteLength,
  );
}

function mockFetch(response: unknown, encoding = ''): ReturnType<typeof vi.fn> {
  let buffer: ArrayBuffer;
  const text = JSON.stringify(response);
  if (encoding === 'gzip') buffer = gzipBuffer(text);
  else if (encoding === 'br') buffer = brotliBuffer(text);
  else buffer = new TextEncoder().encode(text).buffer;

  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-encoding' ? encoding : null,
    },
    arrayBuffer: async () => buffer,
    text: async () => new TextDecoder().decode(buffer),
    json: async () => response,
  } as unknown as Response);
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('compressRequestBody', () => {
  it('compresses large bodies with gzip by default and preserves contents', async () => {
    const compressed = await compressRequestBody(largeBody);
    expect(compressed).toBeDefined();
    if (!compressed) throw new Error('expected compressed body');
    expect(compressed.algorithm).toBe('gzip');
    expect(gunzipSync(compressed.body).toString()).toBe(largeBody);
    expect(compressed.body.byteLength).toBeLessThan(
      new TextEncoder().encode(largeBody).byteLength,
    );
  });

  it('compresses and restores bodies with Brotli', async () => {
    const compressed = await compressRequestBody(largeBody, { algorithm: 'brotli' });
    expect(compressed).toBeDefined();
    if (!compressed) throw new Error('expected compressed body');
    expect(compressed.algorithm).toBe('brotli');
    expect(brotliDecompressSync(compressed.body).toString()).toBe(largeBody);
  });

  it('leaves bodies below the threshold uncompressed', async () => {
    await expect(compressRequestBody('small', { threshold: 10 })).resolves.toBeUndefined();
  });

  it('compresses bodies above a custom threshold', async () => {
    const body = '1234567890';
    await expect(compressRequestBody(body, { threshold: 5 })).resolves.toBeDefined();
    await expect(compressRequestBody(body, { threshold: 100 })).resolves.toBeUndefined();
  });

  it('does not compress when disabled', async () => {
    await expect(compressRequestBody(largeBody, { enabled: false })).resolves.toBeUndefined();
  });

  it('throws on invalid threshold', async () => {
    await expect(
      compressRequestBody(largeBody, { threshold: -1 }),
    ).rejects.toThrow(/non-negative/);
  });
});

describe('prepareRequestBody', () => {
  it('sets Content-Encoding and removes Content-Length for compressed bodies', async () => {
    const prepared = await prepareRequestBody(largeBody, { 'Content-Length': '99999' });
    expect(prepared.headers).toEqual({ 'Content-Encoding': 'gzip' });
    expect(gunzipSync(prepared.body as Uint8Array).toString()).toBe(largeBody);
  });

  it('does not re-encode when caller already set Content-Encoding', async () => {
    const prepared = await prepareRequestBody(largeBody, { 'content-encoding': 'identity' });
    expect(prepared.body).toBe(largeBody);
    expect(prepared.headers).toEqual({ 'content-encoding': 'identity' });
  });

  it('returns body unchanged when below threshold', async () => {
    const prepared = await prepareRequestBody('tiny', {});
    expect(prepared.body).toBe('tiny');
    expect(prepared.headers).toEqual({});
  });
});

describe('decompressResponseBody', () => {
  it('decompresses gzip-encoded response bodies', async () => {
    const text = await decompressResponseBody(gzipBuffer(largeBody), 'gzip');
    expect(text).toBe(largeBody);
  });

  it('decompresses br-encoded response bodies', async () => {
    const text = await decompressResponseBody(brotliBuffer(largeBody), 'br');
    expect(text).toBe(largeBody);
  });

  it('returns identity text when no encoding is set', async () => {
    const text = await decompressResponseBody(new TextEncoder().encode(largeBody).buffer, '');
    expect(text).toBe(largeBody);
  });

  it('handles a null body gracefully', async () => {
    const text = await decompressResponseBody(null, 'gzip');
    expect(text).toBe('');
  });
});

describe('HttpClient request compression', () => {
  it('compresses POST bodies automatically and sends Accept-Encoding', async () => {
    const fetchMock = mockFetch({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', {
      compress: { enabled: true, threshold: 1 },
    });
    await client.request('/api/v1/items', {
      method: 'POST',
      body: { payload: largeBody },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init.headers['Accept-Encoding']).toBe('gzip, br');
    expect(init.headers['Content-Encoding']).toBe('gzip');
    expect(init.headers['content-length']).toBeUndefined();
    const compressedBody = init.body as Uint8Array;
    expect(gunzipSync(compressedBody).toString()).toBe(
      JSON.stringify({ payload: largeBody }),
    );
    expect(compressedBody.byteLength).toBeLessThan(
      new TextEncoder().encode(JSON.stringify({ payload: largeBody })).byteLength,
    );
  });

  it('does not compress small POST bodies', async () => {
    const fetchMock = mockFetch({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', {
      compress: { threshold: 10000 },
    });
    await client.request('/api/v1/items', {
      method: 'POST',
      body: { small: 'body' },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init.headers['Content-Encoding']).toBeUndefined();
    expect(init.body).toBe(JSON.stringify({ small: 'body' }));
  });

  it('sends Accept-Encoding on GET without compressing (no body)', async () => {
    const fetchMock = mockFetch({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com');
    await client.request('/api/v1/items', { method: 'GET' });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init.headers['Accept-Encoding']).toBe('gzip, br');
    expect(init.body).toBeUndefined();
  });

  it('disables request compression when compressionEnabled is false', async () => {
    const fetchMock = mockFetch({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', {
      compress: { enabled: false },
    });
    await client.request('/api/v1/items', {
      method: 'POST',
      body: { payload: largeBody },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init.headers['Content-Encoding']).toBeUndefined();
    expect(init.body).toBe(JSON.stringify({ payload: largeBody }));
  });

  it('uses brotli for request bodies when configured', async () => {
    const fetchMock = mockFetch({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com', {
      compress: { algorithm: 'brotli', threshold: 1 },
    });
    await client.request('/api/v1/items', {
      method: 'POST',
      body: { payload: largeBody },
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init.headers['Content-Encoding']).toBe('brotli');
    expect(brotliDecompressSync(init.body as Uint8Array).toString()).toBe(
      JSON.stringify({ payload: largeBody }),
    );
  });
});

describe('HttpClient response decompression', () => {
  it('transparently decompresses gzip-encoded responses', async () => {
    const fetchMock = mockFetch({ id: 1, name: 'compressed-response' }, 'gzip');
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com');
    const data = await client.request<{ id: number; name: string }>('/api/v1/items', {
      method: 'GET',
    });

    expect(data).toEqual({ id: 1, name: 'compressed-response' });
  });

  it('transparently decompresses br-encoded responses', async () => {
    const fetchMock = mockFetch({ id: 2, name: 'brotli-response' }, 'br');
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com');
    const data = await client.request<{ id: number; name: string }>('/api/v1/items', {
      method: 'GET',
    });

    expect(data).toEqual({ id: 2, name: 'brotli-response' });
  });

  it('returns uncompressed responses unchanged when no encoding header', async () => {
    const fetchMock = mockFetch({ id: 3 });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new HttpClient('https://api.example.com');
    const data = await client.request<{ id: number }>('/api/v1/items', { method: 'GET' });

    expect(data).toEqual({ id: 3 });
  });
});
