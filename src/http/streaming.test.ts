/**
 * Streaming response tests (Issue #120)
 *
 * A scripted fetch mock emits byte chunks on demand, exercising:
 * - incremental, pull-driven delivery (the body is never fully buffered)
 * - multi-byte characters that straddle chunk boundaries
 * - progress reporting with and without Content-Length
 * - transfer statistics
 * - HTTP failures, mid-stream failures, timeouts and caller cancellation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DorisioClient } from '../client';
import { StreamHandler } from './stream-handler';

const enc = new TextEncoder();

/**
 * A response body that hands out one chunk per pull (default highWaterMark 1),
 * matching how a network response actually arrives: nothing is materialised
 * ahead of the consumer asking for it.
 */
function chunkedBody(
  chunks: Uint8Array[],
  hooks: { onPull?: () => void; cancel?: (reason?: unknown) => void } = {}
): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      hooks.onPull?.();
      const chunk = chunks[index];
      if (chunk) {
        index += 1;
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
    cancel: hooks.cancel,
  });
}

function textResponse(
  body: ReadableStream<Uint8Array> | null,
  init: { status?: number; headers?: Record<string, string> } = {}
) {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers(init.headers),
    body,
    text: async () => 'error',
  } as unknown as Response;
}

describe('HttpClient.requestTextStream (Issue #120)', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('streams an unbounded export without ever buffering it', async () => {
    let produced = 0;
    // Never closes: an implementation that buffered the whole body first would
    // never hand back a single byte.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1;
        controller.enqueue(enc.encode(`row${produced}\n`));
      },
    });
    fetchMock.mockResolvedValue(textResponse(body));

    const client = new DorisioClient({ baseUrl: 'https://api.test', mode: 'live' });
    const { stream } = await client.streamText('/transactions/export?format=csv&stream=true', {
      highWaterMark: 1,
    });
    const reader = stream.getReader();

    expect((await reader.read()).value).toBe('row1\n');
    // Only the chunk the queue needed (plus at most one in flight): the
    // "export" is effectively infinite, so it can never be fully drained.
    expect(produced).toBeLessThanOrEqual(2);

    expect((await reader.read()).value).toBe('row2\n');
    await reader.cancel();
  });

  it('delivers chunks in order, closes at the end and reports totals', async () => {
    const body = chunkedBody([enc.encode('row1\n'), enc.encode('row2\n'), enc.encode('row3\n')]);
    fetchMock.mockResolvedValue(textResponse(body));

    const client = new DorisioClient({ baseUrl: 'https://api.test', mode: 'live' });
    const { stream, stats } = await client.streamText('/export');
    const reader = stream.getReader();

    const received: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) received.push(value);
    }

    expect(received).toEqual(['row1\n', 'row2\n', 'row3\n']);
    expect(stats.totalBytes).toBe(15);
    expect(stats.chunks).toBe(3);
    expect(stats.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('stitches multi-byte characters that straddle chunk boundaries', async () => {
    const text = 'café — naïve ✓';
    const bytes = enc.encode(text);
    const split = 7; // lands inside the 3-byte em dash
    const body = chunkedBody([bytes.slice(0, split), bytes.slice(split)]);
    fetchMock.mockResolvedValue(textResponse(body));

    const client = new DorisioClient({ baseUrl: 'https://api.test', mode: 'live' });
    const { stream } = await client.streamText('/export');
    const reader = stream.getReader();

    const first = (await reader.read()).value ?? '';
    const second = (await reader.read()).value ?? '';
    await reader.read();

    expect(first + second).toBe(text);
    // The incomplete sequence is held back rather than replaced with U+FFFD.
    expect(first).toBe('café ');
    expect(new TextDecoder().decode(bytes.slice(0, split))).not.toBe(first);
  });

  it('reports progress with totalBytes when Content-Length is present', async () => {
    const body = chunkedBody([enc.encode('abcd'), enc.encode('efgh')]);
    fetchMock.mockResolvedValue(textResponse(body, { headers: { 'Content-Length': '8' } }));

    const progress: Array<{ bytesReceived: number; percentComplete?: number }> = [];
    const client = new DorisioClient({ baseUrl: 'https://api.test', mode: 'live' });
    const { stream } = await client.streamText('/export', {
      onProgress: (p) =>
        progress.push({ bytesReceived: p.bytesReceived, percentComplete: p.percentComplete }),
    });
    const reader = stream.getReader();

    await reader.read();
    await reader.read();
    await reader.read();

    expect(progress).toEqual([
      { bytesReceived: 4, percentComplete: 50 },
      { bytesReceived: 8, percentComplete: 100 },
    ]);
  });

  it('omits percentComplete when the server sends no Content-Length', async () => {
    const body = chunkedBody([enc.encode('x')]);
    fetchMock.mockResolvedValue(textResponse(body));

    const progress: Array<{ totalBytes?: number; percentComplete?: number }> = [];
    const client = new DorisioClient({ baseUrl: 'https://api.test', mode: 'live' });
    const { stream } = await client.streamText('/export', { onProgress: (p) => progress.push(p) });
    const reader = stream.getReader();

    await reader.read();
    await reader.read();

    expect(progress).toHaveLength(1);
    expect(progress[0]?.totalBytes).toBeUndefined();
    expect(progress[0]?.percentComplete).toBeUndefined();
  });

  it('throws ApiError for an error status before any streaming starts', async () => {
    fetchMock.mockResolvedValue(textResponse(null, { status: 404 }));

    const client = new DorisioClient({ baseUrl: 'https://api.test', mode: 'live' });
    await expect(client.streamText('/transactions/export')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('surfaces a mid-stream failure as a rejected read', async () => {
    const boom = new Error('connection reset');
    let fail!: (error: Error) => void;
    const gate = new Promise<Error>((resolve) => {
      fail = resolve;
    });
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(enc.encode('partial'));
          return;
        }
        controller.error(await gate);
      },
    });
    fetchMock.mockResolvedValue(textResponse(body));

    const client = new DorisioClient({ baseUrl: 'https://api.test', mode: 'live' });
    const { stream } = await client.streamText('/export');
    const reader = stream.getReader();

    expect((await reader.read()).value).toBe('partial');

    fail(boom);
    await expect(reader.read()).rejects.toThrow('connection reset');
  });

  it('rejects pending reads when the caller aborts', async () => {
    const body = chunkedBody([
      enc.encode('chunk1'),
      enc.encode('chunk2'),
      enc.encode('chunk3'),
    ]);
    fetchMock.mockResolvedValue(textResponse(body));

    const controller = new AbortController();
    const client = new DorisioClient({ baseUrl: 'https://api.test', mode: 'live' });
    const { stream, abort } = await client.streamText('/export', {
      signal: controller.signal,
      highWaterMark: 1,
    });
    const reader = stream.getReader();

    expect((await reader.read()).value).toBe('chunk1');

    abort();
    await expect(reader.read()).rejects.toThrow();
  });

  it('cancels the upstream body when the consumer cancels the stream', async () => {
    const cancelSpy = vi.fn();
    const body = chunkedBody([enc.encode('one'), enc.encode('two'), enc.encode('three')], {
      cancel: cancelSpy,
    });
    fetchMock.mockResolvedValue(textResponse(body));

    const client = new DorisioClient({ baseUrl: 'https://api.test', mode: 'live' });
    const { stream } = await client.streamText('/export', { highWaterMark: 1 });
    const reader = stream.getReader();

    await reader.read();
    await reader.cancel('no longer needed');

    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it('fails with TimeoutError when headers never arrive', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const aborted = new Error('Aborted');
          aborted.name = 'AbortError';
          init.signal?.addEventListener('abort', () => reject(aborted));
        })
    );

    const client = new DorisioClient({ baseUrl: 'https://api.test', mode: 'live' });
    await expect(client.streamText('/export', { timeout: 10 })).rejects.toThrow('timed out');
  });

  it('sends auth and request-id headers with the streaming request', async () => {
    const body = chunkedBody([enc.encode('x')]);
    fetchMock.mockResolvedValue(textResponse(body));

    const client = new DorisioClient({
      baseUrl: 'https://api.test',
      mode: 'live',
      token: 'tok_123',
      requestIdGenerator: () => 'fixed-id',
    });
    const { stream } = await client.streamText('/export');
    await stream.getReader().read();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok_123');
    expect(headers['X-Request-Id']).toBe('fixed-id');
  });

  it('exposes exportTransactionHistoryStream end-to-end', async () => {
    const csv = 'id,amount,status\ntx_1,10,confirmed\ntx_2,20,pending\n';
    const mid = Math.floor(csv.length / 2);
    const body = chunkedBody([enc.encode(csv.slice(0, mid)), enc.encode(csv.slice(mid))]);
    fetchMock.mockResolvedValue(textResponse(body));

    const client = new DorisioClient({ baseUrl: 'https://api.test', mode: 'live' });
    const { stream } = await client.exportTransactionHistoryStream({
      format: 'csv',
      startDate: new Date('2024-01-01T00:00:00Z'),
    });

    const reader = stream.getReader();
    const parts: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) parts.push(value);
    }

    expect(parts.join('')).toBe(csv);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/transactions/export?format=csv&stream=true&startDate=2024-01-01T00%3A00%3A00.000Z',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it("supports the issue's `stream: true` export flag", async () => {
    const csv = 'id,amount\ntx_1,10\n';
    const body = chunkedBody([enc.encode(csv)]);
    fetchMock.mockResolvedValue(textResponse(body));

    const client = new DorisioClient({ baseUrl: 'https://api.test', mode: 'live' });
    const exported = await client.exportTransactionHistory({ format: 'csv', stream: true });
    expect(exported.stream).toBeInstanceOf(ReadableStream);

    const reader = exported.stream.getReader();
    const parts: string[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) parts.push(value);
    }

    expect(parts.join('')).toBe(csv);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.test/transactions/export?format=csv&stream=true'
    );
  });
});

describe('StreamHandler (pre-existing helper, regression coverage)', () => {
  it('processes a response in chunks and reports totals', async () => {
    const payload = enc.encode('hello streaming world');
    const response = textResponse(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(payload.slice(0, 8));
          controller.enqueue(payload.slice(8));
          controller.close();
        },
      })
    );

    const seen: Uint8Array[] = [];
    const result = await new StreamHandler().processStream(response, {
      chunkHandler: async (chunk) => {
        seen.push(chunk);
      },
    });

    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen.reduce((acc, c) => acc + c.length, 0)).toBe(payload.length);
    expect(result.totalBytes).toBe(payload.length);
  });
});
