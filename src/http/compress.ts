export type CompressionAlgorithm = 'gzip' | 'brotli';

export interface RequestCompressionConfig {
  /** Enable request compression. Defaults to true. */
  enabled?: boolean;
  /** Minimum serialized request size in bytes (default 1024). */
  threshold?: number;
  /** Compression format (default 'gzip'). */
  algorithm?: CompressionAlgorithm;
}

export interface CompressedRequestBody {
  body: Uint8Array;
  algorithm: CompressionAlgorithm;
}

export interface PreparedRequestBody {
  body: BodyInit;
  headers: Record<string, string>;
}

export async function prepareRequestBody(
  body: string,
  headers: Record<string, string>,
  config?: RequestCompressionConfig
): Promise<PreparedRequestBody> {
  if (Object.keys(headers).some((name) => name.toLowerCase() === 'content-encoding')) {
    return { body, headers };
  }

  const compressed = await compressRequestBody(body, config);
  if (!compressed) return { body, headers };

  const requestHeaders = Object.fromEntries(
    Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'content-length')
  );
  requestHeaders['Content-Encoding'] = compressed.algorithm;
  const compressedBuffer = new Uint8Array(compressed.body).buffer;
  return { body: new Blob([compressedBuffer]), headers: requestHeaders };
}

export async function compressRequestBody(
  body: string,
  config?: RequestCompressionConfig
): Promise<CompressedRequestBody | undefined> {
  if (config?.enabled === false) return undefined;

  const threshold = config?.threshold ?? 1024;
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error('Compression threshold must be a non-negative number');
  }

  const algorithm = config?.algorithm ?? 'gzip';
  const input = new TextEncoder().encode(body);
  if (input.byteLength <= threshold) return undefined;

  if (algorithm === 'gzip') {
    if (typeof CompressionStream === 'undefined') {
      throw new Error('Gzip compression is not supported in this runtime');
    }

    const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'));
    return {
      body: new Uint8Array(await new Response(stream).arrayBuffer()),
      algorithm,
    };
  }

  if (algorithm === 'brotli') {
    const zlib = await import('node:zlib');
    const compressed = await new Promise<Uint8Array>((resolve, reject) => {
      zlib.brotliCompress(input, (error, result) => {
        if (error) reject(error);
        else resolve(result);
      });
    });
    return { body: compressed, algorithm };
  }

  throw new Error(`Unsupported compression algorithm: ${String(algorithm)}`);
}