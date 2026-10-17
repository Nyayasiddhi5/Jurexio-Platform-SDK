#!/usr/bin/env tsx
/**
 * NV-AGENT-SELECT-PROBE-001 — why does partner traffic land on agentKey=generic?
 *
 * Reproduces `resolveAgentByCapability()` (src/services/jrx-client.ts:410) exactly,
 * against the real registry, for the taskType values partner callers actually send.
 *
 * It is a *copy* of the predicate rather than an import because importing
 * nv-client pulls the whole service graph and hangs. The copy is asserted against
 * the source by tests/unit/jrx-agent-selection.test.ts, so drift is caught.
 *
 * NV-VALIDATE-THE-PROBE-001: runs a positive control first. If the registry does
 * not load, or a capability substring that must match does not match, the probe
 * aborts instead of reporting "nothing binds".
 *
 * Usage: npx tsx scripts/jrx-probe-agent-selection.ts
 */
import { getAllAgents } from '../src/services/agent-registry-service.js';
import {
  capabilitiesForTaskType, classifySubjectArea, nameHintsForSubject,
} from '../src/services/jrx-agent-capability-alias.js';

type Entry = {
  id: string;
  name?: string;
  description?: string;
  tier: string;
  capabilities: string[];
  jurisdiction?: string;
  jurisdictions?: string[];
  systemPrompt?: string;
};

const TIER_PRIORITY: Record<string, number> = {
  sovereign: 5, expert: 4, professional: 3, assistant: 2, executor: 1,
};

/**
 * Port of nv-client.ts `resolveAgentByCapability` AFTER
 * NV-AGENT-CAPABILITY-ALIAS-001 + NV-AGENT-JURISDICTION-LIST-001 +
 * NV-AGENT-SUBJECT-MATTER-001. The alias/subject tables are imported (not
 * copied), so the part most likely to drift is shared with production.
 */
function resolveAgentByCapability(
  agents: Entry[], taskType: string, jurisdiction?: string, prompt?: string,
): Entry | null {
  const wanted = capabilitiesForTaskType(taskType || 'general');
  const nameHints = nameHintsForSubject(prompt ? classifySubjectArea(prompt) : 'general');

  const jurisMatches = (a: Entry): boolean => {
    if (!jurisdiction) return true;
    const want = jurisdiction.toLowerCase();
    const declared = [
      ...(Array.isArray(a.jurisdictions) ? a.jurisdictions : []),
      ...(a.jurisdiction ? [a.jurisdiction] : []),
    ].map((j) => String(j).toLowerCase());
    if (declared.length === 0) return true;
    return declared.some((j) => j === 'default' || j.includes(want) || want.includes(j));
  };

  const ranked: Array<{ agent: Entry; capRank: number; subjectRank: number }> = [];
  for (const a of agents) {
    if (!jurisMatches(a)) continue;
    const caps = (a.capabilities ?? []).map((c) => c.toLowerCase());
    if (caps.length === 0) continue;
    let capRank = -1;
    for (let i = 0; i < wanted.length; i += 1) {
      const w = wanted[i].toLowerCase();
      if (!w) continue;
      if (caps.some((c) => c === w || c.includes(w))) { capRank = i; break; }
    }
    if (capRank === -1) continue;

    const haystack = `${a.name ?? ''} ${a.description ?? ''}`.toLowerCase();
    let subjectRank = nameHints.length;
    for (let i = 0; i < nameHints.length; i += 1) {
      if (haystack.includes(nameHints[i].toLowerCase())) { subjectRank = i; break; }
    }

    ranked.push({ agent: a, capRank, subjectRank });
  }
  if (ranked.length === 0) return null;
  ranked.sort((x, y) => {
    if (x.capRank !== y.capRank) return x.capRank - y.capRank;
    if (x.subjectRank !== y.subjectRank) return x.subjectRank - y.subjectRank;
    const t = (TIER_PRIORITY[y.agent.tier] || 0) - (TIER_PRIORITY[x.agent.tier] || 0);
    if (t !== 0) return t;
    return x.agent.id.localeCompare(y.agent.id);
  });
  return ranked[0].agent;
}

/** taskType values real partner callers send (NSP / NYM / console / SDK). */
const PARTNER_TASK_TYPES = [
  'legal-chat', 'legal-chat-fast', 'legal-draft', 'legal-draft-fast',
  'doc-draft', 'doc-draft-fast', 'document-draft-fast',
  'legal_research', 'legal-research', 'research',
  'drafting', 'draft', 'document_drafting',
  'contract_review', 'contract-review', 'review',
  'compliance', 'compliance_check',
  'case_analysis', 'case-analysis', 'analysis',
  'statute_lookup', 'citation_check', 'summarization',
  'chat', 'general', 'qa', 'micro_faq',
];

function main(): void {
  const raw = getAllAgents() as unknown[];
  const agents = (raw as Entry[]).map((a) => ({
    ...a,
    capabilities: Array.isArray(a.capabilities) ? a.capabilities.map(String) : [],
    tier: String(a.tier ?? 'assistant'),
  }));

  console.log('');
  console.log('NV-AGENT-SELECT-PROBE-001 — agent binding for partner taskTypes');
  console.log('='.repeat(78));

  // ---- positive control (NV-VALIDATE-THE-PROBE-001) ----
  if (agents.length === 0) {
    console.error('PROBE BROKEN: registry loaded 0 agents. Nothing below would mean anything.');
    process.exit(3);
  }
  const withCaps = agents.filter((a) => a.capabilities.length > 0);
  if (withCaps.length === 0) {
    console.error('PROBE BROKEN: no agent exposes a capabilities[] array.');
    process.exit(3);
  }
  const controlCap = withCaps[0].capabilities[0];
  const controlHit = resolveAgentByCapability(agents, controlCap);
  if (!controlHit) {
    console.error(`PROBE BROKEN: exact capability "${controlCap}" matched no agent.`);
    process.exit(3);
  }
  console.log(`control: OK — ${agents.length} agents, ${withCaps.length} with capabilities;`);
  console.log(`         exact cap "${controlCap}" -> ${controlHit.id}`);
  console.log('');

  // ---- the actual question ----
  let bound = 0; const unbound: string[] = [];
  console.log('taskType                 jurisdiction=IN            no jurisdiction');
  console.log('-'.repeat(78));
  for (const t of PARTNER_TASK_TYPES) {
    const inIN = resolveAgentByCapability(agents, t, 'IN');
    const anyJ = resolveAgentByCapability(agents, t);
    if (inIN) bound += 1; else unbound.push(t);
    console.log(
      t.padEnd(24),
      (inIN ? `${inIN.id} (${inIN.tier})` : 'GENERIC ← no match').padEnd(26),
      anyJ ? `${anyJ.id}` : 'none',
    );
  }

  console.log('');
  console.log('-'.repeat(78));
  console.log(`bound to a named agent: ${bound}/${PARTNER_TASK_TYPES.length}`);
  console.log(`fell back to generic  : ${unbound.length}  ${unbound.join(', ')}`);

  // ── subject-matter correctness (NV-AGENT-SUBJECT-MATTER-001) ──────────────
  // Binding *an* agent is not enough: a BNS murder question answered by the Tax
  // Law Research Agent is worse than a declared generalist, because the wrong
  // specialism arrives with a specialist's authority.
  const SUBJECT_CASES: Array<{ q: string; task: string; expect: RegExp; why: string }> = [
    { q: 'Which BNS section replaces IPC 302 for murder?', task: 'legal_research', expect: /criminal/i, why: 'criminal' },
    { q: 'Limitation period to file a bail application after arrest by police', task: 'legal_research', expect: /criminal/i, why: 'criminal' },
    // The registry has no family-law *drafting* agent (24 drafting agents, none
    // matrimonial) and no corporate-law *research* agent (18 research agents,
    // none corporate). A divorce petition is a court pleading, and the Companies
    // Act is a statute, so these are the correct nearest specialists rather than
    // aspirational ones. Asserting a non-existent agent would make the probe lie.
    { q: 'Draft a mutual divorce petition with child custody terms', task: 'drafting', expect: /family|matrimonial|pleading/i, why: 'family; registry has no matrimonial drafter, so Pleading Drafting is correct' },
    { q: 'Is GST input tax credit available on employee cab services?', task: 'legal_research', expect: /tax/i, why: 'tax' },
    { q: 'Review this employment agreement for termination clause risk', task: 'contract_review', expect: /employment|labour|labor/i, why: 'labour' },
    { q: 'Trademark infringement remedies for a deceptively similar mark', task: 'legal_research', expect: /ip |ip law|intellectual|trademark|patent/i, why: 'IP' },
    { q: 'Shareholder oppression remedy under Companies Act 2013', task: 'legal_research', expect: /corporate|company|governance|statutory/i, why: 'corporate; registry has no corporate researcher, so Statutory Research is correct' },
    { q: 'CIRP timeline under IBC for a corporate debtor before NCLT', task: 'legal_research', expect: /insolvency|bankruptcy/i, why: 'insolvency' },
  ];

  console.log('');
  console.log('SUBJECT-MATTER CORRECTNESS (does the right specialist bind?)');
  console.log('-'.repeat(78));
  let correct = 0;
  for (const c of SUBJECT_CASES) {
    const a = resolveAgentByCapability(agents, c.task, 'IN', c.q);
    const ok = a ? c.expect.test(String(a.name ?? '')) : false;
    if (ok) correct += 1;
    console.log(
      `${ok ? 'OK  ' : 'MISS'}  [${classifySubjectArea(c.q).padEnd(14)}] ${c.q.slice(0, 44).padEnd(44)} -> ${a ? `${a.id} ${a.name}` : 'GENERIC'}`,
    );
    if (!ok) console.log(`        expected a ${c.why} specialist`);
  }
  console.log('');
  console.log(`right specialist: ${correct}/${SUBJECT_CASES.length}`);

  // What DO capabilities look like? Needed to design the fix.
  const capCounts = new Map<string, number>();
  for (const a of agents) for (const c of a.capabilities) {
    capCounts.set(c, (capCounts.get(c) || 0) + 1);
  }
  console.log('');
  console.log(`distinct capability strings: ${capCounts.size}`);
  console.log('20 most common:');
  for (const [c, n] of [...capCounts].sort((x, y) => y[1] - x[1]).slice(0, 20)) {
    console.log(`   ${String(n).padStart(4)}  ${c}`);
  }

  // Jurisdiction shape matters: the predicate reads `a.jurisdiction` (singular)
  // while the registry entries carry `jurisdictions` (plural).
  const singular = agents.filter((a) => typeof a.jurisdiction === 'string').length;
  const plural = agents.filter((a) => Array.isArray(a.jurisdictions)).length;
  console.log('');
  console.log(`agents with .jurisdiction (singular, read by the predicate): ${singular}`);
  console.log(`agents with .jurisdictions (plural, what the registry ships): ${plural}`);
}

main();
