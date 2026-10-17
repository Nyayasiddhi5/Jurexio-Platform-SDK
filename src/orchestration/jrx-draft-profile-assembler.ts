/**
 * NV-DRAFT-PROFILE-ASSEMBLER-001 — assemble the NSP `draftProfile` +
 * `validationResults[]` outbound surface from LIVE JRX SSoT.
 *
 * One assembler, no second scoring pass (NV-NO-DUPLICATE-001): it composes the
 * already-computed `structureMarkers`, the filing-checklist registry, and the
 * echoed advisory `filingContext`. Limitation (`jrx-nyayatimeline-service` schedule)
 * and court-fee (shared `jrx-court-fee` slab) are now emitted as advisory profiles
 * with honest applicability flags — resolved from LIVE JRX SSoT, never invented
 * (NV-DRAFT-PROFILE-LIMITATION-001 / -COURTFEE-001). `formattedBlocks[]` are the
 * deterministic ready-to-insert enclosure / limitation / fee / service texts.
 *
 * Contract: `documents/working/NSP-LEGAL-INTELLIGENCE-SDK-SURFACE-2026-08.md` §D
 * (outbound wire) + §4 (DraftProfile shape) + §7 (validation layers).
 */
import type {
  DraftDocumentType,
  DraftDocumentTypeResolution,
} from '../config/jrx-draft-length-registry.js';
import {
  FILING_BOOK_MANIFEST_VERSION,
  resolveFilingChecklist,
  type FilingChecklistItem,
} from '../config/jrx-filing-checklist-registry.js';
import type { DraftStructureMarkers } from '../services/jrx-draft-completion.js';
import { isNoticeDocumentType } from '../services/jrx-draft-completion.js';
import type { FilingContextHint } from '../services/jrx-filing-context-hint.js';
import { NV_TEMPLATE_KEY_CROSSWALK } from '../config/jrx-filing-book-crosswalk.js';
import { hintAppealMaintainability } from '../config/jrx-cpc-appealable-orders-pack.js';
import { computeCourtFee } from '../services/jrx-court-fee.js';
import { resolveLimitationRule } from '../services/jrx-legal-tools/jrx-nyayatimeline-service.js';

export type DraftValidationStatus = 'pass' | 'warn' | 'fail' | 'na';

export interface DraftValidationResult {
  id: string;
  label: string;
  status: DraftValidationStatus;
  detail?: string;
  /** Which JRX layer produced this item (structureMarkers | filingChecklist | filingContext). */
  source: string;
}

export type DraftServiceMode = 'personal' | 'rpad' | 'affixation' | 'email' | 'publication';

/**
 * NV-DRAFT-PROFILE-LIMITATION-001 — advisory limitation RULE for the draft.
 *
 * Emitted only when JRX can resolve a cause of action (from an explicit
 * `filingContext.causeOfActionKey` / `limitationRuleKey`, or the nvTemplateKey /
 * doctype map). The dated `computed` block appears only when an accrual date was
 * supplied. Never invents a period — `applicable:false` when unresolved.
 */
export interface DraftLimitationProfile {
  applicable: boolean;
  causeOfAction?: string;
  /** Human period, e.g. "3 years" or "No limitation period applies". */
  limitationPeriod?: string;
  legalBasis?: string;
  jurisdiction: 'IN';
  /** Present only when `causeAccrualDate` was supplied — a dated expiry computation. */
  computed?: {
    accrualDate: string;
    expiryDate: string;
    daysRemaining: number;
    isExpired: boolean;
    warnings: string[];
  };
  note: string;
  source: 'explicit-hint' | 'template-key-map' | 'doctype-map' | 'unresolved';
}

/**
 * NV-DRAFT-PROFILE-COURTFEE-001 — advisory court-fee for the draft.
 *
 * `computed` (ad-valorem slab) appears only for value-driven instruments when a
 * `suitValue` was supplied; otherwise a schedule reference is emitted. Court fee
 * is `applicable:false` for notices / affidavits / opinions.
 */
export interface DraftCourtFeeProfile {
  applicable: boolean;
  scheduleBasis: string;
  computed?: {
    suitValue: number;
    courtFee: number;
    tier: string;
    additionalFees: { processFee: number; noticeFee: number };
    total: number;
    currency: 'INR';
  };
  note: string;
  source: 'court-fee-calc' | 'schedule-reference' | 'not-applicable';
  /**
   * Present when a fee may apply but JRX cannot compute a State-specific amount
   * (per-state court-fee tables not ingested — NV-BOOK-SME-WAVE-D-001).
   */
  unavailableReason?: string;
}

/** NV-DRAFT-FORMATTED-BLOCKS-001 — deterministic, ready-to-insert draft text blocks. */
export interface DraftFormattedBlock {
  id: string;
  kind: 'enclosure-list' | 'limitation-clause' | 'court-fee-note' | 'service-modes' | 'ni-138-statutory';
  title: string;
  text: string;
}

const NI138_STATUTORY_NOTICE_BLOCK = `STATUTORY NOTICE UNDER SECTION 138 — NEGOTIABLE INSTRUMENTS ACT, 1881 (deterministic skeleton):
1. Subject line: demand under Section 138 NI Act for dishonour of Cheque No. [[PLACEHOLDER: cheque number]] dated [[PLACEHOLDER: cheque date]] for Rs. [[PLACEHOLDER: amount]].
2. Facts: legally enforceable debt/liability; cheque drawn on [[PLACEHOLDER: bank and branch]]; presentation date [[PLACEHOLDER: presentation date]]; return memo dated [[PLACEHOLDER: return memo date]] with endorsement [[PLACEHOLDER: dishonour reason]].
3. Statutory demand: pay Rs. [[PLACEHOLDER: amount]] within FIFTEEN (15) DAYS of receipt of this notice (proviso to Section 138).
4. Consequence: failure to pay within 15 days — criminal complaint under Section 138 NI Act and civil recovery, at drawer's risk as to costs.
5. Service: retain office copy; dispatch by registered post A.D. / speed post / permitted electronic mode with proof.
Advisory timelines: notice within 30 days of dishonour memo; complaint within one month after expiry of 15-day cure period (Section 142) — verify dates on facts.`;

const NI138_PROMPT_RE =
  /\b(section\s*138|s\.?\s*138|negotiable instruments act|ni\s*act|cheque\s+dishonou?r|dishonou?red\s+cheque)\b/i;

/** R-DRAFT-NSP-QUALITY P1-b — inject into counsel user prompt for NI §138 notices. */
export function resolveNi138StatutoryNoticeContext(input: {
  documentType: DraftDocumentType;
  nvTemplateKey?: string;
  prompt?: string;
}): { active: boolean; promptInjection: string; blockText: string } {
  const templateHit = input.nvTemplateKey === 'ni_138_statutory_notice';
  const docAndPrompt =
    input.documentType === 'legal_notice'
    && NI138_PROMPT_RE.test(String(input.prompt || ''));
  const active = templateHit || docAndPrompt;
  return {
    active,
    promptInjection: active
      ? `MANDATORY NI ACT §138 BLOCKS (include all; use [[PLACEHOLDER: …]] for unknown facts):\n${NI138_STATUTORY_NOTICE_BLOCK}`
      : '',
    blockText: NI138_STATUTORY_NOTICE_BLOCK,
  };
}

/**
 * NV-DRAFT-INTENT-PROMPT-001 — how JRX resolved the drafting intent when NSP
 * omitted `documentType` / `filingContext`. Surfaced so NSP can show a "JRX
 * inferred this" badge and offer a correction affordance.
 */
export interface DraftIntentResolutionEcho {
  docType: DraftDocumentType;
  /** Fine-grained FB-468 key JRX inferred (drives the enclosure checklist). */
  nvTemplateKey?: string;
  confidence: number;
  rationale: string[];
  /** Provenance of the resolution (explicit wire, prompt heuristic, fallback). */
  source: DraftDocumentTypeResolution['source'];
  wasInferred: boolean;
  /** Truncated partner wire value when an unknown explicit type was substituted. */
  partnerDocumentTypeRaw?: string;
}

export interface DraftProfile {
  documentType: DraftDocumentType;
  /** Echoed NSP fine-grained `nvTemplateKey` (provenance, not authority). */
  templateKey?: string;
  /** Echoed NSP filing-book row provenance. */
  filingBookRowId?: string;
  /** NSP manifest version, or the JRX manifest stamp when NSP omits it. */
  filingBookVersion: string;
  /** JRX filing-book manifest stamp the checklist rows were seeded from. */
  manifestVersion: string;
  filingChecklist: FilingChecklistItem[];
  /** Only for notices/summons — the service modes counsel may use. */
  serviceModes?: DraftServiceMode[];
  /** NV-DRAFT-PROFILE-LIMITATION-001 — advisory limitation rule (+ dated computation). */
  limitation?: DraftLimitationProfile;
  /** NV-DRAFT-PROFILE-COURTFEE-001 — advisory court-fee (ad-valorem slab or schedule ref). */
  courtFee?: DraftCourtFeeProfile;
  /** NV-DRAFT-FORMATTED-BLOCKS-001 — deterministic ready-to-insert text blocks. */
  formattedBlocks?: DraftFormattedBlock[];
  /**
   * Advisory hints echoed back so NSP can reconcile its local fallback. Present
   * only when NSP supplied them; JRX treats them as advisory, never authority.
   */
  advisory?: {
    nvTemplateKey?: string;
    legalBasisHint?: string;
    limitationRuleKey?: string;
    feeScheduleKey?: string;
    noticeComplianceDays?: number;
    exportProfile?: string;
    expectedSections?: string[];
    expectedAnnexures?: string[];
    advisoryOnly: boolean;
    note: string;
  };
  /**
   * NV-DRAFT-INTENT-PROMPT-001 — present when JRX had to resolve the drafting
   * intent itself (prompt heuristic or fallback), rather than take an explicit
   * partner wire value. Omitted for clean explicit-type requests.
   */
  intentResolution?: DraftIntentResolutionEcho;
  /**
   * NV-DRAFT-INTENT-PROMPT-001 — why JRX emitted a DEFAULT / inferred envelope
   * instead of an NSP-directed one (no filingContext, unrecognised type, or
   * low-confidence coarse fallback). Absent on the clean, fully-specified path.
   */
  fallbackReason?: string;
}

const NOTICE_SERVICE_MODES: DraftServiceMode[] = ['personal', 'rpad', 'affixation'];

/**
 * NV-DRAFT-PROFILE-LIMITATION-001 — fine-grained nvTemplateKey → limitation cause
 * of action (Limitation Act schedule key resolved by the nyayatimeline service).
 * Only keys with a single, defensible cause are mapped — never guessed.
 */
const NV_TEMPLATE_KEY_LIMITATION_CAUSE: Readonly<Record<string, string>> = {
  ni_138_statutory_notice: 'cheque-bounce',
  breach_notice: 'contract-breach',
  termination_notice: 'contract-breach',
  consumer_pre_litigation_notice: 'consumer-complaint',
  money_recovery_notice: 'money-recovery',
  eviction_notice: 'eviction-suit',
  civil_section_47_application: 'execution-of-decree',
  civil_caveat: 'caveat',
  civil_cross_objection: 'cross-objection',
  civil_revision_petition: 'civil-revision',
  civil_first_appeal: 'first-appeal-high-court',
  memorandum_of_appeal: 'first-appeal-high-court',
  first_appeal_memo: 'first-appeal-district',
  second_appeal_memo: 'second-appeal',
  civil_miscellaneous_appeal: 'first-appeal-district',
  civil_amend_pleading: 'amend-pleading',
  summary_suit_leave_to_defend: 'summary-leave-to-defend',
  civil_setaside_exparte_decree: 'restoration-application',
};

/** Coarse doctype → limitation cause, only where a single cause is defensible. */
const DOCTYPE_LIMITATION_CAUSE: Partial<Record<DraftDocumentType, string>> = {
  execution_petition: 'execution-of-decree',
  review_petition: 'review-petition',
  revision_petition: 'civil-revision',
  cross_objection: 'cross-objection',
  caveat: 'caveat',
  petition_application: 'first-appeal-district',
};

/** Value-driven instruments where an ad-valorem court fee is computed from suit value. */
const AD_VALOREM_FEE_TYPES: ReadonlySet<DraftDocumentType> = new Set<DraftDocumentType>([
  'civil_suit_plaint',
  'petition_application',
  'execution_petition',
]);

/** Instruments that bear SOME court fee at filing (ad-valorem or fixed/nominal). */
const COURT_FEE_BEARING_TYPES: ReadonlySet<DraftDocumentType> = new Set<DraftDocumentType>([
  'civil_suit_plaint',
  'petition_application',
  'writ_petition',
  'interlocutory_application',
  'criminal_petition',
  'bail_application',
  'divorce_petition',
  'review_petition',
  'execution_petition',
  'revision_petition',
  'cross_objection',
  'caveat',
]);

/** Resolve the applicable limitation rule for a draft (date-free unless accrual supplied). */
function buildLimitationProfile(
  documentType: DraftDocumentType,
  effectiveNvTemplateKey: string | undefined,
  filingContext?: FilingContextHint,
): DraftLimitationProfile {
  const explicit = filingContext?.causeOfActionKey ?? filingContext?.limitationRuleKey;
  const normalize = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, '-');
  let cause: string | undefined;
  let source: DraftLimitationProfile['source'] = 'unresolved';

  if (explicit) {
    cause = normalize(explicit);
    source = 'explicit-hint';
  } else if (effectiveNvTemplateKey && NV_TEMPLATE_KEY_LIMITATION_CAUSE[effectiveNvTemplateKey]) {
    cause = NV_TEMPLATE_KEY_LIMITATION_CAUSE[effectiveNvTemplateKey];
    source = 'template-key-map';
  } else if (DOCTYPE_LIMITATION_CAUSE[documentType]) {
    cause = DOCTYPE_LIMITATION_CAUSE[documentType];
    source = 'doctype-map';
  }

  if (!cause) {
    return {
      applicable: false,
      jurisdiction: 'IN',
      note:
        'No single limitation rule could be resolved for this draft — supply '
        + '`filingContext.causeOfActionKey` (e.g. "contract-breach", "cheque-bounce") '
        + 'for an advisory limitation statement. JRX never assumes a period.',
      source: 'unresolved',
    };
  }

  const rule = resolveLimitationRule(cause, 'IN');
  if (!rule.recognized) {
    return {
      applicable: false,
      causeOfAction: cause,
      jurisdiction: 'IN',
      note: `Cause of action "${cause}" is not in the limitation schedule — confirm the applicable Article with counsel.`,
      source,
    };
  }

  const profile: DraftLimitationProfile = {
    applicable: true,
    causeOfAction: cause,
    limitationPeriod: rule.limitationPeriod,
    legalBasis: rule.legalBasis,
    jurisdiction: 'IN',
    note:
      rule.limitationPeriodYears === 0 && !rule.limitationPeriodDays
        ? 'No limitation period applies. Advisory only — confirm before filing.'
        : rule.kind === 'procedural'
          ? 'Advisory procedural limitation window (days). Supply `filingContext.causeAccrualDate` as the triggering event date (e.g. date of decree/service); verify condonation u/s 5 and court-specific practice.'
          : 'Advisory limitation rule. Supply `filingContext.causeAccrualDate` to compute the exact expiry; verify against condonation/exclusion facts before filing.',
    source,
  };

  // Dated computation only when an accrual date is supplied AND a period exists.
  const accrual = filingContext?.causeAccrualDate;
  if (accrual && rule.limitationPeriodDays && rule.limitationPeriodDays > 0) {
    const accrualDate = new Date(accrual);
    if (!Number.isNaN(accrualDate.getTime())) {
      const expiry = new Date(accrualDate);
      expiry.setDate(expiry.getDate() + rule.limitationPeriodDays);
      const daysRemaining = Math.ceil((expiry.getTime() - Date.now()) / 86_400_000);
      const isExpired = daysRemaining < 0;
      const warnings: string[] = [];
      if (isExpired) warnings.push('PROCEDURAL WINDOW HAS EXPIRED — filing may be time-barred (consider condonation under s.5 Limitation Act).');
      else if (daysRemaining <= 7) warnings.push(`URGENT: only ${daysRemaining} day(s) remaining in the procedural window — file immediately.`);
      else if (daysRemaining <= 21) warnings.push(`${daysRemaining} day(s) remaining — plan filing promptly.`);
      profile.computed = {
        accrualDate: accrualDate.toISOString().slice(0, 10),
        expiryDate: expiry.toISOString().slice(0, 10),
        daysRemaining: Math.max(daysRemaining, isExpired ? daysRemaining : 0),
        isExpired,
        warnings,
      };
    }
  } else if (accrual && rule.limitationPeriodYears > 0) {
    const accrualDate = new Date(accrual);
    if (!Number.isNaN(accrualDate.getTime())) {
      const expiry = new Date(accrualDate);
      expiry.setFullYear(expiry.getFullYear() + rule.limitationPeriodYears);
      const daysRemaining = Math.ceil((expiry.getTime() - Date.now()) / 86_400_000);
      const isExpired = daysRemaining < 0;
      const warnings: string[] = [];
      if (isExpired) warnings.push('LIMITATION PERIOD HAS EXPIRED — filing may be time-barred (consider condonation under s.5 Limitation Act).');
      else if (daysRemaining <= 30) warnings.push(`URGENT: only ${daysRemaining} day(s) remaining — file immediately.`);
      else if (daysRemaining <= 90) warnings.push(`${daysRemaining} day(s) remaining — plan filing promptly.`);
      profile.computed = {
        accrualDate: accrualDate.toISOString().slice(0, 10),
        expiryDate: expiry.toISOString().slice(0, 10),
        daysRemaining: Math.max(daysRemaining, isExpired ? daysRemaining : 0),
        isExpired,
        warnings,
      };
    }
  }

  return profile;
}

/** Resolve the advisory court-fee profile for a draft. */
function buildCourtFeeProfile(
  documentType: DraftDocumentType,
  filingContext?: FilingContextHint,
): DraftCourtFeeProfile {
  if (!COURT_FEE_BEARING_TYPES.has(documentType)) {
    return {
      applicable: false,
      scheduleBasis: 'Court Fees Act 1870 (State schedule may vary)',
      note: 'No ad-valorem court fee at filing for this instrument (e.g. legal notice / affidavit). Notarial / stamp charges may still apply.',
      source: 'not-applicable',
    };
  }

  const suitValue = filingContext?.suitValue;
  if (AD_VALOREM_FEE_TYPES.has(documentType) && suitValue && suitValue > 0) {
    const fee = computeCourtFee(suitValue);
    return {
      applicable: true,
      scheduleBasis: fee.legalBasis + ' (generic Central Act slab — State schedule may vary)',
      computed: {
        suitValue: fee.suitValue,
        courtFee: fee.courtFee,
        tier: fee.tier,
        additionalFees: fee.additionalFees,
        total: fee.total,
        currency: fee.currency,
      },
      note: 'Ad-valorem estimate on the generic Court Fees Act slab. Verify against the applicable State Court Fees / Suits Valuation Act and the court registry.',
      source: 'court-fee-calc',
    };
  }

  const stateScheduleRequested =
    filingContext?.feeScheduleKey && !/central|1870|generic/i.test(filingContext.feeScheduleKey);
  const unavailableReason =
    'Per-state court-fee and suits-valuation tables are not loaded in JRX (generic Court Fees Act 1870 slab only). '
    + 'Verify stamp duty, vakalatnama fee, and ad-valorem fee with the court registry or State schedule before filing.';

  return {
    applicable: true,
    scheduleBasis: 'Court Fees Act 1870 / applicable State schedule',
    note: AD_VALOREM_FEE_TYPES.has(documentType)
      ? 'Ad-valorem court fee applies — supply `filingContext.suitValue` to compute the amount.'
      : 'A fixed / nominal court fee applies per the State schedule for this instrument — verify the exact amount with the court registry.',
    source: 'schedule-reference',
    ...(!suitValue && (stateScheduleRequested || !AD_VALOREM_FEE_TYPES.has(documentType))
      ? { unavailableReason }
      : AD_VALOREM_FEE_TYPES.has(documentType) && !suitValue
        ? { unavailableReason }
        : {}),
  };
}

/** Build the deterministic ready-to-insert text blocks for the draft. */
function buildFormattedBlocks(input: {
  documentType: DraftDocumentType;
  nvTemplateKey?: string;
  prompt?: string;
  checklistRows: FilingChecklistItem[];
  serviceModes?: DraftServiceMode[];
  limitation: DraftLimitationProfile;
  courtFee: DraftCourtFeeProfile;
}): DraftFormattedBlock[] {
  const blocks: DraftFormattedBlock[] = [];

  const ni138 = resolveNi138StatutoryNoticeContext({
    documentType: input.documentType,
    nvTemplateKey: input.nvTemplateKey,
    prompt: input.prompt,
  });
  if (ni138.active) {
    blocks.push({
      id: 'ni-138-statutory',
      kind: 'ni-138-statutory',
      title: 'Section 138 NI Act — statutory notice skeleton',
      text: ni138.blockText,
    });
  }

  if (input.checklistRows.length > 0) {
    const lines = input.checklistRows.map((r, i) => {
      const tag = r.mandatory ? '[MANDATORY]' : '[recommended]';
      return `${i + 1}. ${r.label} ${tag} — ${r.basis}`;
    });
    blocks.push({
      id: 'enclosures',
      kind: 'enclosure-list',
      title: 'Enclosures / documents to accompany the filing',
      text: `Enclosures to be attached:\n${lines.join('\n')}`,
    });
  }

  if (input.limitation.applicable && input.limitation.limitationPeriod) {
    const computed = input.limitation.computed;
    const dated = computed
      ? ` Computed from the stated accrual date (${computed.accrualDate}), the period expires on ${computed.expiryDate}`
        + `${computed.isExpired ? ' (APPEARS TIME-BARRED)' : ` (approx. ${computed.daysRemaining} day(s) remaining)`}.`
      : '';
    blocks.push({
      id: 'limitation',
      kind: 'limitation-clause',
      title: 'Limitation',
      text:
        `The applicable limitation period for this matter is ${input.limitation.limitationPeriod} `
        + `(${input.limitation.legalBasis}).${dated} This is advisory — confirm accrual, exclusion `
        + `and condonation facts before filing.`,
    });
  }

  if (input.courtFee.applicable) {
    const c = input.courtFee.computed;
    const amount = c
      ? ` Estimated court fee on a suit value of ₹${c.suitValue.toLocaleString('en-IN')}: ₹${c.courtFee.toLocaleString('en-IN')} (${c.tier}), plus process ₹${c.additionalFees.processFee} and notice ₹${c.additionalFees.noticeFee} = ₹${c.total.toLocaleString('en-IN')}.`
      : '';
    blocks.push({
      id: 'court-fee',
      kind: 'court-fee-note',
      title: 'Court fee',
      text: `Court fee: ${input.courtFee.scheduleBasis}.${amount} ${input.courtFee.note}`,
    });
  }

  if (input.serviceModes && input.serviceModes.length > 0) {
    blocks.push({
      id: 'service-modes',
      kind: 'service-modes',
      title: 'Modes of service',
      text: `Permissible modes of service: ${input.serviceModes.join(', ')}. Retain proof of dispatch and an office copy.`,
    });
  }

  return blocks;
}

function structuralValidation(
  markers: DraftStructureMarkers,
  documentType: DraftDocumentType,
): DraftValidationResult[] {
  const notice = isNoticeDocumentType(documentType);
  const src = 'structureMarkers';
  return [
    {
      id: 'structure.prayer',
      label: notice ? 'Demand / relief clause present' : 'Prayer / relief present',
      status: markers.prayer ? 'pass' : 'fail',
      source: src,
    },
    {
      id: 'structure.verification',
      label: notice ? 'Signature / closing block present' : 'Verification present',
      status: markers.verification ? 'pass' : 'fail',
      source: src,
    },
    {
      id: 'structure.causeTitle',
      label: notice ? 'Addressee / subject header present' : 'Cause title present',
      status: markers.causeTitle ? 'pass' : 'warn',
      source: src,
    },
    {
      id: 'structure.numberedParas',
      label: 'Numbered / structured paragraphs present',
      status: markers.numberedParas ? 'pass' : 'warn',
      source: src,
    },
    {
      id: 'structure.limitation',
      label: notice ? 'Statutory timeline / cure period stated' : 'Limitation / timeline referenced',
      status: markers.limitationChecked ? 'pass' : 'warn',
      detail: markers.limitationChecked
        ? undefined
        : 'No explicit limitation/timeline marker detected — confirm before filing.',
      source: src,
    },
  ];
}

export interface DraftProfileAssembly {
  draftProfile: DraftProfile;
  validationResults: DraftValidationResult[];
}

/**
 * Build `draftProfile` + `validationResults[]`. Deterministic (no LLM).
 */
export function assembleDraftProfile(input: {
  documentType: DraftDocumentType;
  structureMarkers?: DraftStructureMarkers;
  /** Partner instruction / prompt (for NI §138 heuristic injection only). */
  prompt?: string;
  filingContext?: FilingContextHint;
  /**
   * NV-DRAFT-INTENT-PROMPT-001 — how the documentType was resolved. When NSP
   * omitted `filingContext.nvTemplateKey` but JRX inferred a fine-grained key
   * from the prompt, it is used to select the enclosure manifest and is echoed
   * on `draftProfile.intentResolution` with a `fallbackReason`.
   */
  documentTypeResolution?: DraftDocumentTypeResolution;
}): DraftProfileAssembly {
  const { documentType, structureMarkers, filingContext, documentTypeResolution } = input;

  // Prefer the advisory NSP key; else fall back to a key JRX inferred from the
  // prompt so the fine-grained enclosure manifest still applies fail-open.
  const effectiveNvTemplateKey =
    filingContext?.nvTemplateKey ?? documentTypeResolution?.nvTemplateKey;
  const checklist = resolveFilingChecklist({
    nvTemplateKey: effectiveNvTemplateKey,
    documentType,
  });

  const validationResults: DraftValidationResult[] = [];
  if (structureMarkers) {
    validationResults.push(...structuralValidation(structureMarkers, documentType));
  }

  // Enclosure summary — a rule statement, not an attach-state claim (NSP ticks).
  const mandatoryEnclosures = checklist.rows.filter((r) => r.mandatory);
  if (mandatoryEnclosures.length > 0) {
    validationResults.push({
      id: 'filing.enclosures',
      label: 'Mandatory enclosures to attach',
      status: 'warn',
      detail: `${mandatoryEnclosures.length} mandatory enclosure(s): ${mandatoryEnclosures
        .map((r) => r.label)
        .join('; ')}`,
      source: 'filingChecklist',
    });
  }

  // Drift reconciliation — NSP-supplied expectations vs JRX registry (advisory).
  if (filingContext?.expectedSections && filingContext.expectedSections.length > 0) {
    validationResults.push({
      id: 'filing.expectedSections',
      label: 'Partner-supplied section expectations reconciled',
      status: 'na',
      detail:
        'NSP `mandatorySections` treated as advisory; JRX structure/validation is authoritative '
        + `(${filingContext.expectedSections.length} expected section hint(s) received).`,
      source: 'filingContext',
    });
  }

  const serviceModes = isNoticeDocumentType(documentType) ? [...NOTICE_SERVICE_MODES] : undefined;

  /* NV-DRAFT-PROFILE-LIMITATION-001 / -COURTFEE-001 — advisory limitation + court
   * fee resolved from LIVE JRX SSoT (nyayatimeline schedule + shared court-fee
   * formula). Emitted with honest applicability flags; never invented. */
  const limitation = buildLimitationProfile(documentType, effectiveNvTemplateKey, filingContext);
  const courtFee = buildCourtFeeProfile(documentType, filingContext);
  const formattedBlocks = buildFormattedBlocks({
    documentType,
    nvTemplateKey: effectiveNvTemplateKey,
    prompt: input.prompt,
    checklistRows: checklist.rows,
    serviceModes,
    limitation,
    courtFee,
  });

  // Surface limitation as a validation row so NSP's panel shows it (advisory).
  if (limitation.applicable && limitation.limitationPeriod) {
    const expired = limitation.computed?.isExpired === true;
    validationResults.push({
      id: 'filing.limitation',
      label: 'Limitation period (advisory)',
      status: expired ? 'fail' : 'na',
      detail: expired
        ? `${limitation.limitationPeriod} (${limitation.legalBasis}) — APPEARS TIME-BARRED as of the stated accrual date; consider condonation u/s 5 Limitation Act.`
        : `${limitation.limitationPeriod} (${limitation.legalBasis}).${limitation.computed ? ` Expires ${limitation.computed.expiryDate}.` : ''}`,
      source: 'nyayatimeline',
    });
  }
  if (courtFee.applicable) {
    validationResults.push({
      id: 'filing.courtFee',
      label: 'Court fee (advisory)',
      status: courtFee.unavailableReason ? 'warn' : 'na',
      detail: courtFee.computed
        ? `${courtFee.scheduleBasis} — estimated total ₹${courtFee.computed.total.toLocaleString('en-IN')} (${courtFee.computed.tier}).`
        : courtFee.unavailableReason
          ? `${courtFee.note} ${courtFee.unavailableReason}`
          : courtFee.note,
      source: './jrx-court-fee',
    });
  }

  if (filingContext?.appealableOrderKey) {
    const maintainability = hintAppealMaintainability(filingContext.appealableOrderKey);
    validationResults.push({
      id: 'filing.appealMaintainability',
      label: 'Appeal against order (O.43 advisory index)',
      status: maintainability.recognized ? 'pass' : 'warn',
      detail: maintainability.order
        ? `${maintainability.order.label} — ${maintainability.order.cpcBasis}. ${maintainability.note}`
        : maintainability.note,
      source: './jrx-cpc-appealable-orders-pack',
    });
  }

  const draftProfile: DraftProfile = {
    documentType,
    ...(filingContext?.nvTemplateKey ? { templateKey: filingContext.nvTemplateKey } : {}),
    ...(filingContext?.filingBookRowId ? { filingBookRowId: filingContext.filingBookRowId } : {}),
    filingBookVersion: filingContext?.filingBookVersion ?? FILING_BOOK_MANIFEST_VERSION,
    manifestVersion: FILING_BOOK_MANIFEST_VERSION,
    filingChecklist: checklist.rows,
    ...(serviceModes ? { serviceModes } : {}),
    limitation,
    courtFee,
    ...(formattedBlocks.length > 0 ? { formattedBlocks } : {}),
  };

  if (filingContext) {
    draftProfile.advisory = {
      ...(filingContext.nvTemplateKey ? { nvTemplateKey: filingContext.nvTemplateKey } : {}),
      ...(filingContext.legalBasisHint ? { legalBasisHint: filingContext.legalBasisHint } : {}),
      ...(filingContext.limitationRuleKey ? { limitationRuleKey: filingContext.limitationRuleKey } : {}),
      ...(filingContext.feeScheduleKey ? { feeScheduleKey: filingContext.feeScheduleKey } : {}),
      ...(filingContext.noticeComplianceDays != null
        ? { noticeComplianceDays: filingContext.noticeComplianceDays }
        : {}),
      ...(filingContext.exportProfile ? { exportProfile: filingContext.exportProfile } : {}),
      ...(filingContext.expectedSections ? { expectedSections: filingContext.expectedSections } : {}),
      ...(filingContext.expectedAnnexures ? { expectedAnnexures: filingContext.expectedAnnexures } : {}),
      advisoryOnly: filingContext.advisoryOnly,
      note: 'Advisory hints echoed from NSP filingContext — JRX structureMarkers / filingChecklist are authoritative.',
    };
  }

  /* NV-DRAFT-INTENT-PROMPT-001 — echo how JRX resolved intent + why a DEFAULT /
   * inferred envelope was produced. Only when JRX actually had to infer, or when
   * NSP supplied no filingContext (default structure envelope path §C). */
  if (documentTypeResolution) {
    const r = documentTypeResolution;
    if (r.wasInferred || !filingContext) {
      draftProfile.intentResolution = {
        docType: r.documentType,
        ...(r.nvTemplateKey ? { nvTemplateKey: r.nvTemplateKey } : {}),
        confidence: r.confidence,
        rationale: r.rationale,
        source: r.source,
        wasInferred: r.wasInferred,
        ...(r.rawInput ? { partnerDocumentTypeRaw: r.rawInput.slice(0, 64) } : {}),
      };
    }

    const reasons: string[] = [];
    if (r.source === 'general_fallback') {
      reasons.push(
        'documentType could not be resolved from parameters or prompt — using the '
        + 'general_legal_document counsel envelope.',
      );
    } else if (r.source === 'unknown_explicit_fallback') {
      reasons.push(
        `Partner documentType${r.rawInput ? ` "${r.rawInput.slice(0, 48)}"` : ''} was not `
        + 'recognised — using the general_legal_document counsel envelope.',
      );
    } else if (r.source === 'prompt_inferred') {
      reasons.push(
        `documentType inferred from the prompt (\`${r.documentType}\`, confidence ${r.confidence.toFixed(2)})`
        + `${r.nvTemplateKey ? ` → filing-book key \`${r.nvTemplateKey}\`` : ''}.`,
      );
    }
    if (!filingContext) {
      reasons.push(
        'No NSP filingContext supplied — JRX applied its own Indian structure checklist and '
        + `${checklist.fromManifest ? 'a fine-grained' : 'a coarse doctype'} enclosure checklist.`,
      );
    }
    if (reasons.length > 0) {
      draftProfile.fallbackReason = reasons.join(' ');
    }
  }

  return { draftProfile, validationResults };
}
