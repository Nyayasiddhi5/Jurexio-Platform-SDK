import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';
import { getMemoryCompiler } from './jrx-memory-compiler.js';
import { db as _nvDb } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
import { isJrxFeatureOn } from '../config/jrx-feature-flags.js';

const logger = createLogger('mem0-persistence-service');

// Lazy DB handle — resolved through the project-standard proxy so importing
// this module never throws when the gateway runs without a database (the
// durable path is gated by JRX_F_MEM0_DURABLE and only touched when ON).
const durableDb = lazyRequire(() => _nvDb, 'db');

export interface Mem0Config {
  maxMemoriesPerAgent: number;
  maxMemoriesPerNamespace: number;
  consolidationThreshold: number;
  forgettingHalfLifeMs: number;
  reinforcementBoost: number;
  enableConsolidation: boolean;
  enableForgetting: boolean;
  /**
   * Embedding routing context for the durable path. Kept stable per instance so
   * stored vectors and the query vector come from the SAME model (cosine is only
   * meaningful within one model's space). Defaults to a generic English config
   * that routes through the existing embedding service's default model; operators
   * with a self-hosted Indic/legal model can override jurisdiction/language/
   * docType to select it (see jrx-legal-embedding-service selectModel()).
   */
  embedJurisdiction: 'IN' | 'UK' | 'EU' | 'US' | 'GC' | 'SG';
  embedLanguage: string;
  embedDocType: 'statute' | 'case' | 'contract' | 'pleading' | 'affidavit' | 'order' | 'gazette' | 'other';
}

export interface Memory {
  id: string;
  agentId: string;
  namespace: string;
  type: 'factual' | 'procedural' | 'episodic' | 'semantic';
  content: string;
  summary: string;
  tags: string[];
  importance: number;
  strength: number;
  accessCount: number;
  createdAt: string;
  lastAccessedAt: string;
  lastReinforcedAt: string;
  metadata: Record<string, any>;
  relatedMemoryIds: string[];
  /**
   * Dense vector from the existing embedding service, used for cosine recall on
   * the durable path. Optional: absent when JRX_F_MEM0_DURABLE is OFF or when no
   * embedding provider is configured (recall then falls back to lexical).
   */
  embedding?: number[];
  /** Embedding model id that produced `embedding` (for mismatch detection). */
  embeddingModel?: string;
}

export interface MemorySearchResult {
  memory: Memory;
  relevanceScore: number;
  decayedStrength: number;
  matchType: 'exact' | 'partial' | 'semantic';
}

export interface MemoryConsolidationResult {
  mergedCount: number;
  removedCount: number;
  consolidatedMemories: Memory[];
  timestamp: string;
}

export interface AgentContext {
  agentId: string;
  namespace: string;
  recentMemories: Memory[];
  keyFacts: string[];
  sessionHistory: SessionEntry[];
  totalMemories: number;
  oldestMemory: string | null;
  strongestMemory: Memory | null;
}

export interface SessionEntry {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: string;
  extractedFacts: string[];
}

export interface Mem0Stats {
  totalMemories: number;
  totalAgents: number;
  totalNamespaces: number;
  memoryTypeDistribution: Record<string, number>;
  averageStrength: number;
  consolidationCount: number;
  evictionCount: number;
  searchCount: number;
  averageSearchLatencyMs: number;
  namespaceBreakdown: Record<string, number>;
}

const DEFAULT_CONFIG: Mem0Config = {
  maxMemoriesPerAgent: 1000,
  maxMemoriesPerNamespace: 50000,
  consolidationThreshold: 0.8,
  forgettingHalfLifeMs: 7 * 24 * 60 * 60 * 1000,
  reinforcementBoost: 0.3,
  enableConsolidation: true,
  enableForgetting: true,
  embedJurisdiction: 'GC',
  embedLanguage: 'en',
  embedDocType: 'other',
};

const DEFAULT_NAMESPACE = 'default';
/**
 * Consolidation is an O(n²) similarity sweep plus a compiler pass, so it is
 * rate-limited per namespace rather than run on every turn.
 */
const CONSOLIDATION_COOLDOWN_MS = 10 * 60 * 1000;
const MIN_MEMORIES_BEFORE_CONSOLIDATION = 6;

const FACT_PATTERNS = [
  /\b(?:is|are|was|were|has|have|had)\b/i,
  /\b(?:name|email|phone|address|location|age|role|title)\b/i,
  /\b(?:prefers?|likes?|wants?|needs?|requires?)\b/i,
  /\b(?:always|never|usually|typically|generally)\b/i,
  /\b(?:born|lives?|works?|studies|graduated)\b/i,
];

export class Mem0PersistenceService extends EventEmitter {
  private config: Mem0Config;
  private memories: Map<string, Memory> = new Map();
  private agentMemoryIndex: Map<string, Set<string>> = new Map();
  private namespaceIndex: Map<string, Set<string>> = new Map();
  private sessionStore: Map<string, SessionEntry[]> = new Map();
  private consolidationCount: number = 0;
  private evictionCount: number = 0;
  private searchCount: number = 0;
  private totalSearchLatencyMs: number = 0;
  /** Per-namespace consolidation gate — see `noteTurn`. */
  private lastConsolidationAt: Map<string, number> = new Map();

  constructor(config?: Partial<Mem0Config>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    logger.info('[Mem0] Memory Persistence Service initialized');
    logger.info(`[Mem0] Max per agent: ${this.config.maxMemoriesPerAgent}, Max per namespace: ${this.config.maxMemoriesPerNamespace}`);
    logger.info(`[Mem0] Consolidation threshold: ${this.config.consolidationThreshold}, Half-life: ${(this.config.forgettingHalfLifeMs / (24 * 60 * 60 * 1000)).toFixed(1)} days`);
    logger.info(`[Mem0] Consolidation: ${this.config.enableConsolidation ? 'enabled' : 'disabled'}, Forgetting: ${this.config.enableForgetting ? 'enabled' : 'disabled'}`);
  }

  async store(
    agentId: string,
    content: string,
    options: {
      type?: Memory['type'];
      namespace?: string;
      tags?: string[];
      importance?: number;
      metadata?: Record<string, any>;
    } = {}
  ): Promise<Memory> {
    const namespace = options.namespace || DEFAULT_NAMESPACE;
    const now = new Date().toISOString();

    const memory: Memory = {
      id: randomUUID(),
      agentId,
      namespace,
      type: options.type || 'episodic',
      content,
      summary: this.generateSummary(content),
      tags: options.tags || [],
      importance: this.clamp(options.importance ?? 0.5, 0, 1),
      strength: 1.0,
      accessCount: 0,
      createdAt: now,
      lastAccessedAt: now,
      lastReinforcedAt: now,
      metadata: options.metadata || {},
      relatedMemoryIds: [],
    };

    this.enforceAgentLimit(agentId, namespace);
    this.enforceNamespaceLimit(namespace);

    this.memories.set(memory.id, memory);

    if (!this.agentMemoryIndex.has(agentId)) {
      this.agentMemoryIndex.set(agentId, new Set());
    }
    this.agentMemoryIndex.get(agentId)!.add(memory.id);

    if (!this.namespaceIndex.has(namespace)) {
      this.namespaceIndex.set(namespace, new Set());
    }
    this.namespaceIndex.get(namespace)!.add(memory.id);

    this.linkRelatedMemories(memory);

    // Durable path (JRX_F_MEM0_DURABLE): embed via the existing embedding
    // service and persist so this memory survives a restart and is visible to
    // other replicas. Fail-safe — any error leaves the in-process Map intact.
    if (this.durableEnabled()) {
      await this.persistStoredMemory(memory);
    }

    logger.info(`[Mem0] Stored memory ${memory.id.substring(0, 8)} for agent ${agentId} [${memory.type}] in namespace ${namespace}`);
    this.emit('memory:stored', memory);

    return memory;
  }

  async recall(
    agentId: string,
    query: string,
    options?: {
      namespace?: string;
      limit?: number;
      minStrength?: number;
      types?: Memory['type'][];
    }
  ): Promise<MemorySearchResult[]> {
    const startTime = Date.now();
    this.searchCount++;

    const namespace = options?.namespace;
    const limit = options?.limit || 10;
    const minStrength = options?.minStrength || 0;
    const types = options?.types;

    // Durable path: pull this agent's memories from Postgres into the hot cache
    // so recall reflects writes from other replicas and survives a restart.
    if (this.durableEnabled()) {
      await this.hydrateAgentFromDurable(agentId, namespace);
    }

    const agentMemoryIds = this.agentMemoryIndex.get(agentId);
    if (!agentMemoryIds || agentMemoryIds.size === 0) {
      const latency = Date.now() - startTime;
      this.totalSearchLatencyMs += latency;
      return [];
    }

    const candidates: MemorySearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryTokens = this.tokenize(queryLower);

    // Embedding-backed recall: embed the query through the existing embedding
    // service and score by cosine over stored vectors. If no provider is
    // configured (or the call fails), `queryEmbedding` is null and we degrade
    // EXPLICITLY + LOUDLY to lexical scoring below — never random vectors.
    const queryEmbed = this.durableEnabled()
      ? await this.embedTextOrDegrade(query, 'recall')
      : null;
    const queryEmbedding = queryEmbed?.embedding ?? null;

    const memIds = Array.from(agentMemoryIds);
    for (let idx = 0; idx < memIds.length; idx++) {
      const memory = this.memories.get(memIds[idx]);
      if (!memory) continue;

      if (namespace && memory.namespace !== namespace) continue;
      if (types && !types.includes(memory.type)) continue;

      const decayedStrength = this.computeDecayedStrength(memory);
      if (decayedStrength < minStrength) continue;

      // Prefer cosine when both the query and this memory carry a same-length
      // vector; otherwise fall back to the lexical scorer for this candidate.
      let score: number;
      let matchType: 'exact' | 'partial' | 'semantic';
      const cos = queryEmbedding && memory.embedding
        ? this.cosineSimilarity(queryEmbedding, memory.embedding)
        : null;
      if (cos !== null) {
        score = Math.max(0, cos);
        matchType = 'semantic';
      } else {
        const lexical = this.computeRelevance(memory, queryLower, queryTokens);
        score = lexical.score;
        matchType = lexical.matchType;
      }
      if (score <= 0) continue;

      const recencyBoost = this.computeRecencyBoost(memory);
      const frequencyBoost = Math.min(memory.accessCount * 0.02, 0.2);
      const importanceBoost = memory.importance * 0.15;

      const relevanceScore = this.clamp(
        score + recencyBoost + frequencyBoost + importanceBoost,
        0,
        1
      );

      candidates.push({
        memory,
        relevanceScore,
        decayedStrength,
        matchType,
      });
    }

    candidates.sort((a, b) => {
      const scoreA = a.relevanceScore * a.decayedStrength;
      const scoreB = b.relevanceScore * b.decayedStrength;
      return scoreB - scoreA;
    });

    const results = candidates.slice(0, limit);

    for (const result of results) {
      result.memory.accessCount++;
      result.memory.lastAccessedAt = new Date().toISOString();
    }

    // Persist access bookkeeping for the returned rows (best-effort, off the
    // critical path) so frequency/recency boosts survive a restart too.
    if (this.durableEnabled() && results.length > 0) {
      void this.touchDurable(results.map((r) => ({ id: r.memory.id, accessCount: r.memory.accessCount, lastAccessedAt: r.memory.lastAccessedAt })));
    }

    const latency = Date.now() - startTime;
    this.totalSearchLatencyMs += latency;

    const recallMode = queryEmbedding ? 'embedding' : 'lexical';
    logger.info(`[Mem0] Recall (${recallMode}) for agent ${agentId}: query="${query.substring(0, 50)}", found ${results.length}/${candidates.length} results in ${latency}ms`);
    this.emit('memory:recalled', { agentId, query, resultCount: results.length, latencyMs: latency });

    return results;
  }

  async reinforce(memoryId: string): Promise<Memory | null> {
    const memory = this.memories.get(memoryId);
    if (!memory) {
      logger.info(`[Mem0] Reinforce failed: memory ${memoryId.substring(0, 8)} not found`);
      return null;
    }

    const now = new Date().toISOString();
    memory.strength = this.clamp(memory.strength + this.config.reinforcementBoost, 0, 1);
    memory.lastReinforcedAt = now;
    memory.lastAccessedAt = now;
    memory.accessCount++;

    logger.info(`[Mem0] Reinforced memory ${memoryId.substring(0, 8)}, strength: ${memory.strength.toFixed(3)}`);
    this.emit('memory:reinforced', memory);

    if (this.durableEnabled()) {
      void this.persistStoredMemory(memory, { skipEmbedding: true });
    }

    return memory;
  }

  async forget(memoryId: string): Promise<boolean> {
    const memory = this.memories.get(memoryId);
    if (!memory) {
      return false;
    }

    this.removeMemory(memory);

    if (this.durableEnabled()) {
      void this.deleteDurable(memoryId);
    }

    logger.info(`[Mem0] Forgot memory ${memoryId.substring(0, 8)} for agent ${memory.agentId}`);
    this.emit('memory:forgotten', { memoryId, agentId: memory.agentId });

    return true;
  }

  async getAgentContext(agentId: string, namespace?: string): Promise<AgentContext> {
    const ns = namespace || DEFAULT_NAMESPACE;

    // Durable path: ensure the hot cache reflects the persisted store so the
    // context (and any reinforce/forget keyed off it) works after a restart.
    if (this.durableEnabled()) {
      await this.hydrateAgentFromDurable(agentId, namespace);
    }

    const agentMemoryIds = this.agentMemoryIndex.get(agentId);
    const allMemories: Memory[] = [];

    if (agentMemoryIds) {
      const ids = Array.from(agentMemoryIds);
      for (let i = 0; i < ids.length; i++) {
        const memory = this.memories.get(ids[i]);
        if (memory && (!namespace || memory.namespace === ns)) {
          allMemories.push(memory);
        }
      }
    }

    allMemories.sort((a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime());

    const recentMemories = allMemories.slice(0, 20);

    const keyFacts = this.extractKeyFacts(allMemories);

    const sessionKey = `${agentId}:${ns}`;
    const sessionHistory = this.sessionStore.get(sessionKey) || [];

    let oldestMemory: string | null = null;
    let strongestMemory: Memory | null = null;
    let maxStrength = -1;

    for (const memory of allMemories) {
      if (!oldestMemory || new Date(memory.createdAt).getTime() < new Date(oldestMemory).getTime()) {
        oldestMemory = memory.createdAt;
      }
      const decayed = this.computeDecayedStrength(memory);
      if (decayed > maxStrength) {
        maxStrength = decayed;
        strongestMemory = memory;
      }
    }

    const context: AgentContext = {
      agentId,
      namespace: ns,
      recentMemories,
      keyFacts,
      sessionHistory: sessionHistory.slice(-50),
      totalMemories: allMemories.length,
      oldestMemory,
      strongestMemory,
    };

    logger.info(`[Mem0] Context for agent ${agentId}: ${allMemories.length} memories, ${keyFacts.length} facts, ${sessionHistory.length} session entries`);
    this.emit('context:retrieved', { agentId, namespace: ns, totalMemories: allMemories.length });

    return context;
  }

  async addSessionEntry(
    agentId: string,
    entry: Omit<SessionEntry, 'id' | 'timestamp' | 'extractedFacts'>
  ): Promise<SessionEntry> {
    const namespace = DEFAULT_NAMESPACE;
    const sessionKey = `${agentId}:${namespace}`;

    const extractedFacts = this.extractFactsFromContent(entry.content);

    const sessionEntry: SessionEntry = {
      id: randomUUID(),
      role: entry.role,
      content: entry.content,
      timestamp: new Date().toISOString(),
      extractedFacts,
    };

    if (!this.sessionStore.has(sessionKey)) {
      this.sessionStore.set(sessionKey, []);
    }
    const sessions = this.sessionStore.get(sessionKey)!;
    sessions.push(sessionEntry);

    if (sessions.length > 200) {
      this.sessionStore.set(sessionKey, sessions.slice(-200));
    }

    if (extractedFacts.length > 0) {
      for (const fact of extractedFacts) {
        await this.store(agentId, fact, {
          type: 'factual',
          namespace,
          tags: ['auto-extracted', 'session-fact'],
          importance: 0.6,
          metadata: { sourceSessionEntryId: sessionEntry.id, role: entry.role },
        });
      }
    }

    logger.info(`[Mem0] Session entry added for agent ${agentId} [${entry.role}], extracted ${extractedFacts.length} facts`);
    this.emit('session:entry', { agentId, entryId: sessionEntry.id, role: entry.role, factsExtracted: extractedFacts.length });

    return sessionEntry;
  }

  /**
   * NV-MEM-COMPILER-WIRE-001 — the compiler's read side
   * (`queryKnowledge` + `buildContextFromArticles`) had zero callers, so every
   * compiled article was written and never read: real 800-token compression sat
   * unused while the specialist path injected raw memory instead.
   *
   * The namespace IS the isolation key for compiled articles, so this fails
   * closed on the shared `default` namespace — reading it would serve one
   * tenant's compiled matter knowledge to another.
   */
  async recallCompiledKnowledge(
    agentId: string,
    query: string,
    options: { namespace: string; maxArticles?: number; charCap?: number },
  ): Promise<{ articles: number; context: string; skippedReason?: string }> {
    const ns = String(options.namespace || '').trim();
    if (!ns || ns === DEFAULT_NAMESPACE) {
      return { articles: 0, context: '', skippedReason: 'unscoped-namespace' };
    }
    if (!query.trim()) {
      return { articles: 0, context: '', skippedReason: 'empty-query' };
    }

    const compiler = getMemoryCompiler();
    const articles = compiler.queryKnowledge(agentId, ns, query, options.maxArticles ?? 3);
    if (articles.length === 0) {
      return { articles: 0, context: '', skippedReason: 'no-matching-article' };
    }

    let context = compiler.buildContextFromArticles(articles);
    const cap = options.charCap;
    if (cap && cap > 0 && context.length > cap) {
      // Drop whole articles rather than slicing an article mid-citation.
      const kept: typeof articles = [];
      for (const article of articles) {
        const candidate = compiler.buildContextFromArticles([...kept, article]);
        if (candidate.length > cap) break;
        kept.push(article);
      }
      if (kept.length === 0) {
        return { articles: 0, context: '', skippedReason: 'over-char-budget' };
      }
      context = compiler.buildContextFromArticles(kept);
      return { articles: kept.length, context };
    }

    return { articles: articles.length, context };
  }

  /**
   * Record a live turn into the tenant-scoped namespace the compiler compiles
   * from, and trigger consolidation no more than once per cooldown so the
   * O(n²) similarity sweep cannot run per request.
   */
  async noteTurn(
    agentId: string,
    content: string,
    options: { namespace: string; importance?: number; tags?: string[]; metadata?: Record<string, any> },
  ): Promise<void> {
    const ns = String(options.namespace || '').trim();
    if (!ns || ns === DEFAULT_NAMESPACE) return;

    await this.store(agentId, content, {
      type: 'episodic',
      namespace: ns,
      importance: options.importance ?? 0.6,
      tags: options.tags,
      metadata: options.metadata,
    });

    const key = `${agentId}:${ns}`;
    const last = this.lastConsolidationAt.get(key) ?? 0;
    if (Date.now() - last < CONSOLIDATION_COOLDOWN_MS) return;

    const nsIds = this.namespaceIndex.get(ns);
    if (!nsIds || nsIds.size < MIN_MEMORIES_BEFORE_CONSOLIDATION) return;

    this.lastConsolidationAt.set(key, Date.now());
    await this.consolidate(agentId, ns);
  }

  async consolidate(agentId: string, namespace?: string): Promise<MemoryConsolidationResult> {
    if (!this.config.enableConsolidation) {
      return { mergedCount: 0, removedCount: 0, consolidatedMemories: [], timestamp: new Date().toISOString() };
    }

    const ns = namespace || DEFAULT_NAMESPACE;
    const agentMemoryIds = this.agentMemoryIndex.get(agentId);
    if (!agentMemoryIds || agentMemoryIds.size === 0) {
      return { mergedCount: 0, removedCount: 0, consolidatedMemories: [], timestamp: new Date().toISOString() };
    }

    const targetMemories: Memory[] = [];
    const consolidateIds = Array.from(agentMemoryIds);
    for (let i = 0; i < consolidateIds.length; i++) {
      const memory = this.memories.get(consolidateIds[i]);
      if (memory && memory.namespace === ns) {
        targetMemories.push(memory);
      }
    }

    const mergedPairs: Array<{ kept: Memory; removed: Memory }> = [];
    const removedIds = new Set<string>();

    for (let i = 0; i < targetMemories.length; i++) {
      if (removedIds.has(targetMemories[i].id)) continue;

      for (let j = i + 1; j < targetMemories.length; j++) {
        if (removedIds.has(targetMemories[j].id)) continue;

        const similarity = this.computeJaccardSimilarity(
          targetMemories[i].content.toLowerCase(),
          targetMemories[j].content.toLowerCase()
        );

        if (similarity >= this.config.consolidationThreshold) {
          const kept = targetMemories[i].accessCount >= targetMemories[j].accessCount
            ? targetMemories[i]
            : targetMemories[j];
          const removed = kept === targetMemories[i] ? targetMemories[j] : targetMemories[i];

          kept.strength = this.clamp(kept.strength + removed.strength * 0.5, 0, 1);
          kept.accessCount += removed.accessCount;
          kept.importance = Math.max(kept.importance, removed.importance);

          const mergedTags = new Set([...kept.tags, ...removed.tags]);
          kept.tags = Array.from(mergedTags);

          kept.metadata = { ...removed.metadata, ...kept.metadata, consolidatedFrom: removed.id };

          if (!kept.relatedMemoryIds.includes(removed.id)) {
            kept.relatedMemoryIds.push(removed.id);
          }
          for (const relId of removed.relatedMemoryIds) {
            if (!kept.relatedMemoryIds.includes(relId) && relId !== kept.id) {
              kept.relatedMemoryIds.push(relId);
            }
          }

          removedIds.add(removed.id);
          mergedPairs.push({ kept, removed });
        }
      }
    }

    const consolidatedMemories: Memory[] = [];
    for (const { kept, removed } of mergedPairs) {
      this.removeMemory(removed);
      consolidatedMemories.push(kept);
    }

    this.consolidationCount += mergedPairs.length;

    const result: MemoryConsolidationResult = {
      mergedCount: mergedPairs.length,
      removedCount: removedIds.size,
      consolidatedMemories,
      timestamp: new Date().toISOString(),
    };

    logger.info(`[Mem0] Consolidation for agent ${agentId}: merged ${mergedPairs.length} pairs, removed ${removedIds.size} memories`);
    this.emit('memory:consolidated', result);

    setImmediate(async () => {
      try {
        const compiler = getMemoryCompiler();
        const rawMemories = targetMemories.map(m => ({
          id: m.id,
          content: m.content,
          type: m.type,
          importance: m.importance,
          strength: m.strength,
          tags: m.tags,
          createdAt: m.createdAt,
          metadata: m.metadata,
        }));
        const compilationResult = await compiler.compile(agentId, ns, rawMemories);
        if (compilationResult.articlesCreated > 0 || compilationResult.articlesUpdated > 0) {
          logger.info(`[Mem0] MemoryCompiler: ${compilationResult.articlesCreated} articles created, ${compilationResult.articlesUpdated} updated, token reduction: ${compilationResult.reductionPercent.toFixed(1)}%`);
        }
      } catch (err: unknown) {
        logger.warn(`[Mem0] MemoryCompiler post-consolidation failed (non-blocking): ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    return result;
  }

  /**
   * Cold-cache hydrate for CAM Memory Browser list.
   * After a gateway restart the in-process Map is empty even when
   * `nv_schema.mem0_memories` holds seeded/demo rows — hydrate distinct
   * agents before listing so `/api/jrx/cam/entries` reflects durable data.
   */
  async ensureListHydratedFromDurable(): Promise<void> {
    if (this.memories.size > 0 || !_nvDb) return;
    try {
      const res = await durableDb.execute(sql`
        SELECT DISTINCT agent_id FROM nv_schema.mem0_memories LIMIT 50
      `) as unknown as { rows?: Array<{ agent_id?: string }> };
      const rows: Array<{ agent_id?: string }> = Array.isArray(res)
        ? (res as Array<{ agent_id?: string }>)
        : (res?.rows ?? []);
      for (const row of rows) {
        const agentId = String(row.agent_id ?? '');
        if (agentId) await this.hydrateAgentFromDurable(agentId);
      }
    } catch (err) {
      logger.warn(`[Mem0] list hydrate failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** CAM Memory Browser — list persisted mem0 entries (newest first). */
  listEntries(opts?: { agentId?: string; limit?: number; offset?: number }): {
    entries: Array<{
      id: string;
      agent_id: string;
      request_id?: string;
      scope: string;
      ttl_seconds: number;
      created_at: string;
      payload: Record<string, unknown>;
    }>;
    total: number;
  } {
    let all = Array.from(this.memories.values());
    if (opts?.agentId) {
      all = all.filter(m => m.agentId === opts.agentId);
    }
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const total = all.length;
    const offset = Math.max(opts?.offset ?? 0, 0);
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 200);
    const entries = all.slice(offset, offset + limit).map(m => ({
      id: m.id,
      agent_id: m.agentId,
      scope: m.namespace,
      ttl_seconds: Math.round(this.config.forgettingHalfLifeMs / 1000),
      created_at: m.createdAt,
      payload: {
        type: m.type,
        summary: m.summary,
        content: m.content.slice(0, 500),
        importance: m.importance,
        strength: this.computeDecayedStrength(m),
        tags: m.tags,
        accessCount: m.accessCount,
      },
    }));
    return { entries, total };
  }

  getStats(): Mem0Stats {
    const memoryTypeDistribution: Record<string, number> = {};
    let totalStrength = 0;
    const namespaceBreakdown: Record<string, number> = {};

    const allMemories = Array.from(this.memories.values());
    for (let i = 0; i < allMemories.length; i++) {
      const memory = allMemories[i];
      memoryTypeDistribution[memory.type] = (memoryTypeDistribution[memory.type] || 0) + 1;
      totalStrength += this.computeDecayedStrength(memory);
      namespaceBreakdown[memory.namespace] = (namespaceBreakdown[memory.namespace] || 0) + 1;
    }

    const totalMemories = this.memories.size;
    const averageStrength = totalMemories > 0 ? totalStrength / totalMemories : 0;
    const averageSearchLatencyMs = this.searchCount > 0
      ? this.totalSearchLatencyMs / this.searchCount
      : 0;

    return {
      totalMemories,
      totalAgents: this.agentMemoryIndex.size,
      totalNamespaces: this.namespaceIndex.size,
      memoryTypeDistribution,
      averageStrength,
      consolidationCount: this.consolidationCount,
      evictionCount: this.evictionCount,
      searchCount: this.searchCount,
      averageSearchLatencyMs,
      namespaceBreakdown,
    };
  }

  async clearAgent(agentId: string): Promise<number> {
    const agentMemoryIds = this.agentMemoryIndex.get(agentId);
    if (!agentMemoryIds || agentMemoryIds.size === 0) {
      return 0;
    }

    const count = agentMemoryIds.size;
    const idsToRemove = Array.from(agentMemoryIds);

    for (const memId of idsToRemove) {
      const memory = this.memories.get(memId);
      if (memory) {
        this.removeMemory(memory);
      }
    }

    const sessionKeys = Array.from(this.sessionStore.keys());
    for (let i = 0; i < sessionKeys.length; i++) {
      if (sessionKeys[i].startsWith(`${agentId}:`)) {
        this.sessionStore.delete(sessionKeys[i]);
      }
    }

    logger.info(`[Mem0] Cleared ${count} memories for agent ${agentId}`);
    this.emit('agent:cleared', { agentId, memoriesRemoved: count });

    return count;
  }

  async clearNamespace(namespace: string): Promise<number> {
    const namespaceIds = this.namespaceIndex.get(namespace);
    if (!namespaceIds || namespaceIds.size === 0) {
      return 0;
    }

    const count = namespaceIds.size;
    const idsToRemove = Array.from(namespaceIds);

    for (const memId of idsToRemove) {
      const memory = this.memories.get(memId);
      if (memory) {
        this.removeMemory(memory);
      }
    }

    logger.info(`[Mem0] Cleared ${count} memories in namespace ${namespace}`);
    this.emit('namespace:cleared', { namespace, memoriesRemoved: count });

    return count;
  }

  private computeDecayedStrength(memory: Memory): number {
    if (!this.config.enableForgetting) {
      return memory.strength;
    }

    const now = Date.now();
    const lastReinforced = new Date(memory.lastReinforcedAt).getTime();
    const timeSinceReinforcement = now - lastReinforced;

    const decayed = memory.strength * Math.pow(0.5, timeSinceReinforcement / this.config.forgettingHalfLifeMs);
    return this.clamp(decayed, 0, 1);
  }

  private computeRelevance(
    memory: Memory,
    queryLower: string,
    queryTokens: string[]
  ): { score: number; matchType: 'exact' | 'partial' | 'semantic' } {
    const contentLower = memory.content.toLowerCase();
    const summaryLower = memory.summary.toLowerCase();

    if (contentLower === queryLower || summaryLower === queryLower) {
      return { score: 1.0, matchType: 'exact' };
    }

    if (contentLower.includes(queryLower)) {
      return { score: 0.9, matchType: 'exact' };
    }

    const contentTokens = this.tokenize(contentLower);
    const tagTokens = memory.tags.map(t => t.toLowerCase());
    const allTargetTokens = new Set([...contentTokens, ...tagTokens]);

    let exactMatches = 0;
    for (const qt of queryTokens) {
      if (allTargetTokens.has(qt)) {
        exactMatches++;
      }
    }

    if (queryTokens.length > 0 && exactMatches === queryTokens.length) {
      return { score: 0.85, matchType: 'exact' };
    }

    if (exactMatches > 0) {
      const partialScore = 0.3 + (exactMatches / queryTokens.length) * 0.4;
      return { score: partialScore, matchType: 'partial' };
    }

    const jaccardScore = this.computeJaccardSimilarity(queryLower, contentLower);
    if (jaccardScore > 0.1) {
      return { score: jaccardScore * 0.5, matchType: 'semantic' };
    }

    let semanticScore = 0;
    for (const qt of queryTokens) {
      for (const ct of contentTokens) {
        if (ct.includes(qt) || qt.includes(ct)) {
          semanticScore += 0.1;
        }
      }
    }

    if (semanticScore > 0) {
      return { score: this.clamp(semanticScore, 0, 0.5), matchType: 'semantic' };
    }

    return { score: 0, matchType: 'semantic' };
  }

  private computeRecencyBoost(memory: Memory): number {
    const now = Date.now();
    const lastAccessed = new Date(memory.lastAccessedAt).getTime();
    const ageMs = now - lastAccessed;
    const oneDay = 24 * 60 * 60 * 1000;

    if (ageMs < oneDay) return 0.15;
    if (ageMs < 7 * oneDay) return 0.1;
    if (ageMs < 30 * oneDay) return 0.05;
    return 0;
  }

  private computeJaccardSimilarity(a: string, b: string): number {
    const tokensA = this.tokenize(a);
    const tokensB = this.tokenize(b);
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);

    let intersectionSize = 0;
    const arrA = Array.from(setA);
    for (let i = 0; i < arrA.length; i++) {
      if (setB.has(arrA[i])) {
        intersectionSize++;
      }
    }

    const unionSize = setA.size + setB.size - intersectionSize;
    return unionSize > 0 ? intersectionSize / unionSize : 0;
  }

  private tokenize(text: string): string[] {
    return text.split(/\s+/).filter(t => t.length > 2);
  }

  private generateSummary(content: string): string {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length === 0) return content.substring(0, 100);
    if (sentences.length <= 2) return sentences.join('. ').trim();
    return sentences.slice(0, 2).join('. ').trim() + '.';
  }

  private extractKeyFacts(memories: Memory[]): string[] {
    const facts: string[] = [];
    const seen = new Set<string>();

    const factualMemories = memories
      .filter(m => m.type === 'factual')
      .sort((a, b) => b.importance - a.importance);

    for (const memory of factualMemories) {
      const normalized = memory.content.trim().toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        facts.push(memory.content.trim());
      }
      if (facts.length >= 20) break;
    }

    return facts;
  }

  private extractFactsFromContent(content: string): string[] {
    const facts: string[] = [];
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10);

    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      for (const pattern of FACT_PATTERNS) {
        if (pattern.test(trimmed)) {
          facts.push(trimmed);
          break;
        }
      }
    }

    return facts.slice(0, 5);
  }

  private linkRelatedMemories(newMemory: Memory): void {
    const agentMemoryIds = this.agentMemoryIndex.get(newMemory.agentId);
    if (!agentMemoryIds) return;

    const newTokens = this.tokenize(newMemory.content.toLowerCase());
    if (newTokens.length === 0) return;

    const existingIds = Array.from(agentMemoryIds);
    for (const existingId of existingIds) {
      if (existingId === newMemory.id) continue;
      const existing = this.memories.get(existingId);
      if (!existing || existing.namespace !== newMemory.namespace) continue;

      const similarity = this.computeJaccardSimilarity(
        newMemory.content.toLowerCase(),
        existing.content.toLowerCase()
      );

      if (similarity > 0.3 && similarity < this.config.consolidationThreshold) {
        if (!newMemory.relatedMemoryIds.includes(existingId)) {
          newMemory.relatedMemoryIds.push(existingId);
        }
        if (!existing.relatedMemoryIds.includes(newMemory.id)) {
          existing.relatedMemoryIds.push(newMemory.id);
        }
      }

      if (newMemory.relatedMemoryIds.length >= 10) break;
    }
  }

  private enforceAgentLimit(agentId: string, namespace: string): void {
    const agentMemoryIds = this.agentMemoryIndex.get(agentId);
    if (!agentMemoryIds || agentMemoryIds.size < this.config.maxMemoriesPerAgent) return;

    const agentMemories: Memory[] = [];
    const agentIds = Array.from(agentMemoryIds);
    for (let i = 0; i < agentIds.length; i++) {
      const memory = this.memories.get(agentIds[i]);
      if (memory) agentMemories.push(memory);
    }

    agentMemories.sort((a, b) => {
      const strengthA = this.computeDecayedStrength(a);
      const strengthB = this.computeDecayedStrength(b);
      return strengthA - strengthB;
    });

    const toRemove = agentMemories.slice(0, Math.ceil(agentMemories.length * 0.1));
    for (const memory of toRemove) {
      this.removeMemory(memory);
      this.evictionCount++;
    }

    if (toRemove.length > 0) {
      logger.info(`[Mem0] Evicted ${toRemove.length} weak memories for agent ${agentId}`);
      this.emit('memory:evicted', { agentId, count: toRemove.length });
    }
  }

  private enforceNamespaceLimit(namespace: string): void {
    const namespaceIds = this.namespaceIndex.get(namespace);
    if (!namespaceIds || namespaceIds.size < this.config.maxMemoriesPerNamespace) return;

    const nsMemories: Memory[] = [];
    const nsIdArr = Array.from(namespaceIds);
    for (let i = 0; i < nsIdArr.length; i++) {
      const memory = this.memories.get(nsIdArr[i]);
      if (memory) nsMemories.push(memory);
    }

    nsMemories.sort((a, b) => {
      const strengthA = this.computeDecayedStrength(a);
      const strengthB = this.computeDecayedStrength(b);
      return strengthA - strengthB;
    });

    const toRemove = nsMemories.slice(0, Math.ceil(nsMemories.length * 0.1));
    for (const memory of toRemove) {
      this.removeMemory(memory);
      this.evictionCount++;
    }

    if (toRemove.length > 0) {
      logger.info(`[Mem0] Evicted ${toRemove.length} weak memories from namespace ${namespace}`);
      this.emit('memory:evicted', { namespace, count: toRemove.length });
    }
  }

  private removeMemory(memory: Memory): void {
    this.memories.delete(memory.id);

    const agentIds = this.agentMemoryIndex.get(memory.agentId);
    if (agentIds) {
      agentIds.delete(memory.id);
      if (agentIds.size === 0) {
        this.agentMemoryIndex.delete(memory.agentId);
      }
    }

    const nsIds = this.namespaceIndex.get(memory.namespace);
    if (nsIds) {
      nsIds.delete(memory.id);
      if (nsIds.size === 0) {
        this.namespaceIndex.delete(memory.namespace);
      }
    }

    for (const relId of memory.relatedMemoryIds) {
      const related = this.memories.get(relId);
      if (related) {
        related.relatedMemoryIds = related.relatedMemoryIds.filter(id => id !== memory.id);
      }
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Durable backing (JRX_F_MEM0_DURABLE) — nv_schema.mem0_memories
  //
  // When the flag is OFF, none of the methods below are reached and the service
  // behaves exactly as before (per-process Map, lexical recall). When ON, the
  // Map is a hot cache over the Postgres table; every path fails SAFE back to
  // the cache on a DB or embedding-provider error.
  // ──────────────────────────────────────────────────────────────────────────

  /** Whether the durable + embedding-backed path is enabled. Never throws. */
  private durableEnabled(): boolean {
    try {
      return isJrxFeatureOn('mem0Durable');
    } catch {
      return false;
    }
  }

  /**
   * Embed `text` through the EXISTING legal embedding service. Returns null (and
   * logs LOUDLY) when no provider is configured or the call fails, so callers
   * degrade explicitly to lexical scoring. Never returns a random/synthetic
   * vector — that would silently corrupt similarity ranking.
   */
  private async embedTextOrDegrade(
    text: string,
    phase: 'store' | 'recall',
  ): Promise<{ embedding: number[]; model: string } | null> {
    try {
      const { nvLegalEmbeddingService } = await import('./rag/jrx-legal-embedding-service.js');
      const res = await nvLegalEmbeddingService.embed(text, {
        jurisdiction: this.config.embedJurisdiction,
        language: this.config.embedLanguage,
        docType: this.config.embedDocType,
        namespace: 'user',
      });
      if (Array.isArray(res.embedding) && res.embedding.length > 0) {
        return { embedding: res.embedding, model: res.model };
      }
      logger.warn(`[Mem0] embedding (${phase}) returned an empty vector — degrading to lexical scoring`);
      return null;
    } catch (e) {
      logger.warn(
        `[Mem0] embedding provider unavailable (${phase}) — degrading to lexical scoring (no random vectors): ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /** Cosine similarity over two equal-length vectors; null when incomparable. */
  private cosineSimilarity(a: number[], b: number[]): number | null {
    if (!Array.isArray(a) || !Array.isArray(b)) return null;
    if (a.length === 0 || a.length !== b.length) return null;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? null : dot / magnitude;
  }

  /**
   * Embed (unless asked to skip) and UPSERT a memory row. Mutates `memory`
   * in place with the computed embedding so the hot cache and DB stay aligned.
   */
  private async persistStoredMemory(
    memory: Memory,
    opts?: { skipEmbedding?: boolean },
  ): Promise<void> {
    if (!opts?.skipEmbedding && (!memory.embedding || memory.embedding.length === 0)) {
      const emb = await this.embedTextOrDegrade(memory.content, 'store');
      if (emb) {
        memory.embedding = emb.embedding;
        memory.embeddingModel = emb.model;
      }
    }
    await this.upsertMemoryRow(memory);
  }

  /** Idempotent UPSERT of a single memory row. Best-effort; logs on failure. */
  private async upsertMemoryRow(memory: Memory): Promise<void> {
    if (!_nvDb) {
      logger.warn(`[Mem0] durable write skipped for ${memory.id.substring(0, 8)} — DB handle unavailable`);
      return;
    }
    try {
      const embeddingFragment = memory.embedding && memory.embedding.length > 0
        ? sql`${'{' + memory.embedding.join(',') + '}'}::double precision[]`
        : sql`NULL`;
      await durableDb.execute(sql`
        INSERT INTO nv_schema.mem0_memories
          (id, agent_id, namespace, type, content, summary, tags, importance, strength,
           access_count, embedding, embedding_model, metadata, related_memory_ids,
           created_at, last_accessed_at, last_reinforced_at)
        VALUES (
          ${memory.id}::uuid,
          ${memory.agentId},
          ${memory.namespace},
          ${memory.type},
          ${memory.content},
          ${memory.summary},
          ${JSON.stringify(memory.tags ?? [])}::jsonb,
          ${memory.importance},
          ${memory.strength},
          ${memory.accessCount},
          ${embeddingFragment},
          ${memory.embeddingModel ?? null},
          ${JSON.stringify(memory.metadata ?? {})}::jsonb,
          ${JSON.stringify(memory.relatedMemoryIds ?? [])}::jsonb,
          ${memory.createdAt}::timestamptz,
          ${memory.lastAccessedAt}::timestamptz,
          ${memory.lastReinforcedAt}::timestamptz
        )
        ON CONFLICT (id) DO UPDATE SET
          summary            = EXCLUDED.summary,
          tags               = EXCLUDED.tags,
          importance         = EXCLUDED.importance,
          strength           = EXCLUDED.strength,
          access_count       = EXCLUDED.access_count,
          embedding          = EXCLUDED.embedding,
          embedding_model    = EXCLUDED.embedding_model,
          metadata           = EXCLUDED.metadata,
          related_memory_ids = EXCLUDED.related_memory_ids,
          last_accessed_at   = EXCLUDED.last_accessed_at,
          last_reinforced_at = EXCLUDED.last_reinforced_at
      `);
    } catch (err) {
      logger.warn(`[Mem0] durable write failed for ${memory.id.substring(0, 8)} (kept in cache): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Load an agent's persisted memories into the hot cache. Existing cache
   * entries win (they are at least as fresh). Best-effort; logs on failure.
   */
  private async hydrateAgentFromDurable(agentId: string, namespace?: string): Promise<void> {
    if (!_nvDb) {
      logger.warn(`[Mem0] durable hydrate skipped for agent ${agentId} — DB handle unavailable`);
      return;
    }
    try {
      const nsFragment = namespace ? sql`AND namespace = ${namespace}` : sql``;
      const res = await durableDb.execute(sql`
        SELECT id, agent_id, namespace, type, content, summary, tags, importance, strength,
               access_count, embedding, embedding_model, metadata, related_memory_ids,
               created_at, last_accessed_at, last_reinforced_at
        FROM nv_schema.mem0_memories
        WHERE agent_id = ${agentId} ${nsFragment}
        ORDER BY last_accessed_at DESC
        LIMIT ${this.config.maxMemoriesPerAgent}
      `) as unknown as { rows?: Record<string, unknown>[] };
      const rows: Record<string, unknown>[] = Array.isArray(res)
        ? (res as Record<string, unknown>[])
        : (res?.rows ?? []);
      for (const row of rows) {
        const id = String(row.id);
        if (this.memories.has(id)) continue;
        const mem = this.rowToMemory(row);
        this.memories.set(mem.id, mem);
        if (!this.agentMemoryIndex.has(mem.agentId)) {
          this.agentMemoryIndex.set(mem.agentId, new Set());
        }
        this.agentMemoryIndex.get(mem.agentId)!.add(mem.id);
        if (!this.namespaceIndex.has(mem.namespace)) {
          this.namespaceIndex.set(mem.namespace, new Set());
        }
        this.namespaceIndex.get(mem.namespace)!.add(mem.id);
      }
    } catch (err) {
      logger.warn(`[Mem0] durable hydrate failed for agent ${agentId} (using cache only): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Map a persisted row back into the in-memory Memory shape. */
  private rowToMemory(row: Record<string, unknown>): Memory {
    const toIso = (v: unknown): string => {
      if (v instanceof Date) return v.toISOString();
      if (typeof v === 'string') return v;
      return new Date(v as string | number).toISOString();
    };
    const parseJson = <T>(v: unknown, fallback: T): T => {
      if (v == null) return fallback;
      if (typeof v === 'string') {
        try { return JSON.parse(v) as T; } catch { return fallback; }
      }
      return v as T;
    };
    const embedding = Array.isArray(row.embedding)
      ? (row.embedding as unknown[]).map(Number)
      : (typeof row.embedding === 'string' ? this.parseVectorLiteral(row.embedding) : undefined);
    return {
      id: String(row.id),
      agentId: String(row.agent_id),
      namespace: String(row.namespace),
      type: row.type as Memory['type'],
      content: String(row.content),
      summary: String(row.summary ?? ''),
      tags: parseJson<string[]>(row.tags, []),
      importance: Number(row.importance ?? 0.5),
      strength: Number(row.strength ?? 1),
      accessCount: Number(row.access_count ?? 0),
      createdAt: toIso(row.created_at),
      lastAccessedAt: toIso(row.last_accessed_at),
      lastReinforcedAt: toIso(row.last_reinforced_at),
      metadata: parseJson<Record<string, any>>(row.metadata, {}),
      relatedMemoryIds: parseJson<string[]>(row.related_memory_ids, []),
      embedding: embedding && embedding.length > 0 ? embedding : undefined,
      embeddingModel: row.embedding_model ? String(row.embedding_model) : undefined,
    };
  }

  /** Parse a Postgres array literal (e.g. "{0.1,0.2}") into numbers. */
  private parseVectorLiteral(literal: string): number[] {
    const inner = literal.trim().replace(/^\{/, '').replace(/\}$/, '');
    if (!inner) return [];
    return inner.split(',').map(Number).filter((n) => !Number.isNaN(n));
  }

  /** Persist access bookkeeping for recalled rows. Best-effort, off hot path. */
  private async touchDurable(
    items: Array<{ id: string; accessCount: number; lastAccessedAt: string }>,
  ): Promise<void> {
    if (!_nvDb || items.length === 0) return;
    try {
      for (const it of items) {
        await durableDb.execute(sql`
          UPDATE nv_schema.mem0_memories
          SET access_count = ${it.accessCount},
              last_accessed_at = ${it.lastAccessedAt}::timestamptz
          WHERE id = ${it.id}::uuid
        `);
      }
    } catch (err) {
      logger.warn(`[Mem0] durable access update failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Delete one persisted row. Best-effort; logs on failure. */
  private async deleteDurable(id: string): Promise<void> {
    if (!_nvDb) return;
    try {
      await durableDb.execute(sql`DELETE FROM nv_schema.mem0_memories WHERE id = ${id}::uuid`);
    } catch (err) {
      logger.warn(`[Mem0] durable delete failed for ${id.substring(0, 8)} (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

export const mem0PersistenceService = new Mem0PersistenceService();
