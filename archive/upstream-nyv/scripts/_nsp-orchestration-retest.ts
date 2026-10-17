#!/usr/bin/env npx tsx
/**
 * Live NSP orchestration quality re-test (NYV-SDK-AUTO-ORCH-001 verification).
 * Uses NYV_SDK_KEY_NSP from env — never logs the key.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE = process.env.NV_BASE_URL?.replace(/\/$/, '') || 'https://api.nyayasiddhi.online';
const KEY = process.env.NYV_SDK_KEY_NSP || '';
const OUT_DIR = join(process.cwd(), 'docs/audit/nsp-orchestration-retest-2026-06-15');

type Case = { id: string; label: string; body: Record<string, unknown>; expectQueen?: boolean };

const CASES: Case[] = [
  {
    id: 'simple',
    label: 'Simple single-issue (expect single-agent ring)',
    body: {
      prompt: 'In one sentence under Indian law, what is consideration?',
      jurisdiction: 'IN',
      taskType: 'summarize',
      mode: 'sync',
    },
    expectQueen: false,
  },
  {
    id: 'complex-contract',
    label: 'Multi-issue contract dispute (expect Queen auto-orch)',
    body: {
      prompt:
        'Our client signed a software licensing agreement with a force majeure clause, ' +
        'then the vendor terminated for alleged breach of SLA uptime guarantees while ' +
        'simultaneously invoking limitation of liability and indemnity caps. ' +
        'Analyze: (1) whether termination was valid under the Indian Contract Act and IT Act, ' +
        '(2) interplay of force majeure vs frustration, (3) recoverable damages and ' +
        'injunctive relief, citing applicable sections and leading precedents.',
      jurisdiction: 'IN',
      taskType: 'analysis',
      enableRAG: true,
      enableHallucinationCheck: true,
    },
    expectQueen: true,
  },
  {
    id: 'complex-multi-domain',
    label: 'Cross-domain regulatory (expect Queen auto-orch)',
    body: {
      prompt:
        'A fintech NBFC is launching cross-border remittance with KYC under PMLA, ' +
        'RBI master directions, and DPDP Act consent flows. Draft a compliance checklist ' +
        'covering licensing, data localization, grievance redressal, and agent liability ' +
        'for AI-assisted customer onboarding.',
      jurisdiction: 'IN',
      taskType: 'analysis',
      enableRAG: true,
    },
    expectQueen: true,
  },
];

function pickMeta(json: Record<string, unknown>) {
  const data = (json.data ?? json) as Record<string, unknown>;
  const content = typeof data.content === 'string' ? data.content : '';
  return {
    httpOk: json.success !== false,
    orchestrationMode: data.orchestrationMode ?? json.orchestrationMode ?? null,
    autoOrchestrated: data.autoOrchestrated ?? json.autoOrchestrated ?? null,
    agentsUsed: data.agentsUsed ?? json.agentsUsed ?? null,
    orchestrationPattern: data.orchestrationPattern ?? json.orchestrationPattern ?? null,
    complexityAssessment: data.complexityAssessment ?? json.complexityAssessment ?? null,
    tier: data.tier ?? json.tier ?? null,
    model: data.model ?? json.model ?? null,
    provider: data.provider ?? json.provider ?? null,
    agent: data.agent ?? json.agent ?? null,
    pattern: data.pattern ?? json.pattern ?? null,
    citationsVerified: data.citationsVerified ?? json.citationsVerified ?? null,
    groundingStatus: data.groundingStatus ?? json.groundingStatus ?? null,
    totalTokens: data.totalTokens ?? json.totalTokens ?? null,
    totalTime: data.totalTime ?? json.totalTime ?? null,
    executionsCount: Array.isArray(data.executions) ? data.executions.length : 0,
    contentLength: content.length,
    contentPreview: content.slice(0, 280).replace(/\s+/g, ' '),
    hasCitations: /§|Section|Act,|IPC|Contract Act|precedent/i.test(content),
  };
}

async function runCase(c: Case) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/jrx/orchestrate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': KEY,
    },
    body: JSON.stringify(c.body),
    signal: AbortSignal.timeout(Number(process.env.NV_ORCH_TIMEOUT_MS || 120_000)),
  });
  const elapsed = Date.now() - t0;
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { success: false, error: 'non-json', raw: text.slice(0, 500) };
  }
  const meta = pickMeta(json);
  const queenEngaged =
    meta.autoOrchestrated === true ||
    (typeof meta.agentsUsed === 'number' && meta.agentsUsed > 1) ||
    meta.orchestrationMode === 'auto' ||
    (meta.executionsCount ?? 0) > 1;
  return {
    id: c.id,
    label: c.label,
    expectQueen: c.expectQueen,
    httpStatus: res.status,
    elapsedMs: elapsed,
    queenEngaged,
    pass:
      res.status === 200 &&
      meta.contentLength > 50 &&
      (c.expectQueen ? queenEngaged : true),
    meta,
    error: json.error ?? null,
  };
}

async function main() {
  if (!KEY) {
    console.error('NYV_SDK_KEY_NSP not set');
    process.exit(2);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  const health = await fetch(`${BASE}/api/jrx/health`).then((r) => r.json()).catch(() => ({}));
  const results = [];
  for (const c of CASES) {
    console.log(`\n▶ ${c.id}: ${c.label}`);
    const r = await runCase(c);
    results.push(r);
    console.log(
      `  HTTP ${r.httpStatus} | ${r.elapsedMs}ms | queen=${r.queenEngaged} | agents=${r.meta.agentsUsed} | ` +
        `pattern=${r.meta.orchestrationPattern ?? r.meta.pattern ?? '-'} | tier=${r.meta.tier ?? '-'} | ` +
        `model=${r.meta.model ?? '-'} | len=${r.meta.contentLength} | pass=${r.pass}`,
    );
    if (r.meta.complexityAssessment) {
      console.log(`  complexity=${JSON.stringify(r.meta.complexityAssessment)}`);
    }
  }
  const summary = {
    timestamp: new Date().toISOString(),
    base: BASE,
    healthVersion: (health as any)?.version,
    registryVersion: (health as any)?.registryVersion,
    totalAgents: (health as any)?.totalAgents,
    results,
    verdict: results.every((r) => r.pass) ? 'PASS' : results.some((r) => r.httpStatus === 200) ? 'PARTIAL' : 'FAIL',
  };
  const outPath = join(OUT_DIR, 'nsp-orchestration-retest.json');
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(`Verdict: ${summary.verdict}`);
  process.exit(summary.verdict === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
