import { describe, expect, it } from "vitest";
import type { ExtractionResult, FieldResolution } from "../src/types.js";
import {
  applyPartialFieldRecovery,
  mergePartialRecovery,
  fieldPathsNeedingRecovery,
} from "../src/recovery/partial-field-recovery.js";

function minimalResult(resolutions: FieldResolution[]): ExtractionResult {
  return {
    batchId: "t",
    documents: [{
      documentId: "d1",
      fileName: "x.pdf",
      classification: { code: "PLAINT", conf: 0.9, alternatives: [] },
      pages: [],
      sha256: "abc",
      mime: "application/pdf",
      pageCount: 0,
      langs: ["en"],
      timings: {},
      warnings: [],
    }],
    candidates: [],
    resolutions,
    autofill: {
      tier: "T0",
      fields: {},
      absent: resolutions.filter((r) => r.status === "ABSENT").map((r) => r.fieldPath),
      conflicts: [],
      lowConfidence: [],
      withheld: [],
      completeness: { filled: 0, expected: 2, ratio: 0 },
    },
    analysis: [],
    governance: {
      restricted: false,
      restrictedReasons: [],
      redactions: [],
      aiInvolved: false,
      humanReviewRequired: [],
      auditEvents: [],
    },
    timings: {},
    warnings: [],
  };
}

describe("partial field recovery", () => {
  it("lists absent paths below threshold", () => {
    const r = minimalResult([
      { fieldPath: "cnr", status: "ABSENT", competing: [], rationale: "" },
      { fieldPath: "court.raw", status: "RESOLVED", chosen: { fieldPath: "court.raw", valueRaw: "HC", valueNormalized: "HC", confidence: 0.9, extractorId: "a", extractorKind: "ANCHOR", aiInvolved: false, documentId: "d1", pageNo: 1, bbox: null, lineIndices: [], authorityWeight: 0.8 }, competing: [], rationale: "" },
    ]);
    expect(fieldPathsNeedingRecovery(r)).toContain("cnr");
    expect(fieldPathsNeedingRecovery(r)).not.toContain("court.raw");
  });

  it("merges snippet LLM without overwriting confident fields", () => {
    const base = minimalResult([
      { fieldPath: "cnr", status: "ABSENT", competing: [], rationale: "" },
      { fieldPath: "court.raw", status: "RESOLVED", chosen: { fieldPath: "court.raw", valueRaw: "HC", valueNormalized: "HC", confidence: 0.9, extractorId: "a", extractorKind: "ANCHOR", aiInvolved: false, documentId: "d1", pageNo: 1, bbox: null, lineIndices: [], authorityWeight: 0.8 }, competing: [], rationale: "" },
    ]);
    const merged = mergePartialRecovery(base, {
      applied: true,
      model: "test-llm",
      values: { cnr: { value: "CNR123", confidence: 0.6 } },
      notes: [],
    });
    expect(merged.autofill.fields.cnr).toBe("CNR123");
    expect(merged.resolutions.find((r) => r.fieldPath === "court.raw")?.chosen?.valueRaw).toBe("HC");
  });

  it("applyPartialFieldRecovery no-ops without provider", async () => {
    const base = minimalResult([
      { fieldPath: "cnr", status: "ABSENT", competing: [], rationale: "" },
    ]);
    const { result, patch } = await applyPartialFieldRecovery(base, undefined);
    expect(patch).toBeNull();
    expect(result).toBe(base);
  });
});
