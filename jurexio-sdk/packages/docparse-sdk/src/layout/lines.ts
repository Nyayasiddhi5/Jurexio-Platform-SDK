/**
 * Word → line → block grouping, and page-zone assignment.
 *
 * Why not trust the OCR engine's own line numbers: because half our pages come
 * from a PDF text layer, where there are no line numbers at all, only positioned
 * glyph runs. One grouping implementation for both routes means the downstream
 * anchor engine and the review-UI highlighting behave identically whether a page
 * was read or recognised — which matters, because a user should not be able to
 * tell which route a page took by how the highlights land.
 */

import type { BBox, Block, Line, PageZone, ScriptCode, Word } from "../types.js";
import { bboxUnion, verticalOverlapRatio } from "../types.js";
import { detectScript, prepare } from "../grammar/script.js";

export interface GroupOptions {
  pageWidth: number;
  pageHeight: number;
  /** Fraction of median glyph height that counts as the same line. */
  lineTolerance?: number;
  /** Fraction of median glyph height that ends a paragraph. */
  paragraphGap?: number;
}

/**
 * Approximate advance width of a character, in em units.
 *
 * Deliberately a coarse table rather than real font metrics. Exact metrics would
 * mean loading and parsing the embedded font programme for every text item,
 * which is a large amount of work and a large dependency for a gain we do not
 * need: what matters here is that a space is about half a digit and a capital W
 * is about twice one. Those ratios are stable across Helvetica, Times, Arial and
 * the Nimbus/Liberation clones that Indian court software actually embeds.
 *
 * Indic characters are given a wide advance because Devanagari and Tamil glyphs
 * with matras are typically wider than Latin lowercase, and because underestimating
 * them would push every subsequent word on the line to the left.
 */
function charAdvance(ch: string): number {
  const c = ch.codePointAt(0) ?? 32;
  if (c === 32 || c === 9) return 0.28;                       // space, tab
  if (c >= 0x0900 && c <= 0x0dff) return 0.62;                // Indic block
  if (ch === "i" || ch === "l" || ch === "j" || ch === "I" || ch === "t" ||
      ch === "f" || ch === "r" || ch === "." || ch === "," || ch === ":" ||
      ch === ";" || ch === "'" || ch === "|" || ch === "!" || ch === "(" ||
      ch === ")" || ch === "[" || ch === "]" || ch === "/" || ch === "-") return 0.30;
  if (ch === "W" || ch === "M" || ch === "@") return 0.95;
  if (ch === "w" || ch === "m" || (c >= 0x41 && c <= 0x5a)) return 0.72;  // wide lower, caps
  return 0.55;                                                 // digits, most lowercase
}

function textAdvance(s: string): number {
  let total = 0;
  for (const ch of s) total += charAdvance(ch);
  return total > 0 ? total : 1;
}

function median(ns: number[]): number {
  if (ns.length === 0) return 0;
  const s = [...ns].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Group words into lines.
 *
 * The naive approach — bucket by rounded y — fails on two things that are
 * routine in Indian court documents: a slightly skewed scan, where a line's y
 * drifts several points from left margin to right, and superscript/subscript
 * fragments from OCR of matras and diacritics, which sit above the baseline.
 *
 * So we sort by y and grow lines greedily using VERTICAL OVERLAP against the
 * line's running box rather than a fixed y bucket. Overlap is scale-free, so it
 * handles a 12pt body and a 20pt cause title on the same page without tuning.
 */
export function groupLines(words: Word[], opts: GroupOptions): Line[] {
  if (words.length === 0) return [];
  const tolerance = opts.lineTolerance ?? 0.4;

  const sorted = [...words].sort((a, b) => (a.bbox.y - b.bbox.y) || (a.bbox.x - b.bbox.x));

  // Median word height sets the scale for "same line". Computed once over the
  // whole page so a single oversized word (a stamp, a heading glyph, an OCR
  // artefact spanning two rows) cannot redefine it.
  const medH = median(sorted.map((w) => w.bbox.h).filter((h) => h > 0)) || 12;

  /**
   * Match against a running CENTRE, not a growing union box.
   *
   * The first version grew each candidate line's box with bboxUnion and tested
   * new words against that box. That is unstable: the union only ever gets
   * taller, and once it is tall enough, a word two rows away still overlaps 40%
   * of the *shorter* box and gets absorbed — which makes the box taller again.
   * The result on a real OCR'd FIR was runaway merging: items 1 to 7 of the
   * numbered form, spanning a dozen visual rows and two columns, collapsed into
   * one "line" reading
   *
   *   "= wnhnrd Noor.. - - _. _ District: Acts FIR Occurrence Type Information
   *    Place No. & of of Sections: New 0123/2024 …"
   *
   * with the FIR number buried mid-soup and unparseable by any pattern. Nothing
   * downstream could recover from it, and no confidence signal reflected it —
   * the words themselves were read at 0.92.
   *
   * Tracking the mean centre and comparing against the MEDIAN page height keeps
   * the acceptance band fixed in size, so a line cannot bootstrap itself wider.
   */
  interface Group { words: Word[]; centreSum: number; count: number; right: number }
  const groups: Group[] = [];

  const band = tolerance * medH * 2; // half-height acceptance window

  for (const w of sorted) {
    const centre = w.bbox.y + w.bbox.h / 2;
    let placed = false;
    // Only the most recent few candidate lines can plausibly match; checking all
    // of them is O(n²) on a dense page.
    for (let i = groups.length - 1; i >= Math.max(0, groups.length - 6); i--) {
      const g = groups[i]!;
      const gCentre = g.centreSum / g.count;
      if (Math.abs(centre - gCentre) > band) continue;

      // Horizontal sanity: a word separated from the line's right edge by more
      // than ~8 em is a different column, not a continuation. Without this, a
      // two-column form header merges its label column into its value column.
      const gap = w.bbox.x - g.right;
      if (gap > medH * 8) continue;

      g.words.push(w);
      g.centreSum += centre;
      g.count += 1;
      g.right = Math.max(g.right, w.bbox.x + w.bbox.w);
      placed = true;
      break;
    }
    if (!placed) {
      groups.push({ words: [w], centreSum: centre, count: 1, right: w.bbox.x + w.bbox.w });
    }
  }

  const lines: Line[] = groups.map((g, i) => {
    const ws = g.words.sort((a, b) => a.bbox.x - b.bbox.x);
    const bbox = ws.reduce((acc, w) => bboxUnion(acc, w.bbox), { ...ws[0]!.bbox });
    const text = joinWords(ws);
    return {
      text,
      bbox,
      words: ws,
      script: dominantScript(ws),
      conf: ws.reduce((a, w) => a + w.conf, 0) / ws.length,
      index: i,
      zone: zoneOf(bbox, opts),
    };
  });

  // Re-sort into reading order and renumber, so `index` is meaningful as a
  // stable reference from a candidate back to a line.
  lines.sort((a, b) => (a.bbox.y - b.bbox.y) || (a.bbox.x - b.bbox.x));
  lines.forEach((l, i) => { l.index = i; });
  return lines;
}

/**
 * Join words into line text.
 *
 * Indic scripts do use spaces between words, so a plain space join is right —
 * but two cases need care. A word ending in a hyphen at the right margin is a
 * line-wrap artefact from typeset judgements. And Devanagari danda should not
 * get a leading space.
 */
function joinWords(ws: Word[]): string {
  let out = "";
  for (let i = 0; i < ws.length; i++) {
    const t = ws[i]!.text;
    if (i === 0) { out = t; continue; }
    if (/^[।॥,.;:)\]}%]/.test(t)) { out += t; continue; }
    if (/[([{₹]$/.test(out)) { out += t; continue; }
    out += " " + t;
  }
  return out;
}

function dominantScript(ws: Word[]): ScriptCode {
  const counts = new Map<ScriptCode, number>();
  for (const w of ws) {
    const s = w.script ?? detectScript(w.text);
    if (s === "Zyyy" || s === "Zzzz") continue;
    counts.set(s, (counts.get(s) ?? 0) + w.text.length);
  }
  if (counts.size === 0) return "Zyyy";
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

/**
 * Page zones.
 *
 * This matters more than it looks. A date in the left margin of an order sheet is
 * usually the *order date* written by the reader; a date in the footer is usually
 * the print timestamp; a date in the body is the substantive one. Treating them
 * alike puts a printer timestamp into a limitation calculation.
 */
export function zoneOf(bbox: BBox, opts: GroupOptions): PageZone {
  const { pageWidth: W, pageHeight: H } = opts;
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  if (cx < W * 0.08) return "MARGIN_LEFT";
  if (cx > W * 0.92) return "MARGIN_RIGHT";
  if (cy < H * 0.07) return "HEADER";
  if (cy > H * 0.93) return "FOOTER";
  return "BODY";
}

/**
 * Group lines into blocks.
 *
 * A block boundary is a vertical gap larger than the paragraph threshold, a
 * change of indentation, or a change of zone. Headings are detected by being
 * short, centred or fully upper-case, and followed by a gap — which is what a
 * cause title, "JUDGMENT", "PRAYER" and "VERIFICATION" all look like.
 */
export function groupBlocks(lines: Line[], opts: GroupOptions): Block[] {
  if (lines.length === 0) return [];
  const heights = lines.map((l) => l.bbox.h).filter((h) => h > 0);
  const medH = median(heights) || 12;
  const gapThreshold = (opts.paragraphGap ?? 0.85) * medH;

  const blocks: Block[] = [];
  let current: Line[] = [lines[0]!];

  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]!;
    const cur = lines[i]!;
    const gap = cur.bbox.y - (prev.bbox.y + prev.bbox.h);
    const indentShift = Math.abs(cur.bbox.x - prev.bbox.x);
    const zoneChange = cur.zone !== prev.zone;

    if (gap > gapThreshold || indentShift > medH * 2.5 || zoneChange) {
      blocks.push(makeBlock(current, blocks.length, opts));
      current = [cur];
    } else {
      current.push(cur);
    }
  }
  blocks.push(makeBlock(current, blocks.length, opts));
  return blocks;
}

const HEADING_WORDS = /^(JUDGMENT|JUDGEMENT|ORDER|PRAYER|VERIFICATION|SCHEDULE|AFFIDAVIT|SYNOPSIS|INDEX|MEMO(?:RANDUM)?\s+OF\s+PARTIES|LIST\s+OF\s+DATES|GROUNDS|WITNESSES|ANNEXURE\s*[-–]?\s*[A-Z0-9]*)$/;

function makeBlock(lines: Line[], index: number, opts: GroupOptions): Block {
  const bbox = lines.reduce((acc, l) => bboxUnion(acc, l.bbox), { ...lines[0]!.bbox });
  const text = lines.map((l) => l.text).join("\n");
  const first = lines[0]!;

  let kind: Block["kind"] = "PARAGRAPH";
  const t = first.text.trim();
  const centred = Math.abs((first.bbox.x + first.bbox.w / 2) - opts.pageWidth / 2) < opts.pageWidth * 0.06;

  if (lines.length <= 2 && (HEADING_WORDS.test(t.toUpperCase().replace(/[.:]$/, "")) ||
      (centred && t.length < 90 && t === t.toUpperCase() && /[A-Z]/.test(t)))) {
    kind = "HEADING";
  } else if (/^\s*(?:\(?\d{1,3}[.)]|\([a-z]\)|[ivxl]+[.)])\s/.test(t)) {
    kind = "LIST_ITEM";
  } else if (/^\s*(?:Sd\/-|Signature|Advocate for|Yours faithfully|\(.*\))\s*$/i.test(t)) {
    kind = "SIGNATURE";
  }

  return { kind, text, bbox, lines, index };
}

/**
 * Build lines from a PDF text layer.
 *
 * Text-layer words come with exact boxes, so confidence is 1 and script is per
 * word. The one thing that must be handled here is that pdf.js reports items in
 * content-stream order, which is NOT reading order in a two-column judgement or
 * a table — the grouping above sorts by geometry, which fixes it.
 */
export function linesFromTextLayer(
  items: Array<{ text: string; bbox: BBox }>,
  opts: GroupOptions,
): Line[] {
  const words: Word[] = [];
  for (const it of items) {
    const { text } = prepare(it.text);
    if (text.trim().length === 0) continue;
    // A text-layer "item" is often a run of several words. Split it and
    // apportion the box by character count.
    //
    // WHITESPACE MUST BE INCLUDED IN THE APPORTIONMENT. The first version
    // filtered the whitespace runs out before dividing the width, which packed
    // the words edge-to-edge across the item's full box: every inter-word gap
    // came out as 0.0 and every word came out wider than it is.
    //
    // That silently destroyed the only signal a whitespace-aligned table has.
    // A bank-statement row reading
    //     "03/10/2022  03/10/2022  NEFT INWARD SHREE STEEL   4,20,000  28,38,442"
    // produced words with zero gaps between the date columns, so column
    // detection found one cell where there were six, and table extraction
    // returned nothing at all on every statement, cause list and invoice.
    //
    // It also mattered for the anchor engine's COLUMN layout, which locates a
    // value by its x position relative to the label, and for the accuracy of
    // every highlight box shown to the advocate.
    const parts = text.split(/(\s+)/).filter((p) => p.length > 0);
    if (parts.length <= 1) {
      words.push({ text, bbox: it.bbox, conf: 1, script: detectScript(text), source: "TEXT_LAYER" });
      continue;
    }
    // Apportion by estimated ADVANCE WIDTH, not by character count.
    //
    // Counting characters uniformly treats a space as being as wide as a digit.
    // In every proportional face a space is roughly half a digit, so uniform
    // counting inflates single spaces and shrinks the multi-space runs that
    // separate columns — measured on a bank statement, an ordinary inter-word
    // gap came out at 6.1pt while the two-space gap BETWEEN two date columns
    // came out at 5.0pt. The column separation was narrower than the word
    // spacing, so no threshold could tell them apart.
    const totalAdvance = parts.reduce((a, p) => a + textAdvance(p), 0);
    let x = it.bbox.x;
    for (const p of parts) {
      const w = (textAdvance(p) / totalAdvance) * it.bbox.w;
      // Whitespace consumes width but emits no word — which is exactly what
      // turns a run of six spaces into a six-space-wide gap.
      if (p.trim().length > 0) {
        words.push({
          text: p,
          bbox: { x, y: it.bbox.y, w, h: it.bbox.h },
          conf: 1,
          script: detectScript(p),
          source: "TEXT_LAYER",
        });
      }
      x += w;
    }
  }
  return groupLines(words, opts);
}
