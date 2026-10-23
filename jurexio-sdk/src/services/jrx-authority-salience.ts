/**
 * NV-AUTHORITY-SALIENCE-001 — make "which court decided it" a ranking signal,
 * and make the *request* for a court tier a retrieval filter instead of eight
 * mandatory search terms.
 *
 * MEASURED ROOT CAUSE (live nyv_caselaw, 2026-08-20 — see CHANGELOG)
 * ------------------------------------------------------------------
 * `judgments.search_tsv` is a generated tsvector over METADATA ONLY:
 *   A = title · B = petitioner/respondent, citation/cnr/case_no · C = judges/description
 * `full_text` is a real column and is NULL for every row probed (0 non-null in
 * 50,000 SC rows), so a judgment's *significance* is nowhere in its index.
 *
 * On top of that, `searchRdsJudgments` uses `websearch_to_tsquery`, which ANDs
 * every lexeme. The reference query
 *   "Leading Supreme Court authorities on anticipatory bail for economic offences."
 * parses to
 *   'lead' & 'suprem' & 'court' & 'author' & 'anticipatori' & 'bail' & 'econom' & 'offenc'
 * and matches **0 rows in 26,259,225** — measured. Four of those eight lexemes
 * ("leading", "supreme", "court", "authorities") describe *what kind of answer
 * the lawyer wants*, not what any judgment is about, and they can never appear
 * in a title, a party name or a reporter citation. They cannot match; because
 * the operator is AND, they guarantee that nothing else matches either.
 *
 * So the FTS leg contributed nothing and the vector leg was the only source of
 * candidates. Its 30 nearest neighbours were 30 High Court bail orders and 0
 * Supreme Court rows: HC bail orders carry a populated `description` headnote
 * and case-type codes like `ABAIL/`/`ABA/` in the title, while
 * `caseEmbeddingText()` for a pre-2020 SC landmark reduces to its party names —
 * SC `description` is NULL for 42,377 of 43,505 rows, and for every single row
 * decided before 2020 bar 41. Gurbaksh Singh Sibbia therefore sits at cosine
 * distance 0.892 from the query while `ABAIL/3711/2022` sits at 0.598.
 *
 * WHY A TIER *REQUEST* SIGNAL AND NOT AN "SC IS BETTER" BOOST
 * ----------------------------------------------------------
 * Pushing Supreme Court rows up on every query would be a regression, not a
 * fix: a state-specific procedural question is *correctly* answered by a High
 * Court judgment. The signal here is symmetric and consent-based — it fires
 * only when the query itself names a tier or asks for leading authority, and it
 * then promotes **that** tier. "Kerala High Court procedure for condonation of
 * delay" promotes HC. A query naming no tier is left exactly as it was.
 *
 * WHY REPORTER-CITATION PRESENCE IS NOT A SECOND SIGNAL
 * ----------------------------------------------------
 * It was offered as one, and it is real but redundant. Measured:
 *   court_type='sc' → 43,505 rows, 43,505 with a citation (100.00%)
 *   court_type<>'sc' → 2,000,000 rows scanned, 0 with a citation (0.00%)
 * `citation IS NOT NULL` is a perfect proxy for `court_type='sc'` in this
 * corpus, so scoring both would double-weight one fact. `courtTier` is the
 * signal; `hasReporterCitation` is carried for the *honesty* check below (can
 * we hand the lawyer a reference they can look up?), never added to the score.
 */

/** Court tiers as `judgments.court_type` spells them. */
export type AuthorityTier = 'sc' | 'hc' | 'dc';

export interface AuthorityTierRequest {
  /** The tier the query asked for. */
  tier: AuthorityTier;
  /** The phrases that fired, for logs and for the context-block disclosure. */
  cues: string[];
  /**
   * The query with the tier-request phrases removed — safe to send to a
   * metadata-only AND-semantics FTS index. Never empty: falls back to the
   * original query when stripping would leave nothing to search for.
   */
  contentQuery: string;
  /** True when no tier was named and the tier was inferred from "leading"/"landmark". */
  inferred: boolean;
}

/**
 * Tier names, longest-first so "supreme court" is consumed before a bare "court".
 * These are matched AND removed, because none of them can appear in the indexed
 * metadata: `court` is not a column in `search_tsv` at all, and a title is
 * either `X versus Y` (SC) or `<CASETYPE>/<NO>/<YEAR> of X Vs Y` (HC/DC).
 */
const TIER_PHRASES: Array<{ re: RegExp; tier: AuthorityTier }> = [
  { re: /\bhon(?:'|’)?ble\s+supreme\s+court(?:\s+of\s+india)?\b/gi, tier: 'sc' },
  { re: /\bsupreme\s+court(?:\s+of\s+india)?\b/gi, tier: 'sc' },
  { re: /\bapex\s+court\b/gi, tier: 'sc' },
  { re: /\bconstitution\s+bench\b/gi, tier: 'sc' },
  { re: /\bhigh\s+court(?:s)?\b/gi, tier: 'hc' },
  { re: /\bdistrict\s+court(?:s)?\b/gi, tier: 'dc' },
  { re: /\btrial\s+court(?:s)?\b/gi, tier: 'dc' },
  // Bare abbreviations only when written as standalone capitals, so "sc" inside
  // a word and the lowercase noun "hc" in free prose cannot trigger a filter.
  { re: /(?<![A-Za-z])SC(?![A-Za-z])/g, tier: 'sc' },
  { re: /(?<![A-Za-z])HC(?![A-Za-z])/g, tier: 'hc' },
];

/**
 * A request for authority *weight* rather than a named forum. In a unitary
 * judicial hierarchy the leading authority on a point of central law is the
 * Supreme Court's, so these imply `sc` — but only when no forum is named, and
 * the resulting request is marked `inferred` so callers can weigh it as the
 * weaker inference it is.
 */
const WEIGHT_CUES =
  /\b(leading|landmark|seminal|locus\s+classicus|settled\s+law|binding\s+precedent|authoritative|governing)\b/gi;

/**
 * Bare request nouns. Stripped for the same reason as the tier names: they are
 * how a lawyer asks the question, not how a judgment describes itself.
 * `judgment`/`order`/`held` are deliberately NOT here — those DO occur in the
 * `description` headnotes that weight C indexes, so removing them would cost
 * real recall.
 */
const REQUEST_NOUNS =
  /\b(authorit(?:y|ies)|precedents?|case\s*law|caselaw|jurisprudence)\b/gi;

/** Filler left behind once the phrases above are removed. */
const DANGLING = /\b(on|of|for|the|about|regarding|in|to|and|please|list|cite|give|me|what|are|is)\b/gi;

/**
 * Does this query explicitly ask for a court tier? Returns `null` when it does
 * not, or when it names more than one tier — an ambiguous request must add no
 * signal rather than guess which forum the lawyer meant.
 */
export function detectAuthorityTierRequest(query: string): AuthorityTierRequest | null {
  const q = String(query ?? '');
  if (!q.trim()) return null;

  const named = new Set<AuthorityTier>();
  const cues: string[] = [];
  for (const { re, tier } of TIER_PHRASES) {
    const found = q.match(new RegExp(re.source, re.flags));
    if (found && found.length > 0) {
      named.add(tier);
      cues.push(found[0]);
    }
  }

  // Two different forums named: we cannot tell which one is being requested.
  if (named.size > 1) return null;

  const weight = q.match(WEIGHT_CUES);
  let tier: AuthorityTier | null = null;
  let inferred = false;
  if (named.size === 1) {
    [tier] = [...named];
  } else if (weight && weight.length > 0) {
    tier = 'sc';
    inferred = true;
  }
  if (!tier) return null;
  if (weight) cues.push(...weight);

  return { tier, cues, contentQuery: stripTierRequestTerms(q), inferred };
}

/**
 * Remove the phrases that were just turned into a tier filter, so the remaining
 * lexemes are all things a judgment's indexed metadata could actually contain.
 *
 * Returns the ORIGINAL query when stripping would leave fewer than two content
 * words: a filter is worth having, an empty search is not.
 */
export function stripTierRequestTerms(query: string): string {
  const original = String(query ?? '');
  let out = original;
  for (const { re } of TIER_PHRASES) out = out.replace(new RegExp(re.source, re.flags), ' ');
  out = out.replace(WEIGHT_CUES, ' ').replace(REQUEST_NOUNS, ' ');
  out = out.replace(DANGLING, ' ');
  out = out.replace(/[^\p{L}\p{N}\s§().'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const words = out.split(' ').filter((w) => w.replace(/[^\p{L}\p{N}]/gu, '').length > 1);
  return words.length >= 2 ? words.join(' ') : original;
}

/**
 * How many rank positions a chunk of the requested tier is credited.
 *
 * Deliberately a small, bounded, *interpretable* number rather than a score
 * multiplier: "the lawyer named a forum, that is worth three places". A
 * strongly-ranked chunk from another tier can still out-rank a weak one from
 * the requested tier, which is what stops this from becoming the blanket
 * "SC first, always" that would regress every state-procedure question. An
 * inferred tier (from "leading"/"landmark" with no forum named) gets less.
 */
export const TIER_RANK_CREDIT = 3;
export const INFERRED_TIER_RANK_CREDIT = 2;

export function tierRankCredit(request: AuthorityTierRequest): number {
  return request.inferred ? INFERRED_TIER_RANK_CREDIT : TIER_RANK_CREDIT;
}

/**
 * The minimum a chunk must expose to be ranked by salience. Declared
 * structurally rather than importing `AutoRagChunk` so this module stays a leaf
 * — the router imports it, not the other way round.
 */
export interface SalienceRankable {
  courtTier?: AuthorityTier;
  hasReporterCitation?: boolean;
}

/**
 * Reorder a already-ranked list by crediting chunks of the requested tier a
 * fixed number of rank positions.
 *
 * Properties this function must keep, each asserted by a test that fails when
 * the property is removed:
 *   • It is a permutation — nothing is added, dropped or rewritten.
 *   • With no request it is the identity.
 *   • It is stable within a tier, so it cannot scramble the cross-encoder's
 *     relative judgement among equally-eligible authorities.
 *   • The credit is bounded, so a chunk ranked `credit + 1` places below a
 *     requested-tier chunk still keeps its place.
 */
export function applyTierSalience<T extends SalienceRankable>(
  ranked: readonly T[],
  request: AuthorityTierRequest | null,
): T[] {
  if (!request || ranked.length < 2) return [...ranked];
  const credit = tierRankCredit(request);
  return ranked
    .map((chunk, index) => ({
      chunk,
      index,
      effective: chunk.courtTier === request.tier ? index - credit : index,
    }))
    .sort((a, b) => (a.effective - b.effective) || (a.index - b.index))
    .map((x) => x.chunk);
}

export interface AuthorityGap {
  /** True when the query asked for a tier and nothing of that tier was delivered. */
  unmet: boolean;
  /** Requested-tier chunks that also carry a reporter citation. */
  citableCount: number;
  /** Requested-tier chunks delivered at all. */
  tierCount: number;
}

/**
 * Did the delivered set actually answer the tier request?
 *
 * This is the "say less" half of the fix. The overlay already forbids inventing
 * a citation; presenting four routine High Court bail orders in answer to
 * "leading Supreme Court authorities" is the adjacent failure — nothing is
 * fabricated, yet the lawyer is shown irrelevant material in the slot where the
 * governing authority belongs. The caller renders this into the context block so
 * the model states the gap instead of dressing the gap up.
 */
export function assessAuthorityGap<T extends SalienceRankable>(
  delivered: readonly T[],
  request: AuthorityTierRequest | null,
): AuthorityGap | null {
  if (!request) return null;
  const ofTier = delivered.filter((c) => c.courtTier === request.tier);
  const citable = ofTier.filter((c) => c.hasReporterCitation === true);
  return {
    unmet: ofTier.length === 0,
    citableCount: citable.length,
    tierCount: ofTier.length,
  };
}

const TIER_LABEL: Record<AuthorityTier, string> = {
  sc: 'Supreme Court',
  hc: 'High Court',
  dc: 'District / trial court',
};

export function describeAuthorityTier(tier: AuthorityTier): string {
  return TIER_LABEL[tier];
}

export interface ResolvedAuthoritySalience<T> {
  /** The list after the bounded tier-rank credit. Identity when no tier asked. */
  ranked: T[];
  /** The detected request, or null when the query named no tier. */
  request: AuthorityTierRequest | null;
  /** The gap assessment over `ranked`, or null when no tier was asked. */
  gap: AuthorityGap | null;
  /** True when the credit actually changed the order — telemetry, not policy. */
  reordered: boolean;
}

/**
 * The whole salience step, from raw prompt to reordered list plus disclosure.
 *
 * Exists as one function because the caller previously derived the tier request
 * from a NETWORK HOP's return value, which made the disclosure conditional on
 * that hop succeeding — so the one case the disclosure exists for ("you asked
 * for Supreme Court authority and retrieval found none") was the case that could
 * not render it. Detection is pure regex over the prompt, so it belongs here,
 * beside the ranking it drives, where a unit test can reach it.
 */
export function resolveAuthoritySalience<T extends SalienceRankable & { id?: string }>(
  query: string,
  ranked: readonly T[],
): ResolvedAuthoritySalience<T> {
  const request = detectAuthorityTierRequest(query);
  if (!request) return { ranked: [...ranked], request: null, gap: null, reordered: false };
  const before = ranked.map((c) => c.id ?? '').join('|');
  const after = applyTierSalience(ranked, request);
  return {
    ranked: after,
    request,
    gap: assessAuthorityGap(after, request),
    reordered: before !== after.map((c) => c.id ?? '').join('|'),
  };
}
