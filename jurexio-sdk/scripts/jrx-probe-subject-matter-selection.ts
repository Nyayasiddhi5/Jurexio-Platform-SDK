#!/usr/bin/env tsx
/**
 * NV-AGENT-SELECT-PROBE-002 — does the EXISTING prompt-aware selector pick the
 * right specialist?
 *
 * `NvAgentAutoSelector` (src/services/jrx-orchestration-services.ts:460) already
 * classifies a query into one of 15 practice areas and then picks a registry
 * agent. Before adding subject-matter awareness to `resolveAgentByCapability`,
 * this checks whether the existing selector already solves it — building a second
 * classifier would violate NV-NO-DUPLICATE-001.
 *
 * It reproduces the selector's *pure* logic (keyword scoring + registry search)
 * without its DB write, so it can run outside a DB context.
 *
 * NV-VALIDATE-THE-PROBE-001: asserts a control query whose specialist is
 * unambiguous before reporting anything.
 *
 * Usage: npx tsx scripts/jrx-probe-subject-matter-selection.ts
 */
import {
  getAllAgents, searchAgents, getAgentsByPracticeArea,
} from '../src/services/agent-registry-service.js';

/** Verbatim from NvAgentAutoSelector.practiceAreaKeywords. */
const PRACTICE_AREA_KEYWORDS: Record<string, string[]> = {
  criminal: ['crime', 'theft', 'murder', 'bail', 'fir', 'arrest', 'police', 'prosecution', 'accused'],
  corporate: ['company', 'merger', 'acquisition', 'shareholder', 'board', 'incorporation', 'llp'],
  family: ['divorce', 'custody', 'maintenance', 'alimony', 'marriage', 'domestic', 'child'],
  property: ['land', 'property', 'tenant', 'lease', 'rent', 'eviction', 'title', 'deed'],
  labor: ['employment', 'salary', 'termination', 'workplace', 'labor', 'pf', 'esi', 'gratuity'],
  tax: ['income tax', 'gst', 'tax', 'assessment', 'refund', 'deduction', 'tds'],
  ipr: ['patent', 'trademark', 'copyright', 'intellectual property', 'infringement', 'design'],
  banking: ['loan', 'bank', 'nbfc', 'rbi', 'cheque', 'sarfaesi', 'drt', 'mortgage'],
  constitutional: ['fundamental rights', 'article', 'constitution', 'writ', 'pil'],
  cyber: ['cyber', 'data protection', 'privacy', 'it act', 'online fraud', 'hacking'],
  consumer: ['consumer', 'deficiency', 'complaint', 'product', 'service defect'],
  arbitration: ['arbitration', 'mediation', 'conciliation', 'dispute resolution', 'adr'],
  environmental: ['environment', 'pollution', 'ngt', 'forest', 'wildlife', 'climate'],
  immigration: ['visa', 'immigration', 'passport', 'oci', 'deportation', 'work permit'],
  insolvency: ['ibc', 'insolvency', 'bankruptcy', 'nclt', 'resolution', 'liquidation'],
};

function classify(query: string): { area: string; score: number } {
  const q = query.toLowerCase();
  let area = 'general'; let best = 0;
  for (const [a, kws] of Object.entries(PRACTICE_AREA_KEYWORDS)) {
    let s = 0;
    for (const k of kws) if (q.includes(k)) s += 1;
    if (s > best) { best = s; area = a; }
  }
  return { area, score: best };
}

/** The selector's agent pick, minus the DB write. */
function pick(query: string): { agentKey: string; name: string; via: string } {
  const { area } = classify(query);
  const reg = searchAgents(query) as Array<{ id: string; name: string }>;
  const pa = getAgentsByPracticeArea(area) as Array<{ id: string; name: string }>;
  const all = getAllAgents() as Array<{ id: string; name: string }>;
  const chosen = reg[0] || pa[0] || all[0];
  const via = reg[0] ? 'searchAgents(query)' : pa[0] ? `practiceArea(${area})` : 'FIRST-AGENT-IN-REGISTRY';
  return { agentKey: chosen?.id ?? 'none', name: chosen?.name ?? 'none', via };
}

/** Real legal queries with the specialist a lawyer would expect. */
const CASES: Array<{ q: string; expect: RegExp; why: string }> = [
  { q: 'Which BNS section replaces IPC 302 for murder?', expect: /criminal/i, why: 'murder → criminal law' },
  { q: 'What is the limitation period to file a bail application after arrest?', expect: /criminal|litigation/i, why: 'bail → criminal' },
  { q: 'Draft a mutual divorce petition with child custody terms', expect: /family/i, why: 'divorce/custody → family' },
  { q: 'Is GST input tax credit available on employee cab services?', expect: /tax/i, why: 'GST → tax' },
  { q: 'Review this employment agreement for termination clause risk', expect: /employment|labour|labor/i, why: 'employment → labour' },
  { q: 'Trademark infringement remedies for a deceptively similar mark', expect: /ip|trademark|intellectual/i, why: 'trademark → IP' },
  { q: 'Shareholder oppression remedy under Companies Act 2013', expect: /corporate|company/i, why: 'shareholder → corporate' },
  { q: 'CIRP timeline under IBC for a corporate debtor before NCLT', expect: /insolvency/i, why: 'IBC → insolvency' },
];

function main(): void {
  const agents = getAllAgents() as unknown[];
  console.log('');
  console.log('NV-AGENT-SELECT-PROBE-002 — does the existing selector pick the right specialist?');
  console.log('='.repeat(84));

  // ---- positive control ----
  if (agents.length === 0) {
    console.error('PROBE BROKEN: 0 agents loaded.'); process.exit(3);
  }
  const control = classify('bail application after arrest by police');
  if (control.area !== 'criminal') {
    console.error(`PROBE BROKEN: control query classified as "${control.area}", expected "criminal".`);
    process.exit(3);
  }
  console.log(`control: OK — ${agents.length} agents; "bail…arrest…police" → ${control.area}`);
  console.log('');

  let right = 0;
  for (const c of CASES) {
    const { area, score } = classify(c.q);
    const p = pick(c.q);
    const ok = c.expect.test(p.name);
    if (ok) right += 1;
    console.log(`${ok ? 'OK  ' : 'MISS'}  ${c.q.slice(0, 56)}`);
    console.log(`        area=${area}(score ${score})  ->  ${p.agentKey} "${p.name}"`);
    console.log(`        via=${p.via}   expected: ${c.why}`);
  }

  console.log('');
  console.log('-'.repeat(84));
  console.log(`correct specialist: ${right}/${CASES.length}`);
}

main();
