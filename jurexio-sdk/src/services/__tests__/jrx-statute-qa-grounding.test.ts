/**
 * Unit tests — NV-STATUTE-QA-GROUND-001
 */
import { describe, expect, it } from 'vitest';
import {
  answerConflictsWithStatuteTitle,
  applyStatuteQaGroundingGate,
  isOldNewMappingQuestion,
  isShortStatuteFaq,
  needsGenerationBeyondRetrieval,
  needsMoreThanOneSection,
  needsReasoningBeyondStoredText,
  parseOldNewMappingReference,
  parseOldNewMappingReferences,
  parseStatuteReference,
} from '../jrx-statute-qa-grounding.js';

describe('parseStatuteReference', () => {
  it('parses BNS 103 shorthand', () => {
    expect(parseStatuteReference('BNS 103')).toEqual({ act: 'BNS', section: '103' });
  });

  it('parses natural language BNS Section 103', () => {
    const r = parseStatuteReference('What is Section 103 of the Bharatiya Nyaya Sanhita about?');
    expect(r).toEqual({ act: 'BNS', section: '103' });
  });

  it('parses offence FAQ form', () => {
    expect(
      parseStatuteReference('What offence does Section 103 of the Bharatiya Nyaya Sanhita punish?'),
    ).toEqual({ act: 'BNS', section: '103' });
  });

  it('parses IPC 302', () => {
    expect(parseStatuteReference('Explain IPC Section 302')).toEqual({ act: 'IPC', section: '302' });
  });

  it('detects IPC→BNS replacement questions', () => {
    expect(isOldNewMappingQuestion('What BNS section replaced IPC 302?')).toBe(true);
    expect(parseOldNewMappingReference('What BNS section replaced IPC 302?')).toEqual({
      fromCode: 'IPC',
      section: '302',
    });
    expect(parseOldNewMappingReference('CrPC 438 under BNSS')).toEqual({
      fromCode: 'CrPC',
      section: '438',
    });
    expect(parseOldNewMappingReference('IRPC 438 equivalent in BNSS')).toEqual({
      fromCode: 'CrPC',
      section: '438',
    });
  });

  it('returns null for non-statute queries', () => {
    expect(parseStatuteReference('How do I draft an NDA?')).toBeNull();
  });
});

describe('isShortStatuteFaq', () => {
  it('flags short BNS section FAQs', () => {
    expect(isShortStatuteFaq('What offence does Section 103 of the Bharatiya Nyaya Sanhita punish?')).toBe(true);
  });

  it('treats IPC replacement questions as short FAQs', () => {
    expect(isShortStatuteFaq('What BNS section replaced IPC 302?')).toBe(true);
  });

  it('excludes comparative prompts', () => {
    expect(isShortStatuteFaq('Compare BNS 103 with IPC 302 case law')).toBe(false);
  });
});

describe('parseOldNewMappingReferences — NV-STATUTE-MAP-MULTI-001', () => {
  it('returns every distinct old-code section, not just the first', () => {
    expect(parseOldNewMappingReferences('What replaced IPC 302 and IPC 420?')).toEqual([
      { fromCode: 'IPC', section: '302' },
      { fromCode: 'IPC', section: '420' },
    ]);
  });

  it('spans codes in one question', () => {
    const refs = parseOldNewMappingReferences('Which sections replaced IPC 302 and CrPC 438?');
    expect(refs).toEqual([
      { fromCode: 'IPC', section: '302' },
      { fromCode: 'CrPC', section: '438' },
    ]);
  });

  it('dedupes repeated references', () => {
    expect(parseOldNewMappingReferences('IPC 302 — what replaced IPC 302?')).toEqual([
      { fromCode: 'IPC', section: '302' },
    ]);
  });

  it('caps at five so one message cannot fan out unbounded', () => {
    const q = 'What replaced IPC 302, IPC 420, IPC 376, IPC 379, IPC 411 and IPC 499?';
    expect(parseOldNewMappingReferences(q)).toHaveLength(5);
  });

  it('keeps the single-reference API backward compatible', () => {
    expect(parseOldNewMappingReference('What replaced IPC 302 and IPC 420?')).toEqual({
      fromCode: 'IPC',
      section: '302',
    });
  });

  it('returns nothing without a mapping cue', () => {
    expect(parseOldNewMappingReferences('IPC 302 punishment')).toEqual([]);
  });
});

describe('scope helpers shared with the deterministic tier', () => {
  it('needsReasoningBeyondStoredText catches strategy and non-core instruments', () => {
    expect(needsReasoningBeyondStoredText('bail strategy under BNSS 482')).toBe(true);
    expect(needsReasoningBeyondStoredText('BNS 318 with PMLA attachment')).toBe(true);
    expect(needsReasoningBeyondStoredText('What does BNS 103 say?')).toBe(false);
  });

  it('needsGenerationBeyondRetrieval catches verbs NYS does not flag', () => {
    // NYS's own GENERATIVE_HINTS list omits these, so its llmRequired stays
    // false — this is the gap the local gate exists to close.
    expect(needsGenerationBeyondRetrieval('Recommend an approach for BNS 103')).toBe(true);
    expect(needsGenerationBeyondRetrieval('Compare BNS 103 with IPC 302')).toBe(true);
    expect(needsGenerationBeyondRetrieval('What should I do about BNS 103?')).toBe(true);
    expect(needsGenerationBeyondRetrieval('What does BNS 103 say?')).toBe(false);
  });

  it('needsMoreThanOneSection still delegates to the shared reasoning test', () => {
    expect(needsMoreThanOneSection('bail strategy under BNSS 482')).toBe(true);
    expect(needsMoreThanOneSection('BNSS 482 and BNS 318')).toBe(true);
    expect(needsMoreThanOneSection('What does BNS 103 say?')).toBe(false);
  });
});

describe('applyStatuteQaGroundingGate — NV-DRAFT-STATUTE-GATE-001', () => {
  it('preserves draft output when generation is requested', async () => {
    const query =
      'Draft an anticipatory bail application for the Principal Sessions Judge at Hyderabad. The offence is cheating committed in March 2025.';
    const draftBody = 'IN THE COURT OF...\n\nMOST RESPECTFULLY SHOWETH:\n1. The applicant seeks bail.';
    const gated = await applyStatuteQaGroundingGate({ query, answer: draftBody, jurisdiction: 'IN' });
    expect(gated.content).toBe(draftBody);
    expect(gated.reason).toBe('generation_requested');
    expect(gated.corrected).toBe(false);
  });
});

describe('answerConflictsWithStatuteTitle', () => {
  it('flags theft answer against murder title', () => {
    expect(
      answerConflictsWithStatuteTitle(
        'Section 103 of the Bharatiya Nyaya Sanhita punishes the offence of theft.',
        'Punishment for murder',
      ),
    ).toBe(true);
  });

  it('accepts murder-aligned answer', () => {
    expect(
      answerConflictsWithStatuteTitle(
        'BNS Section 103 deals with the punishment for murder.',
        'Punishment for murder',
      ),
    ).toBe(false);
  });

  it('flags irreconcilable multi-agent waffle', () => {
    expect(
      answerConflictsWithStatuteTitle(
        'The evidence contains irreconcilable conflicts. Agents cite five completely different offences for Section 103.',
        'Punishment for murder',
      ),
    ).toBe(true);
  });
});
