# Interceptors

Interceptors let you hook into the Dorisio SDK request/response lifecycle to add cross-cutting
behaviour — logging, metrics, retry policy, header injection — without wrapping every call site.

The `InterceptorManager` is part of the public API:

```typescript
import {
  DorisioClient,
  InterceptorManager,
  type RequestInterceptor,
  type ResponseInterceptor,
  type ErrorInterceptor,
  type RequestOptions,
} from 'dorisio-sdk';
```

Access the manager from a client:

```typescript
const client = new DorisioClient({ baseUrl: 'https://api.dorisio.com', token: 'token' });

const interceptors: InterceptorManager = client.getHttpClient().getInterceptors();
```

> Interceptors are registered on the `HttpClient`, which is shared by every bound client method
> (`client.payments.*`, `client.wallets.*`, …). Registering one applies it to all of them.

---

## Quick start

```typescript
import { DorisioClient } from 'dorisio-sdk';

const client = new DorisioClient({ baseUrl: 'https://api.dorisio.com', token: 'token' });
const interceptors = client.getHttpClient().getInterceptors();

interceptors.addRequestInterceptor((options) => {
  options.headers = { ...options.headers, 'X-Request-Id': crypto.randomUUID() };
  return options;
});

interceptors.addResponseInterceptor((response) => {
  console.log('response received');
  return response;
});

interceptors.addErrorInterceptor((error) => {
  console.error('request failed', error);
  return error;
});
```

---

## API

| Method | Signature | Purpose |
| --- | --- | --- |
| `addRequestInterceptor` | `(interceptor: RequestInterceptor) => void` | Mutate/observe outgoing requests before they are sent. |
| `addResponseInterceptor` | `(interceptor: ResponseInterceptor) => void` | Observe/transform a successful response payload. |
| `addErrorInterceptor` | `(interceptor: ErrorInterceptor) => void` | Observe failures (including retried attempts). |
| `executeRequestInterceptors` | `(options: RequestOptions) => Promise<RequestOptions>` | Runs all request interceptors. |
| `executeResponseInterceptors` | `<T>(response: T) => Promise<T>` | Runs all response interceptors. |
| `executeErrorInterceptors` | `(error: unknown) => Promise<unknown>` | Runs all error interceptors. |

```typescript
export type RequestInterceptor = (
  options: RequestOptions
) => RequestOptions | Promise<RequestOptions>;

export type ResponseInterceptor = <T>(response: T) => T | Promise<T>;

export type ErrorInterceptor = (error: unknown) => unknown | Promise<unknown>;

export interface RequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  timeout?: number;
  retries?: number;
  isIdempotent?: boolean;
}
```

---

## Execution order

Interceptors run **sequentially, in registration order**, and may be `async` — each interceptor is
awaited before the next one starts.

1. **Request interceptors** run once per `HttpClient.request()` call, in the order they were added.
   The value returned by an interceptor is passed to the next one, and the final result is the
   options actually sent. Because they run once, a request interceptor is not re-executed on a
   built-in retry attempt.
2. The request is sent (or served from the sandbox mock router when `mode: 'sandbox'`).
3. **Response interceptors** run after a successful response, in registration order. The returned
   value becomes the payload the caller receives, so a response interceptor can reshape data.
   In live mode they run on **every attempt** of the retry loop; in sandbox mode they run once.
4. **Error interceptors** run on every failed attempt, in registration order, before the retry
   loop decides whether to try again.

```
request() ──▶ request interceptors ──▶ fetch / sandbox mock
                                             │
                        ┌──────── success ──┴── failure ─────────┐
                        ▼                                        ▼
              response interceptors                      error interceptors
                (return value = payload)                 (observation only)
```

### Error handling

Error interceptors are **observational**: they are awaited so logging/metrics side effects are
flushed, but their return value is **not** substituted for the error. The SDK rethrows the original
error after running them so callers keep their existing `try/catch` semantics:

```typescript
interceptors.addErrorInterceptor(async (error) => {
  await reportToSentry(error); // await is honoured before the error is rethrown
  return error;                // return value is ignored
});
```

If you need to turn a failure into a success, do it in the calling code or with a custom method
wrapper — not in an error interceptor.

Client errors (`4xx`) are never retried. Server errors (`5xx`/network) are retried only for
idempotent requests; a `POST`/`DELETE` must opt in with `isIdempotent: true` or an
`Idempotency-Key` header. See [Idempotent Payments](./README.md#idempotent-payments).

### Interceptors and the built-in 401 refresh

`HttpClient` already recovers from `401 Unauthorized` when a token refresher is registered
(`client.setTokenRefresher(fn)`), so a refresh does **not** need to be an interceptor. Prefer the
built-in path; the example below shows both.

---

## Examples

Runnable samples live in [`examples/interceptors/`](./examples/interceptors/).

### 1. Logging interceptor

```typescript
import type { RequestInterceptor } from 'dorisio-sdk';

const start = new WeakMap<object, number>();

export const loggingRequestInterceptor: RequestInterceptor = (options) => {
  start.set(options, Date.now());
  console.log(`→ ${options.method} ${options.body ? Object.keys(options.body).join(', ') : ''}`);
  return options;
};

const loggingResponseInterceptor = <T>(response: T): T => {
  console.log('← response OK');
  return response;
};
```

### 2. Metrics interceptor

```typescript
import type { RequestInterceptor, ErrorInterceptor } from 'dorisio-sdk';

export const metrics = {
  requests: 0,
  errors: 0,
};

export const metricsRequestInterceptor: RequestInterceptor = (options) => {
  metrics.requests += 1;
  return options;
};

export const metricsErrorInterceptor: ErrorInterceptor = (error) => {
  metrics.errors += 1;
  return error;
};
```

> Request and response interceptors do not share a handle for the same call, so per-call timing
> belongs in a wrapper around the operation rather than inside an interceptor:
>
> ```typescript
> async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
>   const start = Date.now();
>   try {
>     return await fn();
>   } finally {
>     console.log(`${label} took ${Date.now() - start}ms`);
>   }
> }
> ```

### 3. Auth refresh (401)

Preferred — the SDK's built-in, single-flight refresh:

```typescript
client.setTokenRefresher(async () => {
  const { accessToken } = await refreshSession();
  client.getHttpClient().setHeader('Authorization', `Bearer ${accessToken}`);
});
```

The SDK will refresh at most once per rejection, shares one in-flight refresh across concurrent
401s, and never attempts a refresh for `/auth/login`, `/auth/register`, `/auth/refresh` (that would
recurse) or for requests without credentials.

If you already own the refresh flow, you can observe `401`s with an error interceptor for
telemetry, but the retry itself should remain the built-in one:

```typescript
interceptors.addErrorInterceptor((error) => {
  if (error instanceof ApiError && error.statusCode === 401) {
    console.warn('session rejected; built-in refresher will retry');
  }
  return error;
});
```

### 4. Retry policy interceptor

The SDK retries idempotent requests automatically. A request interceptor is the right place to set a
per-endpoint retry budget without touching call sites:

```typescript
import type { RequestInterceptor } from 'dorisio-sdk';

export const retryPolicyInterceptor: RequestInterceptor = (options) => {
  const idempotent = ['GET', 'PUT', 'PATCH'].includes(options.method);
  if (idempotent) {
    options.retries = Math.max(options.retries ?? 0, 5);
  }
  return options;
};
```

For a userland retry around a whole SDK call (for example, retrying a logical operation rather than
a single HTTP request):

```typescript
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 100));
    }
  }
  throw lastError;
}
```

---

## Sandbox compatibility

Interceptors run in sandbox mode too: request interceptors execute before the mock router, and
response interceptors receive the deterministic mock payload. This makes them useful for asserting
that your middleware is wired up, without any network access:

```typescript
const client = createSandboxClient();
const interceptors = client.getHttpClient().getInterceptors();
let calls = 0;
interceptors.addRequestInterceptor((options) => {
  calls += 1;
  return options;
});

await client.getCurrentUser();
console.log(calls); // 1
```
