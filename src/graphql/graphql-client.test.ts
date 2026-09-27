/**
 * GraphQL Client & Cache Unit Tests
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  GraphQLClient,
  GraphQLCache,
  GraphQLError,
} from './graphql-client';
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
  buildCustomQuery,
} from './queries';
import { DorisioClient } from '../client';
import { DorisioError, NetworkError, TimeoutError } from '../types/errors';

describe('GraphQLCache', () => {
  it('stores and retrieves values within TTL', () => {
    const cache = new GraphQLCache({ defaultTtl: 5000 });
    cache.set('key1', { foo: 'bar' });

    expect(cache.has('key1')).toBe(true);
    expect(cache.get('key1')).toEqual({ foo: 'bar' });
  });

  it('expires entries after TTL', () => {
    vi.useFakeTimers();
    try {
      const cache = new GraphQLCache({ defaultTtl: 1000 });
      cache.set('key1', 'value1');

      expect(cache.get('key1')).toBe('value1');

      vi.advanceTimersByTime(1001);

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.has('key1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects per-item TTL override', () => {
    vi.useFakeTimers();
    try {
      const cache = new GraphQLCache({ defaultTtl: 10000 });
      cache.set('key-short', 'value-short', 500);
      cache.set('key-long', 'value-long', 5000);

      vi.advanceTimersByTime(600);

      expect(cache.get('key-short')).toBeUndefined();
      expect(cache.get('key-long')).toBe('value-long');
    } finally {
      vi.useRealTimers();
    }
  });

  it('evicts oldest entries when maxSize is exceeded (LRU)', () => {
    const cache = new GraphQLCache({ maxSize: 2 });
    cache.set('a', 1);
    cache.set('b', 2);

    // Access 'a' to make 'b' the oldest
    cache.get('a');

    cache.set('c', 3);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });

  it('deletes entries and clears cache', () => {
    const cache = new GraphQLCache();
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');

    expect(cache.delete('k1')).toBe(true);
    expect(cache.get('k1')).toBeUndefined();
    expect(cache.size).toBe(1);

    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('prunes expired entries', () => {
    vi.useFakeTimers();
    try {
      const cache = new GraphQLCache({ defaultTtl: 1000 });
      cache.set('k1', 'v1', 500);
      cache.set('k2', 'v2', 2000);

      vi.advanceTimersByTime(600);

      const pruned = cache.prune();
      expect(pruned).toBe(1);
      expect(cache.size).toBe(1);
      expect(cache.get('k2')).toBe('v2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates entries by string substring or RegExp pattern', () => {
    const cache = new GraphQLCache();
    cache.set('creator::1', { name: 'Alice' });
    cache.set('creator::2', { name: 'Bob' });
    cache.set('wallet::1', { balance: 100 });

    const removed = cache.invalidate(/^creator::/);
    expect(removed).toBe(2);
    expect(cache.has('creator::1')).toBe(false);
    expect(cache.has('creator::2')).toBe(false);
    expect(cache.has('wallet::1')).toBe(true);
  });

  it('generates deterministic cache keys with sorted variables', () => {
    const cache = new GraphQLCache();
    const query = 'query Test { user { id } }';

    const key1 = cache.generateKey(query, { b: 2, a: 1 });
    const key2 = cache.generateKey(query, { a: 1, b: 2 });

    expect(key1).toBe(key2);
    expect(key1).toContain('{"a":1,"b":2}');
  });
});

describe('GraphQLError', () => {
  it('instantiates with errors array and extracts locations and paths', () => {
    const errorItem = {
      message: 'Field "foo" does not exist',
      locations: [{ line: 2, column: 5 }],
      path: ['creator', 'foo'],
      extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
    };

    const gqlError = new GraphQLError('GraphQL error occurred', [errorItem], 400);

    expect(gqlError).toBeInstanceOf(DorisioError);
    expect(gqlError.name).toBe('GraphQLError');
    expect(gqlError.message).toContain('Field "foo" does not exist');
    expect(gqlError.statusCode).toBe(400);
    expect(gqlError.locations).toEqual([{ line: 2, column: 5 }]);
    expect(gqlError.path).toEqual(['creator', 'foo']);
    expect(gqlError.extensions).toEqual({ code: 'GRAPHQL_VALIDATION_FAILED' });
    expect(gqlError.errors).toHaveLength(1);
  });
});

describe('GraphQL Queries & Query Builders', () => {
  it('exports standard query strings', () => {
    expect(GET_CREATOR).toContain('creator(id: $id)');
    expect(GET_CREATOR_WITH_USER).toContain('user {');
    expect(LIST_CREATORS).toContain('creators(');
    expect(GET_CREATOR_PROFILE).toContain('creatorProfile(');
    expect(GET_TRANSACTION).toContain('transaction(id: $id)');
    expect(GET_TRANSACTION_WITH_DETAILS).toContain('fromUser {');
    expect(GET_TRANSACTION_HISTORY).toContain('transactionHistory(');
    expect(GET_WALLET).toContain('wallet(id: $id)');
    expect(GET_WALLETS).toContain('wallets(');
    expect(CREATE_TIP).toContain('createTip(input: $input)');
  });

  it('builds custom creator queries avoiding over-fetching', () => {
    const query = buildCreatorQuery(['id', 'username', 'avatar']);
    expect(query).toContain('creator(id: $id)');
    expect(query).toContain('id');
    expect(query).toContain('username');
    expect(query).toContain('avatar');
    expect(query).not.toContain('pendingBalance');
  });

  it('builds custom list creators query with selected fields', () => {
    const query = buildListCreatorsQuery(['id', 'displayName']);
    expect(query).toContain('creators(page: $page');
    expect(query).toContain('displayName');
    expect(query).not.toContain('pendingBalance');
  });

  it('builds custom transaction queries avoiding over-fetching', () => {
    const query = buildTransactionQuery(['id', 'amount', 'status']);
    expect(query).toContain('transaction(id: $id)');
    expect(query).toContain('amount');
    expect(query).toContain('status');
    expect(query).not.toContain('stellarTxHash');
  });

  it('builds custom transaction history query', () => {
    const query = buildTransactionHistoryQuery(['id', 'amount']);
    expect(query).toContain('transactionHistory(');
    expect(query).toContain('amount');
    expect(query).not.toContain('stellarTxHash');
  });

  it('builds generic custom queries', () => {
    const query = buildCustomQuery({
      operationType: 'query',
      operationName: 'MyCustomFetch',
      field: 'creator',
      variables: { id: 'ID!' },
      args: { id: '$id' },
      fields: ['id', 'username'],
    });

    expect(query).toContain('query MyCustomFetch($id: ID!)');
    expect(query).toContain('creator(id: $id)');
    expect(query).toContain('username');
  });
});

describe('GraphQLClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('executes a basic query successfully', async () => {
    const mockCreator = {
      id: 'creator-1',
      userId: 'user-1',
      username: 'alice',
      displayName: 'Alice',
      bio: 'Bio',
      avatar: null,
      verified: true,
      isPublic: true,
      totalEarnings: 1000,
      pendingBalance: 50,
      createdAt: '2024-01-01',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: { creator: mockCreator },
      }),
    });

    const client = new GraphQLClient({
      baseUrl: 'https://api.example.com',
      token: 'jwt-123',
    });

    const result = await client.query<{ creator: typeof mockCreator }>(GET_CREATOR, {
      id: 'creator-1',
    });

    expect(result.creator).toEqual(mockCreator);
    const firstCall = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(firstCall).toBeDefined();
    const url = firstCall?.[0];
    const requestInit = firstCall?.[1] as RequestInit & { headers: Record<string, string> };
    expect(url).toBe('https://api.example.com/graphql');
    expect(requestInit.headers['Authorization']).toBe('Bearer jwt-123');
    expect(requestInit.headers['Content-Type']).toBe('application/json');
  });

  it('caches query results and avoids duplicate network requests', async () => {
    const mockData = { creator: { id: 'creator-1', username: 'alice' } };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: mockData }),
    });
    globalThis.fetch = fetchMock;

    const client = new GraphQLClient({ baseUrl: 'https://api.example.com' });

    const result1 = await client.query(GET_CREATOR, { id: 'creator-1' });
    const result2 = await client.query(GET_CREATOR, { id: 'creator-1' });

    expect(result1).toEqual(mockData);
    expect(result2).toEqual(mockData);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(client.getCacheSize()).toBe(1);
  });

  it('bypasses cache when skipCache is true', async () => {
    const mockData = { creator: { id: 'creator-1', username: 'alice' } };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: mockData }),
    });
    globalThis.fetch = fetchMock;

    const client = new GraphQLClient({ baseUrl: 'https://api.example.com' });

    await client.query(GET_CREATOR, { id: 'creator-1' });
    await client.query(GET_CREATOR, { id: 'creator-1' }, { skipCache: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes cache when forceRefresh is true', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { value: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { value: 2 } }),
      });
    globalThis.fetch = fetchMock;

    const client = new GraphQLClient({ baseUrl: 'https://api.example.com' });

    const res1 = await client.query('query Test { value }');
    expect(res1).toEqual({ value: 1 });

    const res2 = await client.query('query Test { value }', {}, { forceRefresh: true });
    expect(res2).toEqual({ value: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws GraphQLError when errors array is returned in response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: null,
        errors: [{ message: 'Creator not found', path: ['creator'] }],
      }),
    });

    const client = new GraphQLClient({ baseUrl: 'https://api.example.com' });

    await expect(client.query(GET_CREATOR, { id: 'non-existent' })).rejects.toThrow(
      GraphQLError
    );
  });

  it('throws NetworkError on fetch network rejection', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    const client = new GraphQLClient({ baseUrl: 'https://api.example.com' });

    await expect(client.query(GET_CREATOR, { id: 'c1' })).rejects.toThrow(NetworkError);
  });

  it('throws TimeoutError when request aborts due to timeout', async () => {
    const timeoutErr = new Error('The operation was aborted');
    timeoutErr.name = 'TimeoutError';
    globalThis.fetch = vi.fn().mockRejectedValue(timeoutErr);

    const client = new GraphQLClient({ baseUrl: 'https://api.example.com' });

    await expect(client.query(GET_CREATOR, { id: 'c1' })).rejects.toThrow(TimeoutError);
  });

  it('executes mutations without caching and supports cache invalidation', async () => {
    const tipData = {
      id: 'tx-1',
      amount: 25,
      fromUserId: 'u1',
      creatorId: 'c1',
      status: 'pending',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: { createTip: tipData },
      }),
    });
    globalThis.fetch = fetchMock;

    const client = new GraphQLClient({ baseUrl: 'https://api.example.com' });
    client.getCache().set('creator::c1', { name: 'Alice' });
    expect(client.getCacheSize()).toBe(1);

    const result = await client.mutate<{ createTip: typeof tipData }>(
      CREATE_TIP,
      { input: { creatorId: 'c1', amount: 25 } },
      { invalidateCache: true }
    );

    expect(result.createTip).toEqual(tipData);
    expect(client.getCacheSize()).toBe(0);
  });

  it('supports token and header management', () => {
    const client = new GraphQLClient({ baseUrl: 'https://api.example.com' });

    client.setToken('my-token');
    client.setHeader('X-Custom-Header', 'custom-value');

    client.removeHeader('X-Custom-Header');
    client.clearToken();
  });

  it('supports custom endpoint configuration', () => {
    const client = new GraphQLClient({
      baseUrl: 'https://api.example.com',
      endpoint: '/api/v2/graphql',
    });

    expect(client.getEndpoint()).toBe('/api/v2/graphql');
    client.setEndpoint('custom-graphql');
    expect(client.getEndpoint()).toBe('/custom-graphql');
  });

  describe('High-level domain convenience methods', () => {
    it('calls getCreator and listCreators', async () => {
      const mockCreator = { id: 'c1', username: 'alice' };
      const mockList = { creators: [mockCreator], total: 1, page: 1, pageSize: 10 };

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: { creator: mockCreator } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: { creators: mockList } }),
        });

      const client = new GraphQLClient({ baseUrl: 'https://api.example.com' });

      const creator = await client.getCreator('c1');
      expect(creator).toEqual(mockCreator);

      const list = await client.listCreators({ page: 1, pageSize: 10 });
      expect(list).toEqual(mockList);
    });

    it('solves N+1 query problem with getCreatorWithUser and getTransactionWithDetails', async () => {
      const mockCreatorWithUser = {
        id: 'c1',
        username: 'alice',
        user: { id: 'u1', email: 'alice@example.com' },
      };
      const mockTxWithDetails = {
        id: 'tx-1',
        amount: 50,
        fromUser: { id: 'u2', email: 'fan@example.com' },
        creator: { id: 'c1', username: 'alice' },
      };

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: { creator: mockCreatorWithUser } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: { transaction: mockTxWithDetails } }),
        });

      const client = new GraphQLClient({ baseUrl: 'https://api.example.com' });

      const creatorWithUser = await client.getCreatorWithUser('c1');
      expect(creatorWithUser.user.email).toBe('alice@example.com');

      const txWithDetails = await client.getTransactionWithDetails('tx-1');
      expect(txWithDetails.fromUser.email).toBe('fan@example.com');
      expect(txWithDetails.creator.username).toBe('alice');
    });

    it('calls getCreatorProfile, getTransaction, getTransactionHistory, getWallet, getWallets, createTip', async () => {
      const mockProfile = { id: 'c1', username: 'alice', stats: { totalTips: 10 } };
      const mockTx = { id: 'tx-1', amount: 10 };
      const mockHistory = { transactions: [mockTx], total: 1, page: 1, pageSize: 20 };
      const mockWallet = { id: 'w1', publicKey: 'GB123' };
      const mockWallets = { wallets: [mockWallet], total: 1, page: 1, pageSize: 10 };
      const mockTip = { id: 'tx-new', amount: 15 };

      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: { creatorProfile: mockProfile } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: { transaction: mockTx } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: { transactionHistory: mockHistory } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: { wallet: mockWallet } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: { wallets: mockWallets } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: { createTip: mockTip } }),
        });

      const client = new GraphQLClient({ baseUrl: 'https://api.example.com' });

      const profile = await client.getCreatorProfile('alice');
      expect(profile).toEqual(mockProfile);

      const tx = await client.getTransaction('tx-1');
      expect(tx).toEqual(mockTx);

      const history = await client.getTransactionHistory({ creatorId: 'c1' });
      expect(history).toEqual(mockHistory);

      const wallet = await client.getWallet('w1');
      expect(wallet).toEqual(mockWallet);

      const wallets = await client.getWallets('u1');
      expect(wallets).toEqual(mockWallets);

      const createdTip = await client.createTip({ creatorId: 'c1', amount: 15 });
      expect(createdTip).toEqual(mockTip);
    });
  });

  describe('Sandbox mode integration', () => {
    it('returns mock responses without network fetch when mode is sandbox', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const client = new GraphQLClient({
        baseUrl: 'https://api.example.com',
        mode: 'sandbox',
        sandboxSeed: 42,
      });

      const creator = await client.getCreator('any-id');

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(creator).toBeDefined();
      expect(creator.id).toMatch(/^creator-/);
      expect(client.getMode()).toBe('sandbox');
    });

    it('creates tip via mutation in sandbox mode', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const client = new GraphQLClient({
        baseUrl: 'https://api.example.com',
        mode: 'sandbox',
        sandboxSeed: 99,
      });

      const tip = await client.createTip({ creatorId: 'c1', amount: 50 });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(tip).toBeDefined();
      expect(tip.amount).toBe(50);
    });
  });
});

describe('DorisioClient GraphQL property integration', () => {
  it('exposes graphql client instance on DorisioClient and synchronizes tokens and modes', () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.dorisio.com',
      token: 'init-token',
      mode: 'sandbox',
    });

    expect(client.graphql).toBeInstanceOf(GraphQLClient);
    expect(client.graphql.getMode()).toBe('sandbox');

    client.setToken('updated-token');
    client.clearToken();

    client.setMode('live');
    expect(client.graphql.getMode()).toBe('live');
  });
});
