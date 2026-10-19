# React Hooks Lint Rules

The Dorisio SDK enforces the [eslint-plugin-react-hooks](https://www.npmjs.com/package/eslint-plugin-react-hooks) rules on all code under `src/react/`.

## Rules

| Rule | Severity | Purpose |
|------|----------|---------|
| `react-hooks/rules-of-hooks` | `error` | Ensures hooks are only called at the top level of React components or custom hooks, never inside loops, conditions, or nested functions. |
| `react-hooks/exhaustive-deps` | `error` | Verifies that every value referenced inside a `useEffect`, `useCallback`, or `useMemo` dependency list is declared, and that no stale closures are created by missing dependencies. |

Both rules are configured as `error`, so any violation fails the linter and blocks CI.

## Configuration

Base configuration: `.eslintrc.json` — enables `plugin:react-hooks/recommended` and overrides both rules to `error`.

React-specific enforcement: `.eslintrc.override.json` — extends the base config and forces both react-hooks rules to `error` for `src/react/`. Used by CI:

```bash
npx eslint -c .eslintrc.override.json src/react/
```

## How to comply

### Rules of hooks

- Call hooks unconditionally at the top level of your component or custom hook.
- Do not call hooks inside `if`, `for`, `while`, `try/catch`, or nested functions.
- Only call hooks from React functions (components or custom hooks whose names start with `use`), never from regular functions.

### Exhaustive dependencies

- Declare every reactive value (props, state, refs, variables from outer scope) read inside a hook's callback in its dependency array.
- Functions and objects defined inside the component should either be moved outside, wrapped in `useCallback`/`useMemo`, or added to the dependency array.
- Do not suppress violations with `// eslint-disable-next-line` — fix the root cause by correcting the dependency list or restructuring the hook.
- Values that never change (module-level constants, refs via `.current` only read inside effects) may be omitted, but prefer listing anything the effect reads to avoid stale closures.

### Example

Incorrect:

```ts
useEffect(() => {
  document.title = `Hello, ${name}`;
}, []); // 'name' is missing from dependencies
```

Correct:

```ts
useEffect(() => {
  document.title = `Hello, ${name}`;
}, [name]);
```

## CI

CI runs `npm run lint` over `src/` and a dedicated React hooks lint over `src/react/` using `.eslintrc.override.json`. Any `react-hooks` violation is reported as an error and fails the build. Pull requests introducing hook violations cannot be merged until they are fixed.
