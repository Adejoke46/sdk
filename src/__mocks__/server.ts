/**
 * In-process mock API server for the E2E suite (Issue #55)
 *
 * The SDK reaches the network through `globalThis.fetch`, so the server swaps in
 * a fetch implementation that routes requests to registered handlers and records
 * every call. Responses are real `Response` objects, which keeps the HTTP layer
 * (status handling, `Retry-After`, JSON parsing, abort signals) behaving exactly
 * as it does against a live backend.
 *
 * The server also models an unreachable network (`goOffline()`), so failure and
 * recovery scenarios can be exercised without touching a real socket.
 */

/** Backend success envelope the SDK expects: `{ success, data, timestamp }`. */
export interface MockEnvelope<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

export interface MockRequest {
  method: string;
  path: string;
  url: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
  /** 1 for the first hit of this method+path, 2 for the next, and so on. */
  attempt: number;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type MockHandler = (request: MockRequest) => MockResponse | Promise<MockResponse>;

interface MockRoute {
  method: string;
  path: string | RegExp;
  handler: MockHandler;
}

/** Wrap a payload in the envelope every client method expects. */
export function envelope<T>(data: T): MockEnvelope<T> {
  return {
    success: true,
    data,
    timestamp: '2026-01-01T00:00:00.000Z',
  };
}

/**
 * Error body shape the HTTP layer reads: `error` is the message surfaced on
 * {@link ApiError} and `code` becomes its machine-readable code.
 */
export function apiError(message: string, code = 'ERROR'): Record<string, string> {
  return { error: message, code };
}

function matchesPath(routePath: string | RegExp, path: string): boolean {
  return typeof routePath === 'string' ? routePath === path : routePath.test(path);
}

function toHeaders(init: HeadersInit | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!init) return headers;

  if (init instanceof Headers) {
    init.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return headers;
  }

  if (Array.isArray(init)) {
    for (const pair of init) {
      const key = pair[0];
      const value = pair[1];
      if (key !== undefined && value !== undefined) headers[key.toLowerCase()] = value;
    }
    return headers;
  }

  for (const [key, value] of Object.entries(init as Record<string, string>)) {
    headers[key.toLowerCase()] = value;
  }
  return headers;
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** What fetch rejects with when the caller aborts the request. */
function abortError(): Error {
  const error = new Error('This operation was aborted');
  error.name = 'AbortError';
  return error;
}

export class MockApiServer {
  private readonly routes: MockRoute[] = [];

  private readonly calls: MockRequest[] = [];

  private isOffline = false;

  private installed = false;

  private originalFetch: typeof fetch | undefined;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Install the mock as `globalThis.fetch`. */
  start(): this {
    if (this.installed) return this;
    this.originalFetch = globalThis.fetch;
    globalThis.fetch = this.handle;
    this.installed = true;
    return this;
  }

  /** Restore the previous `fetch` implementation. */
  stop(): this {
    if (!this.installed) return this;
    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch;
    } else {
      delete (globalThis as { fetch?: unknown }).fetch;
    }
    this.originalFetch = undefined;
    this.installed = false;
    return this;
  }

  /** Forget recorded calls and registered routes. */
  reset(): this {
    this.calls.length = 0;
    this.routes.length = 0;
    this.isOffline = false;
    return this;
  }

  /** Make every request fail the way an unreachable network does. */
  goOffline(): this {
    this.isOffline = true;
    return this;
  }

  /** Restore connectivity. */
  goOnline(): this {
    this.isOffline = false;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Routing
  // ---------------------------------------------------------------------------

  /**
   * Register a handler. Handlers registered later win, so a test can override a
   * route set up by the shared `beforeEach`.
   */
  on(method: string, path: string | RegExp, handler: MockHandler): this {
    this.routes.push({ method: method.toUpperCase(), path, handler });
    return this;
  }

  /** Plain JSON response. */
  onJson(method: string, path: string | RegExp, body: unknown, status = 200): this {
    return this.on(method, path, () => ({ status, body }));
  }

  /** Respond with each entry in order; the final entry repeats. */
  sequence(method: string, path: string | RegExp, responses: MockResponse[]): this {
    const queue = responses.map((response) => ({ ...response }));
    return this.on(method, path, () => {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return next ?? { status: 200, body: {} };
    });
  }

  // ---------------------------------------------------------------------------
  // Recorded calls
  // ---------------------------------------------------------------------------

  getCalls(method?: string, path?: string | RegExp): MockRequest[] {
    return this.calls.filter(
      (call) =>
        (method === undefined || call.method === method.toUpperCase()) &&
        (path === undefined || matchesPath(path, call.path))
    );
  }

  callCount(method: string, path?: string | RegExp): number {
    return this.getCalls(method, path).length;
  }

  lastCall(method?: string, path?: string | RegExp): MockRequest | undefined {
    const calls = this.getCalls(method, path);
    return calls[calls.length - 1];
  }

  /** `METHOD /path` for every recorded call, in order. */
  requestedPaths(): string[] {
    return this.calls.map((call) => `${call.method} ${call.path}`);
  }

  // ---------------------------------------------------------------------------
  // fetch implementation
  // ---------------------------------------------------------------------------

  private readonly handle: typeof fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    const request = this.record(input, init);
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw abortError();

    if (this.isOffline) {
      // Mirrors the TypeError a real fetch rejects with when the host is
      // unreachable, so failure handling is exercised for real.
      throw new TypeError('fetch failed');
    }

    const route = [...this.routes]
      .reverse()
      .find(
        (candidate) =>
          candidate.method === request.method && matchesPath(candidate.path, request.path)
      );
    if (!route) {
      return jsonResponse(apiError(`No mock route for ${request.method} ${request.path}`), 404);
    }

    const response = await route.handler(request);
    // A real fetch rejects when the caller aborts mid-flight.
    if (signal?.aborted) throw abortError();
    return jsonResponse(response.body ?? {}, response.status ?? 200, response.headers);
  };

  private record(input: RequestInfo | URL, init?: RequestInit): MockRequest {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const parsed = new URL(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = parsed.pathname;

    let body: Record<string, unknown> | undefined;
    if (typeof init?.body === 'string' && init.body.length > 0) {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = undefined;
      }
    }

    const attempt = this.calls.filter(
      (call) => call.method === method && call.path === path
    ).length + 1;

    const request: MockRequest = {
      method,
      path,
      url,
      query: parsed.searchParams,
      headers: toHeaders(init?.headers),
      body,
      attempt,
    };
    this.calls.push(request);
    return request;
  }
}
