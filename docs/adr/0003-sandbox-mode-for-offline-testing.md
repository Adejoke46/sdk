# ADR-003: Sandbox Mode for Offline Testing

* Status: accepted
* Deciders: Dorisio Core Engineering Team
* Date: 2026-09-18

## Context and Problem Statement

Developers integrating payment SDKs face significant development friction:
1. Setting up local mock servers or testnet Stellar accounts takes time and effort.
2. Network flakiness and external testnet rate limits slow down CI/CD test runs.
3. Automated unit/integration tests require deterministic mock data rather than volatile live balances.

We needed a seamless way for developers and tests to exercise the full SDK surface without performing real network I/O.

## Decision Drivers

* **Zero-Configuration Developer Experience**: Instant local development with zero external dependencies.
* **Deterministic Test Fixtures**: Reproducible responses controlled by PRNG seeds.
* **Fast CI/CD Pipelines**: Running hundreds of tests in milliseconds without external HTTP calls.
* **Full Surface Parity**: Mock routing covering all auth, creator, wallet, transaction, and balance endpoints.

## Considered Options

* **In-SDK Sandbox Mode (`SandboxClient` / `mode: 'sandbox'`)**: Built-in mock router and PRNG data generator inside `HttpClient`.
* **External Mock Server Docker Image**: Requiring developers to run a Docker container for testing.
* **Mock Service Worker (MSW)**: Recommending users configure MSW handlers in their testing environments.

## Decision Outcome

Chosen option: **In-SDK Sandbox Mode**, because:
1. Developers can simply pass `mode: 'sandbox'` to `DorisioClient` or import `createSandboxClient()` from `dorisio-sdk/sandbox`.
2. All API responses are generated deterministically using a seed, allowing precise test assertions.
3. It includes request history recording (`getSandboxHistory()`) and simulated latency/error-rate injection for chaos testing.

### Positive Consequences

* Developers can start building UI components immediately before backend servers or testnets are provisioned.
* CI suites execute 100% offline and reliably without network timeouts.
* Enables simulation of edge cases (e.g., specific error rates, network delays).

### Negative Consequences

* Mock data generator must be maintained alongside API schema additions.
* Slight increase in SDK source code size to house mock routing logic.

## Pros and Cons of the Options

### In-SDK Sandbox Mode

* Good, because works out-of-the-box with zero third-party tools or Docker.
* Good, because deterministic seeded mock generation.
* Good, because supports request history recording for test assertions.
* Bad, because mock routers must be updated as endpoints evolve.

### External Mock Server

* Good, because decouples mock code from SDK library.
* Bad, because requires Docker, network port configuration, and process management.
* Bad, because slows down local onboarding.

### MSW

* Good, because powerful interceptor framework.
* Bad, because imposes setup burden on every developer and client framework.
