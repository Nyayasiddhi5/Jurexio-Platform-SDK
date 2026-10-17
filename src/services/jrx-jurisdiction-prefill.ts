/**
 * NV-CASE-MASTER-DATA-001 — jurisdiction master prefill for CNR resolve.
 *
 * Fills ONLY empty resolve fields (courtType / courtName / stateName /
 * districtName / complexName) from the static NYV jurisdiction master tables
 * (nv_cnr_prefix_rules, nv_court_jurisdictions, nv_district_master,
 * nv_case_type_codes). These are deterministic reference joins — they NEVER
 * set claimEcourts and NEVER overwrite a non-empty corpus value. Prefilled
 * values carry source:"nyv_master" + a note so NSP can distinguish
 * reference-derived from corpus-published.
 *
 * Ref: documents/working/NYV-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md Appendix F.
 */
import { pool } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import type { CnrResolveData, CnrFieldValue } from '../../packages/client-sdk/src/api/CnrApi.js';

const logger = createLogger('./jrx-jurisdiction-prefill');

export const PREFILL_SOURCE = 'nyv_master';
const PREFILL_CONFIDENCE = 0.8;
const PREFILL_NOTE =
  'prefilled from NYV jurisdiction master (reference join, not live eCourts)';

/** eCourts CNR positions 1–2 (state code) → canonical state name. */
const STATE_CODE_TO_NAME: Record<string, string> = {
  SC: 'National',
  AP: 'Andhra Pradesh',
  TS: 'Telangana',
  DL: 'Delhi',
  MH: 'Maharashtra',
  KA: 'Karnataka',
  TN: 'Tamil Nadu',
  KL: 'Kerala',
  UP: 'Uttar Pradesh',
  GJ: 'Gujarat',
  WB: 'West Bengal',
  MP: 'Madhya Pradesh',
  RJ: 'Rajasthan',
  PB: 'Punjab & Haryana',
  BR: 'Bihar',
  OD: 'Odisha',
  CG: 'Chhattisgarh',
  AS: 'Assam',
  HP: 'Himachal Pradesh',
  JK: 'Jammu & Kashmir',
  JH: 'Jharkhand',
  MN: 'Manipur',
  ML: 'Meghalaya',
  SK: 'Sikkim',
  TR: 'Tripura',
  UK: 'Uttarakhand',
};

export interface CnrPrefixRuleRow {
  cnrPrefix: string;
  stateCode: string;
  courtTier: string;
  /** 'HC' | 'SC' | 'DC' */
  courtType: string;
  benchCode: string | null;
  establishment: string | null;
}

export interface CourtJurisdictionRow {
  benchCode: string;
  courtName: string;
  courtType: string;
  stateName: string | null;
}

export interface DistrictRow {
  stateCode: string;
  districtCode: string;
  districtName: string;
  defaultComplex: string | null;
}

/** NV-DC-ESTAB-CROSSWALK-001 — CNR letters → eCourts numeric codes + names. */
export interface EstablishmentCrosswalkRow {
  stateLetters: string;
  estabLetters: string;
  stateCode: string | null;
  districtCode: string | null;
  complexCode: string | null;
  courtCode: string | null;
  stateName: string | null;
  districtName: string | null;
  complexName: string | null;
}

/** Read surface over the master tables — DB-backed at runtime, in-memory in tests. */
export interface JurisdictionMasterProvider {
  getPrefixRule(prefix: string): Promise<CnrPrefixRuleRow | null>;
  getJurisdiction(benchCode: string): Promise<CourtJurisdictionRow | null>;
  getDistrict(stateCode: string, districtCode: string): Promise<DistrictRow | null>;
  getCaseTypeDisplay(
    code: string,
    courtType: string,
    stateCode: string,
  ): Promise<string | null>;
  /** DC establishment crosswalk (CNR letters → eCourts numeric codes). Optional. */
  getEstablishmentCrosswalk?(
    stateLetters: string,
    estabLetters: string,
  ): Promise<EstablishmentCrosswalkRow | null>;
}

export interface PrefillInput {
  cnr: string;
  courtType?: string | null;
  courtName?: string | null;
  stateName?: string | null;
  districtName?: string | null;
  complexName?: string | null;
  bench?: string | null;
  caseType?: string | null;
}

export interface PrefillOutput {
  courtType?: string;
  courtName?: string;
  stateName?: string;
  districtName?: string;
  complexName?: string;
  /** eCourts numeric codes from the DC establishment crosswalk (NV-DC-ESTAB-CROSSWALK-001). */
  courtCode?: string;
  complexCode?: string;
  /** P1 — computed for callers; not yet written as a dedicated resolve field. */
  caseTypeDisplay?: string;
  filledKeys: string[];
}

function isEmpty(v: string | null | undefined): boolean {
  return v === null || v === undefined || String(v).trim() === '';
}

function courtTierToType(raw: string): 'sc' | 'hc' | 'dc' | null {
  switch (raw.trim().toUpperCase()) {
    case 'HC':
      return 'hc';
    case 'SC':
      return 'sc';
    case 'DC':
      return 'dc';
    default:
      return null;
  }
}

function markFilled(out: PrefillOutput, key: string): void {
  if (!out.filledKeys.includes(key)) out.filledKeys.push(key);
}

/**
 * Prefill algorithm (Appendix F.3). Pure given a provider — fills only empty
 * inputs and never overwrites a non-empty corpus value.
 */
export async function resolvePrefill(
  input: PrefillInput,
  provider: JurisdictionMasterProvider,
): Promise<PrefillOutput> {
  const out: PrefillOutput = { filledKeys: [] };
  const cnr = String(input.cnr ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (cnr.length < 4) return out;

  const rule =
    (await provider.getPrefixRule(cnr.slice(0, 6))) ??
    (await provider.getPrefixRule(cnr.slice(0, 4)));

  let courtType = input.courtType ?? null;
  let courtName = input.courtName ?? null;
  let stateName = input.stateName ?? null;
  let districtName = input.districtName ?? null;

  if (rule) {
    if (isEmpty(courtType)) {
      const t = courtTierToType(rule.courtType);
      if (t) {
        out.courtType = t;
        markFilled(out, 'courtType');
        courtType = t;
      }
    }
    if (isEmpty(stateName)) {
      const sn = STATE_CODE_TO_NAME[rule.stateCode];
      if (sn) {
        out.stateName = sn;
        markFilled(out, 'stateName');
        stateName = sn;
      }
    }
    if (isEmpty(courtName) && !isEmpty(rule.establishment)) {
      out.courtName = rule.establishment as string;
      markFilled(out, 'courtName');
      courtName = rule.establishment;
    }
  }

  const bench = String(input.bench ?? '').trim().toLowerCase();
  if (bench) {
    const j = await provider.getJurisdiction(bench);
    if (j) {
      if (isEmpty(courtName) && !isEmpty(j.courtName)) {
        out.courtName = j.courtName;
        markFilled(out, 'courtName');
        courtName = j.courtName;
      }
      if (isEmpty(stateName) && !isEmpty(j.stateName)) {
        out.stateName = j.stateName as string;
        markFilled(out, 'stateName');
        stateName = j.stateName;
      }
      if (isEmpty(courtType)) {
        const t = courtTierToType(j.courtType);
        if (t) {
          out.courtType = t;
          markFilled(out, 'courtType');
          courtType = t;
        }
      }
    }
  }

  const effectiveType = courtType ?? (rule ? courtTierToType(rule.courtType) : null);

  if (effectiveType === 'dc') {
    // Appendix F.3 — for DC rows, court_tier holds the district/establishment
    // code (eCourts CNR positions 3–4); join nv_district_master on it.
    const stateLetters = rule?.stateCode ?? cnr.slice(0, 2);
    const estabLetters = rule?.courtTier ?? cnr.slice(2, 4);

    if (rule && isEmpty(districtName)) {
      const d = await provider.getDistrict(rule.stateCode, rule.courtTier);
      if (d) {
        out.districtName = d.districtName;
        markFilled(out, 'districtName');
        districtName = d.districtName;
        if (isEmpty(input.complexName) && !isEmpty(d.defaultComplex)) {
          out.complexName = d.defaultComplex as string;
          markFilled(out, 'complexName');
        }
      }
    }

    // NV-DC-ESTAB-CROSSWALK-001 — CNR letters → eCourts numeric codes (+ name fallback).
    if (provider.getEstablishmentCrosswalk && stateLetters && estabLetters) {
      const x = await provider.getEstablishmentCrosswalk(stateLetters, estabLetters);
      if (x) {
        if (!isEmpty(x.courtCode)) {
          out.courtCode = x.courtCode as string;
          markFilled(out, 'courtCode');
        }
        if (!isEmpty(x.complexCode)) {
          out.complexCode = x.complexCode as string;
          markFilled(out, 'complexCode');
        }
        if (isEmpty(districtName) && !isEmpty(x.districtName)) {
          out.districtName = x.districtName as string;
          markFilled(out, 'districtName');
          districtName = x.districtName;
        }
        if (isEmpty(input.complexName) && isEmpty(out.complexName) && !isEmpty(x.complexName)) {
          out.complexName = x.complexName as string;
          markFilled(out, 'complexName');
        }
      }
    }
  }

  if (!isEmpty(input.caseType) && effectiveType) {
    const disp = await provider.getCaseTypeDisplay(
      String(input.caseType).trim(),
      effectiveType.toUpperCase(),
      rule?.stateCode ?? '',
    );
    if (disp) {
      out.caseTypeDisplay = disp;
      markFilled(out, 'caseTypeDisplay');
    }
  }

  return out;
}

// ── DB-backed provider (runtime) ─────────────────────────────────────────────

function isPrefillDisabled(): boolean {
  const flag = (process.env.JRX_F_CNR_MASTER_PREFILL ?? '').trim().toLowerCase();
  return flag === '0' || flag === 'false' || flag === 'off' || flag === 'no';
}

function isTestEnv(): boolean {
  return process.env.VITEST !== undefined || process.env.NODE_ENV === 'test';
}

/** Build a DB-backed provider over the shared pool. Returns null when no pool. */
export function createDbJurisdictionMasterProvider(): JurisdictionMasterProvider | null {
  if (!pool) return null;
  const p = pool;
  const prefixCache = new Map<string, CnrPrefixRuleRow | null>();
  const benchCache = new Map<string, CourtJurisdictionRow | null>();

  return {
    async getPrefixRule(prefix: string): Promise<CnrPrefixRuleRow | null> {
      if (prefixCache.has(prefix)) return prefixCache.get(prefix) ?? null;
      const r = await p.query(
        `SELECT cnr_prefix, state_code, court_tier, court_type, bench_code, establishment
           FROM public.nv_cnr_prefix_rules WHERE cnr_prefix = $1`,
        [prefix],
      );
      const row = r.rows?.[0];
      const mapped: CnrPrefixRuleRow | null = row
        ? {
            cnrPrefix: String(row.cnr_prefix),
            stateCode: String(row.state_code),
            courtTier: String(row.court_tier),
            courtType: String(row.court_type),
            benchCode: row.bench_code != null ? String(row.bench_code) : null,
            establishment: row.establishment != null ? String(row.establishment) : null,
          }
        : null;
      prefixCache.set(prefix, mapped);
      return mapped;
    },
    async getJurisdiction(benchCode: string): Promise<CourtJurisdictionRow | null> {
      if (benchCache.has(benchCode)) return benchCache.get(benchCode) ?? null;
      const r = await p.query(
        `SELECT bench_code, court_name, court_type, state_name
           FROM public.nv_court_jurisdictions WHERE bench_code = $1`,
        [benchCode],
      );
      const row = r.rows?.[0];
      const mapped: CourtJurisdictionRow | null = row
        ? {
            benchCode: String(row.bench_code),
            courtName: String(row.court_name),
            courtType: String(row.court_type),
            stateName: row.state_name != null ? String(row.state_name) : null,
          }
        : null;
      benchCache.set(benchCode, mapped);
      return mapped;
    },
    async getDistrict(
      stateCode: string,
      districtCode: string,
    ): Promise<DistrictRow | null> {
      const r = await p.query(
        `SELECT state_code, district_code, district_name, default_complex
           FROM public.nv_district_master WHERE state_code = $1 AND district_code = $2`,
        [stateCode, districtCode],
      );
      const row = r.rows?.[0];
      if (!row) return null;
      return {
        stateCode: String(row.state_code),
        districtCode: String(row.district_code),
        districtName: String(row.district_name),
        defaultComplex: row.default_complex != null ? String(row.default_complex) : null,
      };
    },
    async getCaseTypeDisplay(
      code: string,
      courtType: string,
      stateCode: string,
    ): Promise<string | null> {
      // Prefer a state-specific row, then the state-agnostic ('') row.
      const r = await p.query(
        `SELECT display_name
           FROM public.nv_case_type_codes
          WHERE code = $1 AND court_type = $2 AND state_code IN ($3, '')
          ORDER BY (state_code = $3) DESC
          LIMIT 1`,
        [code, courtType, stateCode],
      );
      const row = r.rows?.[0];
      return row?.display_name != null ? String(row.display_name) : null;
    },
    async getEstablishmentCrosswalk(
      stateLetters: string,
      estabLetters: string,
    ): Promise<EstablishmentCrosswalkRow | null> {
      const r = await p.query(
        `SELECT state_letters, estab_letters, state_code, district_code,
                complex_code, court_code, state_name, district_name, complex_name
           FROM public.nv_dc_establishment_crosswalk
          WHERE state_letters = $1 AND estab_letters = $2`,
        [stateLetters.toUpperCase(), estabLetters.toUpperCase()],
      );
      const row = r.rows?.[0];
      if (!row) return null;
      return {
        stateLetters: String(row.state_letters),
        estabLetters: String(row.estab_letters),
        stateCode: row.state_code != null ? String(row.state_code) : null,
        districtCode: row.district_code != null ? String(row.district_code) : null,
        complexCode: row.complex_code != null ? String(row.complex_code) : null,
        courtCode: row.court_code != null ? String(row.court_code) : null,
        stateName: row.state_name != null ? String(row.state_name) : null,
        districtName: row.district_name != null ? String(row.district_name) : null,
        complexName: row.complex_name != null ? String(row.complex_name) : null,
      };
    },
  };
}

let cachedDefaultProvider: JurisdictionMasterProvider | null | undefined;

function getDefaultProvider(): JurisdictionMasterProvider | null {
  if (isTestEnv() || isPrefillDisabled()) return null;
  if (cachedDefaultProvider === undefined) {
    cachedDefaultProvider = createDbJurisdictionMasterProvider();
  }
  return cachedDefaultProvider;
}

/**
 * Apply master prefill to a resolved CNR envelope. No-op when no provider is
 * available (tests / no DB / feature disabled) or when nothing needs filling.
 * Wire this AFTER the adapter buildFields() step (NV-CASE-MASTER-DATA-001).
 */
export async function applyJurisdictionPrefill(
  data: CnrResolveData,
  cnr: string,
  provider: JurisdictionMasterProvider | null = getDefaultProvider(),
): Promise<CnrResolveData> {
  if (!provider) return data;
  if (data.status !== 'found' || !data.fields) return data;

  const fields = data.fields;
  const cur = (key: string): string | null => {
    const v = fields[key]?.value;
    if (v === null || v === undefined) return null;
    return typeof v === 'string' ? v : String(v);
  };

  const input: PrefillInput = {
    cnr,
    courtType: cur('courtType'),
    courtName: cur('courtName'),
    stateName: cur('stateName'),
    districtName: cur('districtName'),
    complexName: cur('complexName'),
    bench: cur('bench'),
    caseType: cur('caseType'),
  };

  let out: PrefillOutput;
  try {
    out = await resolvePrefill(input, provider);
  } catch (err) {
    logger.warn('[prefill] jurisdiction master lookup failed', {
      cnr,
      err: err instanceof Error ? err.message : String(err),
    });
    return data;
  }

  if (out.filledKeys.length === 0) return data;

  const newFields: Record<string, CnrFieldValue> = { ...fields };
  const valueByKey: Record<string, string | undefined> = {
    courtType: out.courtType,
    courtName: out.courtName,
    stateName: out.stateName,
    districtName: out.districtName,
    complexName: out.complexName,
    courtCode: out.courtCode,
    complexCode: out.complexCode,
    caseTypeDisplay: out.caseTypeDisplay,
  };
  for (const key of out.filledKeys) {
    const val = valueByKey[key];
    if (val === undefined) continue;
    newFields[key] = {
      value: val,
      source: PREFILL_SOURCE,
      confidence: PREFILL_CONFIDENCE,
      note: PREFILL_NOTE,
    };
  }

  const sourcesTried = data.sourcesTried.includes(PREFILL_SOURCE)
    ? data.sourcesTried
    : [...data.sourcesTried, PREFILL_SOURCE];

  return { ...data, fields: newFields, sourcesTried };
}
