/**
 * NV-MEM-TENANT-001 / NV-MEM-DECAY-001 / NV-MEM-BUDGET-001 / NV-MEM-GRAPHRAG-001
 *
 * Regression suite for the graph-memory audit. Each `describe` block maps to one
 * audited defect and is written so it FAILS against the pre-fix implementation:
 *
 *  - cross-tenant leak: pre-fix `queryMemory` filtered `userNodeIds.has(n.id)
 *    || !n.userId` and ignored tenant entirely, so tenant B's query returned
 *    tenant A's node.
 *  - decay: pre-fix clamped at MIN_DECAY_SCORE and filtered `>= MIN_DECAY_SCORE`,
 *    making the predicate unsatisfiable-as-a-filter (always true).
 *  - limit contract: pre-fix appended related nodes AFTER slicing to `limit`.
 *  - GraphRAG: pre-fix read `edge.type` (nonexistent) and nothing ever wrote an
 *    edge, so `chains` was always empty or mislabelled.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  GraphMemoryService,
  computeMemoryDecayScore,
  MEMORY_DECAY_FLOOR,
  type MemoryNode,
} from '../../src/services/memory/graph-memory-service.js';
import {
  buildMemoryInjectionBlock,
  buildGraphInjectionBlock,
  clipToBudget,
} from '../../src/services/memory/jrx-memory-injection-budget.js';

const TENANT_A = 'org-alpha-llp';
const TENANT_B = 'org-beta-associates';
const PRIVILEGED = 'Client Sharma admits the wire transfer of 4.2 crore predates the PMLA complaint';

describe('NV-MEM-TENANT-001 — cross-tenant memory isolation', () => {
  let svc: GraphMemoryService;

  beforeEach(() => {
    svc = new GraphMemoryService();
  });

  it('does NOT return tenant A privileged memory to a tenant B query', async () => {
    await svc.addMemory(PRIVILEGED, 'fact', {}, {
      tenantId: TENANT_A,
      userId: 'advocate-1',
      sessionId: 'sess-a',
    });

    const leaked = await svc.queryMemory({
      query: 'wire transfer PMLA complaint',
      tenantId: TENANT_B,
      userId: 'advocate-2',
      sessionId: 'sess-b',
      limit: 10,
    });

    expect(leaked.nodes).toHaveLength(0);
    expect(JSON.stringify(leaked.nodes)).not.toContain('Sharma');
  });

  it('does NOT leak an ownerless node to an identified user (the || !n.userId hole)', async () => {
    // The pre-fix predicate was `userNodeIds.has(n.id) || !n.userId`, so any
    // node written without a userId was readable by every user on the platform.
    await svc.addMemory('Ownerless intake note: Sharma matter, 4.2 crore', 'fact', {}, {});

    const leaked = await svc.queryMemory({
      query: 'Sharma matter intake note',
      tenantId: TENANT_A,
      userId: 'advocate-1',
      limit: 10,
    });

    expect(leaked.nodes).toHaveLength(0);
  });

  it('still returns the owning tenant its own memory (isolation is not a blanket denial)', async () => {
    await svc.addMemory(PRIVILEGED, 'fact', {}, {
      tenantId: TENANT_A,
      userId: 'advocate-1',
      sessionId: 'sess-a',
    });

    const own = await svc.queryMemory({
      query: 'wire transfer PMLA complaint',
      tenantId: TENANT_A,
      userId: 'advocate-1',
      sessionId: 'sess-a',
      limit: 10,
    });

    expect(own.nodes.length).toBeGreaterThan(0);
    expect(own.nodes[0].content).toContain('Sharma');
  });

  it('isolates the same user id across two different tenants', async () => {
    await svc.addMemory('Tenant A strategy: rely on BNSS 482 anticipatory bail', 'fact', {}, {
      tenantId: TENANT_A,
      userId: 'shared-user-id',
    });

    const crossTenant = await svc.queryMemory({
      query: 'anticipatory bail strategy',
      tenantId: TENANT_B,
      userId: 'shared-user-id',
      limit: 10,
    });

    expect(crossTenant.nodes).toHaveLength(0);
  });

  it('does not expose another tenant via a co-cited entity node', async () => {
    await svc.addMemory('Tenant A: BNS 318(4) cheating charge against the promoter', 'fact', {}, {
      tenantId: TENANT_A,
      userId: 'advocate-1',
    });
    await svc.addMemory('Tenant B: BNS 318(4) unrelated complaint', 'fact', {}, {
      tenantId: TENANT_B,
      userId: 'advocate-2',
    });

    const bView = await svc.recall({
      query: 'BNS 318(4)',
      tenantId: TENANT_B,
      userId: 'advocate-2',
      limit: 10,
      includeRelated: true,
      maxHops: 3,
    });

    const rendered = JSON.stringify(bView);
    expect(rendered).not.toContain('promoter');
    expect(rendered).not.toContain('Tenant A');
  });

  it('refuses a write that would draw an edge into another tenant', async () => {
    const aNode = await svc.addMemory('Tenant A confidential settlement figure', 'fact', {}, {
      tenantId: TENANT_A,
      userId: 'advocate-1',
    });

    await svc.addMemory('Tenant B note', 'fact', {}, {
      tenantId: TENANT_B,
      userId: 'advocate-2',
      relationships: [{ targetId: aNode.id, relationship: 'relates_to' }],
    });

    const bView = await svc.recall({
      query: 'note settlement',
      tenantId: TENANT_B,
      userId: 'advocate-2',
      limit: 10,
      includeRelated: true,
    });

    expect(JSON.stringify(bView.memory.nodes)).not.toContain('confidential settlement');
  });

  it('does not let dedup/conflict resolution overwrite another tenant node', async () => {
    const original = await svc.addMemory('Retainer agreed at 12 lakh for the appeal', 'fact', {}, {
      tenantId: TENANT_A,
      userId: 'advocate-1',
    });

    // Near-identical content from another tenant must create a NEW node rather
    // than resolve as a "conflict" against tenant A's node.
    const other = await svc.addMemory('Retainer agreed at 12 lakh for the appeal', 'fact', {}, {
      tenantId: TENANT_B,
      userId: 'advocate-2',
    });

    expect(other.id).not.toBe(original.id);
    expect(other.tenantId).toBe(TENANT_B);
  });
});

describe('NV-MEM-DECAY-001 — the decay threshold must be reachable', () => {
  it('produces a score strictly below the recall floor for a stale, low-value node', () => {
    // This is the assertion that fails pre-fix: the old clamp floored the score
    // AT the filter threshold, so no input could ever land below it.
    const stale = computeMemoryDecayScore({
      hoursSinceAccess: 24 * 365 * 5,
      importance: 0,
      accessCount: 0,
    });
    expect(stale).toBeLessThan(MEMORY_DECAY_FLOOR);
  });

  it('never exceeds 1 even for a fresh, maximally important, heavily accessed node', () => {
    const hot = computeMemoryDecayScore({
      hoursSinceAccess: 0,
      importance: 1,
      accessCount: 10_000,
    });
    expect(hot).toBeLessThanOrEqual(1);
    expect(hot).toBeGreaterThan(MEMORY_DECAY_FLOOR);
  });

  it('is monotonically non-increasing in age', () => {
    const ages = [0, 24, 24 * 30, 24 * 180, 24 * 365, 24 * 365 * 3];
    const scores = ages.map(h =>
      computeMemoryDecayScore({ hoursSinceAccess: h, importance: 0.5, accessCount: 2 }),
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it('actually drops a decayed node out of recall', async () => {
    const svc = new GraphMemoryService();
    const node = await svc.addMemory('Ancient note about a closed matter', 'fact', {}, {
      tenantId: TENANT_A,
      userId: 'advocate-1',
      importance: 0,
    });

    const stored = (svc as unknown as { nodes: Map<string, MemoryNode> }).nodes.get(node.id)!;
    stored.lastAccessedAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 5);
    stored.accessCount = 0;
    stored.importance = 0;
    svc.applyDecayNow();

    expect(stored.decayScore).toBeLessThan(MEMORY_DECAY_FLOOR);

    const result = await svc.queryMemory({
      query: 'ancient note closed matter',
      tenantId: TENANT_A,
      userId: 'advocate-1',
      limit: 10,
    });
    expect(result.nodes).toHaveLength(0);
  });
});

describe('NV-MEM-LIMIT-001 — includeRelated must honour the limit contract', () => {
  it('returns at most `limit` nodes even with a densely connected graph', async () => {
    const svc = new GraphMemoryService();
    const scope = { tenantId: TENANT_A, userId: 'advocate-1' };

    // Every memory cites the same two authorities, so entity extraction builds a
    // dense co-citation graph — exactly the shape that blew the budget pre-fix.
    for (let i = 0; i < 25; i++) {
      await svc.addMemory(
        `Matter note ${i}: BNS 318(4) cheating read with BNSS 482 anticipatory bail relief`,
        'fact',
        {},
        scope,
      );
    }

    const limited = await svc.recall({
      query: 'BNS 318(4) BNSS 482 anticipatory bail',
      ...scope,
      limit: 5,
      includeRelated: true,
      maxHops: 3,
    });

    expect(limited.memory.nodes.length).toBeLessThanOrEqual(5);
  });

  it('fills the limit from the lexical tail when the graph is sparse', async () => {
    const svc = new GraphMemoryService();
    const scope = { tenantId: TENANT_A, userId: 'advocate-1' };
    for (let i = 0; i < 8; i++) {
      await svc.addMemory(`Isolated note ${i} about limitation period computation`, 'fact', {}, scope);
    }

    const result = await svc.recall({
      query: 'limitation period computation',
      ...scope,
      limit: 5,
      includeRelated: true,
    });

    expect(result.memory.nodes).toHaveLength(5);
  });

  it('reports withheld characters honestly rather than a fabricated 90% saving', async () => {
    const svc = new GraphMemoryService();
    const scope = { tenantId: TENANT_A, userId: 'advocate-1' };
    for (let i = 0; i < 10; i++) {
      await svc.addMemory(`Note ${i} regarding the limitation period`, 'fact', {}, scope);
    }

    const result = await svc.queryMemory({
      query: 'limitation period',
      ...scope,
      limit: 2,
    });

    // Pre-fix this was always exactly 90% of the RETURNED content, regardless of
    // what was withheld — a claim with no computation behind it.
    const returnedTokens = result.nodes.reduce((s, n) => s + Math.ceil(n.content.length / 4), 0);
    expect(result.totalTokensSaved).toBeGreaterThan(0);
    expect(result.totalTokensSaved).not.toBe(Math.floor(returnedTokens * 0.9));
  });
});

describe('NV-MEM-GRAPHRAG-001 — GraphRAG must produce real chains', () => {
  it('emits chains with correct relationship labels from shared legal authorities', async () => {
    const svc = new GraphMemoryService();
    const scope = { tenantId: TENANT_A, userId: 'advocate-1' };

    await svc.addMemory(
      'Bail argument grounded in BNSS 482 read with the PMLA 2002 twin conditions',
      'fact',
      {},
      scope,
    );
    await svc.addMemory(
      'Predicate offence pleaded under BNS 318(4) alongside PMLA 2002',
      'fact',
      {},
      scope,
    );

    const graph = await svc.traverseEntityGraph('BNSS 482 PMLA bail predicate offence', {
      ...scope,
      maxHops: 3,
      maxChains: 8,
    });

    expect(graph.chains.length).toBeGreaterThan(0);
    expect(graph.edgeCount).toBeGreaterThan(0);
    // Pre-fix every label collapsed to 'relates_to' because `edge.type` does not
    // exist on MemoryEdge; the real field is `relationship`.
    expect(graph.chains.some(c => /—\[(cites|co_cited)\]→/.test(c))).toBe(true);
  });

  it('returns no chains for a tenant with no memory rather than inventing them', async () => {
    const svc = new GraphMemoryService();
    await svc.addMemory('Tenant A only', 'fact', {}, { tenantId: TENANT_A, userId: 'a' });

    const graph = await svc.traverseEntityGraph('anything at all', {
      tenantId: TENANT_B,
      userId: 'b',
    });

    expect(graph.chains).toHaveLength(0);
  });
});

describe('NV-MEM-BUDGET-001 — memoryCharCap enforced at the injection site', () => {
  const longNode = {
    type: 'fact' as const,
    content: 'A'.repeat(2000),
  };

  it('keeps the rendered block within the declared budget', () => {
    const nodes = Array.from({ length: 10 }, () => longNode);
    const result = buildMemoryInjectionBlock(nodes, { memoryCharCap: 360, maxItems: 5 });

    expect(result.charsRendered).toBeLessThanOrEqual(360 * 5);
    // The raw interpolation this replaces emitted >20k characters for this input.
    expect(result.charsBeforeCap).toBeGreaterThan(result.charsRendered * 4);
  });

  it('drops whole items instead of slicing the block', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      type: 'fact' as const,
      content: `Memory ${i}: ${'detail '.repeat(40)}`,
    }));
    const result = buildMemoryInjectionBlock(nodes, { memoryCharCap: 280, maxItems: 3 });

    expect(result.itemsRendered).toBeLessThanOrEqual(3);
    expect(result.itemsDropped).toBe(nodes.length - result.itemsRendered);
  });

  it('never cuts inside a statute citation', () => {
    // A mid-token cut would emit "Section 318(" — a fabricated citation.
    const text = 'The charge is laid under Section 318(4) of the Bharatiya Nyaya Sanhita 2023 and more';
    for (let cap = 20; cap < text.length; cap++) {
      const clipped = clipToBudget(text, cap);
      expect(clipped.length).toBeLessThanOrEqual(cap + 1);
      if (clipped.includes('318')) {
        expect(clipped).not.toMatch(/318\($/);
        expect(clipped).not.toMatch(/Section\s*$/);
      }
    }
  });

  it('emits nothing when the cap cannot fit any useful item', () => {
    const result = buildMemoryInjectionBlock([longNode], { memoryCharCap: 5, maxItems: 5 });
    expect(result.block).toBe('');
    expect(result.itemsRendered).toBe(0);
  });

  it('preserves the highest-relevance memory when it must drop items', () => {
    const nodes = [
      { type: 'fact' as const, content: 'TOP RELEVANCE: BNSS 482 relief was granted on 12 March' },
      { type: 'fact' as const, content: 'B'.repeat(900) },
      { type: 'fact' as const, content: 'C'.repeat(900) },
    ];
    const result = buildMemoryInjectionBlock(nodes, { memoryCharCap: 280, maxItems: 2 });
    expect(result.block).toContain('TOP RELEVANCE');
  });

  it('drops graph chains whole so relationship arrows survive intact', () => {
    const chains = [
      'short A —[cites]→ short B',
      `${'X'.repeat(500)} —[co_cited]→ ${'Y'.repeat(500)}`,
    ];
    const result = buildGraphInjectionBlock(chains, { memoryCharCap: 280, maxItems: 6 });

    expect(result.block).toContain('short A —[cites]→ short B');
    expect(result.block).not.toContain('X'.repeat(200));
    // No chain is rendered without both endpoints and its arrow.
    for (const line of result.block.split('\n').slice(1)) {
      expect(line).toContain('—[');
      expect(line).toContain(']→');
    }
  });
});

describe('NV-MEM-SINGLEPASS-001 — one scored pass yields memory and graph', () => {
  it('recall() returns both memory nodes and chains from a single call', async () => {
    const svc = new GraphMemoryService();
    const scope = { tenantId: TENANT_A, userId: 'advocate-1' };
    await svc.addMemory('Charge under BNS 318(4) with PMLA 2002 overlay', 'fact', {}, scope);
    await svc.addMemory('Bail sought under BNSS 482 against the PMLA 2002 case', 'fact', {}, scope);

    const recall = await svc.recall(
      { query: 'BNS 318(4) BNSS 482 PMLA', ...scope, limit: 6, includeRelated: true },
      { maxChains: 6 },
    );

    expect(recall.memory.nodes.length).toBeGreaterThan(0);
    expect(recall.graph.chains.length).toBeGreaterThan(0);
    // The graph sees more nodes than the memory block renders: extracted
    // authority entities carry the chains without consuming a memory slot.
    expect(recall.graph.nodeCount).toBeGreaterThan(recall.memory.nodes.length);
    expect(recall.memory.nodes.every(n => n.type !== 'entity')).toBe(true);
  });
});
