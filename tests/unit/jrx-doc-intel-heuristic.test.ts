import { describe, expect, it } from 'vitest';
import { heuristicDocumentIntelligence } from '../../src/services/sdk/jrx-doc-intel-heuristic.js';

describe('heuristicDocumentIntelligence', () => {
  it('extracts parties, obligations, risks, and deadlines from India NDA text', () => {
    const text = `INDEMNITY AND NON-DISCLOSURE AGREEMENT
This Agreement is entered into between Acme Technologies Private Limited and Beta Legal LLP.
Receiving Party shall keep Confidential Information secret for three (3) years.
Provider indemnifies Client against losses arising from gross negligence.
Governing law: India. Term twenty-four (24) months.`;
    const out = heuristicDocumentIntelligence(text);
    expect(out.entities.entities.length).toBeGreaterThan(0);
    expect(out.entities.obligations.length).toBeGreaterThan(0);
    expect(out.entities.risks.length).toBeGreaterThan(0);
    expect(out.entities.deadlines.length).toBeGreaterThan(0);
  });
});
