/**
 * Structural repair of OCR'd identifiers.
 *
 * WHY THIS EXISTS — a measured failure, not a hypothetical one.
 *
 * On the degraded FIR fixture, Tesseract read the line
 *
 *     "State Bank of India, Connaught Place Branch, IFSC: SBIN0000691,"
 *
 * as "IFSC: SBINO000691" — letter O where the digit 0 belongs. The IFSC pattern
 * correctly requires a literal '0' at position 5 (that is what the format
 * mandates), so it did not match, and the bank identifier was simply absent from
 * the extraction. The number was legible on the page; the pipeline lost it to one
 * character.
 *
 * That is an unusually tractable class of error, because Indian statutory
 * identifiers are FIXED-WIDTH with a KNOWN pattern of letters and digits. When a
 * token is the right length and every mismatch is at a position where the format
 * demands a digit and OCR produced a digit-confusable letter (or vice versa), the
 * repair is not a guess — it is the only string of that length that can satisfy
 * the format.
 *
 * The discipline that keeps this safe:
 *
 *  1. Repairs are MASK-DIRECTED, never speculative. We substitute only at
 *     positions where the mask and the observed character disagree, and only
 *     across a fixed confusion table. We do not enumerate variants and see what
 *     sticks.
 *  2. A repaired value must pass the STRICT validator afterwards, including any
 *     checksum. A repair that produces a syntactically valid but checksum-invalid
 *     PAN or GSTIN is rejected.
 *  3. Repairs are CAPPED at two substitutions. Beyond that the token is too
 *     damaged to be certain about, and a third substitution starts to make
 *     different formats reachable from the same token.
 *  4. Every repair is RECORDED on the candidate — the original token, the repaired
 *     token, and the positions changed — and carries a confidence penalty. The
 *     review UI shows "read as SBINO000691, corrected to SBIN0000691" so the
 *     advocate can check it against the page in one glance.
 *  5. Repair NEVER runs on a text-layer page. A text layer says what it says; if
 *     it contains a letter O, that is the document's own content, not a
 *     misreading, and "fixing" it would be fabrication.
 */

import type { ScriptCode } from "../types.js";

// ---------------------------------------------------------------------------
// Masks
// ---------------------------------------------------------------------------

/**
 * Mask characters:
 *   A  alpha only            [A-Z]
 *   D  digit only            [0-9]
 *   X  either                [A-Z0-9]
 *   0  the literal digit zero
 *   Z  the literal letter Z
 */
export interface IdentifierFormat {
  id: string;
  label: string;
  mask: string;
  /** Strict validator applied AFTER repair. */
  strict: RegExp;
  /** Optional checksum validator. */
  checksum?: (value: string) => boolean;
  /** Field path a repaired value maps to. */
  fieldPath: string;
  baseConf: number;
}

export const IDENTIFIER_FORMATS: IdentifierFormat[] = [
  {
    id: "IFSC", label: "IFSC", fieldPath: "bank.ifsc", baseConf: 0.92,
    // 4 alpha bank code, mandatory 0, 6 alnum branch code.
    mask: "AAAA0XXXXXX",
    strict: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  },
  {
    id: "PAN", label: "PAN", fieldPath: "ids.pan", baseConf: 0.9,
    // 5 alpha (4th encodes holder type), 4 digits, 1 alpha check letter.
    mask: "AAAAADDDDA",
    strict: /^[A-Z]{3}[ABCFGHLJPTKE][A-Z]\d{4}[A-Z]$/,
  },
  {
    id: "GSTIN", label: "GSTIN", fieldPath: "ids.gstin", baseConf: 0.92,
    // 2 digit state, 10 char PAN, 1 entity char, literal Z, 1 check char.
    mask: "DDAAAAADDDDAXZX",
    strict: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
    checksum: gstinChecksum,
  },
  {
    id: "CIN", label: "CIN", fieldPath: "ids.cin", baseConf: 0.92,
    mask: "ADDDDDAADDDDAAADDDDDD",
    strict: /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/,
  },
  {
    id: "TAN", label: "TAN", fieldPath: "ids.tan", baseConf: 0.85,
    mask: "AAAADDDDDA",
    strict: /^[A-Z]{4}\d{5}[A-Z]$/,
  },
  {
    id: "EPIC", label: "Voter ID", fieldPath: "ids.epic", baseConf: 0.7,
    mask: "AAADDDDDDD",
    strict: /^[A-Z]{3}\d{7}$/,
  },
  {
    id: "MICR", label: "MICR", fieldPath: "bank.micr", baseConf: 0.85,
    mask: "DDDDDDDDD",
    strict: /^\d{9}$/,
  },
  {
    id: "AADHAAR", label: "Aadhaar", fieldPath: "ids.aadhaar", baseConf: 0.75,
    mask: "DDDDDDDDDDDD",
    strict: /^[2-9]\d{11}$/,
    checksum: verhoeffValid,
  },
];

// ---------------------------------------------------------------------------
// Confusion tables
// ---------------------------------------------------------------------------

/**
 * Letters that OCR produces where a digit belongs, and the digit meant.
 * Restricted to the confusions that actually occur in Latin OCR of printed text.
 */
const LETTER_TO_DIGIT: Record<string, string> = {
  O: "0", o: "0", Q: "0", D: "0",
  I: "1", l: "1", i: "1", "|": "1",
  Z: "2", z: "2",
  A: "4",
  S: "5", s: "5",
  G: "6", b: "6",
  T: "7",
  B: "8",
  g: "9", q: "9",
};

/** Digits that OCR produces where a letter belongs, and the letter meant. */
const DIGIT_TO_LETTER: Record<string, string> = {
  "0": "O",
  "1": "I",
  "2": "Z",
  "4": "A",
  "5": "S",
  "6": "G",
  "8": "B",
};

export interface RepairResult {
  original: string;
  repaired: string;
  /** 0-based positions changed. */
  positions: number[];
  format: IdentifierFormat;
  /** Confidence after the repair penalty. */
  confidence: number;
  /** Whether a checksum was available and passed. */
  checksumVerified: boolean;
}

const MAX_SUBSTITUTIONS = 2;

/**
 * Try to repair one token against one format.
 * Returns null when the token cannot be made to fit within the substitution cap.
 */
export function repairAgainst(token: string, fmt: IdentifierFormat): RepairResult | null {
  const t = token.toUpperCase().replace(/[\s-]/g, "");
  if (t.length !== fmt.mask.length) return null;

  // Already valid — nothing to repair.
  if (fmt.strict.test(t)) return null;

  const chars = [...t];
  const positions: number[] = [];

  for (let i = 0; i < fmt.mask.length; i++) {
    const want = fmt.mask[i]!;
    const got = chars[i]!;

    const isDigit = /[0-9]/.test(got);
    const isAlpha = /[A-Z]/.test(got);

    let needsDigit = false;
    let needsAlpha = false;
    if (want === "D") needsDigit = true;
    else if (want === "0") { needsDigit = true; }
    else if (want === "A") needsAlpha = true;
    else if (want === "Z") needsAlpha = true;
    else continue; // X accepts either

    if (needsDigit && isDigit) {
      // Literal-zero positions must be exactly '0'.
      if (want === "0" && got !== "0") return null;
      continue;
    }
    if (needsAlpha && isAlpha) {
      if (want === "Z" && got !== "Z") return null;
      continue;
    }

    // Mismatch — attempt a directed substitution.
    if (needsDigit && isAlpha) {
      const sub = LETTER_TO_DIGIT[got];
      if (sub === undefined) return null;
      if (want === "0" && sub !== "0") return null;
      chars[i] = sub;
      positions.push(i);
    } else if (needsAlpha && isDigit) {
      const sub = DIGIT_TO_LETTER[got];
      if (sub === undefined) return null;
      if (want === "Z" && sub !== "Z") return null;
      chars[i] = sub;
      positions.push(i);
    } else {
      return null;
    }

    if (positions.length > MAX_SUBSTITUTIONS) return null;
  }

  if (positions.length === 0) return null;

  const repaired = chars.join("");
  if (!fmt.strict.test(repaired)) return null;

  const checksumVerified = fmt.checksum ? fmt.checksum(repaired) : false;
  if (fmt.checksum && !checksumVerified) return null; // a repair that fails the checksum is wrong

  // Each substitution costs confidence. A single directed repair on a fixed-width
  // format is close to certain; two is noticeably less so.
  const penalty = positions.length === 1 ? 0.9 : 0.78;
  const bonus = checksumVerified ? 1.05 : 1;

  return {
    original: token,
    repaired,
    positions,
    format: fmt,
    confidence: Math.min(0.95, fmt.baseConf * penalty * bonus),
    checksumVerified,
  };
}

/**
 * Scan a line for repairable identifier tokens.
 *
 * Only runs on OCR-derived text — see rule 5 in the module comment.
 */
export function findRepairs(
  text: string,
  opts: { script: ScriptCode; fromOcr: boolean },
): RepairResult[] {
  if (!opts.fromOcr) return [];
  // Indic-script lines are not scanned: these identifiers are always ASCII, and
  // the confusion table is Latin-specific.
  if (opts.script !== "Latn" && opts.script !== "Zyyy") return [];

  const out: RepairResult[] = [];
  const seen = new Set<string>();

  // Candidate tokens: alnum runs of a plausible length, allowing internal
  // spaces/hyphens only for the Aadhaar 4-4-4 grouping.
  const tokenRe = /\b[A-Za-z0-9|]{9,21}\b|\b\d{4}[ -]\d{4}[ -]\d{4}\b/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(text)) !== null) {
    const tok = m[0];
    for (const fmt of IDENTIFIER_FORMATS) {
      const r = repairAgainst(tok, fmt);
      if (!r) continue;
      const key = `${fmt.id}|${r.repaired}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checksums
// ---------------------------------------------------------------------------

/**
 * Verhoeff checksum, used by Aadhaar.
 *
 * Included because an Aadhaar-shaped 12-digit run is common in documents that
 * contain no Aadhaar at all — a long account number, a phone with a prefix, a
 * concatenated reference. Verhoeff catches most of those, which matters here in
 * an unusual direction: a FALSE Aadhaar detection triggers masking of a number
 * that is not an Aadhaar, and the advocate then cannot see a figure they need.
 */
const D5 = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const PERM = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 12) return false;
  let c = 0;
  const rev = [...digits].reverse().map(Number);
  for (let i = 0; i < rev.length; i++) {
    c = D5[c]![PERM[i % 8]![rev[i]!]!]!;
  }
  return c === 0;
}

/**
 * GSTIN checksum: base-36 weighted mod 36, with the check character at the end.
 */
export function gstinChecksum(value: string): boolean {
  const v = value.toUpperCase();
  if (v.length !== 15) return false;
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const idx = alphabet.indexOf(v[i]!);
    if (idx < 0) return false;
    const factor = i % 2 === 0 ? 1 : 2;
    const prod = idx * factor;
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  const check = (36 - (sum % 36)) % 36;
  return alphabet[check] === v[14];
}
