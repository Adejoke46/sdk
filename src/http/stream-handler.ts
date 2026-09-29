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
  chunkHandler: StreamChunkHandler;
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
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      let totalBytes = 0;

      // Extract total bytes from content-length header if available
      const contentLength = response.headers.get('content-length');
      const totalExpectedBytes = contentLength ? parseInt(contentLength, 10) : undefined;

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        if (!value) continue;

        totalBytes += value.length;
        this.totalBytes += value.length;
        this.chunksProcessed++;

        // Decode and buffer the chunk
        buffer += decoder.decode(value, { stream: true });

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

        // Call chunk handler for processing
        await options.chunkHandler(value);
      }

      // Flush remaining buffer
      if (buffer) {
        const remaining = new TextEncoder().encode(buffer);
        await options.chunkHandler(remaining);
      }

      return {
        totalBytes: this.totalBytes,
        chunksProcessed: this.chunksProcessed,
        duration: Date.now() - this.startTime,
      };
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
 * Utility to detect if response is large based on content-length
 */
export function isLargeResponse(response: Response, threshold = 1024 * 1024): boolean {
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
