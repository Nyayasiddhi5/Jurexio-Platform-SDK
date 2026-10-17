/**
 * Pack-aware JSON key allowlists for partial LLM recovery (snippet-bound).
 */
import type { DomainPack } from "../domain/domain-pack.js";
import { loadDomainPack } from "../domain/domain-pack.js";
import { isCivilCompanyDocType } from "../doctype/civil-registry.js";
import { isIdentityDocType } from "../doctype/identity-registry.js";

export type PartialRecoverySchemaId =
  | "legal-in-court"
  | "legal-in-civil-company"
  | "legal-in-identity"
  | "legal-in-gov";

const COURT_KEYS = [
  "cnr",
  "court",
  "case_type",
  "case_year",
  "filing_number",
  "fir_number",
  "police_station",
  "statutes_invoked",
  "petitioner",
  "respondent",
  "advocate",
  "document_type",
] as const;

const COMPANY_KEYS = [
  "company_name",
  "cin",
  "registration_number",
  "registered_address",
  "gstin",
  "date_of_incorporation",
  "state",
  "department",
] as const;

const IDENTITY_KEYS = [
  "full_name",
  "pan",
  "aadhaar_last4",
  "address",
  "dob",
  "document_number",
] as const;

const GOV_KEYS = [
  "govt_order_number",
  "department",
  "notification_date",
  "subject",
  "rti_subject",
] as const;

export function partialRecoverySchemaId(
  domainPackId: string,
  docTypeCodes: string[],
): PartialRecoverySchemaId {
  if (docTypeCodes.some(isIdentityDocType) || domainPackId === "legal-in-identity") {
    return "legal-in-identity";
  }
  if (docTypeCodes.some(isCivilCompanyDocType)) return "legal-in-civil-company";
  if (domainPackId === "legal-in-gov") return "legal-in-gov";
  if (domainPackId === "legal-in-civil") return "legal-in-civil-company";
  return "legal-in-court";
}

export function allowedPartialRecoveryKeys(schemaId: PartialRecoverySchemaId): readonly string[] {
  switch (schemaId) {
    case "legal-in-civil-company":
      return COMPANY_KEYS;
    case "legal-in-identity":
      return IDENTITY_KEYS;
    case "legal-in-gov":
      return [...GOV_KEYS, ...COURT_KEYS];
    case "legal-in-court":
      return COURT_KEYS;
    default: {
      const _exhaustive: never = schemaId;
      return _exhaustive;
    }
  }
}

/** Map partial-LLM JSON keys → resolution field paths. */
export function partialKeyToFieldPath(key: string, schemaId: PartialRecoverySchemaId): string {
  if (schemaId === "legal-in-identity") {
    const map: Record<string, string> = {
      full_name: "user.fullName",
      pan: "ids.pan",
      aadhaar_last4: "ids.aadhaar",
      address: "user.address",
      dob: "user.dob",
      document_number: "ids.passport",
    };
    return map[key] ?? key;
  }
  if (schemaId === "legal-in-civil-company") {
    const map: Record<string, string> = {
      company_name: "company.name",
      cin: "ids.cin",
      registration_number: "registration.number",
      registered_address: "registered.address",
      gstin: "ids.gstin",
      date_of_incorporation: "dates.incorporation",
      state: "govt.state",
      department: "govt.department",
    };
    return map[key] ?? key;
  }
  const courtMap: Record<string, string> = {
    cnr: "cnr",
    court: "court.raw",
    case_type: "caseType",
    case_year: "caseNumber.year",
    filing_number: "caseNumber.number",
    fir_number: "fir.number",
    police_station: "fir.policeStation",
    statutes_invoked: "sections[0].statute",
    petitioner: "parties[0].name",
    respondent: "parties[1].name",
    advocate: "advocates[0].name",
    document_type: "documentType",
  };
  return courtMap[key] ?? key;
}

export function resolveDomainPack(domainPackId?: string): DomainPack {
  return loadDomainPack(domainPackId ?? "legal-in");
}
