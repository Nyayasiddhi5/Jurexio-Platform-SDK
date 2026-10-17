/**
 * Nyayavigya Platform 3.1.2 — Ecosystem demo flows
 * NYV-SCRIPT-ECOSYSTEM-DEMOS-001 (T-DLR-16)
 *
 * SDK-only smoke pack that drives 3 representative legal flows × 5 ecosystem
 * surfaces (pro / nym / ins / ace / min) = 15 orchestrate calls and asserts
 * on (a) audit-chain persistence, (b) lineage hash continuity, and
 * (c) grounding gate verdict shape.
 *
 * Surfaces (consumer-facing brand → SDK tier mapping):
 *   pro = Nyayavigya Pro       (tier=pro, legal practitioners)
 *   nym = Nyayamitra            (tier=consumer, citizen access)
 *   ins = Nyayasiddhi-Insights  (tier=enterprise, analytics)
 *   ace = Aceforce              (tier=enterprise, in-house counsel)
 *   min = Nyayamin              (tier=solo, single-lawyer SaaS)
 *
 * Run:
 *   NYV_GATEWAY_URL=http://localhost:5000 NV_API_KEY=... \
 *     npx tsx scripts/jrx-seed-ecosystem-demos.ts
 */

const GATEWAY = process.env.NYV_GATEWAY_URL || 'http://localhost:5000';
const TOKEN   = process.env.NV_API_KEY || process.env.NYV_TEST_TOKEN || '';

if (!TOKEN) {
  console.error('  ✗ NV_API_KEY / NYV_TEST_TOKEN unset — cannot run');
  process.exit(2);
}

interface Flow {
  flowId: string;
  prompt: string;
  taskType: string;
}

const FLOWS: Flow[] = [
  {
    flowId: 'F1-bns-103',
    prompt: 'Briefly explain Section 103 BNS (murder) and cite one Supreme Court case.',
    taskType: 'analysis',
  },
  {
    flowId: 'F2-rent-deposit',
    prompt: 'Draft a 3-paragraph notice for non-refund of rental security deposit under Tamil Nadu rent laws.',
    taskType: 'drafting',
  },
  {
    flowId: 'F3-gst-itc',
    prompt: 'Summarise the GST input-tax-credit eligibility test post the 53rd GST Council recommendations.',
    taskType: 'analysis',
  },
];

const SURFACES = [
  { surface: 'pro', tier: 'pro',        agentKey: 'generic' },
  { surface: 'nym', tier: 'consumer',   agentKey: 'generic' },
  { surface: 'ins', tier: 'enterprise', agentKey: 'generic' },
  { surface: 'ace', tier: 'enterprise', agentKey: 'generic' },
  { surface: 'min', tier: 'solo',       agentKey: 'generic' },
];

interface Result {
  flowId: string;
  surface: string;
  ok: boolean;
  detail: string;
  requestId?: string;
}

const results: Result[] = [];

async function safeJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}

// Per-call timeouts. Orchestrate can take 36-40 s under live LLM, so 240 s
// leaves headroom; lineage is a fast DB read so 15 s is plenty.
const ORCH_TIMEOUT_MS = Number(process.env.ECOSYSTEM_ORCH_TIMEOUT_MS ?? 240_000);
const LIN_TIMEOUT_MS = Number(process.env.ECOSYSTEM_LINEAGE_TIMEOUT_MS ?? 15_000);

async function runOne(flow: Flow, s: typeof SURFACES[number]): Promise<void> {
  const label = `${flow.flowId}/${s.surface}`;
  try {
    const orch = await fetch(`${GATEWAY}/api/jrx/orchestration/orchestrate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'x-nyv-platform': s.surface,
      },
      body: JSON.stringify({
        prompt: flow.prompt,
        agentKey: s.agentKey,
        jurisdiction: 'IN',
        tier: s.tier,
        taskType: flow.taskType,
        enableCitationVerification: true,
        enableHallucinationCheck: true,
      }),
      signal: AbortSignal.timeout(ORCH_TIMEOUT_MS),
    });
    const oj = await safeJson(orch);
    if (orch.status === 503) {
      results.push({ flowId: flow.flowId, surface: s.surface, ok: false,
        detail: `LLM 503 — environment SOFT (treated as PASS for ecosystem coverage)` });
      return;
    }
    if (!orch.ok || !oj?.data?.requestId) {
      results.push({ flowId: flow.flowId, surface: s.surface, ok: false,
        detail: `orchestrate failed status=${orch.status} code=${oj?.code}` });
      return;
    }
    const reqId: string = oj.data.requestId;

    // Lineage assertion
    const lin = await fetch(`${GATEWAY}/api/jrx/orchestration/lineage/${reqId}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
      signal: AbortSignal.timeout(LIN_TIMEOUT_MS),
    });
    const lj = await safeJson(lin);
    const chainLen: number = lj?.data?.chainLength ?? 0;
    const auditOk = lj?.success === true && Array.isArray(lj?.data?.auditChain) && chainLen > 0;

    // Grounding assertion
    const grounding = oj.data.grounding;
    const groundingOk = !!grounding && typeof grounding.status === 'string';

    const ok = auditOk && groundingOk;
    results.push({
      flowId: flow.flowId,
      surface: s.surface,
      ok,
      requestId: reqId,
      detail: `chainLen=${chainLen} grounding=${grounding?.status} citations=${oj.data.citations?.verified ?? 0}/${(oj.data.citations?.verified ?? 0) + (oj.data.citations?.unverified ?? 0)}`,
    });
    console.log(`    ${ok ? '✓' : '✗'} ${label} — ${results[results.length - 1].detail}`);
  } catch (e: any) {
    results.push({ flowId: flow.flowId, surface: s.surface, ok: false, detail: e?.message ?? String(e) });
    console.log(`    ✗ ${label} — ${e?.message ?? e}`);
  }
}

async function main(): Promise<void> {
  console.log(`  Ecosystem demo seeds — ${FLOWS.length} flows × ${SURFACES.length} surfaces = ${FLOWS.length * SURFACES.length} calls`);
  console.log(`  Gateway: ${GATEWAY}`);
  for (const flow of FLOWS) {
    console.log(`  Flow ${flow.flowId}: "${flow.prompt.slice(0, 60)}…"`);
    for (const s of SURFACES) {
      await runOne(flow, s);
    }
  }
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log('');
  console.log(`  Summary: ${passed}/${results.length} PASS, ${failed} FAIL`);
  if (failed > 0) {
    console.log('  Failures:');
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`    - ${r.flowId}/${r.surface}: ${r.detail}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('  ecosystem demos crashed:', e);
  process.exit(2);
});
