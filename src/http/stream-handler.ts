/**
 * Stream Handler
 *
 * Handles streaming responses for large data transfers.
 * Processes chunked data, manages progress tracking, and handles stream errors.
 */

export type StreamChunkHandler = (chunk: Uint8Array) => Promise<void> | void;
export type StreamProgressHandler = (progress: StreamProgress) => void;

export interface StreamProgress {
  bytesReceived: number;
  totalBytes?: number;
  percentComplete?: number;
  chunkSize: number;
}

export interface StreamOptions {
  /** Invoked for every chunk received from the response body. */
  onChunk?: StreamChunkHandler;
  /** Legacy alias for `onChunk`. */
  chunkHandler?: StreamChunkHandler;
  /** Invoked when streaming completes with the final result. */
  onComplete?: (result: StreamResult) => void;
  progressHandler?: StreamProgressHandler;
  onError?: (error: Error) => void;
  maxChunkSize?: number;
}

export interface StreamResult {
  totalBytes: number;
  chunksProcessed: number;
  duration: number;
}

/**
 * StreamHandler processes large responses in chunks to reduce memory usage.
 */
export class StreamHandler {
  private totalBytes = 0;
  private chunksProcessed = 0;
  private startTime = 0;

  /**
   * Process a streaming response body
   */
  async processStream(
    response: Response,
    options: StreamOptions,
  ): Promise<StreamResult> {
    if (!response.body) {
      throw new Error('Response body is null or not readable');
    }

    this.startTime = Date.now();
    const reader = response.body.getReader();

    try {
      let totalBytes = 0;

      // Extract total bytes from content-length header if available
      const contentLength = response.headers.get('content-length');
      const totalExpectedBytes = contentLength ? parseInt(contentLength, 10) : undefined;

      const chunkHandler = options.onChunk ?? options.chunkHandler;

      // Standard read-until-done loop; `for (;;)` is the lint-friendly form.
      for (;;) {
        const { done, value } = await reader.read();

        if (done) break;

        if (!value) continue;

        totalBytes += value.length;
        this.totalBytes += value.length;
        this.chunksProcessed++;

        // Process progress callback
        if (options.progressHandler) {
          const progress: StreamProgress = {
            bytesReceived: totalBytes,
            totalBytes: totalExpectedBytes,
            chunkSize: value.length,
            percentComplete: totalExpectedBytes
              ? (totalBytes / totalExpectedBytes) * 100
              : undefined,
          };
          options.progressHandler(progress);
        }

        // Call chunk handler for processing, splitting oversized chunks when
        // a max chunk size is configured.
        if (chunkHandler) {
          const chunks = options.maxChunkSize && value.length > options.maxChunkSize
            ? this.splitChunk(value, options.maxChunkSize)
            : [value];
          for (const piece of chunks) {
            await chunkHandler(piece);
          }
        }
      }

      const result: StreamResult = {
        totalBytes: this.totalBytes,
        chunksProcessed: this.chunksProcessed,
        duration: Date.now() - this.startTime,
      };

      options.onComplete?.(result);

      return result;
    } catch (error) {
      if (options.onError) {
        options.onError(error instanceof Error ? error : new Error(String(error)));
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Split a chunk into smaller pieces of at most `size` bytes each.
   */
  private splitChunk(chunk: Uint8Array, size: number): Uint8Array[] {
    const pieces: Uint8Array[] = [];
    for (let i = 0; i < chunk.length; i += size) {
      pieces.push(chunk.slice(i, i + size));
    }
    return pieces;
  }

  /**
   * Process a streaming request body with chunks
   */
  async* streamChunks(
    data: AsyncIterable<Uint8Array>,
    maxChunkSize?: number,
  ): AsyncGenerator<Uint8Array> {
    const size = maxChunkSize || 64 * 1024; // 64KB default chunk size

    for await (const chunk of data) {
      if (chunk.length <= size) {
        yield chunk;
      } else {
        // Split large chunks
        for (let i = 0; i < chunk.length; i += size) {
          yield chunk.slice(i, i + size);
        }
      }
    }
  }

  /**
   * Create a readable stream from data
   */
  createReadableStream(data: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
    return new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of data) {
            controller.enqueue(chunk);
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
  }

  /**
   * Pipe every chunk of a readable stream to a writable destination (e.g. a
   * file-system stream) while emitting stream events.
   */
  async pipeTo(
    source: ReadableStream<Uint8Array>,
    destination: WritableStream<Uint8Array>,
    options: PipeOptions = {},
  ): Promise<StreamResult> {
    const reader = source.getReader();
    const writer = destination.getWriter();

    this.startTime = Date.now();

    try {
      for (;;) {
        const { done, value } = await reader.read();

        if (done) break;

        if (!value) continue;

        this.totalBytes += value.length;
        this.chunksProcessed++;

        await writer.write(value);

        if (options.onChunk) {
          await options.onChunk(value);
        }

        if (options.progressHandler) {
          const progress: StreamProgress = {
            bytesReceived: this.totalBytes,
            chunkSize: value.length,
          };
          options.progressHandler(progress);
        }
      }

      await writer.close();

      const result: StreamResult = {
        totalBytes: this.totalBytes,
        chunksProcessed: this.chunksProcessed,
        duration: Date.now() - this.startTime,
      };

      options.onComplete?.(result);

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      options.onError?.(err);
      try {
        await writer.abort(err);
      } catch {
        // destination already closed or errored
      }
      throw err;
    } finally {
      reader.releaseLock();
      try {
        writer.releaseLock();
      } catch {
        // already released
      }
    }
  }

  /**
   * Transform each chunk of a readable stream with a mapper function and
   * expose the result as a new readable stream.
   */
  async transform(
    source: ReadableStream<Uint8Array>,
    mapChunk: (chunk: Uint8Array) => Uint8Array | Promise<Uint8Array>,
    options: TransformOptions = {},
  ): Promise<ReadableStream<Uint8Array>> {
    return this.createReadableStream(
      (async function* () {
        const reader = source.getReader();
        let totalBytes = 0;
        let chunksProcessed = 0;
        const startTime = Date.now();

        try {
          for (;;) {
            const { done, value } = await reader.read();

            if (done) break;

            if (!value) continue;

            totalBytes += value.length;
            chunksProcessed++;

            const mapped = await mapChunk(value);

            if (options.onChunk) {
              await options.onChunk(mapped);
            }

            if (options.progressHandler) {
              options.progressHandler({
                bytesReceived: totalBytes,
                chunkSize: value.length,
              });
            }

            yield mapped;
          }

          options.onComplete?.({
            totalBytes,
            chunksProcessed,
            duration: Date.now() - startTime,
          });
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          options.onError?.(err);
          throw err;
        } finally {
          reader.releaseLock();
        }
      })(),
    );
  }

  /**
   * Get summary of stream processing
   */
  getSummary(): Omit<StreamResult, 'totalBytes'> & { totalBytesProcessed: number } {
    return {
      totalBytesProcessed: this.totalBytes,
      chunksProcessed: this.chunksProcessed,
      duration: Date.now() - this.startTime,
    };
  }

  /**
   * Reset stream handler state
   */
  reset(): void {
    this.totalBytes = 0;
    this.chunksProcessed = 0;
    this.startTime = 0;
  }
}

/**
 * Options for {@link StreamHandler.pipeTo}.
 */
export interface PipeOptions {
  /** Invoked for every chunk written to the destination. */
  onChunk?: StreamChunkHandler;
  /** Invoked when the pipe completes with the final result. */
  onComplete?: (result: StreamResult) => void;
  /** Invoked with progress updates after each chunk is written. */
  progressHandler?: StreamProgressHandler;
  /** Invoked when a pipe error occurs; the error is still rethrown. */
  onError?: (error: Error) => void;
}

/**
 * Options for {@link StreamHandler.transform}.
 */
export interface TransformOptions {
  /** Invoked for every transformed chunk emitted by the stream. */
  onChunk?: StreamChunkHandler;
  /** Invoked when the transformation completes with the final result. */
  onComplete?: (result: StreamResult) => void;
  /** Invoked with progress updates after each chunk is transformed. */
  progressHandler?: StreamProgressHandler;
  /** Invoked when a transform error occurs; the error is still rethrown. */
  onError?: (error: Error) => void;
}

/**
 * Utility to detect if response is large based on content-length.
 * Default threshold: 5MB.
 */
export function isLargeResponse(response: Response, threshold = 5 * 1024 * 1024): boolean {
  const contentLength = response.headers.get('content-length');
  if (!contentLength) return false;
  return parseInt(contentLength, 10) > threshold;
}

/**
 * Create a simple stream handler for text responses
 */
export async function streamTextResponse(
  response: Response,
  onChunk: (text: string) => Promise<void>,
  onProgress?: StreamProgressHandler,
): Promise<string> {
  const handler = new StreamHandler();
  const chunks: string[] = [];
  const decoder = new TextDecoder();

  await handler.processStream(response, {
    chunkHandler: async (chunk) => {
      const text = decoder.decode(chunk);
      chunks.push(text);
      await onChunk(text);
    },
    progressHandler: onProgress,
  });

  return chunks.join('');
}
