import { describe, it, expect, vi } from 'vitest';
import { DorisioClient } from './client';
import crypto from 'crypto';

describe('DorisioClient Request Signing', () => {
  it('should automatically sign requests when requestSigning options are provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, data: { id: '123' } }),
      text: async () => JSON.stringify({ success: true, data: { id: '123' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new DorisioClient({
      baseUrl: 'https://api.dorisio.io',
      mode: 'live',
      requestSigning: {
        secret: 'client-signing-secret',
      },
    });

    await client.getCreator('creator-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.dorisio.io/creators/creator-1');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Signature']).toBeDefined();
    expect(headers['X-Timestamp']).toBeDefined();
    expect(headers['X-Signature']?.length).toBe(64);

    const canonicalString = `GET\n/creators/creator-1\n${headers['X-Timestamp']}\n`;
    const expectedSig = crypto
      .createHmac('sha256', 'client-signing-secret')
      .update(canonicalString)
      .digest('hex');
    expect(headers['X-Signature']).toBe(expectedSig);

    vi.unstubAllGlobals();
  });

  it('should allow setting and updating signing secret on client', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ success: true, data: { id: '123' } }),
      text: async () => JSON.stringify({ success: true, data: { id: '123' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new DorisioClient({
      baseUrl: 'https://api.dorisio.io',
      mode: 'live',
    });

    client.setRequestSigning({
      secret: { 'k1': 'sec-1', 'k2': 'sec-2' },
      keyId: 'k2',
    });

    await client.getCreator('creator-1');

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['X-Key-Id']).toBe('k2');
    expect(headers['X-Signature']).toBeDefined();

    vi.unstubAllGlobals();
  });
});
