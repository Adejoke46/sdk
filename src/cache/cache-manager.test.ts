import { afterEach, describe, expect, it, vi } from 'vitest';
import { CacheManager } from './cache-manager';

afterEach(() => {
  vi.useRealTimers();
});

describe('CacheManager', () => {
  it('is disabled by default and supports method/parameter invalidation', () => {
    const disabledCache = new CacheManager();
    disabledCache.set('getTip', ['tip-1'], { id: 'tip-1' });
    expect(disabledCache.get('getTip', ['tip-1'])).toBeUndefined();

    const cache = new CacheManager({ enabled: true });
    cache.set('getTip', ['tip-1'], { id: 'tip-1' });
    expect(cache.get('getTip', ['tip-1'])).toEqual({ id: 'tip-1' });
    expect(cache.invalidate('getTip', 'tip-1')).toBe(true);
    expect(cache.invalidate('getTip', 'tip-1')).toBe(false);
    expect(cache.getStats()).toEqual({ hits: 1, misses: 0, size: 0 });
  });

  it('creates stable keys independent of object property insertion order', () => {
    const cache = new CacheManager({ enabled: true });
    cache.set('listTips', [{ creatorId: 'creator-1', page: 2 }], ['tip-1']);

    expect(
      cache.get('listTips', [{ page: 2, creatorId: 'creator-1' }])
    ).toEqual(['tip-1']);
  });

  it('expires entries at their TTL and honors method-specific TTL overrides', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const cache = new CacheManager({
      enabled: true,
      ttl: 1000,
      ttlByMethod: { getTip: 100 },
    });

    cache.set('getTip', ['tip-1'], { id: 'tip-1' });
    cache.set('getCreator', ['creator-1'], { id: 'creator-1' });
    vi.advanceTimersByTime(101);

    expect(cache.get('getTip', ['tip-1'])).toBeUndefined();
    expect(cache.get('getCreator', ['creator-1'])).toEqual({ id: 'creator-1' });
    expect(cache.getStats()).toMatchObject({ hits: 1, misses: 1 });
    expect(cache.getStats().size).toBe(1);
  });

  it('evicts the least recently used entry', () => {
    const cache = new CacheManager({ enabled: true, strategy: 'lru', maxSize: 2 });
    cache.set('GET', ['/a'], 'a');
    cache.set('GET', ['/b'], 'b');
    cache.get('GET', ['/a']);
    cache.set('GET', ['/c'], 'c');

    expect(cache.get('GET', ['/a'])).toBe('a');
    expect(cache.get('GET', ['/b'])).toBeUndefined();
    expect(cache.get('GET', ['/c'])).toBe('c');
  });

  it('evicts the oldest inserted entry for FIFO without refreshing on read', () => {
    const cache = new CacheManager({ enabled: true, strategy: 'fifo', maxSize: 2 });
    cache.set('GET', ['/a'], 'a');
    cache.set('GET', ['/b'], 'b');
    cache.get('GET', ['/a']);
    cache.set('GET', ['/c'], 'c');

    expect(cache.get('GET', ['/a'])).toBeUndefined();
    expect(cache.get('GET', ['/b'])).toBe('b');
  });

  it('evicts the least frequently used entry', () => {
    const cache = new CacheManager({ enabled: true, strategy: 'lfu', maxSize: 2 });
    cache.set('GET', ['/a'], 'a');
    cache.set('GET', ['/b'], 'b');
    cache.get('GET', ['/a']);
    cache.get('GET', ['/a']);
    cache.set('GET', ['/c'], 'c');

    expect(cache.get('GET', ['/a'])).toBe('a');
    expect(cache.get('GET', ['/b'])).toBeUndefined();
    expect(cache.get('GET', ['/c'])).toBe('c');
  });

  it('clears all entries and validates cache limits', () => {
    const cache = new CacheManager({ enabled: true });
    cache.set('GET', ['/a'], 'a');
    cache.clear();

    expect(cache.getStats().size).toBe(0);
    expect(() => new CacheManager({ maxSize: 0 })).toThrow('maxSize');
    expect(() => new CacheManager({ ttl: -1 })).toThrow('ttl');
  });
});