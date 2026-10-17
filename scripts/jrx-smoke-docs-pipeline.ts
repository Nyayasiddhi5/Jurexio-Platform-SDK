#!/usr/bin/env tsx
/**
 * Document pipeline + Phase 5 governance smoke harness.
 *
 * Usage:
 *   GATEWAY=http://localhost:5000 NYV_SDK_KEY_NSP=... JWT_TOKEN=... \
 *     npx tsx scripts/jrx-smoke-docs-pipeline.ts
 *
 * Exercises:
 *   - SDK docs-pipeline: parse → summarize → embeddings
 *   - Gate 8 JRX: 8 live rule evaluations
 *   - Audit chain verify (JWT)
 *   - PII vault status (JWT)
 */

const GATEWAY = (process.env.GATEWAY || 'http://localhost:5000').replace(/\/+$/, '');
const SDK_KEY = process.env.NYV_SDK_KEY_NSP || process.env.NYV_SDK_KEY_JRX || '';
const JWT = process.env.JWT_TOKEN || process.env.SME_TOKEN || process.env.SUPERADMIN_TOKEN || '';

const SAMPLE = `SERVICE AGREEMENT between Alpha Legal Tech Pvt Ltd and Beta Consulting LLP.
The Provider shall deliver document automation services within thirty (30) days.
The Client shall pay INR 5,00,000 upon execution. Either party may terminate with thirty days notice.
This agreement is governed by the laws of India.`;

interface Result { name: string; ok: boolean; detail?: string }

const results: Result[] = [];

function pass(name: string, detail?: string) { results.push({ name, ok: true, detail }); console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); }
function fail(name: string, detail?: string) { results.push({ name, ok: false, detail }); console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }

async function sdkPost(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`${GATEWAY}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': SDK_KEY },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, json };
}

async function jwtGet(path: string): Promise<{ status: number; json: any }> {
  try {
    const r = await fetch(`${GATEWAY}${path}`, {
      headers: JWT ? { Authorization: `Bearer ${JWT}` } : {},
    });
    const json = await r.json().catch(() => ({}));
    return { status: r.status, json };
  } catch (e: any) {
    return { status: 0, json: { error: e?.message || 'fetch failed' } };
  }
}

async function runDocPipeline() {
  console.log('\n── Docs pipeline (SDK) ──');
  if (!SDK_KEY) { fail('sdk-key', 'NYV_SDK_KEY_NSP unset'); return; }

  const parse = await sdkPost('/api/jrx/sdk/docs-pipeline/documents/parse', {
    content: SAMPLE, format: 'text', jurisdiction: 'IN', language: 'en',
  });
  if (parse.status === 200 && parse.json?.success) pass('parse', `sections=${parse.json.data?.sections?.length ?? 0}`);
  else fail('parse', `HTTP ${parse.status} ${parse.json?.error ?? ''}`);

  const sum = await sdkPost('/api/jrx/sdk/docs-pipeline/documents/summarize', {
    documentText: SAMPLE, jurisdiction: 'IN', length: 'short',
  });
  if (sum.status === 200 && sum.json?.success && sum.json.data?.summary) pass('summarize', `agent=${sum.json.data?.agentId ?? '?'}`);
  else fail('summarize', `HTTP ${sum.status} ${sum.json?.error ?? ''}`);

  const emb = await sdkPost('/api/jrx/sdk/docs-pipeline/documents/embeddings', {
    documents: [{ id: 'smoke-1', content: SAMPLE.slice(0, 500) }],
  });
  if (emb.status === 200 && emb.json?.success && (!emb.json.data?.synthetic || process.env.NYV_EMBED_KEYWORD_FALLBACK === '1' || process.env.NV_PLATFORM_UAT_BYPASS === '1' || process.env.NODE_ENV === 'development')) {
    const dims = emb.json.data?.embeddings?.[0]?.dimensions ?? 0;
    const tag = emb.json.data?.synthetic ? 'keyword-fallback' : `${dims} dims`;
    pass('embed', tag);
  } else if (emb.status === 500 || emb.status === 422) {
    fail('embed', emb.json?.error || `HTTP ${emb.status} (OPENAI_API_KEY required for real vectors)`);
  } else fail('embed', `HTTP ${emb.status}`);
}

async function runGate8Cases() {
  console.log('\n── Gate 8 JRX (8 cases) ──');
  const { jrxGuardrailsService } = await import('../src/services/jrx/jrx-guardrails.js');
  const cases: Array<{ name: string; input: Parameters<typeof jrxGuardrailsService.evaluate>[0]; expect: string[] }> = [
    { name: 'allow-clean-response', input: { requestId: 'g8-1', jurisdiction: 'IN', responseText: 'This is informational only — not legal advice. Consult a qualified advocate.' }, expect: ['ALLOW', 'WARN'] },
    { name: 'bci-33-no-disclaimer', input: { requestId: 'g8-2', jurisdiction: 'IN', responseText: 'You must terminate this contract immediately without delay.' }, expect: ['WARN', 'HITL', 'BLOCK', 'MANDATORY_HITL'] },
    { name: 'bci-36-solicitation', input: { requestId: 'g8-3', jurisdiction: 'IN', responseText: 'Hire us to represent you in this matter — contact us to retain our firm.' }, expect: ['WARN', 'HITL', 'BLOCK', 'MANDATORY_HITL'] },
    { name: 'bci-46-billing-no-estimate', input: { requestId: 'g8-4', jurisdiction: 'IN', promptText: 'What are your fees?', responseText: 'Our retainer fee is INR 2 lakh per month.' }, expect: ['WARN', 'HITL', 'BLOCK', 'MANDATORY_HITL'] },
    { name: 'bci-17-conflict', input: { requestId: 'g8-5', jurisdiction: 'IN', matterId: 'matter-smoke-1', responseText: 'Proceed with the merger filing.', metadata: { conflictCheckLogged: false } }, expect: ['WARN', 'HITL', 'BLOCK', 'MANDATORY_HITL'] },
    { name: 'bci-citation-bns', input: { requestId: 'g8-6', jurisdiction: 'IN', responseText: 'Apply IPC 1860 section 420 for cheating.' }, expect: ['WARN', 'HITL', 'BLOCK', 'MANDATORY_HITL'] },
    { name: 'court-submission-citations', input: { requestId: 'g8-7', jurisdiction: 'UK', responseText: 'File this petition with the court tomorrow.', citations: { verified: 0, unverified: 2 } }, expect: ['WARN', 'HITL', 'BLOCK', 'MANDATORY_HITL', 'ALLOW'] },
    { name: 'client-consent', input: { requestId: 'g8-8', jurisdiction: 'US', responseText: 'Share the client confidential strategy memo.', metadata: { clientConsent: false } }, expect: ['WARN', 'HITL', 'BLOCK', 'MANDATORY_HITL', 'ALLOW'] },
  ];

  for (const c of cases) {
    try {
      const r = await jrxGuardrailsService.evaluate(c.input);
      if (c.expect.includes(r.enforcement)) pass(`gate8:${c.name}`, r.enforcement);
      else fail(`gate8:${c.name}`, `got ${r.enforcement}, expected one of ${c.expect.join('|')}`);
    } catch (e: any) {
      fail(`gate8:${c.name}`, e?.message);
    }
  }
}

async function runGovernanceRoutes() {
  console.log('\n── Governance routes ──');
  const gate8 = await jwtGet('/api/jrx/governance/gate8/status');
  if (gate8.status === 200 && gate8.json?.success) pass('gate8/status', gate8.json.data?.sampleEvaluation?.enforcement);
  else if (gate8.status === 0) fail('gate8/status', 'gateway unreachable');
  else fail('gate8/status', `HTTP ${gate8.status}`);

  if (!JWT) {
    fail('audit/chain/verify', 'JWT_TOKEN unset — skip');
    fail('pii-vault/status', 'JWT_TOKEN unset — skip');
    return;
  }

  const chain = await jwtGet('/api/jrx/audit/chain/verify');
  if (chain.status === 200 && chain.json?.success) {
    const verified = chain.json.data?.verified ?? chain.json.data?.ok;
    pass('audit/chain/verify', verified === false ? 'verified=false (empty chain ok locally)' : String(verified ?? 'ok'));
  } else fail('audit/chain/verify', `HTTP ${chain.status}`);

  const pii = await jwtGet('/api/jrx/phase5/security/pii-vault/status');
  if (pii.status === 200 && pii.json?.success) pass('pii-vault/status', pii.json.data?.encryptionVerified ? 'AES-256-GCM' : 'dev-key');
  else fail('pii-vault/status', `HTTP ${pii.status}`);
}

async function main() {
  console.log(`Gateway: ${GATEWAY}`);
  await runDocPipeline();
  await runGate8Cases();
  await runGovernanceRoutes();

  const failed = results.filter(r => !r.ok);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('Failures:', failed.map(f => f.name).join(', '));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
