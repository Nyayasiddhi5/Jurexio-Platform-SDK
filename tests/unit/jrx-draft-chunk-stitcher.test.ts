import { describe, it, expect } from 'vitest';
import { stitchDraftChunks } from '../../src/services/jrx-draft-chunk-stitcher.js';
import type { DraftChunkPlan } from '../../src/services/jrx-draft-chunk-planner.js';

function chunk(index: number, phase: DraftChunkPlan['phase'], content: string): { plan: DraftChunkPlan; content: string } {
  return {
    plan: { phase, index, label: `chunk-${index}`, instruction: '', maxTokens: 1000 },
    content,
  };
}

describe('NV-DRAFT-CHUNK-001 stitcher', () => {
  it('joins chunks in index order', () => {
    const result = stitchDraftChunks([
      chunk(1, 'operative', 'Clause 5: Indemnity…'),
      chunk(0, 'outline', 'PARTIES\nAcme and Beta'),
    ]);
    expect(result.content.indexOf('PARTIES')).toBeLessThan(result.content.indexOf('Indemnity'));
    expect(result.chunkCount).toBe(2);
  });

  it('appends execution closure when missing (NV-DRAFT-COMPLETION-001)', () => {
    const result = stitchDraftChunks([
      chunk(0, 'outline', 'SHARE PURCHASE AGREEMENT\nRecitals…'),
      chunk(1, 'operative', 'Clause 1: Purchase price…'),
    ], 'complex_agreement');
    expect(result.appendedClosure).toBe(true);
    expect(result.content).toMatch(/IN WITNESS WHEREOF/i);
  });

  it('renumbers duplicate ARTICLE headings across chunks (NV-DRAFT-CHUNK-COHESION-002)', () => {
    const result = stitchDraftChunks([
      chunk(0, 'outline', 'PARTIES\n**ARTICLE 1**\nRecitals…'),
      chunk(1, 'operative', '**ARTICLE 1**\nIndemnity clause…\n**ARTICLE 2**\nLimitation…'),
    ], 'complex_agreement');
    const articleMatches = [...result.content.matchAll(/ARTICLE\s+(\d+)/gi)].map((m) => Number(m[1]));
    expect(articleMatches.filter((n) => n === 1).length).toBeLessThanOrEqual(1);
  });

  it('carries shared definitions registry from outline chunk', () => {
    const result = stitchDraftChunks([
      chunk(0, 'outline', '**DEFINITIONS**\n"Buyer" shall mean Acme Pvt Ltd.\n"Seller" shall mean Beta LLP.'),
      chunk(1, 'operative', 'Clause 5: Indemnity by Buyer in favour of Seller.'),
    ], 'complex_agreement');
    expect(result.definitionsRegistry.terms).toContain('Buyer');
    expect(result.definitionsRegistry.terms).toContain('Seller');
  });
});

