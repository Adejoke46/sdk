/**
 * Real-time sync over WebSocket (Issue #58)
 *
 * The client could only poll: balances, transaction statuses and notifications
 * went stale until the next request. `WebSocketClient` adds a push channel on
 * top of the SDK with:
 *
 * - subscriptions per channel (`balance`, `transaction`, `notification`, ...)
 * - automatic reconnection with exponential backoff + jitter, resubscribing
 *   every active channel once the socket reopens
 * - a heartbeat that detects half-open connections and reconnects
 * - a polling fallback used when WebSocket cannot be established at all
 *   (e.g. proxy-blocked, or a runtime without a WebSocket implementation)
 *
 * Everything the client touches is injectable ({@link WebSocketClientOptions.webSocketFactory},
 * {@link PollingFallbackOptions.poll}), so the behaviour is testable in Node
 * without a server.
 */

/** Message shape accepted from the server. */
export interface RealtimeFrame {
  type?: string;
  channel?: string;
  data?: unknown;
  payload?: unknown;
  [key: string]: unknown;
}

/** Minimal WebSocket surface the client relies on (DOM/undici compatible). */
export interface WebSocketLike {
  readonly readyState?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WebSocketFactory = (url: string, protocols?: string | string[]) => WebSocketLike;

export interface PollingFallbackOptions {
  /** Called for every subscribed channel while polling is active. */
  poll: (channel: string, params?: Record<string, unknown>) => Promise<unknown>;
  /** Poll interval in ms (default 5000). */
  intervalMs?: number;
}

export interface WebSocketClientOptions {
  /** Socket endpoint; `http(s)://` is rewritten to `ws(s)://`. */
  url: string;
  protocols?: string | string[];
  /** Auth token appended as `?token=` when the url has none. */
  token?: string;
  /** Injectable socket constructor (tests, non-browser runtimes). */
  webSocketFactory?: WebSocketFactory;
  /** Reconnect after an unexpected close (default true). */
  autoReconnect?: boolean;
  /** First reconnect delay in ms (default 500). */
  reconnectDelayMs?: number;
  /** Upper bound for the backoff delay in ms (default 15000). */
  maxReconnectDelayMs?: number;
  /** Reconnect attempts before falling back to polling / giving up (default 5, 0 = unlimited). */
  maxReconnectAttempts?: number;
  /** Heartbeat ping interval in ms; 0 disables the heartbeat (default 0). */
  heartbeatIntervalMs?: number;
  /** Silence tolerated before the socket is considered dead (default 30000). */
  heartbeatTimeoutMs?: number;
  /** Polling fallback. Without it, failures surface as errors. */
  polling?: PollingFallbackOptions;
}

export type WebSocketState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'polling'
  | 'closed';

export type RealtimeSource = 'websocket' | 'polling';

export interface RealtimeEvent<T = unknown> {
  channel: string;
  data: T;
  receivedAt: string;
  source: RealtimeSource;
}

export type RealtimeListener<T = unknown> = (event: RealtimeEvent<T>) => void;

export type RealtimeStateListener = (state: WebSocketState) => void;

/** Channel that receives every event, whatever its channel. */
export const ALL_CHANNELS = '*';

const RECONNECT_JITTER = 0.25;

function toError(value: unknown, fallback = 'websocket error'): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string' && value.length > 0) return new Error(value);
  if (value && typeof value === 'object') {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) return new Error(message);
  }
  return new Error(fallback);
}

function unref(timer: unknown): void {
  const candidate = timer as { unref?: () => void };
  if (candidate && typeof candidate.unref === 'function') candidate.unref();
}

function safeCall<T>(listener: (event: T) => void, event: T): void {
  try {
    listener(event);
  } catch {
    // Listener isolation: one bad subscriber must not stop the others.
  }
}

/**
 * Create the factory used when none was injected. Throws when the runtime has
 * no WebSocket implementation, which lets the caller fall back to polling.
 */
function defaultWebSocketFactory(): WebSocketFactory {
  return (url, protocols) => {
    const Ctor = (
      globalThis as {
        WebSocket?: new (url: string, protocols?: string | string[]) => unknown;
      }
    ).WebSocket;
    if (!Ctor) {
      throw new Error('WebSocket is not available in this runtime');
    }
    return new Ctor(url, protocols) as WebSocketLike;
  };
}

export class WebSocketClient {
  private readonly options: WebSocketClientOptions;

  private readonly factory: WebSocketFactory;

  private socket: WebSocketLike | null = null;

  private state: WebSocketState = 'idle';

  private reconnectAttempts = 0;

  private lastMessageAt = 0;

  private manualClose = false;

  private disposed = false;

  private readonly channelListeners = new Map<string, Set<RealtimeListener>>();

  private readonly channelParams = new Map<string, Record<string, unknown>>();

  private readonly stateListeners = new Set<RealtimeStateListener>();

  private readonly errorListeners = new Set<(error: Error) => void>();

  private reconnectTimer?: ReturnType<typeof setTimeout>;

  private heartbeatTimer?: ReturnType<typeof setInterval>;

  private pollingTimer?: ReturnType<typeof setInterval>;

  constructor(options: WebSocketClientOptions) {
    if (!options || typeof options.url !== 'string' || options.url.length === 0) {
      throw new Error('WebSocketClient requires a url');
    }
    this.options = options;
    this.factory = options.webSocketFactory ?? defaultWebSocketFactory();
  }

  // ---------------------------------------------------------------------------
  // Connection
  // ---------------------------------------------------------------------------

  /**
   * Open the socket (or start the polling fallback). Resolves once the
   * connection is usable, never rejects — failures are reported through
   * {@link onError} so callers do not need a try/catch around setup.
   */
  async connect(): Promise<void> {
    this.disposed = false;
    this.manualClose = false;
    if (this.state === 'open' || this.state === 'connecting') return;
    await this.openSocket();
  }

  private openSocket(): Promise<void> {
    this.setState('connecting');

    return new Promise<void>((resolve) => {
      let socket: WebSocketLike;
      try {
        socket = this.factory(this.resolveUrl(), this.options.protocols);
      } catch (error) {
        // No WebSocket at all: go straight to polling when configured.
        if (this.startPollingFallback()) {
          resolve();
          return;
        }
        this.emitError(toError(error));
        this.setState('closed');
        resolve();
        return;
      }

      this.socket = socket;

      socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.lastMessageAt = Date.now();
        this.setState('open');
        this.startHeartbeat();
        this.resubscribeAll();
        resolve();
      };

      socket.onmessage = (event: { data: unknown }) => {
        this.lastMessageAt = Date.now();
        this.receive(event ? event.data : undefined);
      };

      socket.onerror = (event: unknown) => {
        this.emitError(toError(event ?? new Error('websocket error')));
      };

      socket.onclose = () => {
        this.handleClose();
      };
    });
  }

  /** Close the socket and cancel every timer. Safe to call more than once. */
  disconnect(): void {
    this.manualClose = true;
    this.disposed = true;
    this.clearReconnectTimer();
    this.stopHeartbeat();
    this.stopPolling();

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close(1000, 'client disconnect');
      } catch {
        // Already closed, or the implementation refuses to close: nothing to do.
      }
    }
    this.setState('closed');
  }

  private handleClose(): void {
    this.stopHeartbeat();
    this.socket = null;

    if (this.manualClose || this.disposed) {
      this.setState('closed');
      return;
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.options.autoReconnect === false) {
      this.setState('closed');
      return;
    }

    const maxAttempts = this.options.maxReconnectAttempts ?? 5;
    if (maxAttempts > 0 && this.reconnectAttempts >= maxAttempts) {
      if (this.startPollingFallback()) return;
      this.emitError(
        new Error(`websocket reconnect attempts exhausted (${this.reconnectAttempts})`)
      );
      this.setState('closed');
      return;
    }

    this.reconnectAttempts += 1;
    const delay = this.nextReconnectDelay();
    this.setState('reconnecting');

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.openSocket();
    }, delay);
    unref(this.reconnectTimer);
  }

  private nextReconnectDelay(): number {
    const base = this.options.reconnectDelayMs ?? 500;
    const max = this.options.maxReconnectDelayMs ?? 15000;
    const backoff = Math.min(max, base * 2 ** (this.reconnectAttempts - 1));
    const jitter = backoff * RECONNECT_JITTER * Math.random();
    return Math.round(backoff + jitter);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  /**
   * Listen on a channel. Returns an unsubscribe function. Use
   * {@link ALL_CHANNELS} to observe every event.
   */
  subscribe<T = unknown>(
    channel: string,
    listener: RealtimeListener<T>,
    params?: Record<string, unknown>
  ): () => void {
    if (typeof channel !== 'string' || channel.length === 0) {
      throw new Error('subscribe() requires a channel name');
    }

    const listeners = this.channelListeners.get(channel) ?? new Set<RealtimeListener>();
    listeners.add(listener as RealtimeListener);
    this.channelListeners.set(channel, listeners);
    if (params) this.channelParams.set(channel, params);

    if (this.state === 'open') {
      this.sendFrame({ type: 'subscribe', channel, params });
    }

    return () => {
      this.unsubscribe(channel, listener);
    };
  }

  /** Remove one listener from a channel. */
  unsubscribe<T = unknown>(channel: string, listener: RealtimeListener<T>): void {
    const listeners = this.channelListeners.get(channel);
    if (!listeners) return;

    listeners.delete(listener as RealtimeListener);
    if (listeners.size > 0) return;

    this.channelListeners.delete(channel);
    this.channelParams.delete(channel);
    if (this.state === 'open') {
      this.sendFrame({ type: 'unsubscribe', channel });
    }
  }

  /** Channels that currently have at least one listener. */
  getSubscribedChannels(): string[] {
    return [...this.channelListeners.keys()];
  }

  private resubscribeAll(): void {
    for (const channel of this.channelListeners.keys()) {
      if (channel === ALL_CHANNELS) continue;
      this.sendFrame({
        type: 'subscribe',
        channel,
        params: this.channelParams.get(channel),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Sending / receiving
  // ---------------------------------------------------------------------------

  /** Send a frame. Returns false when there is no open socket to send on. */
  send(type: string, payload?: Record<string, unknown>): boolean {
    return this.sendFrame({ type, ...payload });
  }

  private sendFrame(frame: RealtimeFrame): boolean {
    if (!this.socket || this.state !== 'open') return false;
    try {
      this.socket.send(JSON.stringify(frame));
      return true;
    } catch (error) {
      this.emitError(toError(error));
      return false;
    }
  }

  private receive(raw: unknown): void {
    if (typeof raw !== 'string') {
      this.deliver('message', raw, 'websocket');
      return;
    }

    let frame: RealtimeFrame;
    try {
      frame = JSON.parse(raw) as RealtimeFrame;
    } catch {
      // Servers occasionally push plain text; treat it as a message payload.
      this.deliver('message', raw, 'websocket');
      return;
    }

    if (frame.type === 'pong') return;
    if (frame.type === 'ping') {
      this.sendFrame({ type: 'pong' });
      return;
    }

    const channel =
      typeof frame.channel === 'string' && frame.channel.length > 0
        ? frame.channel
        : 'message';
    const data = 'data' in frame ? frame.data : 'payload' in frame ? frame.payload : frame;
    this.deliver(channel, data, 'websocket');
  }

  private deliver(channel: string, data: unknown, source: RealtimeSource): void {
    const event: RealtimeEvent = {
      channel,
      data,
      receivedAt: new Date().toISOString(),
      source,
    };

    for (const listener of [...(this.channelListeners.get(channel) ?? [])]) {
      safeCall(listener, event);
    }
    if (channel !== ALL_CHANNELS) {
      for (const listener of [...(this.channelListeners.get(ALL_CHANNELS) ?? [])]) {
        safeCall(listener, event);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const interval = this.options.heartbeatIntervalMs ?? 0;
    if (interval <= 0) return;

    const timeout = this.options.heartbeatTimeoutMs ?? 30000;
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt > timeout) {
        this.emitError(new Error('websocket heartbeat timed out'));
        const socket = this.socket;
        if (socket) {
          try {
            socket.close(4000, 'heartbeat timeout');
          } catch {
            // Ignore: the close handler below still runs the reconnect path.
          }
        } else {
          this.handleClose();
        }
        return;
      }
      this.sendFrame({ type: 'ping', timestamp: new Date().toISOString() });
    }, interval);
    unref(this.heartbeatTimer);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Polling fallback
  // ---------------------------------------------------------------------------

  /**
   * Start polling subscribed channels. Returns false when no fallback is
   * configured.
   */
  private startPollingFallback(): boolean {
    const polling = this.options.polling;
    if (!polling || typeof polling.poll !== 'function') return false;

    this.stopPolling();
    this.setState('polling');

    const interval = polling.intervalMs ?? 5000;
    this.pollingTimer = setInterval(() => {
      void this.pollOnce();
    }, interval);
    unref(this.pollingTimer);

    void this.pollOnce();
    return true;
  }

  private stopPolling(): void {
    if (this.pollingTimer !== undefined) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  private async pollOnce(): Promise<void> {
    const polling = this.options.polling;
    if (!polling) return;

    for (const channel of [...this.channelListeners.keys()]) {
      if (channel === ALL_CHANNELS) continue;
      try {
        const data = await polling.poll(channel, this.channelParams.get(channel));
        this.deliver(channel, data, 'polling');
      } catch (error) {
        this.emitError(toError(error));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Errors / state
  // ---------------------------------------------------------------------------

  /**
   * Observe client errors (socket errors, exhausted reconnects, failed polls).
   */
  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  private emitError(error: Error): void {
    for (const listener of [...this.errorListeners]) {
      safeCall(listener, error);
    }
  }

  onStateChange(listener: RealtimeStateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  getState(): WebSocketState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === 'open';
  }

  isUsingPollingFallback(): boolean {
    return this.state === 'polling';
  }

  getReconnectAttempt(): number {
    return this.reconnectAttempts;
  }

  private setState(state: WebSocketState): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of [...this.stateListeners]) {
      safeCall(listener, state);
    }
  }

  private resolveUrl(): string {
    let url = this.options.url.replace(/^http/, 'ws');
    const token = this.options.token;
    if (!token || /[?&]token=/.test(url)) return url;
    url += (url.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
    return url;
  }
}
