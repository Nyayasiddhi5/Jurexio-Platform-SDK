/**
 * NV-LEGAL-STRUCTURE-ATTACH-001 — stored IRAC / Prayer attach (no extra LLM pass).
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  selectLegalStructure,
  attachStoredLegalStructure,
  structureFillOverlay,
  buildStoredPrayer,
} from '../../src/services/jrx-legal-structure-attach.js';
import { applyLegalResponseFormatting } from '../../src/services/jrx-legal-response-format.js';
import { buildUniversalLegalIntelligenceOverlay } from '../../src/services/jrx-legal-intelligence-overlay.js';

describe('legal structure attach', () => {
  const prev: Record<string, string | undefined> = {};
  afterEach(() => {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k]!;
    }
  });

  it('does not attach on extract / search or legal-chat-fast (NV-FAST-CHAT-SLA-001)', () => {
    expect(selectLegalStructure({ taskType: 'extract', query: 'Aadhaar 1234' }).kind).toBe('none');
    expect(selectLegalStructure({ taskType: 'web-search', query: 'bail law' }).kind).toBe('none');
    expect(selectLegalStructure({
      taskType: 'legal-chat-fast',
      query: 'Is anticipatory bail available for a BNS 103 FIR in Chennai?',
      jurisdiction: 'IN',
    }).kind).toBe('none');
  });

  it('attaches IRAC skeleton for legal chat without rewriting existing analysis', () => {
    const analysis = 'Anticipatory bail is discretionary under BNSS 482 on Sibbia principles.';
    const r = attachStoredLegalStructure(analysis, { taskType: 'legal-chat', jurisdiction: 'IN' });
    expect(r.kind).toBe('irac');
    expect(r.attached).toBe(true);
    expect(r.content).toContain(analysis);
    expect(r.content).toMatch(/ISSUE & SHORT ANSWER/);
    expect(r.content).toMatch(/stored skeleton/);
  });

  it('does not re-attach IRAC when headings already present', () => {
    const full = '**ISSUE & SHORT ANSWER**\nYes.\n**FACTS ASSUMED / CONTEXT**\nFIR.\n**APPLICABLE LAW & INGREDIENTS**\nBNSS 482.\n**ANALYSIS**\nGranted.\n**AUTHORITIES**\nSibbia.\n**RISKS & CAVEATS**\nTwin conditions.\n**NEXT STEPS / PRAYER**\nFile at Sessions.';
    const r = attachStoredLegalStructure(full, { taskType: 'legal-chat', jurisdiction: 'IN' });
    expect(r.attached).toBe(false);
  });

  it('skips paper-book Prayer attach for legal_notice drafts', () => {
    const sel = selectLegalStructure({
      taskType: 'legal-draft',
      query: 'Draft demand notice under NI Act s.138',
      jurisdiction: 'IN',
      documentType: 'legal_notice',
    });
    expect(sel.kind).toBe('none');
    const r = attachStoredLegalStructure('Demand for ₹5 lakh within 15 days.', {
      taskType: 'legal-draft',
      query: 'legal notice NI Act',
      jurisdiction: 'IN',
      documentType: 'legal_notice',
    });
    expect(r.attached).toBe(false);
    expect(r.content).not.toMatch(/MOST RESPECTFULLY SHOWETH/);
  });

  it('attaches stored BNSS Prayer for a draft, not a second LLM pass', () => {
    const r = attachStoredLegalStructure('Facts of arrest at Chennai PS.', {
      taskType: 'document-drafting',
      query: 'Draft anticipatory bail under BNSS 482',
      jurisdiction: 'IN',
    });
    expect(r.kind).toBe('bnss-prayer');
    expect(r.slug).toBe('in-bnss-anticipatory-bail-482');
    expect(r.content).toMatch(/\*\*PRAYER\*\*/);
    expect(r.content).toMatch(/BNSS §482/);
    expect(r.content).toMatch(/VERIFICATION/);
    expect(r.content).not.toMatch(/heading was omitted/);
  });

  it('legal chat about bail is IRAC, not a full paper-book Prayer', () => {
    const sel = selectLegalStructure({
      taskType: 'legal-chat',
      query: 'Is anticipatory bail available for a BNS 103 FIR in Chennai?',
      jurisdiction: 'IN',
    });
    expect(sel.kind).toBe('irac');
  });

  it('overlay tells the model not to regenerate the skeleton', () => {
    const ov = structureFillOverlay({ kind: 'bnss-prayer', slug: 'in-bnss-anticipatory-bail-482' });
    expect(ov).toMatch(/do not regenerate/i);
    expect(ov).toMatch(/in-bnss-anticipatory-bail-482/);
    const intel = buildUniversalLegalIntelligenceOverlay({
      prompt: 'Draft regular bail application',
      jurisdiction: 'IN',
      taskKind: 'draft',
    });
    expect(intel).toMatch(/STRUCTURE ATTACH/);
  });

  it('stored prayer uses pack metadata (use-case) without LLM', () => {
    const p = buildStoredPrayer({
      id: 1,
      name: 'Anticipatory Bail Application',
      sections: ['482'],
      category: 'For Freedom',
      formerCrpc: 'CrPC 438',
      forum: 'Sessions',
      useCase: 'Pre-arrest bail.',
      sampleUse: 'x',
      templateSlug: 'in-bnss-anticipatory-bail-482',
    });
    expect(p).toMatch(/Pre-arrest bail/);
    expect(p).toMatch(/§482/);
  });

  it('JRX_LEGAL_STRUCTURE_ATTACH=0 disables attach', () => {
    prev.JRX_LEGAL_STRUCTURE_ATTACH = process.env.JRX_LEGAL_STRUCTURE_ATTACH;
    process.env.JRX_LEGAL_STRUCTURE_ATTACH = '0';
    expect(selectLegalStructure({ taskType: 'legal-chat' }).kind).toBe('none');
    const out = applyLegalResponseFormatting('Thin answer.', {
      jurisdiction: 'IN',
      taskType: 'legal-chat',
      comprehensive: true,
    });
    expect(out).not.toMatch(/NV-LEGAL-STRUCTURE-ATTACH-001/);
  });
});
