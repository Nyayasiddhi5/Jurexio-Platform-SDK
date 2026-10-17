/**
 * NV-PARTNER-INDIA-SCOPE + JRX-dependent Queen depth unit tests.
 */
import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  INDIA_ONLY_PARTNER_CODES,
  JRX_DEPENDENT_PLATFORM_CODES,
  isIndiaOnlyPartner,
  isJrxDependentPlatform,
  isNspOrNymPartner,
  resolvePartnerPlatformCode,
  resolvePartnerMemoryUserId,
  resolveNspNymBestOutcomeQuality,
  applyIndiaOnlyScopeToRequest,
  applyPartnerPromptAlias,
  resolvePartnerPrompt,
  wantsNspNymBestOutcome,
  wantsPartnerSyncLean,
  isPartnerCounselOrDraftTask,
  shouldSkipQueenForTransactionalCounselDraft,
  applyPartnerDraftDocumentTypeInference,
} from '../../src/utils/jrx-partner-platform.js';
import {
  tenantDocumentKey,
  assertKeyWithinTenant,
  normalizePlatformCode,
} from '../../src/utils/jrx-multitenant-storage.js';
import { GraphMemoryService } from '../../src/services/memory/graph-memory-service.js';
import { extractDirectMemoryRecall } from '../../src/services/memory/jrx-memory-injection-budget.js';

function fakeReq(sdk: Record<string, unknown> | undefined, extras: Partial<Request> = {}): Request {
  return {
    sdkContext: sdk,
    body: { ...(extras as any).body },
    query: { ...(extras as any).query },
    headers: { ...(extras as any).headers },
    ...extras,
  } as unknown as Request;
}

describe('./jrx-partner-platform India-only', () => {
  it('INDIA_ONLY set contains NSP and NYM only among common codes', () => {
    expect(INDIA_ONLY_PARTNER_CODES.has('NSP')).toBe(true);
    expect(INDIA_ONLY_PARTNER_CODES.has('NYM')).toBe(true);
    expect(INDIA_ONLY_PARTNER_CODES.has('JRX')).toBe(false);
  });

  it('resolves platformUatLabel NSP/NYM as India-only', () => {
    expect(isIndiaOnlyPartner(fakeReq({ platformUatLabel: 'NSP' }))).toBe(true);
    expect(isIndiaOnlyPartner(fakeReq({ platformUatLabel: 'nym' }))).toBe(true);
    expect(isIndiaOnlyPartner(fakeReq({ platformUatLabel: 'JRX' }))).toBe(false);
  });

  it('forces body/query jurisdiction=IN for NSP', () => {
    const req = fakeReq(
      { platformUatLabel: 'NSP', jurisdiction: 'US' },
      { body: { jurisdiction: 'UK', includeNonIndia: true }, query: { jurisdiction: 'US', includeNonIndia: '1' } },
    );
    applyIndiaOnlyScopeToRequest(req);
    expect((req as any).sdkContext.jurisdiction).toBe('IN');
    expect((req.body as any).jurisdiction).toBe('IN');
    expect((req.body as any).includeNonIndia).toBeUndefined();
    expect((req.query as any).jurisdiction).toBe('IN');
    expect(resolvePartnerPlatformCode(req)).toBe('NSP');
  });

  it('does not mutate JRX jurisdiction', () => {
    const req = fakeReq(
      { platformUatLabel: 'JRX', jurisdiction: 'US' },
      { body: { jurisdiction: 'US' }, query: { jurisdiction: 'US' } },
    );
    applyIndiaOnlyScopeToRequest(req);
    expect((req.body as any).jurisdiction).toBe('US');
    expect((req as any).sdkContext.jurisdiction).toBe('US');
  });
});

describe('JRX-dependent full Queen depth', () => {
  it('marks NSP/NYM/NSI as JRX-dependent; JRX is not', () => {
    expect(JRX_DEPENDENT_PLATFORM_CODES.has('NSP')).toBe(true);
    expect(isJrxDependentPlatform(fakeReq({ platformUatLabel: 'NSP' }))).toBe(true);
    expect(isJrxDependentPlatform(fakeReq({ platformUatLabel: 'NSI' }))).toBe(true);
    expect(isJrxDependentPlatform(fakeReq({ platformUatLabel: 'JRX' }))).toBe(false);
  });

  it('partnerSyncLean ignored for ecosystem best-outcome unless JRX_ALLOW_NSP_NYM_LEAN=1', () => {
    const leanNsi = fakeReq(
      { platformUatLabel: 'NSI' },
      { body: { partnerSyncLean: true }, headers: {} },
    );
    expect(wantsPartnerSyncLean(leanNsi, { explicitAgentKey: 'clause-extractor', taskType: 'extract' })).toBe(false);
    const prev = process.env.JRX_ALLOW_NSP_NYM_LEAN;
    process.env.JRX_ALLOW_NSP_NYM_LEAN = '1';
    try {
      expect(wantsPartnerSyncLean(leanNsi, { explicitAgentKey: 'clause-extractor', taskType: 'extract' })).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.JRX_ALLOW_NSP_NYM_LEAN;
      else process.env.JRX_ALLOW_NSP_NYM_LEAN = prev;
    }
    // JRX is not ecosystem-best-outcome — lean still works when opted in
    const leanJrx = fakeReq(
      { platformUatLabel: 'JRX' },
      { body: { partnerSyncLean: true }, headers: {} },
    );
    expect(wantsPartnerSyncLean(leanJrx, { explicitAgentKey: 'clause-extractor', taskType: 'extract' })).toBe(true);
  });

  it('NSP/NYM best-outcome ignores partnerSyncLean by default', () => {
    expect(isNspOrNymPartner(fakeReq({ platformUatLabel: 'NSP' }))).toBe(true);
    expect(wantsNspNymBestOutcome(fakeReq({ platformUatLabel: 'NYM' }))).toBe(true);
    const leanReq = fakeReq(
      { platformUatLabel: 'NSP' },
      { body: { partnerSyncLean: true }, headers: {} },
    );
    expect(wantsPartnerSyncLean(leanReq, { explicitAgentKey: 'clause-extractor', taskType: 'extract' })).toBe(false);
    // `partnerSyncLean` is a *heuristic* hint and stays ignored under best-outcome.
    // Omitting the per-request flags entirely means "no caller opinion", so the
    // forced best-outcome envelope applies in full.
    const q = resolveNspNymBestOutcomeQuality(leanReq, { userId: 'u1' });
    expect(q.forceLegalBestOutcome).toBe(true);
    expect(q.enableRAG).toBe(true);
    expect(q.enableCitationVerification).toBe(true);
    expect(q.enableHallucinationCheck).toBe(true);
    expect(q.enableMemory).toBe(true);
    expect(q.enableCoT).toBe(true);
  });

  /**
   * NV-TOKEN-BUDGET-001 — this test previously asserted the opposite: an explicit
   * `enableRAG: false` was overwritten to `true`, so a caller who opted out of
   * retrieval still paid for the retrieval context block. That was measured as
   * Phase-3 defect #1 ("caller flags do not reduce prompt size — sometimes they
   * increase it"). An explicit flag is a contract and is now honoured.
   *
   * The split that matters: the caller owns the *size* levers (RAG, memory, CoT,
   * explainability) because they decide the latency/cost envelope. The caller does
   * NOT own the output-safety gates (citation verification, hallucination check) —
   * those do not enlarge the prompt, and letting a partner switch them off would
   * trade legal correctness for nothing.
   */
  it('honours an explicit caller opt-out but never the output-safety gates', () => {
    const leanReq = fakeReq(
      { platformUatLabel: 'NSP' },
      { body: { partnerSyncLean: true }, headers: {} },
    );
    const q = resolveNspNymBestOutcomeQuality(leanReq, {
      userId: 'u1',
      enableRAG: false,
      enableCitationVerification: false,
      enableHallucinationCheck: false,
      enableMemory: false,
      enableCoT: false,
    });
    expect(q.forceLegalBestOutcome).toBe(true);
    // Caller-owned size levers: opt-out respected.
    expect(q.enableRAG).toBe(false);
    expect(q.enableMemory).toBe(false);
    expect(q.enableCoT).toBe(false);
    // Not caller-owned: safety gates stay on regardless of what was requested.
    expect(q.enableCitationVerification).toBe(true);
    expect(q.enableHallucinationCheck).toBe(true);
  });

  it('an explicit enableRAG:true still wins over a lean heuristic', () => {
    const leanReq = fakeReq(
      { platformUatLabel: 'NSP' },
      { body: { partnerSyncLean: true }, headers: {} },
    );
    const q = resolveNspNymBestOutcomeQuality(leanReq, { userId: 'u1', enableRAG: true });
    expect(q.enableRAG).toBe(true);
  });

  it('legal-chat-fast is SLA-fast (CoT off); bare counsel stays Queen+CoT', () => {
    // NV-DRAFT-FAST-SLA-001: the `-fast` suffix is a caller latency contract.
    // NV-NSP-COUNSEL-QUEEN-001 still applies to *bare* legal-chat / legal-draft.
    const chatFast = fakeReq(
      { platformUatLabel: 'NSP' },
      { body: { partnerSyncLean: true, taskType: 'legal-chat-fast', enableRAG: true }, headers: {} },
    );
    expect(wantsPartnerSyncLean(chatFast, { explicitAgentKey: 'legal-analyst', taskType: 'legal-chat-fast' })).toBe(true);
    const chatFastQ = resolveNspNymBestOutcomeQuality(chatFast, {
      userId: 'u1',
      taskType: 'legal-chat-fast',
      enableRAG: true,
    });
    expect(chatFastQ.enableRAG).toBe(true);
    expect(chatFastQ.enableCoT).toBe(false);

    const chatFull = fakeReq(
      { platformUatLabel: 'NSP' },
      { body: { taskType: 'legal-chat' }, headers: {} },
    );
    expect(wantsPartnerSyncLean(chatFull, { explicitAgentKey: 'legal-analyst', taskType: 'legal-chat' })).toBe(false);
    const chatFullQ = resolveNspNymBestOutcomeQuality(chatFull, { userId: 'u1', taskType: 'legal-chat' });
    expect(chatFullQ.enableCoT).toBe(true);

    expect(isPartnerCounselOrDraftTask('document-drafting')).toBe(true);
    expect(isPartnerCounselOrDraftTask('web-search')).toBe(false);

    const web = fakeReq(
      { platformUatLabel: 'NSP' },
      { body: { taskType: 'web-search', tools: ['web-search'] }, headers: {} },
    );
    const webQ = resolveNspNymBestOutcomeQuality(web, {
      userId: 'u1',
      taskType: 'web-search',
    });
    expect(webQ.enableRAG).toBe(false);
    expect(webQ.enableMemory).toBe(false);
    expect(webQ.enableCitationVerification).toBe(true);
  });

  it('bare draft taskTypes use Queen+CoT; -fast aliases do not', () => {
    for (const taskType of ['legal-draft', 'doc-draft', 'drafting']) {
      const req = fakeReq(
        { platformUatLabel: 'NSP' },
        { body: { taskType }, headers: {} },
      );
      expect(wantsPartnerSyncLean(req, { explicitAgentKey: 'drafting-specialist', taskType })).toBe(false);
      const q = resolveNspNymBestOutcomeQuality(req, {
        userId: 'u1',
        partnerLean: false,
        taskType,
      });
      expect(q.enableRAG).toBe(true);
      expect(q.enableCitationVerification).toBe(true);
      expect(q.enableHallucinationCheck).toBe(true);
      expect(q.enableCoT).toBe(true);
    }
    for (const taskType of ['legal-draft-fast', 'doc-draft-fast']) {
      const req = fakeReq(
        { platformUatLabel: 'NSP' },
        { body: { taskType }, headers: {} },
      );
      expect(wantsPartnerSyncLean(req, { explicitAgentKey: 'drafting-specialist', taskType })).toBe(true);
      const q = resolveNspNymBestOutcomeQuality(req, { userId: 'u1', taskType, hasDocumentPayload: false });
      expect(q.enableRAG).toBe(false);
      expect(q.enableCitationVerification).toBe(true);
      expect(q.enableHallucinationCheck).toBe(true);
      expect(q.enableCoT).toBe(false);
      const qDoc = resolveNspNymBestOutcomeQuality(req, { userId: 'u1', taskType, hasDocumentPayload: true });
      expect(qDoc.enableRAG).toBe(true);
    }
  });

  it('JRX_NSP_COUNSEL_QUEEN=0 restores grounded-fast (RAG on, CoT off)', () => {
    const prev = process.env.JRX_NSP_COUNSEL_QUEEN;
    process.env.JRX_NSP_COUNSEL_QUEEN = '0';
    try {
      const chat = fakeReq(
        { platformUatLabel: 'NSP' },
        { body: { taskType: 'legal-chat-fast' }, headers: {} },
      );
      expect(wantsPartnerSyncLean(chat, { explicitAgentKey: 'legal-analyst', taskType: 'legal-chat-fast' })).toBe(true);
      const q = resolveNspNymBestOutcomeQuality(chat, {
        userId: 'u1',
        partnerLean: true,
        taskType: 'legal-chat-fast',
        hasDocumentPayload: false,
      });
      expect(q.enableRAG).toBe(false);
      expect(q.enableCoT).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.JRX_NSP_COUNSEL_QUEEN;
      else process.env.JRX_NSP_COUNSEL_QUEEN = prev;
    }
  });

  it('ecosystem platforms (NSI/NSA) also get best-outcome; JRX does not', () => {
    expect(wantsNspNymBestOutcome(fakeReq({ platformUatLabel: 'NSI' }))).toBe(true);
    expect(wantsNspNymBestOutcome(fakeReq({ platformUatLabel: 'NSA' }))).toBe(true);
    expect(wantsNspNymBestOutcome(fakeReq({ platformUatLabel: 'JRX' }))).toBe(false);
  });

  it('demo unlimited + maxTokens floor for ecosystem partners (default ON)', async () => {
    const mod = await import('../../src/utils/jrx-partner-platform.js');
    const nsp = fakeReq({ platformUatLabel: 'NSP' });
    expect(mod.wantsPartnerDemoUnlimited(nsp)).toBe(true);
    expect(mod.wantsNspUnlimited(nsp)).toBe(true);
    expect(mod.shouldSkipPartnerProductRateLimits(nsp)).toBe(true);
    expect(mod.applyPartnerMaxTokensFloor(nsp, undefined)).toBeGreaterThanOrEqual(8_192);
    expect(mod.applyPartnerMaxTokensFloor(nsp, 32_000)).toBe(32_000);
    const draftReq = fakeReq({ platformUatLabel: 'NSP' }, {
      body: {
        taskType: 'legal-draft-fast',
        parameters: { documentType: 'bail_application' },
        options: { draftLength: 'medium' },
      },
    });
    expect(mod.applyPartnerMaxTokensFloor(draftReq, undefined)).toBeGreaterThanOrEqual(6_144);
    expect(mod.applyPartnerMaxTokensFloor(draftReq, undefined)).toBeLessThanOrEqual(8_192);
    expect(mod.applyPartnerMaxTokensFloor(draftReq, 128)).toBe(6_144);
    const chatFastReq = fakeReq({ platformUatLabel: 'NSP' }, { body: { taskType: 'legal-chat-fast' } });
    expect(mod.applyPartnerMaxTokensFloor(chatFastReq, undefined)).toBeGreaterThanOrEqual(512);
    expect(mod.applyPartnerMaxTokensFloor(chatFastReq, undefined)).toBeLessThanOrEqual(768);
    expect(mod.applyPartnerMaxTokensFloor(chatFastReq, 128)).toBe(768);
    const extractReq = fakeReq({ platformUatLabel: 'NSP' }, { body: { taskType: 'extract' } });
    expect(mod.applyPartnerMaxTokensFloor(extractReq, undefined)).toBeLessThanOrEqual(2_048);
    expect(mod.resolvePartnerServingProfile(nsp).effectiveTier).toBe('enterprise');
    const prev = process.env.JRX_PARTNER_DEMO_UNLIMITED;
    process.env.JRX_PARTNER_DEMO_UNLIMITED = '0';
    try {
      // NSP unlimited remains ON even when partner demo flag is off
      expect(mod.wantsPartnerDemoUnlimited(nsp)).toBe(true);
      expect(mod.wantsNspUnlimited(nsp)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.JRX_PARTNER_DEMO_UNLIMITED;
      else process.env.JRX_PARTNER_DEMO_UNLIMITED = prev;
    }
  });

  it('NSP unlimited via X-JRX-Platform header (any user key)', async () => {
    const mod = await import('../../src/utils/jrx-partner-platform.js');
    const req = {
      headers: { 'x-jrx-platform': 'nsp' },
      body: {},
      sdkContext: undefined,
    } as any;
    expect(mod.isNspPlatformRequest(req)).toBe(true);
    expect(mod.wantsNspUnlimited(req)).toBe(true);
    expect(mod.shouldSkipPartnerProductRateLimits(req)).toBe(true);
    const prev = process.env.JRX_NSP_UNLIMITED;
    process.env.JRX_NSP_UNLIMITED = '0';
    try {
      expect(mod.wantsNspUnlimited(req)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.JRX_NSP_UNLIMITED;
      else process.env.JRX_NSP_UNLIMITED = prev;
    }
  });
});

describe('NV-PARTNER-PROMPT-ALIAS-001 voice copy-resend', () => {
  it('accepts message/text/transcript aliases and STT envelopes', () => {
    expect(resolvePartnerPrompt({ message: '  What is BNSS 480?  ' })).toBe('What is BNSS 480?');
    expect(resolvePartnerPrompt({ text: 'Section 73 ICA' })).toBe('Section 73 ICA');
    expect(resolvePartnerPrompt({ transcript: 'bail under BNSS' })).toBe('bail under BNSS');
    expect(resolvePartnerPrompt({ success: true, data: { text: 'copied STT' } })).toBe('copied STT');
    expect(resolvePartnerPrompt({
      messages: [{ role: 'user', content: 'chat-completions body' }],
    })).toBe('chat-completions body');
  });

  it('unwraps copied STT JSON pasted into prompt and strips NBSP/BOM', () => {
    const pasted = JSON.stringify({ success: true, data: { text: 'voice copy' } });
    expect(resolvePartnerPrompt({ prompt: pasted })).toBe('voice copy');
    expect(resolvePartnerPrompt({ prompt: '\u00a0\uFEFFvoice copy\u00a0' })).toBe('voice copy');
    expect(resolvePartnerPrompt({ prompt: '   ' })).toBe('');
  });

  it('writes canonical body.prompt for downstream Queen', () => {
    const body: Record<string, unknown> = { message: 'Section 302 BNS' };
    expect(applyPartnerPromptAlias(body)).toBe('Section 302 BNS');
    expect(body.prompt).toBe('Section 302 BNS');
  });
});

describe('multitenant storage keys', () => {
  it('builds org/platform scoped document keys', () => {
    const key = tenantDocumentKey(
      { orgId: 42, platform: 'NSP', userId: 'u1' },
      'doc1',
      'a b.pdf',
    );
    expect(key).toBe('orgs/42/nsp/users/u1/documents/doc1/a_b.pdf');
    assertKeyWithinTenant(key, { orgId: 42, platform: 'NSP' });
    expect(normalizePlatformCode('NSP')).toBe('nsp');
  });

  it('rejects cross-tenant keys', () => {
    expect(() =>
      assertKeyWithinTenant('orgs/99/nym/users/u/documents/d/f.pdf', { orgId: 42, platform: 'NSP' }),
    ).toThrow(/JRX-MT-002/);
  });
});

describe('NV-MEM-FAST-NORAG-001 partner memory on SLA-fast chat', () => {
  it('keeps enableMemory true when caller explicitly opts in on doc-less legal-chat-fast (RAG off)', () => {
    const chat = fakeReq(
      { platformUatLabel: 'NSP' },
      { body: { taskType: 'legal-chat-fast', enableMemory: true }, headers: {} },
    );
    const q = resolveNspNymBestOutcomeQuality(chat, {
      userId: '88421',
      enableMemory: true,
      taskType: 'legal-chat-fast',
      hasDocumentPayload: false,
    });
    expect(q.enableRAG).toBe(false);
    expect(q.enableMemory).toBe(true);
  });
});

describe('NV-MEM-PARTNER-USER-001 resolvePartnerMemoryUserId', () => {
  it('resolves numeric userId from header on turn A and body.userId on turn B', () => {
    const turnA = fakeReq(
      { platformUatLabel: 'NSP' },
      {
        body: { taskType: 'legal-chat-fast', enableMemory: true },
        headers: { 'x-jrx-user-id': '88421' },
      },
    );
    const turnB = fakeReq(
      { platformUatLabel: 'NSP' },
      {
        body: { taskType: 'legal-chat-fast', enableMemory: true, userId: 88421 },
        headers: {},
      },
    );
    const idA = resolvePartnerMemoryUserId(turnA, turnA.body as Record<string, unknown>);
    const idB = resolvePartnerMemoryUserId(turnB, turnB.body as Record<string, unknown>);
    expect(idA.numericUserId).toBe(88421);
    expect(idB.numericUserId).toBe(88421);
    expect(idA.userId).toBe('88421');
    expect(idB.userId).toBe('88421');
  });

  it('write→recall roundtrip: turn A store and turn B recall for same partner userId', async () => {
    const svc = new GraphMemoryService();
    const userId = '88421';
    const sessionId = 'sess-partner-memory-probe';
    const secret = 'MEMORY-PROBE-ROUNDTRIP';

    await svc.addMemory(
      `Remember this codeword exactly: ${secret}. Acknowledge in one line.`,
      'fact',
      { taskType: 'legal-chat-fast' },
      { userId, sessionId, source: 'ai_response', importance: 0.6 },
    );

    const recalled = await svc.recall(
      { query: 'codeword remember prior message', userId, sessionId, limit: 6, includeRelated: true },
      { maxChains: 6 },
    );
    const hit = recalled.memory.nodes.some((n) => n.content.includes(secret));
    expect(hit).toBe(true);
  });

  it('NV-MEM-DIRECT-RECALL-001 extractDirectMemoryRecall serves codeword from L3 nodes', () => {
    const secret = 'MEMORY-PROBE-DIRECT-001';
    const nodes = [{ content: `Q: Remember this codeword exactly: ${secret}. Ack.` }];
    expect(extractDirectMemoryRecall('Reply with that codeword only from platform memory', nodes)).toBe(secret);
    expect(extractDirectMemoryRecall('What is section 302 IPC?', nodes)).toBeNull();
  });

  it('NV-MEM-TENANT-LEGACY-001: null-tenant node recalls under scoped org when session matches', async () => {
    const svc = new GraphMemoryService();
    const userId = '88421';
    const sessionId = 'sess-tenant-legacy';
    const secret = 'MEMORY-PROBE-TENANT-LEGACY';

    await svc.addMemory(
      `Codeword: ${secret}`,
      'fact',
      {},
      { userId, sessionId, source: 'ai_response', importance: 0.6 },
    );

    const recalled = await svc.recall(
      { query: 'codeword', userId, sessionId, tenantId: '999', limit: 4, includeRelated: false },
      { maxChains: 2 },
    );
    expect(recalled.memory.nodes.some((n) => n.content.includes(secret))).toBe(true);
  });
});

describe('R-DRAFT-NSP-QUALITY P2/P3 transactional counsel routing', () => {
  it('skips Queen for comprehensive legal_notice on NSP', () => {
    const req = fakeReq(
      { platformUatLabel: 'NSP' },
      {
        body: {
          taskType: 'legal-draft',
          prompt: 'Draft NI Act section 138 statutory notice',
          options: { draftLength: 'comprehensive' },
          parameters: { documentType: 'legal_notice' },
        },
        headers: { 'x-jrx-platform': 'NSP' },
      },
    );
    applyPartnerDraftDocumentTypeInference(req, 'legal-draft');
    expect(shouldSkipQueenForTransactionalCounselDraft(req, 'legal-draft')).toBe(true);
  });

  it('does not skip Queen for writ_petition counsel', () => {
    const req = fakeReq(
      { platformUatLabel: 'NSP' },
      {
        body: {
          taskType: 'legal-draft',
          prompt: 'Draft writ petition',
          options: { draftLength: 'comprehensive' },
          parameters: { documentType: 'writ_petition' },
        },
      },
    );
    applyPartnerDraftDocumentTypeInference(req, 'legal-draft');
    expect(shouldSkipQueenForTransactionalCounselDraft(req, 'legal-draft')).toBe(false);
  });
});
