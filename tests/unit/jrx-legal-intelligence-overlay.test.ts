/**
 * NV-LEGAL-INTEL-FORCE-001 — unit tests for universal legal intelligence overlay.
 */
import { describe, it, expect } from 'vitest';
import {
  buildUniversalLegalIntelligenceOverlay,
  mergeLegalIntelligencePrompt,
  preferLegalIntelligenceSystemPrompt,
  looksLikeLegalIntelOverlay,
  LEGAL_INTEL_OVERLAY_MARKER,
  detectLegalIntelTaskKind,
} from '../../src/services/jrx-legal-intelligence-overlay.js';

describe('./jrx-legal-intelligence-overlay', () => {
  it('marks overlays and detects draft/research kinds', () => {
    expect(detectLegalIntelTaskKind('draft anticipatory bail')).toBe('draft');
    expect(detectLegalIntelTaskKind('research BNS 103')).toBe('research');
    const overlay = buildUniversalLegalIntelligenceOverlay({
      prompt: 'draft anticipatory bail under BNSS 482',
      jurisdiction: 'IN',
      partnerBestOutcome: true,
    });
    expect(overlay).toContain(LEGAL_INTEL_OVERLAY_MARKER);
    expect(overlay).toMatch(/PLATFORM REFERENCE DATE/);
    expect(overlay).toMatch(/INDIAN LEGAL CORPUS|CORPUS:/);
    expect(overlay).toMatch(/1950–2026|1950-2026/);
    expect(overlay).toMatch(/SURETIES RULE|practising Indian advocate/i);
    expect(overlay).toMatch(/COMPREHENSIVE counsel-length/i);
    expect(looksLikeLegalIntelOverlay(overlay)).toBe(true);
  });

  it('analysis mode uses India ICA/DPDP completeness, not US GDPR templates', () => {
    const overlay = buildUniversalLegalIntelligenceOverlay({
      prompt: 'analyse this SaaS MSA and flag missing clauses',
      jurisdiction: 'IN',
      taskKind: 'analysis',
    });
    expect(overlay).toMatch(/CHAIN OF THOUGHT/);
    expect(overlay).toMatch(/ICA 1872|Contract Act 1872/);
    expect(overlay).toMatch(/DPDP/);
    expect(overlay).toMatch(/Arbitration and Conciliation Act 1996/);
    expect(overlay).toMatch(/Do not apply US employment \/ GDPR \/ CCPA \/ ADA templates/);
  });

  it('never lets a longer generic registry prompt wipe legal-intel overlay', () => {
    const registry = 'X'.repeat(8000) + ' You are Agent A-001 compliance template.';
    const sme = buildUniversalLegalIntelligenceOverlay({
      prompt: 'draft bail application',
      jurisdiction: 'IN',
    });
    const merged = preferLegalIntelligenceSystemPrompt(sme, registry);
    expect(merged).toContain(LEGAL_INTEL_OVERLAY_MARKER);
    expect(merged).toMatch(/SURETIES RULE|bail/i);
  });

  it('re-appends overlay after simulated compile wipe', () => {
    const overlay = buildUniversalLegalIntelligenceOverlay({
      prompt: 'legal research on anticipatory bail',
      jurisdiction: 'IN',
      taskKind: 'research',
    });
    const compiledOnly = 'Compressed registry prompt without craft.';
    const restored = mergeLegalIntelligencePrompt(compiledOnly, overlay);
    expect(restored).toContain(LEGAL_INTEL_OVERLAY_MARKER);
    expect(restored).toContain('Compressed registry');
  });

  it('preserves §1 ROLE IDENTITY and §2 CORE MANDATE when merging long registry prompts', () => {
    const registry = [
      '<section_0_security_constitution>',
      '§0 SECURITY CONSTITUTION',
      'X'.repeat(5000),
      '</section_0_security_constitution>',
      '<section_1_identity>',
      '§1 ROLE IDENTITY',
      'Agent: Contract Drafting Agent',
      'ID: A-001',
      '</section_1_identity>',
      '<section_2_core_mandate>',
      '§2 CORE MANDATE',
      'Primary Objective: Generates commercial contracts',
      '</section_2_core_mandate>',
      '<section_retrieval_policy>',
      '§ RETRIEVAL POLICY NYS Knowledge Plane FIRST',
      '</section_retrieval_policy>',
    ].join('\n');
    const overlay = buildUniversalLegalIntelligenceOverlay({
      prompt: 'draft a share purchase agreement',
      jurisdiction: 'IN',
      taskKind: 'draft',
    });
    const merged = mergeLegalIntelligencePrompt(registry, overlay);
    expect(merged).toContain('Contract Drafting Agent');
    expect(merged).toContain('A-001');
    expect(merged).toContain('Generates commercial contracts');
    expect(merged).toContain(LEGAL_INTEL_OVERLAY_MARKER);
    expect(merged).not.toMatch(/^X{4000}/); // must not be security-only head trim
  });
});
