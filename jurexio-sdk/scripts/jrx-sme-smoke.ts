#!/usr/bin/env tsx
/**
 * Task #156 — SME Legal Chat smoke harness.
 *
 * Usage:
 *   NV_SMOKE_BASE=http://localhost:5000 \
 *   NV_SMOKE_EMAIL=sme1@example.com NV_SMOKE_PASSWORD=... \
 *   npx tsx scripts/jrx-sme-smoke.ts
 *
 * What it does (read-only-ish; INSERTs only into the user's own session):
 *   1. POST /api/auth/login with the SME's credentials → token
 *   2. POST /api/jrx/legal-chat/sessions → sessionId
 *   3. POST /api/jrx/legal-chat/send  (one prompt) → consume SSE,
 *      capture the orchestrationId + final assistant content + every
 *      timeline step + verify the SME-specific steps appear:
 *        - memory_injection (mem0 pre-recall)
 *        - safety_verdict
 *        - audit_chain
 *        - run_complete
 *   4. POST /api/jrx/legal-chat/feedback with a 5-criteria rubric →
 *      verifies the GRPO Postgres pair + Redis enqueue happen (best
 *      effort; presence of feedbackId is the contract).
 *   5. Prints a one-line PASS / FAIL per phase.
 *
 * No production data is written. The harness is jurisdiction-parametric:
 * set NV_SMOKE_JURISDICTIONS=IN,UK,US,EU,SG,GC,GLOBAL to run the full
 * 7-jurisdiction sweep (one prompt each). Default: IN only.
 */

const BASE = process.env.NV_SMOKE_BASE || 'http://localhost:5000';
const EMAIL = process.env.NV_SMOKE_EMAIL;
const PASSWORD = process.env.NV_SMOKE_PASSWORD;
const JURIS = (process.env.NV_SMOKE_JURISDICTIONS || 'IN').split(',').map((s) => s.trim()).filter(Boolean);

const PROMPTS_BY_JUR: Record<string, string> = {
  IN: 'Summarise key obligations of a data fiduciary under DPDPA 2023.',
  UK: 'List the principal duties of a director under the UK Companies Act 2006.',
  US: 'Outline the elements of fair use under 17 U.S.C. § 107.',
  EU: 'Explain the lawful bases for processing personal data under GDPR Art. 6.',
  SG: 'Summarise the DNC obligations under the Singapore PDPA.',
  GC: 'List the cross-border KYC requirements common to GCC banking regulators.',
  GLOBAL: 'Compare reasonable-care duties of a corporate director across major common-law jurisdictions.',
};

interface Phase { name: string; ok: boolean; detail?: string; }
const phases: Phase[] = [];
function record(name: string, ok: boolean, detail?: string) {
  phases.push({ name, ok, detail });
  // eslint-disable-next-line no-console
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error('NV_SMOKE_EMAIL and NV_SMOKE_PASSWORD are required');
    process.exit(2);
  }

  // 1. Login.
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const loginJson = await loginRes.json().catch(() => ({} as Record<string, unknown>));
  const token = loginJson?.token || loginJson?.accessToken;
  record('login', !!token, token ? `role=${loginJson?.user?.role}` : `status=${loginRes.status}`);
  if (!token) process.exit(1);
  const auth = { Authorization: `Bearer ${token}` };

  for (const j of JURIS) {
    // 2. Session.
    const sRes = await fetch(`${BASE}/api/jrx/legal-chat/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ title: `SME smoke ${j}`, jurisdictions: [j], tier: 'pro', mode: 'sme' }),
    });
    const sJson = await sRes.json().catch(() => ({} as Record<string, unknown>));
    const sessionId = sJson?.session?.id || sJson?.id;
    record(`session:${j}`, !!sessionId, sessionId ? `id=${sessionId}` : `status=${sRes.status}`);
    if (!sessionId) continue;

    // 3. Send + consume SSE.
    const prompt = PROMPTS_BY_JUR[j] || PROMPTS_BY_JUR.GLOBAL;
    const sendRes = await fetch(`${BASE}/api/jrx/legal-chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...auth },
      body: JSON.stringify({
        sessionId, prompt, jurisdictions: [j], tier: 'pro', mode: 'sme', smeContext: true,
      }),
    });
    const reader = sendRes.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let orchId: string | undefined;
    const seenSteps = new Set<string>();
    let finalText = '';
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const ev of events) {
          const line = ev.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const obj = JSON.parse(line.slice(6));
            if (obj?.step) seenSteps.add(obj.step);
            if (obj?.orchestrationId && !orchId) orchId = obj.orchestrationId;
            if (obj?.step === 'run_complete') finalText = String(obj?.data?.response ?? '');
          } catch { /* skip */ }
        }
      }
    }
    record(`send:${j}.run_complete`, seenSteps.has('run_complete'), `steps=${seenSteps.size} chars=${finalText.length}`);
    record(`send:${j}.memory_injection`, seenSteps.has('memory_injection'), 'mem0 pre-recall hook fired');
    record(`send:${j}.safety_verdict`, seenSteps.has('safety_verdict'));
    record(`send:${j}.audit_chain`, seenSteps.has('audit_chain'));

    // 4. Feedback (rubric).
    if (orchId) {
      const fRes = await fetch(`${BASE}/api/jrx/legal-chat/feedback`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
        body: JSON.stringify({
          orchestrationId: orchId,
          sessionId,
          ratings: {
            accuracy: 4, citation_grounding: 4, jurisdiction_fit: 5, completeness: 4, clarity: 5,
          },
          comment: 'Smoke harness rating',
        }),
      });
      const fJson = await fRes.json().catch(() => ({} as Record<string, unknown>));
      record(`feedback:${j}`, !!fJson?.feedbackId, `feedbackId=${fJson?.feedbackId ?? '?'}`);
    }
  }

  const failed = phases.filter((p) => !p.ok).length;
  console.log(`\n${phases.length - failed}/${phases.length} phases PASS`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
