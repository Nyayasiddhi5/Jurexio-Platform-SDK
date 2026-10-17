/**
 * NV-AUTHORITY-SALIENCE-001 — measure `detectAuthorityTierRequest` /
 * `stripTierRequestTerms` over a deliberately mixed query spread.
 *
 * The spread is chosen to make a "Supreme Court first, always" regression
 * VISIBLE rather than to flatter the fix: it contains a query whose correct
 * answer is a High Court judgment, a statute lookup, a query where the Supreme
 * Court has said nothing, and two queries that name no tier at all and must
 * therefore come back as the identity.
 *
 * Positive control: SPREAD[0] is the production reference query, whose detection
 * MUST be tier=sc. If that comes back null the probe is broken, not the module.
 */
import {
  detectAuthorityTierRequest,
  applyTierSalience,
  tierRankCredit,
  type AuthorityTier,
} from '../src/services/jrx-authority-salience.js';

interface SpreadCase {
  id: string;
  query: string;
  /** What a lawyer would call the right forum for this question. */
  correctForum: AuthorityTier | 'statute' | 'none';
  expectIdentity: boolean;
  why: string;
}

const SPREAD: SpreadCase[] = [
  {
    id: 'ref-sc-anticipatory-bail',
    query: 'Leading Supreme Court authorities on anticipatory bail for economic offences.',
    correctForum: 'sc',
    expectIdentity: false,
    why: 'the production reference query — positive control for detection',
  },
  {
    id: 'hc-state-procedure',
    query: 'Kerala High Court procedure for condonation of delay in filing a first appeal',
    correctForum: 'hc',
    expectIdentity: false,
    why: 'a state-specific procedural point: the High Court judgment IS the authority',
  },
  {
    id: 'statute-lookup',
    query: 'What does Section 138 of the Negotiable Instruments Act provide?',
    correctForum: 'statute',
    expectIdentity: true,
    why: 'statute lookup names no forum — any reordering here is a regression',
  },
  {
    id: 'sc-silent-local',
    query: 'Leading Supreme Court authorities on BBMP khata transfer procedure in Bengaluru',
    correctForum: 'none',
    expectIdentity: false,
    why: 'the Supreme Court has said nothing relevant — must surface an authority GAP',
  },
  {
    id: 'no-tier-named',
    query: 'anticipatory bail for economic offences',
    correctForum: 'none',
    expectIdentity: true,
    why: 'no tier and no weight cue — must be the identity',
  },
  {
    id: 'multi-tier-ambiguous',
    query: 'Supreme Court and High Court views on anticipatory bail',
    correctForum: 'none',
    expectIdentity: true,
    why: 'two forums named — an ambiguous request must add no signal',
  },
];

function main(): void {
  console.log('NV-AUTHORITY-SALIENCE-001 spread probe\n');
  let controlOk = false;

  for (const c of SPREAD) {
    const req = detectAuthorityTierRequest(c.query);
    if (c.id === 'ref-sc-anticipatory-bail' && req?.tier === 'sc') controlOk = true;

    // A synthetic already-ranked list: 6 chunks, HC first (today's behaviour),
    // one SC row buried at position 4. Shows exactly how far the credit moves it.
    const ranked = [
      { id: 'hc1', courtTier: 'hc' as AuthorityTier },
      { id: 'hc2', courtTier: 'hc' as AuthorityTier },
      { id: 'hc3', courtTier: 'hc' as AuthorityTier },
      { id: 'hc4', courtTier: 'hc' as AuthorityTier },
      { id: 'sc1', courtTier: 'sc' as AuthorityTier },
      { id: 'dc1', courtTier: 'dc' as AuthorityTier },
    ];
    const after = applyTierSalience(ranked, req);
    const identity = after.map((x) => x.id).join(',') === ranked.map((x) => x.id).join(',');

    console.log(`[${c.id}] correctForum=${c.correctForum}`);
    console.log(`  query        : ${c.query}`);
    console.log(`  detected     : ${req ? `${req.tier}${req.inferred ? ' (inferred)' : ''} credit=${tierRankCredit(req)}` : 'null (no signal)'}`);
    console.log(`  cues         : ${req ? JSON.stringify(req.cues) : '-'}`);
    console.log(`  contentQuery : ${req ? `"${req.contentQuery}"` : '(unchanged)'}`);
    console.log(`  order after  : ${after.map((x) => x.id).join(',')}`);
    console.log(`  identity     : ${identity}  (expected ${c.expectIdentity})`
      + `${identity === c.expectIdentity ? '  OK' : '  ← MISMATCH'}`);
    console.log(`  why          : ${c.why}\n`);
  }

  console.log(`CONTROL detection-on-reference-query = ${controlOk}  (MUST be true)`);
  if (!controlOk) {
    console.error('probe is broken: the reference query did not detect tier=sc');
    process.exit(1);
  }
}

main();
