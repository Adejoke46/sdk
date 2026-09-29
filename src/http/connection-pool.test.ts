import { describe, expect, it } from 'vitest';
import { ConnectionPool } from './connection-pool';

describe('ConnectionPool', () => {
  it('limits active leases and wakes waiters in FIFO order', async () => {
    const pool = new ConnectionPool({ maxConnections: 1 });
    const release = await pool.acquire();
    let acquired = false;
    const waiting = pool.acquire().then((done) => {
      acquired = true;
      return done;
    });
    await Promise.resolve();
    expect(acquired).toBe(false);
    expect(pool.stats()).toMatchObject({ active: 1, waiting: 1, available: 0 });
    release();
    const releaseSecond = await waiting;
    expect(acquired).toBe(true);
    releaseSecond();
    expect(pool.stats()).toMatchObject({ active: 0, waiting: 0, totalAcquired: 2 });
  });

  it('makes release idempotent and rejects aborted acquisition', async () => {
    const pool = new ConnectionPool({ maxConnections: 1 });
    const release = await pool.acquire();
    const controller = new AbortController();
    const waiting = pool.acquire(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
    release();
    release();
    expect(pool.stats().active).toBe(0);
  });
});
