/**
 * NV-DRAFT-FAST-SLA-001 — an explicit `-fast` alias is a caller latency contract.
 *
 * Reported production symptom (NSP, Written Statement drafting):
 *   client: "Draft generation timed out. Please retry."
 *   cause : `legal-draft-fast` was classified as counsel/draft, so the
 *           counsel-Queen default vetoed the SLA and the request took the full
 *           best-outcome path — measured at 84.8s on jrx-prod.
 *
 * These tests pin both directions, because the failure mode on each side is
 * serious and opposite:
 *   - `-fast` NOT honoured  → multi-minute hang, user-visible timeout;
 *   - bare aliases wrongly made fast → silent quality loss on counsel work,
 *     which is far worse than a slow answer because nobody notices.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request } from 'express';
import {
  isPartnerSlaFastTask,
  isPartnerExplicitFastAlias,
  isPartnerExplicitFastChatAlias,
  isPartnerExplicitFastDraftAlias,
  shouldSkipRagForPartnerFastChat,
  shouldSkipRagForPartnerFastDraft,
  resolvePartnerFastLlmTier,
  resolvePartnerDispatchEnableCoT,
  isSlaFastTaskType,
  isPartnerCounselOrDraftTask,
  resolveNspNymBestOutcomeQuality,
} from '../../src/utils/jrx-partner-platform.js';

/** NSP-shaped request: an sdkContext makes it a JRX-dependent platform. */
function nspRequest(body: Record<string, unknown> = {}): Request {
  return {
    body,
    headers: { 'x-jrx-platform': 'NSP' },
    sdkContext: { partnerCode: 'NSP', tenantId: 't-nsp' },
  } as unknown as Request;
}

const FAST_ALIASES = ['legal-draft-fast', 'legal_draft_fast', 'legal-chat-fast', 'doc-draft-fast'];
const FULL_DEPTH = ['legal-draft', 'legal-chat', 'drafting', 'legal_research', 'legal-advice'];

describe('NV-DRAFT-FAST-SLA-001: explicit -fast aliases are honoured', () => {
  const prev = process.env.JRX_NSP_COUNSEL_QUEEN;

  beforeEach(() => {
    // Reproduce the production default — this is the setting under which the
    // defect occurred. With counsel-Queen OFF the bug was invisible.
    process.env.JRX_NSP_COUNSEL_QUEEN = '1';
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.JRX_NSP_COUNSEL_QUEEN;
    else process.env.JRX_NSP_COUNSEL_QUEEN = prev;
  });

  it.each(FAST_ALIASES)('%s is SLA-fast even with counsel-Queen ON', (taskType) => {
    expect(isPartnerExplicitFastAlias(taskType)).toBe(true);
    expect(isPartnerSlaFastTask(nspRequest({ taskType }), { taskType })).toBe(true);
  });

  it.each(FAST_ALIASES)('%s resolves to enableCoT=false (no multi-minute CoT)', (taskType) => {
    const q = resolveNspNymBestOutcomeQuality(nspRequest({ taskType }), { userId: 'u1', taskType });
    expect(q.enableCoT).toBe(false);
    expect(q.enableCitationVerification).toBe(true);
    expect(q.enableHallucinationCheck).toBe(true);
    if (isPartnerExplicitFastChatAlias(taskType)) {
      // NV-FAST-CHAT-NORAG-001 — chat-fast without documents skips RAG.
      expect(q.enableRAG).toBe(false);
    } else if (isPartnerExplicitFastDraftAlias(taskType)) {
      // NV-FAST-DRAFT-NORAG-001 — doc-less draft-fast skips RAG too.
      expect(q.enableRAG).toBe(false);
    } else {
      expect(q.enableRAG).toBe(true);
    }
  });

  it.each(FULL_DEPTH)('%s is NOT made fast — counsel depth preserved', (taskType) => {
    expect(isPartnerExplicitFastAlias(taskType)).toBe(false);
    expect(isPartnerSlaFastTask(nspRequest({ taskType }), { taskType })).toBe(false);
    const q = resolveNspNymBestOutcomeQuality(nspRequest({ taskType }), { userId: 'u1', taskType });
    expect(q.enableCoT).toBe(true);
  });

  it('a -fast alias is still recognised as counsel/draft work', () => {
    // The two predicates answer different questions and must not be merged:
    // "is this counsel work?" (yes) vs "did the caller pin a latency budget?" (yes).
    // Conflating them is precisely what caused this defect.
    expect(isPartnerCounselOrDraftTask('legal-draft-fast')).toBe(true);
    expect(isPartnerExplicitFastAlias('legal-draft-fast')).toBe(true);
  });

  it('-deep aliases are never treated as fast', () => {
    for (const tt of ['legal-draft-deep', 'doc-draft-deep']) {
      expect(isPartnerExplicitFastAlias(tt)).toBe(false);
      expect(isPartnerSlaFastTask(nspRequest({ taskType: tt }), { taskType: tt })).toBe(false);
    }
  });

  it('does not match a task that merely contains "fast"', () => {
    // Guards against a substring rule leaking speed semantics into unrelated work.
    for (const tt of ['fast', 'breakfast-clause', 'legal-draft-faster', 'fast-legal-draft']) {
      expect(isPartnerExplicitFastAlias(tt)).toBe(false);
    }
  });

  it('is unaffected by counsel-Queen being OFF (fast stays fast)', () => {
    process.env.JRX_NSP_COUNSEL_QUEEN = '0';
    expect(isPartnerSlaFastTask(nspRequest({ taskType: 'legal-draft-fast' }), { taskType: 'legal-draft-fast' })).toBe(true);
  });

  it('isSlaFastTaskType mirrors explicit -fast aliases without Request', () => {
    expect(isSlaFastTaskType('legal-chat-fast')).toBe(true);
    expect(isSlaFastTaskType('legal-draft-fast')).toBe(true);
    expect(isSlaFastTaskType('legal-draft')).toBe(false);
    expect(isSlaFastTaskType('web-search')).toBe(true);
  });
});

describe('NV-FAST-CHAT-NORAG-001 / NV-FAST-SERVING-TIER-001', () => {
  it('chat-fast skips RAG without documents; draft-fast skips RAG without documents', () => {
    expect(isPartnerExplicitFastChatAlias('legal-chat-fast')).toBe(true);
    expect(isPartnerExplicitFastDraftAlias('legal-draft-fast')).toBe(true);
    expect(shouldSkipRagForPartnerFastChat('legal-chat-fast', false)).toBe(true);
    expect(shouldSkipRagForPartnerFastChat('legal-chat-fast', true)).toBe(false);
    expect(shouldSkipRagForPartnerFastChat('legal-chat-fast', false, true)).toBe(false);
    expect(shouldSkipRagForPartnerFastDraft('legal-draft-fast', false)).toBe(true);
    expect(shouldSkipRagForPartnerFastDraft('legal-draft-fast', true)).toBe(false);
    expect(shouldSkipRagForPartnerFastDraft('legal-draft-fast', false, true)).toBe(false);
    expect(shouldSkipRagForPartnerFastChat('legal-draft-fast', false)).toBe(false);

    const chatQ = resolveNspNymBestOutcomeQuality(nspRequest({ taskType: 'legal-chat-fast' }), {
      userId: 'u1',
      taskType: 'legal-chat-fast',
      hasDocumentPayload: false,
    });
    expect(chatQ.enableRAG).toBe(false);

    const draftQ = resolveNspNymBestOutcomeQuality(nspRequest({ taskType: 'legal-draft-fast' }), {
      userId: 'u1',
      taskType: 'legal-draft-fast',
      hasDocumentPayload: false,
    });
    expect(draftQ.enableRAG).toBe(false);

    const draftWithDoc = resolveNspNymBestOutcomeQuality(nspRequest({ taskType: 'legal-draft-fast' }), {
      userId: 'u1',
      taskType: 'legal-draft-fast',
      hasDocumentPayload: true,
    });
    expect(draftWithDoc.enableRAG).toBe(true);
  });

  it('NV-MEM-FAST-NORAG-001: explicit enableMemory survives chat-fast no-RAG path', () => {
    const chatQ = resolveNspNymBestOutcomeQuality(nspRequest({ taskType: 'legal-chat-fast' }), {
      userId: '88421',
      taskType: 'legal-chat-fast',
      enableMemory: true,
      hasDocumentPayload: false,
    });
    expect(chatQ.enableRAG).toBe(false);
    expect(chatQ.enableMemory).toBe(true);

    const leanDefault = resolveNspNymBestOutcomeQuality(nspRequest({ taskType: 'legal-chat-fast' }), {
      userId: '88421',
      taskType: 'legal-chat-fast',
      hasDocumentPayload: false,
    });
    expect(leanDefault.enableMemory).toBe(false);
  });

  it('resolvePartnerFastLlmTier returns plus for -fast aliases', () => {
    const req = nspRequest({ taskType: 'legal-chat-fast' });
    expect(resolvePartnerFastLlmTier(req, 'legal-chat-fast')).toBe('plus');
    expect(resolvePartnerFastLlmTier(req, 'legal-draft')).toBeNull();
  });
});

describe('NV-FAST-COT-OFF-001: partner enableCoT cannot override -fast', () => {
  it('resolvePartnerDispatchEnableCoT forces false on -fast even when body asks true', () => {
    expect(resolvePartnerDispatchEnableCoT('legal-draft-fast', true, true)).toBe(false);
    expect(resolvePartnerDispatchEnableCoT('legal-chat-fast', true, true)).toBe(false);
    expect(resolvePartnerDispatchEnableCoT('legal-draft', true, true)).toBe(true);
    expect(resolvePartnerDispatchEnableCoT('legal-draft', false, false)).toBe(false);
  });
});

describe('NV-FAST-CHAT-SLA-001: chat-fast lean path', () => {
  it('chat-fast token floor is below generic -fast and skips IRAC attach', async () => {
    const mod = await import('../../src/utils/jrx-partner-platform.js');
    const { selectLegalStructure } = await import('../../src/services/jrx-legal-structure-attach.js');
    const nsp = nspRequest({ taskType: 'legal-chat-fast' });
    expect(mod.applyPartnerMaxTokensFloor(nsp, 128)).toBeLessThanOrEqual(768);
    expect(mod.applyPartnerMaxTokensFloor(nsp, 128)).toBeGreaterThanOrEqual(128);
    expect(
      selectLegalStructure({
        taskType: 'legal-chat-fast',
        query: 'What is anticipatory bail under BNSS?',
        jurisdiction: 'IN',
      }).kind,
    ).toBe('none');
  });
});

describe('NV-DRAFT-FAST-LENGTH-001 / NV-DRAFT-FAST-SLA-001: draft-fast output floor', () => {
  it('draft-fast SLA caps bail medium at registry 6144; chat-fast stays 768', async () => {
    const mod = await import('../../src/utils/jrx-partner-platform.js');
    const draftReq = nspRequest({
      taskType: 'legal-draft-fast',
      parameters: { documentType: 'bail_application' },
      options: { draftLength: 'medium' },
    });
    const chatReq = nspRequest({ taskType: 'legal-chat-fast' });
    expect(mod.applyPartnerMaxTokensFloor(draftReq, undefined)).toBe(6_144);
    expect(mod.applyPartnerMaxTokensFloor(chatReq, undefined)).toBeLessThanOrEqual(768);
  });

  it('resolveDraftFastSlaTokenCap tier floors', async () => {
    const mod = await import('../../src/utils/jrx-partner-platform.js');
    expect(mod.resolveDraftFastSlaTokenCap('low')).toBe(4_096);
    expect(mod.resolveDraftFastSlaTokenCap('medium')).toBe(8_192);
    expect(mod.resolveDraftFastSlaTokenCap('comprehensive')).toBe(16_384);
  });

  it('shouldSkipExpensiveDraftFastSteps true for draft-fast when SLA on', async () => {
    const mod = await import('../../src/utils/jrx-partner-platform.js');
    expect(mod.shouldSkipExpensiveDraftFastSteps('legal-draft-fast')).toBe(true);
    expect(mod.shouldSkipExpensiveDraftFastSteps('legal-draft')).toBe(false);
  });
});

describe('NV-DRAFT-FAST-SLA-001: envelope consistency', () => {
  it('lean path requires CoT only when CoT is enabled', async () => {
    // The router's lean branch sets `requireCoT: !!input.enableCoT`. Combined with
    // the SLA resolver returning enableCoT=false, the envelope can no longer ask
    // for a `cot` step that the SLA deliberately skipped — which was the
    // "JRX rejects legal-draft-fast for missing cot" report.
    const { decideAdaptivePath } = await import('../../src/orchestration/jrx-adaptive-router.js');
    const decision = decideAdaptivePath({
      prompt: 'Draft a Written Statement in a civil suit for recovery.',
      taskType: 'legal-draft-fast',
      partnerLean: true,
      enableCoT: false,
      nyvDependent: true,
      forceLegalBestOutcome: true,
    });

    expect(decision.path).toBe('specialist');
    expect(decision.requireCoT).toBe(false);
    expect(decision.requireMakerChecker).toBe(false);
  });
});
