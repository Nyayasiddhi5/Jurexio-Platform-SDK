/**
 * NV-DRAFT-LENGTH-REGISTRY-001 — per-document-type output token strategy (JRX SSOT).
 *
 * NSP 3-tier wire mapping (draft-quality-routing.ts):
 *   fast       → options.draftLength `low`         → ~4096 streaming
 *   standard   → options.draftLength `medium`      → 6144–8192 streaming
 *   comprehensive → `comprehensive` + bare `legal-draft` async → 16384–32768 (no SLA cap)
 *
 * Medium = table default; low = fast tier; comprehensive = counsel async tier.
 * Char ranges (~4 chars/token) used for validation/warning only (±10% tolerance).
 * Attachment bump: see {@link resolveDraftAttachmentTokenBump} (+1024 low / +2048 medium / +4096 comprehensive).
 */

import { crosswalkNvTemplateKey, normalizeNvTemplateKey } from './jrx-filing-book-crosswalk.js';
import { inferDraftIntentFromPrompt } from './jrx-draft-intent-from-prompt.js';
import {
  betaDraftFastSlaMediumCeiling,
  betaPartnerDraftFastFloor,
  isBetaQualityFirst,
} from './jrx-beta-quality-profile.js';

export type DraftLengthTier = 'low' | 'medium' | 'comprehensive';

/** Partner `parameters.documentType` / registry keys (snake_case). */
export type DraftDocumentType =
  | 'affidavit_simple'
  | 'affidavit_case'
  | 'legal_notice'
  | 'reply_legal_notice'
  | 'petition_application'
  | 'writ_petition'
  | 'counter_affidavit'
  | 'written_statement'
  | 'rejoinder'
  | 'interlocutory_application'
  | 'criminal_petition'
  | 'bail_application'
  | 'divorce_petition'
  | 'civil_suit_plaint'
  | 'written_arguments'
  | 'final_arguments'
  | 'legal_opinion'
  | 'case_summary'
  | 'simple_agreement'
  | 'complex_agreement'
  | 'review_petition'
  | 'execution_petition'
  /** NV-NSP-FB468-P0-001 — appeal/execution family keys for NSP filing-book crosswalk. */
  | 'revision_petition'
  | 'cross_objection'
  | 'caveat'
  /** NV-DOCUMENT-TYPE-INFERENCE-001 — counsel-grade fallback when partner omits or sends unknown type. */
  | 'general_legal_document';

export interface DraftLengthSpec {
  documentType: DraftDocumentType;
  /** Medium (default) completion tokens. */
  defaultTokens: number;
  lowTokens: number;
  comprehensiveTokens: number;
  /** Approx char range at ~4 chars/token — validation/warning only. */
  charRangeMin: number;
  charRangeMax: number;
}

/** ±10% tolerance for length validation warnings only. */
export const DRAFT_LENGTH_TOLERANCE = 0.1;

/** NSP fast / standard / comprehensive completion token bands (counsel-grade A4 estimates). */
export const DRAFT_TIER_TOKEN_BANDS = {
  low: { target: 4_096, ceiling: 4_096 },
  medium: { floor: 6_144, ceiling: 8_192 },
  comprehensive: { floor: 16_384, ceiling: 32_768 },
} as const;

export const DRAFT_LENGTH_REGISTRY: Record<DraftDocumentType, DraftLengthSpec> = {
  affidavit_simple: { documentType: 'affidavit_simple', defaultTokens: 6_144, lowTokens: 4_096, comprehensiveTokens: 16_384, charRangeMin: 12_000, charRangeMax: 24_000 },
  affidavit_case: { documentType: 'affidavit_case', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 24_576, charRangeMin: 24_000, charRangeMax: 48_000 },
  legal_notice: { documentType: 'legal_notice', defaultTokens: 6_144, lowTokens: 4_096, comprehensiveTokens: 16_384, charRangeMin: 20_000, charRangeMax: 48_000 },
  reply_legal_notice: { documentType: 'reply_legal_notice', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 20_480, charRangeMin: 24_000, charRangeMax: 56_000 },
  petition_application: { documentType: 'petition_application', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 24_576, charRangeMin: 32_000, charRangeMax: 72_000 },
  writ_petition: { documentType: 'writ_petition', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 32_768, charRangeMin: 60_000, charRangeMax: 140_000 },
  counter_affidavit: { documentType: 'counter_affidavit', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 27_648, charRangeMin: 48_000, charRangeMax: 120_000 },
  written_statement: { documentType: 'written_statement', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 32_768, charRangeMin: 60_000, charRangeMax: 180_000 },
  rejoinder: { documentType: 'rejoinder', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 24_576, charRangeMin: 32_000, charRangeMax: 88_000 },
  interlocutory_application: { documentType: 'interlocutory_application', defaultTokens: 6_144, lowTokens: 4_096, comprehensiveTokens: 20_480, charRangeMin: 20_000, charRangeMax: 56_000 },
  criminal_petition: { documentType: 'criminal_petition', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 24_576, charRangeMin: 32_000, charRangeMax: 88_000 },
  bail_application: { documentType: 'bail_application', defaultTokens: 6_144, lowTokens: 4_096, comprehensiveTokens: 16_384, charRangeMin: 20_000, charRangeMax: 48_000 },
  divorce_petition: { documentType: 'divorce_petition', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 27_648, charRangeMin: 48_000, charRangeMax: 120_000 },
  civil_suit_plaint: { documentType: 'civil_suit_plaint', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 32_768, charRangeMin: 60_000, charRangeMax: 180_000 },
  written_arguments: { documentType: 'written_arguments', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 32_768, charRangeMin: 60_000, charRangeMax: 140_000 },
  final_arguments: { documentType: 'final_arguments', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 32_768, charRangeMin: 80_000, charRangeMax: 240_000 },
  legal_opinion: { documentType: 'legal_opinion', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 24_576, charRangeMin: 48_000, charRangeMax: 120_000 },
  case_summary: { documentType: 'case_summary', defaultTokens: 6_144, lowTokens: 4_096, comprehensiveTokens: 16_384, charRangeMin: 16_000, charRangeMax: 48_000 },
  simple_agreement: { documentType: 'simple_agreement', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 27_648, charRangeMin: 48_000, charRangeMax: 120_000 },
  complex_agreement: { documentType: 'complex_agreement', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 32_768, charRangeMin: 160_000, charRangeMax: 480_000 },
  review_petition: { documentType: 'review_petition', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 27_648, charRangeMin: 48_000, charRangeMax: 120_000 },
  execution_petition: { documentType: 'execution_petition', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 24_576, charRangeMin: 32_000, charRangeMax: 88_000 },
  revision_petition: { documentType: 'revision_petition', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 27_648, charRangeMin: 40_000, charRangeMax: 110_000 },
  cross_objection: { documentType: 'cross_objection', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 24_576, charRangeMin: 32_000, charRangeMax: 88_000 },
  caveat: { documentType: 'caveat', defaultTokens: 6_144, lowTokens: 4_096, comprehensiveTokens: 8_192, charRangeMin: 6_000, charRangeMax: 18_000 },
  general_legal_document: { documentType: 'general_legal_document', defaultTokens: 8_192, lowTokens: 4_096, comprehensiveTokens: 24_576, charRangeMin: 32_000, charRangeMax: 96_000 },
};

/** Long pleadings whose medium-tier SLA cap (8192) truncates counsel-grade output. */
export const LONG_PLEADING_DOCUMENT_TYPES: ReadonlySet<DraftDocumentType> = new Set([
  'written_statement',
  'final_arguments',
  'complex_agreement',
  'writ_petition',
  'civil_suit_plaint',
  'written_arguments',
]);

export function isLongPleadingDocumentType(documentType: DraftDocumentType): boolean {
  return LONG_PLEADING_DOCUMENT_TYPES.has(documentType);
}

/** Instruments whose comprehensive registry floor exceeds the medium streaming band (~8192 tok). */
export function isMediumTierTruncationLikely(documentType: DraftDocumentType): boolean {
  const spec = DRAFT_LENGTH_REGISTRY[documentType];
  return spec.comprehensiveTokens > DRAFT_TIER_TOKEN_BANDS.medium.ceiling;
}

/** Registry tier tokens for a document type (before attachment bump). */
export function registryTokensForDraftTier(
  documentType: DraftDocumentType,
  tier: DraftLengthTier,
): number {
  const spec = DRAFT_LENGTH_REGISTRY[documentType];
  if (tier === 'low') return spec.lowTokens;
  if (tier === 'comprehensive') return spec.comprehensiveTokens;
  return spec.defaultTokens;
}

/** Counsel-grade depth hint from registry char/token bands (draft prompts, not chat analysis). */
export function buildDraftDepthHint(
  documentType: DraftDocumentType,
  tier: DraftLengthTier = 'medium',
): string {
  const spec = DRAFT_LENGTH_REGISTRY[documentType];
  const approxChars = Math.round(
    (tier === 'low' ? spec.lowTokens : tier === 'comprehensive' ? spec.comprehensiveTokens : spec.defaultTokens) * 4,
  );
  if (documentType === 'simple_agreement' || documentType === 'complex_agreement') {
    if (tier === 'comprehensive') {
      return [
        `Produce a complete Indian counsel-grade commercial agreement`,
        `(target ~${Math.round(spec.charRangeMin / 1000)}k–${Math.round(spec.charRangeMax / 1000)}k characters,`,
        `≈${spec.comprehensiveTokens} completion tokens).`,
        'Include recitals, 12–25 numbered operative clauses (definitions, scope, consideration/fees, term,',
        'confidentiality, IP, warranties, liability cap, indemnity, termination, dispute resolution, governing law),',
        'and IN WITNESS WHEREOF execution block.',
        'No Court cause title, MOST RESPECTFULLY SHOWETH, PRAYER, or VERIFICATION.',
        'Avoid repetitive boilerplate and duplicate clauses — quality over padding.',
      ].join(' ');
    }
    return `Agreement draft (~${approxChars} chars at ${tier} tier): operative clauses + execution block; contract voice only.`;
  }
  if (documentType === 'legal_notice' || documentType === 'reply_legal_notice') {
    if (tier === 'comprehensive') {
      return `Complete statutory/demand notice (~${approxChars} chars): letterhead, facts, demand, timeline, consequences, advocate closing — not a Court paper-book.`;
    }
    return `Notice draft (~${approxChars} chars): letter voice with demand and closing.`;
  }
  if (tier === 'comprehensive' && isMediumTierTruncationLikely(documentType)) {
    return `Comprehensive counsel draft for ${documentType} (~${approxChars} chars); complete all numbered paragraphs and closing blocks without truncation.`;
  }
  if (tier === 'low') {
    return `Fast-tier draft (~${approxChars} chars): complete structure but concise substance.`;
  }
  if (tier === 'medium' && isMediumTierTruncationLikely(documentType)) {
    return [
      `Medium-tier ${documentType.replace(/_/g, ' ')} (~${approxChars} chars at registry medium budget):`,
      'complete all numbered paragraphs and mandatory closing blocks within the completion token budget —',
      'not a full paper-book (select comprehensive tier for counsel-length pleadings).',
    ].join(' ');
  }
  return '';
}

export interface DraftRoutingHint {
  recommendedDraftLength: 'comprehensive';
  reason: string;
  documentType: DraftDocumentType;
  currentTier: DraftLengthTier;
  truncationLikely: boolean;
  registryComprehensiveTokens: number;
}

/** Partner metadata when standard/medium tier may truncate long instruments. */
export function buildDraftRoutingHint(input: {
  documentType?: unknown;
  draftLength?: unknown;
  options?: Record<string, unknown>;
  body?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  taskType?: unknown;
  prompt?: unknown;
}): DraftRoutingHint | null {
  const documentType = resolveDraftDocumentType(input);
  if (!isMediumTierTruncationLikely(documentType)) return null;

  const tier = resolveDraftLengthTier(input);
  if (tier === 'comprehensive' || tier === 'low') return null;

  const spec = DRAFT_LENGTH_REGISTRY[documentType];
  const mediumCharCeiling = Math.ceil(DRAFT_TIER_TOKEN_BANDS.medium.ceiling * 4 * (1 + DRAFT_LENGTH_TOLERANCE));
  const truncationLikely = spec.comprehensiveTokens > DRAFT_TIER_TOKEN_BANDS.medium.ceiling;
  const instrument = isLongPleadingDocumentType(documentType)
    ? 'paper-book'
    : (documentType === 'simple_agreement' || documentType === 'complex_agreement')
      ? 'MSA/agreement'
      : 'notice/instrument';

  return {
    recommendedDraftLength: 'comprehensive',
    reason: `${documentType} comprehensive registry floor is ${spec.comprehensiveTokens} tokens (~${spec.charRangeMin}+ chars); standard tier SLA caps at ${DRAFT_TIER_TOKEN_BANDS.medium.ceiling} tokens (~${mediumCharCeiling} chars). Re-submit with options.draftLength=comprehensive and taskType legal-draft (async worker) for full ${instrument}.`,
    documentType,
    currentTier: tier,
    truncationLikely,
    registryComprehensiveTokens: spec.comprehensiveTokens,
  };
}

const DOCUMENT_TYPE_ALIASES: Record<string, DraftDocumentType> = {
  affidavit_simple: 'affidavit_simple',
  simple_affidavit: 'affidavit_simple',
  affidavit_case: 'affidavit_case',
  case_affidavit: 'affidavit_case',
  legal_notice: 'legal_notice',
  notice: 'legal_notice',
  demand_notice: 'legal_notice',
  reply_legal_notice: 'reply_legal_notice',
  reply_to_notice: 'reply_legal_notice',
  petition_application: 'petition_application',
  application: 'petition_application',
  petition: 'petition_application',
  writ_petition: 'writ_petition',
  writ: 'writ_petition',
  wp: 'writ_petition',
  counter_affidavit: 'counter_affidavit',
  counteraffidavit: 'counter_affidavit',
  written_statement: 'written_statement',
  writtenstatement: 'written_statement',
  ws: 'written_statement',
  rejoinder: 'rejoinder',
  replication: 'rejoinder',
  interlocutory_application: 'interlocutory_application',
  ia: 'interlocutory_application',
  interim_application: 'interlocutory_application',
  criminal_petition: 'criminal_petition',
  bail_application: 'bail_application',
  bail: 'bail_application',
  anticipatory_bail: 'bail_application',
  divorce_petition: 'divorce_petition',
  divorce: 'divorce_petition',
  civil_suit_plaint: 'civil_suit_plaint',
  plaint: 'civil_suit_plaint',
  civil_plaint: 'civil_suit_plaint',
  written_arguments: 'written_arguments',
  written_submissions: 'written_arguments',
  final_arguments: 'final_arguments',
  oral_arguments: 'final_arguments',
  legal_opinion: 'legal_opinion',
  opinion: 'legal_opinion',
  case_summary: 'case_summary',
  summary: 'case_summary',
  simple_agreement: 'simple_agreement',
  agreement: 'simple_agreement',
  msa: 'simple_agreement',
  nda: 'simple_agreement',
  complex_agreement: 'complex_agreement',
  spa: 'complex_agreement',
  slp: 'writ_petition',
  review_petition: 'review_petition',
  review: 'review_petition',
  execution_petition: 'execution_petition',
  execution: 'execution_petition',
  darkhast: 'execution_petition',
  revision_petition: 'revision_petition',
  civil_revision_petition: 'revision_petition',
  revision: 'revision_petition',
  cross_objection: 'cross_objection',
  cross_objections: 'cross_objection',
  civil_cross_objection: 'cross_objection',
  caveat: 'caveat',
  caveat_petition: 'caveat',
  civil_caveat: 'caveat',
  general_legal_document: 'general_legal_document',
  general: 'general_legal_document',
  legal_document: 'general_legal_document',
  legal_document_general: 'general_legal_document',
};

const DEFAULT_DOCUMENT_TYPE: DraftDocumentType = 'general_legal_document';

export type DocumentTypeResolutionSource =
  | 'explicit_registry'
  | 'explicit_alias'
  /** NV-NSP-FB468-P0-001 — resolved from an NSP FB-468 `nvTemplateKey` crosswalk. */
  | 'nv_template_key'
  | 'prompt_inferred'
  | 'unknown_explicit_fallback'
  | 'general_fallback';

export interface DraftDocumentTypeResolution {
  documentType: DraftDocumentType;
  source: DocumentTypeResolutionSource;
  /** True when JRX inferred or substituted the partner wire value. */
  wasInferred: boolean;
  /** Partner wire value when present (may be unknown). */
  rawInput?: string;
  /**
   * NV-DRAFT-INTENT-PROMPT-001 — 0..1 confidence in the resolved type. Explicit
   * wire values are 1.0; prompt heuristics carry the heuristic band; the coarse
   * fallback sits low so callers can flag "JRX guessed" on the draftProfile.
   */
  confidence: number;
  /** Human-readable reasons for the resolution (surfaced on draftProfile.intentResolution). */
  rationale: string[];
  /**
   * Fine-grained FB-468 manifest key when the prompt/wire unambiguously implies
   * one — lets the filing-checklist assembler pick the fine-grained enclosure
   * manifest even when NSP omits `filingContext.nvTemplateKey`.
   */
  nvTemplateKey?: string;
}

function normalizeDraftLengthTier(raw: unknown): DraftLengthTier {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'low' || v === 'short' || v === 'brief') return 'low';
  if (v === 'comprehensive' || v === 'full' || v === 'detailed' || v === 'long') return 'comprehensive';
  return 'medium';
}

function normalizeDocumentTypeKey(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export function resolveDraftDocumentTypeWithMeta(input: {
  documentType?: unknown;
  draftType?: unknown;
  template?: unknown;
  taskType?: unknown;
  prompt?: unknown;
  parameters?: Record<string, unknown>;
}): DraftDocumentTypeResolution {
  const params = input.parameters && typeof input.parameters === 'object' ? input.parameters : {};
  const filingContext = params.filingContext && typeof params.filingContext === 'object'
    ? (params.filingContext as Record<string, unknown>)
    : {};
  const candidates = [
    input.documentType,
    input.draftType,
    params.documentType,
    params.draftType,
    params.template,
    input.template,
    params.docType,
    /* NV-NSP-FB468-P0-001 — NSP sends the fine-grained key in `filingContext.nvTemplateKey`
     * (and, per the reconciled flow, also as `documentType`); consult it last so an
     * explicit registry key/alias still wins. */
    filingContext.nvTemplateKey,
  ];

  let rawExplicit: string | undefined;
  for (const raw of candidates) {
    if (raw == null || String(raw).trim() === '') continue;
    rawExplicit = String(raw).trim();
    const key = normalizeDocumentTypeKey(raw);
    if (key && key in DRAFT_LENGTH_REGISTRY) {
      return {
        documentType: key as DraftDocumentType,
        source: 'explicit_registry',
        wasInferred: false,
        rawInput: rawExplicit,
        confidence: 1,
        rationale: [`Explicit partner \`documentType\` "${rawExplicit}" matched the registry.`],
      };
    }
    if (key && DOCUMENT_TYPE_ALIASES[key]) {
      return {
        documentType: DOCUMENT_TYPE_ALIASES[key],
        source: 'explicit_alias',
        wasInferred: false,
        rawInput: rawExplicit,
        confidence: 1,
        rationale: [`Explicit partner value "${rawExplicit}" resolved via alias → \`${DOCUMENT_TYPE_ALIASES[key]}\`.`],
      };
    }
    /* NV-NSP-FB468-P0-001 — FB-468 nvTemplateKey → coarse DraftDocumentType.
     * An explicit mapping, not an inference: `wasInferred` stays false. */
    const crosswalked = crosswalkNvTemplateKey(raw);
    if (crosswalked) {
      return {
        documentType: crosswalked,
        source: 'nv_template_key',
        wasInferred: false,
        rawInput: rawExplicit,
        confidence: 1,
        nvTemplateKey: normalizeNvTemplateKey(raw),
        rationale: [`Explicit FB-468 nvTemplateKey "${rawExplicit}" crosswalked → \`${crosswalked}\`.`],
      };
    }
  }

  /* NV-DRAFT-INTENT-PROMPT-001 — no usable explicit wire value: decode intent
   * from the prompt / documentText. Delegates to the single heuristic SSoT so
   * there is no second rule list to drift (NV-NO-DUPLICATE-001). */
  const blob = [
    input.prompt,
    params.instruction,
    params.documentText,
    params.prompt,
    input.taskType,
  ]
    .filter((v) => v != null && String(v).trim() !== '')
    .join(' ');
  const intent = inferDraftIntentFromPrompt(blob);
  if (intent.source === 'prompt_heuristic') {
    return {
      documentType: intent.docType,
      source: 'prompt_inferred',
      wasInferred: true,
      ...(rawExplicit ? { rawInput: rawExplicit } : {}),
      ...(intent.nvTemplateKey ? { nvTemplateKey: intent.nvTemplateKey } : {}),
      confidence: intent.confidence,
      rationale: intent.rationale,
    };
  }

  /* Unknown explicit wire value that also failed prompt inference → coarse
   * fallback, but preserve the partner-sent-something signal (source differs
   * from a truly empty request so NSP can show "unrecognised type"). */
  if (rawExplicit) {
    return {
      documentType: DEFAULT_DOCUMENT_TYPE,
      source: 'unknown_explicit_fallback',
      wasInferred: true,
      rawInput: rawExplicit,
      confidence: 0.2,
      rationale: [
        `Partner \`documentType\` "${rawExplicit}" is not a recognised JRX type and the `
        + 'prompt did not imply a specific instrument — using the default counsel envelope.',
      ],
    };
  }

  return {
    documentType: DEFAULT_DOCUMENT_TYPE,
    source: 'general_fallback',
    wasInferred: true,
    confidence: intent.confidence,
    rationale: intent.rationale,
  };
}

export function resolveDraftDocumentType(input: {
  documentType?: unknown;
  draftType?: unknown;
  template?: unknown;
  taskType?: unknown;
  prompt?: unknown;
  parameters?: Record<string, unknown>;
}): DraftDocumentType {
  return resolveDraftDocumentTypeWithMeta(input).documentType;
}

export function resolveDraftLengthTier(input: {
  draftLength?: unknown;
  options?: Record<string, unknown>;
  body?: Record<string, unknown>;
}): DraftLengthTier {
  const opts = input.options && typeof input.options === 'object' ? input.options : {};
  const body = input.body && typeof input.body === 'object' ? input.body : {};
  const bodyOpts = body.options && typeof body.options === 'object'
    ? (body.options as Record<string, unknown>)
    : {};
  return normalizeDraftLengthTier(
    input.draftLength
    ?? opts.draftLength
    ?? bodyOpts.draftLength
    ?? body.draftLength
    ?? paramsDepth(body),
  );
}

function paramsDepth(body: Record<string, unknown>): unknown {
  const params = body.parameters;
  if (!params || typeof params !== 'object') return undefined;
  return (params as Record<string, unknown>).draftLength
    ?? (params as Record<string, unknown>).depth;
}

export interface DraftOutputTokenResolution {
  documentType: DraftDocumentType;
  tier: DraftLengthTier;
  tokens: number;
  spec: DraftLengthSpec;
  attachmentBump: number;
}

function envDraftToken(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.min(128_000, Math.max(256, Math.floor(n))) : fallback;
}

/**
 * NV-DRAFT-FAST-SLA-002 — per-doc-type fast SLA completion ceiling (not a global 8192).
 * Uses registry tier budget capped by global tier rails from env / DRAFT_TIER_TOKEN_BANDS.
 */
export function resolveDraftFastSlaTokenCapForDocument(input: {
  documentType: DraftDocumentType;
  tier: DraftLengthTier;
}): number {
  let registryTier = registryTokensForDraftTier(input.documentType, input.tier);
  /** R-DRAFT-TOKEN-TRUTH-001 — beta medium `-fast` uses quality floor up to medium ceiling, not flat registry min only. */
  if (isBetaQualityFirst() && input.tier === 'medium') {
    registryTier = Math.min(
      betaDraftFastSlaMediumCeiling(),
      Math.max(registryTier, betaPartnerDraftFastFloor()),
    );
  }
  const bandCeiling = input.tier === 'low'
    ? DRAFT_TIER_TOKEN_BANDS.low.ceiling
    : input.tier === 'comprehensive'
      ? DRAFT_TIER_TOKEN_BANDS.comprehensive.ceiling
      : isBetaQualityFirst()
        ? betaDraftFastSlaMediumCeiling()
        : DRAFT_TIER_TOKEN_BANDS.medium.ceiling;
  const globalRail = input.tier === 'low'
    ? envDraftToken('JRX_DRAFT_FAST_SLA_MAX_TOKENS_LOW', DRAFT_TIER_TOKEN_BANDS.low.ceiling)
    : input.tier === 'comprehensive'
      ? envDraftToken(
        'JRX_DRAFT_FAST_SLA_MAX_TOKENS_COMPREHENSIVE',
        DRAFT_TIER_TOKEN_BANDS.comprehensive.ceiling,
      )
      : envDraftToken('JRX_DRAFT_FAST_SLA_MAX_TOKENS', DRAFT_TIER_TOKEN_BANDS.medium.ceiling);
  return Math.min(registryTier, bandCeiling, globalRail);
}

/** Extra completion budget when partner attaches reference docs (grounded draft). */
export function resolveDraftAttachmentTokenBump(
  hasAttachments: boolean,
  tier: DraftLengthTier = 'medium',
): number {
  if (!hasAttachments) return 0;
  switch (tier) {
    case 'low':
      return envDraftToken('JRX_DRAFT_ATTACHMENT_BUMP_LOW', 1_024);
    case 'comprehensive':
      return envDraftToken('JRX_DRAFT_ATTACHMENT_BUMP_COMPREHENSIVE', 4_096);
    default:
      return envDraftToken('JRX_DRAFT_ATTACHMENT_BUMP_MEDIUM', 2_048);
  }
}

function clampDraftTokens(tokens: number, tier: DraftLengthTier, hasAttachments = false): number {
  if (tier === 'low') {
    const ceiling = hasAttachments
      ? DRAFT_TIER_TOKEN_BANDS.low.ceiling + resolveDraftAttachmentTokenBump(true, 'low')
      : DRAFT_TIER_TOKEN_BANDS.low.ceiling;
    return Math.min(tokens, ceiling);
  }
  if (tier === 'comprehensive') {
    return Math.min(
      Math.max(tokens, DRAFT_TIER_TOKEN_BANDS.comprehensive.floor),
      DRAFT_TIER_TOKEN_BANDS.comprehensive.ceiling,
    );
  }
  const mediumCeiling = hasAttachments
    ? DRAFT_TIER_TOKEN_BANDS.medium.ceiling
    : DRAFT_TIER_TOKEN_BANDS.medium.ceiling;
  return Math.min(
    Math.max(tokens, DRAFT_TIER_TOKEN_BANDS.medium.floor),
    mediumCeiling,
  );
}

/** Detect partner attachment / grounding on orchestrate body. */
export function partnerBodyHasDraftAttachments(body: Record<string, unknown> | undefined): boolean {
  if (!body || typeof body !== 'object') return false;
  const params = body.parameters && typeof body.parameters === 'object'
    ? (body.parameters as Record<string, unknown>)
    : {};
  const ragIds = body.ragDocumentIds ?? params.ragDocumentIds ?? params.nyvRagDocumentIds;
  const refIds = body.referenceDocumentIds ?? params.referenceDocumentIds ?? params.attachedDocIds;
  if (Array.isArray(ragIds) && ragIds.length > 0) return true;
  if (Array.isArray(refIds) && refIds.length > 0) return true;
  const docText = String(
    body.documentText ?? body.documentContent ?? params.documentText ?? '',
  ).trim();
  if (docText.length > 80) return true;
  if (body.filePath || params.filePath) return true;
  return false;
}

export function resolveDraftOutputTokens(input: {
  documentType?: unknown;
  draftType?: unknown;
  draftLength?: unknown;
  template?: unknown;
  taskType?: unknown;
  prompt?: unknown;
  parameters?: Record<string, unknown>;
  options?: Record<string, unknown>;
  body?: Record<string, unknown>;
  hasAttachments?: boolean;
}): DraftOutputTokenResolution {
  const documentType = resolveDraftDocumentType(input);
  const tier = resolveDraftLengthTier(input);
  const spec = DRAFT_LENGTH_REGISTRY[documentType];
  const base = tier === 'low'
    ? spec.lowTokens
    : tier === 'comprehensive'
      ? spec.comprehensiveTokens
      : spec.defaultTokens;
  const body = input.body && typeof input.body === 'object' ? input.body : undefined;
  const hasAttachments = input.hasAttachments ?? partnerBodyHasDraftAttachments(body);
  const attachmentBump = resolveDraftAttachmentTokenBump(hasAttachments, tier);
  const tokens = clampDraftTokens(base + attachmentBump, tier, hasAttachments);
  return { documentType, tier, tokens, spec, attachmentBump };
}

export interface DraftLengthValidation {
  withinRange: boolean;
  belowMin: boolean;
  aboveMax: boolean;
  expectedCharMin: number;
  expectedCharMax: number;
  contentLen: number;
  warning?: string;
}

/** Validation/warning only — ±10% tolerance on char range. */
export function validateDraftContentLength(
  content: string,
  documentType: DraftDocumentType,
  tier: DraftLengthTier = 'medium',
): DraftLengthValidation {
  const spec = DRAFT_LENGTH_REGISTRY[documentType];
  const tierTokens = tier === 'low'
    ? spec.lowTokens
    : tier === 'comprehensive'
      ? spec.comprehensiveTokens
      : spec.defaultTokens;
  const tierCharMin = Math.floor(tierTokens * 4 * (1 - DRAFT_LENGTH_TOLERANCE));
  const tierCharMax = Math.ceil(tierTokens * 4 * (1 + DRAFT_LENGTH_TOLERANCE));
  const contentLen = content?.length ?? 0;
  const belowMin = contentLen > 0 && contentLen < tierCharMin;
  const aboveMax = contentLen > tierCharMax;
  const withinRange = !belowMin && !aboveMax;
  let warning: string | undefined;
  if (belowMin) {
    warning = `Draft shorter than expected for ${documentType} (${tier}): ${contentLen} chars < ~${tierCharMin}`;
  } else if (aboveMax) {
    warning = `Draft longer than expected for ${documentType} (${tier}): ${contentLen} chars > ~${tierCharMax}`;
  }
  return {
    withinRange,
    belowMin,
    aboveMax,
    expectedCharMin: tierCharMin,
    expectedCharMax: tierCharMax,
    contentLen,
    warning,
  };
}

export function isPartnerDraftTaskType(taskType?: string): boolean {
  const tt = String(taskType || '').trim();
  if (!tt) return false;
  // NV-LEGAL-DRAFT-AGENTIC-001 — the `-agentic` D1 tier is also a draft taskType
  // (gets doc-type inference + draftProfile/validationResults assembly).
  return /^(legal[_-]?draft([_-]?fast|[_-]?agentic)?|doc[_-]?draft([_-]?fast|[_-]?agentic)?|document[_-]?draft(?:ing|[_-]?agentic)?)$/i.test(tt);
}
