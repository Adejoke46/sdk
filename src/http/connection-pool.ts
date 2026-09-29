/**
 * Lightweight connection-slot pool for fetch-based transports.
 *
 * Browsers and modern Node fetch implementations own the TCP socket pool;
 * this class limits concurrent leases and keeps callers from creating an
 * unbounded burst of transports. The lease API also lets a future Node
 * transport attach a reusable Agent/Client to each slot without changing the
 * HttpClient contract.
 */
export interface ConnectionPoolOptions {
  maxConnections?: number;
  idleTimeoutMs?: number;
}

export interface ConnectionPoolStats {
  maxConnections: number;
  active: number;
  available: number;
  waiting: number;
  totalAcquired: number;
}

type Waiter = { resolve: () => void; reject: (error: Error) => void };

export class ConnectionPool {
  public readonly maxConnections: number;
  public readonly idleTimeoutMs: number;
  private active = 0;
  private waiting: Waiter[] = [];
  private totalAcquired = 0;

  constructor(options: ConnectionPoolOptions = {}) {
    this.maxConnections = Math.max(1, Math.floor(options.maxConnections ?? 10));
    this.idleTimeoutMs = Math.max(0, options.idleTimeoutMs ?? 30_000);
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
    if (this.active < this.maxConnections) {
      this.active++;
      this.totalAcquired++;
      return this.lease();
    }

    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      const onAbort = () => {
        this.waiting = this.waiting.filter((candidate) => candidate !== waiter);
        reject(new DOMException('The operation was aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push({
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      });
    });
    this.active++;
    this.totalAcquired++;
    return this.lease();
  }

  stats(): ConnectionPoolStats {
    return {
      maxConnections: this.maxConnections,
      active: this.active,
      available: this.maxConnections - this.active,
      waiting: this.waiting.length,
      totalAcquired: this.totalAcquired,
    };
  }

  clear(): void {
    const error = new Error('Connection pool cleared');
    for (const waiter of this.waiting.splice(0)) waiter.reject(error);
  }

  private lease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      const next = this.waiting.shift();
      if (next) next.resolve();
    };
  }
}
