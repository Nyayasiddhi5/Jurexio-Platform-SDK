/**
 * Anchor extraction — label → value.
 *
 * The grammar pack finds things by their SHAPE ("this looks like a CNR"). The
 * anchor engine finds things by their LABEL ("whatever follows 'Police Station:'
 * is the police station"). Both are needed and they fail in opposite directions:
 *
 *  - Shape rules cannot read a party's name, an occupation, a place of occurrence
 *    or a boundary description, because those have no distinguishing shape.
 *  - Label rules cannot read a section run buried in a narrative paragraph,
 *    because there is no label.
 *
 * Indian court forms are heavily labelled — the FIR under CrPC s.154 is a
 * numbered form with fixed field names, and so are charge sheets, MLC reports,
 * invoices and filing receipts. On those documents the anchor engine does most of
 * the work and does it with high precision.
 *
 * THE THREE LAYOUTS an anchor has to handle, all of which occur:
 *
 *   INLINE      "P.S. Connaught Place"           value on the same line
 *   COLON_WRAP  "Address:"                       value on the following line(s)
 *               "B-45, Karol Bagh, New Delhi"
 *   COLUMN      "Name          | Rajesh Kumar"   value in a right-hand column,
 *                                                 vertically aligned, not adjacent
 *
 * Getting COLUMN right is what separates a usable form reader from a demo. A
 * two-column FIR header has the label at x=54 and the value at x=200, and a
 * naive "text after the colon" rule returns an empty string for every field.
 */

import type { BBox, Candidate, Line, Page } from "../types.js";
import { bboxUnion, verticalOverlapRatio } from "../types.js";
import { prepare } from "../grammar/script.js";
import { parseDate } from "../grammar/dates.js";
import { findMoney } from "../grammar/money.js";

export type AnchorLayout = "INLINE" | "COLON_WRAP" | "COLUMN" | "ANY";

export interface AnchorSpec {
  /** Dotted field path the value maps to. */
  fieldPath: string;
  /** Label patterns, most specific first. */
  labels: RegExp[];
  layout?: AnchorLayout;
  /** Stop the value at the first of these, when scanning forward. */
  stopAt?: RegExp;
  /** Maximum lines a wrapped value may span. */
  maxLines?: number;
  /** Reject a captured value that matches this — used to kill empty form fields. */
  reject?: RegExp;
  /** Post-process the raw captured string. */
  clean?: (s: string) => string;
  baseConf: number;
  label: string;
  /** Mark values needing masking before persistence. */
  sensitive?: boolean;
}

export interface AnchorProfile {
  id: string;
  /** Applies to these document type codes. */
  docTypes: string[];
  anchors: AnchorSpec[];
}

// ---------------------------------------------------------------------------
// Value scanning
// ---------------------------------------------------------------------------

/** Placeholder text that means "the form field was left blank". */
const EMPTY_VALUE = /^(?:[-–—_.\s]*|n\.?a\.?|nil|none|not\s+(?:applicable|available|known)|xxx+|\?+)$/i;

/**
 * Default stop for a wrapped value: a new numbered form field, another label, or
 * an all-caps heading.
 *
 * The all-caps branch was added after a wrapped value swallowed the next section
 * heading — "Rs. 50,000/- with one solvent surety of the like amount PRAYER" —
 * which then had to be cleaned out downstream. A heading is never part of the
 * value above it.
 */
const DEFAULT_STOP =
  /^\s*(?:\d{1,2}[.)]\s|\([a-z]\)\s|[A-Z][A-Za-z' ]{2,30}\s*:|[A-Z][A-Z\s]{3,}$)/;

function cleanValue(s: string): string {
  return s
    .replace(/^[\s:.\-–—>]+/, "")
    .replace(/[\s.\-–—_]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Find the value for one anchor on one page.
 *
 * Returns null rather than an empty string when nothing was found — the
 * distinction drives the "absent" list in the autofill payload, which is what
 * lets the UI show "not found in your documents" instead of a blank box the user
 * cannot distinguish from a parse failure.
 */
export function extractAnchor(
  page: Page,
  spec: AnchorSpec,
): { value: string; bbox: BBox; lineIndices: number[]; layout: AnchorLayout } | null {
  const layout = spec.layout ?? "ANY";
  const maxLines = spec.maxLines ?? 3;
  const stopAt = spec.stopAt ?? DEFAULT_STOP;

  for (const labelRe of spec.labels) {
    const re = new RegExp(labelRe.source, labelRe.flags.includes("g") ? labelRe.flags : labelRe.flags + "g");

    for (const line of page.lines) {
      re.lastIndex = 0;
      const m = re.exec(line.text);
      if (!m) continue;

      const afterLabel = line.text.slice(m.index + m[0].length);

      // ---- INLINE: value follows the label on the same line.
      if (layout === "INLINE" || layout === "ANY") {
        const inline = cleanValue(afterLabel);
        if (inline.length > 0 && !EMPTY_VALUE.test(inline)) {
          // Cut at the next label on the same line — form rows routinely pack
          // three fields onto one line ("District: X   P.S.: Y   Year: Z").
          const cut = /\s{2,}[A-Z][A-Za-z' .]{2,28}\s*:/.exec(inline);
          const value = cut ? inline.slice(0, cut.index).trim() : inline;
          if (value.length > 0 && !EMPTY_VALUE.test(value) && !spec.reject?.test(value)) {
            return {
              value: spec.clean ? spec.clean(value) : value,
              bbox: line.bbox,
              lineIndices: [line.index],
              layout: "INLINE",
            };
          }
        }
      }

      // ---- COLUMN: value is horizontally separated, vertically aligned.
      if (layout === "COLUMN" || layout === "ANY") {
        const labelRight = line.bbox.x + line.bbox.w;
        const sameRow = page.lines.filter(
          (l) => l.index !== line.index &&
                 verticalOverlapRatio(l.bbox, line.bbox) > 0.5 &&
                 l.bbox.x >= labelRight - 2,
        ).sort((a, b) => a.bbox.x - b.bbox.x);
        if (sameRow.length > 0) {
          const value = cleanValue(sameRow.map((l) => l.text).join(" "));
          if (value.length > 0 && !EMPTY_VALUE.test(value) && !spec.reject?.test(value)) {
            return {
              value: spec.clean ? spec.clean(value) : value,
              bbox: sameRow.reduce((acc, l) => bboxUnion(acc, l.bbox), { ...sameRow[0]!.bbox }),
              lineIndices: sameRow.map((l) => l.index),
              layout: "COLUMN",
            };
          }
        }
      }

      // ---- COLON_WRAP: value begins on the next line.
      //
      // Gated on the label actually behaving like a form label: it must end with
      // a colon, or sit at the end of its line with nothing after it. Without
      // that gate, a label phrase occurring mid-prose triggered a wrap and
      // captured whatever followed — "…shall have exclusive jurisdiction." pulled
      // in the next heading and reported the jurisdiction clause as "SCHEDULE OF
      // PROPERTY". A label buried in a sentence is a mention, not a field.
      const labelLooksLikeField =
        /[:\-]\s*$/.test(m[0]) ||
        cleanValue(afterLabel).length === 0 ||
        /[:\-]\s*$/.test(line.text.trimEnd());

      if ((layout === "COLON_WRAP" || layout === "ANY") && labelLooksLikeField) {
        const collected: string[] = [];
        const indices: number[] = [];
        let box: BBox | null = null;
        for (let i = line.index + 1; i < page.lines.length && collected.length < maxLines; i++) {
          const next = page.lines[i]!;
          if (next.zone !== line.zone) break;
          if (stopAt.test(next.text)) break;
          const t = cleanValue(next.text);
          if (t.length === 0) break;
          collected.push(t);
          indices.push(next.index);
          box = box ? bboxUnion(box, next.bbox) : { ...next.bbox };
          // A value that clearly ends (full stop, or a short line) stops here.
          if (/[.;]$/.test(t) || t.length < 25) break;
        }
        if (collected.length > 0) {
          const value = collected.join(" ");
          if (!EMPTY_VALUE.test(value) && !spec.reject?.test(value)) {
            return {
              value: spec.clean ? spec.clean(value) : value,
              bbox: box ?? line.bbox,
              lineIndices: indices,
              layout: "COLON_WRAP",
            };
          }
        }
      }
    }
  }
  return null;
}

/** Run a whole profile over a document's pages, producing candidates. */
export function runAnchorProfile(
  profile: AnchorProfile,
  pages: Page[],
  documentId: string,
  authorityWeight: number,
): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    for (const spec of profile.anchors) {
      // First page wins for a given field — form headers are on page 1, and a
      // later page repeating a label is usually a continuation sheet.
      if (seen.has(spec.fieldPath)) continue;
      const hit = extractAnchor(page, spec);
      if (!hit) continue;
      seen.add(spec.fieldPath);

      const normalised = normaliseAnchorValue(spec.fieldPath, hit.value);
      // Layout affects reliability: an inline value adjacent to its label is more
      // trustworthy than a wrapped value that might have swallowed the next field.
      const layoutPenalty = hit.layout === "INLINE" ? 1 : hit.layout === "COLUMN" ? 0.96 : 0.9;

      out.push({
        fieldPath: spec.fieldPath,
        valueRaw: hit.value,
        valueNormalized: normalised,
        confidence: Math.min(0.97, spec.baseConf * layoutPenalty * pageConfidence(page)),
        extractorId: `anchor:${profile.id}:${spec.fieldPath}`,
        extractorKind: "ANCHOR",
        aiInvolved: false,
        documentId,
        pageNo: page.pageNo,
        bbox: hit.bbox,
        lineIndices: hit.lineIndices,
        authorityWeight,
        notes: [`layout=${hit.layout}`, `label="${spec.label}"`],
        ...(spec.sensitive ? { redacted: false } : {}),
      });
    }
  }
  return out;
}

/**
 * Normalise an anchor's captured string into the same canonical form the grammar
 * sweep produces for the same field.
 *
 * Without this, the two extractors produce different REPRESENTATIONS of the same
 * fact and the resolver treats them as rival values. Measured: the anchor read
 * "Pronounced on: 26th August, 2024" and stored the string, the date sweep stored
 * a ParsedDate for the same characters, and `order.pronouncedOn` came out as a
 * CONFLICT asking the advocate to choose between a date and the same date.
 *
 * Two extractors agreeing is the single strongest signal available short of a
 * human, so it must not be thrown away by a formatting difference.
 */
export function normaliseAnchorValue(fieldPath: string, raw: string): unknown {
  const { text } = prepare(raw);

  const isDateField =
    /(?:\.date|Date|On)$/.test(fieldPath) ||
    /^(?:dates\.|.*\.dob$)/.test(fieldPath);
  if (isDateField) {
    const d = parseDate(text);
    // Fall back to the cleaned string when the value is not actually a date —
    // some "date" anchors capture a period ("within 15 days") instead.
    if (d && (d.iso !== null || d.precision !== "UNKNOWN")) return d;
  }

  const isMoneyField =
    /(?:valuation|consideration|rent|deposit|stampDuty|amount|suretyOffered|paid)$/i.test(fieldPath);
  if (isMoneyField) {
    const m = findMoney(text)[0];
    if (m) return { amount: m.amount, currency: m.currency, scale: m.scale, grouping: m.grouping };
  }

  return text;
}

/**
 * How much the page's own read quality should discount every candidate from it.
 * An OCR page at 0.62 mean confidence cannot yield a 0.95 field, however clean
 * the anchor match looks — the characters themselves are uncertain.
 */
export function pageConfidence(page: Page): number {
  if (page.route === "TEXT_LAYER") return 1;
  if (page.route === "EMPTY") return 0;
  const q = page.quality;
  // Sub-linear so a decent OCR page is not punished too hard, but a poor one is.
  return Math.max(0.3, Math.min(1, 0.55 + 0.45 * q.meanConf)) * (1 - q.garbleRate * 0.5);
}
