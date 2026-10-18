/**
 * NV-AI-COMPLETION-LOOP-001 — continuation segments until filing structure passes
 * or segment budget exhausts; surfaces NSP "Continue" when still incomplete.
 */

import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { createLogger } from '../utils/logger.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';
import {
  betaCompletionLoopMaxSegments,
  betaCompletionSegmentMaxTokens,
  isBetaQualityFirst,
} from '../config/jrx-beta-quality-profile.js';
import {
  analyzeDraftCompletion,
  applyDraftCompletionPolish,
  DRAFT_COMPLETION_PROMPT_RULE,
} from './jrx-draft-completion.js';
import {
  resolveDraftDocumentType,
  type DraftDocumentType,
} from '../config/jrx-draft-length-registry.js';
import { isPartnerDraftTaskType } from '../config/jrx-draft-length-registry.js';
import {
  isPartnerCounselOrDraftTask,
  isPartnerExplicitFastDraftAlias,
  resolvePartnerMaxOutputTokens,
} from '../utils/jrx-partner-platform.js';
import { getRequestUsage } from '../utils/jrx-request-usage-context.js';
import { formatIndianDraftStructureChecklist } from './jrx-indian-draft-structure-registry.js';

const logger = createLogger('./jrx-ai-completion-loop');

export type CompletionStatus = 'complete' | 'incomplete' | 'continued';

export interface PartnerCompletionEnvelope {
  status: CompletionStatus;
  continuationAvailable: boolean;
  continuationCount: number;
  incompleteReason?: 'abrupt_ending' | 'max_tokens' | 'structure' | 'segment_budget';
  hint?: string;
  /** Additive NSP wire — echo on next POST /orchestrate */
  continueRequest?: {
    options: {
      continueIncomplete: true;
      segmentIndex: number;
      priorRequestId?: string;
    };
  };
}

function envOff(name: string): boolean {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  return v === '0' || v === 'false' || v === 'no' || v === 'off';
}

export function isCompletionLoopEnabled(): boolean {
  if (envOff('JRX_F_BETA_COMPLETION_LOOP')) return false;
  return isJrxFeatureOn('betaCompletionLoop') || isBetaQualityFirst();
}

export function parsePartnerContinuationInput(req: Request): {
  active: boolean;
  priorContent: string;
  segmentIndex: number;
  priorRequestId?: string;
} {
  const body = (req.body || {}) as Record<string, unknown>;
  const options = body.options && typeof body.options === 'object'
    ? (body.options as Record<string, unknown>)
    : {};
  const continuation = body.continuation && typeof body.continuation === 'object'
    ? (body.continuation as Record<string, unknown>)
    : {};
  const active = options.continueIncomplete === true || continuation.continueIncomplete === true;
  const priorContent = String(
    options.priorContent
    ?? continuation.priorContent
    ?? body.priorContent
    ?? '',
  ).trim();
  const segmentIndex = Math.max(
    0,
    Math.floor(Number(options.segmentIndex ?? continuation.segmentIndex ?? 0) || 0),
  );
  const priorRequestId = String(
    options.priorRequestId ?? continuation.priorRequestId ?? '',
  ).trim() || undefined;
  return { active, priorContent, segmentIndex, priorRequestId };
}

export function shouldAttemptCompletionLoop(input: {
  taskType?: string;
  content: string;
  req?: Request;
}): boolean {
  if (!isCompletionLoopEnabled()) return false;
  const tt = String(input.taskType || '');
  if (!isPartnerDraftTaskType(tt) && !isPartnerCounselOrDraftTask(tt) && !/legal-chat|legal-draft|doc-draft/i.test(tt)) {
    return false;
  }
  const text = String(input.content || '').trim();
  if (!text) return false;
  const analysis = analyzeDraftCompletion(text);
  const usage = getRequestUsage();
  const finish = String(usage?.lastLlmFinishReason || '').toLowerCase();
  const hitLength = finish === 'length' || finish === 'max_tokens' || finish === 'model_length';
  return analysis.abruptEnding
    || analysis.truncatedPrayer
    || analysis.incompleteNumberedPara
    || hitLength
    || (isPartnerDraftTaskType(tt) && !analysis.complete && text.length > 400);
}

function mergeContinuationSegment(prior: string, segment: string): string {
  const a = prior.trimEnd();
  const b = segment.trimStart();
  if (!b) return a;
  if (b.startsWith(a.slice(-Math.min(80, a.length)))) return b;
  return `${a}\n\n${b}`;
}

function buildContinuationPrompt(input: {
  originalUserPrompt: string;
  priorContent: string;
  documentType?: DraftDocumentType;
  taskType?: string;
}): string {
  const tail = input.priorContent.slice(-14_000);
  const checklist = input.documentType
    ? formatIndianDraftStructureChecklist({
        documentType: input.documentType,
        taskType: input.taskType,
      })
    : '';
  return [
    'Continue the Indian legal draft below. Do NOT repeat earlier numbered paragraphs or headings.',
    'Finish any cut-off numbered paragraph, then complete PRAYER/RELIEF, advocate block, and VERIFICATION (or notice closing / agreement execution block as applicable).',
    DRAFT_COMPLETION_PROMPT_RULE,
    checklist ? `Checklist:\n${checklist}` : '',
    `Original user instruction (context only):\n${input.originalUserPrompt.slice(0, 2_000)}`,
    '--- DRAFT SO FAR ---',
    tail,
    '--- CONTINUE FROM HERE ---',
  ].filter(Boolean).join('\n\n');
}

/** NV-NSP-STREAM-META-002 — sync-shaped completion on stream `run_completed` (no extra LLM). */
export function buildPartnerStreamCompletionEnvelope(input: {
  content: string;
  taskType?: string;
  requestId: string;
  options?: Record<string, unknown>;
  continuationCount?: number;
  segmentIndex?: number;
}): PartnerCompletionEnvelope {
  const segmentIndex = Math.max(
    0,
    Math.floor(Number(input.segmentIndex ?? input.options?.segmentIndex ?? 0) || 0),
  );
  const usage = getRequestUsage();
  const continuationCount =
    input.continuationCount ?? usage?.completionLoopSegments ?? 0;
  return buildPartnerCompletionEnvelope({
    content: input.content,
    taskType: input.taskType,
    continuationCount,
    segmentIndex,
    requestId: input.requestId,
  });
}

export function buildPartnerCompletionEnvelope(input: {
  content: string;
  taskType?: string;
  continuationCount: number;
  segmentIndex: number;
  requestId: string;
  priorIncomplete?: boolean;
}): PartnerCompletionEnvelope {
  const analysis = analyzeDraftCompletion(input.content);
  const draftLike = isPartnerDraftTaskType(String(input.taskType || ''))
    || isPartnerCounselOrDraftTask(String(input.taskType || ''));
  const incomplete = analysis.abruptEnding
    || analysis.truncatedPrayer
    || analysis.incompleteNumberedPara
    || (draftLike && !analysis.complete && analysis.reviewRecommended);

  if (!incomplete) {
    const status: CompletionStatus = input.continuationCount > 0 ? 'continued' : 'complete';
    return {
      status,
      continuationAvailable: false,
      continuationCount: input.continuationCount,
    };
  }

  const maxSeg = betaCompletionLoopMaxSegments();
  const canContinue = input.segmentIndex < maxSeg;
  let incompleteReason: PartnerCompletionEnvelope['incompleteReason'] = 'abrupt_ending';
  if (input.continuationCount >= maxSeg) incompleteReason = 'segment_budget';
  const finish = String(getRequestUsage()?.lastLlmFinishReason || '').toLowerCase();
  if (finish === 'length' || finish === 'max_tokens') incompleteReason = 'max_tokens';

  const hint = canContinue
    ? 'This draft is incomplete. Tap Continue and re-post with options.continueIncomplete=true, options.priorContent=<this content>, and options.segmentIndex from continueRequest.'
    : 'This draft is incomplete. Counsel review or a new comprehensive request is recommended.';

  return {
    status: 'incomplete',
    continuationAvailable: canContinue,
    continuationCount: input.continuationCount,
    incompleteReason,
    hint,
    ...(canContinue
      ? {
          continueRequest: {
            options: {
              continueIncomplete: true,
              segmentIndex: input.segmentIndex + 1,
              priorRequestId: input.requestId,
            },
          },
        }
      : {}),
  };
}

export async function runOrchestrateCompletionLoop(input: {
  req: Request;
  content: string;
  taskType?: string;
  userPrompt: string;
  documentType?: string;
  parameters?: Record<string, unknown>;
  segmentIndex?: number;
}): Promise<{ content: string; continuationCount: number; segmentIndex: number }> {
  let content = String(input.content || '');
  let continuationCount = 0;
  let segmentIndex = Math.max(0, input.segmentIndex ?? 0);

  const cont = parsePartnerContinuationInput(input.req);
  if (cont.active && cont.priorContent) {
    content = mergeContinuationSegment(cont.priorContent, content);
    segmentIndex = cont.segmentIndex;
  }

  if (!shouldAttemptCompletionLoop({ taskType: input.taskType, content, req: input.req })) {
    return { content, continuationCount, segmentIndex };
  }

  let docType: DraftDocumentType | undefined;
  try {
    docType = resolveDraftDocumentType({
      documentType: input.documentType,
      taskType: input.taskType,
      prompt: input.userPrompt,
      parameters: input.parameters,
    });
  } catch {
    docType = undefined;
  }

  const maxSeg = betaCompletionLoopMaxSegments();
  const usage = getRequestUsage();
  const maxSegmentsThisRequest = Math.max(0, maxSeg - segmentIndex);

  for (let i = 0; i < maxSegmentsThisRequest; i += 1) {
    if (!shouldAttemptCompletionLoop({ taskType: input.taskType, content, req: input.req })) break;
    if (usage && usage.completionLoopSegments !== undefined && usage.completionLoopSegments >= maxSeg) break;

    const prompt = buildContinuationPrompt({
      originalUserPrompt: input.userPrompt,
      priorContent: content,
      documentType: docType,
      taskType: input.taskType,
    });
    const maxTokens = Math.min(
      betaCompletionSegmentMaxTokens(),
      resolvePartnerMaxOutputTokens(input.req, betaCompletionSegmentMaxTokens()),
    );

    try {
      const { realLLMService } = await import('./real-llm-service.js');
      const resp = await realLLMService.executeRequest({
        id: randomUUID(),
        userId: 'system',
        prompt,
        systemPrompt:
          'You are senior Indian counsel completing a partial draft. Output ONLY the continuation text to append — no preamble, no JSON.',
        maxTokens,
        temperature: 0.2,
        tier: isPartnerExplicitFastDraftAlias(input.taskType) ? 'plus' : 'pro',
        taskKind: input.taskType || 'legal-draft',
        jurisdiction: 'IN',
        requirements: {
          complexity: 'medium',
          domain: 'analytical',
          priority: 'high',
          costBudget: 'unlimited',
          responseTime: 'standard',
          qualityLevel: 'premium',
        },
        fallbackLevels: 2,
        timestamp: new Date(),
      } as unknown as Parameters<typeof realLLMService.executeRequest>[0]);

      const segment = String(resp?.content || '').trim();
      if (segment.length < 40) {
        logger.warn('[NV-AI-COMPLETION-LOOP-001] continuation segment too short — stop');
        break;
      }
      content = mergeContinuationSegment(content, segment);
      continuationCount += 1;
      segmentIndex += 1;
      if (usage) {
        usage.completionLoopSegments = (usage.completionLoopSegments ?? 0) + 1;
      }
      if (usage && (resp as { finishReason?: string })?.finishReason) {
        usage.lastLlmFinishReason = String((resp as { finishReason?: string }).finishReason);
      }
    } catch (err: unknown) {
      logger.warn('[NV-AI-COMPLETION-LOOP-001] continuation failed (non-fatal)', {
        err: err instanceof Error ? err.message : String(err),
      });
      break;
    }
  }

  if (isPartnerDraftTaskType(String(input.taskType || ''))) {
    const polished = applyDraftCompletionPolish(content, {
      documentType: docType,
      appendClosure: false,
      tier: isPartnerExplicitFastDraftAlias(input.taskType) ? 'medium' : 'comprehensive',
      trimRunaway: false,
    });
    content = polished.content;
  }

  return { content, continuationCount, segmentIndex };
}
