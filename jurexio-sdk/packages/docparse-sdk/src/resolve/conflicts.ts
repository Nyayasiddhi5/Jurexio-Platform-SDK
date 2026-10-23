/**
 * Cross-document conflict resolution and calibrated confidence.
 *
 * A real intake is several documents about one matter, and they disagree. Not
 * because anyone is wrong, usually, but because they were written at different
 * stages: the FIR says "Sunil Kumar Bansal", the charge sheet adds a middle name,
 * the bail application drops the honorific, the judgement spells the village
 * differently. Sometimes the disagreement IS substantive — a legal notice claims
 * ₹18,75,000 and the complaint claims ₹18,57,000, and one of those is a typo that
 * will be cross-examined.
 *
 * Three rules, in priority order:
 *
 *  1. NEVER silently merge a substantive disagreement. If two documents state
 *     different values for the same field and they are not trivially equivalent,
 *     the field is CONFLICT and the advocate chooses. The system's job is to
 *     surface it, not to be clever.
 *
 *  2. AUTHORITY BEFORE CONFIDENCE. An FIR is authoritative for the FIR number
 *     even if a later document mentions it more legibly. Confidence measures how
 *     well we READ something; authority measures whether that document is
 *     entitled to state it. Reading a wrong fact clearly is still wrong.
 *
 *  3. CORROBORATION RAISES, IT DOES NOT CREATE. Three documents agreeing lifts
 *     confidence, but not above what a single reliable reading could justify plus
 *     a bounded bonus. Ten sloppy documents agreeing on a garbled name do not
 *     make it right.
 */

import type { Candidate, FieldResolution } from "../types.js";

// ---------------------------------------------------------------------------
// Field cardinality
// ---------------------------------------------------------------------------

/**
 * Whether a field holds ONE value or a SET of values.
 *
 * This distinction was missing from the first version of the resolver and the
 * omission produced nonsense. Everything went through single-value conflict
 * resolution, so a sale deed naming the vendor's PAN and the purchaser's PAN was
 * reported as a PAN "conflict"; an FIR listing four charged sections was a
 * sections conflict; a document with a complainant's phone and three witnesses'
 * phones was a phone conflict. In each case the correct answer was "these are all
 * true", and the resolver's answer was "the advocate must choose one".
 *
 * SINGLE means the field has exactly one true value in this matter, so two
 * different values are a genuine disagreement to surface.
 *
 * MULTI means the field is a collection: distinct values are all kept, each
 * scored on its own evidence. There is still such a thing as a conflict within a
 * MULTI field — the same cheque read as two different numbers — but that is
 * handled by equivalence inside a single collected value, not by making the whole
 * collection compete with itself.
 */
export type Cardinality = "SINGLE" | "MULTI";

/** Ordered: first matching rule wins, so specific paths precede prefixes. */
const CARDINALITY_RULES: Array<{ re: RegExp; card: Cardinality }> = [
  // Indexed paths are single per index — parties[0].name has one value.
  { re: /^(?:parties|advocates|witnesses)\[\d+\]\./, card: "SINGLE" },

  // Genuine collections.
  { re: /^sections$/, card: "MULTI" },
  { re: /^articles$/, card: "MULTI" },
  { re: /^acts$/, card: "MULTI" },
  { re: /^orderRules$/, card: "MULTI" },
  { re: /^notifications$/, card: "MULTI" },
  { re: /^amounts$/, card: "MULTI" },
  { re: /^citations\./, card: "MULTI" },
  { re: /^contacts\./, card: "MULTI" },
  { re: /^ids\./, card: "MULTI" },
  { re: /^property\.surveyNo$/, card: "MULTI" },
  { re: /^property\.boundaries$/, card: "MULTI" },
  { re: /^vehicle\./, card: "MULTI" },
  { re: /^parties\.(?:age|relation|dob)$/, card: "MULTI" },
  { re: /^dates\./, card: "MULTI" },
  { re: /^advocates\.enrolmentNo$/, card: "MULTI" },
  { re: /^bank\.accountNo$/, card: "MULTI" },
  { re: /^reliefsSought$/, card: "MULTI" },
  { re: /^obligations$/, card: "MULTI" },
  { re: /^coram$/, card: "MULTI" },          // a bench has several judges
  { re: /^advocates\.for/, card: "MULTI" },
  { re: /^relatedCase$/, card: "MULTI" },

  // Everything else is single: the CNR, the case number, the FIR number, the
  // court, the cheque, the disposition, the dated milestones.
];

export function cardinalityOf(fieldPath: string): Cardinality {
  for (const r of CARDINALITY_RULES) if (r.re.test(fieldPath)) return r.card;
  return "SINGLE";
}

// ---------------------------------------------------------------------------
// Equivalence
// ---------------------------------------------------------------------------

/**
 * Are two values the same fact written differently?
 *
 * Field-aware, because equivalence is not universal. "0123" and "123" are the
 * same FIR number but different cheque numbers (a cheque number is a fixed-width
 * printed token, and a leading zero is part of it). "Sri Ram Kumar" and "Ram
 * Kumar" are the same person; "1,50,000" and "150000" are the same amount.
 */
export function equivalent(fieldPath: string, a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;

  // A ParsedDate and the raw string it came from are the SAME FACT in two
  // representations, and they must compare equal.
  //
  // This is not a cosmetic tidy-up. An anchor reads "Pronounced on: 26th August,
  // 2024" and stores the string; the date sweep reads the same characters and
  // stores a ParsedDate. Without this branch the two representations landed in
  // different equivalence classes, the field was reported as a CONFLICT, and the
  // advocate was asked to choose between "26th August, 2024" and 2024-08-26.
  const dateA = asParsedDate(a);
  const dateB = asParsedDate(b);
  if (dateA && dateB) return dateA.iso === dateB.iso && dateA.iso !== null;
  if (dateA && typeof b === "string") {
    const parsed = parseLoose(b);
    if (parsed) return parsed === dateA.iso;
  }
  if (dateB && typeof a === "string") {
    const parsed = parseLoose(a);
    if (parsed) return parsed === dateB.iso;
  }

  // Structured values compare on their identifying part.
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    // Dates: the ISO string is the identity. Two dates with different precision
    // are NOT equivalent — "August 2024" is not "15 August 2024".
    if ("iso" in ao || "iso" in bo) return ao.iso === bo.iso && ao.precision === bo.precision;
    if ("cnr" in ao || "cnr" in bo) return ao.cnr === bo.cnr;
    if ("amount" in ao || "amount" in bo) return numEq(ao.amount, bo.amount);
    if ("number" in ao && "year" in ao) {
      return numEq(normNum(ao.number), normNum(bo.number)) && numEq(ao.year, bo.year);
    }
    if ("canonical" in ao || "canonical" in bo) return ao.canonical === bo.canonical;
    return JSON.stringify(sortKeys(ao)) === JSON.stringify(sortKeys(bo));
  }

  const as = String(a).trim();
  const bs = String(b).trim();
  if (as.toLowerCase() === bs.toLowerCase()) return true;

  // Fixed-width printed tokens: leading zeros are significant.
  if (/^(?:instrument\.chequeNo|bank\.|ids\.|cnr)/.test(fieldPath)) {
    return as.replace(/\s/g, "").toUpperCase() === bs.replace(/\s/g, "").toUpperCase();
  }

  // Numbers where leading zeros are formatting, not identity.
  if (/^\d+$/.test(as) && /^\d+$/.test(bs)) return Number(as) === Number(bs);

  // Amounts written with and without grouping.
  const an = parseAmount(as);
  const bn = parseAmount(bs);
  if (an !== null && bn !== null) return Math.abs(an - bn) < 0.5;

  // Names: compare on the honorific-stripped, punctuation-free form. A middle
  // name present in one and absent in the other is treated as equivalent only if
  // one is a strict token-subset of the other — which catches "Ram Kumar" vs
  // "Ram Kumar Verma" but not "Ram Kumar" vs "Ram Singh".
  if (/(?:parties\[\d+\]\.name|advocates\[\d+\]\.name|\.name$)/.test(fieldPath)) {
    const na = nameTokens(as);
    const nb = nameTokens(bs);
    if (na.length === 0 || nb.length === 0) return false;
    if (na.join(" ") === nb.join(" ")) return true;
    const small = na.length <= nb.length ? na : nb;
    const large = na.length <= nb.length ? nb : na;
    return small.every((t) => large.includes(t)) && small.length >= 2;
  }

  return false;
}

function asParsedDate(v: unknown): { iso: string | null } | null {
  if (v !== null && typeof v === "object" && "iso" in (v as object) && "precision" in (v as object)) {
    return v as { iso: string | null };
  }
  return null;
}

/** Best-effort ISO from a free-text date, for cross-representation comparison. */
function parseLoose(s: string): string | null {
  const m = /\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:day\s+of\s+)?([A-Za-z]{3,9})\.?,?\s*((?:19|20)\d{2})\b/.exec(s);
  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  if (m) {
    const mo = months[m[2]!.slice(0, 3).toLowerCase()];
    if (mo) return `${m[3]}-${String(mo).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
  }
  const n = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.]((?:19|20)\d{2})\b/.exec(s);
  if (n) return `${n[3]}-${String(Number(n[2])).padStart(2, "0")}-${String(Number(n[1])).padStart(2, "0")}`;
  const iso = /\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function numEq(a: unknown, b: unknown): boolean {
  const x = Number(a);
  const y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}

function normNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(String(v).replace(/^0+/, "") || "0");
  return Number.isFinite(n) ? n : null;
}

function parseAmount(s: string): number | null {
  if (!/^[₹\s]*[\d,]+(?:\.\d{1,2})?[\s/-]*$/.test(s)) return null;
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

const HON = /^(?:sri|shri|smt|mr|mrs|ms|dr|prof|late|kum|ms|m\/s)$/;

function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-zऀ-෿\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !HON.test(t));
}

function sortKeys(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

// ---------------------------------------------------------------------------
// Calibrated confidence
// ---------------------------------------------------------------------------

export interface ConfidenceInputs {
  /** The extractor's own confidence, already page- and zone-adjusted. */
  base: number;
  /** How entitled this document type is to state this field. */
  authorityWeight: number;
  /** How many independent documents produced an equivalent value. */
  corroborations: number;
  /** How many produced a materially different value. */
  contradictions: number;
  /** True if the value came through an LLM fallback. */
  aiInvolved: boolean;
  /** Hard cap for AI-derived values. */
  aiCap: number;
}

/**
 * Combine the signals into a final confidence.
 *
 * Shape of the model and why:
 *  - Authority is a MULTIPLIER, not an addend. A document with no business
 *    stating a field should not reach high confidence however clearly it is read.
 *  - Corroboration is a bounded bonus with diminishing returns. The second
 *    document agreeing is worth a lot; the fifth is worth almost nothing.
 *  - A single contradiction is heavily penalising. It means we are probably about
 *    to pre-fill the wrong value, which is worse than pre-filling nothing.
 *  - The AI cap is applied LAST, so nothing can push an LLM-derived value past it.
 */
export function combineConfidence(i: ConfidenceInputs): number {
  let c = i.base * (0.55 + 0.45 * clamp01(i.authorityWeight));

  if (i.corroborations > 0) {
    // 1 → +0.06, 2 → +0.09, 3 → +0.11, asymptotic to +0.14
    c += 0.14 * (1 - Math.exp(-0.55 * i.corroborations));
  }
  if (i.contradictions > 0) {
    c *= Math.pow(0.55, i.contradictions);
  }

  c = clamp01(c);
  if (i.aiInvolved) c = Math.min(c, i.aiCap);
  return Math.round(c * 1000) / 1000;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolveOptions {
  autofillThreshold: number;
  floorThreshold: number;
  aiCap: number;
}

/**
 * Resolve one field from all its candidates.
 *
 * Groups candidates into equivalence classes, scores each class, and picks a
 * winner — unless two classes are close, in which case the field is CONFLICT and
 * nothing is picked. "Close" is deliberately generous: a 0.15 gap is not enough
 * to overrule a document that says something different.
 */
export function resolveField(
  fieldPath: string,
  candidates: Candidate[],
  opts: ResolveOptions,
): FieldResolution {
  const usable = candidates.filter((c) => c.confidence >= opts.floorThreshold);
  if (usable.length === 0) {
    return {
      fieldPath,
      chosen: null,
      competing: candidates,
      status: "ABSENT",
      rationale: candidates.length === 0
        ? "not found in any document"
        : `found ${candidates.length} candidate(s) but all below the floor threshold ${opts.floorThreshold}`,
    };
  }

  // Equivalence classes.
  const classes: Array<{ rep: Candidate; members: Candidate[] }> = [];
  for (const c of usable) {
    const cls = classes.find((k) => equivalent(fieldPath, k.rep.valueNormalized ?? k.rep.valueRaw, c.valueNormalized ?? c.valueRaw));
    if (cls) cls.members.push(c);
    else classes.push({ rep: c, members: [c] });
  }

  // MULTI fields are collections, not competitors.
  //
  // Four sections on an FIR, two parties' PANs on a deed, four phone numbers in a
  // witness list — these are all simultaneously true. Running them through
  // single-value conflict resolution asks the advocate to pick one PAN out of
  // two correct ones, which is worse than useless: it teaches them to distrust
  // the conflict UI, which is the one thing that must stay trustworthy.
  if (cardinalityOf(fieldPath) === "MULTI") {
    const collected = classes.map((cls) => {
      const best = cls.members.reduce((a, b) =>
        (b.confidence * b.authorityWeight > a.confidence * a.authorityWeight ? b : a));
      const docs = new Set(cls.members.map((m) => m.documentId));
      return {
        ...best,
        confidence: combineConfidence({
          base: best.confidence,
          authorityWeight: Math.max(...cls.members.map((m) => m.authorityWeight)),
          corroborations: docs.size - 1,
          // No contradiction penalty: another value in the same collection is a
          // sibling, not a rival.
          contradictions: 0,
          aiInvolved: cls.members.some((m) => m.aiInvolved),
          aiCap: opts.aiCap,
        }),
      };
    }).sort((a, b) => b.confidence - a.confidence);

    const above = collected.filter((c) => c.confidence >= opts.autofillThreshold);
    const head = above[0] ?? collected[0]!;

    return {
      fieldPath,
      // The chosen candidate carries the whole collection in valueNormalized, so
      // a consumer that expects one value still gets the strongest member and a
      // consumer that expects the set gets all of it.
      chosen: {
        ...head,
        valueNormalized: flattenCollection(collected),
        notes: [
          ...(head.notes ?? []),
          `collection of ${collected.length} distinct value(s)`,
          `${above.length} at or above the autofill threshold`,
        ],
      },
      competing: collected.slice(1),
      status: above.length > 0 ? "RESOLVED" : "LOW_CONFIDENCE",
      rationale:
        `multi-valued field: ${collected.length} distinct value(s) collected across ` +
        `${new Set(usable.map((c) => c.documentId)).size} document(s); ` +
        `${above.length} at or above the autofill threshold. ` +
        `Values are siblings, not alternatives — none was discarded.`,
    };
  }

  // Score each class.
  const scored = classes.map((cls) => {
    // Corroboration counts DISTINCT DOCUMENTS, not candidates. Two patterns
    // matching the same line in the same document is one piece of evidence, not
    // two — counting candidates would let a repetitive document out-vote three
    // others.
    const docs = new Set(cls.members.map((m) => m.documentId));
    const otherDocs = new Set(
      usable.filter((c) => !cls.members.includes(c)).map((c) => c.documentId),
    );
    // A contradicting document is one that produced a value in a different class.
    for (const d of docs) otherDocs.delete(d);

    const best = cls.members.reduce((a, b) => (b.confidence * b.authorityWeight > a.confidence * a.authorityWeight ? b : a));
    const conf = combineConfidence({
      base: best.confidence,
      authorityWeight: Math.max(...cls.members.map((m) => m.authorityWeight)),
      corroborations: docs.size - 1,
      contradictions: otherDocs.size,
      aiInvolved: cls.members.some((m) => m.aiInvolved),
      aiCap: opts.aiCap,
    });
    return { cls, best, conf, docs: docs.size, contradictions: otherDocs.size };
  });

  scored.sort((a, b) => b.conf - a.conf);
  const top = scored[0]!;
  const runnerUp = scored[1];

  const chosen: Candidate = { ...top.best, confidence: top.conf };
  const competing = usable.filter((c) => c !== top.best);

  // A genuine conflict: another class is materially supported and close behind.
  const CONFLICT_GAP = 0.15;
  if (runnerUp && (top.conf - runnerUp.conf) < CONFLICT_GAP) {
    return {
      fieldPath,
      chosen: null,
      competing: usable,
      status: "CONFLICT",
      rationale:
        `${scored.length} distinct values across documents and the top two are within ${CONFLICT_GAP} ` +
        `(${top.conf.toFixed(2)} vs ${runnerUp.conf.toFixed(2)}). ` +
        `"${short(top.best)}" from ${top.best.documentId} p${top.best.pageNo} vs ` +
        `"${short(runnerUp.best)}" from ${runnerUp.best.documentId} p${runnerUp.best.pageNo}. ` +
        `Advocate must choose — the system will not guess between conflicting documents.`,
    };
  }

  if (top.conf < opts.autofillThreshold) {
    return {
      fieldPath,
      chosen,
      competing,
      status: "LOW_CONFIDENCE",
      rationale:
        `best value "${short(chosen)}" at confidence ${top.conf.toFixed(2)}, below the autofill ` +
        `threshold ${opts.autofillThreshold}. Shown for confirmation, not pre-filled.` +
        (top.contradictions > 0 ? ` ${top.contradictions} document(s) disagree.` : ""),
    };
  }

  return {
    fieldPath,
    chosen,
    competing,
    status: "RESOLVED",
    rationale:
      `"${short(chosen)}" from ${chosen.documentId} p${chosen.pageNo} ` +
      `(${chosen.extractorKind}, authority ${chosen.authorityWeight.toFixed(2)}` +
      (top.docs > 1 ? `, corroborated by ${top.docs - 1} other document(s)` : "") +
      `) → confidence ${top.conf.toFixed(2)}`,
  };
}

/**
 * Flatten a MULTI field's classes into one array value.
 *
 * Members whose normalised value is itself an array (a section run yields
 * `StatuteSection[]`) are spread, so `sections` ends up as a flat list of
 * sections rather than a list of lists. Duplicates across classes are already
 * excluded by equivalence, but spreading can reintroduce them — an FIR that
 * states "420, 468, 471 r/w 34 IPC" twice produces two runs containing the same
 * four sections — so a final key-based dedupe runs over the flattened result.
 */
function flattenCollection(cands: Candidate[]): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const c of cands) {
    const v = c.valueNormalized ?? c.valueRaw;
    const items = Array.isArray(v) ? v : [v];
    for (const item of items) {
      const key = typeof item === "object" && item !== null
        ? JSON.stringify(Object.fromEntries(Object.entries(item as Record<string, unknown>)
            // `successor` is derived, not identifying — including it would make
            // the same section look distinct depending on concordance state.
            .filter(([k]) => k !== "successor" && k !== "raw" && k !== "statuteLabel")
            .sort(([a], [b]) => a.localeCompare(b))))
        : String(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function short(c: Candidate): string {
  const v = c.valueNormalized ?? c.valueRaw;
  const s = typeof v === "object" && v !== null
    ? (("canonical" in (v as object) && String((v as Record<string, unknown>).canonical)) ||
       ("iso" in (v as object) && String((v as Record<string, unknown>).iso)) ||
       JSON.stringify(v))
    : String(v);
  return s.length > 60 ? s.slice(0, 57) + "…" : s;
}

/** Resolve every field present in the candidate list. */
export function resolveAll(candidates: Candidate[], opts: ResolveOptions): FieldResolution[] {
  const byField = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const arr = byField.get(c.fieldPath);
    if (arr) arr.push(c); else byField.set(c.fieldPath, [c]);
  }
  return [...byField.entries()]
    .map(([fieldPath, cs]) => resolveField(fieldPath, cs, opts))
    .sort((a, b) => a.fieldPath.localeCompare(b.fieldPath));
}
