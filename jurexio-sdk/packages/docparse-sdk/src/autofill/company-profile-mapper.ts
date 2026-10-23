/**
 * NSP company / registration autofill — full resolution states (not collapsed).
 */
import type { ExtractionResult, FieldResolution } from "../types.js";
import { buildAutofill } from "./autofill.js";
import type { AutofillPayload } from "../types.js";
import { isCivilCompanyDocType } from "../doctype/civil-registry.js";
import type { FieldProvenanceEntry } from "./case-create-mapper.js";

export interface NspCompanyProfilePayload {
  fields: Record<string, unknown>;
  /** All resolution states surfaced for UI — never collapse to filled/blank only. */
  autofill: AutofillPayload;
  resolved: string[];
  absent: string[];
  conflicts: string[];
  lowConfidence: string[];
  withheld: string[];
  completenessRatio: number;
  provenance: FieldProvenanceEntry[];
  docTypes: string[];
  primaryDocType?: string;
}

function resolutionProvenance(resolutions: FieldResolution[]): FieldProvenanceEntry[] {
  return resolutions
    .filter((r) => r.status === "RESOLVED" && r.chosen)
    .map((r) => ({
      fieldPath: r.fieldPath,
      value: r.chosen!.valueNormalized ?? r.chosen!.valueRaw,
      confidence: r.chosen!.confidence,
      extractorKind: r.chosen!.extractorKind,
      aiInvolved: Boolean(r.chosen!.aiInvolved),
      documentId: r.chosen!.documentId,
      pageNo: r.chosen!.pageNo,
    }));
}

export function mapExtractionToNspCompanyProfile(
  result: ExtractionResult,
  autofillThreshold = 0.72,
): NspCompanyProfilePayload | null {
  const docTypeCodes = [...new Set(result.documents.map((d) => d.classification.code))];
  if (!docTypeCodes.some(isCivilCompanyDocType)) return null;

  const autofill = buildAutofill(result.resolutions, {
    autofillThreshold,
    docTypeCodes,
  });

  const resolved = result.resolutions
    .filter((r) => r.status === "RESOLVED")
    .map((r) => r.fieldPath);

  return {
    fields: autofill.fields,
    autofill,
    resolved,
    absent: autofill.absent,
    conflicts: autofill.conflicts,
    lowConfidence: autofill.lowConfidence,
    withheld: autofill.withheld,
    completenessRatio: autofill.completeness.ratio,
    provenance: resolutionProvenance(result.resolutions),
    docTypes: docTypeCodes,
    primaryDocType: docTypeCodes.find(isCivilCompanyDocType),
  };
}
