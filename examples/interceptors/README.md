# Interceptor examples

Runnable, copy-pasteable interceptors for the Dorisio SDK. See
[`INTERCEPTORS.md`](../../INTERCEPTORS.md) for the full guide and the execution order.

| File | What it shows |
| --- | --- |
| [`logging.ts`](./logging.ts) | Log every request and successful response. |
| [`metrics.ts`](./metrics.ts) | Count requests/errors and record timing. |
| [`auth-refresh.ts`](./auth-refresh.ts) | Recover from `401` with the built-in single-flight refresher. |
| [`retry-policy.ts`](./retry-policy.ts) | Raise the retry budget for idempotent requests, plus a userland retry wrapper. |

All examples attach to a client through the public `InterceptorManager`:

```typescript
import { DorisioClient } from 'dorisio-sdk';
import { withLogging } from './logging';

const client = withLogging(
  new DorisioClient({ baseUrl: 'https://api.dorisio.com', token: 'token' })
);
```

Interceptors run sequentially in registration order and may be `async`. Error interceptors are
awaited but cannot swallow an error — the SDK rethrows the original failure so existing `try/catch`
code keeps working.
