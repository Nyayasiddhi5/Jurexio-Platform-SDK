/**
 * NV-NSP-ONBOARDING-EXTRACT-001 — NSP Pro Step-2 autofill shape from docparse extraction.
 * Aligns with NSP onboarding-extraction.service field names (no duplicate LLM path).
 */
import type { ExtractionResult } from "../types.js";
import { mapExtractionToNspUserOnboarding } from "./user-onboarding-mapper.js";
import { mapExtractionToNspCompanyProfile } from "./company-profile-mapper.js";

export type NspOnboardingDocumentHint = "panCard" | "barCert" | "firmCert" | "auto";

export function resolveOnboardingDomainPack(
  hint?: NspOnboardingDocumentHint | string,
  ingestRole?: string,
): string {
  const h = (hint ?? "auto").toLowerCase();
  if (h === "pancard" || h === "barcert") return "legal-in-identity";
  if (h === "firmcert") return "legal-in-civil";
  if (ingestRole === "onboarding_kyc") return "legal-in-identity";
  if (ingestRole === "company_kyc") return "legal-in-civil";
  return "legal-in-identity";
}

function fieldStr(fields: Record<string, unknown>, path: string): string | undefined {
  const v = fields[path];
  if (v == null || typeof v === "object") return undefined;
  const s = String(v).trim();
  return s || undefined;
}

export interface NspOnboardingClassify {
  docTypeCode: string | null;
  docTypeLabel: string | null;
  confidence: number | null;
  detectedFieldCount: number;
  parseDetails?: {
    completenessRatio?: number;
    domainPackId?: string;
    documentHint?: string;
  };
}

export interface NspOnboardingFormPayload {
  panNumber?: string | null;
  panCardName?: string | null;
  fullName?: string | null;
  barCouncilNumber?: string | null;
  barCouncilName?: string | null;
  barCouncilState?: string | null;
  firmName?: string | null;
  registrationNumber?: string | null;
  registrationDate?: string | null;
  addressLine?: string | null;
  addressState?: string | null;
  city?: string | null;
  pincode?: string | null;
  enrollmentDate?: string | null;
  yearOfEnrollment?: string | null;
  classify: NspOnboardingClassify;
  completenessRatio: number;
  engine: "docparse-sdk";
}

export function mapExtractionToNspOnboardingForm(
  result: ExtractionResult,
  opts?: { domainPackId?: string; documentHint?: string },
): NspOnboardingFormPayload {
  const user = mapExtractionToNspUserOnboarding(result);
  const company = mapExtractionToNspCompanyProfile(result);
  const fields = { ...result.autofill.fields };

  const primary = result.documents[0]?.classification;
  const resolvedCount = result.resolutions.filter((r) => r.status === "RESOLVED").length;

  const pan = fieldStr(fields, "ids.pan") ?? user?.userProfile.pan ?? null;
  const fullName =
    user?.userProfile.fullName
    ?? fieldStr(fields, "user.fullName")
    ?? fieldStr(fields, "parties[0].name")
    ?? null;

  const barEnrol =
    fieldStr(fields, "advocates.enrolmentNo")
    ?? fieldStr(fields, "advocates[0].enrolmentNo")
    ?? null;

  const firmName = fieldStr(fields, "company.name") ?? null;
  const regNo = fieldStr(fields, "registration.number") ?? fieldStr(fields, "ids.cin") ?? null;
  const address =
    fieldStr(fields, "registered.address")
    ?? fieldStr(fields, "user.address")
    ?? fieldStr(fields, "address")
    ?? null;

  return {
    panNumber: pan,
    panCardName: primary?.code === "PAN_CARD" ? fullName : null,
    fullName,
    barCouncilNumber: barEnrol,
    barCouncilName: fieldStr(fields, "govt.department") ?? null,
    barCouncilState: fieldStr(fields, "court.state") ?? null,
    firmName: firmName ?? (company ? fieldStr(company.fields, "company.name") : null),
    registrationNumber: regNo,
    registrationDate: fieldStr(fields, "dates.registration") ?? fieldStr(fields, "dates.incorporation") ?? null,
    addressLine: address,
    addressState: fieldStr(fields, "registered.state") ?? null,
    city: fieldStr(fields, "registered.city") ?? null,
    pincode: fieldStr(fields, "registered.pincode") ?? fieldStr(fields, "address.pincode") ?? null,
    enrollmentDate: fieldStr(fields, "dates.enrollment") ?? null,
    yearOfEnrollment: fieldStr(fields, "dates.enrollmentYear") ?? null,
    classify: {
      docTypeCode: primary?.code ?? null,
      docTypeLabel: primary?.label ?? null,
      confidence: primary?.conf ?? null,
      detectedFieldCount: resolvedCount,
      parseDetails: {
        completenessRatio: result.autofill.completeness.ratio,
        domainPackId: opts?.domainPackId,
        documentHint: opts?.documentHint,
      },
    },
    completenessRatio: result.autofill.completeness.ratio,
    engine: "docparse-sdk",
  };
}
