#!/usr/bin/env tsx
/**
 * Task #156 — SME Legal Chat E2E smoke harness.
 *
 * Drives the SME flow across 7 jurisdictions × 6 modes = 42 scenarios via
 * the real `/api/jrx/legal-chat/send` SSE endpoint, posts a synthetic
 * rubric for each completed orchestration, and asserts:
 *   - the GRPO Redis stream `nyv:grpo:training` grew by N (best effort)
 *   - the EMA hash family `nyv:grpo:prefs:*` contains entries
 *   - per-(jurisdiction, mode) pass/fail is printed
 *
 * Usage:
 *   GATEWAY=http://localhost:5000 SME_TOKEN=<jwt> \
 *     npx tsx scripts/jrx-smoke-sme-legal-chat.ts
 *
 * Env:
 *   GATEWAY        target gateway base URL (default http://localhost:5000)
 *   SME_TOKEN      JWT for an `sme` (or `superadmin`) user; required
 *   SCENARIOS      override 'all' (default), 'min' (1 jur × 1 mode)
 *
 * Exit 0 on full pass, non-zero on any failure.
 */

const GATEWAY = (process.env.GATEWAY || 'http://localhost:5000').replace(/\/+$/, '');
let TOKEN = process.env.SME_TOKEN || '';
const SUPERADMIN_TOKEN = process.env.SUPERADMIN_TOKEN || '';
const SME_EMAIL = process.env.SME_SMOKE_EMAIL || `sme-smoke-${Date.now()}@example.com`;
const SME_PASSWORD = process.env.SME_SMOKE_PASSWORD || `SmokePw_${Date.now()}_aA1!`;
const SCENARIOS = (process.env.SCENARIOS || 'all').toLowerCase();

const JURISDICTIONS = ['IN', 'UK', 'US', 'EU', 'SG', 'GC', 'GLOBAL'] as const;
// Scenario "mode" values map to the canonical Console/SME mode taxonomy
// (free_chat, research, drafting, …). The first row drives the SCENARIOS=min
// mini-run and is intentionally `free_chat` to match the runbook label.
const MODES: Array<{ mode: string; prompt: string }> = [
  { mode: 'free_chat', prompt: 'Summarise the doctrine of frustration of contract.' },
  { mode: 'drafting', prompt: 'Draft a one-page mutual NDA between two software firms.' },
  { mode: 'document_qa', prompt: 'What are the key obligations of a data processor under GDPR Article 28?' },
  { mode: 'statute_lookup', prompt: 'Cite the statutory limit for filing an appeal in a civil suit.' },
  { mode: 'compliance_review', prompt: 'List 5 controls a fintech needs for KYC compliance.' },
  { mode: 'litigation_strategy', prompt: 'Outline a litigation strategy for a partnership-dissolution dispute.' },
];

interface ScenarioResult {
  jurisdiction: string;
  mode: string;
  ok: boolean;
  orchestrationId?: string;
  feedbackOk?: boolean;
  error?: string;
}

async function createSession(j: string, mode: string): Promise<string | null> {
  try {
    const r = await fetch(`${GATEWAY}/api/jrx/legal-chat/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        title: `smoke ${j} ${mode} ${new Date().toISOString().slice(11, 19)}`,
        jurisdictions: [j], tier: 'pro', mode,
      }),
    });
    const j2 = await r.json().catch(() => ({}));
    return (j2?.session?.id || j2?.id) ?? null;
  } catch { return null; }
}

async function runOne(j: string, mode: string, prompt: string): Promise<ScenarioResult> {
  try {
    const sessionId = await createSession(j, mode);
    const r = await fetch(`${GATEWAY}/api/jrx/legal-chat/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ prompt, jurisdictions: [j], mode, sessionId: sessionId ?? undefined }),
    });
    if (!r.ok || !r.body) {
      return { jurisdiction: j, mode, ok: false, error: `send ${r.status}` };
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = ''; let orchestrationId: string | undefined; let completed = false;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const dl = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!dl) continue;
        try {
          const evt = JSON.parse(dl.slice(6)) as { step?: string; orchestrationId?: string };
          if (evt.orchestrationId) orchestrationId = evt.orchestrationId;
          if (evt.step === 'run_complete') completed = true;
          if (evt.step === 'run_failed') return { jurisdiction: j, mode, ok: false, orchestrationId, error: 'run_failed' };
        } catch { /* ignore */ }
      }
    }
    if (!completed || !orchestrationId) {
      return { jurisdiction: j, mode, ok: false, orchestrationId, error: 'no run_complete' };
    }
    const fb = await fetch(`${GATEWAY}/api/jrx/legal-chat/feedback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        orchestrationId,
        ratings: { accuracy: 4, citationQuality: 4, jurisdictionFit: 5, helpfulness: 4, safety: 5 },
        thumb: 'up',
      }),
    });
    return { jurisdiction: j, mode, ok: fb.ok, orchestrationId, feedbackOk: fb.ok };
  } catch (e: unknown) {
    return { jurisdiction: j, mode, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function readRedisLen(stream: string): Promise<number | null> {
  const url = process.env.JRX_REDIS_TCP_URL || process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { createClient } = await import('redis');
    const c = createClient({ url });
    await c.connect();
    const n = await c.xLen(stream).catch(() => 0);
    await c.quit();
    return Number(n) || 0;
  } catch { return null; }
}

async function readPrefsKeys(): Promise<number | null> {
  const url = process.env.JRX_REDIS_TCP_URL || process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { createClient } = await import('redis');
    const c = createClient({ url });
    await c.connect();
    const keys = await c.keys('nyv:grpo:prefs:*').catch(() => []);
    await c.quit();
    return Array.isArray(keys) ? keys.length : 0;
  } catch { return null; }
}

async function provisionSmeViaSuperadmin(): Promise<string> {
  if (!SUPERADMIN_TOKEN) {
    throw new Error('Either SME_TOKEN or SUPERADMIN_TOKEN must be set');
  }
  console.log(`[smoke:sme] no SME_TOKEN; provisioning ${SME_EMAIL} via SUPERADMIN_TOKEN…`);
  // 1) Issue setup token
  const issueR = await fetch(`${GATEWAY}/api/jrx/legal-chat/sme-allocations/issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPERADMIN_TOKEN}` },
    body: JSON.stringify({ email: SME_EMAIL, scope: { jurisdictions: ['IN'] } }),
  });
  if (!issueR.ok) throw new Error(`issue failed ${issueR.status}: ${await issueR.text()}`);
  const issued = await issueR.json() as { setupUrl?: string };
  // The issuance response no longer surfaces the raw token in its JSON
  // body (NV-SME-ISSUE-TOKEN-PRIVACY-001); the canonical handoff is the
  // setupUrl which embeds `?token=...`. Smoke parses the URL to recover
  // the credential the same way a Superadmin's browser/email handoff
  // would deliver it to the SME.
  if (!issued.setupUrl) throw new Error('issue response missing setupUrl');
  const setupToken = new URL(issued.setupUrl).searchParams.get('token');
  if (!setupToken) throw new Error('setupUrl missing token query param');

  // 2) Redeem setup token (sets password + returns JWT). This is a PUBLIC
  // (unauthenticated) route, so it is CSRF-protected — a real browser sends
  // an Origin header automatically; the harness must do the same or the
  // gateway returns 403 "CSRF validation failed: missing origin".
  const setupR = await fetch(`${GATEWAY}/api/jrx/auth/sme-setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: GATEWAY },
    body: JSON.stringify({ token: setupToken, password: SME_PASSWORD }),
  });
  if (!setupR.ok) throw new Error(`setup failed ${setupR.status}: ${await setupR.text()}`);
  const setup = await setupR.json() as { token: string };
  if (!setup.token) throw new Error('setup response missing JWT');
  console.log(`[smoke:sme] provisioned + logged in as ${SME_EMAIL}`);
  return setup.token;
}

async function main(): Promise<void> {
  if (!TOKEN) {
    try {
      TOKEN = await provisionSmeViaSuperadmin();
    } catch (e) {
      console.error('[smoke:sme] credential bootstrap failed:', e instanceof Error ? e.message : String(e));
      console.error('[smoke:sme] set SUPERADMIN_TOKEN (preferred — exercises full E2E issuance) or pre-provide SME_TOKEN.');
      process.exit(2);
    }
  }
  // Optional scoping (NV-SME-PARALLEL-001): JURS / SME_MODES are comma-separated
  // allowlists for a targeted subset run (e.g. JURS=US,EU,GLOBAL SME_MODES=free_chat,drafting)
  // without touching the canonical 42-scenario matrix. Unknown tokens are ignored.
  const jursFilter = (process.env.JURS || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const modesFilter = (process.env.SME_MODES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  let jurs: readonly string[] = SCENARIOS === 'min' ? [JURISDICTIONS[0]] : JURISDICTIONS;
  let modes = SCENARIOS === 'min' ? [MODES[0]] : MODES;
  if (jursFilter.length) jurs = JURISDICTIONS.filter((j) => jursFilter.includes(j));
  if (modesFilter.length) modes = MODES.filter((m) => modesFilter.includes(m.mode));
  const total = jurs.length * modes.length;
  console.log(`[smoke:sme] running ${total} scenarios against ${GATEWAY}`);

  const streamBefore = await readRedisLen('nyv:grpo:training');
  const prefsBefore = await readPrefsKeys();

  const results: ScenarioResult[] = [];
  for (const j of jurs) {
    for (const m of modes) {
      const res = await runOne(j, m.mode, m.prompt);
      results.push(res);
      console.log(`  ${res.ok ? 'PASS' : 'FAIL'} ${j.padEnd(7)} ${m.mode.padEnd(20)} orch=${res.orchestrationId ?? '-'} ${res.error ?? ''}`);
    }
  }
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n[smoke:sme] ${pass}/${total} PASS`);

  let assertFail = false;
  const streamAfter = await readRedisLen('nyv:grpo:training');
  const prefsAfter = await readPrefsKeys();
  const expectedDelta = pass; // one feedback per passing scenario
  if (streamBefore !== null && streamAfter !== null) {
    const delta = streamAfter - streamBefore;
    const okDelta = delta >= expectedDelta && expectedDelta > 0;
    console.log(`[smoke:sme] redis stream nyv:grpo:training: ${streamBefore} -> ${streamAfter} (delta ${delta}, expected >=${expectedDelta}) ${okDelta ? 'OK' : 'FAIL'}`);
    if (!okDelta) assertFail = true;
  } else {
    console.log('[smoke:sme] redis stream check skipped (no JRX_REDIS_TCP_URL)');
  }
  if (prefsBefore !== null && prefsAfter !== null) {
    const okPrefs = prefsAfter > prefsBefore || prefsAfter > 0;
    console.log(`[smoke:sme] redis prefs nyv:grpo:prefs:*: ${prefsBefore} -> ${prefsAfter} ${okPrefs ? 'OK' : 'MISSING'}`);
    if (!okPrefs && pass > 0) assertFail = true;
  } else {
    console.log('[smoke:sme] redis prefs check skipped (no JRX_REDIS_TCP_URL)');
  }

  process.exit(pass === total && !assertFail ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error('[smoke:sme] FATAL:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
