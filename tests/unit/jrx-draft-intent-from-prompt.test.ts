/**
 * NV-DRAFT-INTENT-PROMPT-001 — prompt → drafting-intent fail-open resolver.
 *
 * Proves NYV-level intelligence when NSP omits documentType/filingContext and
 * sends only a prompt: intent decode, fine-grained nvTemplateKey where a
 * statutory trigger is unambiguous, and a safe default envelope otherwise.
 */
import { describe, it, expect } from 'vitest';
import {
  inferDraftIntentFromPrompt,
  DRAFT_INTENT_LOW_CONFIDENCE,
} from '../../src/config/jrx-draft-intent-from-prompt.js';
import { resolveDraftDocumentTypeWithMeta } from '../../src/config/jrx-draft-length-registry.js';
import { assembleDraftProfile } from '../../src/orchestration/jrx-draft-profile-assembler.js';

describe('inferDraftIntentFromPrompt — keyword/heuristic map', () => {
  it('S.138 cheque-bounce notice → legal_notice + ni_138_statutory_notice', () => {
    const intent = inferDraftIntentFromPrompt(
      'Draft a section 138 NI Act notice for a dishonoured cheque of Rs 5,00,000',
    );
    expect(intent.docType).toBe('legal_notice');
    expect(intent.nvTemplateKey).toBe('ni_138_statutory_notice');
    expect(intent.source).toBe('prompt_heuristic');
    expect(intent.confidence).toBeGreaterThanOrEqual(0.9);
    expect(intent.rationale.length).toBeGreaterThan(0);
  });

  it('plaint → civil_suit_plaint', () => {
    const intent = inferDraftIntentFromPrompt('Prepare a plaint for recovery of money in the City Civil Court');
    expect(intent.docType).toBe('civil_suit_plaint');
    expect(intent.source).toBe('prompt_heuristic');
    expect(intent.confidence).toBeGreaterThan(DRAFT_INTENT_LOW_CONFIDENCE);
  });

  it('caveat → caveat + civil_caveat', () => {
    const intent = inferDraftIntentFromPrompt('Lodge a caveat under section 148A CPC before the High Court');
    expect(intent.docType).toBe('caveat');
    expect(intent.nvTemplateKey).toBe('civil_caveat');
    expect(intent.source).toBe('prompt_heuristic');
  });

  it('generic vague prompt → general_legal_document default (fail-open, low confidence)', () => {
    const intent = inferDraftIntentFromPrompt('Prepare a legal document for my client');
    expect(intent.docType).toBe('general_legal_document');
    expect(intent.source).toBe('default');
    expect(intent.confidence).toBeLessThan(DRAFT_INTENT_LOW_CONFIDENCE);
    expect(intent.nvTemplateKey).toBeUndefined();
  });

  it('empty prompt never throws and fails open to default', () => {
    const intent = inferDraftIntentFromPrompt('');
    expect(intent.docType).toBe('general_legal_document');
    expect(intent.source).toBe('default');
  });

  it('cross-objection statutory trigger maps to civil_cross_objection', () => {
    const intent = inferDraftIntentFromPrompt('File a cross-objection under Order XLI Rule 22');
    expect(intent.docType).toBe('cross_objection');
    expect(intent.nvTemplateKey).toBe('civil_cross_objection');
  });
});

describe('resolveDraftDocumentTypeWithMeta — enriched with confidence/rationale/nvTemplateKey', () => {
  it('explicit registry type is confidence 1 and carries rationale', () => {
    const meta = resolveDraftDocumentTypeWithMeta({ documentType: 'writ_petition' });
    expect(meta.documentType).toBe('writ_petition');
    expect(meta.source).toBe('explicit_registry');
    expect(meta.confidence).toBe(1);
    expect(meta.rationale.length).toBeGreaterThan(0);
  });

  it('prompt-only S.138 resolves legal_notice and threads the inferred nvTemplateKey', () => {
    const meta = resolveDraftDocumentTypeWithMeta({
      prompt: 'Notice for cheque bounce under section 138',
    });
    expect(meta.documentType).toBe('legal_notice');
    expect(meta.source).toBe('prompt_inferred');
    expect(meta.nvTemplateKey).toBe('ni_138_statutory_notice');
    expect(meta.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('vague prompt falls open to general_legal_document at low confidence', () => {
    const meta = resolveDraftDocumentTypeWithMeta({ prompt: 'help me with something legal' });
    expect(meta.documentType).toBe('general_legal_document');
    expect(meta.source).toBe('general_fallback');
    expect(meta.confidence).toBeLessThan(DRAFT_INTENT_LOW_CONFIDENCE);
  });
});

describe('assembleDraftProfile — default envelope + intentResolution when NSP omits filingContext', () => {
  it('emits intentResolution + fallbackReason and a fine-grained checklist from the inferred key', () => {
    const resolution = resolveDraftDocumentTypeWithMeta({
      prompt: 'Draft a section 138 notice for a bounced cheque',
    });
    const { draftProfile, validationResults } = assembleDraftProfile({
      documentType: resolution.documentType,
      documentTypeResolution: resolution,
      // No filingContext — the whole point of the fail-open path.
    });
    expect(draftProfile.documentType).toBe('legal_notice');
    expect(draftProfile.intentResolution?.source).toBe('prompt_inferred');
    expect(draftProfile.intentResolution?.nvTemplateKey).toBe('ni_138_statutory_notice');
    expect(draftProfile.fallbackReason).toBeTruthy();
    // ni_138 has a fine-grained enclosure manifest — checklist must be non-empty.
    expect(draftProfile.filingChecklist.length).toBeGreaterThan(0);
    // No structureMarkers passed → validation is checklist-only, still additive.
    expect(Array.isArray(validationResults)).toBe(true);
  });

  it('clean explicit + filingContext path does NOT emit fallbackReason', () => {
    const resolution = resolveDraftDocumentTypeWithMeta({ documentType: 'caveat' });
    const { draftProfile } = assembleDraftProfile({
      documentType: 'caveat',
      documentTypeResolution: resolution,
      filingContext: { nvTemplateKey: 'civil_caveat', advisoryOnly: true },
    });
    expect(draftProfile.fallbackReason).toBeUndefined();
    expect(draftProfile.intentResolution).toBeUndefined();
  });
});
