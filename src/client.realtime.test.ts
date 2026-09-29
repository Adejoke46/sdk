/**
 * DorisioClient real-time wiring tests (Issue #58)
 *
 * A mock socket is injected through `webSocketFactory`, so no network is used.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { DorisioClient, type ClientConfig } from './client';
import {
  WebSocketClient,
  type RealtimeEvent,
  type WebSocketLike,
} from './websocket/websocket-client';

class MockSocket implements WebSocketLike {
  static instances: MockSocket[] = [];

  static get last(): MockSocket {
    const socket = MockSocket.instances[MockSocket.instances.length - 1];
    if (!socket) throw new Error('no mock socket created');
    return socket;
  }

  readonly url: string;

  readonly sent: string[] = [];

  closed: { code?: number; reason?: string } | null = null;

  onopen: ((event: unknown) => void) | null = null;

  onmessage: ((event: { data: unknown }) => void) | null = null;

  onclose: ((event: { code?: number; reason?: string }) => void) | null = null;

  onerror: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
    this.onclose?.({ code, reason });
  }

  open(): void {
    this.onopen?.({});
  }

  emit(channel: string, data: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ type: 'event', channel, data }) });
  }
}

const clients: DorisioClient[] = [];

const createClient = (config: Partial<ClientConfig> = {}): DorisioClient => {
  const client = new DorisioClient({ baseUrl: 'https://realtime.test', ...config });
  clients.push(client);
  return client;
};

const factory = (url: string) => new MockSocket(url);

/** Enable real-time and resolve once the mock socket is open. */
const enableRealtime = async (client: DorisioClient): Promise<MockSocket> => {
  const pending = client.enableRealtime({ url: 'wss://realtime.test/socket', webSocketFactory: factory });
  const socket = MockSocket.last;
  socket.open();
  await pending;
  return socket;
};

afterEach(() => {
  for (const client of clients.splice(0)) client.disableRealtime();
  MockSocket.instances = [];
});

describe('DorisioClient real-time support', () => {
  it('enables real-time and reports the connection state', async () => {
    const client = createClient();
    expect(client.getRealtimeState()).toBe('disabled');
    expect(client.getRealtime()).toBeNull();

    await enableRealtime(client);

    expect(client.getRealtimeState()).toBe('open');
    expect(client.getRealtime()?.isConnected()).toBe(true);
  });

  it('passes the client token to the socket url', async () => {
    const client = createClient({ token: 'jwt_token' });
    await enableRealtime(client);

    expect(MockSocket.last.url).toBe('wss://realtime.test/socket?token=jwt_token');
  });

  it('delivers real-time events to subscribers', async () => {
    const client = createClient();
    const socket = await enableRealtime(client);
    const events: RealtimeEvent[] = [];

    const unsubscribe = client.subscribeRealtime<{ amount: number }>('balance', (event) =>
      events.push(event)
    );

    expect(JSON.parse(socket.sent[socket.sent.length - 1] ?? 'null')).toEqual({
      type: 'subscribe',
      channel: 'balance',
    });

    socket.emit('balance', { amount: 500 });

    expect(events).toHaveLength(1);
    expect(events[0]?.data).toEqual({ amount: 500 });
    expect(events[0]?.source).toBe('websocket');

    unsubscribe();
    socket.emit('balance', { amount: 1 });
    expect(events).toHaveLength(1);
  });

  it('uses ClientConfig.websocket as the default transport', async () => {
    const client = createClient({
      websocket: { url: 'wss://realtime.test/configured', webSocketFactory: factory },
    });

    const pending = client.enableRealtime();
    const socket = MockSocket.last;
    socket.open();
    const realtime = await pending;

    expect(realtime).toBeInstanceOf(WebSocketClient);
    expect(socket.url).toBe('wss://realtime.test/configured');
    expect(client.getRealtimeState()).toBe('open');
  });

  it('rejects subscriptions before real-time is enabled', () => {
    const client = createClient();
    expect(() => client.subscribeRealtime('balance', () => undefined)).toThrow(/not enabled/);
  });

  it('rejects enableRealtime without a url and when disabled by config', async () => {
    const client = createClient();
    await expect(client.enableRealtime()).rejects.toThrow(/requires a WebSocket url/);

    const disabled = createClient({ websocket: false });
    await expect(disabled.enableRealtime()).rejects.toThrow(/requires a WebSocket url/);
  });

  it('closes the socket on disableRealtime', async () => {
    const client = createClient();
    const socket = await enableRealtime(client);

    client.disableRealtime();

    expect(client.getRealtimeState()).toBe('disabled');
    expect(client.getRealtime()).toBeNull();
    expect(socket.closed?.code).toBe(1000);
  });

  it('replaces an existing real-time client when enabled twice', async () => {
    const client = createClient();
    await enableRealtime(client);
    const first = client.getRealtime() as WebSocketClient;

    await enableRealtime(client);
    const second = client.getRealtime() as WebSocketClient;

    expect(first).not.toBe(second);
    expect(first.getState()).toBe('closed');
    expect(MockSocket.instances).toHaveLength(2);
  });
});
