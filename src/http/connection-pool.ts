import type { Agent as HttpAgent } from 'http';
import type { Agent as HttpsAgent } from 'https';

const isNode =
  typeof process !== 'undefined' &&
  process !== null &&
  typeof process.versions === 'object' &&
  process.versions !== null &&
  typeof process.versions.node === 'string';

export interface ConnectionPoolOptions {
  maxConnections?: number;
  idleTimeoutMs?: number;
  keepAlive?: boolean;
  keepAliveTimeoutMs?: number;
  maxIdle?: number;
  maxFreeSockets?: number;
}

export interface ConnectionPoolStats {
  maxConnections: number;
  active: number;
  idle: number;
  available: number;
  waiting: number;
  queued: number;
  totalAcquired: number;
  totalReleased: number;
}

type Waiter = { resolve: (release: () => void) => void; reject: (error: Error) => void };

type IdleEntry = { id: number; timer: ReturnType<typeof setTimeout> };

export class ConnectionPool {
  public readonly maxConnections: number;
  public readonly idleTimeoutMs: number;
  public readonly keepAlive: boolean;
  public readonly keepAliveTimeoutMs: number;
  public readonly maxIdle: number;
  public readonly maxFreeSockets: number;

  private active = 0;
  private idle = 0;
  private totalAcquired = 0;
  private totalReleased = 0;
  private destroyed = false;
  private waiting: Waiter[] = [];
  private idleQueue: IdleEntry[] = [];
  private nextIdleId = 0;

  private httpAgent: HttpAgent | null = null;
  private httpsAgent: HttpsAgent | null = null;
  private agentsResolved = false;

  constructor(options: ConnectionPoolOptions = {}) {
    this.maxConnections = Math.max(1, Math.floor(options.maxConnections ?? 10));
    this.idleTimeoutMs = Math.max(0, options.idleTimeoutMs ?? 30_000);
    this.keepAlive = options.keepAlive ?? true;
    this.keepAliveTimeoutMs = Math.max(0, options.keepAliveTimeoutMs ?? 30_000);
    this.maxIdle = Math.max(0, options.maxIdle ?? this.maxConnections);
    this.maxFreeSockets = Math.max(0, options.maxFreeSockets ?? this.maxIdle);
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.destroyed) {
      throw new Error('Connection pool destroyed');
    }

    while (this.idleQueue.length > 0) {
      const entry = this.idleQueue.shift();
      if (!entry) continue;
      this.idle--;
      this.active++;
      this.totalAcquired++;
      return this.lease();
    }

    if (this.active < this.maxConnections) {
      this.active++;
      this.totalAcquired++;
      return this.lease();
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      const onAbort = () => {
        this.waiting = this.waiting.filter((candidate) => candidate !== waiter);
        reject(new DOMException('The operation was aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      waiter.resolve = (release) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(release);
      };
      this.waiting.push(waiter);
    });
  }

  stats(): ConnectionPoolStats {
    return {
      maxConnections: this.maxConnections,
      active: this.active,
      idle: this.idle,
      available: this.maxConnections - this.active,
      waiting: this.waiting.length,
      queued: this.waiting.length,
      totalAcquired: this.totalAcquired,
      totalReleased: this.totalReleased,
    };
  }

  getKeepAliveHeaders(): Record<string, string> {
    if (!this.keepAlive) return {};
    const headers: Record<string, string> = { Connection: 'keep-alive' };
    if (this.keepAliveTimeoutMs > 0) {
      headers['Keep-Alive'] = `timeout=${Math.floor(this.keepAliveTimeoutMs / 1000)}`;
    }
    return headers;
  }

  async getAgent(url: string): Promise<HttpAgent | HttpsAgent | undefined> {
    if (!isNode || this.destroyed) return undefined;
    await this.resolveNodeAgents();
    return url.startsWith('https://') ? this.httpsAgent : this.httpAgent;
  }

  clear(): void {
    for (const entry of this.idleQueue) clearTimeout(entry.timer);
    this.idleQueue = [];
    this.idle = 0;
    const error = new Error('Connection pool cleared');
    for (const waiter of this.waiting.splice(0)) waiter.reject(error);
  }

  destroy(): void {
    this.destroyed = true;
    this.clear();
    this.httpAgent = null;
    this.httpsAgent = null;
    this.agentsResolved = false;
  }

  private async resolveNodeAgents(): Promise<void> {
    if (this.agentsResolved) return;
    this.agentsResolved = true;
    if (!isNode) return;
    try {
      const http = await import('http');
      const https = await import('https');
      const agentOptions = {
        keepAlive: this.keepAlive,
        keepAliveMsecs: this.keepAlive ? this.keepAliveTimeoutMs : 1000,
        maxSockets: this.maxConnections,
        maxFreeSockets: this.maxFreeSockets,
      };
      this.httpAgent = new http.Agent(agentOptions);
      this.httpsAgent = new https.Agent(agentOptions);
    } catch {
      // Node agents unavailable; the pool still works as a fetch concurrency limiter.
    }
  }

  private lease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.releaseSlot();
    };
  }

  private releaseSlot(): void {
    if (this.destroyed) return;
    this.active--;
    this.totalReleased++;
    const waiter = this.waiting.shift();
    if (waiter) {
      this.active++;
      this.totalAcquired++;
      waiter.resolve(this.lease());
      return;
    }
    if (this.idle >= this.maxIdle) return;
    const entry: IdleEntry = { id: this.nextIdleId++, timer: 0 };
    this.idleQueue.push(entry);
    this.idle++;
    if (this.idleTimeoutMs > 0) {
      entry.timer = setTimeout(() => {
        const index = this.idleQueue.indexOf(entry);
        if (index === -1) return;
        this.idleQueue.splice(index, 1);
        this.idle--;
      }, this.idleTimeoutMs);
    }
  }
}
