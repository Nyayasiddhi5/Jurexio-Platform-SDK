/**
 * Single export path for JRX / NSP — Result v1 + LegalParseGuide + Intelligence + PII policy.
 */
import type { ExtractionResult } from "../types.js";
import { buildLegalParseGuide } from "./legal-parse-guide.js";
import { toDocparseResultV1, type DocparseResultV1 } from "./docparse-result-v1.js";
import { buildDocparseIntelligenceV1, type DocparseIntelligenceV1 } from "./intelligence-envelope.js";
import { buildExtractiveLegalIntelligence } from "../intelligence/legal-extractive-intel.js";

export interface DocparseResultBundle {
  resultV1: DocparseResultV1;
  legalParseGuide: DocparseIntelligenceV1["legalParseGuide"];
  intelligence: DocparseIntelligenceV1;
}

export function buildDocparseResultBundle(
  result: ExtractionResult,
  opts: { domainPackId: string; engineVersion: string; producedAt?: string },
): DocparseResultBundle {
  const guide = buildLegalParseGuide(result, opts.domainPackId);
  const intelligence = {
    ...buildDocparseIntelligenceV1(result, guide),
    extractiveLegal: buildExtractiveLegalIntelligence(result),
  };
  const resultV1 = toDocparseResultV1(result, {
    ...opts,
    intelligence,
  });
  return {
    resultV1,
    legalParseGuide: guide,
    intelligence,
  };
}
