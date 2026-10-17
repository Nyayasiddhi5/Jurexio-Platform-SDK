/**
 * NV-CITATOR-ATTRIBUTION-001 (2026-08-20) — bind a treatment verb to the authority it acts on.
 *
 * THE PROBLEM THIS SOLVES
 * `jrx-citator-treatment.ts` detects that adverse language EXISTS. It cannot say what the
 * language was said ABOUT. Over short retrieved passages that gap is tolerable because the
 * passage was retrieved for the authority. Over a full judgment body it is fatal: Sushila
 * Aggarwal (2020) overrules nine authorities and *relies on* Gurbaksh Singh Sibbia, all
 * within a few hundred characters. Detection alone reports "overruled" for Sibbia too.
 *
 * WHY THE ASYMMETRY DECIDES THE DESIGN
 * A false `overruled` makes a lawyer discard valid law, and — unlike a missed overruling —
 * they never find out they were wrong. A missed overruling leaves the verdict at `unknown`,
 * which the panel already renders as "not cleared": an honest non-answer. So every rule below
 * is biased towards emitting NOTHING. An unattributed treatment is not an edge, it is a miss,
 * and a miss is the cheap error.
 *
 * WHAT THE CORPUS ACTUALLY LOOKS LIKE (all observed in extracted SC bodies, 2026-08-20)
 *   • Sibbia (1980) says "the provisions of Section 438 … stand overruled … by virtue of
 *     Rule 184" — the object is a STATUTE, and no case is overruled at all.
 *   • Vodafone (2012) says "it was contended on behalf of the Revenue that … Azadi Bachao …
 *     needs to be overruled". Counsel's prayer. Vodafone approved Azadi Bachao.
 *   • Sushila Aggarwal (2018) QUOTES Mhetre holding Salauddin per incuriam. The 2018 order
 *     performs nothing; it refers the question to a larger Bench.
 *   • Aligarh Muslim University (2024) has a dissent arguing the view "demands due deference
 *     rather than … being overruled" — declining, with the verb fully present.
 *   • Gayatri Project (2025) holds a decision "cannot be termed to be per incuriam" — negated.
 * Each of those is an `overruled` edge under proximity matching and a miss under this module.
 */
import { authorityTokens, normaliseAuthorityText } from './jrx-authority-identity.js';

/** How a treatment verb was bound to an authority. `unattributed` never yields an edge. */
export type AttributionMethod =
  | 'citation-span'
  | 'case-name-span'
  | 'reporter-list-verdict'
  | 'unattributed';

/** Why an otherwise-matching adverse phrase was refused. Reported so a reader can audit us. */
export type AttributionVeto =
  | 'quoted-from-another-judgment'
  | 'counsel-submission'
  | 'hypothetical-or-conditional'
  | 'declined-to-overrule'
  | 'negated'
  | 'legislative-not-judicial'
  | 'object-is-statute-not-case'
  | 'target-is-the-overruling-court'
  | 'different-authority-is-the-object';

export interface AttributionOutcome {
  attributed: boolean;
  method: AttributionMethod;
  /** 0..1 — confidence in the BINDING, not in the law. */
  confidence: number;
  /** Present when an adverse phrase was found but deliberately refused. */
  veto?: AttributionVeto;
  /** The sentence(s) the decision was made on, so a lawyer can check our work. */
  scope: string;
}

/**
 * Indian citation shapes, widened past the extractor's three forms because SCR bodies use
 * the bracketed reporter style throughout: `[1995] 6 Suppl. SCR 556`, `[1973] SUPP. 1 S.C.R. 1`.
 *
 * The SCC alternative must NOT be prefixed with `\b`: `(` is not a word character, so there is
 * no boundary between a space and an opening paren and `\b\(` can never match. That bug shipped
 * once already in `CITATION_RE` and silently failed on `(2012) 6 SCC 613`.
 */
const CITATION_SPAN_RE =
  /(?:\(\d{4}\)\s*\d+\s*SCC\s*(?:OnLine\s*(?:SC\s*)?)?\d+|\[\d{4}\]\s*(?:\(?\d+\)?\s*)?(?:SUPP\.?|Suppl\.?)?\s*\d*\s*S\.?\s?C\.?\s?R\.?\s*\d+|\bAIR\s*\d{4}\s*[A-Z]{2,4}\s*\d+\b|\b\d{4}\s*SCC\s*OnLine\s*(?:SC\s*)?\d+\b|\b\d{4}\s*\(\d+\)\s*SCC\s*\d+\b)/gi;

/** A capitalised party-name run, the shape a case name takes when cited inline. */
const CASE_NAME_SPAN_RE =
  /\b(?:[A-Z][A-Za-z.'’&-]{1,24}\s+){0,5}[A-Z][A-Za-z.'’&-]{1,24}\s+(?:v\.?|vs\.?|versus)\s+(?:[A-Z][A-Za-z.'’&-]{1,24}(?:\s+|$)){1,6}/g;

/** Statutory references. When one of these is the object, no case was overruled. */
const STATUTE_OBJECT_RE =
  /\b(?:provisions?\s+of\s+)?(?:Section|Sections|s\.|ss\.|Rule|Rules|Article|Articles|Order|Clause|Regulation)\s*\d/i;

export interface AuthoritySpan {
  start: number;
  end: number;
  kind: 'citation' | 'case-name' | 'target-name';
  text: string;
  isTarget: boolean;
}

/*
 * Ubiquitous Indian name particles. On their own they identify nobody: matching `singh` from
 * "Gurbaksh Singh Sibbia" against "Satpal Singh v. State of Punjab" is the Kesavananda stem
 * collision in a new costume, and it produced a false `overruled` for Sibbia — the single most
 * consequential false positive available, since Sibbia is the authority Sushila Aggarwal
 * expressly relied on.
 */
const COMMON_NAME_PARTICLE: ReadonlySet<string> = new Set([
  'singh', 'kumar', 'prasad', 'devi', 'lal', 'chand', 'ram', 'nath', 'kaur',
  'bank', 'limited', 'company', 'corporation', 'authority', 'association',
  'municipal', 'development', 'construction', 'projects', 'trust',
]);

/**
 * Does `candidate` name the same authority as `target`?
 *
 * Whole-token containment via the shared tokeniser, never substring: `includes('kesavan')`
 * matches "kesavananda" and reinstates the exact bug NV-CITATOR-AUTHORITY-RESOLVE-001 fixed.
 * A candidate must carry EVERY distinctive token of the target — a lone place name is a forum,
 * not an identity.
 */
export function namesTargetAuthority(candidate: string, target: string): boolean {
  const { distinctive } = authorityTokens(target);
  if (distinctive.length === 0) return false;
  const tokens = new Set(normaliseAuthorityText(candidate).split(' ').filter(Boolean));
  return distinctive.every((t) => tokens.has(t));
}

/**
 * Locate every authority-shaped span in `text`, flagging those that name the target.
 *
 * A short-name mention ("Sibbia (supra)", "Mhetre") is how Indian judgments refer back after
 * the first full citation, so a bare distinctive token counts as a target span. That widens
 * target detection only — it never widens what counts as an ADVERSE finding, because a nearer
 * non-target span still wins in `attributeTreatment`.
 */
export function findAuthoritySpans(text: string, target: string): AuthoritySpan[] {
  const spans: AuthoritySpan[] = [];
  const push = (start: number, end: number, kind: AuthoritySpan['kind'], raw: string) => {
    spans.push({ start, end, kind, text: raw, isTarget: namesTargetAuthority(raw, target) });
  };

  CITATION_SPAN_RE.lastIndex = 0;
  for (let m = CITATION_SPAN_RE.exec(text); m; m = CITATION_SPAN_RE.exec(text)) {
    push(m.index, m.index + m[0].length, 'citation', m[0]);
  }
  CASE_NAME_SPAN_RE.lastIndex = 0;
  for (let m = CASE_NAME_SPAN_RE.exec(text); m; m = CASE_NAME_SPAN_RE.exec(text)) {
    push(m.index, m.index + m[0].length, 'case-name', m[0]);
  }

  const { distinctive } = authorityTokens(target);
  /*
   * Short-name mentions ("Sibbia (supra)", "Mhetre") are how Indian judgments refer back after
   * a full citation, so they must be findable — but a LONE token is only an identity if it is
   * long enough and not a common particle. Otherwise tokens are clustered: adjacent matches
   * within 60 characters form one mention, and the mention must cover at least half the
   * target's distinctive tokens to count.
   */
  const tokenHits: Array<{ start: number; end: number; token: string }> = [];
  for (const tok of distinctive) {
    /* Word-boundary anchored so "kesavan" cannot match inside "kesavananda" and vice versa. */
    const re = new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    for (let m = re.exec(text); m; m = re.exec(text)) {
      tokenHits.push({ start: m.index, end: m.index + m[0].length, token: tok });
    }
  }
  tokenHits.sort((a, b) => a.start - b.start);
  let cluster: typeof tokenHits = [];
  const flush = () => {
    if (cluster.length === 0) return;
    const covered = new Set(cluster.map((h) => h.token));
    const strongLone = [...covered].some((t) => t.length >= 6 && !COMMON_NAME_PARTICLE.has(t));
    if (covered.size * 2 >= distinctive.length || strongLone) {
      spans.push({
        start: cluster[0].start,
        end: cluster[cluster.length - 1].end,
        kind: 'target-name',
        text: text.slice(cluster[0].start, cluster[cluster.length - 1].end),
        isTarget: true,
      });
    }
    cluster = [];
  };
  for (const h of tokenHits) {
    if (cluster.length > 0 && h.start - cluster[cluster.length - 1].end > 60) flush();
    cluster.push(h);
  }
  flush();

  return spans.sort((a, b) => a.start - b.start);
}

/**
 * Sentence containing `at`, bounded so a page of running text cannot become one "sentence".
 *
 * Abbreviation-aware, and that is not a nicety: `v. `, `K.L. `, `Ltd. ` and `M/s. ` all end in
 * a period followed by a space. A naive split puts "Siddharam Satlingappa Mhetre v." in one
 * sentence and "State of Maharashtra … are hereby overruled" in the next, which severs the
 * authority from the verb that acts on it and turns every full-name overruling into a miss.
 */
const ABBREV_BEFORE_SPLIT = /(?:\bv|\bvs|\bLtd|\bPvt|\bNo|\bMr|\bMrs|\bMs|\bDr|\bJJ|\bJ|\bSmt|\bAnr|\bOrs|\bSCC|\bSCR|\bAIR|\bCr|\bP|\bM\/s|\b[A-Z])\.$/;

function sentenceAround(text: string, at: number, maxBack = 700, maxFwd = 700): { start: number; end: number } {
  const backFloor = Math.max(0, at - maxBack);
  const splitsAt = (i: number, mark: string): boolean => {
    if (mark !== '. ') return true;
    return !ABBREV_BEFORE_SPLIT.test(text.slice(Math.max(0, i - 6), i + 1));
  };
  let start = backFloor;
  for (const mark of ['. ', '.” ', '." ', '? ', '! ']) {
    let i = text.lastIndexOf(mark, at);
    while (i >= backFloor && !splitsAt(i, mark)) i = text.lastIndexOf(mark, i - 1);
    if (i >= backFloor && i + mark.length > start) start = i + mark.length;
  }
  const fwdCeil = Math.min(text.length, at + maxFwd);
  let end = fwdCeil;
  for (const mark of ['. ', '.” ', '." ', '? ', '! ']) {
    let i = text.indexOf(mark, at);
    while (i !== -1 && !splitsAt(i, mark)) i = text.indexOf(mark, i + 1);
    if (i !== -1 && i + mark.length < end) end = i + mark.length;
  }
  return { start, end: Math.max(end, at + 1) };
}

/**
 * Does `fragment` contain a real sentence break?
 *
 * Shares `ABBREV_BEFORE_SPLIT` with `sentenceAround` on purpose: an initial in a party name
 * ("Ashok G. Rajani") is a period followed by a capital, and a second ad-hoc abbreviation list
 * would drift out of step with the first and silently sever a reporter list group.
 */
function startsNewSentence(fragment: string): boolean {
  for (let i = fragment.indexOf('. '); i !== -1; i = fragment.indexOf('. ', i + 1)) {
    if (!/^[A-Z]/.test(fragment.slice(i + 2))) continue;
    if (ABBREV_BEFORE_SPLIT.test(fragment.slice(Math.max(0, i - 6), i + 1))) continue;
    return true;
  }
  return false;
}

/*
 * VETOES — the load-bearing half of this module.
 *
 * Each pattern marks a context in which the adverse verb is fully present in the text and yet
 * NOTHING was done to the authority. Declining-to-overrule is the most dangerous of these:
 * "demands due deference rather than the view being overruled" contains `being overruled`
 * verbatim, and a proximity matcher scores it identically to an actual overruling.
 */

/** Reported speech: the court is repeating what ANOTHER judgment or party said. */
const VETO_QUOTED: readonly RegExp[] = [
  /\bto\s+quote\b/i,
  /\bhas\s+taken\s+the\s+stand\s+that\b/i,
  /\bit\s+was\s+(?:held|observed)\s+(?:in|that)\b.*\bper\s+incuriam\b/i,
  /\bobservations?\s+(?:made\s+)?in\b[^.]{0,80}\bthat\b/i,
  /\bwherein\s+it\s+held\b/i,
  /\bthe\s+relevant\s+para\b/i,
  /\bare\s+extracted\s+as\s+under\b/i,
  /\breads\s+as\s+under\b/i,
];

/** Counsel asked for it. A prayer is not a holding. */
const VETO_SUBMISSION: readonly RegExp[] = [
  /\bit\s+was\s+contended\b/i,
  /\bcontended\s+on\s+behalf\s+of\b/i,
  /\bit\s+is\s+submitted\b/i,
  /\bsubmitted\s+that\b/i,
  /\blearned\s+(?:counsel|senior\s+counsel|Solicitor\s+General|Additional\s+Solicitor\s+General|Amicus)\b/i,
  /\bcounsel\s+(?:relied|urged|argued|submitted)\b/i,
  /\bprayed\s+that\b/i,
  /\bseeks?\s+(?:to\s+have\s+)?(?:the\s+)?(?:decision|judgment)\b[^.]{0,40}\boverrul/i,
];

/** Conditional or hypothetical. "If X were accepted, all these would stand overruled." */
const VETO_HYPOTHETICAL: readonly RegExp[] = [
  /\bif\b[^.]{0,120}\bwould\s+(?:stand\s+)?(?:be\s+)?overrul/i,
  /\bwere\s+(?:to\s+be\s+)?accepted\b/i,
  /\bmay\s+(?:have\s+to\s+)?be\s+overruled\b/i,
  /\bcould\s+(?:well\s+)?(?:be\s+)?(?:overrul|doubt)/i,
  /\bwhether\b[^.]{0,120}\b(?:overrul|per\s+incuriam)/i,
  /\bneeds?\s+to\s+be\s+overruled\b/i,
  /\bshould\s+be\s+overruled\b/i,
];

/**
 * Declining to overrule. The phrase is present in full; the holding is the opposite.
 * This is the single most dangerous false positive in the whole design, because the reader
 * has no way to tell it apart from a real overruling except by reading the sentence.
 */
const VETO_DECLINED: readonly RegExp[] = [
  /\b(?:no|not\s+any)\s+reason\s+to\s+overrule\b/i,
  /\bdeclin(?:e|ed|ing)\s+to\s+overrule\b/i,
  /\brefuse[ds]?\s+to\s+overrule\b/i,
  /\brather\s+than\b[^.]{0,60}\bbeing\s+overruled\b/i,
  /\bdemands?\s+due\s+deference\b/i,
  /\bdo(?:es)?\s+not\s+(?:call\s+for|warrant|require)\b[^.]{0,40}\boverrul/i,
  /\bneed\s+not\s+be\s+overruled\b/i,
  /\bwe\s+see\s+no\s+(?:reason|justification)\b[^.]{0,60}\boverrul/i,
];

/** Direct negation of the adverse finding. */
const VETO_NEGATED: readonly RegExp[] = [
  /\bcannot\s+be\s+(?:termed|treated|said)\s+(?:to\s+be\s+|as\s+)?per\s+incuriam\b/i,
  /\bnot\s+per\s+incuriam\b/i,
  /\bwould\s+not\s+render\s+it\s+per\s+incuriam\b/i,
  /\bis\s+not\s+overruled\b/i,
  /\bhas\s+not\s+been\s+overruled\b/i,
  /\bstands?\s+(?:un|not\s+)overruled\b/i,
  /\bnever\s+been\s+(?:doubted|overruled)\b/i,
];

/** The legislature superseded it. Real, but it is not a judicial treatment edge. */
const VETO_LEGISLATIVE: readonly RegExp[] = [
  /\blegislatively\s+overruled\b/i,
  /\boverruled\s+by\s+(?:the\s+)?(?:Amendment|Act|statute|Parliament|Legislature)\b/i,
];

function anyMatch(text: string, pats: readonly RegExp[]): boolean {
  return pats.some((re) => re.test(text));
}

/** Markers that OPEN a quotation of another judgment's reasoning. */
const QUOTE_OPENER_RE = /(?:\bTo\s+quote\b|\bare\s+extracted\s+as\s+under\b|\breads?\s+as\s+under\b|\bthe\s+relevant\s+para(?:graph)?s?\b[^.]{0,40}\b(?:reads|are)\b|\bobserved\s+as\s+under\b|\bheld\s+as\s+under\b)[\s:—–-]*[“"]?/gi;

/**
 * Is `at` inside a block quoted from another judgment?
 *
 * Quotation is a state with a width no window can bound — `To quote:- "123. In view of …"`
 * runs for paragraphs. So the nearest opener before `at` is found, and the veto holds unless
 * the quotation demonstrably closed before `at`: a closing curly quote, or a paragraph number
 * resuming the judgment's own numbering after the close.
 */
function insideQuotedBlock(text: string, at: number): boolean {
  QUOTE_OPENER_RE.lastIndex = 0;
  let opener = -1;
  for (let m = QUOTE_OPENER_RE.exec(text); m; m = QUOTE_OPENER_RE.exec(text)) {
    if (m.index >= at) break;
    opener = m.index + m[0].length;
  }
  if (opener === -1) return false;
  const between = text.slice(opener, at);
  /* A closing quote mark, or the judgment resuming its own numbered paragraphs, ends the
   * quotation. `xxx xxx` is the reporter's elision marker and stays INSIDE the block. */
  if (/[”"]\s*(?:\d+\.|[A-Z])/.test(between)) return false;
  return true;
}

/**
 * The reporter-style verdict list Indian SCR bodies carry near the head of a judgment:
 * `Salauddin … (1996) 1 SCC 667 : [1995] 6 Suppl. SCR 556 – overruled.`
 * `[1980] 3 SCR 383 relied on Para 3`
 *
 * This is the highest-precision signal in the corpus, because the reporter has already done
 * the attribution and states it as a table. It is also the only place a `relied on` marker can
 * clear the target: Sushila Aggarwal lists Sibbia as `relied on` in the same block where it
 * lists nine other authorities as `overruled`.
 */
const REPORTER_ADVERSE_RE = /[–—-]\s*overruled\b|\boverruled\s+Para\b|\bheld\s+not\s+good\s+law\b|\bheld\s+not\s+correct\s+law\b|\bheld\s+per\s+incuriam\b/i;
/*
 * Non-adverse markers. `distinguished` belongs here even though it is not approval: it is
 * NEUTRAL, and a neutral marker still terminates the preceding group, so an authority marked
 * `distinguished` is not swept into a neighbouring `– overruled`.
 */
const REPORTER_NON_ADVERSE_RE = /[–—-]\s*(?:relied\s+on|approved|followed|referred\s+to|distinguished|explained|reiterated)\b|\b(?:relied\s+on|referred\s+to|approved|distinguished)\s+Para\b/i;

/**
 * Decide whether an adverse phrase at `phraseIndex` in `text` is about `targetAuthority`.
 *
 * Refusing is the safe default and the common outcome. `attributed: false` means the caller
 * must emit no adverse edge and leave the verdict at `unknown` — an honest non-answer that the
 * panel already renders as "not cleared".
 */
export function attributeTreatment(input: {
  text: string;
  phraseIndex: number;
  phraseLength: number;
  targetAuthority: string;
}): AttributionOutcome {
  const { text, phraseIndex, phraseLength, targetAuthority } = input;
  const { start, end } = sentenceAround(text, phraseIndex);
  const scopeRaw = text.slice(start, end);
  const scope = scopeRaw.replace(/\s+/g, ' ').trim();
  /*
   * Frame vetoes ("To quote:", "It is submitted that") introduce a block, and the adverse verb
   * often lands a sentence later — so they read one sentence further back than the binding does.
   * They must NOT read a fixed-width window: a 900-character lookback let a counsel submission
   * veto a genuine holding three sentences later, which is a miss bought for no safety gain.
   */
  const lead = start > 0 ? sentenceAround(text, Math.max(0, start - 2)).start : 0;
  const vetoWindow = text.slice(Math.min(lead, start), Math.min(text.length, phraseIndex + phraseLength + 120));

  const refuse = (veto: AttributionVeto): AttributionOutcome => ({
    attributed: false,
    method: 'unattributed',
    confidence: 0,
    veto,
    scope,
  });

  /*
   * Quotation is a STATE, not a proximity: `To quote:- "…"` opens a block that can run for
   * paragraphs, and a two-sentence lookback loses it. So the frame markers are searched
   * backwards without a width bound, and the veto holds until the quotation closes.
   *
   * This must not be replaced by a wider fixed window: that is what let a counsel submission
   * veto a genuine holding three sentences later — a miss bought for no safety gain.
   */
  if (insideQuotedBlock(text, phraseIndex)) return refuse('quoted-from-another-judgment');

  if (anyMatch(vetoWindow, VETO_DECLINED)) return refuse('declined-to-overrule');
  if (anyMatch(vetoWindow, VETO_NEGATED)) return refuse('negated');
  if (anyMatch(vetoWindow, VETO_LEGISLATIVE)) return refuse('legislative-not-judicial');
  if (anyMatch(vetoWindow, VETO_SUBMISSION)) return refuse('counsel-submission');
  if (anyMatch(vetoWindow, VETO_QUOTED)) return refuse('quoted-from-another-judgment');
  if (anyMatch(vetoWindow, VETO_HYPOTHETICAL)) return refuse('hypothetical-or-conditional');

  /*
   * "overruled by a three-Judge Bench of this Court in Hyder Consulting" — the authority named
   * AFTER `by` is the court that DID the overruling, not the authority overruled. Binding to it
   * inverts the edge and reports a still-good authority as bad, which is the failure direction
   * that matters. Found by a unit test the gold set did not cover; the gold set had the shape
   * but with the overruled case named first, so the inversion hid behind a correct answer.
   */
  const afterPhrase = text.slice(phraseIndex, Math.min(text.length, phraseIndex + phraseLength + 160));
  const byClause = /\boverrul\w*\s+(?:by|in)\b/i.exec(afterPhrase);
  if (byClause) {
    const attributor = afterPhrase.slice(byClause.index + byClause[0].length);
    if (namesTargetAuthority(attributor.split(/[.;]/)[0] ?? '', targetAuthority)) {
      return refuse('target-is-the-overruling-court');
    }
  }

  const spans = findAuthoritySpans(text, targetAuthority);

  /*
   * Reporter verdict list. Scoped tightly (±300 chars) because these tables pack dozens of
   * authorities into a few lines, and a `relied on` marker for the target inside that window
   * is a positive clearance that must outrank a neighbouring `– overruled`.
   */
  const listWindow = text.slice(Math.max(0, phraseIndex - 300), Math.min(text.length, phraseIndex + phraseLength + 300));
  if (REPORTER_ADVERSE_RE.test(listWindow)) {
    const lo = Math.max(0, phraseIndex - 300);
    const hi = phraseIndex + phraseLength + 300;
    const targetInList = spans.filter((s) => s.isTarget && s.start >= lo && s.start <= hi);
    if (targetInList.length > 0) {
      const nearest = targetInList.reduce((a, b) =>
        Math.abs(a.start - phraseIndex) <= Math.abs(b.start - phraseIndex) ? a : b);
      /*
       * Reporter convention: a verdict marker governs every authority back to the PREVIOUS
       * marker. So the only question that matters is which marker comes first after the target
       * mention. That is what correctly reads `A; B; C – overruled.` as overruling all three,
       * while refusing `Sibbia … – relied on. Salauddin … – overruled.` for Sibbia — the
       * authority Sushila Aggarwal expressly relied on, and the false positive that would
       * matter most.
       *
       * Searching only the text BETWEEN the target and this particular adverse phrase gets that
       * backwards whenever the target's own marker sits on the far side of it.
       */
      const after = text.slice(nearest.end, Math.min(text.length, nearest.end + 320));
      const adverseAfter = after.search(REPORTER_ADVERSE_RE);
      const nonAdverseAfter = after.search(REPORTER_NON_ADVERSE_RE);
      if (adverseAfter === -1) return refuse('different-authority-is-the-object');
      if (nonAdverseAfter !== -1 && nonAdverseAfter < adverseAfter) {
        return refuse('different-authority-is-the-object');
      }
      /*
       * The intervening run must be list furniture — citations, party names, semicolons — and
       * nothing that reads like a fresh holding. A full stop starts a new sentence, at which
       * point this is prose and the list convention no longer applies.
       */
      const upToMarker = after.slice(0, adverseAfter);
      if (startsNewSentence(upToMarker)) {
        return refuse('different-authority-is-the-object');
      }
      return {
        attributed: true,
        method: 'reporter-list-verdict',
        confidence: 0.9,
        scope,
      };
    }
    return refuse('different-authority-is-the-object');
  }

  /*
   * Prose binding. Only spans in the SAME sentence count — reaching into the previous sentence
   * is where a full body starts manufacturing edges, because judgments name an authority in
   * one sentence and overrule a different one in the next.
   */
  const inScope = spans.filter((s) => s.start >= start && s.start < end);
  const targets = inScope.filter((s) => s.isTarget);
  if (targets.length === 0) return refuse('different-authority-is-the-object');

  /*
   * "the provisions of Section 438 … stand overruled … by virtue of Rule 184" — Sibbia's own
   * words. The object is a statute, no case was touched, and the target's name is in the
   * sentence only because it is the judgment being read.
   */
  const preceding = text.slice(start, phraseIndex);
  if (STATUTE_OBJECT_RE.test(preceding) && !/\b(?:decision|judgment|judgement|case|ratio|view|dictum)\b/i.test(preceding)) {
    return refuse('object-is-statute-not-case');
  }

  const others = inScope.filter((s) => !s.isTarget && s.kind !== 'target-name');
  const dist = (s: AuthoritySpan) => Math.abs(s.start - phraseIndex);
  const nearestTarget = targets.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
  if (others.length > 0) {
    const nearestOther = others.reduce((a, b) => (dist(a) <= dist(b) ? a : b));
    /*
     * A named non-target authority nearer the verb than the target is the ordinary shape of
     * "we rely on Sibbia and overrule Mhetre". Refusing here is the whole point of the module:
     * we would rather miss than assert.
     */
    if (dist(nearestOther) <= dist(nearestTarget)) return refuse('different-authority-is-the-object');
  }

  /*
   * A citation or full case-name span is a real binding. A bare short-name mention
   * ("Mhetre", "Sibbia") is weaker, so it is only trusted when no OTHER authority is named in
   * the sentence — which is the case that actually reads as "X stands overruled". Repeat
   * mentions of the target itself are not ambiguity: "Azeez Basha" contributes two token spans
   * and must not be mistaken for two competing authorities.
   */
  const method: AttributionMethod = nearestTarget.kind === 'citation'
    ? 'citation-span'
    : 'case-name-span';
  if (nearestTarget.kind === 'target-name' && others.length > 0) {
    return refuse('different-authority-is-the-object');
  }
  return {
    attributed: true,
    method,
    /* Never 1.0: binding a verb to a name is an inference about syntax, and Indian judgment
     * prose is not reliably parseable by proximity. Confidence describes the binding. */
    confidence: method === 'citation-span' ? 0.85 : 0.72,
    scope,
  };
}
