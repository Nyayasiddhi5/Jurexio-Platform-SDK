import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config — Phase 4 foundational suite (Session-15 v9, 2026-05-11).
 *
 * Scope per NV-SDK-UNIFIED-001 v6 clarification: this suite exercises the
 * Admin Console UI (the only surface where runtime React errors are not
 * server-detectable per feature-matrix line 80). The 7-platform SDK API
 * surface is already covered by `scripts/nv-smoke-bash.sh` +
 * `nv-smoke-all-platforms.ts` — do NOT duplicate that work here.
 *
 * Browsers are NOT auto-installed at npm install; run `npm run e2e:install`
 * once (downloads ~500 MB of Chromium). Then `npm run e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  outputDir: 'test-results/',
  use: {
    baseURL: process.env.NYV_E2E_BASE_URL ?? 'http://localhost:3004',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // No webServer block — assumes the NYV Console workflow (port 3004) and
  // NYV Gateway workflow (port 5000) are already running in dev. CI must
  // start them explicitly before invoking `npx playwright test`.
});
