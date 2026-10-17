/**
 * NV-FAST-DELIVERY-POLISH-001 — skeleton placeholder cleanup on partner `-fast` paths.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  attachStoredLegalStructure,
} from '../../src/services/jrx-legal-structure-attach.js';
import { applyLegalResponseFormatting } from '../../src/services/jrx-legal-response-format.js';
import {
  applyFastDeliveryPolish,
  deterministicFastDeliveryPolish,
  hasStructureSkeletonPlaceholders,
  shouldRunFastDeliveryPolish,
} from '../../src/services/jrx-fast-delivery-polish.js';

describe('NV-FAST-DELIVERY-POLISH-001', () => {
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k]!;
    }
  });

  it('detects orchestrator skeleton placeholders', () => {
    const raw = attachStoredLegalStructure(
      'Anticipatory bail is discretionary under BNSS 482 on Sibbia principles.',
      { taskType: 'legal-chat', jurisdiction: 'IN' },
    ).content;
    expect(hasStructureSkeletonPlaceholders(raw)).toBe(true);
  });

  it('deterministic fill removes skeleton markers on legal-chat (draft-fast keeps polish)', () => {
    const raw = attachStoredLegalStructure(
      'Anticipatory bail is discretionary under BNSS 482 on Sibbia principles. The FIR at Chennai PS alleges BNS 103. However, twin conditions under Sibbia must be satisfied.',
      { taskType: 'legal-chat', jurisdiction: 'IN', query: 'Anticipatory bail for BNS 103 FIR Chennai' },
    ).content;

    const out = deterministicFastDeliveryPolish(raw, {
      taskType: 'legal-chat',
      query: 'Anticipatory bail for BNS 103 FIR Chennai',
    });

    expect(out).not.toMatch(/Orchestrator skeleton/i);
    expect(out).not.toMatch(/stored skeleton, not a new LLM pass/i);
    expect(out).toMatch(/ISSUE & SHORT ANSWER/i);
    expect(out).toMatch(/BNSS 482|Sibbia/i);
    expect(out).toMatch(/Chennai PS|BNS 103/i);
    expect(hasStructureSkeletonPlaceholders(out)).toBe(false);
  });

  it('fills draft numbered-paragraph skeleton on legal-draft-fast', () => {
    const raw = attachStoredLegalStructure(
      'The accused was arrested at Anna Nagar PS on 12 Jan 2026. The cheque for Rs 5,00,000 was dishonoured under NI Act s.138.',
      {
        taskType: 'legal-draft-fast',
        query: 'Draft anticipatory bail under BNSS 482',
        jurisdiction: 'IN',
      },
    ).content;

    const out = deterministicFastDeliveryPolish(raw, {
      taskType: 'legal-draft-fast',
      query: 'Draft anticipatory bail under BNSS 482',
    });

    expect(out).not.toMatch(/Numbered paragraphs mapping/i);
    expect(out).not.toMatch(/Orchestrator skeleton/i);
    expect(out).toMatch(/\*\*PRAYER\*\*/);
    expect(out).toMatch(/1\./);
  });

  it('runs only on draft -fast / partnerLean, not bare legal-draft or chat-fast', () => {
    expect(shouldRunFastDeliveryPolish({ taskType: 'legal-draft-fast' })).toBe(true);
    expect(shouldRunFastDeliveryPolish({ taskType: 'legal-chat-fast' })).toBe(false);
    expect(shouldRunFastDeliveryPolish({ partnerLean: true })).toBe(true);
    expect(shouldRunFastDeliveryPolish({ taskType: 'legal-draft' })).toBe(false);
    expect(shouldRunFastDeliveryPolish({ taskType: 'legal-chat' })).toBe(false);
  });

  it('NYV_FAST_DELIVERY_POLISH=0 disables polish gate', () => {
    prev.NYV_FAST_DELIVERY_POLISH = process.env.NYV_FAST_DELIVERY_POLISH;
    process.env.NYV_FAST_DELIVERY_POLISH = '0';
    expect(shouldRunFastDeliveryPolish({ taskType: 'legal-draft-fast' })).toBe(false);
  });

  it('applyFastDeliveryPolish is no-op on counsel-grade legal-draft', async () => {
    const skeleton = attachStoredLegalStructure('Counsel analysis.', {
      taskType: 'legal-draft',
      jurisdiction: 'IN',
    }).content;
    const out = await applyFastDeliveryPolish(skeleton, { taskType: 'legal-draft' });
    expect(out).toBe(skeleton);
    expect(hasStructureSkeletonPlaceholders(out)).toBe(true);
  });

  it('NV-FAST-CHAT-SLA-001: chat-fast skips IRAC attach and delivery polish', async () => {
    const formatted = applyLegalResponseFormatting(
      'Sessions Court may grant anticipatory bail under BNSS 482. Sibbia (1980) governs twin conditions.',
      {
        jurisdiction: 'IN',
        taskType: 'legal-chat-fast',
        query: 'Anticipatory bail BNSS 482',
        comprehensive: true,
      },
    );
    expect(hasStructureSkeletonPlaceholders(formatted)).toBe(false);
    expect(formatted).not.toMatch(/NV-LEGAL-STRUCTURE-ATTACH-001/);

    const polished = await applyFastDeliveryPolish(formatted, {
      taskType: 'legal-chat-fast',
      query: 'Anticipatory bail BNSS 482',
      jurisdiction: 'IN',
    });
    expect(polished).toBe(formatted);
    expect(polished).toMatch(/Sibbia|BNSS 482/i);
  });
});
