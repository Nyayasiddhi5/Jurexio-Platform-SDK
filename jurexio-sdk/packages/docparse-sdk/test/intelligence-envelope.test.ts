import { describe, it, expect } from "vitest";
import { buildDocparseResultBundle } from "../src/contracts/docparse-result-bundle.js";
import type { ExtractionResult } from "../src/types.js";

const stub: ExtractionResult = {
  batchId: "b1",
  documents: [{
    documentId: "d1",
    fileName: "x.pdf",
    sha256: "abc",
    pageCount: 1,
    classification: { code: "VAKALATNAMA", label: "Vak", conf: 0.9, runnersUp: [] },
    pages: [],
  }],
  autofill: {
    tier: "T1",
    fields: { "parties[0].name": "A" },
    completeness: { ratio: 0.5, filled: 1, expected: 2 },
    conflicts: [],
    lowConfidence: [],
    absent: ["cnr"],
    withheld: [],
  },
  resolutions: [{
    fieldPath: "parties[0].name",
    status: "RESOLVED",
    chosen: { value: "A", confidence: 0.88 },
  }],
  analysis: [],
  governance: { humanReviewRequired: [], redactions: [], restrictedReasons: [], aiInvolved: false, auditEvents: [] },
  timings: {},
  warnings: [],
};

describe("buildDocparseResultBundle", () => {
  it("embeds intelligence + PII summary + legalParseGuide", () => {
    const bundle = buildDocparseResultBundle(stub, {
      domainPackId: "legal-in",
      engineVersion: "1.0.0-alpha.2-test",
    });
    expect(bundle.resultV1.intelligence?.schema).toBe("docparse.intelligence/v1");
    expect(bundle.intelligence.pii.catalogEntries).toBeGreaterThan(0);
    expect(bundle.legalParseGuide.entries.length).toBe(1);
    expect(bundle.legalParseGuide.entries[0].piiClass).toBe("NAME");
  });
});
