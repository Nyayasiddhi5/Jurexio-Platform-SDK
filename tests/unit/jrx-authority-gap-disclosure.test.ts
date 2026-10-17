/**
 * NV-AUTHORITY-SALIENCE-001 — the gap disclosure must reach the MODEL, not just
 * the envelope.
 *
 * This is the same class of defect as NV-CITE-GROUND-001: `citationRef` was
 * populated correctly and rendered nowhere the Queen path could see it, so a
 * field that existed changed nothing about the answer. `assessAuthorityGap`
 * exists so the model can STATE that leading authorities were not found rather
 * than presenting four routine orders as if they were the authorities — which
 * only works if the note is inside the string that becomes the prompt.
 *
 * `formatAutoRagContext` produces that string; `nv-queen-orchestrator` splices
 * it into the completion prompt. Asserting on its output is therefore asserting
 * on what the model is told.
 */
import { describe, it, expect } from 'vitest';
import {
  formatAutoRagContext,
  type AutoRagChunk,
  type AutoRagResult,
} from '../../src/services/jrx-auto-rag-router.js';
import type { AuthorityTierRequest } from '../../src/services/jrx-authority-salience.js';

const BUDGET = { ragChunkCharCap: 1_200, ragTotalCharCap: 20_000 };

const scRequest: AuthorityTierRequest = {
  tier: 'sc',
  cues: ['Supreme Court', 'Leading'],
  contentQuery: 'anticipatory bail economic offences',
  inferred: false,
};

const chunk = (over: Partial<AutoRagChunk>): AutoRagChunk => ({
  id: over.id ?? 'c1',
  content: over.content ?? 'Bail granted subject to conditions.',
  source: over.source ?? 'nys',
  score: over.score ?? 0.5,
  ...over,
});

const mkResult = (
  chunks: AutoRagChunk[],
  salience?: AutoRagResult['authoritySalience'],
): AutoRagResult =>
  ({
    chunks,
    contextBlock: '',
    intent: 'precedent_research',
    capabilityTier: 'enterprise',
    layersUsed: ['unified-base', 'nys_global'],
    retrievalMethods: ['nys:retrieve:case-search'],
    totalFound: chunks.length,
    confidence: 0.72,
    latencyMs: 1_200,
    ...(salience ? { authoritySalience: salience } : {}),
  } as AutoRagResult);

/** The production defect verbatim: four routine HC bail orders, zero SC rows. */
const FOUR_HC_ORDERS: AutoRagChunk[] = [1, 2, 3, 4].map((n) =>
  chunk({
    id: `hc${n}`,
    content: `ABAIL/${3700 + n}/2022 — anticipatory bail allowed on conditions.`,
    courtTier: 'hc',
    hasReporterCitation: false,
    authorityRef: `Gujarat High Court, 2022, ABAIL/${3700 + n}/2022`,
  }),
);

describe('formatAutoRagContext — AUTHORITY GAP reaches the model', () => {
  it('states the gap when the requested tier is entirely absent', () => {
    const result = mkResult(FOUR_HC_ORDERS, {
      request: scRequest, tierCount: 0, citableCount: 0,
    });
    const block = formatAutoRagContext(result, BUDGET);

    expect(block).toContain('AUTHORITY GAP');
    expect(block).toContain('Supreme Court');
    // The instruction that actually prevents the shipped failure mode.
    expect(block).toMatch(/do not present a lower-court order as if it were the governing/i);
    // And it must not invite the model to fill the gap from memory.
    expect(block).toMatch(/not supply a .*case name or citation from memory/i);
  });

  it('explains WHY, so the model does not read the gap as a corpus absence', () => {
    // A landmark can be in the corpus and still be unfindable: the index covers
    // metadata only. The model must not tell the lawyer "no such authority
    // exists" when the honest statement is "retrieval did not surface one".
    const block = formatAutoRagContext(
      mkResult(FOUR_HC_ORDERS, { request: scRequest, tierCount: 0, citableCount: 0 }),
      BUDGET,
    );
    expect(block).toMatch(/metadata only|not indexed/i);
  });

  it('downgrades to a citation NOTE when the tier is present but not citable', () => {
    const chunks = [
      chunk({ id: 'sc1', courtTier: 'sc', hasReporterCitation: false, content: 'Held: bail is the rule.' }),
      ...FOUR_HC_ORDERS,
    ];
    const block = formatAutoRagContext(
      mkResult(chunks, { request: scRequest, tierCount: 1, citableCount: 0 }),
      BUDGET,
    );
    expect(block).toContain('AUTHORITY NOTE');
    expect(block).not.toContain('AUTHORITY GAP');
    expect(block).toMatch(/do not upgrade a case-number reference into a reporter citation/i);
  });

  it('is SILENT when the requested tier was delivered and is citable', () => {
    const chunks = [
      chunk({
        id: 'sc1', courtTier: 'sc', hasReporterCitation: true,
        content: 'Sushila Aggarwal v. State (NCT of Delhi) — anticipatory bail need not be time-bound.',
        authorityRef: '(2020) 5 SCC 1',
      }),
      ...FOUR_HC_ORDERS,
    ];
    const block = formatAutoRagContext(
      mkResult(chunks, { request: scRequest, tierCount: 1, citableCount: 1 }),
      BUDGET,
    );
    expect(block).not.toContain('AUTHORITY GAP');
    expect(block).not.toContain('AUTHORITY NOTE');
  });

  it('is SILENT on every query that named no tier', () => {
    // The inertness guarantee: no `authoritySalience` means no note, so this
    // change cannot alter the prompt for the overwhelming majority of traffic.
    const block = formatAutoRagContext(mkResult(FOUR_HC_ORDERS), BUDGET);
    expect(block).not.toContain('AUTHORITY GAP');
    expect(block).not.toContain('AUTHORITY NOTE');
  });

  it('still renders the retrieved authorities alongside the gap note', () => {
    // The gap note must ADD a caveat, never replace the grounding — otherwise
    // an honest disclosure would cost the answer its evidence.
    const block = formatAutoRagContext(
      mkResult(FOUR_HC_ORDERS, { request: scRequest, tierCount: 0, citableCount: 0 }),
      BUDGET,
    );
    expect(block).toContain('AUTHORITY GAP');
    expect(block).toContain('ABAIL/3701/2022');
  });
});
