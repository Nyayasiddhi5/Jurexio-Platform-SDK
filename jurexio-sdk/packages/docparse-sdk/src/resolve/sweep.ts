/**
 * Grammar sweep — run the pattern registry over a document's pages and emit
 * provenance-bearing candidates.
 *
 * The sweep is the shape-based half of extraction (the anchor engine is the
 * label-based half). Its job is not just to find matches but to attach enough
 * context that a match can be JUDGED: which line, which zone, which page, what
 * the surrounding words were, and how much the page's own read quality should
 * discount it.
 *
 * Zone weighting is applied here and it matters. A date in the footer of an order
 * sheet is usually a print timestamp; the same shape in the body is the order
 * date. Treating them alike is how a printer timestamp ends up driving a
 * limitation calculation.
 */

import type { BBox, Candidate, Page, ParsedDate } from "../types.js";
import { bboxUnion } from "../types.js";
import { PATTERN_REGISTRY, freshRegex, type PatternSpec } from "../grammar/patterns.js";
import { pageConfidence } from "../anchors/engine.js";
import { parseDate } from "../grammar/dates.js";
import { crossCheckMoney } from "../grammar/money.js";
import { findSections } from "../grammar/sections.js";
import { prepare } from "../grammar/script.js";
import { findRepairs, verhoeffValid } from "../grammar/repair.js";

/**
 * Zone multipliers.
 *
 * Header and footer carry running titles, page numbers and print stamps —
 * genuine content sometimes, boilerplate usually. Margins carry endorsements,
 * which are real but are ABOUT the document rather than part of it.
 */
const ZONE_WEIGHT: Record<Page["lines"][number]["zone"], number> = {
  BODY: 1.0,
  HEADER: 0.75,
  FOOTER: 0.55,
  MARGIN_LEFT: 0.7,
  MARGIN_RIGHT: 0.7,
};

/**
 * Script penalty for candidates read off Indic-script lines.
 *
 * Justified by measurement, not caution: on the fixture set, Devanagari and Tamil
 * OCR of prose produced systematic matra-reordering errors ("दनिंक" for "दिनांक",
 * "சனெனல" for "சென்னை") while ASCII digit runs on the same lines came through
 * intact after arbitration. So a NUMERIC candidate off an Indic line is fine, but
 * a TEXTUAL one — a name, a place, an occupation — is materially less reliable
 * and must not be pre-filled at the same confidence as its Latin equivalent.
 */
function scriptPenalty(spec: PatternSpec, lineScript: string): number {
  const isIndic = lineScript !== "Latn" && lineScript !== "Zyyy" && lineScript !== "Zzzz";
  if (!isIndic) return 1;
  const numericField = /^(?:cnr|caseNumber|diaryNumber|fir\.|chargesheet\.|sections|articles|amounts|instrument\.|bank\.|ids\.|contacts\.phone|property\.registrationNo|vehicle\.)/;
  return numericField.test(spec.fieldPath ?? "") ? 0.95 : 0.72;
}

export interface SweepOptions {
  documentId: string;
  docTypeCode: string;
  authorityWeight: (fieldPath: string) => number;
  referenceYear?: number;
  /** Restrict to these pattern ids. Used for targeted re-extraction. */
  only?: string[];
}

/**
 * Patterns that must be swept over whole BLOCKS, not single lines.
 *
 * Line-level sweeping has a hard limitation that showed up on a real document:
 * legal text wraps, and a pattern that straddles the break is invisible. The
 * s.138 notice reads
 *
 *     "...proceedings under Section 138 read"
 *     "with Section 142 of the Negotiable Instruments Act, 1881 before the..."
 *
 * so the line-level sweep saw "Section 138 read" (no statute → no match) and
 * "Section 142 of the NI Act" (match). Section 138 — the section the entire
 * complaint rests on — was silently dropped. Not mis-read. Dropped.
 *
 * These pattern ids therefore get a second pass over block text, with offsets
 * mapped back to the contributing lines so provenance and highlighting survive.
 * Only patterns that can legitimately span a wrap are listed: an identifier like
 * a CNR or an IFSC never wraps, and sweeping it at block level would only create
 * duplicates.
 */
const BLOCK_LEVEL_PATTERNS = new Set([
  "SECTION_BLOCK", "ARTICLE", "ORDER_RULE", "CITATION_REPORTED", "CITATION_AIR",
  "MONEY", "ACT_NUMBER", "ACT_NUMBER_PAREN", "CASE_NUMBER", "FIR_NO", "CHARGESHEET_NO",
  "DISPOSITION", "COURT_NAME", "CORAM", "POLICE_STATION", "RELATION",
  "DISHONOUR_REASON", "REG_DOC_NO", "CHEQUE_NO",
]);

/**
 * The case number of THIS proceeding versus a case number it merely mentions.
 *
 * A judgement in a criminal appeal carries both: "CRL.A. No. 567 of 2023" in its
 * cause title, and "S.C. No. 112/2021" in the body where it describes the trial
 * it arose from. Both are real case numbers, so treating them as rival readings
 * of one field produced a permanent CONFLICT on every appellate document and
 * pre-filled nothing.
 *
 * They are different FIELDS, and position tells them apart: the proceeding's own
 * number sits in the cause-title region at the top of page 1; anything further
 * down is a related matter.
 */
function caseNumberFieldPath(page: Page, line: Page["lines"][number]): string {
  const inTitleRegion = page.pageNo === 1 && line.bbox.y < page.height * 0.32;
  return inTitleRegion ? "caseNumber" : "relatedCase";
}

export function sweep(pages: Page[], opts: SweepOptions): Candidate[] {
  const out: Candidate[] = [];
  const specs = opts.only
    ? PATTERN_REGISTRY.filter((s) => opts.only!.includes(s.id))
    : PATTERN_REGISTRY;

  for (const page of pages) {
    const pageConf = pageConfidence(page);
    if (pageConf === 0) continue;

    // ---- Block-level pass, for patterns that can span a line wrap.
    for (const block of page.blocks) {
      if (block.lines.length < 2) continue; // a single-line block adds nothing here

      // Join with a space and keep an offset→line map so a match can be traced
      // back to the exact lines it covered.
      const offsets: Array<{ start: number; end: number; line: Page["lines"][number] }> = [];
      let cursor = 0;
      const parts: string[] = [];
      for (const line of block.lines) {
        const { text } = prepare(line.text);
        offsets.push({ start: cursor, end: cursor + text.length, line });
        parts.push(text);
        cursor += text.length + 1;
      }
      const blockText = parts.join(" ");
      if (blockText.length === 0) continue;

      const linesFor = (from: number, to: number) =>
        offsets.filter((o) => o.end >= from && o.start <= to).map((o) => o.line);

      for (const spec of specs) {
        if (!BLOCK_LEVEL_PATTERNS.has(spec.id)) continue;
        const re = freshRegex(spec.re);
        let m: RegExpExecArray | null;
        while ((m = re.exec(blockText)) !== null) {
          if (m[0].length === 0) { re.lastIndex++; continue; }
          const covered = linesFor(m.index, m.index + m[0].length);
          if (covered.length === 0) continue;
          // Only emit when the match actually SPANS lines — a within-one-line
          // match is already produced by the line pass, and emitting it again
          // would inflate corroboration counts with a duplicate of itself.
          if (covered.length < 2) continue;

          const first = covered[0]!;
          const bbox = covered.reduce<BBox>((acc, l) => bboxUnion(acc, l.bbox), { ...first.bbox });
          const zoneW = ZONE_WEIGHT[first.zone];
          const meanLineConf = covered.reduce((a, l) => a + l.conf, 0) / covered.length;

          const fieldPath = spec.id === "CASE_NUMBER"
            ? caseNumberFieldPath(page, first)
            : (spec.fieldPath ?? spec.id.toLowerCase());

          out.push({
            fieldPath,
            valueRaw: m[0].trim(),
            valueNormalized: normalise(spec, m, opts.referenceYear),
            confidence: Math.min(0.98,
              spec.baseConf * pageConf * zoneW *
              scriptPenalty(spec, first.script) *
              (meanLineConf > 0 ? Math.min(1, 0.6 + 0.4 * meanLineConf) : 1) *
              // A wrapped match is slightly less certain than a contiguous one:
              // the join inserts a space that was not in the document.
              0.97),
            extractorId: `grammar:${spec.id}:block`,
            extractorKind: "GRAMMAR",
            aiInvolved: false,
            documentId: opts.documentId,
            pageNo: page.pageNo,
            bbox,
            lineIndices: covered.map((l) => l.index),
            authorityWeight: opts.authorityWeight(fieldPath),
            notes: [`pattern=${spec.id}`, "matched across a line wrap",
                    `lines=${covered.map((l) => l.index).join(",")}`, `zone=${first.zone}`],
            ...(spec.sensitive ? { redacted: false } : {}),
          });
        }
      }
    }

    // ---- Structural identifier repair, OCR pages only.
    //
    // Recovers identifiers lost to single-character OCR confusions on fixed-width
    // formats. Measured need: "IFSC: SBIN0000691" was read as "SBINO000691" and
    // the bank identifier was absent from the extraction entirely.
    if (page.route === "OCR" || page.route === "HYBRID") {
      for (const line of page.lines) {
        const { text } = prepare(line.text);
        for (const rep of findRepairs(text, { script: line.script, fromOcr: true })) {
          out.push({
            fieldPath: rep.format.fieldPath,
            valueRaw: rep.original,
            valueNormalized: rep.repaired,
            confidence: Math.min(0.95, rep.confidence * pageConf * ZONE_WEIGHT[line.zone]),
            extractorId: `repair:${rep.format.id}`,
            extractorKind: "COMPUTED",
            aiInvolved: false,
            documentId: opts.documentId,
            pageNo: page.pageNo,
            bbox: line.bbox,
            lineIndices: [line.index],
            authorityWeight: opts.authorityWeight(rep.format.fieldPath),
            notes: [
              `OCR read "${rep.original}", corrected to "${rep.repaired}"`,
              `${rep.positions.length} character(s) substituted at position(s) ${rep.positions.join(",")}`,
              rep.checksumVerified ? "checksum verified" : "no checksum available for this format",
            ],
            ...(rep.format.id === "AADHAAR" ? { redacted: false } : {}),
          });
        }
      }
    }

    // ---- Line-level pass.
    for (const line of page.lines) {
      const { text } = prepare(line.text);
      if (text.length === 0) continue;
      const zoneW = ZONE_WEIGHT[line.zone];

      for (const spec of specs) {
        const re = freshRegex(spec.re);
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          if (m[0].length === 0) { re.lastIndex++; continue; }

          const valueRaw = m[0].trim();
          const primary = firstDefined(m.slice(1)) ?? valueRaw;

          const fieldPath = spec.id === "CASE_NUMBER"
            ? caseNumberFieldPath(page, line)
            : (spec.fieldPath ?? spec.id.toLowerCase());

          const normalized = normalise(spec, m, opts.referenceYear);

          // An Aadhaar-shaped run that fails the Verhoeff checksum is masked all
          // the same, but it is far less likely to BE an Aadhaar — a 15-digit
          // IMEI, a long account number or a concatenated reference all contain
          // Aadhaar-shaped substrings. Lowering the confidence stops such a
          // number being asserted into the identity field while keeping the mask.
          const checksumPenalty =
            spec.id === "AADHAAR" &&
            normalized !== null && typeof normalized === "object" &&
            (normalized as { checksumValid?: boolean }).checksumValid === false
              ? 0.55 : 1;

          const conf =
            spec.baseConf *
            pageConf *
            zoneW *
            checksumPenalty *
            scriptPenalty(spec, line.script) *
            (line.conf > 0 ? Math.min(1, 0.6 + 0.4 * line.conf) : 1);

          out.push({
            fieldPath,
            valueRaw,
            valueNormalized: normalized,
            confidence: Math.min(0.98, conf),
            extractorId: `grammar:${spec.id}`,
            extractorKind: "GRAMMAR",
            aiInvolved: false,
            documentId: opts.documentId,
            pageNo: page.pageNo,
            bbox: line.bbox,
            lineIndices: [line.index],
            authorityWeight: opts.authorityWeight(fieldPath),
            notes: [`pattern=${spec.id}`, `zone=${line.zone}`, `script=${line.script}`,
                    ...(primary !== valueRaw ? [`capture=${primary}`] : [])],
            ...(spec.sensitive ? { redacted: false } : {}),
          });
        }
      }
    }
  }

  return out;
}

function firstDefined(groups: Array<string | undefined>): string | undefined {
  for (const g of groups) if (g !== undefined && g.length > 0) return g;
  return undefined;
}

/**
 * Normalise a match to its canonical stored form.
 *
 * Returns null when normalisation fails, which is a meaningful state: the value
 * was FOUND but could not be canonicalised, so it can be shown to the user but
 * must not be relied on by a computation.
 */
function normalise(spec: PatternSpec, m: RegExpExecArray, referenceYear?: number): unknown {
  switch (spec.id) {
    case "CNR":
      return {
        cnr: `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}`,
        stateCode: m[1], districtCode: m[2], establishment: m[3],
        serial: m[4], year: Number(m[5]),
      };

    case "FIR_NO": {
      const year = expand2(m[2], referenceYear);
      return { number: stripLeadingZeros(m[1] ?? ""), rawNumber: m[1], year };
    }

    case "CHARGESHEET_NO": {
      const year = expand2(m[2], referenceYear);
      return { number: stripLeadingZeros(m[1] ?? ""), year };
    }

    case "CASE_NUMBER":
      return {
        typeToken: (m[1] ?? "").replace(/\s+/g, ""),
        number: m[2],
        year: Number(m[3]),
      };

    case "DIARY_NO":
      return { number: m[1], year: Number(m[2]) };

    case "NEUTRAL_SC":
      return { kind: "NEUTRAL_SC", year: Number(m[1]), serial: Number(m[2]), canonical: `${m[1]} INSC ${m[2]}` };

    case "NEUTRAL_HC":
      return {
        kind: "NEUTRAL_HC", year: Number(m[1]), courtCode: m[2], serial: Number(m[3]),
        bench: m[4] ?? null,
        canonical: `${m[1]}:${m[2]}:${m[3]}${m[4] ? ":" + m[4] : ""}`,
      };

    case "CITATION_REPORTED":
      return { kind: "REPORTED", year: Number(m[1]), volume: m[2] ? Number(m[2]) : null, reporter: (m[3] ?? "").replace(/\s+/g, " ").trim(), page: Number(m[4]) };

    case "SECTION_BLOCK": {
      const secs = findSections(m[0]);
      return secs.length > 0 ? secs : null;
    }

    case "MONEY": {
      const cc = crossCheckMoney(m[0]);
      return cc[0] ? { amount: cc[0].figure.amount, currency: "INR", scale: cc[0].figure.scale, grouping: cc[0].figure.grouping, verdict: cc[0].verdict } : null;
    }

    case "AADHAAR": {
      // Stored MASKED from the outset. The unmasked value never becomes the
      // normalised form, so a downstream bug cannot persist it by accident.
      //
      // The Verhoeff checksum is recorded but NOT used to gate the match. The
      // asymmetry is deliberate: a false positive means a number is masked that
      // did not need to be — mildly annoying — while a false negative means a
      // real Aadhaar is persisted in full, which is a statutory breach. So we
      // mask permissively and merely FLAG whether the number is well-formed,
      // which is what the confidence adjustment below consumes.
      const digits = (m[1]! + m[2]! + m[3]!).replace(/\D/g, "");
      return {
        masked: `XXXX XXXX ${m[3]}`,
        last4: m[3],
        checksumValid: verhoeffValid(digits),
      };
    }

    case "ACCOUNT_NO": {
      const v = m[1] ?? "";
      return { masked: v.length > 4 ? "X".repeat(v.length - 4) + v.slice(-4) : "XXXX", last4: v.slice(-4) };
    }

    case "PAN": case "GSTIN": case "CIN": case "TAN": case "EPIC":
    case "PASSPORT": case "IFSC": case "MICR": case "DIN":
      return (m[1] ?? "").toUpperCase();

    case "PHONE_IN":
      return m[1] ? `+91${m[1]}` : null;

    case "EMAIL":
      return (m[1] ?? "").toLowerCase();

    case "AGE": {
      const n = Number(m[1]);
      return n >= 1 && n <= 120 ? n : null;
    }

    case "VEHICLE_REG":
      return (m[1] ?? "").replace(/[\s\-]/g, "").toUpperCase();

    case "ACT_NUMBER":
    case "ACT_NUMBER_PAREN":
      return { number: Number(m[1]), year: Number(m[2]) };

    case "REG_DOC_NO":
      return { number: m[1], year: Number(m[2]) };

    case "SURVEY_NO":
      return (m[1] ?? "").replace(/\s+/g, "");

    case "BAR_ENROLMENT":
      return (m[1] ?? "").replace(/\s+/g, "").toUpperCase();

    case "DISPOSITION":
      return (m[1] ?? "").toLowerCase().replace(/\s+/g, "_");

    case "DISHONOUR_REASON":
      return (m[0] ?? "").toLowerCase().replace(/\s+/g, "_");

    case "POLICE_STATION":
      return (m[1] ?? "").replace(/[,.\s]+$/, "").trim();

    case "COURT_NAME":
      return (m[1] ?? m[0]).replace(/\s+/g, " ").trim();

    case "CORAM":
      return (m[1] ?? "").replace(/\s+/g, " ").trim();

    case "RELATION":
      return { type: (m[1] ?? "").toUpperCase().replace(/\//g, "/"), name: (m[2] ?? "").trim() };

    default:
      return m[1] ?? m[0];
  }
}

function stripLeadingZeros(s: string): string {
  const t = s.replace(/^0+/, "");
  return t.length > 0 ? t : "0";
}

function expand2(raw: string | undefined, referenceYear?: number): number | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (raw.length === 4) return n;
  const ref = referenceYear ?? new Date().getUTCFullYear();
  const century = Math.floor(ref / 100) * 100;
  const cand = century + n;
  return cand > ref + 5 ? cand - 100 : cand;
}

/**
 * Extract every date on the page with its zone, as candidates.
 *
 * Separate from the pattern sweep because dates need the richer ParsedDate
 * treatment (ambiguity flag, calendar, impossible-date rejection) and because
 * the marker word before a date ("pronounced on", "next date", "dated") changes
 * both its field path and its confidence far more than any other pattern.
 */
export function sweepDates(pages: Page[], opts: SweepOptions): Candidate[] {
  const out: Candidate[] = [];

  const MARKERS: Array<{ re: RegExp; fieldPath: string; conf: number }> = [
    { re: /\bpronounced\s+on\b/i, fieldPath: "order.pronouncedOn", conf: 0.93 },
    { re: /\breserved\s+on\b/i, fieldPath: "order.reservedOn", conf: 0.92 },
    { re: /\b(?:next\s+date|next\s+hearing|listed\s+on|adjourned\s+to|returnable\s+on)\b/i, fieldPath: "nextHearing.date", conf: 0.9 },
    { re: /\b(?:registered|executed)\s+on\b/i, fieldPath: "deed.date", conf: 0.9 },
    { re: /\bfiled\s+on\b/i, fieldPath: "filing.date", conf: 0.9 },
    { re: /\bw\.?e\.?f\.?\b|\bwith\s+effect\s+from\b/i, fieldPath: "effectiveDate", conf: 0.88 },
    { re: /\b(?:arrested|taken\s+into\s+custody)\s+on\b/i, fieldPath: "arrest.date", conf: 0.9 },
    { re: /\bdate\s+of\s+(?:birth|dob)\b/i, fieldPath: "parties.dob", conf: 0.9 },
    { re: /\b(?:dated|dt\.?)\b/i, fieldPath: "dates.dated", conf: 0.85 },
  ];

  for (const page of pages) {
    const pageConf = pageConfidence(page);
    if (pageConf === 0) continue;

    for (const line of page.lines) {
      const { text } = prepare(line.text);
      const found = findDatesInLine(text, opts.referenceYear);
      if (found.length === 0) continue;

      for (const f of found) {
        // Which marker, if any, governs this date? Look backwards from the date
        // within the line — that is where the marker sits in every real phrasing.
        const before = text.slice(0, f.index);
        const marker = MARKERS.find((mk) => {
          const re = new RegExp(mk.re.source + "\\s*[:\\-]?\\s*$", mk.re.flags.replace("g", ""));
          return re.test(before.slice(-40));
        }) ?? MARKERS.find((mk) => mk.re.test(before));

        const fieldPath = marker?.fieldPath ?? "dates.unlabelled";
        const base = marker?.conf ?? 0.62;

        // An ambiguous DD/MM order is capped below the autofill threshold. The
        // value is shown with both readings rather than silently committed.
        const ambiguityPenalty = f.date.ambiguousOrder ? 0.78 : 1;
        // A Saka date has no Gregorian ISO, so it cannot drive a clock.
        const calendarPenalty = f.date.calendar === "SAKA" ? 0.5 : 1;
        // An unparseable date is present-but-unusable.
        const parsePenalty = f.date.iso === null ? 0.45 : 1;

        out.push({
          fieldPath,
          valueRaw: f.date.raw,
          valueNormalized: f.date,
          confidence: Math.min(0.97,
            base * pageConf * ZONE_WEIGHT[line.zone] * ambiguityPenalty * calendarPenalty * parsePenalty),
          extractorId: `grammar:DATE${marker ? ":" + marker.fieldPath : ""}`,
          extractorKind: "GRAMMAR",
          aiInvolved: false,
          documentId: opts.documentId,
          pageNo: page.pageNo,
          bbox: line.bbox,
          lineIndices: [line.index],
          authorityWeight: opts.authorityWeight(fieldPath),
          notes: [
            `zone=${line.zone}`,
            f.date.ambiguousOrder ? "DD/MM order assumed; MM/DD also possible" : "order unambiguous",
            f.date.calendar === "SAKA" ? "Saka calendar — no Gregorian conversion applied" : "",
            f.date.iso === null ? "date parts present but not a valid date" : "",
          ].filter((s) => s.length > 0),
        });
      }
    }
  }
  return out;
}

function findDatesInLine(
  text: string,
  referenceYear?: number,
): Array<{ date: ParsedDate; index: number }> {
  const out: Array<{ date: ParsedDate; index: number }> = [];
  const seen = new Set<number>();
  const patterns = [
    /\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b/g,
    /\b\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:day\s+of\s+)?[A-Za-zऀ-෿]{3,20}\.?,?\s*(?:19|20)\d{2}\b/g,
    /\b[A-Za-zऀ-෿]{3,20}\.?\s+\d{1,2}\s*(?:st|nd|rd|th)?\s*,?\s*(?:19|20)\d{2}\b/g,
    /\b\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*(?:\d{4}|\d{2})\b/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(text)) !== null) {
      if (seen.has(m.index)) continue;
      const d = parseDate(m[0], referenceYear !== undefined ? { referenceYear } : {});
      if (!d) continue;
      // Skip pure year-only reads that came from a longer pattern's fragment.
      if (d.precision === "YEAR" && m[0].length < 6) continue;
      seen.add(m.index);
      out.push({ date: d, index: m.index });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}
