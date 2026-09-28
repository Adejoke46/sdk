# Testing Guide

This guide covers patterns and strategies for testing applications that use the Dorisio SDK.

## Unit Testing Patterns

### Mocking the HTTP Client

The simplest way to test code that uses the SDK is to mock the HTTP layer:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DorisioClient } from 'dorisio-sdk';

describe('DorisioClient', () => {
  let client: DorisioClient;

  beforeEach(() => {
    client = new DorisioClient({
      baseUrl: 'https://api.example.com',
      token: 'test-token',
    });
  });

  it('calls createTip correctly', async () => {
    const mockResponse = {
      id: 'tip-123',
      amount: 50,
      creatorId: 'creator-1',
      status: 'pending',
    };

    vi.spyOn(client, 'createTip' as never).mockResolvedValue(mockResponse as never);

    const result = await client.createTip({
      creatorId: 'creator-1',
      amount: 50,
    });

    expect(result.id).toBe('tip-123');
  });
});
```

### Using Sandbox Mode

The SDK provides a built-in sandbox mode for offline testing:

```typescript
import { DorisioClient } from 'dorisio-sdk';

const client = new DorisioClient({
  baseUrl: 'https://api.example.com',
  mode: 'sandbox',
  sandboxSeed: 42,
});

// All requests return deterministic mocks
const user = await client.getCurrentUser();
expect(user).toBeDefined();

// Inspect what happened
console.log(client.getSandboxHistory());
```

### Using the Dedicated Sandbox Client

```typescript
import { createSandboxClient } from 'dorisio-sdk';

const client = createSandboxClient({ seed: 42 });

// Works without any network calls
const tip = await client.createTip({
  creatorId: 'mock-creator',
  amount: 50,
});
```

## Mocking Strategies

### Mocking fetch Directly

```typescript
import { afterEach, vi } from 'vitest';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

it('handles API errors', async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 400,
    json: async () => ({ error: 'Invalid amount' }),
  });

  // Test error handling
});
```

### Mocking at the Module Level

```typescript
vi.mock('dorisio-sdk', () => ({
  DorisioClient: vi.fn().mockImplementation(() => ({
    createTip: vi.fn().mockResolvedValue({ id: 'mock-tip' }),
    getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1' }),
  })),
}));
```

## Integration Testing Patterns

Integration tests verify that multiple components work together correctly:

```typescript
import { describe, it, expect } from 'vitest';
import { DorisioClient, PaymentError } from 'dorisio-sdk';

describe('Payment Flow Integration', () => {
  it('validates input before making request', async () => {
    const client = new DorisioClient({
      baseUrl: 'https://api.test.com',
      mode: 'sandbox',
    });

    // Sandbox mode returns mock data — useful for testing flow logic
    const tip = await client.createTip({
      creatorId: 'test-creator',
      amount: 100,
      message: 'Integration test',
    });

    expect(tip).toBeDefined();
  });
});
```

## E2E Testing Patterns

For end-to-end tests, use a test API key and testnet:

```typescript
import { DorisioClient } from 'dorisio-sdk';

const client = new DorisioClient({
  baseUrl: process.env.TEST_API_URL!,
  token: process.env.TEST_API_TOKEN!,
});

it('full payment flow', async () => {
  const user = await client.getCurrentUser();
  expect(user).toBeDefined();

  const tip = await client.createTip({
    creatorId: 'test-creator-id',
    amount: 10,
  });

  expect(tip.id).toBeDefined();
});
```

## Testing Error Handling

```typescript
import { PaymentError, AuthError, ValidationError } from 'dorisio-sdk';

it('throws PaymentError on payment failure', async () => {
  const client = new DorisioClient({
    baseUrl: 'https://api.example.com',
    mode: 'sandbox',
  });

  // Test that error types are correctly thrown
  try {
    await client.createTip({
      creatorId: 'invalid',
      amount: -1,
    });
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
  }
});
```

## Best Practices

1. **Use sandbox mode** for unit tests — zero network calls, deterministic results.
2. **Mock at the HTTP boundary** when testing custom logic that wraps the SDK.
3. **Use unique idempotency keys** in tests to avoid cross-test interference.
4. **Test error paths** — verify domain-specific error types are thrown correctly.
5. **Keep E2E tests isolated** — each test should be independent and idempotent.
6. **Use `vi.useFakeTimers()`** for timeout and retry testing.
