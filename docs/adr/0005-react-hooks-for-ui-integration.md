# ADR-005: React Hooks for UI Integration

* Status: accepted
* Deciders: Dorisio Core Engineering Team
* Date: 2026-09-22

## Context and Problem Statement

A substantial percentage of developers integrating Dorisio build frontend user interfaces in React or Next.js. Manually managing asynchronous state (loading indicators, error boundaries, data caching, cleanup on unmount) for every tip button, wallet connect dialog, and creator balance card produces repetitive boilerplate code across projects. We needed an ergonomic integration layer tailored for modern React applications.

## Decision Drivers

* **Declarative Developer Experience**: Providing idiomatic React hooks (`useCreateTip`, `useWallet`, etc.).
* **Zero Dependency Impact for Non-React Users**: React must remain an optional peer dependency so Node.js backend integrations don't download React.
* **Separation of Concerns**: Keeping UI lifecycle logic cleanly decoupled from core HTTP transport.
* **Predictable Error Handling**: Guaranteeing errors are trapped, reported, and exposed to component state without unhandled promise rejections.

## Considered Options

* **Subpath Export (`dorisio-sdk/react`) with React Hooks & Context**: Bundled in the SDK under a dedicated export path with `react` as an optional peer dependency.
* **Separate NPM Package (`@dorisio/react`)**: Publishing a standalone package.
* **Providing Documentation Examples Only**: Expecting developers to write their own custom hooks.

## Decision Outcome

Chosen option: **Subpath Export (`dorisio-sdk/react`) with React Hooks & Context**, because:
1. Subpath exports allow consumers to import from `dorisio-sdk/react` with zero impact on the root bundle size for backend Node.js users.
2. `DorisioProvider` manages client instance lifecycle and token propagation down the React component tree.
3. Hooks encapsulate loading states, optimistic updates, and automatic unmount cleanup.

### Positive Consequences

* Single package to install (`npm install dorisio-sdk`).
* Standardized state patterns (`loading`, `error`, `data`) across all Dorisio UI widgets.
* Non-React projects do not bundle React code thanks to package.json `exports` separation.

### Negative Consequences

* Must maintain compatibility with multiple React versions (React 18 and React 19).
* Hook tests require DOM test environments (`jsdom`).

## Pros and Cons of the Options

### Subpath Export (`dorisio-sdk/react`)

* Good, because single npm package, zero monorepo publishing overhead.
* Good, because modern package bundlers tree-shake unused exports cleanly.
* Good, because `react` is declared as an optional peer dependency.
* Bad, because SDK repository must configure React build tooling in `tsup`.

### Separate NPM Package

* Good, because completely independent versioning.
* Bad, because version synchronization overhead between `@dorisio/sdk` and `@dorisio/react`.
* Bad, because higher maintenance friction for small team.
