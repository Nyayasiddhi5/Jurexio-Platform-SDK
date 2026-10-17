#!/usr/bin/env tsx
/**
 * NV-CITATION-LIVE-PROBE — live authority-adapter smoke for NV-SVC-AUTHORITY-ADAPTER-001.
 *
 * Forces every per-jurisdiction live-citation flag ON and runs the real
 * authority lookups (legislation.gov.uk, EUR-Lex CELEX, India Code, SSO,
 * CourtListener, operator GC source) against known-GOOD and known-BAD
 * citations, proving:
 *   - a real citation resolves to `verified`
 *   - a structurally-impossible / fabricated citation resolves to
 *     `invalid` or explicit `unverified` (never a silent `verified`)
 *
 * No DB, no LLM keys. Network egress required (it consults the live APIs).
 *
 *   npx tsx scripts/jrx-citation-live-probe.ts
 *   npx tsx scripts/jrx-citation-live-probe.ts --jurisdiction UK
 */

// Force live flags ON for the probe (env is read fresh on every adapter call).
for (const j of ['IN', 'UK', 'US', 'EU', 'GC', 'SG']) {
  process.env[`NYV_F_CITATION_LIVE_${j}`] = '1';
}

import {
  verifyCitations,
  normalizeJurisdiction,
  getAuthorityRegistrySnapshot,
  clearAuthorityLiveCache,
} from '../src/services/citation-verification/index.js';

interface Probe {
  jurisdiction: string;
  label: string;
  /** Citation expected to be positively confirmed by the live authority. */
  good: { text: string; expect: 'verified' };
  /** Citation expected to be flagged (invalid OR explicit unverified). */
  bad: { text: string; expect: 'invalid' | 'unverified' };
}

const PROBES: Probe[] = [
  {
    jurisdiction: 'UK',
    label: 'legislation.gov.uk',
    good: { text: 'See the Senior Courts Act 1981 for the relevant provision.', expect: 'verified' },
    bad: { text: 'See the Zzqq Imaginary Powers Act 2023 for the relevant provision.', expect: 'invalid' },
  },
  {
    jurisdiction: 'EU',
    label: 'EUR-Lex CELEX',
    good: { text: 'Under Regulation (EU) 2019/1150 platforms must act fairly.', expect: 'verified' },
    bad: { text: 'Under Regulation (EU) 2099/9999 platforms must act fairly.', expect: 'invalid' },
  },
  {
    jurisdiction: 'IN',
    label: 'India Code',
    good: { text: 'The Mines Act, 1952 governs mine safety in India.', expect: 'verified' },
    bad: { text: 'Article 999 of the Constitution guarantees this right.', expect: 'invalid' },
  },
  {
    jurisdiction: 'US',
    label: 'CourtListener',
    good: { text: 'As held in Brown v. Board of Education, 347 U.S. 483, segregation is unconstitutional.', expect: 'verified' },
    bad: { text: 'Per 999 U.S.C. § 1 the agency has authority.', expect: 'invalid' },
  },
  {
    jurisdiction: 'SG',
    label: 'Singapore Statutes Online',
    good: { text: 'Section 300 of the Penal Code defines murder.', expect: 'verified' },
    bad: { text: 'The Zzqq Imaginary Singapore Act 2099 applies here.', expect: 'invalid' },
  },
  {
    jurisdiction: 'GC',
    label: 'UAE Federal / DIFC / ADGM',
    good: { text: 'Federal Decree-Law No. 45 of 2021 governs data protection in the UAE.', expect: 'verified' },
    bad: { text: 'Federal Law No. 999 of 2099 governs imaginary matters.', expect: 'invalid' },
  },
];

const onlyArgIdx = process.argv.indexOf('--jurisdiction');
const ONLY = onlyArgIdx >= 0 ? normalizeJurisdiction(process.argv[onlyArgIdx + 1]) : null;

function pickVerdict(report: any, want: string) {
  // Choose the verdict most relevant to the sample (highest-signal status).
  const order = ['invalid', 'verified', 'unverified', 'unsupported'];
  return report.verdicts
    .slice()
    .sort((a: any, b: any) => order.indexOf(a.status) - order.indexOf(b.status))[0];
}

async function main() {
  clearAuthorityLiveCache();
  const snap = getAuthorityRegistrySnapshot();
  console.log('Authority registry (live flags forced ON for this probe):');
  for (const s of snap) {
    console.log(`  ${s.jurisdiction.padEnd(3)} ${s.adapter.padEnd(30)} liveApiEnabled=${s.liveApiEnabled}`);
  }
  console.log('\n' + '─'.repeat(100));
  console.log('JCN'.padEnd(5) + 'Sample'.padEnd(8) + 'Expect'.padEnd(12) + 'Got'.padEnd(12) + 'Source'.padEnd(18) + 'Live  Result');
  console.log('─'.repeat(100));

  let failures = 0;
  for (const p of PROBES) {
    const code = normalizeJurisdiction(p.jurisdiction);
    if (ONLY && ONLY !== code) continue;

    for (const kind of ['good', 'bad'] as const) {
      const sample = p[kind];
      const report = await verifyCitations(sample.text, code);
      const v = pickVerdict(report, sample.expect);
      const got = v?.status ?? 'none';

      let ok: boolean;
      if (kind === 'good') {
        ok = got === 'verified';
      } else {
        // A bad citation passes if it is flagged at all (invalid or unverified).
        ok = got === 'invalid' || got === 'unverified';
      }
      if (!ok) failures++;

      console.log(
        code.padEnd(5) +
        kind.padEnd(8) +
        sample.expect.padEnd(12) +
        String(got).padEnd(12) +
        String(v?.source ?? '—').padEnd(18) +
        String(report.liveApiConsulted).padEnd(6) +
        (ok ? '✅' : '❌') + `  "${v?.citation?.raw ?? '∅'}"`,
      );
    }
  }

  console.log('─'.repeat(100));
  if (failures > 0) {
    console.error(`\n✗ ${failures} live-probe expectation(s) failed.`);
    process.exit(1);
  }
  console.log('\n✓ All live authority probes behaved as expected (verified for real, flagged for fake).');
}

main().catch(err => { console.error(err); process.exit(1); });
