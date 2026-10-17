/**
 * NV-COURT-FEE-CALC-001 — pure, dependency-free ad-valorem court-fee computation
 * (Court Fees Act 1870 tiered slab). Single SSoT (NV-NO-DUPLICATE-001) consumed by:
 *   - the Phase-4 sandbox `court-fee-calc` tool (`jrx-phase4-services.ts`), and
 *   - the NSP `draftProfile.courtFee` assembler (`jrx-draft-profile-assembler.ts`).
 *
 * Kept in its own module with NO heavy imports (no db / docx) so the draftProfile
 * assembler — exercised by fast unit tests — does not transitively pull the
 * Phase-4 service graph.
 *
 * Honesty: this is the generic Central Act slab; State amendments (Tamil Nadu,
 * Maharashtra, Karnataka Court Fees & Suits Valuation Acts, etc.) vary — every
 * consumer MUST surface the "verify with the court / State schedule" caveat.
 */
export interface CourtFeeComputation {
  suitValue: number;
  courtFee: number;
  tier: string;
  additionalFees: { processFee: number; noticeFee: number };
  total: number;
  currency: 'INR';
  legalBasis: string;
}

export function computeCourtFee(suitValueInput: number): CourtFeeComputation {
  const suitValue =
    Number.isFinite(suitValueInput) && suitValueInput > 0 ? suitValueInput : 500000;
  let courtFee: number;
  let tier: string;
  if (suitValue <= 500000) {
    courtFee = Math.round(suitValue * 0.075);
    tier = 'Tier 1 (up to ₹5L): 7.5%';
  } else if (suitValue <= 2000000) {
    courtFee = Math.round(37500 + (suitValue - 500000) * 0.06);
    tier = 'Tier 2 (₹5L–₹20L): 6%';
  } else {
    courtFee = Math.round(37500 + 90000 + (suitValue - 2000000) * 0.045);
    tier = 'Tier 3 (above ₹20L): 4.5%';
  }
  const processFee = 300;
  const noticeFee = 100;
  return {
    suitValue,
    courtFee,
    tier,
    additionalFees: { processFee, noticeFee },
    total: courtFee + processFee + noticeFee,
    currency: 'INR',
    legalBasis: 'Court Fees Act 1870',
  };
}
