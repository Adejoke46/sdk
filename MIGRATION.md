# Dorisio SDK Migration Guide: v0.0.x to v0.1.x

This guide outlines breaking changes, new features, and step-by-step instructions to upgrade your integration from **v0.0.x** to **v0.1.x** of `dorisio-sdk`.

---

## 📌 Executive Summary

The `v0.1.x` release transitions `dorisio-sdk` into a hardened, production-ready payment integration library for the Stellar network:

| Area | v0.0.x | v0.1.x |
| :--- | :--- | :--- |
| **HTTP Transport** | Axios wrapper dependency | Native Fetch + AbortSignal timeout |
| **Package Exports** | Monolithic default export | Subpath exports (`/react`, `/sandbox`, `/webhook`) |
| **Error Handling** | Generic `Error` / Axios error objects | Domain-specific error hierarchy (`DorisioError`, `PaymentError`, etc.) |
| **Payment Safety** | Unsafe blind retries | Built-in idempotency keys (`Idempotency-Key`) |
| **Validation** | Ad-hoc runtime validation | Exported Zod schemas (`AuthSchemas`, `PaymentSchemas`, etc.) |
| **Testing** | Live testnet calls required | Deterministic `SandboxClient` / mock mode (zero network) |
| **Node.js Support** | Node.js >= 16 | Node.js >= 20 (ES2020+) |

---

## 🚀 Step-by-Step Upgrade Guide

### Step 1: Update Dependencies

Update `dorisio-sdk` in `package.json`:

```bash
npm install dorisio-sdk@^0.1.0
```

Verify your environment meets the minimum engine requirements:
- **Node.js**: `>= 20.0.0`
- **TypeScript**: `>= 5.4.0` (recommended for full type inference)
- **React**: `>= 18.0.0` (optional peer dependency if using `@dorisio-sdk/react`)

---

### Step 2: Update Package Imports

In v0.0.x, all utilities and hooks were imported from the root package. In v0.1.x, imports are partitioned into clean subpaths:

```typescript
// ❌ v0.0.x (Deprecated)
import { DorisioClient, useCreateTip, verifyWebhook } from 'dorisio-sdk';

// ✅ v0.1.x (Modern)
import { DorisioClient, PaymentError } from 'dorisio-sdk';
import { useCreateTip, DorisioProvider } from 'dorisio-sdk/react';
import { verifyWebhookSignature } from 'dorisio-sdk/webhook';
import { createSandboxClient, SandboxClient } from 'dorisio-sdk/sandbox';
```

---

### Step 3: Client Instantiation

The constructor configuration parameter was normalized from `baseURL` to `baseUrl`. Sandbox mode is now natively toggled via `mode: 'sandbox'`:

#### Before (v0.0.x)
```typescript
const client = new DorisioClient({
  baseURL: 'https://api.dorisio.com', // ⚠️ Deprecated casing
  timeout: 15000,
});
```

#### After (v0.1.x)
```typescript
const client = new DorisioClient({
  baseUrl: 'https://api.dorisio.com', // ✅ Standardized camelCase
  token: 'jwt-access-token',
  timeout: 30000,
  mode: process.env.NODE_ENV === 'test' ? 'sandbox' : 'live',
  sandboxSeed: 42, // Optional: deterministic responses in sandbox
});
```

---

### Step 4: Payments and Tip Creation

`createTip` now requires structured currency codes and supports `idempotencyKey` to guarantee mutation safety across retries.

#### Before (v0.0.x)
```typescript
// ❌ v0.0.x
const tip = await client.createTip('creator-123', 50, 'Great work!');
```

#### After (v0.1.x)
```typescript
import { v4 as uuidv4 } from 'uuid';

// ✅ v0.1.x: Object payload with explicit currency & idempotency key
const tip = await client.createTip({
  creatorId: 'creator-123',
  amount: 50,
  currency: 'USD', // 'USD' | 'EUR' | 'XLM'
  message: 'Great work!',
  idempotencyKey: uuidv4(), // Prevents duplicate charges on network retry
});

console.log('Tip Status:', tip.status); // 'pending' | 'confirmed' | 'failed'
```

---

### Step 5: Stellar Transaction Build and Submit Flow

For on-chain payment settlement, v0.1.x splits transaction building and submission into explicit, auditable phases:

```typescript
// 1. Build payment transaction XDR
const { xdr, networkPassphrase } = await client.buildPaymentTransaction(tip.id, {
  senderAddress: 'GA...',
  recipientAddress: 'GB...',
  amount: '50.0000000',
  assetCode: 'USDC',
  assetIssuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
});

// 2. Sign transaction with user's wallet (e.g. Freighter, Albedo, keypair)
const signedXdr = await userWallet.sign(xdr, { networkPassphrase });

// 3. Submit signed envelope
const submission = await client.submitPaymentTransaction(tip.id, { signedXdr });
console.log('Stellar Ledger Hash:', submission.transactionHash);
```

---

### Step 6: Domain-Specific Error Handling

Generic try/catch blocks should be updated to inspect specific typed errors exported by `dorisio-sdk`:

#### Before (v0.0.x)
```typescript
try {
  await client.createTip(creatorId, amount);
} catch (err: any) {
  if (err.response?.status === 400) {
    console.error('Validation failed');
  }
}
```

#### After (v0.1.x)
```typescript
import {
  DorisioError,
  PaymentError,
  WalletVerificationError,
  AuthError,
  RateLimitError,
} from 'dorisio-sdk';

try {
  await client.createTip({ creatorId, amount });
} catch (err) {
  if (err instanceof PaymentError) {
    console.error('Payment processing failed:', err.message, err.transactionHash);
  } else if (err instanceof WalletVerificationError) {
    console.error('Wallet signature invalid:', err.challenge);
  } else if (err instanceof RateLimitError) {
    console.warn(`Rate limited. Retry after ${err.retryAfter}s`);
  } else if (err instanceof DorisioError) {
    console.error('General SDK error:', err.message, err.statusCode);
  } else {
    throw err;
  }
}
```

---

### Step 7: React Hooks

In v0.1.x, all React hooks must be wrapped in `DorisioProvider` and import from `dorisio-sdk/react`:

#### Before (v0.0.x)
```tsx
import { useCreateTip } from 'dorisio-sdk';

function TipButton() {
  const { sendTip, isPending } = useCreateTip();
  return <button onClick={() => sendTip('crt-1', 10)}>Send</button>;
}
```

#### After (v0.1.x)
```tsx
import { DorisioProvider, useCreateTip } from 'dorisio-sdk/react';

function App() {
  return (
    <DorisioProvider baseUrl="https://api.dorisio.com" token="user-jwt">
      <TipButton />
    </DorisioProvider>
  );
}

function TipButton() {
  const { createTip, loading, error, data } = useCreateTip();

  const handleSend = async () => {
    try {
      const tip = await createTip({ creatorId: 'crt-1', amount: 10, currency: 'USD' });
      console.log('Created tip:', tip.id);
    } catch (e) {
      console.error(error);
    }
  };

  return (
    <button disabled={loading} onClick={handleSend}>
      {loading ? 'Processing...' : 'Send $10 Tip'}
    </button>
  );
}
```

---

### Step 8: Webhook Signature Verification

Webhook utilities have moved to `dorisio-sdk/webhook`. Verification now uses constant-time HMAC-SHA256:

#### Before (v0.0.x)
```typescript
const isValid = verifyWebhook(req.body, req.headers['signature'], secret);
```

#### After (v0.1.x)
```typescript
import { verifyWebhookSignature } from 'dorisio-sdk/webhook';

const signature = req.headers['x-dorisio-signature'];
const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

const isValid = verifyWebhookSignature(rawBody, signature, process.env.DORISIO_WEBHOOK_SECRET!);
if (!isValid) {
  res.status(401).send('Invalid signature');
}
```

---

## ⚠️ Deprecations and Removed APIs

| Deprecated / Removed in v0.1.x | Replacement | Reason |
| :--- | :--- | :--- |
| `client.payments.createTip(...)` | `client.createTip({ ... })` | Flatter API surface; structured parameters |
| `client.auth.verifyAndLinkWallet(...)` | `client.verifyWallet(walletId, proof)` | Simplified cryptographic challenge verification |
| `import { useCreateTip } from 'dorisio-sdk'` | `import { useCreateTip } from 'dorisio-sdk/react'` | Cleaner tree-shaking and zero React bundle bloat |
| `config.baseURL` | `config.baseUrl` | Standardized property casing across SDK |
| `AxiosError` | `ApiError`, `DorisioError` | Removed Axios dependency in favor of native Fetch |

---

## ✅ Upgrade Checklist

- [ ] Updated `dorisio-sdk` to `^0.1.0` in `package.json`.
- [ ] Confirmed runtime environment is Node.js `>= 20.0.0`.
- [ ] Updated imports to use subpaths (`dorisio-sdk/react`, `dorisio-sdk/webhook`, `dorisio-sdk/sandbox`).
- [ ] Changed `baseURL` to `baseUrl` in client configurations.
- [ ] Converted `createTip` calls from positional parameters to object syntax.
- [ ] Added `idempotencyKey` to critical mutation operations.
- [ ] Updated error-handling catch blocks to handle `DorisioError` and subclasses.
- [ ] Wrapped React application components in `<DorisioProvider>`.
- [ ] Ran `npm run type-check` and `npm test` locally.

---

## ❓ Troubleshooting

### 1. `Cannot find module 'dorisio-sdk/react'`
Ensure your `tsconfig.json` has `moduleResolution` set to `"bundler"`, `"node16"`, or `"nodenext"` so TypeScript can resolve package exports subpaths.

### 2. `Expected string, received number` in `createTip`
The `amount` parameter accepts a JavaScript `number` (e.g. `10` or `10.5`), while Stellar XDR builders require a string (e.g. `"10.0000000"`). Check parameter types in your build step.

### 3. Missing `X-Dorisio-Signature` in Webhooks
Ensure your server body parser does not mutate the raw payload before signature verification. For Express, use `express.raw({ type: 'application/json' })` or preserve the raw body buffer.
