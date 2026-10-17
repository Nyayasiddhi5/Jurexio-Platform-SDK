/**
 * NV-ORCH-CONTENT-ENFORCE-001 — post-synthesis counsel-grade enforcers shared
 * by Queen and specialist orchestrate paths.
 */

import { resolveDraftDocumentType, type DraftDocumentType } from '../config/jrx-draft-length-registry.js';
import { enforceDraftPlaceholders } from './jrx-draft-placeholder-enforcer.js';
import { enforceResearchAuthorities } from './jrx-research-authority-enforcer.js';
import type { RetrievedSourceLine } from './jrx-sources-consulted-enforcer.js';
import {
  analyzeDraftCompletion,
  analyzeDraftStructureMarkers,
  applyDraftCompletionPolish,
  structureMarkersComplete,
  type DraftStructureMarkers,
} from './jrx-draft-completion.js';
import { applyDraftStructureChecker } from './jrx-draft-structure-checker.js';
import {
  isPartnerExplicitFastDraftAlias,
  isPartnerCounselOrDraftTask,
} from '../utils/jrx-partner-platform.js';
import { isCounselOrDraftTaskType } from '../utils/jrx-partner-human-polish.js';

export interface OrchestrationContentEnforcerOpts {
  taskType?: string;
  query?: string;
  documentType?: string;
  parameters?: Record<string, unknown>;
  citations?: unknown;
  contextBlock?: string;
  ragContext?: {
    chunks?: Array<{ title?: string; authorityRef?: string; citationRef?: string; content?: string }>;
  } | null;
  retrievedSources?: RetrievedSourceLine[];
  partnerLean?: boolean;
}

export function applyOrchestrationContentEnforcers(
  content: string,
  opts: OrchestrationContentEnforcerOpts = {},
): string {
  let out = String(content || '');

  const research = enforceResearchAuthorities(out, {
    taskType: opts.taskType,
    citations: opts.citations,
    contextBlock: opts.contextBlock,
    ragContext: opts.ragContext,
    retrievedSources: opts.retrievedSources,
  });
  out = research.content;

  let documentType: DraftDocumentType | undefined;
  try {
    documentType = resolveDraftDocumentType({
      documentType: opts.documentType,
      taskType: opts.taskType,
      prompt: opts.query,
      parameters: opts.parameters,
    });
  } catch {
    documentType = undefined;
  }

  const placeholders = enforceDraftPlaceholders(out, {
    taskType: opts.taskType,
    query: opts.query,
    documentType,
    minPlaceholders: 3,
  });
  out = placeholders.content;

  return out;
}

const counselPlaceholderExitThreshold = (): number =>
  Number(process.env.JRX_COUNSEL_EXIT_PLACEHOLDER_THRESHOLD || 10);

/** R-DRAFT-NSP-QUALITY P3 — counsel exit needs deterministic closure before optional Sonnet checker. */
export function counselDraftExitNeedsPolish(
  content: string,
  documentType?: DraftDocumentType,
): boolean {
  const text = String(content || '');
  if (!text.trim()) return false;
  const completion = analyzeDraftCompletion(text);
  if (completion.abruptEnding || completion.truncatedPrayer || completion.incompleteNumberedPara) {
    return true;
  }
  if (completion.unresolvedPlaceholders >= counselPlaceholderExitThreshold()) return true;
  if (documentType && !structureMarkersComplete(analyzeDraftStructureMarkers(text, documentType), documentType)) {
    return !completion.complete || completion.reviewRecommended;
  }
  return completion.reviewRecommended && !completion.complete;
}

/**
 * NV-DRAFT-COMPLETION-001 / P3 — deterministic closure on bare counsel paths
 * (mirrors fast-delivery polish; no extra LLM).
 */
export function applyOrchestrationCounselDraftExitPolish(
  content: string,
  opts: OrchestrationContentEnforcerOpts = {},
): string {
  const tt = String(opts.taskType || '');
  if (opts.partnerLean === true) return content;
  if (isPartnerExplicitFastDraftAlias(tt)) return content;
  if (!isCounselOrDraftTaskType(tt) && !isPartnerCounselOrDraftTask(tt)) return content;

  let documentType: DraftDocumentType | undefined;
  try {
    documentType = resolveDraftDocumentType({
      documentType: opts.documentType,
      taskType: opts.taskType,
      prompt: opts.query,
      parameters: opts.parameters,
    });
  } catch {
    return content;
  }

  if (!counselDraftExitNeedsPolish(content, documentType)) return content;

  return applyDraftCompletionPolish(content, {
    documentType,
    appendClosure: true,
    tier: 'comprehensive',
    trimRunaway: true,
  }).content;
}

/** NV-DRAFT-STRUCTURE-CHECKER-001 — bounded Sonnet pass on counsel/comprehensive exit (max 1/request). */
export async function applyOrchestrationDraftStructureChecker(
  content: string,
  opts: OrchestrationContentEnforcerOpts = {},
): Promise<{ content: string; structureMarkers?: DraftStructureMarkers }> {
  const checked = await applyDraftStructureChecker(content, {
    taskType: opts.taskType,
    documentType: opts.documentType,
    partnerLean: opts.partnerLean,
    parameters: opts.parameters,
    prompt: opts.query,
  });
  return {
    content: checked.content,
    ...(checked.checkerApplied ? { structureMarkers: checked.structureMarkers } : {}),
  };
}
