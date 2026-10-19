/**
 * Header Building Pipeline
 * ------------------------
 * All outgoing request headers are assembled in a single, deterministic place
 * so that default headers (User-Agent, Accept), the auth token, custom headers,
 * the idempotency key, and tracing headers are applied consistently regardless
 * of whether the request originates in the http client, an interceptor, or
 * middleware.
 *
 * Precedence (lowest to highest):
 *   1. Client default headers (Content-Type, Authorization, user defaults set
 *      via `HttpClient.setHeader`)
 *   2. Auth token (`Authorization: Bearer <token>`) — added only when no
 *      Authorization header is already present
 *   3. Custom / per-request headers (`RequestOptions.headers`) — override all
 *      of the above, so interceptors and callers always win
 *   4. Idempotency key (`Idempotency-Key`) — added only when not already set
 *   5. Tracing headers (`X-Request-Id`, `X-Correlation-ID`) — added only when
 *      the caller did not already supply them
 *   6. Default `User-Agent` and `Accept` — filled in only when absent
 *
 * Caller-supplied headers always win; generated values fill in the gaps.
 */

export interface BuildHeadersOptions {
  /** Client-level default headers (Content-Type, Authorization, user defaults). */
  defaultHeaders?: Record<string, string>;
  /** Per-request / custom headers from `RequestOptions.headers`. */
  headers?: Record<string, string>;
  /** Bearer auth token; added as `Authorization` when none is already set. */
  authToken?: string;
  /** Idempotency key sent as `Idempotency-Key`. */
  idempotencyKey?: string;
  /** Stable logical request id sent as `X-Request-Id`. */
  requestId?: string;
  /** Distributed tracing id sent as `X-Correlation-ID`. */
  correlationId?: string;
}

const DEFAULT_USER_AGENT = 'DorisioSDK/0.1.0';
const DEFAULT_ACCEPT = 'application/json';

/** Return true when `headers` already carries `name` (case-insensitive). */
function hasHeader(headers: Record<string, string> | undefined, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === target);
}

/**
 * Merge all header sources into one canonical header record.
 *
 * Headers supplied by the caller take precedence; generated values (auth
 * token, idempotency key, tracing ids, User-Agent, Accept) are only filled in
 * when they are not already present.
 */
export function buildHeaders(options: BuildHeadersOptions): Record<string, string> {
  const {
    defaultHeaders,
    headers: customHeaders,
    authToken,
    idempotencyKey,
    requestId,
    correlationId,
  } = options;

  const result: Record<string, string> = {};

  // 1. Client default headers (Content-Type, Authorization, user defaults).
  for (const [key, value] of Object.entries(defaultHeaders ?? {})) {
    result[key] = value;
  }

  // 2. Auth token — added when present and no Authorization header is set.
  if (authToken && !hasHeader(result, 'authorization')) {
    result['Authorization'] = `Bearer ${authToken}`;
  }

  // 3. Custom / per-request headers — highest precedence, override everything.
  for (const [key, value] of Object.entries(customHeaders ?? {})) {
    result[key] = value;
  }

  // 4. Idempotency key — filled in only when absent.
  if (idempotencyKey && !hasHeader(result, 'idempotency-key')) {
    result['Idempotency-Key'] = idempotencyKey;
  }

  // 5. Tracing headers — filled in only when the caller did not supply them.
  if (requestId && !hasHeader(result, 'x-request-id')) {
    result['X-Request-Id'] = requestId;
  }
  if (correlationId && !hasHeader(result, 'x-correlation-id')) {
    result['X-Correlation-ID'] = correlationId;
  }

  // 6. Default User-Agent / Accept — filled in only when absent.
  if (!hasHeader(result, 'user-agent')) {
    result['User-Agent'] = DEFAULT_USER_AGENT;
  }
  if (!hasHeader(result, 'accept')) {
    result['Accept'] = DEFAULT_ACCEPT;
  }

  return result;
}
