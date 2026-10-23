/**
 * CnrApi — Corpus CNR resolve for NSP autofill.
 * Canonical path: /api/jrx/v1/sdk/cnr/*
 * claimEcourts is always false (judgment corpus / Open Data only).
 */
import type { JrxHttpClient } from '../JrxClient.js';

export interface CnrResolveOptions {
  includeDocuments?: boolean;
  includeExtractPreview?: boolean;
  /** Explicit nysapi court tier hint — required for B9 duplicate CNRs (e.g. DLCT…). */
  courtType?: 'sc' | 'hc' | 'dc';
  /** When true, fetch `/timeline` even when inline hearings exist (P0-C). */
  includeTimeline?: boolean;
  profile?: "default" | "caseCreate";
  fuzzyLimit?: number;
  jurisdiction?: string;
  /** When true, attach `data.nspParseGuide` (machine-readable parse contract, §21). */
  includeParseGuide?: boolean;
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
  /** Presigned PDF URL from nysapi timeline event (900s TTL). */
  docUrl?: string | null;
  source: string;
  confidence: number;
}

/** Advocate on record — side when known from corpus row. */
export interface CnrAdvocateEntry {
  name: string;
  side: 'petitioner' | 'respondent' | null;
}

/**
 * Linked / connected / clubbed matter (Group 12).
 * Mapped from the upstream `linked_cases` / `linked` / `connected_cases` corpus
 * columns (NYS `cnr_case_details.linked_cases` JSONB). Every field is nullable —
 * corpus rows publish an inconsistent subset. `relation` is a free-text label
 * from the source (e.g. "connected", "clubbed", "analogous", "earlier court").
 */
export interface CnrLinkedMatter {
  cnr: string | null;
  caseNumber: string | null;
  title: string | null;
  relation: string | null;
  court: string | null;
  source: string;
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
  /** Corpus tiers never populate these slots (beta honesty — NV-CASE-CORPUS-BETA-001). */
  corpusUnavailable?: string[];
  /** Partner must capture manually or via EDJ / Matter Vault (beta). */
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

export interface CnrExtractPreview {
  s3Path: string;
  textLength: number;
  truncated: boolean;
  ocrUsed: boolean;
  policeStation: string | null;
  source: "nyv_extract";
}

export interface CnrResolveMeta {
  attribution?: string;
  latencyMs?: number;
  tier?: string | null;
  source?: string;
  /** Full nysapi per-field availability map (P0-A). */
  fieldAvailability?: Record<string, string>;
  /** Indexed counts from nysapi row (P0-A). */
  counts?: { hearings?: number; acts?: number };
  /** nysapi provenance subset (P0-A / P1 max resolve). */
  provenance?: {
    backend?: string | null;
    elapsedMs?: number | null;
    sourceSyncedAt?: string | null;
    /** RDS/DuckDB watermark from nysapi `/health` when available. */
    tableVersion?: string | null;
  };
  /** Sanitized unmapped source fields — scalar values only (P0-A). */
  extra?: Record<string, string | number | boolean | null>;
  inferredCourtType?: string;
  identifierKind?: string;
  /** Beta partner expectations for judgment corpus vs Tier-3 live fields (NV-CASE-CORPUS-BETA-001). */
  betaReadiness?: {
    corpusTier: 'judgment_index';
    tier3RequiredFields: string[];
    manualCaptureFields: string[];
    /** EDJ job API for document-driven capture (witnesses, PII). */
    edjJobPath?: string;
  };
}

/**
 * Well-known keys on `CnrResolveData.fields` (additive; not exhaustive).
 * - `summary` — judgment/corpus summary text (`CnrFieldValue` string).
 * - `registrationDate` — ISO date distinct from `filingDate` when both published.
 * - `partyDetails` — `CnrPartyEntry[]` with address/phone/email/fatherName when corpus has PII.
 */
export type CnrResolveFieldKey =
  | 'summary'
  | 'registrationDate'
  | 'registrationNumber'
  | 'registrationYear'
  | 'partyDetails'
  | 'petitioners'
  | 'respondents'
  | 'hearings'
  | 'actsSections'
  | 'benchComposition'
  | 'judicialSection'
  | 'coram'
  | 'hcCategoryDetails'
  | 'lowerCourtReference'
  | 'finalOrders'
  | 'interimOrders'
  | 'iaFilings'
  | 'registryObjections'
  | 'caseCategory'
  | 'interlocutoryApplications'
  | 'registryDefects'
  | 'earlierCourtDetails'
  // Gap-closure 2026-09-25 (NV-CASE-CORPUS-FIELD-GAP-CLOSURE-001):
  | 'linkedMatters'
  | 'incidentDate'
  | 'caseTypeDisplay'
  | 'courtCode'
  | 'complexCode';

/**
 * NSP resolve parse contract entry (machine-readable) — §21 of
 * NSP-CASE-SEARCH-INTEGRATION. One entry per resolve field key telling NSP
 * exactly how to parse the value, its nested shape, and — critically — WHY it
 * is absent when empty (`absentWhen`).
 */
export interface NspParseContractEntry {
  /** JSON path from the resolve envelope root, e.g. `data.fields.caseTitle.value`. */
  path: string;
  /** Primitive/collection type of `.value`. */
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'date'
    | 'string[]'
    | 'object'
    | 'object[]';
  /** `one` = scalar; `many` = array; `nested` = single object. */
  cardinality: 'one' | 'many' | 'nested';
  /** Shape of each element/object when `type` is object/object[]. */
  nestedSchema?: Record<string, string>;
  /** Population reality per court tier (see §11.1). */
  availabilityTier: string;
  /** Short instruction on how to read/render the value. */
  parseHint: string;
  /** Why `.value` may be empty even though the key is always present. */
  absentWhen: Array<
    | 'null'
    | 'not_in_corpus'
    | 'not_applicable'
    | 'tier_mobile_depth_only'
    | 'tier3_required'
    | 'manual_required'
    | 'search_surface_only'
  >;
}

export interface CnrResolveData {
  cnr: string;
  /** Diary vs CNR lookup path (unified cascade). */
  lookupType?: 'cnr' | 'diary' | string;
  diaryNumber?: string;
  status: 'found' | 'suggested' | 'not_found' | 'invalid';
  matchType: string;
  source: string | null;
  sourcesTried: string[];
  confidence: number;
  claimEcourts: false;
  validation?: string;
  ui: { badge: string; subtitle: string };
  fields: Record<string, CnrFieldValue> | null;
  caseCreate?: CnrCaseCreateProfile;
  extractPreview?: CnrExtractPreview | null;
  documents: CnrDocument[];
  candidates: CnrCandidate[];
  /** True when nysapi marks CNR as synthetic (SC judgment corpus). */
  cnrSynthetic?: boolean;
  /**
   * Machine-readable parse contract for `data.fields.*` (NSP-RESOLVE-PARSE-CONTRACT).
   * Present only when `options.includeParseGuide: true` (keeps default envelopes
   * lean). Keyed by resolve field key → {@link NspParseContractEntry}. Static
   * JSON export: `documents/working/NSP-RESOLVE-PARSE-CONTRACT.json`.
   */
  nspParseGuide?: Record<string, NspParseContractEntry>;
  meta?: CnrResolveMeta;
}

export interface CnrResolveResponse {
  success: boolean;
  claimEcourts?: false;
  source?: string;
  data?: CnrResolveData;
  error?: { code: string; message: string };
}

/** nysapi case-api search filters — forwarded by GET /sdk/cnr/search (P1-A). */
export interface CnrSearchQuery {
  court_type?: 'SC' | 'HC' | 'DC';
  /** Alias for court_type — normalized server-side. */
  courtType?: 'sc' | 'hc' | 'dc';
  party_name?: string;
  diary_no?: string;
  /** Exact CNR lookup within court tier (nysapi `cnr` query param). */
  cnr?: string;
  cnrNumber?: string;
  filing_number?: string;
  filing_number_year?: string | number;
  /** Mapped upstream to nysapi `fir_number`. */
  fir_no?: string;
  fir_number?: string;
  act?: string;
  case_number?: string;
  case_title?: string;
  case_type?: string;
  advocate_name?: string;
  court_complex?: string;
  court_establishment?: string;
  police_station?: string;
  /** Corpus decision/filing year filter (nysapi native; replaces date-range params). */
  year?: string | number;
  /** Legacy — mapped to `year` when value starts with YYYY. */
  decision_date_from?: string;
  decision_date_to?: string;
  filing_date_from?: string;
  filing_date_to?: string;
  page?: number;
  page_size?: number;
  want_total?: boolean;
}

export interface CnrSearchResponse {
  success: boolean;
  claimEcourts?: false;
  source?: string;
  data?: {
    cases?: unknown[];
    returned?: number;
    page?: number;
    page_size?: number;
    total?: number | null;
    meta?: { source?: string; latencyMs?: number };
  };
  error?: { code: string; message: string };
}

/** P3 document bundle — judgment + timeline orders in one response. */
export interface CnrDocumentBundle {
  cnr: string;
  claimEcourts: false;
  judgment: CnrDocument | null;
  orders: CnrDocument[];
  documents: CnrDocument[];
  extractPreview: null;
  meta: {
    refreshedAt: string;
    source: string;
    latencyMs?: number;
    includeTimelineOrders: boolean;
    claimEcourts: false;
  };
}

export interface CnrDocumentBundleResponse {
  success: boolean;
  claimEcourts?: false;
  source?: string;
  data?: CnrDocumentBundle;
  error?: { code: string; message: string };
}

export class CnrApi {
  constructor(private readonly http: JrxHttpClient) {}

  health(): Promise<{ success: boolean; data: unknown }> {
    return this.http.get('/api/jrx/v1/sdk/cnr/health');
  }

  resolve(input: {
    cnr?: string;
    cnrNumber?: string;
    /** SC diary or compact form — runtime supported on same POST body. */
    diaryNumber?: string;
    /** DC filing reference — search-then-resolve when CNR unknown (P1-B). */
    filingNumber?: string;
    filingYear?: string | number;
    /** Unified identifier — diary, CNR, or filing ref shape. */
    identifier?: string;
    options?: CnrResolveOptions;
  }): Promise<CnrResolveResponse> {
    return this.http.post('/api/jrx/v1/sdk/cnr/resolve', input);
  }

  /** Matter discovery — party, FIR, filing ref, diary (SC), date filters. */
  search(query: CnrSearchQuery): Promise<CnrSearchResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      params.set(key, String(value));
    }
    const qs = params.toString();
    return this.http.get(`/api/jrx/v1/sdk/cnr/search${qs ? `?${qs}` : ''}`);
  }

  get(cnr: string): Promise<CnrResolveResponse> {
    return this.http.get(`/api/jrx/v1/sdk/cnr/${encodeURIComponent(cnr)}`);
  }

  listDocuments(cnr: string): Promise<{
    success: boolean;
    data?: { cnr: string; claimEcourts: false; documents: CnrDocument[] };
  }> {
    return this.http.get(
      `/api/jrx/v1/sdk/cnr/${encodeURIComponent(cnr)}/documents`,
    );
  }

  /** Multi-PDF bundle — judgment + timeline orders (P3). */
  documentBundle(
    cnr: string,
    query?: { includeTimelineOrders?: boolean; refresh?: boolean; courtType?: string },
  ): Promise<CnrDocumentBundleResponse> {
    const params = new URLSearchParams();
    if (query?.includeTimelineOrders === false) params.set('includeTimelineOrders', 'false');
    if (query?.refresh === false) params.set('refresh', 'false');
    if (query?.courtType) params.set('courtType', query.courtType);
    const qs = params.toString();
    return this.http.get(
      `/api/jrx/v1/sdk/cnr/${encodeURIComponent(cnr)}/document-bundle${qs ? `?${qs}` : ''}`,
    );
  }

  enrich(input: {
    cnr: string;
    petitioner?: string;
    respondent?: string;
    caseType?: string;
    caseNo?: string;
    courtCode?: string;
    filingDate?: string;
    decisionDate?: string;
    caseStatus?: string;
  }): Promise<{ success: boolean; data?: unknown }> {
    return this.http.post('/api/jrx/v1/sdk/cnr/enrich', input);
  }
}
