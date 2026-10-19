/**
 * Cache-Control
 *
 * Parses the `Cache-Control` response header and derives cache directives
 * (max-age, public, private, no-store, no-cache, ...) used by the HTTP
 * client to decide whether and for how long a response may be stored.
 *
 * Directive parsing follows RFC 9111 section 5.2: names are compared
 * case-insensitively, whitespace around directives and `=` is ignored, and
 * unknown directives are silently skipped.
 */

export interface CacheControl {
  /** `max-age=<delta-seconds>` freshness lifetime in seconds. */
  maxAge?: number;
  /** `s-maxage=<delta-seconds>` shared-cache freshness lifetime in seconds. */
  sMaxAge?: number;
  /** `public` - response may be cached by any cache. */
  public?: boolean;
  /** `private` - response intended for a single user; cacheable by a client cache. */
  private?: boolean;
  /** `no-cache` - must not be served from cache without revalidation. */
  noCache?: boolean;
  /** `no-store` - must not be stored in any cache. */
  noStore?: boolean;
  /** `must-revalidate` - stale entries must not be served without revalidation. */
  mustRevalidate?: boolean;
  /** `proxy-revalidate` - shared caches must revalidate stale entries. */
  proxyRevalidate?: boolean;
  /** `stale-while-revalidate=<seconds>` */
  staleWhileRevalidate?: number;
  /** `stale-if-error=<seconds>` */
  staleIfError?: number;
}

/** Cacheability directive derived from a parsed Cache-Control header. */
export type Cacheability = 'cacheable' | 'no-cache' | 'no-store';

function parseDirectiveValue(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Parse a `Cache-Control` header string into a normalized directive map.
 *
 * @param header - Raw `Cache-Control` header value (e.g. `public, max-age=3600`).
 * @returns Normalized directives; unknown or malformed directives are ignored.
 */
export function parseCacheControl(header: string): CacheControl {
  const result: CacheControl = {};
  if (!header) return result;

  for (const raw of header.split(',')) {
    const directive = raw.trim();
    if (!directive) continue;

    const eqIndex = directive.indexOf('=');
    const name = eqIndex === -1 ? directive.toLowerCase() : directive.slice(0, eqIndex).trim().toLowerCase();
    const value = eqIndex === -1 ? undefined : directive.slice(eqIndex + 1).trim();

    switch (name) {
      case 'max-age': {
        const parsed = parseDirectiveValue(value);
        if (parsed !== undefined) result.maxAge = parsed;
        break;
      }
      case 's-maxage': {
        const parsed = parseDirectiveValue(value);
        if (parsed !== undefined) result.sMaxAge = parsed;
        break;
      }
      case 'public':
        result.public = true;
        break;
      case 'private':
        result.private = true;
        break;
      case 'no-cache':
        result.noCache = true;
        break;
      case 'no-store':
        result.noStore = true;
        break;
      case 'must-revalidate':
        result.mustRevalidate = true;
        break;
      case 'proxy-revalidate':
        result.proxyRevalidate = true;
        break;
      case 'stale-while-revalidate': {
        const parsed = parseDirectiveValue(value);
        if (parsed !== undefined) result.staleWhileRevalidate = parsed;
        break;
      }
      case 'stale-if-error': {
        const parsed = parseDirectiveValue(value);
        if (parsed !== undefined) result.staleIfError = parsed;
        break;
      }
      default:
        // Unknown directive: ignore.
        break;
    }
  }

  return result;
}

/**
 * Determine whether a response may be stored based on its Cache-Control
 * directives. `no-store` always wins; `no-cache` means do not serve from cache
 * without revalidation (treated as not cacheable by this client).
 */
export function cacheability(cc: CacheControl): Cacheability {
  if (cc.noStore) return 'no-store';
  if (cc.noCache) return 'no-cache';
  return 'cacheable';
}

/**
 * Derive a cache TTL in milliseconds from a parsed Cache-Control header.
 *
 * Returns:
 * - `0` when the response must not be stored (`no-store` / `no-cache`).
 * - `maxAge * 1000` when a `max-age` freshness lifetime is present.
 * - `null` when there is no explicit freshness information (the caller's
 *   configured default TTL applies instead).
 */
export function ttlFromCacheControl(cc: CacheControl): number | null {
  if (cc.noStore || cc.noCache) return 0;
  if (cc.maxAge !== undefined) return Math.max(0, cc.maxAge * 1000);
  return null;
}
