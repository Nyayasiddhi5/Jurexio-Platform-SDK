/**
 * NV-MEM-BUDGET-001 — measured injected-character reduction.
 *
 * Compares the pre-fix injection (raw interpolation of every recalled node, with
 * `includeRelated` overflowing the limit) against the post-fix path (limit
 * honoured + `memoryCharCap` enforced), on the same synthetic session for each
 * complexity tier's real budget from `nv-context-budgets.ts`.
 *
 * This is the evidence for the token-reduction claim, so it asserts a floor
 * rather than printing a number: if a future change re-inflates the injected
 * block, this goes red.
 */
import { describe, it, expect } from 'vitest';
import { GraphMemoryService } from '../../src/services/memory/graph-memory-service.js';
import {
  buildMemoryInjectionBlock,
  buildGraphInjectionBlock,
} from '../../src/services/memory/jrx-memory-injection-budget.js';
import { resolveContextBudgets } from '../../src/orchestration/jrx-context-budgets.js';
import { graphMemoryServicePreFix } from '../fixtures/jrx-graph-memory-prefix-snapshot.js';

const TENANT = 'org-measure';
const USER = 'advocate-measure';
const SESSION = 'sess-measure';

/**
 * A realistic legal session: 30 turns, each citing overlapping authorities.
 * Turn text is deliberately varied enough to stay below the 0.85 dedup
 * similarity threshold — otherwise the service collapses them and both the
 * before and after measurements shrink, understating the real effect.
 */
function turns(): string[] {
  const authorities = [
    'BNSS 482 anticipatory bail',
    'BNS 318(4) cheating',
    'PMLA 2002 twin conditions',
    'SEBI Act 1992 disclosure',
    'Companies Act 2013 oppression',
  ];
  const postures = [
    'the petitioner seeks interim protection pending investigation',
    'the respondent disputes territorial jurisdiction of the special court',
    'the complainant relies on documentary evidence seized during the raid',
    'the intervenor challenges the attachment order as disproportionate',
    'the prosecution opposes on the ground of flight risk and tampering',
    'the applicant tenders an undertaking to cooperate with summons',
  ];
  const consequences = [
    'limitation begins from the date of knowledge, not the date of transaction',
    'the twin conditions require a prima facie finding before release',
    'disclosure obligations attach independently of the criminal proceeding',
    'the tribunal retains discretion to mould relief on equitable grounds',
    'costs may follow the event where the pleading is found to be vexatious',
  ];

  return Array.from({ length: 30 }, (_, i) => {
    const a = authorities[i % authorities.length];
    const b = authorities[(i + 2) % authorities.length];
    const posture = postures[i % postures.length];
    const consequence = consequences[i % consequences.length];
    return (
      `Q: On issue ${i + 1}, advise how ${a} interacts with ${b} where ${posture}. ` +
      `A: On these facts ${a} governs the relief sought and ${b} constrains the timeline, ` +
      `because ${consequence}. Counsel should therefore file within the computed period, ` +
      `plead the predicate offence expressly, and preserve the ${i + 1}th ground for appeal ` +
      `with contemporaneous records of instruction number ${1000 + i * 37}.`
    );
  });
}

async function measurePreFix(limit: number, maxHops: number): Promise<number> {
  const svc = graphMemoryServicePreFix();
  const ids: string[] = [];
  for (const t of turns()) {
    const n = await svc.addMemory(t, 'fact', {}, { userId: USER, sessionId: SESSION, importance: 0.6 });
    ids.push(n.id);
  }
  // Pre-fix wrote no edges automatically; a real deployment that had wired edges
  // is the worst case, so connect a modest 3-neighbour chain to represent it.
  for (let i = 0; i + 1 < ids.length; i++) {
    await svc.addEdge(ids[i], ids[i + 1], 'relates_to');
  }

  const result = await svc.queryMemory({
    query: 'BNSS 482 anticipatory bail PMLA predicate offence limitation',
    userId: USER,
    sessionId: SESSION,
    limit,
    includeRelated: true,
    maxHops,
  });

  // The exact pre-fix interpolation from nv-client.ts:701-703.
  const memoryContext = result.nodes
    .map((n: { type: string; content: string }) => `[Memory: ${n.type}] ${n.content}`)
    .join('\n');
  const block = `[Relevant Context from Memory]\n${memoryContext}`;

  const graph = await svc.traverseEntityGraph(
    'BNSS 482 anticipatory bail PMLA predicate offence limitation',
    { userId: USER, maxHops, maxChains: 6 },
  );
  const graphBlock = graph.chains.length > 0
    ? `[Legal Concept Relationships — GraphRAG]\n${graph.chains.join('\n')}`
    : '';

  return block.length + graphBlock.length;
}

async function measurePostFix(complexity: 'simple' | 'moderate' | 'complex' | 'very_complex'): Promise<number> {
  const budgets = resolveContextBudgets(complexity);
  const svc = new GraphMemoryService();
  for (const t of turns()) {
    await svc.addMemory(t, 'fact', {}, {
      tenantId: TENANT,
      userId: USER,
      sessionId: SESSION,
      importance: 0.6,
    });
  }

  const recall = await svc.recall(
    {
      query: 'BNSS 482 anticipatory bail PMLA predicate offence limitation',
      tenantId: TENANT,
      userId: USER,
      sessionId: SESSION,
      limit: budgets.memoryLimit,
      includeRelated: budgets.memorySources !== 'session',
      maxHops: budgets.memoryMaxHops,
    },
    { maxChains: Math.min(6, budgets.memorySlice) },
  );

  const injectionBudget = { memoryCharCap: budgets.memoryCharCap, maxItems: budgets.memorySlice };
  const mem = buildMemoryInjectionBlock(recall.memory.nodes, injectionBudget);
  const graph = buildGraphInjectionBlock(recall.graph.chains, injectionBudget);
  return mem.charsRendered + graph.charsRendered;
}

describe('NV-MEM-BUDGET-001 — measured injected-character reduction', () => {
  const tiers = ['simple', 'moderate', 'complex', 'very_complex'] as const;

  for (const tier of tiers) {
    it(`reduces injected characters by >=60% on the ${tier} budget`, async () => {
      const budgets = resolveContextBudgets(tier);
      const before = await measurePreFix(budgets.memoryLimit, budgets.memoryMaxHops);
      const after = await measurePostFix(tier);

      const reduction = (before - after) / before;
      // Reported for the record; the assertion is the contract.
      // eslint-disable-next-line no-console
      console.log(
        `[${tier}] cap=${budgets.memoryCharCap} limit=${budgets.memoryLimit} ` +
          `chars ${before} → ${after} (−${(reduction * 100).toFixed(1)}%)`,
      );

      expect(after).toBeLessThan(before);
      expect(reduction).toBeGreaterThanOrEqual(0.6);
    });

    it(`never exceeds memoryCharCap × memorySlice on the ${tier} budget`, async () => {
      const budgets = resolveContextBudgets(tier);
      const after = await measurePostFix(tier);
      // Two blocks (memory + graph) each bounded by cap × slice.
      expect(after).toBeLessThanOrEqual(budgets.memoryCharCap * budgets.memorySlice * 2);
    });
  }

  it('still recalls the authorities the query asked about (reduction is not blind truncation)', async () => {
    const budgets = resolveContextBudgets('moderate');
    const svc = new GraphMemoryService();
    for (const t of turns()) {
      await svc.addMemory(t, 'fact', {}, {
        tenantId: TENANT,
        userId: USER,
        sessionId: SESSION,
        importance: 0.6,
      });
    }
    await svc.addMemory(
      'Q: What is the filing deadline? A: BNSS 482 application must be filed before arrest, PMLA 2002 bail follows.',
      'fact',
      {},
      { tenantId: TENANT, userId: USER, sessionId: SESSION, importance: 0.9 },
    );

    const recall = await svc.recall({
      query: 'BNSS 482 filing deadline before arrest',
      tenantId: TENANT,
      userId: USER,
      sessionId: SESSION,
      limit: budgets.memoryLimit,
      includeRelated: true,
      maxHops: budgets.memoryMaxHops,
    });
    const block = buildMemoryInjectionBlock(recall.memory.nodes, {
      memoryCharCap: budgets.memoryCharCap,
      maxItems: budgets.memorySlice,
    });

    // A win that destroys recall is not a win: the on-point memory must survive.
    expect(block.block).toContain('BNSS 482');
  });
});
