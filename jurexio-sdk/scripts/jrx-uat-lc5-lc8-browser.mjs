#!/usr/bin/env node
/**
 * LC5–LC8 Legal Chat browser UAT (Playwright fallback when MCP browsers unavailable).
 * Env: UAT_ADMIN_EMAIL, UAT_ADMIN_PASSWORD, UAT_SME_EMAIL, UAT_SME_PASSWORD
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'test-results', 'lc-uat-' + new Date().toISOString().slice(0, 10));
mkdirSync(OUT, { recursive: true });

const CONSOLE = (process.env.CONSOLE_URL || 'https://console.jurexio.com').replace(/\/+$/, '');
const GATEWAY = (process.env.GATEWAY || 'https://api.jurexio.com').replace(/\/+$/, '');
const ADMIN_EMAIL = process.env.UAT_ADMIN_EMAIL || 'admin@jurexio.com';
const ADMIN_PASSWORD = process.env.UAT_ADMIN_PASSWORD || process.env.NV_DEMO_PASSWORD || '';
const SME_EMAIL = process.env.UAT_SME_EMAIL || 'legalchat-sme-a-uat@jurexio.com';
const SME_PASSWORD = process.env.UAT_SME_PASSWORD || process.env.NV_DEMO_PASSWORD || '';
/** Fast one-line prompt — Queen completes in ~30–90s vs 120s+ for Article 21 research. */
const UAT_CHAT_PROMPT = process.env.UAT_CHAT_PROMPT
  || 'One line: what is anticipatory bail under BNSS?';
/** Wait for SSE run_complete + msg-rate (LC8 gates on message.status=ok). */
const SSE_JRXT_MS = Number(process.env.UAT_SSE_JRXT_MS || 240_000);
const FIXTURE = join(ROOT, 'tests/fixtures/product-readiness/sample-nda.txt');

const results = [];
function record(id, status, detail, extra = {}) {
  results.push({ id, status, detail, ...extra });
  console.log(`[${status}] ${id}: ${detail}`);
}

async function loginApi(email, password) {
  const res = await fetch(`${GATEWAY}/api/nv/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: CONSOLE },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  const token = json?.token || json?.accessToken || json?.data?.token;
  return { ok: res.ok && !!token, status: res.status, token, user: json?.user };
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

async function uiLogin(page, loginUrl, email, password) {
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const emailInput = page.locator('input[type="email"], input[name="email"]').first();
  const passInput = page.locator('input[type="password"], input[name="password"]').first();
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });
  await emailInput.fill(email);
  await passInput.fill(password);
  const loginPromise = page.waitForResponse((r) => r.url().includes('/auth/login'), { timeout: 15000 }).catch(() => null);
  await page.locator('button[type="submit"], button:has-text("Sign in"), button:has-text("Log in")').first().click();
  const loginRes = await loginPromise;
  await page.waitForTimeout(2000);
  return { status: loginRes?.status() ?? 0, url: page.url(), ok: loginRes?.ok() && !page.url().includes('/login') };
}

async function main() {
  console.log(`\n═══ LC5–LC8 Browser UAT → ${CONSOLE} ═══\n`);
  const preseedToken = process.env.UAT_ADMIN_TOKEN || process.env.UAT_JWT || '';
  if (!ADMIN_PASSWORD && !SME_PASSWORD && !preseedToken) {
    record('SETUP', 'BLOCKED', 'UAT_ADMIN_PASSWORD / UAT_SME_PASSWORD / UAT_ADMIN_TOKEN not set');
    writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const consoleErrors = [];
  const networkLog = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('response', (res) => {
    const u = res.url();
    if (u.includes('/legal-chat/') || u.includes('/auth/')) {
      networkLog.push({ url: u.replace(/Bearer\s+\S+/, 'Bearer [REDACTED]'), status: res.status() });
    }
  });

  // LC5 — page load + auth (Console login first, then LegalChat SME shell)
  let authOk = false;
  let authDetail = '';
  if (preseedToken) {
    const meRes = await fetch(`${GATEWAY}/api/nv/auth/me`, {
      headers: { Authorization: `Bearer ${preseedToken}`, Origin: CONSOLE },
    }).catch(() => null);
    const meJson = meRes ? await meRes.json().catch(() => ({})) : {};
    const user = meJson?.user || meJson?.data?.user || meJson;
    await seedAuth(page, preseedToken, user?.email ? user : undefined);
    authOk = meRes?.ok === true;
    authDetail = `preseed JWT me HTTP ${meRes?.status ?? 0}`;
  }
  if (!authOk && ADMIN_PASSWORD) {
    const ui = await uiLogin(page, `${CONSOLE}/console/login`, ADMIN_EMAIL, ADMIN_PASSWORD);
    authDetail = `console UI login HTTP ${ui.status} url=${ui.url}`;
    authOk = ui.ok;
    if (!authOk) {
      const api = await loginApi(ADMIN_EMAIL, ADMIN_PASSWORD);
      authDetail += `; API HTTP ${api.status}`;
      if (api.ok) {
        await seedAuth(page, api.token, api.user);
        authOk = true;
      }
    }
  }
  if (!authOk && SME_PASSWORD) {
    const ui = await uiLogin(page, `${CONSOLE}/legalchat/login`, SME_EMAIL, SME_PASSWORD);
    authDetail = `legalchat UI login HTTP ${ui.status} url=${ui.url}`;
    authOk = ui.ok;
  }

  const targets = authOk ? [
    `${CONSOLE}/console/legal-chat`,
    `${CONSOLE}/console/chat?tab=legal`,
    `${CONSOLE}/legalchat/chat`,
  ] : [`${CONSOLE}/console/legal-chat`];
  let loaded = false;
  let finalUrl = '';
  for (const url of targets) {
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      finalUrl = page.url();
      if (res?.status() === 200 && !finalUrl.includes('/login')) {
        loaded = true;
        break;
      }
    } catch { /* try next */ }
  }
  const lc5Shot = await shot(page, 'LC5-page-load');
  const hasChatInput = await page.locator('[data-testid="chat-input"]').count() > 0;
  const hasSidebar = await page.locator('text=Documents').count() > 0 || await page.locator('text=LegalChat').count() > 0;
  record('LC5', authOk && loaded && hasChatInput ? 'PASS' : authOk && loaded ? 'WARN' : 'BLOCKED',
    `${authDetail}; url=${finalUrl} chatInput=${hasChatInput} sidebar=${hasSidebar} consoleErrors=${consoleErrors.length}`,
    { screenshot: lc5Shot, http: 200 });

  if (!authOk || !loaded || !hasChatInput) {
    await browser.close();
    writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, consoleErrors, networkLog, tool: 'playwright-chromium-fallback' }, null, 2));
    process.exit(authOk ? 1 : 2);
  }

  // LC6 — send message + SSE stream (prefer Cost-saver for faster Queen completion)
  const costSaver = page.locator('button', { hasText: /Cost-saver/i }).first();
  if (await costSaver.count() > 0) {
    await costSaver.click().catch(() => null);
    await page.waitForTimeout(300);
  }
  await page.locator('[data-testid="chat-input"]').fill(UAT_CHAT_PROMPT);
  const runCompletePromise = page.waitForEvent('response', {
    predicate: (r) => r.url().includes('/legal-chat/send') && r.request().method() === 'POST',
    timeout: SSE_JRXT_MS,
  }).catch(() => null);
  await page.locator('[data-testid="chat-send"]').click();
  const sendRes = await runCompletePromise;
  await page.waitForSelector('[data-testid="msg-assistant"]', { timeout: SSE_JRXT_MS }).catch(() => null);
  // msg-rate requires message.status=ok (run_complete SSE) — poll longer than assistant bubble
  await page.locator('[data-testid="msg-rate"]').first().waitFor({ state: 'visible', timeout: SSE_JRXT_MS }).catch(() => null);
  await page.waitForTimeout(1500);
  const lc6Shot = await shot(page, 'LC6-sse-response');
  const assistantMsgs = await page.locator('[data-testid="msg-assistant"]').count();
  const rateVisible = await page.locator('[data-testid="msg-rate"]').count() > 0;
  const sseStatus = sendRes?.status() ?? 0;
  const sseOk = sseStatus === 200 && assistantMsgs > 0 && rateVisible;
  record('LC6', sseOk ? 'PASS' : rateVisible && sseStatus === 200 ? 'WARN' : 'FAIL',
    `send HTTP ${sseStatus} assistantMsgs=${assistantMsgs} rateBtn=${rateVisible} waitMs=${SSE_JRXT_MS}`,
    { screenshot: lc6Shot, sseStatus });

  // LC7 — document upload
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(FIXTURE);
  const uploadRes = await page.waitForResponse((r) => r.url().includes('/legal-chat/upload'), { timeout: 30000 }).catch(() => null);
  await page.waitForTimeout(2000);
  const lc7Shot = await shot(page, 'LC7-upload');
  const uploadedName = await page.locator('text=sample-nda.txt').count();
  const upStatus = uploadRes?.status() ?? 0;
  record('LC7', upStatus === 200 && uploadedName > 0 ? 'PASS' : upStatus === 200 ? 'WARN' : 'FAIL',
    `upload HTTP ${upStatus} visible=${uploadedName > 0}`,
    { screenshot: lc7Shot, uploadStatus: upStatus });

  // LC8 — SME rubric + replay
  let lc8Status = 'BLOCKED';
  let lc8Detail = 'no rate/replay UI exercised';
  const rateBtn = page.locator('[data-testid="msg-rate"]').first();
  if (await rateBtn.count() > 0) {
    await rateBtn.click();
    await page.waitForSelector('text=Rate this answer', { timeout: 5000 }).catch(() => null);
    const criteriaRows = page.locator('label').filter({ hasText: /accuracy|jurisdiction|citation|drafting|reasoning/i });
    const rowCount = await criteriaRows.count();
    for (let r = 0; r < rowCount; r++) {
      await page.locator('button').filter({ hasText: /^4$/ }).nth(r).click().catch(() => null);
    }
    const fbPromise = page.waitForResponse((r) => r.url().includes('/legal-chat/feedback'), { timeout: 20000 }).catch(() => null);
    await page.locator('button', { hasText: /Submit feedback/i }).click();
    const fbRes = await fbPromise;
    const fbOk = fbRes?.status() === 200;
    await page.waitForTimeout(3500);
    const replayBtn = page.locator('button', { hasText: /Replay|replay/i }).first();
    let replayOk = false;
    if (await replayBtn.count() > 0) {
      const rpPromise = page.waitForResponse((r) => r.url().includes('/legal-chat/timeline') || r.url().includes('/legal-chat/replay'), { timeout: 20000 }).catch(() => null);
      await replayBtn.click();
      const rpRes = await rpPromise;
      replayOk = (rpRes?.status() ?? 0) >= 200 && (rpRes?.status() ?? 0) < 300;
    }
    const lc8Shot = await shot(page, 'LC8-rubric-replay');
    lc8Status = fbOk ? (replayOk ? 'PASS' : 'WARN') : 'FAIL';
    lc8Detail = `feedback HTTP ${fbRes?.status() ?? 0} replay=${replayOk} judgeVerdict=awaited_3s`;
    record('LC8', lc8Status, lc8Detail, { screenshot: lc8Shot });
  } else {
    record('LC8', 'BLOCKED', 'msg-rate not visible — SSE stream may not have reached status=ok');
  }

  await browser.close();
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, consoleErrors: consoleErrors.slice(0, 20), networkLog: networkLog.slice(-30), tool: 'playwright-chromium-fallback', outDir: OUT }, null, 2));
  console.log(`\nEvidence: ${OUT}`);
  const failed = results.some((r) => r.status === 'FAIL');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
