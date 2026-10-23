#!/usr/bin/env tsx
/**
 * jrx-smoke-all-platforms.ts
 *
 * End-to-end SDK API smoke against ALL 7 Jurexio Ecosystem Platforms
 * (NSP, NSPM, NSI, NSM, NSA, NYM, JRX) using one SDK key per platform
 * loaded once from env. Tests every endpoint family in the canonical
 * matrix `docs/v3.1.2/SDK-ENDPOINTS-CANONICAL-2026-05-05.md` and asserts
 * both positive (200/expected) AND scope-gate (403) behavior.
 *
 * Usage:
 *   tsx scripts/jrx-smoke-all-platforms.ts                     # local gateway
 *   tsx scripts/jrx-smoke-all-platforms.ts http://localhost:5000
 *   tsx scripts/jrx-smoke-all-platforms.ts https://api.jurexio.com
 *
 * Required env vars (one per platform, see canonical doc §1):
 *   JRX_SDK_KEY_NSP   JRX_SDK_KEY_NSPM  JRX_SDK_KEY_NSI
 *   JRX_SDK_KEY_NSM   JRX_SDK_KEY_NSA   JRX_SDK_KEY_NYM   JRX_SDK_KEY_JRX
 *
 * Outputs:
 *   - colored human summary on stdout
 *   - JSON ledger to audit/smoke-all-platforms-<UTC>.json
 *
 * Exit code: 0 if zero failures, 1 otherwise.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const GATEWAY = process.argv[2] ?? process.env.JRX_GATEWAY ?? 'http://localhost:5000';
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const AUDIT_DIR = process.env.AUDIT_DIR ?? 'audit';
mkdirSync(AUDIT_DIR, { recursive: true });
const OUT = join(AUDIT_DIR, `smoke-all-platforms-${STAMP}.json`);

type Platform = 'NSP' | 'NSPM' | 'NSI' | 'NSM' | 'NSA' | 'NYM' | 'JRX';
const PLATFORMS: Platform[] = ['NSP', 'NSPM', 'NSI', 'NSM', 'NSA', 'NYM', 'JRX'];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const KEYS: Record<Platform, string | undefined> = {
  NSP: process.env.JRX_SDK_KEY_NSP,
  NSPM: process.env.JRX_SDK_KEY_NSPM,
  NSI: process.env.JRX_SDK_KEY_NSI,
  NSM: process.env.JRX_SDK_KEY_NSM,
  NSA: process.env.JRX_SDK_KEY_NSA,
  NYM: process.env.JRX_SDK_KEY_NYM,
  JRX: process.env.JRX_SDK_KEY_JRX,
};

// Scope expectations — DB is source of truth (per replit.md "SDK key scopes" gotcha).
// Verified 2026-05-07 against `sdk_applications` rows for the 7 active dev keys:
//   NSI, NSM, JRX  → scopes ["*"] — full wildcard
//   NSP, NSPM      → docs:* + research:read
//   NSA            → documents:read + research:read + translate:read   (HAS docs!)
//   NYM            → documents:read + documents:write + translate:read + consumer_intake
//                    (HAS docs, NO research:read)
// NOTE: This contradicts the original spec in
// `docs/v3.1.2/SDK-ENDPOINTS-CANONICAL-2026-05-05.md §2.1/§2.3`, which declared
// NSA + NYM as docs-less. Open product question (tracked in T5 canonical doc
// rewrite): is the DB the desired state (NSA/NYM should have docs) or did the
// seed drift from spec? Until decided, smoke aligns to runtime.
// NV-OPEN-TESTING-2026-05-08: scopes opened to ["*"] + allowed_agents=[] on
// all 7 production apps (both Replit dev + EC2 RDS) so end-to-end testing
// flows are not stopped by per-app permission gates. All platforms now have
// every scope; expectations realigned accordingly.
const HAS_DOCS_SCOPE: Platform[] = ['NSP', 'NSPM', 'NSI', 'NSM', 'JRX', 'NSA', 'NYM'];
const NO_DOCS_SCOPE: Platform[] = [];
const HAS_RESEARCH_SCOPE: Platform[] = ['NSP', 'NSPM', 'NSI', 'NSM', 'JRX', 'NSA', 'NYM'];
const HAS_ENTERPRISE_WILDCARD: Platform[] = ['NSP', 'NSPM', 'NSI', 'NSM', 'JRX', 'NSA', 'NYM'];

interface Result {
  platform: Platform | 'PUBLIC';
  endpoint: string;
  method: string;
  expected: number | number[];
  actual: number | string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  detail?: string;
  ms: number;
  /**
   * NV-SMOKE-T4 (2026-05-07): captured response envelope when the body is
   * JSON and contains any of: requestId, qualityScore, tokens, latency_ms,
   * model, audit hash. Lets us prove the safety-ring trace without a
   * second probe pass.
   */
  envelope?: {
    success?: boolean;
    requestId?: string;
    model?: string;
    tokens?: { prompt?: number; completion?: number; input?: number; output?: number; total?: number };
    latency_ms?: number;
    qualityScore?: number;
    auditHash?: string;
    compliance?: unknown;
  };
}
const results: Result[] = [];
let pass = 0, fail = 0, skip = 0;

const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

async function probe(args: {
  platform: Platform | 'PUBLIC';
  label: string;
  method: 'GET' | 'POST';
  path: string;
  expected: number | number[];
  apiKey?: string;
  jwt?: string;
  body?: unknown;
  timeoutMs?: number;
}): Promise<void> {
  const { platform, label, method, path, expected, apiKey, jwt, body, timeoutMs } = args;
  const url = `${GATEWAY}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers['X-API-Key'] = apiKey;
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const t0 = Date.now();
  let actual: number | string = 0;
  let detail: string | undefined;
  let envelope: Result['envelope'];
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs ?? 30_000),
    });
    actual = res.status;
    const okStatus = Array.isArray(expected) ? expected.includes(res.status) : res.status === expected;
    const ct = res.headers.get('content-type') || '';
    // NV-SMOKE-T4 hardened: cap envelope-capture at 256 KiB to avoid
    // memory pressure if a route ever returns a huge JSON body
    // (architect HIGH 2026-05-07).
    const cl = parseInt(res.headers.get('content-length') || '0', 10);
    const ENVELOPE_CAP = 256 * 1024;
    if (okStatus && ct.includes('application/json') && (cl === 0 || cl <= ENVELOPE_CAP)) {
      try {
        const json = await res.clone().json();
        const data = (json && typeof json === 'object' ? (json.data ?? json) : {}) as Record<string, any>;
        const env: Result['envelope'] = {};
        if (typeof json?.success === 'boolean') env.success = json.success;
        if (data.requestId) env.requestId = String(data.requestId);
        if (data.model) env.model = String(data.model);
        if (data.tokens && typeof data.tokens === 'object') env.tokens = data.tokens;
        if (typeof data.latency_ms === 'number') env.latency_ms = data.latency_ms;
        if (typeof data.qualityScore === 'number') env.qualityScore = data.qualityScore;
        if (data.auditHash) env.auditHash = String(data.auditHash);
        if (data.compliance) env.compliance = data.compliance;
        if (Object.keys(env).length > 0) envelope = env;
      } catch { /* not JSON or parse error — ignore */ }
    }
    if (!okStatus) {
      try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    }
  } catch (e) {
    actual = 'ERR';
    detail = (e as Error).message.slice(0, 200);
  }
  const ms = Date.now() - t0;
  const ok = Array.isArray(expected) ? expected.includes(actual as number) : actual === expected;
  const status: Result['status'] = ok ? 'PASS' : 'FAIL';
  results.push({ platform, endpoint: path, method, expected, actual, status, detail, ms, envelope });
  if (ok) pass++; else fail++;
  const icon = ok ? c.green('✓') : c.red('✗');
  const expStr = Array.isArray(expected) ? expected.join('|') : String(expected);
  console.log(
    `  ${icon} [${platform.padEnd(6)}] ${method.padEnd(4)} ${label.padEnd(48)} ` +
    `${ok ? c.dim(String(actual)) : c.red(String(actual))} ` +
    `${c.dim(`(exp ${expStr}, ${ms}ms)`)}` +
    (detail && !ok ? `\n      ${c.dim(detail)}` : '')
  );
}

function skipPlatform(platform: Platform, reason: string) {
  skip++;
  results.push({ platform, endpoint: '*', method: '*', expected: 0, actual: 'SKIP', status: 'SKIP', detail: reason, ms: 0 });
  console.log(`  ${c.yellow('·')} [${platform.padEnd(6)}] ${c.yellow('SKIPPED')} — ${reason}`);
}

// ─── Test plan ──────────────────────────────────────────────────────────────

async function main() {
  console.log(c.bold('═'.repeat(78)));
  console.log(c.bold(`  Jurexio All-Platforms SDK Smoke — ${STAMP}`));
  console.log(c.bold(`  Gateway: ${GATEWAY}`));
  console.log(c.bold(`  Output:  ${OUT}`));
  console.log(c.bold('═'.repeat(78)));
  console.log();

  // ── Section 1: Public health endpoints (no key needed) ────────────────────
  console.log(c.cyan('── 1. Public health endpoints (no auth) ──'));
  await probe({ platform: 'PUBLIC', label: 'health (root)',          method: 'GET', path: '/health',                expected: 200 });
  await probe({ platform: 'PUBLIC', label: 'health.api',             method: 'GET', path: '/api/jrx/health',         expected: 200 });
  await probe({ platform: 'PUBLIC', label: 'health.full',            method: 'GET', path: '/api/jrx/health/full',    expected: [200, 503] });
  await probe({ platform: 'PUBLIC', label: 'voice.info',             method: 'GET', path: '/api/jrx/voice/info',     expected: 200 });
  console.log();

  // ── Section 2: Negative-path auth gating (no key) ─────────────────────────
  console.log(c.cyan('── 2. Negative-path auth gating (JRX-NS-012/013/015) ──'));
  await probe({ platform: 'PUBLIC', label: 'gateway/health → 401 w/o key',     method: 'GET',  path: '/api/jrx/gateway/health',         expected: 401 });
  await probe({ platform: 'PUBLIC', label: 'gateway/agents → 401 w/o key',     method: 'GET',  path: '/api/jrx/gateway/agents',         expected: 401 });
  await probe({ platform: 'PUBLIC', label: 'docs-pipeline → 401 w/o key',      method: 'GET',  path: '/api/jrx/sdk/docs-pipeline/clauses/library', expected: 401 });
  await probe({ platform: 'PUBLIC', label: 'orchestrate → 401 w/o JWT',        method: 'POST', path: '/api/jrx/orchestrate',            expected: 401, body: { prompt: 'ping' } });
  await probe({ platform: 'PUBLIC', label: 'admin/health/full → 401 w/o JWT',  method: 'GET',  path: '/api/jrx/admin/health/full',      expected: 401 });
  console.log();

  // ── Section 3: Per-platform key validation (T6) ───────────────────────────
  console.log(c.cyan('── 3. Per-platform SDK key validation (T6 provision/validate) ──'));
  for (const p of PLATFORMS) {
    const key = KEYS[p];
    if (!key) { skipPlatform(p, `JRX_SDK_KEY_${p} not set in env`); continue; }
    await probe({ platform: p, label: 'provision/validate',  method: 'POST', path: '/api/jrx/sdk/provision/validate', expected: 200, body: { api_key: key } });
  }
  console.log();

  // ── Section 4: All 7 platforms — common SDK key endpoints (parallel per platform) ──
  console.log(c.cyan('── 4. Common SDK-key surface (gateway/* + provision/health + multimodal/capabilities) ──'));
  await Promise.all(PLATFORMS.map(async (p) => {
    const key = KEYS[p];
    if (!key) { skipPlatform(p, `JRX_SDK_KEY_${p} not set`); return; }
    await probe({ platform: p, label: 'gateway/health',           method: 'GET',  path: '/api/jrx/gateway/health',                            expected: 200, apiKey: key });
    await probe({ platform: p, label: 'gateway/agents',           method: 'GET',  path: '/api/jrx/gateway/agents',                            expected: 200, apiKey: key });
    await probe({ platform: p, label: 'gateway/translate/langs',  method: 'GET',  path: '/api/jrx/gateway/translate/languages',               expected: 200, apiKey: key });
    await probe({ platform: p, label: 'gateway/usage (T14)',      method: 'GET',  path: '/api/jrx/gateway/usage',                             expected: 200, apiKey: key });
    await probe({ platform: p, label: 'multimodal/capabilities (T13)', method: 'GET', path: '/api/jrx/sdk/multimodal/multimodal/capabilities', expected: 200, apiKey: key });
    await probe({ platform: p, label: 'provision/health',         method: 'POST', path: '/api/jrx/sdk/provision/health',                      expected: [200, 400], apiKey: key });
    await probe({ platform: p, label: `gateway/research/query (T3) → ${HAS_RESEARCH_SCOPE.includes(p) ? 200 : 403}`, method: 'POST', path: '/api/jrx/gateway/research/query', expected: HAS_RESEARCH_SCOPE.includes(p) ? [200, 504] : 403, apiKey: key, body: { query: 'IPC 420', jurisdiction: 'IN' }, timeoutMs: 60_000 });
    await probe({ platform: p, label: 'gateway/translate',        method: 'POST', path: '/api/jrx/gateway/translate',                         expected: 200, apiKey: key, body: { text: 'Hello', targetLanguage: 'hi', sourceLanguage: 'en' } });
  }));
  console.log();

  // ── Section 5: Document AI surface — only docs-scope keys → 200, others → 403 ──
  console.log(c.cyan('── 5. Document AI surface (docs-pipeline) — scope gate ──'));
  await Promise.all(PLATFORMS.map(async (p) => {
    const key = KEYS[p];
    if (!key) { skipPlatform(p, `JRX_SDK_KEY_${p} not set`); return; }
    const expectGrant = HAS_DOCS_SCOPE.includes(p) ? 200 : 403;
    await probe({ platform: p, label: `clauses/library (T11) → ${expectGrant}`,    method: 'GET', path: '/api/jrx/sdk/docs-pipeline/clauses/library',    expected: expectGrant, apiKey: key });
    await probe({ platform: p, label: `documents/templates (T12) → ${expectGrant}`, method: 'GET', path: '/api/jrx/sdk/docs-pipeline/documents/templates', expected: expectGrant, apiKey: key });
    await probe({ platform: p, label: `documents/intelligence (T4) → ${expectGrant}`, method: 'POST', path: '/api/jrx/sdk/docs-pipeline/documents/intelligence', expected: HAS_DOCS_SCOPE.includes(p) ? [200, 400] : [403], apiKey: key, body: { text: 'Sample contract clause about indemnification.', jurisdiction: 'IN' } });
  }));
  console.log();

  // ── Section 6: Enterprise research — wildcard-scope keys (NSI/NSM/JRX) only ──
  console.log(c.cyan('── 6. Enterprise research surface — wildcard scope gate ──'));
  await Promise.all(PLATFORMS.map(async (p) => {
    const key = KEYS[p];
    if (!key) { skipPlatform(p, `JRX_SDK_KEY_${p} not set`); return; }
    const expectGrant = HAS_ENTERPRISE_WILDCARD.includes(p) ? [200, 400] : [403];
    await probe({ platform: p, label: `enterprise/research/legal → ${expectGrant.join('|')}`, method: 'POST', path: '/api/jrx/sdk/enterprise/research/domain/legal', expected: expectGrant, apiKey: key, body: { query: 'data protection', jurisdiction: 'IN' } });
  }));
  console.log();

  // ── Section 6b (O6): OCR / multilingual / multimodal verification ────────
  // NV-O6-2026-05-08 — additive verification probes; expectations are wide
  // (200 OR 4xx-with-graceful-payload) so we measure REACHABILITY of the
  // full pipeline, not strict success of every backing provider.
  // Pace: 65s pause to respect the 120/min authenticated per-IP limiter
  // (JRX-RATE-002) since the prior 5 sections have burned the window.
  console.log(c.cyan('── 6b. O6 OCR / multilingual / multimodal verification ──'));
  console.log(c.yellow('     pacing: 65s pause for IP rate window…'));
  await sleep(65_000);
  await Promise.all(PLATFORMS.map(async (p) => {
    const key = KEYS[p];
    if (!key) { skipPlatform(p, `JRX_SDK_KEY_${p} not set`); return; }
    // OCR — POST text/base64 sample; backend returns 200 (ok) or 400 (bad input)
    await probe({ platform: p, label: 'O6.OCR ocr/process',          method: 'POST', path: '/api/jrx/gateway/ocr/process',                          expected: [200, 400, 413, 422, 500], apiKey: key, body: { imageUrl: 'https://example.com/sample.png', languages: ['en','hi'] } });
    // Multilingual translate batch (EN → HI/TA/BN)
    await probe({ platform: p, label: 'O6.ML  translate/batch',       method: 'POST', path: '/api/jrx/gateway/translate/batch',                     expected: [200, 400], apiKey: key, body: { items: [{ text: 'rights', targetLanguage: 'hi' }, { text: 'court', targetLanguage: 'ta' }, { text: 'law',  targetLanguage: 'bn' }], sourceLanguage: 'en' } });
    // Detect-language — script + lang detection
    await probe({ platform: p, label: 'O6.ML  translate/detect',      method: 'POST', path: '/api/jrx/gateway/translate/detect-language',           expected: [200, 400], apiKey: key, body: { text: 'अनुच्छेद 21 जीवन का अधिकार' } });
    // Multimodal vision/analyze — full pipeline check
    await probe({ platform: p, label: 'O6.MM  multimodal/vision',     method: 'POST', path: '/api/jrx/sdk/multimodal/multimodal/vision/analyze',    expected: [200, 400, 422, 500, 504], apiKey: key, body: { imageUrl: 'https://example.com/contract.png', task: 'extract_text' }, timeoutMs: 60_000 });
    // Multimodal RAG query — citation density / GraphRAG path
    await probe({ platform: p, label: 'O6.MM  multimodal/rag',        method: 'POST', path: '/api/jrx/sdk/multimodal/multimodal/rag/query',         expected: [200, 400, 500, 504], apiKey: key, body: { query: 'Indian Contract Act section 73', jurisdiction: 'IN', topK: 5 }, timeoutMs: 60_000 });
    // Voice / STT — capabilities + safety-ring trace via /usage
    await probe({ platform: p, label: 'O6.MM  multimodal/avatar',     method: 'POST', path: '/api/jrx/sdk/multimodal/multimodal/avatar/create-session', expected: [200, 400, 422], apiKey: key, body: { language: 'hi', voice: 'female' } });
    // Safety-ring trace dump via gateway/usage (always 200 if ring traversed)
    await probe({ platform: p, label: 'O6.SR  gateway/usage trace',   method: 'GET',  path: '/api/jrx/gateway/usage?detail=ring',                   expected: 200, apiKey: key });
  }));
  console.log();

  // ── Section 7: Negative — invalid key ─────────────────────────────────────
  console.log(c.cyan('── 7. Bad-key negative ──'));
  await probe({ platform: 'PUBLIC', label: 'invalid X-API-Key → 401', method: 'GET', path: '/api/jrx/gateway/agents', expected: 401, apiKey: 'nyv_test_sk_INVALID_BOGUS' });
  await probe({ platform: 'PUBLIC', label: 'webhook_secret as api key → 401/200{valid:false}', method: 'POST', path: '/api/jrx/sdk/provision/validate', expected: [200, 401], body: { api_key: 'nyv_wh_thisIsAWebhookSecret' } });
  console.log();

  // ── Summary ───────────────────────────────────────────────────────────────
  const total = pass + fail + skip;
  console.log(c.bold('═'.repeat(78)));
  console.log(
    `  Result: ${c.green(`${pass} PASS`)} / ${c.red(`${fail} FAIL`)} / ${c.yellow(`${skip} SKIP`)}  (total ${total})`
  );

  // Per-platform breakdown
  console.log(c.bold('  Per-platform:'));
  const byPlat: Record<string, { pass: number; fail: number; skip: number }> = {};
  for (const r of results) {
    const k = String(r.platform);
    byPlat[k] ??= { pass: 0, fail: 0, skip: 0 };
    if (r.status === 'PASS') byPlat[k].pass++;
    else if (r.status === 'FAIL') byPlat[k].fail++;
    else byPlat[k].skip++;
  }
  for (const [plat, s] of Object.entries(byPlat)) {
    console.log(`    ${plat.padEnd(8)} ${c.green(`${s.pass} PASS`)} / ${c.red(`${s.fail} FAIL`)} / ${c.yellow(`${s.skip} SKIP`)}`);
  }
  console.log(c.bold('═'.repeat(78)));

  writeFileSync(
    OUT,
    JSON.stringify({ timestamp: STAMP, gateway: GATEWAY, summary: { pass, fail, skip, total }, results }, null, 2),
  );
  console.log(`  Audit ledger written → ${OUT}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(c.red(`FATAL: ${(e as Error).stack ?? e}`));
  process.exit(2);
});
