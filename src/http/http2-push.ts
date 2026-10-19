/**
 * HTTP/2 Server Push Support
 *
 * Detects HTTP/2 availability, registers push handlers,
 * caches pushed resources locally, and consumes them on
 * subsequent requests. HTTP/2 is only used when available;
 * it is never enforced.
 */

export interface Http2PushConfig {
  /** Enable HTTP/2 push support. Defaults to true when HTTP/2 is available. */
  enabled?: boolean;
  /** Maximum number of pushed resources to cache. Defaults to 50. */
  maxPushedResources?: number;
  /** TTL for cached pushed resources in milliseconds. Defaults to five minutes. */
  ttl?: number;
}

export interface PushedResourceEntry {
  /** The URL of the pushed resource. */
  readonly url: string;
  /** HTTP method used for the pushed resource. */
  readonly method: string;
  /** Response headers. */
  readonly headers: Record<string, string>;
  /** Cached response data. */
  readonly data: unknown;
  /** Timestamp when the resource was cached. */
  readonly cachedAt: number;
  /** TTL in milliseconds. */
  readonly ttl: number;
}

type PushHandler = (entry: PushedResourceEntry) => void;

function isNodeJs(): boolean {
  return typeof globalThis.process !== 'undefined' && !!globalThis.process.versions?.node;
}

function detectHttp2Available(): boolean {
  if (isNodeJs()) {
    return true;
  }
  if (typeof globalThis.fetch === 'function' && typeof globalThis.Request === 'function') {
    return true;
  }
  return false;
}

export class Http2PushManager {
  private readonly enabled: boolean;
  private readonly maxPushedResources: number;
  private readonly ttl: number;
  private readonly http2Available: boolean;
  private readonly pushCache = new Map<string, PushedResourceEntry>();
  private readonly handlers = new Set<PushHandler>();

  constructor(config: Http2PushConfig = {}) {
    this.enabled = config.enabled ?? true;
    this.maxPushedResources = config.maxPushedResources ?? 50;
    this.ttl = config.ttl ?? 5 * 60 * 1000;
    this.http2Available = detectHttp2Available();
  }

  /** Whether HTTP/2 push is enabled and available in this environment. */
  isEnabled(): boolean {
    return this.enabled && this.http2Available;
  }

  /** Whether HTTP/2 is detected as available in this environment. */
  isHttp2Available(): boolean {
    return this.http2Available;
  }

  /**
   * Register a handler invoked whenever a pushed resource is cached.
   */
  registerPushHandler(handler: PushHandler): void {
    this.handlers.add(handler);
  }

  /** Remove a previously registered push handler. */
  unregisterPushHandler(handler: PushHandler): void {
    this.handlers.delete(handler);
  }

  /**
   * Cache a pushed resource. Called when a server push is received
   * (e.g., from Node.js http2 client push events).
   */
  cachePushedResource(
    url: string,
    data: unknown,
    headers: Record<string, string> = {},
    method: string = 'GET'
  ): void {
    if (!this.enabled) {
      return;
    }
    this.evictIfNeeded();
    const entry: PushedResourceEntry = {
      url,
      method,
      headers,
      data,
      cachedAt: Date.now(),
      ttl: this.ttl,
    };
    this.pushCache.set(url, entry);
    for (const handler of this.handlers) {
      handler(entry);
    }
  }

  /** Retrieve a cached pushed resource without removing it. */
  getPushedResource(url: string): PushedResourceEntry | undefined {
    const entry = this.pushCache.get(url);
    if (!entry) {
      return undefined;
    }
    if (Date.now() - entry.cachedAt > entry.ttl) {
      this.pushCache.delete(url);
      return undefined;
    }
    return entry;
  }

  /**
   * Consume a cached pushed resource. Returns the cached data or undefined
   * if no pushed resource exists for the URL (or it has expired).
   */
  consumePushedResource(url: string): unknown | undefined {
    const entry = this.getPushedResource(url);
    return entry?.data;
  }

  /** Check whether a pushed resource is cached for the given URL. */
  hasPushedResource(url: string): boolean {
    return this.getPushedResource(url) !== undefined;
  }

  /**
   * Register push handlers on a Node.js http2 client request stream.
   * Pushed responses received via the stream's 'push' event are cached.
   */
  registerNodeHttp2PushHandler(stream: unknown): void {
    if (!isNodeJs() || typeof (stream as { on?: unknown }).on !== 'function') {
      return;
    }
    const clientStream = stream as { on: (event: string, listener: (...args: unknown[]) => void) => void };
    clientStream.on('push', (pushStream: unknown, responseHeaders: Record<string, string>) => {
      const path = responseHeaders[':path'] ?? responseHeaders[':Path'] ?? '';
      const url = path ? this.resolveUrl(path) : '';
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(responseHeaders)) {
        if (!key.startsWith(':')) {
          headers[key] = value;
        }
      }
      const chunks: unknown[] = [];
      const ps = pushStream as {
        on: (event: string, listener: (...args: unknown[]) => void) => void;
      };
      ps.on('data', (chunk: unknown) => {
        chunks.push(chunk);
      });
      ps.on('end', () => {
        let data: unknown;
        if (chunks.length === 0) {
          data = undefined;
        } else if (chunks.length === 1 && typeof chunks[0] === 'string') {
          data = this.tryParseJson(chunks[0] as string);
        } else if (chunks.every((c) => typeof c === 'string')) {
          data = this.tryParseJson(chunks.join('') as string);
        } else {
          data = chunks;
        }
        if (url) {
          this.cachePushedResource(url, data, headers, 'GET');
        }
      });
    });
  }

  /**
   * Create a Node.js HTTP/2 client whose request streams automatically
   * register push handlers. Resolves to null outside Node.js or if
   * the http2 module cannot be loaded.
   */
  async createHttp2PushClient(origin: string): Promise<Http2PushClient | null> {
    if (!isNodeJs()) {
      return null;
    }
    let http2: typeof import('http2');
    try {
      http2 = (await Function('return import("http2")')()) as typeof import('http2');
    } catch {
      return null;
    }
    const client = http2.connect(origin);
    return {
      request: (headers: Record<string, string>) => {
        const stream = client.request(headers);
        this.registerNodeHttp2PushHandler(stream);
        return stream;
      },
      close: () => {
        client.close();
      },
      destroy: () => {
        client.destroy();
      },
    };
  }

  /** Clear all cached pushed resources. */
  clear(): void {
    this.pushCache.clear();
  }

  /** Get cache statistics. */
  getStats(): {
    size: number;
    maxSize: number;
    urls: string[];
    http2Available: boolean;
    enabled: boolean;
  } {
    return {
      size: this.pushCache.size,
      maxSize: this.maxPushedResources,
      urls: [...this.pushCache.keys()],
      http2Available: this.http2Available,
      enabled: this.enabled,
    };
  }

  private evictIfNeeded(): void {
    if (this.pushCache.size >= this.maxPushedResources) {
      const firstKey = this.pushCache.keys().next().value;
      if (firstKey !== undefined) {
        this.pushCache.delete(firstKey);
      }
    }
  }

  private resolveUrl(path: string): string {
    if (isNodeJs()) {
      try {
        // Best effort: return path as-is if we can't resolve origin
        return path;
      } catch {
        return path;
      }
    }
    return path;
  }

  private tryParseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
}

export interface Http2PushClient {
  request: (headers: Record<string, string>) => unknown;
  close: () => void;
  destroy: () => void;
}
