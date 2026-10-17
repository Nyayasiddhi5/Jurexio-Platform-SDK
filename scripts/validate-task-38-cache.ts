/**
 * Task #38 validation: prove the prompt cache wiring works end-to-end.
 *
 *   1. Namespace isolation — tenant A's cached answer is invisible to tenant B
 *      and to the same tenant on a different jurisdiction / different agent.
 *   2. Hit rate target — a second pass of N identical prompts under the same
 *      namespace produces >70% cache hits.
 *
 * Run with:  npx tsx scripts/validate-task-38-cache.ts
 *
 * Exits non-zero on any failure so it's suitable for CI gating.
 */

import { LMCacheService } from '../src/services/lm-cache-service.js';

function buildNamespace(tenantId: string, jurisdiction: string, agentId: string): string {
  return `nv-agent:tenant:${tenantId}:juris:${jurisdiction.toUpperCase()}:agent:${agentId}`;
}

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  const icon = ok ? '✅' : '❌';
  console.log(`  ${icon} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function testNamespaceIsolation(): Promise<void> {
  console.log('\n[1/2] Namespace isolation (tenant × jurisdiction × agent)');
  // Disable semantic matching so we test exact-key isolation only — the path
  // most prone to cross-tenant leak before the indexKey fix.
  const cache = new LMCacheService({ enableSemanticMatching: false });

  const prompt = 'What is the punishment for theft under IPC?';
  const nsTenantA = buildNamespace('tenant-A', 'IN', 'litigation');
  const nsTenantB = buildNamespace('tenant-B', 'IN', 'litigation');
  const nsTenantAUS = buildNamespace('tenant-A', 'US', 'litigation');
  const nsTenantAOther = buildNamespace('tenant-A', 'IN', 'compliance');

  await cache.set(prompt, 'TENANT_A_ANSWER', { namespace: nsTenantA, model: 'gpt-4.1-mini' });

  const tenantALookup = await cache.get(prompt, nsTenantA);
  check('tenant A sees own cached entry', tenantALookup.hit && tenantALookup.entry?.value === 'TENANT_A_ANSWER',
    `hit=${tenantALookup.hit} value=${tenantALookup.entry?.value}`);

  const tenantBLookup = await cache.get(prompt, nsTenantB);
  check('tenant B does NOT see tenant A entry (cross-tenant isolation)', !tenantBLookup.hit,
    `hit=${tenantBLookup.hit}`);

  const usLookup = await cache.get(prompt, nsTenantAUS);
  check('tenant A in US jurisdiction does NOT see IN entry (cross-jurisdiction isolation)', !usLookup.hit,
    `hit=${usLookup.hit}`);

  const otherAgentLookup = await cache.get(prompt, nsTenantAOther);
  check('tenant A on different agent does NOT see litigation entry (cross-agent isolation)', !otherAgentLookup.hit,
    `hit=${otherAgentLookup.hit}`);

  // Tenant B writes its own answer — both tenants now have independent entries.
  await cache.set(prompt, 'TENANT_B_ANSWER', { namespace: nsTenantB, model: 'gpt-4.1-mini' });
  const tenantALookup2 = await cache.get(prompt, nsTenantA);
  const tenantBLookup2 = await cache.get(prompt, nsTenantB);
  check('after tenant B writes, tenant A still sees own answer (no overwrite)',
    tenantALookup2.hit && tenantALookup2.entry?.value === 'TENANT_A_ANSWER',
    `value=${tenantALookup2.entry?.value}`);
  check('after tenant B writes, tenant B sees own answer',
    tenantBLookup2.hit && tenantBLookup2.entry?.value === 'TENANT_B_ANSWER',
    `value=${tenantBLookup2.entry?.value}`);
}

async function testHitRateOnIdenticalPrompts(): Promise<void> {
  console.log('\n[2/2] Hit rate on identical prompts (target >70%)');
  const cache = new LMCacheService();

  const namespace = buildNamespace('acme-legal', 'IN', 'agent.litigation.criminal');
  const prompts = [
    'Explain the elements of murder under Section 300 IPC.',
    'What are the bail provisions for non-bailable offences?',
    'Describe the procedure for filing an FIR.',
    'What is the difference between murder and culpable homicide?',
    'Explain anticipatory bail under Section 438 CrPC.',
  ];

  // First pass — all misses, populate the cache.
  let firstPassHits = 0;
  for (const p of prompts) {
    const r = await cache.get(p, namespace);
    if (r.hit) firstPassHits++;
    else await cache.set(p, `Synthesized answer for: ${p}`, { namespace, model: 'gpt-4.1-mini' });
  }
  console.log(`  ℹ️  first pass hits: ${firstPassHits}/${prompts.length} (expected 0)`);

  // Second pass — every prompt must hit.
  let secondPassHits = 0;
  let totalSecondPass = 0;
  for (const p of prompts) {
    totalSecondPass++;
    const r = await cache.get(p, namespace);
    if (r.hit) secondPassHits++;
  }
  const hitRate = secondPassHits / totalSecondPass;
  console.log(`  ℹ️  second pass: ${secondPassHits}/${totalSecondPass} hits (rate=${(hitRate * 100).toFixed(1)}%)`);
  check('second-pass hit rate exceeds 70% target', hitRate > 0.7,
    `actual=${(hitRate * 100).toFixed(1)}%`);

  // Cross-tenant probe — none of these prompts should hit.
  const otherTenantNamespace = buildNamespace('other-firm', 'IN', 'agent.litigation.criminal');
  let crossTenantHits = 0;
  for (const p of prompts) {
    const r = await cache.get(p, otherTenantNamespace);
    if (r.hit) crossTenantHits++;
  }
  check('cross-tenant probe sees no cached entries (re-confirms isolation under semantic matching)',
    crossTenantHits === 0, `cross-tenant hits=${crossTenantHits}`);
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' Task #38 — prompt cache wiring validation');
  console.log('═══════════════════════════════════════════════════════════════');

  try {
    await testNamespaceIsolation();
    await testHitRateOnIdenticalPrompts();
  } catch (e) {
    console.error('FATAL error during validation:', e);
    process.exit(2);
  }

  console.log('\n───────────────────────────────────────────────────────────────');
  if (failures === 0) {
    console.log('✅ ALL CHECKS PASSED — Task #38 cache wiring contract holds.');
    process.exit(0);
  } else {
    console.log(`❌ ${failures} check(s) FAILED — review output above.`);
    process.exit(1);
  }
}

main();
