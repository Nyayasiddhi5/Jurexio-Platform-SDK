/**
 * NV-DOCPARSE-SDK-PARITY-001 — golden field-key parity vs legacy adapter mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const legacyRun = vi.hoisted(() => vi.fn());
const sdkRun = vi.hoisted(() => vi.fn());

vi.mock('@jurexio/docparse', () => ({
  run: legacyRun,
  CONCORDANCE_STATUS: 'DRAFT',
  toCaseDraft: (payload: { fields: Record<string, unknown> }) => {
    const f = payload.fields;
    const draft: Record<string, unknown> = {};
    if (f['court.raw']) draft.court = { raw: f['court.raw'] };
    if (f['caseNumber']) draft.caseNumber = f['caseNumber'];
    return draft;
  },
}));

vi.mock('@jurexio/docparse-sdk', () => ({
  run: sdkRun,
  DOCPARSE_SDK_VERSION: '1.0.0-alpha.2-test',
  buildDocparseResultBundle: vi.fn(() => ({
    resultV1: { schema: 'docparse.result/v1', batchId: 'parity' },
    legalParseGuide: { schema: 'legal.parseGuide/v1', domainPackId: 'legal-in', entries: [] },
    intelligence: { schema: 'docparse.intelligence/v1', domainPackId: 'legal-in', qualityBand: 'medium' },
  })),
}));

vi.mock('../../src/config/jrx-feature-flags.js', () => ({
  isJrxFeatureOn: vi.fn((k: string) => k === 'docparse' || k === 'docparseSdk'),
}));

vi.mock('../../src/services/document-pipeline/jrx-got-ocr-adapter-service.js', () => ({
  nvOcrAdapterService: {
    ocrDocument: vi.fn().mockRejectedValue(new Error('ocr unavailable')),
  },
}));

const sharedExtraction = {
  batchId: 'parity',
  documents: [{
    documentId: 'd1',
    classification: { code: 'VAKALATNAMA', label: 'Vakalatnama', conf: 0.9, runnersUp: [] },
    pages: [],
  }],
  autofill: {
    tier: 'T1',
    fields: { 'court.raw': 'Hyderabad Sessions' },
    completeness: { ratio: 0.4, filled: 2, expected: 5 },
    conflicts: [],
    lowConfidence: [],
    absent: ['cnr'],
  },
  resolutions: [{ fieldPath: 'court.raw', status: 'RESOLVED', chosen: { value: 'Hyderabad Sessions', confidence: 0.9 } }],
  analysis: [],
  governance: { humanReviewRequired: [], redactions: [], restrictedReasons: [], aiInvolved: false, auditEvents: [] },
  timings: {},
  warnings: [],
};

describe('NV-DOCPARSE-SDK-PARITY-001', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    legacyRun.mockResolvedValue(sharedExtraction);
    sdkRun.mockResolvedValue(sharedExtraction);
  });

  it('maps court field keys when Platform SDK flag is on', async () => {
    const { runDocparseWithFallback } = await import('../../src/services/jrx-docparse-adapter-service.js');
    const sdk = await runDocparseWithFallback({
      text: 'IN THE COURT OF SESSIONS AT HYDERABAD VAKALATNAMA',
      jurisdiction: 'IN',
      bytes: Buffer.from('%PDF-1.4'),
      fileName: 'vak.pdf',
    });

    expect(sdk.fields.some((f) => f.key === 'court')).toBe(true);
    expect(sdk.docparseMeta?.engine).toBe('docparse-sdk');
    expect(sdk.docparseMeta?.legalParseGuide).toBeDefined();
    expect(sdkRun).toHaveBeenCalled();
    expect(legacyRun).not.toHaveBeenCalled();
  });
});
