import { describe, it, expect } from 'vitest';
import { formatCnrCaseContext, formatForumContext } from '../../src/services/jrx-legal-drafting-prompt.js';

describe('NV-CNR-ORCHESTRATE-MERGE-001', () => {
  it('formatCnrCaseContext parses JSON cnrFacts parameter', () => {
    const block = formatCnrCaseContext({
      cnrFacts: JSON.stringify({
        cnr: 'HCTS010044442023000123',
        petitioner: 'Ramesh Kumar',
        respondent: 'State of Telangana',
        courtName: 'High Court for Telangana',
        caseType: 'CRLP',
        sections: 'BNSS 482',
      }),
    });
    expect(block).toMatch(/CNR \/ MATTER FACTS/i);
    expect(block).toContain('HCTS010044442023000123');
    expect(block).toContain('Ramesh Kumar');
    expect(block).toContain('BNSS 482');
  });

  it('formatForumContext merges forum + CNR blocks', () => {
    const block = formatForumContext({
      highCourt: 'Telangana High Court',
      cnrFacts: {
        cnr: 'HCTS010044442023000123',
        petitioner: 'A',
        respondent: 'B',
      },
    });
    expect(block).toMatch(/FORUM CONTEXT/i);
    expect(block).toMatch(/CNR \/ MATTER FACTS/i);
  });
});
