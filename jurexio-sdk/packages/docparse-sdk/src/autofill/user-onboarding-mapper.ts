/**
 * NSP user / client onboarding autofill — identity KYC with withheld sensitive IDs.
 */
import type { ExtractionResult, FieldResolution } from "../types.js";
import type { FieldProvenanceEntry } from "./case-create-mapper.js";
import { isIdentityDocType } from "../doctype/identity-registry.js";

export interface NspUserProfileFields {
  fullName?: string;
  address?: string;
  pan?: string;
  aadhaarLast4?: string;
  dob?: string;
  passport?: string;
  dl?: string;
  epic?: string;
  phone?: string;
  email?: string;
}

export interface NspUserOnboardingPayload {
  /** Onboarding form keys (never full Aadhaar). */
  userProfile: NspUserProfileFields;
  fields: Record<string, unknown>;
  autofill: ExtractionResult["autofill"];
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

function readField(fields: Record<string, unknown>, path: string): string | undefined {
  const v = fields[path];
  if (v == null) return undefined;
  if (typeof v === "object" && v !== null && "withheld" in v) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function aadhaarLast4FromFields(fields: Record<string, unknown>): string | undefined {
  const raw = fields["ids.aadhaar"];
  if (raw == null || typeof raw === "object") return undefined;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 4) return undefined;
  return digits.slice(-4);
}

function buildUserProfileFromAutofill(fields: Record<string, unknown>): NspUserProfileFields {
  const profile: NspUserProfileFields = {};
  profile.fullName =
    readField(fields, "user.fullName")
    ?? readField(fields, "parties[0].name");
  profile.address =
    readField(fields, "user.address")
    ?? readField(fields, "parties[0].address")
    ?? readField(fields, "address");
  profile.pan = readField(fields, "ids.pan");
  profile.aadhaarLast4 = aadhaarLast4FromFields(fields);
  profile.dob =
    readField(fields, "user.dob")
    ?? readField(fields, "parties[0].dob");
  profile.passport = readField(fields, "ids.passport");
  profile.dl = readField(fields, "ids.dl");
  profile.epic = readField(fields, "ids.epic");
  profile.phone = readField(fields, "contacts.phone");
  profile.email = readField(fields, "contacts.email");
  return profile;
}

/** Full onboarding bind shape for NSP sign-up / KYC screens. */
export function mapExtractionToNspUserOnboarding(
  result: ExtractionResult,
  autofillThreshold = 0.72,
): NspUserOnboardingPayload | null {
  const docTypeCodes = [...new Set(result.documents.map((d) => d.classification.code))];
  if (!docTypeCodes.some(isIdentityDocType)) return null;

  const autofill = result.autofill;
  void autofillThreshold;
  void docTypeCodes;

  const userProfile = buildUserProfileFromAutofill(autofill.fields);
  const resolved = result.resolutions
    .filter((r) => r.status === "RESOLVED")
    .map((r) => r.fieldPath);

  const withheld = [...autofill.withheld];
  if (autofill.fields["ids.aadhaar"] != null && !withheld.includes("ids.aadhaar")) {
    withheld.push("ids.aadhaar");
  }

  return {
    userProfile,
    fields: autofill.fields,
    autofill,
    resolved,
    absent: autofill.absent,
    conflicts: autofill.conflicts,
    lowConfidence: autofill.lowConfidence,
    withheld,
    completenessRatio: autofill.completeness.ratio,
    provenance: resolutionProvenance(result.resolutions),
    docTypes: docTypeCodes,
    primaryDocType: docTypeCodes.find(isIdentityDocType),
  };
}
