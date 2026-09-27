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

  if (options.limit) {
    params.append('limit', String(options.limit));
  }
  if (options.offset) {
    params.append('offset', String(options.offset));
  }
  if (options.cursor) {
    params.append('cursor', options.cursor);
  }
  if (options.sort) {
    params.append('sort', options.sort);
  }

  // Add filters
  if (options.filters) {
    Object.entries(options.filters).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        params.append(`filter[${key}]`, String(value));
      }
    });
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

/**
 * Parse pagination metadata from response.
 * Pass the request `offset` for offset-based backends that don't echo `page`.
 */
export function parsePaginationMeta(
  response: any,
  offset?: number
): {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
} {
  const pageSize = response.pageSize || response.limit || 20;
  const total = response.total || 0;
  const start = offset ?? ((response.page || 1) - 1) * pageSize;
  const page = offset !== undefined ? Math.floor(offset / pageSize) + 1 : response.page || 1;

  return { page, pageSize, total, hasMore: start + pageSize < total };
}

/** Encode an offset as an opaque cursor: base64 of `{"offset":n}`. */
export function encodeCursor(offset: number): string {
  return btoa(JSON.stringify({ offset }));
}

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

/** Our own cursors carry an offset, so also send it for offset-based backends. */
function resolveOptions(options: QueryOptions): QueryOptions {
  if (options.cursor && options.offset === undefined) {
    const decoded = decodeCursor(options.cursor);
    if (decoded) return { ...options, offset: decoded.offset };
  }
  return options;
}

function toPage<T>(data: any, items: T[], options: QueryOptions): PaginationResult<T> {
  const meta = parsePaginationMeta(
    { ...data, pageSize: data.pageSize || data.limit || options.limit },
    options.offset
  );
  const { page, pageSize } = meta;
  const start = options.offset ?? (page - 1) * pageSize;

  let hasMore: boolean;
  if (typeof data.hasMore === 'boolean') hasMore = data.hasMore;
  else if (data.nextCursor) hasMore = true;
  else if (typeof data.total === 'number')
    hasMore = items.length > 0 && start + items.length < data.total;
  else hasMore = items.length > 0 && items.length >= pageSize;

  return {
    items,
    total: meta.total,
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
export async function listCreatorTips<T = Tip>(
  client: ListClient,
  creatorId: string,
  options: QueryOptions = {}
): Promise<PaginationResult<T>> {
  return fetchPage<T>(
    client,
    `/api/v1/transactions/creator/${encodeURIComponent(creatorId)}`,
    'transactions',
    'Failed to fetch creator tips',
    options
  );
}

/**
 * List creators with filtering and pagination
 */
export async function listCreators<T = Creator>(
  client: ListClient,
  options: QueryOptions = {}
): Promise<PaginationResult<T>> {
  return fetchPage<T>(client, '/api/v1/creators', 'creators', 'Failed to fetch creators', options);
}

/**
 * List verified creators
 */
export async function listVerifiedCreators<T = Creator>(
  client: ListClient,
  options: QueryOptions = {}
): Promise<PaginationResult<T>> {
  return listCreators<T>(client, {
    ...options,
    filters: { ...options.filters, verified: true },
  });
}

/**
 * Stateful pager over any list function. Cursors are remembered per page, so
 * `prev()` returns to exactly the page you came from. Works with cursor-based
 * and offset-based backends.
 *
 * `next()` / `prev()` resolve to `null` at the end / start instead of refetching.
 *
 * @example
 * ```ts
 * const paginator = createPaginator<Tip>((opts) => listTips(client, opts), { limit: 10 });
 * const page1 = await paginator.next();
 * const page2 = await paginator.next();
 * await paginator.prev(); // page 1 again
 * ```
 */
export class Paginator<T> {
  private readonly cursors = new Map<number, string | undefined>();
  private index = -1;
  private last?: PaginationResult<T>;

  constructor(
    private readonly fetcher: PageFetcher<T>,
    private readonly options: QueryOptions = {}
  ) {
    this.cursors.set(
      0,
      options.cursor ?? (options.offset ? encodeCursor(options.offset) : undefined)
    );
  }

  /** Fetch the next page (the first page on the first call). `null` when there is none. */
  async next(): Promise<PaginationResult<T> | null> {
    if (this.last && !this.last.hasMore) return null;
    const target = this.index + 1;
    const cursor = target === 0 ? this.cursors.get(0) : this.last?.nextCursor;
    return this.load(target, cursor);
  }

  /** Fetch the previous page. `null` when already on (or before) the first page. */
  async prev(): Promise<PaginationResult<T> | null> {
    if (this.index <= 0) return null;
    return this.load(this.index - 1, this.cursorFor(this.index - 1));
  }

  /** @deprecated Use {@link Paginator.prev}. */
  previous(): Promise<PaginationResult<T> | null> {
    return this.prev();
  }

  /** Jump to a 1-based page number. Jumping past known pages assumes an offset-based backend. */
  async goto(pageNumber: number): Promise<PaginationResult<T>> {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new RangeError('Page number must be an integer >= 1');
    }
    return this.load(pageNumber - 1, this.cursorFor(pageNumber - 1));
  }

  /** Forget all state; the next `next()` fetches the first page again. */
  reset(): void {
    this.index = -1;
    this.last = undefined;
    const first = this.cursors.get(0);
    this.cursors.clear();
    this.cursors.set(0, first);
  }

  /** Whether `next()` can return another page (true before the first fetch). */
  get hasNext(): boolean {
    return this.last ? this.last.hasMore : true;
  }

  /** Whether `prev()` can return a page. */
  get hasPrev(): boolean {
    return this.index > 0;
  }

  /** 1-based number of the current page, or 0 before the first fetch. */
  get currentPage(): number {
    return this.index + 1;
  }

  private cursorFor(index: number): string | undefined {
    if (this.cursors.has(index)) return this.cursors.get(index);
    const pageSize = this.options.limit ?? this.last?.pageSize ?? 20;
    return encodeCursor(index * pageSize);
  }

  private async load(index: number, cursor: string | undefined): Promise<PaginationResult<T>> {
    // Position is tracked via cursors; drop any initial offset.
    const page = await this.fetcher({ ...this.options, offset: undefined, cursor });
    // State only moves once the fetch succeeded.
    this.index = index;
    this.last = page;
    this.cursors.set(index, cursor);
    if (page.hasMore && page.nextCursor) this.cursors.set(index + 1, page.nextCursor);
    return page;
  }
}

/**
 * Wrap any list function in a {@link Paginator}.
 */
export function createPaginator<T>(fetcher: PageFetcher<T>, options?: QueryOptions): Paginator<T> {
  return new Paginator<T>(fetcher, options);
}
