import { describe, it, expect } from 'vitest';
import {
  DRAFT_LENGTH_REGISTRY,
  DRAFT_TIER_TOKEN_BANDS,
  partnerBodyHasDraftAttachments,
  resolveDraftAttachmentTokenBump,
  resolveDraftDocumentType,
  resolveDraftFastSlaTokenCapForDocument,
  resolveDraftOutputTokens,
  validateDraftContentLength,
} from '../../src/config/jrx-draft-length-registry.js';
import { applyPartnerMaxTokensFloor } from '../../src/utils/jrx-partner-platform.js';
import type { Request } from 'express';

function nspRequest(body: Record<string, unknown> = {}): Request {
  return {
    body,
    headers: { 'x-nyv-platform': 'NSP' },
    sdkContext: { partnerCode: 'NSP', tenantId: 't-nsp' },
  } as unknown as Request;
}

describe('NV-DRAFT-LENGTH-REGISTRY-001', () => {
  it('maps parameters.documentType bail_application', () => {
    expect(resolveDraftDocumentType({ documentType: 'bail_application' })).toBe('bail_application');
  });

  it('medium tier uses registry default tokens', () => {
    const r = resolveDraftOutputTokens({
      documentType: 'bail_application',
      draftLength: 'medium',
    });
    expect(r.tokens).toBe(DRAFT_LENGTH_REGISTRY.bail_application.defaultTokens);
    expect(r.tier).toBe('medium');
    expect(r.attachmentBump).toBe(0);
  });

  it('low tier uses fast band; comprehensive uses counsel band', () => {
    const low = resolveDraftOutputTokens({ documentType: 'writ_petition', draftLength: 'low' });
    const full = resolveDraftOutputTokens({ documentType: 'writ_petition', draftLength: 'comprehensive' });
    expect(low.tokens).toBe(DRAFT_TIER_TOKEN_BANDS.low.target);
    expect(full.tokens).toBe(DRAFT_LENGTH_REGISTRY.writ_petition.comprehensiveTokens);
    expect(full.tokens).toBeGreaterThanOrEqual(DRAFT_TIER_TOKEN_BANDS.comprehensive.floor);
  });

  it('defaults draftLength to medium when absent', () => {
    const r = resolveDraftOutputTokens({ documentType: 'legal_notice' });
    expect(r.tier).toBe('medium');
    expect(r.tokens).toBe(6_144);
  });

  it('attachment bump adds budget on grounded medium drafts', () => {
    const plain = resolveDraftOutputTokens({
      documentType: 'bail_application',
      draftLength: 'medium',
    });
    const grounded = resolveDraftOutputTokens({
      documentType: 'bail_application',
      draftLength: 'medium',
      hasAttachments: true,
    });
    expect(grounded.attachmentBump).toBe(2_048);
    expect(grounded.tokens).toBe(plain.tokens + 2_048);
    expect(grounded.tokens).toBeLessThanOrEqual(DRAFT_TIER_TOKEN_BANDS.medium.ceiling);
  });

  it('partnerBodyHasDraftAttachments detects rag ids and documentText', () => {
    expect(partnerBodyHasDraftAttachments({ ragDocumentIds: [1] })).toBe(true);
    expect(partnerBodyHasDraftAttachments({ documentText: 'x'.repeat(100) })).toBe(true);
    expect(partnerBodyHasDraftAttachments({ prompt: 'short' })).toBe(false);
  });

  it('resolveDraftAttachmentTokenBump tier steps', () => {
    expect(resolveDraftAttachmentTokenBump(true, 'low')).toBe(1_024);
    expect(resolveDraftAttachmentTokenBump(true, 'medium')).toBe(2_048);
    expect(resolveDraftAttachmentTokenBump(true, 'comprehensive')).toBe(4_096);
    expect(resolveDraftAttachmentTokenBump(false, 'medium')).toBe(0);
  });

  it('validateDraftContentLength applies ±10% tolerance', () => {
    const spec = DRAFT_LENGTH_REGISTRY.bail_application;
    const minChars = Math.floor(spec.defaultTokens * 4 * 0.9);
    const ok = validateDraftContentLength('x'.repeat(minChars + 100), 'bail_application', 'medium');
    expect(ok.withinRange).toBe(true);
    const short = validateDraftContentLength('short', 'bail_application', 'medium');
    expect(short.belowMin).toBe(true);
  });

  it('R-DRAFT-TOKEN-TRUTH-001 beta medium fast SLA uses 8192 rail not registry-only 6144', () => {
    const prev = process.env.NYV_BETA_QUALITY_FIRST;
    process.env.NYV_BETA_QUALITY_FIRST = '1';
    try {
      const cap = resolveDraftFastSlaTokenCapForDocument({
        documentType: 'bail_application',
        tier: 'medium',
      });
      expect(cap).toBeGreaterThanOrEqual(8_192);
      const req = nspRequest({
        taskType: 'legal-draft-fast',
        parameters: { documentType: 'bail_application' },
        options: { draftLength: 'medium' },
      });
      expect(applyPartnerMaxTokensFloor(req, undefined)).toBeGreaterThanOrEqual(8_192);
    } finally {
      if (prev === undefined) delete process.env.NYV_BETA_QUALITY_FIRST;
      else process.env.NYV_BETA_QUALITY_FIRST = prev;
    }
  });

  it('resolvePartnerMaxOutputTokens caps legal-draft-fast at registry when beta off', () => {
    const prev = process.env.NYV_BETA_QUALITY_FIRST;
    process.env.NYV_BETA_QUALITY_FIRST = '0';
    try {
      const req = nspRequest({
        taskType: 'legal-draft-fast',
        parameters: { documentType: 'bail_application' },
        options: { draftLength: 'medium' },
      });
      expect(applyPartnerMaxTokensFloor(req, undefined)).toBe(6_144);
    } finally {
      if (prev === undefined) delete process.env.NYV_BETA_QUALITY_FIRST;
      else process.env.NYV_BETA_QUALITY_FIRST = prev;
    }
  });

  it('resolvePartnerMaxOutputTokens bumps grounded standard drafts toward SLA ceiling', () => {
    const req = nspRequest({
      taskType: 'legal-draft-fast',
      parameters: { documentType: 'bail_application' },
      options: { draftLength: 'medium' },
      ragDocumentIds: [42],
    });
    expect(applyPartnerMaxTokensFloor(req, undefined)).toBe(8_192);
  });

  it('comprehensive on -fast skips SLA cap and uses registry floor', () => {
    const req = nspRequest({
      taskType: 'legal-draft-fast',
      parameters: { documentType: 'bail_application' },
      options: { draftLength: 'comprehensive' },
    });
    expect(applyPartnerMaxTokensFloor(req, undefined)).toBe(16_384);
  });

  it('resolvePartnerMaxOutputTokens uses full registry floor when NYV_DRAFT_FAST_SLA=0', () => {
    const prev = process.env.NYV_DRAFT_FAST_SLA;
    process.env.NYV_DRAFT_FAST_SLA = '0';
    try {
      const req = nspRequest({
        taskType: 'legal-draft-fast',
        parameters: { documentType: 'bail_application' },
        options: { draftLength: 'medium' },
      });
      expect(applyPartnerMaxTokensFloor(req, undefined)).toBe(6_144);
    } finally {
      if (prev === undefined) delete process.env.NYV_DRAFT_FAST_SLA;
      else process.env.NYV_DRAFT_FAST_SLA = prev;
    }
  });

  it('chat-fast stays at 768 floor', () => {
    const req = nspRequest({ taskType: 'legal-chat-fast' });
    expect(applyPartnerMaxTokensFloor(req, 128)).toBeLessThanOrEqual(768);
  });

  it('legal-draft-fast medium uses doc-type SLA cap (notice 6144, agreement 8192)', () => {
    const noticeReq = nspRequest({
      taskType: 'legal-draft-fast',
      parameters: { documentType: 'legal_notice' },
      options: { draftLength: 'medium' },
    });
    expect(applyPartnerMaxTokensFloor(noticeReq, undefined)).toBe(6_144);
    const agreeReq = nspRequest({
      taskType: 'legal-draft-fast',
      parameters: { documentType: 'simple_agreement' },
      options: { draftLength: 'medium' },
    });
    expect(applyPartnerMaxTokensFloor(agreeReq, undefined)).toBe(8_192);
  });

  it('NYV_PARTNER_MAX_TOKENS_DRAFT_FAST does not starve registry typed drafts', () => {
    const prev = process.env.NYV_PARTNER_MAX_TOKENS_DRAFT_FAST;
    process.env.NYV_PARTNER_MAX_TOKENS_DRAFT_FAST = '4096';
    try {
      const req = nspRequest({
        taskType: 'legal-draft-fast',
        parameters: { documentType: 'bail_application' },
        options: { draftLength: 'medium' },
      });
      expect(applyPartnerMaxTokensFloor(req, undefined)).toBe(6_144);
    } finally {
      if (prev === undefined) delete process.env.NYV_PARTNER_MAX_TOKENS_DRAFT_FAST;
      else process.env.NYV_PARTNER_MAX_TOKENS_DRAFT_FAST = prev;
    }
  });

  it('comprehensive legal-draft uses full registry floor for simple_agreement', () => {
    const req = nspRequest({
      taskType: 'legal-draft',
      parameters: { documentType: 'simple_agreement' },
      options: { draftLength: 'comprehensive' },
    });
    expect(applyPartnerMaxTokensFloor(req, undefined)).toBe(27_648);
  });
});
