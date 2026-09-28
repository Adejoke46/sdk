# Walkthrough - Add API Version Detection and Auto-Migration

## PR Title
`feat(client): add API version detection and auto-migration (#56)`

---

## PR Description

### What
Implements automatic API version detection from response headers, bi-directional request/response migrations across version schemas, pre-configured and dynamic deprecation warnings, and version fallback handling.

### Why
Closes #56. Backend API changes previously required manual version tracking across clients, risking runtime breakage when upstream endpoints or models evolved without warning.

### How
- **`src/http/api-version-handler.ts`**:
  - Implemented `ApiVersionHandler` core class supporting detection of version indicators (`API-Version`, `X-API-Version`, case-insensitive).
  - Built BFS-based auto-migration path finder supporting multi-step version jumps (`v1` -> `v2` -> `v3`).
  - Implemented deprecation detection via standard and proprietary headers (`Deprecation`, `Sunset`, `X-API-Deprecated`) and route matching for pre-configured endpoints with in-memory deduplication.
  - Added fallback version support when backend reports an unsupported version.
- **`src/http/http-client.ts`**:
  - Added `onResponse` response interception hook in `HttpClient` and `RequestOptions`.
  - Registered request id synchronously to maintain concurrency integrity.
- **`src/client.ts`**:
  - Integrated `ApiVersionHandler` into `DorisioClient` configuration (`apiVersion`, `supportedApiVersions`, `fallbackApiVersion`, `autoMigrateApiVersion`, `deprecatedEndpoints`, `onApiVersionChange`, `onApiDeprecation`).
  - Added automatic injection of `API-Version` headers into outgoing requests.
  - Added auto-migration of request payloads and URLs prior to dispatch.
  - Added public helper methods: `getApiVersion()`, `setApiVersion()`, `getApiVersionHandler()`, and `detectApiVersion()`.
- **`src/index.ts`**:
  - Exported `ApiVersionHandler` and related configuration types.
- **Test Suite**:
  - Added comprehensive unit tests in `src/http/api-version-handler.test.ts` (15 tests).
  - Added client integration tests in `src/client.version.test.ts` (6 tests).
  - Resolved pre-existing upstream type discrepancies in `query-builder.ts`, `transactions.ts`, and test cleanup hooks.

---

## Files Changed

| File | Description |
| --- | --- |
| `src/http/api-version-handler.ts` | Core version detection, multi-hop migration pipeline, deprecation management, and fallback. |
| `src/http/api-version-handler.test.ts` | 15 unit tests covering header parsing, migrations, deprecation alerts, and fallbacks. |
| `src/client.ts` | Integrated version handler into `DorisioClient`, request transformation, header injection, and helper APIs. |
| `src/client.version.test.ts` | 6 integration tests verifying client end-to-end version detection, deprecation callbacks, and auto-migration. |
| `src/http/http-client.ts` | Added `onResponse` callback support and fixed synchronous in-flight request registration. |
| `src/index.ts` | Exported `ApiVersionHandler` class and type definitions. |
| `src/client/transactions.ts` | Added `RequestOptions` type import. |
| `src/lib/query-builder.ts` | Resolved upstream merge artifact and duplicated function signatures. |
| `src/lib/query-builder.test.ts` | Added safe indexing and optional chaining for test assertions. |
| `src/http/interceptors.test.ts` | Typed generic response interceptor callbacks. |
| `src/http/retry-concurrency.test.ts` | Avoided non-null assertions under ESLint rules. |
| `src/react/unmount-cleanup.test.tsx` | Fixed `ClientConfig` import path. |
| `src/react/useTransactionHistory.ts` | Propagated abort cancellation on unmount and wrapped async tasks in `withAbort`. |

---

## CI Verification Results

| Check | Command | Status | Details |
| --- | --- | --- | --- |
| Type Check | `npm run type-check` | **PASS** | `tsc --noEmit` completed with 0 errors. |
| Linter | `npm run lint` | **PASS** | `eslint` completed with 0 errors. |
| Test Suite | `npm run test` | **PASS** | 38 test files passed, 509 tests passed, 0 failed. |
| Build | `npm run build` | **PASS** | `tsup` compiled ESM, CJS, and DTS bundles cleanly. |
