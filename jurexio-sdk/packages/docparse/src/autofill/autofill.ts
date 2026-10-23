/**
 * Autofill payload assembly.
 *
 * Turns resolved fields into the object the NSP case form consumes, and — more
 * importantly — decides what NOT to fill.
 *
 * The four states a field can be in, and why each is distinct in the UI:
 *
 *   FILLED         resolved above threshold → the input is pre-populated
 *   LOW_CONFIDENCE found, but uncertain → the input is EMPTY with the candidate
 *                  offered beside it. The user accepts it with one tap. This is
 *                  not the same as filling it: a pre-filled field is a field the
 *                  user will not read.
 *   CONFLICT       two documents disagree → a chooser, never a default
 *   ABSENT         genuinely not in the documents → the input is empty and
 *                  labelled "not found", which is different from "we failed"
 *
 * Collapsing these four into "filled or blank" is the single most damaging
 * simplification available here, because it destroys the user's ability to tell
 * a confident extraction from a guess.
 */

import type { AutofillPayload, FieldResolution } from "../types.js";
import { profileFor } from "../doctype/registry.js";

export interface AutofillOptions {
  autofillThreshold: number;
  /** Document type codes present in the batch, for expected-field computation. */
  docTypeCodes: string[];
  /** Field paths the governance layer says must be withheld. */
  withheldFieldPaths?: string[];
}

/** Tier thresholds — the four-tier minimum case record. */
const T1_FIELDS = ["parties[0].name", "caseType", "court.raw"];
const T2_FIELDS = [
  "court.raw", "caseType", "parties[0].name", "parties[1].name",
  "parties[0].role", "parties[1].role", "cause.date", "reliefsSought",
  "suit.valuation", "advocates[0].name",
];

export function buildAutofill(
  resolutions: FieldResolution[],
  opts: AutofillOptions,
): AutofillPayload {
  const fields: Record<string, unknown> = {};
  const absent: string[] = [];
  const conflicts: string[] = [];
  const lowConfidence: string[] = [];

  const withheld = new Set(expandWildcards(opts.withheldFieldPaths ?? [], resolutions));

  for (const r of resolutions) {
    if (withheld.has(r.fieldPath)) {
      // A withheld field is neither filled nor reported absent — it is withheld,
      // and saying so is what makes the restriction visible rather than looking
      // like a parse failure.
      fields[r.fieldPath] = { withheld: true, reason: "restricted matter — statutory bar on disclosure" };
      continue;
    }
    switch (r.status) {
      case "RESOLVED":
        fields[r.fieldPath] = r.chosen?.valueNormalized ?? r.chosen?.valueRaw ?? null;
        break;
      case "CONFLICT":
        conflicts.push(r.fieldPath);
        break;
      case "LOW_CONFIDENCE":
        lowConfidence.push(r.fieldPath);
        break;
      case "ABSENT":
        absent.push(r.fieldPath);
        break;
    }
  }

  // Expected fields come from the document types present, so completeness is
  // measured against what these documents COULD have yielded rather than against
  // a universal schema. An FIR that yields every FIR field is 100% complete even
  // though it says nothing about a sale deed's boundaries.
  const expected = new Set<string>();
  for (const code of opts.docTypeCodes) {
    for (const f of profileFor(code)?.expectedFields ?? []) expected.add(f);
  }
  const filledCount = Object.keys(fields).filter((k) => {
    const v = fields[k];
    return v !== null && v !== undefined && !(typeof v === "object" && v !== null && "withheld" in v);
  }).length;

  return {
    tier: computeTier(fields),
    fields,
    absent,
    conflicts,
    lowConfidence,
    completeness: {
      filled: filledCount,
      expected: Math.max(expected.size, filledCount),
      ratio: expected.size > 0 ? Math.min(1, filledCount / expected.size) : 0,
    },
  };
}

/**
 * Which tier of the minimum case record has been reached.
 *
 * T0 a stub exists · T1 workable · T2 filing-ready · T3 pleading-complete.
 * T3 is deliberately NOT computed here — whether a pleading is complete is a
 * question of statute and court rules for that case type, and answering it from
 * field presence alone would be a legal conclusion the parser is not entitled to
 * reach. It is left to the advisor with the court registry in hand.
 */
function computeTier(fields: Record<string, unknown>): AutofillPayload["tier"] {
  const has = (k: string) => {
    const v = fields[k];
    return v !== null && v !== undefined && !(typeof v === "object" && v !== null && "withheld" in v);
  };
  const anyParty = Object.keys(fields).some((k) => /^parties\[\d+\]\.name$/.test(k) && has(k));
  if (!anyParty && !has("court.raw") && !has("cnr") && !has("caseNumber")) return "T0";
  if (T2_FIELDS.filter(has).length >= 8) return "T2";
  if (T1_FIELDS.some(has) || anyParty) return "T1";
  return "T0";
}

/** Expand `parties[*].name` style paths against the actual resolutions. */
function expandWildcards(paths: string[], resolutions: FieldResolution[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (!p.includes("[*]")) { out.push(p); continue; }
    const re = new RegExp("^" + p.replace(/\[\*\]/g, "\\[\\d+\\]").replace(/\./g, "\\.") + "$");
    for (const r of resolutions) if (re.test(r.fieldPath)) out.push(r.fieldPath);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Field map to the NSP case shape
// ---------------------------------------------------------------------------

/**
 * Translate flat dotted field paths into the nested shape the case API accepts.
 *
 * Kept as an explicit map rather than a generic dotted-path setter, because the
 * translation is not always structural: `fir.number` and `fir.year` combine into
 * one `fir` object, `parties[n].*` collapses into an array, and several fields
 * carry a unit conversion or a code lookup on the way through. A generic setter
 * would silently produce a shape the API rejects at runtime instead of a mapping
 * error at build time.
 */
export interface NspCaseDraft {
  cnr?: string;
  court?: { raw?: string; courtId?: string; tier?: string };
  caseNumber?: { typeToken?: string; number?: string; year?: number };
  diaryNumber?: { number?: string; year?: number };
  fir?: {
    number?: string; year?: number; date?: string;
    policeStation?: string; district?: string; gdEntry?: string;
    placeOfOccurrence?: string;
  };
  sections?: Array<{ statute: string; section: string; subsections: string[] }>;
  parties?: Array<Record<string, unknown>>;
  advocates?: Array<Record<string, unknown>>;
  instrument?: Record<string, unknown>;
  property?: Record<string, unknown>;
  amounts?: Array<Record<string, unknown>>;
  dates?: Record<string, string>;
  /** Everything that had no mapping. Never discarded silently. */
  unmapped?: Record<string, unknown>;
}

export function toCaseDraft(payload: AutofillPayload): NspCaseDraft {
  const f = payload.fields;
  const draft: NspCaseDraft = {};
  const unmapped: Record<string, unknown> = {};
  const consumed = new Set<string>();

  const take = <T>(key: string): T | undefined => {
    if (!(key in f)) return undefined;
    consumed.add(key);
    const v = f[key];
    if (v !== null && typeof v === "object" && "withheld" in (v as object)) return undefined;
    return v as T;
  };

  const cnr = take<{ cnr?: string } | string>("cnr");
  if (cnr) draft.cnr = typeof cnr === "string" ? cnr : cnr.cnr;

  const courtRaw = take<string>("court.raw");
  if (courtRaw) draft.court = { raw: courtRaw };

  const cn = take<{ typeToken?: string; number?: string; year?: number }>("caseNumber");
  if (cn) draft.caseNumber = cn;

  const dn = take<{ number?: string; year?: number }>("diaryNumber");
  if (dn) draft.diaryNumber = dn;

  const firNumber = take<{ number?: string; year?: number } | string>("fir.number");
  const firPs = take<string>("fir.policeStation");
  const firDist = take<string>("fir.district");
  const firGd = take<string>("fir.gdEntry");
  const firPlace = take<string>("fir.placeOfOccurrence");
  const firYearField = take<string>("fir.year");
  if (firNumber || firPs || firDist || firGd || firPlace) {
    draft.fir = {
      ...(typeof firNumber === "object" && firNumber
        ? { number: firNumber.number, ...(firNumber.year ? { year: firNumber.year } : {}) }
        : firNumber ? { number: String(firNumber) } : {}),
      ...(firYearField && !(typeof firNumber === "object" && firNumber?.year) ? { year: Number(firYearField) } : {}),
      ...(firPs ? { policeStation: firPs } : {}),
      ...(firDist ? { district: firDist } : {}),
      ...(firGd ? { gdEntry: firGd } : {}),
      ...(firPlace ? { placeOfOccurrence: firPlace } : {}),
    };
  }

  const sections = take<Array<{ statute: string; section: string; subsections: string[] }>>("sections");
  if (Array.isArray(sections)) {
    draft.sections = sections.map((s) => ({ statute: s.statute, section: s.section, subsections: s.subsections ?? [] }));
  }

  // Parties and advocates: collect indexed paths.
  const parties: Array<Record<string, unknown>> = [];
  const advocates: Array<Record<string, unknown>> = [];
  for (const key of Object.keys(f)) {
    const pm = /^parties\[(\d+)\]\.(.+)$/.exec(key);
    if (pm) {
      consumed.add(key);
      const i = Number(pm[1]);
      const v = f[key];
      if (v !== null && typeof v === "object" && "withheld" in (v as object)) {
        (parties[i] ??= {})[pm[2]!] = { withheld: true };
      } else {
        (parties[i] ??= {})[pm[2]!] = v;
      }
      continue;
    }
    const am = /^advocates\[(\d+)\]\.(.+)$/.exec(key);
    if (am) {
      consumed.add(key);
      (advocates[Number(am[1])] ??= {})[am[2]!] = f[key];
    }
  }
  if (parties.length > 0) draft.parties = parties.filter(Boolean);
  if (advocates.length > 0) draft.advocates = advocates.filter(Boolean);

  // Grouped namespaces.
  for (const [prefix, target] of [
    ["instrument.", "instrument"],
    ["property.", "property"],
    ["bank.", "instrument"],
  ] as const) {
    for (const key of Object.keys(f)) {
      if (!key.startsWith(prefix)) continue;
      consumed.add(key);
      const bucket = (draft[target] ??= {}) as Record<string, unknown>;
      bucket[key.slice(prefix.length)] = f[key];
    }
  }

  // Dates: keep the ISO form only, since that is what the API stores.
  const dates: Record<string, string> = {};
  for (const key of Object.keys(f)) {
    if (!/(?:\.date|On|Date)$/.test(key) && !key.startsWith("dates.")) continue;
    const v = f[key];
    if (v && typeof v === "object" && "iso" in (v as object)) {
      const iso = (v as { iso: string | null }).iso;
      if (iso) { dates[key] = iso; consumed.add(key); }
    }
  }
  if (Object.keys(dates).length > 0) draft.dates = dates;

  // Everything unconsumed is kept, explicitly. A field the map does not know
  // about must not vanish — it goes into `unmapped` where it is visible in the
  // review UI and can be promoted into the map later.
  for (const key of Object.keys(f)) {
    if (!consumed.has(key)) unmapped[key] = f[key];
  }
  if (Object.keys(unmapped).length > 0) draft.unmapped = unmapped;

  return draft;
}
