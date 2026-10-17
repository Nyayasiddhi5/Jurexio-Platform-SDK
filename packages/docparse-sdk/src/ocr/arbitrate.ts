/**
 * Multi-pass numeric arbitration.
 *
 * This module exists because of a measured failure, not a theoretical one.
 *
 * MEASUREMENT (Tesseract 5.3.4, 300 DPI, degraded Devanagari district-court
 * order, ground truth "दिनांक 15/08/2024" and "10/03/2024", case no "456/2024"):
 *
 *   -l hin                      → "5/08/2024",  "0/03/2024",  "456/2024"
 *   -l hin+mar+san+nep+eng      → "5/08/2024",  "0/03/2024",  "456/2024"
 *   -l eng                      → "15/08/2024", "10/03/2024", "456 202"
 *   -l Devanagari (script model)→ "15/08/2024", "10/03/2024", "456/2024"
 *
 * Read that carefully. The Devanagari LANGUAGE models silently drop the leading
 * digit of a date. Not garble it — drop it. "15/08/2024" becomes "5/08/2024",
 * which is a perfectly well-formed date ten days earlier. Nothing downstream can
 * tell it is wrong. A limitation clock computed from it is wrong by ten days, and
 * the field looks clean in the review UI, so the advocate has no reason to check.
 *
 * That is the worst class of defect this system can produce: a plausible wrong
 * value with no signal attached. Confidence does not help — Tesseract reports
 * high confidence on the truncated token.
 *
 * The countermeasure is redundancy. Run more than one recognition pass over the
 * same pixels with different models, then reconcile the NUMERIC tokens
 * positionally. Where passes agree, confidence rises above what any single pass
 * could justify. Where they disagree, we do not silently pick a winner and move
 * on — we pick the more probable reading, LOWER the confidence, and mark the
 * field for human review.
 *
 * The arbitration rule for disagreement is "prefer the longer digit run". That
 * is not a general truth about OCR; it is an asymmetry specific to this failure:
 * truncation at a token boundary is common, and fabricating an extra leading
 * digit is rare. It is stated here explicitly so that it can be revisited when
 * we have benchmark data from real court scans rather than one synthetic page.
 */

import type { BBox, Word } from "../types.js";
import { verticalOverlapRatio } from "../types.js";

export interface Pass {
  /** Engine/model identifier, e.g. "tesseract-native:Devanagari". */
  id: string;
  words: Word[];
  meanConf: number;
}

export interface ArbitrationNote {
  kind: "AGREE" | "DISAGREE" | "SINGLE_PASS_ONLY";
  bbox: BBox;
  chosen: string;
  /** What each pass read, keyed by pass id. */
  readings: Record<string, string>;
  /** Confidence after arbitration. */
  confidence: number;
  /** True when the field must be shown to a human before it can be relied on. */
  reviewRequired: boolean;
}

export interface ArbitrationResult {
  /** The merged word list to use downstream. */
  words: Word[];
  notes: ArbitrationNote[];
  /** Count of numeric tokens where passes disagreed. A useful page-level alarm. */
  numericConflicts: number;
}

/** A token worth arbitrating: contains at least two digits. */
const NUMERIC_ISH = /\d.*\d/;

/** Digits only, for comparing two readings of the same token. */
function digitsOf(s: string): string {
  return s.replace(/\D/g, "");
}

/** Horizontal + vertical overlap test for "these are the same token". */
function sameToken(a: BBox, b: BBox): boolean {
  if (verticalOverlapRatio(a, b) < 0.5) return false;
  const ax2 = a.x + a.w;
  const bx2 = b.x + b.w;
  const overlap = Math.min(ax2, bx2) - Math.max(a.x, b.x);
  if (overlap <= 0) return false;
  return overlap / Math.min(a.w, b.w) >= 0.5;
}

/**
 * Reconcile numeric tokens across passes.
 *
 * The primary pass supplies the text and layout for everything; the secondary
 * passes are consulted only for numeric tokens. This is deliberate — Indic prose
 * from a Latin model is garbage and must never leak into the merged output, but
 * ASCII digits from a Latin model are often BETTER than from the language model,
 * as the measurement above shows.
 */
export function arbitrate(primary: Pass, secondaries: Pass[]): ArbitrationResult {
  const notes: ArbitrationNote[] = [];
  let numericConflicts = 0;

  const merged: Word[] = primary.words.map((w) => ({ ...w }));

  for (let i = 0; i < merged.length; i++) {
    const w = merged[i]!;
    if (!NUMERIC_ISH.test(w.text)) continue;

    const readings: Record<string, string> = { [primary.id]: w.text };
    const candidates: Array<{ passId: string; text: string; conf: number }> = [
      { passId: primary.id, text: w.text, conf: w.conf },
    ];

    for (const sec of secondaries) {
      // Find the secondary-pass word occupying the same place on the page.
      // Several short tokens can overlap one long one (the "456 202" case), so
      // we join every overlapping numeric token in reading order.
      const hits = sec.words
        .filter((sw) => sameToken(w.bbox, sw.bbox) && /\d/.test(sw.text))
        .sort((a, b) => a.bbox.x - b.bbox.x);
      if (hits.length === 0) continue;
      const text = hits.map((h) => h.text).join(hits.length > 1 ? "" : "");
      const conf = hits.reduce((a, h) => a + h.conf, 0) / hits.length;
      readings[sec.id] = text;
      candidates.push({ passId: sec.id, text, conf });
    }

    if (candidates.length === 1) {
      notes.push({
        kind: "SINGLE_PASS_ONLY",
        bbox: w.bbox,
        chosen: w.text,
        readings,
        // A numeric token seen by only one pass gets no redundancy bonus and a
        // small penalty, because this is exactly where truncation hides.
        confidence: Math.min(w.conf, 0.85) * 0.95,
        reviewRequired: false,
      });
      w.conf = Math.min(w.conf, 0.85) * 0.95;
      continue;
    }

    const digitSets = new Set(candidates.map((c) => digitsOf(c.text)));

    if (digitSets.size === 1) {
      // Independent passes agree on every digit. This is the strongest signal
      // available without a human, so confidence goes above any single pass.
      const conf = Math.min(0.99, Math.max(...candidates.map((c) => c.conf)) * 1.06 + 0.03);
      notes.push({ kind: "AGREE", bbox: w.bbox, chosen: w.text, readings, confidence: conf, reviewRequired: false });
      w.conf = conf;
      continue;
    }

    // Disagreement. Prefer the longer digit run — see the module comment for why
    // this asymmetry, and why it is provisional.
    numericConflicts++;
    const best = candidates.slice().sort((a, b) => {
      const dl = digitsOf(b.text).length - digitsOf(a.text).length;
      if (dl !== 0) return dl;
      return b.conf - a.conf;
    })[0]!;

    // Confidence is capped well below the autofill threshold so a conflicted
    // number is SHOWN to the advocate rather than pre-filled.
    const conf = 0.5;
    notes.push({
      kind: "DISAGREE",
      bbox: w.bbox,
      chosen: best.text,
      readings,
      confidence: conf,
      reviewRequired: true,
    });
    w.text = best.text;
    w.conf = conf;
    w.engine = `${w.engine ?? primary.id}+arbitrated`;
  }

  return { words: merged, notes, numericConflicts };
}

/**
 * Which extra passes are worth running for a given script.
 *
 * Empty for Latin: a second Latin pass adds latency and no information. For
 * Indic scripts the extra passes are cheap relative to the cost of a wrong date,
 * and the measurement shows they catch a real defect class.
 */
export function arbitrationPasses(script: string): string[] {
  switch (script) {
    case "Deva": return ["Devanagari", "eng"];
    case "Beng": return ["Bengali", "eng"];
    case "Taml": return ["Tamil", "eng"];
    case "Telu": return ["Telugu", "eng"];
    // No script-level traineddata ships for these, so the Latin pass alone is
    // the redundancy. Still worth it — the numbers are what matter.
    case "Knda":
    case "Mlym":
    case "Gujr":
    case "Guru":
    case "Orya":
    case "Arab":
      return ["eng"];
    default: return [];
  }
}
