/**
 * Offline Storage Backends (Issue #129)
 *
 * Storage abstraction layer with multiple backend implementations:
 * - MemoryStorage: In-memory storage (no persistence)
 * - IndexedDBStorage: Browser IndexedDB storage
 * - SQLiteStorage: SQLite storage for Node.js environments
 */

import type {
  IStorageBackend,
  QueuedOperation,
  OperationFilter,
  StorageBackendOptions,
  OperationStatus,
  OperationType,
} from '../types/offline';

/**
 * Base storage backend with common filtering and sorting logic
 */
abstract class BaseStorage implements IStorageBackend {
  protected options: StorageBackendOptions;

  constructor(options: StorageBackendOptions = {}) {
    this.options = {
      databaseName: 'dorisio-offline',
      maxOperations: 1000,
      autoCleanup: true,
      cleanupInterval: 60000, // 1 minute
      ...options,
    };
  }

  abstract initialize(): Promise<void>;
  abstract saveOperation(operation: QueuedOperation): Promise<void>;
  abstract getOperation(id: string): Promise<QueuedOperation | null>;
  abstract getOperations(filter?: OperationFilter): Promise<QueuedOperation[]>;
  abstract updateOperation(id: string, updates: Partial<QueuedOperation>): Promise<void>;
  abstract deleteOperation(id: string): Promise<void>;
  abstract deleteOperations(ids: string[]): Promise<void>;
  abstract clearAll(): Promise<void>;
  abstract getCount(filter?: OperationFilter): Promise<number>;
  abstract close(): Promise<void>;

  /**
   * Apply filters to a list of operations
   */
  protected filterOperations(
    operations: QueuedOperation[],
    filter?: OperationFilter
  ): QueuedOperation[] {
    if (!filter) return operations;

    let filtered = [...operations];

    // Filter by status
    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      filtered = filtered.filter((op) => statuses.includes(op.status));
    }

    // Filter by type
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      filtered = filtered.filter((op) => types.includes(op.type));
    }

    // Filter by timestamp range
    if (filter.after !== undefined) {
      const after = filter.after;
      filtered = filtered.filter((op) => op.timestamp > after);
    }
    if (filter.before !== undefined) {
      const before = filter.before;
      filtered = filtered.filter((op) => op.timestamp < before);
    }

    // Sort operations
    if (filter.sortBy) {
      const sortOrder = filter.sortOrder === 'desc' ? -1 : 1;
      filtered.sort((a, b) => {
        let aVal: number;
        let bVal: number;

        switch (filter.sortBy) {
          case 'timestamp':
            aVal = a.timestamp;
            bVal = b.timestamp;
            break;
          case 'priority':
            aVal = a.priority ?? 0;
            bVal = b.priority ?? 0;
            break;
          case 'attempts':
            aVal = a.attempts;
            bVal = b.attempts;
            break;
          default:
            return 0;
        }

        return (aVal - bVal) * sortOrder;
      });
    }

    // Apply limit
    if (filter.limit !== undefined && filter.limit > 0) {
      filtered = filtered.slice(0, filter.limit);
    }

    return filtered;
  }
}

/**
 * In-Memory Storage Backend
 * 
 * Stores operations in memory. Data is lost when the process exits.
 * Useful for testing or temporary offline support.
 */
export class MemoryStorage extends BaseStorage {
  private operations: Map<string, QueuedOperation> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    this.operations.clear();
    this.initialized = true;
  }

  async saveOperation(operation: QueuedOperation): Promise<void> {
    this.ensureInitialized();
    
    // Enforce max operations limit
    if (
      this.options.maxOperations &&
      this.operations.size >= this.options.maxOperations &&
      !this.operations.has(operation.id)
    ) {
      // Remove oldest operation
      const oldest = this.findOldestOperation();
      if (oldest) {
        this.operations.delete(oldest.id);
      }
    }

    this.operations.set(operation.id, { ...operation });
  }

  async getOperation(id: string): Promise<QueuedOperation | null> {
    this.ensureInitialized();
    const operation = this.operations.get(id);
    return operation ? { ...operation } : null;
  }

  async getOperations(filter?: OperationFilter): Promise<QueuedOperation[]> {
    this.ensureInitialized();
    const allOperations = Array.from(this.operations.values());
    return this.filterOperations(allOperations, filter);
  }

  async updateOperation(id: string, updates: Partial<QueuedOperation>): Promise<void> {
    this.ensureInitialized();
    const existing = this.operations.get(id);
    if (!existing) {
      throw new Error(`Operation ${id} not found`);
    }
    this.operations.set(id, { ...existing, ...updates });
  }

  async deleteOperation(id: string): Promise<void> {
    this.ensureInitialized();
    this.operations.delete(id);
  }

  async deleteOperations(ids: string[]): Promise<void> {
    this.ensureInitialized();
    for (const id of ids) {
      this.operations.delete(id);
    }
  }

  async clearAll(): Promise<void> {
    this.ensureInitialized();
    this.operations.clear();
  }

  async getCount(filter?: OperationFilter): Promise<number> {
    this.ensureInitialized();
    if (!filter) {
      return this.operations.size;
    }
    const filtered = await this.getOperations(filter);
    return filtered.length;
  }

  async close(): Promise<void> {
    this.operations.clear();
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('MemoryStorage not initialized. Call initialize() first.');
    }
  }

  private findOldestOperation(): QueuedOperation | null {
    let oldest: QueuedOperation | null = null;
    for (const op of this.operations.values()) {
      if (!oldest || op.timestamp < oldest.timestamp) {
        oldest = op;
      }
    }
    return oldest;
  }
}

/**
 * IndexedDB Storage Backend
 * 
 * Stores operations in browser IndexedDB for persistent offline storage.
 * Available in browser environments.
 */
export class IndexedDBStorage extends BaseStorage {
  private db: IDBDatabase | null = null;
  private readonly storeName = 'operations';
  private readonly version = 1;

  async initialize(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is not available in this environment');
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.options.databaseName!, this.version);

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          
          // Create indexes for efficient querying
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('type', 'type', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('priority', 'priority', { unique: false });
        }
      };
    });
  }

  async saveOperation(operation: QueuedOperation): Promise<void> {
    this.ensureInitialized();

    // Check and enforce max operations limit
    const count = await this.getCount();
    if (
      this.options.maxOperations &&
      count >= this.options.maxOperations
    ) {
      // Remove oldest operation
      const oldest = await this.findOldestOperation();
      if (oldest) {
        await this.deleteOperation(oldest.id);
      }
    }

    return new Promise((resolve, reject) => {
      const db = this.db;
      if (!db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(operation);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to save operation: ${request.error?.message}`));
    });
  }

  async getOperation(id: string): Promise<QueuedOperation | null> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const db = this.db;
      if (!db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(id);

      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => reject(new Error(`Failed to get operation: ${request.error?.message}`));
    });
  }

  async getOperations(filter?: OperationFilter): Promise<QueuedOperation[]> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const db = this.db;
      if (!db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const operations = request.result as QueuedOperation[];
        resolve(this.filterOperations(operations, filter));
      };
      request.onerror = () => reject(new Error(`Failed to get operations: ${request.error?.message}`));
    });
  }

  async updateOperation(id: string, updates: Partial<QueuedOperation>): Promise<void> {
    this.ensureInitialized();

    const existing = await this.getOperation(id);
    if (!existing) {
      throw new Error(`Operation ${id} not found`);
    }

    const updated = { ...existing, ...updates };
    await this.saveOperation(updated);
  }

  async deleteOperation(id: string): Promise<void> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const db = this.db;
      if (!db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to delete operation: ${request.error?.message}`));
    });
  }

  async deleteOperations(ids: string[]): Promise<void> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const db = this.db;
      if (!db) {
        reject(new Error('Database not initialized'));
        return;
      }

      const transaction = db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      let completed = 0;
      let hasError = false;

      for (const id of ids) {
        const request = store.delete(id);
        
        request.onsuccess = () => {
          completed++;
          if (completed === ids.length && !hasError) {
            resolve();
          }
        };
        
        request.onerror = () => {
          hasError = true;
          reject(new Error(`Failed to delete operation ${id}: ${request.error?.message}`));
        };
      }

      if (ids.length === 0) {
        resolve();
      }
    });
  }

  async clearAll(): Promise<void> {
    this.ensureInitialized();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(`Failed to clear operations: ${request.error?.message}`));
    });
  }

  async getCount(filter?: OperationFilter): Promise<number> {
    this.ensureInitialized();

    if (!filter) {
      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.count();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error(`Failed to count operations: ${request.error?.message}`));
      });
    }

    // For filtered counts, get all and filter
    const operations = await this.getOperations(filter);
    return operations.length;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private ensureInitialized(): void {
    if (!this.db) {
      throw new Error('IndexedDBStorage not initialized. Call initialize() first.');
    }
  }

  private async findOldestOperation(): Promise<QueuedOperation | null> {
    const operations = await this.getOperations({
      sortBy: 'timestamp',
      sortOrder: 'asc',
      limit: 1,
    });
    return operations[0] || null;
  }
}

/**
 * SQLite Storage Backend
 * 
 * Stores operations in SQLite database for Node.js environments.
 * Requires better-sqlite3 or similar SQLite library.
 */
export class SQLiteStorage extends BaseStorage {
  private db: any = null;
  private initialized = false;

  async initialize(): Promise<void> {
    // Check if we're in a Node.js environment
    if (typeof process === 'undefined' || typeof require === 'undefined') {
      throw new Error('SQLite storage is only available in Node.js environments');
    }

    try {
      // Try to dynamically import better-sqlite3
      // This is optional and will fail gracefully if not installed
      const Database = await this.loadSQLiteModule();
      
      this.db = new Database(this.options.databaseName || ':memory:');
      
      // Create operations table
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS operations (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          method TEXT NOT NULL,
          path TEXT NOT NULL,
          data TEXT,
          headers TEXT,
          status TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          attempts INTEGER NOT NULL,
          error TEXT,
          idempotencyKey TEXT,
          priority INTEGER,
          metadata TEXT
        );
        
        CREATE INDEX IF NOT EXISTS idx_status ON operations(status);
        CREATE INDEX IF NOT EXISTS idx_type ON operations(type);
        CREATE INDEX IF NOT EXISTS idx_timestamp ON operations(timestamp);
        CREATE INDEX IF NOT EXISTS idx_priority ON operations(priority);
      `);

      this.initialized = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize SQLite storage: ${error instanceof Error ? error.message : String(error)}. ` +
        `Make sure 'better-sqlite3' is installed: npm install better-sqlite3`
      );
    }
  }

  private async loadSQLiteModule(): Promise<any> {
    // Try to load better-sqlite3
    try {
      // In ESM context, we need to use dynamic import
      const module = await import('better-sqlite3');
      return module.default || module;
    } catch {
      // Fallback: throw error with installation instructions
      throw new Error('SQLite module not found');
    }
  }

  async saveOperation(operation: QueuedOperation): Promise<void> {
    this.ensureInitialized();

    // Check and enforce max operations limit
    const count = await this.getCount();
    if (
      this.options.maxOperations &&
      count >= this.options.maxOperations
    ) {
      // Remove oldest operation
      const oldest = await this.findOldestOperation();
      if (oldest) {
        await this.deleteOperation(oldest.id);
      }
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO operations (
        id, type, method, path, data, headers, status, timestamp,
        attempts, error, idempotencyKey, priority, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      operation.id,
      operation.type,
      operation.method,
      operation.path,
      operation.data ? JSON.stringify(operation.data) : null,
      operation.headers ? JSON.stringify(operation.headers) : null,
      operation.status,
      operation.timestamp,
      operation.attempts,
      operation.error || null,
      operation.idempotencyKey || null,
      operation.priority ?? null,
      operation.metadata ? JSON.stringify(operation.metadata) : null
    );
  }

  async getOperation(id: string): Promise<QueuedOperation | null> {
    this.ensureInitialized();

    const stmt = this.db.prepare('SELECT * FROM operations WHERE id = ?');
    const row = stmt.get(id);

    return row ? this.rowToOperation(row) : null;
  }

  async getOperations(filter?: OperationFilter): Promise<QueuedOperation[]> {
    this.ensureInitialized();

    let query = 'SELECT * FROM operations WHERE 1=1';
    const params: any[] = [];

    // Build WHERE clause
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      query += ` AND status IN (${statuses.map(() => '?').join(',')})`;
      params.push(...statuses);
    }

    if (filter?.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      query += ` AND type IN (${types.map(() => '?').join(',')})`;
      params.push(...types);
    }

    if (filter?.after !== undefined) {
      query += ' AND timestamp > ?';
      params.push(filter.after);
    }

    if (filter?.before !== undefined) {
      query += ' AND timestamp < ?';
      params.push(filter.before);
    }

    // Add ORDER BY
    if (filter?.sortBy) {
      const sortOrder = filter.sortOrder === 'desc' ? 'DESC' : 'ASC';
      query += ` ORDER BY ${filter.sortBy} ${sortOrder}`;
    } else {
      query += ' ORDER BY timestamp ASC';
    }

    // Add LIMIT
    if (filter?.limit !== undefined && filter.limit > 0) {
      query += ' LIMIT ?';
      params.push(filter.limit);
    }

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);

    return rows.map((row: any) => this.rowToOperation(row));
  }

  async updateOperation(id: string, updates: Partial<QueuedOperation>): Promise<void> {
    this.ensureInitialized();

    const existing = await this.getOperation(id);
    if (!existing) {
      throw new Error(`Operation ${id} not found`);
    }

    const updated = { ...existing, ...updates };
    await this.saveOperation(updated);
  }

  async deleteOperation(id: string): Promise<void> {
    this.ensureInitialized();

    const stmt = this.db.prepare('DELETE FROM operations WHERE id = ?');
    stmt.run(id);
  }

  async deleteOperations(ids: string[]): Promise<void> {
    this.ensureInitialized();

    if (ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(',');
    const stmt = this.db.prepare(`DELETE FROM operations WHERE id IN (${placeholders})`);
    stmt.run(...ids);
  }

  async clearAll(): Promise<void> {
    this.ensureInitialized();

    this.db.exec('DELETE FROM operations');
  }

  async getCount(filter?: OperationFilter): Promise<number> {
    this.ensureInitialized();

    if (!filter) {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM operations');
      const result = stmt.get();
      return result.count;
    }

    // For filtered counts, use same logic as getOperations but count
    const operations = await this.getOperations(filter);
    return operations.length;
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('SQLiteStorage not initialized. Call initialize() first.');
    }
  }

  private rowToOperation(row: any): QueuedOperation {
    return {
      id: row.id,
      type: row.type as OperationType,
      method: row.method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      path: row.path,
      data: row.data ? JSON.parse(row.data) : undefined,
      headers: row.headers ? JSON.parse(row.headers) : undefined,
      status: row.status as OperationStatus,
      timestamp: row.timestamp,
      attempts: row.attempts,
      error: row.error || undefined,
      idempotencyKey: row.idempotencyKey || undefined,
      priority: row.priority ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  private async findOldestOperation(): Promise<QueuedOperation | null> {
    const operations = await this.getOperations({
      sortBy: 'timestamp',
      sortOrder: 'asc',
      limit: 1,
    });
    return operations[0] || null;
  }
}

/**
 * Factory function to create storage backend instances
 */
export function createStorageBackend(
  type: 'memory' | 'idb' | 'sqlite',
  options?: StorageBackendOptions
): IStorageBackend {
  switch (type) {
    case 'memory':
      return new MemoryStorage(options);
    case 'idb':
      return new IndexedDBStorage(options);
    case 'sqlite':
      return new SQLiteStorage(options);
    default:
      throw new Error(`Unknown storage backend type: ${type}`);
  }
}
