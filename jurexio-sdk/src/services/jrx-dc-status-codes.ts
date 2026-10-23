/**
 * NV-DC-STATUS-DECODE-001 — District-court case-status decode (Group 2).
 *
 * District-court rows publish `case_status` / `disposal_nature` as a **numeric
 * eCourts code** (e.g. `"572"`), not a human label. The authoritative numeric
 * code → label master is the NJDG `t_case_status` table, which is establishment
 * -scoped in eCourts CIS (each court's own status master) and is **not** exposed
 * as a single national numeric→label CSV (see gap plan Appendix G; WebSearch
 * 2026-09-25 — NJDG National-Master exports cover case-type/purpose/adjourn/
 * disposal/act, NOT `t_case_status`; the eCourtsIndia enum publishes 71 **string**
 * status codes, not numerics). We therefore do NOT fabricate numeric mappings —
 * doing so would mislead lawyers about a case's status.
 *
 * What this module closes honestly:
 *   1. Categorises the **text/string** disposal + stage labels that ARE
 *      published (verifiable eCourts buckets, now widened to the public
 *      eCourtsIndia 71-code taxonomy) into disposed / pending / unknown.
 *   2. Exposes the numeric-decode seam (`decodeDcCaseStatus`) that reads a
 *      caller-provided OR module-registered numeric master (`nv_dc_case_status_codes`
 *      rows where `numeric_code IS NOT NULL`). Until a verifiable numeric master
 *      is populated it returns `null`/undecoded, and the adapter attaches an
 *      honest "decode pending" note rather than a guessed label.
 *
 * The DB table `nv_dc_case_status_codes` is the runtime SSoT; this in-code map is
 * the static fallback used by the pure adapter and by tests (no DB). The string
 * taxonomy is sourced from the public eCourtsIndia case-status dictionary
 * (2026-09-23 snapshot, 71 codes) — string labels only, never numeric guesses.
 */

export type DcStatusCategory = 'disposed' | 'pending' | 'unknown';

export interface DcStatusDecode {
  /** Human label (echoes input when only categorisation is possible). */
  label: string;
  category: DcStatusCategory;
  /** True when the input was a bare numeric eCourts code we cannot yet decode. */
  numericUndecoded: boolean;
}

/** Numeric-code master row shape (decoded eCourts numeric → label + category). */
export interface DcNumericStatusEntry {
  label: string;
  category: DcStatusCategory;
}

/**
 * Public eCourtsIndia normalized status taxonomy (71 codes, 2026-09-23 snapshot).
 * These are **string** codes — used for EXACT normalized-key decode of text
 * statuses. Numeric eCourts codes are NOT in this table (see module header).
 * Groups: active/pending, disposed/final, special/ADR.
 */
const DC_STATUS_TAXONOMY: ReadonlyArray<readonly [string, string, DcStatusCategory]> = [
  // ── Active / Pending (44) ──
  ['PENDING', 'Pending', 'pending'],
  ['ADMITTED', 'Admitted', 'pending'],
  ['ARGUMENTS', 'Arguments', 'pending'],
  ['PART_HEARD', 'Part Heard', 'pending'],
  ['HEARING', 'Hearing', 'pending'],
  ['EVIDENCE', 'Evidence', 'pending'],
  ['TRIAL', 'Trial', 'pending'],
  ['FIRST_HEARING', 'First Hearing', 'pending'],
  ['APPEARANCE', 'Appearance', 'pending'],
  ['NOTICE_ISSUED', 'Notice Issued', 'pending'],
  ['FOR_ADMISSION', 'For Admission', 'pending'],
  ['FOR_JUDGMENT', 'For Judgment', 'pending'],
  ['RESERVED', 'Reserved', 'pending'],
  ['FOR_ORDERS', 'For Orders', 'pending'],
  ['FOR_STEPS', 'For Steps', 'pending'],
  ['REGISTERED', 'Registered', 'pending'],
  ['LISTED', 'Listed', 'pending'],
  ['MENTIONED', 'Mentioned', 'pending'],
  ['FILED', 'Filed', 'pending'],
  ['READY_FOR_REGISTRATION', 'Ready For Registration', 'pending'],
  ['ADJOURNED', 'Adjourned', 'pending'],
  ['COMPLIANCE_PENDING', 'Compliance Pending', 'pending'],
  ['CONTEMPT_PENDING', 'Contempt Pending', 'pending'],
  ['CURATIVE_PENDING', 'Curative Petition Pending', 'pending'],
  ['EXECUTION_PENDING', 'Execution Pending', 'pending'],
  ['LPA_PENDING', 'Letters Patent Appeal Pending', 'pending'],
  ['MAINTENANCE_PENDING', 'Maintenance Pending', 'pending'],
  ['PIL_PENDING', 'PIL Pending', 'pending'],
  ['REVIEW_PENDING', 'Review Pending', 'pending'],
  ['SERVICE_PENDING', 'Service Pending', 'pending'],
  ['PENDING_AFTER_NOTICE', 'Pending After Notice', 'pending'],
  ['PENDING_BEFORE_NOTICE', 'Pending Before Notice', 'pending'],
  ['INTERIM_ORDER_PASSED', 'Interim Order Passed', 'pending'],
  ['FRAMING_OF_ISSUES', 'Framing Of Issues', 'pending'],
  ['PLAINTIFF_EVIDENCE', 'Plaintiff Evidence', 'pending'],
  ['DEFENCE_EVIDENCE', 'Defence Evidence', 'pending'],
  ['PROSECUTION_EVIDENCE', 'Prosecution Evidence', 'pending'],
  ['CROSS_EXAMINATION', 'Cross Examination', 'pending'],
  ['COUNTER_AFFIDAVIT_FILED', 'Counter Affidavit Filed', 'pending'],
  ['REJOINDER_FILED', 'Rejoinder Filed', 'pending'],
  ['WRITTEN_STATEMENT_FILED', 'Written Statement Filed', 'pending'],
  ['CHARGE_FRAMED', 'Charge Framed', 'pending'],
  ['SUMMONS_ISSUED', 'Summons Issued', 'pending'],
  ['STAYED', 'Stayed', 'pending'],
  // ── Disposed / Final (23) ──
  ['DISPOSED', 'Disposed', 'disposed'],
  ['DISMISSED', 'Dismissed', 'disposed'],
  ['ALLOWED', 'Allowed', 'disposed'],
  ['PARTLY_ALLOWED', 'Partly Allowed', 'disposed'],
  ['DECREED', 'Decreed', 'disposed'],
  ['WITHDRAWN', 'Withdrawn', 'disposed'],
  ['COMPROMISE', 'Compromised', 'disposed'],
  ['TRANSFERRED', 'Transferred', 'disposed'],
  ['REMANDED', 'Remanded', 'disposed'],
  ['CLOSED', 'Closed', 'disposed'],
  ['DISMISSED_AS_WITHDRAWN', 'Dismissed As Withdrawn', 'disposed'],
  ['DISMISSED_IN_DEFAULT', 'Dismissed In Default', 'disposed'],
  ['DISMISSED_NO_COSTS', 'Dismissed Without Costs', 'disposed'],
  ['ALLOWED_NO_COSTS', 'Allowed Without Costs', 'disposed'],
  ['NOT_ADMITTED', 'Not Admitted', 'disposed'],
  ['REJECTED', 'Rejected', 'disposed'],
  ['INFRUCTUOUS', 'Infructuous', 'disposed'],
  ['ABATED', 'Abated', 'disposed'],
  ['JUDGMENT', 'Judgment Delivered', 'disposed'],
  ['RULE_ABSOLUTE', 'Rule Absolute', 'disposed'],
  ['RULE_DISCHARGED', 'Rule Discharged', 'disposed'],
  ['BAIL_GRANTED', 'Bail Granted', 'disposed'],
  ['BAIL_REJECTED', 'Bail Rejected', 'disposed'],
  // ── Special / ADR (4) ──
  ['LOK_ADALAT', 'Lok Adalat Settlement', 'disposed'],
  ['MEDIATION', 'Referred To Mediation', 'pending'],
  ['DEFECTIVE', 'Defective', 'pending'],
  ['UNKNOWN', 'Unknown', 'unknown'],
  // ── Legacy verifiable disposal labels retained from the P0 seed ──
  ['CONVICTED', 'Convicted', 'disposed'],
  ['ACQUITTED', 'Acquitted', 'disposed'],
  ['CONTESTED', 'Contested', 'pending'],
  ['UNCONTESTED', 'Uncontested', 'pending'],
];

/** Normalize a raw status string to a taxonomy key: UPPER + non-alnum → single `_`. */
export function normalizeDcStatusKey(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const DC_STATUS_EXACT: ReadonlyMap<string, DcNumericStatusEntry> = new Map(
  DC_STATUS_TAXONOMY.map(([key, label, category]) => [key, { label, category }]),
);

/**
 * Verifiable eCourts/legal disposal + stage buckets (fuzzy substring fallback).
 * Used when a status string is not an exact taxonomy code (e.g.
 * `"CASE WITHDRAWN BY PETITIONER"`, `"Pending for evidence"`). Keyed by an
 * uppercased label token.
 */
const DC_TEXT_STATUS_BUCKETS: ReadonlyArray<{
  match: RegExp;
  label: string;
  category: DcStatusCategory;
}> = [
  { match: /\bPENDING\b/, label: 'Pending', category: 'pending' },
  { match: /\bDISPOSED\b/, label: 'Disposed', category: 'disposed' },
  { match: /\bWITHDRAWN\b/, label: 'Withdrawn', category: 'disposed' },
  { match: /\bDISMISS(ED|AL)?\b/, label: 'Dismissed', category: 'disposed' },
  { match: /\bALLOWED\b/, label: 'Allowed', category: 'disposed' },
  { match: /\bABATED\b/, label: 'Abated', category: 'disposed' },
  { match: /\bTRANSFERRED\b/, label: 'Transferred', category: 'disposed' },
  { match: /\bCONVICTED\b/, label: 'Convicted', category: 'disposed' },
  { match: /\bACQUITTED\b/, label: 'Acquitted', category: 'disposed' },
  { match: /\bCOMPROMISE(D)?\b/, label: 'Compromised', category: 'disposed' },
  { match: /\bDECREED\b/, label: 'Decreed', category: 'disposed' },
  { match: /\bCONTESTED\b/, label: 'Contested', category: 'pending' },
  { match: /\bUNCONTESTED\b/, label: 'Uncontested', category: 'pending' },
];

/** True when the raw status is a bare integer (eCourts numeric code). */
export function isNumericDcStatus(raw: string): boolean {
  return /^\d{1,6}$/.test(raw.trim());
}

/**
 * Module-registered numeric master (`nv_dc_case_status_codes` numeric rows),
 * loaded once at boot via `setDcNumericStatusMaster`. Empty until an authoritative
 * numeric master is seeded — until then numeric codes stay honestly undecoded.
 */
let moduleNumericMaster: ReadonlyMap<string, DcNumericStatusEntry> | null = null;

/** Register the numeric master loaded from the DB (NV-DC-STATUS-DECODE-001). */
export function setDcNumericStatusMaster(
  master: ReadonlyMap<string, DcNumericStatusEntry> | null,
): void {
  moduleNumericMaster = master;
}

/** Build a numeric master map from DB rows (numeric_code → label/category). */
export function buildDcNumericStatusMaster(
  rows: ReadonlyArray<{ numeric_code?: string | null; numericCode?: string | null; label: string; category: string }>,
): Map<string, DcNumericStatusEntry> {
  const map = new Map<string, DcNumericStatusEntry>();
  for (const row of rows) {
    const code = (row.numeric_code ?? row.numericCode ?? '').trim();
    if (!code || !isNumericDcStatus(code)) continue;
    const category: DcStatusCategory =
      row.category === 'disposed' || row.category === 'pending' ? row.category : 'unknown';
    map.set(code, { label: row.label, category });
  }
  return map;
}

/**
 * Look up a numeric eCourts DC status code in a caller-provided master map, then
 * the module-registered master. Returns null when the code is not in any master
 * (the honest default until an authoritative numeric master is loaded). Text
 * statuses are decoded via the exact taxonomy first, then the fuzzy buckets.
 */
export function decodeDcCaseStatus(
  raw: string,
  master?: ReadonlyMap<string, DcNumericStatusEntry>,
): DcStatusDecode | null {
  const value = raw.trim();
  if (!value) return null;

  if (isNumericDcStatus(value)) {
    const hit = master?.get(value) ?? moduleNumericMaster?.get(value);
    if (hit) {
      return { label: hit.label, category: hit.category, numericUndecoded: false };
    }
    return { label: value, category: 'unknown', numericUndecoded: true };
  }

  // 1) Exact normalized taxonomy key (precise eCourts status code).
  const exact = DC_STATUS_EXACT.get(normalizeDcStatusKey(value));
  if (exact) {
    return { label: exact.label, category: exact.category, numericUndecoded: false };
  }

  // 2) Fuzzy substring bucket (free-text status like "CASE WITHDRAWN BY …").
  const upper = value.toUpperCase();
  for (const bucket of DC_TEXT_STATUS_BUCKETS) {
    if (bucket.match.test(upper)) {
      return { label: bucket.label, category: bucket.category, numericUndecoded: false };
    }
  }
  return { label: value, category: 'unknown', numericUndecoded: false };
}

/** Honest note attached when a DC numeric code cannot be decoded yet. */
export const DC_STATUS_DECODE_PENDING_NOTE =
  'DC numeric eCourts status code — decode pending NJDG t_case_status master ' +
  '(nv_dc_case_status_codes; NV-DC-STATUS-DECODE-001). Value is the raw code, not a label.';
