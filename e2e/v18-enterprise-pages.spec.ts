/**
 * Session-15 v18 — smoke for the 4 newly-shipped enterprise pages.
 * Closes Phase-4 partial extension for CPO-audit gaps #1, #2, #3+#4, #6.
 */
import { test, expect } from '@playwright/test';

const PAGES = [
  { path: '/federated-tenants',  testId: 'page-federated-tenants',  heading: 'Federated Tenant View' },
  { path: '/realtime-activity',  testId: 'page-realtime-activity',  heading: 'Real-time Activity Feed' },
  { path: '/provider-failover',  testId: 'page-provider-failover',  heading: 'Provider Failover Dashboard' },
  { path: '/audit-chain',        testId: 'page-audit-chain',        heading: 'Audit Chain' },
];

for (const p of PAGES) {
  test(`v18 enterprise page renders: ${p.path}`, async ({ page }) => {
    await page.goto(p.path);
    await expect(page.getByTestId(p.testId)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: p.heading })).toBeVisible();
  });
}
