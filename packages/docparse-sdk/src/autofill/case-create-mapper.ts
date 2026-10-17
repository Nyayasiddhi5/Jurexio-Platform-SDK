/**
 * NSP case-create + user-profile autofill mapping from a completed parse.
 */
import type { AutofillPayload, ExtractionResult, FieldResolution } from "../types.js";
import { buildAutofill, toCaseDraft, type NspCaseDraft } from "./autofill.js";

export interface FieldProvenanceEntry {
  fieldPath: string;
  value: unknown;
  confidence: number;
  extractorKind: string;
  aiInvolved: boolean;
  documentId?: string;
  pageNo?: number;
}

export interface NspCaseCreatePayload {
  draft: NspCaseDraft;
  /** Flat autofill fields (same keys as form bindings). */
  fields: Record<string, unknown>;
  /** Full resolution state lists (never collapse to filled/blank only). */
  resolved: string[];
  absent: string[];
  conflicts: string[];
  lowConfidence: string[];
  withheld: string[];
  autofill: AutofillPayload;
  completenessRatio: number;
  provenance: FieldProvenanceEntry[];
  docTypes: string[];
}

export interface UserProfileAutofillHints {
  fullName?: string;
  email?: string;
  phone?: string;
  address?: string;
  pan?: string;
  aadhaarLast4?: string;
}

const USER_FIELD_HINTS: Array<{ path: string; hintKey: keyof UserProfileAutofillHints }> = [
  { path: "parties[0].name", hintKey: "fullName" },
  { path: "parties[0].address", hintKey: "address" },
  { path: "advocates[0].email", hintKey: "email" },
  { path: "advocates[0].phone", hintKey: "phone" },
  { path: "parties[0].pan", hintKey: "pan" },
];

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

export function mapExtractionToNspCaseCreate(
  result: ExtractionResult,
  autofillThreshold = 0.72,
): NspCaseCreatePayload {
  const docTypeCodes = [...new Set(result.documents.map((d) => d.classification.code))];
  const autofill = buildAutofill(result.resolutions, {
    autofillThreshold,
    docTypeCodes,
  });
  const draft = toCaseDraft(autofill);
  const resolved = result.resolutions
    .filter((r) => r.status === "RESOLVED")
    .map((r) => r.fieldPath);
  return {
    draft,
    fields: autofill.fields,
    resolved,
    absent: autofill.absent,
    conflicts: autofill.conflicts,
    lowConfidence: autofill.lowConfidence,
    withheld: autofill.withheld,
    autofill,
    completenessRatio: autofill.completeness.ratio,
    provenance: resolutionProvenance(result.resolutions),
    docTypes: docTypeCodes,
  };
}

export function mapExtractionToUserProfileHints(result: ExtractionResult): UserProfileAutofillHints {
  const payload = mapExtractionToNspCaseCreate(result);
  const hints: UserProfileAutofillHints = {};
  for (const { path, hintKey } of USER_FIELD_HINTS) {
    const v = payload.fields[path];
    if (v != null && String(v).trim()) {
      hints[hintKey] = String(v).trim();
    }
  }
  return hints;
}
