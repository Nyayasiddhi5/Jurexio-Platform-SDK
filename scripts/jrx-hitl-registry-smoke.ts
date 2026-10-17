#!/usr/bin/env tsx
/**
 * NYV_F_HITL_REGISTRY integration smoke — registry-driven HITL thresholds + reviewer routing.
 *
 * Probes:
 *   1. POST /api/jrx/orchestration/hitl/workflow/execute (registry flag surfaced)
 *   2. GET  /api/jrx/orchestration/hitl/stats
 *   3. POST /api/jrx/orchestrate with high-risk taskType (HITL path when flag ON)
 *
 * Usage:
 *   GATEWAY=http://localhost:5000 TOKEN=<jwt> NYV_F_HITL_REGISTRY=true \
 *     npx tsx scripts/jrx-hitl-registry-smoke.ts
 *
 * Exit 0 on pass, non-zero on failure.
 */
const GATEWAY = (process.env.GATEWAY || 'http://localhost:5000').replace(/\/+$/, '');
const TOKEN = process.env.TOKEN || process.env.SME_TOKEN || '';
const HITL_FLAG = process.env.NYV_F_HITL_REGISTRY === 'true' || process.env.NYV_F_HITL_REGISTRY === '1';

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> || {}),
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  return fetch(`${GATEWAY}${path}`, { ...init, headers });
}

async function main(): Promise<void> {
  const failures: string[] = [];

  console.log(`[hitl-smoke] gateway=${GATEWAY} NYV_F_HITL_REGISTRY=${HITL_FLAG}`);

  // 1 — workflow execute endpoint
  const wf = await authFetch('/api/jrx/orchestration/hitl/workflow/execute', {
    method: 'POST',
    body: JSON.stringify({
      agentKey: 'in-contract-specialist',
      agentConfidence: 0.55,
      jurisdiction: 'IN',
      practiceArea: 'Contract Law',
      taskType: 'contract-review',
    }),
  });
  const wfJson = await wf.json().catch(() => ({}));
  if (!wf.ok) {
    failures.push(`workflow/execute HTTP ${wf.status}`);
  } else if (wfJson.hitlRegistryFlag !== HITL_FLAG) {
    failures.push(`workflow/execute hitlRegistryFlag mismatch (got ${wfJson.hitlRegistryFlag}, env ${HITL_FLAG})`);
  } else {
    console.log(`  ✓ workflow/execute status=${wf.status} hitlRegistryFlag=${wfJson.hitlRegistryFlag}`);
  }

  // 2 — stats endpoint
  const stats = await authFetch('/api/jrx/orchestration/hitl/stats');
  if (!stats.ok) {
    failures.push(`hitl/stats HTTP ${stats.status}`);
  } else {
    console.log(`  ✓ hitl/stats status=${stats.status}`);
  }

  // 3 — orchestrate high-risk (advisory when flag OFF)
  const orch = await authFetch('/api/jrx/orchestrate', {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'Assess criminal liability under BNS for a cheque dishonour matter.',
      agentKey: 'in-litigation-specialist',
      jurisdiction: 'IN',
      taskType: 'criminal-analysis',
      tier: 'pro',
      enableHITL: true,
      enableRAG: false,
      enableMemory: false,
    }),
  });
  const orchJson = await orch.json().catch(() => ({}));
  if (!orch.ok && orch.status !== 503) {
    failures.push(`orchestrate HTTP ${orch.status}`);
  } else {
    const hasHitl = !!(orchJson.data?.hitlStatus || orchJson.hitlStatus || orchJson.data?.hitlRegistryExecution);
    console.log(`  ✓ orchestrate status=${orch.status} hitlSurfaced=${hasHitl}`);
    if (HITL_FLAG && !hasHitl && orch.ok) {
      failures.push('orchestrate: expected hitlStatus or hitlRegistryExecution when NYV_F_HITL_REGISTRY=true');
    }
  }

  if (failures.length) {
    console.error('\n[hitl-smoke] FAIL');
    failures.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log('\n[hitl-smoke] PASS');
}

main().catch(err => {
  console.error('[hitl-smoke] fatal', err);
  process.exit(1);
});
