import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'react/index': 'src/react/index.ts',
      webhook: 'src/webhook.ts',
      'offline/sqlite': 'src/offline/sqlite.ts',
    },
    format: ['esm', 'cjs'],
    dts: false,
    sourcemap: true,
    clean: true,
    external: ['better-sqlite3'],
  },
  {
    entry: {
      'cli/create-app': 'src/cli/create-app.ts',
    },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    clean: false,
    banner: {
      js: '#!/usr/bin/env node',
    },
    shims: true,
    external: ['better-sqlite3'],
  },
]);
