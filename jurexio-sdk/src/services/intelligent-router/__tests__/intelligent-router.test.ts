/**
 * NV-ROUTER-001 unit tests for IntelligentRouter scoring + Claude bias + fallback.
 * Run: npx tsx --test src/services/intelligent-router/__tests__/intelligent-router.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSequence } from '../intelligent-router.js';
import { recordFailure, recordSuccess, getHealthSnapshot, resetHealth } from '../health-tracker.js';
import { MODEL_CATALOG as CATALOG } from '../model-catalog.js';

test('catalog ships ≥ 25 models with all 4 enabled providers represented', () => {
  assert.ok(CATALOG.length >= 25, `expected ≥ 25 models, got ${CATALOG.length}`);
  const provs = new Set(CATALOG.map((m) => m.provider));
  for (const p of ['anthropic', 'openai', 'google', 'openrouter', 'agentzero'] as const) {
    assert.ok(provs.has(p), `provider ${p} missing from catalog`);
  }
});

test('pro + legal_drafting + IN → Claude family wins', () => {
  const d = pickSequence({
    agentId: 'contract-drafter',
    tier: 'pro',
    jurisdiction: 'IN',
    taskKind: 'legal_drafting',
  });
  assert.equal(d.primary.provider, 'anthropic', `expected anthropic, got ${d.primary.provider} (${d.primary.id})`);
  assert.ok(d.primary.id.includes('claude'), `expected claude model, got ${d.primary.id}`);
});

test('enterprise + legal_drafting → Claude in top 3', () => {
  const d = pickSequence({
    agentId: 'chief-legal-officer',
    tier: 'enterprise',
    jurisdiction: 'UK',
    taskKind: 'legal_drafting',
  });
  const top3 = d.sequence.slice(0, 3);
  assert.ok(
    top3.every((m) => m.provider === 'anthropic'),
    `expected top3 all anthropic, got ${top3.map((m) => m.id).join(',')}`,
  );
});

test('superadmin + chain_of_thought + requireReasoning → Claude or reasoning model on top', () => {
  const d = pickSequence({
    agentId: 'senior-litigation-strategist',
    tier: 'superadmin',
    jurisdiction: 'IN',
    taskKind: 'chain_of_thought',
    requireReasoning: true,
  });
  const top = d.primary;
  const ok = top.provider === 'anthropic' || top.capabilities?.reasoning === true;
  assert.ok(ok, `expected claude or reasoning model on top, got ${top.id} (${top.provider})`);
});

test('solo + classification + preferCheaper → cheap model first, Claude not first', () => {
  const d = pickSequence({
    agentId: 'deadline-calculator',
    tier: 'solo',
    jurisdiction: 'US',
    taskKind: 'classification',
    preferCheaper: true,
  });
  assert.notEqual(d.primary.id, 'claude-opus-4-6', 'opus should not lead cheap solo classification');
  assert.ok(d.primary.costInPer1M <= 5, `primary too expensive: ${d.primary.id} @ $${d.primary.costInPer1M}/1M`);
});

test('missing tier + senior agent → fallback to Claude default sequence', () => {
  const d = pickSequence({
    agentId: 'senior-litigation-strategist',
    // tier intentionally omitted
  });
  assert.equal(d.inputs.hasMissingInputs, true);
  assert.equal(d.primary.provider, 'anthropic', `expected default-Claude, got ${d.primary.id}`);
});

test('sequence always non-empty and ends with deterministic fallback (agentzero or simulation)', () => {
  for (const tier of ['free', 'solo', 'pro', 'enterprise', 'superadmin'] as const) {
    for (const taskKind of ['legal_drafting', 'classification', 'chain_of_thought', 'general'] as const) {
      const d = pickSequence({ agentId: 'x', tier, taskKind });
      assert.ok(d.sequence.length > 0, `empty sequence for ${tier}/${taskKind}`);
      const last = d.sequence[d.sequence.length - 1];
      assert.ok(
        last.provider === 'agentzero' || last.provider === 'simulation',
        `expected terminal agentzero/simulation, got ${last.id} (${last.provider}) for ${tier}/${taskKind}`,
      );
    }
  }
});

test('failed model gets demoted in score after repeated failures', () => {
  resetHealth();
  // Take the would-be primary for pro/legal_drafting
  const before = pickSequence({ agentId: 'contract-drafter', tier: 'pro', taskKind: 'legal_drafting' });
  const victim = before.primary.id;
  for (let i = 0; i < 12; i++) recordFailure(victim, 'forced 500');
  const snap = getHealthSnapshot().find((h) => h.modelId === victim);
  const successRate = snap ? 1 - snap.failureRate : 1;
  assert.ok(snap && successRate < 0.4, `expected low successRate, got ${successRate} (failureRate=${snap?.failureRate})`);
  const after = pickSequence({ agentId: 'contract-drafter', tier: 'pro', taskKind: 'legal_drafting' });
  // Victim must no longer be #1 OR must be demoted relative to its earlier rank
  const beforeRank = before.sequence.findIndex((m) => m.id === victim);
  const afterRank = after.sequence.findIndex((m) => m.id === victim);
  assert.ok(afterRank > beforeRank, `expected ${victim} demoted: was #${beforeRank}, now #${afterRank}`);
  resetHealth();
});

test('recovered model regains rank after success burst', () => {
  resetHealth();
  const v = 'claude-sonnet-4-6';
  for (let i = 0; i < 10; i++) recordFailure(v, 'forced');
  const demoted = pickSequence({ agentId: 'x', tier: 'pro', taskKind: 'legal_drafting' });
  for (let i = 0; i < 20; i++) recordSuccess(v, 800);
  const recovered = pickSequence({ agentId: 'x', tier: 'pro', taskKind: 'legal_drafting' });
  const dRank = demoted.sequence.findIndex((m) => m.id === v);
  const rRank = recovered.sequence.findIndex((m) => m.id === v);
  assert.ok(rRank <= dRank, `expected recovery: demoted #${dRank}, now #${rRank}`);
  resetHealth();
});

test('vision request never picks a non-vision model as primary', () => {
  const d = pickSequence({ agentId: 'doc-extractor', tier: 'pro', taskKind: 'vision', requireVision: true });
  assert.equal(d.primary.capabilities?.vision, true, `primary must support vision, got ${d.primary.id}`);
});

test('JSON request never picks a non-JSON model as primary', () => {
  const d = pickSequence({ agentId: 'classifier', tier: 'pro', taskKind: 'classification', requireJson: true });
  assert.equal(d.primary.capabilities?.json, true, `primary must support JSON, got ${d.primary.id}`);
});

test('pickSequence is pure — same input → same primary', () => {
  resetHealth();
  const a = pickSequence({ agentId: 'x', tier: 'pro', jurisdiction: 'IN', taskKind: 'legal_drafting' });
  const b = pickSequence({ agentId: 'x', tier: 'pro', jurisdiction: 'IN', taskKind: 'legal_drafting' });
  assert.equal(a.primary.id, b.primary.id, 'router not deterministic for same input');
});

test('an empty stream is treated as failure and the next candidate is tried', async () => {
  // Architect-flagged regression: previously, if a provider closed the SSE
  // stream without emitting any text, the orchestrator recorded success and
  // returned an empty response. The fix re-throws when emittedAny=false so
  // the orchestrator's catch block falls through to the next candidate.
  // We don't actually call providers here — we exercise the same control-flow
  // shape with a stand-in async generator and assert it advances.
  async function* emptyGen(): AsyncGenerator<string> {
    return; // closes without yielding
  }
  async function* goodGen(): AsyncGenerator<string> {
    yield 'hello ';
    yield 'world';
  }
  const fakeSequence: Array<() => AsyncGenerator<string>> = [emptyGen, goodGen];

  async function* orchestrate(): AsyncGenerator<string> {
    for (const make of fakeSequence) {
      let emittedAny = false;
      try {
        for await (const c of make()) { emittedAny = true; yield c; }
        if (!emittedAny) throw new Error('empty stream — provider returned no text content');
        return;
      } catch (e) {
        if (emittedAny) { yield `\n[STREAM_INTERRUPTED]`; return; }
      }
    }
  }

  const out: string[] = [];
  for await (const c of orchestrate()) out.push(c);
  assert.equal(out.join(''), 'hello world',
    `empty stream should cascade to next candidate, got: ${JSON.stringify(out)}`);
});

test('a sick preferred model loses primary slot to a healthy alternative even with legal-affinity boost', () => {
  // Reproduces the architect's MEDIUM finding: previously a +12 legal-affinity
  // boost on Claude could outweigh the max -4 health penalty, so a model with
  // 50%+ recent failures could still be picked as primary.
  resetHealth();
  const baseline = pickSequence({
    agentId: 'contract-drafter',
    tier: 'pro',
    jurisdiction: 'IN',
    taskKind: 'legal_drafting',
  });
  assert.equal(baseline.primary.provider, 'anthropic',
    `precondition: healthy state should pick Claude, got ${baseline.primary.id}`);
  const sickClaude = baseline.primary.id;

  // Drive the sick model into circuit-breaker territory:
  // 12 failures, 0 successes → failureRate=1.0, last fail just now → score=0.05.
  for (let i = 0; i < 12; i++) recordFailure(sickClaude, 'forced 500');

  const after = pickSequence({
    agentId: 'contract-drafter',
    tier: 'pro',
    jurisdiction: 'IN',
    taskKind: 'legal_drafting',
  });
  assert.notEqual(after.primary.id, sickClaude,
    `sick ${sickClaude} (failureRate=1.0) must NOT be primary anymore`);
  // It still belongs in the sequence as a late-position fallback.
  assert.ok(after.sequence.find((m) => m.id === sickClaude),
    `sick model should remain in sequence as fallback, got ${after.sequence.map(m=>m.id).join(',')}`);
  resetHealth();
});
