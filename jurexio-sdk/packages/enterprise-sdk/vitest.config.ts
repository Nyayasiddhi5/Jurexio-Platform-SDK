import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@jurexio/enterprise-sdk',
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
    },
  },
});
