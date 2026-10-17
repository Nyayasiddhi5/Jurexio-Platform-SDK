import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Request } from 'express';
import {
  analyzeDraftStructureMarkers,
  structureMarkersComplete,
} from '../../src/services/jrx-draft-completion.js';
import { computeDraftQuality } from '../../src/orchestration/jrx-orchestration-response-contract.js';
import {
  applyPartnerCounselUpgradeTaskType,
  shouldSkipRagForPartnerFastDraft,
  validatePartnerDraftDocumentType,
  getPartnerDraftDocumentTypeResolution,
  wantsPartnerQualityQueenPath,
} from '../../src/utils/jrx-partner-platform.js';
import {
  buildAgentDraftOverlay,
  buildResearchAgentOverlay,
} from '../../src/services/jrx-agent-draft-overlay.js';
import { propositionMatchesRetrieval } from '../../src/services/jrx-citation-retrieval-verify.js';
import {
  shouldRunDraftStructureChecker,
} from '../../src/services/jrx-draft-structure-checker.js';
import { resolveDraftFastSlaTokenCap } from '../../src/utils/jrx-partner-platform.js';

const SAMPLE_DRAFT = `
IN THE HIGH COURT OF JUDICATURE AT BOMBAY

MOST RESPECTFULLY SHOWETH:

1. The petitioner states that the facts are as narrated herein for grant of bail.

**PRAYER**
It is prayed that bail be granted on such terms as this Hon'ble Court deems fit.

**VERIFICATION**
I verify that the contents are true to my knowledge.
Limitation under Article 134 is computed from the impugned order dated 01.01.2025.
`;

function nspRequest(body: Record<string, unknown> = {}): Request {
  return {
    body,
    headers: { 'x-nyv-platform': 'NSP' },
    sdkContext: { partnerCode: 'NSP', tenantId: 't-nsp' },
  } as unknown as Request;
}

const SAMPLE_LEGAL_NOTICE = `
Advocate for the Sender
Date: 01.09.2025

Subject: Legal Notice under Section 138 of the Negotiable Instruments Act

FACTS
1. Our client advanced a sum of Rs. 5,00,000/- by cheque dated 15.03.2025 which was dishonoured.

Legal Basis: Section 138 NI Act — ingredients of cheque dishonour are satisfied.

Demand: You are hereby called upon to pay the sum of Rs. 5,00,000/- within 15 days from receipt of this notice.

Consequence: Failing which, our client shall initiate legal proceedings without further reference.

Yours faithfully,
Counsel for the Sender
`;

const SAMPLE_SIMPLE_AGREEMENT = `
SERVICE AGREEMENT

WHEREAS the parties wish to enter into this Agreement for software development services;

1. Scope of Services — the Provider shall deliver the modules described in Schedule A.

Clause 2. Consideration — the Client shall pay fees as per the payment schedule.

Governing law: laws of India. Disputes subject to arbitration under the Arbitration Act, 1996.

IN WITNESS WHEREOF the parties have executed this Agreement.

Party A: _________________________
Party B: _________________________
Witness 1: _________________________
`;

describe('NV-COUNSEL-STRUCTURE-MARKERS-001', () => {
  it('detects structure markers on counsel draft sample', () => {
    const m = analyzeDraftStructureMarkers(SAMPLE_DRAFT);
    expect(m.prayer).toBe(true);
    expect(m.verification).toBe(true);
    expect(m.causeTitle).toBe(true);
    expect(m.numberedParas).toBe(true);
    expect(m.limitationChecked).toBe(true);
    expect(structureMarkersComplete(m)).toBe(true);
  });

  it('legal_notice uses demand/signature markers — not pleading prayer/causeTitle', () => {
    const m = analyzeDraftStructureMarkers(SAMPLE_LEGAL_NOTICE, 'legal_notice');
    expect(m.prayer).toBe(true);
    expect(m.verification).toBe(true);
    expect(m.causeTitle).toBe(true);
    expect(m.numberedParas).toBe(true);
    expect(m.limitationChecked).toBe(true);
    expect(structureMarkersComplete(m, 'legal_notice')).toBe(true);
  });

  it('legal_notice without demand fails doc-type completeness', () => {
    const incomplete = 'Subject: Notice\n1. Facts only.\nYours faithfully,\nCounsel';
    const m = analyzeDraftStructureMarkers(incomplete, 'legal_notice');
    expect(structureMarkersComplete(m, 'legal_notice')).toBe(false);
  });

  it('simple_agreement uses execution/recitals markers — not pleading prayer', () => {
    const m = analyzeDraftStructureMarkers(SAMPLE_SIMPLE_AGREEMENT, 'simple_agreement');
    expect(m.prayer).toBe(true);
    expect(m.verification).toBe(true);
    expect(m.causeTitle).toBe(true);
    expect(m.numberedParas).toBe(true);
    expect(structureMarkersComplete(m, 'simple_agreement')).toBe(true);
  });

  it('computeDraftQuality legal_notice does not flag review for missing pleading prayer', () => {
    const dq = computeDraftQuality({
      content: SAMPLE_LEGAL_NOTICE,
      riskBadge: 'GREEN',
      authoritiesDelivered: 1,
      taskType: 'legal-draft-fast',
      documentType: 'legal_notice',
    });
    expect(dq.structureMarkers?.prayer).toBe(true);
    expect(dq.reviewRecommended).toBe(false);
  });

  it('computeDraftQuality exports structureMarkers', () => {
    const dq = computeDraftQuality({
      content: SAMPLE_DRAFT,
      riskBadge: 'GREEN',
      authoritiesDelivered: 2,
      taskType: 'legal-draft-fast',
    });
    expect(dq.structureMarkers?.prayer).toBe(true);
    expect(dq.reviewRecommended).toBe(false);
  });

  it('reviewRecommended when counsel draft lacks authorities', () => {
    const dq = computeDraftQuality({
      content: SAMPLE_DRAFT,
      riskBadge: 'GREEN',
      authoritiesDelivered: 0,
      taskType: 'legal-draft-fast',
    });
    expect(dq.reviewRecommended).toBe(true);
  });
});

describe('NV-NSP-COUNSEL-UPGRADE-001', () => {
  it('upgrades legal-draft-fast when draftLength comprehensive', () => {
    const req = nspRequest({
      taskType: 'legal-draft-fast',
      options: { draftLength: 'comprehensive' },
      parameters: { documentType: 'writ_petition' },
    });
    expect(wantsPartnerQualityQueenPath(req)).toBe(true);
    expect(applyPartnerCounselUpgradeTaskType(req)).toBe('legal-draft');
    expect((req.body as Record<string, unknown>).taskType).toBe('legal-draft');
  });

  it('upgrades when qualityMode counsel', () => {
    const req = nspRequest({
      taskType: 'legal-draft-fast',
      qualityMode: 'counsel',
      parameters: { documentType: 'bail_application' },
    });
    expect(applyPartnerCounselUpgradeTaskType(req)).toBe('legal-draft');
  });
});

describe('NV-FAST-DRAFT-RAG-COMPREHENSIVE-001', () => {
  it('does not skip RAG on comprehensive draft-fast without documents', () => {
    expect(shouldSkipRagForPartnerFastDraft('legal-draft-fast', false, false, 'comprehensive')).toBe(false);
    expect(shouldSkipRagForPartnerFastDraft('legal-draft-fast', false, false, 'medium')).toBe(true);
    expect(shouldSkipRagForPartnerFastDraft('legal-draft-fast', false, true)).toBe(false);
  });
});

describe('NV-PARTNER-DOCUMENT-TYPE-VALIDATION-001', () => {
  it('infers documentType on draft taskTypes instead of 400', () => {
    const req = nspRequest({ taskType: 'legal-draft-fast', prompt: 'Draft bail application' });
    expect(validatePartnerDraftDocumentType(req)).toBeNull();
    expect(getPartnerDraftDocumentTypeResolution(req)?.documentType).toBe('bail_application');
  });

  it('accepts valid documentType unchanged', () => {
    const req = nspRequest({
      taskType: 'legal-draft-fast',
      parameters: { documentType: 'bail_application' },
    });
    expect(validatePartnerDraftDocumentType(req)).toBeNull();
    expect(getPartnerDraftDocumentTypeResolution(req)?.wasInferred).toBe(false);
  });
});

describe('NV-AGENT-DRAFT-OVERLAY-001', () => {
  it('returns overlays for pinned agents', () => {
    expect(buildAgentDraftOverlay('A-004')).toMatch(/PRE-FILING CHECKS/);
    expect(buildAgentDraftOverlay('A-005')).toMatch(/NI Act s\.138/);
    expect(buildAgentDraftOverlay('A-006')).toMatch(/personal knowledge/);
    expect(buildAgentDraftOverlay('A-001')).toMatch(/Stamp duty/);
  });
});

describe('NV-CITATION-RETRIEVAL-VERIFY-001 overlap', () => {
  it('propositionMatchesRetrieval accepts moderate overlap', () => {
    const sentence = 'Anticipatory bail may be granted when twin conditions are satisfied.';
    const snippet = 'The twin conditions for anticipatory bail require reasonable apprehension of arrest.';
    expect(propositionMatchesRetrieval(sentence, snippet)).toBe(true);
  });
});

describe('NV-DRAFT-STRUCTURE-CHECKER-001 wiring', () => {
  it('runs on incomplete fast draft when markers missing', () => {
    const incomplete = 'Draft body only — no prayer or verification block.';
    expect(shouldRunDraftStructureChecker({
      taskType: 'legal-draft-fast',
      content: incomplete,
    })).toBe(true);
  });

  it('skips when structure markers already complete', () => {
    expect(shouldRunDraftStructureChecker({
      taskType: 'legal-draft-fast',
      content: SAMPLE_DRAFT,
    })).toBe(false);
  });

  it('skips legal_notice when notice markers complete (no pleading prayer required)', () => {
    expect(shouldRunDraftStructureChecker({
      taskType: 'legal-draft-fast',
      content: SAMPLE_LEGAL_NOTICE,
      documentType: 'legal_notice',
    })).toBe(false);
  });

  it('skips on non-fast task types without docType', () => {
    expect(shouldRunDraftStructureChecker({
      taskType: 'legal-draft',
      content: 'Incomplete draft without prayer.',
    })).toBe(false);
  });

  it('runs for incomplete legal_notice on counsel path', () => {
    const incomplete = 'Subject: Notice\n1. Facts only.\nYours faithfully,\nCounsel';
    expect(shouldRunDraftStructureChecker({
      taskType: 'legal-draft',
      documentType: 'legal_notice',
      content: incomplete,
    })).toBe(true);
  });

  it('runs for incomplete simple_agreement on counsel path', () => {
    expect(shouldRunDraftStructureChecker({
      taskType: 'legal-draft',
      documentType: 'simple_agreement',
      content: 'Agreement stub — no execution block.',
    })).toBe(true);
  });

  it('runs for counsel review_petition when markers complete but draft ends abruptly (P2)', () => {
    const abrupt = [
      'IN THE HIGH COURT AT CALCUTTA',
      'REVIEW PETITION NO. ___ OF 2026',
      'MOST RESPECTFULLY SHOWETH:',
      '1. The petitioner states that paragraph 42 of the impugned judgment contains an error apparent.',
      '2. It is submitted that',
    ].join('\n');
    expect(shouldRunDraftStructureChecker({
      taskType: 'legal-draft',
      documentType: 'review_petition',
      content: abrupt,
    })).toBe(true);
  });

  it('runs for incomplete legal-draft-agentic counsel exit', () => {
    expect(shouldRunDraftStructureChecker({
      taskType: 'legal-draft-agentic',
      documentType: 'execution_petition',
      content: 'Execution stub without prayer or verification.',
    })).toBe(true);
  });

  it('runs for truncated SLP counsel output on writ_petition (P3 variance)', () => {
    const abruptSlp = [
      'IN THE SUPREME COURT OF INDIA',
      'SPECIAL LEAVE PETITION (CRIMINAL) NO. ___ OF 2026',
      'MOST RESPECTFULLY SHOWETH:',
      '1. The Petitioner seeks leave to appeal under Article 136 against the impugned order dated',
    ].join('\n');
    expect(shouldRunDraftStructureChecker({
      taskType: 'legal-draft',
      documentType: 'writ_petition',
      prompt: 'Draft SLP under Article 136 special leave petition',
      content: abruptSlp,
    })).toBe(true);
  });
});

describe('NV-AGENT-RESEARCH-OVERLAY-001 A-047/A-048 split', () => {
  it('returns statute-first overlay for A-047 and statute research', () => {
    expect(buildResearchAgentOverlay('A-047')).toMatch(/STATUTE-FIRST RESEARCH/);
    expect(buildResearchAgentOverlay(undefined, 'statute-research')).toMatch(/STATUTE-FIRST RESEARCH/);
  });

  it('returns caselaw-first overlay for A-048 and caselaw research', () => {
    expect(buildResearchAgentOverlay('A-048')).toMatch(/CASELAW-FIRST RESEARCH/);
    expect(buildResearchAgentOverlay(undefined, 'caselaw-research')).toMatch(/CASELAW-FIRST RESEARCH/);
  });
});

describe('NV-DRAFT-FAST-SLA-COMPREHENSIVE-001 tier cap', () => {
  it('comprehensive tier SLA cap exceeds standard medium cap', () => {
    expect(resolveDraftFastSlaTokenCap('medium')).toBe(8_192);
    expect(resolveDraftFastSlaTokenCap('comprehensive')).toBe(16_384);
    expect(resolveDraftFastSlaTokenCap('comprehensive')).toBeGreaterThan(
      resolveDraftFastSlaTokenCap('medium'),
    );
  });
});
