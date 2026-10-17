import { describe, it, expect } from 'vitest';
import {
  enforceDraftPlaceholders,
  countCounselGradePlaceholders,
  promptRequestsPlaceholders,
} from '../../src/services/jrx-draft-placeholder-enforcer.js';
import { countPlaceholders } from '../../scripts/_nv-counsel-grade-assertions.js';

const WS_BODY = `
IN THE CITY CIVIL COURT AT BENGALURU
CS No. 1234/2024

WRITTEN STATEMENT

1. The defendant denies the allegations in the plaint.
2. Preliminary objection on limitation is taken.

PRAYER
Dismiss the suit with costs.

VERIFICATION
Verified at Bengaluru.
`.trim();

describe('NV-DRAFT-PLACEHOLDER-ENFORCE-001', () => {
  it('detects placeholder requests in prompt', () => {
    expect(promptRequestsPlaceholders('Do not invent party names — use placeholders.')).toBe(true);
    expect(promptRequestsPlaceholders('Draft a comprehensive written statement.')).toBe(false);
  });

  it('appends placeholders when prompt requests them and body has none', () => {
    const result = enforceDraftPlaceholders(WS_BODY, {
      taskType: 'legal-draft-fast',
      query: 'Do not invent party names or amounts — use placeholders.',
      documentType: 'written_statement',
      minPlaceholders: 3,
    });
    expect(result.appended).toBe(true);
    expect(result.placeholdersAfter).toBeGreaterThanOrEqual(3);
    expect(countCounselGradePlaceholders(result.content)).toBeGreaterThanOrEqual(3);
    expect(countPlaceholders(result.content)).toBeGreaterThanOrEqual(3);
    expect(result.content).toMatch(/\[\[PLACEHOLDER: Defendant name and address\]\]/);
  });

  it('no-op when placeholders already sufficient', () => {
    const withPlaceholders = `${WS_BODY}\n[[PLACEHOLDER: A]]\n[[PLACEHOLDER: B]]\n[[PLACEHOLDER: C]]`;
    const result = enforceDraftPlaceholders(withPlaceholders, {
      taskType: 'legal-draft-fast',
      query: 'use placeholders',
      documentType: 'written_statement',
    });
    expect(result.appended).toBe(false);
  });

  it('no-op when prompt does not request placeholders', () => {
    const result = enforceDraftPlaceholders(WS_BODY, {
      taskType: 'legal-draft-fast',
      query: 'Draft written statement for CS 1234/2024',
      documentType: 'written_statement',
    });
    expect(result.appended).toBe(false);
  });
});
