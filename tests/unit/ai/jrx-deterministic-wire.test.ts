/**
 * NV-JRX-DETERMINISTIC-WIRE-001 — the deterministic tier must be LIVE on the
 * specialist path, not merely exported.
 *
 * NV-JRX-LLMREQUIRED-001 made Auto-RAG carry `deterministic.answer`, but only the
 * knowledge-plane routes read it. Per NV-WIRING-001 exported != live: every
 * `/orchestrate` request still paid a frontier completion to restate statute text
 * NYS had already returned verbatim in ~50 ms. That gap is invisible to unit tests
 * of the resolver itself, which is exactly why it survived — so these tests assert
 * the CONSUMPTION SITE, not the resolver.
 *
 * The ordering assertions matter as much as the existence one: placed after the
 * NV-RAG-ABSTAIN-001 gate, a resolved citation answer would be discarded in favour
 * of asking the user to rephrase a question we had already answered (because
 * `abstainTasks` includes 'advisory' and 'research').
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(process.cwd(), 'src');
const clientSource = readFileSync(join(SRC, 'services/jrx-client.ts'), 'utf8');
const routerSource = readFileSync(join(SRC, 'services/jrx-auto-rag-router.ts'), 'utf8');

const wireIdx = clientSource.indexOf('NV-JRX-DETERMINISTIC-WIRE-001');
const abstainIdx = clientSource.indexOf("model: 'rag-abstain'");
const ragCtxIdx = clientSource.indexOf('ragContextResult = {');

describe('NV-JRX-DETERMINISTIC-WIRE-001 — the specialist path consumes the verdict', () => {
  it('reads deterministic.answer from the Auto-RAG result', () => {
    expect(wireIdx).toBeGreaterThan(-1);
    expect(clientSource).toContain('autoRag?.deterministic?.answer');
  });

  it('returns zero tokens, because no provider call is made', () => {
    // A non-zero token figure here would corrupt the benchmark set (plan §2.6),
    // where prompts 1-3 must show billed=0.
    const block = clientSource.slice(wireIdx, abstainIdx);
    expect(block).toContain('tokens: { prompt: 0, completion: 0, total: 0 }');
  });

  it('reports the resolver as the model so a zero-token answer stays auditable', () => {
    // 'unknown' or a real model name here would make deterministic traffic
    // indistinguishable from model traffic in the ledger.
    const block = clientSource.slice(wireIdx, abstainIdx);
    expect(block).toContain('model: deterministicAnswer.resolver');
  });

  it('carries citations through to the caller', () => {
    // A statute answer without pin-cites is not usable by counsel.
    const block = clientSource.slice(wireIdx, abstainIdx);
    expect(block).toContain('citations: deterministicAnswer.citations');
  });

  it('fires BEFORE the ungrounded-abstain gate', () => {
    // The specific ordering defect: abstainTasks matches advisory/research, so a
    // resolved answer placed after it would be replaced by "please rephrase".
    expect(wireIdx).toBeLessThan(abstainIdx);
  });

  it('fires AFTER rag context is captured, so the audit trail is not lost', () => {
    expect(ragCtxIdx).toBeGreaterThan(-1);
    expect(ragCtxIdx).toBeLessThan(wireIdx);
  });

  it('requires actual content rather than the mere presence of a verdict', () => {
    // NYS returns llmRequired:false for strategy prompts that merely name a
    // section; an empty-content early return would ship a blank answer.
    const block = clientSource.slice(wireIdx, abstainIdx);
    expect(block).toMatch(/deterministicAnswer\?\.content/);
  });
});

describe('NV-JRX-LLMREQUIRED-001 — the NYS verdict is re-tested locally, never trusted alone', () => {
  it('gates the probe on a pure pre-filter so drafting traffic pays nothing', () => {
    expect(routerSource).toContain('couldBeDeterministic(req.query)');
  });

  it('does not pay for re-retrieval reformulation when bypassing the model', () => {
    // llmReformulateQuery is itself a completion; improving grounding we are about
    // to discard is pure waste.
    expect(routerSource).toMatch(/confidence < RR_MIN_CONF && !deterministic\?\.answer/);
  });

  it('bounds the probe by the shared extras deadline', () => {
    // A slow NYS must not add latency to a request that will use the model anyway.
    const idx = routerSource.indexOf('deterministicJob');
    expect(idx).toBeGreaterThan(-1);
    expect(routerSource).toMatch(/Promise\.race\(\[\s*\n?\s*deterministicJob/);
  });

  it('keeps chunks populated so ignoring the verdict degrades safely', () => {
    // Callers that do not yet consume it must fall back to today's behaviour
    // rather than losing grounding entirely: the field is spread in additively
    // and never replaces `chunks`.
    expect(routerSource).toContain('...(deterministic ? { deterministic } : {})');
  });
});
