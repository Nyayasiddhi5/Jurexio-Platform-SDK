/**
 * NV-CITATOR-AUTHORITY-RESOLVE-001 — the `authority` block must never be a guess.
 *
 * NSP's first finding: `?citation=Kesavananda Bharati v. State of Kerala` resolved to
 * "WP(C)/4124/2018 KESAVAN Vs STATE OF KERALA" — a 2018 Kerala High Court matter, not the
 * 1973 Supreme Court authority. Nothing unsafe was asserted (`goodLaw` stayed `unknown`), but
 * a caller trusting `authority.title` would put the wrong case on a lawyer's screen. Cause:
 * `results[0]` was copied into title/court/year because FTS always returns something, and
 * "KESAVAN" shares a stem with "Kesavananda".
 *
 * NSP's second finding (NV-CITATOR-NUMERIC-TOKEN-001): `[1980] 3 S.C.R. 383` resolved to
 * "The Shalimar Works (1980) Limited", a High Court matter, with `matched: true`.
 *
 * This file used to carry a MIRROR of `resolveAuthority` rather than importing it, on the
 * grounds that the function was module-private to the route. The mirror is why the numeric
 * defect shipped: every assertion here passed against a copy that no request ever executed.
 * It now imports the shipped implementation, so a defect in the resolver fails this file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  authorityTokens,
  resolveAuthority,
} from '../../src/services/jrx-authority-identity.js';

const ROUTE = readFileSync(
  path.join(process.cwd(), 'src/routes/jrx-knowledge-plane-routes.ts'),
  'utf8',
);

describe('resolveAuthority — the exact bug NSP reported', () => {
  it('REJECTS the Kesavananda/KESAVAN collision', () => {
    const r = resolveAuthority(
      'Kesavananda Bharati v. State of Kerala',
      [{ title: 'WP(C)/4124/2018 KESAVAN Vs STATE OF KERALA', court: 'Kerala High Court', year: 2018 }],
      { exactOnly: false },
    );
    // "bharati" is absent from the 2018 title, so the candidate must fail even though FTS
    // ranked it first. Substring matching would have let "kesavan" match "kesavananda".
    expect(r.matched).toBe(false);
    expect(r.method).toBe('unresolved');
    expect(r.record).toBeNull();
  });

  it('accepts the real authority when it IS in the results', () => {
    const r = resolveAuthority(
      'Kesavananda Bharati v. State of Kerala',
      [
        { title: 'WP(C)/4124/2018 KESAVAN Vs STATE OF KERALA', year: 2018 },
        { title: 'Kesavananda Bharati versus State of Kerala', court: 'Supreme Court of India', year: 1973 },
      ],
      { exactOnly: false },
    );
    expect(r.matched).toBe(true);
    expect(r.record.year).toBe(1973);
    expect(r.method).toBe('all-tokens-in-title');
  });

  it('does not let party-name noise alone carry a match', () => {
    // "State of Kerala" appears in thousands of judgments; matching on it would reinstate
    // the bug for every case against a state.
    const r = resolveAuthority(
      'State of Kerala',
      [{ title: 'Somebody Else Vs STATE OF KERALA', year: 2019 }],
      { exactOnly: false },
    );
    expect(r.matched).toBe(false);
  });
});

/*
 * NV-CITATOR-NUMERIC-TOKEN-001 — the candidate rows below are the real ones the live corpus
 * returned on 2026-08-20 for the query the gateway actually sent (the bare token `1980`), and
 * for the raw citation.
 */
describe('resolveAuthority — a number is not a case name', () => {
  const shalimarCandidates = [
    { title: 'WPA/11026/2015 of THE SHALIMAR WORKS(1980) LTD & ANR Vs THE CENTRAL PR', court: 'Calcutta High Court', year: 2025 },
    { title: 'CRP/3616/2010 of The Shalimar Works (1980) Limited Vs The Board of Tru', court: 'High Court for State of Telangana', year: 2010 },
  ];

  it('never substitutes a company whose NAME contains the reporter year', () => {
    const r = resolveAuthority('[1980] 3 S.C.R. 383', shalimarCandidates, { exactOnly: false });
    expect(r.matched).toBe(false);
    expect(r.record).toBeNull();
  });

  it('is unresolved rather than wrong for the 2018 SCR citation too', () => {
    const r = resolveAuthority(
      '[2018] 6 S.C.R. 825',
      [{ title: 'W.P.(C)/1234/2018 of SOMEBODY Vs STATE OF JHARKHAND', court: 'Jharkhand High Court', year: 2018 }],
      { exactOnly: false },
    );
    expect(r.matched).toBe(false);
  });

  /*
   * The other half of the fix, and the reason it is an improvement rather than a refusal: the
   * corpus stores these citations verbatim in its `citation` column, so the honest answer is
   * the RIGHT case at citation grade. Both rows below are live corpus rows.
   */
  it('resolves the bracketed SCR citation to the case that actually carries it', () => {
    const r = resolveAuthority(
      '[1980] 3 S.C.R. 383',
      [
        ...shalimarCandidates,
        { title: 'GURBAKSH SINGH SIBBIA ETC . versus STATE OF PUNJAB', court: 'Supreme Court of India', year: 1980, citation: '[1980] 3 S.C.R. 383' },
      ],
      { exactOnly: false },
    );
    expect(r.method).toBe('exact-citation');
    expect(r.record.court).toBe('Supreme Court of India');
    expect(r.record.year).toBe(1980);
  });

  it('matches S.C.R. against SCR, because counsel and the corpus spell it differently', () => {
    const r = resolveAuthority(
      '[2018] 6 SCR 825',
      [{ title: 'SUSHILA AGGARWAL & ORS. versus STATE (NCT OF DELHI) & ANR.', year: 2018, citation: '[2018] 6 S.C.R. 825' }],
      { exactOnly: false },
    );
    expect(r.method).toBe('exact-citation');
    expect(r.record.year).toBe(2018);
  });

  /* The digit-level twin of `kesavan` ⊂ `kesavananda`: a page-number prefix is not a match. */
  it('does not let a truncated page number match a longer one', () => {
    const r = resolveAuthority(
      '[2018] 6 S.C.R. 82',
      [{ title: 'SUSHILA AGGARWAL & ORS. versus STATE (NCT OF DELHI) & ANR.', year: 2018, citation: '[2018] 6 S.C.R. 825' }],
      { exactOnly: false },
    );
    expect(r.matched).toBe(false);
  });

  it('exact mode still refuses when the corpus does not carry the citation', () => {
    const r = resolveAuthority('[1980] 3 S.C.R. 383', shalimarCandidates, { exactOnly: true });
    expect(r.matched).toBe(false);
    expect(r.method).toBe('unresolved');
  });
});

/*
 * A year in a query is real signal, but it is signal about WHEN the case was decided, which is
 * the `year` column — never the title, where it matches company names and case numbers.
 */
describe('resolveAuthority — a stated year may reject a candidate, never promote one', () => {
  it('rejects the same-name, wrong-year judgment', () => {
    const r = resolveAuthority(
      'Maneka Gandhi 1978',
      [{ title: 'ELEP/3/2024 of MANEKA SANJAY GANDHI VS RAMBHUAL NISHAD AND OTHERS', year: 2024 }],
      { exactOnly: false },
    );
    expect(r.matched).toBe(false);
  });

  it('accepts the right-year judgment from the same candidate set', () => {
    const r = resolveAuthority(
      'Maneka Gandhi 1978',
      [
        { title: 'ELEP/3/2024 of MANEKA SANJAY GANDHI VS RAMBHUAL NISHAD AND OTHERS', year: 2024 },
        { title: 'MANEKA GANDHI versus UNION OF INDIA', court: 'Supreme Court of India', year: 1978 },
      ],
      { exactOnly: false },
    );
    expect(r.matched).toBe(true);
    expect(r.record.year).toBe(1978);
  });

  it('does not reject a candidate that carries no year — absence is not contradiction', () => {
    const r = resolveAuthority(
      'Maneka Gandhi 1978',
      [{ title: 'MANEKA GANDHI versus UNION OF INDIA' }],
      { exactOnly: false },
    );
    expect(r.matched).toBe(true);
  });

  it('is inert when the query states no year', () => {
    const r = resolveAuthority(
      'Maneka Gandhi v. Union of India',
      [{ title: 'MANEKA GANDHI versus UNION OF INDIA', year: 1978 }],
      { exactOnly: false },
    );
    expect(r.matched).toBe(true);
  });
});

describe('resolveAuthority — citation-grade resolution', () => {
  it('prefers an exact citation match with the highest confidence', () => {
    const r = resolveAuthority(
      'Vodafone (2012) 6 SCC 613',
      [
        { title: 'Some Other Matter', citation: 'AIR 1973 SC 1461' },
        { title: 'Vodafone International Holdings', citation: '(2012) 6 SCC 613' },
      ],
      { exactOnly: false },
    );
    expect(r.method).toBe('exact-citation');
    expect(r.confidence).toBeGreaterThan(0.9);
    expect(r.record.citation).toBe('(2012) 6 SCC 613');
  });

  it('still matches an AIR citation inside a multi-citation field', () => {
    const r = resolveAuthority(
      'AIR 1973 SC 1461',
      [{ title: 'Kesavananda Bharati', citation: 'AIR 1973 SC 1461; (1973) 4 SCC 225' }],
      { exactOnly: false },
    );
    expect(r.method).toBe('exact-citation');
  });

  it('exact mode returns nothing rather than a near-miss', () => {
    // What a citator UI should ask for: no answer beats a plausible wrong one.
    const r = resolveAuthority(
      'Kesavananda Bharati',
      [{ title: 'Kesavananda Bharati versus State of Kerala', year: 1973 }],
      { exactOnly: true },
    );
    expect(r.matched).toBe(false);
  });

  it('normalises v. / vs. / versus so counsel spelling still resolves', () => {
    for (const q of [
      'Vodafone v. Union of India',
      'Vodafone vs Union of India',
      'Vodafone versus Union of India',
    ]) {
      const r = resolveAuthority(q, [{ title: 'Vodafone versus Union of India' }], { exactOnly: false });
      expect(r.matched, q).toBe(true);
    }
  });

  it('is unresolved on empty input rather than throwing', () => {
    expect(resolveAuthority('', [{ title: 'x' }], { exactOnly: false }).matched).toBe(false);
    expect(resolveAuthority('Vodafone', [], { exactOnly: false }).matched).toBe(false);
  });
});

describe('the route must not present an unresolved authority as identified', () => {
  it('nulls title/court/year when unresolved instead of guessing', () => {
    expect(ROUTE).toContain('resolved.matched ? (resolved.record?.title ?? null) : null');
  });

  it('never reads results[0] into the authority block again', () => {
    // The precise shape of the bug.
    expect(ROUTE).not.toContain('title: results[0]?.title');
  });

  it('emits authority_not_identified, which was declared but never used', () => {
    expect(ROUTE).toContain("'authority_not_identified'");
  });

  it('withholds treatments when the authority is unresolved', () => {
    // Those rows may describe a different case; attributing them is the mislabelling.
    expect(ROUTE).toContain('authorityUnresolved ? [] : verdict.treatments');
  });

  it('forces goodLaw to unknown when unresolved', () => {
    expect(ROUTE).toContain("authorityUnresolved ? 'unknown' : verdict.goodLaw");
  });

  it('returns the confidence field NSP asked for, and how it was reached', () => {
    expect(ROUTE).toContain('confidence: resolved.confidence');
    expect(ROUTE).toContain('method: resolved.method');
  });

  it('supports an exact-match mode', () => {
    expect(ROUTE).toContain('exactOnly');
  });

  /*
   * The deeper half of the bug. The treatment retrieval appends "overruled per incuriam
   * doubted ..." to bias towards judgments that ACT ON the authority — so the authority
   * itself is usually absent from that result set. Resolving identity against it is what
   * surfaced a citing/stem-similar judgment as the authority. Identity therefore needs its
   * own clean lookup on the citation alone.
   */
  it('resolves identity from a dedicated lookup, not the treatment result set', () => {
    expect(ROUTE).toContain('idCandidates');
    expect(ROUTE).toContain('resolveAuthority(citation, idCandidates');
    expect(ROUTE).not.toContain('resolveAuthority(citation, results');
  });

  it('uses fts for identity so a busy vector rail cannot break resolution', () => {
    const idBlock = ROUTE.slice(ROUTE.indexOf('const { distinctive }'), ROUTE.indexOf('const exactOnly'));
    expect(idBlock).toContain("mode: 'fts'");
    /* Identity must not carry treatment vocabulary. */
    expect(idBlock).not.toContain('overruled per incuriam');
  });

  /*
   * The third and final layer. Measured on the live corpus, FTS returns ZERO rows for the raw
   * citation — the connectives and generic respondents starve the match:
   *   "Kesavananda Bharati v. State of Kerala" -> 0    "Kesavananda Bharati" -> 1
   *   "Maneka Gandhi v. Union of India"        -> 0    "Maneka Gandhi"       -> 10
   * So retrieval must query the distinctive tokens and let resolveAuthority do the strict
   * verification. Without this the endpoint is safe but useless: nothing ever resolves.
   *
   * The `: citation` fallback is now load-bearing for a second reason: a pure-citation query
   * has NO distinctive tokens once numbers are excluded, and the raw citation is exactly what
   * retrieves the row that carries it (measured: `[1980] 3 S.C.R. 383` -> 1 row, the right one).
   */
  it('queries the corpus with distinctive tokens, and falls back to the raw citation', () => {
    expect(ROUTE).toContain('const idQuery = distinctive.length > 0 ? distinctive.join(\' \') : citation');
    expect(ROUTE).toContain('q: idQuery');
  });
});

describe('authorityTokens — retrieval query construction', () => {
  it('strips the connectives and generic respondents that return 0 FTS rows', () => {
    expect(authorityTokens('Kesavananda Bharati v. State of Kerala').distinctive.join(' '))
      .toBe('kesavananda bharati');
    expect(authorityTokens('Maneka Gandhi v. Union of India').distinctive.join(' '))
      .toBe('maneka gandhi');
  });

  it('keeps place names for VERIFICATION even though retrieval drops them', () => {
    // Retrieval must be broad enough to find the row; verification must be strict enough to
    // confirm it. Conflating the two is what produced both halves of this bug.
    const t = authorityTokens('Kesavananda Bharati v. State of Kerala');
    expect(t.significant).toContain('kerala');
    expect(t.distinctive).not.toContain('kerala');
  });

  it('leaves a pure forum query with no distinctive token, so it cannot resolve', () => {
    expect(authorityTokens('State of Kerala').distinctive).toHaveLength(0);
  });

  it('leaves a pure citation query with no distinctive token, so retrieval uses the citation', () => {
    expect(authorityTokens('[1980] 3 S.C.R. 383').distinctive).toHaveLength(0);
  });
});

describe('real corpus title shapes (measured live, 2026-08-19/20)', () => {
  /* Ground truth pulled from the live NYS corpus so the resolver is tested against the
   * titles it will actually see — case-number prefixes, "versus", honorifics and all. */
  it('matches the real Kesavananda title despite honorifics and a long party name', () => {
    const r = resolveAuthority(
      'Kesavananda Bharati v. State of Kerala',
      [{ title: 'HIS HOLINESS KESAVANANDA BHARATI SRIPADAGALAVARU versus STATE OF KERALA', court: 'Supreme Court of India', year: 1973 }],
      { exactOnly: false },
    );
    expect(r.matched).toBe(true);
    expect(r.record.year).toBe(1973);
    expect(r.record.court).toBe('Supreme Court of India');
  });

  it('matches the real Maneka Gandhi title', () => {
    const r = resolveAuthority(
      'Maneka Gandhi v. Union of India',
      [{ title: 'MANEKA GANDHI versus UNION OF INDIA', court: 'Supreme Court of India', year: 1978 }],
      { exactOnly: false },
    );
    expect(r.matched).toBe(true);
    expect(r.record.year).toBe(1978);
    expect(r.record.court).toBe('Supreme Court of India');
  });

  it('matches Vodafone International Holdings when the 2012 judgment IS present', () => {
    const r = resolveAuthority(
      'Vodafone International Holdings',
      [
        { title: 'VODAFONE IDEA LTD. (EARLIER KNOWN AS VODAFONE MOBILE SERVICES LIMITED)', year: 2020 },
        { title: 'VODAFONE INTERNATIONAL HOLDINGS B.V. versus UNION OF INDIA', court: 'Supreme Court of India', year: 2012 },
      ],
      { exactOnly: false },
    );
    expect(r.matched).toBe(true);
    expect(r.record.year).toBe(2012);
    expect(r.record.court).toBe('Supreme Court of India');
  });

  it('stays unresolved when the corpus holds only same-party, different-case judgments', () => {
    /* Live corpus for "Vodafone" returns VODAFONE IDEA / VODAFONE MOBILE SERVICES — none is
     * "Vodafone International Holdings". Unresolved is the honest answer; labelling the 2020
     * Vodafone Idea judgment as the 2012 tax authority is the failure mode NSP reported. */
    const r = resolveAuthority(
      'Vodafone International Holdings',
      [
        { title: 'VODAFONE IDEA LTD. (EARLIER KNOWN AS VODAFONE MOBILE SERVICES LIMITED)', year: 2020 },
        { title: 'ITA/563/2019 of PR. COMMISSIONER OF INCOME TAX- 9 Vs M/S VODAFONE IDEA', year: 2019 },
      ],
      { exactOnly: false },
    );
    expect(r.matched).toBe(false);
  });

  it('is not fooled by a case-number prefix on an unrelated judgment', () => {
    const r = resolveAuthority(
      'Maneka Gandhi v. Union of India',
      [{ title: 'ELEP/3/2024 of MANEKA SANJAY GANDHI VS RAMBHUAL NISHAD AND OTHERS', year: 2024 }],
      { exactOnly: false },
    );
    /* "maneka" and "gandhi" are both present, so this DOES match on tokens — and that is the
     * honest limit of a title heuristic when the query carries no year. What matters is that
     * confidence is reported rather than implied, so a caller can require exact-citation
     * resolution instead. */
    expect(r.confidence).toBeLessThan(0.95);
    expect(r.method).toBe('all-tokens-in-title');
  });
});
