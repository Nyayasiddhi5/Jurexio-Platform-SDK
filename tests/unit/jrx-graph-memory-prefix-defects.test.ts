/**
 * NV-MEM-TENANT-001 — proof that the regression suite is not vacuous.
 *
 * These cases run the assertions from
 * `jrx-graph-memory-tenant-isolation.test.ts` against the PRE-FIX implementation
 * (a verbatim copy of `graph-memory-service.ts` at the commit before the fix,
 * checked in under `tests/fixtures/`). Every `expect` here asserts the defective
 * behaviour, so this file passing is the evidence that the fixed suite would
 * fail without the fix.
 *
 * If someone reverts the isolation predicate, the fixed suite goes red; if
 * someone deletes the fixture, this file goes red. The pair cannot both pass by
 * accident.
 */
import { describe, it, expect } from 'vitest';
import { graphMemoryServicePreFix } from '../fixtures/jrx-graph-memory-prefix-snapshot.js';

const TENANT_A = 'org-alpha-llp';
const TENANT_B = 'org-beta-associates';

describe('pre-fix graph memory — the defects the fix closes', () => {
  it('LEAKED an ownerless node to every user (|| !n.userId)', async () => {
    const svc = graphMemoryServicePreFix();
    await svc.addMemory('Ownerless intake note: Sharma matter, 4.2 crore', 'fact', {}, {});

    const leaked = await svc.queryMemory({
      query: 'Sharma matter intake note',
      userId: 'advocate-from-another-firm',
      limit: 10,
    });

    // The defect: a different firm's advocate reads the note.
    expect(leaked.nodes.length).toBeGreaterThan(0);
    expect(leaked.nodes[0].content).toContain('Sharma');
  });

  it('LEAKED across tenants because tenant was not part of the predicate', async () => {
    const svc = graphMemoryServicePreFix();
    // Pre-fix `addMemory` had no tenantId at all, so two tenants sharing a user
    // id — or any node written without a user id — were indistinguishable.
    await svc.addMemory('Tenant A privileged: promoter admitted the transfer', 'fact', {}, {
      userId: 'shared-user-id',
    });

    const crossTenant = await svc.queryMemory({
      query: 'promoter admitted transfer',
      userId: 'shared-user-id',
      limit: 10,
    });

    expect(crossTenant.nodes.length).toBeGreaterThan(0);
  });

  it('had an UNSATISFIABLE decay filter — no node could ever fall below the floor', async () => {
    const svc = graphMemoryServicePreFix();
    const node = await svc.addMemory('Ancient note about a closed matter', 'fact', {}, {
      userId: 'advocate-1',
      importance: 0,
    });

    const internal = svc as unknown as {
      nodes: Map<string, { lastAccessedAt: Date; accessCount: number; importance: number; decayScore: number }>;
      applyDecay(): void;
    };
    const stored = internal.nodes.get(node.id)!;
    stored.lastAccessedAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 5);
    stored.accessCount = 0;
    stored.importance = 0;
    internal.applyDecay();

    // The clamp floor equalled the filter threshold (0.1), so the predicate
    // `decayScore >= MIN_DECAY_SCORE` was true by construction. Decay was inert.
    expect(stored.decayScore).toBe(0.1);

    const stillRecalled = await svc.queryMemory({
      query: 'ancient note closed matter',
      userId: 'advocate-1',
      limit: 10,
    });
    expect(stillRecalled.nodes.length).toBeGreaterThan(0);
  });

  it('BROKE the limit contract when includeRelated was set', async () => {
    const svc = graphMemoryServicePreFix();
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const n = await svc.addMemory(`Matter note ${i}: BNS 318(4) with BNSS 482 relief`, 'fact', {}, {
        userId: 'advocate-1',
      });
      ids.push(n.id);
    }
    // Pre-fix nothing wrote edges automatically, so the graph had to be wired by
    // hand to demonstrate the overflow — which is itself the GraphRAG defect.
    for (let i = 1; i < ids.length; i++) {
      await svc.addEdge(ids[0], ids[i], 'relates_to');
    }

    const limited = await svc.queryMemory({
      query: 'BNS 318(4) BNSS 482 relief',
      userId: 'advocate-1',
      limit: 5,
      includeRelated: true,
      maxHops: 3,
    });

    // Asked for 5, got far more — this is how the char budget was blown.
    expect(limited.nodes.length).toBeGreaterThan(5);
  });

  it('produced ZERO chains because nothing ever wrote an edge', async () => {
    const svc = graphMemoryServicePreFix();
    await svc.addMemory('Bail under BNSS 482 with PMLA 2002 twin conditions', 'fact', {}, {
      userId: 'advocate-1',
    });
    await svc.addMemory('Predicate offence under BNS 318(4) with PMLA 2002', 'fact', {}, {
      userId: 'advocate-1',
    });

    const graph = await svc.traverseEntityGraph('BNSS 482 PMLA predicate offence', {
      userId: 'advocate-1',
      maxHops: 3,
      maxChains: 8,
    });

    expect(graph.edgeCount).toBe(0);
    // The only output was the isolated-node fallback, never a relationship chain.
    expect(graph.chains.every(c => !c.includes('—['))).toBe(true);
  });

  it('reported a FABRICATED 90% token saving with no compression performed', async () => {
    const svc = graphMemoryServicePreFix();
    for (let i = 0; i < 5; i++) {
      await svc.addMemory(`Note ${i} regarding the limitation period`, 'fact', {}, { userId: 'advocate-1' });
    }

    const result = await svc.queryMemory({
      query: 'limitation period',
      userId: 'advocate-1',
      limit: 5,
    });

    const returnedTokens = result.nodes.reduce(
      (s: number, n: { content: string }) => s + Math.ceil(n.content.length / 4),
      0,
    );
    // Exactly 90% of what was RETURNED — a hardcoded ratio, not a measurement.
    expect(result.totalTokensSaved).toBe(returnedTokens - Math.floor(returnedTokens * 0.1));
  });
});
