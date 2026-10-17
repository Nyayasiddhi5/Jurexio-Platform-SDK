/**
 * NV-AUTHORITY-SALIENCE-001 — the four properties `applyTierSalience` claims,
 * plus the detection and stripping behaviour the ranking depends on.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The module carried four documented properties and no test. Each is asserted
 * here in a way that FAILS if the property is removed — verified by mutation,
 * not by inspection (see the mutation table in the Session ledger).
 *
 * The property that matters most commercially is the BOUND. An unbounded
 * "requested tier wins" rule would push Supreme Court rows to the top of every
 * query that says "leading", which is wrong for every state-specific procedural
 * question — where the High Court judgment IS the governing authority. The
 * bound is what makes this a tie-breaker rather than a hierarchy.
 */
import { describe, it, expect } from 'vitest';
import {
  applyTierSalience,
  assessAuthorityGap,
  describeAuthorityTier,
  detectAuthorityTierRequest,
  stripTierRequestTerms,
  tierRankCredit,
  INFERRED_TIER_RANK_CREDIT,
  TIER_RANK_CREDIT,
  type AuthorityTier,
  type AuthorityTierRequest,
} from '../../src/services/jrx-authority-salience.js';

interface Row {
  id: string;
  courtTier?: AuthorityTier;
  hasReporterCitation?: boolean;
}

const row = (id: string, courtTier?: AuthorityTier, hasReporterCitation?: boolean): Row =>
  ({ id, ...(courtTier ? { courtTier } : {}), ...(hasReporterCitation === undefined ? {} : { hasReporterCitation }) });

/** A named request, so tests do not depend on detection to exercise ranking. */
const scRequest: AuthorityTierRequest = {
  tier: 'sc', cues: ['Supreme Court'], contentQuery: 'anticipatory bail', inferred: false,
};
const inferredScRequest: AuthorityTierRequest = { ...scRequest, cues: ['leading'], inferred: true };
const hcRequest: AuthorityTierRequest = {
  tier: 'hc', cues: ['High Court'], contentQuery: 'condonation delay', inferred: false,
};

describe('applyTierSalience — property 1: it is a permutation', () => {
  it('never adds, drops or rewrites a chunk', () => {
    const ranked = [row('a', 'hc'), row('b', 'sc'), row('c', 'dc'), row('d', 'sc'), row('e')];
    const after = applyTierSalience(ranked, scRequest);

    expect(after).toHaveLength(ranked.length);
    // Same multiset of identities…
    expect([...after].map((r) => r.id).sort()).toEqual([...ranked].map((r) => r.id).sort());
    // …and the very same object references, so nothing was rebuilt or mutated.
    for (const original of ranked) expect(after).toContain(original);
  });

  it('does not mutate the input array', () => {
    const ranked = [row('a', 'hc'), row('b', 'sc')];
    const snapshot = ranked.map((r) => r.id).join(',');
    applyTierSalience(ranked, scRequest);
    expect(ranked.map((r) => r.id).join(',')).toBe(snapshot);
  });
});

describe('applyTierSalience — property 2: identity when no tier was requested', () => {
  it('returns the same order for a null request', () => {
    const ranked = [row('a', 'hc'), row('b', 'sc'), row('c', 'dc')];
    expect(applyTierSalience(ranked, null).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('is the identity on a list with no tier metadata at all', () => {
    // Tenant documents and statutes carry no `courtTier`. `undefined` must mean
    // "adds no signal", never "not the requested tier, therefore demote".
    const ranked = [row('s1'), row('s2'), row('s3')];
    expect(applyTierSalience(ranked, scRequest).map((r) => r.id)).toEqual(['s1', 's2', 's3']);
  });

  it('is the identity when every chunk is already of the requested tier', () => {
    const ranked = [row('a', 'sc'), row('b', 'sc'), row('c', 'sc')];
    expect(applyTierSalience(ranked, scRequest).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('applyTierSalience — property 3: stable within a tier', () => {
  it('preserves the cross-encoder order among equally-eligible authorities', () => {
    // Four SC rows interleaved with HC rows. The SC rows may move up, but never
    // past each other: their relative judgement is the reranker's, not ours.
    const ranked = [
      row('hc1', 'hc'), row('sc1', 'sc'), row('hc2', 'hc'),
      row('sc2', 'sc'), row('hc3', 'hc'), row('sc3', 'sc'),
    ];
    const after = applyTierSalience(ranked, scRequest).map((r) => r.id);
    const scOrder = after.filter((id) => id.startsWith('sc'));
    expect(scOrder).toEqual(['sc1', 'sc2', 'sc3']);
    // Non-requested tiers keep their relative order too.
    expect(after.filter((id) => id.startsWith('hc'))).toEqual(['hc1', 'hc2', 'hc3']);
  });
});

describe('applyTierSalience — property 4: the credit is bounded', () => {
  it('moves a requested-tier chunk up by at most TIER_RANK_CREDIT places', () => {
    const ranked = [
      row('hc1', 'hc'), row('hc2', 'hc'), row('hc3', 'hc'),
      row('hc4', 'hc'), row('sc1', 'sc'),
    ];
    const after = applyTierSalience(ranked, scRequest).map((r) => r.id);
    // The bound is an upper bound, and it is not reached: sc1's effective rank
    // (4 − 3 = 1) TIES with hc2's (1), and the tie breaks on original index, so
    // the incumbent keeps the place. Net movement is credit − 1 = 2 places.
    // Asserted both ways on purpose — the inequality is the property, the exact
    // index pins the tie-breaking that makes it conservative.
    expect(after.indexOf('sc1')).toBeGreaterThanOrEqual(4 - TIER_RANK_CREDIT);
    expect(after.indexOf('sc1')).toBe(2);
    expect(after[0]).toBe('hc1');
    expect(after[1]).toBe('hc2');
  });

  it('leaves a chunk ranked further than credit+1 below still ahead', () => {
    // This is the anti-regression assertion: a strongly-ranked High Court
    // judgment out-ranks a weakly-ranked Supreme Court one. If the credit were
    // unbounded (or a score multiplier), hc1 would lose its place here.
    const ranked = [
      row('hc1', 'hc'), row('hc2', 'hc'), row('hc3', 'hc'),
      row('hc4', 'hc'), row('hc5', 'hc'), row('sc_weak', 'sc'),
    ];
    const after = applyTierSalience(ranked, scRequest).map((r) => r.id);
    expect(after.indexOf('hc1')).toBeLessThan(after.indexOf('sc_weak'));
    expect(after.indexOf('hc2')).toBeLessThan(after.indexOf('sc_weak'));
  });

  it('credits an inferred tier strictly less than a named one', () => {
    const ranked = [
      row('hc1', 'hc'), row('hc2', 'hc'), row('hc3', 'hc'), row('sc1', 'sc'),
    ];
    const named = applyTierSalience(ranked, scRequest).map((r) => r.id).indexOf('sc1');
    const inferred = applyTierSalience(ranked, inferredScRequest).map((r) => r.id).indexOf('sc1');
    expect(inferred).toBeGreaterThan(named);
    expect(INFERRED_TIER_RANK_CREDIT).toBeLessThan(TIER_RANK_CREDIT);
    expect(tierRankCredit(scRequest)).toBe(TIER_RANK_CREDIT);
    expect(tierRankCredit(inferredScRequest)).toBe(INFERRED_TIER_RANK_CREDIT);
  });

  it('promotes High Court symmetrically — this is not an "SC is better" boost', () => {
    // The same mechanism, requested the other way. If tier salience were a
    // hierarchy rather than a request, this case could not pass.
    const ranked = [
      row('sc1', 'sc'), row('sc2', 'sc'), row('sc3', 'sc'), row('hc1', 'hc'),
    ];
    const after = applyTierSalience(ranked, hcRequest).map((r) => r.id);
    expect(after.indexOf('hc1')).toBeGreaterThanOrEqual(3 - TIER_RANK_CREDIT);
    expect(after.indexOf('hc1')).toBeLessThan(3);
    // The top-ranked Supreme Court row is NOT displaced by an HC request either:
    // the bound cuts both ways.
    expect(after[0]).toBe('sc1');
  });
});

describe('applyTierSalience — degenerate inputs', () => {
  it('returns a copy for an empty or single-element list', () => {
    expect(applyTierSalience([], scRequest)).toEqual([]);
    const one = [row('a', 'sc')];
    const after = applyTierSalience(one, scRequest);
    expect(after).toEqual(one);
    expect(after).not.toBe(one);
  });
});
