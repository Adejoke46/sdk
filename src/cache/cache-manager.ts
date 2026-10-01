import type { CacheOptions, CacheStats, CacheStrategy } from '../types/cache';

interface CacheEntry {
  method: string;
  params: readonly unknown[];
  value: unknown;
  expiresAt: number;
  frequency: number;
  lastAccessed: number;
  insertedAt: number;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`
      )
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export class CacheManager {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly enabled: boolean;
  private readonly ttl: number;
  private readonly strategy: CacheStrategy;
  private readonly maxSize: number;
  private readonly ttlByMethod: Record<string, number>;
  private hits = 0;
  private misses = 0;
  private sequence = 0;

  constructor(options: CacheOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.ttl = options.ttl ?? 5 * 60 * 1000;
    this.strategy = options.strategy ?? 'lru';
    this.maxSize = options.maxSize ?? 100;
    this.ttlByMethod = options.ttlByMethod ?? {};

    if (!Number.isFinite(this.ttl) || this.ttl < 0) {
      throw new Error('Cache ttl must be a finite number greater than or equal to zero');
    }
    if (!Number.isInteger(this.maxSize) || this.maxSize < 1) {
      throw new Error('Cache maxSize must be a positive integer');
    }
    if (!['lru', 'fifo', 'lfu'].includes(this.strategy)) {
      throw new Error(`Unsupported cache strategy: ${this.strategy}`);
    }
    for (const [method, ttl] of Object.entries(this.ttlByMethod)) {
      if (!method || !Number.isFinite(ttl) || ttl < 0) {
        throw new Error(`Cache TTL override for ${method || 'method'} must be a finite number greater than or equal to zero`);
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  get<T>(method: string, params: readonly unknown[] = []): T | undefined {
    if (!this.enabled) {
      return undefined;
    }

    const key = this.createKey(method, params);
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      if (entry) {
        this.entries.delete(key);
      }
      this.misses++;
      return undefined;
    }

    this.hits++;
    entry.frequency++;
    entry.lastAccessed = ++this.sequence;
    if (this.strategy === 'lru') {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry.value as T;
  }

  set<T>(
    method: string,
    params: readonly unknown[],
    value: T,
    ttl = this.ttlByMethod[method] ?? this.ttl
  ): void {
    if (!this.enabled || ttl === 0) {
      return;
    }
    if (!Number.isFinite(ttl) || ttl < 0) {
      throw new Error('Cache entry ttl must be a finite number greater than or equal to zero');
    }

    const key = this.createKey(method, params);
    const now = ++this.sequence;
    this.pruneExpired(Date.now());

    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, {
      method,
      params: [...params],
      value,
      expiresAt: Date.now() + ttl,
      frequency: 0,
      lastAccessed: now,
      insertedAt: now,
    });

    while (this.entries.size > this.maxSize) {
      this.evictOne();
    }
  }

  invalidate(method: string, ...params: unknown[]): boolean {
    this.pruneExpired(Date.now());
    const serializedParams = params.map(stableSerialize);
    let invalidated = false;

    for (const [key, entry] of this.entries) {
      const matches =
        entry.method === method &&
        serializedParams.length <= entry.params.length &&
        serializedParams.every(
          (param, index) => param === stableSerialize(entry.params[index])
        );
      if (matches) {
        this.entries.delete(key);
        invalidated = true;
      }
    }

    return invalidated;
  }

  clear(): void {
    this.entries.clear();
  }

  getStats(): CacheStats {
    this.pruneExpired(Date.now());
    return { hits: this.hits, misses: this.misses, size: this.entries.size };
  }

  private createKey(method: string, params: readonly unknown[]): string {
    return `${method}:${stableSerialize(params)}`;
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  private evictOne(): void {
    let victimKey: string | undefined;
    let victim: CacheEntry | undefined;

    for (const [key, entry] of this.entries) {
      if (
        !victim ||
        (this.strategy === 'lfu' &&
          (entry.frequency < victim.frequency ||
            (entry.frequency === victim.frequency && entry.lastAccessed < victim.lastAccessed))) ||
        (this.strategy === 'fifo' && entry.insertedAt < victim.insertedAt)
      ) {
        victimKey = key;
        victim = entry;
      }
    }

    if (victimKey !== undefined) {
      this.entries.delete(victimKey);
    }
  }
}