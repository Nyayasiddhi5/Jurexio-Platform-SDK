import { describe, expect, it } from 'vitest';
import {
  applyPartnerHumanPolish,
  countPartnerAiMarkerHits,
  countPartnerPlaceholders,
  shouldRunPartnerHumanPolish,
  stripPartnerAiMarkers,
} from '../../src/utils/jrx-partner-human-polish.js';
import {
  buildUnifiedOrchestrationContract,
  computeAttestationRequired,
  computeDraftQuality,
  countUnresolvedCourtDocConflicts,
} from '../../src/orchestration/jrx-orchestration-response-contract.js';
import type { QualityEnvelopeSnapshot } from '../../src/orchestration/jrx-quality-envelope.js';
import type { AdaptiveRouterDecision } from '../../src/orchestration/jrx-adaptive-router.js';

const stubDecision = {
  path: 'specialist',
  reason: 'test',
  complexity: 'medium',
  risk: 'medium',
} as AdaptiveRouterDecision;

const stubQuality = { ok: true, passed: true, missingMandatory: [] } as QualityEnvelopeSnapshot;

describe('NV-PARTNER-HUMAN-POLISH-001', () => {
  it('strips AI preamble markers on -fast paths', () => {
    const raw = `Certainly!

Here's a draft:

**PRAYER:** Grant bail.

In conclusion, the applicant deserves relief.`;
    const out = applyPartnerHumanPolish(raw, { taskType: 'legal-draft-fast' });
    expect(out).toContain('**PRAYER:**');
    expect(out).not.toMatch(/Certainly!/i);
    expect(out).not.toMatch(/Here's a draft/i);
    expect(out).not.toMatch(/In conclusion,/i);
  });

  it('preserves disclaimer tail when includeDisclaimer is true', () => {
    const raw = `Certainly!

**ISSUE:** Bail under BNSS.

---
*Disclaimer: This is AI-assisted legal information, not legal advice.*`;
    const out = stripPartnerAiMarkers(raw, { includeDisclaimer: true });
    expect(out).toContain('Disclaimer:');
    expect(out).not.toMatch(/Certainly!/i);
  });

  it('skips mitra-conversational agent', () => {
    expect(shouldRunPartnerHumanPolish({ taskType: 'legal-chat-fast', agentKey: 'mitra-conversational' })).toBe(false);
    const raw = 'Certainly!\n\nHello counsel.';
    expect(applyPartnerHumanPolish(raw, { taskType: 'legal-chat-fast', agentKey: 'mitra-conversational' })).toBe(raw);
  });

  it('counts placeholders for draftQuality', () => {
    expect(countPartnerPlaceholders('Fill [PARTY NAME] and {{court_name}} here.')).toBe(2);
  });

  it('counts AI marker hits', () => {
    expect(countPartnerAiMarkerHits('As an AI, I cannot advise.\n\n**PRAYER:**')).toBeGreaterThan(0);
    expect(countPartnerAiMarkerHits('**PRAYER:** Grant bail.')).toBe(0);
  });
});

describe('NV-DRAFT-QUALITY-001', () => {
  it('computes reviewRecommended for counsel draft with no authorities', () => {
    const dq = computeDraftQuality({
      content: '**PRAYER:** Grant bail.',
      riskBadge: 'GREEN',
      authoritiesDelivered: 0,
      taskType: 'legal-draft-fast',
    });
    expect(dq.reviewRecommended).toBe(true);
    expect(dq.voiceOk).toBe(true);
  });

  it('does not require authorities for non-counsel tasks', () => {
    const dq = computeDraftQuality({
      content: 'Hello',
      riskBadge: 'GREEN',
      authoritiesDelivered: 0,
      taskType: 'workflow',
    });
    expect(dq.reviewRecommended).toBe(false);
  });

  it('flags placeholders and YELLOW risk', () => {
    const dq = computeDraftQuality({
      content: 'Party: [NAME]',
      riskBadge: 'YELLOW',
      authoritiesDelivered: 2,
      taskType: 'legal-draft-fast',
    });
    expect(dq.placeholdersRemaining).toBe(1);
    expect(dq.reviewRecommended).toBe(true);
  });

  it('attestationRequired when conflicts or RED badge', () => {
    expect(computeAttestationRequired({
      reviewRecommended: false,
      riskBadge: 'RED',
      courtDocBlock: null,
    })).toBe(true);
    expect(computeAttestationRequired({
      reviewRecommended: false,
      riskBadge: 'GREEN',
      courtDocBlock: { docparseMeta: { conflictFields: ['party_name'] } },
    })).toBe(true);
    expect(countUnresolvedCourtDocConflicts({ docparseMeta: { conflictFields: ['a', 'b'] } })).toBe(2);
  });

  it('buildUnifiedOrchestrationContract emits draftQuality and analysisStatus', () => {
    const contract = buildUnifiedOrchestrationContract({
      content: '**PRAYER:** Relief.',
      requestId: 'req-1',
      decision: stubDecision,
      qualityEnvelope: stubQuality,
      tokens: { prompt: 1, completion: 1, total: 2 },
      latencyMs: 100,
      taskType: 'legal-draft-fast',
      extras: {
        fields: [{ key: 'case_no', value: '123', confidence: 0.9, source: 'regex-rules' }],
        fieldCount: 1,
        fieldSource: 'nyv',
        analysisStatus: 'structured',
        analysisStatusReason: 'Structured extraction succeeded.',
      },
    });
    expect(contract.draftQuality?.reviewRecommended).toBe(true);
    expect(contract.analysisStatus).toBe('structured');
    expect(typeof contract.attestationRequired).toBe('boolean');
  });
});
