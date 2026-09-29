# Error Handling

The Dorisio SDK uses a typed error hierarchy that lets you handle exactly what you
care about and propagate everything else. This guide covers every error class,
explains which errors to catch vs. propagate, documents retry patterns, and
shows you how to set up structured error logging.

---

## Table of Contents

- [Error hierarchy](#error-hierarchy)
- [Error reference](#error-reference)
  - [DorisioError — base class](#dorisioerror--base-class)
  - [AuthError](#autherror)
  - [AuthenticationError](#authenticationerror)
  - [AuthorizationError](#authorizationerror)
  - [PaymentError](#paymenterror)
  - [WalletVerificationError](#walletverificationerror)
  - [ValidationError](#validationerror)
  - [RateLimitError](#ratelimiterror)
  - [TimeoutError](#timeouterror)
  - [NetworkError](#networkerror)
  - [NotFoundError](#notfounderror)
  - [ApiError — legacy base](#apierror--legacy-base)
- [Error codes and HTTP status codes](#error-codes-and-http-status-codes)
- [Which errors to catch vs. propagate](#which-errors-to-catch-vs-propagate)
- [Common error scenarios and solutions](#common-error-scenarios-and-solutions)
- [Retry patterns](#retry-patterns)
  - [Built-in retry](#built-in-retry)
  - [Manual retry with RateLimitError.retryAfter](#manual-retry-with-ratelimiterrorretryafter)
  - [Exponential backoff helper](#exponential-backoff-helper)
  - [Circuit breaker pattern](#circuit-breaker-pattern)
- [Error logging setup](#error-logging-setup)
  - [Structured logging](#structured-logging)
  - [Log via interceptors](#log-via-interceptors)
  - [What not to log](#what-not-to-log)
- [React error handling](#react-error-handling)
- [Sandbox testing for error paths](#sandbox-testing-for-error-paths)

---

## Error hierarchy

```
Error (built-in)
└── DorisioError           statusCode?, code?
    ├── AuthError          generic auth failure
    │   ├── AuthenticationError   401 UNAUTHORIZED
    │   └── AuthorizationError    403 FORBIDDEN
    ├── PaymentError       transactionHash?
    ├── WalletVerificationError   challenge?
    ├── ValidationError    details?, always 400 VALIDATION_ERROR
    ├── RateLimitError     retryAfter?, always 429 RATE_LIMITED
    ├── TimeoutError       always 408 TIMEOUT
    ├── NetworkError       always 0  NETWORK_ERROR
    ├── NotFoundError      always 404 NOT_FOUND
    └── ApiError           legacy base (statusCode, code)
```

All error classes are exported from the package root:

```typescript
import {
  DorisioError,
  AuthError,
  AuthenticationError,
  AuthorizationError,
  PaymentError,
  WalletVerificationError,
  ValidationError,
  RateLimitError,
  TimeoutError,
  NetworkError,
  NotFoundError,
  ApiError,
} from 'dorisio-sdk';
```

---

## Error reference

### DorisioError — base class

The base class for every SDK-originated error.

```typescript
class DorisioError extends Error {
  readonly statusCode?: number; // HTTP status code, if applicable
  readonly code?: string;       // Machine-readable error code
}
```

Use `instanceof DorisioError` as a catch-all to distinguish SDK errors from
unexpected runtime errors (bugs, third-party library throws, etc.).

```typescript
try {
  await client.payments.createTip(data);
} catch (error) {
  if (error instanceof DorisioError) {
    // SDK-originated: safe to display error.message to users
    console.error(error.code, error.statusCode, error.message);
  } else {
    // Unexpected — re-throw so your global handler or error boundary sees it
    throw error;
  }
}
```

---

### AuthError

Generic authentication failure. Thrown when the SDK detects an auth problem
that does not map to a specific HTTP status (e.g., a missing token before a
request is sent). Subclasses `AuthenticationError` and `AuthorizationError`
carry fixed HTTP statuses.

**When thrown:** Token is missing, malformed, or an auth endpoint returns an
unrecognised response.

**How to handle:** Redirect the user to login.

```typescript
import { AuthError } from 'dorisio-sdk';

try {
  await client.auth.validateSession();
} catch (error) {
  if (error instanceof AuthError) {
    redirectToLogin();
  }
}
```

---

### AuthenticationError

The request was rejected because the caller is not authenticated.

| Property   | Value           |
|------------|-----------------|
| statusCode | `401`           |
| code       | `UNAUTHORIZED`  |

**When thrown:** The server returns HTTP 401. Common causes: expired token,
missing `Authorization` header, or logging in with wrong credentials.

**How to handle:** Clear the token, prompt the user to log in again. Do not
retry without fresh credentials.

```typescript
import { AuthenticationError } from 'dorisio-sdk';

try {
  await client.auth.validateSession();
} catch (error) {
  if (error instanceof AuthenticationError) {
    client.clearToken();
    redirectToLogin();
  }
}
```

---

### AuthorizationError

The caller is authenticated but lacks permission for the requested resource.

| Property   | Value       |
|------------|-------------|
| statusCode | `403`       |
| code       | `FORBIDDEN` |

**When thrown:** The server returns HTTP 403. The token is valid but the
account does not have the required role or ownership.

**How to handle:** Show a "permission denied" message. Do not retry — the
same credentials will always be refused for this resource.

```typescript
import { AuthorizationError } from 'dorisio-sdk';

try {
  await client.creators.updateCreator(creatorId, data);
} catch (error) {
  if (error instanceof AuthorizationError) {
    showError('You do not have permission to edit this creator.');
  }
}
```

---

### PaymentError

A payment operation failed on the server side.

| Property         | Value                                      |
|------------------|--------------------------------------------|
| statusCode       | Varies (typically `402`, `409`, `500`)     |
| code             | Varies (e.g., `PAYMENT_FAILED`, `SERVER_ERROR`) |
| transactionHash  | Optional — Stellar transaction hash if the transaction was submitted before the error occurred |

**When thrown:** `createTip`, `buildPaymentTransaction`, or
`submitPaymentTransaction` fails.

**Key consideration:** If `transactionHash` is present, the transaction may
have been submitted to the Stellar network even though the SDK received an
error. Always check and record `transactionHash` before retrying to avoid
duplicate payments. Use an idempotency key on the original call to guarantee
safety on retry.

```typescript
import { PaymentError } from 'dorisio-sdk';
import { v4 as uuidv4 } from 'uuid';

const idempotencyKey = uuidv4(); // generate once, reuse on retry

try {
  const tip = await client.payments.createTip({
    creatorId: 'xxx',
    amount: 50,
    idempotencyKey, // safe to retry with same key
  });
} catch (error) {
  if (error instanceof PaymentError) {
    if (error.transactionHash) {
      // Transaction may have landed — log hash and verify before retrying
      logger.warn('Payment error after submission', {
        transactionHash: error.transactionHash,
        message: error.message,
      });
      const status = await client.payments.checkTransactionConfirmation(
        error.transactionHash
      );
      if (status === 'confirmed') {
        // Already succeeded — don't charge again
        return;
      }
    }
    // Safe to retry with same idempotencyKey
  }
}
```

---

### WalletVerificationError

Wallet linking or the challenge-response verification flow failed.

| Property  | Value                                        |
|-----------|----------------------------------------------|
| statusCode | Varies (typically `400`, `409`, `422`)      |
| code       | Varies (e.g., `VERIFICATION_FAILED`)        |
| challenge  | Optional — the challenge string from the current or failed verification attempt |

**When thrown:** `verifyAndLinkWallet` or `verifyWallet` fails.

**How to handle:** If `challenge` is present, start the signing flow again
with the same challenge. Otherwise request a fresh challenge.

```typescript
import { WalletVerificationError } from 'dorisio-sdk';

async function linkWallet(publicKey: string) {
  const { challenge } = await client.auth.requestWalletChallenge();

  try {
    const signature = await signChallenge(challenge, privateKey);
    await client.auth.verifyAndLinkWallet({ challenge, signature, publicKey });
  } catch (error) {
    if (error instanceof WalletVerificationError) {
      if (error.challenge) {
        // Challenge is still valid — re-sign and retry
        const newSignature = await signChallenge(error.challenge, privateKey);
        await client.auth.verifyAndLinkWallet({
          challenge: error.challenge,
          signature: newSignature,
          publicKey,
        });
      } else {
        // Challenge expired — start over
        return linkWallet(publicKey);
      }
    }
  }
}
```

---

### ValidationError

The request was rejected because of invalid input. Always a client-side error.

| Property   | Value               |
|------------|---------------------|
| statusCode | `400`               |
| code       | `VALIDATION_ERROR`  |
| details    | Optional — field-level breakdown of what failed |

**When thrown:** The server returns HTTP 400 with validation details, or the
SDK's own `RequestValidator` rejects input before sending.

**How to handle:** Do not retry. Show `details` in your form/UI so the user
can correct the input.

```typescript
import { ValidationError } from 'dorisio-sdk';

try {
  await client.payments.createTip({ creatorId: '', amount: -5 });
} catch (error) {
  if (error instanceof ValidationError) {
    // Never retry — fix the input
    console.error('Validation failed:', error.details);
    // Example details: { amount: 'Must be greater than 0', creatorId: 'Required' }
    showFormErrors(error.details);
  }
}
```

Prefer validating with the exported Zod schemas *before* calling the SDK to
catch errors locally without a network round-trip:

```typescript
import { PaymentSchemas } from 'dorisio-sdk';

const result = PaymentSchemas.createTip.safeParse(userInput);
if (!result.success) {
  showFormErrors(result.error.flatten().fieldErrors);
  return; // don't call the SDK at all
}

await client.payments.createTip(result.data);
```

---

### RateLimitError

The server has throttled the caller.

| Property   | Value          |
|------------|----------------|
| statusCode | `429`          |
| code       | `RATE_LIMITED` |
| retryAfter | Optional — seconds to wait before retrying, sourced from the server's `Retry-After` header |

**When thrown:** The server returns HTTP 429.

**How to handle:** Wait for `retryAfter` seconds (or fall back to exponential
backoff) before retrying. The SDK's built-in retry logic already handles
transient 429s for idempotent requests; you only need to handle `RateLimitError`
when a request exhausts all retry attempts.

```typescript
import { RateLimitError } from 'dorisio-sdk';

async function createTipWithBackoff(data: CreateTipInput) {
  try {
    return await client.payments.createTip(data);
  } catch (error) {
    if (error instanceof RateLimitError) {
      const waitSeconds = error.retryAfter ?? 60;
      console.warn(`Rate limited. Retrying in ${waitSeconds}s…`);
      await sleep(waitSeconds * 1000);
      return client.payments.createTip(data); // same idempotencyKey in data
    }
    throw error;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

---

### TimeoutError

The request did not complete within the configured timeout.

| Property   | Value     |
|------------|-----------|
| statusCode | `408`     |
| code       | `TIMEOUT` |

**When thrown:** The per-request timeout fires (default 30 s), or the server
returns HTTP 408.

**How to handle:** Safe to retry for idempotent requests. Use an
`idempotencyKey` for payment calls to prevent double-charging. The SDK
retries timeouts automatically for requests it knows are idempotent.

```typescript
import { TimeoutError } from 'dorisio-sdk';
import { v4 as uuidv4 } from 'uuid';

const idempotencyKey = uuidv4();

try {
  return await client.payments.createTip({ ...data, idempotencyKey });
} catch (error) {
  if (error instanceof TimeoutError) {
    // Safe to retry — server will return the original tip if already created
    return client.payments.createTip({ ...data, idempotencyKey });
  }
  throw error;
}
```

---

### NetworkError

A low-level network failure — no response was received from the server.

| Property   | Value           |
|------------|-----------------|
| statusCode | `0`             |
| code       | `NETWORK_ERROR` |

**When thrown:** `fetch` rejects with a network error (DNS failure, connection
refused, offline). The SDK normalises these from raw `TypeError` throws.

**How to handle:** Check connectivity, then retry with backoff. Network
errors are always safe to retry because no request reached the server.

```typescript
import { NetworkError } from 'dorisio-sdk';

try {
  await client.payments.createTip(data);
} catch (error) {
  if (error instanceof NetworkError) {
    if (!navigator.onLine) {
      showError('No internet connection. Please check your network and try again.');
    } else {
      // Transient — retry with backoff
      await retryWithBackoff(() => client.payments.createTip(data));
    }
  }
}
```

---

### NotFoundError

The requested resource does not exist.

| Property   | Value       |
|------------|-------------|
| statusCode | `404`       |
| code       | `NOT_FOUND` |

**When thrown:** The server returns HTTP 404.

**How to handle:** Do not retry. The resource either never existed or was
deleted. Show a "not found" message or redirect.

```typescript
import { NotFoundError } from 'dorisio-sdk';

try {
  const creator = await client.creators.getCreator(creatorId);
} catch (error) {
  if (error instanceof NotFoundError) {
    showError(`Creator ${creatorId} not found.`);
    redirectToCreatorList();
  }
}
```

---

### ApiError — legacy base

`ApiError` is the legacy base for server errors. New code should catch the
specific subclasses above. `ApiError` remains useful when catching 5xx server
errors that don't have a more specific class:

```typescript
import { ApiError, DorisioError } from 'dorisio-sdk';

try {
  await client.payments.createTip(data);
} catch (error) {
  if (error instanceof DorisioError && error.statusCode && error.statusCode >= 500) {
    // Server error — may be transient, retry with backoff
    await retryWithBackoff(() => client.payments.createTip(data));
  }
}
```

---

## Error codes and HTTP status codes

| Class                    | statusCode | code               | Retryable |
|--------------------------|------------|--------------------|-----------|
| `AuthenticationError`    | 401        | `UNAUTHORIZED`     | No        |
| `AuthorizationError`     | 403        | `FORBIDDEN`        | No        |
| `ValidationError`        | 400        | `VALIDATION_ERROR` | No        |
| `NotFoundError`          | 404        | `NOT_FOUND`        | No        |
| `TimeoutError`           | 408        | `TIMEOUT`          | Yes*      |
| `RateLimitError`         | 429        | `RATE_LIMITED`     | Yes†      |
| `ApiError` (5xx)         | 500–504    | `SERVER_ERROR`     | Yes       |
| `NetworkError`           | 0          | `NETWORK_ERROR`    | Yes       |
| `PaymentError`           | varies     | varies             | Yes*      |
| `WalletVerificationError`| varies     | varies             | Situational |
| `AuthError`              | varies     | varies             | No        |

\* Only with an idempotency key or for GET/HEAD methods.  
† Wait for `retryAfter` seconds before retrying.

---

## Which errors to catch vs. propagate

A simple rule: **catch what you can recover from; propagate everything else.**

### Always catch at the call site

- `ValidationError` — fix the input, don't retry.
- `AuthenticationError` — clear the token and redirect to login.
- `RateLimitError` — back off and retry after `retryAfter` seconds.
- `PaymentError` with `transactionHash` — verify the transaction status
  before deciding whether to retry.

### Catch and retry

- `TimeoutError` — retry with the same `idempotencyKey`.
- `NetworkError` — retry with exponential backoff.
- `ApiError` with 5xx `statusCode` — transient server errors; retry with backoff.

### Propagate up (or let an error boundary handle)

- `AuthorizationError` — the user cannot fix this at runtime.
- `NotFoundError` — the resource is gone; redirect, don't retry.
- Anything that isn't a `DorisioError` — this is an unexpected bug.

```typescript
import {
  DorisioError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  RateLimitError,
  NotFoundError,
  TimeoutError,
  NetworkError,
  PaymentError,
} from 'dorisio-sdk';

async function sendTip(data: CreateTipInput) {
  try {
    return await client.payments.createTip(data);
  } catch (error) {
    if (error instanceof ValidationError) {
      // Fix input — don't retry
      showFormErrors(error.details);
      return;
    }

    if (error instanceof AuthenticationError) {
      // Session expired — redirect
      client.clearToken();
      redirectToLogin();
      return;
    }

    if (error instanceof RateLimitError) {
      // Server-requested back-off
      await sleep((error.retryAfter ?? 60) * 1000);
      return sendTip(data); // same idempotencyKey in data
    }

    if (error instanceof PaymentError && error.transactionHash) {
      // Transaction may have been submitted — verify before retrying
      const confirmed = await checkConfirmed(error.transactionHash);
      if (confirmed) return; // already done
    }

    if (error instanceof TimeoutError || error instanceof NetworkError) {
      // Transient — retry is safe with idempotencyKey
      return retryWithBackoff(() => client.payments.createTip(data));
    }

    // AuthorizationError, NotFoundError, or non-SDK errors:
    // propagate to caller / error boundary
    throw error;
  }
}
```

---

## Common error scenarios and solutions

### Scenario: Login fails with 401

```typescript
import { AuthenticationError } from 'dorisio-sdk';

try {
  await client.auth.login({ email, password });
} catch (error) {
  if (error instanceof AuthenticationError) {
    showError('Incorrect email or password.');
    // Don't retry — user must correct credentials
  }
}
```

### Scenario: Session expires mid-flow

Use an error interceptor to refresh tokens automatically:

```typescript
import { AuthenticationError } from 'dorisio-sdk';

client.getHttpClient().getInterceptors().addErrorInterceptor(async (error) => {
  if (error instanceof AuthenticationError) {
    try {
      await client.auth.refreshSession();
      // The interceptor cannot replay the original request;
      // signal the caller to retry
    } catch {
      client.clearToken();
      redirectToLogin();
    }
  }
  // Always re-throw — error interceptors observe, they don't swallow
  throw error;
});
```

> See [INTERCEPTORS.md](../INTERCEPTORS.md) for the full interceptor API.

### Scenario: Tip times out and you don't know if it was created

```typescript
import { TimeoutError, PaymentError } from 'dorisio-sdk';
import { v4 as uuidv4 } from 'uuid';

async function safeSendTip(data: Omit<CreateTipInput, 'idempotencyKey'>) {
  const idempotencyKey = uuidv4(); // generate once

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await client.payments.createTip({ ...data, idempotencyKey });
    } catch (error) {
      if (error instanceof TimeoutError || error instanceof NetworkError) {
        // Same idempotencyKey — server returns the original tip if already created
        await sleep(2 ** attempt * 1000);
        continue;
      }
      throw error; // non-retryable
    }
  }
  throw new Error('Tip creation failed after 3 attempts');
}
```

### Scenario: Rate limit during bulk operations

```typescript
import { RateLimitError } from 'dorisio-sdk';

async function sendBulkTips(tips: CreateTipInput[]) {
  const results = [];
  for (const tip of tips) {
    let sent = false;
    while (!sent) {
      try {
        results.push(await client.payments.createTip(tip));
        sent = true;
      } catch (error) {
        if (error instanceof RateLimitError) {
          const wait = (error.retryAfter ?? 60) * 1000;
          console.warn(`Rate limited. Waiting ${wait / 1000}s before continuing.`);
          await sleep(wait);
        } else {
          throw error;
        }
      }
    }
  }
  return results;
}
```

### Scenario: Wallet verification challenge expires

```typescript
import { WalletVerificationError } from 'dorisio-sdk';

async function linkWalletWithRetry(publicKey: string, maxAttempts = 2) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { challenge } = await client.auth.requestWalletChallenge();
    const signature = await wallet.sign(challenge);

    try {
      return await client.auth.verifyAndLinkWallet({ challenge, signature, publicKey });
    } catch (error) {
      if (error instanceof WalletVerificationError && attempt < maxAttempts - 1) {
        // Challenge may have expired — try with a fresh one on next iteration
        continue;
      }
      throw error;
    }
  }
}
```

### Scenario: Creator not found (deleted or bad ID)

```typescript
import { NotFoundError } from 'dorisio-sdk';

try {
  const creator = await client.creators.getCreator(creatorId);
  displayCreator(creator);
} catch (error) {
  if (error instanceof NotFoundError) {
    // No point retrying — handle gracefully
    displayEmptyState(`Creator ${creatorId} no longer exists.`);
  } else {
    throw error;
  }
}
```

---

## Retry patterns

### Built-in retry

The SDK's `HttpClient` automatically retries requests that fail with status
codes `408`, `429`, `500`, `502`, `503`, and `504`. The default configuration
is:

| Setting            | Default |
|--------------------|---------|
| maxAttempts        | 3       |
| initialDelayMs     | 1 000   |
| maxDelayMs         | 30 000  |
| backoffMultiplier  | 2×      |
| jitter             | ±10%    |

Only idempotent requests are retried by default:
- `GET` and `HEAD` are always retried.
- `POST`, `PUT`, `PATCH`, `DELETE` are retried only if an `Idempotency-Key`
  header is set or `isIdempotent: true` is passed.

Override the retry budget for safe methods using a request interceptor:

```typescript
import { DorisioClient, type RequestInterceptor } from 'dorisio-sdk';

const moreRetries: RequestInterceptor = (options) => {
  if (options.method === 'GET') {
    options.retries = 5;
  }
  return options;
};

client.getHttpClient().getInterceptors().addRequestInterceptor(moreRetries);
```

### Manual retry with RateLimitError.retryAfter

The `retryAfter` value comes directly from the server's `Retry-After`
response header, expressed in seconds. Always prefer it over a hard-coded
delay:

```typescript
import { RateLimitError } from 'dorisio-sdk';

async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof RateLimitError) {
      const delayMs = (error.retryAfter ?? 60) * 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return fn(); // one more attempt
    }
    throw error;
  }
}
```

### Exponential backoff helper

Use this for `TimeoutError`, `NetworkError`, and 5xx `ApiError` where the
SDK's built-in retries have been exhausted (i.e., all attempts failed):

```typescript
import { TimeoutError, NetworkError, ApiError } from 'dorisio-sdk';

const RETRYABLE = [TimeoutError, NetworkError];

function isTransient(error: unknown): boolean {
  if (RETRYABLE.some((E) => error instanceof E)) return true;
  if (error instanceof ApiError && error.statusCode && error.statusCode >= 500) return true;
  return false;
}

async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  {
    maxAttempts = 4,
    initialDelayMs = 500,
    maxDelayMs = 16_000,
    factor = 2,
  } = {}
): Promise<T> {
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransient(error) || attempt === maxAttempts) throw error;

      const jitter = delay * 0.1 * (Math.random() * 2 - 1);
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
      delay = Math.min(delay * factor, maxDelayMs);
    }
  }

  // TypeScript — unreachable, but satisfies the return type
  throw new Error('Unreachable');
}

// Usage
const tip = await withExponentialBackoff(
  () => client.payments.createTip({ ...data, idempotencyKey }),
  { maxAttempts: 4 }
);
```

### Circuit breaker pattern

A circuit breaker prevents cascading failures when a service is consistently
down. After a threshold of consecutive failures the circuit "opens" and
requests fail immediately (no network call) for a cooldown period.

```typescript
import { DorisioError } from 'dorisio-sdk';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private nextAttemptAt = 0;

  constructor(
    private readonly failureThreshold = 5,
    private readonly cooldownMs = 30_000
  ) {}

  async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttemptAt) {
        throw new Error('Circuit is OPEN — request blocked');
      }
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  private onFailure() {
    this.failures++;
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttemptAt = Date.now() + this.cooldownMs;
    }
  }
}

const breaker = new CircuitBreaker(5, 30_000);

try {
  const tip = await breaker.call(() =>
    client.payments.createTip({ ...data, idempotencyKey })
  );
} catch (error) {
  if (error instanceof DorisioError) {
    handleSdkError(error);
  } else {
    // May be the breaker itself — show degraded service message
    showError('Payment service temporarily unavailable.');
  }
}
```

---

## Error logging setup

### Structured logging

Log errors as structured objects rather than plain strings so they are
searchable and correlatable with traces:

```typescript
import {
  DorisioError,
  ValidationError,
  PaymentError,
  RateLimitError,
} from 'dorisio-sdk';

function logError(operation: string, error: unknown, context?: Record<string, unknown>) {
  if (error instanceof DorisioError) {
    // Never log raw payment data — only safe identifiers
    logger.error({
      event: 'sdk_error',
      operation,
      errorType: error.constructor.name,
      code: error.code,
      statusCode: error.statusCode,
      message: error.message,
      // Domain-specific safe fields:
      ...(error instanceof PaymentError && {
        transactionHash: error.transactionHash,
      }),
      ...(error instanceof ValidationError && {
        validationDetails: error.details,
      }),
      ...(error instanceof RateLimitError && {
        retryAfter: error.retryAfter,
      }),
      ...context,
    });
  } else {
    logger.error({
      event: 'unexpected_error',
      operation,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ...context,
    });
  }
}

// Usage
try {
  await client.payments.createTip(data);
} catch (error) {
  logError('createTip', error, { creatorId: data.creatorId, amount: data.amount });
  throw error; // propagate after logging
}
```

### Log via interceptors

Attach a single error interceptor to log every SDK error without decorating
each call site:

```typescript
import { DorisioClient, DorisioError } from 'dorisio-sdk';

function attachErrorLogger(client: DorisioClient, logger: Logger) {
  client.getHttpClient().getInterceptors().addErrorInterceptor((error) => {
    if (error instanceof DorisioError) {
      logger.error('sdk_request_failed', {
        code: error.code,
        statusCode: error.statusCode,
        message: error.message,
      });
    }
    // Re-throw — interceptors must not swallow errors
    throw error;
  });
}

const client = new DorisioClient({ baseUrl: 'https://api.dorisio.com', token });
attachErrorLogger(client, myLogger);
```

You can also capture request context from a request interceptor and correlate
it with errors (e.g., attach a request ID):

```typescript
const requestMeta = new Map<string, { startedAt: number; path: string }>();

interceptors.addRequestInterceptor((options) => {
  const requestId = crypto.randomUUID();
  options.headers = { ...options.headers, 'X-Request-Id': requestId };
  options.requestId = requestId;
  requestMeta.set(requestId, { startedAt: Date.now(), path: options.url ?? '' });
  return options;
});

interceptors.addErrorInterceptor((error, requestId) => {
  const meta = requestId ? requestMeta.get(requestId) : undefined;
  logger.error('request_error', {
    requestId,
    durationMs: meta ? Date.now() - meta.startedAt : undefined,
    path: meta?.path,
    error: error instanceof DorisioError ? { code: error.code, status: error.statusCode } : String(error),
  });
  requestMeta.delete(requestId ?? '');
  throw error;
});
```

### What not to log

- **Auth tokens** — never log `Authorization` header values or the raw token.
- **Passwords / secrets** — strip from request bodies before logging.
- **Wallet private keys / signatures** — never present in SDK calls, but worth
  noting if you build on top of these APIs.
- **Full request/response bodies in production** — log only safe identifiers
  (IDs, status codes). Body logging is acceptable in development with the SDK's
  built-in `debug: true` option.

Enable sanitised debug logging through the client config:
# Error Handling and Recovery

The Dorisio SDK provides custom error handlers and error recovery strategies to help you implement robust error handling in your application.

## Custom Error Handlers

You can register a custom error handler to implement custom error recovery logic such as retrying with custom delays, implementing fallback strategies, or circuit breaker patterns.

### Basic Usage

```typescript
import { DorisioClient } from 'dorisio-sdk';

const client = new DorisioClient({
  baseUrl: 'https://api.dorisio.com',
  token: 'your-token',
  errorHandler: async (error, context) => {
    if (error.statusCode === 429) {
      // Custom rate limit handling
      return { action: 'retry', delayMs: 5000 };
    }
    if (error.statusCode && error.statusCode >= 500) {
      // Custom server error handling
      return { action: 'fallback', fallbackValue: { cached: true } };
    }
    return { action: 'throw' };
  },
});
```

### Error Handler Actions

The error handler can return one of three actions:

- **`{ action: 'retry', delayMs?: number }`** - Retry the request with an optional custom delay
- **`{ action: 'fallback', fallbackValue: unknown }`** - Return a fallback value instead of throwing the error
- **`{ action: 'throw' }`** - Throw the error as normal

### Error Context

The error handler receives context information about the request:

```typescript
interface ErrorHandlerContext {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  attempt?: number;
  requestId?: string;
}
```

### Registering Error Handlers

You can also register error handlers after creating the client:

```typescript
client.onError(async (error, context) => {
  console.error('Error occurred:', error, context);
  if (error.statusCode === 429) {
    return { action: 'retry', delayMs: 1000 };
  }
  return { action: 'throw' };
});
```

## Common Patterns

### Rate Limit Handling

```typescript
const client = new DorisioClient({
  baseUrl: 'https://api.dorisio.com',
  errorHandler: async (error) => {
    if (error.statusCode === 429) {
      // Exponential backoff for rate limits
      const delayMs = Math.pow(2, (context.attempt || 1)) * 1000;
      return { action: 'retry', delayMs };
    }
    return { action: 'throw' };
  },
});
```

### Circuit Breaker Pattern

```typescript
let failureCount = 0;
const FAILURE_THRESHOLD = 5;
const RESET_TIMEOUT = 60000; // 1 minute

const client = new DorisioClient({
  baseUrl: 'https://api.dorisio.com',
  errorHandler: async (error, context) => {
    if (error.statusCode && error.statusCode >= 500) {
      failureCount++;
      if (failureCount >= FAILURE_THRESHOLD) {
        // Circuit is open, return fallback
        return { action: 'fallback', fallbackValue: { fromCache: true } };
      }
      return { action: 'retry', delayMs: 1000 };
    }
    // Reset on success
    failureCount = 0;
    return { action: 'throw' };
  },
});
```

### Fallback Strategies

```typescript
const client = new DorisioClient({
  baseUrl: 'https://api.dorisio.com',
  errorHandler: async (error, context) => {
    if (error.statusCode === 503) {
      // Service unavailable, return cached data
      return { action: 'fallback', fallbackValue: getCachedData(context.path) };
    }
    return { action: 'throw' };
  },
});
```

## Async Error Handlers

Error handlers support async operations:

```typescript
const client = new DorisioClient({
  baseUrl: 'https://api.dorisio.com',
  errorHandler: async (error, context) => {
    // Perform async operations
    await logErrorToService(error, context);
    await sendAlert(error);

    if (error.statusCode === 429) {
      return { action: 'retry', delayMs: 5000 };
    }
    return { action: 'throw' };
  },
});
```

## Error Handler Failure

If the error handler itself throws an error, the SDK will fall back to normal error handling and the original error will be thrown:

```typescript
const client = new DorisioClient({
  baseUrl: 'https://api.dorisio.com',
  errorHandler: async (error) => {
    // If this throws, the original error will be thrown
    throw new Error('Handler failed');
  },
});
```
