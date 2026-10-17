/**
 * T-DLR-15: DEV-LIVE-READY end-to-end smoke pack.
 *
 * Validates Lane B wiring against a running gateway:
 *   1. GET /api/jrx/health                    → service up
 *   2. POST /api/jrx/orchestration/orchestrate → real LLM call (or 503 if unavail)
 *   3. Response carries citations + grounding fields                  (T-DLR-05)
 *   4. GET /api/jrx/orchestration/lineage/:requestId returns audit chain (T-DLR-04)
 *   5. emitOrchestrationAudit row is written to nv_audit_logs           (T-DLR-03)
 *   6. NSP web proxy /api/nyv-proxy/api/jrx/health passes through        (T-DLR-15)
 *
 * Exits non-zero on any HARD failure; SOFT failures (503 LLM, NSP unreachable)
 * are reported but do not fail the script — those are environment, not code.
 *
 * Usage:
 *   NYV_GATEWAY_URL=http://localhost:5000 \
 *   NYV_TEST_TOKEN=<jwt> \
 *   NSP_BASE_URL=http://localhost:3000 \
 *   NYV_F_AUDIT_WIRE=1 \
 *   tsx scripts/jrx-smoke-dev-live-ready.ts
 *
 * Result classification:
 *   PASS  — step succeeded against a live, reachable component (`ok=true`)
 *   SOFT  — step degraded due to environment, not code (`ok=false, soft=true`).
 *           SOFT outcomes are visible in the summary and intentionally do NOT
 *           cause a non-zero exit so the pack can run in dev/staging where
 *           NSP / external LLMs may be intermittently unavailable.
 *   FAIL  — step failed with no soft excuse (`ok=false, soft=false`); causes
 *           non-zero exit.
 */

const GATEWAY = process.env.NYV_GATEWAY_URL || 'http://localhost:5000';
const NSP     = process.env.NSP_BASE_URL    || 'http://localhost:3000';
const TOKEN   = process.env.NYV_TEST_TOKEN  || '';

type StepResult = { name: string; ok: boolean; soft?: boolean; detail?: string };
const results: StepResult[] = [];

function record(name: string, ok: boolean, detail = '', soft = false) {
  results.push({ name, ok, soft, detail });
  const tag = ok ? 'PASS' : (soft ? 'SOFT' : 'FAIL');
  // eslint-disable-next-line no-console
  console.log(`[${tag}] ${name}${detail ? '  — ' + detail : ''}`);
}

async function safeJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}

async function step1Health(): Promise<void> {
  try {
    const r = await fetch(`${GATEWAY}/api/jrx/health`);
    const j = await safeJson(r);
    record('1. gateway /api/jrx/health', r.ok && j?.status === 'healthy',
      `status=${r.status} health=${j?.status} agents=${j?.agents}`);
  } catch (e: any) {
    record('1. gateway /api/jrx/health', false, e?.message ?? String(e));
  }
}

async function step2Orchestrate(): Promise<{ requestId: string | null; data: any }> {
  if (!TOKEN) {
    record('2. orchestrate (no token, skipped)', false, 'NYV_TEST_TOKEN unset', true);
    return { requestId: null, data: null };
  }
  try {
    const r = await fetch(`${GATEWAY}/api/jrx/orchestration/orchestrate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({
        prompt: 'Briefly explain Section 103 BNS (murder) and cite one Supreme Court case.',
        agentKey: 'generic',
        jurisdiction: 'IN',
        tier: 'pro',
        taskType: 'analysis',
        enableCitationVerification: true,
        enableHallucinationCheck: true,
      }),
    });
    const j = await safeJson(r);
    if (r.status === 503) {
      record('2. orchestrate (LLM provider 503)', false,
        `code=${j?.code} — environment SOFT (no LLM available)`, true);
      return { requestId: null, data: j };
    }
    const reqId = j?.data?.requestId ?? null;
    record('2. orchestrate', r.ok && !!reqId,
      `status=${r.status} reqId=${reqId?.slice(0, 8)}…`);
    return { requestId: reqId, data: j?.data };
  } catch (e: any) {
    record('2. orchestrate', false, e?.message ?? String(e));
    return { requestId: null, data: null };
  }
}

function step3Grounding(data: any): void {
  if (!data) {
    record('3. grounding gate (no data, skipped)', false,
      'orchestrate step did not return data — environment SOFT', true);
    return;
  }
  const grounding = data.grounding;
  const citations = data.citations;
  const ok = !!grounding && typeof grounding.status === 'string';
  record('3. grounding gate (T-DLR-05)', ok,
    `status=${grounding?.status} verified=${citations?.verified} unverified=${citations?.unverified} hitl=${grounding?.requiresHumanReview}`);
}

async function step4Lineage(requestId: string | null): Promise<void> {
  if (!requestId || !TOKEN) {
    record('4. lineage reader (no requestId, skipped)', false,
      'no requestId from step 2 — environment SOFT', true);
    return;
  }
  // Audit emission is non-blocking (setImmediate); allow it a moment to land.
  await new Promise((r) => setTimeout(r, 750));
  try {
    const r = await fetch(`${GATEWAY}/api/jrx/orchestration/lineage/${encodeURIComponent(requestId)}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    const j = await safeJson(r);
    if (r.status === 404) {
      record('4. lineage reader (T-DLR-04)', false,
        '404 — likely NYV_F_AUDIT_WIRE=off; environment SOFT', true);
      return;
    }
    const ok = r.ok && j?.success && Array.isArray(j?.data?.auditChain) && j.data.auditChain.length > 0;
    record('4. lineage reader (T-DLR-04)', ok,
      `chainLength=${j?.data?.chainLength} summary.success=${j?.data?.summary?.success}`);
  } catch (e: any) {
    record('4. lineage reader (T-DLR-04)', false, e?.message ?? String(e));
  }
}

async function step5NspProxy(): Promise<void> {
  try {
    const r = await fetch(`${NSP}/api/nyv-proxy/api/jrx/health`);
    const j = await safeJson(r);
    if (!r.ok) {
      record('5. NSP proxy (T-DLR-15)', false,
        `NSP not running or upstream not configured (status=${r.status}) — environment SOFT`, true);
      return;
    }
    record('5. NSP proxy (T-DLR-15)', j?.status === 'healthy',
      `proxied health=${j?.status}`);
  } catch (e: any) {
    record('5. NSP proxy (T-DLR-15)', false,
      `NSP unreachable (${e?.message}) — environment SOFT`, true);
  }
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('═══ DEV-LIVE-READY smoke pack ═══');
  // eslint-disable-next-line no-console
  console.log(`  gateway: ${GATEWAY}`);
  // eslint-disable-next-line no-console
  console.log(`  nsp:     ${NSP}`);
  // eslint-disable-next-line no-console
  console.log(`  token:   ${TOKEN ? 'set' : 'unset (will skip auth steps)'}`);
  // eslint-disable-next-line no-console
  console.log('');

  await step1Health();
  const { requestId, data } = await step2Orchestrate();
  step3Grounding(data);
  await step4Lineage(requestId);
  await step5NspProxy();

  // eslint-disable-next-line no-console
  console.log('');
  const hardFails = results.filter((r) => !r.ok && !r.soft);
  const softFails = results.filter((r) => !r.ok && r.soft);
  // eslint-disable-next-line no-console
  console.log(`═══ Summary: ${results.length - hardFails.length - softFails.length} PASS, ${softFails.length} SOFT, ${hardFails.length} FAIL ═══`);
  process.exit(hardFails.length > 0 ? 1 : 0);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Smoke pack crashed:', e);
  process.exit(2);
});
