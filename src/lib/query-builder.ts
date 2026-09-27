/**
 * Query & Pagination Utilities
 *
 * Build clean queries with filtering, sorting, and pagination.
 */

import type { Creator, Tip } from '../types';

export interface QueryOptions {
  limit?: number;
  /** Offset-based position. Ignored by cursor-only backends. */
  offset?: number;
  /** Opaque cursor from a previous page's `nextCursor` / `prevCursor`. */
  cursor?: string;
  sort?: 'asc' | 'desc';
  filters?: Record<string, any>;
  /** Fetch the next page in the background so the following call resolves instantly. */
  prefetch?: boolean;
}

/** Minimal shape of the client the list helpers need (DorisioClient satisfies it). */
export interface ListClient {
  request(...args: any[]): Promise<any>;
}

/** Fetches one page. `listTips(client, opts)` and friends fit this shape. */
export type PageFetcher<T> = (options: QueryOptions) => Promise<PaginationResult<T>>;

/** Infer the item type of a Paginator, PaginationResult or (a Promise of) either. */
export type PageItem<P> =
  P extends Promise<infer U>
    ? PageItem<U>
    : P extends Paginator<infer T>
      ? T
      : P extends PaginationResult<infer T>
        ? T
        : never;

export interface PaginationResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  nextCursor?: string;
  prevCursor?: string;
}

/**
 * Build query string from options
 */
export function buildQueryString(options: QueryOptions = {}): string {
  const params = new URLSearchParams();

  if (options.limit) params.append('limit', String(options.limit));
  if (options.offset) params.append('offset', String(options.offset));
  if (options.cursor) params.append('cursor', options.cursor);
  if (options.sort) params.append('sort', options.sort);

  if (options.filters) {
    for (const [key, value] of Object.entries(options.filters)) {
      if (value !== null && value !== undefined) {
        params.append(`filter[${key}]`, String(value));
      }
    }
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

interface PaginatedApiData {
  page?: number;
  pageSize?: number;
  limit?: number;
  total?: number;
}

/**
 * Parse pagination metadata from response.
 */
export function parsePaginationMeta(response: PaginatedApiData): {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
} {
  const page = response.page ?? 1;
  const pageSize = response.pageSize ?? response.limit ?? 20;
  const total = response.total ?? 0;
  return { page, pageSize, total, hasMore: page * pageSize < total };
}

/**
 * List tips with filtering and pagination
 */
export async function listTips(
  client: QueryClient,
  options: QueryOptions = {}
): Promise<PaginationResult<Transaction>> {
  const query = buildQueryString(options);
  const response = await client.request<{
    transactions?: Transaction[];
    page?: number;
    pageSize?: number;
    total?: number;
  }>('GET', `/api/v1/transactions/history${query}`);

/** Decode a cursor created by {@link encodeCursor}. Returns null for server-defined cursors. */
export function decodeCursor(cursor: string): { offset: number } | null {
  try {
    const parsed = JSON.parse(atob(cursor));
    return Number.isInteger(parsed?.offset) && parsed.offset >= 0
      ? { offset: parsed.offset }
      : null;
  } catch {
    return null;
  }
}

  const data = response.data ?? {};
  const { page, pageSize, total, hasMore } = parsePaginationMeta(data);
  const offset = options.offset ?? 0;

  return {
    items: data.transactions ?? [],
    total,
    page,
    pageSize,
    hasMore,
    nextCursor: hasMore ? (data.nextCursor ?? encodeCursor(start + items.length)) : undefined,
    prevCursor:
      data.prevCursor ?? (start > 0 ? encodeCursor(Math.max(0, start - pageSize)) : undefined),
  };
}

// Prefetched pages, per client. A page is consumed once so cached data is never stale.
const prefetchCache = new WeakMap<object, Map<string, Promise<PaginationResult<any> | null>>>();

async function fetchPage<T>(
  client: ListClient,
  basePath: string,
  itemsKey: string,
  errorMessage: string,
  rawOptions: QueryOptions
): Promise<PaginationResult<T>> {
  const options = resolveOptions(rawOptions);
  const path = `${basePath}${buildQueryString(options)}`;

  const load = async (): Promise<PaginationResult<T>> => {
    const response = await client.request('GET', path);
    if (!response.success) {
      throw new Error(response.error?.message || errorMessage);
    }
    const data = response.data ?? {};
    return toPage<T>(data, data[itemsKey] ?? data.items ?? [], options);
  };

  const cache = prefetchCache.get(client) ?? new Map();
  prefetchCache.set(client, cache);

  const cached = cache.get(path);
  cache.delete(path);
  const page = (cached && (await cached)) || (await load());

  if (options.prefetch && page.hasMore && page.nextCursor) {
    const next: QueryOptions = { ...options, offset: undefined, cursor: page.nextCursor };
    const nextPath = `${basePath}${buildQueryString(resolveOptions(next))}`;
    if (!cache.has(nextPath)) {
      cache.set(
        nextPath,
        fetchPage<T>(client, basePath, itemsKey, errorMessage, { ...next, prefetch: false }).catch(
          () => null
        )
      );
    }
  }

  return page;
}

/**
 * List tips with filtering and cursor/offset pagination
 *
 * @example
 * ```ts
 * const results = await listTips(client, { limit: 20, cursor: 'eyJvZmZzZXQiOiAyMH0=' });
 * results.items; // Tip[]
 * results.nextCursor; // pass back as `cursor` for the next page
 * ```
 */
export async function listTips<T = Tip>(
  client: ListClient,
  options: QueryOptions = {}
): Promise<PaginationResult<T>> {
  return fetchPage<T>(
    client,
    '/api/v1/transactions/history',
    'transactions',
    'Failed to fetch tips',
    options
  );
}

/**
 * List creator tips with filtering and pagination
 */
export async function listCreatorTips(
  client: QueryClient,
  creatorId: string,
  options: QueryOptions = {}
): Promise<PaginationResult<Transaction>> {
  const query = buildQueryString(options);
  const response = await client.request<{
    transactions?: Transaction[];
    page?: number;
    pageSize?: number;
    total?: number;
  }>('GET', `/api/v1/transactions/creator/${creatorId}${query}`);

  if (!response.success) {
    throw new Error(response.error?.message || 'Failed to fetch creator tips');
  }

  const data = response.data ?? {};
  const { page, pageSize, total, hasMore } = parsePaginationMeta(data);
  const offset = options.offset ?? 0;

  return {
    items: data.transactions ?? [],
    total,
    page,
    pageSize,
    hasMore,
    nextCursor: hasMore ? String(offset + pageSize) : undefined,
    prevCursor: offset > 0 ? String(Math.max(0, offset - pageSize)) : undefined,
  };
}

/**
 * List creators with filtering and pagination
 */
export async function listCreators(
  client: QueryClient,
  options: QueryOptions = {}
): Promise<PaginationResult<Creator>> {
  const query = buildQueryString(options);
  const response = await client.request<{
    creators?: Creator[];
    page?: number;
    pageSize?: number;
    total?: number;
  }>('GET', `/api/v1/creators${query}`);

  if (!response.success) {
    throw new Error(response.error?.message || 'Failed to fetch creators');
  }

  const data = response.data ?? {};
  const { page, pageSize, total, hasMore } = parsePaginationMeta(data);
  const offset = options.offset ?? 0;

  return {
    items: data.creators ?? [],
    total,
    page,
    pageSize,
    hasMore,
    nextCursor: hasMore ? String(offset + pageSize) : undefined,
    prevCursor: offset > 0 ? String(Math.max(0, offset - pageSize)) : undefined,
  };
}

/**
 * List verified creators
 */
export async function listVerifiedCreators(
  client: QueryClient,
  options: QueryOptions = {}
): Promise<PaginationResult<Creator>> {
  return listCreators(client, {
    ...options,
    filters: { ...options.filters, verified: true },
  });
}

/**
 * Paginate through results manually
 */
export class Paginator<T> {
  private offset = 0;
  private readonly pageSize: number;
  private readonly endpoint: string;
  private readonly client: QueryClient;
  private readonly filters?: Record<string, string | number | boolean>;

  constructor(
    client: QueryClient,
    endpoint: 'tips' | 'creators' | 'creator-tips',
    options: QueryOptions = {}
  ) {
    this.client = client;
    this.endpoint = endpoint;
    this.pageSize = options.limit ?? 20;
    this.filters = options.filters;
  }

  async next(): Promise<PaginationResult<T>> {
    const result = await this.fetchPage();
    if (result.hasMore) this.offset += this.pageSize;
    return result;
  }

  async previous(): Promise<PaginationResult<T>> {
    this.offset = Math.max(0, this.offset - this.pageSize);
    return this.fetchPage();
  }

  async goto(pageNumber: number): Promise<PaginationResult<T>> {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new RangeError('Page number must be an integer >= 1');
    }
    return this.load(pageNumber - 1, this.cursorFor(pageNumber - 1));
  }

  reset(): void {
    this.index = -1;
    this.last = undefined;
    const first = this.cursors.get(0);
    this.cursors.clear();
    this.cursors.set(0, first);
  }

  getOffset(): number {
    return this.offset;
  }

  private async fetchPage(): Promise<PaginationResult<T>> {
    const options: QueryOptions = {
      limit: this.pageSize,
      offset: this.offset,
      filters: this.filters,
    };

    if (this.endpoint === 'tips') {
      return listTips(this.client, options) as Promise<PaginationResult<T>>;
    } else if (this.endpoint === 'creators') {
      return listCreators(this.client, options) as Promise<PaginationResult<T>>;
    } else {
      throw new Error(`Unknown endpoint: ${this.endpoint}`);
    }
  }
}

/**
 * Wrap any list function in a {@link Paginator}.
 */
export function createPaginator<T>(
  client: QueryClient,
  endpoint: 'tips' | 'creators' | 'creator-tips',
  options?: QueryOptions
): Paginator<T> {
  return new Paginator(client, endpoint, options);
}
