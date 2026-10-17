import { describe, it, expect } from 'vitest';
import type { Request } from 'express';
import {
  resolveDraftDocumentType,
  resolveDraftDocumentTypeWithMeta,
} from '../../src/config/jrx-draft-length-registry.js';
import { computeDraftQuality } from '../../src/orchestration/jrx-orchestration-response-contract.js';
import {
  applyPartnerDraftDocumentTypeInference,
  getPartnerDraftDocumentTypeResolution,
  validatePartnerDraftDocumentType,
} from '../../src/utils/jrx-partner-platform.js';
import { resolvePinnedAgentIdForDocumentType } from '../../src/services/jrx-document-type-agent-pin.js';
import { formatIndianDraftStructureChecklist } from '../../src/services/jrx-indian-draft-structure-registry.js';

function nspRequest(body: Record<string, unknown> = {}): Request {
  return {
    body,
    headers: { 'x-nyv-platform': 'NSP' },
    sdkContext: { partnerCode: 'NSP', tenantId: 't-nsp' },
  } as unknown as Request;
}

describe('NV-DOCUMENT-TYPE-INFERENCE-001', () => {
  it('keeps explicit known documentType unchanged', () => {
    const meta = resolveDraftDocumentTypeWithMeta({
      documentType: 'bail_application',
      prompt: 'Draft something vague',
    });
    expect(meta.documentType).toBe('bail_application');
    expect(meta.wasInferred).toBe(false);
    expect(meta.source).toBe('explicit_registry');
  });

  it('infers bail_application from prompt when documentType missing', () => {
    const meta = resolveDraftDocumentTypeWithMeta({
      prompt: 'Draft anticipatory bail under BNS for Sessions Court Chennai',
    });
    expect(meta.documentType).toBe('bail_application');
    expect(meta.wasInferred).toBe(true);
    expect(meta.source).toBe('prompt_inferred');
  });

  it('falls back to general_legal_document for unknown explicit type', () => {
    const meta = resolveDraftDocumentTypeWithMeta({
      documentType: 'custom_partner_slug',
      prompt: 'Prepare legal document',
    });
    expect(meta.documentType).toBe('general_legal_document');
    expect(meta.source).toBe('unknown_explicit_fallback');
    expect(meta.wasInferred).toBe(true);
    expect(meta.rawInput).toBe('custom_partner_slug');
  });

  it('falls back to general_legal_document when prompt is too vague', () => {
    const meta = resolveDraftDocumentTypeWithMeta({
      prompt: 'Prepare a legal document for my client',
    });
    expect(meta.documentType).toBe('general_legal_document');
    expect(meta.source).toBe('general_fallback');
  });

  it('applyPartnerDraftDocumentTypeInference mutates parameters and never blocks', () => {
    const req = nspRequest({
      taskType: 'legal-draft-fast',
      prompt: 'Draft anticipatory bail for accused in custody',
    });
    expect(validatePartnerDraftDocumentType(req)).toBeNull();
    const resolution = getPartnerDraftDocumentTypeResolution(req);
    expect(resolution?.documentType).toBe('bail_application');
    expect((req.body as Record<string, unknown>).parameters).toMatchObject({
      documentType: 'bail_application',
    });
    expect(resolution?.source).toBe('prompt_inferred');
  });

  it('unknown partner type routes to general overlay and A-004 pin', () => {
    const req = nspRequest({
      taskType: 'legal-draft-fast',
      prompt: 'Draft document',
      parameters: { documentType: 'totally_unknown_type' },
    });
    applyPartnerDraftDocumentTypeInference(req);
    const params = (req.body as Record<string, unknown>).parameters as Record<string, unknown>;
    expect(params.documentType).toBe('general_legal_document');
    expect(resolvePinnedAgentIdForDocumentType({ documentType: params.documentType })).toBe('A-004');
    expect(formatIndianDraftStructureChecklist({ documentType: params.documentType }))
      .toContain('general_legal_document');
  });

  it('computeDraftQuality exposes inferredDocumentType metadata', () => {
    const quality = computeDraftQuality({
      content: 'Draft body with numbered paragraphs and relief sought.',
      riskBadge: 'GREEN',
      authoritiesDelivered: 1,
      taskType: 'legal-draft-fast',
      documentTypeResolution: {
        documentType: 'general_legal_document',
        source: 'general_fallback',
        wasInferred: true,
        confidence: 0.2,
        rationale: ['general fallback'],
      },
    });
    expect(quality.inferredDocumentType).toBe('general_legal_document');
    expect(quality.documentTypeSource).toBe('general_fallback');
  });

  it('resolveDraftDocumentType remains backward compatible for known keys', () => {
    expect(resolveDraftDocumentType({ documentType: 'writ_petition' })).toBe('writ_petition');
  });
});
