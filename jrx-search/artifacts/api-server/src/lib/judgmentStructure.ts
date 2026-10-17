/**
 * NYS-JUDGMENT-STRUCTURE-001 — extract the structure that is genuinely present
 * in an Indian judgment's text, and nothing else.
 *
 * WHY THE CONSTRAINT IS THE FEATURE
 * ---------------------------------
 * The partner ask is `paras[]` with real paragraph numbers so counsel can cite
 * "at para 47". The failure mode to avoid is not "found too few paragraphs" — it
 * is "returned a number counsel then cited in court that the judgment does not
 * carry". NSP deleted exactly that behaviour in their FB-206 (a panel was
 * sentence-splitting a summary into invented "Key Holdings").
 *
 * So this module NEVER assigns `n` by position. Every `n` is a literal integer
 * read out of the source text. If a judgment does not number its paragraphs, the
 * honest result is `paras: []` plus `numbering: 'absent'` — measured below, that
 * is the true answer for a large, identifiable class of Indian judgments, not a
 * parser shortfall.
 *
 * MEASURED CONVENTIONS (real SCR text layers, 2026-08-20, via unpdf)
 * ------------------------------------------------------------------
 * Two eras, and the split is the single most important finding:
 *
 *  - **Modern SCR (~2000 onwards)** — paragraphs are numbered `N.` at the start
 *    of a line, restarting at 1 for each separate opinion. Verified: 2026 SCR
 *    (68 paragraphs, 1..68 contiguous), 2025 SCR (1..28 then a restart per
 *    opinion), 2024 SCR (876 marker lines / 41 descents across three opinions).
 *  - **Old SCR (1950–~1990)** — paragraphs are **NOT numbered at all**. The body
 *    is unnumbered prose keyed by marginal letters A–G for pinpoint citation.
 *    Verified: Maneka Gandhi [1978] 2 SCR 621 and Kesavananda Bharati [1973] 1
 *    SCR 1 contain no paragraph numbering; every `^N.` line in them is a year
 *    (`1967.`), an Article number (`368.`), a quoted enactment clause, or a
 *    footnote marker. For those two, `paras: []` is the correct answer and any
 *    non-empty result would be fabricated.
 *
 * Hence the decoys this module must reject, all observed in real text:
 *  - years as sentence openers — `1967. On the 4th of July 1977, …`
 *  - Article/section numbers — `368. It is determinative of …`
 *  - footnote/citation markers — `(1) [1967] 3 S.C.R. 525.`
 *  - reporter page furniture — `684 SUPREME COURT REPORTS [1978] 2 S·C·R·`
 *  - marginal letters alone on a line — `A`, `B`, … `G`
 *  - headnote "Held: 1." enumeration, which numbers HOLDINGS, not paragraphs
 *
 * The discriminator is a **contiguous ascending run**, not a regex. A real
 * paragraph sequence increments by exactly 1 over many markers; years and
 * Article numbers do not. A marker is only accepted as a paragraph number when
 * it belongs to such a run, which is why `368.` is dropped in Kesavananda but
 * `68.` is kept in the 2026 volume.
 *
 * WHERE THIS RUNS
 * ---------------
 * In NYS, next to the extractor, but NOT baked into the `archive_extracts`
 * cache. The cache stores raw text; parsing happens per request over cached
 * text. Rationale: parsing 2.88 M chars costs ~40 ms (measured) against a ~2.7 s
 * cold extract, so there is little to win, while writing a parsed payload into
 * the cache would change a stored shape that already has 67 rows and would pin
 * every future parser improvement behind a cache migration. Re-parsing is cheap
 * and always reflects the current parser.
 */

/** A paragraph whose number was read literally from the source text. */
export interface JudgmentParagraph {
  /**
   * The paragraph number AS PRINTED. Never derived from position — a counted
   * index would be a citation an advocate could not rely on in court.
   */
  n: number;
  text: string;
  /**
   * Which opinion this paragraph belongs to, 0-based, in document order.
   * Multi-opinion judgments restart numbering at 1 per opinion, so `n` alone is
   * ambiguous — "para 5" exists once per opinion.
   */
  opinionIndex: number;
  /** Authoring judge as printed at the head of the opinion, when detected. */
  opinionAuthor: string | null;
}

export type ParagraphNumbering =
  /** Numbers were read from the source. */
  | 'preserved'
  /** The source carries no paragraph numbering (old SCR prose). */
  | 'absent'
  /** Markers exist but no trustworthy ascending run — refuse rather than guess. */
  | 'ambiguous';

export interface JudgmentOpinion {
  index: number;
  author: string | null;
  /** Inclusive-exclusive line span in the normalized text. */
  lineStart: number;
  lineEnd: number;
  paragraphCount: number;
  /** First/last paragraph number printed in this opinion, when numbered. */
  firstParagraph: number | null;
  lastParagraph: number | null;
}

export interface JudgmentStructure {
  paras: JudgmentParagraph[];
  numbering: ParagraphNumbering;
  /**
   * Human-readable reason for `absent` / `ambiguous`, so a partner UI can tell a
   * reader *why* there is nothing to cite rather than showing an empty panel.
   */
  numberingNote: string | null;
  opinions: JudgmentOpinion[];
  /** Field names this parser actually found in THIS document. */
  extractedFields: string[];
  /**
   * Fields asked for by the contract that are not present in this source.
   * Explicit, because an absent field and an unextractable field are different
   * facts and the partner needs to tell them apart.
   */
  unavailableFields: string[];
  headnote: string | null;
  held: string | null;
  facts: string | null;
  issues: string | null;
  disposition: string | null;
  /**
   * Bench composition exactly as printed in the source, e.g.
   * `[M. H. BEG, C. J., Y. V. CHANDRACHUD, … JJ.]`.
   */
  coram: string[];
  /** Reporter citations printed in the document header, e.g. `2026 INSC 228`. */
  parallelCitations: string[];
  /** Court appealed from, when the source states it in a "Case Arising From" block. */
  appealedFrom: string | null;
}

/**
 * Minimum markers in one ascending chain. Below this, quoted statutory clauses
 * ("1. India, that is Bharat…" / "2. The States…" / "3. The territory…",
 * verbatim in Kesavananda) are indistinguishable from paragraphs.
 */
const MIN_CHAIN_LENGTH = 4;

/**
 * Minimum mean lines per paragraph inside a chain.
 *
 * A judgment paragraph is multi-line prose; a footnote table or a list of
 * authorities is one line per entry. Measured on real text: genuine body chains
 * run 6–25 lines per paragraph, while the footnote block in [2025] 1 SCR 1782
 * (`4. Bennion on Statutory Interpretation…` / `5. (2022) 2 SCC 401.`) runs at
 * 1.0 and Kesavananda's quoted-clause lists at 2.0–2.7. Rejecting below 2.0
 * removes those without touching any real paragraph sequence.
 */
const MIN_CHAIN_DENSITY = 2.0;

/**
 * Minimum share of the judgment body that the accepted paragraphs must span
 * before numbering is believed.
 *
 * This is the decisive global check, and the threshold is measured rather than
 * chosen: across 12 real SCR volumes the genuinely-numbered ones cover 26.9 %–
 * 98.6 % of their body, while every false candidate covers 0 %–6.1 %. Real
 * paragraph numbering partitions the whole judgment; a coincidental run covers a
 * sliver of it. 20 % sits inside the empty gap between the two populations, with
 * margin on both sides.
 */
const MIN_BODY_COVERAGE = 0.2;

/**
 * A judgment's paragraph numbering starts near the top of the opinion. The first
 * accepted number must therefore be small: a "sequence" whose lowest number is
 * 47 is far more likely to be a footnote or clause list than paragraph 47 of an
 * opinion whose paragraphs 1–46 were never found.
 */
const MAX_FIRST_PARAGRAPH = 12;

/** Paragraph markers, one regex per printed convention. */
const MARKER_FORMS = [
  /** `47.` — the Supreme Court Reports body convention. */
  { form: 'n.' as const, re: /^(\d{1,4})\.\s+(?=\S)/ },
  /** `(47)` — used by some High Courts; also the SCR footnote form. */
  { form: '(n)' as const, re: /^\((\d{1,4})\)\s+(?=\S)/ },
  /** `47)` — occasional High Court convention. */
  { form: 'n)' as const, re: /^(\d{1,4})\)\s+(?=\S)/ },
  /** `Para 47` / `Paragraph 47.` — rare, but explicit when present. */
  { form: 'para n' as const, re: /^(?:Para|Paragraph)\.?\s+(\d{1,4})[.:)]?\s+(?=\S)/i },
];

export type MarkerForm = (typeof MARKER_FORMS)[number]['form'];

/**
 * Opinion heading: an authoring judge line such as `J.K. Maheshwari, J.`,
 * `S. M. Sikri C.J.`, `M. R. SHAH, J.` or `Per S.H. Kapadia, CJI.`.
 *
 * Anchored and length-capped so it cannot swallow a sentence ending in "J.".
 */
const OPINION_HEAD =
  /^(?:Per\s+)?((?:[A-Z][A-Za-z.'’-]*\s+){0,4}[A-Z][A-Za-z.'’-]*)\s*,?\s*(C\.?\s*J\.?(?:\s*I\.?)?|JJ?\.)\s*:?\.?$/;

/**
 * Headnote cross-references (`In the judgment of Surya Kant, J.:`) — these sit
 * in the reporter's summary, not at an opinion boundary. Treating them as
 * boundaries splits a single opinion into phantom ones.
 */
const HEADNOTE_OPINION_REF = /^(?:In\s+the\s+judge?ments?\s+of|IN\s+THE\s+JUDGMENT\s+OF)\b/i;

/**
 * Reporter page furniture that the text layer interleaves into the body.
 *
 * These are the shapes actually observed, not guesses. The running header is
 * printed as a PAIR of lines and the volume/page number is glued to the case
 * name with no space, because the PDF places them as separate text runs:
 *
 *   `526 [2026] 3 S.C.R.Supreme Court Reports`
 *   `[2026] 3 S.C.R. 529Municipal Corporation of Greater Mumbai v.`
 *   `M/s R.V. Anderson Associates Limited`      ← continuation of the above
 *   `684 SUPREME COURT REPORTS [1978] 2 S·C·R·`  (older volumes, spaced periods)
 *
 * Left in place, this text lands mid-sentence inside a paragraph an advocate is
 * about to quote — measured: 13 of 68 paragraphs in [2026] 3 SCR 525 carried a
 * running header before this filter matched the real shapes.
 */
const PAGE_FURNITURE = [
  /** `526 [2026] 3 S.C.R.Supreme Court Reports` */
  /^\d{1,4}\s*\[\d{4}\]\s*\d*\s*S[.·]?\s*C[.·]?\s*R[.·]?\s*(?:Supreme\s+Court\s+Reports)?\s*$/i,
  /** `[2026] 3 S.C.R. 529Municipal Corporation of Greater Mumbai v.` */
  /^\[\d{4}\]\s*\d*\s*S[.·]?\s*C[.·]?\s*R[.·]?\s*\d{1,4}\S/,
  /** `684 SUPREME COURT REPORTS [1978] 2 S·C·R·` */
  /^\d{0,4}\s*SUPREME\s+COURT\s+REPORTS\b/i,
  /** bare folio number alone on a line */
  /^\d{1,4}\s*$/,
];

/**
 * Second line of a two-line running header. Only stripped when the previous line
 * was itself furniture, so a case name quoted in the body is never removed.
 */
const CONTINUATION_MAX_LEN = 90;

/** Marginal pinpoint letters (A–G) that old SCR prints alone on a line. */
const MARGIN_LETTER = /^[A-G]$/;

function isFurniture(line: string): boolean {
  if (!line) return true;
  if (MARGIN_LETTER.test(line)) return true;
  return PAGE_FURNITURE.some((re) => re.test(line));
}

/**
 * Drop the second line of a two-line running header.
 *
 * Guarded on the previous line being furniture and on brevity: a case name is a
 * short line, whereas a sentence continuing a paragraph is not. Without the
 * guard this would delete body text that happens to end in `v.`
 */
function isHeaderContinuation(line: string, previousWasFurniture: boolean): boolean {
  if (!previousWasFurniture) return false;
  return line.length <= CONTINUATION_MAX_LEN && !/[.;:]$/.test(line);
}

interface Marker {
  line: number;
  n: number;
}

function readMarkers(lines: string[], re: RegExp, from: number): Marker[] {
  const out: Marker[] = [];
  for (let i = from; i < lines.length; i += 1) {
    const m = re.exec(lines[i]!);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isInteger(n) || n < 1 || n > 9999) continue;
    out.push({ line: i, n });
  }
  return out;
}

/**
 * Split markers into strictly-+1 ascending chains, then drop the ones whose
 * spacing shows they are list entries rather than paragraphs.
 *
 * The +1 test is the anti-fabrication mechanism: a judgment's paragraph numbers
 * increment by one, whereas years (`1967.`), Article numbers (`368.`) and
 * reporter page refs never form such a chain.
 */
function chainMarkers(markers: Marker[]): Marker[][] {
  const chains: Marker[][] = [];
  let current: Marker[] = [];
  const flush = () => {
    if (current.length < MIN_CHAIN_LENGTH) return;
    const span = current[current.length - 1]!.line - current[0]!.line;
    const density = span / Math.max(1, current.length - 1);
    if (density >= MIN_CHAIN_DENSITY) chains.push(current);
  };
  for (const marker of markers) {
    const last = current[current.length - 1];
    if (last && marker.n === last.n + 1) {
      current.push(marker);
      continue;
    }
    flush();
    current = [marker];
  }
  flush();
  return mergeContinuations(chains);
}

/**
 * Stitch chains that continue the same ascending sequence.
 *
 * A single opinion's numbering is routinely broken into several chains because
 * one marker went missing from the text layer — a paragraph number swallowed by
 * an interleaved page header, or a `4.` OCR'd as `4,`. Left unmerged, [2025] 1
 * SCR 1782 reported 31 "opinions" for a two-opinion judgment, which would tell a
 * reader the numbering restarted 31 times when it did not.
 *
 * Merge only FORWARD gaps (next chain starts above the previous chain's last
 * number and later in the document). A chain that restarts at or below the
 * previous number is a genuine restart — a separate opinion — and must stay
 * separate, because that is the fact a citation depends on.
 */
function mergeContinuations(chains: Marker[][]): Marker[][] {
  if (chains.length < 2) return chains;
  const out: Marker[][] = [chains[0]!];
  for (let i = 1; i < chains.length; i += 1) {
    const chain = chains[i]!;
    const prev = out[out.length - 1]!;
    const prevLast = prev[prev.length - 1]!;
    const isForwardContinuation = chain[0]!.n > prevLast.n && chain[0]!.line > prevLast.line;
    if (isForwardContinuation) prev.push(...chain);
    else out.push(chain);
  }
  return out;
}

/**
 * Section captions the modern SCR format prints literally. Only these delimit a
 * field: each one is a caption the reporter actually typeset, so the resulting
 * `headnote` / `held` / `issues` are quotations, not inferences.
 *
 * `ratio` and `obiter` are absent from this table on purpose and there is no
 * heuristic for them below. No Indian judgment format delimits ratio from
 * obiter — deciding which reasoning is binding is the reader's legal judgment,
 * and a keyword or sentence-position guess is precisely the FB-206 failure.
 */
const SECTION_CAPTIONS: Array<{ field: keyof JudgmentStructure; re: RegExp }> = [
  { field: 'issues', re: /^Issues?\s+for\s+Consideration\s*:?\.?$/i },
  { field: 'headnote', re: /^Headnotes?\s*[†*]?\s*:?\.?$/i },
];

/** Captions that terminate a headnote/issues block without starting a field. */
const SECTION_TERMINATORS = [
  /^Case\s+Law\s+Cited\s*:?\.?$/i,
  /^List\s+of\s+(?:Acts|Keywords)\s*:?\.?$/i,
  /^Case\s+Arising\s+From\s*:?\.?$/i,
  /^Appearances?\s+for\s+Parties\s*:?\.?$/i,
  /^Judgments?\s*\/\s*Orders?\s+of\s+the\s+Supreme\s+Court\s*:?\.?$/i,
  /^(?:CIVIL|CRIMINAL)\s+(?:ORIGINAL|APPELLATE|WRIT)\s+JURISDICTION\b/i,
  /^Issues?\s+for\s+Consideration\s*:?\.?$/i,
  /^Headnotes?\s*[†*]?\s*:?\.?$/i,
];

/** The body anchor in modern SCR: everything after it is the judgment itself. */
const BODY_ANCHOR = /^Judgments?\s*\/\s*Orders?\s+of\s+the\s+Supreme\s+Court\s*:?\.?$/i;

/** `Held:` opens the operative part of a modern headnote. */
const HELD_OPENER = /^Held\s*:/i;

/** A body caption the author typeset, e.g. `FACTS`. */
const FACTS_CAPTION = /^(?:FACTS|THE\s+FACTS|FACTUAL\s+(?:MATRIX|BACKGROUND))\s*:?\.?$/i;

/** `Result of the case: Appeals Dismissed.` — the reporter's own disposition line. */
const DISPOSITION = /^Result\s+of\s+the\s+case\s*:\s*(.+?)\s*$/i;

/**
 * Coram as printed: `[J.K. Maheshwari* and Atul S. Chandurkar, JJ.]`. Requires
 * the bracketed form so a sentence naming judges is never mistaken for a bench.
 */
const CORAM_LINE = /^\[([^\]]{6,300}?),?\s*(?:JJ?\.|C\.?\s*J\.?I?\.?)\s*\]$/;

/** Neutral / reporter citations printed in the header, e.g. `2026 INSC 228`. */
const CITATION_TOKENS = [
  /\b(\d{4}\s+INSC\s+\d+)\b/g,
  /(\[\d{4}\]\s*\d*\s*S\.?\s*C\.?\s*R\.?\s*\d+)/g,
  /\b(\(\d{4}\)\s*\d+\s*SCC\s*\d+)\b/g,
  /\b(AIR\s+\d{4}\s+SC\s+\d+)\b/g,
];

const APPEALED_FROM = /^From\s+the\s+(?:Judgment|Order)s?\b.*$/i;

export interface ParseOptions {
  /**
   * Cap on lines scanned, to bound worst-case cost on a pathological document.
   * Defaults to the whole text; Kesavananda's 45,029 lines parse in ~40 ms.
   */
  maxLines?: number;
}

/**
 * Locate the start of the judgment body.
 *
 * Two anchors, most reliable first:
 *  1. Modern SCR caption `Judgment / Order of the Supreme Court`.
 *  2. The first authoring-judge line (`J.B. Pardiwala, J.`), for volumes that
 *     print no caption.
 *
 * Getting this boundary right is a correctness requirement, not a refinement.
 * In [1980] 3 SCR 383 the *headnote* carries `HELD : 1.` … `15.` — a numbered
 * list of HOLDINGS, each ending in a reporter page ref such as `[393 C-D]` — and
 * it is a genuine +1 chain with prose-like spacing, so neither the chain test nor
 * the density test can reject it. Returning those as `paras` would hand counsel a
 * "para 14" that cites the reporter's summary rather than the Court: the FB-206
 * failure exactly.
 *
 * A jurisdiction-block anchor (`CRIMINAL APPELLATE JURISDICTION : …`) was tried
 * and removed: it changed no verdict on any of the 12 real volumes measured,
 * because the authoring-judge line always follows it closely. An unreachable
 * branch would have read as a safeguard while doing nothing.
 */
function findBodyStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i += 1) {
    if (BODY_ANCHOR.test(lines[i]!)) return i + 1;
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (HEADNOTE_OPINION_REF.test(line)) continue;
    if (OPINION_HEAD.test(line)) return i + 1;
  }
  return -1;
}

/** Collect the text under a caption until the next caption/terminator. */
function captureBlock(lines: string[], from: number, limit: number): string {
  const parts: string[] = [];
  for (let i = from; i < Math.min(lines.length, limit); i += 1) {
    const line = lines[i]!;
    if (SECTION_TERMINATORS.some((re) => re.test(line))) break;
    if (isFurniture(line)) continue;
    parts.push(line);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function detectOpinionHeads(
  lines: string[],
  from: number,
  to: number,
): Array<{ line: number; author: string }> {
  const heads: Array<{ line: number; author: string }> = [];
  for (let i = Math.max(0, from); i < Math.min(lines.length, to); i += 1) {
    const line = lines[i]!;
    if (HEADNOTE_OPINION_REF.test(line)) continue;
    const m = OPINION_HEAD.exec(line);
    if (!m) continue;
    heads.push({ line: i, author: `${m[1]!.trim()} ${m[2]!.trim()}`.replace(/\s+/g, ' ') });
  }
  return heads;
}

/**
 * Group accepted ascending runs into opinions.
 *
 * A run that starts at 1 after a previous run has advanced is a restart, which in
 * Indian practice means a new (concurring or dissenting) opinion. Opinions are
 * kept as separate containers rather than renumbering, because renumbering would
 * destroy the only citation that is actually valid: "para 5 of Khanna J."
 */
function buildParagraphs(
  lines: string[],
  chains: Marker[][],
  bodyStart: number,
  bodyEnd: number,
): { paras: JudgmentParagraph[]; opinions: JudgmentOpinion[] } {
  const heads = detectOpinionHeads(lines, bodyStart, bodyEnd);
  const authorFor = (line: number): string | null => {
    let author: string | null = null;
    for (const head of heads) {
      if (head.line <= line) author = head.author;
      else break;
    }
    return author;
  };

  const paras: JudgmentParagraph[] = [];
  const opinions: JudgmentOpinion[] = [];

  chains.forEach((chain, opinionIndex) => {
    const author = authorFor(chain[0]!.line);
    for (let k = 0; k < chain.length; k += 1) {
      const marker = chain[k]!;
      // A paragraph ends where the next marker begins; the last one ends at the
      // following chain's start (or the body end) so it is not silently emptied.
      const stop =
        k + 1 < chain.length
          ? chain[k + 1]!.line
          : Math.min(bodyEnd, nextChainStart(chains, opinionIndex, bodyEnd));
      const parts: string[] = [];
      let previousWasFurniture = false;
      for (let i = marker.line; i < stop; i += 1) {
        const line = lines[i]!;
        if (isFurniture(line)) {
          previousWasFurniture = true;
          continue;
        }
        if (isHeaderContinuation(line, previousWasFurniture)) {
          previousWasFurniture = false;
          continue;
        }
        previousWasFurniture = false;
        parts.push(i === marker.line ? stripMarker(line) : line);
      }
      const text = parts.join(' ').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      paras.push({ n: marker.n, text, opinionIndex, opinionAuthor: author });
    }
    opinions.push({
      index: opinionIndex,
      author,
      lineStart: chain[0]!.line,
      lineEnd: chain[chain.length - 1]!.line,
      paragraphCount: chain.length,
      firstParagraph: chain[0]!.n,
      lastParagraph: chain[chain.length - 1]!.n,
    });
  });

  return { paras, opinions };
}

function stripMarker(line: string): string {
  for (const { re } of MARKER_FORMS) {
    const stripped = line.replace(re, '');
    if (stripped !== line) return stripped;
  }
  return line;
}

function nextChainStart(chains: Marker[][], index: number, fallback: number): number {
  const next = chains[index + 1];
  return next ? next[0]!.line : fallback;
}

/** Fields the NSP contract asks for, so absence can be reported explicitly. */
const CONTRACT_FIELDS = [
  'paras',
  'headnote',
  'held',
  'ratio',
  'obiter',
  'facts',
  'issues',
  'disposition',
  'coram',
  'parallelCitations',
  'appealedFrom',
  'appealedTo',
] as const;

/**
 * Extract the structure present in a judgment's extracted text.
 *
 * Total function: never throws on malformed input, and returns empty/absent
 * rather than partial guesses. Determinism matters because the same cached text
 * must always yield the same paragraph numbers — an advocate's citation cannot
 * depend on when the request was made.
 */
export function parseJudgmentStructure(
  rawText: string,
  options: ParseOptions = {},
): JudgmentStructure {
  const empty = (note: string): JudgmentStructure => ({
    paras: [],
    numbering: 'absent',
    numberingNote: note,
    opinions: [],
    extractedFields: [],
    unavailableFields: [...CONTRACT_FIELDS],
    headnote: null,
    held: null,
    facts: null,
    issues: null,
    disposition: null,
    coram: [],
    parallelCitations: [],
    appealedFrom: null,
  });

  if (typeof rawText !== 'string' || rawText.trim().length === 0) {
    return empty('No extracted text was supplied, so nothing could be read.');
  }

  const allLines = rawText.split('\n').map((l) => l.trim());
  const lines =
    options.maxLines && options.maxLines > 0 ? allLines.slice(0, options.maxLines) : allLines;

  const bodyAnchor = findBodyStart(lines);
  const bodyStart = bodyAnchor >= 0 ? bodyAnchor : 0;
  const bodyEnd = lines.length;

  // Header region = everything before the body; that is where the reporter prints
  // coram and parallel citations. Old SCR has no body anchor, so a bounded
  // prefix stands in — the bench block is always in the first page or two.
  const headerEnd = bodyAnchor >= 0 ? bodyAnchor : Math.min(lines.length, 80);

  const coram: string[] = [];
  for (let i = 0; i < headerEnd; i += 1) {
    const m = CORAM_LINE.exec(lines[i]!);
    if (!m) continue;
    const names = m[1]!
      .split(/,|\band\b/)
      .map((s) => s.replace(/[*†]/g, '').trim())
      .filter((s) => s.length > 1 && /[A-Za-z]/.test(s));
    if (names.length > 0) {
      coram.push(...names);
      break;
    }
  }

  const parallelCitations: string[] = [];
  const headerText = lines.slice(0, Math.min(headerEnd, 40)).join('\n');
  for (const re of CITATION_TOKENS) {
    for (const m of headerText.matchAll(re)) {
      const value = m[1]!.replace(/\s+/g, ' ').trim();
      if (value && !parallelCitations.includes(value)) parallelCitations.push(value);
    }
  }

  let headnote: string | null = null;
  let issues: string | null = null;
  let held: string | null = null;
  let facts: string | null = null;
  let disposition: string | null = null;
  let appealedFrom: string | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    for (const caption of SECTION_CAPTIONS) {
      if (!caption.re.test(line)) continue;
      const block = captureBlock(lines, i + 1, headerEnd);
      if (!block) continue;
      if (caption.field === 'headnote' && !headnote) headnote = block;
      if (caption.field === 'issues' && !issues) issues = block;
    }
    if (!held && HELD_OPENER.test(line) && i < headerEnd) {
      held = captureBlock(lines, i, headerEnd).replace(HELD_OPENER, '').trim() || null;
    }
    if (!facts && FACTS_CAPTION.test(line) && i >= bodyStart) {
      // Bounded to the next paragraph marker: a FACTS caption introduces
      // numbered paragraphs, and those are already returned in `paras`.
      facts = captureBlock(lines, i + 1, Math.min(lines.length, i + 60)) || null;
    }
    if (!disposition) {
      const m = DISPOSITION.exec(line);
      if (m) disposition = m[1]!.trim();
    }
    if (!appealedFrom && i < headerEnd && APPEALED_FROM.test(line)) {
      appealedFrom = captureBlock(lines, i, headerEnd) || null;
    }
  }

  // Paragraph markers are read from the BODY only. A headnote's numbered list
  // enumerates HOLDINGS (in [1980] 3 SCR 383 each entry ends in a reporter page
  // ref such as `[393 C-D]`), so emitting those as `paras` would give counsel a
  // paragraph number that cites the reporter's summary, not the Court.
  const bodyLineCount = Math.max(1, bodyEnd - bodyStart);

  // Each printed convention is evaluated independently and the strongest wins.
  // Mixing them would fuse a body chain with the footnote block that uses `(n)`.
  let best: { chains: Marker[][]; coverage: number; markers: number } | null = null;
  let markerTotal = 0;
  for (const { re } of MARKER_FORMS) {
    const markers = readMarkers(lines, re, bodyStart);
    markerTotal += markers.length;
    const chains = chainMarkers(markers);
    if (chains.length === 0) continue;
    const covered = chains.reduce((sum, c) => sum + (c[c.length - 1]!.line - c[0]!.line), 0);
    const coverage = covered / bodyLineCount;
    if (!best || coverage > best.coverage) best = { chains, coverage, markers: markers.length };
  }

  let numbering: ParagraphNumbering;
  let numberingNote: string | null = null;
  let paras: JudgmentParagraph[] = [];
  let opinions: JudgmentOpinion[] = [];

  if (best && best.coverage >= MIN_BODY_COVERAGE && best.chains[0]![0]!.n <= MAX_FIRST_PARAGRAPH) {
    const built = buildParagraphs(lines, best.chains, bodyStart, bodyEnd);
    paras = built.paras;
    opinions = built.opinions;
    numbering = 'preserved';
    if (opinions.length > 1) {
      numberingNote =
        `Paragraph numbering restarts within this judgment (${opinions.length} numbered sequences detected, ` +
        'which is how separate concurring or dissenting opinions are printed). A paragraph number is only ' +
        'unambiguous together with its opinion — cite the authoring judge alongside it.';
    }
  } else if (markerTotal === 0) {
    numbering = 'absent';
    numberingNote =
      'This judgment does not number its paragraphs. Older Supreme Court Reports volumes print unnumbered ' +
      'prose with marginal letters (A–G) for pinpoint citation, so there is no paragraph number in the source ' +
      'and none has been inferred.';
  } else {
    const pct = best ? (best.coverage * 100).toFixed(1) : '0.0';
    numbering = 'ambiguous';
    numberingNote =
      `Found ${markerTotal} line-initial numeric marker(s) in the body, but they do not form a paragraph ` +
      `sequence: the longest consistent set spans only ${pct}% of the judgment, whereas real paragraph ` +
      'numbering partitions the whole of it. These markers are years, statutory clause numbers, quoted ' +
      'enactment text, or footnote references. No paragraph numbers have been inferred from position.';
  }

  const present: Record<string, boolean> = {
    paras: paras.length > 0,
    headnote: Boolean(headnote),
    held: Boolean(held),
    // No format delimits ratio/obiter, and inferring them by keyword or sentence
    // position is the guess NSP removed in FB-206. Always reported unavailable.
    ratio: false,
    obiter: false,
    facts: Boolean(facts),
    issues: Boolean(issues),
    disposition: Boolean(disposition),
    coram: coram.length > 0,
    parallelCitations: parallelCitations.length > 0,
    appealedFrom: Boolean(appealedFrom),
    // The judgment text never states where an appeal goes next; only the
    // procedural posture of a later case could establish it.
    appealedTo: false,
  };

  return {
    paras,
    numbering,
    numberingNote,
    opinions,
    extractedFields: CONTRACT_FIELDS.filter((f) => present[f]),
    unavailableFields: CONTRACT_FIELDS.filter((f) => !present[f]),
    headnote,
    held,
    facts,
    issues,
    disposition,
    coram,
    parallelCitations,
    appealedFrom,
  };
}
