#!/usr/bin/env tsx
/**
 * NSP P0 SDK smoke — typed @nyayavigya/client-sdk only (no raw fetch).
 *
 * Usage:
 *   cd nyayavigya-platform-312
 *   NYV_SDK_KEY_NSP=nyv_live_sk_... npm run sdk:smoke:nsp
 *   NV_TARGET=ec2 NYV_SDK_KEY_NSP=... npm run sdk:smoke:nsp
 */

import { NyvClient } from '../packages/client-sdk/src/NyvClient.js';

const TARGET = process.env.NV_TARGET ?? 'local';
const BASE =
  process.env.NV_BASE_URL ??
  (TARGET === 'ec2' || TARGET === 'prod' ? 'https://api.nyayasiddhi.online' : 'http://127.0.0.1:5000');
const KEY = process.env.NYV_SDK_KEY_NSP ?? process.env.NYV_SDK_KEY ?? '';

interface Step {
  name: string;
  ok: boolean;
  detail?: string;
}

const steps: Step[] = [];

function pass(name: string, detail?: string) {
  steps.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name: string, detail?: string) {
  steps.push({ name, ok: false, detail });
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log(`\n── NSP SDK smoke (typed) — ${BASE} ──\n`);

  if (!KEY) {
    fail('config', 'NYV_SDK_KEY_NSP unset');
    process.exit(1);
  }

  const nyv = new NyvClient({
    apiKey: KEY,
    baseUrl: BASE,
    platformClient: 'nyayasiddhi-professional/1.0.0',
    orchestrateTimeoutMs: 120_000,
  });

  try {
    const health = await nyv.healthCheck();
    pass('healthCheck', health.status);
  } catch (e: unknown) {
    fail('healthCheck', e instanceof Error ? e.message : String(e));
  }

  try {
    await nyv.gateway.getPracticeAreas();
    pass('gateway.getPracticeAreas');
  } catch (e: unknown) {
    fail('gateway.getPracticeAreas', e instanceof Error ? e.message : String(e));
  }

  try {
    await nyv.llmRouter.catalog();
    pass('llmRouter.catalog');
  } catch (e: unknown) {
    fail('llmRouter.catalog', e instanceof Error ? e.message : String(e));
  }

  try {
    await nyv.legalResearch('What is consideration under the Indian Contract Act?', 'IN');
    pass('legalResearch');
  } catch (e: unknown) {
    fail('legalResearch', e instanceof Error ? e.message : String(e));
  }

  try {
    await nyv.docsPipeline.summarize({
      documentText: 'SERVICE AGREEMENT between Alpha and Beta. Governed by laws of India.',
      jurisdiction: 'IN',
      length: 'short',
    });
    pass('docsPipeline.summarize');
  } catch (e: unknown) {
    fail('docsPipeline.summarize', e instanceof Error ? e.message : String(e));
  }

  try {
    await nyv.partnerIntelligence.classifyDocument({
      text: 'LEASE DEED between landlord and tenant for commercial premises in Mumbai.',
      jurisdiction: 'IN',
    });
    pass('partnerIntelligence.classifyDocument');
  } catch (e: unknown) {
    fail('partnerIntelligence.classifyDocument', e instanceof Error ? e.message : String(e));
  }

  try {
    await nyv.swarm.listTopologies({ limit: 3 });
    pass('swarm.listTopologies');
  } catch (e: unknown) {
    fail('swarm.listTopologies', e instanceof Error ? e.message : String(e));
  }

  try {
    await nyv.orchestrate({
      prompt: 'In one sentence, define breach of contract under Indian law.',
      agentKey: 'summarizer',
      taskType: 'summarize',
      jurisdiction: 'IN',
    });
    pass('orchestrate');
  } catch (e: unknown) {
    fail('orchestrate', e instanceof Error ? e.message : String(e));
  }

  const failed = steps.filter((s) => !s.ok).length;
  console.log(`\nResult: ${failed === 0 ? 'PASS' : 'FAIL'} (${steps.length - failed}/${steps.length})\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
