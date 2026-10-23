/**
 * Map NSP product ingest roles → domain pack id (single parse ladder).
 */
export type NspDocparseIngestRole =
  | "onboarding_kyc"
  | "company_kyc"
  | "case_intake"
  | "case_evidence"
  | "chat_attachment"
  | "draft_attachment";

export function domainPackIdForIngestRole(role?: string): string {
  switch (role) {
    case "onboarding_kyc":
      return "legal-in-identity";
    case "case_evidence":
    case "chat_attachment":
    case "draft_attachment":
      return "legal-in-evidence";
    case "company_kyc":
    case "case_intake":
      return "legal-in-civil";
    default:
      return "legal-in-civil";
  }
}
