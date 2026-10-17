/**
 * Document-type classification.
 *
 * Weighted-cue scoring, not machine learning, and that is a deliberate choice
 * rather than a limitation:
 *
 *  - It is EXPLAINABLE. The review UI can say "classified as Written Statement
 *    because 'written statement' and 'on behalf of the defendant' appear on
 *    page 1". A model that says "0.94" cannot be argued with by an advocate, and
 *    an unexplainable classification cannot be defended in an audit.
 *  - It is CORRECTABLE IN MINUTES. A new document family arriving from a tribunal
 *    is a data change, not a retraining cycle.
 *  - It needs NO TRAINING CORPUS. We do not have a labelled corpus of Indian
 *    legal documents that we are licensed to train on, and pretending otherwise
 *    would be the real limitation.
 *
 * The scoring rules that matter:
 *  - Cues are weighted by diagnosticity, not frequency. "WHEREAS" appears in
 *    every deed and is worth 6; "deed of absolute sale" appears in one type and
 *    is worth 12.
 *  - Only the FIRST TWO PAGES are scored by default. A judgement quoting a plaint
 *    at length on page 14 would otherwise drift toward PLAINT.
 *  - Anti-cues subtract. They exist specifically for near-neighbour separation.
 *  - Runners-up are always returned. A single confident answer with no
 *    alternatives is how a misclassification becomes invisible.
 */

import type { Classification, DocTypeProfile, Page } from "../types.js";
import { ALL_DOC_TYPES as DOC_TYPES } from "./all-types.js";
import { prepare } from "../grammar/script.js";

export interface ClassifyOptions {
  /** How many leading pages to score. */
  pagesToScore?: number;
  /** Extra profiles, e.g. tenant-specific tribunal forms. */
  extraProfiles?: DocTypeProfile[];
  /** File name, used as a weak signal when the text is inconclusive. */
  fileName?: string;
}

interface Score {
  profile: DocTypeProfile;
  raw: number;
  hits: Array<{ cue: string; weight: number; pageNo: number; snippet: string }>;
  antiHits: Array<{ cue: string; weight: number; pageNo: number }>;
}

/** A short window around a match, for the explainability panel. */
function snippet(text: string, index: number, len: number): string {
  const from = Math.max(0, index - 30);
  const to = Math.min(text.length, index + len + 40);
  return (from > 0 ? "…" : "") + text.slice(from, to).replace(/\s+/g, " ").trim() + (to < text.length ? "…" : "");
}

export function classify(pages: Page[], opts: ClassifyOptions = {}): Classification {
  const profiles = [...DOC_TYPES, ...(opts.extraProfiles ?? [])];
  const limit = Math.min(pages.length, opts.pagesToScore ?? 2);

  const pageTexts: Array<{ pageNo: number; text: string }> = [];
  for (let i = 0; i < limit; i++) {
    const p = pages[i]!;
    const { text } = prepare(p.lines.map((l) => l.text).join("\n"));
    pageTexts.push({ pageNo: p.pageNo, text });
  }

  const scores: Score[] = profiles.map((profile) => {
    const hits: Score["hits"] = [];
    const antiHits: Score["antiHits"] = [];
    let raw = 0;

    for (const { pageNo, text } of pageTexts) {
      // Page 1 carries the identity of a document; later pages are corroboration.
      const pageWeight = pageNo === pageTexts[0]!.pageNo ? 1 : 0.6;

      for (const cue of profile.cues) {
        const re = new RegExp(cue.re.source, cue.re.flags.includes("g") ? cue.re.flags : cue.re.flags + "g");
        const m = re.exec(text);
        if (!m) continue;
        // A cue counts once per page however often it appears. Repetition is not
        // evidence — a contract says "shall" ninety times and is not ninety times
        // more of a contract.
        raw += cue.w * pageWeight;
        hits.push({ cue: cue.re.source, weight: cue.w * pageWeight, pageNo, snippet: snippet(text, m.index, m[0].length) });
      }

      for (const anti of profile.antiCues ?? []) {
        const re = new RegExp(anti.re.source, anti.re.flags.includes("g") ? anti.re.flags : anti.re.flags + "g");
        if (!re.test(text)) continue;
        raw -= anti.w * pageWeight;
        antiHits.push({ cue: anti.re.source, weight: anti.w * pageWeight, pageNo });
      }
    }

    // Filename is a weak tiebreaker only — never enough to classify on its own,
    // because users name files "scan001.pdf" and "final final.pdf".
    if (opts.fileName) {
      const fn = opts.fileName.toLowerCase();
      const codeWords = profile.code.toLowerCase().split("_").filter((w) => w.length >= 4);
      if (codeWords.length > 0 && codeWords.every((w) => fn.includes(w))) raw += 1.5;
    }

    return { profile, raw: Math.max(0, raw), hits, antiHits };
  });

  scores.sort((a, b) => b.raw - a.raw);
  const best = scores[0]!;
  const second = scores[1];

  if (best.raw === 0) {
    return {
      code: "UNKNOWN", label: "Unclassified", family: "OTHER",
      conf: 0, alternatives: [], evidence: [],
    };
  }

  // Confidence from separation, not from raw score.
  //
  // Raw score is unbounded and scales with document length, so mapping it
  // directly to a probability would make a long document look confidently
  // classified merely for being long. What actually indicates confidence is how
  // far the winner is clear of the runner-up: a plaint that scores 45 with a
  // written statement at 43 is a coin toss and must be shown as one.
  const runnerUp = second?.raw ?? 0;
  const separation = best.raw > 0 ? (best.raw - runnerUp) / best.raw : 0;
  const absolute = Math.min(1, best.raw / 30); // 30 points is a solid identification
  const conf = Math.max(0, Math.min(0.98, 0.45 * absolute + 0.55 * separation));

  return {
    code: best.profile.code,
    label: best.profile.label,
    family: best.profile.family,
    conf,
    alternatives: scores
      .slice(1, 4)
      .filter((s) => s.raw > 0)
      .map((s) => ({
        code: s.profile.code,
        label: s.profile.label,
        conf: Math.min(0.98, s.raw / Math.max(best.raw, 1) * conf),
      })),
    // Strongest evidence first, capped so the panel stays readable.
    evidence: best.hits.sort((a, b) => b.weight - a.weight).slice(0, 8),
  };
}

/**
 * Classify each page independently.
 *
 * Needed because a single uploaded PDF is very often a BUNDLE: a bail
 * application, then the FIR, then the medical report, then the vakalatnama,
 * scanned in one pass. Treating that as one document of one type throws away most
 * of it. Page-level classification lets the pipeline split the bundle into
 * logical documents before extraction.
 */
export function classifyPages(pages: Page[], opts: ClassifyOptions = {}): Classification[] {
  return pages.map((p) => classify([p], { ...opts, pagesToScore: 1 }));
}

export interface BundleSegment {
  code: string;
  label: string;
  family: string;
  fromPage: number;
  toPage: number;
  conf: number;
}

/**
 * Split a multi-document bundle into segments.
 *
 * The rule: a new segment starts when a page classifies as a different type with
 * reasonable confidence AND that page looks like a document opening (a heading
 * block near the top, or a court name). Requiring the opening signal is what
 * stops a mid-document page that happens to quote an FIR from splitting the
 * document in two.
 */
export function segmentBundle(
  pages: Page[],
  opts: ClassifyOptions & { minConf?: number } = {},
): BundleSegment[] {
  const minConf = opts.minConf ?? 0.35;
  const perPage = classifyPages(pages, opts);
  const segments: BundleSegment[] = [];

  const looksLikeOpening = (p: Page): boolean => {
    const topLines = p.lines.filter((l) => l.bbox.y < p.height * 0.3);
    const topText = topLines.map((l) => l.text).join(" ");
    return (
      /IN\s+THE\s+|BEFORE\s+THE\s+|FIRST\s+INFORMATION|LEGAL\s+NOTICE|AFFIDAVIT|VAKALATNAMA|DEED\s+OF|THIS\s+AGREEMENT/i.test(topText) ||
      p.blocks.some((b) => b.kind === "HEADING" && b.bbox.y < p.height * 0.25)
    );
  };

  for (let i = 0; i < pages.length; i++) {
    const c = perPage[i]!;
    const prev = segments[segments.length - 1];
    const isNew =
      !prev ||
      (c.code !== prev.code && c.conf >= minConf && looksLikeOpening(pages[i]!));

    if (isNew) {
      segments.push({
        code: c.code, label: c.label, family: c.family,
        fromPage: pages[i]!.pageNo, toPage: pages[i]!.pageNo, conf: c.conf,
      });
    } else {
      prev!.toPage = pages[i]!.pageNo;
      prev!.conf = Math.max(prev!.conf, c.conf);
    }
  }
  return segments;
}
