/**
 * NV-NSP-FB468-P0-001 — C3 contract probe (no LLM, no secrets).
 *
 * Exercises the reconciled filing-book wire offline:
 *   parameters.filingContext → buildUnifiedOrchestrationContract → draftProfile +
 *   validationResults[] on partner draft task types (sync + stream terminal builder).
 *
 * Run: npx tsx scripts/jrx-probe-fb468-draft-profile-contract.ts
 * Wired: npm run guardrail:orch-stage (via nv-guardrail-orch-stage-contract.ts)
 */
import type { AdaptiveRouterDecision } from '../src/orchestration/jrx-adaptive-router.js';
import type { QualityEnvelopeSnapshot } from '../src/orchestration/jrx-quality-envelope.js';
import { buildUnifiedOrchestrationContract } from '../src/orchestration/jrx-orchestration-response-contract.js';
import { buildPartnerStreamRunCompletedResult } from '../src/orchestration/jrx-stream-terminal-polish.js';
import { wrapPartnerRunCompletedSseEvent } from '../src/orchestration/jrx-partner-run-completed-sse.js';

const stubDecision = {
  path: 'specialist',
  reason: 'fb468-probe',
  complexity: 'medium',
  risk: 'low',
} as AdaptiveRouterDecision;

const stubQuality = { ok: true, passed: true, missingMandatory: [] } as QualityEnvelopeSnapshot;

const filingParameters = {
  documentType: 'civil_caveat',
  filingContext: {
    nvTemplateKey: 'civil_caveat',
    filingBookRowId: 'probe-row-1',
    filingBookVersion: 'FB-468.v1',
    advisoryOnly: true,
  },
};

const draftContent =
  'IN THE HIGH COURT OF JUDICATURE AT MADRAS\nCAVEAT PETITION\n1. Facts...\nPRAYER\nVERIFICATION';

function assertDraftProfileShape(label: string, payload: Record<string, unknown>): void {
  const profile = payload.draftProfile as Record<string, unknown> | undefined;
  if (!profile || typeof profile !== 'object') {
    throw new Error(`${label}: missing draftProfile`);
  }
  if (profile.documentType !== 'caveat') {
    throw new Error(`${label}: draftProfile.documentType expected caveat, got ${String(profile.documentType)}`);
  }
  if (profile.templateKey !== 'civil_caveat') {
    throw new Error(`${label}: draftProfile.templateKey expected civil_caveat`);
  }
  if (profile.filingBookRowId !== 'probe-row-1') {
    throw new Error(`${label}: draftProfile.filingBookRowId mismatch`);
  }
  const checklist = profile.filingChecklist;
  if (!Array.isArray(checklist) || checklist.length === 0) {
    throw new Error(`${label}: draftProfile.filingChecklist must be non-empty`);
  }
  const advisory = profile.advisory as Record<string, unknown> | undefined;
  if (!advisory || advisory.advisoryOnly !== true) {
    throw new Error(`${label}: draftProfile.advisory.advisoryOnly must be true`);
  }
  const validation = payload.validationResults;
  if (!Array.isArray(validation) || validation.length === 0) {
    throw new Error(`${label}: validationResults must be non-empty`);
  }
  const dq = payload.draftQuality as Record<string, unknown> | undefined;
  if (!dq || typeof dq !== 'object') {
    throw new Error(`${label}: draftQuality must remain present`);
  }

  /* NV-DRAFT-PROFILE-LIMITATION-001 / C-14 procedural — civil_caveat maps to 90-day
   * procedural window; courtFee.applicable=true; formattedBlocks include enclosure. */
  const limitation = profile.limitation as Record<string, unknown> | undefined;
  if (!limitation || typeof limitation !== 'object') {
    throw new Error(`${label}: draftProfile.limitation must be present`);
  }
  if (limitation.applicable !== true || limitation.limitationPeriod !== '90 days') {
    throw new Error(`${label}: caveat limitation should be applicable procedural 90 days`);
  }
  const courtFee = profile.courtFee as Record<string, unknown> | undefined;
  if (!courtFee || courtFee.applicable !== true) {
    throw new Error(`${label}: caveat courtFee must be applicable:true`);
  }
  const blocks = profile.formattedBlocks;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error(`${label}: draftProfile.formattedBlocks must be non-empty`);
  }
  const topBlocks = payload.formattedBlocks;
  if (!Array.isArray(topBlocks) || topBlocks.length !== blocks.length) {
    throw new Error(`${label}: top-level formattedBlocks must mirror draftProfile.formattedBlocks`);
  }
}

function assertValuedPlaintFee(label: string, payload: Record<string, unknown>): void {
  const profile = payload.draftProfile as Record<string, unknown> | undefined;
  const courtFee = profile?.courtFee as Record<string, unknown> | undefined;
  const computed = courtFee?.computed as Record<string, unknown> | undefined;
  if (!computed || typeof computed.total !== 'number') {
    throw new Error(`${label}: valued plaint must carry a computed court fee`);
  }
}

function main(): void {
  const sync = buildUnifiedOrchestrationContract({
    content: draftContent,
    requestId: 'fb468-probe-sync',
    decision: stubDecision,
    qualityEnvelope: stubQuality,
    tokens: { prompt: 0, completion: 0, total: 0 },
    latencyMs: 1,
    model: 'probe',
    provider: 'probe',
    taskType: 'doc-draft-fast',
    documentType: 'civil_caveat',
    parameters: filingParameters,
  }) as Record<string, unknown>;

  assertDraftProfileShape('sync orchestrate contract', sync);

  const stream = buildPartnerStreamRunCompletedResult({
    content: draftContent,
    runId: 'fb468-probe-stream',
    taskType: 'doc-draft-fast',
    effectiveTier: 'standard',
    streamAdaptive: stubDecision,
    qualityEnvelope: stubQuality,
    documentType: 'civil_caveat',
    parameters: filingParameters,
  });

  assertDraftProfileShape('stream run_completed', stream);

  const sse = wrapPartnerRunCompletedSseEvent({
    runId: 'fb468-probe-stream',
    timestamp: '2026-09-21T00:00:00.000Z',
    result: stream,
  });
  if (!Array.isArray(sse.validationResults) || sse.validationResults.length === 0) {
    throw new Error('stream SSE event must mirror validationResults at event root');
  }
  if (!sse.draftProfile || typeof sse.draftProfile !== 'object') {
    throw new Error('stream SSE event must mirror draftProfile at event root');
  }

  // NV-DRAFT-PROFILE-COURTFEE-001 — valued plaint computes an ad-valorem fee.
  const valuedPlaint = buildUnifiedOrchestrationContract({
    content: 'IN THE COURT OF THE PRINCIPAL DISTRICT JUDGE\nPLAINT\n1. Facts...\nPRAYER\nVERIFICATION',
    requestId: 'fb468-probe-plaint',
    decision: stubDecision,
    qualityEnvelope: stubQuality,
    tokens: { prompt: 0, completion: 0, total: 0 },
    latencyMs: 1,
    taskType: 'legal-draft',
    documentType: 'civil_suit_plaint',
    parameters: {
      documentType: 'civil_suit_plaint',
      filingContext: { suitValue: 1000000, advisoryOnly: true },
    },
  }) as Record<string, unknown>;
  assertValuedPlaintFee('valued plaint court fee', valuedPlaint);

  console.log('NV-NSP-FB468-P0-001 C3 PASS — draftProfile + validationResults + limitation/courtFee/formattedBlocks shape OK (sync + stream + valued plaint)');
}

main();
