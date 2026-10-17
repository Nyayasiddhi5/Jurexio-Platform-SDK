/**
 * NV-DOCPARSE-ADAPTER-001 — wire @jurexio/docparse v0.2.0 into NYV ingest with
 * honest provenance and tier-2 fallbacks.
 *
 * Cascade (enhancement-only — existing paths remain):
 *   bytes → docparse run() [deterministic primary]
 *        → if unreadable / empty / throw → nv-got-ocr-adapter → heuristics + NER
 *        → partial success → merge docparse + heuristic (higher confidence wins)
 *
 * Never claims literal 100% — completeness ratio and conflict/low-confidence
 * lists are surfaced in docparseMeta for partner UI.
 */
import crypto from 'crypto';
import {
  toCaseDraft,
  CONCORDANCE_STATUS,
  type AutofillPayload,
  type ExtractionResult,
  type FieldResolution,
  type TableRecord,
} from '@jurexio/docparse';
import { createLogger } from '../utils/logger.js';
import { isNyvFeatureOn } from '../config/jrx-feature-flags.js';
import {
  extractCourtDocumentFields,
  type CourtDocField,
  type CourtDocExtraction,
  type CourtDocTableRecord,
} from './jrx-court-document-fields.js';
import { DOCPARSE_BATCH_DOC_LIMIT } from './jrx-docparse-ingest-helper.js';

const logger = createLogger('./jrx-docparse-adapter');

export type ExtractionPath = 'docparse' | 'heuristic' | 'mixed' | 'ocr_fallback';

export interface DocparseAdapterInput {
  text: string;
  jurisdiction?: string;
  bytes?: Buffer;
  fileName?: string;
  mimeType?: string;
  batchId?: string;
  actor?: string;
  documents?: Array<{ bytes: Buffer; fileName: string; mimeType?: string }>;
  onProgress?: (stage: string, detail?: Record<string, unknown>) => void;
  domainPackId?: string;
  forceOcr?: boolean;
  preferOcr?: boolean;
  maxPagesPerDoc?: number;
}

export interface DocparseMeta {
  tier?: string;
  completenessRatio?: number;
  conflictFields?: string[];
  lowConfidenceFields?: string[];
  absentFields?: string[];
  degraded?: boolean;
  degradeReason?: string;
  documentTypeCode?: string;
  documentTypeLabel?: string;
  warnings?: string[];
  concordanceStatus?: 'DRAFT' | 'SIGNED_OFF';
  handwritingTriageSuggested?: boolean;
  humanReviewPages?: Array<{ documentId: string; pageNo: number; reason: string }>;
  inputFormat?: string;
  batchDocumentCount?: number;
  ocrProvider?: string;
  progressStages?: Array<{ stage: string; at: string; detail?: Record<string, unknown> }>;
  /** NV-DOCPARSE-LLM-FALLBACK-001 — set when the optional Nova-Micro recovery pass ran. */
  llmFallbackApplied?: boolean;
  llmFallbackModel?: string;
  llmFallbackFields?: string[];
  /** NV-DOCPARSE-SDK-001 — present when JRX_F_DOCPARSE_SDK routes engine to Platform SDK. */
  engine?: 'docparse' | 'docparse-sdk';
  legalParseGuide?: Record<string, unknown>;
  /** NV-DOCPARSE-RESULT-V1-001 — additive partner contract when Platform SDK runs. */
  docparseResultV1?: Record<string, unknown>;
  /** NV-DOCPARSE-INTELLIGENCE-001 — quality + PII summary + embedded LegalParseGuide for NSP. */
  docparseIntelligence?: Record<string, unknown>;
}

export interface DocparseAdapterResult extends CourtDocExtraction {
  extractionPath: ExtractionPath;
  docparseMeta?: DocparseMeta;
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'tiff', 'tif', 'bmp', 'gif']);
const DOCX_EXTS = new Set(['docx', 'doc']);

function emitProgress(
  input: DocparseAdapterInput,
  stages: DocparseMeta['progressStages'],
  stage: string,
  detail?: Record<string, unknown>,
): void {
  const entry = { stage, at: new Date().toISOString(), detail };
  stages?.push(entry);
  input.onProgress?.(stage, detail);
}

function isIndianLegalJurisdiction(jurisdiction?: string): boolean {
  const j = (jurisdiction || 'IN').toUpperCase();
  return j === 'IN' || j.startsWith('IN-') || j === 'INDIA';
}

function fileExt(fileName?: string): string {
  return (fileName?.split('.').pop() || '').toLowerCase();
}

function isDocparseEligibleBinary(fileName?: string, mimeType?: string): boolean {
  const ext = fileExt(fileName);
  if (ext === 'pdf' || IMAGE_EXTS.has(ext)) return true;
  const mime = (mimeType || '').toLowerCase();
  return mime.includes('pdf') || mime.startsWith('image/');
}

function isDocxBinary(fileName?: string, mimeType?: string): boolean {
  const ext = fileExt(fileName);
  if (DOCX_EXTS.has(ext)) return true;
  const mime = (mimeType || '').toLowerCase();
  return mime.includes('wordprocessingml') || mime === 'application/msword';
}

function resolutionConfidence(status: string, chosenConf?: number): number {
  switch (status) {
    case 'RESOLVED':
      return chosenConf ?? 0.88;
    case 'LOW_CONFIDENCE':
      return 0.55;
    case 'CONFLICT':
      return 0.42;
    default:
      return 0;
  }
}

function pushField(
  out: CourtDocField[],
  key: string,
  label: string,
  value: unknown,
  confidence: number,
): void {
  const str = value == null ? '' : String(value).trim();
  if (!str) return;
  if (out.some((f) => f.key === key)) return;
  out.push({ key, label, value: str, confidence, source: 'docparse' });
}

/** Map docparse autofill + resolutions → NSP CourtDocField keys. */
function mapDocparseToCourtFields(
  autofill: AutofillPayload,
  resolutions: FieldResolution[],
  classification?: { code?: string; label?: string },
): CourtDocField[] {
  const fields: CourtDocField[] = [];
  const resolutionByPath = new Map(resolutions.map((r) => [r.fieldPath, r]));

  const confFor = (fieldPath: string, fallback = 0.85): number => {
    const r = resolutionByPath.get(fieldPath);
    if (!r) return fallback;
    return resolutionConfidence(r.status, r.chosen?.confidence);
  };

  const draft = toCaseDraft(autofill);

  if (draft.cnr) {
    pushField(fields, 'cnr', 'CNR', draft.cnr, confFor('cnr'));
  }

  if (draft.court?.raw) {
    pushField(fields, 'court', 'Court', draft.court.raw, confFor('court.raw'));
  }

  if (draft.caseNumber) {
    const cn = draft.caseNumber;
    const filing = [cn.typeToken, cn.number ? `No. ${cn.number}` : '', cn.year ? `of ${cn.year}` : '']
      .filter(Boolean)
      .join(' ')
      .trim();
    if (filing) {
      pushField(fields, 'filing_number', 'Filing number', filing, confFor('caseNumber'));
    }
    if (cn.typeToken) {
      pushField(fields, 'case_type', 'Case type', cn.typeToken, confFor('caseNumber.typeToken', 0.82));
    }
    if (cn.year != null) {
      pushField(fields, 'case_year', 'Case year', String(cn.year), confFor('caseNumber.year', 0.82));
    }
  }

  if (draft.fir) {
    const fir = draft.fir;
    if (fir.number) {
      const firLabel = fir.year
        ? `FIR No. ${fir.number} of ${fir.year}`
        : `FIR No. ${fir.number}`;
      pushField(fields, 'fir_number', 'FIR number', firLabel, confFor('fir.number'));
    }
    if (fir.policeStation) {
      const ps = String(fir.policeStation).includes('Police Station')
        ? fir.policeStation
        : `${fir.policeStation} Police Station`;
      pushField(fields, 'police_station', 'Police station', ps, confFor('fir.policeStation', 0.78));
    }
  }

  if (Array.isArray(draft.sections) && draft.sections.length > 0) {
    const statutes = draft.sections
      .map((s: { statute: string; section: string }) => `${s.statute} §${s.section}`)
      .slice(0, 12)
      .join('; ');
    pushField(fields, 'statutes_invoked', 'Statutes / sections invoked', statutes, confFor('sections', 0.8));
  }

  if (Array.isArray(draft.parties)) {
    for (let i = 0; i < draft.parties.length; i++) {
      const p = draft.parties[i];
      if (!p?.name) continue;
      const role = String(p.role || '').toUpperCase();
      let key = `party_${i + 1}`;
      if (role.includes('PETITIONER') || role.includes('PLAINTIFF') || role.includes('COMPLAINANT')) {
        key = i === 0 ? 'petitioner' : `petitioner_${i + 1}`;
      } else if (role.includes('RESPONDENT') || role.includes('DEFENDANT') || role.includes('ACCUSED')) {
        key = i === 0 ? 'respondent' : `respondent_${i + 1}`;
      }
      pushField(fields, key, role || `Party ${i + 1}`, p.name, confFor(`parties[${i}].name`, 0.82));
    }
  }

  if (Array.isArray(draft.advocates) && draft.advocates[0]?.name) {
    pushField(
      fields,
      'advocate',
      'Advocate',
      draft.advocates[0].name,
      confFor('advocates[0].name', 0.75),
    );
  }

  if (classification?.code) {
    pushField(
      fields,
      'document_type',
      'Document type',
      classification.label || classification.code,
      0.82,
    );
  }

  return fields;
}

function mapTablesFromAnalysis(result: ExtractionResult): CourtDocTableRecord[] {
  const out: CourtDocTableRecord[] = [];
  for (const analysis of result.analysis || []) {
    for (const t of analysis.tables || []) {
      out.push(mapTableRecord(t));
    }
  }
  return out.slice(0, 24);
}

function mapTableRecord(t: TableRecord): CourtDocTableRecord {
  return {
    documentId: t.documentId,
    pageNo: t.pageNo,
    semantics: t.semantics,
    gridConf: t.gridConf,
    semanticsConf: t.semanticsConf,
    rows: t.rows,
    cols: t.cols,
    columns: [...t.columns],
    grid: t.grid.map((row) => [...row]),
  };
}

function mergeCourtFields(
  docparseFields: CourtDocField[],
  heuristicFields: CourtDocField[],
): CourtDocField[] {
  const byKey = new Map<string, CourtDocField>();
  for (const f of heuristicFields) {
    byKey.set(f.key, f);
  }
  for (const f of docparseFields) {
    const existing = byKey.get(f.key);
    if (!existing || f.confidence >= existing.confidence) {
      byKey.set(f.key, f);
    }
  }
  return Array.from(byKey.values());
}

function assessDocparseDegradation(
  result: ExtractionResult,
): { degraded: boolean; reason?: string } {
  const blockCodes = result.warnings
    .filter((w: { severity: string }) => w.severity === 'BLOCK')
    .map((w: { code: string }) => w.code);
  if (blockCodes.length > 0) {
    return { degraded: true, reason: blockCodes.join(',') };
  }

  const hasReadableText = result.documents.some(
    (d: ExtractionResult['documents'][number]) => d.pages.some(
      (p: ExtractionResult['documents'][number]['pages'][number]) => p.lines.some(
        (l: { text: string }) => l.text.trim().length > 0,
      ),
    ),
  );
  const filled = result.autofill.completeness.filled;
  if (!hasReadableText && filled === 0) {
    return { degraded: true, reason: 'unreadable_or_empty' };
  }

  return { degraded: false };
}

function buildDocparseMeta(
  dpResult: ExtractionResult,
  degradation: { degraded: boolean; reason?: string },
  primaryDoc: ExtractionResult['documents'][number] | undefined,
  extras: Partial<DocparseMeta>,
): DocparseMeta {
  const humanReview = dpResult.governance?.humanReviewRequired || [];
  return {
    tier: dpResult.autofill.tier,
    completenessRatio: dpResult.autofill.completeness.ratio,
    conflictFields: [...dpResult.autofill.conflicts],
    lowConfidenceFields: [...dpResult.autofill.lowConfidence],
    absentFields: [...dpResult.autofill.absent],
    degraded: degradation.degraded,
    degradeReason: degradation.reason,
    documentTypeCode: primaryDoc?.classification.code,
    documentTypeLabel: primaryDoc?.classification.label,
    warnings: dpResult.warnings
      .filter((w: { severity: string }) => w.severity !== 'INFO')
      .map((w: { code: string; message: string }) => `${w.code}: ${w.message}`)
      .slice(0, 8),
    concordanceStatus: CONCORDANCE_STATUS,
    handwritingTriageSuggested: humanReview.some((h) =>
      /handwrit|human review|confidence/i.test(h.reason),
    ),
    humanReviewPages: humanReview.slice(0, 12),
    ...extras,
  };
}

async function tryCloudOcrFallback(
  bytes: Buffer,
  fileName: string,
  mimeType: string | undefined,
): Promise<{ text: string; provider: string } | null> {
  try {
    const { nvOcrAdapterService } = await import('./document-pipeline/jrx-got-ocr-adapter-service.js');
    const ext = fileExt(fileName);
    const mime = mimeType
      || (ext === 'pdf' ? 'application/pdf' : IMAGE_EXTS.has(ext) ? `image/${ext === 'jpg' ? 'jpeg' : ext}` : 'application/pdf');
    const ocr = await nvOcrAdapterService.ocrDocument(bytes, mime, {
      language: 'en',
      jurisdiction: 'IN',
    });
    const text = String(ocr?.text || '').trim();
    if (!text) return null;
    return { text, provider: ocr.provider };
  } catch (err) {
    logger.warn('[DocparseAdapter] OCR fallback unavailable', {
      fileName,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function runDocparseEngine(
  files: Array<{ bytes: Buffer; fileName: string; mimeType?: string }>,
  batchId: string,
  actor: string,
  onProgress?: DocparseAdapterInput['onProgress'],
  runOpts: Pick<DocparseAdapterInput, 'domainPackId' | 'forceOcr' | 'preferOcr' | 'maxPagesPerDoc'> = {},
): Promise<ExtractionResult & { _sdkMeta?: { engine: 'docparse-sdk'; legalParseGuide: Record<string, unknown> } }> {
  const totalBytes = files.reduce((n, f) => n + f.bytes.length, 0);
  const { shouldUseAsyncDocparseJob, runDocparseSdkViaQueue } = await import('./jrx-docparse-async-bridge.js');
  const domainPackId = runOpts.domainPackId ?? 'legal-in';
  if (shouldUseAsyncDocparseJob(totalBytes)) {
    onProgress?.('docparse_async_queue', { totalBytes, domainPackId });
    const queued = await runDocparseSdkViaQueue({
      files,
      batchId,
      actor,
      domainPackId,
      forceOcr: runOpts.forceOcr,
      preferOcr: runOpts.preferOcr,
      maxPagesPerDoc: runOpts.maxPagesPerDoc,
    });
    if (isNyvFeatureOn('docparseSdk')) {
      try {
        const { buildSdkResultBundle } = await import('./jrx-docparse-sdk-adapter-service.js');
        const bundle = await buildSdkResultBundle(queued, domainPackId);
        return {
          ...queued,
          _sdkMeta: {
            engine: 'docparse-sdk',
            legalParseGuide: bundle.legalParseGuide as Record<string, unknown>,
            docparseResultV1: bundle.resultV1 as Record<string, unknown>,
            intelligence: bundle.intelligence as Record<string, unknown>,
          },
        };
      } catch {
        return queued;
      }
    }
    return queued;
  }
  const inputFiles = files.map((f) => ({
    bytes: new Uint8Array(f.bytes),
    fileName: f.fileName,
    mime: f.mimeType,
  }));
  const onPage = onProgress
    ? (detail: { documentId: string; pageNo: number; pageTotal: number; route: string }) => {
        onProgress('docparse_page', {
          documentId: detail.documentId,
          pageNo: detail.pageNo,
          pageTotal: detail.pageTotal,
          route: detail.route,
        });
      }
    : undefined;

  if (isNyvFeatureOn('docparseSdk')) {
    try {
      const { runDocparseSdkEngine, buildSdkResultBundle } = await import(
        './jrx-docparse-sdk-adapter-service.js'
      );
      const result = await runDocparseSdkEngine(files, batchId, actor, onProgress, domainPackId, {
        domainPackId,
        forceOcr: runOpts.forceOcr,
        preferOcr: runOpts.preferOcr,
        maxPagesPerDoc: runOpts.maxPagesPerDoc,
      });
      const bundle = await buildSdkResultBundle(result, domainPackId);
      return {
        ...result,
        _sdkMeta: {
          engine: 'docparse-sdk',
          legalParseGuide: bundle.legalParseGuide as Record<string, unknown>,
          docparseResultV1: bundle.resultV1 as Record<string, unknown>,
          intelligence: bundle.intelligence as Record<string, unknown>,
        },
      };
    } catch (err) {
      logger.warn('[DocparseAdapter] Platform SDK engine failed', {
        err: err instanceof Error ? err.message : String(err),
      });
      if (!isNyvFeatureOn('docparseLegacy')) {
        throw err;
      }
    }
  }

  if (isNyvFeatureOn('docparseLegacy')) {
    const { run } = await import('@jurexio/docparse');
    return run(inputFiles, { batchId, actor, onPage });
  }
  throw new Error('Docparse Platform SDK unavailable and JRX_F_DOCPARSE_LEGACY is not enabled');
}

/**
 * DOCX (P2): pre-convert via nv-doc-content-extractor; docparse run() is PDF/image only.
 */
async function extractDocxText(bytes: Buffer, fileName: string, mimeType?: string): Promise<string> {
  const { extractDocumentText } = await import('./sdk/jrx-doc-content-extractor.js');
  const result = await extractDocumentText({
    base64: bytes.toString('base64'),
    fileName,
    mimeType,
  });
  return result.text;
}

function buildInputFiles(input: DocparseAdapterInput): Array<{ bytes: Buffer; fileName: string; mimeType?: string }> {
  if (input.documents?.length) {
    return input.documents.slice(0, DOCPARSE_BATCH_DOC_LIMIT);
  }
  if (input.bytes?.length && input.fileName) {
    return [{ bytes: input.bytes, fileName: input.fileName, mimeType: input.mimeType }];
  }
  return [];
}

/**
 * Primary entry: try docparse on bytes, always merge with heuristic tier-2, then
 * (opt-in) run the Nova-Micro low-confidence recovery pass.
 *
 * NV-DOCPARSE-LLM-FALLBACK-001: the deterministic engine below stays the SSoT
 * primary. `applyDocparseLlmFallback` is flag-gated (default OFF) and fail-soft —
 * when off or on error it returns `core` unchanged, so this wrapper is
 * byte-for-byte identical to the previous behaviour unless the flag is enabled.
 */
export async function runDocparseWithFallback(
  input: DocparseAdapterInput,
): Promise<DocparseAdapterResult> {
  const core = await runDocparseCore(input);
  const { applyDocparseLlmFallback } = await import('./jrx-docparse-llm-fallback.js');
  return applyDocparseLlmFallback(core, {
    text: input.text,
    jurisdiction: input.jurisdiction || 'IN',
  });
}

/**
 * Deterministic docparse + heuristic/OCR cascade (no LLM). SSoT primary.
 */
async function runDocparseCore(
  input: DocparseAdapterInput,
): Promise<DocparseAdapterResult> {
  const jurisdiction = input.jurisdiction || 'IN';
  const progressStages: NonNullable<DocparseMeta['progressStages']> = [];
  const progressInput: DocparseAdapterInput = {
    ...input,
    onProgress: (stage, detail) => {
      emitProgress({ ...input, onProgress: undefined }, progressStages, stage, detail);
      input.onProgress?.(stage, detail);
    },
  };

  let workingText = input.text;
  const files = buildInputFiles(input);
  const primaryFile = files[0];
  const batchId = input.batchId || crypto.randomUUID();
  const actor = input.actor || 'nyv:docparse-adapter';

  /* DOCX path — extract text first; binary docparse engine is PDF/image only. */
  if (primaryFile && isDocxBinary(primaryFile.fileName, primaryFile.mimeType)) {
    emitProgress(progressInput, progressStages, 'docx_extract_start', { fileName: primaryFile.fileName });
    try {
      const docxText = await extractDocxText(primaryFile.bytes, primaryFile.fileName, primaryFile.mimeType);
      if (docxText.length > workingText.length) workingText = docxText;
      emitProgress(progressInput, progressStages, 'docx_extract_done', { chars: docxText.length });
    } catch (err) {
      logger.warn('[DocparseAdapter] DOCX pre-convert failed', {
        fileName: primaryFile.fileName,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const heuristic = await extractCourtDocumentFields(workingText, jurisdiction);

  const flagOn = isNyvFeatureOn('docparse');
  const inLegal = isIndianLegalJurisdiction(jurisdiction);
  const hasBinary = files.length > 0;
  const eligible = primaryFile ? isDocparseEligibleBinary(primaryFile.fileName, primaryFile.mimeType) : false;
  const isDocx = primaryFile ? isDocxBinary(primaryFile.fileName, primaryFile.mimeType) : false;

  if (!flagOn || !inLegal || !hasBinary) {
    return { ...heuristic, extractionPath: 'heuristic' };
  }

  if (isDocx) {
    return {
      ...heuristic,
      fields: mergeCourtFields([], heuristic.fields),
      fieldCount: heuristic.fieldCount,
      extractionPath: 'heuristic',
      docparseMeta: {
        inputFormat: 'docx',
        concordanceStatus: CONCORDANCE_STATUS,
        degraded: false,
        progressStages,
      },
    };
  }

  if (!eligible) {
    return { ...heuristic, extractionPath: 'heuristic' };
  }

  try {
    emitProgress(progressInput, progressStages, 'docparse_start', {
      fileName: primaryFile!.fileName,
      batchSize: files.length,
    });

    const dpResult = await runDocparseEngine(files, batchId, actor, progressInput.onProgress, {
      domainPackId: input.domainPackId,
      forceOcr: input.forceOcr,
      preferOcr: input.preferOcr,
      maxPagesPerDoc: input.maxPagesPerDoc,
    });

    emitProgress(progressInput, progressStages, 'docparse_complete', {
      documents: dpResult.documents.length,
      filled: dpResult.autofill.completeness.filled,
    });

    const degradation = assessDocparseDegradation(dpResult);
    const primaryDoc = dpResult.documents[0];
    const dpFields = mapDocparseToCourtFields(
      dpResult.autofill,
      dpResult.resolutions,
      primaryDoc?.classification,
    );
    const tables = mapTablesFromAnalysis(dpResult);

    const sdkMeta = (dpResult as {
      _sdkMeta?: {
        engine: 'docparse-sdk';
        legalParseGuide: Record<string, unknown>;
        docparseResultV1?: Record<string, unknown>;
        intelligence?: Record<string, unknown>;
      };
    })._sdkMeta;
    const docparseMeta = buildDocparseMeta(dpResult, degradation, primaryDoc, {
      batchDocumentCount: files.length,
      progressStages,
      ...(sdkMeta
        ? {
          engine: sdkMeta.engine,
          legalParseGuide: sdkMeta.legalParseGuide,
          ...(sdkMeta.docparseResultV1 ? { docparseResultV1: sdkMeta.docparseResultV1 } : {}),
          ...(sdkMeta.intelligence ? { docparseIntelligence: sdkMeta.intelligence } : {}),
        }
        : {}),
    });

    /* Tier-2: cloud OCR when docparse could not rasterise / read scans. */
    if (degradation.degraded && primaryFile) {
      emitProgress(progressInput, progressStages, 'ocr_fallback_start', {
        reason: degradation.reason,
      });
      const ocr = await tryCloudOcrFallback(
        primaryFile.bytes,
        primaryFile.fileName,
        primaryFile.mimeType,
      );
      if (ocr?.text) {
        emitProgress(progressInput, progressStages, 'ocr_fallback_done', {
          provider: ocr.provider,
          chars: ocr.text.length,
        });
        const ocrHeuristic = await extractCourtDocumentFields(ocr.text, jurisdiction);
        const merged = mergeCourtFields(dpFields, ocrHeuristic.fields);
        return {
          fields: merged,
          fieldCount: merged.length,
          detectedDocumentType:
            primaryDoc?.classification.label
            || primaryDoc?.classification.code
            || ocrHeuristic.detectedDocumentType
            || heuristic.detectedDocumentType,
          isIndianCourtDocument: heuristic.isIndianCourtDocument || merged.length > 0,
          extractionPath: 'ocr_fallback',
          tables,
          docparseMeta: {
            ...docparseMeta,
            ocrProvider: ocr.provider,
            degraded: true,
            degradeReason: degradation.reason || 'ocr_fallback',
          },
        };
      }
    }

    if (degradation.degraded && dpFields.length === 0) {
      return {
        ...heuristic,
        extractionPath: 'ocr_fallback',
        tables,
        docparseMeta,
      };
    }

    const merged = mergeCourtFields(dpFields, heuristic.fields);
    let extractionPath: ExtractionPath = 'heuristic';
    if (dpFields.length > 0 && heuristic.fieldCount === 0) {
      extractionPath = 'docparse';
    } else if (dpFields.length > 0 && heuristic.fieldCount > 0) {
      extractionPath = 'mixed';
    } else if (dpFields.length > 0) {
      extractionPath = 'docparse';
    }

    const detectedDocumentType =
      primaryDoc?.classification.label
      || primaryDoc?.classification.code
      || heuristic.detectedDocumentType;

    return {
      fields: merged,
      fieldCount: merged.length,
      detectedDocumentType,
      isIndianCourtDocument: heuristic.isIndianCourtDocument || dpFields.length > 0,
      extractionPath,
      tables,
      docparseMeta,
    };
  } catch (err) {
    logger.warn('[DocparseAdapter] run() failed — OCR/heuristic fallback', {
      fileName: primaryFile?.fileName,
      err: err instanceof Error ? err.message : String(err),
    });

    if (primaryFile) {
      const ocr = await tryCloudOcrFallback(
        primaryFile.bytes,
        primaryFile.fileName,
        primaryFile.mimeType,
      );
      if (ocr?.text) {
        const ocrHeuristic = await extractCourtDocumentFields(ocr.text, jurisdiction);
        return {
          ...ocrHeuristic,
          extractionPath: 'ocr_fallback',
          docparseMeta: {
            degraded: true,
            degradeReason: 'docparse_throw',
            ocrProvider: ocr.provider,
            concordanceStatus: CONCORDANCE_STATUS,
            progressStages,
          },
        };
      }
    }

    return {
      ...heuristic,
      extractionPath: 'heuristic',
      docparseMeta: {
        degraded: true,
        degradeReason: 'docparse_throw',
        concordanceStatus: CONCORDANCE_STATUS,
        progressStages,
      },
    };
  }
}

export function isDocparseEnabled(jurisdiction?: string): boolean {
  return isNyvFeatureOn('docparse') && isIndianLegalJurisdiction(jurisdiction);
}
