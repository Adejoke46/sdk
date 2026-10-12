# Dorisio SDK Cleanup Plan

**Status**: Investigation Complete  
**Date**: 2024  
**Scope**: Full repository cleanup after merged PRs  

## Executive Summary

The Dorisio SDK contains multiple categories of issues blocking builds and deployments:

1. **Critical Build Blockers** (prevent `npm run type-check` and `npm run lint`)
   - Missing module: `src/types/schemas.ts` (re-exported in `src/types/index.ts` but doesn't exist)
   - Missing module: `src/client/transactions.ts` (exists in file system but exported as non-existent in multiple places)
   - Duplicate `Analytics` import in `src/client.ts` (lines 21, 59)
   - ESLint plugin not installed: `eslint-plugin-react-hooks`

2. **Type Errors** (100+ TS2300-TS7006 errors)
   - Broken type references (`CacheOptions`, `RequestCompressionConfig`, `CacheManager`, `RequestSigner`, `WebSocketClient`, etc.)
   - Missing interface properties in `ClientConfig` (analytics, i18n, websocket, requestSigning, etc.)
   - Tests referencing non-existent config options

3. **Unused Dependencies**
   - `better-sqlite3@^11.10.0` — no imports found anywhere in codebase

4. **Test Infrastructure Issues**
   - Multiple test files reference config options that don't exist in `ClientConfig`
   - Integration test helpers try to import missing modules

5. **Dead/Obsolete Code Candidates**
   - Unused middleware/hook system exports
   - Test-only utilities that may be redundant
   - GraphQL support (unclear if actively maintained)
   - WebSocket/realtime support (no active imports)

6. **Documentation Issues**
   - README references features (analytics, i18n, realtime, websocket, request signing) that aren't properly exported or are broken
   - Storybook setup references may be stale

---

## Detailed Findings

### 1. Missing Modules (CRITICAL)

#### `src/types/schemas.ts` — DOES NOT EXIST

**File**: `src/types/index.ts` (line 117)  
**Issue**: Re-exports `Schemas`, `AuthSchemas`, `PaymentSchemas`, etc. from `./schemas`, but the file does not exist.

```typescript
// src/types/index.ts line 117-165
export {
  Schemas,
  AuthSchemas,
  PaymentSchemas,
  // ... 30+ exports
} from './schemas';  // ← FILE DOES NOT EXIST
```

**Impact**: Any code importing from `dorisio-sdk/react` or using `Schemas` directly will fail at runtime.  
**Used by**: `src/client/auth.ts:8`, `src/client/balance.ts:14`

**Resolution**: Either:
- Create `src/types/schemas.ts` with all schema definitions, OR
- Move schema exports to existing `src/utils/validation-schemas.ts` and redirect imports

---

#### `src/client/transactions.ts` — EXISTS BUT IMPORT STATEMENTS ARE BROKEN

**Issue**: File exists (`src/client/transactions.ts` confirmed in file system), but imports in `src/client.ts` and tests fail.

**Affected imports**:
- `src/client.ts:40` — `Cannot find module './client/transactions'`
- `src/client.ts:44` — `Cannot find module './client/transactions'`
- `src/__integration-tests__/helpers/create-client.ts:4` — `Cannot find module '../../client/transactions'`

**Resolution**: Likely a module resolution or file encoding issue; verify the file is properly committed and readable.

---

### 2. Duplicate Identifier: `Analytics`

**File**: `src/client.ts`  
**Lines**: 21, 59  
**Error**: `TS2300: Duplicate identifier 'Analytics'`

```typescript
// Line 21
import { Analytics, type AnalyticsOptions, ... } from './lib/analytics';

// Line 59 (duplicate)
import { Analytics } from './lib/analytics';
```

**Resolution**: Delete line 59 import (duplicate).

---

### 3. Missing Type Definitions in `ClientConfig`

The following properties are referenced in code but not declared in the `ClientConfig` interface:

- `analytics` — referenced in tests and client code
- `i18n` — referenced in tests and `src/client.ts:456`
- `websocket` — referenced in tests and `src/client.ts:720`
- `requestSigning` — referenced in tests and `src/client.ts:261`
- `apiVersion` — referenced in `src/client.ts:247`
- `supportedApiVersions` — referenced in `src/client.ts:248`
- `fallbackApiVersion` — referenced in `src/client.ts:249`
- `autoMigrateApiVersion` — referenced in `src/client.ts:250`
- `deprecatedEndpoints` — referenced in `src/client.ts:251`
- `onApiVersionChange` — referenced in `src/client.ts:252`
- `onApiDeprecation` — referenced in `src/client.ts:253`
- `endpoints` — referenced in `src/client.ts:314`
- `healthCheckInterval` — referenced in `src/client.ts:318`

**Tests with broken config references**:
- `src/client.analytics.test.ts:107`
- `src/client.i18n.test.ts:8, 20`
- `src/client.version.test.ts:15, 38, 67, 86, 112, 151`
- `src/client.realtime.test.ts:131, 153`
- `src/client.signing.test.ts:19`

**Resolution**: Add missing properties to `ClientConfig` interface (in `src/client.ts`) OR remove/disable the tests referencing them.

---

### 4. Unused Dependencies

#### `better-sqlite3@^11.10.0`

**Status**: Appears in `package.json` dependencies but is never imported.

**Search result**: No imports of `better-sqlite3` or `sqlite3` found anywhere in `src/`.

**Likely reason**: Offline storage was refactored to support pluggable backends (IndexedDB, Memory, etc.), leaving SQLite as optional.

**Resolution**: Move to `optionalDependencies` or remove entirely if offline is not used.

---

### 5. Broken/Incomplete Feature Exports

The following features are exported from `src/index.ts` but either:
- Have broken types that cause compilation errors, OR
- Are not properly initialized in `ClientConfig`, OR
- Have no active usage patterns in examples

**Affected features**:

| Feature | Status | Notes |
|---------|--------|-------|
| **GraphQL Client** | Questionable | Exported but no examples or active usage found; API preference is REST |
| **WebSocket / Realtime** | Broken | Types missing, config option not in `ClientConfig`, no examples |
| **i18n / Internationalization** | Incomplete | Config option not in `ClientConfig`, `localizeError` imported but i18n setup unclear |
| **Analytics** | Duplicate/Incomplete | Duplicate import, property not in `ClientConfig`, no examples |
| **Request Signing** | Incomplete | Property not in `ClientConfig` |
| **API Version Handler** | Incomplete | Multiple config options not in `ClientConfig` |
| **Plugin System** | Unused | Exported but no examples, no active plugins in codebase |

---

### 6. Obsolete/Dead Test Files

**Test files referencing non-existent features**:

- `src/client.analytics.test.ts` — tests config options that don't exist in `ClientConfig`
- `src/client.i18n.test.ts` — tests config options that don't exist
- `src/client.realtime.test.ts` — tests config options and properties that don't exist
- `src/client.signing.test.ts` — tests config options that don't exist
- `src/client.version.test.ts` — tests config options and API version handling that isn't wired up
- `src/client.middleware.test.ts` — unclear if middleware is actively used

**Status**: These tests cannot run until their corresponding config options are added to `ClientConfig` OR the tests are removed.

---

### 7. Incomplete/Redundant Exports in index.ts

The main `src/index.ts` exports many modules that are either:
- Broken (don't compile), OR
- Untested/unused in examples, OR
- Duplicated across multiple export statements

**Examples of potentially redundant exports**:

```typescript
// Lines 30-35: GraphQL exports (no example usage)
export { GraphQLClient, GraphQLCache, GraphQLError, ... } from './graphql/graphql-client';

// Lines 37-41: GraphQL queries (no example usage)
export { GET_CREATOR, LIST_CREATORS, ... } from './graphql/queries';

// Lines 99-100: Multiple hook system exports (no examples)
export { HookManager, ... } from './lib/hooks';

// Lines 103-105: Throttle manager (no examples)
export { ThrottleManager, ... } from './http/throttle-manager';

// Lines 125-132: Plugin system (no examples, Issue #137 reference)
export { PluginSystem, createPlugin, ... } from './lib/plugin-system';
```

---

### 8. ESLint Plugin Missing

**Error**: `ESLint couldn't find the plugin "eslint-plugin-react-hooks"`

**Status**: Listed in `devDependencies` but not properly installed.

**Resolution**: Run `npm install` or rebuild `node_modules`.

---

### 9. Documentation Inconsistencies

**README.md** lists/documents features that are broken or not exported:

- "React hooks for seamless integration" — hooks are exported but the SDK doesn't build (`npm run type-check` fails)
- "Interceptors" — documented with extensive examples, but export types are missing
- "Request Fingerprinting & Debugging" — documented, uses `X-Request-ID`, but setup is unclear
- "Request Queueing & Prioritization" — documented, exported, but not in `ClientConfig`
- "Batch Operations" — documented, exported, but dependent on missing modules

---

## Cleanup Order (Safe Dependency Order)

### Phase 1: Fix Broken Imports & Type Definitions

1. **Fix duplicate `Analytics` import** in `src/client.ts`
   - **Files**: `src/client.ts`
   - **Action**: Delete line 59 (duplicate import)
   - **Verify**: `npm run type-check` shows fewer errors

2. **Create or relocate `schemas.ts`**
   - **Files**: `src/types/schemas.ts` (create new) OR `src/types/index.ts` (redirect imports)
   - **Action**: 
     - Option A: Create `src/types/schemas.ts` with schema definitions
     - Option B: Move schema exports from `src/utils/validation-schemas.ts` to `src/types/schemas.ts`
   - **Verify**: `npm run type-check` resolves schema import errors

3. **Verify `src/client/transactions.ts` is committed and readable**
   - **Files**: `src/client/transactions.ts`
   - **Action**: Check file encoding, re-stage if necessary
   - **Verify**: `npm run type-check` resolves import errors

4. **Add missing properties to `ClientConfig` interface**
   - **Files**: `src/client.ts` (update `ClientConfig` interface)
   - **Action**: Add type declarations for:
     - `analytics?: AnalyticsOptions`
     - `i18n?: I18nConfig`
     - `websocket?: WebSocketClientOptions`
     - `requestSigning?: RequestSignerOptions`
     - `apiVersion?: string`
     - `supportedApiVersions?: string[]`
     - `fallbackApiVersion?: string`
     - `autoMigrateApiVersion?: boolean`
     - `deprecatedEndpoints?: DeprecatedEndpointConfig[]`
     - `onApiVersionChange?: (oldVersion: string, newVersion: string) => void`
     - `onApiDeprecation?: (warning: DeprecationWarning) => void`
     - `endpoints?: EndpointConfig[]`
     - `healthCheckInterval?: number`
   - **Verify**: `npm run type-check` resolves property errors

### Phase 2: Fix Tests

5. **Review and fix test files with broken config references**
   - **Files**: 
     - `src/client.analytics.test.ts`
     - `src/client.i18n.test.ts`
     - `src/client.version.test.ts`
     - `src/client.realtime.test.ts`
     - `src/client.signing.test.ts`
   - **Action**: 
     - For each test, either:
       - Enable the feature in `ClientConfig` and wire it up in client initialization, OR
       - Remove the test if the feature is deprecated
   - **Verify**: `npm run test` passes all tests

6. **Fix integration test imports**
   - **Files**: `src/__integration-tests__/helpers/create-client.ts`
   - **Action**: Import from the correct module path or remove if redundant
   - **Verify**: No import errors in type-check

### Phase 3: Clean Up Unused Code & Dependencies

7. **Remove unused dependency: `better-sqlite3`**
   - **Files**: `package.json`
   - **Action**: Delete `"better-sqlite3": "^11.10.0"` from `dependencies`
   - **Verify**: `npm install`, then `npm run type-check` (no new errors)

8. **Evaluate and document GraphQL support**
   - **Files**: `src/graphql/`, `src/index.ts`
   - **Action**: 
     - If GraphQL is not actively used/maintained: Remove `src/graphql/` folder and its exports from `src/index.ts`
     - If GraphQL is kept: Add example usage to `examples/`
   - **Verify**: `npm run type-check`

9. **Evaluate WebSocket / Realtime support**
   - **Files**: `src/websocket/`, `src/client.ts` (realtime methods), `src/index.ts`
   - **Action**:
     - If realtime is not maintained: Remove `src/websocket/` and references
     - If realtime is kept: Add to `ClientConfig`, add examples, ensure tests pass
   - **Verify**: `npm run type-check`, `npm run test`

10. **Evaluate Analytics feature**
    - **Files**: `src/lib/analytics.ts`, `src/client.ts`, `src/index.ts`
    - **Action**:
      - If analytics is kept: Add to `ClientConfig`, fix duplicate import, add examples
      - If not: Remove from exports and client
    - **Verify**: `npm run type-check`, `npm run test`

11. **Evaluate i18n support**
    - **Files**: `src/i18n/`, `src/client.ts`, `src/index.ts`
    - **Action**:
      - If i18n is kept: Add to `ClientConfig`, initialize in client
      - If not: Remove or mark as internal-only
    - **Verify**: `npm run type-check`, `npm run test`

12. **Evaluate Plugin System**
    - **Files**: `src/lib/plugin-system.ts`, `src/index.ts`
    - **Action**:
      - If plugins are not used: Remove from exports
      - If kept: Add examples and test coverage
    - **Verify**: `npm run type-check`, `npm run test`

### Phase 4: Install Dependencies & Build

13. **Rebuild dependencies**
    - **Action**: `npm install`
    - **Verify**: ESLint plugin now available

14. **Run full build pipeline**
    - **Commands**:
      ```bash
      npm run type-check    # Should pass with no errors
      npm run lint          # Should pass with no errors
      npm run test          # All tests pass
      npm run build         # Build succeeds
      ```
    - **Verify**: All commands exit with code 0

### Phase 5: Documentation Updates

15. **Update README.md**
    - **Files**: `README.md`
    - **Action**:
      - Remove documentation for features that were deleted
      - Fix documentation for features that were fixed/enabled
      - Update examples to work with the cleaned-up SDK
    - **Verify**: Links to `docs/` are accurate, examples run without errors

---

## Summary: Files to Delete (if determined obsolete)

| File/Folder | Reason | Decision |
|------------|--------|----------|
| `src/graphql/` | No active usage, unclear maintenance status | **DECISION PENDING**: Ask user if GraphQL support should be kept |
| `src/websocket/` | Broken types, config not wired up, no examples | **DECISION PENDING**: Ask user if WebSocket support should be kept |
| `src/client.analytics.test.ts` | Tests broken config options | Remove if analytics feature is removed; fix if kept |
| `src/client.i18n.test.ts` | Tests broken config options | Remove if i18n is removed; fix if kept |
| `src/client.version.test.ts` | Tests broken config options | Remove if API versioning is not active |
| `src/client.realtime.test.ts` | Tests broken config options | Remove if WebSocket is removed; fix if kept |
| `src/client.signing.test.ts` | Tests broken config options | Remove if request signing is not active |

---

## Summary: Dependencies to Remove (confirmed unused)

| Dependency | Current Version | Reason | Action |
|------------|-----------------|--------|--------|
| `better-sqlite3` | `^11.10.0` | Never imported; offline storage uses pluggable backends | Remove from `package.json` |

---

## Verification Steps (Final Checklist)

Run these commands after cleanup to confirm all issues are resolved:

```bash
# 1. Install dependencies
npm install

# 2. Type check (must have 0 errors)
npm run type-check
# Expected: "error TS?????: ..." → 0 errors

# 3. Lint (must have 0 errors)
npm run lint
# Expected: "No errors!"

# 4. Tests (must have all passing)
npm run test
# Expected: "PASS" with "X tests" passing

# 5. Build (must succeed)
npm run build
# Expected: dist/ folder created with .js and .d.ts files

# 6. Type safety check on exports
npx tsc --noEmit --lib esnext src/index.ts
# Expected: No errors
```

---

## Notes

- **Do NOT delete `.agents/` folder** — preserve workflow automation
- **Do NOT delete tests directory** without ensuring coverage is maintained
- **Do NOT delete examples** without updating README
- **Archive any deleted code** by committing with message "chore: remove [feature]" before deletion
- **Verify backward compatibility**: Check if any deletions break documented public API

---

## References

- Main client: `src/client.ts`
- Main exports: `src/index.ts`
- Configuration: `src/config.ts`
- Type definitions: `src/types/`
- Package metadata: `package.json`, `tsconfig.json`
- Build output: `dist/`
- CI/CD: `.github/workflows/`
