/**
 * NV-TRUST-TIER-001 — memory/RAG provenance gates (Beta).
 *
 * AI orchestrate output is not counsel-grade memory until explicitly accepted.
 * Eval / test traffic must never write durable recall.
 */

import type { Request } from 'express';
import { isNyvFeatureOn } from '../config/jrx-feature-flags.js';
import { isPartnerDraftTaskType } from '../config/jrx-draft-length-registry.js';
import {
  wantsNspNymBestOutcome,
  wantsPartnerDemoUnlimited,
} from '../utils/jrx-partner-platform.js';
import { analyzeDraftCompletion } from './jrx-draft-completion.js';

export type TrustTier =
  | 'T0_authority'
  | 'T1_matter_fact'
  | 'T2_session_scratch'
  | 'T3_ai_output'
  | 'T4_accepted_counsel'
  | 'T5_eval_test';

export function isTrustTierMemoryGateEnabled(): boolean {
  return isNyvFeatureOn('trustTierMemory');
}

export function isEvalOrTestOrchestrateRequest(req: Request, body?: Record<string, unknown>): boolean {
  const record = body && typeof body === 'object' ? body : ((req.body || {}) as Record<string, unknown>);
  const headers = req.headers || {};
  const evalHdr = String(headers['x-nyv-eval'] ?? headers['x-nyv-test'] ?? headers['x-nyv-fixture'] ?? '').toLowerCase();
  if (evalHdr === '1' || evalHdr === 'true' || evalHdr === 'yes') return true;
  const matterId = String(record.matterId ?? record.matter_id ?? '').toLowerCase();
  if (/^(eval|test|fixture|smoke|uat)[-_]/i.test(matterId)) return true;
  const sessionId = String(record.sessionId ?? record.session_id ?? '').toLowerCase();
  if (/^(eval|test|fixture|smoke|uat)[-_]/i.test(sessionId)) return true;
  const options = record.options && typeof record.options === 'object'
    ? (record.options as Record<string, unknown>)
    : {};
  if (options.evalFixture === true || options.testHarness === true) return true;
  return false;
}

export function isExplicitCounselMemoryAcceptance(body?: Record<string, unknown>): boolean {
  if (!body || typeof body !== 'object') return false;
  const options = body.options && typeof body.options === 'object'
    ? (body.options as Record<string, unknown>)
    : {};
  if (options.acceptToMatterKnowledge === true) return true;
  if (options.counselAccepted === true) return true;
  if (body.acceptToMatterKnowledge === true) return true;
  return false;
}

export interface OrchestrateMemoryWriteDecision {
  allowed: boolean;
  tier: TrustTier;
  reason: string;
}

/**
 * Whether post-orchestrate durable memory (graph / 5-tier / mem0) may persist this turn.
 */
export function decideOrchestrateMemoryWrite(input: {
  req: Request;
  taskType?: string;
  content?: string;
  body?: Record<string, unknown>;
}): OrchestrateMemoryWriteDecision {
  if (!isTrustTierMemoryGateEnabled()) {
    return { allowed: true, tier: 'T2_session_scratch', reason: 'gate_off' };
  }

  const body = input.body ?? ((input.req.body || {}) as Record<string, unknown>);
  if (isEvalOrTestOrchestrateRequest(input.req, body)) {
    return { allowed: false, tier: 'T5_eval_test', reason: 'eval_or_test_request' };
  }

  if (isExplicitCounselMemoryAcceptance(body)) {
    return { allowed: true, tier: 'T4_accepted_counsel', reason: 'explicit_acceptance' };
  }

  const tt = String(input.taskType || body.taskType || '');
  const isDraft = isPartnerDraftTaskType(tt);
  const completion = analyzeDraftCompletion(String(input.content || ''));
  if (isDraft || /draft|pleading|petition|notice|affidavit/i.test(tt)) {
    if (completion.abruptEnding || completion.truncatedPrayer || completion.incompleteNumberedPara) {
      return { allowed: false, tier: 'T3_ai_output', reason: 'incomplete_draft' };
    }
    return { allowed: false, tier: 'T3_ai_output', reason: 'unreviewed_draft_output' };
  }

  if (completion.abruptEnding && String(input.content || '').length > 200) {
    return { allowed: false, tier: 'T3_ai_output', reason: 'abrupt_chat_or_advisory' };
  }

  const ecosystem = wantsNspNymBestOutcome(input.req) || wantsPartnerDemoUnlimited(input.req);
  if (ecosystem) {
    return { allowed: true, tier: 'T2_session_scratch', reason: 'session_scratch_ecosystem' };
  }

  return { allowed: true, tier: 'T2_session_scratch', reason: 'session_scratch_default' };
}

/** Recall filter — drop unreviewed AI output nodes from graph recall when gate ON. */
export function isRecallTrustTierAllowed(metadata: Record<string, unknown> | undefined): boolean {
  if (!isTrustTierMemoryGateEnabled()) return true;
  if (!metadata || typeof metadata !== 'object') return true;
  const tier = String(metadata.trustTier || metadata.trust_tier || '');
  if (tier === 'T3_ai_output' || tier === 'T5_eval_test') return false;
  if (String(metadata.source || '') === 'ai_response_unreviewed') return false;
  return true;
}
