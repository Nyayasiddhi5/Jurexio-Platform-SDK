import { describe, it, expect } from 'vitest';
import { classify } from '../src/doctype/classify.js';
import { LEGAL_IN_IDENTITY_PACK, LEGAL_IN_CIVIL_PACK } from '../src/domain/domain-pack.js';
import {
  mapExtractionToNspOnboardingForm,
  resolveOnboardingDomainPack,
} from '../src/autofill/nsp-onboarding-extract-mapper.js';
import type { ExtractionResult, Page } from '../src/types.js';

const PAN_SYNTHETIC = `
INCOME TAX DEPARTMENT
Permanent Account Number Card
Name: Synthetic Holder
PAN: ABCDE1234F
`.trim();

const BAR_SYNTHETIC = `
Bar Council of Maharashtra
Certificate of Enrolment
Name: Advocate Sample
Enrolment No: MH/1234/2020
`.trim();

const MCA_SYNTHETIC = `
Ministry of Corporate Affairs
Certificate of Incorporation
Corporate Identity Number U12345MH2020PTC123456
Company Name SAMPLE LEGAL LLP
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

function minimalExtraction(docType: string, pages: Page[], fields: Record<string, unknown>): ExtractionResult {
  return {
    batchId: 'golden',
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
      fields,
      absent: [],
      conflicts: [],
      lowConfidence: [],
      withheld: [],
      completeness: { filled: Object.keys(fields).length, expected: 6, ratio: 0.5 },
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

describe('onboarding-extract golden (synthetic OCR text)', () => {
  it('resolveOnboardingDomainPack routes pan/bar vs firm', () => {
    expect(resolveOnboardingDomainPack('panCard')).toBe('legal-in-identity');
    expect(resolveOnboardingDomainPack('barCert')).toBe('legal-in-identity');
    expect(resolveOnboardingDomainPack('firmCert')).toBe('legal-in-civil');
  });

  it('classifies PAN and maps onboardingForm.panNumber', () => {
    const hit = classify([syntheticPage(PAN_SYNTHETIC)], { extraProfiles: LEGAL_IN_IDENTITY_PACK.docTypes });
    expect(hit.code).toBe('PAN_CARD');
    const ext = minimalExtraction('PAN_CARD', [syntheticPage(PAN_SYNTHETIC)], {
      'ids.pan': 'ABCDE1234F',
      'user.fullName': 'Synthetic Holder',
    });
    const form = mapExtractionToNspOnboardingForm(ext, { documentHint: 'panCard' });
    expect(form.panNumber).toBe('ABCDE1234F');
    expect(form.fullName).toBe('Synthetic Holder');
    expect(form.classify.docTypeCode).toBe('PAN_CARD');
  });

  it('classifies Bar Council cert (MCA + Bar both supported)', () => {
    const hit = classify([syntheticPage(BAR_SYNTHETIC)], { extraProfiles: LEGAL_IN_IDENTITY_PACK.docTypes });
    expect(hit.code).toBe('BAR_COUNCIL_CERT');
    const ext = minimalExtraction('BAR_COUNCIL_CERT', [syntheticPage(BAR_SYNTHETIC)], {
      'advocates.enrolmentNo': 'MH/1234/2020',
      'user.fullName': 'Advocate Sample',
    });
    const form = mapExtractionToNspOnboardingForm(ext, { documentHint: 'barCert' });
    expect(form.barCouncilNumber).toBe('MH/1234/2020');
    expect(form.fullName).toBe('Advocate Sample');
  });

  it('classifies MCA firm cert', () => {
    const hit = classify([syntheticPage(MCA_SYNTHETIC)], { extraProfiles: LEGAL_IN_CIVIL_PACK.docTypes });
    expect(hit.code).toBe('MCA_CERTIFICATE');
    const ext = minimalExtraction('MCA_CERTIFICATE', [syntheticPage(MCA_SYNTHETIC)], {
      'company.name': 'SAMPLE LEGAL LLP',
      'ids.cin': 'U12345MH2020PTC123456',
    });
    const form = mapExtractionToNspOnboardingForm(ext, { documentHint: 'firmCert' });
    expect(form.firmName).toBe('SAMPLE LEGAL LLP');
    expect(form.registrationNumber).toBe('U12345MH2020PTC123456');
  });
});
