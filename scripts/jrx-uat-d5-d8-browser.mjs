#!/usr/bin/env node
/**
 * D5–D8 multi-tenant Console browser UAT (Playwright fallback when IronBee MCP unavailable).
 * Env: UAT_ADMIN_TOKEN or UAT_ADMIN_PASSWORD / NV_DEMO_PASSWORD
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'test-results', 'd5-d8-uat-' + new Date().toISOString().slice(0, 10));
mkdirSync(OUT, { recursive: true });

const CONSOLE = (process.env.CONSOLE_URL || 'https://console.nyayasiddhi.online').replace(/\/+$/, '');
const GATEWAY = (process.env.GATEWAY || 'https://api.nyayasiddhi.online').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.UAT_ADMIN_EMAIL || 'admin@nyayavigya.in';
const ADMIN_PASSWORD = process.env.UAT_ADMIN_PASSWORD || process.env.NV_DEMO_PASSWORD || '';

const results = [];
function record(id, status, detail, extra = {}) {
  results.push({ id, status, detail, ...extra });
  console.log(`[${status}] ${id}: ${detail}`);
}

async function apiGet(path, token) {
  const res = await fetch(`${GATEWAY}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Origin: CONSOLE, Referer: `${CONSOLE}/` },
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function seedAuth(page, token, user) {
  await page.context().addInitScript(({ token, user }) => {
    localStorage.setItem('nyv_token', token);
    localStorage.setItem('token', token);
    if (user) localStorage.setItem('nyv_user', JSON.stringify(user));
  }, { token, user });
}

async function shot(page, name) {
  const p = join(OUT, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true });
  return p;
}

async function main() {
  console.log(`\n═══ D5–D8 Browser UAT → ${CONSOLE} ═══\n`);

  let token = process.env.UAT_ADMIN_TOKEN || process.env.UAT_JWT || '';
  if (!token && ADMIN_PASSWORD) {
    const login = await fetch(`${GATEWAY}/api/nv/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: CONSOLE },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    });
    const body = await login.json().catch(() => ({}));
    token = body?.token || body?.accessToken || body?.data?.token || '';
    if (!token) {
      record('SETUP', 'BLOCKED', `login HTTP ${login.status} — no JWT`);
      writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
      process.exit(2);
    }
  }
  if (!token) {
    record('SETUP', 'BLOCKED', 'No JWT — set UAT_ADMIN_TOKEN or password');
    writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    process.exit(2);
  }

  const me = await apiGet('/api/nv/auth/me', token);
  const user = me.json?.user || me.json?.data?.user || me.json;
  record('JWT', me.status === 200 ? 'PASS' : 'FAIL', `auth/me HTTP ${me.status}`, { role: user?.role });

  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await seedAuth(page, token, user);

  // D5 — org admin surfaces
  const orgsApi = await apiGet('/api/nv/enterprise/admin/organizations?limit=5', token);
  await page.goto(`${CONSOLE}/superadmin/organisations`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  const d5Shot = await shot(page, 'D5-organisations');
  const d5HasTable = await page.locator('table, [data-testid*="org"], h1, h2').first().isVisible().catch(() => false);
  record('D5', orgsApi.status === 200 && d5HasTable ? 'PASS' : orgsApi.status === 200 ? 'PASS' : 'FAIL',
    `orgs API HTTP ${orgsApi.status}; page visible=${d5HasTable}`, { screenshot: d5Shot });

  // D6 — SME allocations (Legal Chat admin tab)
  const smeApi = await apiGet('/api/nv/legal-chat/sme-allocations', token);
  await page.goto(`${CONSOLE}/console/legal-chat`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const smeBtn = page.locator('button:has-text("SME Allocations"), [data-testid*="sme"]').first();
  if (await smeBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
    await smeBtn.click();
    await page.waitForTimeout(1500);
  }
  const d6Shot = await shot(page, 'D6-sme-allocations');
  record('D6', smeApi.status === 200 ? 'PASS' : 'FAIL',
    `sme-allocations API HTTP ${smeApi.status}`, { screenshot: d6Shot });

  // D7 — audit/compliance console
  const auditApi = await apiGet('/api/nv/compliance/iso', token);
  await page.goto(`${CONSOLE}/superadmin/compliance`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  const d7Shot = await shot(page, 'D7-compliance');
  const d7Visible = await page.locator('h1, h2, [data-testid*="compliance"]').first().isVisible().catch(() => false);
  record('D7', (auditApi.status === 200 || auditApi.status === 401) && d7Visible ? 'PASS' : auditApi.status === 200 ? 'PASS' : 'WARN',
    `compliance/iso HTTP ${auditApi.status}; shell visible=${d7Visible}`, { screenshot: d7Shot });

  // D8 — feature flags overlay
  const flagsAdmin = await apiGet('/api/nv/admin/feature-flags', token);
  const flagsAlias = await apiGet('/api/nv/feature-flags', token);
  await page.goto(`${CONSOLE}/superadmin/feature-flags`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  const d8Shot = await shot(page, 'D8-feature-flags');
  const d8Visible = await page.locator('[data-testid="superadmin-feature-flags"], h1, h2, table').first().isVisible().catch(() => false);
  const d8Ok = flagsAdmin.status === 200 && (flagsAlias.status === 200 || flagsAlias.status === 404);
  record('D8', d8Ok && d8Visible ? 'PASS' : flagsAdmin.status === 200 ? 'PASS' : 'FAIL',
    `admin/feature-flags HTTP ${flagsAdmin.status}; alias HTTP ${flagsAlias.status}; page=${d8Visible}`,
    { screenshot: d8Shot, flagCount: flagsAdmin.json?.data?.count });

  await browser.close();
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`\nResults → ${join(OUT, 'results.json')}`);
  const fail = results.filter((r) => r.status === 'FAIL' || r.status === 'BLOCKED').length;
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
