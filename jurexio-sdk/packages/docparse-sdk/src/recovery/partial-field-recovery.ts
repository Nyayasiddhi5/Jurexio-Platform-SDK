/**
 * Partial on-demand LLM recovery — fills only absent/low-confidence field paths.
 * Never overwrites confident deterministic resolutions (NV-DOCPARSE-PARTIAL-LLM-001).
 */
import type { ExtractionResult, FieldResolution } from "../types.js";
import { extractSnippetsForFieldPaths } from "./snippet-extract.js";
import { partialRecoverySchemaId } from "./partial-schema-registry.js";

export interface PartialFieldRecoveryInput {
  result: ExtractionResult;
  fieldPaths: string[];
  jurisdiction: string;
  snippets: Record<string, string>;
  /** Domain pack for schema-aware recovery (JRX/NSP inject). */
  domainPackId?: string;
  /** When set, provider should only emit keys allowed for this schema. */
  schemaId?: string;
}

export interface PartialFieldRecoveryPatch {
  applied: boolean;
  model?: string;
  /** fieldPath → recovered value */
  values: Record<string, { value: string; confidence: number }>;
  notes: string[];
}

export interface PartialFieldRecoveryProvider {
  readonly id: string;
  recover(input: PartialFieldRecoveryInput): Promise<PartialFieldRecoveryPatch>;
}

const CONFIDENT = 0.72;

export function fieldPathsNeedingRecovery(
  result: ExtractionResult,
  threshold = CONFIDENT,
): string[] {
  return result.resolutions
    .filter((r) => r.status === "ABSENT" || r.status === "LOW_CONFIDENCE")
    .filter((r) => (r.chosen?.confidence ?? 0) < threshold)
    .map((r) => r.fieldPath);
}

export function mergePartialRecovery(
  result: ExtractionResult,
  patch: PartialFieldRecoveryPatch,
): ExtractionResult {
  if (!patch.applied || Object.keys(patch.values).length === 0) {
    return result;
  }
  const resolutions: FieldResolution[] = result.resolutions.map((r) => {
    const hit = patch.values[r.fieldPath];
    if (!hit) return r;
    const existingConf = r.chosen?.confidence ?? 0;
    if (existingConf >= CONFIDENT && r.status !== "ABSENT") return r;
    const docId = r.chosen?.documentId ?? result.documents[0]?.documentId ?? "unknown";
    const pageNo = r.chosen?.pageNo ?? 1;
    const candidate = {
      fieldPath: r.fieldPath,
      valueRaw: hit.value,
      valueNormalized: hit.value,
      confidence: Math.min(hit.confidence, 0.65),
      extractorId: patch.model ?? "partial-llm",
      extractorKind: "LLM_FALLBACK" as const,
      aiInvolved: true,
      documentId: docId,
      pageNo,
      bbox: r.chosen?.bbox ?? null,
      lineIndices: r.chosen?.lineIndices ?? [],
      authorityWeight: Math.min(r.chosen?.authorityWeight ?? 0.5, 0.55),
    };
    return {
      ...r,
      status: "RESOLVED",
      chosen: candidate,
      competing: r.competing,
      rationale: "partial LLM recovery on snippet (deterministic gap fill)",
    };
  });

  const filled = new Set(resolutions.filter((r) => r.status === "RESOLVED").map((r) => r.fieldPath));
  const absent = result.autofill.absent.filter((p) => !filled.has(p));
  const low = result.autofill.lowConfidence.filter((p) => !filled.has(p));
  const fields = { ...result.autofill.fields };
  for (const [path, v] of Object.entries(patch.values)) {
    if (filled.has(path)) fields[path] = v.value;
  }
  const expected = result.autofill.completeness.expected;
  const filledCount = Object.keys(fields).length;

  return {
    ...result,
    resolutions,
    autofill: {
      ...result.autofill,
      fields,
      absent,
      lowConfidence: low,
      withheld: result.autofill.withheld ?? [],
      completeness: {
        filled: filledCount,
        expected,
        ratio: expected > 0 ? filledCount / expected : 0,
      },
    },
    warnings: [
      ...result.warnings,
      {
        code: "PARTIAL_LLM_RECOVERY",
        message: `Partial LLM recovery applied (${Object.keys(patch.values).length} fields) via ${patch.model ?? patch.notes[0] ?? "provider"}`,
        severity: "INFO",
      },
    ],
  };
}

export async function applyPartialFieldRecovery(
  result: ExtractionResult,
  provider: PartialFieldRecoveryProvider | undefined,
  opts: {
    jurisdiction?: string;
    threshold?: number;
    maxCharsPerSnippet?: number;
    domainPackId?: string;
    /** When true, snippets are taken only from pages flagged for human review. */
    humanReviewPagesOnly?: boolean;
  } = {},
): Promise<{ result: ExtractionResult; patch: PartialFieldRecoveryPatch | null }> {
  if (!provider) return { result, patch: null };
  let paths = fieldPathsNeedingRecovery(result, opts.threshold ?? CONFIDENT);
  if (paths.length === 0) {
    return { result, patch: { applied: false, values: {}, notes: ["no gaps"] } };
  }
  const reviewPages =
    opts.humanReviewPagesOnly && result.governance.humanReviewRequired.length > 0
      ? new Set(result.governance.humanReviewRequired.map((h) => h.pageNo))
      : undefined;
  const snippets = extractSnippetsForFieldPaths(
    result,
    paths,
    opts.maxCharsPerSnippet ?? 480,
    reviewPages,
  );
  paths = paths.filter((p) => (snippets[p] ?? "").trim().length > 0);
  if (paths.length === 0) {
    return { result, patch: { applied: false, values: {}, notes: ["no snippets for recovery"] } };
  }
  const docTypes = [...new Set(result.documents.map((d) => d.classification.code))];
  const schemaId = partialRecoverySchemaId(opts.domainPackId ?? "legal-in", docTypes);
  const patch = await provider.recover({
    result,
    fieldPaths: paths,
    jurisdiction: opts.jurisdiction ?? "IN",
    snippets,
    domainPackId: opts.domainPackId,
    schemaId,
  });
  if (!patch.applied) return { result, patch };
  return { result: mergePartialRecovery(result, patch), patch };
}
