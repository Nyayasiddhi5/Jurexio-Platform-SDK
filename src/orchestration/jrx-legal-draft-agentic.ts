/**
 * NV-LEGAL-DRAFT-AGENTIC-001 — Tier D1 agentic drafting pipeline (deterministic
 * orchestration over LIVE NYV SSoT; no second LLM pipeline — NV-NO-DUPLICATE-001,
 * NV-NO-STUB-001).
 *
 * The `legal-draft-agentic` taskType runs a four-stage counsel loop:
 *
 *   plan → research → draft → self-validate → validationResults[]
 *
 * This module owns the *deterministic* spine of that loop:
 *   - `buildAgenticDraftPlan()` composes the plan + research + draft stage
 *     descriptors from the existing registries (structure checklist, filing-book
 *     checklist, document-type agent pin, draft-length band). It never invents a
 *     stage — every descriptor is grounded in an existing SSoT.
 *   - `summarizeAgenticDraftRun()` turns the already-computed
 *     `validationResults[]` (from `assembleDraftProfile`) into a self-validate
 *     verdict + a bounded refine decision.
 *
 * The actual LLM work (research retrieval + drafting) is executed by the Queen
 * counsel path through the NV-ARCH-001 safety ring — this module does NOT call an
 * LLM. It is Queen-schedulable via the `draft_agentic` INTENT
 * (INTENT_CAPABILITY_MAP + analyzePrompt hint — NV-MESH-001), which binds to the
 * existing `agent.auto-select` / `rag.search` / `intelligence.precedent` /
 * `safety.citation-verify` leaves.
 */
import {
  DRAFT_LENGTH_REGISTRY,
  type DraftDocumentType,
  type DraftLengthTier,
} from '../config/jrx-draft-length-registry.js';
import { resolveFilingChecklist } from '../config/jrx-filing-checklist-registry.js';
import { INDIAN_DRAFT_STRUCTURE_CHECKLIST } from '../services/jrx-indian-draft-structure-registry.js';
import { DOCUMENT_TYPE_AGENT_PIN } from '../services/jrx-document-type-agent-pin.js';
import type { DraftValidationResult } from './jrx-draft-profile-assembler.js';

/** Queen INTENT token for the agentic-draft mesh binding (see capability-manifest). */
export const AGENTIC_DRAFT_INTENT = 'draft_agentic';

/** Research leaves the plan schedules (bound in INTENT_CAPABILITY_MAP → draft_agentic). */
export const AGENTIC_DRAFT_RESEARCH_CAPABILITIES = [
  'rag.search',
  'intelligence.precedent',
  'intelligence.statute-verify',
] as const;

/**
 * NV-LEGAL-DRAFT-AGENTIC-001 — recognise the agentic draft taskType family.
 * `-agentic` is a distinct latency/quality contract (multi-stage counsel loop),
 * NOT a synonym of bare `legal-draft` or the `-fast` SLA alias.
 */
export function isAgenticDraftTaskType(taskType?: string): boolean {
  const tt = String(taskType || '').trim();
  if (!tt) return false;
  return /^(legal[_-]?draft|doc[_-]?draft|document[_-]?draft)[_-]agentic$/i.test(tt);
}

export type AgenticDraftStageName = 'plan' | 'research' | 'draft' | 'self_validate';
export type AgenticDraftStageStatus = 'planned' | 'complete' | 'refine_recommended' | 'skipped';

export interface AgenticDraftStage {
  stage: AgenticDraftStageName;
  status: AgenticDraftStageStatus;
  detail: string;
  /** Capability leaves this stage engages (mesh provenance). */
  capabilityIds?: string[];
}

export interface AgenticDraftPlan {
  documentType: DraftDocumentType;
  nvTemplateKey?: string;
  /** Ordered structure sections counsel expects (Indian drafting registry). */
  structureSections: string[];
  /** Mandatory + recommended enclosures (filing-book checklist). */
  filingChecklistLabels: string[];
  /** Retrieval leaves + query hints the research stage runs. */
  researchCapabilityIds: string[];
  researchQueries: string[];
  /** Specialist drafting agent (document-type pin). */
  draftingAgentId: string;
  /** Target output band for the draft stage. */
  targetTier: DraftLengthTier;
  targetTokens: number;
  /** The four stage descriptors, in execution order. */
  stages: AgenticDraftStage[];
}

/** Derive concise research queries from the doc type + filing basis (no LLM). */
function buildResearchQueries(
  documentType: DraftDocumentType,
  nvTemplateKey: string | undefined,
  filingBases: string[],
  prompt?: string,
): string[] {
  const queries = new Set<string>();
  const pretty = documentType.replace(/_/g, ' ');
  queries.add(`Governing procedure and mandatory contents for a ${pretty} (India)`);
  if (nvTemplateKey) {
    queries.add(`Statutory basis and precedents for ${nvTemplateKey.replace(/_/g, ' ')}`);
  }
  // Distinct statutory bases from the filing checklist become precedent queries.
  for (const basis of filingBases.slice(0, 4)) {
    if (basis && !/practice$/i.test(basis)) {
      queries.add(`Leading precedents on ${basis}`);
    }
  }
  const p = String(prompt || '').trim();
  if (p) queries.add(`Facts to address: ${p.slice(0, 160)}`);
  return [...queries].slice(0, 6);
}

/**
 * Build the deterministic agentic-draft plan. Every field is sourced from an
 * existing registry — the plan is a *schedule*, not generated content.
 */
export function buildAgenticDraftPlan(input: {
  documentType: DraftDocumentType;
  nvTemplateKey?: string;
  prompt?: string;
  targetTier?: DraftLengthTier;
}): AgenticDraftPlan {
  const { documentType, nvTemplateKey } = input;
  const structureSections = [...(INDIAN_DRAFT_STRUCTURE_CHECKLIST[documentType] ?? [])];
  const checklist = resolveFilingChecklist({ nvTemplateKey, documentType });
  const filingChecklistLabels = checklist.rows.map((r) => r.label);
  const filingBases = checklist.rows.map((r) => r.basis);
  const draftingAgentId = DOCUMENT_TYPE_AGENT_PIN[documentType] ?? 'A-004';
  const spec = DRAFT_LENGTH_REGISTRY[documentType];
  // Agentic drafting defaults to the counsel (comprehensive) band unless pinned.
  const targetTier: DraftLengthTier = input.targetTier ?? 'comprehensive';
  const targetTokens =
    targetTier === 'comprehensive'
      ? spec.comprehensiveTokens
      : targetTier === 'low'
        ? spec.lowTokens
        : spec.defaultTokens;
  const researchQueries = buildResearchQueries(documentType, nvTemplateKey, filingBases, input.prompt);
  const researchCapabilityIds = [...AGENTIC_DRAFT_RESEARCH_CAPABILITIES];

  const stages: AgenticDraftStage[] = [
    {
      stage: 'plan',
      status: 'complete',
      detail:
        `Resolved ${documentType}${nvTemplateKey ? ` (${nvTemplateKey})` : ''}: `
        + `${structureSections.length} structure section(s), ${filingChecklistLabels.length} enclosure(s), `
        + `pinned specialist ${draftingAgentId}.`,
      capabilityIds: ['agent.auto-select'],
    },
    {
      stage: 'research',
      status: 'planned',
      detail:
        `${researchQueries.length} grounded research query(ies) over precedent + statute + RAG `
        + `before drafting (counsel-grade evidence).`,
      capabilityIds: researchCapabilityIds,
    },
    {
      stage: 'draft',
      status: 'planned',
      detail:
        `Specialist ${draftingAgentId} drafts to the ${targetTier} band (~${targetTokens} tokens) `
        + `following the ${structureSections.length}-section envelope through the safety ring.`,
      capabilityIds: ['agent.auto-select', 'safety.citation-verify'],
    },
    {
      stage: 'self_validate',
      status: 'planned',
      detail:
        'Structure + enclosure + limitation validation via assembleDraftProfile → validationResults[]; '
        + 'one bounded refine pass when a mandatory check fails.',
      capabilityIds: ['safety.citation-verify', 'safety.hallucination-check'],
    },
  ];

  return {
    documentType,
    ...(nvTemplateKey ? { nvTemplateKey } : {}),
    structureSections,
    filingChecklistLabels,
    researchCapabilityIds,
    researchQueries,
    draftingAgentId,
    targetTier,
    targetTokens,
    stages,
  };
}

export interface AgenticDraftReport {
  taskType: 'legal-draft-agentic';
  intent: string;
  plan: AgenticDraftPlan;
  stages: AgenticDraftStage[];
  /** Self-validate outcome derived from validationResults[]. */
  verdict: 'pass' | 'refine_recommended';
  /** Validation rows that failed (drive the refine decision). */
  failingChecks: Array<{ id: string; label: string; detail?: string }>;
  /** True when a bounded refine pass is advised (>=1 mandatory failure). */
  refinePassRecommended: boolean;
}

/**
 * Fold the already-computed `validationResults[]` into a self-validate verdict.
 * Deterministic; reuses the single assembler pass (no re-scoring).
 */
export function summarizeAgenticDraftRun(input: {
  plan: AgenticDraftPlan;
  validationResults: DraftValidationResult[];
  /** True once draft content exists (draft stage executed). */
  drafted?: boolean;
}): AgenticDraftReport {
  const failing = input.validationResults.filter((v) => v.status === 'fail');
  const failingChecks = failing.map((v) => ({
    id: v.id,
    label: v.label,
    ...(v.detail ? { detail: v.detail } : {}),
  }));
  const verdict: AgenticDraftReport['verdict'] = failing.length > 0 ? 'refine_recommended' : 'pass';

  const stages = input.plan.stages.map((s): AgenticDraftStage => {
    if (s.stage === 'research' || s.stage === 'draft') {
      return { ...s, status: input.drafted ? 'complete' : s.status };
    }
    if (s.stage === 'self_validate') {
      return {
        ...s,
        status: verdict === 'refine_recommended' ? 'refine_recommended' : 'complete',
        detail:
          verdict === 'refine_recommended'
            ? `${failing.length} mandatory check(s) failed: ${failing.map((f) => f.label).join('; ')} — refine pass recommended.`
            : `All structural / enclosure checks passed (${input.validationResults.length} row(s)).`,
      };
    }
    return s;
  });

  return {
    taskType: 'legal-draft-agentic',
    intent: AGENTIC_DRAFT_INTENT,
    plan: input.plan,
    stages,
    verdict,
    failingChecks,
    refinePassRecommended: failing.length > 0,
  };
}
