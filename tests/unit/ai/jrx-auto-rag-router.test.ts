import { describe, expect, it } from 'vitest';
import {
  classifyRagIntent,
  reciprocalRankFusion,
  formatAutoRagContext,
  scoreConfidence,
  normalizeRagJurisdiction,
  JRX_SIX_JURISDICTIONS,
  type AutoRagChunk,
} from '../../../src/services/jrx-auto-rag-router.js';

/** Build a chunk with a deterministic id. */
function chunk(id: string): AutoRagChunk {
  return {
    id, source: 'kc', title: id.toUpperCase(), content: `content-${id}`,
    jurisdiction: 'IN', score: 0, layer: 'knowledge_chunks',
  };
}

/** Rank `ids` as one retriever's ordered list. */
function list(ids: string[]) {
  return ids.map((id) => ({ key: id, chunk: chunk(id) }));
}

const RERETRIEVE_THRESHOLD = 0.55;
const ABSTAIN_FLOOR = 0.45;

describe('./jrx-auto-rag-router', () => {
  it('classifies precedent research intent', () => {
    expect(classifyRagIntent('Find landmark precedent on contract breach')).toBe('precedent_research');
  });

  it('classifies citation lookup intent', () => {
    expect(classifyRagIntent('What does Section 318 of BNS say?')).toBe('citation_lookup');
  });

  it('classifies NI Act authority-seeking research as precedent (not citation_lookup)', () => {
    const q = 'What are the leading Supreme Court authorities on the presumption under Section 139 of the Negotiable Instruments Act? Cite the cases.';
    expect(classifyRagIntent(q, 'legal_research')).toBe('precedent_research');
  });

  it('classifies comparative analysis intent', () => {
    expect(classifyRagIntent('Compare GDPR vs DPDPA data retention')).toBe('comparative_analysis');
  });

  it('normalizes GCC alias to GC for RAG jurisdiction', () => {
    expect(normalizeRagJurisdiction('gcc')).toBe('GC');
    expect(normalizeRagJurisdiction('US')).toBe('US');
  });

  it('defines six canonical jurisdictions for cross-jx retrieval', () => {
    expect(JRX_SIX_JURISDICTIONS).toEqual(['IN', 'UK', 'US', 'EU', 'SG', 'GC']);
  });

  it('merges ranked lists with RRF boosting shared documents', () => {
    const chunkA: AutoRagChunk = {
      id: 'a', source: 'kc', title: 'A', content: 'alpha', jurisdiction: 'IN', score: 0, layer: 'knowledge_chunks',
    };
    const chunkB: AutoRagChunk = {
      id: 'b', source: 'rd', title: 'B', content: 'beta', jurisdiction: 'IN', score: 0, layer: 'rag_documents',
    };
    const chunkC: AutoRagChunk = {
      id: 'c', source: 'rd', title: 'C', content: 'gamma', jurisdiction: 'IN', score: 0, layer: 'rag_documents',
    };
    const merged = reciprocalRankFusion([
      [{ key: 'a', chunk: chunkA }, { key: 'b', chunk: chunkB }, { key: 'c', chunk: chunkC }],
      [{ key: 'b', chunk: chunkB }],
    ]);
    expect(merged.length).toBe(3);
    expect(merged[0].id).toBe('b');
    expect(merged.find((c) => c.id === 'c')!.score).toBeLessThan(merged[0].score);
  });

  it('formats context block with layer tags', () => {
    const block = formatAutoRagContext({
      chunks: [{
        id: '1', source: 'BNS', title: 'S.318', content: 'text', jurisdiction: 'IN', score: 0.9, layer: 'knowledge_chunks',
      }],
      contextBlock: '',
      intent: 'citation_lookup',
      capabilityTier: 'enterprise',
      layersUsed: ['unified-base'],
      retrievalMethods: ['knowledge_chunks:hybrid'],
      totalFound: 1,
      confidence: 0.9,
      latencyMs: 12,
    });
    expect(block).toContain('Auto-RAG');
    expect(block).toContain('knowledge_chunks');
    expect(block).toContain('S.318');
  });
});

/**
 * NV-RAG-CONF-001 regression suite.
 *
 * The shipped defect: confidence was `0.45 + mean(top-3 raw RRF)`. A raw RRF sum
 * tops out at `nLists/(k+1)` (≈0.098 for six lists at k=60), so confidence could
 * never exceed 0.5484 — under the 0.55 re-retrieval threshold. Result: a second
 * full retrieval pass on 100% of RAG requests, an unreachable 0.45 abstain floor,
 * and a near-constant ~0.47 confidence reported to SDK clients.
 */
describe('./jrx-auto-rag-router — confidence (NV-RAG-CONF-001)', () => {
  it('clears the re-retrieval threshold on a strong top-ranked result', () => {
    // Same chunk ranked #1 by two independent retrievers — the strongest signal
    // retrieval can produce. Under the old formula this scored ~0.478.
    const merged = reciprocalRankFusion([list(['a', 'b', 'c']), list(['a', 'x'])]);
    const conf = scoreConfidence(merged);
    expect(conf).toBeGreaterThan(RERETRIEVE_THRESHOLD);
    expect(conf).toBeGreaterThan(ABSTAIN_FLOOR);
  });

  it('still clears the threshold with a single retriever ranking cleanly', () => {
    const merged = reciprocalRankFusion([list(['a', 'b', 'c'])]);
    expect(scoreConfidence(merged)).toBeGreaterThan(RERETRIEVE_THRESHOLD);
  });

  it('does NOT penalise enabling more retrievers', () => {
    // Guards the rejected normalise-by-nLists approach, which made identical
    // top hits score lower as more retrievers were configured — that would push
    // genuine answers under the abstain floor.
    const one = scoreConfidence(reciprocalRankFusion([list(['a', 'b', 'c'])]));
    const many = scoreConfidence(reciprocalRankFusion([
      list(['a', 'b', 'c']), list(['a', 'b']), list(['a']), list(['a', 'z']),
    ]));
    expect(many).toBeGreaterThanOrEqual(one);
  });

  it('falls below both thresholds when nothing ranks well', () => {
    // Deep-tail hits from one retriever: the case abstain exists for.
    const deep = list(['p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z']);
    const merged = reciprocalRankFusion([deep]).slice(9);
    const conf = scoreConfidence(merged);
    expect(conf).toBeLessThan(RERETRIEVE_THRESHOLD);
    expect(conf).toBeLessThan(ABSTAIN_FLOOR);
  });

  it('returns 0 for no chunks so abstain can fire', () => {
    expect(scoreConfidence([])).toBe(0);
  });

  it('is bounded to (0, 0.98]', () => {
    const many = Array.from({ length: 8 }, () => list(['a', 'b', 'c']));
    expect(scoreConfidence(reciprocalRankFusion(many))).toBeLessThanOrEqual(0.98);
  });
});
