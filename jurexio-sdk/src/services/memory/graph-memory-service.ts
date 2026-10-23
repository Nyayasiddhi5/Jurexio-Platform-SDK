// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Graph-Based Memory Service (Mem0ᵍ Pattern)
 * Jurexio Legal SDK v5.0.0 - Memory System
 *
 * Features:
 * - Graph-based relational memory with entity relationships
 * - Memory decay mechanisms for outdated information
 * - Episodic/Semantic/Procedural memory types
 * - Salient fact extraction for compact recall
 * - Conflict resolution and deduplication
 *
 * NV-MEM-TENANT-001 — every read and every conflict-resolving write resolves an
 * explicit `MemoryScope` inside this class. Callers cannot opt out of isolation
 * by omitting a filter: an un-scoped query matches only un-scoped, explicitly
 * shared nodes. Privileged client matter is the payload here, so the boundary is
 * fail-closed in both directions (a tenant cannot read global nodes and a global
 * caller cannot read tenant nodes).
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../utils/logger.js';
import { isRecallTrustTierAllowed } from '../jrx-trust-tier.js';

const logger = createLogger('graph-memory');

export interface MemoryNode {
  id: string;
  type: 'entity' | 'concept' | 'event' | 'fact' | 'preference' | 'skill';
  content: string;
  embedding?: number[];
  metadata: Record<string, any>;
  createdAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
  decayScore: number;
  importance: number;
  source: string;
  userId?: string;
  sessionId?: string;
  tenantId?: string;
  /** Opt-in tenant-wide visibility. Absent/false means owner-only. */
  shared?: boolean;
}

/**
 * The isolation key for every read. Resolved once, applied inside the service.
 */
export interface MemoryScope {
  tenantId?: string;
  userId?: string;
  sessionId?: string;
}

export interface MemoryEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  weight: number;
  metadata: Record<string, any>;
  createdAt: Date;
  lastReinforced: Date;
  reinforcementCount: number;
}

export interface MemoryQuery {
  query: string;
  userId?: string;
  sessionId?: string;
  tenantId?: string;
  memoryTypes?: MemoryNode['type'][];
  limit?: number;
  minImportance?: number;
  includeRelated?: boolean;
  maxHops?: number;
}

export interface MemoryResult {
  nodes: MemoryNode[];
  edges: MemoryEdge[];
  relevanceScores: Map<string, number>;
  /**
   * Characters of in-scope memory that recall deliberately did NOT return
   * (scored candidates below the limit). This is a measured number, not a
   * compression claim — this service performs no compression.
   */
  totalTokensSaved: number;
  retrievalTime: number;
}

/** Combined recall + graph traversal from a single scored pass. */
export interface MemoryRecall {
  memory: MemoryResult;
  graph: GraphTraversalResult;
}

export interface GraphTraversalResult {
  chains: string[];
  nodeCount: number;
  edgeCount: number;
}

export type MemoryCategory = 'episodic' | 'semantic' | 'procedural';

interface EpisodicMemory {
  id: string;
  event: string;
  timestamp: Date;
  context: Record<string, any>;
  emotionalValence: number;
  participants: string[];
  location?: string;
}

interface SemanticMemory {
  id: string;
  concept: string;
  definition: string;
  relationships: Array<{ concept: string; relation: string }>;
  confidence: number;
  sources: string[];
}

interface ProceduralMemory {
  id: string;
  skill: string;
  steps: string[];
  prerequisites: string[];
  successRate: number;
  executionCount: number;
}

/**
 * NV-MEM-DECAY-001 — the recall threshold and the decay clamp must NOT be the
 * same number.
 *
 * The previous code clamped `decayScore = Math.max(MIN_DECAY_SCORE, …)` and then
 * filtered `decayScore >= MIN_DECAY_SCORE`. Since the clamp floor equalled the
 * filter threshold, the predicate was satisfied by construction for every node
 * and decay could never remove anything — the same unreachable-threshold shape
 * as NV-RAG-CONF-001, where `scoreConfidence` peaked at 0.5484 against a 0.55
 * gate. The clamp now floors at 0 so the score can fall strictly below the
 * recall threshold, and is capped at 1 so a fresh, important, frequently
 * accessed node cannot score above the theoretical maximum.
 */
const MEMORY_DECAY_FLOOR = 0.1;
const MEMORY_DECAY_CLAMP_MIN = 0;
const MEMORY_DECAY_RATE_PER_DAY = 0.05;

export { MEMORY_DECAY_FLOOR, MEMORY_DECAY_RATE_PER_DAY };

/**
 * Pure decay arithmetic, exported so the reachability of `MEMORY_DECAY_FLOOR`
 * can be proven by test rather than asserted in a comment.
 *
 * Returns a value in [0, 1]. The old implementation returned
 * `Math.max(MEMORY_DECAY_FLOOR, …)`, which made `score >= MEMORY_DECAY_FLOOR`
 * a tautology; it also had no upper clamp, so importance/access boosts could
 * push the score above 1 and double-count importance in the relevance product.
 */
export function computeMemoryDecayScore(input: {
  hoursSinceAccess: number;
  importance: number;
  accessCount: number;
  decayRatePerDay?: number;
}): number {
  const rate = input.decayRatePerDay ?? MEMORY_DECAY_RATE_PER_DAY;
  const decayFactor = Math.exp(-rate * Math.max(0, input.hoursSinceAccess) / 24);
  const importanceBoost = 1 + (input.importance * 0.5);
  const accessBoost = 1 + (Math.log10(Math.max(0, input.accessCount) + 1) * 0.2);
  return Math.min(1, Math.max(MEMORY_DECAY_CLAMP_MIN, decayFactor * importanceBoost * accessBoost));
}

/** Statute/case references that make two memories genuinely related. */
const LEGAL_ENTITY_PATTERNS: RegExp[] = [
  /\b(?:BNS|BNSS|BSA|IPC|CrPC|IEA)\s*(?:Section\s*|Sec\.?\s*|§\s*)?\d+[A-Z]?(?:\(\d+\))?/gi,
  /\bSection\s*\d+[A-Z]?(?:\(\d+\))?\s*of\s*(?:the\s*)?[A-Z][\w\s]{2,40}?Act(?:,?\s*\d{4})?/gi,
  /\(\d{4}\)\s*\d+\s*SCC\s*\d+/g,
  /\bAIR\s*\d{4}\s*[A-Z]{2,4}\s*\d+/g,
  /\b(?:PMLA|SEBI Act|Companies Act|Income Tax Act|GST Act|Arbitration and Conciliation Act)(?:,?\s*\d{4})?/gi,
];

class GraphMemoryService {
  private nodes: Map<string, MemoryNode> = new Map();
  private edges: Map<string, MemoryEdge> = new Map();
  private episodicMemories: Map<string, EpisodicMemory> = new Map();
  private semanticMemories: Map<string, SemanticMemory> = new Map();
  private proceduralMemories: Map<string, ProceduralMemory> = new Map();

  private readonly DECAY_RATE = 0.05;
  private readonly MAX_MEMORY_SIZE = 10000;

  private userGraphs: Map<string, Set<string>> = new Map();
  private sessionGraphs: Map<string, Set<string>> = new Map();
  /** nodeId → edgeIds. Keeps graph expansion proportional to the frontier. */
  private adjacency: Map<string, Set<string>> = new Map();
  /** Scope-partitioned entity node ids, so entity reuse cannot cross tenants. */
  private entityIndex: Map<string, string> = new Map();

  private decayTimer?: ReturnType<typeof setInterval>;

  constructor() {
    this.startDecayProcess();
  }

  /*
   * NV-GRAPH-MEMORY-DURABLE-001 — write-through + boot hydration against
   * `nv_schema.memory_entries`, reusing the `upsertRow` / `selectRows` primitives that
   * ClaWdBot / OpenBot / AutomateAI / TwinDesk already use. No new table and no second
   * persistence path (NV-NO-DUPLICATE-001).
   *
   * NOTE: `upsertRow` itself was broken until today — it ran an unparameterised `sql.raw`
   * first, which threw "there is no parameter $1", was swallowed by its own catch, and never
   * reached the real `pool.query`. So every consumer of this helper had been silently losing
   * writes (`nv_openbot_channels` and `nv_openbot_routes` were both empty on the live DB).
   * Fixed in `jrx-persistence-helper.ts` as NV-PERSIST-UPSERT-001; without that fix this
   * write-through would have been just as silent.
   */
  private static readonly MEMORY_TABLE = 'nv_schema.memory_entries';

  private async persistNode(node: MemoryNode): Promise<void> {
    try {
      const { upsertRow } = await import('../persistence/jrx-persistence-helper.js');
      await upsertRow(GraphMemoryService.MEMORY_TABLE, 'id', {
        id: node.id,
        /* `user_id` is NOT NULL. A node with no user is graph-scoped rather than
         * user-scoped, so it gets an explicit sentinel instead of failing the insert. */
        user_id: node.userId || 'graph:shared',
        tenant_id: node.tenantId ?? null,
        memory_type: `graph:${node.type}`,
        scope: node.shared ? 'shared' : (node.sessionId ? 'session' : 'user'),
        session_id: node.sessionId ?? null,
        key: null,
        /* The whole node goes in `value` so hydration can rebuild it losslessly — the
         * columns above exist to make it *queryable*, not to be the source of truth. */
        value: {
          content: node.content,
          type: node.type,
          metadata: node.metadata,
          source: node.source,
          decayScore: node.decayScore,
          shared: node.shared === true,
          createdAt: node.createdAt instanceof Date ? node.createdAt.toISOString() : node.createdAt,
        },
        importance: node.importance,
        access_count: node.accessCount,
        last_accessed_at: node.lastAccessedAt,
        created_at: node.createdAt,
      });
    } catch (err) {
      logger.warn('[graph-memory] persist failed (non-fatal)', {
        nodeId: node.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Rebuild the in-process graph from Postgres. Called once at boot from
   * `startPlatformJobs`; bounded so a large corpus cannot stall startup.
   */
  async hydrateFromDb(limit = 5_000): Promise<number> {
    try {
      const { selectRows } = await import('../persistence/jrx-persistence-helper.js');
      const rows = await selectRows(
        `SELECT id, user_id, tenant_id, memory_type, scope, session_id, value,
                importance, access_count, last_accessed_at, created_at
           FROM ${GraphMemoryService.MEMORY_TABLE}
          WHERE memory_type LIKE 'graph:%'
            AND (expires_at IS NULL OR expires_at > NOW())
          ORDER BY importance DESC NULLS LAST, created_at DESC
          LIMIT $1`,
        [limit],
      );
      let n = 0;
      for (const row of rows) {
        if (this.ingestHydratedRow(row as Record<string, unknown>)) n += 1;
      }
      if (n > 0) logger.info('[graph-memory] hydrated from db', { nodes: n });
      return n;
    } catch (err) {
      logger.warn('[graph-memory] hydrate failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  async addMemory(
    content: string,
    type: MemoryNode['type'],
    metadata: Record<string, any> = {},
    options: {
      userId?: string;
      sessionId?: string;
      tenantId?: string;
      shared?: boolean;
      source?: string;
      importance?: number;
      relationships?: Array<{ targetId: string; relationship: string; weight?: number }>;
    } = {}
  ): Promise<MemoryNode> {
    // Dedup/conflict resolution mutates an existing node, so it must run under
    // the same scope as a read — otherwise a write could rewrite another
    // tenant's memory (NV-MEM-TENANT-001).
    const scope: MemoryScope = {
      tenantId: options.tenantId,
      userId: options.userId,
      sessionId: options.sessionId,
    };
    const conflictingNode = await this.findConflictingMemory(content, scope);
    if (conflictingNode) {
      return await this.resolveConflict(conflictingNode, content, metadata);
    }

    const node: MemoryNode = {
      id: uuidv4(),
      type,
      content,
      metadata,
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      accessCount: 1,
      decayScore: 1.0,
      importance: options.importance ?? this.calculateImportance(content, type),
      source: options.source ?? 'user_input',
      userId: options.userId,
      sessionId: options.sessionId,
      tenantId: options.tenantId,
      shared: options.shared === true,
    };

    this.nodes.set(node.id, node);
    /*
     * NV-GRAPH-MEMORY-DURABLE-001 (2026-08-18) — write through to Postgres.
     *
     * Every one of this service's nine state Maps was process-local, and
     * `nv_schema.knowledge_graph_entities` held **0 rows** on the live database, so the
     * entire graph tier was lost on each restart — and the gateway was recreated ~8 times in
     * two days. Anything built on "the assistant remembers this matter" silently reset.
     *
     * `memory_entries` is the target rather than `knowledge_graph_entities` because the
     * latter keys on `integer` ids while these nodes are uuid strings, and because
     * `memory_entries` already carries `memory_type`, `scope`, `session_id`, a `jsonb value`
     * and the `value_tsv` GIN index that made recall 10.6 ms. It holds 1,695 rows today, so
     * it is the tier that demonstrably works.
     *
     * Fire-and-forget on purpose: memory is an enhancement to an answer, never a
     * precondition for it, so a write failure must not fail the caller's request.
     */
    await this.persistNode(node);

    if (options.userId) {
      if (!this.userGraphs.has(options.userId)) {
        this.userGraphs.set(options.userId, new Set());
      }
      this.userGraphs.get(options.userId)!.add(node.id);
    }

    if (options.sessionId) {
      if (!this.sessionGraphs.has(options.sessionId)) {
        this.sessionGraphs.set(options.sessionId, new Set());
      }
      this.sessionGraphs.get(options.sessionId)!.add(node.id);
    }

    if (options.relationships) {
      for (const rel of options.relationships) {
        // An edge may only be drawn to a node the writer can already read,
        // otherwise graph expansion becomes a cross-tenant escape hatch.
        const target = this.nodes.get(rel.targetId);
        if (!target || !this.isNodeInScope(target, scope)) continue;
        await this.addEdge(node.id, rel.targetId, rel.relationship, rel.weight ?? 1.0);
      }
    }

    // NV-MEM-GRAPHRAG-001 — without this, nothing in the platform ever wrote an
    // edge, so the entity graph was permanently empty and GraphRAG could not
    // emit a single chain. Statute and case references are extracted
    // deterministically (no LLM) and promoted to scoped entity nodes, so two
    // memories that cite the same authority become genuinely connected.
    await this.linkLegalEntities(node, scope);

    await this.enforceMemoryLimit();

    return node;
  }

  async addEdge(
    sourceId: string,
    targetId: string,
    relationship: string,
    weight: number = 1.0,
    metadata: Record<string, any> = {}
  ): Promise<MemoryEdge> {
    const existingEdge = this.findEdge(sourceId, targetId, relationship);

    if (existingEdge) {
      existingEdge.weight = Math.min(existingEdge.weight + 0.1, 2.0);
      existingEdge.reinforcementCount++;
      existingEdge.lastReinforced = new Date();
      return existingEdge;
    }

    const edge: MemoryEdge = {
      id: uuidv4(),
      sourceId,
      targetId,
      relationship,
      weight,
      metadata,
      createdAt: new Date(),
      lastReinforced: new Date(),
      reinforcementCount: 1
    };

    this.edges.set(edge.id, edge);
    this.indexEdge(edge);
    return edge;
  }

  private findEdge(sourceId: string, targetId: string, relationship: string): MemoryEdge | undefined {
    for (const edgeId of Array.from(this.adjacency.get(sourceId) ?? [])) {
      const e = this.edges.get(edgeId);
      if (e && e.sourceId === sourceId && e.targetId === targetId && e.relationship === relationship) {
        return e;
      }
    }
    return undefined;
  }

  private indexEdge(edge: MemoryEdge): void {
    for (const nodeId of [edge.sourceId, edge.targetId]) {
      if (!this.adjacency.has(nodeId)) this.adjacency.set(nodeId, new Set());
      this.adjacency.get(nodeId)!.add(edge.id);
    }
  }

  private dropEdge(edgeId: string): void {
    const edge = this.edges.get(edgeId);
    if (!edge) return;
    this.adjacency.get(edge.sourceId)?.delete(edgeId);
    this.adjacency.get(edge.targetId)?.delete(edgeId);
    this.edges.delete(edgeId);
  }

  private scopeKey(scope: MemoryScope): string {
    return `${scope.tenantId ?? ''}::${scope.userId ?? ''}::${scope.sessionId ?? ''}`;
  }

  private extractLegalEntities(content: string): string[] {
    const found = new Set<string>();
    for (const pattern of LEGAL_ENTITY_PATTERNS) {
      const matches = content.match(pattern);
      if (!matches) continue;
      for (const m of matches) {
        const normalized = m.replace(/\s+/g, ' ').trim();
        if (normalized.length >= 4) found.add(normalized);
        if (found.size >= 6) return Array.from(found);
      }
    }
    return Array.from(found);
  }

  private async linkLegalEntities(node: MemoryNode, scope: MemoryScope): Promise<void> {
    if (node.type === 'entity') return;
    const entities = this.extractLegalEntities(node.content);
    if (entities.length === 0) return;

    const entityIds: string[] = [];
    for (const label of entities) {
      const key = `${this.scopeKey(scope)}::${label.toLowerCase()}`;
      let entityId = this.entityIndex.get(key);
      let entityNode = entityId ? this.nodes.get(entityId) : undefined;

      if (!entityNode) {
        entityNode = {
          id: uuidv4(),
          type: 'entity',
          content: label,
          metadata: { legalAuthority: true },
          createdAt: new Date(),
          lastAccessedAt: new Date(),
          accessCount: 1,
          decayScore: 1.0,
          importance: 0.8,
          source: 'legal_entity_extraction',
          userId: node.userId,
          sessionId: node.sessionId,
          tenantId: node.tenantId,
          shared: node.shared,
        };
        this.nodes.set(entityNode.id, entityNode);
        entityId = entityNode.id;
        this.entityIndex.set(key, entityId);
        if (node.userId) this.userGraphs.get(node.userId)?.add(entityId);
        if (node.sessionId) this.sessionGraphs.get(node.sessionId)?.add(entityId);
      }

      await this.addEdge(node.id, entityId!, 'cites', 1.0, { authority: label });
      entityIds.push(entityId!);
    }

    for (let i = 0; i < entityIds.length; i++) {
      for (let j = i + 1; j < entityIds.length; j++) {
        await this.addEdge(entityIds[i], entityIds[j], 'co_cited', 0.6);
      }
    }
  }

  private normScopeKey(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    return String(value);
  }

  /**
   * NV-MEM-TENANT-001 — the single isolation predicate. Every read path funnels
   * through here so a caller cannot leak memory by forgetting a filter.
   *
   * Rules, in order:
   *  1. Tenant boundary is absolute. A node belonging to tenant A is invisible
   *     to tenant B and to an un-scoped (no-tenant) caller, and a tenant caller
   *     cannot see nodes with no tenant.
   *  2. Within a tenant, a node is visible to its owning user, to the owning
   *     session, or tenant-wide if it was explicitly written as `shared`.
   *  3. Ownerless, tenantless nodes are only visible to ownerless callers
   *     (platform-level seeds), never to an identified user.
   */
  private isNodeInScope(node: MemoryNode, scope: MemoryScope): boolean {
    const nodeTenant = this.normScopeKey(node.tenantId);
    const scopeTenant = this.normScopeKey(scope.tenantId);
    const nodeUser = this.normScopeKey(node.userId);
    const scopeUser = this.normScopeKey(scope.userId);
    const nodeSession = this.normScopeKey(node.sessionId);
    const scopeSession = this.normScopeKey(scope.sessionId);
    // NV-MEM-TENANT-LEGACY-001 — nodes persisted before partner org wiring carry
    // tenant_id NULL while recall scopes include sdkCtx.customerOrgId. Require an
    // owner/session match so this does not become a cross-tenant read.
    if (nodeTenant !== scopeTenant) {
      if (nodeTenant !== null || scopeTenant === null) return false;
      if (scopeUser && nodeUser === scopeUser) return true;
      if (scopeSession && nodeSession && nodeSession === scopeSession) return true;
      return false;
    }

    if (nodeUser) {
      if (scopeUser && nodeUser === scopeUser) return true;
      if (scopeSession && nodeSession && nodeSession === scopeSession) return true;
      // Tenant-wide sharing is opt-in at write time and requires a tenant.
      return node.shared === true && scopeTenant !== null;
    }

    if (nodeSession) {
      return !!scopeSession && nodeSession === scopeSession;
    }

    // Ownerless node: only an ownerless caller in the same tenant partition.
    return !scopeUser || node.shared === true;
  }

  private resolveScope(query: MemoryQuery | MemoryScope): MemoryScope {
    return { tenantId: query.tenantId, userId: query.userId, sessionId: query.sessionId };
  }

  /**
   * Score every in-scope candidate once. `recall` and `traverseEntityGraph`
   * both consume this, which is what removes the second O(n) scan per request.
   *
   * Extracted legal-authority entity nodes are deliberately NOT scored as
   * recall candidates: they are bare labels ("BNSS 482"), so injecting them as
   * memory would spend the character budget on text the user's own query
   * already contains, crowding out substantive prior turns. They remain fully
   * available to graph traversal, which is what they exist for.
   */
  private scoreCandidates(query: MemoryQuery): Array<{ node: MemoryNode; score: number }> {
    const scope = this.resolveScope(query);
    const queryTerms = query.query.toLowerCase().split(/\s+/).filter(t => t.length > 0);
    const scored: Array<{ node: MemoryNode; score: number }> = [];

    for (const node of Array.from(this.nodes.values())) {
      if (!this.isNodeInScope(node, scope)) continue;
      if (!isRecallTrustTierAllowed(node.metadata)) continue;
      if (this.isExtractedEntity(node)) continue;
      if (query.memoryTypes && query.memoryTypes.length > 0 && !query.memoryTypes.includes(node.type)) continue;
      if (query.minImportance !== undefined && node.importance < query.minImportance) continue;
      if (node.decayScore < MEMORY_DECAY_FLOOR) continue;

      const contentLower = node.content.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        if (contentLower.includes(term)) score += 1;
      }

      score *= node.decayScore;
      score *= (1 + node.importance);
      score *= (1 + Math.log10(node.accessCount + 1) * 0.1);

      // NV-MEM-RECENCY-001 — latest in-session turn must outrank stale keyword hits
      // from pooled partner threads (NV-MEM-PARTNER-USER-001 codeword probe).
      if (scope.sessionId && node.sessionId && String(node.sessionId) === String(scope.sessionId)) {
        score += 3;
      }
      const ageMs = Math.max(0, Date.now() - node.createdAt.getTime());
      const ageHours = ageMs / 3_600_000;
      score *= Math.max(0.35, 2 - ageHours * 0.15);

      scored.push({ node, score });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.node.createdAt.getTime() - a.node.createdAt.getTime();
    });
    return scored;
  }

  private isExtractedEntity(node: MemoryNode): boolean {
    return node.type === 'entity' && node.metadata?.legalAuthority === true;
  }

  async queryMemory(query: MemoryQuery): Promise<MemoryResult> {
    return (await this.recall(query)).memory;
  }

  /**
   * Recall + graph traversal from a single scored pass.
   *
   * `limit` is a hard ceiling on returned nodes even when `includeRelated` is
   * set: related nodes compete for the same slots instead of being appended
   * after the fact, which is what previously let a limit-5 query return dozens
   * of nodes and blow the caller's character budget.
   */
  /**
   * NV-MEM-GRAPH-DB-RECALL-001 — hydrate scoped rows before scoring. Writes are
   * write-through (NV-GRAPH-MEMORY-DURABLE-001) but recall only scanned the
   * boot-time hydrate; a recreated gateway pod saw an empty graph until restart.
   */
  private ingestHydratedRow(row: Record<string, unknown>): boolean {
    const v = (typeof row.value === 'string' ? JSON.parse(row.value) : row.value) || {};
    const id = String(row.id);
    if (this.nodes.has(id)) return false;
    const node: MemoryNode = {
      id,
      type: v.type || String(row.memory_type || '').replace(/^graph:/, '') || 'fact',
      content: String(v.content ?? ''),
      metadata: v.metadata || {},
      createdAt: row.created_at ? new Date(String(row.created_at)) : new Date(),
      lastAccessedAt: row.last_accessed_at ? new Date(String(row.last_accessed_at)) : new Date(),
      accessCount: Number(row.access_count) || 0,
      decayScore: typeof v.decayScore === 'number' ? v.decayScore : 1.0,
      importance: Number(row.importance) || 0.5,
      source: v.source || 'user_input',
      userId: row.user_id === 'graph:shared' ? undefined : (row.user_id ?? undefined),
      sessionId: row.session_id ?? undefined,
      tenantId: row.tenant_id ?? undefined,
      shared: v.shared === true,
    } as MemoryNode;
    this.nodes.set(id, node);
    if (node.userId) {
      if (!this.userGraphs.has(node.userId)) this.userGraphs.set(node.userId, new Set());
      this.userGraphs.get(node.userId)!.add(id);
    }
    if (node.sessionId) {
      if (!this.sessionGraphs.has(node.sessionId)) this.sessionGraphs.set(node.sessionId, new Set());
      this.sessionGraphs.get(node.sessionId)!.add(id);
    }
    return true;
  }

  private async ensureScopedHydratedFromDb(scope: MemoryScope, limit = 32): Promise<number> {
    if (!scope.sessionId && !scope.userId) return 0;
    try {
      const { selectRows } = await import('../persistence/jrx-persistence-helper.js');
      const clauses = ["memory_type LIKE 'graph:%'", '(expires_at IS NULL OR expires_at > NOW())'];
      const params: unknown[] = [];
      let n = 1;
      if (scope.sessionId) {
        clauses.push(`session_id = $${n++}`);
        params.push(scope.sessionId);
      } else if (scope.userId) {
        clauses.push(`user_id = $${n++}`);
        params.push(scope.userId);
      }
      params.push(Math.max(1, Math.min(limit, 64)));
      const rows = await selectRows(
        `SELECT id, user_id, tenant_id, memory_type, scope, session_id, value,
                importance, access_count, last_accessed_at, created_at
           FROM ${GraphMemoryService.MEMORY_TABLE}
          WHERE ${clauses.join(' AND ')}
          ORDER BY created_at DESC
          LIMIT $${n}`,
        params,
      );
      let added = 0;
      for (const row of rows) {
        if (this.ingestHydratedRow(row as Record<string, unknown>)) added += 1;
      }
      if (added > 0) {
        logger.info('[graph-memory] scoped db hydrate', {
          sessionId: scope.sessionId,
          userId: scope.userId,
          nodes: added,
        });
      }
      return added;
    } catch (err) {
      logger.warn('[graph-memory] scoped db hydrate failed (non-fatal)', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 0;
    }
  }

  async recall(
    query: MemoryQuery,
    graphOptions: { maxChains?: number } = {},
  ): Promise<MemoryRecall> {
    const startTime = Date.now();
    const scope = this.resolveScope(query);
    const limit = Math.max(0, query.limit ?? 10);

    await this.ensureScopedHydratedFromDb(scope, Math.max(limit * 2, 16));

    const scored = this.scoreCandidates(query);
    const seedCount = query.includeRelated ? Math.max(1, Math.ceil(limit / 2)) : limit;
    const seeds = scored.slice(0, Math.min(seedCount, limit));

    const results: MemoryNode[] = [];
    const relevanceScores = new Map<string, number>();
    for (const { node, score } of seeds) {
      results.push(node);
      relevanceScores.set(node.id, score);
    }

    const relatedEdges: MemoryEdge[] = [];
    const graphNodes: MemoryNode[] = [...results];
    if (query.includeRelated && limit > 0) {
      const nodeIds = new Set(results.map(n => n.id));
      const scoredById = new Map(scored.map(s => [s.node.id, s.score]));
      this.expandGraph(nodeIds, relatedEdges, query.maxHops ?? 2, scope, limit);

      const weakestSeed = seeds.length > 0 ? seeds[seeds.length - 1].score : 0;
      for (const nodeId of Array.from(nodeIds)) {
        if (relevanceScores.has(nodeId)) continue;
        const node = this.nodes.get(nodeId);
        if (!node || !this.isNodeInScope(node, scope)) continue;

        // Entity nodes carry the chains but must not consume a memory slot.
        if (this.isExtractedEntity(node)) {
          graphNodes.push(node);
          continue;
        }
        if (results.length >= limit) continue;

        results.push(node);
        graphNodes.push(node);
        // Graph-reached nodes are supporting context, so they rank strictly
        // below the weakest lexical seed rather than at a fixed 0.5.
        relevanceScores.set(nodeId, scoredById.get(nodeId) ?? Math.min(weakestSeed, 0.5) * 0.5);
      }

      // Only keep edges whose BOTH endpoints survived, otherwise the chain is
      // unrenderable context.
      const kept = new Set(graphNodes.map(n => n.id));
      for (let i = relatedEdges.length - 1; i >= 0; i--) {
        const e = relatedEdges[i];
        if (!kept.has(e.sourceId) || !kept.has(e.targetId)) relatedEdges.splice(i, 1);
      }
    }

    // Backfill unused slots from the lexical tail so a low-connectivity graph
    // never costs the caller recall it asked for.
    if (results.length < limit) {
      for (const { node, score } of scored) {
        if (results.length >= limit) break;
        if (relevanceScores.has(node.id)) continue;
        results.push(node);
        graphNodes.push(node);
        relevanceScores.set(node.id, score);
      }
    }

    // Backfill unused slots from the lexical tail so a low-connectivity graph
    // never costs the caller recall it asked for.
    if (results.length < limit) {
      for (const { node, score } of scored) {
        if (results.length >= limit) break;
        if (relevanceScores.has(node.id)) continue;
        results.push(node);
        relevanceScores.set(node.id, score);
      }
    }

    for (const node of results) {
      node.lastAccessedAt = new Date();
      node.accessCount++;
    }

    // Honest accounting: characters of in-scope memory recall chose NOT to
    // return. This service compresses nothing, so no compression ratio is claimed.
    const returnedIds = new Set(results.map(n => n.id));
    const withheldChars = scored
      .filter(s => !returnedIds.has(s.node.id))
      .reduce((sum, s) => sum + s.node.content.length, 0);

    const memory: MemoryResult = {
      nodes: results,
      edges: relatedEdges,
      relevanceScores,
      totalTokensSaved: Math.ceil(withheldChars / 4),
      retrievalTime: Date.now() - startTime,
    };

    return {
      memory,
      graph: this.buildChains(graphNodes, relatedEdges, graphOptions.maxChains ?? 8),
    };
  }

  async addEpisodicMemory(
    event: string,
    context: Record<string, any>,
    options: {
      userId?: string;
      tenantId?: string;
      sessionId?: string;
      emotionalValence?: number;
      participants?: string[];
      location?: string;
    } = {}
  ): Promise<EpisodicMemory> {
    const memory: EpisodicMemory = {
      id: uuidv4(),
      event,
      timestamp: new Date(),
      context,
      emotionalValence: options.emotionalValence ?? 0,
      participants: options.participants ?? [],
      location: options.location
    };

    this.episodicMemories.set(memory.id, memory);

    await this.addMemory(
      `Event: ${event}`,
      'event',
      { episodicId: memory.id, ...context },
      {
        userId: options.userId,
        tenantId: options.tenantId,
        sessionId: options.sessionId,
        importance: Math.abs(memory.emotionalValence),
      }
    );

    return memory;
  }

  async addSemanticMemory(
    concept: string,
    definition: string,
    relationships: Array<{ concept: string; relation: string }> = [],
    options: { userId?: string; tenantId?: string; sessionId?: string; confidence?: number; sources?: string[] } = {}
  ): Promise<SemanticMemory> {
    const memory: SemanticMemory = {
      id: uuidv4(),
      concept,
      definition,
      relationships,
      confidence: options.confidence ?? 0.8,
      sources: options.sources ?? []
    };

    this.semanticMemories.set(memory.id, memory);

    const scope: MemoryScope = {
      tenantId: options.tenantId,
      userId: options.userId,
      sessionId: options.sessionId,
    };

    const node = await this.addMemory(
      `${concept}: ${definition}`,
      'concept',
      { semanticId: memory.id, confidence: memory.confidence },
      { userId: options.userId, tenantId: options.tenantId, sessionId: options.sessionId, importance: memory.confidence }
    );

    for (const rel of relationships) {
      // Concept resolution is scope-bound: linking to a match outside the
      // writer's scope would expose another tenant's content through traversal.
      const targetNode = Array.from(this.nodes.values()).find(
        n => this.isNodeInScope(n, scope) && n.content.toLowerCase().includes(rel.concept.toLowerCase())
      );
      if (targetNode) {
        await this.addEdge(node.id, targetNode.id, rel.relation);
      }
    }

    return memory;
  }

  async addProceduralMemory(
    skill: string,
    steps: string[],
    options: { userId?: string; tenantId?: string; sessionId?: string; prerequisites?: string[] } = {}
  ): Promise<ProceduralMemory> {
    const memory: ProceduralMemory = {
      id: uuidv4(),
      skill,
      steps,
      prerequisites: options.prerequisites ?? [],
      successRate: 1.0,
      executionCount: 0
    };

    this.proceduralMemories.set(memory.id, memory);

    await this.addMemory(
      `Skill: ${skill}\nSteps: ${steps.join(' -> ')}`,
      'skill',
      { proceduralId: memory.id, stepCount: steps.length },
      { userId: options.userId, tenantId: options.tenantId, sessionId: options.sessionId, importance: 0.9 }
    );

    return memory;
  }

  async updateProceduralSuccess(memoryId: string, success: boolean): Promise<void> {
    const memory = this.proceduralMemories.get(memoryId);
    if (memory) {
      memory.executionCount++;
      const currentWeight = memory.successRate * (memory.executionCount - 1);
      memory.successRate = (currentWeight + (success ? 1 : 0)) / memory.executionCount;
    }
  }

  private async findConflictingMemory(content: string, scope: MemoryScope): Promise<MemoryNode | null> {
    const contentLower = content.toLowerCase();

    for (const node of Array.from(this.nodes.values())) {
      if (!this.isNodeInScope(node, scope)) continue;

      const similarity = this.calculateSimilarity(contentLower, node.content.toLowerCase());
      if (similarity > 0.85) {
        return node;
      }
    }

    return null;
  }

  private async resolveConflict(
    existingNode: MemoryNode,
    newContent: string,
    newMetadata: Record<string, any>
  ): Promise<MemoryNode> {
    const existingDate = existingNode.createdAt;
    const newDate = new Date();
    
    if (newDate > existingDate) {
      existingNode.content = newContent;
      existingNode.metadata = { ...existingNode.metadata, ...newMetadata };
      existingNode.lastAccessedAt = new Date();
      existingNode.accessCount++;
    } else {
      existingNode.accessCount++;
      existingNode.lastAccessedAt = new Date();
    }
    
    return existingNode;
  }

  private calculateSimilarity(a: string, b: string): number {
    const aWords = new Set(a.split(/\s+/));
    const bWords = new Set(b.split(/\s+/));
    
    let intersection = 0;
    for (const word of Array.from(aWords)) {
      if (bWords.has(word)) intersection++;
    }
    
    const aArray = Array.from(aWords);
    const bArray = Array.from(bWords);
    const union = new Set([...aArray, ...bArray]).size;
    return intersection / union;
  }

  private calculateImportance(content: string, type: MemoryNode['type']): number {
    let importance = 0.5;

    const importantKeywords = ['critical', 'important', 'remember', 'always', 'never', 'must', 'key', 'essential'];
    for (const keyword of importantKeywords) {
      if (content.toLowerCase().includes(keyword)) {
        importance += 0.1;
      }
    }

    const typeWeights: Record<MemoryNode['type'], number> = {
      'preference': 0.8,
      'skill': 0.9,
      'fact': 0.7,
      'event': 0.6,
      'entity': 0.5,
      'concept': 0.7
    };
    importance *= typeWeights[type] ?? 1;

    return Math.min(importance, 1.0);
  }

  /**
   * Breadth-first expansion over the adjacency index, bounded by hops and by a
   * node budget. Every reached node is re-checked against the caller's scope so
   * an edge cannot carry a read across a tenant boundary.
   */
  private expandGraph(
    nodeIds: Set<string>,
    edges: MemoryEdge[],
    remainingHops: number,
    scope: MemoryScope,
    maxNodes: number,
  ): void {
    let frontier = Array.from(nodeIds);
    const seenEdges = new Set<string>();

    for (let hop = 0; hop < remainingHops && frontier.length > 0; hop++) {
      const next: string[] = [];

      for (const nodeId of frontier) {
        for (const edgeId of Array.from(this.adjacency.get(nodeId) ?? [])) {
          if (seenEdges.has(edgeId)) continue;
          const edge = this.edges.get(edgeId);
          if (!edge) continue;

          const otherId = edge.sourceId === nodeId ? edge.targetId : edge.sourceId;
          const other = this.nodes.get(otherId);
          if (!other || !this.isNodeInScope(other, scope)) continue;
          if (other.decayScore < MEMORY_DECAY_FLOOR) continue;

          seenEdges.add(edgeId);
          edges.push(edge);

          if (!nodeIds.has(otherId) && nodeIds.size < maxNodes * 3) {
            nodeIds.add(otherId);
            next.push(otherId);
          }
        }
      }

      frontier = next;
    }
  }

  private startDecayProcess(): void {
    this.decayTimer = setInterval(() => {
      this.applyDecay();
    }, 60000);
    // Decay is a housekeeping timer; it must never hold the process open.
    this.decayTimer.unref?.();
  }

  /** Exposed for tests and for deterministic decay verification. */
  applyDecayNow(): void {
    this.applyDecay();
  }

  private applyDecay(): void {
    const now = Date.now();

    for (const node of Array.from(this.nodes.values())) {
      node.decayScore = computeMemoryDecayScore({
        hoursSinceAccess: (now - node.lastAccessedAt.getTime()) / (1000 * 60 * 60),
        importance: node.importance,
        accessCount: node.accessCount,
        decayRatePerDay: this.DECAY_RATE,
      });
    }
  }

  private async enforceMemoryLimit(): Promise<void> {
    if (this.nodes.size <= this.MAX_MEMORY_SIZE) return;

    const sortedNodes = Array.from(this.nodes.values())
      .sort((a, b) => {
        const scoreA = a.decayScore * a.importance;
        const scoreB = b.decayScore * b.importance;
        return scoreA - scoreB;
      });

    const nodesToRemove = sortedNodes.slice(0, this.nodes.size - this.MAX_MEMORY_SIZE);

    for (const node of nodesToRemove) {
      this.removeNode(node.id);
    }
  }

  private removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    for (const edgeId of Array.from(this.adjacency.get(nodeId) ?? [])) {
      this.dropEdge(edgeId);
    }
    this.adjacency.delete(nodeId);
    this.nodes.delete(nodeId);

    if (node.userId) this.userGraphs.get(node.userId)?.delete(nodeId);
    if (node.sessionId) this.sessionGraphs.get(node.sessionId)?.delete(nodeId);
    if (node.type === 'entity') {
      const key = `${this.scopeKey({ tenantId: node.tenantId, userId: node.userId, sessionId: node.sessionId })}::${node.content.toLowerCase()}`;
      if (this.entityIndex.get(key) === nodeId) this.entityIndex.delete(key);
    }
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  async extractSalientFacts(content: string, maxFacts: number = 5): Promise<string[]> {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    const scoredSentences = sentences.map(sentence => {
      let score = 0;
      
      const importantWords = ['is', 'are', 'means', 'defined', 'equals', 'always', 'never', 'must'];
      for (const word of importantWords) {
        if (sentence.toLowerCase().includes(word)) score += 1;
      }
      
      if (sentence.length > 20 && sentence.length < 200) score += 1;
      if (/\d/.test(sentence)) score += 0.5;
      
      return { sentence: sentence.trim(), score };
    });

    scoredSentences.sort((a, b) => b.score - a.score);
    
    return scoredSentences.slice(0, maxFacts).map(s => s.sentence);
  }

  getStats(): {
    totalNodes: number;
    totalEdges: number;
    episodicCount: number;
    semanticCount: number;
    proceduralCount: number;
    averageDecayScore: number;
    userCount: number;
  } {
    const decayScores = Array.from(this.nodes.values()).map(n => n.decayScore);
    const averageDecayScore = decayScores.length > 0
      ? decayScores.reduce((a, b) => a + b, 0) / decayScores.length
      : 0;

    return {
      totalNodes: this.nodes.size,
      totalEdges: this.edges.size,
      episodicCount: this.episodicMemories.size,
      semanticCount: this.semanticMemories.size,
      proceduralCount: this.proceduralMemories.size,
      averageDecayScore,
      userCount: this.userGraphs.size
    };
  }

  /**
   * NV-MEM-GRAPHRAG-001 — chains are built from an already-scored pass, so this
   * costs no extra graph scan. `edge.relationship` is the real field on
   * `MemoryEdge`; the previous code read `edge.type`, which does not exist, so
   * every label silently fell back to `relates_to`.
   */
  private buildChains(
    nodes: MemoryNode[],
    edges: MemoryEdge[],
    maxChains: number,
  ): GraphTraversalResult {
    if (nodes.length === 0) {
      return { chains: [], nodeCount: 0, edgeCount: 0 };
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const chains: string[] = [];
    const seen = new Set<string>();

    const ranked = edges
      .slice()
      .sort((a, b) => (b.weight * b.reinforcementCount) - (a.weight * a.reinforcementCount));

    for (const edge of ranked) {
      if (chains.length >= maxChains) break;
      const src = nodeMap.get(edge.sourceId);
      const tgt = nodeMap.get(edge.targetId);
      if (!src || !tgt) continue;

      const key = `${edge.sourceId}|${edge.relationship}|${edge.targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      chains.push(
        `${this.clip(src.content, 80)} —[${edge.relationship}]→ ${this.clip(tgt.content, 80)}`,
      );
    }

    return { chains, nodeCount: nodes.length, edgeCount: edges.length };
  }

  /**
   * Trim on a word boundary. A mid-word/mid-citation cut can turn
   * "Section 318(4)" into "Section 318(" — a fabricated citation in a legal
   * prompt, which is worse than omitting the item.
   */
  private clip(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const slice = text.slice(0, maxChars);
    const lastBreak = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'));
    return `${(lastBreak > maxChars * 0.5 ? slice.slice(0, lastBreak) : slice).trimEnd()}…`;
  }

  /**
   * GraphRAG traversal — entity-relationship chains as supplementary context.
   * Prefer `recall()` when you also need the memory nodes: it returns both from
   * one scored pass instead of scanning the graph twice per request.
   */
  async traverseEntityGraph(
    query: string,
    options: { userId?: string; tenantId?: string; sessionId?: string; maxHops?: number; maxChains?: number } = {}
  ): Promise<GraphTraversalResult> {
    const { graph } = await this.recall(
      {
        query,
        userId: options.userId,
        tenantId: options.tenantId,
        sessionId: options.sessionId,
        limit: 6,
        includeRelated: true,
        maxHops: options.maxHops ?? 3,
      },
      { maxChains: options.maxChains ?? 8 },
    );
    return graph;
  }

  async clearUserMemory(userId: string): Promise<number> {
    const nodeIds = this.userGraphs.get(userId);
    if (!nodeIds) return 0;

    let removed = 0;
    for (const nodeId of Array.from(nodeIds)) {
      if (!this.nodes.has(nodeId)) continue;
      this.removeNode(nodeId);
      removed++;
    }

    this.userGraphs.delete(userId);
    return removed;
  }
}

export const graphMemoryService = new GraphMemoryService();
export { GraphMemoryService };
export default graphMemoryService;
