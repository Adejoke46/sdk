import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionPool } from '../../src/http/connection-pool';

afterEach(() => {
  vi.useRealTimers();
});

describe('ConnectionPool', () => {
  describe('configuration & defaults', () => {
    it('uses sensible defaults', () => {
      const pool = new ConnectionPool();
      expect(pool.maxConnections).toBe(10);
      expect(pool.idleTimeoutMs).toBe(30_000);
      expect(pool.keepAlive).toBe(true);
      expect(pool.keepAliveTimeoutMs).toBe(30_000);
      expect(pool.maxIdle).toBe(10);
      pool.destroy();
    });

    it('applies custom options', () => {
      const pool = new ConnectionPool({
        maxConnections: 5,
        idleTimeoutMs: 10_000,
        keepAlive: false,
        keepAliveTimeoutMs: 120_000,
        maxIdle: 3,
        maxFreeSockets: 2,
      });
      expect(pool.maxConnections).toBe(5);
      expect(pool.idleTimeoutMs).toBe(10_000);
      expect(pool.keepAlive).toBe(false);
      expect(pool.keepAliveTimeoutMs).toBe(120_000);
      expect(pool.maxIdle).toBe(3);
      expect(pool.maxFreeSockets).toBe(2);
      pool.destroy();
    });

    it('clamps maxConnections to at least 1', () => {
      const pool = new ConnectionPool({ maxConnections: 0 });
      expect(pool.maxConnections).toBe(1);
      pool.destroy();
    });
  });

  describe('keep-alive', () => {
    it('enables keep-alive by default', () => {
      const pool = new ConnectionPool();
      const headers = pool.getKeepAliveHeaders();
      expect(headers.Connection).toBe('keep-alive');
      expect(headers['Keep-Alive']).toBe('timeout=30');
      pool.destroy();
    });

    it('omits keep-alive headers when disabled', () => {
      const pool = new ConnectionPool({ keepAlive: false });
      expect(pool.getKeepAliveHeaders()).toEqual({});
      pool.destroy();
    });

    it('reflects custom keep-alive timeout in seconds', () => {
      const pool = new ConnectionPool({ keepAliveTimeoutMs: 120_000 });
      expect(pool.getKeepAliveHeaders()['Keep-Alive']).toBe('timeout=120');
      pool.destroy();
    });
  });

  describe('acquire / release lifecycle', () => {
    it('tracks active and idle connections across acquire and release', async () => {
      const pool = new ConnectionPool({ maxConnections: 5 });
      const release = await pool.acquire();
      expect(pool.stats()).toMatchObject({ active: 1, idle: 0 });
      release();
      expect(pool.stats()).toMatchObject({ active: 0, idle: 1 });
      pool.destroy();
    });

    it('reuses an idle connection instead of opening a new slot', async () => {
      const pool = new ConnectionPool({ maxConnections: 2 });
      const r1 = await pool.acquire();
      const r2 = await pool.acquire();
      expect(pool.stats()).toMatchObject({ active: 2, idle: 0, totalAcquired: 2 });

      r1();
      expect(pool.stats()).toMatchObject({ active: 1, idle: 1, totalReleased: 1 });

      const r3 = await pool.acquire();
      expect(pool.stats()).toMatchObject({ active: 2, idle: 0, totalAcquired: 3 });

      r2();
      r3();
      expect(pool.stats()).toMatchObject({ active: 0, totalReleased: 3 });
      pool.destroy();
    });

    it('supports concurrent acquires up to maxConnections', async () => {
      const pool = new ConnectionPool({ maxConnections: 3 });
      const leases = await Promise.all([
        pool.acquire(),
        pool.acquire(),
        pool.acquire(),
      ]);
      expect(pool.stats().active).toBe(3);

      const overflow = pool.acquire();
      await Promise.resolve();
      expect(pool.stats().waiting).toBe(1);

      leases.forEach((release) => release());
      const overflowRelease = await overflow;
      overflowRelease();
      expect(pool.stats().active).toBe(0);
      pool.destroy();
    });

    it('tracks total acquired and released counts', async () => {
      const pool = new ConnectionPool({ maxConnections: 2 });
      const r1 = await pool.acquire();
      const r2 = await pool.acquire();
      expect(pool.stats().totalAcquired).toBe(2);

      r1();
      r2();
      expect(pool.stats().totalReleased).toBe(2);
      expect(pool.stats().active).toBe(0);
      pool.destroy();
    });

    it('makes release idempotent', async () => {
      const pool = new ConnectionPool({ maxConnections: 1 });
      const release = await pool.acquire();
      release();
      release();
      release();
      expect(pool.stats().active).toBe(0);
      expect(pool.stats().totalReleased).toBe(1);
      pool.destroy();
    });
  });

  describe('overflow queue', () => {
    it('queues acquisitions beyond maxConnections and reports waiting', async () => {
      const pool = new ConnectionPool({ maxConnections: 1 });
      const r1 = await pool.acquire();
      expect(pool.stats()).toMatchObject({ active: 1, waiting: 0, queued: 0 });

      const second = pool.acquire();
      await Promise.resolve();
      expect(pool.stats()).toMatchObject({ active: 1, waiting: 1, queued: 1 });

      r1();
      await second;
      expect(pool.stats()).toMatchObject({ active: 1, waiting: 0, queued: 0 });
      await second;
      pool.destroy();
    });

    it('wakes waiters in FIFO order', async () => {
      const pool = new ConnectionPool({ maxConnections: 1 });
      const order: number[] = [];

      const r1 = await pool.acquire();
      const p1 = pool.acquire().then((release) => {
        order.push(1);
        return release;
      });
      const p2 = pool.acquire().then((release) => {
        order.push(2);
        return release;
      });
      const p3 = pool.acquire().then((release) => {
        order.push(3);
        return release;
      });

      await Promise.resolve();
      expect(pool.stats().waiting).toBe(3);

      r1();
      const rel1 = await p1;
      expect(order).toEqual([1]);

      rel1();
      const rel2 = await p2;
      expect(order).toEqual([1, 2]);

      rel2();
      const rel3 = await p3;
      expect(order).toEqual([1, 2, 3]);

      rel3();
      expect(pool.stats()).toMatchObject({ active: 0, waiting: 0, totalAcquired: 4 });
      pool.destroy();
    });

    it('rejects a queued acquisition when the signal aborts', async () => {
      const pool = new ConnectionPool({ maxConnections: 1 });
      await pool.acquire();

      const controller = new AbortController();
      const waiting = pool.acquire(controller.signal);
      controller.abort();

      await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
      expect(pool.stats().waiting).toBe(0);
      pool.destroy();
    });

    it('clears and rejects all pending waiters', async () => {
      const pool = new ConnectionPool({ maxConnections: 1 });
      await pool.acquire();
      const p2 = pool.acquire();
      const p3 = pool.acquire();

      pool.clear();
      await expect(p2).rejects.toThrow('Connection pool cleared');
      await expect(p3).rejects.toThrow('Connection pool cleared');

      expect(pool.stats().waiting).toBe(0);
      expect(pool.stats().queued).toBe(0);
      pool.destroy();
    });
  });

  describe('idle eviction & timeout', () => {
    it('evicts idle connections after idleTimeoutMs', async () => {
      vi.useFakeTimers();
      const pool = new ConnectionPool({ maxConnections: 5, idleTimeoutMs: 1000 });
      const release = await pool.acquire();
      release();
      expect(pool.stats().idle).toBe(1);

      vi.advanceTimersByTime(1000);
      expect(pool.stats().idle).toBe(0);
      pool.destroy();
    });

    it('does not evict idle connections when idleTimeoutMs is 0', async () => {
      vi.useFakeTimers();
      const pool = new ConnectionPool({ maxConnections: 5, idleTimeoutMs: 0 });
      const release = await pool.acquire();
      release();
      expect(pool.stats().idle).toBe(1);

      vi.advanceTimersByTime(60_000);
      expect(pool.stats().idle).toBe(1);
      pool.destroy();
    });

    it('caps retained idle connections at maxIdle', async () => {
      const pool = new ConnectionPool({ maxConnections: 5, maxIdle: 2, idleTimeoutMs: 60_000 });
      const r1 = await pool.acquire();
      const r2 = await pool.acquire();
      const r3 = await pool.acquire();
      r1();
      r2();
      r3();
      expect(pool.stats().idle).toBe(2);
      expect(pool.stats().active).toBe(0);
      pool.destroy();
    });

    it('reuses an idle connection before opening a new slot after release', async () => {
      const pool = new ConnectionPool({ maxConnections: 3, idleTimeoutMs: 60_000 });
      const r1 = await pool.acquire();
      r1();
      expect(pool.stats().idle).toBe(1);

      const r2 = await pool.acquire();
      expect(pool.stats().idle).toBe(0);
      expect(pool.stats().active).toBe(1);
      expect(pool.stats().totalAcquired).toBe(2);

      r2();
      pool.destroy();
    });
  });

  describe('agents & headers', () => {
    it('returns a keep-alive http agent for http URLs in Node', async () => {
      const pool = new ConnectionPool({ keepAlive: true, keepAliveTimeoutMs: 30_000 });
      const agent = await pool.getAgent('http://example.com');
      expect(agent).toBeDefined();
      expect((agent as { keepAlive?: boolean }).keepAlive).toBe(true);
      pool.destroy();
    });

    it('returns a keep-alive https agent for https URLs in Node', async () => {
      const pool = new ConnectionPool({ keepAlive: true });
      const agent = await pool.getAgent('https://example.com');
      expect(agent).toBeDefined();
      expect((agent as { keepAlive?: boolean }).keepAlive).toBe(true);
      pool.destroy();
    });

    it('returns undefined for agents when the pool is destroyed', async () => {
      const pool = new ConnectionPool();
      pool.destroy();
      const agent = await pool.getAgent('http://example.com');
      expect(agent).toBeUndefined();
    });

    it('exposes keep-alive headers for transport configuration', () => {
      const pool = new ConnectionPool({ keepAliveTimeoutMs: 45_000 });
      const headers = pool.getKeepAliveHeaders();
      expect(headers).toMatchObject({
        Connection: 'keep-alive',
        'Keep-Alive': 'timeout=45',
      });
      pool.destroy();
    });
  });

  describe('stats getter', () => {
    it('exposes active, idle, queued, and available counts', () => {
      const pool = new ConnectionPool({ maxConnections: 4 });
      expect(pool.stats()).toMatchObject({
        maxConnections: 4,
        active: 0,
        idle: 0,
        available: 4,
        waiting: 0,
        queued: 0,
        totalAcquired: 0,
        totalReleased: 0,
      });
      pool.destroy();
    });

    it('reports available as remaining capacity', async () => {
      const pool = new ConnectionPool({ maxConnections: 3 });
      const r1 = await pool.acquire();
      const r2 = await pool.acquire();
      expect(pool.stats().available).toBe(1);
      expect(pool.stats().active).toBe(2);
      r1();
      r2();
      expect(pool.stats().available).toBe(3);
      pool.destroy();
    });
  });

  describe('lifecycle safety', () => {
    it('throws when acquiring from a destroyed pool', async () => {
      const pool = new ConnectionPool();
      pool.destroy();
      await expect(pool.acquire()).rejects.toThrow('Connection pool destroyed');
    });

    it('is safe to clear and destroy repeatedly', () => {
      const pool = new ConnectionPool({ maxConnections: 2 });
      pool.clear();
      pool.clear();
      pool.destroy();
      pool.destroy();
      expect(pool.stats().maxConnections).toBe(2);
    });
  });
});
