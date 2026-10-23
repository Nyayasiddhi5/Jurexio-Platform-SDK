/**
 * NV-DRAFT-STRUCTURE-CHECKER-001 — Sonnet structure pass on `-fast` when
 * structureMarkers incomplete. Mirrors jrx-fast-delivery-polish (512 tokens, 8s).
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../utils/logger.js';
import {
  analyzeDraftCompletion,
  analyzeDraftStructureMarkers,
  structureMarkersComplete,
  usesPleadingCompletionRules,
  type DraftStructureMarkers,
} from './jrx-draft-completion.js';
import {
  resolveDraftDocumentType,
  type DraftDocumentType,
} from '../config/jrx-draft-length-registry.js';
import {
  isPartnerExplicitFastDraftAlias,
  shouldSkipExpensiveDraftFastSteps,
} from '../utils/jrx-partner-platform.js';
import { isCounselOrDraftTaskType } from '../utils/jrx-partner-human-polish.js';
import { isTransactionalDraftDocumentType } from './jrx-indian-draft-structure-registry.js';
import { isSpecialLeavePetitionDraftContext } from '../utils/jrx-partner-platform.js';
import { getRequestUsage } from '../utils/jrx-request-usage-context.js';
import { formatIndianDraftStructureChecklist } from './jrx-indian-draft-structure-registry.js';
import { buildSlpPaperbookOverlay } from './jrx-agent-draft-overlay.js';
import {
  betaStructureCheckerMaxTokensCounsel,
  betaStructureCheckerMaxTokensFast,
  isBetaQualityFirst,
} from '../config/jrx-beta-quality-profile.js';

const logger = createLogger('./jrx-draft-structure-checker');

export interface StructureCheckerResult {
  content: string;
  structureMarkers: DraftStructureMarkers;
  checkerApplied: boolean;
}

export function isDraftStructureCheckerEnabled(): boolean {
  const v = String(process.env.JRX_DRAFT_STRUCTURE_CHECKER ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

function resolveCheckerDocumentType(opts: {
  documentType?: string;
  parameters?: Record<string, unknown>;
  prompt?: string;
  taskType?: string;
}): DraftDocumentType | undefined {
  try {
    return resolveDraftDocumentType({
      documentType: opts.documentType,
      parameters: opts.parameters,
      prompt: opts.prompt,
      taskType: opts.taskType,
    });
  } catch {
    return undefined;
  }
}

const LONG_PLEADING_STRUCTURE_CHECK_TYPES = new Set<DraftDocumentType>([
  'written_statement',
  'writ_petition',
  'review_petition',
  'execution_petition',
  'interlocutory_application',
]);

function isCounselDraftExitPath(opts: { taskType?: string; partnerLean?: boolean }): boolean {
  if (opts.partnerLean === true) return false;
  if (isPartnerExplicitFastDraftAlias(opts.taskType)) return false;
  return isCounselOrDraftTaskType(opts.taskType);
}

function hasExplicitDraftDocumentType(opts: {
  documentType?: string;
  parameters?: Record<string, unknown>;
  prompt?: string;
  taskType?: string;
}): boolean {
  if (String(opts.documentType || '').trim()) return true;
  const p = opts.parameters?.documentType;
  if (typeof p === 'string' && p.trim().length > 0) return true;
  const prompt = String(opts.prompt || '').trim();
  if (prompt.length < 12) return false;
  return !!resolveCheckerDocumentType(opts);
}

function counselExitStructureCheckEligible(
  docType?: DraftDocumentType,
  ctx?: {
    documentType?: string;
    parameters?: Record<string, unknown>;
    prompt?: string;
  },
): boolean {
  if (!docType) return false;
  if (isTransactionalDraftDocumentType(docType)) return true;
  if (LONG_PLEADING_STRUCTURE_CHECK_TYPES.has(docType)) return true;
  if (
    docType === 'writ_petition'
    && isSpecialLeavePetitionDraftContext({
      documentType: ctx?.documentType ?? docType,
      prompt: ctx?.prompt,
      parameters: ctx?.parameters,
    })
  ) {
    return true;
  }
  return usesPleadingCompletionRules(docType);
}

export function shouldRunDraftStructureChecker(opts: {
  taskType?: string;
  content?: string;
  partnerLean?: boolean;
  documentType?: string;
  parameters?: Record<string, unknown>;
  prompt?: string;
}): boolean {
  if (!isDraftStructureCheckerEnabled()) return false;
  const usage = getRequestUsage();
  if (usage?.draftStructureCheckerApplied) return false;

  const docType = resolveCheckerDocumentType(opts);
  const markers = analyzeDraftStructureMarkers(String(opts.content || ''), docType);
  const incomplete = !structureMarkersComplete(markers, docType);
  if (!incomplete) return false;

  const isFast = isPartnerExplicitFastDraftAlias(opts.taskType) || opts.partnerLean === true;
  if (isFast) return true;

  const completion = analyzeDraftCompletion(String(opts.content || ''));
  const placeholderOverflow = completion.unresolvedPlaceholders
    >= Number(process.env.JRX_COUNSEL_EXIT_PLACEHOLDER_THRESHOLD || 10);
  const counselExitNeedsCompletion =
    isCounselDraftExitPath(opts)
    && counselExitStructureCheckEligible(docType, {
      documentType: opts.documentType,
      parameters: opts.parameters,
      prompt: opts.prompt,
    })
    && (
      incomplete
      || completion.abruptEnding
      || completion.truncatedPrayer
      || completion.incompleteNumberedPara
      || placeholderOverflow
    );

  if (counselExitNeedsCompletion && hasExplicitDraftDocumentType(opts)) {
    return true;
  }

  if (shouldSkipExpensiveDraftFastSteps(opts.taskType)) {
    return false;
  }
  return false;
}

function resolveStructureCheckerMaxTokens(taskType?: string): number {
  const isFast = isPartnerExplicitFastDraftAlias(taskType);
  if (isBetaQualityFirst()) {
    return isFast ? betaStructureCheckerMaxTokensFast() : betaStructureCheckerMaxTokensCounsel();
  }
  if (isFast) {
    return Number(process.env.JRX_DRAFT_STRUCTURE_CHECKER_MAX_TOKENS || 512);
  }
  return Number(process.env.JRX_DRAFT_STRUCTURE_CHECKER_COUNSEL_MAX_TOKENS || 2048);
}

async function sonnetStructurePass(
  content: string,
  opts: {
    taskType?: string;
    documentType?: string;
    parameters?: Record<string, unknown>;
    prompt?: string;
  },
): Promise<string | null> {
  const budgetMs = Number(process.env.JRX_DRAFT_STRUCTURE_CHECKER_BUDGET_MS || 8000);
  const { realLLMService } = await import('./real-llm-service.js');

  const docType = resolveCheckerDocumentType(opts);
  const checklist = formatIndianDraftStructureChecklist({
    documentType: opts.documentType ?? docType,
    parameters: opts.parameters,
    prompt: opts.prompt,
    taskType: opts.taskType,
  });
  const slpOverlay = buildSlpPaperbookOverlay({
    documentType: opts.documentType ?? docType,
    parameters: opts.parameters,
    prompt: opts.prompt,
  });
  const completion = analyzeDraftCompletion(content);
  const completionHint = completion.abruptEnding || completion.truncatedPrayer
    ? 'The draft appears truncated — complete PRAYER, advocate block, and VERIFICATION/AFFIDAVIT in full; finish any cut-off numbered paragraph.'
    : '';

  const prompt = [
    'Review this Indian legal draft for filing structure only.',
    'Return JSON: {"prayerAdded":bool,"verificationAdded":bool,"causeTitleAdded":bool,"numberedParasFixed":bool,"patchedDraft":"..."}',
    'If structure is complete, set patchedDraft to the original text unchanged.',
    'Do not invent facts, parties, or citations. Add only missing PRAYER/VERIFICATION/cause title/numbered paragraphs using [[PLACEHOLDER: …]] where needed.',
    completionHint,
    checklist ? `Mandatory checklist for this instrument:\n${checklist}` : '',
    slpOverlay ? `Supreme Court SLP paper-book sections:\n${slpOverlay}` : '',
    '',
    content.slice(0, 12_000),
  ].filter(Boolean).join('\n');

  try {
    const llmPromise = realLLMService.executeRequest({
      id: randomUUID(),
      userId: 'system',
      prompt,
      systemPrompt:
        'You are an Indian filing-structure checker. Output valid JSON only. Never add new case citations.',
      maxTokens: resolveStructureCheckerMaxTokens(opts.taskType),
      temperature: 0.1,
      tier: 'plus',
      taskKind: opts.taskType || 'legal-draft-fast',
      jurisdiction: 'IN',
      requirements: {
        complexity: 'simple',
        domain: 'analytical',
        priority: 'medium',
        costBudget: 'minimal',
        responseTime: 'fastest',
        qualityLevel: 'standard',
      },
      fallbackLevels: 1,
      timestamp: new Date(),
    } as Parameters<typeof realLLMService.executeRequest>[0]);

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), budgetMs);
    });
    const resp = await Promise.race([llmPromise, timeoutPromise]);
    if (!resp?.content) {
      logger.warn('[NV-DRAFT-STRUCTURE-CHECKER-001] Sonnet pass timed out');
      return null;
    }

    const raw = String(resp.content).trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as { patchedDraft?: string };
    const patched = String(parsed.patchedDraft || '').trim();
    return patched.length > 40 ? patched : null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[NV-DRAFT-STRUCTURE-CHECKER-001] checker skipped: ${msg}`);
    return null;
  }
}

export async function applyDraftStructureChecker(
  content: string,
  opts: {
    taskType?: string;
    documentType?: string;
    partnerLean?: boolean;
    parameters?: Record<string, unknown>;
    prompt?: string;
  } = {},
): Promise<StructureCheckerResult> {
  const docType = resolveCheckerDocumentType(opts);
  const baseMarkers = analyzeDraftStructureMarkers(content, docType);
  if (!shouldRunDraftStructureChecker({ ...opts, content })) {
    return { content, structureMarkers: baseMarkers, checkerApplied: false };
  }

  const usage = getRequestUsage();
  if (usage?.draftStructureCheckerApplied) {
    return { content, structureMarkers: baseMarkers, checkerApplied: false };
  }
  if (usage) usage.draftStructureCheckerApplied = true;

  logger.info('[NV-DRAFT-STRUCTURE-CHECKER-001] incomplete structure — Sonnet pass');
  const patched = await sonnetStructurePass(content, {
    taskType: opts.taskType,
    documentType: opts.documentType,
    parameters: opts.parameters,
    prompt: opts.prompt,
  });
  if (!patched) {
    return { content, structureMarkers: baseMarkers, checkerApplied: false };
  }

  const postMarkers = analyzeDraftStructureMarkers(patched, docType);
  return {
    content: patched,
    structureMarkers: postMarkers,
    checkerApplied: true,
  };
}
