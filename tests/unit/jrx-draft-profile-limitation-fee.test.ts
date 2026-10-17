/**
 * NV-DRAFT-PROFILE-LIMITATION-001 / -COURTFEE-001 / NV-DRAFT-FORMATTED-BLOCKS-001
 *
 * The NSP AI wire: draftProfile.limitation, draftProfile.courtFee and
 * formattedBlocks[] emitted from LIVE NYV SSoT (nyayatimeline limitation schedule
 * + shared court-fee slab), with honest applicability flags (never invented).
 */
import { describe, it, expect } from 'vitest';
import { assembleDraftProfile } from '../../src/orchestration/jrx-draft-profile-assembler.js';
import {
  resolveLimitationRule,
  listLimitationCauses,
} from '../../src/services/nyaya-tools/jrx-nyayatimeline-service.js';
import { computeCourtFee } from '../../src/services/jrx-court-fee.js';

describe('nyayatimeline — limitation rule resolver (date-free)', () => {
  it('resolves a book-grounded cheque-bounce limitation (NI Act)', () => {
    const r = resolveLimitationRule('cheque-bounce', 'IN');
    expect(r.recognized).toBe(true);
    expect(r.limitationPeriod).toBe('1 year');
    expect(r.legalBasis).toMatch(/NI Act/);
  });

  it('exposes the expanded civil causes (money-recovery, partition, execution)', () => {
    const causes = listLimitationCauses('IN');
    expect(causes).toEqual(expect.arrayContaining([
      'money-recovery', 'partition', 'execution-of-decree', 'rent-arrears', 'eviction-suit',
    ]));
  });

  it('returns recognized:false for an unknown cause — never invents a period', () => {
    const r = resolveLimitationRule('teleport-dispute', 'IN');
    expect(r.recognized).toBe(false);
    expect(r.limitationPeriodYears).toBe(-1);
  });

  it('resolves procedural caveat window (90 days)', () => {
    const r = resolveLimitationRule('caveat', 'IN');
    expect(r.recognized).toBe(true);
    expect(r.kind).toBe('procedural');
    expect(r.limitationPeriodDays).toBe(90);
    expect(r.limitationPeriod).toBe('90 days');
  });
});

describe('court-fee — shared pure slab (Court Fees Act 1870)', () => {
  it('tier 1 (<=5L) is 7.5% ad valorem', () => {
    const fee = computeCourtFee(400000);
    expect(fee.courtFee).toBe(30000);
    expect(fee.tier).toMatch(/Tier 1/);
    expect(fee.total).toBe(30000 + 300 + 100);
  });

  it('tier 3 (>20L) applies the 4.5% marginal slab', () => {
    const fee = computeCourtFee(3000000);
    // 37500 + 90000 + (1,000,000 * 0.045) = 172500
    expect(fee.courtFee).toBe(172500);
    expect(fee.tier).toMatch(/Tier 3/);
  });
});

describe('draftProfile — limitation wire', () => {
  it('emits an applicable limitation for an NI-138 notice via template-key map', () => {
    const { draftProfile } = assembleDraftProfile({
      documentType: 'legal_notice',
      filingContext: { nvTemplateKey: 'ni_138_statutory_notice', advisoryOnly: true },
    });
    expect(draftProfile.limitation?.applicable).toBe(true);
    expect(draftProfile.limitation?.causeOfAction).toBe('cheque-bounce');
    expect(draftProfile.limitation?.limitationPeriod).toBe('1 year');
    expect(draftProfile.limitation?.source).toBe('template-key-map');
    expect(draftProfile.limitation?.computed).toBeUndefined(); // no accrual date
  });

  it('computes a dated expiry + expiry warning when accrual date supplied', () => {
    const { draftProfile, validationResults } = assembleDraftProfile({
      documentType: 'legal_notice',
      filingContext: {
        causeOfActionKey: 'contract-breach',
        causeAccrualDate: '2019-01-01', // > 3y ago ⇒ time-barred
        advisoryOnly: true,
      },
    });
    expect(draftProfile.limitation?.applicable).toBe(true);
    expect(draftProfile.limitation?.source).toBe('explicit-hint');
    expect(draftProfile.limitation?.computed?.isExpired).toBe(true);
    const lim = validationResults.find((v) => v.id === 'filing.limitation');
    expect(lim?.status).toBe('fail');
  });

  it('is applicable:false with an honest note when no cause resolves', () => {
    const { draftProfile } = assembleDraftProfile({ documentType: 'writ_petition' });
    expect(draftProfile.limitation?.applicable).toBe(false);
    expect(draftProfile.limitation?.source).toBe('unresolved');
    expect(draftProfile.limitation?.note).toMatch(/never assumes/i);
  });

  it('emits procedural limitation for caveat via template-key map', () => {
    const { draftProfile } = assembleDraftProfile({
      documentType: 'caveat',
      filingContext: { nvTemplateKey: 'civil_caveat', advisoryOnly: true },
    });
    expect(draftProfile.limitation?.applicable).toBe(true);
    expect(draftProfile.limitation?.limitationPeriod).toBe('90 days');
    expect(draftProfile.limitation?.legalBasis).toMatch(/Order XLII/i);
  });
});

describe('draftProfile — court-fee wire', () => {
  it('computes ad-valorem fee for a plaint when suitValue supplied', () => {
    const { draftProfile } = assembleDraftProfile({
      documentType: 'civil_suit_plaint',
      filingContext: { suitValue: 1000000, advisoryOnly: true },
    });
    expect(draftProfile.courtFee?.applicable).toBe(true);
    expect(draftProfile.courtFee?.source).toBe('court-fee-calc');
    expect(draftProfile.courtFee?.computed?.total).toBe(computeCourtFee(1000000).total);
  });

  it('emits a schedule reference for a plaint without a suit value', () => {
    const { draftProfile } = assembleDraftProfile({ documentType: 'civil_suit_plaint' });
    expect(draftProfile.courtFee?.applicable).toBe(true);
    expect(draftProfile.courtFee?.source).toBe('schedule-reference');
    expect(draftProfile.courtFee?.computed).toBeUndefined();
  });

  it('is not-applicable for a legal notice (no court fee at notice stage)', () => {
    const { draftProfile } = assembleDraftProfile({ documentType: 'legal_notice' });
    expect(draftProfile.courtFee?.applicable).toBe(false);
    expect(draftProfile.courtFee?.source).toBe('not-applicable');
  });
});

describe('draftProfile — formattedBlocks', () => {
  it('produces enclosure + limitation + service blocks for an NI-138 notice', () => {
    const { draftProfile } = assembleDraftProfile({
      documentType: 'legal_notice',
      filingContext: { nvTemplateKey: 'ni_138_statutory_notice', advisoryOnly: true },
    });
    const blocks = draftProfile.formattedBlocks ?? [];
    const kinds = blocks.map((b) => b.kind);
    expect(kinds).toContain('enclosure-list');
    expect(kinds).toContain('limitation-clause');
    expect(kinds).toContain('service-modes');
    const enclosure = blocks.find((b) => b.kind === 'enclosure-list');
    expect(enclosure?.text).toMatch(/dishonour/i);
  });

  it('produces a court-fee block with the computed amount for a valued plaint', () => {
    const { draftProfile } = assembleDraftProfile({
      documentType: 'civil_suit_plaint',
      filingContext: { suitValue: 1000000, advisoryOnly: true },
    });
    const feeBlock = (draftProfile.formattedBlocks ?? []).find((b) => b.kind === 'court-fee-note');
    expect(feeBlock).toBeTruthy();
    expect(feeBlock?.text).toMatch(/Estimated court fee/);
  });
});
