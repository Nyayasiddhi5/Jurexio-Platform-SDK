import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // React plugin enables automatic JSX runtime so client pages that don't
  // explicitly `import React from 'react'` (the modern default) load
  // correctly under the sidebar-route regression sweep.
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'src/**/*.test.ts',
    ],
    exclude: [
      'node_modules',
      'dist',
      'client',
      // NYV-NS-022 (2026-05-05): intelligent-router has its own node:test
      // suite (run separately via `tsx --test`), incompatible with vitest's
      // describe/it API. Excluding it from vitest avoids "No test suite
      // found" noise without losing coverage.
      'src/services/intelligent-router/__tests__/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/**',
        'dist/**',
        'client/**',
        'tests/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        'src/db/migrations/**',
        'scripts/**',
      ],
      thresholds: {
        branches: 70,
        functions: 75,
        lines: 75,
        statements: 75,
      },
    },
    testTimeout: 15_000,
    hookTimeout: 10_000,
    reporters: ['verbose'],
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@nyv/docparse': path.resolve('./packages/docparse/dist/index.js'),
      // `@/` is exclusively used by client React pages (verified — zero
      // hits in tests/ or src/). Map it to `client/src` so the sidebar
      // regression sweep can resolve `@/components/*` and `@/lib/*`
      // imports the same way Vite does in the browser.
      '@': path.resolve('./client/src'),
      '@shared': path.resolve('./shared'),
    },
  },
});
