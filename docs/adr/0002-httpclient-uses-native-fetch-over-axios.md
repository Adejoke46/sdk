# ADR-002: HttpClient Uses Native Fetch Over Axios

* Status: accepted
* Deciders: Dorisio Core Engineering Team
* Date: 2026-09-14

## Context and Problem Statement

Early prototypes of the Dorisio SDK used `axios` as the underlying HTTP client library. While `axios` provides convenient defaults for Node.js, modern web runtimes (Node.js >= 18, browsers, Cloudflare Workers, Deno, Next.js Edge) standardize on the global `fetch` API. We needed to decide whether to retain `axios` or build an internal lightweight `HttpClient` around native `fetch`.

## Decision Drivers

* **Bundle Size**: Minimizing total SDK weight for mobile web and embedded widget usage.
* **Isomorphic Execution**: Running without polyfills in modern Node.js, browsers, Edge runtimes, and serverless environments.
* **Security & Supply Chain**: Reducing third-party dependency surface area and transitive vulnerabilities.
* **Custom Extensibility**: Supporting interceptors, timeout aborts (`AbortSignal.timeout`), and retry mechanisms natively.

## Considered Options

* **Native Fetch Wrapper (`HttpClient`)**: Thin internal class wrapping `globalThis.fetch`.
* **Axios**: Standard third-party HTTP client.
* **Ky / Got**: Modern lightweight HTTP libraries.

## Decision Outcome

Chosen option: **Native Fetch Wrapper (`HttpClient`)**, because:
1. Native `fetch` is a global standard across Node.js >= 18, all modern browsers, Deno, and Edge environments.
2. It eliminates the ~15 kB (gzipped) `axios` dependency, substantially reducing SDK bundle weight.
3. Node.js built-in `AbortSignal.timeout` provides reliable request cancellation and timeout enforcement without external timers.

### Positive Consequences

* Zero external HTTP dependencies.
* Universal execution across client and server runtimes without adapter packages.
* Full control over custom interceptors, idempotency checks, and exponential backoff.

### Negative Consequences

* Must implement custom response JSON parsing and interceptor pipelines internally.
* Older environments (e.g. Node 16) require a polyfill if targeted (mitigated by Node >= 20 engine constraint).

## Pros and Cons of the Options

### Native Fetch Wrapper

* Good, because zero added dependency weight.
* Good, because native browser, Node.js, and Edge runtime compatibility.
* Good, because built-in `AbortSignal` timeout handling.
* Bad, because requires manual interceptor implementation.

### Axios

* Good, because established API familiar to developers.
* Bad, because substantial bundle size increase.
* Bad, because compatibility friction in Edge runtimes.
* Bad, because extra dependency to monitor for security vulnerabilities.
