/** Mirror of @nyayavigya/client-sdk CnrApi types — NYS dashboard same-origin only. */

export interface CnrResolveOptions {
  includeDocuments?: boolean;
  includeExtractPreview?: boolean;
  profile?: "default" | "caseCreate";
  fuzzyLimit?: number;
  jurisdiction?: string;
  courtType?: "sc" | "hc" | "dc";
  /** Tier-4 live eCourts fallback (opt-in). */
  live?: boolean;
  includeParseGuide?: boolean;
  includeTimeline?: boolean;
}

export interface CnrFieldValue {
  value: unknown;
  source: string | null;
  confidence: number;
  note?: string;
}

export interface CnrDocument {
  id: string;
  kind: string;
  title: string;
  decisionDate?: string | null;
  s3Path?: string | null;
  pdfUrlKind?: string;
  sourceArchive?: string;
  url?: string | null;
  expiresIn?: number;
}

export interface CnrCandidate {
  cnr: string | null;
  title: string;
  courtName: string | null;
  decisionDate: string | null;
  confidence: number;
  source: string;
}

export interface CnrTimelineEntry {
  date: string | null;
  purpose: string | null;
  judge: string | null;
  status: string | null;
  source: string;
  confidence: number;
}

export interface CnrPartyEntry {
  partyType: "Individual" | "Organisation";
  name: string | null;
  fatherName: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  advocate: string | null;
  source: string;
  confidence: number;
}

export interface CnrWitnessEntry {
  partyType: "Individual" | "Organisation";
  name: string | null;
  address: string | null;
  advocate: string | null;
  source: string;
  confidence: number;
}

export interface CnrFieldManifest {
  complete: string[];
  partial: string[];
  missing: string[];
  manualRecommended: string[];
  corpusUnavailable?: string[];
  manualRequired?: string[];
}

export interface CnrCaseCreateProfile {
  header: {
    caseTitle: CnrFieldValue;
    cnr: CnrFieldValue;
    filingDate: CnrFieldValue;
    nextHearingDate: CnrFieldValue;
    caseStatus: CnrFieldValue;
    policeStation: CnrFieldValue;
  };
  timeline: CnrTimelineEntry[];
  summary: CnrFieldValue;
  clients: CnrPartyEntry[];
  opposingParties: CnrPartyEntry[];
  witnesses: CnrWitnessEntry[];
  fieldManifest: CnrFieldManifest;
}

export interface CnrResolveData {
  cnr: string;
  diaryNumber?: string | null;
  lookupType?: "cnr" | "diary";
  status: "found" | "suggested" | "not_found" | "invalid";
  matchType: string;
  source: string | null;
  sourcesTried: string[];
  confidence: number;
  claimEcourts: boolean;
  validation?: string;
  ui: { badge: string; subtitle: string };
  fields: Record<string, CnrFieldValue> | null;
  caseCreate?: CnrCaseCreateProfile;
  documents: CnrDocument[];
  candidates: CnrCandidate[];
  nspParseGuide?: Record<string, unknown>;
  meta?: {
    attribution?: string;
    latencyMs?: number;
    fieldAvailability?: Record<string, string>;
    tier?: string | null;
    provenance?: Record<string, unknown>;
  };
}

export interface CnrResolveResponse {
  success: boolean;
  claimEcourts?: false;
  source?: string;
  data?: CnrResolveData;
  error?: { code: string; message: string; retryable?: boolean };
}

export const DASHBOARD_CNR_PROFILE = "caseCreate" as const;
export const DASHBOARD_LOOKUP_PROFILE = "default" as const;

/** Fast RDS lookup for Case Lookup landing search (~50ms not_found). */
export const DASHBOARD_LOOKUP_OPTIONS: CnrResolveOptions = {
  profile: DASHBOARD_LOOKUP_PROFILE,
  includeDocuments: true,
  includeExtractPreview: false,
};

/** Deep Athena + FTS cascade — opt-in after fast not_found (~7–45s). */
export const DASHBOARD_DEEP_OPTIONS: CnrResolveOptions = {
  profile: DASHBOARD_CNR_PROFILE,
  includeDocuments: true,
  includeExtractPreview: false,
};

/** @deprecated Prefer DASHBOARD_LOOKUP_OPTIONS or DASHBOARD_DEEP_OPTIONS explicitly. */
export const DASHBOARD_RESOLVE_OPTIONS: CnrResolveOptions = DASHBOARD_DEEP_OPTIONS;
