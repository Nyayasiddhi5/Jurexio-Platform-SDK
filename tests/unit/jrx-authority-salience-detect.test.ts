/**
 * NV-AUTHORITY-SALIENCE-001 — tier-request DETECTION, term stripping, and the
 * "say less" gap disclosure.
 *
 * The stripping half is the actual root-cause fix and is worth stating plainly:
 * `judgments.search_tsv` is a generated tsvector over METADATA ONLY (title,
 * parties, reporter citation, judges, headnote) and `full_text` is NULL for all
 * 26,259,225 rows. `searchRdsJudgments` uses `websearch_to_tsquery`, which ANDs
 * every lexeme. So "Supreme Court", "leading" and "authorities" are not merely
 * unhelpful — they are unmatchable, and because the operator is AND they
 * guarantee that nothing else matches either. A metadata-only index cannot
 * surface a landmark by what it decided; stripping the words that describe the
 * *shape of the answer wanted* is what makes the FTS leg non-empty at all.
 *
 * The gap half exists because the adjacent failure to fabricating a citation is
 * presenting four routine High Court bail orders in the slot where the governing
 * authority belongs. Nothing is invented, and the lawyer is still misled.
 */
import { describe, it, expect } from 'vitest';
import {
  assessAuthorityGap,
  describeAuthorityTier,
  detectAuthorityTierRequest,
  resolveAuthoritySalience,
  stripTierRequestTerms,
  type AuthorityTier,
  type AuthorityTierRequest,
} from '../../src/services/jrx-authority-salience.js';

const REFERENCE_QUERY = 'Leading Supreme Court authorities on anticipatory bail for economic offences.';

describe('detectAuthorityTierRequest — named forums', () => {
  it('detects the production reference query as a named (not inferred) SC request', () => {
    const req = detectAuthorityTierRequest(REFERENCE_QUERY);
    expect(req).not.toBeNull();
    expect(req!.tier).toBe('sc');
    // "Supreme Court" is named outright, so this must NOT be the weaker
    // inference drawn from the word "leading".
    expect(req!.inferred).toBe(false);
    expect(req!.cues.join(' ').toLowerCase()).toContain('supreme court');
  });

  it.each<[string, AuthorityTier]>([
    ['Kerala High Court procedure for condonation of delay', 'hc'],
    ['what did the apex court hold on Article 21', 'sc'],
    ['constitution bench ruling on basic structure', 'sc'],
    ['district court jurisdiction for a money suit', 'dc'],
    ['trial court power to summon an additional accused', 'dc'],
  ])('detects %s as tier=%s', (query, tier) => {
    expect(detectAuthorityTierRequest(query)?.tier).toBe(tier);
  });

  it('detects a bare standalone SC abbreviation but not "sc" inside a word', () => {
    expect(detectAuthorityTierRequest('SC ruling on anticipatory bail')?.tier).toBe('sc');
    // "escrow" and "disclosure" both contain the letters; neither names a forum.
    expect(detectAuthorityTierRequest('escrow disclosure obligations in a share purchase')).toBeNull();
  });
});

describe('detectAuthorityTierRequest — the deliberate nulls', () => {
  it('returns null when two different forums are named', () => {
    // An ambiguous request must add NO signal rather than guess a forum. If this
    // guessed, "compare Supreme Court and High Court views" would silently
    // suppress half of what the lawyer explicitly asked to compare.
    expect(detectAuthorityTierRequest('Supreme Court and High Court views on anticipatory bail')).toBeNull();
    expect(detectAuthorityTierRequest('does the High Court or the district court hear this appeal')).toBeNull();
  });

  it('returns null on an ambiguous forum pair EVEN WHEN a weight cue is present', () => {
    // This is the only case in which the `named.size > 1` guard is observable,
    // and it was found by mutation: with the guard deleted, the two assertions
    // above still passed, because with no weight cue the function falls through
    // to `if (!tier) return null` anyway. Add "leading" and the guard becomes
    // load-bearing — without it, a query that explicitly asks about BOTH forums
    // is silently rewritten into an inferred Supreme-Court-only request, and the
    // High Court half of the comparison the lawyer asked for is demoted.
    expect(
      detectAuthorityTierRequest('leading Supreme Court and High Court authorities on anticipatory bail'),
    ).toBeNull();
    expect(
      detectAuthorityTierRequest('landmark decisions of the apex court and the trial court on framing of charge'),
    ).toBeNull();
  });

  it('returns null when no forum and no weight cue appear', () => {
    expect(detectAuthorityTierRequest('anticipatory bail for economic offences')).toBeNull();
    expect(detectAuthorityTierRequest('What does Section 138 of the Negotiable Instruments Act provide?')).toBeNull();
  });

  it('returns null for empty and whitespace-only input', () => {
    expect(detectAuthorityTierRequest('')).toBeNull();
    expect(detectAuthorityTierRequest('   ')).toBeNull();
  });

  it('infers SC from a weight cue alone, and marks it inferred', () => {
    const req = detectAuthorityTierRequest('landmark judgments on the basic structure doctrine');
    expect(req?.tier).toBe('sc');
    expect(req?.inferred).toBe(true);
  });

  it('does not mark a request inferred when a forum is named alongside a weight cue', () => {
    // "leading" + "High Court" must promote HC, not SC. A weight cue is only an
    // SC inference in the ABSENCE of a named forum.
    const req = detectAuthorityTierRequest('leading High Court authorities on delay condonation');
    expect(req?.tier).toBe('hc');
    expect(req?.inferred).toBe(false);
  });
});

describe('stripTierRequestTerms', () => {
  it('removes the unmatchable request words from the reference query', () => {
    const stripped = stripTierRequestTerms(REFERENCE_QUERY);
    for (const dead of ['supreme', 'court', 'leading', 'authorities']) {
      expect(stripped.toLowerCase()).not.toContain(dead);
    }
    // …and keeps every word a judgment's indexed metadata could actually carry.
    expect(stripped.toLowerCase()).toContain('anticipatory');
    expect(stripped.toLowerCase()).toContain('bail');
    expect(stripped.toLowerCase()).toContain('economic');
  });

  it('keeps the jurisdiction-bearing words on a state procedural query', () => {
    // "Kerala" is the highest-value token here: it appears in HC titles and is
    // exactly what makes the answer state-specific. Stripping the forum name
    // must not take the state with it.
    const stripped = stripTierRequestTerms('Kerala High Court procedure for condonation of delay in filing a first appeal');
    expect(stripped.toLowerCase()).toContain('kerala');
    expect(stripped.toLowerCase()).toContain('condonation');
    expect(stripped.toLowerCase()).not.toContain('high court');
  });

  it('never returns empty — falls back to the original query', () => {
    // A filter is worth having; an empty search is not. Every one of these
    // strips down to nothing (or to a single stray token).
    for (const q of ['Supreme Court', 'leading authorities', 'the apex court precedents', 'SC case law']) {
      const stripped = stripTierRequestTerms(q);
      expect(stripped.trim()).not.toBe('');
      expect(stripped).toBe(q);
    }
  });

  it('is a no-op on a query with nothing to strip', () => {
    const q = 'anticipatory bail economic offences';
    expect(stripTierRequestTerms(q)).toBe(q);
  });

  it('preserves statutory section markers', () => {
    // `§` and digits survive the punctuation scrub, because a section number is
    // the single most locatable thing a statute query carries.
    const stripped = stripTierRequestTerms('leading authorities on § 438 CrPC anticipatory bail');
    expect(stripped).toContain('438');
  });

  it('handles null and undefined without throwing', () => {
    expect(() => stripTierRequestTerms(undefined as unknown as string)).not.toThrow();
    expect(() => stripTierRequestTerms(null as unknown as string)).not.toThrow();
  });
});

describe('assessAuthorityGap — the "say less" disclosure', () => {
  const sc = (id: string, citable: boolean) =>
    ({ id, courtTier: 'sc' as AuthorityTier, hasReporterCitation: citable });
  const hc = (id: string) => ({ id, courtTier: 'hc' as AuthorityTier, hasReporterCitation: false });
  const request: AuthorityTierRequest = {
    tier: 'sc', cues: ['Supreme Court'], contentQuery: 'anticipatory bail', inferred: false,
  };

  it('reports unmet when the requested tier is entirely absent', () => {
    // This is the production defect verbatim: four routine HC bail orders
    // delivered against a request for leading Supreme Court authority.
    const gap = assessAuthorityGap([hc('a'), hc('b'), hc('c'), hc('d')], request);
    expect(gap).toEqual({ unmet: true, tierCount: 0, citableCount: 0 });
  });

  it('reports met, and counts how many can actually be looked up', () => {
    const gap = assessAuthorityGap([sc('s1', true), sc('s2', false), hc('h1')], request);
    expect(gap!.unmet).toBe(false);
    expect(gap!.tierCount).toBe(2);
    expect(gap!.citableCount).toBe(1);
  });

  it('separates "retrieved" from "citable" — tier present but nothing locatable', () => {
    const gap = assessAuthorityGap([sc('s1', false), sc('s2', false)], request);
    expect(gap!.unmet).toBe(false);
    expect(gap!.tierCount).toBe(2);
    expect(gap!.citableCount).toBe(0);
  });

  it('returns null when no tier was requested, so the note stays silent', () => {
    expect(assessAuthorityGap([hc('a')], null)).toBeNull();
  });

  it('reports unmet on an empty delivered set', () => {
    expect(assessAuthorityGap([], request)).toEqual({ unmet: true, tierCount: 0, citableCount: 0 });
  });
});

describe('describeAuthorityTier', () => {
  it('renders a label a lawyer would recognise for every tier', () => {
    expect(describeAuthorityTier('sc')).toBe('Supreme Court');
    expect(describeAuthorityTier('hc')).toBe('High Court');
    expect(describeAuthorityTier('dc')).toContain('court');
  });
});

describe('resolveAuthoritySalience — the prompt is the only input', () => {
  const hc = (id: string) => ({ id, courtTier: 'hc' as AuthorityTier, hasReporterCitation: false });
  const sc = (id: string, citable = true) =>
    ({ id, courtTier: 'sc' as AuthorityTier, hasReporterCitation: citable });

  it('derives the request, the reorder and the gap from the query alone', () => {
    // Found by mutation M11: the caller used to read the tier request off a
    // NETWORK HOP's result, so when retrieval failed the disclosure went silent —
    // exactly when it was needed. Nothing here touches I/O.
    const out = resolveAuthoritySalience(REFERENCE_QUERY, [hc('a'), hc('b'), hc('c'), hc('d')]);
    expect(out.request?.tier).toBe('sc');
    expect(out.gap).toEqual({ unmet: true, tierCount: 0, citableCount: 0 });
  });

  it('reports the gap as unmet on an EMPTY retrieval — the hop-failed case', () => {
    // NYS 503 "corpus is busy", a timeout, or an open circuit breaker all land
    // here. The lawyer asked for Supreme Court authority; we must still be able
    // to say that none was retrieved.
    const out = resolveAuthoritySalience(REFERENCE_QUERY, []);
    expect(out.request?.tier).toBe('sc');
    expect(out.gap?.unmet).toBe(true);
    expect(out.reordered).toBe(false);
  });

  it('is the identity, with no request and no gap, when no tier is named', () => {
    const ranked = [hc('a'), sc('b'), hc('c')];
    const out = resolveAuthoritySalience('anticipatory bail for economic offences', ranked);
    expect(out.request).toBeNull();
    expect(out.gap).toBeNull();
    expect(out.reordered).toBe(false);
    expect(out.ranked.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('reports reordered=true only when the credit actually moved something', () => {
    const moved = resolveAuthoritySalience(REFERENCE_QUERY, [hc('a'), hc('b'), hc('c'), sc('d')]);
    expect(moved.reordered).toBe(true);
    // Already top of the list: the credit changes nothing, and says so.
    const unmoved = resolveAuthoritySalience(REFERENCE_QUERY, [sc('d'), hc('a'), hc('b')]);
    expect(unmoved.reordered).toBe(false);
    expect(unmoved.gap?.unmet).toBe(false);
  });

  it('does not mutate the list it was given', () => {
    const ranked = [hc('a'), hc('b'), hc('c'), sc('d')];
    resolveAuthoritySalience(REFERENCE_QUERY, ranked);
    expect(ranked.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
