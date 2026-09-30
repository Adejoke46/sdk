export type CacheStrategy = 'lru' | 'fifo' | 'lfu';

export interface CacheOptions {
  /** Enable response caching. Disabled by default. */
  enabled?: boolean;
  /** Default time-to-live in milliseconds. Defaults to five minutes. */
  ttl?: number;
  /** Eviction strategy used when the cache reaches maxSize. Defaults to LRU. */
  strategy?: CacheStrategy;
  /** Maximum number of cached responses. Defaults to 100. */
  maxSize?: number;
  /** TTL overrides keyed by SDK method name or HTTP method. */
  ttlByMethod?: Record<string, number>;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
}