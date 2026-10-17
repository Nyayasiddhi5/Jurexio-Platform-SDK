/**
 * Programmatic auth helper for the Phase-4 Playwright suite (Session-15 v13).
 *
 * Some specs need a logged-in session before they can render protected
 * routes. Rather than driving the login UI in every spec, this helper:
 *   1. Reads NYV_E2E_TEST_EMAIL / NYV_E2E_TEST_PASSWORD env vars.
 *   2. POSTs to /api/auth/login (or /api/jrx/auth/login fallback) on the
 *      gateway.
 *   3. Seeds the returned access token into localStorage under both
 *      'nyv_token' and 'token' keys (mirrors what AuthContext reads).
 *   4. Returns true on success; false if creds were missing or login failed.
 *
 * Specs using this helper should call test.skip(!ok) so missing creds in
 * CI degrade to a skip rather than a hard fail (tracked separately by the
 * smoke harness which always has creds).
 */

import type { Page, BrowserContext, APIRequestContext } from '@playwright/test';

interface SeededAuth {
  ok: boolean;
  reason?: string;
  token?: string;
  user?: { id?: string | number; email?: string; role?: string; organizationId?: string | number };
}

const LOGIN_PATHS = [
  '/api/auth/login',
  '/api/jrx/auth/login',
];

export async function loginViaApi(request: APIRequestContext, gatewayBaseUrl: string): Promise<SeededAuth> {
  const email = process.env.NYV_E2E_TEST_EMAIL;
  const password = process.env.NYV_E2E_TEST_PASSWORD;
  if (!email || !password) {
    return { ok: false, reason: 'NYV_E2E_TEST_EMAIL / NYV_E2E_TEST_PASSWORD not set' };
  }

  let lastErr = '';
  for (const path of LOGIN_PATHS) {
    try {
      const res = await request.post(`${gatewayBaseUrl}${path}`, {
        data: { email, password },
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok()) { lastErr = `${path} → HTTP ${res.status()}`; continue; }
      const json: any = await res.json();
      const token: string | undefined =
        json?.token ?? json?.accessToken ?? json?.data?.token ?? json?.data?.accessToken;
      const user = json?.user ?? json?.data?.user;
      if (!token) { lastErr = `${path} → no token in body`; continue; }
      return { ok: true, token, user };
    } catch (e: any) {
      lastErr = `${path} → ${e?.message ?? String(e)}`;
    }
  }
  return { ok: false, reason: lastErr || 'login failed' };
}

/**
 * Seed the access token into localStorage on the page so AuthContext
 * picks it up. Must be called BEFORE the first navigation to a protected
 * route. Uses addInitScript so the storage write happens on every nav.
 */
export async function seedTokenIntoContext(context: BrowserContext, token: string, user?: SeededAuth['user']): Promise<void> {
  await context.addInitScript(({ token, user }) => {
    try {
      window.localStorage.setItem('nyv_token', token);
      window.localStorage.setItem('token', token);
      if (user) window.localStorage.setItem('nyv_user', JSON.stringify(user));
    } catch { /* ignore */ }
  }, { token, user });
}

export async function attemptAuthBoot(page: Page, gatewayBaseUrl: string): Promise<SeededAuth> {
  const auth = await loginViaApi(page.request, gatewayBaseUrl);
  if (!auth.ok || !auth.token) return auth;
  await seedTokenIntoContext(page.context(), auth.token, auth.user);
  return auth;
}
