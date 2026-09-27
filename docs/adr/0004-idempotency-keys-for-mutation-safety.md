# ADR-004: Idempotency Keys for Mutation Safety

* Status: accepted
* Deciders: Dorisio Core Engineering Team
* Date: 2026-09-20

## Context and Problem Statement

Network connections are inherently unreliable. When a client sends a payment request (`POST /transactions/tip`) and experiences a network timeout or connection reset, the client cannot know whether the server received and processed the request or failed before execution. If the SDK blindly retries the POST request, the user risks being double-charged or submitting duplicate tips. Conversely, if the SDK does not retry, the user experiences transient failure. We needed a mechanism to ensure payment mutations can be retried safely.

## Decision Drivers

* **Financial Integrity**: Guaranteeing a user is never double-charged due to network packet loss or retries.
* **Resilience**: Enabling safe automatic retry with exponential backoff on 5xx network errors.
* **Standardization**: Adhering to IETF standards for HTTP idempotency headers (`Idempotency-Key`).
* **Developer Ergonomics**: Making idempotency transparent and simple to specify in SDK method options.

## Considered Options

* **IETF `Idempotency-Key` Header Pattern**: Client generates a unique UUID per intent and passes it in the HTTP header or body.
* **Client-side Nonce / Timestamp**: Using client timestamp combined with hash.
* **Disabling All Retries for Non-Safe Methods**: Only retrying GET/HEAD and forcing manual recovery on payment failures.

## Decision Outcome

Chosen option: **IETF `Idempotency-Key` Header Pattern**, because:
1. `Idempotency-Key` is the proven industry standard for payment APIs (Stripe, Adyen, Square).
2. The server caches responses for a given idempotency key. If a retry with the same key arrives, the server returns the cached result without re-executing the payment.
3. The SDK's `HttpClient` can safely retry requests with exponential backoff whenever an `Idempotency-Key` header or `isIdempotent: true` flag is present, while strictly refusing to retry non-idempotent mutations.

### Positive Consequences

* Prevents duplicate financial transactions across network drops.
* Safe automatic retries for transient 502/503/504 gateway failures.
* Clear contract: clients supply a UUID to guarantee exactly-once processing semantics.

### Negative Consequences

* Backend server infrastructure must maintain a deduplication cache with appropriate TTL (e.g., Redis).
* Developers must manage idempotency key generation (facilitated by SDK recommendations using UUIDv4).

## Pros and Cons of the Options

### Idempotency-Key Header

* Good, because industry standard semantics.
* Good, because allows automated SDK retry loops without fear of duplicate charges.
* Good, because decoupled from payload structure.
* Bad, because requires server-side idempotency storage.

### Disabling All POST Retries

* Good, because no server storage required.
* Bad, because poor UX when transient wifi or cell connection drops fail payments unnecessarily.
