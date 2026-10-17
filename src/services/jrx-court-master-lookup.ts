/**
 * NV-COURT-MASTER-P0-001 — jurisdiction cascade lookup service.
 *
 * Read surface over the NYV court-master reference tables that powers the
 * eCourts/NSP-style cascade: court type → state → district → complex → case
 * type. Backs the partner lookup routes in src/routes/jrx-court-master-routes.ts.
 *
 *   - court types  → static { sc | hc | dc }
 *   - states       → nv_court_jurisdictions (HC/SC) or nv_court_complexes (DC)
 *   - districts     → nv_court_complexes (DC focus, P0)
 *   - complexes     → nv_court_complexes (DC focus, P0)
 *   - case types    → nv_case_type_codes (per tier, optional state)
 *
 * These are deterministic static reference joins — they NEVER claim live
 * eCourts. The DB-backed provider is swappable for tests via
 * __setCourtMasterProviderForTests().
 *
 * Ref: NYV-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md Appendix F.5;
 *      NSP-CASE-SEARCH-INTEGRATION-2026-09.md §18.
 */
import { pool } from '../db/index.js';

export type CourtTypeCode = 'sc' | 'hc' | 'dc';

export interface CourtTypeEntry {
  code: CourtTypeCode;
  name: string;
}

export interface StateEntry {
  /** eCourts numeric state code (DC) or the state name itself (HC/SC). */
  code: string;
  name: string;
}

export interface DistrictEntry {
  code: string;
  name: string;
}

export interface ComplexEntry {
  code: string;
  name: string;
  /** Comma-separated eCourts court numbers within the complex, when known. */
  courtNumbers: string | null;
}

export interface CaseTypeEntry {
  code: string;
  displayName: string;
  /** '' = applies to any state. */
  stateCode: string;
}

/** Read surface over the court-master tables — DB-backed at runtime, in-memory in tests. */
export interface CourtMasterProvider {
  listCourtTypes(): Promise<CourtTypeEntry[]>;
  listStates(courtType: CourtTypeCode): Promise<StateEntry[]>;
  listDistricts(courtType: CourtTypeCode, state: string): Promise<DistrictEntry[]>;
  listComplexes(
    courtType: CourtTypeCode,
    state: string,
    district: string,
  ): Promise<ComplexEntry[]>;
  listCaseTypes(courtType: CourtTypeCode, state?: string): Promise<CaseTypeEntry[]>;
}

export const COURT_TYPES: CourtTypeEntry[] = [
  { code: 'sc', name: 'Supreme Court' },
  { code: 'hc', name: 'High Court' },
  { code: 'dc', name: 'District Court' },
];

/** Normalise an arbitrary caller string to one of the three court-type codes. */
export function parseCourtType(raw: unknown): CourtTypeCode | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'sc' || v === 'hc' || v === 'dc') return v;
  return null;
}

// ── DB-backed provider (runtime) ─────────────────────────────────────────────

/** Build a DB-backed provider over the shared pool. Returns null when no pool. */
export function createDbCourtMasterProvider(): CourtMasterProvider | null {
  if (!pool) return null;
  const p = pool;

  return {
    async listCourtTypes(): Promise<CourtTypeEntry[]> {
      return COURT_TYPES;
    },

    async listStates(courtType: CourtTypeCode): Promise<StateEntry[]> {
      if (courtType === 'dc') {
        const r = await p.query(
          `SELECT DISTINCT state_code, state_name
             FROM public.nv_court_complexes
            WHERE court_type = 'DC'
            ORDER BY state_name`,
        );
        return (r.rows ?? []).map((row: Record<string, unknown>) => ({
          code: String(row.state_code),
          name: String(row.state_name),
        }));
      }
      // HC / SC — canonical benches from the jurisdiction master.
      const r = await p.query(
        `SELECT DISTINCT state_name
           FROM public.nv_court_jurisdictions
          WHERE court_type = $1 AND state_name IS NOT NULL AND state_name <> ''
          ORDER BY state_name`,
        [courtType.toUpperCase()],
      );
      return (r.rows ?? []).map((row: Record<string, unknown>) => ({
        code: String(row.state_name),
        name: String(row.state_name),
      }));
    },

    async listDistricts(
      courtType: CourtTypeCode,
      state: string,
    ): Promise<DistrictEntry[]> {
      // P0 focus: district-court complexes (numeric eCourts hierarchy).
      if (courtType !== 'dc') return [];
      const r = await p.query(
        `SELECT DISTINCT district_code, district_name
           FROM public.nv_court_complexes
          WHERE court_type = 'DC'
            AND (state_code = $1 OR LOWER(state_name) = LOWER($1))
          ORDER BY district_name`,
        [state],
      );
      return (r.rows ?? []).map((row: Record<string, unknown>) => ({
        code: String(row.district_code),
        name: String(row.district_name),
      }));
    },

    async listComplexes(
      courtType: CourtTypeCode,
      state: string,
      district: string,
    ): Promise<ComplexEntry[]> {
      if (courtType !== 'dc') return [];
      const r = await p.query(
        `SELECT complex_code, complex_name, court_numbers
           FROM public.nv_court_complexes
          WHERE court_type = 'DC'
            AND (state_code = $1 OR LOWER(state_name) = LOWER($1))
            AND (district_code = $2 OR LOWER(district_name) = LOWER($2))
          ORDER BY complex_name`,
        [state, district],
      );
      return (r.rows ?? []).map((row: Record<string, unknown>) => ({
        code: String(row.complex_code),
        name: String(row.complex_name),
        courtNumbers: row.court_numbers != null ? String(row.court_numbers) : null,
      }));
    },

    async listCaseTypes(
      courtType: CourtTypeCode,
      state?: string,
    ): Promise<CaseTypeEntry[]> {
      const stateCode = String(state ?? '').trim();
      const r = await p.query(
        `SELECT code, display_name, state_code
           FROM public.nv_case_type_codes
          WHERE court_type = $1 AND state_code IN ($2, '')
          ORDER BY (state_code = $2) DESC, code`,
        [courtType.toUpperCase(), stateCode],
      );
      return (r.rows ?? []).map((row: Record<string, unknown>) => ({
        code: String(row.code),
        displayName: String(row.display_name),
        stateCode: row.state_code != null ? String(row.state_code) : '',
      }));
    },
  };
}

let overrideProvider: CourtMasterProvider | null = null;
let cachedDbProvider: CourtMasterProvider | null | undefined;

/** Test seam — inject an in-memory provider (or null to restore DB). */
export function __setCourtMasterProviderForTests(
  provider: CourtMasterProvider | null,
): void {
  overrideProvider = provider;
  cachedDbProvider = undefined;
}

/** Resolve the active provider (test override → cached DB provider). */
export function getCourtMasterProvider(): CourtMasterProvider | null {
  if (overrideProvider) return overrideProvider;
  if (cachedDbProvider === undefined) {
    cachedDbProvider = createDbCourtMasterProvider();
  }
  return cachedDbProvider;
}
