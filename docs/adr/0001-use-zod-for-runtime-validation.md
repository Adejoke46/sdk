# ADR-001: Use Zod for Runtime Validation

* Status: accepted
* Deciders: Dorisio Core Engineering Team
* Date: 2026-09-12

## Context and Problem Statement

The Dorisio SDK handles sensitive financial operations, including creator tips, wallet links, and Stellar transaction metadata. TypeScript provides static compile-time type safety, but compiled JavaScript applications and external network responses require runtime validation to prevent malformed payloads, silent bugs, and injection attacks. We needed a robust validation library that seamlessly bridges TypeScript types with runtime checks.

## Decision Drivers

* First-class TypeScript type inference (`z.infer<T>`).
* Zero external dependencies and low runtime overhead.
* Clear, informative validation error messages for developers.
* Ability to export schemas for consumer applications to validate user input before sending network requests.

## Considered Options

* **Zod**: TypeScript-first schema declaration and validation library.
* **Joi**: Popular validation library from the Hapi ecosystem.
* **Yup**: Schema builder for value parsing and validation, often used with Formik.
* **Hand-crafted type guards**: Custom JavaScript `typeof` / `instanceof` check functions.

## Decision Outcome

Chosen option: **Zod**, because:
1. It produces inferred static TypeScript types directly from schemas, eliminating duplicate type definitions.
2. It has zero dependencies and tree-shakes effectively.
3. It allows exporting reusable schemas (`AuthSchemas`, `PaymentSchemas`, etc.) so consumers can validate form inputs on the client before calling SDK methods.

### Positive Consequences

* Single source of truth for runtime validation and static typing.
* Structured `ZodError` with exact field paths and helpful error messages.
* Consumer applications can import schemas directly from `dorisio-sdk`.

### Negative Consequences

* Minor addition to bundle size (~12 kB gzipped), though manageable and shared with modern frontend tooling.
* Developers must learn Zod syntax when adding new domain schemas.

## Pros and Cons of the Options

### Zod

* Good, because of automatic static type inference with `z.infer`.
* Good, because composable schemas and custom error messaging.
* Good, because zero external dependencies.
* Bad, because slightly larger bundle size than bespoke hand-written type guards.

### Joi

* Good, because mature and feature-rich.
* Bad, because poor TypeScript type inference requiring separate `.d.ts` definitions.
* Bad, because large bundle footprint unsuitable for browser SDKs.

### Yup

* Good, because widespread React/Formik compatibility.
* Bad, because less strictly typed than Zod for complex nested objects.

### Hand-crafted Type Guards

* Good, because zero bundle overhead.
* Bad, because labor-intensive, error-prone, and difficult to maintain as API evolves.
