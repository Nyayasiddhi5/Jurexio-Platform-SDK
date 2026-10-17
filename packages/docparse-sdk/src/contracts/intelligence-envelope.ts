/**
 * NV-DOCPARSE-INTELLIGENCE-001 — standardized analysis envelope for Result v1 (legal-first).
 */
import type { ExtractionResult } from "../types.js";
import type { LegalParseGuide } from "./legal-parse-guide.js";
import { listPiiCatalog, piiPolicyForFieldPath } from "../pii/pii-field-catalog.js";
import type { ExtractiveLegalIntelligence } from "../intelligence/legal-extractive-intel.js";
import {
  buildPageManifestV1,
  DOCPARSE_PAGE_MANIFEST_V1,
  type PageManifestEntryV1,
} from "../intelligence/page-manifest.js";

export const DOCPARSE_INTELLIGENCE_V1 = "docparse.intelligence/v1" as const;

export type QualityBand = "high" | "medium" | "low";

export interface DocparseIntelligenceV1 {
  schema: typeof DOCPARSE_INTELLIGENCE_V1;
  domainPackId: string;
  qualityBand: QualityBand;
  completenessRatio: number;
  filledFields: number;
  expectedFields: number;
  conflictCount: number;
  lowConfidenceCount: number;
  absentCount: number;
  humanReviewPages: number;
  pii: {
    catalogEntries: number;
    fieldsTagged: number;
    sensitiveFieldPaths: number;
    withheldHints: number;
    maskInLogsDefault: boolean;
  };
  legalParseGuide: LegalParseGuide;
  /** Extractive obligations/risks/deadlines/parties — no LLM prose (legal-first). */
  extractiveLegal?: ExtractiveLegalIntelligence;
  /** Per-page routing/quality manifest (NSP partial-context UX). */
  pageManifest?: {
    schema: typeof DOCPARSE_PAGE_MANIFEST_V1;
    pages: PageManifestEntryV1[];
  };
}

function qualityBand(ratio: number, conflicts: number): QualityBand {
  if (ratio >= 0.72 && conflicts === 0) return "high";
  if (ratio >= 0.45) return "medium";
  return "low";
}

export function buildDocparseIntelligenceV1(
  result: ExtractionResult,
  guide: LegalParseGuide,
): DocparseIntelligenceV1 {
  const comp = result.autofill.completeness;
  const ratio = comp.ratio ?? 0;
  const conflicts = result.autofill.conflicts?.length ?? 0;
  const sensitivePaths = guide.entries.filter(
    (e) => e.piiClass && e.piiClass !== "NONE",
  ).length;
  const withheld = guide.entries.filter((e) => e.autofillHint === "withheld").length;
  const tagged = result.resolutions.filter((r) => {
    const pol = piiPolicyForFieldPath(r.fieldPath);
    return pol?.piiClass !== "NONE";
  }).length;

  return {
    schema: DOCPARSE_INTELLIGENCE_V1,
    domainPackId: guide.domainPackId,
    qualityBand: qualityBand(ratio, conflicts),
    completenessRatio: ratio,
    filledFields: comp.filled,
    expectedFields: comp.expected,
    conflictCount: conflicts,
    lowConfidenceCount: result.autofill.lowConfidence?.length ?? 0,
    absentCount: result.autofill.absent?.length ?? 0,
    humanReviewPages: result.governance.humanReviewRequired?.length ?? 0,
    pii: {
      catalogEntries: listPiiCatalog().length,
      fieldsTagged: tagged,
      sensitiveFieldPaths: sensitivePaths,
      withheldHints: withheld,
      maskInLogsDefault: true,
    },
    legalParseGuide: guide,
    pageManifest: {
      schema: DOCPARSE_PAGE_MANIFEST_V1,
      pages: buildPageManifestV1(result),
    },
  };
}
