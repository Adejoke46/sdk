import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { compressRequestBody, prepareRequestBody } from './compress';

function requireCompressed<T>(result: T | undefined): T {
  if (result === undefined) throw new Error('Expected the request body to be compressed');
  return result;
}

describe('compressRequestBody', () => {
  const largeBody = JSON.stringify({ values: Array.from({ length: 500 }, (_, index) => index) });

  it('compresses large bodies with gzip by default and preserves their contents', async () => {
    const compressed = requireCompressed(await compressRequestBody(largeBody));

    expect(compressed.algorithm).toBe('gzip');
    expect(gunzipSync(compressed.body).toString()).toBe(largeBody);
    expect(compressed.body.byteLength).toBeLessThan(new TextEncoder().encode(largeBody).byteLength);
  });

  it('uses the configured threshold and leaves smaller bodies unchanged', async () => {
    await expect(compressRequestBody('1234', { threshold: 4 })).resolves.toBeUndefined();

    const compressed = requireCompressed(await compressRequestBody('12345', { threshold: 4 }));
    expect(compressed.algorithm).toBe('gzip');
    expect(gunzipSync(compressed.body).toString()).toBe('12345');
  });

  it('does not compress when disabled', async () => {
    await expect(compressRequestBody(largeBody, { enabled: false })).resolves.toBeUndefined();
  });

  it('compresses and restores bodies with Brotli', async () => {
    const compressed = requireCompressed(
      await compressRequestBody(largeBody, { algorithm: 'brotli' })
    );

    expect(compressed.algorithm).toBe('brotli');
    expect(brotliDecompressSync(compressed.body).toString()).toBe(largeBody);
  });

  it('sets Content-Encoding and clears a stale Content-Length', async () => {
    const headers = { 'Content-Length': '99999' };
    const prepared = await prepareRequestBody(largeBody, headers);
    const compressedBytes = new Uint8Array(await (prepared.body as Blob).arrayBuffer());

    expect(prepared.headers).toEqual({ 'Content-Encoding': 'gzip' });
    expect(gunzipSync(compressedBytes).toString()).toBe(largeBody);
  });

  it('does not re-encode a body with a caller-provided Content-Encoding', async () => {
    const headers = { 'content-encoding': 'custom' };
    const prepared = await prepareRequestBody(largeBody, headers);

    expect(prepared.body).toBe(largeBody);
    expect(prepared.headers).toEqual({ 'content-encoding': 'custom' });
  });
});