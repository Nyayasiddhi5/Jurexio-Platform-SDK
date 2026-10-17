import { describe, expect, it } from 'vitest';
import {
  isShortStatuteFaq,
  needsMoreThanOneSection,
  parseStatuteReference,
} from '../../../src/services/jrx-statute-qa-grounding.js';

/**
 * NV-STATUTE-FAQ-SCOPE-001 regression suite.
 *
 * Measured defect: a 208-char litigation-strategy prompt — "anticipatory bail
 * under BNSS 482, PMLA attachment exposure, and parallel SEBI proceedings" —
 * satisfied every condition of `isShortStatuteFaq` (under 280 chars, parsed a
 * section reference, matched none of the excluded keywords). The strict
 * statute-FAQ gate therefore discarded the Queen's synthesised multi-agent
 * answer and replaced it with a 732-char BNSS 482 excerpt, *after* the platform
 * had already paid for up to five provider completions.
 */
describe('./jrx-statute-qa-grounding — FAQ scope (NV-STATUTE-FAQ-SCOPE-001)', () => {
  const STRATEGY_PROMPT =
    'Devise a litigation strategy for a multi-jurisdiction economic offence: '
    + 'anticipatory bail under BNSS 482, PMLA attachment exposure, and parallel '
    + 'SEBI proceedings. Sequence the remedies and flag limitation risks.';

  it('does not treat the measured litigation-strategy prompt as a section FAQ', () => {
    // Guard the exact prompt that reproduced the defect on nysdev.
    expect(STRATEGY_PROMPT.length).toBeLessThan(280);
    expect(parseStatuteReference(STRATEGY_PROMPT)).not.toBeNull();
    expect(needsMoreThanOneSection(STRATEGY_PROMPT)).toBe(true);
    expect(isShortStatuteFaq(STRATEGY_PROMPT)).toBe(false);
  });

  it('still treats a genuine single-section FAQ as a section FAQ', () => {
    expect(isShortStatuteFaq('What does BNS 318 say?')).toBe(true);
    expect(isShortStatuteFaq('Explain Section 482 of BNSS')).toBe(true);
  });

  it('flags non-core instruments as out of single-section scope', () => {
    for (const q of [
      'BNS 318 and PMLA attachment',
      'Does BNSS 482 interact with SEBI proceedings?',
      'BNS 318 exposure under the Companies Act',
      'IPC 420 versus NDPS provisions',
    ]) {
      expect(needsMoreThanOneSection(q)).toBe(true);
      expect(isShortStatuteFaq(q)).toBe(false);
    }
  });

  it('flags reasoning/strategy asks as out of single-section scope', () => {
    for (const q of [
      'What is my strategy under BNSS 482?',
      'Sequence the remedies available under BNS 318',
      'What is the limitation risk for BNSS 482?',
      'Which court has jurisdiction for BNS 318 and what are my options?',
    ]) {
      expect(isShortStatuteFaq(q)).toBe(false);
    }
  });

  it('flags two or more distinct core-code sections', () => {
    expect(needsMoreThanOneSection('Compare BNSS 482 with BNS 318')).toBe(true);
    // A single section repeated is still one section.
    expect(needsMoreThanOneSection('BNS 318 — what does BNS 318 mean?')).toBe(false);
  });

  it('preserves the Phase 0 old→new mapping fast path', () => {
    // Mapping questions must remain FAQ-eligible: they are answered
    // deterministically from NYS with zero LLM tokens.
    for (const q of [
      'What is the BNS equivalent of IPC 420?',
      'IPC 302 maps to which BNS section?',
      'CrPC 438 to BNSS mapping',
    ]) {
      expect(isShortStatuteFaq(q)).toBe(true);
    }
  });

  it('leaves an ordinary long prompt with no section reference alone', () => {
    expect(isShortStatuteFaq('Draft a rent agreement for a Bengaluru flat')).toBe(false);
  });
});
