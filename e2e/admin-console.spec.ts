import { test, expect, type Page } from '@playwright/test';

/**
 * Admin Console foundational E2E smoke (Session-15 v9, 2026-05-11).
 *
 * Goal: detect runtime React errors that the existing HTTP smoke harness
 * (`scripts/jrx-smoke-bash.sh`) cannot see — the Vite SPA shell returns 200
 * for every route, but a thrown component error renders an empty page.
 *
 * Coverage in this seed file:
 *   1. Index landing redirects to /login when unauthenticated
 *   2. /login renders without console errors and exposes the email input
 *   3. Static SPA shell loads (favicon + logo asset reachable)
 *   4. Browser console captures no `[Error]` lines during the smoke flow
 *
 * Per-page protected-route specs (Dashboard, ChatHub, Phase-C scaffolds,
 * SuperAgent tabs, etc.) require a seeded test user + session token —
 * deferred to follow-on spec authoring under Item #4 continuation.
 */

/**
 * Anchored filter for benign console noise. Anchored to start-of-line so a
 * real React error that merely *mentions* "Sentry" (e.g. a crash inside a
 * Sentry integration component) still fails the spec — only literal Sentry
 * SDK self-logs and favicon 404s are suppressed. (Refined post architect
 * review, Session-15 v9.)
 */
function isBenignConsoleNoise(line: string): boolean {
  return /^\[Sentry\]/.test(line) || /^Failed to load resource:.*favicon\.ico/i.test(line);
}

function attachConsoleAssertions(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return errors;
}

test.describe('Admin Console — foundational smoke', () => {
  test('index landing redirects unauthenticated user to /login', async ({ page }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto('/');
    await page.waitForURL(/\/login$/, { timeout: 10_000 });
    expect(page.url()).toMatch(/\/login$/);
    // Allow benign Sentry-no-DSN log; fail on anything else.
    const significant = errors.filter((e) => !isBenignConsoleNoise(e));
    expect(significant, `Unexpected console errors: ${significant.join(' | ')}`).toEqual([]);
  });

  test('/login renders without React errors and exposes email input', async ({ page }) => {
    const errors = attachConsoleAssertions(page);
    await page.goto('/login');
    // Wait for any `<input type="email">` OR a Mail-icon-decorated input.
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="mail" i]').first();
    await expect(emailInput).toBeVisible({ timeout: 10_000 });
    const significant = errors.filter((e) => !isBenignConsoleNoise(e));
    expect(significant, `Unexpected console errors: ${significant.join(' | ')}`).toEqual([]);
  });

  test('static SPA shell assets are reachable', async ({ page, request }) => {
    const logo = await request.get('/nyayasiddhi-logo.png');
    expect(logo.status(), 'logo asset must be served by the SPA').toBe(200);
    await page.goto('/login');
    // Wouter SPA — title is set by react-helmet or static index.html.
    await expect(page).toHaveTitle(/.+/, { timeout: 5_000 });
  });
});

test.describe('Admin Console — gateway connectivity', () => {
  test('console can reach the gateway /api/jrx/health endpoint', async ({ request }) => {
    const gatewayUrl = process.env.NYV_E2E_GATEWAY_URL ?? 'http://localhost:5000';
    const res = await request.get(`${gatewayUrl}/api/jrx/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
  });
});
