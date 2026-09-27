/**
 * Offline Queue (Issue #35)
 *
 * Queues mutation requests (POST/PUT/PATCH/DELETE) when offline,
 * allows read requests (GET) to fail immediately,
 * detects online/offline transitions, and automatically retries
 * queued mutations when back online.
 */

import { NetworkError } from '../types/errors';

export type OfflineEventType = 'online' | 'offline' | 'queue-processed';

export interface QueueProcessedResult {
  processedCount: number;
  successCount: number;
  failureCount: number;
}

export type OfflineEventListener = (...args: unknown[]) => void;

export interface OfflineQueueItem<T = unknown> {
  id: string;
  method: string;
  path: string;
  task: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  timestamp: number;
}

export interface OfflineQueueOptions {
  /** Initial online state (defaults to navigator.onLine if available, or true) */
  initialOnline?: boolean;
  /** Automatically bind window online/offline event listeners if available */
  autoListen?: boolean;
}

export class OfflineQueue {
  private online: boolean;
  private queue: OfflineQueueItem<unknown>[] = [];
  private listeners: Map<OfflineEventType, Set<OfflineEventListener>> = new Map();
  private isProcessing: boolean = false;
  private windowOnlineHandler?: () => void;
  private windowOfflineHandler?: () => void;

  constructor(options?: OfflineQueueOptions) {
    if (typeof options?.initialOnline === 'boolean') {
      this.online = options.initialOnline;
    } else if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      this.online = navigator.onLine;
    } else {
      this.online = true;
    }

    if (options?.autoListen !== false && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this.windowOnlineHandler = () => this.setOnline(true);
      this.windowOfflineHandler = () => this.setOnline(false);
      window.addEventListener('online', this.windowOnlineHandler);
      window.addEventListener('offline', this.windowOfflineHandler);
    }
  }

  /**
   * Check current online/offline status.
   */
  isOnline(): boolean {
    return this.online;
  }

  /**
   * Set online/offline status explicitly, emitting events and processing the queue on reconnect.
   */
  setOnline(online: boolean): void {
    if (this.online === online) {
      return;
    }

    this.online = online;

    if (online) {
      this.emit('online');
      void this.processQueue();
    } else {
      this.emit('offline');
    }
  }

  /**
   * Number of mutations currently queued offline.
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Register an event listener for online, offline, or queue-processed events.
   */
  on(event: OfflineEventType, listener: OfflineEventListener): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return this;
  }

  /**
   * Remove a previously registered event listener.
   */
  off(event: OfflineEventType, listener: OfflineEventListener): this {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(listener);
    }
    return this;
  }

  /**
   * Emit an event to registered listeners.
   */
  private emit(event: OfflineEventType, ...args: unknown[]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const listener of set) {
        try {
          listener(...args);
        } catch (err) {
          console.error(`[OfflineQueue] Error in ${event} listener:`, err);
        }
      }
    }
  }

  /**
   * Check if an HTTP method represents a mutation (POST, PUT, PATCH, DELETE).
   */
  isMutation(method: string): boolean {
    const m = method.toUpperCase();
    return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
  }

  /**
   * Handle a request: if offline, mutations are queued and reads fail immediately.
   * If online, execute the task directly.
   */
  async handleRequest<T>(
    method: string,
    path: string,
    task: () => Promise<T>
  ): Promise<T> {
    if (this.online) {
      return task();
    }

    // Device is offline
    if (!this.isMutation(method)) {
      throw new NetworkError(`Cannot perform ${method} ${path} while offline`);
    }

    // Queue mutations when offline
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        method: method.toUpperCase(),
        path,
        task: task as () => Promise<unknown>,
        resolve: resolve as (value: unknown) => void,
        reject,
        timestamp: Date.now(),
      });
    });
  }

  /**
   * Process all queued mutations in FIFO order when connectivity is restored.
   */
  async processQueue(): Promise<QueueProcessedResult> {
    if (this.isProcessing || !this.online || this.queue.length === 0) {
      return { processedCount: 0, successCount: 0, failureCount: 0 };
    }

    this.isProcessing = true;
    let processedCount = 0;
    let successCount = 0;
    let failureCount = 0;

    try {
      while (this.queue.length > 0 && this.online) {
        const item = this.queue[0];
        if (!item) break;

        try {
          const result = await item.task();
          // Remove from queue after success
          this.queue.shift();
          processedCount++;
          successCount++;
          item.resolve(result);
        } catch (error) {
          // If the device went back offline during replay, pause queue
          if (!this.online || (error instanceof NetworkError && !this.online)) {
            break;
          }

          // Permanent failure or API error for this mutation
          this.queue.shift();
          processedCount++;
          failureCount++;
          item.reject(error);
        }
      }
    } finally {
      this.isProcessing = false;
      const summary: QueueProcessedResult = {
        processedCount,
        successCount,
        failureCount,
      };
      this.emit('queue-processed', summary);
    }

    return { processedCount, successCount, failureCount };
  }

  /**
   * Clear the queue, rejecting all pending items.
   */
  clearQueue(reason: Error = new Error('Offline queue cleared')): void {
    const pending = [...this.queue];
    this.queue = [];
    for (const item of pending) {
      item.reject(reason);
    }
  }

  /**
   * Clean up event listeners.
   */
  dispose(): void {
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      if (this.windowOnlineHandler) {
        window.removeEventListener('online', this.windowOnlineHandler);
      }
      if (this.windowOfflineHandler) {
        window.removeEventListener('offline', this.windowOfflineHandler);
      }
    }
    this.listeners.clear();
  }
}
