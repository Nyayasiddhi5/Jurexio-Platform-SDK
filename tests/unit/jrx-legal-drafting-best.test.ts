/**
 * NV-LEGAL-DRAFT-BEST-001 — unit tests for India drafting prompts + format polish.
 */
import { describe, it, expect } from 'vitest';
import {
  buildLegalDraftSystemPrompt,
  buildLegalDraftUserPrompt,
  inferDraftDocFamily,
  buildLegalSummarizeSystemPrompt,
  buildLegalAdviceSystemPrompt,
  LEGAL_DRAFT_ADVOCATE_DISCLAIMER,
} from '../../src/services/jrx-legal-drafting-prompt.js';
import { applyLegalResponseFormatting } from '../../src/services/jrx-legal-response-format.js';
import { decideAdaptivePath } from '../../src/orchestration/jrx-adaptive-router.js';

describe('./jrx-legal-drafting-prompt', () => {
  it('infers Indian pleading families', () => {
    expect(inferDraftDocFamily('custom', 'writ petition')).toBe('petition');
    expect(inferDraftDocFamily('plaint', undefined)).toBe('plaint');
    expect(inferDraftDocFamily('custom', undefined, 'draft anticipatory bail')).toBe('bail');
    expect(inferDraftDocFamily('nda', undefined)).toBe('contract');
    expect(inferDraftDocFamily('custom', undefined, 'send legal notice under NI Act')).toBe('notice');
  });

  it('builds India system prompt with BNS/BNSS and pleading structure', () => {
    const sp = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'petition',
      documentType: 'writ',
      partnerBestOutcome: true,
    });
    expect(sp).toMatch(/BNS 2023/);
    expect(sp).toMatch(/BNSS 2023/);
    expect(sp).toMatch(/MOST RESPECTFULLY|Cause title|Prayer|High Court/i);
    expect(sp).toMatch(/best-outcome|advocate/i);
    expect(sp).not.toMatch(/Use IPC for new offences/);
  });

  it('counsel quality bar stays paper-book for bail but not for legal_notice', () => {
    const bail = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'bail_application',
      documentType: 'bail_application',
      partnerBestOutcome: true,
    });
    expect(bail).toMatch(/paper-book|Showeth/i);

    const notice = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'legal_notice',
      documentType: 'legal_notice',
      partnerBestOutcome: true,
    });
    expect(notice).toMatch(/legal notice|demand letter/i);
    expect(notice).not.toMatch(/COMPREHENSIVE paper-book/i);
    expect(notice).toMatch(/NV-INDIAN-DRAFT-STRUCTURE-001/);
  });

  it('bail drafts forbid surety schedules and inject forum context', () => {
    const sp = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'bail',
      instruction: 'draft anticipatory bail',
      parameters: {
        highCourt: 'High Court of Judicature at Madras',
        district: 'Chennai',
        courtName: 'Sessions Court',
      },
      partnerBestOutcome: true,
    });
    expect(sp).toMatch(/SURETIES RULE|Do NOT draft surety/i);
    expect(sp).toMatch(/High Court of Judicature at Madras/);
    expect(sp).toMatch(/Chennai/);
    expect(sp).toMatch(/humanized|practising Indian advocate|chatbot/i);
  });

  it('builds user prompt with placeholders instruction', () => {
    const up = buildLegalDraftUserPrompt({
      template: 'legal_notice',
      jurisdiction: 'IN',
      parameters: { party: 'Acme Pvt Ltd', amount: 500000 },
      instruction: 'Demand payment under NI Act s.138',
    });
    expect(up).toMatch(/Acme Pvt Ltd/);
    expect(up).toMatch(/PLACEHOLDER|SQUARE BRACKETS/i);
    expect(up).toMatch(/NI Act/);
  });

  it('summarize + advice prompts are India-aware', () => {
    expect(buildLegalSummarizeSystemPrompt('IN')).toMatch(/BNS/);
    expect(buildLegalAdviceSystemPrompt('IN')).toMatch(/limitation|Advocate/i);
  });
});

describe('applyLegalResponseFormatting for drafts', () => {
  it('adds advocate disclaimer on document-drafting', () => {
    const out = applyLegalResponseFormatting('## Draft\n\nMOST RESPECTFULLY SHOWETH:\n1. Facts.', {
      jurisdiction: 'IN',
      taskType: 'document-drafting',
    });
    expect(out).toMatch(/\*\*MOST RESPECTFULLY SHOWETH:\*\*/);
    expect(out).toContain(LEGAL_DRAFT_ADVOCATE_DISCLAIMER.slice(0, 40));
  });

  it('appends missing counsel headings on thin research answers', () => {
    const out = applyLegalResponseFormatting('Bail may be granted on facts.', {
      jurisdiction: 'IN',
      taskType: 'legal-chat',
      comprehensive: true,
    });
    expect(out).toMatch(/ISSUE & SHORT ANSWER/);
    expect(out).toMatch(/APPLICABLE LAW/);
    expect(out).toMatch(/Counsel structure \(NV-LEGAL-STRUCTURE-ATTACH-001/);
  });

  it('skips heading stubs when JRX_LEGAL_COMPREHENSIVE=0', () => {
    const prev = process.env.JRX_LEGAL_COMPREHENSIVE;
    process.env.JRX_LEGAL_COMPREHENSIVE = '0';
    try {
      const out = applyLegalResponseFormatting('Bail may be granted on facts.', {
        jurisdiction: 'IN',
        taskType: 'legal-chat',
      });
      expect(out).not.toMatch(/Counsel completeness/);
    } finally {
      if (prev === undefined) delete process.env.JRX_LEGAL_COMPREHENSIVE;
      else process.env.JRX_LEGAL_COMPREHENSIVE = prev;
    }
  });
});

describe('AdaptiveRouter drafting elevation', () => {
  it('treats freeform draft as Queen task under NSP best-outcome', () => {
    const d = decideAdaptivePath({
      prompt: 'Draft a legal notice under NI Act for unpaid invoice',
      taskType: 'document-drafting',
      complexity: 'moderate',
      risk: 'medium',
      forceLegalBestOutcome: true,
      nyvDependent: true,
    });
    expect(d.path).toBe('queen');
    expect(d.requireCoT).toBe(true);
  });

  it('QUEEN_TASK_TYPE matches document-drafting', () => {
    const d = decideAdaptivePath({
      prompt: 'Please prepare the instrument',
      taskType: 'document-drafting',
      complexity: 'moderate',
      risk: 'medium',
    });
    expect(d.path).toBe('queen');
  });

  /**
   * NV-QUEEN-EARNED-001 (2026-08-16): previously asserted `queen`. A single-issue
   * anticipatory-bail question carrying ONE section anchor, on a task type whose
   * own name says `fast`, is the exact shape §10.2 rule 2 says must not fan out.
   * It is now a specialist request — but CoT and maker-checker are retained, so
   * the change is a cost change and not a quality change.
   */
  it('legal-chat-fast under NSP best-outcome keeps depth but drops fan-out', () => {
    const d = decideAdaptivePath({
      prompt: 'Is anticipatory bail available for a BNS 103 FIR in Chennai?',
      taskType: 'legal-chat-fast',
      complexity: 'simple',
      risk: 'medium',
      forceLegalBestOutcome: true,
      nyvDependent: true,
    });
    expect(d.path).toBe('specialist');
    expect(d.requireCoT).toBe(true);
    expect(d.requireMakerChecker).toBe(true);
    expect(d.queenAdmission?.admit).toBe(false);
  });
});
