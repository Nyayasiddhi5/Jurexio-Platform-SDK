import { describe, it, expect } from "vitest";
import { buildDocparseIntelligenceV1 } from "../src/contracts/intelligence-envelope.js";
import { buildLegalParseGuide } from "../src/contracts/legal-parse-guide.js";
import type { ExtractionResult } from "../src/types.js";

const base: ExtractionResult = {
  batchId: "b1",
  documents: [{
    documentId: "d1",
    fileName: "scan.pdf",
    sha256: "abc",
    pageCount: 2,
    classification: { code: "FIR", label: "FIR", conf: 0.8, runnersUp: [] },
    pages: [{
      pageNo: 1,
      width: 100,
      height: 100,
      deskewDeg: 0,
      lines: [{ text: "Line", bbox: { x: 0, y: 0, w: 1, h: 1 }, words: [], script: "Latn", conf: 0.9, index: 0, zone: "body" }],
      blocks: [],
      tables: [{ rows: 2, cols: 2, cells: [] }],
      script: "Latn",
      route: "OCR",
      quality: { textLayerCoverage: 0, meanConf: 0.72, garbleRate: 0.1, handwrittenSuspected: false },
    }],
  }],
  autofill: {
    tier: "T1",
    fields: {},
    completeness: { ratio: 0.4, filled: 1, expected: 3 },
    conflicts: [],
    lowConfidence: [],
    absent: [],
    withheld: [],
  },
  resolutions: [{
    fieldPath: "parties[0].name",
    status: "RESOLVED",
    chosen: { value: "A", confidence: 0.88 },
  }],
  analysis: [],
  governance: {
    humanReviewRequired: [{ documentId: "d1", pageNo: 1, reason: "low_conf" }],
    redactions: [],
    restrictedReasons: [],
    aiInvolved: false,
    auditEvents: [],
  },
  timings: {},
  warnings: [],
};

describe("pageManifest in docparseIntelligence v1", () => {
  it("includes per-page manifest entries", () => {
    const guide = buildLegalParseGuide(base, "legal-in");
    const intel = buildDocparseIntelligenceV1(base, guide);
    expect(intel.pageManifest?.schema).toBe("docparse.pageManifest/v1");
    expect(intel.pageManifest?.pages).toHaveLength(1);
    expect(intel.pageManifest?.pages[0].route).toBe("OCR");
    expect(intel.pageManifest?.pages[0].humanReview).toBe(true);
    expect(intel.pageManifest?.pages[0].tableCount).toBe(1);
  });
});
