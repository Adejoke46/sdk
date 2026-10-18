/**
 * Serializer Interface
 *
 * Pluggable serialization/deserialization for HTTP request/response bodies.
 * Ships with a built-in JSON serializer; users can provide custom implementations.
 */

export interface Serializer {
  /** Serialize a value to a string for transmission. */
  serialize(value: unknown): string;
  /** Deserialize a string received from the network. */
  deserialize<T = unknown>(text: string): T;
  /** The MIME type produced by this serializer. */
  readonly contentType: string;
}

/**
 * Built-in JSON serializer (default).
 */
export class JsonSerializer implements Serializer {
  readonly contentType = 'application/json';

  serialize(value: unknown): string {
    return JSON.stringify(value);
  }

  deserialize<T = unknown>(text: string): T {
    return JSON.parse(text) as T;
  }
}
