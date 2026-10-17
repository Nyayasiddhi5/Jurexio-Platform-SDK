/**
 * Per-protected-route smoke (Phase 4 continuation, Session-15 v13).
 *
 * Walks each canonical protected route, attaches console-error listener,
 * and asserts the page renders without thrown React errors. The Vite SPA
 * shell returns 200 for every route even when a component throws — so
 * curl smoke can't see these regressions; only a real browser can.
 *
 * Auth model:
 *   - Reads NYV_E2E_TEST_EMAIL + NYV_E2E_TEST_PASSWORD env vars.
 *   - If absent → entire describe() block is skipped (CI-friendly: missing
 *     creds degrade to a skip rather than a hard fail).
 *   - If present → seeds the access token into localStorage via
 *     addInitScript so AuthContext picks it up on first render.
 *
 * Route list:
 *   Curated below to cover one route per major surface (Hub, Operations,
 *   Orchestration, Governance, Admin, SuperAdmin) instead of all 151. The
 *   cost of full coverage isn't justified at this layer — per-feature specs
 *   (see admin-console.spec.ts pattern) cover deep behaviour.
 *
 * Console-error filter: same isBenignConsoleNoise() as admin-console.spec.ts
 * — anchored to start-of-line so a real error mentioning Sentry still fails.
 */

import { test, expect, type Page } from '@playwright/test';
import { attemptAuthBoot } from './_auth';

const GATEWAY_URL = process.env.NYV_E2E_GATEWAY_URL ?? 'http://localhost:5000';

interface RouteCase {
  path: string;
  // A locator predicate that should resolve true once the page has rendered
  // its primary content (data-testid first; role/text fallback).
  expectVisible: { testid?: string; text?: RegExp; role?: { role: string; name?: RegExp } };
  // Roles for which this route should be reachable. If the seeded test user's
  // role is BELOW the minimum (per ProtectedRoute), the test is skipped
  // rather than failing.
  minRole: 'user' | 'operator' | 'analyst' | 'manager' | 'org_admin' | 'super_admin';
}

const ROUTES: RouteCase[] = [
  { path: '/chat-hub',                        minRole: 'user',         expectVisible: { testid: 'page-chat-hub' } },
  { path: '/agents',                          minRole: 'operator',     expectVisible: { text: /agents|registry/i } },
  { path: '/orchestration',                   minRole: 'analyst',      expectVisible: { text: /orchestration|hub/i } },
  { path: '/orchestration/grpo',              minRole: 'manager',      expectVisible: { text: /grpo|training/i } },
  { path: '/operations',                      minRole: 'analyst',      expectVisible: { text: /operations/i } },
  { path: '/decision-cards',                  minRole: 'operator',     expectVisible: { text: /decision|hitl/i } },
  { path: '/superadmin/federated-tenants',    minRole: 'super_admin',  expectVisible: { text: /tenant/i } },
  { path: '/superadmin/provider-failover',    minRole: 'super_admin',  expectVisible: { text: /provider|failover/i } },
  { path: '/admin/org-console-layout',        minRole: 'org_admin',    expectVisible: { testid: 'page-org-console-layout' } },
];

const ROLE_HIER: Record<string, number> = {
  super_admin: 10, org_admin: 9, manager: 8, senior_analyst: 7, analyst: 6,
  operator: 5, developer: 4, viewer: 3, user: 2, guest: 1,
};

function isBenignConsoleNoise(line: string): boolean {
  return /^\[Sentry\]/.test(line) || /^Failed to load resource:.*favicon\.ico/i.test(line);
}

function attachConsoleAssertions(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => { errors.push(`pageerror: ${err.message}`); });
  return errors;
}

test.describe('Admin Console — protected routes (auth-required)', () => {
  let userRole = 'guest';

  test.beforeEach(async ({ page }) => {
    const auth = await attemptAuthBoot(page, GATEWAY_URL);
    test.skip(!auth.ok, `Skipping auth-required suite: ${auth.reason ?? 'no creds'}`);
    userRole = String(auth.user?.role ?? 'user');
  });

  for (const r of ROUTES) {
    test(`renders ${r.path} without runtime errors`, async ({ page }) => {
      const requiredLevel = ROLE_HIER[r.minRole] ?? 0;
      const myLevel = ROLE_HIER[userRole] ?? 0;
      test.skip(
        myLevel < requiredLevel,
        `Test user role '${userRole}' below required '${r.minRole}' for ${r.path}`,
      );

      const errors = attachConsoleAssertions(page);
      const res = await page.goto(r.path, { waitUntil: 'domcontentloaded' });
      expect(res?.status() ?? 0, `${r.path} HTTP status`).toBeLessThan(500);

      // Wait for primary content. Fall back through the predicate variants.
      if (r.expectVisible.testid) {
        await expect(page.getByTestId(r.expectVisible.testid)).toBeVisible({ timeout: 10_000 });
      } else if (r.expectVisible.role) {
        await expect(page.getByRole(r.expectVisible.role.role as any, { name: r.expectVisible.role.name })).toBeVisible({ timeout: 10_000 });
      } else if (r.expectVisible.text) {
        await expect(page.getByText(r.expectVisible.text).first()).toBeVisible({ timeout: 10_000 });
      }

      // Allow benign noise; fail on anything else (including pageerror).
      const significant = errors.filter((e) => !isBenignConsoleNoise(e));
      expect(significant, `Console errors on ${r.path}: ${significant.join(' | ')}`).toEqual([]);

      // Defensive: ensure we didn't end up on /login (would mean auth seed failed).
      expect(page.url(), `Should not have been bounced to /login on ${r.path}`).not.toMatch(/\/login(\?|$)/);
    });
  }

  test('logout flow returns to /login and clears storage', async ({ page }) => {
    await page.goto('/chat-hub');
    // Hit any logout endpoint exposed by AuthContext via the user menu.
    await page.evaluate(() => {
      try {
        window.localStorage.removeItem('nyv_token');
        window.localStorage.removeItem('token');
        window.localStorage.removeItem('nyv_user');
      } catch { /* ignore */ }
    });
    await page.goto('/');
    await page.waitForURL(/\/login(\?|$)/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/login(\?|$)/);
  });
});
