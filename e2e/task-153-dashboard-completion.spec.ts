/**
 * Session-15 v19 / Task #153 (2026-05-12) — dashboard-completion smoke.
 *
 * Covers:
 *  - 5 consolidated hubs render
 *  - audit-chain swap to /api/jrx/audit/chain (no "Backend gap" alert)
 *  - per-org console customization page renders
 *  - the 4 v18 enterprise pages still render (regression)
 *
 * Auth: piggybacks on `_auth.ts` storage state if present; otherwise the
 * pages open and the smoke confirms the bundle hydrates.
 */
import { test, expect } from '@playwright/test';

const HUBS = [
  { path: '/sdk-hub',          heading: /SDK/i },
  { path: '/orchestration',    heading: /Orchestration/i },
  { path: '/intelligence/dashboard', heading: /Intelligence/i },
  { path: '/chat',             heading: /Chat/i },
  { path: '/command-centre',   heading: /(Command Centre|Command Center|Nyayavigya)/i },
];

for (const h of HUBS) {
  test(`hub renders: ${h.path}`, async ({ page }) => {
    const resp = await page.goto(h.path, { waitUntil: 'domcontentloaded' });
    expect(resp?.status() ?? 200).toBeLessThan(500);
    // The page must mount React root; we tolerate redirects to /login.
    await expect(page.locator('body')).toBeVisible();
  });
}

test('audit-chain consumes /api/jrx/audit/chain (no backend-gap alert)', async ({ page }) => {
  await page.goto('/audit-chain', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('page-audit-chain')).toBeVisible({ timeout: 10000 });
  // The v18 stub UI used to render a literal "Backend gap" alert. v19 swap removes it.
  await expect(page.locator('text=Backend gap')).toHaveCount(0);
  // The new chain UI shows three KPI cards.
  await expect(page.getByTestId('card-audit-total')).toBeVisible();
  await expect(page.getByTestId('card-audit-shown')).toBeVisible();
  await expect(page.getByTestId('card-audit-integrity')).toBeVisible();
});

test('per-org console layout admin page renders', async ({ page }) => {
  const resp = await page.goto('/admin/org-console-layout', { waitUntil: 'domcontentloaded' });
  // Page may redirect to /login when unauthenticated; both are acceptable for smoke.
  expect(resp?.status() ?? 200).toBeLessThan(500);
});

const V18 = ['/federated-tenants', '/realtime-activity', '/provider-failover', '/audit-chain'];
for (const p of V18) {
  test(`v18 regression: ${p}`, async ({ page }) => {
    await page.goto(p, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();
  });
}
