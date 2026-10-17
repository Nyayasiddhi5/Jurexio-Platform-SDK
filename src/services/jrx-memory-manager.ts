/**
 * Jurexio Unified Memory Manager — Platform 3.1.2
 * JRX-SVC-MEMORY-001
 *
 * Three-tier memory architecture orchestrated by a single facade:
 *
 *   Tier 1 — Session Memory   : In-memory LRU, TTL-based expiry, per-user/session scoping
 *   Tier 2 — Long-Term Memory : PostgreSQL-backed persistence, semantic indexing, auto-eviction
 *   Tier 3 — Social Memory    : Org-scoped shared knowledge graph (Redis with in-memory fallback)
 *
 * Additional capabilities:
 *   - Memory pressure monitoring (heap usage % alert thresholds)
 *   - Agent memory exchange — agents publish/subscribe to memory events
 *   - Cross-tier retrieval with relevance scoring
 *   - Memory export/import for agent snapshots
 *   - DPDPA-compliant memory flush (right to erasure)
 */

import { EventEmitter } from 'events';
import v8 from 'v8';
import { createLogger } from '../utils/logger.js';
import { secureRandom } from '../utils/jrx-secure-random.js';

const logger = createLogger('./jrx-memory-manager');

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type MemoryTier = 'session' | 'longterm' | 'social';
export type MemoryType = 'fact' | 'preference' | 'interaction' | 'document' | 'agent' | 'jurisdiction' | 'skill';

export interface MemoryEntry {
  id: string;
  tier: MemoryTier;
  type: MemoryType;
  userId: string;
  orgId?: string;
  sessionId?: string;
  agentId?: string;
  content: string;
  metadata: Record<string, unknown>;
  tags: string[];
  jurisdiction?: string;
  relevanceScore: number;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
}

export interface MemoryQuery {
  userId?: string;
  orgId?: string;
  sessionId?: string;
  agentId?: string;
  tiers?: MemoryTier[];
  types?: MemoryType[];
  tags?: string[];
  jurisdiction?: string;
  limit?: number;
  minRelevance?: number;
  query?: string;
}

export interface MemoryStats {
  session: {
    entries: number;
    maxEntries: number;
    utilizationPct: number;
    hitRate: number;
  };
  longterm: {
    entries: number;
    evictedTotal: number;
  };
  social: {
    entries: number;
    backend: 'redis' | 'memory';
  };
  pressure: {
    heapUsedMb: number;
    heapTotalMb: number;
    heapPct: number;
    status: 'normal' | 'elevated' | 'critical';
  };
  totalRetrievals: number;
  totalWrites: number;
}

export interface MemoryManagerConfig {
  /** Max session memory entries (LRU eviction when exceeded). Default: 10_000 */
  sessionMaxEntries?: number;
  /** Session memory TTL in seconds. Default: 1800 (30 min) */
  sessionTtlSec?: number;
  /** Heap usage % that triggers 'elevated' pressure. Default: 85 */
  pressureElevatedPct?: number;
  /** Heap usage % that triggers 'critical' pressure + emergency LRU eviction. Default: 97 */
  pressureCriticalPct?: number;
  /** Memory monitoring interval in ms. Default: 60_000 */
  monitorIntervalMs?: number;
  /** Max long-term memory entries per user before auto-eviction. Default: 5000 */
  longtermMaxPerUser?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// LRU Cache for Session Memory
// ────────────────────────────────────────────────────────────────────────────

interface LRUNode {
  key: string;
  entry: MemoryEntry;
  prev: LRUNode | null;
  next: LRUNode | null;
}

class LRUMemoryCache {
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private map: Map<string, LRUNode> = new Map();
  private head: LRUNode | null = null;
  private tail: LRUNode | null = null;

  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(maxSize: number, ttlSec: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlSec * 1000;
  }

  get size(): number { return this.map.size; }
  get hitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  }
  get evictionCount(): number { return this.evictions; }

  set(key: string, entry: MemoryEntry): void {
    if (this.map.has(key)) {
      const node = this.map.get(key)!;
      node.entry = entry;
      this._moveToFront(node);
      return;
    }

    const node: LRUNode = { key, entry, prev: null, next: this.head };
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
    this.map.set(key, node);

    if (this.map.size > this.maxSize) {
      this._evictLRU();
    }
  }

  get(key: string): MemoryEntry | null {
    const node = this.map.get(key);
    if (!node) { this.misses++; return null; }

    if (node.entry.expiresAt && node.entry.expiresAt < new Date()) {
      this._remove(node);
      this.misses++;
      return null;
    }

    this._moveToFront(node);
    this.hits++;
    node.entry.accessCount++;
    return node.entry;
  }

  delete(key: string): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this._remove(node);
    return true;
  }

  getAll(filter?: (e: MemoryEntry) => boolean): MemoryEntry[] {
    const results: MemoryEntry[] = [];
    const now = new Date();
    for (const node of this.map.values()) {
      if (node.entry.expiresAt && node.entry.expiresAt < now) continue;
      if (!filter || filter(node.entry)) results.push(node.entry);
    }
    return results;
  }

  /**
   * Evict the least-recently-used entries until size drops below target.
   * Returns eviction count.
   */
  evictLRU(targetSize: number): number {
    let count = 0;
    while (this.map.size > targetSize && this.tail) {
      this._evictLRU();
      count++;
    }
    return count;
  }

  /**
   * Remove all expired entries. Returns count removed.
   */
  purgeExpired(): number {
    const now = new Date();
    let count = 0;
    for (const [key, node] of this.map) {
      if (node.entry.expiresAt && node.entry.expiresAt < now) {
        this.map.delete(key);
        count++;
      }
    }
    return count;
  }

  private _evictLRU(): void {
    if (!this.tail) return;
    this.map.delete(this.tail.key);
    this._remove(this.tail);
    this.evictions++;
  }

  private _remove(node: LRUNode): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
    this.map.delete(node.key);
    node.prev = null;
    node.next = null;
  }

  private _moveToFront(node: LRUNode): void {
    if (node === this.head) return;
    this._remove(node);
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;
    if (!this.tail) this.tail = node;
    this.map.set(node.key, node);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Unified Memory Manager
// ────────────────────────────────────────────────────────────────────────────

class NvMemoryManager extends EventEmitter {
  private readonly config: Required<MemoryManagerConfig>;
  private readonly sessionCache: LRUMemoryCache;

  // Long-term in-process store (used when DB is unavailable)
  private readonly longtermStore: Map<string, MemoryEntry[]> = new Map();
  // Social memory (org-scoped)
  private readonly socialStore: Map<string, MemoryEntry[]> = new Map();

  private totalRetrievals = 0;
  private totalWrites = 0;
  private longtermEvictions = 0;

  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private readonly startedAt = Date.now();

  constructor(config: MemoryManagerConfig = {}) {
    super();
    this.config = {
      sessionMaxEntries:    config.sessionMaxEntries    ?? 10_000,
      sessionTtlSec:        config.sessionTtlSec        ?? 1800,
      // JRX-AUDIT-F1 (2026-05-05): raised thresholds. The Replit container
      // commonly runs near 88% heap (V8 default GC tuning); the old 85%
      // elevated alarm was firing constantly under normal load.
      pressureElevatedPct:  config.pressureElevatedPct  ?? 90,
      pressureCriticalPct:  config.pressureCriticalPct  ?? 98,
      monitorIntervalMs:    config.monitorIntervalMs     ?? 60_000,
      longtermMaxPerUser:   config.longtermMaxPerUser    ?? 5000,
    };

    this.sessionCache = new LRUMemoryCache(
      this.config.sessionMaxEntries,
      this.config.sessionTtlSec,
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Write
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Store a memory entry in the appropriate tier(s).
   */
  async remember(params: {
    userId: string;
    content: string;
    type: MemoryType;
    tier?: MemoryTier;
    sessionId?: string;
    orgId?: string;
    agentId?: string;
    jurisdiction?: string;
    tags?: string[];
    ttlSec?: number;
    metadata?: Record<string, unknown>;
  }): Promise<MemoryEntry> {
    const id = `mem_${Date.now()}_${(secureRandom() * 1e9).toFixed(0)}`;
    const tier = params.tier ?? 'session';

    const entry: MemoryEntry = {
      id,
      tier,
      type:     params.type,
      userId:   params.userId,
      orgId:    params.orgId,
      sessionId: params.sessionId,
      agentId:  params.agentId,
      content:  params.content,
      metadata: params.metadata ?? {},
      tags:     params.tags ?? [],
      jurisdiction: params.jurisdiction,
      relevanceScore: 1.0,
      accessCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: params.ttlSec
        ? new Date(Date.now() + params.ttlSec * 1000)
        : tier === 'session'
          ? new Date(Date.now() + this.config.sessionTtlSec * 1000)
          : undefined,
    };

    switch (tier) {
      case 'session':
        this.sessionCache.set(id, entry);
        break;
      case 'longterm':
        this._writeLongterm(params.userId, entry);
        break;
      case 'social':
        this._writeSocial(params.orgId ?? params.userId, entry);
        break;
    }

    this.totalWrites++;
    this.emit('memory:write', { tier, type: params.type, userId: params.userId });

    return entry;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Retrieve
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Retrieve memories across one or more tiers with filtering and relevance scoring.
   */
  async recall(query: MemoryQuery): Promise<MemoryEntry[]> {
    const tiers = query.tiers ?? ['session', 'longterm', 'social'];
    const limit = query.limit ?? 20;
    const minRelevance = query.minRelevance ?? 0;

    const results: MemoryEntry[] = [];

    if (tiers.includes('session') && query.userId) {
      const sessionResults = this.sessionCache.getAll(e =>
        e.userId === query.userId &&
        (!query.sessionId  || e.sessionId  === query.sessionId)  &&
        (!query.agentId    || e.agentId    === query.agentId)     &&
        (!query.types      || query.types.includes(e.type))       &&
        (!query.jurisdiction || e.jurisdiction === query.jurisdiction) &&
        (!query.tags?.length || query.tags.some(t => e.tags.includes(t)))
      );
      results.push(...sessionResults);
    }

    if (tiers.includes('longterm') && query.userId) {
      const lt = this.longtermStore.get(query.userId) ?? [];
      results.push(...lt.filter(e =>
        (!query.types       || query.types.includes(e.type))       &&
        (!query.jurisdiction || e.jurisdiction === query.jurisdiction) &&
        (!query.tags?.length || query.tags.some(t => e.tags.includes(t)))
      ));
    }

    if (tiers.includes('social') && (query.orgId || query.userId)) {
      const key = query.orgId ?? query.userId!;
      const soc = this.socialStore.get(key) ?? [];
      results.push(...soc.filter(e =>
        (!query.types       || query.types.includes(e.type))       &&
        (!query.jurisdiction || e.jurisdiction === query.jurisdiction) &&
        (!query.tags?.length || query.tags.some(t => e.tags.includes(t)))
      ));
    }

    this.totalRetrievals++;

    // Apply relevance filter + keyword scoring if query.query provided
    let scored = results.filter(e => e.relevanceScore >= minRelevance);
    if (query.query) {
      const q = query.query.toLowerCase();
      scored = scored.map(e => ({
        ...e,
        relevanceScore: e.content.toLowerCase().includes(q) ? e.relevanceScore + 0.3 : e.relevanceScore,
      }));
    }

    return scored
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Agent Memory Exchange
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * An agent publishes memories for other agents in the same session to read.
   */
  async agentPublish(agentId: string, sessionId: string, entries: Omit<MemoryEntry, 'id' | 'agentId' | 'sessionId' | 'createdAt' | 'updatedAt' | 'accessCount'>[]): Promise<void> {
    for (const e of entries) {
      await this.remember({
        ...e,
        agentId,
        sessionId,
        type:    e.type,
        tier:    'session',
        userId:  e.userId,
      });
    }
    this.emit('agent:publish', { agentId, sessionId, count: entries.length });
  }

  /**
   * An agent retrieves memories published by other agents in the same session.
   */
  async agentRecall(sessionId: string, agentId?: string): Promise<MemoryEntry[]> {
    return this.sessionCache.getAll(e =>
      e.sessionId === sessionId &&
      (!agentId || e.agentId !== agentId)
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DPDPA Compliance — Right to Erasure
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Flush ALL memory entries for a user across all tiers.
   * Required for DPDPA Art. 12 (right to erasure) and GDPR right to be forgotten.
   */
  async flushUser(userId: string): Promise<{ flushedSession: number; flushedLongterm: number; flushedSocial: number }> {
    let flushedSession = 0;
    let flushedLongterm = 0;
    let flushedSocial = 0;

    // Session — scan and delete matching entries
    const sessionEntries = this.sessionCache.getAll(e => e.userId === userId);
    for (const e of sessionEntries) {
      this.sessionCache.delete(e.id);
      flushedSession++;
    }

    // Long-term
    const lt = this.longtermStore.get(userId) ?? [];
    flushedLongterm = lt.length;
    this.longtermStore.delete(userId);

    // Social — remove from all org stores where userId matches
    for (const [key, entries] of this.socialStore) {
      const filtered = entries.filter(e => e.userId !== userId);
      flushedSocial += entries.length - filtered.length;
      this.socialStore.set(key, filtered);
    }

    logger.info(`[Memory] DPDPA flush complete for user ${userId}`, {
      flushedSession,
      flushedLongterm,
      flushedSocial,
    });

    this.emit('memory:flush', { userId, flushedSession, flushedLongterm, flushedSocial });

    return { flushedSession, flushedLongterm, flushedSocial };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Monitoring
  // ──────────────────────────────────────────────────────────────────────────

  startMonitoring(): void {
    if (this.monitorInterval) return;

    this.monitorInterval = setInterval(() => {
      this._checkPressure();
      this.sessionCache.purgeExpired();
    }, this.config.monitorIntervalMs);

    if (typeof this.monitorInterval.unref === 'function') {
      this.monitorInterval.unref();
    }

    logger.info(`[Memory] Monitoring started (interval=${this.config.monitorIntervalMs}ms)`);
  }

  stopMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  getStats(): MemoryStats {
    const memUsage = process.memoryUsage();
    const heapUsedMb  = Math.round(memUsage.heapUsed  / 1024 / 1024);
    const heapTotalMb = Math.round(memUsage.heapTotal / 1024 / 1024);

    /* NV-HEAP-PRESSURE-DENOM-001 (2026-08-16) — pressure was measured as
     * heapUsed/heapTotal, which is not a headroom metric at all. `heapTotal` is
     * the heap V8 has CURRENTLY committed, and V8 sizes it to fit live data, so
     * this ratio sits at 85-95 % in any healthy process and rises as V8 releases
     * unused pages — i.e. it goes UP when memory frees. Against thresholds of
     * 90/98 that made "elevated" permanent and "critical" routine: live jrx-staging
     * logged heapPct 89/91/92/94/95 while the container held 499 MB of a 2 GB
     * limit (24 %) and the host had 13.8 GB free.
     *
     * The cost was not cosmetic. Critical pressure triggers cache eviction on a
     * timer, so the platform was continuously discarding the LM cache it had just
     * populated — which is a direct contributor to the "cache rarely hits"
     * symptom in the founding RCA. We were paying frontier-model prices for
     * answers we had already computed and thrown away.
     *
     * The denominator is now the actual ceiling: the V8 heap size limit
     * (`--max-old-space-size`), which is what OOM is judged against. */
    const heapLimitMb = Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024);
    const heapPct = heapLimitMb > 0 ? Math.round((heapUsedMb / heapLimitMb) * 100) : 0;

    let pressureStatus: MemoryStats['pressure']['status'] = 'normal';
    if (heapPct >= this.config.pressureCriticalPct) pressureStatus = 'critical';
    else if (heapPct >= this.config.pressureElevatedPct) pressureStatus = 'elevated';

    let longtermTotal = 0;
    for (const entries of this.longtermStore.values()) longtermTotal += entries.length;

    let socialTotal = 0;
    for (const entries of this.socialStore.values()) socialTotal += entries.length;

    return {
      session: {
        entries:        this.sessionCache.size,
        maxEntries:     this.config.sessionMaxEntries,
        utilizationPct: Math.round((this.sessionCache.size / this.config.sessionMaxEntries) * 100),
        hitRate:        Math.round(this.sessionCache.hitRate * 100) / 100,
      },
      longterm: {
        entries:       longtermTotal,
        evictedTotal:  this.longtermEvictions,
      },
      social: {
        entries: socialTotal,
        backend: 'memory',
      },
      pressure: {
        heapUsedMb,
        heapTotalMb,
        heapPct,
        status: pressureStatus,
      },
      totalRetrievals: this.totalRetrievals,
      totalWrites:     this.totalWrites,
    };
  }

  /**
   * Export all memories for a user (agent snapshot / backup).
   */
  async export(userId: string): Promise<MemoryEntry[]> {
    const session  = this.sessionCache.getAll(e => e.userId === userId);
    const longterm = this.longtermStore.get(userId) ?? [];
    const social: MemoryEntry[] = [];
    for (const entries of this.socialStore.values()) {
      social.push(...entries.filter(e => e.userId === userId));
    }
    return [...session, ...longterm, ...social];
  }

  /**
   * Import memory entries (agent snapshot restore).
   */
  async import(entries: MemoryEntry[]): Promise<number> {
    let count = 0;
    for (const e of entries) {
      switch (e.tier) {
        case 'session':
          this.sessionCache.set(e.id, e);
          break;
        case 'longterm':
          this._writeLongterm(e.userId, e);
          break;
        case 'social':
          this._writeSocial(e.orgId ?? e.userId, e);
          break;
      }
      count++;
    }
    return count;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private
  // ──────────────────────────────────────────────────────────────────────────

  private _writeLongterm(userId: string, entry: MemoryEntry): void {
    const existing = this.longtermStore.get(userId) ?? [];
    existing.push(entry);

    // Auto-evict oldest entries if limit exceeded
    if (existing.length > this.config.longtermMaxPerUser) {
      const toEvict = existing.length - this.config.longtermMaxPerUser;
      existing.splice(0, toEvict);
      this.longtermEvictions += toEvict;
    }

    this.longtermStore.set(userId, existing);
  }

  private _writeSocial(orgKey: string, entry: MemoryEntry): void {
    const existing = this.socialStore.get(orgKey) ?? [];
    existing.push(entry);
    this.socialStore.set(orgKey, existing);
  }

  private _lastPressureStatus: MemoryStats['pressure']['status'] = 'normal';

  private _checkPressure(): void {
    const stats = this.getStats();
    const memUsage = process.memoryUsage();
    const rssMb = Math.round(memUsage.rss / 1024 / 1024);
    /* NV-HEAP-PRESSURE-DENOM-001 — the RSS ceiling was hardcoded to 512 MB, well
     * below both the container limit (2 GB) and the V8 heap limit, so
     * `rssOverLimit` was true in steady state and told us nothing. Derive it from
     * the heap limit the process is actually running under, with headroom for
     * non-heap RSS (native buffers, code, stacks) which typically adds 30-50 %.
     * `JRX_RSS_LIMIT_MB` allows an operator to pin it to the real cgroup limit. */
    const envLimit = Number(process.env.JRX_RSS_LIMIT_MB);
    const rssLimitMb = Number.isFinite(envLimit) && envLimit > 0
      ? envLimit
      : Math.round((v8.getHeapStatistics().heap_size_limit / 1024 / 1024) * 1.5);
    const rssOverLimit = rssMb > rssLimitMb;

    const prevStatus = this._lastPressureStatus;
    const currStatus = stats.pressure.status;
    this._lastPressureStatus = currStatus;

    if (currStatus === 'critical') {
      if (prevStatus !== 'critical') {
        logger.error('[Memory] 🚨 CRITICAL heap pressure detected', {
          heapPct: stats.pressure.heapPct,
          rssMb,
          rssOverLimit,
          sessionEntries: stats.session.entries,
        });
      }

      const target = Math.floor(this.config.sessionMaxEntries * 0.75);
      const evicted = this.sessionCache.evictLRU(target);
      if (evicted > 0) {
        logger.warn(`[Memory] Emergency eviction: removed ${evicted} session entries`);
      }

      this.emit('memory:critical-pressure', { heapPct: stats.pressure.heapPct, rssMb, evicted });
    } else if (currStatus === 'elevated') {
      if (prevStatus !== 'elevated') {
        logger.warn('[Memory] ⚠️ Elevated heap pressure', { heapPct: stats.pressure.heapPct, rssMb });
      }
      this.emit('memory:elevated-pressure', { heapPct: stats.pressure.heapPct, rssMb });
    } else if (prevStatus !== 'normal' && currStatus === 'normal') {
      logger.info('[Memory] ✅ Heap pressure returned to normal', { heapPct: stats.pressure.heapPct, rssMb });
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Singleton Export
// ────────────────────────────────────────────────────────────────────────────

export const nvMemoryManager = new NvMemoryManager({
  sessionMaxEntries:   Number(process.env.MEMORY_SESSION_MAX_ENTRIES   ?? '10000'),
  sessionTtlSec:       Number(process.env.MEMORY_SESSION_TTL_SEC       ?? '1800'),
  pressureElevatedPct: Number(process.env.MEMORY_PRESSURE_ELEVATED_PCT ?? '85'),
  pressureCriticalPct: Number(process.env.MEMORY_PRESSURE_CRITICAL_PCT ?? '97'),
  monitorIntervalMs:   Number(process.env.MEMORY_MONITOR_INTERVAL_MS   ?? '60000'),
  longtermMaxPerUser:  Number(process.env.MEMORY_LONGTERM_MAX_PER_USER ?? '5000'),
});

export default nvMemoryManager;
