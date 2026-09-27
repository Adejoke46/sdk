import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import {
  buildQueryString,
  createPaginator,
  decodeCursor,
  encodeCursor,
  listCreatorTips,
  listCreators,
  listTips,
  listVerifiedCreators,
  Paginator,
  type PageItem,
  type PaginationResult,
} from './query-builder';
import type { Tip } from '../types';

/** Offset-based fake backend over `total` items. Ignores `page`, like many real ones. */
function offsetClient(total: number, key = 'transactions') {
  const request = vi.fn(async (_method: string, path: string) => {
    const q = new URLSearchParams(path.split('?')[1] ?? '');
    const limit = Number(q.get('limit') ?? 10);
    const offset = Number(q.get('offset') ?? 0);
    const items = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({
      id: offset + i + 1,
    }));
    return { success: true, data: { [key]: items, total, limit } };
  });
  return { request };
}

/** Cursor-only fake backend: opaque cursors "c1", "c2", no total. */
function cursorClient(pages: number[][]) {
  const request = vi.fn(async (_method: string, path: string) => {
    const cursor = new URLSearchParams(path.split('?')[1] ?? '').get('cursor');
    const idx = cursor ? Number(cursor.slice(1)) : 0;
    return {
      success: true,
      data: {
        transactions: (pages[idx] ?? []).map((id) => ({ id })),
        nextCursor: idx + 1 < pages.length ? `c${idx + 1}` : undefined,
      },
    };
  });
  return { request };
}

const ids = (p: PaginationResult<any> | null) => p?.items.map((i) => i.id);

describe('cursor helpers', () => {
  it('round-trips offsets and rejects foreign cursors', () => {
    expect(decodeCursor(encodeCursor(20))).toEqual({ offset: 20 });
    expect(decodeCursor('eyJvZmZzZXQiOiAyMH0=')).toEqual({ offset: 20 });
    expect(decodeCursor('c1')).toBeNull();
    expect(decodeCursor(btoa('{"offset":-1}'))).toBeNull();
  });

  it('buildQueryString sends cursor but never prefetch', () => {
    expect(buildQueryString({ limit: 5, cursor: 'abc', prefetch: true })).toBe(
      '?limit=5&cursor=abc'
    );
  });
});

describe('listTips', () => {
  it('sends offset alongside our own cursors so offset backends work', async () => {
    const client = offsetClient(100);
    const res = await listTips(client, { limit: 20, cursor: 'eyJvZmZzZXQiOiAyMH0=' });
    expect(client.request.mock.calls[0]?.[1]).toContain('offset=20');
    expect(res.items[0]).toEqual({ id: 21 });
    expect(decodeCursor(res.nextCursor as string)).toEqual({ offset: 40 });
    expect(decodeCursor(res.prevCursor as string)).toEqual({ offset: 0 });
  });

  it('last page: hasMore=false, no nextCursor (regression: was always true past page 1)', async () => {
    const res = await listTips(offsetClient(25), { limit: 10, offset: 20 });
    expect(res.items).toHaveLength(5);
    expect(res.hasMore).toBe(false);
    expect(res.nextCursor).toBeUndefined();
    expect(res.page).toBe(3);
  });

  it('empty results', async () => {
    const res = await listTips(offsetClient(0), { limit: 10 });
    expect(res).toMatchObject({ items: [], total: 0, hasMore: false });
    expect(res.nextCursor).toBeUndefined();
    expect(res.prevCursor).toBeUndefined();
  });

  it('honours server-provided cursors and passes them through untouched', async () => {
    const client = cursorClient([[1, 2], [3, 4], [5]]);
    const p1 = await listTips(client, { limit: 2 });
    expect(p1.nextCursor).toBe('c1');
    const p2 = await listTips(client, { limit: 2, cursor: p1.nextCursor });
    expect(client.request.mock.calls[1]?.[1]).toContain('cursor=c1');
    expect(client.request.mock.calls[1]?.[1]).not.toContain('offset');
    expect(ids(p2)).toEqual([3, 4]);
  });

  it('throws the API error message on failure', async () => {
    const client = { request: vi.fn(async () => ({ success: false, error: { message: 'nope' } })) };
    await expect(listTips(client)).rejects.toThrow('nope');
    await expect(listTips({ request: async () => ({ success: false }) })).rejects.toThrow(
      'Failed to fetch tips'
    );
  });
});

describe('other list helpers', () => {
  it('listCreatorTips hits the creator path with paging', async () => {
    const client = offsetClient(15);
    const res = await listCreatorTips(client, 'a/b', { limit: 10 });
    expect(client.request.mock.calls[0]?.[1]).toBe('/api/v1/transactions/creator/a%2Fb?limit=10');
    expect(res.hasMore).toBe(true);
  });

  it('listCreators / listVerifiedCreators read `creators`', async () => {
    const client = offsetClient(3, 'creators');
    expect((await listCreators(client, { limit: 10 })).items).toHaveLength(3);
    await listVerifiedCreators(client, { limit: 10, filters: { x: 1 } });
    expect(client.request.mock.calls[1]?.[1]).toContain('filter%5Bverified%5D=true');
    expect(client.request.mock.calls[1]?.[1]).toContain('filter%5Bx%5D=1');
  });
});

describe('prefetch', () => {
  it('fetches the next page in the background and serves it without a new request', async () => {
    const client = offsetClient(30);
    const p1 = await listTips(client, { limit: 10, prefetch: true });
    expect(client.request).toHaveBeenCalledTimes(2);
    const p2 = await listTips(client, { limit: 10, cursor: p1.nextCursor });
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(ids(p2)?.[0]).toBe(11);
  });

  it('does not prefetch past the last page', async () => {
    const client = offsetClient(10);
    await listTips(client, { limit: 10, prefetch: true });
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it('does not prefetch unless asked', async () => {
    const client = offsetClient(30);
    await listTips(client, { limit: 10 });
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it('a failed prefetch is swallowed and the real call refetches', async () => {
    let n = 0;
    const base = offsetClient(30);
    const client = {
      request: vi.fn(async (m: string, p: string) => {
        if (++n === 2) throw new Error('boom');
        return base.request(m, p);
      }),
    };
    const p1 = await listTips(client, { limit: 10, prefetch: true });
    const p2 = await listTips(client, { limit: 10, cursor: p1.nextCursor });
    expect(ids(p2)?.[0]).toBe(11);
  });
});

describe('Paginator (offset backend)', () => {
  const make = (total = 25) => {
    const client = offsetClient(total);
    return { client, pager: createPaginator<Tip>((o) => listTips(client, o), { limit: 10 }) };
  };

  it('walks forward, stops at the end, and prev() returns the page you came from', async () => {
    const { pager } = make();
    expect(ids(await pager.next())).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    expect(ids(await pager.next())?.[0]).toBe(11);
    expect(ids(await pager.next())).toEqual([21, 22, 23, 24, 25]);
    expect(pager.hasNext).toBe(false);
    expect(await pager.next()).toBeNull();
    expect(ids(await pager.prev())?.[0]).toBe(11); // regression: used to re-serve the current page
    expect(ids(await pager.prev())?.[0]).toBe(1);
    expect(await pager.prev()).toBeNull();
    expect(pager.currentPage).toBe(1);
  });

  it('does not refetch when already at the end', async () => {
    const { client, pager } = make(5);
    await pager.next();
    await pager.next();
    expect(client.request).toHaveBeenCalledTimes(1);
  });

  it('empty results', async () => {
    const { pager } = make(0);
    const page = await pager.next();
    expect(page?.items).toEqual([]);
    expect(await pager.next()).toBeNull();
    expect(pager.hasPrev).toBe(false);
  });

  it('reset() starts over', async () => {
    const { pager } = make();
    await pager.next();
    await pager.next();
    pager.reset();
    expect(pager.currentPage).toBe(0);
    expect(ids(await pager.next())?.[0]).toBe(1);
  });

  it('goto() jumps by page number and prev() still works afterwards', async () => {
    const { pager } = make();
    expect(ids(await pager.goto(3))?.[0]).toBe(21);
    expect(ids(await pager.prev())?.[0]).toBe(11);
    await expect(pager.goto(0)).rejects.toThrow(RangeError);
  });

  it('a failed fetch leaves state untouched', async () => {
    const base = offsetClient(25);
    let fail = false;
    const pager = createPaginator<Tip>(
      (o) => (fail ? Promise.reject(new Error('down')) : listTips(base, o)),
      { limit: 10 }
    );
    await pager.next();
    fail = true;
    await expect(pager.next()).rejects.toThrow('down');
    fail = false;
    expect(ids(await pager.next())?.[0]).toBe(11);
  });

  it('can start from a supplied cursor', async () => {
    const client = offsetClient(50);
    const pager = new Paginator<Tip>((o) => listTips(client, o), {
      limit: 10,
      cursor: encodeCursor(20),
    });
    expect(ids(await pager.next())?.[0]).toBe(21);
  });
});

describe('Paginator (cursor-only backend)', () => {
  it('follows opaque cursors forward and back', async () => {
    const client = cursorClient([[1, 2], [3, 4], [5]]);
    const pager = createPaginator<Tip>((o) => listTips(client, o), { limit: 2 });
    expect(ids(await pager.next())).toEqual([1, 2]);
    expect(ids(await pager.next())).toEqual([3, 4]);
    expect(ids(await pager.next())).toEqual([5]);
    expect(await pager.next()).toBeNull();
    expect(ids(await pager.prev())).toEqual([3, 4]);
    expect(ids(await pager.prev())).toEqual([1, 2]);
  });
});

describe('type inference', () => {
  it('Paginator knows its item shape', () => {
    const pager = createPaginator<Tip>((o) => listTips({ request: async () => ({}) }, o));
    expectTypeOf(pager).toEqualTypeOf<Paginator<Tip>>();
    expectTypeOf<PageItem<typeof pager>>().toEqualTypeOf<Tip>();
    expectTypeOf<PageItem<ReturnType<typeof listTips<Tip>>>>().toEqualTypeOf<Tip>();
    // inferred from the fetcher, no explicit generic needed
    const inferred = createPaginator((o) => listTips({ request: async () => ({}) }, o));
    expectTypeOf<PageItem<typeof inferred>>().toEqualTypeOf<Tip>();
  });
});
