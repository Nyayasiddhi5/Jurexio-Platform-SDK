/**
 * NV-CASE-API-001 — JRX-Search case-api adapter for NSP CNR resolve.
 * Maps GET https://nysapi.jurexio.example/v1/cases/{cnr} → NSP CnrResolveData.
 * Never claims live eCourts (claimEcourts: false).
 */
import { createLogger } from '../utils/logger.js';
import {
  inferCourtTypeFromIdentifier,
  inferenceToCaseApiCourtLevel,
} from '../utils/jrx-cnr-court-type-inference.js';
import {
  isNysKnowledgeConfigured,
  nysKnowledgeRequest,
} from './jrx-nys-knowledge-client.js';
import { applyJurisdictionPrefill } from './jrx-jurisdiction-prefill.js';
import { applyHcOrderPresignFromDb } from './jrx-hc-order-s3-map-loader.js';
import {
  decodeDcCaseStatus,
  isNumericDcStatus,
  DC_STATUS_DECODE_PENDING_NOTE,
} from './jrx-dc-status-codes.js';
import { buildNspParseGuide } from './jrx-nsp-parse-contract.js';
import type {
  CnrAdvocateEntry,
  CnrCandidate,
  CnrCaseCreateProfile,
  CnrDocument,
  CnrFieldManifest,
  CnrFieldValue,
  CnrLinkedMatter,
  CnrPartyEntry,
  CnrResolveData,
  CnrResolveMeta,
  CnrTimelineEntry,
} from '../../packages/client-sdk/src/api/CnrApi.js';

const logger = createLogger('./jrx-case-api-adapter');

const ATTRIBUTION =
  'Judgment metadata © contributors / AWS Open Data (vanga indian-*-court-judgments), CC-BY-4.0. Not live eCourts status.';

/** Presigned S3 PDF TTL — judgment inline docs + timeline order docs (NV-CNR-DOC-TTL-001). */
const PRESIGNED_DOC_TTL_SECONDS = 900;

export type CaseApiCourtLevel = 'HC' | 'SC' | 'DC';

export interface CaseApiHearing {
  date?: string | null;
  /** nysapi RDS/hearing parquet primary date (NV-CNR-HEARING-DATE-001). */
  hearing_date?: string | null;
  business_date?: string | null;
  purpose?: string | null;
  next_date?: string | null;
  judge?: string | null;
  status?: string | null;
}

export interface CaseApiDocument {
  doc_bucket?: string | null;
  doc_key?: string | null;
  url?: string | null;
}

export interface CaseApiCase {
  cnr?: string | null;
  cnr_is_synthetic?: boolean;
  diary_no?: string | null;
  court_level?: CaseApiCourtLevel | string | null;
  jurisdiction?: string | null;
  case_title?: string | null;
  case_number?: string | null;
  case_type?: string | null;
  case_number_display?: string | null;
  court?: string | null;
  state_name?: string | null;
  district_name?: string | null;
  bench?: string | null;
  petitioner?: string | null;
  respondent?: string | null;
  petitioner_advocate?: string | null;
  respondent_advocate?: string | null;
  filing_date?: string | null;
  registration_date?: string | null;
  decision_date?: string | null;
  next_date?: string | null;
  /** nysapi RDS/HC docket next-listing date (NV-CNR-NEXTDATE-KEY-001); `next_date` kept as fallback. */
  next_hearing_date?: string | null;
  case_status?: string | null;
  disposal_nature?: string | null;
  current_judge?: string | null;
  current_purpose?: string | null;
  first_hearing_date?: string | null;
  fir_no?: string | null;
  fir_year?: string | null;
  police_station?: string | null;
  citation?: string | null;
  neutral_citation?: string | null;
  filing_number?: string | null;
  filing_number_year?: string | number | null;
  complex_name?: string | null;
  court_establishment?: string | null;
  petitioners?: string[] | string | null;
  respondents?: string[] | string | null;
  /** Public court record — passthrough when corpus publishes (NV-CNR-PARTY-PII-001). */
  petitioner_address?: string | null;
  respondent_address?: string | null;
  petitioner_phone?: string | null;
  respondent_phone?: string | null;
  petitioner_email?: string | null;
  respondent_email?: string | null;
  petitioner_father_name?: string | null;
  respondent_father_name?: string | null;
  judges?: string[] | string | null;
  hearings?: CaseApiHearing[] | null;
  summary?: string | null;
  document?: CaseApiDocument | null;
  field_availability?: Record<string, string> | null;
  provenance?: {
    backend?: string | null;
    elapsed_ms?: number | null;
    source_synced_at?: string | null;
    table_version?: string | null;
  } | null;
  counts?: { hearings?: number; acts?: number } | null;
  acts?: unknown;
  /** RDS mirror column — hydrated on nysapi read when DuckDB/RDS has acts_json. */
  acts_json?: unknown;
  acts_sections?: unknown;
  sections?: unknown;
  extra?: { acts?: unknown } | Record<string, unknown> | null;
  /** HC/SC docket richness — passthrough when nysapi hydrates (NV-CNR-RICH-FIELDS-001). */
  bench_composition?: unknown;
  judicial_section?: string | null;
  coram?: string | null;
  registration_number?: string | null;
  registration_year?: string | number | null;
  hc_category_details?: unknown;
  lower_court_reference?: unknown;
  final_orders?: unknown;
  interim_orders?: unknown;
  ia_filings?: unknown;
  registry_objections?: unknown;
  case_category?: string | null;
  interlocutory_applications?: unknown;
  registry_defects?: unknown;
  earlier_court_details?: unknown;
  /** Linked / connected / clubbed matters (Group 12 — NYS `cnr_case_details.linked_cases`). */
  linked_cases?: unknown;
  linked?: unknown;
  connected_cases?: unknown;
  /** FIR incident/occurrence date candidates (Group 11 — none published today). */
  date_of_incident?: string | null;
  incident_date?: string | null;
  fir_date?: string | null;
  occurrence_date?: string | null;
  fir_registration_date?: string | null;
  /** eCourts numeric court/complex codes (DC establishment crosswalk targets). */
  court_code?: string | null;
  complex_code?: string | null;
}

export interface CaseApiTimelineEvent {
  date?: string | null;
  event_date?: string | null;
  purpose?: string | null;
  judge?: string | null;
  status?: string | null;
  hearing_date?: string | null;
  next_date?: string | null;
  purpose_name?: string | null;
  event_type?: string | null;
  description?: string | null;
  doc_url?: string | null;
}

export interface CaseApiTimelineResponse {
  events?: CaseApiTimelineEvent[] | null;
  error?: string;
  detail?: string;
}

export type CaseApiTimelineResult =
  | { ok: true; events: CaseApiTimelineEvent[]; latencyMs: number }
  | { ok: false; status: number; error: string; latencyMs: number };

export interface CaseApiLookupResponse {
  case?: CaseApiCase;
  error?: string;
  detail?: string;
}

export type CaseApiFetchResult =
  | { ok: true; status: 200; case: CaseApiCase; latencyMs: number }
  | { ok: false; status: number; error: string; latencyMs: number };

export interface CaseApiSearchResponse {
  cases?: CaseApiCase[];
  returned?: number;
  page?: number;
  page_size?: number;
  total?: number | null;
  error?: string;
  detail?: string;
}

export type CaseApiSearchResult =
  | { ok: true; status: 200; body: CaseApiSearchResponse; latencyMs: number }
  | { ok: false; status: number; error: string; latencyMs: number };

export type CaseApiCnrLookupResult =
  | { kind: 'resolved'; data: CnrResolveData }
  | { kind: 'fallback'; status: number; error: string }
  | { kind: 'upstream_error'; status: number; error: string };

/** Partner diary resolve envelope (extends CnrResolveData at runtime). */
export type CaseApiDiaryResolveData = CnrResolveData & {
  lookupType: 'diary';
  diaryNumber: string;
};

function envFlagOn(name: string): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Feature flag: JRX_F_CASE_API_CNR=1 or alias JRX_ECOSYSTEM_CASE_API_ENABLED=1 */
export function isCaseApiCnrEnabled(): boolean {
  return envFlagOn('JRX_F_CASE_API_CNR') || envFlagOn('JRX_ECOSYSTEM_CASE_API_ENABLED');
}

/** Shadow: call case-api for diff logging but return legacy response. */
export function isCaseApiCnrShadowMode(): boolean {
  return envFlagOn('JRX_F_CASE_API_CNR_SHADOW');
}

/** P2a — merge legacy cnr_case_details when case-api row is sparse. */
export function isCaseApiLegacyEnrichEnabled(): boolean {
  return envFlagOn('JRX_F_CASE_API_LEGACY_ENRICH');
}

export function caseApiBaseUrl(): string {
  const raw = (process.env.JRX_ECOSYSTEM_CASE_API_BASE_URL ?? 'https://nysapi.jurexio.example')
    .trim()
    .replace(/\/$/, '');
  return raw;
}

export function caseApiKeyConfigured(): boolean {
  return (process.env.JRX_ECOSYSTEM_CASE_API_KEY ?? '').trim().length > 8;
}

export function isCaseApiConfigured(): boolean {
  return caseApiBaseUrl().length > 0 && caseApiKeyConfigured();
}

function caseApiTimeoutMs(): number {
  const n = Number(process.env.JRX_ECOSYSTEM_CASE_API_TIMEOUT_MS ?? '30000');
  return Number.isFinite(n) && n >= 3000 ? n : 30_000;
}

function caseApiTimelineTimeoutMs(): number {
  const n = Number(process.env.JRX_ECOSYSTEM_CASE_API_TIMELINE_TIMEOUT_MS ?? '3000');
  return Number.isFinite(n) && n >= 1000 ? Math.min(n, 10_000) : 3_000;
}

function legacyEnrichTimeoutMs(): number {
  const n = Number(process.env.JRX_ECOSYSTEM_CASE_API_LEGACY_ENRICH_TIMEOUT_MS ?? '8000');
  return Number.isFinite(n) && n >= 2000 ? Math.min(n, 20_000) : 8_000;
}

function fv(
  value: unknown,
  source: string | null,
  confidence: number,
  note?: string,
): CnrFieldValue {
  return { value, source, confidence, ...(note ? { note } : {}) };
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 && s.toLowerCase() !== 'null' ? s : null;
}

function dateOnly(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  const d = dmy ? new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}`) : new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function courtLevelToArchive(level: string | null | undefined): 'hc' | 'dc' | 'sc' | 'unknown' {
  const u = (level ?? '').toUpperCase();
  if (u === 'HC') return 'hc';
  if (u === 'DC') return 'dc';
  if (u === 'SC') return 'sc';
  return 'unknown';
}

function courtLevelToType(level: string | null | undefined): string | null {
  const arch = courtLevelToArchive(level);
  return arch === 'unknown' ? null : arch;
}

function inferCourtTypeFromCnr(cnr: string): CaseApiCourtLevel | undefined {
  return inferenceToCaseApiCourtLevel(inferCourtTypeFromIdentifier(cnr));
}

/** Map partner courtType hint (sc|hc|dc) → nysapi court_type. */
export function parseCaseApiCourtType(
  raw: string | null | undefined,
): CaseApiCourtLevel | undefined {
  const u = (raw ?? '').trim().toLowerCase();
  if (u === 'sc') return 'SC';
  if (u === 'hc') return 'HC';
  if (u === 'dc') return 'DC';
  return undefined;
}

export function extractDiaryNumber(body: Record<string, unknown>): string | null {
  const raw =
    (typeof body.diaryNumber === 'string' ? body.diaryNumber : null) ??
    (typeof body.diary === 'string' ? body.diary : null);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

/** DC filing-ref search keys — search-then-resolve on POST /sdk/cnr/resolve (P1-B). */
export function extractFilingRef(
  body: Record<string, unknown>,
): { filingNumber: string; filingYear: string } | null {
  const filingNumber =
    (typeof body.filingNumber === 'string' ? body.filingNumber.trim() : null) ??
    (typeof body.filing_number === 'string' ? body.filing_number.trim() : null);
  if (!filingNumber) return null;

  const rawYear = body.filingYear ?? body.filing_number_year;
  if (rawYear === null || rawYear === undefined) return null;
  const filingYear = String(rawYear).trim();
  return filingYear ? { filingNumber, filingYear } : null;
}

/**
 * JRX-CNR-SEARCH-FILTERS-001 — nysapi GET /v1/cases query surface forwarded by JRX.
 * Undefined keys are omitted so unfiltered calls stay byte-identical.
 */
/** nysapi GET /v1/cases accepted query keys (caselaw-worker case-api, 2026-09-23). */
export const CASE_API_SEARCH_FORWARD_PARAMS = [
  'court_type',
  'party_name',
  'diary_no',
  'cnr',
  'filing_number',
  'filing_number_year',
  'fir_number',
  'act',
  'case_number',
  'case_title',
  'case_type',
  'advocate_name',
  'court_complex',
  'court_establishment',
  'police_station',
  'year',
  'page',
  'page_size',
  'want_total',
] as const;

export type CaseApiSearchForwardParam = (typeof CASE_API_SEARCH_FORWARD_PARAMS)[number];

const CASE_API_SEARCH_QUERY_ALIASES: ReadonlyArray<{
  from: string;
  to: CaseApiSearchForwardParam;
}> = [
  { from: 'fir_no', to: 'fir_number' },
  { from: 'cnrNumber', to: 'cnr' },
];

function pickQueryScalar(
  query: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const raw = query[key];
  if (raw === undefined) return undefined;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === undefined || v === '') return undefined;
  return String(v).trim();
}

/** Map legacy date-range filters to nysapi `year` when only a year is inferable. */
function inferSearchYearFromLegacyDates(
  query: Record<string, string | string[] | undefined>,
): string | undefined {
  for (const key of [
    'year',
    'decision_date_from',
    'decision_date_to',
    'filing_date_from',
    'filing_date_to',
  ]) {
    const v = pickQueryScalar(query, key);
    if (!v) continue;
    const match = v.match(/^(\d{4})/);
    if (match) return match[1];
  }
  return undefined;
}

export function buildCaseApiSearchForwardQuery(
  query: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const forward: Record<string, string | undefined> = {};

  for (const { from, to } of CASE_API_SEARCH_QUERY_ALIASES) {
    if (forward[to]) continue;
    const v = pickQueryScalar(query, from);
    if (v) forward[to] = v;
  }

  for (const key of CASE_API_SEARCH_FORWARD_PARAMS) {
    if (forward[key]) continue;
    const v = pickQueryScalar(query, key);
    if (v) forward[key] = v;
  }

  if (!forward.court_type) {
    const raw = pickQueryScalar(query, 'courtType') ?? pickQueryScalar(query, 'court_type');
    if (raw) forward.court_type = raw.toUpperCase();
  }

  if (forward.cnr) {
    forward.cnr = normalizeCnrInput(forward.cnr);
  }

  if (!forward.year) {
    const year = inferSearchYearFromLegacyDates(query);
    if (year) forward.year = year;
  }

  return forward;
}

/**
 * NV-DIARY-COMPACT-NORM-001 — SC compact diary `NNNNNYYYY` / `NNNNYYYY` → `NNNNN/YYYY`.
 * nysapi indexes slash form in `diary_no`; NSP often sends digits-only from UI.
 */
export function normalizeDiaryNumber(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes('/')) return trimmed;

  const digits = trimmed.replace(/\s/g, '');
  if (!/^\d{6,12}$/.test(digits)) return trimmed;

  const year = Number.parseInt(digits.slice(-4), 10);
  if (!Number.isFinite(year) || year < 1950 || year > 2100) return trimmed;

  const numRaw = digits.slice(0, -4);
  const num = numRaw.replace(/^0+/, '') || numRaw;
  if (num.length < 1 || num.length > 7) return trimmed;

  return `${num}/${year}`;
}

function resolveSourceTag(caseRow: CaseApiCase): string {
  const backend = caseRow.provenance?.backend ?? 'case_api';
  return `nys_case_api_${backend}`;
}

/** Normalize CNR from body or URL param (uppercase, strip separators). */
export function normalizeCnrInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s\-_.]/g, '');
}

export type CaseApiCnrExtract = {
  cnr: string;
  sourceField: string;
  confidence: number;
  synthetic?: boolean;
  note?: string;
};

/** True when normalized token plausibly matches Indian CNR (10–20 alnum). */
export function looksLikeIndianCnr(raw: string): boolean {
  const n = normalizeCnrInput(raw);
  if (!/^[A-Z0-9]{10,20}$/.test(n)) return false;
  if (n.length === 16) return true;
  if (n.startsWith('ESCR') && n.length >= 14) return true;
  if (n.length >= 12 && n.slice(4, 6) === 'HC') return true;
  if (n.length >= 12 && /^[A-Z]{4}\d/.test(n)) return true;
  return n.length >= 10 && n.length <= 20;
}

function extractCnrCandidate(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  const n = normalizeCnrInput(s);
  return looksLikeIndianCnr(n) ? n : null;
}

type CaseApiCaseExtras = CaseApiCase & Record<string, unknown>;

/**
 * NV-CNR-BACKFILL-001 — resolve CNR from case-api row when primary `cnr` is empty.
 * Checks snake_case alternates and identifier fields before giving up.
 */
export function extractCnrFromCaseRow(
  row: CaseApiCase,
  inputCnr?: string | null,
): CaseApiCnrExtract {
  const primary = extractCnrCandidate(row.cnr);
  if (primary) {
    return {
      cnr: primary,
      sourceField: 'cnr',
      confidence: row.cnr_is_synthetic ? 0.85 : 0.97,
      synthetic: row.cnr_is_synthetic ?? false,
    };
  }

  const extras = row as CaseApiCaseExtras;
  for (const [field, confidence, note] of [
    ['cnr_number', 0.95, 'backfilled from cnr_number'],
    ['cnr_no', 0.93, 'backfilled from cnr_no'],
  ] as const) {
    const alt = extractCnrCandidate(extras[field]);
    if (alt) {
      return { cnr: alt, sourceField: field, confidence, note };
    }
  }

  for (const field of ['case_number', 'case_number_display'] as const) {
    const alt = extractCnrCandidate(row[field]);
    if (alt) {
      return {
        cnr: alt,
        sourceField: field,
        confidence: 0.8,
        note: `backfilled from ${field}`,
      };
    }
  }

  const title = str(row.case_title);
  if (title) {
    const match = /\bCNR[:\s-]*([A-Z0-9\-_.]{10,24})\b/i.exec(title);
    if (match?.[1]) {
      const alt = extractCnrCandidate(match[1]);
      if (alt) {
        return {
          cnr: alt,
          sourceField: 'case_title',
          confidence: 0.75,
          note: 'parsed CNR token from case_title',
        };
      }
    }
  }

  const fromInput = inputCnr ? extractCnrCandidate(inputCnr) : null;
  if (fromInput) {
    return { cnr: fromInput, sourceField: 'input', confidence: 0.97 };
  }

  return { cnr: '', sourceField: 'none', confidence: 0 };
}

function cnrFieldValue(
  extracted: CaseApiCnrExtract,
  source: string,
): CnrFieldValue {
  if (!extracted.cnr) {
    return fv('', null, 0, 'CNR not published for this diary in judgment corpus');
  }
  return fv(
    extracted.cnr,
    source,
    extracted.confidence,
    extracted.note ??
      (extracted.synthetic ? 'synthetic CNR from case-api index' : undefined),
  );
}

function sanitizeExtraForMeta(
  extra: CaseApiCase['extra'],
): Record<string, string | number | boolean | null> | undefined {
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (key === 'acts') continue;
    if (value === null) {
      out[key] = null;
      continue;
    }
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') {
      out[key] = value as string | number | boolean;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const BETA_TIER3_NOTE =
  'Beta: live next hearing / running status requires Tier-3 eCourts (NIC key + explicit GO). Judgment corpus only.';
const BETA_PII_NOTE =
  'Beta: party address/phone/email not populated in RDS/DuckDB mirror — capture manually or via document extract (EDJ).';
const EDJ_JOBS_PATH = '/api/jrx/v1/sdk/ecosystem-documents/jobs';

function buildCaseApiMeta(
  sourceTier: string | null,
  latencyMs: number,
  row?: CaseApiCase,
): CnrResolveMeta {
  const meta: CnrResolveMeta = {
    attribution: ATTRIBUTION,
    latencyMs,
    tier: sourceTier,
    source: 'nys-case-api',
  };

  if (!row) return meta;

  if (row.field_availability && typeof row.field_availability === 'object') {
    meta.fieldAvailability = { ...row.field_availability };
  }
  if (row.counts && typeof row.counts === 'object') {
    meta.counts = {
      ...(typeof row.counts.hearings === 'number' ? { hearings: row.counts.hearings } : {}),
      ...(typeof row.counts.acts === 'number' ? { acts: row.counts.acts } : {}),
    };
  }
  if (row.provenance) {
    meta.provenance = {
      backend: row.provenance.backend ?? null,
      elapsedMs: row.provenance.elapsed_ms ?? null,
      sourceSyncedAt: row.provenance.source_synced_at ?? null,
      ...(row.provenance.table_version
        ? { tableVersion: row.provenance.table_version }
        : {}),
    };
  }
  const extra = sanitizeExtraForMeta(row.extra);
  if (extra) meta.extra = extra;

  return meta;
}

/** B9 duplicate risk — 16-char CNR with CT tier code (e.g. DLCT…). */
export function isB9DuplicateRiskCnr(cnr: string): boolean {
  const n = normalizeCnrInput(cnr);
  return n.length === 16 && n.slice(2, 4) === 'CT';
}

export function caseRowToCandidate(row: CaseApiCase, cnr: string): CnrCandidate {
  const title = buildCaseTitle(row) ?? cnr;
  const courtName =
    str(row.court) ??
    ([str(row.state_name), str(row.district_name)].filter(Boolean).join(' — ') || null);
  const courtType = courtLevelToType(row.court_level);
  return {
    cnr,
    title: courtType ? `${title} (${courtType.toUpperCase()})` : title,
    courtName,
    decisionDate: dateOnly(row.decision_date),
    confidence: 0.9,
    source: resolveSourceTag(row),
  };
}

export function mapCaseApiSuggestedResolve(input: {
  cnr: string;
  rows: Array<{ courtLevel: CaseApiCourtLevel; caseRow: CaseApiCase; latencyMs: number }>;
}): CnrResolveData {
  const latencyMs = Math.max(...input.rows.map((r) => r.latencyMs), 0);
  const candidates = input.rows.map(({ caseRow }) => caseRowToCandidate(caseRow, input.cnr));

  return {
    cnr: input.cnr,
    status: 'suggested',
    matchType: 'ambiguous_court_type',
    source: null,
    sourcesTried: ['nys_case_api'],
    confidence: 0.85,
    claimEcourts: false,
    validation: 'ok',
    ui: {
      badge: 'Ambiguous CNR · pick court tier',
      subtitle:
        'Same CNR exists as both High Court and District Court rows — re-resolve with options.courtType',
    },
    fields: null,
    documents: [],
    candidates,
    meta: buildCaseApiMeta(null, latencyMs),
  };
}

/** Prefer actual hearing date over adjournment `next_date` (NV-CNR-HEARING-DATE-001). */
export function hearingRowDate(h: CaseApiHearing): string | null {
  return (
    dateOnly(h.hearing_date ?? h.business_date ?? h.date ?? h.next_date) ?? null
  );
}

/** Timeline event date — nysapi `/timeline` uses `event_date` on HC/SC rows. */
export function timelineEventDate(e: CaseApiTimelineEvent): string | null {
  return (
    dateOnly(e.event_date ?? e.date ?? e.hearing_date ?? e.next_date) ?? null
  );
}

function parseJsonValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return raw;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return raw;
  }
}

function isEmptyStructuredValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

function structuredCorpusField(
  raw: unknown,
  source: string,
  confidence = 0.8,
): CnrFieldValue {
  const parsed = parseJsonValue(raw);
  if (isEmptyStructuredValue(parsed)) {
    return fv(null, null, 0);
  }
  return fv(parsed, source, confidence);
}

function rowCorpusField(row: CaseApiCase, key: string): unknown {
  const bag = rowObjectBag(row);
  return bag[key];
}

export function hearingsToTimeline(
  hearings: CaseApiHearing[] | null | undefined,
  source: string,
): CnrTimelineEntry[] {
  const rows = hearings ?? [];
  const out: CnrTimelineEntry[] = [];
  for (const h of rows) {
    const date = hearingRowDate(h);
    const purpose = str(h.purpose);
    const judge = str(h.judge);
    const status = str(h.status);
    if (!date && !purpose && !judge && !status) continue;
    out.push({
      date,
      purpose,
      judge,
      status,
      source,
      confidence: date ? 0.85 : 0.65,
    });
  }
  return out;
}

function parseJsonArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Split JSON array, comma/semicolon list, or single string into trimmed names. */
export function parseStringArray(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === 'string' ? item.trim() : str(item)))
      .filter((item): item is string => Boolean(item));
  }
  const single = str(raw);
  if (!single) return [];
  const jsonRows = parseJsonArray(raw);
  if (jsonRows.length > 0) {
    return jsonRows
      .map((item) => (typeof item === 'string' ? item.trim() : str(item)))
      .filter((item): item is string => Boolean(item));
  }
  return single
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function hearingDedupeKey(entry: CnrTimelineEntry): string {
  return `${entry.date ?? ''}|${(entry.purpose ?? '').trim().toLowerCase()}`;
}

export function mergeTimelineEntries(
  base: CnrTimelineEntry[],
  legacy: CnrTimelineEntry[],
): CnrTimelineEntry[] {
  const seen = new Set<string>();
  const out: CnrTimelineEntry[] = [];
  for (const entry of [...base, ...legacy]) {
    const key = hearingDedupeKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function actDedupeKey(row: Record<string, unknown>): string {
  const act = String(row.act ?? '').trim().toLowerCase();
  const section = String(row.section ?? '').trim().toLowerCase();
  return `${act}|${section}`;
}

export function mergeActsSectionRows(
  base: unknown[],
  legacy: unknown[],
): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of [...base, ...legacy]) {
    if (!row || typeof row !== 'object') continue;
    const normalized = row as Record<string, unknown>;
    const key = actDedupeKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

export function mergeStringArrayValues(base: unknown[], legacy: unknown[]): string[] {
  return uniqueStrings([
    ...base.filter((item): item is string => typeof item === 'string'),
    ...legacy.filter((item): item is string => typeof item === 'string'),
  ]);
}

function mergeAdvocateEntries(base: unknown[], legacy: unknown[]): CnrAdvocateEntry[] {
  const seen = new Set<string>();
  const out: CnrAdvocateEntry[] = [];
  for (const row of [...base, ...legacy]) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as CnrAdvocateEntry;
    const name = str(entry.name);
    if (!name) continue;
    const key = `${name.toLowerCase()}|${entry.side ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, side: entry.side ?? null });
  }
  return out;
}

function stringArrayFromField(field: CnrFieldValue | undefined): string[] {
  const value = field?.value;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function advocateEntriesFromField(field: CnrFieldValue | undefined): CnrAdvocateEntry[] {
  const value = field?.value;
  if (!Array.isArray(value)) return [];
  const out: CnrAdvocateEntry[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as CnrAdvocateEntry;
    const name = str(entry.name);
    if (!name) continue;
    out.push({ name, side: entry.side ?? null });
  }
  return out;
}

function partyDetailsFromField(field: CnrFieldValue | undefined): CnrPartyEntry[] {
  const value = field?.value;
  if (!Array.isArray(value)) return [];
  const out: CnrPartyEntry[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as CnrPartyEntry;
    const name = str(entry.name);
    if (!name) continue;
    out.push(entry);
  }
  return out;
}

function scalarFromField(field: CnrFieldValue | undefined): unknown {
  return field?.value ?? null;
}

function isEmptyScalarValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  );
}

function buildAdvocatesFromRow(row: CaseApiCase): CnrAdvocateEntry[] {
  const out: CnrAdvocateEntry[] = [];
  const petAdv = str(row.petitioner_advocate);
  const resAdv = str(row.respondent_advocate);
  if (petAdv) out.push({ name: petAdv, side: 'petitioner' });
  if (resAdv) out.push({ name: resAdv, side: 'respondent' });
  return out;
}

function buildPartyArraysFromRow(row: CaseApiCase): {
  petitioners: string[];
  respondents: string[];
  judges: string[];
} {
  const extras = row as CaseApiCaseExtras;
  const petitioners = uniqueStrings([
    ...parseStringArray(row.petitioners),
    ...parseStringArray(row.petitioner),
    ...parseStringArray(extras.petitioners),
  ]);
  const respondents = uniqueStrings([
    ...parseStringArray(row.respondents),
    ...parseStringArray(row.respondent),
    ...parseStringArray(extras.respondents),
  ]);
  const judges = uniqueStrings([
    ...parseStringArray(row.judges),
    ...parseStringArray(row.current_judge),
    ...parseStringArray(extras.judges),
  ]);
  return { petitioners, respondents, judges };
}

export type PartySide = 'petitioner' | 'respondent';

type PartyPiiField = 'address' | 'phone' | 'email' | 'fatherName';

const PARTY_PII_KEY_ALIASES: Record<PartySide, Record<PartyPiiField, readonly string[]>> = {
  petitioner: {
    address: [
      'petitioner_address',
      'pet_address',
      'petitioner_addr',
      'petitionerAddress',
      'petAddress',
    ],
    phone: ['petitioner_phone', 'pet_phone', 'petitionerPhone', 'petPhone'],
    email: ['petitioner_email', 'pet_email', 'petitionerEmail', 'petEmail'],
    fatherName: [
      'petitioner_father_name',
      'pet_father_name',
      'petitioner_father',
      'petitionerFatherName',
      'petFatherName',
      'father_name',
    ],
  },
  respondent: {
    address: [
      'respondent_address',
      'res_address',
      'respondent_addr',
      'respondentAddress',
      'resAddress',
    ],
    phone: ['respondent_phone', 'res_phone', 'respondentPhone', 'resPhone'],
    email: ['respondent_email', 'res_email', 'respondentEmail', 'resEmail'],
    fatherName: [
      'respondent_father_name',
      'res_father_name',
      'respondent_father',
      'respondentFatherName',
      'resFatherName',
    ],
  },
};

const PETITIONER_ROLE_RE =
  /^(petitioner|petitioner\/appellant|applicant|complainant|plaintiff|appellant|pet\.?)$/i;
const RESPONDENT_ROLE_RE =
  /^(respondent|defendant|accused|opposite\s*party|res\.?)$/i;

function rowObjectBag(row: CaseApiCase): Record<string, unknown> {
  const extras = row as CaseApiCaseExtras;
  const extraObj =
    extras.extra && typeof extras.extra === 'object' && !Array.isArray(extras.extra)
      ? (extras.extra as Record<string, unknown>)
      : {};
  return { ...extras, ...extraObj };
}

function sideFromPartyRole(role: unknown): PartySide | null {
  const s = str(role);
  if (!s) return null;
  if (PETITIONER_ROLE_RE.test(s)) return 'petitioner';
  if (RESPONDENT_ROLE_RE.test(s)) return 'respondent';
  return null;
}

function partyObjectField(
  obj: Record<string, unknown>,
  field: PartyPiiField,
): string | null {
  const keys: Record<PartyPiiField, readonly string[]> = {
    address: ['address', 'addr', 'party_address'],
    phone: ['phone', 'mobile', 'contact_phone', 'phone_no', 'phoneNo'],
    email: ['email', 'email_id', 'emailId', 'contact_email'],
    fatherName: ['father_name', 'fatherName', 'father', 'guardian_name', 'guardianName'],
  };
  for (const key of keys[field]) {
    const v = str(obj[key]);
    if (v) return v;
  }
  return null;
}

function findStructuredParty(row: CaseApiCase, side: PartySide): Record<string, unknown> | null {
  const bag = rowObjectBag(row);
  for (const key of ['parties', 'party_details', 'partyDetails', 'party_list'] as const) {
    const rows = parseJsonArray(bag[key]);
    for (const item of rows) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const itemSide =
        sideFromPartyRole(o.role) ??
        sideFromPartyRole(o.side) ??
        sideFromPartyRole(o.party_side) ??
        sideFromPartyRole(o.partySide);
      if (itemSide === side) return o;
    }
  }
  return null;
}

/** NV-CNR-PARTY-PII-001 — passthrough public court party fields when present in corpus row. */
export function extractPartyPiiFromRow(
  row: CaseApiCase,
  side: PartySide,
): Pick<CnrPartyEntry, 'address' | 'phone' | 'email' | 'fatherName'> {
  const bag = rowObjectBag(row);
  const out: Pick<CnrPartyEntry, 'address' | 'phone' | 'email' | 'fatherName'> = {
    address: null,
    phone: null,
    email: null,
    fatherName: null,
  };

  for (const field of ['address', 'phone', 'email', 'fatherName'] as const) {
    for (const key of PARTY_PII_KEY_ALIASES[side][field]) {
      const v = str(bag[key]);
      if (v) {
        out[field] = v;
        break;
      }
    }
  }

  const structured = findStructuredParty(row, side);
  if (structured) {
    for (const field of ['address', 'phone', 'email', 'fatherName'] as const) {
      if (!out[field]) out[field] = partyObjectField(structured, field);
    }
  }

  return out;
}

function resolvePartyType(
  name: string | null,
  structured: Record<string, unknown> | null,
): CnrPartyEntry['partyType'] {
  if (structured) {
    const raw =
      str(structured.entity_type) ??
      str(structured.entityType) ??
      str(structured.party_type) ??
      str(structured.partyType);
    if (raw) {
      if (
        /organi[sz]ation|company|corp|ltd|llp|govt|government|state|authority|bank/i.test(
          raw,
        )
      ) {
        return 'Organisation';
      }
      if (/individual|person|natural/i.test(raw)) return 'Individual';
    }
  }
  return inferOrganisation(name);
}

/** Structured party rows for `fields.partyDetails[]` (NV-CNR-FIELDS-PII-001). */
export function buildPartyDetailsFromRow(row: CaseApiCase, source: string): CnrPartyEntry[] {
  const parties = buildPartyArraysFromRow(row);
  const petAdv = str(row.petitioner_advocate);
  const resAdv = str(row.respondent_advocate);
  const out: CnrPartyEntry[] = [];

  for (const name of parties.petitioners) {
    const entry = buildPartyEntry(row, 'petitioner', name, petAdv, source);
    if (entry) out.push(entry);
  }
  for (const name of parties.respondents) {
    const entry = buildPartyEntry(row, 'respondent', name, resAdv, source);
    if (entry) out.push(entry);
  }

  if (out.length === 0) {
    const pet = buildPartyEntry(row, 'petitioner', str(row.petitioner), petAdv, source);
    const res = buildPartyEntry(row, 'respondent', str(row.respondent), resAdv, source);
    if (pet) out.push(pet);
    if (res) out.push(res);
  }

  return out;
}

function buildPartyEntry(
  row: CaseApiCase,
  side: PartySide,
  name: string | null,
  advocate: string | null,
  source: string,
): CnrPartyEntry | null {
  if (!name) return null;
  const structured = findStructuredParty(row, side);
  const pii = extractPartyPiiFromRow(row, side);
  const piiCount = [pii.address, pii.phone, pii.email, pii.fatherName].filter(Boolean).length;
  return {
    partyType: resolvePartyType(name, structured),
    name,
    fatherName: pii.fatherName,
    address: pii.address,
    phone: pii.phone,
    email: pii.email,
    advocate,
    source,
    confidence: piiCount > 0 ? Math.min(0.95, 0.9 + piiCount * 0.01) : 0.9,
  };
}

function mergePartyPiiEntry(base: CnrPartyEntry, legacy: CnrPartyEntry): CnrPartyEntry {
  return {
    ...base,
    partyType: base.partyType ?? legacy.partyType,
    name: base.name ?? legacy.name,
    fatherName: base.fatherName ?? legacy.fatherName,
    address: base.address ?? legacy.address,
    phone: base.phone ?? legacy.phone,
    email: base.email ?? legacy.email,
    advocate: base.advocate ?? legacy.advocate,
    source: base.source,
    confidence: Math.max(base.confidence, legacy.confidence),
  };
}

function mergeCaseCreatePartyLists(
  baseList: CnrPartyEntry[],
  legacyList: CnrPartyEntry[],
): CnrPartyEntry[] {
  if (baseList.length === 0) return legacyList;
  if (legacyList.length === 0) return baseList;
  const out = baseList.map((entry, index) => {
    const legacyMatch =
      legacyList[index] ??
      legacyList.find((leg) => leg.name && leg.name === entry.name) ??
      null;
    return legacyMatch ? mergePartyPiiEntry(entry, legacyMatch) : entry;
  });
  for (const leg of legacyList) {
    if (!leg.name) continue;
    if (!out.some((b) => b.name === leg.name)) out.push(leg);
  }
  return out;
}

function mergeCaseCreateProfiles(
  base: CnrCaseCreateProfile,
  legacy: CnrCaseCreateProfile,
): CnrCaseCreateProfile {
  const mergedTimeline = mergeTimelineEntries(base.timeline ?? [], legacy.timeline ?? []);
  const clients = mergeCaseCreatePartyLists(base.clients ?? [], legacy.clients ?? []);
  const opposingParties = mergeCaseCreatePartyLists(
    base.opposingParties ?? [],
    legacy.opposingParties ?? [],
  );
  const profile: CnrCaseCreateProfile = {
    ...base,
    timeline: mergedTimeline.length > 0 ? mergedTimeline : base.timeline,
    clients,
    opposingParties,
  };
  profile.fieldManifest = buildFieldManifestFromProfile(profile);
  return profile;
}

/** Normalize nysapi / legacy act rows to NSP actsSections shape. */
export function normalizeActsSections(raw: unknown): Record<string, unknown>[] {
  const rows = parseJsonArray(raw);
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (typeof row === 'string') {
      const s = row.trim();
      if (s) out.push({ act: s });
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const act =
      str(o.act) ??
      str(o.act_name) ??
      str(o.under_act) ??
      str(o.underAct) ??
      str(o.name);
    const section =
      str(o.section) ??
      str(o.section_no) ??
      str(o.sectionNo) ??
      str(o.under_section) ??
      str(o.underSection);
    if (!act && !section) continue;
    out.push({
      ...(act ? { act } : {}),
      ...(section ? { section } : {}),
    });
  }
  return out;
}

/** NV-CASE-API-ACTS-001 — extract acts from inline row / extra.acts / acts_sections / acts_json. */
export function extractActsFromCaseRow(row: CaseApiCase): Record<string, unknown>[] {
  const extras = row as CaseApiCaseExtras;
  const bag = rowObjectBag(row);
  const extraActs =
    extras.extra && typeof extras.extra === 'object' && !Array.isArray(extras.extra)
      ? (extras.extra as Record<string, unknown>).acts
      : undefined;
  for (const candidate of [
    extraActs,
    row.acts,
    row.acts_json,
    bag.acts_json,
    bag.actsJson,
    row.acts_sections,
    row.sections,
    extras.acts_sections,
  ]) {
    const normalized = normalizeActsSections(candidate);
    if (normalized.length > 0) return normalized;
  }
  return [];
}

/**
 * NV-CNR-LINKED-MATTERS-001 — normalize linked/connected/clubbed matters (Group 12).
 * Reads `linked_cases` / `linked` / `connected_cases` (array or JSON string).
 * Every element is best-effort mapped; fully-empty rows are dropped.
 */
export function normalizeLinkedMatters(raw: unknown, source: string): CnrLinkedMatter[] {
  const rows = parseJsonArray(raw);
  const out: CnrLinkedMatter[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (typeof row === 'string') {
      const s = row.trim();
      if (!s) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const asCnr = extractCnrCandidate(s);
      out.push({
        cnr: asCnr,
        caseNumber: asCnr ? null : s,
        title: null,
        relation: null,
        court: null,
        source,
      });
      continue;
    }
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const cnr =
      extractCnrCandidate(o.cnr) ?? extractCnrCandidate(o.linked_cnr) ?? extractCnrCandidate(o.cino);
    const caseNumber =
      str(o.case_no) ?? str(o.case_number) ?? str(o.caseNumber) ?? str(o.filing_no);
    const title = str(o.title) ?? str(o.case_title) ?? str(o.name);
    const relation =
      str(o.relation) ?? str(o.link_type) ?? str(o.linkType) ?? str(o.type) ?? str(o.category);
    const court = str(o.court) ?? str(o.court_name) ?? str(o.establishment);
    if (!cnr && !caseNumber && !title && !relation && !court) continue;
    const key = `${cnr ?? ''}|${caseNumber ?? ''}|${(title ?? '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ cnr, caseNumber, title, relation, court, source });
  }
  return out;
}

/** NV-CNR-FIR-INCIDENT-001 — FIR/incident date candidates (none in corpus today). */
export function extractIncidentDate(row: CaseApiCase): string | null {
  const bag = rowObjectBag(row);
  for (const key of [
    'date_of_incident',
    'incident_date',
    'occurrence_date',
    'fir_date',
    'fir_registration_date',
    'dateOfIncident',
    'incidentDate',
  ]) {
    const d = dateOnly(bag[key]);
    if (d) return d;
  }
  return null;
}

function actsFieldValue(
  acts: Record<string, unknown>[],
  source: string,
  countHint?: number,
): CnrFieldValue {
  if (acts.length > 0) {
    return fv(acts, source, 0.75);
  }
  if (typeof countHint === 'number' && countHint > 0) {
    return fv(
      [],
      source,
      0,
      `${countHint} act(s) indexed — detail not hydrated in case-api row`,
    );
  }
  return fv([], null, 0);
}

export function timelineEventsToTimeline(
  events: CaseApiTimelineEvent[] | null | undefined,
  source: string,
): CnrTimelineEntry[] {
  const rows = events ?? [];
  const out: CnrTimelineEntry[] = [];
  for (const e of rows) {
    const date = timelineEventDate(e);
    const purpose = str(e.purpose ?? e.purpose_name ?? e.event_type ?? e.description);
    const judge = str(e.judge);
    const status = str(e.status);
    const docUrl = str(e.doc_url);
    if (!date && !purpose && !judge && !status && !docUrl) continue;
    out.push({
      date,
      purpose,
      judge,
      status,
      ...(docUrl ? { docUrl } : {}),
      source,
      confidence: date ? 0.85 : 0.65,
    });
  }
  return out;
}

function timelineDocumentsFromEvents(
  events: CaseApiTimelineEvent[],
  cnr: string,
  sourceArchive: string,
): CnrDocument[] {
  const out: CnrDocument[] = [];
  const seenUrls = new Set<string>();
  for (const [idx, e] of events.entries()) {
    const url = str(e.doc_url);
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const date = timelineEventDate(e);
    const purpose = str(e.purpose ?? e.purpose_name ?? e.event_type ?? e.description);
    out.push({
      id: `timeline_${cnr}_${idx}`,
      kind: 'order',
      title: purpose ?? 'Timeline document',
      decisionDate: date,
      pdfUrlKind: 'presigned',
      url,
      expiresIn: PRESIGNED_DOC_TTL_SECONDS,
      sourceArchive,
    });
  }
  return out;
}

function mergeTimelineDocuments(
  existing: CnrDocument[],
  fromTimeline: CnrDocument[],
): CnrDocument[] {
  if (fromTimeline.length === 0) return existing;
  const seen = new Set(existing.map((d) => d.url).filter(Boolean));
  const merged = [...existing];
  for (const doc of fromTimeline) {
    if (doc.url && seen.has(doc.url)) continue;
    if (doc.url) seen.add(doc.url);
    merged.push(doc);
  }
  return merged;
}

function timelineEntriesFromField(field: CnrFieldValue | undefined): CnrTimelineEntry[] {
  const value = field?.value;
  return Array.isArray(value) ? (value as CnrTimelineEntry[]) : [];
}

function actsFromField(field: CnrFieldValue | undefined): unknown[] {
  const value = field?.value;
  return Array.isArray(value) ? value : [];
}

export function needsCaseApiFieldEnrichment(
  data: CnrResolveData,
  includeDocuments = true,
): boolean {
  if (data.status !== 'found' || !data.fields) return false;
  const actsEmpty = actsFromField(data.fields.actsSections).length === 0;
  const actsCountHint = data.meta?.counts?.acts ?? 0;
  const actsNeedLegacy = actsEmpty && actsCountHint > 0;
  const hearingsEmpty = timelineEntriesFromField(data.fields.hearings).length === 0;
  const docsEmpty = includeDocuments ? data.documents.length === 0 : false;
  return actsNeedLegacy || actsEmpty || hearingsEmpty || docsEmpty;
}

/** NV-CNR-DIARY-LEGACY-MERGE-001 — SC diary with empty CNR still hits legacy tiers. */
export function shouldAttemptLegacyCaseApiEnrichment(input: {
  data: CnrResolveData;
  diaryNumber?: string;
  includeDocuments?: boolean;
}): boolean {
  if (!isCaseApiLegacyEnrichEnabled()) return false;
  if (input.data.status !== 'found') return false;
  const cnr = input.data.cnr.trim();
  const diary = input.diaryNumber?.trim() ?? '';
  if (!cnr && !diary) return false;
  if (!cnr && diary) return true;
  return needsCaseApiFieldEnrichment(input.data, input.includeDocuments !== false);
}

export function mergeLegacyEnrichmentIntoResolveData(
  base: CnrResolveData,
  legacy: CnrResolveData,
): CnrResolveData {
  if (base.status !== 'found' || legacy.status !== 'found' || !base.fields || !legacy.fields) {
    return base;
  }

  const legacySource = legacy.source ?? 'nys_cnr_corpus';
  const mergedFields: Record<string, CnrFieldValue> = { ...base.fields };
  const sourcesTried = [...base.sourcesTried];
  if (!sourcesTried.includes(legacySource)) {
    sourcesTried.push(legacySource);
  }
  for (const tier of legacy.sourcesTried ?? []) {
    if (!sourcesTried.includes(tier)) sourcesTried.push(tier);
  }

  const mergeSource = base.source ?? legacySource;
  const mergeConfidence = Math.max(base.confidence, legacy.confidence, 0.75);

  const baseActs = actsFromField(base.fields.actsSections);
  const mergedActs = mergeActsSectionRows(
    baseActs,
    actsFromField(legacy.fields.actsSections),
  );
  if (mergedActs.length > 0) {
    mergedFields.actsSections = fv(mergedActs, mergeSource, mergeConfidence);
  } else if (
    baseActs.length === 0 &&
    typeof base.meta?.counts?.acts === 'number' &&
    base.meta.counts.acts > 0 &&
    base.fields.actsSections?.note
  ) {
    mergedFields.actsSections = base.fields.actsSections;
  }

  const mergedHearings = mergeTimelineEntries(
    timelineEntriesFromField(base.fields.hearings),
    timelineEntriesFromField(legacy.fields.hearings),
  );
  if (mergedHearings.length > 0) {
    mergedFields.hearings = fv(mergedHearings, mergeSource, mergeConfidence);
  }

  const mergedPetitioners = mergeStringArrayValues(
    stringArrayFromField(base.fields.petitioners),
    stringArrayFromField(legacy.fields.petitioners),
  );
  if (mergedPetitioners.length > 0) {
    mergedFields.petitioners = fv(mergedPetitioners, mergeSource, mergeConfidence);
    if (isEmptyScalarValue(base.fields.petitioner?.value) && legacy.fields.petitioner) {
      mergedFields.petitioner = legacy.fields.petitioner;
    } else if (isEmptyScalarValue(base.fields.petitioner?.value)) {
      mergedFields.petitioner = fv(mergedPetitioners[0] ?? null, mergeSource, mergeConfidence);
    }
  }

  const mergedRespondents = mergeStringArrayValues(
    stringArrayFromField(base.fields.respondents),
    stringArrayFromField(legacy.fields.respondents),
  );
  if (mergedRespondents.length > 0) {
    mergedFields.respondents = fv(mergedRespondents, mergeSource, mergeConfidence);
    if (isEmptyScalarValue(base.fields.respondent?.value) && legacy.fields.respondent) {
      mergedFields.respondent = legacy.fields.respondent;
    } else if (isEmptyScalarValue(base.fields.respondent?.value)) {
      mergedFields.respondent = fv(mergedRespondents[0] ?? null, mergeSource, mergeConfidence);
    }
  }

  const mergedJudges = mergeStringArrayValues(
    stringArrayFromField(base.fields.judges),
    stringArrayFromField(legacy.fields.judges),
  );
  if (mergedJudges.length > 0) {
    mergedFields.judges = fv(mergedJudges, mergeSource, mergeConfidence);
  }

  const mergedAdvocates = mergeAdvocateEntries(
    advocateEntriesFromField(base.fields.advocates),
    advocateEntriesFromField(legacy.fields.advocates),
  );
  if (mergedAdvocates.length > 0) {
    mergedFields.advocates = fv(mergedAdvocates, mergeSource, mergeConfidence);
  }

  const mergedPartyDetails = mergeCaseCreatePartyLists(
    partyDetailsFromField(base.fields.partyDetails),
    partyDetailsFromField(legacy.fields.partyDetails),
  );
  if (mergedPartyDetails.length > 0) {
    mergedFields.partyDetails = fv(mergedPartyDetails, mergeSource, mergeConfidence);
  }

  for (const key of [
    'citation',
    'firNo',
    'firYear',
    'jurisdiction',
    'stateName',
    'districtName',
    'bench',
    'complexName',
    'filingNumber',
    'filingNumberYear',
    'currentPurpose',
    'firstHearingDate',
    'summary',
    'registrationDate',
  ] as const) {
    const baseVal = scalarFromField(base.fields[key]);
    const legacyField = legacy.fields[key];
    if (isEmptyScalarValue(baseVal) && legacyField && !isEmptyScalarValue(legacyField.value)) {
      mergedFields[key] = legacyField;
    }
  }

  let documents = mergeTimelineDocuments(base.documents, legacy.documents);

  let caseCreate = base.caseCreate;
  if (caseCreate && legacy.caseCreate) {
    caseCreate = mergeCaseCreateProfiles(caseCreate, legacy.caseCreate);
  } else if (!caseCreate && legacy.caseCreate) {
    caseCreate = legacy.caseCreate;
  }

  const extractPreview =
    base.extractPreview ??
    legacy.extractPreview ??
    null;

  return {
    ...base,
    source: base.source,
    status: base.status,
    matchType: base.matchType,
    ui: base.ui,
    fields: mergedFields,
    documents,
    caseCreate,
    extractPreview,
    sourcesTried,
  };
}

export function applyTimelineEnrichment(
  data: CnrResolveData,
  events: CaseApiTimelineEvent[],
  source: string,
  options?: { forceHearings?: boolean },
): CnrResolveData {
  if (data.status !== 'found' || !data.fields || events.length === 0) return data;

  const timeline = timelineEventsToTimeline(events, source);
  if (timeline.length === 0) return data;

  const mergedFields: Record<string, CnrFieldValue> = { ...data.fields };
  const existingHearings = timelineEntriesFromField(data.fields.hearings);
  if (existingHearings.length === 0) {
    mergedFields.hearings = fv(timeline, source, 0.85);
  } else if (options?.forceHearings) {
    const mergedHearings = mergeTimelineEntries(existingHearings, timeline);
    mergedFields.hearings = fv(mergedHearings, source, 0.85);
  }

  let caseCreate = data.caseCreate;
  if (caseCreate) {
    if (caseCreate.timeline.length === 0) {
      caseCreate = { ...caseCreate, timeline };
    } else if (options?.forceHearings) {
      caseCreate = {
        ...caseCreate,
        timeline: mergeTimelineEntries(caseCreate.timeline, timeline),
      };
    }
  }

  const sourceArchive =
    courtLevelToArchive(
      typeof data.fields.courtType?.value === 'string' ? data.fields.courtType.value : null,
    );
  const timelineDocs = timelineDocumentsFromEvents(events, data.cnr, sourceArchive);
  const documents = mergeTimelineDocuments(data.documents, timelineDocs);

  const sourcesTried = [...data.sourcesTried];
  const timelineTag = `${source}_timeline`;
  if (!sourcesTried.includes(timelineTag)) sourcesTried.push(timelineTag);

  return {
    ...data,
    fields: mergedFields,
    caseCreate,
    documents,
    sourcesTried,
  };
}

/** Legacy NYS POST /cnr/resolve — Athena + cnr_case_details + nyv_caselaw tiers. */
export async function fetchLegacyCnrResolve(input: {
  cnr?: string;
  diaryNumber?: string;
  courtType?: CaseApiCourtLevel | string | null;
  wantCaseCreate?: boolean;
  includeDocuments?: boolean;
  includeExtractPreview?: boolean;
}): Promise<CnrResolveData | null> {
  if (!isNysKnowledgeConfigured()) return null;
  if (!input.cnr && !input.diaryNumber) return null;

  const ct = parseCaseApiCourtType(input.courtType) ?? undefined;
  const wantExtract =
    input.includeExtractPreview === true ||
    (input.wantCaseCreate && input.includeExtractPreview !== false);

  const result = await nysKnowledgeRequest<{ success?: boolean; data?: CnrResolveData }>({
    method: 'POST',
    path: '/cnr/resolve',
    body: {
      ...(input.cnr ? { cnr: input.cnr } : {}),
      ...(input.diaryNumber ? { diaryNumber: input.diaryNumber } : {}),
      options: {
        includeDocuments: input.includeDocuments !== false,
        profile: input.wantCaseCreate ? 'caseCreate' : 'default',
        ...(ct ? { courtType: ct.toLowerCase() as 'sc' | 'hc' | 'dc' } : {}),
        ...(wantExtract ? { includeExtractPreview: true } : {}),
      },
    },
    timeoutMs: legacyEnrichTimeoutMs(),
    retries: 0,
  });

  if (!result.ok) {
    logger.info('[CNR] legacy enrich skipped', {
      cnr: input.cnr ?? null,
      diaryNumber: input.diaryNumber ?? null,
      status: result.status,
      error: result.error,
    });
    return null;
  }

  const payload = result.data;
  const legacyData =
    payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
      ? payload.data
      : null;
  if (!legacyData || legacyData.status !== 'found') return null;
  return legacyData;
}

export async function fetchCaseTimeline(
  cnr: string,
  courtType?: CaseApiCourtLevel,
): Promise<CaseApiTimelineResult> {
  const t0 = Date.now();
  if (!isCaseApiConfigured()) {
    return { ok: false, status: 503, error: 'JRX_ECOSYSTEM_CASE_API not configured', latencyMs: 0 };
  }

  const base = caseApiBaseUrl();
  const key = (process.env.JRX_ECOSYSTEM_CASE_API_KEY ?? '').trim();
  const params = new URLSearchParams();
  const ct = courtType ?? inferCourtTypeFromCnr(cnr);
  if (ct) params.set('court_type', ct);
  const qs = params.toString();
  const url = `${base}/v1/cases/${encodeURIComponent(cnr)}/timeline${qs ? `?${qs}` : ''}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), caseApiTimelineTimeoutMs());

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-Key': key,
      },
      signal: controller.signal,
    });
    const latencyMs = Date.now() - t0;
    const text = await res.text();
    let body: CaseApiTimelineResponse = {};
    try {
      body = JSON.parse(text) as CaseApiTimelineResponse;
    } catch {
      return {
        ok: false,
        status: res.status,
        error: 'non_json_response',
        latencyMs,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: body.error ?? body.detail ?? `http_${res.status}`,
        latencyMs,
      };
    }

    const events = Array.isArray(body.events) ? body.events : [];
    return { ok: true, events, latencyMs };
  } catch (err: unknown) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = /abort|timeout/i.test(msg);
    return {
      ok: false,
      status: isTimeout ? 504 : 502,
      error: isTimeout ? 'timeout' : msg,
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

let cachedTableVersion: { value: string | null; fetchedAt: number } | null = null;
const TABLE_VERSION_TTL_MS = 60_000;

interface CaseApiHealthResponse {
  table_version?: string | null;
  status?: string;
}

/** Best-effort nysapi `/health` table watermark (60s cache). */
export async function fetchCaseApiTableVersion(): Promise<string | null> {
  if (!isCaseApiConfigured()) return null;

  const now = Date.now();
  if (cachedTableVersion && now - cachedTableVersion.fetchedAt < TABLE_VERSION_TTL_MS) {
    return cachedTableVersion.value;
  }

  const base = caseApiBaseUrl();
  const key = (process.env.JRX_ECOSYSTEM_CASE_API_KEY ?? '').trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);

  try {
    const res = await fetch(`${base}/health`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(key ? { 'X-API-Key': key } : {}),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    let body: CaseApiHealthResponse = {};
    try {
      body = JSON.parse(text) as CaseApiHealthResponse;
    } catch {
      cachedTableVersion = { value: null, fetchedAt: now };
      return null;
    }
    const version = str(body.table_version);
    cachedTableVersion = { value: version, fetchedAt: now };
    return version;
  } catch {
    cachedTableVersion = { value: null, fetchedAt: now };
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function attachTableVersionToMeta(
  data: CnrResolveData,
  tableVersion: string | null,
): CnrResolveData {
  if (!tableVersion) return data;
  const meta: CnrResolveMeta = { ...(data.meta ?? {}) };
  meta.provenance = {
    ...(meta.provenance ?? {}),
    tableVersion,
  };
  return { ...data, meta };
}

/** P2a+P2b — additive enrichment after case-api map (status/source unchanged). */
export async function enrichCaseApiResolveData(input: {
  data: CnrResolveData;
  caseRow: CaseApiCase;
  wantCaseCreate?: boolean;
  includeDocuments?: boolean;
  includeTimeline?: boolean;
  /** Diary path — enables legacy merge without CNR when sparse. */
  diaryNumber?: string;
  courtType?: CaseApiCourtLevel | string | null;
  includeExtractPreview?: boolean;
}): Promise<CnrResolveData> {
  let data = input.data;
  if (data.status !== 'found') return data;

  const cnr = data.cnr.trim();

  // NV-CASE-MASTER-DATA-001 — prefill empty court fields from the JRX
  // jurisdiction master (runs after buildFields; no-op without DB/provider).
  data = await applyJurisdictionPrefill(data, cnr);

  data = await applyHcOrderPresignFromDb({
    data,
    courtLevel: input.caseRow.court_level,
    includeDocuments: input.includeDocuments,
  });

  const inlineHearingCount = input.caseRow.hearings?.length ?? 0;
  const countHint = input.caseRow.counts?.hearings;
  const inlineHearingsSparse =
    inlineHearingCount === 0 ||
    (typeof countHint === 'number' && countHint > inlineHearingCount);
  const timelineSource = `${data.source ?? 'nys_case_api'}_timeline`;
  const shouldFetchTimeline =
    cnr.length > 0 && (input.includeTimeline === true || inlineHearingsSparse);

  if (shouldFetchTimeline) {
    const timelineResult = await fetchCaseTimeline(
      cnr,
      parseCaseApiCourtType(input.caseRow.court_level) ??
        inferCourtTypeFromCnr(cnr),
    );
    if (timelineResult.ok && timelineResult.events.length > 0) {
      data = applyTimelineEnrichment(data, timelineResult.events, timelineSource, {
        forceHearings:
          input.includeTimeline === true ||
          (typeof countHint === 'number' && countHint > inlineHearingCount),
      });
    }
  }

  const legacyKey = cnr || input.diaryNumber?.trim() || '';
  if (
    legacyKey &&
    shouldAttemptLegacyCaseApiEnrichment({
      data,
      diaryNumber: input.diaryNumber,
      includeDocuments: input.includeDocuments,
    })
  ) {
    const legacy = await fetchLegacyCnrResolve({
      cnr: cnr || undefined,
      diaryNumber: !cnr && input.diaryNumber ? input.diaryNumber : undefined,
      courtType: input.courtType ?? (input.diaryNumber ? 'SC' : undefined),
      wantCaseCreate: input.wantCaseCreate,
      includeDocuments: input.includeDocuments,
      includeExtractPreview: input.includeExtractPreview,
    });
    if (legacy) {
      data = mergeLegacyEnrichmentIntoResolveData(data, legacy);
    }
  }

  const tableVersion =
    data.meta?.provenance?.tableVersion ?? (await fetchCaseApiTableVersion());
  if (tableVersion) {
    data = attachTableVersionToMeta(data, tableVersion);
  }

  return applyCorpusBetaHonestyEnvelope(data, input.caseRow);
}

function buildCaseTitle(row: CaseApiCase): string | null {
  const t = str(row.case_title);
  if (t && !/^CNR\s/i.test(t)) return t;
  const p = str(row.petitioner);
  const r = str(row.respondent);
  if (p && r) return `${p} vs ${r}`;
  return p ?? r ?? t;
}

function inferOrganisation(name: string | null): 'Individual' | 'Organisation' {
  if (!name) return 'Individual';
  if (
    /\b(Pvt\.?\s*Ltd|Limited|LLP|Inc\.?|Corporation|Company|State of|Union of India|Government|Dept\.?|Department|Authority|Board|Commission|Bank|Municipal|Council)\b/i.test(
      name,
    )
  ) {
    return 'Organisation';
  }
  return 'Individual';
}

function buildFieldManifestFromProfile(profile: {
  header: CnrCaseCreateProfile['header'];
  timeline: CnrTimelineEntry[];
  summary: CnrFieldValue;
  clients: CnrCaseCreateProfile['clients'];
  opposingParties: CnrCaseCreateProfile['opposingParties'];
  witnesses: CnrCaseCreateProfile['witnesses'];
}): CnrFieldManifest {
  const complete: string[] = ['cnr'];
  const partial: string[] = [];
  const missing: string[] = [];
  const manualRecommended: string[] = ['nextHearingDate', 'witnessDetails'];
  const manualRequired: string[] = ['witnesses', 'nextHearingDate'];
  const corpusUnavailable: string[] = [];
  const namedParties = [...profile.clients, ...profile.opposingParties].filter((p) => p.name);
  const partyFieldMissing = (
    field: 'address' | 'phone' | 'email' | 'fatherName',
  ): boolean => namedParties.length > 0 && namedParties.some((p) => !p[field]);
  if (partyFieldMissing('phone')) {
    manualRecommended.push('clientPhone');
    corpusUnavailable.push('clientPhone');
  }
  if (partyFieldMissing('email')) {
    manualRecommended.push('clientEmail');
    corpusUnavailable.push('clientEmail');
  }
  if (partyFieldMissing('fatherName')) {
    manualRecommended.push('clientFatherName');
    corpusUnavailable.push('clientFatherName');
  }
  if (partyFieldMissing('address')) {
    manualRecommended.push('clientAddress');
    corpusUnavailable.push('clientAddress');
  }
  if (namedParties.length === 0) {
    corpusUnavailable.push('party_pii');
  }

  const check = (key: string, val: unknown, partialOk = false) => {
    const empty =
      val === null ||
      val === undefined ||
      val === '' ||
      (Array.isArray(val) && val.length === 0);
    if (empty) missing.push(key);
    else if (partialOk) partial.push(key);
    else complete.push(key);
  };

  check('caseTitle', profile.header.caseTitle.value);
  check('filingDate', profile.header.filingDate.value, true);
  check('caseStatus', profile.header.caseStatus.value, true);
  check('policeStation', profile.header.policeStation.value);
  check('timeline', profile.timeline.length > 0 ? profile.timeline : null);
  check('summary', profile.summary.value);
  check('clients', profile.clients.some((c) => c.name) ? profile.clients : null);
  check(
    'opposingParties',
    profile.opposingParties.some((c) => c.name) ? profile.opposingParties : null,
  );
  check('witnesses', profile.witnesses.length > 0 ? profile.witnesses : null);

  if (profile.header.nextHearingDate.value === null) {
    missing.push('nextHearingDate');
    manualRequired.push('runningStatus');
  }

  if (profile.witnesses.length === 0) {
    manualRequired.push('witnessDetails');
  }

  return {
    complete,
    partial,
    missing,
    manualRecommended,
    manualRequired: [...new Set(manualRequired)],
    corpusUnavailable: [...new Set(corpusUnavailable)],
  };
}

function fieldAvailabilityHints(fa: Record<string, string> | null | undefined): string[] {
  if (!fa) return [];
  return Object.entries(fa)
    .filter(([, v]) => v === 'not_published_by_source' || v === 'not_published')
    .map(([k]) => k);
}

function partyDetailsHavePii(parties: CnrPartyEntry[]): boolean {
  return parties.some(
    (p) =>
      Boolean(p.address?.trim()) ||
      Boolean(p.phone?.trim()) ||
      Boolean(p.email?.trim()) ||
      Boolean(p.fatherName?.trim()),
  );
}

/** NV-CASE-CORPUS-BETA-001 — honest beta slots on resolve (Tier-3 / corpus / manual). */
export function applyCorpusBetaHonestyEnvelope(
  data: CnrResolveData,
  row?: CaseApiCase,
): CnrResolveData {
  if (data.status !== 'found' || !data.fields) return data;

  const fieldAvailability: Record<string, string> = {
    ...(data.meta?.fieldAvailability ?? {}),
  };
  const nextEmpty = isEmptyScalarValue(data.fields.nextHearingDate?.value);
  if (nextEmpty) {
    fieldAvailability.next_hearing_date ??= 'tier3_required';
    fieldAvailability.nextHearingDate ??= 'tier3_required';
    fieldAvailability.runningStatus ??= 'tier3_required';
    fieldAvailability.live_docket ??= 'tier3_required';
  }

  const partyDetails = partyDetailsFromField(data.fields.partyDetails);
  const piiSparse = !partyDetailsHavePii(partyDetails);
  if (piiSparse) {
    for (const key of [
      'party_pii',
      'petitioner_address',
      'respondent_address',
      'petitioner_phone',
      'respondent_phone',
      'petitioner_email',
      'respondent_email',
      'clientAddress',
      'clientPhone',
      'clientEmail',
      'clientFatherName',
    ]) {
      fieldAvailability[key] ??= 'corpus_unavailable';
    }
  }

  fieldAvailability.witnesses ??= 'manual_required';

  const manualCaptureFields = ['witnesses'];
  if (piiSparse) {
    manualCaptureFields.push(
      'clientAddress',
      'clientPhone',
      'clientEmail',
      'clientFatherName',
    );
  }

  const meta: CnrResolveMeta = {
    ...(data.meta ?? {}),
    fieldAvailability,
    betaReadiness: {
      corpusTier: 'judgment_index',
      tier3RequiredFields: nextEmpty
        ? ['nextHearingDate', 'runningStatus', 'liveDocket']
        : [],
      manualCaptureFields,
      edjJobPath: EDJ_JOBS_PATH,
    },
  };

  const fields: Record<string, CnrFieldValue> = { ...data.fields };
  if (nextEmpty && fields.nextHearingDate) {
    fields.nextHearingDate = {
      ...fields.nextHearingDate,
      value: null,
      source: null,
      confidence: 0,
      note: fields.nextHearingDate.note?.includes('Tier-3')
        ? fields.nextHearingDate.note
        : BETA_TIER3_NOTE,
    };
  }
  if (fields.caseStatus && nextEmpty && !str(row?.next_hearing_date ?? row?.next_date)) {
    const existingNote = fields.caseStatus.note ?? '';
    fields.caseStatus = {
      ...fields.caseStatus,
      note: existingNote.includes('Tier-3')
        ? existingNote
        : existingNote
          ? `${existingNote} · ${BETA_TIER3_NOTE}`
          : BETA_TIER3_NOTE,
    };
  }
  if (piiSparse && fields.partyDetails) {
    fields.partyDetails = {
      ...fields.partyDetails,
      note: fields.partyDetails.note ?? BETA_PII_NOTE,
    };
  }

  let caseCreate = data.caseCreate;
  if (caseCreate) {
    if (nextEmpty && caseCreate.header.nextHearingDate) {
      caseCreate = {
        ...caseCreate,
        header: {
          ...caseCreate.header,
          nextHearingDate: {
            ...caseCreate.header.nextHearingDate,
            value: null,
            source: null,
            confidence: 0,
            note: BETA_TIER3_NOTE,
          },
        },
      };
    }
    caseCreate = {
      ...caseCreate,
      fieldManifest: buildFieldManifestFromProfile(caseCreate),
    };
  }

  const ui = {
    ...(data.ui ?? { badge: 'Suggested · Judgment corpus', subtitle: '' }),
    subtitle:
      data.ui?.subtitle ??
      'From JRX-Search case-api index — not live eCourts status (beta corpus)',
  };

  return {
    ...data,
    ui,
    fields,
    meta,
    caseCreate,
  };
}

function buildCaseCreateProfile(
  cnr: string,
  row: CaseApiCase,
  source: string,
): CnrCaseCreateProfile {
  const caseTitle = buildCaseTitle(row);
  const caseStatus =
    str(row.case_status) ??
    (row.disposal_nature || row.decision_date ? 'DISPOSED' : null);
  const timeline = hearingsToTimeline(row.hearings, source);
  // NV-CNR-NEXTDATE-KEY-001 — prefer nysapi `next_hearing_date`; keep `next_date` fallback.
  const nextHearing = dateOnly(row.next_hearing_date ?? row.next_date);
  const policeStation = str(row.police_station) ?? (row.fir_no ? `FIR ${row.fir_no}` : null);

  const header = {
    caseTitle: fv(caseTitle, caseTitle ? source : null, caseTitle ? 0.95 : 0),
    cnr: fv(cnr, source, 1),
    filingDate: fv(
      dateOnly(row.filing_date ?? row.registration_date),
      row.filing_date || row.registration_date ? source : null,
      row.filing_date || row.registration_date ? 0.8 : 0,
      row.filing_date || row.registration_date ? undefined : 'often absent in judgment metadata',
    ),
    nextHearingDate: fv(
      nextHearing,
      nextHearing ? source : null,
      nextHearing ? 0.75 : 0,
      nextHearing ? undefined : 'requires live docket — not in judgment corpus',
    ),
    caseStatus: fv(
      caseStatus,
      caseStatus ? source : null,
      caseStatus ? 0.7 : 0,
      caseStatus === 'DISPOSED'
        ? 'inferred from disposal / decision date when present'
        : undefined,
    ),
    policeStation: fv(
      policeStation,
      policeStation ? source : null,
      policeStation ? 0.75 : 0,
    ),
  };

  const clients = [
    buildPartyEntry(
      row,
      'petitioner',
      str(row.petitioner),
      str(row.petitioner_advocate),
      source,
    ),
  ].filter((entry): entry is CnrPartyEntry => entry !== null);

  const opposingParties = [
    buildPartyEntry(
      row,
      'respondent',
      str(row.respondent),
      str(row.respondent_advocate),
      source,
    ),
  ].filter((entry): entry is CnrPartyEntry => entry !== null);

  const summaryText = str(row.summary);
  const profile: CnrCaseCreateProfile = {
    header,
    timeline,
    summary: fv(
      summaryText,
      summaryText ? source : null,
      summaryText ? 0.7 : 0,
      !summaryText ? 'use document extract or manual entry' : undefined,
    ),
    clients,
    opposingParties,
    witnesses: [],
    fieldManifest: { complete: [], partial: [], missing: [], manualRecommended: [] },
  };
  profile.fieldManifest = buildFieldManifestFromProfile(profile);

  const notPublished = fieldAvailabilityHints(row.field_availability);
  for (const key of notPublished) {
    if (!profile.fieldManifest.partial.includes(key)) {
      profile.fieldManifest.partial.push(key);
    }
  }

  return profile;
}

function documentsFromCase(row: CaseApiCase, sourceArchive: string): CnrDocument[] {
  const doc = row.document;
  if (!doc?.doc_bucket && !doc?.doc_key && !doc?.url) return [];
  const title = buildCaseTitle(row) ?? `CNR ${row.cnr ?? ''}`;
  const presigned = Boolean(doc.url);
  return [
    {
      id: `case_api_${row.cnr ?? 'unknown'}`,
      kind: 'judgment',
      title,
      decisionDate: dateOnly(row.decision_date),
      s3Path: doc.doc_bucket && doc.doc_key ? `s3://${doc.doc_bucket}/${doc.doc_key}` : null,
      pdfUrlKind: presigned ? 'presigned' : undefined,
      sourceArchive,
      url: doc.url ?? null,
      ...(presigned ? { expiresIn: PRESIGNED_DOC_TTL_SECONDS } : {}),
    },
  ];
}

function buildFields(row: CaseApiCase, source: string): Record<string, CnrFieldValue> {
  const rawCaseStatus =
    str(row.case_status) ??
    (row.disposal_nature || row.decision_date ? 'DISPOSED' : null);
  const rawDisposalNature = str(row.disposal_nature);
  const courtTypeCode = courtLevelToType(row.court_level);
  const isDc = courtTypeCode === 'dc';

  // NV-DC-STATUS-DECODE-001 — DC rows publish numeric eCourts status codes.
  // Decode text buckets; for bare numeric codes, keep the raw value and attach
  // an honest "decode pending NJDG master" note (never fabricate a label).
  let caseStatus = rawCaseStatus;
  let caseStatusNote: string | undefined;
  if (isDc && rawCaseStatus) {
    const decoded = decodeDcCaseStatus(rawCaseStatus);
    if (decoded?.numericUndecoded) {
      caseStatusNote = DC_STATUS_DECODE_PENDING_NOTE;
    } else if (decoded && decoded.label !== rawCaseStatus) {
      caseStatus = decoded.label;
      caseStatusNote = `decoded from corpus status "${rawCaseStatus}" (category: ${decoded.category})`;
    }
  }
  let disposalNatureNote: string | undefined;
  if (isDc && rawDisposalNature && isNumericDcStatus(rawDisposalNature)) {
    disposalNatureNote = DC_STATUS_DECODE_PENDING_NOTE;
  }

  const linkedMatters = normalizeLinkedMatters(
    row.linked_cases ?? row.linked ?? row.connected_cases ?? rowCorpusField(row, 'linked_cases'),
    source,
  );
  const incidentDate = extractIncidentDate(row);
  const courtCode = str(row.court_code);
  const complexCode = str(row.complex_code);
  const complexName = str(row.complex_name) ?? str(row.court_establishment);
  const courtName =
    str(row.court) ??
    ([complexName, str(row.state_name), str(row.district_name)].filter(Boolean).join(' — ') ||
      null);
  const parties = buildPartyArraysFromRow(row);
  const petitioners = parties.petitioners;
  const respondents = parties.respondents;
  const judges = parties.judges;
  const advocates = buildAdvocatesFromRow(row);
  const timeline = hearingsToTimeline(row.hearings, source);
  // NV-CNR-NEXTDATE-KEY-001 — prefer nysapi `next_hearing_date`; keep `next_date` fallback.
  const nextHearing = dateOnly(row.next_hearing_date ?? row.next_date);
  const policeStation = str(row.police_station) ?? (row.fir_no ? `FIR ${row.fir_no}` : null);
  const citation = str(row.citation) ?? str(row.neutral_citation);
  const filingNumber = str(row.filing_number);
  const filingNumberYear = str(row.filing_number_year);
  const firNo = str(row.fir_no);
  const firYear = str(row.fir_year);
  const currentPurpose = str(row.current_purpose);
  const firstHearingDate = dateOnly(row.first_hearing_date);
  const summaryText = str(row.summary);
  const registrationDate = dateOnly(row.registration_date);
  const registrationNumber =
    str(row.registration_number) ?? str(rowCorpusField(row, 'registration_number') as string);
  const registrationYear =
    str(row.registration_year) ?? str(rowCorpusField(row, 'registration_year') as string);
  const partyDetails = buildPartyDetailsFromRow(row, source);
  const notPublished = fieldAvailabilityHints(row.field_availability);
  const benchComposition = structuredCorpusField(
    row.bench_composition ?? rowCorpusField(row, 'bench_composition'),
    source,
  );
  const hcCategoryDetails = structuredCorpusField(
    row.hc_category_details ?? rowCorpusField(row, 'hc_category_details'),
    source,
  );
  const lowerCourtReference = structuredCorpusField(
    row.lower_court_reference ?? rowCorpusField(row, 'lower_court_reference'),
    source,
  );
  const finalOrders = structuredCorpusField(
    row.final_orders ?? rowCorpusField(row, 'final_orders'),
    source,
  );
  const interimOrders = structuredCorpusField(
    row.interim_orders ?? rowCorpusField(row, 'interim_orders'),
    source,
  );
  const iaFilings = structuredCorpusField(
    row.ia_filings ?? rowCorpusField(row, 'ia_filings'),
    source,
  );
  const registryObjections = structuredCorpusField(
    row.registry_objections ?? rowCorpusField(row, 'registry_objections'),
    source,
  );
  const interlocutoryApplications = structuredCorpusField(
    row.interlocutory_applications ?? rowCorpusField(row, 'interlocutory_applications'),
    source,
  );
  const registryDefects = structuredCorpusField(
    row.registry_defects ?? rowCorpusField(row, 'registry_defects'),
    source,
  );
  const earlierCourtDetails = structuredCorpusField(
    row.earlier_court_details ?? rowCorpusField(row, 'earlier_court_details'),
    source,
  );
  const judicialSection =
    str(row.judicial_section) ?? str(rowCorpusField(row, 'judicial_section') as string);
  const coram = str(row.coram) ?? str(rowCorpusField(row, 'coram') as string);
  const caseCategory =
    str(row.case_category) ?? str(rowCorpusField(row, 'case_category') as string);

  const noteIfNotPublished = (fieldKey: string, note?: string): string | undefined => {
    if (notPublished.includes(fieldKey)) {
      return 'not published by this court source';
    }
    return note;
  };

  return {
    courtName: fv(courtName, courtName ? source : null, courtName ? 0.97 : 0),
    courtType: fv(
      courtLevelToType(row.court_level),
      row.court_level ? source : null,
      row.court_level ? 0.97 : 0,
    ),
    caseType: fv(
      str(row.case_type),
      str(row.case_type) ? source : null,
      str(row.case_type) ? 0.9 : 0,
      noteIfNotPublished('case_type'),
    ),
    caseNo: fv(
      str(row.case_number ?? row.case_number_display),
      str(row.case_number ?? row.case_number_display) ? source : null,
      str(row.case_number ?? row.case_number_display) ? 0.9 : 0,
    ),
    caseTitle: fv(
      buildCaseTitle(row),
      buildCaseTitle(row) ? source : null,
      buildCaseTitle(row) ? 0.95 : 0,
      noteIfNotPublished('case_title'),
    ),
    petitioner: fv(
      petitioners[0] ?? str(row.petitioner),
      petitioners.length || str(row.petitioner) ? source : null,
      petitioners.length || str(row.petitioner) ? 0.95 : 0,
    ),
    petitioners: fv(
      petitioners,
      petitioners.length ? source : null,
      petitioners.length ? 0.95 : 0,
    ),
    respondent: fv(
      respondents[0] ?? str(row.respondent),
      respondents.length || str(row.respondent) ? source : null,
      respondents.length || str(row.respondent) ? 0.95 : 0,
    ),
    respondents: fv(
      respondents,
      respondents.length ? source : null,
      respondents.length ? 0.95 : 0,
    ),
    judges: fv(judges, judges.length ? source : null, judges.length ? 0.85 : 0),
    decisionDate: fv(
      dateOnly(row.decision_date),
      row.decision_date ? source : null,
      row.decision_date ? 0.95 : 0,
    ),
    disposalNature: fv(
      rawDisposalNature,
      rawDisposalNature ? source : null,
      rawDisposalNature ? 0.8 : 0,
      disposalNatureNote,
    ),
    filingDate: fv(
      dateOnly(row.filing_date ?? row.registration_date),
      row.filing_date || row.registration_date ? source : null,
      row.filing_date || row.registration_date ? 0.8 : 0,
      row.filing_date || row.registration_date
        ? undefined
        : 'often absent in judgment metadata',
    ),
    registrationDate: fv(
      registrationDate,
      registrationDate ? source : null,
      registrationDate ? 0.8 : 0,
      noteIfNotPublished('registration_date', 'distinct from filing date when both published'),
    ),
    registrationNumber: fv(
      registrationNumber,
      registrationNumber ? source : null,
      registrationNumber ? 0.85 : 0,
      noteIfNotPublished('registration_number'),
    ),
    registrationYear: fv(
      registrationYear,
      registrationYear ? source : null,
      registrationYear ? 0.85 : 0,
      noteIfNotPublished('registration_year'),
    ),
    benchComposition,
    judicialSection: fv(
      judicialSection,
      judicialSection ? source : null,
      judicialSection ? 0.85 : 0,
      noteIfNotPublished('judicial_section'),
    ),
    coram: fv(
      coram,
      coram ? source : null,
      coram ? 0.85 : 0,
      noteIfNotPublished('coram'),
    ),
    hcCategoryDetails,
    lowerCourtReference,
    finalOrders,
    interimOrders,
    iaFilings,
    registryObjections,
    caseCategory: fv(
      caseCategory,
      caseCategory ? source : null,
      caseCategory ? 0.85 : 0,
      noteIfNotPublished('case_category'),
    ),
    interlocutoryApplications,
    registryDefects,
    earlierCourtDetails,
    summary: fv(
      summaryText,
      summaryText ? source : null,
      summaryText ? 0.7 : 0,
      !summaryText ? 'use document extract or manual entry' : undefined,
    ),
    partyDetails: fv(
      partyDetails,
      partyDetails.length ? source : null,
      partyDetails.length ? 0.9 : 0,
    ),
    filingNumber: fv(
      filingNumber,
      filingNumber ? source : null,
      filingNumber ? 0.85 : 0,
      noteIfNotPublished('filing_number'),
    ),
    filingNumberYear: fv(
      filingNumberYear,
      filingNumberYear ? source : null,
      filingNumberYear ? 0.85 : 0,
      noteIfNotPublished('filing_number_year'),
    ),
    nextHearingDate: fv(
      nextHearing,
      nextHearing ? source : null,
      nextHearing ? 0.75 : 0,
      nextHearing ? undefined : 'requires live docket — not in corpus v1',
    ),
    firstHearingDate: fv(
      firstHearingDate,
      firstHearingDate ? source : null,
      firstHearingDate ? 0.75 : 0,
      noteIfNotPublished('first_hearing_date'),
    ),
    currentPurpose: fv(
      currentPurpose,
      currentPurpose ? source : null,
      currentPurpose ? 0.75 : 0,
      noteIfNotPublished('current_purpose'),
    ),
    policeStation: fv(
      policeStation,
      policeStation ? source : null,
      policeStation ? 0.75 : 0,
      row.fir_no && !row.police_station
        ? 'FIR reference only — full police station name may require PDF extract'
        : undefined,
    ),
    firNo: fv(firNo, firNo ? source : null, firNo ? 0.8 : 0, noteIfNotPublished('fir_no')),
    firYear: fv(firYear, firYear ? source : null, firYear ? 0.8 : 0, noteIfNotPublished('fir_year')),
    jurisdiction: fv(
      str(row.jurisdiction),
      str(row.jurisdiction) ? source : null,
      str(row.jurisdiction) ? 0.9 : 0,
    ),
    stateName: fv(
      str(row.state_name),
      str(row.state_name) ? source : null,
      str(row.state_name) ? 0.9 : 0,
    ),
    districtName: fv(
      str(row.district_name),
      str(row.district_name) ? source : null,
      str(row.district_name) ? 0.9 : 0,
    ),
    bench: fv(str(row.bench), str(row.bench) ? source : null, str(row.bench) ? 0.85 : 0),
    complexName: fv(
      complexName,
      complexName ? source : null,
      complexName ? 0.85 : 0,
      noteIfNotPublished('complex_name'),
    ),
    citation: fv(
      citation,
      citation ? source : null,
      citation ? 0.9 : 0,
      noteIfNotPublished('citation'),
    ),
    hearings: fv(
      timeline,
      timeline.length ? source : null,
      timeline.length ? 0.85 : 0,
    ),
    caseStatus: fv(
      caseStatus,
      caseStatus ? source : null,
      caseStatus ? 0.7 : 0,
      caseStatusNote ??
        (caseStatus === 'DISPOSED'
          ? 'inferred from disposal / decision date when present'
          : undefined),
    ),
    linkedMatters: fv(
      linkedMatters,
      linkedMatters.length ? source : null,
      linkedMatters.length ? 0.75 : 0,
      linkedMatters.length ? undefined : 'no linked/connected matters published for this row',
    ),
    incidentDate: fv(
      incidentDate,
      incidentDate ? source : null,
      incidentDate ? 0.7 : 0,
      incidentDate
        ? undefined
        : 'FIR/incident date not published in corpus (distinct from firYear); manual/PDF extract',
    ),
    courtCode: fv(courtCode, courtCode ? source : null, courtCode ? 0.85 : 0),
    complexCode: fv(complexCode, complexCode ? source : null, complexCode ? 0.85 : 0),
    caseTypeDisplay: fv(null, null, 0, 'derived at prefill from nv_case_type_codes when available'),
    actsSections: actsFieldValue(
      extractActsFromCaseRow(row),
      source,
      row.counts?.acts,
    ),
    advocates: fv(
      advocates,
      advocates.length ? source : null,
      advocates.length ? 0.7 : 0,
    ),
  };
}

export function mapCaseApiToCnrResolveData(input: {
  cnr: string;
  caseRow: CaseApiCase;
  latencyMs: number;
  wantCaseCreate?: boolean;
  includeDocuments?: boolean;
  /** Attach machine-readable NSP parse contract to data.nspParseGuide (§21). */
  includeParseGuide?: boolean;
}): CnrResolveData {
  const { cnr: inputCnr, caseRow, latencyMs, wantCaseCreate, includeDocuments } = input;
  const source = resolveSourceTag(caseRow);
  const extracted = extractCnrFromCaseRow(caseRow, inputCnr);
  const inputNormalized = normalizeCnrInput(inputCnr);
  const inputLooksLikeCnr = looksLikeIndianCnr(inputNormalized);
  const resolvedCnr = extracted.cnr || (inputLooksLikeCnr ? inputNormalized : '');
  const fieldsCnrExtract: CaseApiCnrExtract = extracted.cnr
    ? extracted
    : resolvedCnr
      ? { cnr: resolvedCnr, sourceField: 'input', confidence: 0.97 }
      : extracted;
  const sourceArchive = courtLevelToArchive(caseRow.court_level);
  const documents =
    includeDocuments === false ? [] : documentsFromCase(caseRow, sourceArchive);

  const data: CnrResolveData = {
    cnr: resolvedCnr,
    status: 'found',
    matchType: 'exact',
    source,
    sourcesTried: ['nys_case_api', caseRow.provenance?.backend ?? 'case_api'].filter(
      Boolean,
    ) as string[],
    confidence: resolvedCnr ? (extracted.confidence || 0.97) : 0.97,
    claimEcourts: false,
    validation: 'ok',
    ui: {
      badge: 'Suggested · Judgment corpus',
      subtitle:
        'From JRX-Search case-api index — not live eCourts status',
    },
    fields: {
      ...buildFields(caseRow, source),
      cnr: cnrFieldValue(fieldsCnrExtract, source),
    },
    documents,
    candidates: [],
    cnrSynthetic: caseRow.cnr_is_synthetic ?? false,
    meta: buildCaseApiMeta(source, latencyMs, caseRow),
  };

  if (wantCaseCreate) {
    data.caseCreate = buildCaseCreateProfile(resolvedCnr, caseRow, source);
  }

  if (input.includeParseGuide) {
    data.nspParseGuide = buildNspParseGuide();
  }

  return data;
}

export function mapCaseApiDiaryToCnrResolveData(input: {
  diaryNumber: string;
  caseRow: CaseApiCase;
  latencyMs: number;
  wantCaseCreate?: boolean;
  includeDocuments?: boolean;
}): CaseApiDiaryResolveData {
  const extracted = extractCnrFromCaseRow(input.caseRow);
  const cnr = extracted.cnr;
  const base = mapCaseApiToCnrResolveData({
    cnr,
    caseRow: input.caseRow,
    latencyMs: input.latencyMs,
    wantCaseCreate: input.wantCaseCreate,
    includeDocuments: input.includeDocuments,
  });
  const diaryField = fv(input.diaryNumber, base.source, 0.97);
  const cnrField =
    cnr.length > 0
      ? cnrFieldValue(extracted, base.source ?? 'nys_case_api')
      : fv('', base.source, 0, 'CNR not published for pending SC diary in judgment corpus');
  return {
    ...base,
    cnr,
    confidence: cnr ? extracted.confidence : base.confidence,
    lookupType: 'diary',
    diaryNumber: input.diaryNumber,
    fields: {
      ...(base.fields ?? {}),
      cnr: cnrField,
      diaryNumber: diaryField,
    },
    ui: {
      badge: 'Suggested · Judgment corpus',
      subtitle: 'From JRX-Search case-api diary index — not live eCourts status',
    },
  };
}

export function mapCaseApiDiaryNotFound(
  diaryNumber: string,
  latencyMs: number,
): CaseApiDiaryResolveData {
  return {
    ...mapCaseApiNotFound(diaryNumber, latencyMs),
    cnr: '',
    lookupType: 'diary',
    diaryNumber,
    ui: {
      badge: 'Suggested · Judgment corpus',
      subtitle: 'Diary not in JRX-Search case-api corpus',
    },
  };
}

export function mapCaseApiNotFound(cnr: string, latencyMs: number): CnrResolveData {
  return {
    cnr,
    status: 'not_found',
    matchType: 'none',
    source: null,
    sourcesTried: ['nys_case_api'],
    confidence: 0,
    claimEcourts: false,
    validation: 'ok',
    ui: {
      badge: 'Suggested · Judgment corpus',
      subtitle: 'CNR not in JRX-Search case-api corpus',
    },
    fields: null,
    documents: [],
    candidates: [],
    meta: buildCaseApiMeta(null, latencyMs),
  };
}

async function resolveCaseApiCnrRow(input: {
  cnr: string;
  caseRow: CaseApiCase;
  latencyMs: number;
  wantCaseCreate?: boolean;
  includeDocuments?: boolean;
  includeTimeline?: boolean;
}): Promise<CnrResolveData> {
  const mapped = mapCaseApiToCnrResolveData({
    cnr: input.cnr,
    caseRow: input.caseRow,
    latencyMs: input.latencyMs,
    wantCaseCreate: input.wantCaseCreate,
    includeDocuments: input.includeDocuments,
  });
  return enrichCaseApiResolveData({
    data: mapped,
    caseRow: input.caseRow,
    wantCaseCreate: input.wantCaseCreate,
    includeDocuments: input.includeDocuments,
    includeTimeline: input.includeTimeline,
  });
}

/** Shared case-api CNR lookup for POST resolve and GET :cnr (P2 cutover). */
export async function lookupCnrViaCaseApi(input: {
  cnr: string;
  courtType?: CaseApiCourtLevel;
  /** True when partner explicitly sent options.courtType (not inference). */
  explicitCourtType?: boolean;
  wantCaseCreate?: boolean;
  includeDocuments?: boolean;
  includeTimeline?: boolean;
}): Promise<CaseApiCnrLookupResult> {
  const cnr = normalizeCnrInput(input.cnr);
  if (!cnr) {
    return { kind: 'fallback', status: 400, error: 'missing_cnr' };
  }

  let caseApiResult: CaseApiFetchResult;
  let caseApiData: CnrResolveData | null = null;

  if (!input.explicitCourtType && isB9DuplicateRiskCnr(cnr)) {
    const [hcResult, dcResult] = await Promise.all([
      fetchCaseByCnr(cnr, 'HC'),
      fetchCaseByCnr(cnr, 'DC'),
    ]);

    if (hcResult.ok && dcResult.ok) {
      return {
        kind: 'resolved',
        data: mapCaseApiSuggestedResolve({
          cnr,
          rows: [
            { courtLevel: 'HC', caseRow: hcResult.case, latencyMs: hcResult.latencyMs },
            { courtLevel: 'DC', caseRow: dcResult.case, latencyMs: dcResult.latencyMs },
          ],
        }),
      };
    }

    if (hcResult.ok) {
      caseApiResult = hcResult;
    } else if (dcResult.ok) {
      caseApiResult = dcResult;
    } else {
      caseApiResult =
        hcResult.status === 404 && dcResult.status === 404
          ? hcResult
          : hcResult.status !== 404
            ? hcResult
            : dcResult;
    }
  } else {
    caseApiResult = await fetchCaseByCnr(cnr, input.courtType);
  }

  if (caseApiResult.ok) {
    caseApiData = await resolveCaseApiCnrRow({
      cnr,
      caseRow: caseApiResult.case,
      latencyMs: caseApiResult.latencyMs,
      wantCaseCreate: input.wantCaseCreate,
      includeDocuments: input.includeDocuments,
      includeTimeline: input.includeTimeline,
    });
  } else if (caseApiResult.status === 404) {
    caseApiData = mapCaseApiNotFound(cnr, caseApiResult.latencyMs);
  }

  if (caseApiData && (caseApiData.status === 'found' || caseApiData.status === 'not_found')) {
    return { kind: 'resolved', data: caseApiData };
  }

  if (!caseApiResult.ok && shouldFallbackToLegacyCnr(caseApiResult.status)) {
    return {
      kind: 'fallback',
      status: caseApiResult.status,
      error: caseApiResult.error,
    };
  }

  if (!caseApiResult.ok) {
    return {
      kind: 'upstream_error',
      status: caseApiResult.status >= 400 ? caseApiResult.status : 502,
      error: caseApiResult.error,
    };
  }

  return { kind: 'fallback', status: 502, error: 'unexpected_case_api_state' };
}

/** Diary search via GET /v1/cases?diary_no= — P2 cutover for NSP slash diaries. */
export async function lookupDiaryViaCaseApi(input: {
  diaryNumber: string;
  courtType?: string | null;
  wantCaseCreate?: boolean;
  includeDocuments?: boolean;
}): Promise<CaseApiCnrLookupResult> {
  const rawDiary = input.diaryNumber.trim();
  if (!rawDiary) {
    return { kind: 'fallback', status: 400, error: 'missing_diary' };
  }

  const diaryNumber = normalizeDiaryNumber(rawDiary);

  // NV-DIARY-COURT-DEFAULT-001: slash SC diaries (e.g. 17329/2025) must not fall back to legacy.
  const courtType = parseCaseApiCourtType(input.courtType) ?? 'SC';

  const search = await fetchCasesSearch({
    court_type: courtType,
    diary_no: diaryNumber,
    page: '1',
    page_size: '5',
    want_total: 'false',
  });

  if (!search.ok) {
    if (shouldFallbackToLegacyDiary(search.status)) {
      return { kind: 'fallback', status: search.status, error: search.error };
    }
    return {
      kind: 'upstream_error',
      status: search.status >= 400 ? search.status : 502,
      error: search.error,
    };
  }

  const cases = search.body.cases ?? [];
  const caseRow =
    cases.find((row) => str(row.diary_no) === diaryNumber) ??
    cases[0] ??
    null;

  if (!caseRow) {
    // Legacy RDS may still match INSC / alternate case_no shapes.
    return { kind: 'fallback', status: 404, error: 'diary_not_in_case_api' };
  }

  const mapped = mapCaseApiDiaryToCnrResolveData({
    diaryNumber,
    caseRow,
    latencyMs: search.latencyMs,
    wantCaseCreate: input.wantCaseCreate,
    includeDocuments: input.includeDocuments,
  });
  const enriched = await enrichCaseApiResolveData({
    data: mapped,
    caseRow,
    wantCaseCreate: input.wantCaseCreate,
    includeDocuments: input.includeDocuments,
    diaryNumber,
    courtType,
  });
  return {
    kind: 'resolved',
    data: {
      ...enriched,
      lookupType: 'diary',
      diaryNumber,
    } as CaseApiDiaryResolveData,
  };
}

/** Returns true when legacy fallback should run (upstream miss, auth, timeout, or rate-limit). */
export function shouldFallbackToLegacyCnr(status: number): boolean {
  return status === 404 || status === 401 || status === 429 || status === 504 || status === 503;
}

/** Diary search may 400 on INSC-shaped ids — always fall back to legacy RDS. */
export function shouldFallbackToLegacyDiary(status: number): boolean {
  return shouldFallbackToLegacyCnr(status) || status === 400 || status === 422;
}

export async function fetchCaseByCnr(
  cnr: string,
  courtType?: CaseApiCourtLevel,
): Promise<CaseApiFetchResult> {
  const t0 = Date.now();
  if (!isCaseApiConfigured()) {
    return { ok: false, status: 503, error: 'JRX_ECOSYSTEM_CASE_API not configured', latencyMs: 0 };
  }

  const base = caseApiBaseUrl();
  const key = (process.env.JRX_ECOSYSTEM_CASE_API_KEY ?? '').trim();
  const params = new URLSearchParams();
  const ct = courtType ?? inferCourtTypeFromCnr(cnr);
  if (ct) params.set('court_type', ct);
  const qs = params.toString();
  const url = `${base}/v1/cases/${encodeURIComponent(cnr)}${qs ? `?${qs}` : ''}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), caseApiTimeoutMs());

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-Key': key,
      },
      signal: controller.signal,
    });
    const latencyMs = Date.now() - t0;
    const text = await res.text();
    let body: CaseApiLookupResponse = {};
    try {
      body = JSON.parse(text) as CaseApiLookupResponse;
    } catch {
      return {
        ok: false,
        status: res.status,
        error: 'non_json_response',
        latencyMs,
      };
    }

    if (res.status === 404 || body.error === 'not_found') {
      return { ok: false, status: 404, error: 'not_found', latencyMs };
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: body.error ?? body.detail ?? `http_${res.status}`,
        latencyMs,
      };
    }

    const caseRow = body.case;
    if (!caseRow || typeof caseRow !== 'object') {
      return { ok: false, status: 502, error: 'missing_case_object', latencyMs };
    }

    return { ok: true, status: 200, case: caseRow, latencyMs };
  } catch (err: unknown) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = /abort|timeout/i.test(msg);
    return {
      ok: false,
      status: isTimeout ? 504 : 502,
      error: isTimeout ? 'timeout' : msg,
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchCasesSearch(
  query: Record<string, string | undefined>,
): Promise<CaseApiSearchResult> {
  const t0 = Date.now();
  if (!isCaseApiConfigured()) {
    return { ok: false, status: 503, error: 'JRX_ECOSYSTEM_CASE_API not configured', latencyMs: 0 };
  }

  const base = caseApiBaseUrl();
  const key = (process.env.JRX_ECOSYSTEM_CASE_API_KEY ?? '').trim();
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== '') params.set(k, v);
  }
  const qs = params.toString();
  const url = `${base}/v1/cases${qs ? `?${qs}` : ''}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), caseApiTimeoutMs());

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-Key': key,
      },
      signal: controller.signal,
    });
    const latencyMs = Date.now() - t0;
    const text = await res.text();
    let body: CaseApiSearchResponse = {};
    try {
      body = JSON.parse(text) as CaseApiSearchResponse;
    } catch {
      return {
        ok: false,
        status: res.status,
        error: 'non_json_response',
        latencyMs,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: body.error ?? body.detail ?? `http_${res.status}`,
        latencyMs,
      };
    }

    return { ok: true, status: 200, body, latencyMs };
  } catch (err: unknown) {
    const latencyMs = Date.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = /abort|timeout/i.test(msg);
    return {
      ok: false,
      status: isTimeout ? 504 : 502,
      error: isTimeout ? 'timeout' : msg,
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Log shadow diff between case-api and legacy payloads (no secret values). */
export function logCaseApiShadowDiff(
  cnr: string,
  caseApiStatus: string | null,
  legacyStatus: string | null,
  caseApiHearings: number,
  legacyHearings: number,
): void {
  logger.info('[CNR] case-api shadow diff', {
    cnr,
    caseApiStatus,
    legacyStatus,
    caseApiHearings,
    legacyHearings,
    statusMatch: caseApiStatus === legacyStatus,
  });
}
