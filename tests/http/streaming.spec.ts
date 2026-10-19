import { describe, it, expect, vi } from 'vitest';
import { WritableStream } from 'stream/web';
import { StreamHandler, isLargeResponse, type StreamResult, type StreamProgress } from '../../src/http/stream-handler';
import { HttpClient } from '../../src/http/http-client';

const enc = new TextEncoder();
const MB = 1024 * 1024;

function concat(parts: Uint8Array[]): string {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return new TextDecoder().decode(out);
}

function bodyOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk === undefined) {
        controller.close();
      } else {
        controller.enqueue(chunk);
      }
    },
  });
}

function responseWith(
  body: ReadableStream<Uint8Array> | null,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(init.headers),
    body,
    text: async () => 'error',
  } as unknown as Response;
}

function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array[]> {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  return (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) parts.push(value);
    }
    return parts;
  })();
}

describe('StreamHandler - chunked reading', () => {
  it('delivers chunks to onChunk without buffering the whole payload', async () => {
    const payload = enc.encode('x'.repeat(1000));
    const chunks = [payload.slice(0, 300), payload.slice(300, 700), payload.slice(700)];
    const received: Uint8Array[] = [];

    const result = await new StreamHandler().processStream(responseWith(bodyOf(chunks)), {
      onChunk: (chunk) => {
        received.push(chunk.slice());
      },
    });

    expect(received).toHaveLength(3);
    expect(concat(received)).toBe(new TextDecoder().decode(payload));
    expect(received.every((chunk) => chunk.length < payload.length)).toBe(true);
    expect(result.totalBytes).toBe(1000);
  });

  it('reports completion through onComplete', async () => {
    const payload = enc.encode('hello streaming world');
    const chunks = [payload.slice(0, 8), payload.slice(8)];
    let completed: StreamResult | undefined;

    await new StreamHandler().processStream(responseWith(bodyOf(chunks)), {
      onChunk: () => undefined,
      onComplete: (result) => {
        completed = result;
      },
    });

    expect(completed).toBeDefined();
    expect(completed?.totalBytes).toBe(payload.length);
    expect(completed?.chunksProcessed).toBe(2);
    expect(completed?.duration).toBeGreaterThanOrEqual(0);
  });

  it('handles an empty body without invoking chunk handlers', async () => {
    let chunks = 0;
    const result = await new StreamHandler().processStream(responseWith(bodyOf([])), {
      onChunk: () => {
        chunks += 1;
      },
    });

    expect(chunks).toBe(0);
    expect(result.totalBytes).toBe(0);
    expect(result.chunksProcessed).toBe(0);
  });

  it('propagates mid-stream body errors through onError', async () => {
    const boom = new Error('connection reset');
    let errorSeen: Error | undefined;
    let chunks = 0;
    const erroringBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(enc.encode('partial'));
        controller.error(boom);
      },
    });

    await expect(
      new StreamHandler().processStream(responseWith(erroringBody), {
        onChunk: () => {
          chunks += 1;
        },
        onError: (error) => {
          errorSeen = error;
        },
      }),
    ).rejects.toThrow('connection reset');

    expect(chunks).toBe(1);
    expect(errorSeen?.message).toBe('connection reset');
  });

  it('throws when the response has no readable body', async () => {
    await expect(
      new StreamHandler().processStream(responseWith(null), { onChunk: () => undefined }),
    ).rejects.toThrow('Response body is null');
  });

  it('reports progress with percentComplete when Content-Length is present', async () => {
    const chunks = [enc.encode('abcd'), enc.encode('efgh')];
    const progress: StreamProgress[] = [];

    await new StreamHandler().processStream(
      responseWith(bodyOf(chunks), { headers: { 'Content-Length': '8' } }),
      {
        progressHandler: (p) => progress.push(p),
      },
    );

    expect(progress).toEqual([
      { bytesReceived: 4, totalBytes: 8, chunkSize: 4, percentComplete: 50 },
      { bytesReceived: 8, totalBytes: 8, chunkSize: 4, percentComplete: 100 },
    ]);
  });

  it('omits percentComplete when Content-Length is absent', async () => {
    const progress: StreamProgress[] = [];
    await new StreamHandler().processStream(responseWith(bodyOf([enc.encode('x')])), {
      progressHandler: (p) => progress.push(p),
    });

    expect(progress[0]?.totalBytes).toBeUndefined();
    expect(progress[0]?.percentComplete).toBeUndefined();
  });

  it('splits oversized chunks when maxChunkSize is configured', async () => {
    const payload = enc.encode('x'.repeat(1000));
    const received: number[] = [];

    await new StreamHandler().processStream(responseWith(bodyOf([payload])), {
      onChunk: (chunk) => received.push(chunk.length),
      maxChunkSize: 300,
    });

    expect(received).toEqual([300, 300, 300, 100]);
  });

  it('supports the legacy chunkHandler alias', async () => {
    const received: Uint8Array[] = [];
    const result = await new StreamHandler().processStream(responseWith(bodyOf([enc.encode('ab')])), {
      chunkHandler: (chunk) => received.push(chunk),
    });

    expect(received).toHaveLength(1);
    expect(result.totalBytes).toBe(2);
  });
});

describe('StreamHandler - size threshold', () => {
  it('treats responses above 5MB as large', () => {
    const header = (value: string | null) =>
      ({ headers: { get: (name: string) => (name === 'content-length' ? value : null) } } as unknown as Response);

    expect(isLargeResponse(header(String(5 * MB + 1)))).toBe(true);
    expect(isLargeResponse(header(String(5 * MB)))).toBe(false);
    expect(isLargeResponse(header(String(5 * MB - 1)))).toBe(false);
    expect(isLargeResponse(header(null))).toBe(false);
    expect(isLargeResponse(header(String(2 * MB)), 1 * MB)).toBe(true);
  });
});

describe('StreamHandler - pipe operations', () => {
  it('pipeTo writes every chunk to a writable destination in order', async () => {
    const payload = enc.encode('x'.repeat(1000));
    const chunks = [payload.slice(0, 300), payload.slice(300, 700), payload.slice(700)];
    const collected: Uint8Array[] = [];

    const destination = new WritableStream<Uint8Array>({
      write(chunk) {
        collected.push(chunk.slice());
      },
    });

    const result = await new StreamHandler().pipeTo(bodyOf(chunks), destination, {
      onChunk: () => undefined,
    });

    expect(concat(collected)).toBe(new TextDecoder().decode(payload));
    expect(result.totalBytes).toBe(1000);
    expect(result.chunksProcessed).toBe(3);
  });

  it('pipeTo emits onChunk, onComplete and onError events', async () => {
    const chunks = [enc.encode('one'), enc.encode('two')];
    const chunkSpy = vi.fn();
    const completeSpy = vi.fn();
    const errorSpy = vi.fn();
    const collected: Uint8Array[] = [];

    const destination = new WritableStream<Uint8Array>({
      write(chunk) {
        collected.push(chunk);
      },
    });

    const result = await new StreamHandler().pipeTo(bodyOf(chunks), destination, {
      onChunk: chunkSpy,
      onComplete: completeSpy,
      onError: errorSpy,
    });

    expect(chunkSpy).toHaveBeenCalledTimes(2);
    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(completeSpy.mock.calls[0][0].totalBytes).toBe(6);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(result.totalBytes).toBe(6);
  });

  it('pipeTo propagates destination errors through onError and rejects', async () => {
    const boom = new Error('disk full');
    const errorSeen: Error[] = [];

    const destination = new WritableStream<Uint8Array>({
      write() {
        throw boom;
      },
    });

    await expect(
      new StreamHandler().pipeTo(bodyOf([enc.encode('x')]), destination, {
        onError: (error) => errorSeen.push(error),
      }),
    ).rejects.toThrow('disk full');

    expect(errorSeen[0]?.message).toBe('disk full');
  });

  it('transform maps chunks through a function and emits events', async () => {
    const chunks = [enc.encode('ab'), enc.encode('cd')];
    const chunkSpy = vi.fn();
    const completeSpy = vi.fn();

    const stream = await new StreamHandler().transform(
      bodyOf(chunks),
      (chunk) => enc.encode(new TextDecoder().decode(chunk).toUpperCase()),
      {
        onChunk: chunkSpy,
        onComplete: completeSpy,
      },
    );

    const parts = await collect(stream);
    expect(concat(parts)).toBe('ABCD');
    expect(chunkSpy).toHaveBeenCalledTimes(2);
    expect(completeSpy.mock.calls[0][0].totalBytes).toBe(4);
  });
});

describe('HttpClient - automatic streaming of large responses', () => {
  it('requestStreaming streams responses above 5MB in chunks without buffering the payload', async () => {
    const originalFetch = globalThis.fetch;
    const payload = enc.encode('x'.repeat(6 * MB));
    const chunks = [
      payload.slice(0, 2 * MB),
      payload.slice(2 * MB, 4 * MB),
      payload.slice(4 * MB),
    ];
    const chunkSpy = vi.fn();

    const fetchMock = vi.fn().mockResolvedValue(
      responseWith(bodyOf(chunks), { headers: { 'Content-Length': String(6 * MB) } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const client = new HttpClient('https://api.test');
      const result = await client.requestStreaming('/export/large', {
        method: 'GET',
        streamOptions: { onChunk: chunkSpy },
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(chunkSpy).toHaveBeenCalledTimes(3);
      expect(chunkSpy.mock.calls.every((call) => call[0].length < payload.length)).toBe(true);
      expect(result.totalBytes).toBe(6 * MB);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
