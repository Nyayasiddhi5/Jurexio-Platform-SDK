/**
 * NV-INDIAN-DRAFT-EVAL-RUBRIC-001 — deterministic SME rubric per DraftDocumentType.
 * SSoT for runtime + eval harness (Phase 4). No LLM calls.
 */
import {
  resolveDraftDocumentType,
  validateDraftContentLength,
  type DraftDocumentType,
  type DraftLengthTier,
} from '../config/jrx-draft-length-registry.js';
import {
  analyzeDraftCompletion,
  analyzeDraftCompletionForDocument,
  analyzeDraftStructureMarkers,
  usesPleadingCompletionRules,
} from './jrx-draft-completion.js';

export interface IndianDraftRubricInput {
  content: string;
  documentType: string;
  /** R-DRAFT-RUBRIC-TIER-001 — score length against selected tier, not comprehensive char minima. */
  draftLength?: DraftLengthTier;
  parameters?: Record<string, unknown>;
  prompt?: string;
}

export interface IndianDraftRubricScore {
  total: number;
  maxTotal: number;
  pct: number;
  structure: number;
  completion: number;
  length: number;
  voice: number;
  placeholders: number;
  markers: ReturnType<typeof analyzeDraftStructureMarkers>;
  completionDetail: ReturnType<typeof analyzeDraftCompletion>;
  lengthWarning?: string;
  voiceHits: string[];
}

const CHATBOT_PENALTY = [
  /certainly!/i,
  /here'?s a draft/i,
  /as an ai/i,
  /in conclusion,/i,
  /i hope this helps/i,
];

const FORUM_PENALTY = /\b(republic of india|jurisdiction:\s*india)\b/i;

function structureScore(
  markers: ReturnType<typeof analyzeDraftStructureMarkers>,
  docType: DraftDocumentType,
): number {
  const weights: Array<[keyof typeof markers, number]> = [
    ['causeTitle', 15],
    ['numberedParas', 15],
    ['prayer', 25],
    ['verification', 20],
    ['limitationChecked', 25],
  ];
  if (
    docType === 'legal_notice'
    || docType === 'reply_legal_notice'
    || docType === 'simple_agreement'
    || docType === 'complex_agreement'
  ) {
    weights[2] = ['prayer', 20];
    weights[3] = ['verification', 15];
  }
  let earned = 0;
  let max = 0;
  for (const [k, w] of weights) {
    max += w;
    if (markers[k]) earned += w;
  }
  return max ? Math.round((earned / max) * 100) : 0;
}

function completionScore(
  analysis: ReturnType<typeof analyzeDraftCompletion>,
  docType: DraftDocumentType,
): number {
  if (!usesPleadingCompletionRules(docType)) {
    let s = analysis.complete ? 100 : 55;
    if (analysis.abruptEnding) s -= 35;
    if (analysis.unresolvedPlaceholders > 6) {
      s -= Math.min(25, (analysis.unresolvedPlaceholders - 6) * 4);
    }
    s -= Math.min(15, analysis.missingSections.length * 5);
    return Math.max(0, s);
  }
  let s = 100;
  if (analysis.abruptEnding) s -= 35;
  if (!analysis.hasPrayerOrRelief) s -= 25;
  if (!analysis.hasVerification && !analysis.hasSignatureBlock) s -= 15;
  if (analysis.incompleteNumberedPara) s -= 15;
  if (analysis.truncatedPrayer) s -= 20;
  s -= Math.min(20, analysis.missingSections.length * 8);
  return Math.max(0, s);
}

function lengthScore(
  content: string,
  docType: DraftDocumentType,
  tier: DraftLengthTier,
): { score: number; warning?: string } {
  const v = validateDraftContentLength(content, docType, tier);
  if (v.withinRange) return { score: 100 };
  if (v.belowMin) return { score: 40, warning: v.warning };
  if (v.aboveMax) return { score: 85, warning: v.warning };
  return { score: 75, warning: v.warning };
}

function voiceScore(content: string, parameters?: Record<string, unknown>): { score: number; hits: string[] } {
  const hits: string[] = [];
  for (const re of CHATBOT_PENALTY) {
    if (re.test(content)) hits.push(re.source);
  }
  const hasForum = Boolean(
    parameters?.highCourt || parameters?.courtName || parameters?.district,
  );
  if (hasForum && FORUM_PENALTY.test(content) && !/high court|sessions|district|magistrate|supreme court/i.test(content)) {
    hits.push('generic_forum_only');
  }
  const penalty = Math.min(40, hits.length * 12);
  return { score: Math.max(0, 100 - penalty), hits };
}

function placeholderScore(content: string, promptHasFacts: boolean): number {
  const n = (content.match(/\[\[PLACEHOLDER:[^\]]+\]\]/gi) || []).length;
  const bracket = (content.match(/\[[^\]]{3,40}\]/g) || []).length;
  const total = n + Math.floor(bracket / 2);
  if (!promptHasFacts) return total <= 8 ? 100 : Math.max(40, 100 - (total - 8) * 5);
  if (total === 0) return 100;
  if (total <= 3) return 85;
  if (total <= 8) return 65;
  return Math.max(30, 100 - total * 6);
}

/** Weighted SME rubric (structure 30%, completion 30%, length 15%, voice 15%, placeholders 10%). */
export function scoreIndianDraftRubric(input: IndianDraftRubricInput): IndianDraftRubricScore {
  const content = String(input.content || '');
  const docType = resolveDraftDocumentType({
    documentType: input.documentType,
    parameters: input.parameters,
    prompt: input.prompt,
  });
  const tier: DraftLengthTier = input.draftLength ?? 'medium';
  const markers = analyzeDraftStructureMarkers(content, docType);
  const completionDetail = analyzeDraftCompletionForDocument(content, docType);
  const structure = structureScore(markers, docType);
  const completion = completionScore(completionDetail, docType);
  const { score: length, warning: lengthWarning } = lengthScore(content, docType, tier);
  const { score: voice, hits: voiceHits } = voiceScore(content, input.parameters);
  const placeholders = placeholderScore(content, Boolean(input.prompt && input.prompt.length > 200));

  const total =
    structure * 0.3 +
    completion * 0.3 +
    length * 0.15 +
    voice * 0.15 +
    placeholders * 0.1;
  const maxTotal = 100;

  return {
    total: Math.round(total * 10) / 10,
    maxTotal,
    pct: Math.round(total),
    structure,
    completion,
    length,
    voice,
    placeholders,
    markers,
    completionDetail,
    lengthWarning,
    voiceHits,
  };
}
