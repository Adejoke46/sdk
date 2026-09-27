# Architecture Decision Records (ADRs)

This directory contains records of significant architectural and design decisions made for the Dorisio SDK.

The format is based on the [Markdown Architectural Decision Records (MADR)](https://adr.github.io/madr/) standard.

## Index of Records

| ADR | Title | Status | Date |
| :--- | :--- | :--- | :--- |
| [ADR-000](./template.md) | [Architecture Decision Record Template](./template.md) | Template | — |
| [ADR-001](./0001-use-zod-for-runtime-validation.md) | [Use Zod for Runtime Validation](./0001-use-zod-for-runtime-validation.md) | Accepted | 2026-09-12 |
| [ADR-002](./0002-httpclient-uses-native-fetch-over-axios.md) | [HttpClient Uses Native Fetch Over Axios](./0002-httpclient-uses-native-fetch-over-axios.md) | Accepted | 2026-09-14 |
| [ADR-003](./0003-sandbox-mode-for-offline-testing.md) | [Sandbox Mode for Offline Testing](./0003-sandbox-mode-for-offline-testing.md) | Accepted | 2026-09-18 |
| [ADR-004](./0004-idempotency-keys-for-mutation-safety.md) | [Idempotency Keys for Mutation Safety](./0004-idempotency-keys-for-mutation-safety.md) | Accepted | 2026-09-20 |
| [ADR-005](./0005-react-hooks-for-ui-integration.md) | [React Hooks for UI Integration](./0005-react-hooks-for-ui-integration.md) | Accepted | 2026-09-22 |

## Contributing an ADR
To record a new architectural decision:
1. Copy [template.md](./template.md) to a new file named `XXXX-short-title.md` (incrementing the 4-digit number).
2. Fill out all sections explaining Context, Problem Statement, Decision Drivers, Considered Options, and Consequences.
3. Submit a PR for review. Once merged, update this index table.
