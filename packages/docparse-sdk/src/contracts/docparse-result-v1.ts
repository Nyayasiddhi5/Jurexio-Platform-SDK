/**
 * DocparseResult v1 — stable wire format for JRX / NSP / JRX / external workers.
 */
import type { ExtractionResult, FieldResolution, AutofillPayload } from "../types.js";
import type { DocparseIntelligenceV1 } from "./intelligence-envelope.js";

export const DOCPARSE_RESULT_V1 = "docparse.result/v1" as const;

export interface DocparseResultV1 {
  schema: typeof DOCPARSE_RESULT_V1;
  batchId: string;
  domainPackId: string;
  documents: Array<{
    id: string;
    fileName: string;
    sha256: string;
    pageCount: number;
    classification?: { code: string; label: string; confidence: number };
  }>;
  autofill: AutofillPayload;
  resolutions: FieldResolution[];
  analysis: ExtractionResult["analysis"];
  governance: ExtractionResult["governance"];
  timings: Record<string, number>;
  warnings: ExtractionResult["warnings"];
  meta: {
    engine: "@jurexio/docparse-sdk";
    engineVersion: string;
    producedAt: string;
  };
  /** NV-DOCPARSE-INTELLIGENCE-001 — quality, PII summary, embedded LegalParseGuide for NSP. */
  intelligence?: DocparseIntelligenceV1;
}

export function toDocparseResultV1(
  result: ExtractionResult,
  opts: {
    domainPackId: string;
    engineVersion: string;
    producedAt?: string;
    intelligence?: DocparseIntelligenceV1;
  },
): DocparseResultV1 {
  return {
    schema: DOCPARSE_RESULT_V1,
    batchId: result.batchId,
    domainPackId: opts.domainPackId,
    documents: result.documents.map((d) => ({
      id: d.documentId,
      fileName: d.fileName,
      sha256: d.sha256,
      pageCount: d.pageCount,
      classification: {
        code: d.classification.code,
        label: d.classification.label,
        confidence: d.classification.conf,
      },
    })),
    autofill: result.autofill,
    resolutions: result.resolutions,
    analysis: result.analysis,
    governance: result.governance,
    timings: result.timings,
    warnings: result.warnings,
    meta: {
      engine: "@jurexio/docparse-sdk",
      engineVersion: opts.engineVersion,
      producedAt: opts.producedAt ?? new Date().toISOString(),
    },
    ...(opts.intelligence ? { intelligence: opts.intelligence } : {}),
  };
}
