/**
 * NV-INDIAN-STRUCTURE-001 — checklist registry + prompt injection tests.
 */
import { describe, it, expect } from 'vitest';
import {
  INDIAN_DRAFT_STRUCTURE_CHECKLIST,
  INDIAN_DRAFT_STRUCTURE_MARKER,
  formatIndianDraftStructureChecklist,
  getIndianDraftStructureChecklist,
} from '../../src/services/jrx-indian-draft-structure-registry.js';
import { buildLegalDraftSystemPrompt } from '../../src/services/jrx-legal-drafting-prompt.js';
import {
  buildLegalChatStructurePrompt,
  buildUniversalLegalIntelligenceOverlay,
  LEGAL_CHAT_STRUCTURE_MARKER,
} from '../../src/services/jrx-legal-intelligence-overlay.js';
import type { DraftDocumentType } from '../../src/config/jrx-draft-length-registry.js';

const ALL_DOCUMENT_TYPES = Object.keys(INDIAN_DRAFT_STRUCTURE_CHECKLIST) as DraftDocumentType[];

describe('./jrx-indian-draft-structure-registry', () => {
  it('covers all DraftDocumentType registry keys', () => {
    expect(ALL_DOCUMENT_TYPES.length).toBeGreaterThanOrEqual(22);
    for (const docType of ALL_DOCUMENT_TYPES) {
      const sections = getIndianDraftStructureChecklist(docType);
      expect(sections.length).toBeGreaterThanOrEqual(5);
      expect(sections.join(' ').length).toBeGreaterThan(80);
    }
  });

  it('formats bail_application checklist with marker', () => {
    const block = formatIndianDraftStructureChecklist({ documentType: 'bail_application' });
    expect(block).toContain(INDIAN_DRAFT_STRUCTURE_MARKER);
    expect(block).toContain('bail_application');
    expect(block).toMatch(/FIR synopsis/i);
    expect(block).toMatch(/NO surety/i);
  });

  it('formats writ_petition checklist with writ-specific sections', () => {
    const block = formatIndianDraftStructureChecklist({ documentType: 'writ_petition' });
    expect(block).toMatch(/Article 226|writ of mandamus/i);
    expect(block).toMatch(/Memo of parties/i);
  });

  it('infers documentType from prompt when explicit type absent', () => {
    const block = formatIndianDraftStructureChecklist({
      prompt: 'Draft anticipatory bail under BNS for Sessions Court Chennai',
    });
    expect(block).toContain('bail_application');
  });
});

describe('buildLegalDraftSystemPrompt checklist injection', () => {
  for (const docType of ['bail_application', 'writ_petition', 'legal_notice', 'simple_agreement'] as const) {
    it(`injects ${docType} mandatory sections`, () => {
      const sp = buildLegalDraftSystemPrompt({
        jurisdiction: 'IN',
        documentType: docType,
        partnerBestOutcome: true,
      });
      expect(sp).toContain(INDIAN_DRAFT_STRUCTURE_MARKER);
      expect(sp).toContain(docType);
      const sections = INDIAN_DRAFT_STRUCTURE_CHECKLIST[docType];
      expect(sp).toContain(sections[0].slice(0, 24));
    });
  }

  it('bail draft still includes surety rule and checklist', () => {
    const sp = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      documentType: 'bail_application',
      instruction: 'anticipatory bail',
    });
    expect(sp).toMatch(/SURETIES RULE|Do NOT draft surety/i);
    expect(sp).toContain('bail_application');
  });
});

describe('buildLegalChatStructurePrompt', () => {
  it('includes sources consulted block', () => {
    const full = buildLegalChatStructurePrompt(false);
    expect(full).toContain(LEGAL_CHAT_STRUCTURE_MARKER);
    expect(full).toMatch(/SOURCES CONSULTED/i);
    expect(full).toMatch(/Never fabricate citations/i);
  });

  it('overlay injects chat structure for legal-chat-fast taskType', () => {
    const overlay = buildUniversalLegalIntelligenceOverlay({
      prompt: 'Is anticipatory bail available under BNSS for a BNS 103 FIR?',
      jurisdiction: 'IN',
      taskType: 'legal-chat-fast',
      depth: 'full',
    });
    expect(overlay).toContain(LEGAL_CHAT_STRUCTURE_MARKER);
    expect(overlay).toMatch(/SOURCES CONSULTED/i);
  });

  it('overlay injects draft checklist when documentType present on draft path', () => {
    const overlay = buildUniversalLegalIntelligenceOverlay({
      prompt: 'Draft complete bail application for accused in custody',
      jurisdiction: 'IN',
      taskType: 'legal-draft-fast',
      documentType: 'bail_application',
      depth: 'full',
    });
    expect(overlay).toContain(INDIAN_DRAFT_STRUCTURE_MARKER);
    expect(overlay).toContain('bail_application');
    expect(overlay).toMatch(/FIR synopsis/i);
  });
});
