import { describe, it, expect } from "vitest";
import { ALL_DOC_TYPES } from "../src/doctype/all-types.js";
import { buildLegalParseGuide } from "../src/contracts/legal-parse-guide.js";
import { toDocparseResultV1, DOCPARSE_RESULT_V1 } from "../src/contracts/docparse-result-v1.js";
import { piiPolicyForFieldPath } from "../src/pii/pii-field-catalog.js";
import type { ExtractionResult } from "../src/types.js";

describe("@jurexio/docparse-sdk platform layer", () => {
  it("includes government doc profiles beyond base legal registry", () => {
    const codes = new Set(ALL_DOC_TYPES.map((d) => d.code));
    expect(codes.has("RTI_APPLICATION")).toBe(true);
    expect(codes.has("GOVT_ORDER")).toBe(true);
    expect(ALL_DOC_TYPES.length).toBeGreaterThan(58);
  });

  it("builds LegalParseGuide with four-state hints", () => {
    const stub: ExtractionResult = {
      batchId: "b",
      documents: [],
      candidates: [],
      resolutions: [
        {
          fieldPath: "cnr",
          status: "RESOLVED",
          chosen: {
            valueRaw: "DLCT010000012023",
            valueNormalized: "DLCT010000012023",
            confidence: 0.9,
            fieldPath: "cnr",
            documentId: "d",
            pageNo: 1,
            bbox: { x: 0, y: 0, w: 1, h: 1 },
            lineIndices: [0],
            extractorId: "grammar",
            extractorKind: "GRAMMAR",
            aiInvolved: false,
            authorityWeight: 1,
          },
          competing: [],
          rationale: "test",
        },
      ],
      autofill: {
        tier: "T1",
        fields: {},
        absent: [],
        conflicts: [],
        lowConfidence: [],
        withheld: [],
        completeness: { filled: 1, expected: 1, ratio: 1 },
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
    const guide = buildLegalParseGuide(stub, "legal-in");
    expect(guide.schema).toBe("legal.parseGuide/v1");
    expect(guide.entries[0]?.autofillHint).toBe("prefill");
  });

  it("serializes DocparseResult v1 envelope", () => {
    const stub: ExtractionResult = {
      batchId: "b1",
      documents: [],
      candidates: [],
      resolutions: [],
      autofill: {
        tier: "T0",
        fields: {},
        absent: [],
        conflicts: [],
        lowConfidence: [],
        withheld: [],
        completeness: { filled: 0, expected: 0, ratio: 0 },
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
    const v1 = toDocparseResultV1(stub, { domainPackId: "legal-in", engineVersion: "1.0.0-alpha.1" });
    expect(v1.schema).toBe(DOCPARSE_RESULT_V1);
    expect(v1.meta.engine).toBe("@jurexio/docparse-sdk");
  });

  it("maps PII policy for aadhaar paths", () => {
    expect(piiPolicyForFieldPath("identity.aadhaar")?.piiClass).toBe("AADHAAR");
  });

  it("loads insurance-fnol JSON domain pack (Phase 4 POC)", async () => {
    const { loadDomainPack } = await import("../src/domain/domain-pack.js");
    const pack = loadDomainPack("insurance-fnol");
    expect(pack.id).toBe("insurance-fnol");
    expect(pack.docTypes.length).toBeGreaterThanOrEqual(2);
    expect(pack.docTypes[0]!.cues[0]!.re.test("first notice of loss")).toBe(true);
  });

  it("lists domain pack catalog entries", async () => {
    const { listDomainPacks } = await import("../src/domain/domain-pack.js");
    const packs = listDomainPacks();
    expect(packs.map((p) => p.id)).toEqual([
      "legal-in",
      "legal-in-gov",
      "legal-in-civil",
      "legal-in-identity",
      "legal-in-evidence",
      "insurance-fnol",
    ]);
  });
});
