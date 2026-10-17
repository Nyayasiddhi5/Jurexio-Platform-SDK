import { describe, it, expect } from 'vitest';
import {
  isNiActAuthorityQuery,
  buildNiActAuthorityFtsQuery,
} from '../../src/services/jrx-nys-knowledge-retriever.js';

describe('NV-NI-ACT-SC-PREFETCH-001', () => {
  const evalPrompt =
    'What are the leading Supreme Court authorities on the presumption under Section 139 of the Negotiable Instruments Act, and how has the burden of rebuttal been described? Cite the cases.';

  it('detects counsel-grade NI Act authority query', () => {
    expect(isNiActAuthorityQuery(evalPrompt)).toBe(true);
  });

  it('does not fire on bare statute FAQ', () => {
    expect(isNiActAuthorityQuery('What does Section 139 of the NI Act say?')).toBe(false);
  });

  it('buildNiActAuthorityFtsQuery strips tier/request poison words', () => {
    const q = buildNiActAuthorityFtsQuery();
    expect(q).not.toMatch(/leading|supreme court|authorities/i);
    expect(q).toMatch(/Negotiable Instruments/i);
    expect(q).toMatch(/139/);
  });
});
