/**
 * NV-LEGAL-DRAFT-AGENTIC-001 — Tier D1 agentic drafting pipeline.
 */
import { describe, it, expect } from 'vitest';
import {
  isAgenticDraftTaskType,
  buildAgenticDraftPlan,
  summarizeAgenticDraftRun,
  AGENTIC_DRAFT_INTENT,
  AGENTIC_DRAFT_RESEARCH_CAPABILITIES,
} from '../../src/orchestration/jrx-legal-draft-agentic.js';
import { isPartnerDraftTaskType } from '../../src/config/jrx-draft-length-registry.js';
import {
  applyPartnerComprehensiveAgenticUpgradeTaskType,
  isPartnerCounselOrDraftTask,
  isPartnerExplicitFastAlias,
} from '../../src/utils/jrx-partner-platform.js';
import type { Request } from 'express';
import { getDeclaredCapabilitiesForIntent, capabilityManifest } from '../../src/orchestration/capability-manifest.js';
import { analyzeDraftStructureMarkers } from '../../src/services/jrx-draft-completion.js';
import { assembleDraftProfile } from '../../src/orchestration/jrx-draft-profile-assembler.js';

describe('agentic draft — taskType detection', () => {
  it('recognises the -agentic family (not bare / -fast)', () => {
    for (const tt of ['legal-draft-agentic', 'doc-draft-agentic', 'document-draft-agentic', 'legal_draft_agentic']) {
      expect(isAgenticDraftTaskType(tt), tt).toBe(true);
    }
    for (const tt of ['legal-draft', 'legal-draft-fast', 'doc-draft', 'legal-chat', '']) {
      expect(isAgenticDraftTaskType(tt), tt).toBe(false);
    }
  });

  it('is a partner DRAFT taskType (gets doc-type inference + draftProfile branch)', () => {
    expect(isPartnerDraftTaskType('legal-draft-agentic')).toBe(true);
    expect(isPartnerDraftTaskType('doc-draft-agentic')).toBe(true);
  });

  it('is counsel work (full Queen) and NOT an explicit -fast SLA alias', () => {
    expect(isPartnerCounselOrDraftTask('legal-draft-agentic')).toBe(true);
    expect(isPartnerExplicitFastAlias('legal-draft-agentic')).toBe(false);
  });
});

describe('agentic draft — comprehensive NSP upgrade (P1-b)', () => {
  function nspReq(body: Record<string, unknown>): Request {
    return {
      body,
      headers: { 'x-nyv-platform': 'NSP' },
      sdkContext: { partnerCode: 'NSP', tenantId: 't-nsp' },
    } as unknown as Request;
  }

  it('upgrades comprehensive HC writ_petition to legal-draft-agentic', () => {
    const req = nspReq({
      taskType: 'legal-draft',
      options: { draftLength: 'comprehensive' },
      parameters: { documentType: 'writ_petition' },
      prompt: 'Draft writ petition under Article 226 challenging transfer order',
    });
    expect(applyPartnerComprehensiveAgenticUpgradeTaskType(req)).toBe('legal-draft-agentic');
  });

  it('keeps comprehensive SLP (writ_petition) on single-shot legal-draft (P2)', () => {
    const req = nspReq({
      taskType: 'legal-draft',
      options: { draftLength: 'comprehensive' },
      parameters: { documentType: 'writ_petition', courtName: 'Supreme Court of India' },
      prompt: 'Draft Special Leave Petition (Civil) under Article 136',
    });
    expect(applyPartnerComprehensiveAgenticUpgradeTaskType(req)).toBe('legal-draft');
  });

  it('keeps comprehensive review_petition on single-shot legal-draft (P2)', () => {
    const req = nspReq({
      taskType: 'legal-draft',
      options: { draftLength: 'comprehensive' },
      parameters: { documentType: 'review_petition' },
      prompt: 'Review under Order XLVII CPC',
    });
    expect(applyPartnerComprehensiveAgenticUpgradeTaskType(req)).toBe('legal-draft');
  });

  it('keeps comprehensive legal_notice on bare legal-draft', () => {
    const req = nspReq({
      taskType: 'legal-draft',
      options: { draftLength: 'comprehensive' },
      parameters: { documentType: 'legal_notice' },
      prompt: 'NI Act 138 notice',
    });
    expect(applyPartnerComprehensiveAgenticUpgradeTaskType(req)).toBe('legal-draft');
  });
});

describe('agentic draft — mesh wiring (NV-MESH-001)', () => {
  it('draft_agentic INTENT binds to real, resolvable capabilities', () => {
    const ids = getDeclaredCapabilitiesForIntent(AGENTIC_DRAFT_INTENT);
    expect(ids && ids.length).toBeGreaterThan(0);
    for (const id of ids!) {
      expect(capabilityManifest.get(id), id).toBeTruthy();
    }
  });

  it('research capabilities are all in the manifest', () => {
    for (const id of AGENTIC_DRAFT_RESEARCH_CAPABILITIES) {
      expect(capabilityManifest.get(id), id).toBeTruthy();
    }
  });
});

describe('agentic draft — plan (deterministic, grounded)', () => {
  it('builds a 4-stage plan grounded in existing registries', () => {
    const plan = buildAgenticDraftPlan({
      documentType: 'civil_suit_plaint',
      nvTemplateKey: 'declaration_injunction_suit',
      prompt: 'Suit for declaration of title and permanent injunction over survey no. 12',
    });
    expect(plan.stages.map((s) => s.stage)).toEqual(['plan', 'research', 'draft', 'self_validate']);
    expect(plan.structureSections.length).toBeGreaterThanOrEqual(5);
    expect(plan.filingChecklistLabels.length).toBeGreaterThan(0);
    expect(plan.researchCapabilityIds).toContain('intelligence.precedent');
    expect(plan.researchQueries.length).toBeGreaterThan(0);
    expect(plan.draftingAgentId).toMatch(/^A-\d+/);
    expect(plan.targetTier).toBe('comprehensive');
    expect(plan.targetTokens).toBeGreaterThan(4096);
  });

  it('plan stage is complete; research/draft/self_validate start planned', () => {
    const plan = buildAgenticDraftPlan({ documentType: 'legal_notice' });
    const byStage = Object.fromEntries(plan.stages.map((s) => [s.stage, s.status]));
    expect(byStage.plan).toBe('complete');
    expect(byStage.research).toBe('planned');
    expect(byStage.draft).toBe('planned');
    expect(byStage.self_validate).toBe('planned');
  });
});

describe('agentic draft — self-validate verdict from validationResults[]', () => {
  it('PASS when structure is complete (no failing checks)', () => {
    const content = [
      'IN THE COURT OF THE DISTRICT MUNSIF AT CHENNAI',
      'O.S. No. ____ of 2026',
      '1. The plaintiff is a resident of ...',
      '2. The cause of action arose on ...',
      'PRAYER: The plaintiff prays for a decree of declaration and permanent injunction.',
      'VERIFICATION: Verified at Chennai on this day.',
    ].join('\n');
    const markers = analyzeDraftStructureMarkers(content, 'civil_suit_plaint');
    const { validationResults } = assembleDraftProfile({ documentType: 'civil_suit_plaint', structureMarkers: markers });
    const plan = buildAgenticDraftPlan({ documentType: 'civil_suit_plaint' });
    const report = summarizeAgenticDraftRun({ plan, validationResults, drafted: true });
    expect(report.verdict).toBe('pass');
    expect(report.refinePassRecommended).toBe(false);
    const sv = report.stages.find((s) => s.stage === 'self_validate');
    expect(sv?.status).toBe('complete');
    // research/draft marked complete once drafted
    expect(report.stages.find((s) => s.stage === 'draft')?.status).toBe('complete');
  });

  it('REFINE recommended when a mandatory structural check fails', () => {
    const markers = analyzeDraftStructureMarkers('Just an unstructured paragraph with no prayer.', 'petition_application');
    const { validationResults } = assembleDraftProfile({ documentType: 'petition_application', structureMarkers: markers });
    const plan = buildAgenticDraftPlan({ documentType: 'petition_application' });
    const report = summarizeAgenticDraftRun({ plan, validationResults, drafted: true });
    expect(report.verdict).toBe('refine_recommended');
    expect(report.refinePassRecommended).toBe(true);
    expect(report.failingChecks.length).toBeGreaterThan(0);
    expect(report.stages.find((s) => s.stage === 'self_validate')?.status).toBe('refine_recommended');
  });
});
