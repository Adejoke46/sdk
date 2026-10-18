/**
 * WebSocketClient Tests (Issue #58)
 *
 * A mock socket is injected through `webSocketFactory`, so connection,
 * subscription, reconnection, heartbeat and polling-fallback behaviour are all
 * exercised without a server.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  WebSocketClient,
  ALL_CHANNELS,
  type RealtimeEvent,
  type WebSocketClientOptions,
  type WebSocketLike,
} from './websocket-client';

class MockSocket implements WebSocketLike {
  static instances: MockSocket[] = [];

  static reset(): void {
    MockSocket.instances = [];
  }

  static get last(): MockSocket {
    const socket = MockSocket.instances[MockSocket.instances.length - 1];
    if (!socket) throw new Error('no mock socket created');
    return socket;
  }

  readonly url: string;

  readonly protocols?: string | string[];

  readonly sent: string[] = [];

  closed: { code?: number; reason?: string } | null = null;

  onopen: ((event: unknown) => void) | null = null;

  onmessage: ((event: { data: unknown }) => void) | null = null;

  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;

  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = protocols;
    MockSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.onclose?.({ code, reason });
  }

  // --- test helpers ---
  open(): void {
    this.onopen?.({});
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  fail(): void {
    this.onerror?.({ message: 'socket error' });
  }

  lastSent(): unknown {
    return JSON.parse(this.sent[this.sent.length - 1] ?? 'null');
  }

  sentTypes(): string[] {
    return this.sent.map((frame) => String(JSON.parse(frame).type));
  }
}

const clients: WebSocketClient[] = [];

const createClient = (options: Partial<WebSocketClientOptions> = {}): WebSocketClient => {
  const client = new WebSocketClient({
    url: 'ws://realtime.test/socket',
    webSocketFactory: (url: string, protocols?: string | string[]) =>
      new MockSocket(url, protocols),
    ...options,
  });
  clients.push(client);
  return client;
};

const waitFor = async (predicate: () => boolean, timeout = 2000): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('waitFor timed out');
};

/** Connect a client and open the mock socket. */
const connectClient = async (client: WebSocketClient): Promise<MockSocket> => {
  const connected = client.connect();
  const socket = MockSocket.last;
  socket.open();
  await connected;
  return socket;
};

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect();
  MockSocket.reset();
});

describe('WebSocketClient', () => {
  it('requires a url', () => {
    expect(() => new WebSocketClient({ url: '' })).toThrow(/requires a url/);
  });

  it('connects, upgrades http urls to ws and reports state transitions', async () => {
    const states: string[] = [];
    const client = createClient({ url: 'https://api.test/realtime', token: 'tok_123' });

    const connected = client.connect();
    expect(client.getState()).toBe('connecting');

    const socket = MockSocket.last;
    expect(socket.url).toBe('wss://api.test/realtime?token=tok_123');
    socket.open();
    await connected;

    expect(client.isConnected()).toBe(true);
    expect(client.getState()).toBe('open');

    const unsubscribe = client.onStateChange((state) => states.push(state));
    client.disconnect();
    expect(client.getState()).toBe('closed');
    expect(states).toEqual(['closed']);
    unsubscribe();
  });

  it('subscribes to a channel, receives events and unsubscribes', async () => {
    const client = createClient();
    const socket = await connectClient(client);
    const received: RealtimeEvent[] = [];

    const unsubscribe = client.subscribe<{ amount: number }>('balance', (event) => {
      received.push(event);
    });

    expect(socket.lastSent()).toEqual({ type: 'subscribe', channel: 'balance' });
    expect(client.getSubscribedChannels()).toEqual(['balance']);

    socket.emit({ type: 'event', channel: 'balance', data: { amount: 42 } });

    expect(received).toHaveLength(1);
    expect(received[0]?.data).toEqual({ amount: 42 });
    expect(received[0]?.channel).toBe('balance');
    expect(received[0]?.source).toBe('websocket');
    expect(typeof received[0]?.receivedAt).toBe('string');

    unsubscribe();
    socket.emit({ type: 'event', channel: 'balance', data: { amount: 99 } });

    expect(received).toHaveLength(1);
    expect(socket.lastSent()).toEqual({ type: 'unsubscribe', channel: 'balance' });
    expect(client.getSubscribedChannels()).toEqual([]);
  });

  it('delivers every event to the wildcard channel and keeps channels isolated', async () => {
    const client = createClient();
    const socket = await connectClient(client);
    const all: RealtimeEvent[] = [];
    const balance: RealtimeEvent[] = [];

    client.subscribe(ALL_CHANNELS, (event) => all.push(event));
    client.subscribe('balance', (event) => balance.push(event));

    socket.emit({ type: 'event', channel: 'balance', data: 1 });
    socket.emit({ type: 'event', channel: 'transaction', data: 2 });

    expect(all).toHaveLength(2);
    expect(balance).toHaveLength(1);
    expect(balance[0]?.data).toBe(1);
  });

  it('reconnects with backoff and resubscribes active channels', async () => {
    const client = createClient({ reconnectDelayMs: 5, maxReconnectDelayMs: 10 });
    const socket = await connectClient(client);
    const received: RealtimeEvent[] = [];
    client.subscribe('transaction', (event) => received.push(event));

    socket.close(1006, 'network gone');
    expect(client.getState()).toBe('reconnecting');
    expect(client.getReconnectAttempt()).toBe(1);

    await waitFor(() => MockSocket.instances.length === 2);
    const reopened = MockSocket.instances[1];
    if (!reopened) throw new Error('expected a reconnect attempt');
    reopened.open();

    await waitFor(() => client.isConnected());
    expect(client.getReconnectAttempt()).toBe(0);
    expect(reopened.lastSent()).toEqual({ type: 'subscribe', channel: 'transaction' });

    reopened.emit({ type: 'event', channel: 'transaction', data: { status: 'confirmed' } });
    expect(received).toHaveLength(1);
    expect(received[0]?.data).toEqual({ status: 'confirmed' });
  });

  it('does not reconnect after an explicit disconnect', async () => {
    const client = createClient({ reconnectDelayMs: 5 });
    const socket = await connectClient(client);

    client.disconnect();
    socket.close(1000, 'client disconnect');

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(MockSocket.instances).toHaveLength(1);
    expect(client.getState()).toBe('closed');
  });

  it('gives up after maxReconnectAttempts when no polling fallback is configured', async () => {
    const errors: Error[] = [];
    const client = createClient({ reconnectDelayMs: 1, maxReconnectDelayMs: 1, maxReconnectAttempts: 1 });
    client.onError((error) => errors.push(error));

    const socket = await connectClient(client);
    socket.close(1006, 'network gone');

    // attempt 1: a new socket is created
    await waitFor(() => MockSocket.instances.length === 2);
    const second = MockSocket.instances[1];
    if (!second) throw new Error('expected a reconnect attempt');
    second.close(1006, 'network gone');

    await waitFor(() => client.getState() === 'closed');
    expect(errors.some((error) => /reconnect attempts exhausted/.test(error.message))).toBe(true);
    expect(MockSocket.instances).toHaveLength(2);
    expect(client.isUsingPollingFallback()).toBe(false);
  });

  it('falls back to polling when WebSocket is unavailable', async () => {
    const polls: string[] = [];
    const events: RealtimeEvent[] = [];
    const client = createClient({
      webSocketFactory: () => {
        throw new Error('WebSocket is not available in this runtime');
      },
      polling: {
        intervalMs: 20,
        poll: async (channel) => {
          polls.push(channel);
          return { channel, balance: 7 };
        },
      },
    });

    client.subscribe('balance', (event) => events.push(event));
    await client.connect();

    expect(client.isUsingPollingFallback()).toBe(true);
    expect(client.getState()).toBe('polling');

    await waitFor(() => events.length > 0);
    expect(polls).toEqual(['balance']);
    expect(events[0]?.source).toBe('polling');
    expect(events[0]?.data).toEqual({ channel: 'balance', balance: 7 });
  });

  it('falls back to polling once reconnects are exhausted', async () => {
    const events: RealtimeEvent[] = [];
    const client = createClient({
      reconnectDelayMs: 1,
      maxReconnectDelayMs: 1,
      maxReconnectAttempts: 1,
      polling: {
        intervalMs: 20,
        poll: async (channel) => ({ channel, refreshed: true }),
      },
    });

    const socket = await connectClient(client);
    client.subscribe('balance', (event) => events.push(event));

    socket.close(1006, 'network gone');

    // attempt 1 creates a replacement socket; when that one also fails the
    // client gives up and switches to polling.
    await waitFor(() => MockSocket.instances.length === 2);
    const second = MockSocket.instances[1];
    if (!second) throw new Error('expected a reconnect attempt');
    second.close(1006, 'network gone');

    await waitFor(() => client.isUsingPollingFallback());
    await waitFor(() => events.length > 0);
    expect(events[0]?.source).toBe('polling');
  });

  it('sends a heartbeat ping and reconnects when the socket goes silent', async () => {
    const client = createClient({
      heartbeatIntervalMs: 10,
      heartbeatTimeoutMs: 30,
      reconnectDelayMs: 5,
      maxReconnectDelayMs: 5,
    });
    const socket = await connectClient(client);

    await waitFor(() => socket.sentTypes().includes('ping'));
    await waitFor(() => MockSocket.instances.length === 2);

    expect(socket.closed?.code).toBe(4000);
    expect(client.getReconnectAttempt()).toBe(1);
  });

  it('answers server pings and ignores pongs', async () => {
    const client = createClient();
    const socket = await connectClient(client);
    const received: RealtimeEvent[] = [];
    client.subscribe(ALL_CHANNELS, (event) => received.push(event));

    socket.emit({ type: 'ping' });
    expect(socket.lastSent()).toEqual({ type: 'pong' });

    socket.emit({ type: 'pong' });
    expect(received).toHaveLength(0);
  });

  it('surfaces socket errors to onError listeners', async () => {
    const errors: Error[] = [];
    const client = createClient();
    client.onError((error) => errors.push(error));

    const socket = await connectClient(client);
    socket.fail();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe('socket error');
  });

  it('isolates throwing channel listeners', async () => {
    const client = createClient();
    const socket = await connectClient(client);
    const seen: RealtimeEvent[] = [];

    client.subscribe('balance', () => {
      throw new Error('listener exploded');
    });
    client.subscribe('balance', (event) => seen.push(event));

    expect(() => socket.emit({ type: 'event', channel: 'balance', data: 1 })).not.toThrow();
    expect(seen).toHaveLength(1);
  });

  it('rejects an empty channel name', async () => {
    const client = createClient();
    await connectClient(client);
    expect(() => client.subscribe('', vi.fn())).toThrow(/requires a channel name/);
  });

  it('only sends frames while the socket is open', async () => {
    const client = createClient();
    expect(client.send('refresh', { channel: 'balance' })).toBe(false);

    const socket = await connectClient(client);
    expect(client.send('refresh', { channel: 'balance' })).toBe(true);
    expect(socket.lastSent()).toEqual({ type: 'refresh', channel: 'balance' });

    client.disconnect();
    expect(client.send('refresh')).toBe(false);
  });
});
