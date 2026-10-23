/**
 * Script detection and script-aware normalisation.
 *
 * Why this exists as its own layer: an Indian court document is very often
 * bi-script on the same page — a Devanagari body with an English cause title, a
 * Tamil order with English section references, a Gujarati sale deed with English
 * survey numbers. Choosing one OCR language for the whole page loses text either
 * way. So script is detected per *line*, and OCR is routed per line group.
 *
 * The other job here is digit normalisation. Devanagari, Bengali, Tamil, Telugu,
 * Kannada, Malayalam, Gujarati, Gurmukhi, Odia and Arabic-Indic digits all appear
 * in real filings. A date written "१५/०८/२०२४" must parse identically to
 * "15/08/2024", and a section "३०२" must match IPC 302. Every downstream grammar
 * rule assumes ASCII digits, so this runs first and never runs twice.
 */

import type { ScriptCode, LangCode } from "../types.js";

// ---------------------------------------------------------------------------
// Unicode block ranges
// ---------------------------------------------------------------------------

interface Range { lo: number; hi: number; script: ScriptCode }

/** Ordered by frequency in Indian legal corpora, so the common case exits early. */
const RANGES: Range[] = [
  { lo: 0x0041, hi: 0x005a, script: "Latn" },
  { lo: 0x0061, hi: 0x007a, script: "Latn" },
  { lo: 0x00c0, hi: 0x024f, script: "Latn" },
  { lo: 0x0900, hi: 0x097f, script: "Deva" },
  { lo: 0xa8e0, hi: 0xa8ff, script: "Deva" }, // Devanagari Extended
  { lo: 0x0980, hi: 0x09ff, script: "Beng" },
  { lo: 0x0a00, hi: 0x0a7f, script: "Guru" },
  { lo: 0x0a80, hi: 0x0aff, script: "Gujr" },
  { lo: 0x0b00, hi: 0x0b7f, script: "Orya" },
  { lo: 0x0b80, hi: 0x0bff, script: "Taml" },
  { lo: 0x0c00, hi: 0x0c7f, script: "Telu" },
  { lo: 0x0c80, hi: 0x0cff, script: "Knda" },
  { lo: 0x0d00, hi: 0x0d7f, script: "Mlym" },
  { lo: 0x0600, hi: 0x06ff, script: "Arab" },
  { lo: 0x0750, hi: 0x077f, script: "Arab" },
  { lo: 0xfb50, hi: 0xfdff, script: "Arab" },
  { lo: 0xfe70, hi: 0xfeff, script: "Arab" },
];

export function scriptOfCodePoint(cp: number): ScriptCode {
  // ASCII digits and punctuation are script-neutral. Treating them as Latin is
  // the classic bug: a Devanagari line containing "302/2024" would be scored as
  // half-Latin and routed to the English model.
  if ((cp >= 0x30 && cp <= 0x39) || cp === 0x20 || (cp >= 0x21 && cp <= 0x2f) ||
      (cp >= 0x3a && cp <= 0x40) || (cp >= 0x5b && cp <= 0x60) || (cp >= 0x7b && cp <= 0x7e)) {
    return "Zyyy";
  }
  for (const r of RANGES) {
    if (cp >= r.lo && cp <= r.hi) return r.script;
  }
  return "Zzzz";
}

export interface ScriptProfile {
  dominant: ScriptCode;
  /** Character mass per script, excluding script-neutral characters. */
  counts: Partial<Record<ScriptCode, number>>;
  /** Total non-neutral characters counted. */
  total: number;
  /** True when two or more scripts each hold at least 15% of the mass. */
  mixed: boolean;
  /** Scripts above the 15% threshold, most massive first. */
  significant: ScriptCode[];
}

const MIXED_THRESHOLD = 0.15;

export function profileScript(text: string): ScriptProfile {
  const counts: Partial<Record<ScriptCode, number>> = {};
  let total = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    const s = scriptOfCodePoint(cp);
    if (s === "Zyyy") continue;
    // Indic digits count toward their script — a line of pure Devanagari
    // numerals is Devanagari, not unknown.
    counts[s] = (counts[s] ?? 0) + 1;
    total++;
  }
  if (total === 0) {
    return { dominant: "Zyyy", counts, total: 0, mixed: false, significant: [] };
  }
  const sorted = (Object.entries(counts) as Array<[ScriptCode, number]>)
    .sort((a, b) => b[1] - a[1]);
  const significant = sorted.filter(([, n]) => n / total >= MIXED_THRESHOLD).map(([s]) => s);
  const first = sorted[0];
  return {
    dominant: first ? first[0] : "Zzzz",
    counts,
    total,
    mixed: significant.length >= 2,
    significant,
  };
}

/** Convenience: the script we should route a single line's OCR on. */
export function detectScript(text: string): ScriptCode {
  return profileScript(text).dominant;
}

// ---------------------------------------------------------------------------
// Digit normalisation
// ---------------------------------------------------------------------------

/**
 * Zero code point for each numeral system we accept. Digits are contiguous in
 * every one of these blocks, so `cp - zero` gives the value directly.
 */
const DIGIT_ZEROS: Array<{ zero: number; script: ScriptCode }> = [
  { zero: 0x0966, script: "Deva" }, // ०
  { zero: 0x09e6, script: "Beng" }, // ০
  { zero: 0x0a66, script: "Guru" }, // ੦
  { zero: 0x0ae6, script: "Gujr" }, // ૦
  { zero: 0x0b66, script: "Orya" }, // ୦
  { zero: 0x0be6, script: "Taml" }, // ௦
  { zero: 0x0c66, script: "Telu" }, // ౦
  { zero: 0x0ce6, script: "Knda" }, // ೦
  { zero: 0x0d66, script: "Mlym" }, // ൦
  { zero: 0x0660, script: "Arab" }, // ٠ Arabic-Indic
  { zero: 0x06f0, script: "Arab" }, // ۰ Extended Arabic-Indic (Urdu)
];

export interface DigitNormalisation {
  text: string;
  /** True when at least one non-ASCII digit was converted. */
  changed: boolean;
  /** Scripts whose digits were seen — a useful language hint on its own. */
  digitScripts: ScriptCode[];
}

export function normaliseDigits(input: string): DigitNormalisation {
  let changed = false;
  const seen = new Set<ScriptCode>();
  let out = "";
  for (const ch of input) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) { out += ch; continue; }
    let mapped: string | null = null;
    for (const d of DIGIT_ZEROS) {
      if (cp >= d.zero && cp <= d.zero + 9) {
        mapped = String(cp - d.zero);
        seen.add(d.script);
        break;
      }
    }
    if (mapped !== null) { out += mapped; changed = true; } else { out += ch; }
  }
  return { text: out, changed, digitScripts: [...seen] };
}

// ---------------------------------------------------------------------------
// Text hygiene shared by every downstream grammar rule
// ---------------------------------------------------------------------------

/**
 * OCR of Indian court documents produces a predictable set of artefacts. These
 * are the ones that actually break field extraction, each fixed deliberately:
 *
 *  - ZWJ/ZWNJ inside Devanagari conjuncts survive OCR and break string equality
 *  - Non-breaking and thin spaces appear in tables and around ₹
 *  - Soft hyphens appear at line-wrap points in typeset judgements
 *  - Devanagari danda (।) is a sentence terminator and must survive, not be
 *    stripped as punctuation — sentence splitting depends on it
 *  - Fullwidth and curly quotes appear in DOCX-origin drafts
 */
export function hygiene(input: string): string {
  let s = input.normalize("NFC");
  s = s.replace(/[​‌‍﻿]/g, "");   // zero-width family
  s = s.replace(/­/g, "");                        // soft hyphen
  s = s.replace(/[  -   　]/g, " "); // exotic spaces
  s = s.replace(/[‘’‛]/g, "'");
  s = s.replace(/[“”‟]/g, '"');
  s = s.replace(/[‐‑‒–—―]/g, "-");  // dash family
  s = s.replace(/⁄/g, "/");                       // fraction slash
  s = s.replace(/[ \t]{2,}/g, " ");
  return s.trim();
}

/**
 * Full pre-grammar pass. Order matters: hygiene first (so digits are not hidden
 * behind zero-width joiners), digits second.
 */
export function prepare(input: string): { text: string; digitScripts: ScriptCode[] } {
  const h = hygiene(input);
  const d = normaliseDigits(h);
  return { text: d.text, digitScripts: d.digitScripts };
}

// ---------------------------------------------------------------------------
// Script → language and OCR model hints
// ---------------------------------------------------------------------------

/**
 * Tesseract traineddata names per script. Multiple languages share a script, so
 * we pass the plausible set plus `eng` — Indian legal documents are bi-script far
 * more often than not, and Tesseract handles a small language union well.
 *
 * Verified present in the container image: asm ben eng guj hin kan mal mar nep
 * ori osd pan san tam tel urd, plus script models Devanagari Bengali Tamil Telugu.
 */
export const TESS_LANGS: Record<ScriptCode, string> = {
  Latn: "eng",
  Deva: "hin+mar+san+nep+eng",
  Beng: "ben+asm+eng",
  Taml: "tam+eng",
  Telu: "tel+eng",
  Knda: "kan+eng",
  Mlym: "mal+eng",
  Gujr: "guj+eng",
  Guru: "pan+eng",
  Orya: "ori+eng",
  Arab: "urd+eng",
  Zyyy: "eng",
  Zzzz: "eng",
};

/** Languages plausibly present given a script. Used for reporting, not routing. */
export const SCRIPT_LANGS: Record<ScriptCode, LangCode[]> = {
  Latn: ["en"],
  Deva: ["hi", "mr", "sa", "ne"],
  Beng: ["bn", "as"],
  Taml: ["ta"],
  Telu: ["te"],
  Knda: ["kn"],
  Mlym: ["ml"],
  Gujr: ["gu"],
  Guru: ["pa"],
  Orya: ["or"],
  Arab: ["ur"],
  Zyyy: ["und"],
  Zzzz: ["und"],
};

/**
 * PP-OCRv5 per-script model ids, for the scripts Paddle actually covers.
 *
 * Deliberately narrow. PP-OCRv6 (the current generation) has NO Indic coverage —
 * its 50-language set is CJK plus Latin-script languages. Indic is reachable only
 * through the three PP-OCRv5 script models below. Bengali has no Paddle model in
 * any generation, so it is absent here and routes to Tesseract by design.
 */
export const PADDLE_V5_MODELS: Partial<Record<ScriptCode, string>> = {
  Deva: "v5-devanagari-mobile",
  Taml: "v5-tamil-mobile",
  Telu: "v5-telugu-mobile",
};
