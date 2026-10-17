/**
 * NV-BOOK-SME-WAVE-D-001 — O.43 appealability pack + procedural limitation + courtFee honesty.
 */
import { describe, it, expect } from 'vitest';
import {
  CPC_APPEALABLE_ORDERS_BOOK,
  hintAppealMaintainability,
} from '../../src/config/jrx-cpc-appealable-orders-pack.js';
import { resolveLimitationRule } from '../../src/services/jrx-legal-tools/jrx-nyayatimeline-service.js';
import { assembleDraftProfile } from '../../src/orchestration/jrx-draft-profile-assembler.js';

describe('CPC appealable orders pack (book O.43 R.1 index)', () => {
  it('indexes at least 15 appealable order types from the book', () => {
    expect(CPC_APPEALABLE_ORDERS_BOOK.length).toBeGreaterThanOrEqual(15);
  });

  it('recognizes a known slug and warns on unknown keys', () => {
    const ok = hintAppealMaintainability('injunction-o39');
    expect(ok.recognized).toBe(true);
    expect(ok.order?.cpcBasis).toMatch(/Order XXXIX/);

    const bad = hintAppealMaintainability('not-in-book');
    expect(bad.recognized).toBe(false);
  });
});

describe('procedural limitation — book §5 extensions', () => {
  it('resolves second appeal (90 days)', () => {
    const r = resolveLimitationRule('second-appeal', 'IN');
    expect(r.recognized).toBe(true);
    expect(r.limitationPeriodDays).toBe(90);
  });

  it('resolves criminal death-sentence appeal window (30 days)', () => {
    const r = resolveLimitationRule('criminal-appeal-death-sentence', 'IN');
    expect(r.recognized).toBe(true);
    expect(r.limitationPeriodDays).toBe(30);
    expect(r.legalBasis).toMatch(/Article 134/);
  });
});

describe('draftProfile — appeal maintainability + courtFee unavailableReason', () => {
  it('emits filing.appealMaintainability when appealableOrderKey supplied', () => {
    const { validationResults } = assembleDraftProfile({
      documentType: 'petition_application',
      filingContext: {
        nvTemplateKey: 'civil_miscellaneous_appeal',
        appealableOrderKey: 'injunction-o39',
        advisoryOnly: true,
      },
    });
    const row = validationResults.find((v) => v.id === 'filing.appealMaintainability');
    expect(row?.status).toBe('pass');
    expect(row?.detail).toMatch(/Order XXXIX/);
  });

  it('emits courtFee.unavailableReason for bail without suitValue', () => {
    const { draftProfile } = assembleDraftProfile({
      documentType: 'bail_application',
      filingContext: { feeScheduleKey: 'TN-2025', advisoryOnly: true },
    });
    expect(draftProfile.courtFee?.applicable).toBe(true);
    expect(draftProfile.courtFee?.unavailableReason).toMatch(/Per-state court-fee/);
  });
});
