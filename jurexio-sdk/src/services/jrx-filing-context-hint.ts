/**
 * NV-FILING-CONTEXT-HINT-001 — parse the NSP FB-468 advisory `parameters.filingContext`.
 *
 * Reconciled wire shape (see
 * `documents/working/NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md` §D):
 * NSP sends `parameters.filingContext` as an ADVISORY hint block plus a
 * top-level `filingBookRowId` (NSP BFF). JRX parses + echoes it, and NEVER lets
 * it override JRX's own `structureMarkers` / `filingChecklist[]` — `advisoryOnly`
 * is honoured by treating any `mandatorySections` / `requiredAnnexures` that
 * still arrive as `expectedSections[]` / `expectedAnnexures[]` (reconciled in
 * `validationResults[]`), not as authority.
 */

export interface FilingContextHint {
  /** Fine-grained NSP filing-book key (echoed back as `draftProfile.templateKey`). */
  nvTemplateKey?: string;
  /** Manifest row provenance (echoed back as `draftProfile.filingBookRowId`). */
  filingBookRowId?: string;
  filingBookVersion?: string;
  /** Advisory only — the NYS corpus is the legal-basis authority. */
  legalBasisHint?: string;
  limitationRuleKey?: string;
  feeScheduleKey?: string;
  noticeComplianceDays?: number;
  /**
   * NV-DRAFT-PROFILE-LIMITATION-001 — advisory cause-of-action key so JRX can
   * resolve the applicable limitation RULE (e.g. `cheque-bounce`, `contract-breach`,
   * `money-recovery`). Advisory: JRX maps it to the Limitation Act schedule.
   */
  causeOfActionKey?: string;
  /** ISO date the cause of action accrued — enables a DATED limitation computation. */
  causeAccrualDate?: string;
  /**
   * NV-DRAFT-PROFILE-COURTFEE-001 — suit/claim value (INR) for the ad-valorem
   * court-fee computation. Advisory; State schedules vary.
   */
  suitValue?: number;
  /**
   * NV-CPC-APPEALABLE-ORDERS-001 — slug from {@link CPC_APPEALABLE_ORDERS_BOOK}
   * when drafting a CMA / appeal against an interlocutory order (O.43).
   */
  appealableOrderKey?: string;
  /** NSP render hint (JRX ignores). */
  exportProfile?: string;
  /**
   * Transitional: sections NSP still sends as `mandatorySections`. Treated as
   * advisory expectations reconciled against JRX's own registry, never authority.
   */
  expectedSections?: string[];
  /** Transitional: annexures NSP still sends as `requiredAnnexures` (advisory). */
  expectedAnnexures?: string[];
  /** Always advisory. Defaults to true unless NSP explicitly sets `advisoryOnly:false`. */
  advisoryOnly: boolean;
}

function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => asString(x)).filter((x): x is string => !!x);
  return out.length > 0 ? out : undefined;
}

function asPositiveInt(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

/**
 * Parse the advisory filing-context hint from an orchestrate body.
 *
 * Returns `undefined` when there is nothing filing-related to echo, so callers
 * can cheaply skip assembly for non-filing drafts.
 */
export function parseFilingContextHint(
  body: Record<string, unknown> | undefined | null,
): FilingContextHint | undefined {
  if (!body || typeof body !== 'object') return undefined;

  const params = body.parameters && typeof body.parameters === 'object'
    ? (body.parameters as Record<string, unknown>)
    : {};
  const fc = params.filingContext && typeof params.filingContext === 'object'
    ? (params.filingContext as Record<string, unknown>)
    : {};

  // Top-level `filingBookRowId` (NSP BFF) is a fallback for the nested value.
  const filingBookRowId =
    asString(fc.filingBookRowId)
    ?? asString(body.filingBookRowId)
    ?? asString(params.filingBookRowId);

  // Transitional authority fields — accepted only as advisory expectations.
  const expectedSections =
    asStringArray(fc.expectedSections)
    ?? asStringArray(fc.mandatorySections)
    ?? asStringArray(params.mandatorySections)
    ?? asStringArray(body.mandatorySections);
  const expectedAnnexures =
    asStringArray(fc.expectedAnnexures)
    ?? asStringArray(fc.requiredAnnexures)
    ?? asStringArray(params.requiredAnnexures)
    ?? asStringArray(body.requiredAnnexures);

  const hint: FilingContextHint = {
    nvTemplateKey: asString(fc.nvTemplateKey) ?? asString(params.nvTemplateKey),
    filingBookRowId,
    filingBookVersion: asString(fc.filingBookVersion),
    legalBasisHint: asString(fc.legalBasisHint) ?? asString(fc.legalBasis),
    limitationRuleKey: asString(fc.limitationRuleKey) ?? asString(fc.limitationRuleHint),
    feeScheduleKey: asString(fc.feeScheduleKey),
    noticeComplianceDays: asPositiveInt(fc.noticeComplianceDays),
    causeOfActionKey: asString(fc.causeOfActionKey) ?? asString(fc.causeOfAction),
    causeAccrualDate: asString(fc.causeAccrualDate) ?? asString(fc.accrualDate),
    suitValue: asPositiveInt(fc.suitValue) ?? asPositiveInt(params.suitValue),
    appealableOrderKey: asString(fc.appealableOrderKey) ?? asString(fc.appealableOrder),
    exportProfile: asString(fc.exportProfile),
    expectedSections,
    expectedAnnexures,
    // Advisory by default; only an explicit `advisoryOnly:false` flips it, and
    // even then JRX keeps authority (the flag is echoed, not obeyed as override).
    advisoryOnly: fc.advisoryOnly !== false,
  };

  const hasSignal =
    hint.nvTemplateKey
    || hint.filingBookRowId
    || hint.filingBookVersion
    || hint.legalBasisHint
    || hint.limitationRuleKey
    || hint.feeScheduleKey
    || hint.noticeComplianceDays != null
    || hint.causeOfActionKey
    || hint.causeAccrualDate
    || hint.suitValue != null
    || hint.appealableOrderKey
    || hint.exportProfile
    || hint.expectedSections
    || hint.expectedAnnexures;

  return hasSignal ? hint : undefined;
}
