/**
 * GraphQL Client
 *
 * Provides a type-safe GraphQL client with built-in caching, error handling,
 * and high-level methods to avoid over-fetching and N+1 queries.
 */

import { DorisioError, ApiError, NetworkError, TimeoutError } from '../types/errors';
import type {
  Creator,
  CreatorWithUser,
  CreatorProfile,
  CreatorListResponse,
  Transaction,
  TransactionWithDetails,
  TransactionHistory,
  Wallet,
  WalletListResponse,
} from '../types/models';
import type { CreateTipRequest } from '../types/requests';
import {
  GET_CREATOR,
  GET_CREATOR_WITH_USER,
  LIST_CREATORS,
  GET_CREATOR_PROFILE,
  GET_TRANSACTION,
  GET_TRANSACTION_WITH_DETAILS,
  GET_TRANSACTION_HISTORY,
  GET_WALLET,
  GET_WALLETS,
  CREATE_TIP,
  buildCreatorQuery,
  buildListCreatorsQuery,
  buildTransactionQuery,
  buildTransactionHistoryQuery,
} from './queries';
import { MockRouter } from '../sandbox/mock-router';

/**
 * GraphQL error location
 */
export interface GraphQLErrorLocation {
  line: number;
  column: number;
}

/**
 * GraphQL individual error item returned in the response
 */
export interface GraphQLErrorItem {
  message: string;
  locations?: GraphQLErrorLocation[];
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}

/**
 * Structured GraphQL error class
 */
export class GraphQLError extends DorisioError {
  public readonly errors: GraphQLErrorItem[];
  public readonly locations?: GraphQLErrorLocation[];
  public readonly path?: Array<string | number>;
  public readonly extensions?: Record<string, unknown>;

  constructor(
    message: string,
    errors: GraphQLErrorItem[] = [],
    statusCode = 400
  ) {
    const errorDetails =
      errors.length > 0
        ? errors.map((e) => e.message).join('; ')
        : message;
    const fullMessage = message.includes(errorDetails)
      ? message
      : `${message}: ${errorDetails}`;

    super(fullMessage, statusCode, 'GRAPHQL_ERROR');
    this.name = 'GraphQLError';
    this.errors = errors;

    const first = errors[0];
    if (first) {
      this.locations = first.locations;
      this.path = first.path;
      this.extensions = first.extensions;
    }
  }
}

/**
 * In-memory cache entry
 */
export interface CacheEntry<T = unknown> {
  data: T;
  expiresAt: number;
  addedAt: number;
}

/**
 * Cache configuration options
 */
export interface GraphQLCacheOptions {
  /** Default time-to-live in milliseconds (default: 60000ms / 1 min) */
  defaultTtl?: number;
  /** Maximum number of items in cache before LRU eviction (default: 100) */
  maxSize?: number;
}

/**
 * In-memory LRU cache for GraphQL query results
 */
export class GraphQLCache {
  private cache = new Map<string, CacheEntry>();
  private defaultTtl: number;
  private maxSize: number;

  constructor(options: GraphQLCacheOptions = {}) {
    this.defaultTtl = options.defaultTtl ?? 60000;
    this.maxSize = options.maxSize ?? 100;
  }

  /**
   * Retrieve cached value if not expired
   */
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Refresh key position for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.data as T;
  }

  /**
   * Set cached value with optional TTL override
   */
  set<T>(key: string, data: T, ttl?: number): void {
    if (this.maxSize <= 0) return;

    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    const duration = ttl !== undefined ? ttl : this.defaultTtl;
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + duration,
      addedAt: Date.now(),
    });
  }

  /**
   * Check if non-expired key exists in cache
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete entry from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all entries from cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get total number of valid entries
   */
  get size(): number {
    this.prune();
    return this.cache.size;
  }

  /**
   * Remove all expired entries
   */
  prune(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Invalidate entries matching a key or RegExp pattern
   */
  invalidate(pattern?: string | RegExp): number {
    if (!pattern) {
      const count = this.cache.size;
      this.clear();
      return count;
    }
    let removed = 0;
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Generate deterministic cache key from query string and variables
   */
  generateKey(query: string, variables?: Record<string, unknown>): string {
    const normalizedQuery = query.replace(/\s+/g, ' ').trim();
    if (!variables || Object.keys(variables).length === 0) {
      return normalizedQuery;
    }
    const serializedVariables = this.stableStringify(variables);
    return `${normalizedQuery}::${serializedVariables}`;
  }

  private stableStringify(obj: unknown): string {
    if (Array.isArray(obj)) {
      return `[${obj.map((item) => this.stableStringify(item)).join(',')}]`;
    }
    if (obj !== null && typeof obj === 'object') {
      const record = obj as Record<string, unknown>;
      const sortedKeys = Object.keys(record).sort();
      const entries = sortedKeys.map(
        (key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`
      );
      return `{${entries.join(',')}}`;
    }
    return JSON.stringify(obj) ?? 'null';
  }
}

/**
 * Standard GraphQL execution response shape
 */
export interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: GraphQLErrorItem[];
  extensions?: Record<string, unknown>;
}

/**
 * Options for GraphQL operations
 */
export interface GraphQLRequestOptions {
  /** Skip cache check and storage */
  skipCache?: boolean;
  /** Force refresh (bypasses cache read, updates cache with fresh data) */
  forceRefresh?: boolean;
  /** Cache time-to-live override in ms for this request */
  ttl?: number;
  /** Invalidate cache entries matching key/pattern after mutation, or true to clear all */
  invalidateCache?: boolean | string | RegExp;
  /** Additional custom headers */
  headers?: Record<string, string>;
  /** Abort signal */
  signal?: AbortSignal;
  /** Timeout in ms */
  timeout?: number;
  /** Explicit GraphQL operation name */
  operationName?: string;
}

/**
 * Configuration options for GraphQLClient
 */
export interface GraphQLClientConfig {
  /** Base URL of the API */
  baseUrl: string;
  /** GraphQL endpoint path (defaults to '/graphql') */
  endpoint?: string;
  /** Authentication bearer token */
  token?: string;
  /** Default headers */
  headers?: Record<string, string>;
  /** Request timeout in ms (default: 30000ms) */
  timeout?: number;
  /** Enable in-memory caching of query responses (default: true) */
  cacheEnabled?: boolean;
  /** Default cache TTL in ms (default: 60000ms) */
  defaultTtl?: number;
  /** Maximum cache entries (default: 100) */
  maxCacheSize?: number;
  /** Custom cache implementation */
  cache?: GraphQLCache;
  /** Client mode: 'live' or 'sandbox' */
  mode?: 'live' | 'sandbox';
  /** Custom fetch implementation */
  fetch?: typeof fetch;
  /** Sandbox deterministic seed */
  sandboxSeed?: number;
}

/**
 * GraphQL Client for Dorisio payment infrastructure
 */
export class GraphQLClient {
  private baseUrl: string;
  private endpoint: string;
  private token?: string;
  private defaultHeaders: Record<string, string>;
  private timeout: number;
  private cache: GraphQLCache;
  private cacheEnabled: boolean;
  private mode: 'live' | 'sandbox';
  private customFetch?: typeof fetch;
  private mockRouter: MockRouter;

  constructor(config: GraphQLClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.endpoint = config.endpoint ?? '/graphql';
    if (!this.endpoint.startsWith('/')) {
      this.endpoint = `/${this.endpoint}`;
    }
    this.token = config.token;
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...config.headers,
    };
    this.timeout = config.timeout ?? 30000;
    this.cacheEnabled = config.cacheEnabled ?? true;
    this.cache =
      config.cache ??
      new GraphQLCache({
        defaultTtl: config.defaultTtl ?? 60000,
        maxSize: config.maxCacheSize ?? 100,
      });
    this.mode = config.mode ?? 'live';
    this.customFetch = config.fetch;
    this.mockRouter = new MockRouter({ seed: config.sandboxSeed ?? 42 });
  }

  /**
   * Set authentication token
   */
  setToken(token: string): void {
    this.token = token;
  }

  /**
   * Clear authentication token
   */
  clearToken(): void {
    this.token = undefined;
  }

  /**
   * Set default header
   */
  setHeader(key: string, value: string): void {
    this.defaultHeaders[key] = value;
  }

  /**
   * Remove default header
   */
  removeHeader(key: string): void {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete this.defaultHeaders[key];
  }

  /**
   * Get GraphQL endpoint
   */
  getEndpoint(): string {
    return this.endpoint;
  }

  /**
   * Update GraphQL endpoint
   */
  setEndpoint(endpoint: string): void {
    this.endpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  }

  /**
   * Get current client mode
   */
  getMode(): 'live' | 'sandbox' {
    return this.mode;
  }

  /**
   * Set client mode
   */
  setMode(mode: 'live' | 'sandbox'): void {
    this.mode = mode;
  }

  /**
   * Access underlying cache
   */
  getCache(): GraphQLCache {
    return this.cache;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get number of cached items
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Invalidate cache entries by string or pattern
   */
  invalidateCache(pattern?: string | RegExp): number {
    return this.cache.invalidate(pattern);
  }

  /**
   * Execute low-level GraphQL request returning full response
   */
  async rawRequest<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
    options?: GraphQLRequestOptions
  ): Promise<GraphQLResponse<T>> {
    const url = `${this.baseUrl}${this.endpoint}`;
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...options?.headers,
    };

    if (this.token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const payload = {
      query,
      variables: variables ?? {},
      operationName: options?.operationName,
    };

    if (this.mode === 'sandbox') {
      const response = await this.mockRouter.handle('POST', this.endpoint, payload);
      if (response && typeof response === 'object' && 'data' in response) {
        return response as GraphQLResponse<T>;
      }
      return { data: response as T };
    }

    const fetchFn = this.customFetch ?? globalThis.fetch;
    const timeoutMs = options?.timeout ?? this.timeout;

    let response: Response;
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: options?.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        throw new TimeoutError(`GraphQL request timed out after ${timeoutMs}ms`);
      }
      throw new NetworkError(
        `GraphQL network request failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    let json: GraphQLResponse<T>;
    try {
      json = (await response.json()) as GraphQLResponse<T>;
    } catch {
      throw new DorisioError(
        `Failed to parse GraphQL response (status ${response.status})`,
        response.status,
        'GRAPHQL_PARSE_ERROR'
      );
    }

    if (!response.ok && (!json.errors || json.errors.length === 0)) {
      throw new ApiError(
        (json as unknown as { error?: string }).error ?? `GraphQL request failed with status ${response.status}`,
        response.status
      );
    }

    return json;
  }

  /**
   * Execute a GraphQL query with automatic result caching
   */
  async query<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
    options?: GraphQLRequestOptions
  ): Promise<T> {
    const cacheKey = this.cache.generateKey(query, variables);

    if (this.cacheEnabled && !options?.skipCache && !options?.forceRefresh) {
      const cached = this.cache.get<T>(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    const response = await this.rawRequest<T>(query, variables, options);

    if (response.errors && response.errors.length > 0) {
      throw new GraphQLError('GraphQL query error', response.errors);
    }

    if (response.data === undefined) {
      throw new GraphQLError('GraphQL query returned no data');
    }

    if (this.cacheEnabled && !options?.skipCache) {
      this.cache.set(cacheKey, response.data, options?.ttl);
    }

    return response.data;
  }

  /**
   * Execute a GraphQL mutation (bypasses cache; optionally invalidates cached entries)
   */
  async mutate<T = unknown>(
    mutation: string,
    variables?: Record<string, unknown>,
    options?: GraphQLRequestOptions
  ): Promise<T> {
    const response = await this.rawRequest<T>(mutation, variables, options);

    if (response.errors && response.errors.length > 0) {
      throw new GraphQLError('GraphQL mutation error', response.errors);
    }

    if (response.data === undefined) {
      throw new GraphQLError('GraphQL mutation returned no data');
    }

    if (options?.invalidateCache) {
      if (typeof options.invalidateCache === 'boolean') {
        this.cache.clear();
      } else {
        this.cache.invalidate(options.invalidateCache);
      }
    }

    return response.data;
  }

  // ==========================================
  // High-Level Domain Convenience Queries
  // ==========================================

  /**
   * Get creator by ID. Allows passing specific fields to avoid over-fetching.
   */
  async getCreator(
    id: string,
    fields?: string[],
    options?: GraphQLRequestOptions
  ): Promise<Creator> {
    const query = fields && fields.length > 0 ? buildCreatorQuery(fields) : GET_CREATOR;
    const data = await this.query<{ creator: Creator }>(query, { id }, options);
    return data.creator;
  }

  /**
   * Get creator with full user details in a single query (solves N+1 problem)
   */
  async getCreatorWithUser(
    id: string,
    options?: GraphQLRequestOptions
  ): Promise<CreatorWithUser> {
    const data = await this.query<{ creator: CreatorWithUser }>(
      GET_CREATOR_WITH_USER,
      { id },
      options
    );
    return data.creator;
  }

  /**
   * List creators with pagination and optional custom field selection
   */
  async listCreators(
    params?: { page?: number; pageSize?: number; verified?: boolean; fields?: string[] },
    options?: GraphQLRequestOptions
  ): Promise<CreatorListResponse> {
    const query =
      params?.fields && params.fields.length > 0
        ? buildListCreatorsQuery(params.fields)
        : LIST_CREATORS;
    const variables = {
      page: params?.page,
      pageSize: params?.pageSize,
      verified: params?.verified,
    };
    const data = await this.query<{ creators: CreatorListResponse }>(
      query,
      variables,
      options
    );
    return data.creators;
  }

  /**
   * Get creator public profile with aggregated tip stats
   */
  async getCreatorProfile(
    username: string,
    options?: GraphQLRequestOptions
  ): Promise<CreatorProfile> {
    const data = await this.query<{ creatorProfile: CreatorProfile }>(
      GET_CREATOR_PROFILE,
      { username },
      options
    );
    return data.creatorProfile;
  }

  /**
   * Get transaction by ID. Allows custom field selection to avoid over-fetching.
   */
  async getTransaction(
    id: string,
    fields?: string[],
    options?: GraphQLRequestOptions
  ): Promise<Transaction> {
    const query = fields && fields.length > 0 ? buildTransactionQuery(fields) : GET_TRANSACTION;
    const data = await this.query<{ transaction: Transaction }>(query, { id }, options);
    return data.transaction;
  }

  /**
   * Get transaction with user and creator details in one query (solves N+1 problem)
   */
  async getTransactionWithDetails(
    id: string,
    options?: GraphQLRequestOptions
  ): Promise<TransactionWithDetails> {
    const data = await this.query<{ transaction: TransactionWithDetails }>(
      GET_TRANSACTION_WITH_DETAILS,
      { id },
      options
    );
    return data.transaction;
  }

  /**
   * Get paginated transaction history
   */
  async getTransactionHistory(
    params?: {
      page?: number;
      pageSize?: number;
      creatorId?: string;
      status?: string;
      fields?: string[];
    },
    options?: GraphQLRequestOptions
  ): Promise<TransactionHistory> {
    const query =
      params?.fields && params.fields.length > 0
        ? buildTransactionHistoryQuery(params.fields)
        : GET_TRANSACTION_HISTORY;
    const variables = {
      page: params?.page,
      pageSize: params?.pageSize,
      creatorId: params?.creatorId,
      status: params?.status,
    };
    const data = await this.query<{ transactionHistory: TransactionHistory }>(
      query,
      variables,
      options
    );
    return data.transactionHistory;
  }

  /**
   * Get wallet by ID
   */
  async getWallet(
    id: string,
    options?: GraphQLRequestOptions
  ): Promise<Wallet> {
    const data = await this.query<{ wallet: Wallet }>(GET_WALLET, { id }, options);
    return data.wallet;
  }

  /**
   * Get all wallets for a user
   */
  async getWallets(
    userId: string,
    options?: GraphQLRequestOptions
  ): Promise<WalletListResponse> {
    const data = await this.query<{ wallets: WalletListResponse }>(
      GET_WALLETS,
      { userId },
      options
    );
    return data.wallets;
  }

  /**
   * Submit tip transaction mutation
   */
  async createTip(
    input: CreateTipRequest,
    options?: GraphQLRequestOptions
  ): Promise<Transaction> {
    const data = await this.mutate<{ createTip: Transaction }>(
      CREATE_TIP,
      { input },
      options
    );
    return data.createTip;
  }
}
