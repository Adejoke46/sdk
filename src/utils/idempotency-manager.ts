/** Persist idempotency keys so retries of the same mutation reuse their key. */
export interface IdempotencyRecord {
  key: string;
  method: string;
  path: string;
  createdAt: number;
  expiresAt: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface IdempotencyManagerOptions {
  storageKey?: string;
  ttlMs?: number;
  storage?: StorageLike;
}

const STORAGE_KEY = 'dorisio.idempotency.keys';
const DEFAULT_TTL = 30 * 24 * 60 * 60 * 1000;
const memory = new Map<string, string>();
const memoryStorage: StorageLike = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: (key) => void memory.delete(key),
};

function defaultStorage(): StorageLike {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    // Restricted browser storage; use the in-memory fallback.
  }
  return memoryStorage;
}

function serialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${serialize(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export class IdempotencyManager {
  private readonly storage: StorageLike;
  private readonly storageKey: string;
  private readonly ttlMs: number;

  constructor(options: IdempotencyManagerOptions = {}) {
    this.storage = options.storage ?? defaultStorage();
    this.storageKey = options.storageKey ?? STORAGE_KEY;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL;
  }

  private cacheKey(method: string, path: string, body?: unknown): string {
    return `${method.toUpperCase()}:${path}:${serialize(body)}`;
  }

  private read(): Record<string, IdempotencyRecord> {
    try {
      const raw = this.storage.getItem(this.storageKey);
      const value: unknown = raw ? JSON.parse(raw) : {};
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
      const now = Date.now();
      return Object.fromEntries(
        Object.entries(value as Record<string, IdempotencyRecord>).filter(
          ([, record]) => record && typeof record.key === 'string' && record.expiresAt > now
        )
      );
    } catch {
      return {};
    }
  }

  private write(records: Record<string, IdempotencyRecord>): void {
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(records));
    } catch {
      // A failed persistence attempt must not prevent sending the request.
    }
  }

  getOrCreateKey(method: string, path: string, body?: unknown): string {
    const records = this.read();
    const id = this.cacheKey(method, path, body);
    if (records[id]) return records[id].key;
    const now = Date.now();
    const key = globalThis.crypto?.randomUUID?.() ?? `idem-${now}-${Math.random().toString(36).slice(2)}`;
    records[id] = { key, method: method.toUpperCase(), path, createdAt: now, expiresAt: now + this.ttlMs };
    this.write(records);
    return key;
  }

  setKey(method: string, path: string, key: string, body?: unknown): void {
    const records = this.read();
    const now = Date.now();
    records[this.cacheKey(method, path, body)] = {
      key, method: method.toUpperCase(), path, createdAt: now, expiresAt: now + this.ttlMs,
    };
    this.write(records);
  }

  getKey(method: string, path: string, body?: unknown): string | undefined {
    return this.read()[this.cacheKey(method, path, body)]?.key;
  }

  removeKey(method: string, path: string, body?: unknown): void {
    const records = this.read();
    delete records[this.cacheKey(method, path, body)];
    this.write(records);
  }

  clear(): void {
    try {
      this.storage.removeItem(this.storageKey);
    } catch {
      // Ignore unavailable storage.
    }
  }
}

let defaultManager: IdempotencyManager | undefined;
export function getIdempotencyManager(options?: IdempotencyManagerOptions): IdempotencyManager {
  if (!defaultManager || options) defaultManager = new IdempotencyManager(options);
  return defaultManager;
}
