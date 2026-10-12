import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      'react/index': 'src/react/index.ts',
      webhook: 'src/webhook.ts',
    },
    format: ['esm', 'cjs'],
    dts: false, // Skip DTS generation for now - types need cleanup
    sourcemap: true,
    clean: true,
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
  },
]);
