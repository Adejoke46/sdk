# Rate limiting and resilient requests

The SDK exposes the server's rate-limit response as `RateLimitError` (HTTP
status `429`). Treat it as a temporary capacity signal, not as an application
failure.

## Headers

Servers may return `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
`X-RateLimit-Reset` (Unix seconds). A `Retry-After` header takes precedence and
may be either seconds or an HTTP date. The SDK preserves that value as
`error.retryAfter`.

## Exponential backoff

Retry only idempotent requests, or requests carrying an idempotency key. Use
jitter so many clients do not retry at the same instant:

```ts
const delay = Math.min(30_000, 500 * 2 ** attempt) + Math.random() * 250;
await new Promise((resolve) => setTimeout(resolve, delay));
```

Never retry a payment mutation without an idempotency key. The SDK's
`RequestQueue` already applies FIFO backoff for `429` responses.

## Circuit breaker

Stop sending traffic after a short run of rate-limit responses, then probe
after the reset window. Keep the breaker per API origin and expose its state to
metrics:

```ts
if (breaker.openUntil > Date.now()) throw new Error('API rate limit circuit open');
try {
  return await client.request('/api/v1/health', { method: 'GET' });
} catch (error) {
  if (error instanceof RateLimitError) breaker.open(error.retryAfter ?? 1);
  throw error;
}
```

## Monitoring

Record request count, 429 count, retry delay, and remaining quota by route and
API origin. Alert when the 429 ratio or queue depth exceeds the service's
normal baseline. Do not log authorization headers or tokens.
