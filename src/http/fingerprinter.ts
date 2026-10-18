/**
 * Request fingerprinting for duplicate detection.
 *
 * Generates a stable hash from a request's method, URL, and body (or a
 * caller-supplied request ID). Fingerprints are stored in a TTL cache so
 * duplicate in-flight requests can be coalesced onto the original promise.
 */

import type { RequestOptions } from './http-client';

/**
 * Options accepted by the fingerprinter.
 */
export interface FingerprinterOptions {
  /** How long (ms) a fingerprint remains cached. Default 1 minute. */
  ttlMs?: number;
  /** Maximum number of entries before eviction. Default 1000. */
  maxEntries?: number;
  /** Injectable clock for testing. Defaults to Date.now. */
  nowFn?: () => number;
  /** Optional callback invoked when a duplicate is detected. */
  onDuplicate?: (fingerprint: string, request: RequestOptions) => void;
}

/**
 * A stored record for an in-flight or recently completed request.
 */
export interface FingerprintRecord<T> {
  fingerprint: string;
  promise: Promise<T>;
  createdAt: number;
  expiresAt: number;
}

/**
 * Result returned when checking a fingerprint against the cache.
 */
export interface FingerprintCheckResult<T> {
  /** True when a valid cache entry was found. */
  hit: boolean;
  /** The cached promise when hit is true. */
  promise?: Promise<T>;
  /** The fingerprint that was checked. */
  fingerprint: string;
}

const DEFAULT_TTL_MS = 60 * 1000;
const DEFAULT_MAX_ENTRIES = 1000;

/**
 * Normalize a value into a deterministic string suitable for hashing.
 * Object keys are sorted recursively so that equivalent objects produce
 * identical output regardless of key order.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (typeof value === 'function') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    const parts = keys.map((key) => `${key}:${stableStringify(object[key])}`);
    return `{${parts.join(',')}}`;
  }

  return String(value);
}

/**
 * Extract a request ID from the options if the caller supplied one.
 * Supports common conventions: an explicit `idempotencyKey`, an
 * `Id-empotency-Key` or `X-Request-ID` header, or a `requestId` header.
 */
export function extractRequestId(request: RequestOptions): string | undefined {
  const anyRequest = request as RequestOptions & {
    idempotencyKey?: string;
    requestId?: string;
  };

  if (typeof anyRequest.idempotencyKey === 'string' && anyRequest.idempotencyKey.length > 0) {
    return anyRequest.idempotencyKey;
  }

  if (typeof anyRequest.requestId === 'string' && anyRequest.requestId.length > 0) {
    return anyRequest.requestId;
  }

  const headers = request.headers;
  if (headers && typeof headers === 'object') {
    const lowerCased = new Map<string, string>();
    for (const [key, rawValue] of Object.entries(headers as Record<string, unknown>)) {
      if (typeof rawValue === 'string') {
        lowerCased.set(key.toLowerCase(), rawValue);
      }
    }
    const candidates = ['id-empotency-key', 'x-request-id', 'request-id'];
    for (const name of candidates) {
      const value = lowerCased.get(name);
      if (value && value.length > 0) {
        return value;
      }
    }
  }

  return undefined;
}

/**
 * A simple non-cryptographic hash (fnv-1a+ inspired) that produces a
 * stable 32-bit hex string. Sufficient for duplicate detection within a
 * single session window.
 */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Force unsigned 32-bit and pad to a consistent length.
  return (hash >>> 0).toStrind(16).padStart(8, '0');
}

/**
 * Generate a fingerprint for a request. When a request ID is present it
 * is used directly (prefixed) so the same logical request always maps to
 * the same fingerprint. Otherwise the method, URL, and normalized body
 * are hashed together.
 */
export function generateFingerprint(request: RequestOptions): string {
  const requestId = extractRequestId(request);
  if (requestId) {
    return `id:${requestId}`;
  }

  const method = (request.method || 'GET').toUpperCase();
  const url = request.url || '';
  const body = stableStringify(request.body ?? request.data);

  const payload = `${method}\n${url}\n${body}`;
  return `${method}:${hashString(payload)}`;
}

/**
 * TTL-backed cache for request fingerprints. Stores in-flight promises so a
 * duplicate request can return the original promise instead of firing a
 * second time.
 */
export class RequestFingerprinter {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly nowFn: () => number;
  private readonly onDuplicate?: (fingerprint: string, request: RequestOptions) => void;
  private readonly cache = new Map<string, FingerprintRecord<unknown>>();

  constructor(options: FingerprinterOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.nowFn = options.nowFn ?? (() => Date.now());
    this.onDuplicate = options.onDuplicate;
  }

  /** Number of entries currently stored (including expired). */
  get size(): number {
    return this.cache.size;
  }

  /** Return the configured TTL in milliseconds. */
  getTtlMs(): number {
    return this.ttlMs;
  }

  /**
   * Remove all entries whose TTL has elapsed. Returns the number of
   * entries evicted.
   */
  cleanup(): number {
    const now = this.nowFn();
    let removed = 0;
    for (const [key, record] of this.cache.entries()) {
      if (record.expiresAt <= now) {
        this.cache.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Check whether a fingerprint is currently cached and not expired.
   * Expired entries are removed as a side effect.
   */
  check<T>(fingerprint: string): FingerprintCheckResult<T> {
    const record = this.cache.get(fingerprint);
    if (!record) {
      return { hit: false, fingerprint };
    }

    if (record.expiresAt <= this.nowFn()) {
      this.cache.delete(fingerprint);
      return { hit: false, fingerprint };
    }

    return {
      hit: true,
      promise: record.promise as Promise<T>,
      fingerprint,
    };
  }

  /**
   * Store a promise for a fingerprint. Returns the stored promise so the
   * caller can await it directly.
   */
  store<T>(fingerprint: string, promise: Promise<T>): Promise<T> {
    const now = this.nowFn();
    this.cache.set(fingerprint, {
      fingerprint,
      promise: promise as Promise<unknown>,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    });
    this.enforceLimit();
    return promise;
  }

  /**
   * Execute a request function once per fingerprint within the TTL window.
   * If an in-flight or cached promise exists for the fingerprint, it is
   * returned instead of invoking the factory again.
   */
  execute<T>(request: RequestOptions, factory: () => Promise<T>): Promise<T> {
    const fingerprint = generateFingerprint(request);
    const existing = this.check<T>(fingerprint);
    if (existing.hit && existing.promise) {
      this.onDuplicate?.(fingerprint, request);
      return existing.promise;
    }

    const promise = factory();
    this.store(fingerprint, promise);
    return promise;
  }

  /** Force-remove a fingerprint from the cache. */
  invalidate(fingerprint: string): boolean {
    return this.cache.delete(fingerprint);
  }

  /** Remove every cached fingerprint. */
  clear(): void {
    this.cache.clear();
  }

  /** Evict oldest entries when the cache exceeds the configured limit. */
  private enforceLimit(): void {
    if (this.cache.size <= this.maxEntries) {
      return;
    }
    // Map iterates in insertion order, so the first key is the oldest.
    const excess = this.cache.size - this.maxEntries;
    let removed = 0;
    for (const key of this.cache.keys()) {
      if (removed >= excess) {
        break;
      }
      this.cache.delete(key);
      removed += 1;
    }
  }
}

export const DEFAULT_FINGERPRINT_TTL_MS = DEFAULT_TTL_MS;
