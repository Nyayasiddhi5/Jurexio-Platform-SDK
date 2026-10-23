/**
 * Date parsing for Indian legal documents.
 *
 * The hard problems, in order of how often they bite:
 *
 *  1. DD/MM vs MM/DD. India writes DD/MM. But documents drafted on foreign
 *     templates, and some system-generated exports, write MM/DD. We prefer
 *     DD/MM and RECORD that we made a choice (`ambiguousOrder`), so the review
 *     UI can flag "12/03/2024 — read as 12 March; could be 3 December".
 *     Silently guessing is how a limitation period gets computed nine months wrong.
 *
 *  2. Two-digit years. "123/24" in an FIR is 2024, but "45/97" is 1997. The
 *     pivot cannot be a fixed constant forever, so it is derived from the
 *     current year: a two-digit year more than 5 years in the future is read as
 *     the previous century.
 *
 *  3. Indic month names. Hindi, Marathi and Sanskrit documents use both the
 *     transliterated Gregorian months (जनवरी) and the Saka calendar months
 *     (चैत्र, वैशाख…). Saka dates appear on gazette notifications, which are
 *     primary legal sources. We recognise Saka months and mark the calendar so
 *     nothing downstream treats a Saka day number as Gregorian.
 *
 *  4. Impossible dates. "31/02/2024" occurs in real OCR output. We reject rather
 *     than roll over into March, because a rolled-over date is a wrong date that
 *     looks right.
 */

import type { ParsedDate } from "../types.js";
import { prepare } from "./script.js";

const GREG_MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

/** Devanagari transliterations of the Gregorian months, as actually printed. */
const DEVA_GREG_MONTHS: Record<string, number> = {
  "जनवरी": 1, "फरवरी": 2, "मार्च": 3, "अप्रैल": 4, "मई": 5, "जून": 6,
  "जुलाई": 7, "अगस्त": 8, "सितंबर": 9, "सितम्बर": 9, "अक्टूबर": 10,
  "अक्तूबर": 10, "नवंबर": 11, "नवम्बर": 11, "दिसंबर": 12, "दिसम्बर": 12,
};

/**
 * Saka (Indian national calendar) months. Month 1 Chaitra begins 22 March in a
 * common year. These carry `calendar: "SAKA"` and are NOT converted here —
 * converting requires the leap rule and the conversion is only correct if the
 * era offset (78 years) is applied to the Saka year, which documents sometimes
 * already do. We surface the parse and let a caller with the full context decide.
 */
const SAKA_MONTHS: Record<string, number> = {
  "चैत्र": 1, "वैशाख": 2, "ज्येष्ठ": 3, "आषाढ": 4, "आषाढ़": 4, "श्रावण": 5,
  "भाद्रपद": 6, "आश्विन": 7, "कार्तिक": 8, "अग्रहायण": 9, "मार्गशीर्ष": 9,
  "पौष": 10, "माघ": 11, "फाल्गुन": 12,
};

const TAMIL_MONTHS: Record<string, number> = {
  "ஜனவரி": 1, "பிப்ரவரி": 2, "மார்ச்": 3, "ஏப்ரல்": 4, "மே": 5, "ஜூன்": 6,
  "ஜூலை": 7, "ஆகஸ்ட்": 8, "செப்டம்பர்": 9, "அக்டோபர்": 10, "நவம்பர்": 11, "டிசம்பர்": 12,
};

const TELUGU_MONTHS: Record<string, number> = {
  "జనవరి": 1, "ఫిబ్రవరి": 2, "మార్చి": 3, "ఏప్రిల్": 4, "మే": 5, "జూన్": 6,
  "జూలై": 7, "ఆగస్టు": 8, "సెప్టెంబర్": 9, "అక్టోబర్": 10, "నవంబర్": 11, "డిసెంబర్": 12,
};

const BENGALI_MONTHS: Record<string, number> = {
  "জানুয়ারি": 1, "ফেব্রুয়ারি": 2, "মার্চ": 3, "এপ্রিল": 4, "মে": 5, "জুন": 6,
  "জুলাই": 7, "আগস্ট": 8, "সেপ্টেম্বর": 9, "অক্টোবর": 10, "নভেম্বর": 11, "ডিসেম্বর": 12,
};

function monthFromWord(word: string): { m: number; calendar: "GREGORIAN" | "SAKA" } | null {
  const w = word.trim().replace(/\.$/, "");
  const lower = w.toLowerCase();
  if (GREG_MONTHS[lower] !== undefined) return { m: GREG_MONTHS[lower]!, calendar: "GREGORIAN" };
  if (DEVA_GREG_MONTHS[w] !== undefined) return { m: DEVA_GREG_MONTHS[w]!, calendar: "GREGORIAN" };
  if (TAMIL_MONTHS[w] !== undefined) return { m: TAMIL_MONTHS[w]!, calendar: "GREGORIAN" };
  if (TELUGU_MONTHS[w] !== undefined) return { m: TELUGU_MONTHS[w]!, calendar: "GREGORIAN" };
  if (BENGALI_MONTHS[w] !== undefined) return { m: BENGALI_MONTHS[w]!, calendar: "GREGORIAN" };
  if (SAKA_MONTHS[w] !== undefined) return { m: SAKA_MONTHS[w]!, calendar: "SAKA" };
  return null;
}

/** Days in month, Gregorian, with the correct leap rule (not "% 4"). */
export function daysInMonth(y: number, m: number): number {
  if (m < 1 || m > 12) return 0;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
}

export interface DateParseOptions {
  /** Reference year for two-digit expansion. Injected so tests are stable. */
  referenceYear?: number;
  /** Prefer month-first when the document is known to use a foreign template. */
  preferMonthFirst?: boolean;
}

/** Expand a two-digit year. A year more than 5 ahead of the reference is last century. */
export function expandYear(yy: number, referenceYear: number): number {
  if (yy >= 100) return yy;
  const century = Math.floor(referenceYear / 100) * 100;
  const candidate = century + yy;
  return candidate > referenceYear + 5 ? candidate - 100 : candidate;
}

function build(
  raw: string,
  y: number | null,
  m: number | null,
  d: number | null,
  calendar: "GREGORIAN" | "SAKA",
  ambiguousOrder: boolean,
): ParsedDate {
  let precision: ParsedDate["precision"] = "UNKNOWN";
  if (y !== null && m !== null && d !== null) precision = "DAY";
  else if (y !== null && m !== null) precision = "MONTH";
  else if (y !== null) precision = "YEAR";

  let iso: string | null = null;
  if (calendar === "GREGORIAN" && y !== null && m !== null && d !== null) {
    if (m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m)) {
      iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    } else {
      // Impossible date. Keep the parts for display but refuse to emit an ISO
      // value — a downstream limitation calculation must not run on it.
      precision = "UNKNOWN";
    }
  }
  return { iso, y, m, d, precision, calendar, ambiguousOrder, raw };
}

/**
 * Parse one date string. Returns null only when nothing date-like is present.
 * A malformed date returns a ParsedDate with `iso: null` and `precision: UNKNOWN`
 * — the distinction matters, because "present but unparseable" needs review while
 * "absent" does not.
 */
export function parseDate(input: string, opts: DateParseOptions = {}): ParsedDate | null {
  const refYear = opts.referenceYear ?? new Date().getUTCFullYear();
  const { text } = prepare(input);
  const s = text.trim();
  if (s.length === 0) return null;

  // ISO first — unambiguous, so no order question arises.
  const iso = /\b((?:19|20)\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(s);
  if (iso) {
    return build(iso[0], Number(iso[1]), Number(iso[2]), Number(iso[3]), "GREGORIAN", false);
  }

  // Verbal, day first: "15th August, 2024" / "15 अगस्त 2024" / "15th day of August, 2024"
  const dmy = /\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:day\s+of\s+)?([A-Za-zऀ-෿]{3,20})\.?,?\s*((?:19|20)\d{2})\b/.exec(s);
  if (dmy) {
    const mo = monthFromWord(dmy[2]!);
    if (mo) return build(dmy[0], Number(dmy[3]), mo.m, Number(dmy[1]), mo.calendar, false);
  }

  // Verbal, month first: "August 15, 2024"
  const mdy = /\b([A-Za-zऀ-෿]{3,20})\.?\s+(\d{1,2})\s*(?:st|nd|rd|th)?\s*,?\s*((?:19|20)\d{2})\b/.exec(s);
  if (mdy) {
    const mo = monthFromWord(mdy[1]!);
    if (mo) return build(mdy[0], Number(mdy[3]), mo.m, Number(mdy[2]), mo.calendar, false);
  }

  // Month and year only: "August 2024" / "08/2024"
  const my = /\b([A-Za-zऀ-෿]{3,20})\.?,?\s*((?:19|20)\d{2})\b/.exec(s);

  // Numeric: 12/03/2024, 12-3-24, 12.03.2024
  const num = /\b(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{2,4})\b/.exec(s);
  if (num) {
    const a = Number(num[1]);
    const b = Number(num[2]);
    const y = expandYear(Number(num[3]), refYear);

    // Order resolution. If one component exceeds 12 it is unambiguously the day.
    let d: number;
    let m: number;
    let ambiguous = false;
    if (a > 12 && b <= 12) { d = a; m = b; }
    else if (b > 12 && a <= 12) { d = b; m = a; }
    else if (a <= 12 && b <= 12) {
      // Genuinely ambiguous. India is DD/MM, so that is the default, but we
      // record the ambiguity rather than hiding it.
      ambiguous = true;
      if (opts.preferMonthFirst) { m = a; d = b; } else { d = a; m = b; }
    } else {
      // Both above 12 — not a date.
      return build(num[0], y, null, null, "GREGORIAN", false);
    }
    return build(num[0], y, m, d, "GREGORIAN", ambiguous);
  }

  if (my) {
    const mo = monthFromWord(my[1]!);
    if (mo) return build(my[0], Number(my[2]), mo.m, null, mo.calendar, false);
  }

  // Year alone, only when it looks like a legal year reference.
  const yOnly = /\b(?:of|year)\s+((?:19|20)\d{2})\b/i.exec(s);
  if (yOnly) return build(yOnly[0], Number(yOnly[1]), null, null, "GREGORIAN", false);

  return null;
}

/** Find every date in a block of text, with its offset, in document order. */
export function findDates(
  input: string,
  opts: DateParseOptions = {},
): Array<{ date: ParsedDate; index: number; length: number }> {
  const { text } = prepare(input);
  const out: Array<{ date: ParsedDate; index: number; length: number }> = [];
  const seen = new Set<number>();

  const scan = (re: RegExp) => {
    const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = r.exec(text)) !== null) {
      if (m[0].length === 0) { r.lastIndex++; continue; }
      if (seen.has(m.index)) continue;
      const parsed = parseDate(m[0], opts);
      if (parsed && (parsed.iso !== null || parsed.precision !== "UNKNOWN")) {
        seen.add(m.index);
        out.push({ date: parsed, index: m.index, length: m[0].length });
      }
    }
  };

  // Longest/most specific forms first, so a verbal date is not shadowed by a
  // numeric fragment inside it.
  scan(/\b(?:19|20)\d{2}-\d{1,2}-\d{1,2}\b/g);
  scan(/\b\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:day\s+of\s+)?[A-Za-zऀ-෿]{3,20}\.?,?\s*(?:19|20)\d{2}\b/g);
  scan(/\b[A-Za-zऀ-෿]{3,20}\.?\s+\d{1,2}\s*(?:st|nd|rd|th)?\s*,?\s*(?:19|20)\d{2}\b/g);
  scan(/\b\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*(?:\d{4}|\d{2})\b/g);

  return out.sort((a, b) => a.index - b.index);
}

/**
 * Add days to an ISO date. Used for limitation arithmetic.
 * Implemented on UTC to avoid the classic DST off-by-one — India has no DST, but
 * the container's local zone is not guaranteed to be IST.
 */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Inclusive day difference between two ISO dates. */
export function daysBetween(fromIso: string, toIso: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((p(toIso) - p(fromIso)) / 86_400_000);
}
