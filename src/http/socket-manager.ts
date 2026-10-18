/**
 * Socket Manager
 *
 * Supervises keep-alive socket lifecycle: idle timeouts, graceful close,
 * error handling, and reconnect with retries.
 *
 * Socket states:
 *   - `open`   socket is live and tracked
 *   - `closing` socket is being closed (draining in-flight work)
 *   - `closed` socket is closed
 *
 * The manager only supervises sockets owned by the transport: it never
 * touches the wire format, so no socket-level protocol changes are made
 * and HTTP/1.1 compatibility is preserved.
 */

export type SocketState = 'open' | 'closing' | 'closed';

export interface SocketLike {
  close?(): void | Promise<void>;
}

export interface SocketEntry {
  readonly id: string;
  state: SocketState;
  readonly createdAt: number;
  lastActivity: number;
  inFlight: number;
}

export interface SocketManagerOptions {
  /**
   * Milliseconds of inactivity before an idle socket is closed.
   * Defaults to 30000 (30s). Set to 0 to disable idle timeouts.
   */
  idleTimeoutMs?: number;
  /**
   * Maximum time in milliseconds to wait for in-flight work to drain
   * during a graceful close. The socket is closed anyway once this elapses,
   * so a graceful close never hangs forever. Defaults to 5000.
   */
  gracefulCloseTimeoutMs?: number;
  /** Maximum number of concurrently tracked sockets. Defaults to Infinity. */
  maxSockets?: number;
  /**
   * Maximum number of reconnect attempts after an unexpected close.
   * Defaults to 3. Set to 0 to disable reconnect.
   */
  maxReconnectAttempts?: number;
  /**
   * Base delay in milliseconds between reconnect attempts. Delays grow
   * exponentially (base * 2^attempt). Defaults to 1000.
   */
  reconnectBaseDelayMs?: number;
  /**
   * Factory that creates a replacement socket after an unexpected close.
   * Receives the closed socket id. Returned sockets are registered as open.
   */
  onReconnect?: (socketId: string) => Promise<SocketLike | void>;
  /** Fired on every state transition (from -> to). */
  onSocketStateChange?: (socketId: string, from: SocketState, to: SocketState) => void;
  /** Fired when a socket reports an error before it is closed. */
  onSocketError?: (socketId: string, error: Error) => void;
}

export interface SocketManagerStats {
  open: number;
  closing: number;
  closed: number;
  total: number;
  inFlight: number;
  registered: number;
  reconnections: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30_000;
const DEFAULT_GRACEFUL_CLOSE_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3;
const DEFAULT_RECONNECT_BASE_DELAY_MS = 1_000;
const DRAIN_POLL_INTERVAL_MS = 10;

type IdleTimer = ReturnType<typeof setTimeout> | null;

interface InternalEntry {
  id: string;
  state: SocketState;
  createdAt: number;
  lastActivity: number;
  inFlight: number;
  idleTimer: IdleTimer;
  closeTimer: IdleTimer;
  reconnectTimer: IdleTimer;
  drainResolver: (() => void) | null;
}

export class SocketManager {
  private readonly options: {
    idleTimeoutMs: number;
    gracefulCloseTimeoutMs: number;
    maxSockets: number;
    maxReconnectAttempts: number;
    reconnectBaseDelayMs: number;
    onReconnect?: (socketId: string) => Promise<SocketLike | void>;
    onSocketStateChange?: (
      socketId: string,
      from: SocketState,
      to: SocketState,
    ) => void;
    onSocketError?: (socketId: string, error: Error) => void;
  };
  private readonly sockets = new Map<string, InternalEntry>();
  private readonly manuallyClosed = new Set<string>();
  private readonly reconnectAttempts = new Map<string, number>();
  private destroyed = false;
  private reconnections = 0;
  private everRegistered = 0;

  constructor(options: SocketManagerOptions = {}) {
    this.options = {
      idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
      gracefulCloseTimeoutMs: options.gracefulCloseTimeoutMs ?? DEFAULT_GRACEFUL_CLOSE_TIMEOUT_MS,
      maxSockets: options.maxSockets ?? Infinity,
      maxReconnectAttempts: options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS,
      reconnectBaseDelayMs: options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS,
      onReconnect: options.onReconnect,
      onSocketStateChange: options.onSocketStateChange,
      onSocketError: options.onSocketError,
    };
  }

  /** Number of sockets ever registered by this manager. */
  getRegisteredCount(): number {
    return this.everRegistered;
  }

  /** Total reconnects performed by this manager. */
  getReconnectionCount(): number {
    return this.reconnections;
  }

  /** Current per-state and aggregate stats. */
  getStats(): SocketManagerStats {
    let open = 0;
    let closing = 0;
    let closed = 0;
    let inFlight = 0;
    for (const entry of this.sockets.values()) {
      inFlight += entry.inFlight;
      switch (entry.state) {
        case 'open':
          open++;
          break;
        case 'closing':
          closing++;
          break;
        case 'closed':
          closed++;
          break;
      }
    }
    return {
      open,
      closing,
      closed,
      total: this.sockets.size,
      inFlight,
      registered: this.everRegistered,
      reconnections: this.reconnections,
    };
  }

  /** Entry for `socketId`, or undefined when unknown. */
  getSocket(socketId: string): SocketEntry | undefined {
    const entry = this.sockets.get(socketId);
    if (!entry) {
      return undefined;
    }
    return {
      id: entry.id,
      state: entry.state,
      createdAt: entry.createdAt,
      lastActivity: entry.lastActivity,
      inFlight: entry.inFlight,
    };
  }

  /** Current state of `socketId`, or undefined when unknown. */
  getState(socketId: string): SocketState | undefined {
    return this.sockets.get(socketId)?.state;
  }

  /** True when `socketId` is tracked as open. */
  isOpen(socketId: string): boolean {
    return this.sockets.get(socketId)?.state === 'open';
  }

  /** True when `socketId` is tracked as closed. */
  isClosed(socketId: string): boolean {
    return this.sockets.get(socketId)?.state === 'closed';
  }

  /**
   * Register `socketId` as an open socket and start its idle timer.
   * Re-registering a closed socket reopens it. Throws when `maxSockets`
   * would be exceeded by a new socket id.
   */
  register(socketId: string): void {
    this.throwIfDestroyed();
    const existing = this.sockets.get(socketId);
    const now = Date.now();

    if (existing) {
      this.clearTimers(existing);
      existing.state = 'open';
      existing.inFlight = 0;
      existing.lastActivity = now;
      existing.createdAt = now;
      this.transitionUnlocked(socketId, existing, 'open');
      this.scheduleIdleTimer(socketId, existing);
      return;
    }

    const openOrClosing = this.countOpenOrClosing();
    if (openOrClosing >= this.options.maxSockets) {
      throw new Error(
        `Maximum socket count (${this.options.maxSockets}) reached; cannot register ${socketId}`,
      );
    }

    const entry: InternalEntry = {
      id: socketId,
      state: 'open',
      createdAt: now,
      lastActivity: now,
      inFlight: 0,
      idleTimer: null,
      closeTimer: null,
      reconnectTimer: null,
      drainResolver: null,
    };
    this.sockets.set(socketId, entry);
    this.everRegistered++;
    this.transitionUnlocked(socketId, entry, 'open');
    this.scheduleIdleTimer(socketId, entry);
  }

  /**
   * Record activity on `socketId`, restarting its idle timer.
   * Returns false when the socket id is unknown or not open.
   */
  recordActivity(socketId: string): boolean {
    const entry = this.sockets.get(socketId);
    if (!entry || entry.state !== 'open' || entry.inFlight > 0) {
      return false;
    }
    entry.lastActivity = Date.now();
    this.restartIdleTimer(socketId, entry);
    return true;
  }

  /** Mark that work has begun on `socketId`. Returns false when unknown. */
  beginUse(socketId: string): boolean {
    const entry = this.sockets.get(socketId);
    if (!entry || entry.state === 'closed') {
      return false;
    }
    entry.inFlight++;
    this.clearIdleTimer(socketId, entry);
    return true;
  }

  /**
   * Mark that work on `socketId` has ended. When the socket becomes idle its
   * idle timer is restarted; when a graceful close is waiting for the drain,
   * the drain completes. Returns false when unknown.
   */
  endUse(socketId: string): boolean {
    const entry = this.sockets.get(socketId);
    if (!entry) {
      return false;
    }
    if (entry.inFlight > 0) {
      entry.inFlight--;
    }
    if (entry.state === 'closing' && entry.inFlight === 0 && entry.drainResolver) {
      const resolve = entry.drainResolver;
      entry.drainResolver = null;
      resolve();
      return true;
    }
    if (entry.state === 'open' && entry.inFlight === 0) {
      this.restartIdleTimer(socketId, entry);
    }
    return true;
  }

  /**
   * Gracefully close `socketId`: transition to `closing`, wait for in-flight
   * work to drain (bounded by `gracefulCloseTimeoutMs`), then transition to
   * `closed`. Resolves once the socket is closed, or immediately when the
   * socket is unknown or already closed.
   *
   * A public close marks the socket as manually closed, which prevents
   * automatic reconnection after an error. Internal close paths (idle
   * timeout, error handling) use {@link doClose} and do not leave that mark.
   */
  async close(socketId: string): Promise<void> {
    this.throwIfDestroyed();
    this.manuallyClosed.add(socketId);
    await this.doClose(socketId);
  }

  /** Internal close path used by idle timeouts and error handling. */
  private async doClose(socketId: string): Promise<void> {
    const entry = this.sockets.get(socketId);
    if (!entry) {
      return;
    }
    if (entry.state === 'closed') {
      return;
    }
    if (entry.state === 'closing') {
      // A close is already in flight for this socket.
      return;
    }

    this.clearIdleTimer(socketId, entry);
    this.transition(socketId, entry, 'closing');

    if (entry.inFlight === 0) {
      this.completeClose(socketId);
      return;
    }

    await new Promise<void>((resolve) => {
      entry.drainResolver = resolve;
      entry.closeTimer = setTimeout(() => {
        entry.closeTimer = null;
        entry.drainResolver = null;
        resolve();
      }, this.options.gracefulCloseTimeoutMs);
    });

    const current = this.sockets.get(socketId);
    if (current && current.state === 'closing') {
      this.completeClose(socketId);
    }
  }

  /** Transition to `closed`, clear timers, and notify listeners. */
  private completeClose(socketId: string): void {
    const entry = this.sockets.get(socketId);
    if (!entry) {
      return;
    }
    this.clearTimers(entry);
    this.transition(socketId, entry, 'closed');
  }

  /**
   * Handle an error on `socketId`: the socket is closed and, when `onReconnect`
   * is configured, a replacement socket is retried with exponential backoff up
   * to `maxReconnectAttempts`. Manually closed sockets are never reconnected.
   */
  async handleError(socketId: string, error: Error): Promise<void> {
    this.throwIfDestroyed();
    if (this.manuallyClosed.has(socketId)) {
      return;
    }
    this.options.onSocketError?.(socketId, error);
    await this.doClose(socketId);
    if (this.manuallyClosed.has(socketId)) {
      return;
    }
    await this.scheduleReconnect(socketId);
  }

  /** Close every tracked socket and cancel all pending reconnects. */
  async closeAll(): Promise<void> {
    this.throwIfDestroyed();
    await Promise.all([...this.sockets.keys()].map((id) => this.close(id)));
  }

  /**
   * Stop managing sockets: close all entries without draining, clear every
   * timer, and reject further registration. Intended for teardown so no
   * timers outlive the manager.
   */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const [socketId, entry] of this.sockets) {
      this.clearTimers(entry);
      const from = entry.state;
      entry.state = 'closed';
      entry.inFlight = 0;
      this.notifyStateChange(socketId, from, 'closed');
    }
    this.sockets.clear();
    this.reconnectAttempts.clear();
    this.manuallyClosed.clear();
  }

  /** Drop `socketId` from tracking and clear its timers. */
  remove(socketId: string): void {
    const entry = this.sockets.get(socketId);
    if (entry) {
      this.clearTimers(entry);
      this.sockets.delete(socketId);
      this.reconnectAttempts.delete(socketId);
      this.manuallyClosed.delete(socketId);
    }
  }

  /** Purge all sockets in the `closed` state. */
  purgeClosed(): void {
    for (const [socketId, entry] of this.sockets) {
      if (entry.state === 'closed') {
        this.clearTimers(entry);
        this.sockets.delete(socketId);
      }
    }
  }

  private throwIfDestroyed(): void {
    if (this.destroyed) {
      throw new Error('SocketManager has been destroyed');
    }
  }

  private countOpenOrClosing(): number {
    let count = 0;
    for (const entry of this.sockets.values()) {
      if (entry.state === 'open' || entry.state === 'closing') {
        count++;
      }
    }
    return count;
  }

  private transition(socketId: string, entry: InternalEntry, to: SocketState): void {
    const from = entry.state;
    if (from === to) {
      return;
    }
    entry.state = to;
    this.notifyStateChange(socketId, from, to);
  }

  private transitionUnlocked(socketId: string, entry: InternalEntry, to: SocketState): void {
    const from = entry.state;
    entry.state = to;
    this.notifyStateChange(socketId, from, to);
  }

  private notifyStateChange(socketId: string, from: SocketState, to: SocketState): void {
    this.options.onSocketStateChange?.(socketId, from, to);
  }

  private scheduleIdleTimer(socketId: string, entry?: InternalEntry): void {
    const e = entry ?? this.sockets.get(socketId);
    if (!e || e.state !== 'open' || e.inFlight > 0) {
      return;
    }
    this.clearIdleTimer(socketId, e);
    if (this.options.idleTimeoutMs <= 0) {
      return;
    }
    e.idleTimer = setTimeout(() => {
      e.idleTimer = null;
      const current = this.sockets.get(socketId);
      if (current && current.state === 'open' && current.inFlight === 0) {
        void this.doClose(socketId);
      }
    }, this.options.idleTimeoutMs);
  }

  private clearIdleTimer(socketId: string, entry?: InternalEntry): void {
    const e = entry ?? this.sockets.get(socketId);
    if (!e || !e.idleTimer) {
      return;
    }
    clearTimeout(e.idleTimer);
    e.idleTimer = null;
  }

  private restartIdleTimer(socketId: string, entry: InternalEntry): void {
    this.clearIdleTimer(socketId, entry);
    this.scheduleIdleTimer(socketId, entry);
  }

  private clearTimers(entry: InternalEntry): void {
    this.clearIdleTimer(entry.id, entry);
    if (entry.closeTimer) {
      clearTimeout(entry.closeTimer);
      entry.closeTimer = null;
    }
    if (entry.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
    entry.drainResolver = null;
  }

  private async scheduleReconnect(socketId: string): Promise<void> {
    if (!this.options.onReconnect || this.destroyed) {
      return;
    }
    const attempts = (this.reconnectAttempts.get(socketId) ?? 0) + 1;
    if (attempts > this.options.maxReconnectAttempts) {
      this.reconnectAttempts.delete(socketId);
      return;
    }
    this.reconnectAttempts.set(socketId, attempts);
    const delay = this.options.reconnectBaseDelayMs * Math.pow(2, attempts - 1);
    await new Promise<void>((resolve) => {
      const entry = this.sockets.get(socketId);
      if (!entry) {
        resolve();
        return;
      }
      entry.reconnectTimer = setTimeout(() => {
        entry.reconnectTimer = null;
        resolve();
      }, delay);
    });
    if (this.destroyed) {
      return;
    }
    await this.attemptReconnect(socketId);
  }

  private async attemptReconnect(socketId: string): Promise<void> {
    if (!this.options.onReconnect) {
      return;
    }
    try {
      await this.options.onReconnect(socketId);
    } catch (error) {
      // Reconnect failed: retry again if attempts remain.
      void this.scheduleReconnect(socketId);
      return;
    }
    // Reconnect succeeded: reopen the same socket id as a fresh open socket.
    const entry = this.sockets.get(socketId);
    if (!entry || entry.state !== 'closed') {
      return;
    }
    this.reconnectAttempts.delete(socketId);
    this.reconnections++;
    entry.createdAt = Date.now();
    entry.state = 'open';
    entry.inFlight = 0;
    entry.lastActivity = Date.now();
    this.notifyStateChange(socketId, 'closed', 'open');
    this.scheduleIdleTimer(socketId, entry);
  }
}
