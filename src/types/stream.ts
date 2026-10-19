/**
 * Stream Types (Issue #120)
 *
 * Public types for incremental (streamed) consumption of large API
 * responses such as transaction-history and analytics exports.
 *
 * Memory characteristics: chunks are delivered to the consumer as they
 * arrive over the wire and are never accumulated by the SDK, so memory
 * usage stays constant (O(chunkSize)) regardless of export size, as long
 * as the consumer does not retain the chunks it receives.
 */

/**
 * Progress information reported while a streamed response is downloading.
 */
export interface StreamProgress {
  /** Number of bytes received so far. */
  bytesReceived: number;
  /** Total bytes when the server sent a `Content-Length` header. */
  totalBytes?: number;
  /** 0–100 completion estimate, only when `totalBytes` is known. */
  percentComplete?: number;
  /** Size of the most recently delivered chunk in bytes. */
  chunkSize: number;
}

/**
 * A chunk of a streamed response body.
 *
 * `text` carries the decoded UTF-8 text (with multi-byte characters that
 * straddle chunk boundaries stitched back together); `bytes` carries the
 * raw payload. Exactly one is always present.
 */
export interface StreamChunk {
  /** Decoded text of the chunk (streaming decoder, boundary-safe). */
  text?: string;
  /** Raw bytes of the chunk. */
  bytes?: Uint8Array;
}

/**
 * Options controlling a streamed request.
 */
export interface StreamRequestOptions {
  /** Extra HTTP headers for the streaming request. */
  headers?: Record<string, string>;
  /** Abort signal propagated to the underlying fetch and the returned stream. */
  signal?: AbortSignal;
  /** Request timeout in ms (default: the HttpClient timeout). */
  timeout?: number;
  /**
   * Called with progress updates after each chunk arrives. Executed inline
   * on the read path — keep it cheap, it throttles the consumer.
   */
  onProgress?: (progress: StreamProgress) => void;
  /**
   * High-water mark for the returned `ReadableStream`'s internal queue.
   * The SDK enqueues each chunk and awaits `pull`-driven backpressure, so
   * a slow consumer naturally pauses the network read loop.
   * Default: 4.
   */
  highWaterMark?: number;
  /** Logical request id for correlation / logs (generated when omitted). */
  requestId?: string;
}

/**
 * Metadata about a completed (or aborted) stream.
 */
export interface StreamStats {
  /** Total bytes that flowed through the stream. */
  totalBytes: number;
  /** Number of chunks delivered. */
  chunks: number;
  /** Wall-clock duration of the transfer in ms. */
  durationMs: number;
}
