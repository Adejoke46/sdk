# Dorisio SDK

For production retry, backoff, circuit-breaker, and monitoring guidance, see
[`docs/RATE_LIMITING.md`](docs/RATE_LIMITING.md).

Type-safe client library for Dorisio payment infrastructure. Send tips, verify wallets, and manage creator payouts on Stellar.

[![npm version](https://img.shields.io/npm/v/dorisio-sdk.svg)](https://www.npmjs.com/package/dorisio-sdk)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

✨ **Production-Ready**

- Type-safe with full TypeScript support
- Domain-specific error handling (PaymentError, WalletVerificationError, AuthError)
- Idempotency support prevents double-charging on retries
- Webhook signature verification for async events
- Comprehensive examples (vanilla JS + React)

🚀 **Developer Experience**

- Exported Zod schemas for consumer validation
- Full JSDoc documentation with examples
- OpenAPI 3.0 specification and interactive documentation viewer
- Backend route generation CLI (`npx dorisio generate-backend`)
- TypeDoc API reference auto-generated
- Architecture Decision Records (ADRs) documenting core design choices
- React hooks for seamless integration
- Comprehensive unit tests (100% passing)

💰 **Payment Features**

- Create tips with optional messages
- Build and submit Stellar transactions
- Check transaction confirmation status
- Transaction history with pagination
- Creator earnings tracking

🔐 **Security**

- Challenge-response wallet verification
- Wallet linking with Stellar integration
- Safe retry logic with exponential backoff
- Constant-time signature verification

## Installation

```bash
npm install dorisio-sdk
```

## Quick Start

### Vanilla JavaScript

```typescript
import { DorisioClient, PaymentError, Schemas } from 'dorisio-sdk';
import { v4 as uuidv4 } from 'uuid';

const client = new DorisioClient({
  baseURL: 'https://api.dorisio.com',
  timeout: 30000,
});

// Validate input with exported schemas
const tipInput = Schemas.Payment.createTip.parse({
  amount: 50,
  currency: 'USD',
  creatorId: '550e8400-e29b-41d4-a716-446655440000',
  message: 'Great content!',
  idempotencyKey: uuidv4(), // Safe to retry with same key
});

try {
  const tip = await client.payments.createTip(tipInput);
  console.log('Tip created:', tip.id);
} catch (error) {
  if (error instanceof PaymentError) {
    console.error('Payment failed:', error.message);
  }
}
```

### React

```typescript
import { DorisioProvider, useCreateTip, useWallet } from 'dorisio-sdk/react';
import { Schemas } from 'dorisio-sdk';

function TipButton() {
  const { createTip, loading, error } = useCreateTip();

  const handleTip = async () => {
    const input = Schemas.Payment.createTip.parse({
      amount: 50,
      currency: 'USD',
      creatorId: 'xxx',
      idempotencyKey: uuidv4(),
    });

    await createTip(input);
  };

  return (
    <button onClick={handleTip} disabled={loading}>
      {loading ? 'Processing...' : 'Send Tip'}
    </button>
  );
}

export function App() {
  return (
    <DorisioProvider config={{ baseURL: 'https://api.dorisio.com' }}>
      <TipButton />
    </DorisioProvider>
  );
}
```


## Sandbox / Mock Mode

Test the SDK offline without hitting testnet or the Dorisio API. When `mode: "sandbox"` is set, `HttpClient` bypasses `fetch` and returns deterministic mock responses for every client method.

```typescript
import { DorisioClient } from 'dorisio-sdk';

const client = new DorisioClient({
  baseUrl: 'https://api.dorisio.com',
  token: 'test-token',
  mode: 'sandbox', // no network calls
  sandboxSeed: 42, // optional — same seed => same mocks
});

const tip = await client.createTip({
  creatorId: 'mock-creator-123',
  amount: 50,
  message: 'Test tip',
});

// Inspect what the sandbox handled
console.log(client.getSandboxHistory());

// Toggle to live without recreating the client
client.setMode('live');
```

Or use the dedicated helper:

```typescript
import { createSandboxClient } from 'dorisio-sdk';

const client = createSandboxClient({ seed: 42, latency: 0 });
await client.getCurrentUser();
```

### Acceptance checklist

- `DorisioClient({ mode: 'sandbox' })` works with zero network calls
- Client methods return deterministic mocks (seeded)
- `client.getSandboxHistory()` / `clearSandboxHistory()` for test assertions
- `client.setMode('sandbox' | 'live')` toggles without recreating the client

## Documentation

### API Reference

- **[Published API Docs](https://docs.dorisio.dev/)** - Auto-generated from JSDoc and deployed to GitHub Pages on every push to `main`
- **[Local TypeDoc build](./docs/index.html)** - Regenerate with `npm run docs`
- **[Examples](./examples/)** - Runnable code samples
  - [Vanilla JS](./examples/vanilla/) - Auth, wallet, payments
  - [React Components](./examples/react/) - CreateTip, WalletStatus

  - [Interceptors](./examples/interceptors/) - Logging, metrics, auth refresh, retry policy

### Interceptors

Hook into the request/response lifecycle for cross-cutting concerns (logging, metrics, retry policy, header injection). See **[INTERCEPTORS.md](./INTERCEPTORS.md)** for the full guide.

```typescript
import { DorisioClient } from 'dorisio-sdk';

const client = new DorisioClient({ baseUrl: 'https://api.dorisio.com', token: 'token' });
const interceptors = client.getHttpClient().getInterceptors();

interceptors.addRequestInterceptor((options) => {
  options.headers = { ...options.headers, 'X-Request-Id': crypto.randomUUID() };
  return options;
});
```

`InterceptorManager`, `RequestInterceptor`, `ResponseInterceptor`, `ErrorInterceptor`, and
`RequestOptions` are exported from the package root. Interceptors run sequentially in registration
order and may be async; error interceptors observe failures but do not swallow them.

### Core Concepts

#### Type-Safe Errors

Catch specific errors and handle them appropriately:

```typescript
import { PaymentError, WalletVerificationError, AuthError } from 'dorisio-sdk';

try {
  await client.payments.createTip({/* ... */});
} catch (error) {
  if (error instanceof PaymentError) {
    console.error('Payment failed:', error.message);
    console.error('Transaction:', error.transactionHash);
  } else if (error instanceof WalletVerificationError) {
    console.error('Wallet error:', error.message);
  } else if (error instanceof AuthError) {
    console.error('Auth failed:', error.message);
  }
}
```

#### Input Validation with Zod & Inferred Types

Dorisio SDK exports both Zod schemas for runtime validation and their corresponding inferred TypeScript types for compile-time safety:

- **When to use TypeScript types**: Use inferred types (`CreateTipInput`, `LoginInput`, `WalletInfo`, etc.) across your application code, component props, and API boundaries for compile-time type checking without runtime overhead.
- **When to use Zod schemas / Normalizers**: Use schemas (`PaymentSchemas`, `AuthSchemas`, `CreatorSchemas`, `WalletSchemas`) or SDK normalizers (`normalizeCreateTip`, `normalizeCreatorProfile`) at I/O boundaries—such as processing user forms, untrusted API responses, webhooks, or query parameters—to validate data shapes and prevent invalid requests.

```typescript
import {
  PaymentSchemas,
  type CreateTipInput,
  normalizeCreateTip,
} from 'dorisio-sdk';
import { v4 as uuidv4 } from 'uuid';

// 1. Static typing with inferred types
const tipData: CreateTipInput = {
  amount: 50,
  currency: 'USD',
  creatorId: '550e8400-e29b-41d4-a716-446655440000',
  message: 'Great work!',
  idempotencyKey: uuidv4(),
};

// 2. Runtime validation via Zod schemas
const validatedTip = PaymentSchemas.createTip.parse(tipData);

// Or safe parsing with error handling
const result = PaymentSchemas.createTip.safeParse(untrustedInput);
if (!result.success) {
  console.error('Validation errors:', result.error.flatten());
}

// 3. Normalizer helper for runtime validation & transformation
const normalized = normalizeCreateTip(untrustedInput);
```

#### Idempotent Payments

Safe retries with unique keys:

```typescript
const idempotencyKey = uuidv4(); // Generate once

try {
  const tip = await client.payments.createTip({
    creatorId: 'xxx',
    amount: 50,
    idempotencyKey, // Prevents double-charging on retry
  });
} catch (error) {
  // Safe to retry with same key - returns same tip
  const tip = await client.payments.createTip({
    creatorId: 'xxx',
    amount: 50,
    idempotencyKey, // Same key = same result
  });
}
```

#### Webhook Verification

Verify incoming webhooks are authentic:

```typescript
import { verifyWebhookSignature, parseWebhookPayload } from 'dorisio-sdk';

// In your webhook handler
const isValid = verifyWebhookSignature(
  JSON.stringify(req.body),
  req.headers['x-dorisio-signature'],
  process.env.DORISIO_WEBHOOK_SECRET!
);

if (!isValid) {
  return res.status(401).json({ error: 'Invalid signature' });
}

const event = parseWebhookPayload(req.body);
console.log(`Event: ${event.event}`, event.data);
```

### Custom Request Headers

You can pass custom headers per request across all client methods to pass tracing headers, tenant identifiers, or custom auth metadata. Custom headers merge with and can override default client headers:

```typescript
// Custom headers on API calls
const tip = await client.createTip(
  {
    creatorId: 'creator-123',
    amount: 25,
    message: 'Awesome work!',
  },
  {
    headers: {
      'X-Trace-Id': 'trace-abc-123',
      'X-Tenant-ID': 'tenant-99',
    },
  }
);

// Custom headers on creator fetching
const creator = await client.getCreator('creator-123', {
  headers: { 'X-Custom-Header': 'custom-value' },
});
```

### Request Queueing & Prioritization

Bound how many requests run at once and make sure important calls are served first. When the concurrency limit is reached, further requests wait in a priority queue; higher priority requests are dequeued before lower priority ones, with FIFO ordering within each level.

```typescript
const client = new DorisioClient({
  baseUrl: 'https://api.dorisio.com',
  token: 'my-token',
  queue: {
    enabled: true,
    maxConcurrent: 3, // at most 3 requests in flight
    prioritize: true, // high > normal > low
    maxQueueSize: 1000, // backpressure: reject beyond this depth
  },
});

// Per-request priority (defaults to 'normal')
const tip = await client.createTip(data, { priority: 'high' });
const history = await client.getTransactionHistory({ page: 1 }, { priority: 'low' });

// Inspect queue statistics
const stats = client.getQueueStats();
// { queueDepth, inFlight, processed, rejected, totalWaitTime, maxWaitTime, averageWaitTime }
```

Semantics:

- **Ordering**: `high` > `normal` > `low`; requests of equal priority run in FIFO order.
- **Concurrency**: at most `maxConcurrent` requests are in flight at any time.
- **Backpressure**: the waiting queue is bounded by `maxQueueSize` (default `1000`). When full, new requests reject with `QueueFullError` instead of growing memory without bound.
- **`prioritize: false`**: plain FIFO across all priorities (still respecting `maxConcurrent`).
- **`enabled: false`** (default): requests pass through with no queueing overhead.

### Batch Operations & Partial Failure Handling

Perform bulk operations with concurrency limits, exponential backoff retries, and detailed breakdown of successful and failed items:

```typescript
// Batch fetch creators with retry capability
const result = await client.getCreatorsBatch(['creator-1', 'creator-2', 'creator-3'], {
  concurrency: 5,
  maxRetries: 3,
  retryDelayMs: 500,
});

console.log(`Processed ${result.successful.length} of ${result.total} creators.`);

if (result.hasFailures) {
  console.warn(`Failed items: ${result.failed.length}`);
  
  // Retry only the failed items
  const retryResult = await client.retryBatch(result.failed, async (creatorId) => {
    return client.getCreator(creatorId);
  });
}

// Batch tip creations with partial failure resilience
const tipBatch = await client.createTipsBatch([
  { creatorId: 'c1', amount: 10 },
  { creatorId: 'c2', amount: 20 },
]);
```

### Request Fingerprinting & Debugging

Every request is assigned a unique `X-Request-ID` for end-to-end tracing across your frontend and backend infrastructure:

```typescript
// Custom request ID generator or structured logger
const client = new DorisioClient({
  baseUrl: 'https://api.dorisio.com',
  token: 'my-token',
  requestIdGenerator: () => `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
  logger: {
    level: 'debug',
    handler: (entry) => {
      console.log(`[${entry.timestamp}] [${entry.level.toUpperCase()}] [req:${entry.requestId}] ${entry.message}`);
    },
  },
});

// Access request ID on errors for debugging and support tickets
try {
  await client.getCreator('non-existent');
} catch (error) {
  if (error instanceof DorisioError) {
    console.error(`Request failed with ID ${error.requestId}: ${error.message}`);
  }
}
```

### React Hooks

#### useCreateTip

```typescript
const { createTip, loading, error, data } = useCreateTip();

const tip = await createTip(
  {
    amount: 50,
    currency: 'USD',
    creatorId: 'xxx',
    idempotencyKey: uuidv4(),
  },
  {
    headers: { 'X-Source': 'creator-modal' },
  }
);
```

#### useWallet

```typescript
const { wallet, loading, error, refetch } = useWallet({
  headers: { 'X-Custom-Header': 'wallet-view' },
});

console.log(wallet?.balance, wallet?.network);
refetch(); // Manual refresh
```

#### useCreator

```typescript
const { creator, loading, error, refetch } = useCreator('creator-123', {
  headers: { 'X-App-Client': 'web-dashboard' },
});

console.log('Creator name:', creator?.name);
```

#### useUser

```typescript
const { user, loading, error, refetch } = useUser({
  headers: { 'X-Context': 'user-profile' },
});

console.log('Logged in user:', user?.email);
```

#### useTransactionHistory

```typescript
const { transactions, total, page, goToPage, loading } = useTransactionHistory({
  limit: 20,
});

transactions.forEach((tx) => {
  console.log(`$${tx.amount} to ${tx.creatorId}`);
});
```

## Configuration

### Request and response schemas

Pass Zod or Joi schemas to validate each request body before it is sent and each
decoded response before it is returned. The schema's parsed value is used, so
coercion and other transformations reach the API and the caller. Joi is optional;
install it in your application if you use Joi schemas.

```typescript
import { z } from 'zod';
import { DorisioClient, SchemaValidationError } from 'dorisio-sdk';

const client = new DorisioClient({
  baseUrl: 'https://api.dorisio.com',
  schemas: {
    request: z.object({ amount: z.coerce.number().positive() }),
    response: z.object({ success: z.boolean(), data: z.unknown() }),
  },
});

try {
  const result = await client.getHttpClient().request('/tips', {
    method: 'POST',
    body: { amount: '10' },
  });
  console.log(result);
} catch (error) {
  if (error instanceof SchemaValidationError) {
    console.error(error.phase, error.issues); // e.g. [{ path: 'amount', message: '...' }]
  }
}
```

You can also pass `schemas` in an individual `HttpClient.request` call to
override the client defaults. Request validation applies to bodies, including
missing bodies on POST, PUT, and PATCH. GET and DELETE calls without bodies
skip request validation; response validation still runs. With no schemas,
requests use the existing path without parsing or conversion.

```typescript
const client = new DorisioClient({
  baseURL: 'https://api.dorisio.com',
  timeout: 30000,
  retryAttempts: 3,
  retryDelay: 1000,
});
```

### Environment Variables

```bash
DORISIO_API_URL=https://api.dorisio.com
DORISIO_WEBHOOK_SECRET=your-secret-key
```

## Development

```bash
# Install
npm install

# Run tests (86 tests, 100% passing)
npm run test

# Type check
npm run type-check

# Lint
npm run lint

# Generate docs (output: docs/, deployed to GitHub Pages by .github/workflows/docs.yml)
npm run docs

# Build
npm run build

# Watch mode
npm run dev
```

## Examples

See [examples/](./examples/) for complete working examples:

- **[Auth Flow](./examples/vanilla/auth.ts)** - Register, login, session validation
- **[Wallet Linking](./examples/vanilla/wallet.ts)** - Challenge-response verification
- **[Payments](./examples/vanilla/payment.ts)** - Tips with idempotency
- **[React Components](./examples/react/)** - CreateTip form, WalletStatus display
- **[Interceptors](./examples/interceptors/)** - Logging, metrics, auth refresh, retry policy wrappers

## API Overview

### Payments

```typescript
// Create tip (with idempotency)
await client.payments.createTip({
  creatorId: string;
  amount: number;
  message?: string;
  idempotencyKey?: string;
});

// Get transaction
await client.payments.getTransaction(transactionId);

// Get history
await client.payments.getTransactionHistory({ limit: 20, offset: 0 });
```

### Authentication

```typescript
// Register
await client.auth.register({
  email: string;
  password: string;
  name: string;
});

// Login
await client.auth.login({
  email: string;
  password: string;
});

// Validate session
await client.auth.validateSession();

// Logout
await client.auth.logout();
```

### Wallets

```typescript
// Request challenge
const challenge = await client.auth.requestWalletChallenge();

// Verify and link
await client.auth.verifyAndLinkWallet({
  challenge: string;
  signature: string;
  publicKey: string;
});

// Get balance
await client.wallet.getBalance();
```

## Error Handling

The SDK provides domain-specific error classes with typed fields that let you write recovery logic without string-parsing error messages.

See **[docs/ERROR_HANDLING.md](./docs/ERROR_HANDLING.md)** for the full guide, including retry patterns, circuit breaker, error logging setup, React hook usage, and sandbox testing for error paths.

| Class | statusCode | code | Key fields |
|---|---|---|---|
| `DorisioError` | varies | varies | base class — `statusCode`, `code` |
| `AuthError` | varies | varies | generic auth failure |
| `AuthenticationError` | 401 | `UNAUTHORIZED` | — |
| `AuthorizationError` | 403 | `FORBIDDEN` | — |
| `ValidationError` | 400 | `VALIDATION_ERROR` | `details` (field-level errors) |
| `PaymentError` | varies | varies | `transactionHash` |
| `WalletVerificationError` | varies | varies | `challenge` |
| `RateLimitError` | 429 | `RATE_LIMITED` | `retryAfter` (seconds) |
| `TimeoutError` | 408 | `TIMEOUT` | — |
| `NetworkError` | 0 | `NETWORK_ERROR` | — |
| `NotFoundError` | 404 | `NOT_FOUND` | — |

### Error recovery examples

#### Catch and recover from common errors

```typescript
import {
  AuthenticationError,
  ValidationError,
  RateLimitError,
  TimeoutError,
  NetworkError,
  PaymentError,
  DorisioError,
} from 'dorisio-sdk';
import { v4 as uuidv4 } from 'uuid';

const idempotencyKey = uuidv4(); // generate once, reuse on retry

try {
  const tip = await client.payments.createTip({
    creatorId: 'xxx',
    amount: 50,
    idempotencyKey,
  });
} catch (error) {
  if (error instanceof ValidationError) {
    // Input rejected — show field errors, don't retry
    showFormErrors(error.details);

  } else if (error instanceof AuthenticationError) {
    // Session expired — redirect to login
    client.clearToken();
    redirectToLogin();

  } else if (error instanceof RateLimitError) {
    // Server-requested back-off — wait, then retry with same idempotencyKey
    await sleep((error.retryAfter ?? 60) * 1000);
    await client.payments.createTip({ creatorId: 'xxx', amount: 50, idempotencyKey });

  } else if (error instanceof PaymentError && error.transactionHash) {
    // Transaction may have reached Stellar — verify before retrying
    const status = await client.payments.checkTransactionConfirmation(error.transactionHash);
    if (status !== 'confirmed') {
      // Safe to retry with same idempotencyKey
      await client.payments.createTip({ creatorId: 'xxx', amount: 50, idempotencyKey });
    }

  } else if (error instanceof TimeoutError || error instanceof NetworkError) {
    // Transient failure — same idempotencyKey prevents double-charging
    await retryWithBackoff(() =>
      client.payments.createTip({ creatorId: 'xxx', amount: 50, idempotencyKey })
    );

  } else if (!(error instanceof DorisioError)) {
    // Unexpected non-SDK error — propagate
    throw error;
  }
}
```

#### Exponential backoff helper

```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  initialDelayMs = 500
): Promise<T> {
  let delay = initialDelayMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2; // exponential backoff
    }
  }
  throw new Error('Unreachable');
}
```

Full guide: **[docs/ERROR_HANDLING.md](./docs/ERROR_HANDLING.md)**

## Browser Support

- Modern browsers with ES2020+ support
- Node.js >=20.0.0
- React >=18.0.0 (optional, for React hooks)

## Performance

- Automatic retry with exponential backoff
- Request timeout: 30s (configurable)
- Concurrent request limit: 10
- Response compression enabled

## Security

- HTTPS only in production
- Bearer token authentication
- HMAC-SHA256 webhook verification
- Constant-time signature comparison
- No secrets in logs
- Input validation with Zod

## CLI & Code Generation

The Dorisio CLI streamlines project scaffolding and backend route integration:

```bash
# Scaffold Dorisio into a frontend project
npx dorisio init

# Generate backend route handlers with Zod validation & error handling
npx dorisio generate-backend --framework express --output ./src/routes
npx dorisio generate-backend --framework nextjs --output ./app/api/dorisio
npx dorisio generate-backend --framework fastify --output ./src/routes --javascript

# Generate OpenAPI 3.0 specification from SDK type definitions
npm run generate:openapi
```

## Documentation

- 📄 [OpenAPI 3.0 Specification](./docs/openapi.json) ([Interactive API Viewer](./docs/api.html))
- 🔄 [Migration Guide (v0.0.x to v0.1.x)](./MIGRATION.md)
- 🏛️ [Architecture Decision Records (ADRs)](./docs/adr/README.md)
- 📖 [TypeDoc API Documentation](./docs/index.html)

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history and release notes.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development guidelines.

## License

MIT - See [LICENSE](./LICENSE) for details

## Support

- 📖 [Published API Documentation](https://docs.dorisio.dev/)
- 📖 [Local API Documentation](./docs/index.html)
- 💬 [GitHub Issues](https://github.com/Dorisio/sdk/issues)
- 📧 Support: support@dorisio.com
