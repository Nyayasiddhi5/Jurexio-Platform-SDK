/**
 * LegalParseGuide — machine-readable field contract (analogous to CNR nspParseGuide).
 */
import type { ExtractionResult, FieldResolution } from "../types.js";
import { piiPolicyForFieldPath } from "../pii/pii-field-catalog.js";

export type ParseGuideAutofillHint =
  | "prefill"
  | "offer_candidate"
  | "chooser_required"
  | "not_found"
  | "withheld";

export interface LegalParseGuideEntry {
  fieldPath: string;
  label: string;
  cardinality: "single" | "multi";
  autofillHint: ParseGuideAutofillHint;
  piiClass?: string;
  confidence?: number;
  status: FieldResolution["status"];
}

export interface LegalParseGuide {
  schema: "legal.parseGuide/v1";
  domainPackId: string;
  entries: LegalParseGuideEntry[];
}

function multiValueFieldPath(path: string): boolean {
  return (
    path === "sections" ||
    path === "parties" ||
    path === "amounts" ||
    path === "dates" ||
    path.startsWith("parties[") ||
    path.includes("witnesses")
  );
}

const LABELS: Record<string, string> = {
  cnr: "CNR",
  "court.raw": "Court",
  caseNumber: "Case number",
  "fir.number": "FIR number",
  "fir.policeStation": "Police station",
  parties: "Parties",
  sections: "Statutes / sections",
  amounts: "Amounts",
  dates: "Dates",
};

function labelFor(path: string): string {
  if (LABELS[path]) return LABELS[path];
  if (path.startsWith("parties[")) return "Party";
  return path.replace(/\[\d+\]/g, "").replace(/\./g, " / ");
}

function autofillHint(r: FieldResolution): ParseGuideAutofillHint {
  if (r.chosen && typeof r.chosen.valueNormalized === "object" && r.chosen.valueNormalized !== null) {
    const v = r.chosen.valueNormalized as Record<string, unknown>;
    if (v.withheld === true) return "withheld";
  }
  switch (r.status) {
    case "RESOLVED":
      return "prefill";
    case "LOW_CONFIDENCE":
      return "offer_candidate";
    case "CONFLICT":
      return "chooser_required";
    case "ABSENT":
    default:
      return "not_found";
  }
}

export function buildLegalParseGuide(
  result: ExtractionResult,
  domainPackId: string,
): LegalParseGuide {
  const entries: LegalParseGuideEntry[] = result.resolutions.map((r) => {
    const pii = piiPolicyForFieldPath(r.fieldPath);
    return {
      fieldPath: r.fieldPath,
      label: labelFor(r.fieldPath),
      cardinality: multiValueFieldPath(r.fieldPath) ? "multi" : "single",
      autofillHint: autofillHint(r),
      piiClass: pii?.piiClass,
      confidence: r.chosen?.confidence,
      status: r.status,
    };
  });

  return {
    schema: "legal.parseGuide/v1",
    domainPackId,
    entries,
  };
}
