/**
 * Document analysis — extractive only.
 *
 * Everything here selects sentences that are already in the document. Nothing is
 * generated, paraphrased or inferred into new prose. That is a hard constraint,
 * not a limitation of ambition, and the reason is specific to this domain:
 *
 * A generated summary of a legal document is a new legal statement. If it is
 * wrong it is the platform's wrong statement, attributable to the advocate who
 * relied on it, in a document that may reach a court. An extractive summary can
 * only ever be a wrong SELECTION of the document's own words — recoverable by
 * reading the highlighted source, which is one click away because every selected
 * sentence carries its page and line indices.
 *
 * So: sentence scoring, not sentence writing.
 */

import type {
  DocumentAnalysis, Page, ParsedDate, StatuteSection,
} from "../types.js";
import * as P from "../grammar/patterns.js";
import { prepare } from "../grammar/script.js";
import { parseDate } from "../grammar/dates.js";
import { findMoney } from "../grammar/money.js";
import { findSections } from "../grammar/sections.js";
import { toTableRecord } from "../layout/table-records.js";

// ---------------------------------------------------------------------------
// Sentence segmentation
// ---------------------------------------------------------------------------

export interface Sentence {
  text: string;
  pageNo: number;
  lineIndices: number[];
  /** Character offset within the page text, for stable ordering. */
  offset: number;
}

/**
 * Split into sentences.
 *
 * Two Indian-specific rules:
 *  - The Devanagari danda (।) and double danda (॥) are sentence terminators, and
 *    a splitter that only knows "." silently produces one enormous sentence for
 *    an entire Hindi order.
 *  - Legal abbreviations are full of full stops that are NOT sentence ends:
 *    "u/s", "Cr.P.C.", "M/s.", "No.", "Rs.", "Hon'ble", "S/o", "v.", "Ltd.",
 *    "Ors.", "Anr.", initials like "A. K. Sharma". Splitting on those shatters
 *    every cause title and citation.
 */
const ABBREV = new Set([
  "no", "nos", "rs", "vs", "v", "ors", "anr", "ltd", "pvt", "co", "mr", "mrs",
  "ms", "dr", "prof", "smt", "sri", "shri", "hon", "hon'ble", "j", "cj",
  "sec", "s", "art", "cl", "para", "u", "w", "d", "c", "h", "e", "g", "i",
  "ipc", "crpc", "cpc", "iea", "bns", "bnss", "bsa", "air", "scc", "scr",
  "p", "ps", "sho", "io", "fir", "cd", "ex", "annex", "sd", "govt", "distt",
  "add", "addl", "asst", "dy", "jt", "retd", "vol", "ed", "pp", "cf", "viz",
]);

export function splitSentences(page: Page): Sentence[] {
  const out: Sentence[] = [];
  // Build page text with a map back to line indices.
  const segments: Array<{ text: string; lineIndex: number; start: number }> = [];
  let cursor = 0;
  for (const line of page.lines) {
    const { text } = prepare(line.text);
    segments.push({ text, lineIndex: line.index, start: cursor });
    cursor += text.length + 1;
  }
  const pageText = segments.map((s) => s.text).join(" ");

  const lineAt = (offset: number): number => {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (offset >= segments[i]!.start) return segments[i]!.lineIndex;
    }
    return 0;
  };

  let start = 0;
  for (let i = 0; i < pageText.length; i++) {
    const ch = pageText[i]!;
    const isDanda = ch === "।" || ch === "॥";
    const isTerminal = ch === "." || ch === "?" || ch === "!" || isDanda;
    if (!isTerminal) continue;

    if (!isDanda) {
      // Abbreviation check: the token immediately before the full stop.
      const before = pageText.slice(Math.max(0, i - 12), i);
      const tok = /([A-Za-z']+)$/.exec(before)?.[1] ?? "";
      if (tok.length > 0 && ABBREV.has(tok.toLowerCase())) continue;
      // A single capital letter before a stop is an initial ("A. K. Sharma").
      if (tok.length === 1 && /[A-Z]/.test(tok)) continue;
      // A digit before a stop is sometimes a numbered clause or a decimal, but
      // NOT always — and suppressing every one of them was over-broad. A deed
      // clause ending "...IFSC: CNRB0000512." and the next clause "3. The Vendor
      // shall deliver..." were welded into a single sentence, so the Vendor's
      // obligation was attributed to the Purchaser named earlier in it. Wrong
      // obligor on a conveyance obligation is a substantive error.
      //
      // Suppress only the two cases that really are not sentence ends:
      //   a decimal or version number  — "4.2", "1.17.1"
      //   a list marker at line start  — "3. The Vendor..."
      if (/\d$/.test(before)) {
        const nextCh = pageText[i + 1] ?? "";
        if (/\d/.test(nextCh)) continue;                       // decimal
        const seg = segments.find((sg) => i >= sg.start && i <= sg.start + sg.text.length);
        const posInSeg = seg ? i - seg.start : 99;
        if (posInSeg <= 3) continue;                            // list marker
        // Otherwise it is a real sentence end that happens to follow a number.
      }
      // Must be followed by whitespace then an opening character.
      const after = pageText.slice(i + 1, i + 4);
      if (!/^\s+["'(₹]?[A-Z0-9ऀ-෿]/.test(after) && i < pageText.length - 2) continue;
    }

    const text = pageText.slice(start, i + 1).trim();
    if (text.length >= 12) {
      const from = lineAt(start);
      const to = lineAt(i);
      const idxs: number[] = [];
      for (let k = from; k <= to; k++) idxs.push(k);
      out.push({ text, pageNo: page.pageNo, lineIndices: idxs, offset: start });
    }
    start = i + 1;
  }
  const tail = pageText.slice(start).trim();
  if (tail.length >= 12) {
    const from = lineAt(start);
    out.push({ text: tail, pageNo: page.pageNo, lineIndices: [from], offset: start });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extractive summary
// ---------------------------------------------------------------------------

/**
 * Sentence scoring for a legal document.
 *
 * Not TF-IDF. Frequency-based scoring picks the sentences that repeat the
 * document's vocabulary most, which in a pleading means the boilerplate. What
 * actually carries a legal document's meaning is a known, enumerable set of
 * signals — the operative verbs, the identifiers, the money, the dates, the
 * dispositive phrases — so we score those directly.
 */
const SIGNAL_WEIGHTS: Array<{ re: RegExp; w: number; why: string }> = [
  { re: /\b(?:appeal|petition|application|suit|complaint|revision)\s+is\s+(?:allowed|dismissed|partly\s+allowed|disposed)/i, w: 14, why: "disposition" },
  { re: /\bit\s+is\s+(?:therefore\s+)?(?:most\s+)?(?:humbly\s+)?prayed\b/i, w: 12, why: "prayer" },
  { re: /\bhereby\s+(?:directed|ordered|restrained|granted|convicted|acquitted|sentenced)\b/i, w: 12, why: "operative direction" },
  { re: /\b(?:we|I)\s+(?:are\s+of\s+the\s+view|hold|find)\b/i, w: 11, why: "holding" },
  { re: /\bheld\s+that\b/i, w: 10, why: "holding" },
  { re: /\bcause\s+of\s+action\b/i, w: 9, why: "cause of action" },
  { re: /\b(?:convicted|acquitted|sentenced)\s+(?:to|under|of)\b/i, w: 10, why: "outcome" },
  { re: /\bset\s+aside\b/i, w: 10, why: "outcome" },
  { re: /\b(?:shall|must)\s+(?:pay|deposit|surrender|deliver|hand\s+over|comply)/i, w: 9, why: "obligation" },
  { re: /(?:₹|Rs\.?|INR)\s*[\d,]{3,}/i, w: 7, why: "money" },
  { re: /\bu\/s\b|\bunder\s+[Ss]ections?\b/i, w: 6, why: "sections" },
  { re: /\bF\.?I\.?R\.?\s*No\b/i, w: 7, why: "FIR reference" },
  { re: /\bcheque\s+(?:bearing\s+)?no\b/i, w: 8, why: "instrument" },
  { re: /\b(?:dishonour|returned\s+unpaid)\b/i, w: 8, why: "dishonour" },
  { re: /\bwithin\s+(?:\d{1,3}|thirty|sixty|ninety|fifteen)\s+(?:days|months)\b/i, w: 8, why: "time limit" },
  { re: /\b(?:whereas|now\s+therefore)\b/i, w: 4, why: "recital" },
  { re: /\bdated\s+\d/i, w: 5, why: "dated event" },
  { re: /\b(?:agreed|undertakes|covenants)\s+to\b/i, w: 7, why: "covenant" },
  { re: /\bexclusive\s+jurisdiction\b/i, w: 7, why: "jurisdiction" },
  { re: /\bshall\s+be\s+referred\s+to\s+arbitration\b/i, w: 8, why: "arbitration" },
];

export function summarise(
  pages: Page[],
  opts: { maxSentences?: number } = {},
): DocumentAnalysis["summarySentences"] {
  const max = opts.maxSentences ?? 8;
  const scored: Array<{ s: Sentence; score: number; reasons: string[] }> = [];

  for (const page of pages) {
    const sentences = splitSentences(page);
    for (const s of sentences) {
      let score = 0;
      const reasons: string[] = [];
      for (const sig of SIGNAL_WEIGHTS) {
        if (sig.re.test(s.text)) { score += sig.w; reasons.push(sig.why); }
      }
      // Position bonus: the first page's opening and the last page's closing
      // carry the identity and the outcome respectively.
      if (page.pageNo === pages[0]!.pageNo && s.offset < 400) score += 3;
      if (page.pageNo === pages[pages.length - 1]!.pageNo) score += 2;
      // Length shaping: very short sentences are headings, very long ones are
      // recital chains. Neither summarises well.
      const len = s.text.length;
      if (len < 40) score *= 0.5;
      else if (len > 400) score *= 0.7;

      if (score > 0) scored.push({ s, score, reasons });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // Deduplicate near-identical picks — pleadings repeat their prayer verbatim.
  const picked: typeof scored = [];
  for (const cand of scored) {
    if (picked.length >= max) break;
    const dup = picked.some((p) => jaccard(tokens(p.s.text), tokens(cand.s.text)) > 0.6);
    if (!dup) picked.push(cand);
  }

  // Return in document order — a summary that jumps around is harder to read
  // than one that follows the document.
  picked.sort((a, b) => (a.s.pageNo - b.s.pageNo) || (a.s.offset - b.s.offset));

  return picked.map((p) => ({
    text: p.s.text,
    pageNo: p.s.pageNo,
    score: Math.round(p.score * 100) / 100,
    lineIndices: p.s.lineIndices,
  }));
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9ऀ-෿\s]/g, " ").split(/\s+/).filter((t) => t.length > 3));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/**
 * Build a chronology.
 *
 * Every dated sentence becomes an event, described by its own words rather than a
 * generated label. Sorted by date, with undated-but-relevant events omitted
 * entirely — a timeline with guessed dates is worse than a short timeline.
 */
export function buildTimeline(
  pages: Page[],
  opts: { referenceYear?: number } = {},
): DocumentAnalysis["timeline"] {
  const out: DocumentAnalysis["timeline"] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    for (const s of splitSentences(page)) {
      const dateRe = /\b(?:\d{1,2}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*(?:\d{4}|\d{2})|\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:day\s+of\s+)?[A-Za-zऀ-෿]{3,20}\.?,?\s*(?:19|20)\d{2}|(?:19|20)\d{2}-\d{2}-\d{2})\b/g;
      let m: RegExpExecArray | null;
      while ((m = dateRe.exec(s.text)) !== null) {
        const d: ParsedDate | null = parseDate(m[0], opts.referenceYear !== undefined ? { referenceYear: opts.referenceYear } : {});
        if (!d || d.iso === null) continue;
        const key = `${d.iso}|${s.text.slice(0, 40)}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Confidence reflects the date, not the event text.
        const conf = d.ambiguousOrder ? 0.7 : 0.9;
        out.push({ date: d, event: s.text.length > 220 ? s.text.slice(0, 217) + "…" : s.text, pageNo: page.pageNo, conf });
      }
    }
  }
  return out.sort((a, b) => (a.date.iso ?? "").localeCompare(b.date.iso ?? ""));
}

// ---------------------------------------------------------------------------
// Obligations and reliefs
// ---------------------------------------------------------------------------

/**
 * Extract obligations from a contract or directions from an order.
 *
 * An obligation needs a MODAL and an ACTOR. "The Seller shall deliver" is an
 * obligation; "delivery is important" is a recital. Requiring both is what keeps
 * the obligation list from becoming a copy of the document.
 */
export function extractObligations(pages: Page[]): DocumentAnalysis["obligations"] {
  const out: DocumentAnalysis["obligations"] = [];

  const ACTOR = /\b((?:the\s+)?(?:Vendor|Purchaser|Seller|Buyer|Lessor|Lessee|Landlord|Tenant|Licensor|Licensee|Employer|Employee|Contractor|Company|Borrower|Lender|Guarantor|Party|Parties|Applicant|Respondent|Petitioner|Appellant|Plaintiff|Defendant|Accused|Claimant|Client|Consultant|Supplier|Customer|Bank|Insurer)(?:\s+of\s+the\s+(?:First|Second|Third)\s+Part)?)\b/i;

  for (const page of pages) {
    for (const s of splitSentences(page)) {
      const modal = P.freshRegex(P.OBLIGATION_MODAL).exec(s.text);
      if (!modal) continue;
      const actor = ACTOR.exec(s.text);
      // In an order, the court directs without naming an actor before the modal.
      const isDirection = /\b(?:hereby\s+)?(?:directed|ordered|restrained|permitted)\b/i.test(s.text);
      if (!actor && !isDirection) continue;

      const kind =
        /\bshall\s+not\b|\bmay\s+not\b/i.test(s.text) ? "NEGATIVE_COVENANT" :
        /\b(?:pay|deposit|remit|refund)\b/i.test(s.text) ? "PAYMENT" :
        /\b(?:deliver|hand\s+over|possession)\b/i.test(s.text) ? "DELIVERY" :
        /\b(?:surrender|appear|attend)\b/i.test(s.text) ? "APPEARANCE" :
        /\b(?:indemnif|hold\s+harmless)\b/i.test(s.text) ? "INDEMNITY" :
        /\b(?:confidential|non-?disclos)\b/i.test(s.text) ? "CONFIDENTIALITY" :
        /\b(?:terminate|termination)\b/i.test(s.text) ? "TERMINATION" :
        isDirection ? "COURT_DIRECTION" : "GENERAL";

      // A due date inside the obligation sentence, if any.
      let dueDate: ParsedDate | undefined;
      const within = P.freshRegex(P.NOTICE_PERIOD).exec(s.text);
      const explicit = /\b(?:on\s+or\s+before|by|not\s+later\s+than)\s+((?:\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:\d{4}|\d{2}))|(?:\d{1,2}\s*(?:st|nd|rd|th)?\s+[A-Z][a-z]{2,9},?\s+(?:19|20)\d{2}))/i.exec(s.text);
      if (explicit) {
        const d = parseDate(explicit[1]!);
        if (d) dueDate = d;
      }

      const relativeDue = within && !dueDate
        ? {
            count: within[1]!,
            unit: (within[2] ?? "days").toUpperCase().replace(/S?$/, "S") as
              "DAYS" | "MONTHS" | "WEEKS" | "YEARS",
          }
        : undefined;

      out.push({
        text: s.text.length > 300 ? s.text.slice(0, 297) + "…" : s.text,
        ...(actor ? { obligor: actor[1]!.replace(/^the\s+/i, "") } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(relativeDue ? { relativeDue } : {}),
        kind,
        pageNo: page.pageNo,
      });
    }
  }
  return out;
}

/** Reliefs sought — the prayer clause, split into its numbered limbs. */
export function extractReliefs(pages: Page[]): DocumentAnalysis["reliefsSought"] {
  const out: DocumentAnalysis["reliefsSought"] = [];

  for (const page of pages) {
    const idx = page.lines.findIndex((l) => P.freshRegex(P.PRAYER_CUE).test(l.text));
    if (idx < 0) continue;

    const STOP = /^\s*(?:VERIFICATION|Verification|Place\s*[:\-]|Dated?\s*[:\-]|Advocate\s+for|Through\s*[:\-]|I,\s)/;
    let buffer: string[] = [];
    const flush = () => {
      const t = buffer.join(" ").trim();
      if (t.length >= 20) out.push({ text: t.length > 400 ? t.slice(0, 397) + "…" : t, pageNo: page.pageNo });
      buffer = [];
    };

    for (let i = idx; i < page.lines.length; i++) {
      const t = page.lines[i]!.text.trim();
      if (i > idx && STOP.test(t)) break;
      if (t.length === 0) { flush(); continue; }
      // A new limb starts at a letter/roman/number marker.
      if (buffer.length > 0 && /^\s*(?:\([a-z]\)|\([ivx]+\)|[a-z][.)]|[ivx]+[.)]|\d{1,2}[.)])\s/i.test(t)) flush();
      buffer.push(t);
    }
    flush();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Structure and holding
// ---------------------------------------------------------------------------

export function extractStructure(pages: Page[]): DocumentAnalysis["structure"] {
  const out: DocumentAnalysis["structure"] = [];
  for (const page of pages) {
    for (const b of page.blocks) {
      if (b.kind !== "HEADING") continue;
      const t = b.text.replace(/\s+/g, " ").trim();
      if (t.length === 0 || t.length > 120) continue;
      // Level from typographic weight proxies: all-caps and short = level 1.
      const level = t === t.toUpperCase() && t.length < 40 ? 1 : 2;
      out.push({ heading: t, pageNo: page.pageNo, level });
    }
  }
  return out;
}

/** Judgement holding and disposition. */
export function extractHolding(pages: Page[]): DocumentAnalysis["holding"] | undefined {
  // Search from the end — the operative part of a judgement is at the back.
  for (let i = pages.length - 1; i >= 0; i--) {
    const page = pages[i]!;
    for (const s of splitSentences(page).reverse()) {
      const d = P.freshRegex(P.DISPOSITION).exec(s.text);
      if (!d) continue;
      const word = (d[1] ?? "").toLowerCase();
      const disposition =
        /partly|partially/.test(word) ? "PARTLY_ALLOWED" :
        word === "allowed" ? "ALLOWED" :
        word === "dismissed" || word === "rejected" ? "DISMISSED" :
        word.startsWith("disposed") ? "DISPOSED" :
        word === "remanded" ? "REMANDED" : "UNKNOWN";
      return { text: s.text, pageNo: page.pageNo, disposition: disposition as never };
    }
  }
  return undefined;
}

export function extractCitations(pages: Page[]): DocumentAnalysis["citations"] {
  const out: DocumentAnalysis["citations"] = [];
  const seen = new Set<string>();
  const add = (raw: string, kind: string, pageNo: number) => {
    const k = `${kind}|${raw}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ raw, kind, pageNo });
  };
  for (const page of pages) {
    const { text } = prepare(page.lines.map((l) => l.text).join(" "));
    for (const m of iterate(P.NEUTRAL_SC, text)) add(m[0], "NEUTRAL_SC", page.pageNo);
    for (const m of iterate(P.NEUTRAL_HC, text)) add(m[0], "NEUTRAL_HC", page.pageNo);
    for (const m of iterate(P.CITATION_REPORTED, text)) add(m[0], "REPORTED", page.pageNo);
    for (const m of iterate(P.CITATION_AIR, text)) add(m[0], "AIR", page.pageNo);
  }
  return out;
}

export function extractMonetary(pages: Page[]): DocumentAnalysis["monetary"] {
  const out: DocumentAnalysis["monetary"] = [];
  for (const page of pages) {
    for (const s of splitSentences(page)) {
      for (const m of findMoney(s.text)) {
        out.push({
          money: { amount: m.amount, currency: m.currency, scale: m.scale, raw: m.raw },
          context: s.text.length > 200 ? s.text.slice(0, 197) + "…" : s.text,
          pageNo: page.pageNo,
        });
      }
    }
  }
  return out;
}

function iterate(re: RegExp, s: string): RegExpExecArray[] {
  const r = P.freshRegex(re);
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = r.exec(s)) !== null) {
    if (m[0].length === 0) { r.lastIndex++; continue; }
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function analyse(
  documentId: string,
  pages: Page[],
  opts: { referenceYear?: number; maxSummary?: number } = {},
): DocumentAnalysis {
  return {
    documentId,
    summarySentences: summarise(pages, opts.maxSummary !== undefined ? { maxSentences: opts.maxSummary } : {}),
    timeline: buildTimeline(pages, opts.referenceYear !== undefined ? { referenceYear: opts.referenceYear } : {}),
    obligations: extractObligations(pages),
    reliefsSought: extractReliefs(pages),
    ...(extractHolding(pages) ? { holding: extractHolding(pages) } : {}),
    citations: extractCitations(pages),
    monetary: extractMonetary(pages),
    structure: extractStructure(pages),
    // Detected grids, labelled and normalised. See table-records.ts for why
    // these are published as structure rather than pushed into the candidate
    // stream that feeds autofill.
    tables: pages.flatMap((p) =>
      p.tables.map((t) => toTableRecord(
        t, documentId, p.pageNo,
        opts.referenceYear !== undefined ? { referenceYear: opts.referenceYear } : {},
      )),
    ),
  };
}

/** All sections mentioned anywhere in the document, deduplicated. */
export function allSections(pages: Page[]): StatuteSection[] {
  const seen = new Set<string>();
  const out: StatuteSection[] = [];
  for (const page of pages) {
    const { text } = prepare(page.lines.map((l) => l.text).join(" "));
    for (const s of findSections(text)) {
      const k = `${s.statute}:${s.section}:${s.subsections.join(".")}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(s);
    }
  }
  return out;
}
