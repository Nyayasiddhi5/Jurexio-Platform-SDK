/**
 * NV-DETERMINISTIC-OVERFIRE-001 — the deterministic tier must decline questions
 * no stored excerpt can answer, WITHOUT losing the genuine zero-token wins.
 *
 * Why this test exists: the frozen cost benchmark (2026-08-16) measured two
 * classes carrying **0.50 combined traffic weight** as "100 % cost saving" when
 * they were in fact answering the wrong question. The worst case asked for
 * "leading Supreme Court authorities on anticipatory bail … and how BNSS 482
 * changed the position" and received a BNSS 482 statutory excerpt with no case
 * law, at zero tokens. A cost win on a prompt whose quality drops is a
 * regression, not a saving.
 *
 * Root cause was a *missing disjunct*: `needsReasoningBeyondStoredText` consulted
 * NON_CORE / BEYOND_SECTION_SCOPE / APPLICABILITY but never
 * `GENERATION_REQUESTED_RE`, even though `needsGenerationBeyondRetrieval` returned
 * true for the very same prompt. Nothing detected an authority ask at all.
 *
 * This suite is two-sided by design. Escalating everything would "fix" the
 * over-fire while destroying the 0.30-weight statute-faq/mapping wins that are
 * real, so both directions are asserted and neither can be satisfied alone.
 */
import { describe, it, expect } from 'vitest';
import {
  needsReasoningBeyondStoredText,
  asksForAuthorityBeyondText,
  needsGenerationBeyondRetrieval,
} from '../../src/services/jrx-statute-qa-grounding.js';

/** Genuine 0-token wins — statute-faq (0.22) + statute-mapping (0.08). */
const MUST_STAY_DETERMINISTIC = [
  'What does BNS 103 say?',
  'What is BNS 103?',
  'IPC 302 → BNS?',
  'What replaced IPC 302?',
  'IRPC 41 maps to which BNSS section?',
  'Full form of BNSS?',
  'Punishment for BNS 318?',
  'Explain section 103 of BNS',
  'BNS 103',
  'what is the punishment under BNS 103',
];

/** Measured or adjacent over-fires — each must be denied the excerpt path. */
const MUST_ESCALATE = [
  'Summarise the leading Supreme Court authorities on anticipatory bail in economic offences and how BNSS 482 changed the position.',
  'What are the leading Supreme Court judgments on anticipatory bail?',
  'How did BNSS 482 change the position on anticipatory bail?',
  'Is anticipatory bail available for a BNS 103 FIR?',
  'Draft a bail application under BNSS 482',
  'Analyse whether BNS 103 applies to my client',
  'What is the settled law on anticipatory bail?',
  'Compare BNS 103 and IPC 302',
];

describe('NV-DETERMINISTIC-OVERFIRE-001', () => {
  it('preserves every genuine zero-token win (0.30 of traffic weight)', () => {
    const regressions = MUST_STAY_DETERMINISTIC.filter((p) => needsReasoningBeyondStoredText(p));
    expect(
      regressions,
      'these are real 0-completion wins; escalating them destroys the measured saving',
    ).toEqual([]);
  });

  it('declines every request no stored excerpt can answer', () => {
    const stillWrong = MUST_ESCALATE.filter((p) => !needsReasoningBeyondStoredText(p));
    expect(
      stillWrong,
      'a statutory excerpt is not an answer to these — they must reach a model',
    ).toEqual([]);
  });

  it('the benchmark prompt that produced the false 100 % saving is closed', () => {
    const p =
      'Summarise the leading Supreme Court authorities on anticipatory bail in economic offences and how BNSS 482 changed the position.';
    expect(needsReasoningBeyondStoredText(p)).toBe(true);
    // Two independent reasons, so removing either one still fails the request out
    // of the excerpt path.
    expect(asksForAuthorityBeyondText(p)).toBe(true);
    expect(needsGenerationBeyondRetrieval(p)).toBe(true);
  });

  it('consults the generation predicate it previously ignored (the root cause)', () => {
    // Regression lock: any prompt that asks for generated text must escalate,
    // because the gate silently disagreed with needsGenerationBeyondRetrieval.
    for (const p of ['Summarise BNS 103', 'Draft a notice under BNSS 482', 'Analyse BNS 103']) {
      expect(needsGenerationBeyondRetrieval(p), p).toBe(true);
      expect(needsReasoningBeyondStoredText(p), p).toBe(true);
    }
  });

  it('the authority detector has teeth in both directions', () => {
    // Must fire on authority asks…
    expect(asksForAuthorityBeyondText('leading judgments on anticipatory bail')).toBe(true);
    expect(asksForAuthorityBeyondText('what is the settled law here')).toBe(true);
    // …and must NOT fire on a bare provision lookup, or it would swallow the
    // statute-faq win via a different route.
    expect(asksForAuthorityBeyondText('What does BNS 103 say?')).toBe(false);
    expect(asksForAuthorityBeyondText('IPC 302 → BNS?')).toBe(false);
  });

  it('the legal-change detector does not swallow reverse mapping', () => {
    // "what changed" needs a model; "which section replaced it" does not.
    expect(needsReasoningBeyondStoredText('How did BNSS 482 change the position?')).toBe(true);
    expect(needsReasoningBeyondStoredText('What replaced IPC 302?')).toBe(false);
    expect(needsReasoningBeyondStoredText('IPC 302 → BNS?')).toBe(false);
  });
});
