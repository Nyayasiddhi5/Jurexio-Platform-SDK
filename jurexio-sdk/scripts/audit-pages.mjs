#!/usr/bin/env node
/**
 * Real end-to-end page audit. For every sidebar destination:
 *   1. Navigate (logged in as super_admin)
 *   2. Wait for network-idle (3s budget)
 *   3. Capture: console errors, JS exceptions, failed network requests (4xx/5xx),
 *      visible "Error"/"404"/"Failed to load" patterns, page title, screenshot
 *   4. Output a per-page JSON verdict
 *
 * Usage: node scripts/audit-pages.mjs [--paths /tmp/sidebar_paths.txt] [--out /tmp/audit-report.json]
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const EMAIL = process.env.NV_AUDIT_EMAIL;
const PASSWORD = process.env.NV_AUDIT_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('Set NV_AUDIT_EMAIL and NV_AUDIT_PASSWORD env vars before running this audit script.');
  process.exit(2);
}
const PATHS_FILE = process.argv.includes('--paths')
  ? process.argv[process.argv.indexOf('--paths') + 1]
  : '/tmp/sidebar_paths.txt';
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : '/tmp/audit-report.json';
const SHOTS_DIR = '/tmp/audit-shots';
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const paths = fs.readFileSync(PATHS_FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
console.log(`[audit] ${paths.length} paths to test against ${BASE}`);

// 1. Login via API and grab the token
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const loginJson = await loginRes.json();
if (!loginJson?.token) {
  console.error('[audit] LOGIN FAILED', loginJson);
  process.exit(1);
}
const TOKEN = loginJson.token;
console.log(`[audit] logged in as ${loginJson.user.email} (${loginJson.user.role})`);

// Optional batching: --start N --count M
const startIdx = process.argv.includes('--start') ? Number(process.argv[process.argv.indexOf('--start') + 1]) : 0;
const count    = process.argv.includes('--count') ? Number(process.argv[process.argv.indexOf('--count') + 1]) : paths.length;

// 2. Launch browser
const chromiumPath = process.env.CHROMIUM_PATH
  || '/nix/store/43y6k6fj85l4kcd1yan43hpdld6nmjmp-ungoogled-chromium-131.0.6778.204/bin/chromium';
const browser = await puppeteer.launch({
  executablePath: chromiumPath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-setuid-sandbox'],
  defaultViewport: { width: 1366, height: 900 },
});

const report = { startedAt: new Date().toISOString(), base: BASE, total: paths.length, results: [] };

// Write incrementally so a kill doesn't lose results
function writeIncremental() {
  try { fs.writeFileSync(OUT, JSON.stringify(report, null, 2)); } catch (_) {}
}

try {
  // Set token once for the page's localStorage
  const seedPage = await browser.newPage();
  await seedPage.goto(`${BASE}/console/`, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await seedPage.evaluate((t) => {
    localStorage.setItem('token', t);
    localStorage.setItem('nyv_token', t);
  }, TOKEN);
  await seedPage.close();

  const end = Math.min(paths.length, startIdx + count);
  for (let i = startIdx; i < end; i++) {
    const p = paths[i];
    const url = `${BASE}/console${p}`;
    const page = await browser.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const failedReqs = [];

    page.on('console', (msg) => {
      const t = msg.type();
      if (t === 'error') consoleErrors.push(msg.text().slice(0, 240));
    });
    page.on('pageerror', (err) => pageErrors.push(String(err.message).slice(0, 240)));
    page.on('requestfailed', (req) => {
      const u = req.url();
      // ignore fonts/extensions/sourcemaps
      if (/\.(woff2?|map|ico)(\?|$)/.test(u)) return;
      failedReqs.push({ url: u.slice(0, 200), reason: req.failure()?.errorText });
    });
    page.on('response', (res) => {
      const status = res.status();
      const u = res.url();
      if (status >= 400 && status < 600 && /\/api\//.test(u)) {
        failedReqs.push({ url: u.slice(0, 200), status });
      }
    });

    let title = '', visibleText = '', flag = 'OK', loadError = null;
    const t0 = Date.now();
    try {
      // Inject token into this context BEFORE navigating
      await page.evaluateOnNewDocument((t) => {
        try {
          localStorage.setItem('token', t);
          localStorage.setItem('nyv_token', t);
        } catch (_) {}
      }, TOKEN);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 6000 });
      // settle: wait briefly for react-rendered content
      await new Promise(r => setTimeout(r, 700));
      title = await page.title();
      visibleText = await page.evaluate(() => (document.body?.innerText || '').slice(0, 4000));
    } catch (e) {
      loadError = String(e.message).slice(0, 240);
      flag = 'LOAD_ERROR';
    }
    const elapsedMs = Date.now() - t0;

    // Heuristic flags from visible text
    const lower = visibleText.toLowerCase();
    const flags = [];
    if (loadError) flags.push('load_error');
    if (/page not found|404 not found|^404$|cannot get \//i.test(visibleText)) flags.push('404');
    if (/something went wrong|unhandled error|application error/i.test(lower)) flags.push('app_error');
    if (/access denied|unauthorized|forbidden|permission denied/i.test(lower) && !p.includes('admin')) flags.push('forbidden');
    if (/^\s*$/.test(visibleText)) flags.push('blank_page');
    if (visibleText.length < 80) flags.push('thin_content');
    if (consoleErrors.length > 0) flags.push(`console_errors:${consoleErrors.length}`);
    if (pageErrors.length > 0) flags.push(`js_exceptions:${pageErrors.length}`);
    const apiFailures = failedReqs.filter(f => f.status);
    if (apiFailures.length > 0) flags.push(`api_failures:${apiFailures.length}`);

    // Screenshot only if something looks wrong (saves disk + time)
    let shot = null;
    if (flags.length > 0) {
      shot = path.join(SHOTS_DIR, `${String(i).padStart(3, '0')}-${p.replace(/[^a-z0-9]/gi, '_')}.jpg`);
      try { await page.screenshot({ path: shot, type: 'jpeg', quality: 60, fullPage: false }); } catch (_) {}
    }

    const verdict = flags.length === 0 ? 'PASS'
                  : flags.includes('load_error') || flags.includes('404') || flags.includes('app_error') ? 'FAIL'
                  : 'WARN';

    const row = { idx: i, path: p, verdict, flags, title, elapsedMs,
      consoleErrors: consoleErrors.slice(0, 3),
      pageErrors: pageErrors.slice(0, 3),
      apiFailures: apiFailures.slice(0, 5),
      shot };
    report.results.push(row);

    const tag = verdict === 'PASS' ? '✓' : verdict === 'WARN' ? '⚠' : '✗';
    console.log(`[${String(i+1).padStart(3,'0')}/${paths.length}] ${tag} ${verdict.padEnd(4)} ${p}  (${elapsedMs}ms) ${flags.join(',')}`);

    await page.close();
    if (i % 5 === 0) writeIncremental();
  }
} finally {
  await browser.close();
}

report.finishedAt = new Date().toISOString();
report.summary = {
  pass: report.results.filter(r => r.verdict === 'PASS').length,
  warn: report.results.filter(r => r.verdict === 'WARN').length,
  fail: report.results.filter(r => r.verdict === 'FAIL').length,
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`\n[audit] DONE. PASS=${report.summary.pass} WARN=${report.summary.warn} FAIL=${report.summary.fail}`);
console.log(`[audit] full report → ${OUT}`);
console.log(`[audit] failure screenshots → ${SHOTS_DIR}/`);
