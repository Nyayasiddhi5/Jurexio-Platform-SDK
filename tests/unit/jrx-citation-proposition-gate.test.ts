import { describe, it, expect } from 'vitest';
import {
  analyzeCitationPropositionIssues,
  applyCitationPropositionSanitize,
  hasCitationPropositionIssues,
} from '../../src/services/jrx-citation-proposition-gate.js';

describe('NV-CITATION-PROPOSITION-GATE-001', () => {
  it('flags date-only Supreme Court citation', () => {
    const sample = 'The Supreme Court in its judgment dated 15.01.2026 explained that arrest is discretionary.';
    expect(hasCitationPropositionIssues(sample)).toBe(true);
    const issues = analyzeCitationPropositionIssues(sample);
    expect(issues.some((i) => i.kind === 'date_only_citation')).toBe(true);
  });

  it('flags verify citation placeholders from lawyer sample', () => {
    const sample = 'See Ajay Malik v. State of Uttarakhand [[PLACEHOLDER: verify citation before filing]].';
    const issues = analyzeCitationPropositionIssues(sample);
    expect(issues.some((i) => i.kind === 'verify_placeholder')).toBe(true);
  });

  it('flags Bhajan Lal stretch pairing', () => {
    const sample = 'In Ajay Malik (supra) the Court applied Bhajan Lal categories for omnibus FIR quashing.';
    expect(analyzeCitationPropositionIssues(sample).some((i) => i.kind === 'stretch_risk')).toBe(true);
  });

  it('sanitizes bare date citation with VERIFY marker', () => {
    const sample = 'Refer to the judgment dated 25.03.2025 on SC/ST ingredients.';
    const result = applyCitationPropositionSanitize(sample);
    expect(result.sanitized).toBe(true);
    expect(result.content).toMatch(/VERIFY/i);
  });
});
