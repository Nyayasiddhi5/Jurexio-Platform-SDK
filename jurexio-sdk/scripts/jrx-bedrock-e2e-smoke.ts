#!/usr/bin/env npx tsx
/**
 * NV-BEDROCK-E2E-001 — invoke smoke for all Bedrock catalog models + router explain.
 *
 * Usage:
 *   npx tsx scripts/jrx-bedrock-e2e-smoke.ts
 *   GATEWAY=https://api.jurexio.com npx tsx scripts/jrx-bedrock-e2e-smoke.ts --remote
 *   npx tsx scripts/jrx-bedrock-e2e-smoke.ts --local-router-only
 */
import { MODEL_CATALOG } from '../src/services/intelligent-router/model-catalog.js';
import { pickSequence } from '../src/services/intelligent-router/intelligent-router.js';
import { orchestrateLLM } from '../src/services/intelligent-router/llm-orchestrator.js';
import { isBedrockFirstPolicy, isBedrockRoutingEnabled } from '../src/config/jrx-llm-routing-policy.js';

const REMOTE = process.argv.includes('--remote');
const LOCAL_ROUTER = process.argv.includes('--local-router-only');
const GATEWAY = process.env.GATEWAY ?? 'http://localhost:5000';

const USE_CASES: Array<{ name: string; tier: 'free' | 'pro' | 'enterprise'; task: string; prompt: string }> = [
  { name: 'legal_research', tier: 'enterprise', task: 'legal_research', prompt: 'Summarize Article 21 of the Indian Constitution in 2 sentences.' },
  { name: 'extraction', tier: 'pro', task: 'extraction', prompt: 'Extract parties from: "Agreement between Acme Corp and Beta LLC dated 2026-01-01."' },
  { name: 'cot', tier: 'enterprise', task: 'chain_of_thought', prompt: 'Reason step-by-step: is a verbal contract enforceable under Indian law?' },
  { name: 'generic_chat', tier: 'solo', task: 'generic_chat', prompt: 'What is nyayasiddhi platform?' },
];

const BEDROCK_MODELS = MODEL_CATALOG.filter((m) => m.provider === 'bedrock');

async function smokeLocalRouter(): Promise<void> {
  console.log('\n── Router policy ──');
  console.log('  bedrockEnabled:', isBedrockRoutingEnabled());
  console.log('  bedrockFirst:', isBedrockFirstPolicy());

  for (const uc of USE_CASES) {
    const decision = pickSequence({
      tier: uc.tier,
      jurisdiction: 'IN',
      taskKind: uc.task as any,
      app: 'NSP',
      promptTokens: 200,
      expectedOutputTokens: 150,
    });
    const lead = decision.sequence.slice(0, 5).map((m) => `${m.provider}:${m.id}`).join(' → ');
    console.log(`\n[router:${uc.name}] primary=${decision.primary.provider}:${decision.primary.id}`);
    console.log(`  lead: ${lead}`);
    const bedrockPos = decision.sequence.findIndex((m) => m.provider === 'bedrock');
    if (bedrockPos > 0 && isBedrockFirstPolicy()) {
      console.warn(`  WARN: bedrock not primary (index ${bedrockPos})`);
    }
  }
}

async function smokeDirectInvoke(): Promise<void> {
  console.log('\n── Direct Bedrock invoke (orchestrateLLM) ──');
  if (!isBedrockRoutingEnabled()) {
    console.warn('SKIP direct invoke — JRX_BEDROCK_ENABLED off / no AWS region');
    return;
  }

  const targets = BEDROCK_MODELS.slice(0, 6);
  let pass = 0;
  let fail = 0;

  for (const model of targets) {
    const t0 = Date.now();
    try {
      const out = await orchestrateLLM({
        requestId: `bedrock-smoke-${model.id}`,
        systemPrompt: 'You are a concise legal assistant. Reply in one short sentence.',
        userMessage: 'Say hello and name your model family.',
        routing: {
          tier: 'pro',
          jurisdiction: 'IN',
          taskKind: 'generic_chat',
          app: 'NSP',
          preferredModels: [model.id],
        },
        maxTokens: 120,
        temperature: 0.2,
      });
      const ms = Date.now() - t0;
      const ok = !!(out.content && out.content.length > 10 && out.provider !== 'agentzero');
      if (ok) pass++;
      else fail++;
      console.log(`  ${ok ? 'PASS' : 'FAIL'} ${model.id} (${ms}ms) len=${out.content?.length ?? 0} provider=${out.provider} model=${out.model}`);
    } catch (e: unknown) {
      fail++;
      console.log(`  FAIL ${model.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\nDirect invoke: ${pass} pass, ${fail} fail / ${targets.length}`);
}

async function smokeRemoteGateway(): Promise<void> {
  console.log(`\n── Remote gateway ${GATEWAY} ──`);
  const key = process.env.JRX_SDK_KEY_NSP ?? process.env.JRX_SDK_KEY;
  if (!key) {
    console.warn('SKIP remote — set JRX_SDK_KEY_NSP');
    return;
  }

  const res = await fetch(`${GATEWAY}/api/jrx/v1/sdk/llm/router/explain`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      tier: 'enterprise',
      jurisdiction: 'IN',
      taskKind: 'legal_research',
      app: 'NSP',
      promptTokens: 500,
      expectedOutputTokens: 300,
    }),
  });
  console.log(`  router/explain HTTP ${res.status}`);
  if (res.ok) {
    const json = await res.json() as any;
    const seq = (json?.data?.sequence ?? json?.sequence ?? []).slice(0, 6);
    console.log('  sequence:', seq.map((s: any) => `${s.provider ?? '?'}:${s.id ?? s.modelId}`).join(' → '));
  }

  const orch = await fetch(`${GATEWAY}/api/jrx/orchestration/orchestrate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      message: 'In one sentence: what is equitable remedy?',
      jurisdiction: 'IN',
      tier: 'pro',
      agentKey: 'jurexio',
      maxTokens: 200,
    }),
  });
  console.log(`  orchestrate HTTP ${orch.status}`);
  if (orch.ok) {
    const body = await orch.json() as any;
    const content = body?.data?.content ?? body?.content ?? '';
    console.log(`  content len=${String(content).length}`);
  }
}

async function main(): Promise<void> {
  console.log('./jrx-bedrock-e2e-smoke');
  await smokeLocalRouter();
  if (!REMOTE) await smokeDirectInvoke();
  if (REMOTE || process.env.GATEWAY) await smokeRemoteGateway();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
