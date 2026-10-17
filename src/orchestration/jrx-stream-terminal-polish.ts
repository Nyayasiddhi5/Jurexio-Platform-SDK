/**
 * NV-STREAM-TERMINAL-POLISH-001 — post-stream deterministic polish for partner
 * `-fast` specialist SSE. Mirrors the sync nv-client chain (no extra LLM):
 *   applyLegalResponseFormatting → applyFastDeliveryPolish → applyPartnerHumanPolish
 *
 * Emits a corrective gated `text_delta` when polished body differs from streamed
 * accum so NSP editor replaces provisional tokens before `run_completed`.
 */

import { isNyvFeatureOn } from '../config/jrx-feature-flags.js';
import {
  isPartnerExplicitFastAlias,
  isPartnerExplicitFastChatAlias,
  isPartnerExplicitFastDraftAlias,
} from '../utils/jrx-partner-platform.js';
import { sanitizeOrchestrationContentForClient } from '../utils/jrx-client-outcome-sanitize.js';
import type { DraftDocumentTypeResolution } from '../config/jrx-draft-length-registry.js';
import type { AdaptiveRouterDecision } from './jrx-adaptive-router.js';
import type { QualityEnvelopeSnapshot } from './jrx-quality-envelope.js';
import { buildPartnerStreamCompletionEnvelope } from '../services/jrx-ai-completion-loop.js';
import { buildUnifiedOrchestrationContract } from './jrx-orchestration-response-contract.js';

export function isStreamTerminalPolishEnabled(): boolean {
  const direct = String(process.env.NYV_STREAM_TERMINAL_POLISH ?? '').trim().toLowerCase();
  if (direct === '0' || direct === 'false' || direct === 'off' || direct === 'no') return false;
  if (direct === '1' || direct === 'true' || direct === 'on' || direct === 'yes') return true;
  return isNyvFeatureOn('streamTerminalPolish');
}

/** Partner `-fast` / lean specialist stream only — Queen path untouched. */
export function shouldApplyStreamTerminalPolish(input: {
  partnerLean?: boolean;
  taskType?: string;
  /** NV-NSP-SLA-QE-001 — skip polish on pure SERP sync (Hub web-search P95). */
  serpOnly?: boolean;
}): boolean {
  if (!isStreamTerminalPolishEnabled()) return false;
  if (input.serpOnly) return false;
  if (/^web[_-]?search$/i.test(String(input.taskType || ''))) return false;
  return !!(input.partnerLean || isPartnerExplicitFastAlias(input.taskType));
}

export interface StreamTerminalPolishOpts {
  prompt: string;
  taskType?: string;
  jurisdiction?: string;
  agentKey?: string;
  forceLegalBestOutcome?: boolean;
  documentType?: string;
  parameters?: Record<string, unknown>;
  ragAttempted?: boolean;
  ragGrounded?: boolean;
  statutePrefetchApplied?: boolean;
  ragContextBlock?: string;
}

export async function applyStreamTerminalPolish(
  rawContent: string,
  opts: StreamTerminalPolishOpts,
): Promise<{ content: string; changed: boolean; citationVerified?: boolean }> {
  const sanitizedBefore = sanitizeOrchestrationContentForClient(String(rawContent ?? ''));
  let content = sanitizedBefore;
  let citationVerified = true;

  try {
    const { applyLegalResponseFormatting } = await import('../services/jrx-legal-response-format.js');
    content = applyLegalResponseFormatting(content, {
      jurisdiction: opts.jurisdiction,
      taskType: opts.taskType,
      query: opts.prompt,
      comprehensive: opts.forceLegalBestOutcome === true
        && !isPartnerExplicitFastChatAlias(opts.taskType),
    });
  } catch { /* non-fatal */ }
  try {
    const { applyFastDeliveryPolish, draftDeliveryNeedsClosingSections } = await import('../services/jrx-fast-delivery-polish.js');
    content = await applyFastDeliveryPolish(content, {
      taskType: opts.taskType,
      query: opts.prompt,
      jurisdiction: opts.jurisdiction,
      documentType: opts.documentType,
      parameters: opts.parameters,
    });
    if (isPartnerExplicitFastDraftAlias(opts.taskType) && draftDeliveryNeedsClosingSections(content, opts.taskType)) {
      const { applyDraftCompletionPolish } = await import('../services/jrx-draft-completion.js');
      const { resolveDraftDocumentType } = await import('../config/jrx-draft-length-registry.js');
      const docType = resolveDraftDocumentType({
        documentType: opts.documentType,
        taskType: opts.taskType,
        prompt: opts.prompt,
        parameters: opts.parameters,
      });
      content = applyDraftCompletionPolish(content, { documentType: docType, appendClosure: true }).content;
    }
  } catch { /* non-fatal */ }
  try {
    const { applyPartnerHumanPolish } = await import('../utils/jrx-partner-human-polish.js');
    content = applyPartnerHumanPolish(content, {
      taskType: opts.taskType,
      agentKey: opts.agentKey,
      includeDisclaimer: opts.agentKey !== 'mitra-conversational',
    });
  } catch { /* non-fatal */ }
  try {
    const { applyPartnerFastPostProcess } = await import('../services/jrx-fast-delivery-polish.js');
    const post = await applyPartnerFastPostProcess(content, {
      taskType: opts.taskType,
      query: opts.prompt,
      jurisdiction: opts.jurisdiction,
      parameters: opts.parameters,
      ragAttempted: opts.ragAttempted,
      ragGrounded: opts.ragGrounded,
      statutePrefetchApplied: opts.statutePrefetchApplied,
      ragContextBlock: opts.ragContextBlock,
    });
    content = post.content;
    citationVerified = post.citationVerified;
  } catch { /* non-fatal */ }

  content = sanitizeOrchestrationContentForClient(content);
  return { content, changed: content !== sanitizedBefore, citationVerified };
}

export function buildPartnerStreamRunCompletedResult(input: {
  content: string;
  runId: string;
  sessionId?: string;
  taskType?: string;
  effectiveTier?: string;
  streamAdaptive: AdaptiveRouterDecision;
  qualityEnvelope: QualityEnvelopeSnapshot;
  safetyOk?: boolean;
  latencyMs?: number;
  model?: string;
  citationVerified?: boolean;
  /** Sync-parity draft metadata for NSP stream run_completed (NV-NSP-STREAM-META-001). */
  documentType?: string;
  parameters?: Record<string, unknown>;
  options?: Record<string, unknown>;
  documentTypeResolution?: DraftDocumentTypeResolution;
  webSearch?: Record<string, unknown>;
}): Record<string, unknown> {
  const completion = buildPartnerStreamCompletionEnvelope({
    content: input.content,
    taskType: input.taskType,
    requestId: input.runId,
    options: input.options,
  });
  const unified = buildUnifiedOrchestrationContract({
    content: input.content,
    requestId: input.runId,
    decision: input.streamAdaptive,
    qualityEnvelope: input.qualityEnvelope,
    tokens: { prompt: 0, completion: 0, total: 0 },
    latencyMs: input.latencyMs ?? 0,
    model: input.model ?? 'stream-specialist',
    provider: 'orchestrator',
    tier: input.effectiveTier,
    compliancePassed: input.safetyOk !== false,
    completion,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    taskType: String(input.taskType || ''),
    citationVerified: input.citationVerified,
    ...(input.documentType ? { documentType: input.documentType } : {}),
    ...(input.parameters ? { parameters: input.parameters } : {}),
    ...(input.options ? { options: input.options } : {}),
    ...(input.documentTypeResolution ? { documentTypeResolution: input.documentTypeResolution } : {}),
    osDepth: { path: 'specialist', queenCotApplied: false, contextEngineering: null },
  });

  return {
    ...unified,
    traceId: input.runId,
    result: input.content,
    ...(input.webSearch ? { webSearch: input.webSearch } : {}),
    routing: {
      ...(unified.routing as Record<string, unknown>),
      ...(input.safetyOk !== undefined ? { safetyOk: input.safetyOk } : {}),
    },
  };
}
