import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@jurexio/react-hooks',
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
    },
  },
});
