/**
 * NV-ORCH-RESPONSE-CONTRACT-001 — unified curated outcome for SDK / platform callers.
 * Always includes: content, curated sections, citations, cost, routing, qualityEnvelope,
 * partner trust fields (riskBadge, auditHash).
 *
 * NV-CLIENT-OUTCOME-SANITIZE-001 — partner-facing payloads are outcome-only;
 * orchestration diagnostics require NYV_EXPOSE_ORCHESTRATION_DIAGNOSTICS=1.
 */

import { createHash } from 'crypto';
import type { AdaptiveRouterDecision } from './jrx-adaptive-router.js';
import type { QualityEnvelopeSnapshot } from './jrx-quality-envelope.js';
import type { RequestPhase } from './jrx-completion-driven.js';
import { sanitizeOrchestrationPayloadForClient } from '../utils/jrx-client-outcome-sanitize.js';
import { getRequestUsage } from '../utils/jrx-request-usage-context.js';
import {
  countPartnerAiMarkerHits,
  countPartnerPlaceholders,
  isCounselOrDraftTaskType,
} from '../utils/jrx-partner-human-polish.js';
import type { AnalysisStatus } from '../services/jrx-court-document-fields.js';
import {
  analyzeDraftCompletion,
  analyzeDraftStructureMarkers,
  structureMarkersComplete,
  usesPleadingCompletionRules,
  type DraftStructureMarkers,
} from '../services/jrx-draft-completion.js';
import {
  buildDraftRoutingHint,
  isPartnerDraftTaskType,
  resolveDraftDocumentType,
  type DraftDocumentType,
  type DraftDocumentTypeResolution,
  type DraftRoutingHint,
} from '../config/jrx-draft-length-registry.js';
import {
  assembleDraftProfile,
  type DraftProfile,
  type DraftValidationResult,
  type DraftFormattedBlock,
} from './jrx-draft-profile-assembler.js';
import {
  parseFilingContextHint,
  type FilingContextHint,
} from '../services/jrx-filing-context-hint.js';
import {
  isAgenticDraftTaskType,
  buildAgenticDraftPlan,
  summarizeAgenticDraftRun,
} from './jrx-legal-draft-agentic.js';
import type { DraftValidationResult } from './jrx-draft-profile-assembler.js';
import { createLogger } from '../utils/logger.js';

const partnerAiLogger = createLogger('./jrx-partner-ai-log');

/** NV-PARTNER-AI-LOG-001 — gate the structured draft-outcome log line (default on). */
function isPartnerAiLogEnabled(): boolean {
  const v = String(process.env.NYV_PARTNER_AI_LOG ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off' || v === 'no');
}

/** Compact PASS/WARN/FAIL rollup for the log line (no free text, no secrets). */
function summarizeValidation(results: DraftValidationResult[]): Record<string, number> {
  const out = { pass: 0, warn: 0, fail: 0, na: 0 };
  for (const r of results) out[r.status] += 1;
  return out;
}

/**
 * NV-PARTNER-AI-LOG-001 — one structured, secret-free line per partner draft
 * outcome. Metadata only (NV-SECRETS-001): request id, taskType, resolved
 * docType, intent source/confidence, filing provenance, latency-independent
 * structure + validation rollups. The prompt body is never logged.
 */
function logPartnerDraftOutcome(input: {
  requestId: string;
  taskType: string;
  resolvedDocType: DraftDocumentType;
  draftProfile: DraftProfile;
  validationResults: DraftValidationResult[];
  structureMarkers?: DraftStructureMarkers;
  documentTypeResolution?: DraftDocumentTypeResolution;
  filingContext?: FilingContextHint;
}): void {
  if (!isPartnerAiLogEnabled()) return;
  try {
    const sm = input.structureMarkers;
    partnerAiLogger.info('NV-PARTNER-AI-LOG-001 draft-outcome', {
      requestId: input.requestId,
      taskType: input.taskType,
      resolvedDocType: input.resolvedDocType,
      templateKey: input.draftProfile.templateKey ?? input.documentTypeResolution?.nvTemplateKey ?? null,
      intentSource: input.documentTypeResolution?.source ?? null,
      intentConfidence: input.documentTypeResolution?.confidence ?? null,
      wasInferred: input.documentTypeResolution?.wasInferred ?? false,
      fallbackReason: input.draftProfile.fallbackReason ?? null,
      filingBookRowId: input.filingContext?.filingBookRowId ?? null,
      filingChecklistCount: input.draftProfile.filingChecklist.length,
      structureMarkers: sm
        ? {
            prayer: sm.prayer,
            verification: sm.verification,
            causeTitle: sm.causeTitle,
            numberedParas: sm.numberedParas,
            limitationChecked: sm.limitationChecked,
          }
        : null,
      validation: summarizeValidation(input.validationResults),
    });
  } catch {
    /* logging is best-effort — never fail the response over it */
  }
}

/**
 * NV-ZEROCOST-ATTRIBUTION-001 (2026-08-16) — how a response was produced, stated
 * rather than inferred.
 *
 * A zero-completion response can be a semantic-cache hit, a deterministic
 * resolver answer, a statute fast path, or an abstain. Those have opposite
 * meanings for a cost claim: the first three are wins, and a deterministic tier
 * answering a question it should have escalated is a quality failure that *looks*
 * like a 100 % saving. Completion count alone cannot separate them, so the value
 * is emitted at the seam that actually knows.
 *
 * `semantic-cache` deliberately says nothing about whether the cached answer was
 * the RIGHT answer for this prompt — a cross-prompt fuzzy match reports
 * `semantic-cache` too. Only the similarity gate and downstream scoring can judge
 * that; this field's job is to stop a consumer from having to guess the mechanism.
 */
export type OrchestrationResolution =
  | 'llm'
  | 'semantic-cache'
  | 'deterministic-resolver'
  | 'statute-fast-path'
  | 'rag-abstain';

export interface OrchestrationCostContract {
  tokens: { prompt: number; completion: number; total: number };
  latencyMs: number;
  model?: string;
  provider?: string;
  path: string;
  /** NV-ZEROCOST-ATTRIBUTION-001 — see {@link OrchestrationResolution}. */
  resolution?: OrchestrationResolution;
  /** Resolver id, cache tier, or fast-path layer behind `resolution`. */
  resolutionDetail?: string;
  /**
   * Queen leaf/agent prompt-cache hits inside a request that still billed
   * completions. NOT a zero-cost answer: it reduces fan-out, and reporting it as
   * `resolution: 'semantic-cache'` would claim the whole response was free.
   */
  leafCacheHits?: number;
  /**
   * NV-METER-ENVELOPE-001 (2026-08-16) — how many billed provider completions this
   * one response consumed. Absent (undefined) only outside a request context.
   *
   * The envelope previously carried a single call's tokens even when the Queen had
   * fanned out to 5, so every per-request cost figure derived from it under-stated
   * true spend — including the figures in our own optimization plan. `completions`
   * makes fan-out legible without needing host log access.
   */
  completions?: number;
  /**
   * Spend that was incurred and then discarded (cancelled hedge leg, deadline-
   * abandoned generation). NOT billed to the customer — surfaced so the waste this
   * platform is trying to eliminate is measurable from the outside.
   */
  wasted?: { completions: number; promptTokens: number; completionTokens: number; costUsd: number };
}

export interface CuratedOutcome {
  summary: string;
  sections: Array<{ title: string; body: string }>;
  recommendations: string[];
  language?: string;
}

/** NV-AI-COMPLETION-LOOP-001 — partner-visible completion / continue UX. */
export type CompletionStatus = 'complete' | 'incomplete' | 'continued';

export interface PartnerCompletionEnvelope {
  status: CompletionStatus;
  continuationAvailable: boolean;
  continuationCount: number;
  incompleteReason?: 'abrupt_ending' | 'max_tokens' | 'structure' | 'segment_budget';
  hint?: string;
  continueRequest?: {
    options: {
      continueIncomplete: true;
      segmentIndex: number;
      priorRequestId?: string;
    };
  };
}

/** NV-DRAFT-QUALITY-001 — partner-visible draft readiness signals. */
export interface DraftQualityEnvelope {
  voiceOk: boolean;
  placeholdersRemaining: number;
  authoritiesDelivered: number;
  reviewRecommended: boolean;
  /** NV-AI-COMPLETION-LOOP-001 */
  completionStatus?: CompletionStatus;
  continuationAvailable?: boolean;
  continuationCount?: number;
  /** NV-CITATION-RETRIEVAL-VERIFY-001 — false when retrieval verify timed out or found mismatches. */
  citationVerified?: boolean;
  /** NV-COUNSEL-STRUCTURE-MARKERS-001 — Indian filing structure probes for NSP export gate. */
  structureMarkers?: DraftStructureMarkers;
  /** NV-LONG-PLEADING-ROUTING-001 — comprehensive tier recommendation when medium may truncate. */
  routingHint?: DraftRoutingHint;
  /** NV-AI-COMPLETION-LOOP-001 — mirror of top-level `completion` for draftQuality readers. */
  completion?: PartnerCompletionEnvelope;
  /** NV-DOCUMENT-TYPE-INFERENCE-001 — resolved type when partner omitted or sent unknown wire key. */
  inferredDocumentType?: DraftDocumentType;
  /** How NYV chose `inferredDocumentType` (prompt heuristic vs general fallback). */
  documentTypeSource?: DraftDocumentTypeResolution['source'];
  /** Truncated partner wire value when unknown explicit type was substituted. */
  partnerDocumentTypeRaw?: string;
}

export interface UnifiedOrchestrationContract {
  content: string;
  curated: CuratedOutcome;
  chainOfThought?: unknown;
  citations?: unknown;
  grounding?: unknown;
  hallucinationCheck?: unknown;
  cost: OrchestrationCostContract;
  routing: {
    path: string;
    reason: string;
    complexity: string;
    risk: string;
    detectedLanguage?: string;
    docTask?: string;
    primaryCapabilityIds?: string[];
  };
  qualityEnvelope: QualityEnvelopeSnapshot;
  /** Partner-stable trust badge (not orchestration topology). */
  riskBadge: 'GREEN' | 'YELLOW' | 'RED';
  /** Deterministic content+request fingerprint for NSP audit UX (not IronLedger full chain). */
  auditHash: string;
  trust: {
    grounded: boolean;
    citationsPresent: boolean;
    /**
     * NV-CITE-GROUND-001 — how many authorities the answer actually carries.
     *
     * Additive (NV-API-CONTRACT-001): `citationsPresent` is now exactly
     * `authoritiesDelivered > 0`, and this field is the count behind that
     * boolean so a partner can show "3 authorities" without re-deriving it from
     * the `citations` envelope. A `0` here with a long, confident answer is the
     * signal that the answer is ungrounded prose.
     */
    authoritiesDelivered?: number;
    qualityOk: boolean;
    compliancePassed: boolean;
  };
  agentsUsed?: number;
  orchestrationPattern?: string;
  autoOrchestrated?: boolean;
  requestId: string;
  tier?: string;
  safetyVerdict?: unknown;
  compliancePassed?: boolean;
  /** Queen / AdaptiveRouter depth signals (partners: do not guess from content alone). */
  osDepth?: {
    queenCotApplied?: boolean;
    contextEngineering?: unknown;
    path: string;
  };
  /**
   * NV-COMPLETION-DRIVEN-001 — lifecycle phase of this request.
   *
   * Partner-visible on purpose. `osDepth` carries the same class of signal but is
   * stripped for partners by `sanitizeOrchestrationPayloadForClient`, so a partner
   * that had to distinguish "still working" from "failed" was left inferring it
   * from an HTTP abort — which is exactly how a completed draft got reported to
   * users as `DRAFT_AI_TIMEOUT`. This field is the supported way to tell them
   * apart and must NOT be added to the sanitizer's delete list.
   */
  requestPhase?: RequestPhase;
  /**
   * True when the answer is complete but an OPTIONAL enrichment (extra CoT,
   * a hung memory source) was dropped so the request could progress.
   * A success signal, not an error: content is present and safety gates ran.
   */
  optionalDegraded?: boolean;
  /**
   * Stable orchestration id for the whole run, when the request took the Queen.
   *
   * `requestId` is per-HTTP-call, so a partner that retries or polls gets a new
   * one and cannot prove two calls belong to the same piece of work. The Queen
   * already mints and enforces this id (`requireOrchestrationId`) for its span
   * tags and AG-UI lifecycle filter; it was simply never surfaced on the sync
   * response, only on `/orchestrate/stream`. Absent on the specialist path,
   * which is a single call with no fan-out to correlate.
   */
  orchestrationId?: string;
  /**
   * NV-DRAFT-QUALITY-001 — human-like voice + placeholder + authority signals for
   * NSP drafting UX (attestation gate, review badge).
   */
  draftQuality?: DraftQualityEnvelope;
  /**
   * NV-DRAFT-PROFILE-ASSEMBLER-001 (NSP FB-468 P0) — filing-book profile: enclosure
   * checklist, service modes, echoed `nvTemplateKey` / `filingBookRowId`. Emitted on
   * partner draft task types (`legal-draft` / `doc-draft` and aliases).
   */
  draftProfile?: DraftProfile;
  /**
   * NV-DRAFT-PROFILE-ASSEMBLER-001 — one assembler over `structureMarkers` +
   * filing checklist + advisory `filingContext`; NSP renders the validation panel.
   */
  validationResults?: DraftValidationResult[];
  /**
   * NV-DRAFT-FORMATTED-BLOCKS-001 — deterministic, ready-to-insert draft text
   * blocks (enclosure list, limitation clause, court-fee note, service modes).
   * Mirror of `draftProfile.formattedBlocks` at the top level for convenience.
   */
  formattedBlocks?: DraftFormattedBlock[];
  /**
   * NV-ANALYZE-STATUS-005 — promoted to top-level when court-doc field block is
   * present (was nested in extras only).
   */
  analysisStatus?: AnalysisStatus;
  analysisStatusReason?: string;
  /**
   * NV-ATTESTATION-001 — NSP must collect advocate attestation before export when
   * true (review recommended, RED badge, or unresolved field conflicts).
   */
  attestationRequired?: boolean;
  /**
   * The session this turn belongs to — echo it back on the next turn to continue.
   *
   * NV-SESSION-ECHO-001: for NSP/NYM the route MINTS an ecosystem session id when
   * the caller sends none (`mintEcosystemPromptSessionId`) and stores session
   * memory under it, but it was never returned. So a partner could not continue a
   * session it did not know the id of: every turn minted a fresh id, and the
   * session memory written on turn 1 was unreachable for turn 2 — multi-turn
   * continuity was impossible even though the storage side worked.
   */
  sessionId?: string;
}

function splitSections(content: string): Array<{ title: string; body: string }> {
  const text = String(content || '').trim();
  if (!text) return [];

  // Markdown ## headings
  const mdParts = text.split(/\n(?=##\s+)/);
  if (mdParts.length > 1) {
    return mdParts.slice(0, 8).map((block, i) => {
      const lines = block.trim().split('\n');
      const title = lines[0].replace(/^#+\s*/, '').trim() || `Section ${i + 1}`;
      const body = lines.slice(1).join('\n').trim() || lines[0];
      return { title, body };
    });
  }

  // Numbered / bullet blocks
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paras.length >= 2) {
    return paras.slice(0, 6).map((p, i) => ({
      title: `Point ${i + 1}`,
      body: p,
    }));
  }

  return [{ title: 'Answer', body: text.slice(0, 4000) }];
}

function firstSummary(content: string, max = 400): string {
  const t = String(content || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const last = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (last > 80 ? cut.slice(0, last + 1) : cut).trim() + '…';
}

function extractRecommendations(content: string): string[] {
  const lines = String(content || '').split('\n');
  const recs: string[] = [];
  for (const line of lines) {
    if (/^\s*[-*•]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const cleaned = line.replace(/^\s*[-*•]\s+/, '').replace(/^\s*\d+[.)]\s+/, '').trim();
      if (cleaned.length > 12 && cleaned.length < 280) recs.push(cleaned);
    }
    if (recs.length >= 5) break;
  }
  return recs;
}

export function buildCuratedOutcome(content: string, language?: string): CuratedOutcome {
  return {
    summary: firstSummary(content),
    sections: splitSections(content),
    recommendations: extractRecommendations(content),
    language,
  };
}

/** Zero-LLM layer ids stamped by the `/orchestrate` pre-Queen fast paths. */
const STATUTE_FAST_PATH_LAYERS = new Set(['nys_statute_map', 'nys_statute_faq']);
const DETERMINISTIC_LAYERS = new Set(['nys_deterministic']);

/**
 * NV-ZEROCOST-ATTRIBUTION-001 — read the mechanism off the orchestration
 * envelope the specialist ring already produces.
 *
 * Order matters. A statute fast path also reports zero tokens and a resolver-ish
 * model name, so layer evidence is consulted before the boolean flags; and
 * `cacheHit` outranks `deterministic` because a cached deterministic answer is
 * still, for cost purposes, a cache hit.
 *
 * Returns `null` rather than `'llm'` when nothing says otherwise: an absent
 * signal and a positively-identified model call must not look the same to a
 * consumer that is trying to decide whether a zero-cost answer was earned.
 */
export function deriveResolution(orchestration: unknown): {
  resolution: OrchestrationResolution;
  detail?: string;
} | null {
  if (!orchestration || typeof orchestration !== 'object') return null;
  const o = orchestration as Record<string, unknown>;

  const layers = Array.isArray(o.layersUsed) ? o.layersUsed.map((l) => String(l)) : [];
  const fastLayer = layers.find((l) => STATUTE_FAST_PATH_LAYERS.has(l));
  if (fastLayer) return { resolution: 'statute-fast-path', detail: fastLayer };
  const detLayer = layers.find((l) => DETERMINISTIC_LAYERS.has(l));
  if (detLayer) return { resolution: 'deterministic-resolver', detail: detLayer };

  if (o.cacheHit === true) {
    return {
      resolution: 'semantic-cache',
      detail: typeof o.cacheTier === 'string' ? `tier:${o.cacheTier}` : undefined,
    };
  }
  if (o.deterministic === true) {
    return {
      resolution: 'deterministic-resolver',
      detail: typeof o.deterministicResolver === 'string' ? o.deterministicResolver : undefined,
    };
  }
  if (o.ragAbstain === true) return { resolution: 'rag-abstain' };
  return null;
}

/**
 * NV-CITE-GROUND-001 (2026-08-19) — count authorities actually DELIVERED in the
 * answer, not "did the citation step run".
 *
 * The previous expression was
 * `Array.isArray(citations) ? citations.length > 0 : !!(citations && typeof citations === 'object')`.
 * The verifier does not return an array — it returns
 * `{ verified, unverified, details[] }` — so the second branch always ran, and
 * ANY envelope satisfied it. `{ verified: 0, unverified: 0, details: [] }`
 * reported `citationsPresent: true`. Measured live: a 6,925-char research answer
 * with zero case citations reported `trust.citationsPresent: true`.
 *
 * That is the same failure class the partner hit twice (FB-189 / FB-195): an
 * assumed contract failing silently as an empty result. An honest `false` is the
 * desired outcome here — it is a badge, not a gate (nothing in this repo branches
 * on it; see the ledger entry).
 *
 * Both shapes are handled because the field is typed `unknown` and different
 * paths populate it: the specialist/Queen paths pass the verifier envelope, and
 * the deterministic path passes a `DeterministicCitation[]`.
 */
export function countDeliveredAuthorities(citations: unknown): number {
  if (Array.isArray(citations)) {
    return citations.filter((c) => {
      if (c == null) return false;
      if (typeof c === 'string') return c.trim().length > 0;
      if (typeof c !== 'object') return false;
      const o = c as Record<string, unknown>;
      return [o.ref, o.text, o.citation, o.title].some(
        (v) => typeof v === 'string' && v.trim().length > 0,
      );
    }).length;
  }
  if (!citations || typeof citations !== 'object') return 0;
  const o = citations as Record<string, unknown>;
  if (Array.isArray(o.details)) return countDeliveredAuthorities(o.details);
  if (Array.isArray(o.citations)) return countDeliveredAuthorities(o.citations);
  const verified = Number(o.verified ?? 0);
  const unverified = Number(o.unverified ?? 0);
  const total = (Number.isFinite(verified) ? verified : 0)
    + (Number.isFinite(unverified) ? unverified : 0);
  return total > 0 ? total : 0;
}

function derivePartnerTrust(input: {
  requestId: string;
  content: string;
  decision: AdaptiveRouterDecision;
  qualityEnvelope: QualityEnvelopeSnapshot;
  citations?: unknown;
  grounding?: unknown;
  safetyVerdict?: unknown;
  compliancePassed?: boolean;
}): {
  riskBadge: 'GREEN' | 'YELLOW' | 'RED';
  auditHash: string;
  trust: {
    grounded: boolean;
    citationsPresent: boolean;
    authoritiesDelivered: number;
    qualityOk: boolean;
    compliancePassed: boolean;
  };
} {
  const risk = String(input.decision?.risk || 'medium').toLowerCase();
  let riskBadge: 'GREEN' | 'YELLOW' | 'RED' =
    risk === 'low' || risk === 'minimal' ? 'GREEN'
      : risk === 'high' || risk === 'critical' ? 'RED'
        : 'YELLOW';

  const sv = input.safetyVerdict as Record<string, unknown> | null | undefined;
  const svBadge = String(sv?.badge || sv?.riskBadge || '').toUpperCase();
  if (svBadge === 'GREEN' || svBadge === 'YELLOW' || svBadge === 'RED') {
    riskBadge = svBadge;
  }

  const qe = input.qualityEnvelope as QualityEnvelopeSnapshot & {
    missingMandatory?: string[];
    ok?: boolean;
    passed?: boolean;
  };
  const missing = Array.isArray(qe?.missingMandatory) ? qe.missingMandatory.length : 0;
  const qualityOk = missing === 0 && qe?.ok !== false && qe?.passed !== false;
  if (!qualityOk) riskBadge = 'RED';

  const authoritiesDelivered = countDeliveredAuthorities(input.citations);
  const citationsPresent = authoritiesDelivered > 0;
  /* `grounded` keeps its own meaning: retrieval/grounding metadata was produced.
   * It must NOT collapse into `citationsPresent`, or the two badges would carry
   * one bit between them and a partner could no longer distinguish "we retrieved
   * context but the answer cited nothing" (the exact defect this fixes) from
   * "we retrieved nothing at all". */
  const grounded = !!(input.grounding)
    || citationsPresent
    || /ground/i.test(String((input.grounding as any)?.status || ''));

  const compliancePassed = input.compliancePassed !== false;
  if (!compliancePassed && riskBadge === 'GREEN') riskBadge = 'YELLOW';

  const auditHash = createHash('sha256')
    .update(
      JSON.stringify({
        requestId: input.requestId,
        content: String(input.content || '').slice(0, 8000),
        riskBadge,
        qualityOk,
      }),
    )
    .digest('hex')
    .slice(0, 32);

  return {
    riskBadge,
    auditHash,
    trust: {
      grounded,
      citationsPresent,
      authoritiesDelivered,
      qualityOk,
      compliancePassed,
    },
  };
}

/** Count unresolved CONFLICT fields from court-doc / docparse block. */
export function countUnresolvedCourtDocConflicts(
  courtDocBlock: Record<string, unknown> | null | undefined,
): number {
  if (!courtDocBlock || typeof courtDocBlock !== 'object') return 0;
  const docparseMeta = courtDocBlock.docparseMeta as Record<string, unknown> | undefined;
  const conflictFields = Array.isArray(docparseMeta?.conflictFields)
    ? docparseMeta!.conflictFields
    : [];
  if (conflictFields.length > 0) return conflictFields.length;
  const fields = Array.isArray(courtDocBlock.fields) ? courtDocBlock.fields : [];
  return fields.filter((f) => {
    if (!f || typeof f !== 'object') return false;
    const status = String((f as Record<string, unknown>).status || '').toUpperCase();
    return status === 'CONFLICT';
  }).length;
}

export function computeDraftQuality(input: {
  content: string;
  riskBadge: 'GREEN' | 'YELLOW' | 'RED';
  authoritiesDelivered: number;
  taskType?: string;
  abruptEnding?: boolean;
  citationVerified?: boolean;
  structureMarkers?: DraftStructureMarkers;
  documentType?: DraftDocumentType | string;
  parameters?: Record<string, unknown>;
  documentTypeResolution?: DraftDocumentTypeResolution;
}): DraftQualityEnvelope {
  const completion = analyzeDraftCompletion(input.content);
  let resolvedDocType: DraftDocumentType | undefined;
  try {
    resolvedDocType = resolveDraftDocumentType({
      documentType: input.documentType,
      parameters: input.parameters,
    });
  } catch {
    resolvedDocType = undefined;
  }
  const structureMarkers = input.structureMarkers
    ?? analyzeDraftStructureMarkers(input.content, resolvedDocType);
  const placeholdersRemaining = Math.max(
    countPartnerPlaceholders(input.content),
    completion.unresolvedPlaceholders,
  );
  const voiceOk = countPartnerAiMarkerHits(input.content) === 0;
  const counselDraft = isCounselOrDraftTaskType(input.taskType);
  const citationVerified = input.citationVerified !== false;
  const pleadingCompletion = usesPleadingCompletionRules(resolvedDocType);
  const structureIncomplete = counselDraft
    && !structureMarkersComplete(structureMarkers, resolvedDocType);
  const completionReview = pleadingCompletion
    ? completion.reviewRecommended
    : completion.unresolvedPlaceholders > 0;
  const reviewRecommended =
    input.riskBadge !== 'GREEN'
    || placeholdersRemaining > 0
    || (counselDraft && input.abruptEnding === true)
    || (counselDraft && completionReview)
    || (counselDraft && input.authoritiesDelivered === 0)
    || (counselDraft && !citationVerified)
    || structureIncomplete;

  return {
    voiceOk,
    placeholdersRemaining,
    authoritiesDelivered: input.authoritiesDelivered,
    reviewRecommended,
    citationVerified,
    structureMarkers,
    ...(input.documentTypeResolution?.wasInferred
      ? {
          inferredDocumentType: input.documentTypeResolution.documentType,
          documentTypeSource: input.documentTypeResolution.source,
          ...(input.documentTypeResolution.rawInput
            ? { partnerDocumentTypeRaw: input.documentTypeResolution.rawInput.slice(0, 64) }
            : {}),
        }
      : {}),
  };
}

export function computeAttestationRequired(input: {
  reviewRecommended: boolean;
  riskBadge: 'GREEN' | 'YELLOW' | 'RED';
  courtDocBlock?: Record<string, unknown> | null;
}): boolean {
  if (input.reviewRecommended) return true;
  if (input.riskBadge === 'RED') return true;
  return countUnresolvedCourtDocConflicts(input.courtDocBlock) > 0;
}

export function buildUnifiedOrchestrationContract(input: {
  content: string;
  requestId: string;
  decision: AdaptiveRouterDecision;
  qualityEnvelope: QualityEnvelopeSnapshot;
  tokens: { prompt?: number; completion?: number; total?: number; input?: number; output?: number };
  latencyMs: number;
  model?: string;
  provider?: string;
  resolution?: OrchestrationResolution;
  resolutionDetail?: string;
  leafCacheHits?: number;
  chainOfThought?: unknown;
  citations?: unknown;
  grounding?: unknown;
  hallucinationCheck?: unknown;
  agentsUsed?: number;
  orchestrationPattern?: string;
  autoOrchestrated?: boolean;
  tier?: string;
  safetyVerdict?: unknown;
  compliancePassed?: boolean;
  /** OS depth signals for partners (Queen CoT / context engineering). */
  osDepth?: {
    queenCotApplied?: boolean;
    contextEngineering?: unknown;
    path: string;
  };
  /**
   * NV-COMPLETION-DRIVEN-001 — Queen supplies this from `completionDrivenResultMeta`.
   * Omitted by non-Queen callers, who get `ready` derived below: a specialist that
   * returned content has, by definition, finished every stage it runs.
   */
  requestPhase?: RequestPhase;
  optionalDegraded?: boolean;
  /** Stable Queen-run id; omitted on the specialist path. */
  orchestrationId?: string;
  /** Session this turn belongs to (minted for NSP/NYM when absent) — echoed back. */
  sessionId?: string;
  /** Partner taskType — drives draftQuality.reviewRecommended counsel/draft rule. */
  taskType?: string;
  citationVerified?: boolean;
  /** Optional override from structure checker pass (otherwise derived from content). */
  structureMarkers?: DraftStructureMarkers;
  /** Partner `parameters.documentType` — drives doc-type-aware structureMarkers (P1). */
  documentType?: string;
  parameters?: Record<string, unknown>;
  /** Top-level partner options (draftLength tier). */
  options?: Record<string, unknown>;
  /** NV-DOCUMENT-TYPE-INFERENCE-001 — inference metadata for draftQuality envelope. */
  documentTypeResolution?: DraftDocumentTypeResolution;
  /**
   * NV-FILING-CONTEXT-HINT-001 (NSP FB-468 P0) — advisory filing-book hint parsed
   * by the route (captures top-level `filingBookRowId`). When omitted, the builder
   * parses it from `parameters.filingContext`.
   */
  filingContext?: FilingContextHint;
  /** NV-AI-COMPLETION-LOOP-001 — set by orchestration routes after completion seam. */
  completion?: PartnerCompletionEnvelope;
  extras?: Record<string, unknown>;
}): UnifiedOrchestrationContract & Record<string, unknown> {
  const callerPrompt = Number(input.tokens.prompt ?? input.tokens.input ?? 0);
  const callerCompletion = Number(input.tokens.completion ?? input.tokens.output ?? 0);
  const callerTotal = Number(input.tokens.total ?? callerPrompt + callerCompletion);

  /* NV-METER-ENVELOPE-001 (2026-08-16) — prefer the request-scoped accumulator over
   * the caller-supplied figure.
   *
   * Callers pass the tokens of the call they know about: the specialist path passes
   * its single LLM response, and the Queen path passes `metadata.totalTokens`, which
   * only counts what the Queen itself tallied. Measured on jrx-staging, a swarm request
   * billed 5 completions while the envelope reported 1 — so every cost number
   * derived from this field was understated, and the discrepancy was only findable
   * by grepping provider log lines on the host.
   *
   * `recordLlmUsage()` is called by the orchestrator after EVERY provider call, so
   * the accumulator is the only place that already sees the true total. We take it
   * when it is non-zero, and fall back to the caller's value otherwise (worker/cron
   * contexts have no accumulator, and a cache hit legitimately has zero calls).
   *
   * Billing is unaffected — `nvAICreditEnforcer.record()` already reads this same
   * accumulator. This aligns what we REPORT with what we already CHARGE. */
  const usage = getRequestUsage();
  const useAccumulator = !!usage && usage.calls > 0;
  const prompt = useAccumulator ? usage!.promptTokens : callerPrompt;
  const completion = useAccumulator ? usage!.completionTokens : callerCompletion;
  const total = useAccumulator ? prompt + completion : callerTotal;
  const partnerTrust = derivePartnerTrust(input);

  const base: UnifiedOrchestrationContract & Record<string, unknown> = {
    content: input.content,
    curated: buildCuratedOutcome(input.content, input.decision.detectedLanguage),
    cost: {
      tokens: { prompt, completion, total },
      latencyMs: input.latencyMs,
      model: input.model,
      provider: input.provider,
      path: input.decision.path,
      ...(input.resolution ? { resolution: input.resolution } : {}),
      ...(input.resolutionDetail ? { resolutionDetail: input.resolutionDetail } : {}),
      ...(typeof input.leafCacheHits === 'number' && input.leafCacheHits > 0
        ? { leafCacheHits: input.leafCacheHits }
        : {}),
      ...(usage ? { completions: usage.calls } : {}),
      ...(usage && usage.wastedCalls > 0
        ? {
            wasted: {
              completions: usage.wastedCalls,
              promptTokens: usage.wastedPromptTokens,
              completionTokens: usage.wastedCompletionTokens,
              costUsd: usage.wastedCostUsd,
            },
          }
        : {}),
    },
    routing: {
      path: input.decision.path,
      reason: input.decision.reason,
      complexity: input.decision.complexity,
      risk: input.decision.risk,
      detectedLanguage: input.decision.detectedLanguage,
      docTask: input.decision.docTask,
      primaryCapabilityIds: input.decision.primaryCapabilityIds,
    },
    qualityEnvelope: input.qualityEnvelope,
    riskBadge: partnerTrust.riskBadge,
    auditHash: partnerTrust.auditHash,
    trust: partnerTrust.trust,
    requestId: input.requestId,
    osDepth: input.osDepth ?? {
      path: input.decision.path,
      queenCotApplied: false,
      contextEngineering: null,
    },
    /* NV-COMPLETION-DRIVEN-001 — always emit a phase.
     *
     * Deriving the default from content rather than defaulting to `ready`
     * unconditionally: a builder call that produced no content has not reached a
     * usable outcome, and labelling that `ready` would tell a partner to render an
     * empty draft. Content present + this builder reached = every stage the path
     * runs has completed, so `ready` is honest for the specialist path too. */
    requestPhase:
      input.requestPhase ?? (String(input.content || '').trim() ? 'ready' : 'failed_infra'),
    ...(input.optionalDegraded ? { optionalDegraded: true } : {}),
    ...(input.orchestrationId ? { orchestrationId: input.orchestrationId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.chainOfThought != null ? { chainOfThought: input.chainOfThought } : {}),
    ...(input.citations != null ? { citations: input.citations } : {}),
    ...(input.grounding != null ? { grounding: input.grounding } : {}),
    ...(input.hallucinationCheck != null ? { hallucinationCheck: input.hallucinationCheck } : {}),
    ...(input.agentsUsed != null ? { agentsUsed: input.agentsUsed } : {}),
    ...(input.orchestrationPattern != null ? { orchestrationPattern: input.orchestrationPattern } : {}),
    ...(input.autoOrchestrated != null ? { autoOrchestrated: input.autoOrchestrated } : {}),
    ...(input.tier != null ? { tier: input.tier } : {}),
    ...(input.safetyVerdict != null ? { safetyVerdict: input.safetyVerdict } : {}),
    ...(input.compliancePassed != null ? { compliancePassed: input.compliancePassed } : {}),
  };

  if (input.extras) Object.assign(base, input.extras);

  const courtDocBlock =
    (input.extras && typeof input.extras === 'object')
      ? input.extras as Record<string, unknown>
      : null;
  const hasCourtDocFields =
    !!courtDocBlock
    && (
      Array.isArray(courtDocBlock.fields)
      || courtDocBlock.analysisStatus != null
      || courtDocBlock.fieldSource != null
    );

  if (hasCourtDocFields) {
    const status = courtDocBlock!.analysisStatus;
    if (status === 'structured' || status === 'unstructured' || status === 'failed') {
      base.analysisStatus = status;
    }
    if (typeof courtDocBlock!.analysisStatusReason === 'string') {
      base.analysisStatusReason = courtDocBlock!.analysisStatusReason;
    }
  }

  const taskType = input.taskType ?? String(input.decision?.docTask || '');
  const draftQuality = computeDraftQuality({
    content: String(input.content || ''),
    riskBadge: partnerTrust.riskBadge,
    authoritiesDelivered: partnerTrust.trust.authoritiesDelivered ?? 0,
    taskType,
    abruptEnding: analyzeDraftCompletion(String(input.content || '')).abruptEnding,
    citationVerified: input.citationVerified,
    structureMarkers: input.structureMarkers,
    documentType: input.documentType,
    parameters: input.parameters,
    documentTypeResolution: input.documentTypeResolution,
  });

  if (isPartnerDraftTaskType(taskType)) {
    const params = input.parameters && typeof input.parameters === 'object'
      ? input.parameters
      : {};
    const nestedOptions = params.options && typeof params.options === 'object'
      ? (params.options as Record<string, unknown>)
      : {};
    const topOptions = input.options && typeof input.options === 'object'
      ? input.options
      : {};
    const routingHint = buildDraftRoutingHint({
      documentType: input.documentType ?? params.documentType,
      parameters: params,
      taskType,
      prompt: params.prompt ?? params.instruction,
      draftLength: topOptions.draftLength ?? nestedOptions.draftLength ?? params.draftLength,
      options: { ...nestedOptions, ...topOptions },
    });
    if (routingHint) {
      draftQuality.routingHint = routingHint;
      base.routing_hint = routingHint;
    }

    /* NV-DRAFT-PROFILE-ASSEMBLER-001 (NSP FB-468 P0) — emit draftProfile +
     * validationResults on the draft response. One deterministic assembler over
     * the already-computed structureMarkers + filing checklist + advisory
     * filingContext (parsed here when the route did not pre-parse it). */
    try {
      let resolvedDocType: DraftDocumentType =
        input.documentTypeResolution?.documentType ?? 'general_legal_document';
      if (!input.documentTypeResolution) {
        try {
          resolvedDocType = resolveDraftDocumentType({
            documentType: input.documentType,
            parameters: input.parameters,
            taskType,
          });
        } catch {
          resolvedDocType = draftQuality.inferredDocumentType ?? 'general_legal_document';
        }
      }
      const filingContext =
        input.filingContext ?? parseFilingContextHint({ parameters: input.parameters });
      const { draftProfile, validationResults } = assembleDraftProfile({
        documentType: resolvedDocType,
        structureMarkers: draftQuality.structureMarkers,
        filingContext,
        documentTypeResolution: input.documentTypeResolution,
      });
      base.draftProfile = draftProfile;
      if (validationResults.length > 0) base.validationResults = validationResults;

      /* NV-LEGAL-DRAFT-AGENTIC-001 — Tier D1: emit the agentic pipeline provenance
       * (plan → research → draft → self-validate) + a verdict derived from the
       * same validationResults[] (no second scoring pass). */
      if (isAgenticDraftTaskType(taskType)) {
        const plan = buildAgenticDraftPlan({
          documentType: resolvedDocType,
          nvTemplateKey: filingContext?.nvTemplateKey ?? input.documentTypeResolution?.nvTemplateKey,
          prompt: String((input.parameters as Record<string, unknown> | undefined)?.prompt ?? ''),
        });
        base.agenticDraft = summarizeAgenticDraftRun({
          plan,
          validationResults,
          drafted: String(input.content || '').trim().length > 0,
        });
      }
      /* NV-DRAFT-FORMATTED-BLOCKS-001 — mirror the ready-to-insert blocks at the
       * top level so NSP can consume them without reaching into draftProfile. */
      if (draftProfile.formattedBlocks && draftProfile.formattedBlocks.length > 0) {
        base.formattedBlocks = draftProfile.formattedBlocks;
      }

      /* NV-PARTNER-AI-LOG-001 — structured, secret-free draft-outcome log line
       * (metadata only; NV-SECRETS-001: no prompt body). The metering middleware
       * writes the durable DB row; this line adds the structureMarkers summary +
       * intent provenance that only exist at this seam. */
      logPartnerDraftOutcome({
        requestId: input.requestId,
        taskType,
        resolvedDocType,
        draftProfile,
        validationResults,
        structureMarkers: draftQuality.structureMarkers,
        documentTypeResolution: input.documentTypeResolution,
        filingContext,
      });
    } catch {
      /* profile assembly is additive — never fail the response over it */
    }
  }

  if (input.completion) {
    draftQuality.completionStatus = input.completion.status;
    draftQuality.continuationAvailable = input.completion.continuationAvailable;
    draftQuality.continuationCount = input.completion.continuationCount;
    draftQuality.completion = input.completion;
    base.completion = input.completion;
    base.completionStatus = input.completion.status;
    base.continuationAvailable = input.completion.continuationAvailable;
    if (input.completion.status === 'incomplete') {
      base.requestPhase = 'degraded';
      base.optionalDegraded = true;
    }
  }

  base.draftQuality = draftQuality;
  base.attestationRequired = computeAttestationRequired({
    reviewRecommended: draftQuality.reviewRecommended,
    riskBadge: partnerTrust.riskBadge,
    courtDocBlock: hasCourtDocFields ? courtDocBlock : null,
  });

  return sanitizeOrchestrationPayloadForClient(base);
}
