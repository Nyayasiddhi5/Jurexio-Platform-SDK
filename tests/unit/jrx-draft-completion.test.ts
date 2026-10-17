import { describe, it, expect } from 'vitest';
import {
  analyzeDraftCompletion,
  analyzeDraftCompletionForDocument,
  applyDraftCompletionPolish,
  hasDraftClosingSections,
  hasDraftExitClosure,
} from '../../src/services/jrx-draft-completion.js';

describe('NV-DRAFT-COMPLETION-001', () => {
  it('detects abrupt mid-sentence ending', () => {
    const sample = [
      '1. The applicant submits that personal liberty is a fundamental right under Article 21 of the Constitution.',
      '2. The applicant undertakes to cooperate with the investigation and has deep roots in the community and',
    ].join('\n');
    const a = analyzeDraftCompletion(sample);
    expect(a.abruptEnding).toBe(true);
    expect(a.reviewRecommended).toBe(true);
  });

  it('recognizes complete prayer + verification', () => {
    const complete = [
      'PRAYER',
      'It is prayed that bail be granted.',
      'Place: Delhi',
      'Advocate for the Applicant',
      'VERIFICATION',
      'I verify that the contents are true.',
    ].join('\n');
    expect(hasDraftClosingSections(complete)).toBe(true);
    expect(analyzeDraftCompletion(complete).abruptEnding).toBe(false);
  });

  it('flags unresolved placeholders for reviewRecommended', () => {
    const sample = [
      'GROUNDS',
      '1. The Petitioner is aged [[PLACEHOLDER: petitioner_age]] years.',
      '2. Chamber at _______________.',
      'PRAYER',
      'It is prayed that relief be granted.',
      'Advocate for the Petitioner',
    ].join('\n');
    const a = analyzeDraftCompletion(sample);
    expect(a.unresolvedPlaceholders).toBeGreaterThan(0);
    expect(a.reviewRecommended).toBe(true);
  });

  it('recognizes legal_notice exit via structure markers not pleading prayer', () => {
    const notice = [
      'Subject: Statutory demand',
      '1. Facts stated.',
      '2. You are hereby called upon to pay within 15 days.',
      'Yours faithfully,',
      'Counsel for Client',
    ].join('\n');
    expect(hasDraftExitClosure(notice, 'legal_notice')).toBe(true);
    const typed = analyzeDraftCompletionForDocument(notice, 'legal_notice');
    expect(typed.complete).toBe(true);
    expect(typed.abruptEnding).toBe(false);
  });

  it('appends closure template when prayer missing', () => {
    const truncated = 'Grounds:\n1. Personal liberty is a fundamental right under Article 21.';
    const result = applyDraftCompletionPolish(truncated, {
      documentType: 'bail_application',
      appendClosure: true,
    });
    expect(result.appendedClosure).toBe(true);
    expect(result.content).toMatch(/PRAYER/i);
    expect(result.content).toMatch(/VERIFICATION/i);
  });
});
