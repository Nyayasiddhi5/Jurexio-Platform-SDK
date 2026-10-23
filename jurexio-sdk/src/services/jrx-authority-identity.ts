/**
 * NV-CITATOR-ATTRIBUTION-001 (2026-08-20) — canonical authority-identity helpers.
 *
 * WHY THIS FILE EXISTS
 * `src/routes/jrx-knowledge-plane-routes.ts` grew a private copy of these helpers when
 * NV-CITATOR-AUTHORITY-RESOLVE-001 fixed NSP's `kesavan` ⊂ `kesavananda` mislabelling. The
 * attribution step needs exactly the same notion of "is this string naming that authority",
 * and writing a second name-matcher is how the two drift apart until one of them reinstates
 * the stem collision (NV-NO-DUPLICATE-001).
 *
 * NV-CITATOR-NUMERIC-TOKEN-001 (2026-08-20) retired that duplicate: the route now imports
 * from here and declares nothing of its own, so the two definitions can no longer disagree.
 * `resolveAuthority` moved here with them, because a resolver that does not share the
 * tokeniser it verifies with is the same defect wearing a different name.
 */

/** Party-name noise that matches almost every Indian judgment and so verifies nothing. */
export const AUTHORITY_STOP: ReadonlySet<string> = new Set([
  'state', 'union', 'india', 'of', 'the', 'and', 'anr', 'ors', 'others',
  'another', 'in', 're', 'ltd', 'pvt', 'co', 'v',
]);

/*
 * Place names identify a FORUM, not an authority. "Kerala" alone matches every case against
 * that state, so a query whose only significant token is a place must stay unresolved —
 * otherwise the Kesavananda bug returns in a different costume for every state respondent.
 * A distinctive party name ("Vodafone") is sufficient on its own; a state name never is.
 */
export const AUTHORITY_PLACE_ONLY: ReadonlySet<string> = new Set([
  'kerala', 'delhi', 'maharashtra', 'karnataka', 'gujarat', 'punjab', 'haryana',
  'rajasthan', 'bengal', 'bihar', 'orissa', 'odisha', 'assam', 'telangana', 'andhra',
  'pradesh', 'tamil', 'nadu', 'madras', 'bombay', 'calcutta', 'madhya', 'uttar',
  'himachal', 'jharkhand', 'chhattisgarh', 'uttarakhand', 'manipur', 'tripura',
  'meghalaya', 'nagaland', 'mizoram', 'sikkim', 'arunachal', 'jammu', 'kashmir',
  'ladakh', 'puducherry', 'chandigarh', 'gauhati', 'allahabad', 'patna', 'ranchi',
  'cuttack', 'jaipur', 'jodhpur', 'lucknow', 'nagpur', 'aurangabad', 'ernakulam',
  'hyderabad', 'bengaluru', 'bangalore', 'ahmedabad', 'mumbai', 'kolkata', 'chennai',
]);

export function normaliseAuthorityText(s: string): string {
  return String(s || '')
    .toLowerCase()
    /* Indian corpus titles use "versus"; counsel type "v." / "vs." */
    .replace(/\b(?:vs?|versus)\.?\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `significant` — everything worth verifying against a title (includes place names).
 * `distinctive` — party names only, which is what FTS can actually retrieve on.
 *
 * NV-CITATOR-NUMERIC-TOKEN-001 — a pure number is never a party name, and in a citation it is
 * the reporter's volume/year/page, which belongs to the `citation` and `year` columns and not
 * to a title. Matching one against a title is how `[1980] 3 S.C.R. 383` resolved to
 * "The Shalimar Works (1980) Limited" — a 2010 Telangana High Court matter that happens to
 * carry 1980 in its company name — and reported `matched: true` for it. Years are not
 * discarded: `citationYears` reads them and `resolveAuthority` checks them against the
 * candidate's `year` column, which is where a year is actually comparable.
 */
export function authorityTokens(q: string): { significant: string[]; distinctive: string[] } {
  const significant = normaliseAuthorityText(q)
    .split(' ')
    .filter((t) => t.length >= 4 && !AUTHORITY_STOP.has(t) && !/^\d+$/.test(t));
  return {
    significant,
    distinctive: significant.filter((t) => !AUTHORITY_PLACE_ONLY.has(t)),
  };
}

/** Below this, a four-digit number in a legal query is a case or section number, not a year. */
const EARLIEST_PLAUSIBLE_YEAR = 1800;

/**
 * Four-digit numbers in the query that could be years, in citation or free-text form.
 *
 * Bounded at both ends deliberately: an Indian case number ("WP(C)/4124/2018") contributes
 * 4124, which is not a year, and a typo must not become a filter that rejects the whole corpus.
 */
export function citationYears(q: string): number[] {
  const ceiling = new Date().getUTCFullYear() + 1;
  const seen = new Set<number>();
  for (const m of String(q || '').match(/\b\d{4}\b/g) ?? []) {
    const y = Number(m);
    if (y >= EARLIEST_PLAUSIBLE_YEAR && y <= ceiling) seen.add(y);
  }
  return [...seen];
}

/**
 * Reporter citation forms the corpus indexes verbatim in its `citation` column.
 *
 * The bracketed Supreme Court Reports form is here because it is what the corpus actually
 * stores — measured live: `[1980] 3 S.C.R. 383` and `[2018] 6 S.C.R. 825` each retrieve
 * exactly one row, the right one. Without it those citations fell through to the token path,
 * which is where the wrong-case substitution happened.
 */
export const CITATION_RE_LOOSE =
  /(?:[[(]\s*\d{4}\s*[\])]\s*\d+\s*S\.?\s*C\.?\s*R\.?\s*\d+|\(\d{4}\)\s*\d+\s*SCC\s*\d+|\bAIR\s*\d{4}\s*[A-Z]{2,4}\s*\d+\b|\b\d{4}\s*SCC\s*OnLine\s*[A-Za-z]+\s*\d+\b)/i;

/**
 * A citation as a comparable token sequence, with runs of single letters glued back together.
 *
 * The corpus writes `[1980] 3 S.C.R. 383`; counsel type `[1980] 3 SCR 383`. Flattening
 * punctuation alone leaves `s c r` against `scr`, so the two never match. Comparing sequences
 * rather than substrings also stops `[2018] 6 S.C.R. 82` from matching `[2018] 6 S.C.R. 825` —
 * the digit-level twin of the `kesavan` ⊂ `kesavananda` collision.
 */
export function citationTokens(s: string): string[] {
  const out: string[] = [];
  let initials = '';
  for (const t of String(s || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (!t) continue;
    if (t.length === 1 && /[a-z]/.test(t)) {
      initials += t;
      continue;
    }
    if (initials) {
      out.push(initials);
      initials = '';
    }
    out.push(t);
  }
  if (initials) out.push(initials);
  return out;
}

function containsSequence(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    let all = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

export interface AuthorityResolution {
  matched: boolean;
  confidence: number;
  method: 'exact-citation' | 'all-tokens-in-title' | 'unresolved';
  record: any | null;
}

/**
 * NV-CITATOR-AUTHORITY-RESOLVE-001 (2026-08-19) — is the top hit actually the authority asked for?
 *
 * NSP found this: `?citation=Kesavananda Bharati v. State of Kerala` resolved to
 * "WP(C)/4124/2018 KESAVAN Vs STATE OF KERALA" — a 2018 Kerala High Court matter, not the
 * 1973 Supreme Court authority. Nothing unsafe was ASSERTED (`goodLaw` was `unknown`), but a
 * caller that trusted the `authority` block would mislabel the case on screen, and the first
 * FTS hit was being copied into `title`/`court`/`year` with no check that it matched.
 *
 * The root cause was structural: the endpoint took `results[0]` as the authority because FTS
 * always returns *something*. "KESAVAN" shares a stem with "Kesavananda", so a fuzzy hit
 * outranked the real judgment.
 *
 * So resolution is now scored and reported rather than assumed:
 *   • an exact citation match (the caller gave a real citation) is the strongest signal;
 *   • otherwise every significant token of the query must appear as a WHOLE token in the
 *     candidate title — "kesavananda" is not "kesavan", so stem collisions are rejected;
 *   • a year stated in the query must not contradict the candidate's `year` column;
 *   • when nothing clears the bar we return `matched: false`, leave title/court/year NULL
 *     rather than guessing, and the caller emits `unknownReason: 'authority_not_identified'`.
 *
 * `exact=true` lets a caller demand citation-grade resolution and get nothing rather than a
 * near-miss — which is what a citator UI should ask for.
 */
export function resolveAuthority(
  query: string,
  results: any[],
  opts: { exactOnly: boolean },
): AuthorityResolution {
  const q = String(query || '').trim();
  const unresolved = { matched: false, confidence: 0, method: 'unresolved' as const, record: null };
  if (!q || results.length === 0) return unresolved;

  /* 1. Exact citation. If the caller supplied a citation and a record carries it, that is
   *    unambiguous and needs no token heuristics. */
  const qCite = CITATION_RE_LOOSE.exec(q)?.[0];
  if (qCite) {
    const wanted = citationTokens(qCite);
    const hit = results.find((r) => containsSequence(citationTokens(r?.citation ?? ''), wanted));
    if (hit) return { matched: true, confidence: 0.95, method: 'exact-citation', record: hit };
  }

  if (opts.exactOnly) return unresolved;

  /*
   * 2. Every significant token of the query must be present in the title.
   *
   * Requiring ALL tokens is what rejects the Kesavananda/KESAVAN collision: "bharati" is
   * absent from the 2018 Kerala title, so the candidate fails even though FTS ranked it
   * first. Party-name noise ("state", "union", "of") is dropped because it matches almost
   * every Indian judgment and would otherwise carry a false positive over the bar.
   */
  const { significant, distinctive } = authorityTokens(q);
  if (significant.length === 0) return unresolved;
  /* Needs at least one token that actually names a party, not just a forum. */
  if (distinctive.length === 0) return unresolved;

  const wantedYears = citationYears(q);

  for (const r of results) {
    const title = normaliseAuthorityText(r?.title ?? '');
    if (!title) continue;
    /* Whole-token containment, not substring: `includes('kesavan')` would match
     * "kesavananda" and reinstate the very bug this fixes. */
    const titleTokens = new Set(title.split(' '));
    if (!significant.every((t) => titleTokens.has(t))) continue;
    /*
     * A stated year is real signal, but only against the `year` column — never against the
     * title, where it matches company names and case numbers. It can only REJECT: "Maneka
     * Gandhi 1978" must not resolve to the 2024 Maneka Sanjay Gandhi election matter whose
     * party tokens all match. A candidate with no usable year is not rejected, because
     * absence of a year is absence of evidence.
     */
    const candidateYear = Number(r?.year);
    if (
      wantedYears.length > 0 &&
      Number.isFinite(candidateYear) &&
      candidateYear > 0 &&
      !wantedYears.includes(candidateYear)
    ) {
      continue;
    }
    /* Confidence caps below the exact-citation path: a title match is strong but a corpus
     * can hold two judgments between the same parties. */
    return {
      matched: true,
      confidence: significant.length >= 2 ? 0.8 : 0.6,
      method: 'all-tokens-in-title',
      record: r,
    };
  }
  return unresolved;
}
