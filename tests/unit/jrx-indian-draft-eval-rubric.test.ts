import { describe, expect, it } from 'vitest';
import { scoreIndianDraftRubric } from '../../src/services/jrx-indian-draft-eval-rubric.js';
import { auditNspDraftRouting } from '../../scripts/jrx-indian-draft-routing-audit.js';

describe('./jrx-indian-draft-eval-rubric', () => {
  it('scores a minimal bail skeleton above threshold', () => {
    const s = scoreIndianDraftRubric({
      documentType: 'bail_application',
      content: [
        'IN THE COURT OF SESSIONS, DELHI',
        'MOST RESPECTFULLY SHOWETH:',
        '1. The applicant apprehends arrest.',
        'PRAYER',
        'Release the applicant on bail on such terms as this Hon\'ble Court deems fit.',
        'VERIFICATION',
        'I verify the above.',
        'Advocate for the Applicant',
      ].join('\n\n'),
      parameters: { courtName: 'Sessions Court, Delhi' },
      prompt: 'anticipatory bail with facts',
    });
    expect(s.pct).toBeGreaterThanOrEqual(55);
    expect(s.completionDetail.hasPrayerOrRelief).toBe(true);
  });

  it('penalises chatbot opener', () => {
    const s = scoreIndianDraftRubric({
      documentType: 'legal_notice',
      content: "Certainly! Here's a draft notice.\n\nSubject: Demand\nPRAYER pay.\nYours faithfully",
      prompt: 'notice',
    });
    expect(s.voiceHits.length).toBeGreaterThan(0);
  });

  it('R-DRAFT-RUBRIC-TIER-001 scores medium-tier length without comprehensive char floor', () => {
    const intro = [
      'Subject: Statutory demand under Section 138 Negotiable Instruments Act',
      '1. Our client advanced a sum of Rs. 5,00,000 by cheque dated 01.01.2025 which was dishonoured.',
      '2. You are hereby called upon to pay the sum within 15 days from receipt of this notice.',
      '3. Failing which, our client shall initiate criminal proceedings without further reference.',
      'Demand: remit the amount within 15 days on or before the statutory deadline.',
      'Yours faithfully,',
      'Advocate for the Payee',
    ].join('\n\n');
    const mediumBody = `${intro}\n\n${'Further particulars and chronology. '.repeat(900)}`;
    const medium = scoreIndianDraftRubric({
      documentType: 'legal_notice',
      draftLength: 'medium',
      content: mediumBody,
      prompt: 'x'.repeat(250),
    });
    const comprehensive = scoreIndianDraftRubric({
      documentType: 'legal_notice',
      draftLength: 'comprehensive',
      content: mediumBody,
      prompt: 'x'.repeat(250),
    });
    expect(medium.length).toBeGreaterThan(comprehensive.length);
  });

  it('R-DRAFT-COMPLETION-DOCTYPE-001 scores notice closure without pleading PRAYER block', () => {
    const notice = [
      'Subject: Breach of contract — demand for performance',
      '1. Under the agreement dated 12 March 2024 you failed to deliver goods within 30 days.',
      '2. You are hereby called upon to cure the breach and pay damages within 15 days from today.',
      '3. Failing which, our client shall seek appropriate legal remedies without further notice.',
      'Demand: pay the sum of Rs. 2,00,000 within 15 days on or before the deadline.',
      'Yours faithfully,',
      'Counsel for the Claimant',
    ].join('\n\n');
    const s = scoreIndianDraftRubric({
      documentType: 'legal_notice',
      draftLength: 'medium',
      content: notice,
      prompt: 'x'.repeat(220),
    });
    expect(s.completionDetail.complete).toBe(true);
    expect(s.completion).toBeGreaterThanOrEqual(90);
  });
});

describe('./jrx-indian-draft-eval routing audit', () => {
  it('passes routing for bail SME case', () => {
    const row = auditNspDraftRouting({
      id: 'IN-BAIL-001',
      documentType: 'bail_application',
      label: 'test',
      parameters: { documentType: 'bail_application' },
      prompt: 'bail',
    });
    expect(row.pass).toBe(true);
    expect(row.counselComprehensive.registryTokens).toBeGreaterThan(row.fastMedium.registryTokens);
  });
});
