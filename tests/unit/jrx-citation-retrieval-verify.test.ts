import { describe, it, expect, vi } from 'vitest';
import {
  applyRetrievalCitationVerify,
  extractCaseCitationCandidates,
  propositionMatchesRetrieval,
  CITATION_VERIFY_HOLDING_MARKER,
  type CaselawSearchFn,
} from '../../src/services/jrx-citation-retrieval-verify.js';

describe('NV-CITATION-RETRIEVAL-VERIFY-001', () => {
  it('extracts party-name case citations', () => {
    const sample = 'As held in Sushila Aggarwal v. State of Delhi, anticipatory bail is discretionary.';
    const candidates = extractCaseCitationCandidates(sample);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].caseQuery).toMatch(/Sushila Aggarwal/i);
  });

  it('propositionMatchesRetrieval accepts overlapping holding text', () => {
    const sentence = 'Anticipatory bail under Section 438 CrPC need not be limited in time.';
    const snippet = 'The Court held anticipatory bail under Section 438 CrPC need not invariably be limited in time.';
    expect(propositionMatchesRetrieval(sentence, snippet)).toBe(true);
  });

  it('replaces stretch cite when retrieval does not support proposition', async () => {
    const mockSearch: CaselawSearchFn = vi.fn(async () => [{
      title: 'Ajay Malik v. State of Uttarakhand',
      citation: '(2024) 1 SCC 100',
      snippet: 'SC/ST Act ingredients and arrest procedure under BNSS.',
    }]);

    const sample = 'In Ajay Malik v. State of Uttarakhand the Court applied Bhajan Lal categories for omnibus FIR quashing.';
    const result = await applyRetrievalCitationVerify(sample, { searchFn: mockSearch, timeoutMs: 2000 });
    expect(result.citationVerified).toBe(false);
    expect(result.content).toMatch(/CITATION REQUIRED — verify holding|\[CITATION REQUIRED — verify holding\]/);
  });

  it('passes when mock retrieval supports proposition', async () => {
    const mockSearch: CaselawSearchFn = vi.fn(async () => [{
      title: 'Gurbaksh Singh Sibbia v. State of Punjab',
      snippet: 'The High Court and Sessions Court must apply their own mind on anticipatory bail.',
    }]);

    const sample = 'The Sessions Court must apply its own mind on anticipatory bail (Gurbaksh Singh Sibbia v. State of Punjab).';
    const result = await applyRetrievalCitationVerify(sample, { searchFn: mockSearch, timeoutMs: 2000 });
    expect(mockSearch).toHaveBeenCalled();
    expect(result.citationVerified).toBe(true);
    expect(result.content).not.toContain(CITATION_VERIFY_HOLDING_MARKER);
  });

  it('fail-soft when retrieval returns no case — citationVerified false', async () => {
    const mockSearch: CaselawSearchFn = vi.fn(async () => []);
    const sample = 'In Maneka Gandhi v. Union of India, personal liberty requires fair procedure.';
    const result = await applyRetrievalCitationVerify(sample, {
      searchFn: mockSearch,
      timeoutMs: 2000,
    });
    expect(result.citationVerified).toBe(false);
    expect(result.content).toContain(CITATION_VERIFY_HOLDING_MARKER);
  });
});
