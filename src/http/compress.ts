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
  return { body: compressed.body, headers: requestHeaders };
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
    const compressed = await gzipSync(input);
    return { body: compressed, algorithm };
  }

  if (algorithm === 'brotli') {
    const compressed = await brotliCompressSync(input);
    return { body: compressed, algorithm };
  }

  throw new Error(`Unsupported compression algorithm: ${String(algorithm)}`);
}

export async function decompressResponseBody(
  body: ArrayBuffer | null,
  encoding: string
): Promise<string> {
  if (!body || !encoding) {
    return body ? new TextDecoder().decode(body) : '';
  }

  const algorithm = encoding.toLowerCase().trim();
  const input = new Uint8Array(body);

  if (algorithm === 'gzip') {
    return decodeStream(input, 'gunzip');
  }

  if (algorithm === 'br') {
    return decodeStream(input, 'brotliDecompress');
  }

  return new TextDecoder().decode(input);
}

async function gzipSync(input: Uint8Array): Promise<Uint8Array> {
  const zlib = await import('node:zlib');
  return new Promise<Uint8Array>((resolve, reject) => {
    zlib.gzip(input, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

async function brotliCompressSync(input: Uint8Array): Promise<Uint8Array> {
  const zlib = await import('node:zlib');
  return new Promise<Uint8Array>((resolve, reject) => {
    zlib.brotliCompress(input, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

async function decodeStream(input: Uint8Array, op: 'gunzip' | 'brotliDecompress'): Promise<string> {
  const zlib = await import('node:zlib');
  return new Promise<string>((resolve, reject) => {
    zlib[op](input, (error, result) => {
      if (error) reject(error);
      else resolve(new TextDecoder().decode(result));
    });
  });
}