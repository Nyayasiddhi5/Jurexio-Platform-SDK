import { describe, it, expect } from 'vitest';
import { classify } from '../src/doctype/classify.js';
import { LEGAL_IN_IDENTITY_PACK, LEGAL_IN_EVIDENCE_PACK } from '../src/domain/domain-pack.js';
import { domainPackIdForIngestRole } from '../src/domain/ingest-role-router.js';
import {
  evidenceDepictionRecommended,
  isEvidenceMediaMime,
} from '../src/doctype/evidence-registry.js';
import { mapExtractionToNspUserOnboarding } from '../src/autofill/user-onboarding-mapper.js';
import { mapExtractionToNspEvidence } from '../src/autofill/evidence-mapper.js';
import type { ExtractionResult, Page } from '../src/types.js';

const PAN_SYNTHETIC = `
INCOME TAX DEPARTMENT
Permanent Account Number Card
Name: Synthetic Holder
PAN: ABCDE1234F
`.trim();

function syntheticPage(text: string): Page {
  const lines = text.split('\n').map((t, i) => ({
    text: t.trim(),
    bbox: { x: 36, y: 36 + i * 14, w: 500, h: 12 },
    lineIndex: i,
  }));
  return {
    pageNo: 1,
    width: 595,
    height: 842,
    deskewDeg: 0,
    lines,
    blocks: [],
    tables: [],
    script: 'Latn',
    route: 'OCR',
    quality: { textLayerCoverage: 0, meanConf: 0.82, garbleRate: 0.02, handwrittenSuspected: false },
  };
}

function minimalExtraction(docType: string, pages: Page[]): ExtractionResult {
  return {
    batchId: 'test',
    documents: [
      {
        documentId: 'doc-1',
        fileName: 'kyc.pdf',
        classification: { code: docType, label: docType, confidence: 0.9, family: 'IDENTITY' },
        pages,
      },
    ],
    resolutions: [],
    autofill: {
      tier: 'T1',
      fields: { 'ids.pan': 'ABCDE1234F', 'user.fullName': 'Synthetic Holder' },
      absent: [],
      conflicts: [],
      lowConfidence: [],
      withheld: [],
      completeness: { filled: 2, expected: 4, ratio: 0.5 },
    },
    governance: {
      restricted: false,
      restrictedReasons: [],
      redactions: [],
      aiInvolved: false,
      humanReviewRequired: [],
      auditEvents: [],
    },
    analysis: [],
    timings: {},
    warnings: [],
  };
}

describe('P1 legal-in-identity', () => {
  it('classifies synthetic PAN under identity pack', () => {
    const hit = classify([syntheticPage(PAN_SYNTHETIC)], {
      extraProfiles: LEGAL_IN_IDENTITY_PACK.docTypes,
    });
    expect(hit.code).toBe('PAN_CARD');
  });

  it('routes onboarding_kyc to legal-in-identity pack', () => {
    expect(domainPackIdForIngestRole('onboarding_kyc')).toBe('legal-in-identity');
  });

  it('maps user onboarding payload for PAN doc type', () => {
    const ext = minimalExtraction('PAN_CARD', [syntheticPage(PAN_SYNTHETIC)]);
    const onboarding = mapExtractionToNspUserOnboarding(ext);
    expect(onboarding).not.toBeNull();
    expect(onboarding!.userProfile.pan).toBe('ABCDE1234F');
    expect(onboarding!.primaryDocType).toBe('PAN_CARD');
  });
});

describe('P2 legal-in-evidence', () => {
  it('routes case_evidence to legal-in-evidence pack', () => {
    expect(domainPackIdForIngestRole('case_evidence')).toBe('legal-in-evidence');
    expect(domainPackIdForIngestRole('chat_attachment')).toBe('legal-in-evidence');
  });

  it('recommends depiction for image mime uploads', () => {
    expect(isEvidenceMediaMime('image/jpeg')).toBe(true);
    expect(evidenceDepictionRecommended([], { mime: 'image/png' })).toBe(true);
  });

  it('classifies x-ray cue text under evidence pack', () => {
    const text = 'Radiology Department — X-ray left knee — Hospital stamp 12/01/2025';
    const hit = classify([syntheticPage(text)], { extraProfiles: LEGAL_IN_EVIDENCE_PACK.docTypes });
    expect(hit.code).toBe('MEDICAL_IMAGING');
  });

  it('maps evidence payload without inventing court fields', () => {
    const ext = minimalExtraction('EVIDENCE_PHOTO', [syntheticPage('Injury photograph — nature of injury')]);
    ext.documents[0]!.classification = {
      code: 'EVIDENCE_PHOTO',
      label: 'Evidence',
      confidence: 0.85,
      family: 'OTHER',
    };
    const ev = mapExtractionToNspEvidence(ext, { mime: 'image/jpeg' });
    expect(ev).not.toBeNull();
    expect(ev!.needsDepiction).toBe(true);
    expect(ev!.tags).toContain('IMAGE_UPLOAD');
  });
});
