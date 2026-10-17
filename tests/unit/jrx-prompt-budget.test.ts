/**
 * NV-TOKEN-BUDGET-001 — task-class prompt budgets and overlay tiering.
 *
 * Measured defect (plan §1.2): a 19-token legal question reached the provider as
 * 5,059–5,431 prompt tokens. Nothing declared a ceiling, so every layer appended
 * and the fixed preamble was identical for "what is the limitation period?" and
 * for "draft a writ petition".
 *
 * The hard constraint on these tests: this is a legal-AI platform. Token cuts are
 * only legitimate where they remove a DUPLICATE or untargeted boilerplate. The
 * grounding / citation / safety instructions must survive every tier, and the
 * assertions below enforce that.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  budgetForRequest,
  classifyPromptTask,
  estimatePromptTokens,
  getPromptBudget,
} from '../../src/config/jrx-prompt-budget.js';
import {
  buildUniversalLegalIntelligenceOverlay,
  detectLegalIntelTaskKind,
} from '../../src/services/jrx-legal-intelligence-overlay.js';
import {
  buildLegalAdviceSystemPrompt,
  buildLegalDraftSystemPrompt,
} from '../../src/services/jrx-legal-drafting-prompt.js';

const FAQ = 'What does BNS 103 say?';
const APPLICABILITY = 'Is anticipatory bail available for a BNS 318(4) cheating case in Karnataka?';
const DRAFT = 'Draft an anticipatory bail application under BNSS 482 for a BNS 318(4) case.';

describe('./jrx-prompt-budget: classification', () => {
  it('gives a short single-issue question the lean tier', () => {
    expect(classifyPromptTask({ prompt: FAQ })).toBe('micro_faq');
    expect(getPromptBudget('micro_faq').overlayDepth).toBe('compact');
  });

  it('escalates applicability asks above micro_faq', () => {
    expect(classifyPromptTask({ prompt: APPLICABILITY })).toBe('research');
  });

  it('partner legal-draft-fast maps to drafting tier', () => {
    expect(
      classifyPromptTask({
        taskKind: 'legal-draft-fast',
        prompt: 'Draft an anticipatory bail application.',
      }),
    ).toBe('drafting');
    expect(getPromptBudget('drafting').maxOutputTokens).toBeGreaterThanOrEqual(8192);
  });

  it('never downgrades a declared drafting or research intent', () => {
    // The whole point of a budget is that it must not starve real legal work.
    expect(classifyPromptTask({ taskKind: 'legal_drafting', prompt: FAQ })).toBe('drafting');
    expect(classifyPromptTask({ taskKind: 'litigation_strategy', prompt: FAQ })).toBe('drafting');
    expect(classifyPromptTask({ taskKind: 'legal_research', prompt: FAQ })).toBe('research');
    expect(classifyPromptTask({ taskKind: 'contract_analysis', prompt: FAQ })).toBe('research');
  });

  it('never downgrades an explicit deep-work request just because the prompt is short', () => {
    expect(classifyPromptTask({ prompt: 'compare these two clauses', forceBestOutcome: true })).toBe('research');
    expect(classifyPromptTask({ prompt: FAQ, requireReasoning: true })).toBe('research');
  });

  it('NV-FAST-CHAT-SLA-001: legal-chat-fast stays chat tier even under best-outcome', () => {
    expect(
      classifyPromptTask({
        taskKind: 'legal-chat-fast',
        prompt: APPLICABILITY,
        forceBestOutcome: true,
      }),
    ).toBe('chat');
    expect(
      budgetForRequest({
        taskKind: 'legal-chat-fast',
        prompt: APPLICABILITY,
        forceBestOutcome: true,
      }).taskClass,
    ).toBe('chat');
  });

  it('escalates on drafting/research vocabulary even without a declared taskKind', () => {
    for (const p of [DRAFT, 'prepare a legal opinion on stamp duty', 'research the limitation position']) {
      expect(classifyPromptTask({ prompt: p }), p).toBe('research');
    }
  });

  it('orders the ceilings so a heavier class always gets more room', () => {
    const order = ['micro_faq', 'classify', 'chat', 'research', 'drafting'] as const;
    for (let i = 1; i < order.length; i += 1) {
      expect(getPromptBudget(order[i]!).maxPromptTokens).toBeGreaterThan(
        getPromptBudget(order[i - 1]!).maxPromptTokens,
      );
    }
  });

  it('keeps the context share inside the prompt ceiling for every class', () => {
    for (const cls of ['micro_faq', 'classify', 'chat', 'research', 'drafting'] as const) {
      const b = getPromptBudget(cls);
      expect(b.maxContextTokens, cls).toBeLessThan(b.maxPromptTokens);
    }
  });
});

describe('./jrx-prompt-budget: overlay tiering actually shrinks the prompt', () => {
  const prevRefDate = process.env.NYV_REFERENCE_DATE;

  beforeEach(() => {
    process.env.NYV_REFERENCE_DATE = '2026-08-20T12:00:00+05:30';
  });

  afterEach(() => {
    if (prevRefDate === undefined) delete process.env.NYV_REFERENCE_DATE;
    else process.env.NYV_REFERENCE_DATE = prevRefDate;
  });

  const full = buildUniversalLegalIntelligenceOverlay({ prompt: FAQ, jurisdiction: 'IN', depth: 'full' });
  const compact = buildUniversalLegalIntelligenceOverlay({ prompt: FAQ, jurisdiction: 'IN', depth: 'compact' });

  it('compact is materially smaller than full', () => {
    const fullTok = estimatePromptTokens(full);
    const compactTok = estimatePromptTokens(compact);
    expect(compactTok).toBeLessThan(fullTok / 2);
  });

  it('a micro_faq overlay fits inside its declared budget', () => {
    expect(estimatePromptTokens(compact)).toBeLessThanOrEqual(
      budgetForRequest({ prompt: FAQ }).maxPromptTokens,
    );
  });

  it('RETAINS every correctness-critical instruction in the compact tier', () => {
    // These are the reasons we do not simply truncate: an ungrounded or
    // uncited legal answer is a wrong answer, not a cheap one.
    expect(compact, 'jurisdiction grounding').toMatch(/BNS|BNSS|India/i);
    expect(compact, 'citation discipline').toMatch(/cite|citation/i);
    expect(compact, 'no fabrication').toMatch(/invent|fabricat|hallucinat/i);
    expect(compact, 'counsel boundary / not a filed pleading').toMatch(/advocate|counsel|pleading/i);
  });

  it('still emits the query-matched BNSS section — that is grounding, not boilerplate', () => {
    const bailOverlay = buildUniversalLegalIntelligenceOverlay({
      prompt: DRAFT,
      jurisdiction: 'IN',
      depth: 'compact',
    });
    expect(bailOverlay).toMatch(/BNSS/);
  });
});

describe('./jrx-prompt-budget: duplicate restatement is gone', () => {
  it('the overlay does not emit the BNSS pack twice on the drafting path', () => {
    const overlay = buildUniversalLegalIntelligenceOverlay({
      prompt: DRAFT,
      jurisdiction: 'IN',
      depth: 'full',
    });
    // The pack's heading is distinctive; it must appear at most once.
    const heading = /BNSS COURT APPLICATION/gi;
    const hits = overlay.match(heading) ?? [];
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  it('the builders can be asked to skip a block the caller already injected', () => {
    const withBnss = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      instruction: DRAFT,
      includeBnssAndForum: true,
    });
    const withoutBnss = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      instruction: DRAFT,
      includeBnssAndForum: false,
    });
    expect(estimatePromptTokens(withoutBnss)).toBeLessThan(estimatePromptTokens(withBnss));

    const adviceWith = buildLegalAdviceSystemPrompt('IN', DRAFT, true);
    const adviceWithout = buildLegalAdviceSystemPrompt('IN', DRAFT, false);
    expect(estimatePromptTokens(adviceWithout)).toBeLessThan(estimatePromptTokens(adviceWith));
    // The cut is the duplicate pack only — the grounding core must remain.
    expect(adviceWithout).toMatch(/India|BNS/i);
  });
});

describe('./jrx-prompt-budget: a bare topic word must not force the drafting tier', () => {
  it('classifies an interrogative about bail as a question, not a draft request', () => {
    // Previously "bail" alone routed this to `draft`, adding a 622-token
    // drafting preamble to a question that asks for no document at all.
    expect(detectLegalIntelTaskKind(FAQ)).not.toBe('draft');
    expect(detectLegalIntelTaskKind('Can I get bail if the offence is non-bailable?')).not.toBe('draft');
  });

  it('still classifies genuine drafting instructions as drafts', () => {
    for (const p of [
      DRAFT,
      'draft anticipatory bail',
      'prepare an FIR quashing petition',
      'write a legal notice under Section 138 NI Act',
      'file a written statement',
    ]) {
      expect(detectLegalIntelTaskKind(p), p).toBe('draft');
    }
  });
});
