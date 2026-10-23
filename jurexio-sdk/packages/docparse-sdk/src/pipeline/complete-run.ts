/**
 * Legal-complete parse — local engine + extractive intelligence + optional partial LLM + cloud OCR hook.
 */
import type { InputFile, RunOptions } from "./run.js";
import { run } from "./run.js";
import type { ExtractionResult } from "../types.js";
import type { PartialFieldRecoveryProvider } from "../recovery/partial-field-recovery.js";
import { applyPartialFieldRecovery } from "../recovery/partial-field-recovery.js";
import type { CloudOcrProvider } from "../ocr/cloud-ocr-types.js";
import { buildDocparseResultBundle, type DocparseResultBundle } from "../contracts/docparse-result-bundle.js";
import { buildExtractiveLegalIntelligence } from "../intelligence/legal-extractive-intel.js";
import type { DocparseIntelligenceV1 } from "../contracts/intelligence-envelope.js";

export interface CompleteRunOptions extends RunOptions {
  partialFieldRecovery?: PartialFieldRecoveryProvider;
  partialRecoveryThreshold?: number;
  cloudOcr?: CloudOcrProvider;
  /** When true, attach extractive legal intelligence to bundle (default true). */
  includeExtractiveLegalIntel?: boolean;
}

export interface CompleteRunResult {
  extraction: ExtractionResult;
  bundle: DocparseResultBundle;
  extractiveLegal?: ReturnType<typeof buildExtractiveLegalIntelligence>;
  partialRecoveryApplied: boolean;
}

export async function runComplete(
  files: InputFile[],
  opts: CompleteRunOptions,
): Promise<CompleteRunResult> {
  const { partialFieldRecovery, includeExtractiveLegalIntel, ...runOpts } = opts;
  let extraction = await run(files, runOpts);
  const { result: merged, patch } = await applyPartialFieldRecovery(
    extraction,
    partialFieldRecovery,
    {
      jurisdiction: "IN",
      threshold: opts.partialRecoveryThreshold,
      domainPackId: opts.domainPackId ?? "legal-in",
      humanReviewPagesOnly: Boolean(process.env.JRX_DOCPARSE_PARTIAL_LLM_HUMAN_REVIEW_ONLY === "1"),
    },
  );
  extraction = merged;
  const domainPackId = opts.domainPackId ?? "legal-in";
  const bundle = buildDocparseResultBundle(extraction, {
    domainPackId,
    engineVersion: "complete-run",
  });
  const extractiveLegal =
    includeExtractiveLegalIntel !== false
      ? buildExtractiveLegalIntelligence(extraction)
      : undefined;
  if (extractiveLegal) {
    (bundle.intelligence as DocparseIntelligenceV1 & { extractiveLegal?: unknown }).extractiveLegal =
      extractiveLegal;
  }
  return {
    extraction,
    bundle,
    extractiveLegal,
    partialRecoveryApplied: Boolean(patch?.applied),
  };
}
