/**
 * Monetary parsing for Indian legal documents.
 *
 * Two things make this non-trivial and both have bitten real pipelines:
 *
 *  1. Indian digit grouping. "1,50,000" is one lakh fifty thousand. A Western
 *     `\d{1,3}(,\d{3})*` pattern matches "1,50" and drops two digits — so a
 *     ₹1,50,000 claim is read as ₹150 and the suit valuation, the court fee
 *     bracket and the pecuniary jurisdiction all come out wrong.
 *
 *  2. The words-and-figures cross-check. Indian pleadings and deeds almost always
 *     state the amount twice: "Rs. 15,00,000/- (Rupees Fifteen Lakh only)". When
 *     both are present and agree, confidence should be high. When they DISAGREE,
 *     that is one of the most legally significant discrepancies a parser can
 *     find — in a cheque-bounce or deed matter it can decide the case — so we
 *     surface it loudly rather than picking one.
 */

import type { ParsedMoney } from "../types.js";
import { prepare } from "./script.js";
import { MONEY, MONEY_WORDS, freshRegex } from "./patterns.js";

const SCALE_MULTIPLIER: Record<string, { mult: number; scale: ParsedMoney["scale"] }> = {
  thousand: { mult: 1_000, scale: "THOUSAND" },
  lakh: { mult: 100_000, scale: "LAKH" },
  lakhs: { mult: 100_000, scale: "LAKH" },
  lac: { mult: 100_000, scale: "LAKH" },
  lacs: { mult: 100_000, scale: "LAKH" },
  crore: { mult: 10_000_000, scale: "CRORE" },
  crores: { mult: 10_000_000, scale: "CRORE" },
  million: { mult: 1_000_000, scale: "NONE" },
  billion: { mult: 1_000_000_000, scale: "NONE" },
};

/**
 * Strip grouping commas. Safe because we validate the grouping shape first —
 * blindly removing commas would turn "1,2,3" into 123 and hide a garbled OCR read.
 */
function digitsFromGrouped(s: string): { value: number | null; grouping: "INDIAN" | "WESTERN" | "PLAIN" | "MALFORMED" } {
  const cleaned = s.replace(/\s/g, "");
  if (!cleaned.includes(",")) {
    const n = Number(cleaned);
    return { value: Number.isFinite(n) ? n : null, grouping: "PLAIN" };
  }
  // Indian: last group 3 digits, all earlier groups 2 digits, first group 1-2.
  if (/^\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d{1,2})?$/.test(cleaned)) {
    const n = Number(cleaned.replace(/,/g, ""));
    return { value: Number.isFinite(n) ? n : null, grouping: "INDIAN" };
  }
  // Western: all groups 3 digits.
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(cleaned)) {
    const n = Number(cleaned.replace(/,/g, ""));
    return { value: Number.isFinite(n) ? n : null, grouping: "WESTERN" };
  }
  // Anything else — e.g. "1,50,00" or "12,3456" — is a garbled read. We still
  // return the digits so a human can see it, but the caller must treat the
  // grouping as malformed and lower confidence.
  const n = Number(cleaned.replace(/,/g, ""));
  return { value: Number.isFinite(n) ? n : null, grouping: "MALFORMED" };
}

export interface MoneyMatch extends ParsedMoney {
  index: number;
  length: number;
  grouping: "INDIAN" | "WESTERN" | "PLAIN" | "MALFORMED";
}

export function findMoney(input: string): MoneyMatch[] {
  const { text } = prepare(input);
  const re = freshRegex(MONEY);
  const out: MoneyMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const numPart = m[1] ?? "";
    const scaleWord = (m[2] ?? "").toLowerCase();
    const { value, grouping } = digitsFromGrouped(numPart);
    let amount = value;
    let scale: ParsedMoney["scale"] = "NONE";
    if (amount !== null && scaleWord) {
      const sm = SCALE_MULTIPLIER[scaleWord];
      if (sm) { amount = amount * sm.mult; scale = sm.scale; }
    }
    out.push({
      amount,
      currency: "INR",
      scale,
      raw: m[0].trim(),
      index: m.index,
      length: m[0].length,
      grouping,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Amount in words
// ---------------------------------------------------------------------------

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const SCALES: Record<string, number> = {
  hundred: 100,
  thousand: 1_000,
  lakh: 100_000, lakhs: 100_000, lac: 100_000, lacs: 100_000,
  crore: 10_000_000, crores: 10_000_000,
  arab: 1_000_000_000,
};

/**
 * Convert an Indian amount-in-words to a number.
 *
 * Indian scale words are *segment* multipliers, not cumulative: "Two Crore
 * Fifteen Lakh Thirty Thousand Five Hundred" = 2e7 + 15e5 + 30e3 + 500. The
 * algorithm keeps a running segment, flushes it on each scale word above
 * hundred, and folds "hundred" into the current segment.
 */
export function wordsToNumber(input: string): number | null {
  const words = input
    .toLowerCase()
    .replace(/[^a-z\s\-]/g, " ")
    .split(/[\s\-]+/)
    .filter((w) => w.length > 0 && w !== "and" && w !== "rupees" && w !== "only" && w !== "paise");

  if (words.length === 0) return null;

  let total = 0;
  let segment = 0;
  let sawAny = false;

  for (const w of words) {
    if (UNITS[w] !== undefined) {
      segment += UNITS[w]!;
      sawAny = true;
      continue;
    }
    const sc = SCALES[w];
    if (sc === undefined) {
      // An unknown word inside an amount phrase means we are not confident we
      // read the whole amount. Refuse rather than return a partial number.
      return null;
    }
    sawAny = true;
    if (sc === 100) {
      // "hundred" scales the current segment and stays inside it.
      segment = (segment === 0 ? 1 : segment) * 100;
    } else {
      total += (segment === 0 ? 1 : segment) * sc;
      segment = 0;
    }
  }
  if (!sawAny) return null;
  return total + segment;
}

export function findMoneyWords(input: string): Array<{ raw: string; amount: number | null; index: number }> {
  const { text } = prepare(input);
  const re = freshRegex(MONEY_WORDS);
  const out: Array<{ raw: string; amount: number | null; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ raw: m[0].trim(), amount: wordsToNumber(m[1] ?? ""), index: m.index });
  }
  return out;
}

export interface MoneyCrossCheck {
  figure: MoneyMatch;
  words?: { raw: string; amount: number | null; index: number };
  /** AGREE, DISAGREE, or FIGURE_ONLY. DISAGREE is legally significant. */
  verdict: "AGREE" | "DISAGREE" | "FIGURE_ONLY" | "WORDS_UNPARSED";
  /** Confidence for the resulting candidate. */
  confidence: number;
}

/**
 * Pair each figure with the words that follow it within a short window, and
 * report agreement. The window is 120 characters because the standard Indian
 * formula — "Rs. 15,00,000/- (Rupees Fifteen Lakh only)" — always sits inside it,
 * while a wider window starts pairing unrelated amounts in a schedule.
 */
export function crossCheckMoney(input: string, windowChars = 120): MoneyCrossCheck[] {
  const figures = findMoney(input);
  const words = findMoneyWords(input);
  return figures.map((f) => {
    const w = words.find((x) => x.index >= f.index && x.index - (f.index + f.length) <= windowChars);
    if (!w) {
      return {
        figure: f,
        verdict: "FIGURE_ONLY" as const,
        confidence: f.grouping === "MALFORMED" ? 0.45 : 0.82,
      };
    }
    if (w.amount === null) {
      return { figure: f, words: w, verdict: "WORDS_UNPARSED" as const, confidence: 0.7 };
    }
    if (f.amount !== null && Math.abs(f.amount - w.amount) < 0.5) {
      return { figure: f, words: w, verdict: "AGREE" as const, confidence: 0.97 };
    }
    // Figures and words disagree. This is a finding, not a parse failure.
    return { figure: f, words: w, verdict: "DISAGREE" as const, confidence: 0.4 };
  });
}

/** Format for display in the review UI, with Indian grouping restored. */
export function formatINR(n: number): string {
  const neg = n < 0;
  const [intPart, decPart] = Math.abs(n).toFixed(2).split(".") as [string, string];
  let s = intPart;
  if (s.length > 3) {
    const last3 = s.slice(-3);
    let rest = s.slice(0, -3);
    const groups: string[] = [];
    while (rest.length > 2) {
      groups.unshift(rest.slice(-2));
      rest = rest.slice(0, -2);
    }
    if (rest.length > 0) groups.unshift(rest);
    s = groups.join(",") + "," + last3;
  }
  const out = `₹${s}${decPart === "00" ? "" : "." + decPart}`;
  return neg ? "-" + out : out;
}
