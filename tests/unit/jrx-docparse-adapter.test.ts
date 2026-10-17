/**
 * NV-DOCPARSE-ADAPTER-001 — adapter unit tests (mocked docparse engine).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const docparseMock = vi.hoisted(() => ({
  run: vi.fn(),
  CONCORDANCE_STATUS: 'DRAFT' as const,
  toCaseDraft: (payload: { fields: Record<string, unknown> }) => {
    const f = payload.fields;
    const draft: Record<string, unknown> = {};
    if (f['court.raw']) draft.court = { raw: f['court.raw'] };
    if (f['caseNumber']) draft.caseNumber = f['caseNumber'];
    if (f['fir.number']) {
      draft.fir = { number: f['fir.number'], policeStation: f['fir.policeStation'] };
    }
    return draft;
  },
}));

vi.mock('@jurexio/docparse', () => docparseMock);

vi.mock('../../src/config/jrx-feature-flags.js', () => ({
  isNyvFeatureOn: vi.fn(() => true),
}));

vi.mock('../../src/services/document-pipeline/jrx-got-ocr-adapter-service.js', () => ({
  nvOcrAdapterService: {
    ocrDocument: vi.fn().mockRejectedValue(new Error('ocr unavailable in test')),
  },
}));

const VAKALAT = `IN THE COURT OF SESSIONS AT HYDERABAD
VAKALATNAMA
Advocate Ram Prasad for the Accused
CNR No. TSHC0100123456789`;

const FIR_DOC = `FIRST INFORMATION REPORT
FIR No. 4421 of 2024
at Secunderabad Police Station
Under Section 302 IPC`;

const PETITION = `IN THE HIGH COURT OF JUDICATURE AT HYDERABAD
Criminal Petition No. 4471 of 2025
Ram Kumar ... PETITIONER
FIR No. 221 of 2025 at Banjara Hills Police Station
PRAYER: grant anticipatory bail`;

describe('NV-DOCPARSE-ADAPTER-001', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('uses heuristic-only path when flag is off', async () => {
    const { isNyvFeatureOn } = await import('../../src/config/jrx-feature-flags.js');
    vi.mocked(isNyvFeatureOn).mockReturnValue(false);

    const { runDocparseWithFallback } = await import('../../src/services/jrx-docparse-adapter-service.js');
    const result = await runDocparseWithFallback({
      text: PETITION,
      jurisdiction: 'IN',
      bytes: Buffer.from('%PDF-1.4 fake'),
      fileName: 'petition.pdf',
    });

    expect(result.extractionPath).toBe('heuristic');
    expect(result.fieldCount).toBeGreaterThan(0);
    expect(docparseMock.run).not.toHaveBeenCalled();
  });

  it('maps docparse autofill and merges with heuristic', async () => {
    const { isNyvFeatureOn } = await import('../../src/config/jrx-feature-flags.js');
    vi.mocked(isNyvFeatureOn).mockReturnValue(true);

    docparseMock.run.mockResolvedValue({
      batchId: 'b1',
      documents: [{
        documentId: 'abc',
        fileName: 'fir.pdf',
        mime: 'application/pdf',
        sha256: 'x',
        pageCount: 1,
        pages: [{ pageNo: 1, width: 100, height: 100, deskewDeg: 0, lines: [{ text: 'FIR', bbox: { x: 0, y: 0, w: 1, h: 1 }, words: [], script: 'Latn', conf: 1, index: 0, zone: 'BODY' }], blocks: [], tables: [], script: 'Latn', route: 'TEXT_LAYER', quality: { textLayerCoverage: 1, meanConf: 1, garbleRate: 0 } }],
        classification: { code: 'FIR', label: 'First Information Report', family: 'POLICE', conf: 0.9, alternatives: [], evidence: [] },
        langs: ['en'],
        timings: {},
        warnings: [],
      }],
      candidates: [],
      resolutions: [
        { fieldPath: 'court.raw', chosen: { confidence: 0.9, valueRaw: 'High Court', valueNormalized: 'High Court', fieldPath: 'court.raw', extractorId: 'anchor', extractorKind: 'ANCHOR', aiInvolved: false, documentId: 'abc', pageNo: 1, bbox: null, lineIndices: [], authorityWeight: 1 }, competing: [], status: 'RESOLVED', rationale: 'anchor' },
        { fieldPath: 'caseNumber', chosen: { confidence: 0.92, valueRaw: 'CP 4471/2025', valueNormalized: { typeToken: 'Criminal Petition', number: '4471', year: 2025 }, fieldPath: 'caseNumber', extractorId: 'grammar', extractorKind: 'GRAMMAR', aiInvolved: false, documentId: 'abc', pageNo: 1, bbox: null, lineIndices: [], authorityWeight: 1 }, competing: [], status: 'RESOLVED', rationale: 'grammar' },
      ],
      autofill: {
        tier: 'T2',
        fields: {
          'court.raw': 'High Court of Telangana',
          'caseNumber': { typeToken: 'Criminal Petition', number: '4471', year: 2025 },
          'fir.number': '221',
          'fir.policeStation': 'Banjara Hills',
        },
        absent: [],
        conflicts: [],
        lowConfidence: [],
        completeness: { filled: 4, expected: 6, ratio: 0.67 },
      },
      analysis: [],
      governance: { auditEvents: [], restriction: { restricted: false, reasons: [] }, redactions: [] },
      timings: {},
      warnings: [],
    } as never);

    const { runDocparseWithFallback } = await import('../../src/services/jrx-docparse-adapter-service.js');
    const result = await runDocparseWithFallback({
      text: PETITION,
      jurisdiction: 'IN',
      bytes: Buffer.from('%PDF-1.4 fake'),
      fileName: 'petition.pdf',
    });

    expect(docparseMock.run).toHaveBeenCalled();
    expect(['docparse', 'mixed']).toContain(result.extractionPath);
    expect(result.fields.some((f) => f.source === 'docparse')).toBe(true);
    expect(result.docparseMeta?.completenessRatio).toBeCloseTo(0.67);
    expect(result.docparseMeta?.degraded).not.toBe(true);
  });

  it('falls back to heuristic when docparse throws', async () => {
    const { isNyvFeatureOn } = await import('../../src/config/jrx-feature-flags.js');
    vi.mocked(isNyvFeatureOn).mockReturnValue(true);

    docparseMock.run.mockRejectedValue(new Error('tesseract unavailable'));

    const { runDocparseWithFallback } = await import('../../src/services/jrx-docparse-adapter-service.js');
    const result = await runDocparseWithFallback({
      text: PETITION,
      jurisdiction: 'IN',
      bytes: Buffer.from('%PDF-1.4 fake'),
      fileName: 'petition.pdf',
    });

    expect(result.extractionPath).toBe('heuristic');
    expect(result.fieldCount).toBeGreaterThan(0);
    expect(result.docparseMeta?.degraded).toBe(true);
    expect(result.docparseMeta?.degradeReason).toBe('docparse_throw');
  });

  it('surfaces concordanceStatus DRAFT and tables from analysis', async () => {
    const { isNyvFeatureOn } = await import('../../src/config/jrx-feature-flags.js');
    vi.mocked(isNyvFeatureOn).mockReturnValue(true);

    docparseMock.run.mockResolvedValue({
      batchId: 'b2',
      documents: [{
        documentId: 'v1',
        fileName: 'vak.pdf',
        mime: 'application/pdf',
        sha256: 'x',
        pageCount: 1,
        pages: [],
        classification: { code: 'VAKALATNAMA', label: 'Vakalatnama', family: 'AUTHORITY', conf: 0.9, alternatives: [], evidence: [] },
        langs: ['en'],
        timings: {},
        warnings: [],
      }],
      candidates: [],
      resolutions: [],
      autofill: {
        tier: 'T2',
        fields: { cnr: 'TSHC0100123456789' },
        absent: [],
        conflicts: [],
        lowConfidence: [],
        completeness: { filled: 1, expected: 4, ratio: 0.25 },
      },
      analysis: [{
        documentId: 'v1',
        summarySentences: [],
        timeline: [],
        obligations: [],
        reliefsSought: [],
        citations: [],
        monetary: [],
        structure: [],
        tables: [{
          documentId: 'v1',
          pageNo: 1,
          semantics: 'ID_LIST',
          gridConf: 0.8,
          semanticsConf: 0.7,
          method: 'PROJECTION',
          rows: 2,
          cols: 2,
          headerRow: 0,
          columns: ['Sl', 'Party'],
          columnKinds: ['NUM', 'TEXT_SHORT'],
          grid: [['1', 'Ram'], ['2', 'Shyam']],
          cellBoxes: [[], []],
          normalized: { dates: {}, money: {} },
        }],
      }],
      governance: { restricted: false, restrictedReasons: [], redactions: [], aiInvolved: false, humanReviewRequired: [], auditEvents: [] },
      timings: {},
      warnings: [],
    } as never);

    const { runDocparseWithFallback } = await import('../../src/services/jrx-docparse-adapter-service.js');
    const result = await runDocparseWithFallback({
      text: VAKALAT,
      jurisdiction: 'IN',
      bytes: Buffer.from('%PDF-1.4 fake'),
      fileName: 'vakalatnama.pdf',
    });

    expect(result.docparseMeta?.concordanceStatus).toBe('DRAFT');
    expect(result.tables?.length).toBe(1);
    expect(result.tables?.[0]?.semantics).toBe('ID_LIST');
  });

  it('heuristic path extracts FIR fields without docparse bytes', async () => {
    const { extractCourtDocumentFields } = await import('../../src/services/jrx-court-document-fields.js');
    const r = await extractCourtDocumentFields(FIR_DOC, 'IN');
    expect(r.fields.some((f) => f.key === 'fir_number')).toBe(true);
    expect(r.fields.some((f) => f.key === 'police_station')).toBe(true);
  });
});
