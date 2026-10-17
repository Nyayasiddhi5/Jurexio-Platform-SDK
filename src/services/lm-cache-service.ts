import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger.js';
import {
  createLMCacheBackendFromEnv,
  type LMCacheBackend,
  type SerializedCacheEntry,
} from './lm-cache-backend.js';
import {
  buildCacheKeyParts,
  classifyCompletionForCache,
  escapeNamespace,
  fingerprintKey,
  isFuzzyMatchSafeNamespace,
  resolveCorpusVersion,
  type CacheRejectReason,
} from './jrx-lm-cache-key.js';
import { MODEL_CATALOG } from './intelligent-router/model-catalog.js';
import { isNyvFeatureOn } from '../config/jrx-feature-flags.js';


const logger = createLogger('lm-cache-service');

export interface LMCacheConfig {
  hotCapacity: number;
  warmCapacity: number;
  coldCapacity: number;
  hotTTLMs: number;
  warmTTLMs: number;
  coldTTLMs: number;
  enableSemanticMatching: boolean;
  similarityThreshold: number;
  compressionEnabled: boolean;
  /**
   * NV-LMCACHE-MAX-AGE-001 — absolute age ceiling measured from `createdAt`.
   *
   * The tier TTLs are *idle* timers (`now - lastAccessedAt > ttlMs`), so a
   * popular entry refreshed its own deadline on every hit and could live
   * forever. For a legal cache that is a correctness defect, not a tuning
   * choice: the most-asked statute question is exactly the one whose answer
   * must not outlive the next amendment.
   */
  maxAgeMs: number;
  /**
   * Upper bound on how many stored answers a single semantic lookup may
   * compare against, per namespace. The pre-existing embedding path scanned
   * every tier and embedded each candidate lazily, so a cold cache of 20k
   * entries would spend more on embeddings than the LLM call it was avoiding
   * (plan §6.2). Vectors are built once at write time and held in a bounded
   * index instead.
   */
  semanticCandidatesPerNamespace: number;
  /** Global ceiling on indexed vectors, to bound heap (NYV-LMCACHE-HEAP-CAP-001). */
  semanticMaxVectors: number;
  /**
   * Similarity at/above which a semantically-matched answer may be *served*.
   * Scores between {@link semanticGroundingFloor} and this value are counted as
   * near-misses only — never served — so the value of a future
   * "serve-as-grounding-to-a-cheap-model" band can be measured before anyone
   * relies on it.
   */
  semanticServeThreshold: number;
  semanticGroundingFloor: number;
}

export interface CacheEntry {
  key: string;
  normalizedKey: string;
  value: string;
  metadata: CacheMetadata;
  tier: 'hot' | 'warm' | 'cold';
  createdAt: number;
  lastAccessedAt: number;
  accessCount: number;
  ttlMs: number;
  compressedSize?: number;
  /**
   * Embedding of the entry's stable user turn, built once at write time and
   * held in the bounded semantic index. Absent when semantic matching is off
   * for this namespace or the embedding provider was unavailable — such an
   * entry is still served by exact key, it just cannot be matched fuzzily.
   */
  embedding?: Float32Array;
}

export interface CacheMetadata {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  namespace?: string;
  tags?: string[];
  originalLatencyMs?: number;
  /**
   * Corpus/law version this answer was grounded against
   * ({@link resolveCorpusVersion}). Also folded into the lookup key, so an
   * entry written under an older corpus can neither be found nor served.
   */
  corpusVersion?: string;
  /** The stable user turn the entry was keyed on — used for embeddings. */
  userTurn?: string;
}

export interface CacheLookupResult {
  hit: boolean;
  tier: 'hot' | 'warm' | 'cold' | 'miss';
  entry?: CacheEntry;
  latencyMs: number;
  semanticMatch: boolean;
  similarityScore?: number;
}

/**
 * Real avoided-work accounting for cache hits (plan §6.3). Replaces the former
 * `estimatedCostSaved = hits * 0.002` constant, which was a fabricated number
 * with no relationship to what was actually avoided.
 */
export interface CacheSavings {
  hits: number;
  /** Prompt tokens we did not send. */
  avoidedPromptTokens: number;
  /** Completion tokens we did not generate. */
  avoidedCompletionTokens: number;
  /**
   * True when any component was derived from character counts rather than
   * provider-reported usage — the callers do not currently pass token counts
   * into `set()`, so most rows are estimated. Stated explicitly instead of
   * being presented as measured.
   */
  estimated: boolean;
  /** Priced from `intelligent-router/model-catalog` for the model that would have run. */
  avoidedCostUsd: number;
  /** Per-model attribution: which model each hit displaced. */
  byModel: Record<string, { hits: number; promptTokens: number; completionTokens: number; costUsd: number }>;
  /** Hits for which no model was recorded, so no price could be applied. */
  unpricedHits: number;
}

export interface CacheStats {
  totalEntries: number;
  hotEntries: number;
  warmEntries: number;
  coldEntries: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  hotHitRate: number;
  warmHitRate: number;
  coldHitRate: number;
  /** Hits served by hydrating an entry from the shared (Redis) backend. */
  backendHits: number;
  /** Hits served by embedding similarity rather than an exact key match. */
  semanticHits: number;
  /**
   * Lookups that found a candidate in the grounding band
   * (`semanticGroundingFloor` ≤ score < `semanticServeThreshold`) and
   * deliberately did NOT serve it. Sizes the remaining opportunity honestly.
   */
  semanticNearMisses: number;
  /**
   * Writes refused because the value was an error / empty / abstain / placeholder. nv-allow-placeholder: describes the REJECTION rule.
   */
  rejectedWrites: number;
  rejectedWritesByReason: Record<string, number>;
  /** Entries dropped because they exceeded `maxAgeMs` (stale-grounding guard). */
  staleEvictions: number;
  /**
   * True when a cross-pod / cross-restart shared backend is wired in.
   * NOTE: this reflects configuration, not runtime reachability — a
   * configured backend can still be momentarily unreachable. Call
   * `LMCacheService.pingBackend()` for a live liveness check.
   */
  sharedBackendEnabled: boolean;
  estimatedLatencySavedMs: number;
  /** @deprecated Use {@link savings}. Kept for `nv-health-full-routes.ts:630`. */
  estimatedCostSaved: number;
  savings: CacheSavings;
  evictionCount: number;
  compressionRatio: number;
  namespaces: string[];
  corpusVersion: string;
}

// NYV-LMCACHE-HEAP-CAP-001 (2026-04-30): cold tier was previously 100k entries × 24h TTL,
// which on EC2 dev (running without a Redis shared backend so all tiers live in heap) was a
// material contributor to the 96% heap pressure. Lowered to 20k by default and made all
// capacity/TTL knobs env-configurable so operators can tune per environment without a redeploy.
// Post-architect-review hardening: validate parsed env vars (NaN/0/negative would silently
// produce broken caps under raw Number()) — fall back to default if parse fails.
function envPosInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return fallback;
  return n;
}
/** Same validation for the [0,1] similarity knobs. */
function envUnitFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 1) return fallback;
  return n;
}
const DEFAULT_CONFIG: LMCacheConfig = {
  hotCapacity: envPosInt('NYV_LMCACHE_HOT_CAPACITY', 1_000),
  warmCapacity: envPosInt('NYV_LMCACHE_WARM_CAPACITY', 5_000),
  coldCapacity: envPosInt('NYV_LMCACHE_COLD_CAPACITY', 20_000),
  hotTTLMs: envPosInt('NYV_LMCACHE_HOT_TTL_MS', 300_000),
  warmTTLMs: envPosInt('NYV_LMCACHE_WARM_TTL_MS', 1_800_000),
  coldTTLMs: envPosInt('NYV_LMCACHE_COLD_TTL_MS', 86_400_000),
  enableSemanticMatching: true,
  similarityThreshold: 0.85,
  compressionEnabled: true,
  // 24 h absolute ceiling: long enough to absorb a day of repeat legal traffic,
  // short enough that an un-signalled corpus change self-heals within a day
  // even if nobody bumps NYV_LEGAL_CORPUS_VERSION.
  maxAgeMs: envPosInt('NYV_LMCACHE_MAX_AGE_MS', 86_400_000),
  semanticCandidatesPerNamespace: envPosInt('NYV_LMCACHE_SEMANTIC_CANDIDATES', 200),
  semanticMaxVectors: envPosInt('NYV_LMCACHE_SEMANTIC_MAX_VECTORS', 5_000),
  // 0.94 serve / 0.88 grounding floor are the plan's §6.1 numbers.
  semanticServeThreshold: envUnitFloat('NYV_LMCACHE_SEMANTIC_SERVE_MIN', 0.94),
  semanticGroundingFloor: envUnitFloat('NYV_LMCACHE_SEMANTIC_GROUNDING_MIN', 0.88),
};

const EVICTION_INTERVAL_MS = 60000;

const LEGAL_WARM_ENTRIES: Array<{ prompt: string; response: string; metadata?: CacheMetadata }> = [
  {
    prompt: 'What is the Indian Penal Code?',
    response: 'The Indian Penal Code (IPC) is the official criminal code of India, enacted in 1860 during British rule. It covers all substantive aspects of criminal law and has been the primary criminal code of India for over 160 years.',
    metadata: { namespace: 'legal', tags: ['ipc', 'criminal-law'] },
  },
  {
    prompt: 'What is Section 302 IPC?',
    response: 'Section 302 of the Indian Penal Code deals with punishment for murder. It states that whoever commits murder shall be punished with death or imprisonment for life, and shall also be liable to fine.',
    metadata: { namespace: 'legal', tags: ['ipc', 'murder', 'section-302'] },
  },
  {
    prompt: 'What is habeas corpus?',
    response: 'Habeas corpus is a fundamental legal remedy that protects against unlawful detention. It is a writ that requires a person under arrest to be brought before a judge or into court to determine if their detention is lawful.',
    metadata: { namespace: 'legal', tags: ['writ', 'fundamental-rights'] },
  },
  {
    prompt: 'What is Article 21 of the Indian Constitution?',
    response: 'Article 21 of the Indian Constitution provides that no person shall be deprived of his life or personal liberty except according to procedure established by law. It is one of the most important fundamental rights.',
    metadata: { namespace: 'legal', tags: ['constitution', 'fundamental-rights', 'article-21'] },
  },
  {
    prompt: 'What is a PIL in Indian law?',
    response: 'A Public Interest Litigation (PIL) is a litigation filed in a court of law for the protection of public interest. It can be filed by any public-spirited person and is not necessarily filed by the aggrieved party.',
    metadata: { namespace: 'legal', tags: ['pil', 'public-interest'] },
  },
  {
    prompt: 'What is bail in Indian criminal law?',
    response: 'Bail is the conditional release of an accused person awaiting trial, sometimes on the deposit of a sum of money as security. Indian criminal law provides for regular bail, anticipatory bail, and interim bail under the Code of Criminal Procedure.',
    metadata: { namespace: 'legal', tags: ['bail', 'criminal-law', 'crpc'] },
  },
  {
    prompt: 'What is the Right to Information Act?',
    response: 'The Right to Information Act (RTI), 2005 is an Act of the Parliament of India that sets out the rules and procedures regarding citizens right to information. It empowers every citizen to seek information from public authorities, promoting transparency and accountability.',
    metadata: { namespace: 'legal', tags: ['rti', 'transparency', 'governance'] },
  },
  {
    prompt: 'What is an FIR?',
    response: 'A First Information Report (FIR) is a document prepared by police when they receive information about the commission of a cognizable offence. It is filed under Section 154 of the Code of Criminal Procedure and sets the criminal law in motion.',
    metadata: { namespace: 'legal', tags: ['fir', 'criminal-law', 'police'] },
  },
];

type CacheTier = 'hot' | 'warm' | 'cold';

/**
 * Price the model a cache hit displaced, from the router's own catalog so the
 * dashboard number is auditable against the code rather than a hand-typed
 * table. Read-only import; the catalog is owned elsewhere.
 *
 * Ids arriving from `set()` are whatever the router reported, which may be a
 * provider-qualified variant (`global.anthropic.claude-sonnet-5`) of a catalog
 * id, so an exact miss falls back to a suffix/prefix match before giving up.
 * Unpriced hits are counted separately rather than silently valued at $0.
 */
function getModelPricePer1M(modelId: string): { inPer1M: number; outPer1M: number } | null {
  const exact = MODEL_CATALOG.find((m) => m.id === modelId);
  const entry = exact ?? MODEL_CATALOG.find(
    (m) => modelId.endsWith(m.id) || m.id.endsWith(modelId),
  );
  if (!entry) return null;
  if (!Number.isFinite(entry.costInPer1M) || !Number.isFinite(entry.costOutPer1M)) return null;
  return { inPer1M: entry.costInPer1M, outPer1M: entry.costOutPer1M };
}

export class LMCacheService extends EventEmitter {
  private config: LMCacheConfig;
  private hotTier: Map<string, CacheEntry> = new Map();
  private warmTier: Map<string, CacheEntry> = new Map();
  private coldTier: Map<string, CacheEntry> = new Map();
  private normalizedKeyIndex: Map<string, string> = new Map();
  private evictionTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Optional shared backend (Task #67). When configured, the cache is
   * mirrored to a cross-pod / cross-restart store (Redis) so prompt
   * answers survive process restarts and pod recycles. When null, the
   * service behaves exactly as before — pure in-process tiers — so dev
   * runs are unaffected.
   */
  private backend: LMCacheBackend | null;
  /**
   * Bounded per-namespace ANN candidate index: namespace → entry keys that
   * currently hold an embedding. Replaces the O(total entries) scan-and-embed
   * walk, which cost more than the LLM call it avoided (plan §6.2).
   */
  private semanticIndex: Map<string, Set<string>> = new Map();
  private semanticVectorCount = 0;
  /** Corpus version captured at construction; folded into every key. */
  private readonly corpusVersion: string;
  private stats = {
    totalHits: 0,
    totalMisses: 0,
    hotHits: 0,
    warmHits: 0,
    coldHits: 0,
    backendHits: 0,
    semanticHits: 0,
    semanticNearMisses: 0,
    rejectedWrites: 0,
    rejectedWritesByReason: {} as Partial<Record<CacheRejectReason, number>>,
    staleEvictions: 0,
    evictionCount: 0,
    totalOriginalBytes: 0,
    totalCompressedBytes: 0,
    estimatedLatencySavedMs: 0,
    avoidedPromptTokens: 0,
    avoidedCompletionTokens: 0,
    avoidedCostUsd: 0,
    savingsEstimated: false,
    unpricedHits: 0,
    byModel: {} as Record<string, { hits: number; promptTokens: number; completionTokens: number; costUsd: number }>,
  };

  constructor(config?: Partial<LMCacheConfig>, backend?: LMCacheBackend | null) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.corpusVersion = resolveCorpusVersion();
    // `backend === undefined` → fall back to env-driven autodetection so
    // the singleton picks Redis up automatically when configured. Pass
    // `null` explicitly to force the legacy in-process-only path (used by
    // unit tests that want no backend).
    this.backend = backend === undefined ? createLMCacheBackendFromEnv() : backend;

    this.startEvictionTimer();
    this.populateDefaultEntries();

    logger.info('[LMCache] LLM Inference Cache Service initialized');
    logger.info(`[LMCache] Hot capacity: ${this.config.hotCapacity}, Warm capacity: ${this.config.warmCapacity}, Cold capacity: ${this.config.coldCapacity}`);
    logger.info(`[LMCache] TTLs - Hot: ${this.config.hotTTLMs / 1000}s, Warm: ${this.config.warmTTLMs / 1000}s, Cold: ${this.config.coldTTLMs / 1000}s, MaxAge: ${this.config.maxAgeMs / 1000}s`);
    logger.info(`[LMCache] Semantic matching: ${this.config.enableSemanticMatching ? 'enabled' : 'disabled'}, serve≥${this.config.semanticServeThreshold}, grounding≥${this.config.semanticGroundingFloor}`);
    logger.info(`[LMCache] Compression: ${this.config.compressionEnabled ? 'enabled' : 'disabled'}`);
    logger.info(`[LMCache] Corpus version: ${this.corpusVersion}`);
    logger.info(`[LMCache] Shared backend: ${this.backend ? 'enabled (cache survives restarts/pods)' : 'disabled (in-process only)'}`);
  }

  private populateDefaultEntries(): void {
    const count = this.warmCache(LEGAL_WARM_ENTRIES);
    logger.info(`[LMCache] Pre-warmed cache with ${count} legal query entries`);
  }

  private startEvictionTimer(): void {
    this.evictionTimer = setInterval(() => {
      this.evictExpired();
    }, EVICTION_INTERVAL_MS);
    if (this.evictionTimer.unref) {
      this.evictionTimer.unref();
    }
  }

  private evictExpired(): void {
    const now = Date.now();
    let evicted = 0;
    let stale = 0;

    const evictFromMap = (cache: Map<string, CacheEntry>) => {
      for (const [key, entry] of cache) {
        const idleExpired = now - entry.lastAccessedAt > entry.ttlMs;
        // NV-LMCACHE-MAX-AGE-001: the idle timer above is refreshed by every
        // hit, so without an absolute ceiling the hottest answer never expires
        // — and in legal Q&A the hottest answer is the one most likely to be
        // invalidated by an amendment.
        const tooOld = now - entry.createdAt > this.config.maxAgeMs;
        if (idleExpired || tooOld) {
          cache.delete(key);
          this.normalizedKeyIndex.delete(entry.normalizedKey);
          this.dropFromSemanticIndex(entry);
          evicted++;
          if (tooOld && !idleExpired) stale++;
        }
      }
    };

    evictFromMap(this.hotTier);
    evictFromMap(this.warmTier);
    evictFromMap(this.coldTier);

    if (evicted > 0) {
      this.stats.evictionCount += evicted;
      this.stats.staleEvictions += stale;
      logger.info(`[LMCache] Evicted ${evicted} entries (${stale} past max age)`);
      this.emit('eviction', { count: evicted, staleCount: stale, timestamp: now });
    }
  }

  /**
   * True when the entry is past either deadline. Checked on the read path as
   * well as by the sweeper, because the sweeper runs only once a minute and a
   * stale legal answer must never be served in that window.
   */
  private isExpired(entry: CacheEntry, now: number): boolean {
    if (now - entry.lastAccessedAt > entry.ttlMs) return true;
    if (now - entry.createdAt > this.config.maxAgeMs) return true;
    // Belt-and-braces for entries hydrated from a shared backend written by a
    // pod running an older corpus: the key already carries the version, but an
    // explicit check means a key-format change can never resurrect them.
    if (entry.metadata.corpusVersion && entry.metadata.corpusVersion !== this.corpusVersion) return true;
    return false;
  }

  /**
   * Build the namespace-scoped, corpus-versioned lookup key.
   *
   * Delegates to {@link buildCacheKeyParts} — the single key SSoT — so `get`,
   * `set`, `invalidate` and the shared-backend write can never disagree. This
   * is the fix for the poisoned key: the previous `normalizePrompt` +
   * `indexKey` pair hashed the *assembled* prompt, which carries per-request
   * memory-row ids, timestamps and RRF scores.
   */
  private keyPartsFor(prompt: string, namespace?: string) {
    return buildCacheKeyParts({ prompt, namespace, corpusVersion: this.corpusVersion });
  }

  private lookupKeyFor(prompt: string, namespace?: string): string {
    return this.keyPartsFor(prompt, namespace).lookupKey;
  }

  /**
   * Whether embedding-based matching may run for this namespace.
   *
   * Three conditions, all required:
   *   • `enableSemanticMatching` — the service-level config switch.
   *   • `JRX_F_LMCACHE_SEMANTIC_EMBED` — the ops opt-in. Kept as the gate (and
   *     still default-OFF) because a real embedding call adds latency and cost
   *     to the write path; the key/isolation/staleness fixes ship unconditionally,
   *     only fuzzy *serving* is opt-in. Tests set it explicitly.
   *   • {@link isFuzzyMatchSafeNamespace} — the scope must pin a tenant, since a
   *     fuzzy match deliberately serves an answer built for a different prompt.
   */
  private semanticAllowed(namespace?: string): boolean {
    if (!this.config.enableSemanticMatching) return false;
    if (!isNyvFeatureOn('lmcacheSemanticEmbed')) return false;
    return isFuzzyMatchSafeNamespace(namespace);
  }

  /** Cosine similarity of two equal-length vectors (0 when degenerate). */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  /**
   * Embed text, or return null if the provider is unavailable.
   *
   * Never throws and never fabricates a vector: a synthetic/random vector would
   * corrupt similarity ranking and could serve an unrelated legal answer, which
   * is far worse than a miss.
   */
  private async embedText(text: string): Promise<Float32Array | null> {
    try {
      const { nvLegalEmbeddingService } = await import('./rag/jrx-legal-embedding-service.js');
      const res = await nvLegalEmbeddingService.embed(text, {
        jurisdiction: 'IN' as const,
        language: 'en',
        docType: 'other' as const,
        namespace: 'global' as const,
      });
      const vec = res?.embedding;
      if (!Array.isArray(vec) || vec.length === 0) return null;
      return Float32Array.from(vec);
    } catch (e) {
      logger.warn('[LMCache] embedding provider unavailable; semantic match disabled for this call', {
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
  }

  private addToSemanticIndex(namespace: string, key: string): void {
    let set = this.semanticIndex.get(namespace);
    if (!set) {
      set = new Set<string>();
      this.semanticIndex.set(namespace, set);
    }
    if (set.has(key)) return;
    set.add(key);
    this.semanticVectorCount++;

    // Bound the index per namespace (candidate cost) and globally (heap).
    // Oldest-first eviction: the vector goes, the entry stays exactly-matchable.
    while (set.size > this.config.semanticCandidatesPerNamespace) {
      const oldest = set.values().next().value as string | undefined;
      if (oldest === undefined) break;
      this.dropVector(namespace, oldest);
    }
    while (this.semanticVectorCount > this.config.semanticMaxVectors) {
      const firstNs = this.semanticIndex.keys().next().value as string | undefined;
      if (firstNs === undefined) break;
      const firstSet = this.semanticIndex.get(firstNs);
      const victim = firstSet?.values().next().value as string | undefined;
      if (victim === undefined) {
        this.semanticIndex.delete(firstNs);
        continue;
      }
      this.dropVector(firstNs, victim);
    }
  }

  private dropVector(namespace: string, key: string): void {
    const set = this.semanticIndex.get(namespace);
    if (!set || !set.delete(key)) return;
    this.semanticVectorCount = Math.max(0, this.semanticVectorCount - 1);
    if (set.size === 0) this.semanticIndex.delete(namespace);
    const entry = this.findEntryByKey(key);
    if (entry) delete entry.embedding;
  }

  private dropFromSemanticIndex(entry: CacheEntry): void {
    const ns = entry.metadata.namespace;
    if (!ns) return;
    this.dropVector(ns, entry.key);
  }

  private findEntryByKey(key: string): CacheEntry | undefined {
    return this.hotTier.get(key) ?? this.warmTier.get(key) ?? this.coldTier.get(key);
  }

  /**
   * Embedding-backed semantic match over the bounded per-namespace index.
   *
   * Only ever called with a `namespace` that {@link isFuzzyMatchSafeNamespace}
   * accepted, so a fuzzy match can never cross a tenant boundary. Candidates
   * are additionally re-checked against the caller's namespace and corpus
   * version — the index is keyed by namespace, but an entry could have been
   * re-tiered between index write and read.
   */
  private async findSemanticMatch(
    userTurn: string,
    namespace: string,
  ): Promise<{ key: string; score: number; served: boolean } | null> {
    const candidates = this.semanticIndex.get(namespace);
    if (!candidates || candidates.size === 0) return null;

    const queryVec = await this.embedText(userTurn);
    if (!queryVec) return null;

    const now = Date.now();
    let best: { key: string; score: number } | null = null;
    for (const key of candidates) {
      const entry = this.findEntryByKey(key);
      if (!entry || !entry.embedding) continue;
      if (entry.metadata.namespace !== namespace) continue;
      if (this.isExpired(entry, now)) continue;
      const score = this.cosineSimilarity(queryVec, entry.embedding);
      if (!best || score > best.score) best = { key, score };
    }
    if (!best) return null;

    if (best.score >= this.config.semanticServeThreshold) {
      return { ...best, served: true };
    }
    if (best.score >= this.config.semanticGroundingFloor) {
      // Counted, never served. The grounding band is a measurement surface
      // until a consumer exists that can use a near-answer as context for a
      // cheap model; serving it now would ship a subtly-wrong legal answer.
      this.stats.semanticNearMisses++;
      return { ...best, served: false };
    }
    return null;
  }

  private estimateCompressedSize(value: string): number {
    const originalBytes = Buffer.byteLength(value, 'utf-8');
    const uniqueChars = new Set(value).size;
    const ratio = Math.max(0.3, Math.min(0.9, 1 - (uniqueChars / 256) * 0.5));
    return Math.ceil(originalBytes * ratio);
  }

  private getTierTTL(tier: CacheTier): number {
    switch (tier) {
      case 'hot': return this.config.hotTTLMs;
      case 'warm': return this.config.warmTTLMs;
      case 'cold': return this.config.coldTTLMs;
    }
  }

  private getTierCache(tier: CacheTier): Map<string, CacheEntry> {
    switch (tier) {
      case 'hot': return this.hotTier;
      case 'warm': return this.warmTier;
      case 'cold': return this.coldTier;
    }
  }

  private getTierCapacity(tier: CacheTier): number {
    switch (tier) {
      case 'hot': return this.config.hotCapacity;
      case 'warm': return this.config.warmCapacity;
      case 'cold': return this.config.coldCapacity;
    }
  }

  private evictFromTier(tier: CacheTier): void {
    const cache = this.getTierCache(tier);
    const capacity = this.getTierCapacity(tier);

    while (cache.size >= capacity) {
      let lruKey: string | null = null;
      let lruAccess = Infinity;

      for (const [key, entry] of cache) {
        if (entry.lastAccessedAt < lruAccess) {
          lruAccess = entry.lastAccessedAt;
          lruKey = key;
        }
      }

      if (lruKey) {
        const evictedEntry = cache.get(lruKey)!;
        cache.delete(lruKey);
        this.normalizedKeyIndex.delete(evictedEntry.normalizedKey);
        this.stats.evictionCount++;

        const demotionTier: CacheTier | null = tier === 'hot' ? 'warm' : tier === 'warm' ? 'cold' : null;
        let demoted = false;
        if (demotionTier) {
          const demotionCache = this.getTierCache(demotionTier);
          const demotionCapacity = this.getTierCapacity(demotionTier);
          if (demotionCache.size < demotionCapacity) {
            evictedEntry.tier = demotionTier;
            evictedEntry.ttlMs = this.getTierTTL(demotionTier);
            if (demotionTier === 'cold' && this.config.compressionEnabled) {
              evictedEntry.compressedSize = this.estimateCompressedSize(evictedEntry.value);
            }
            demotionCache.set(lruKey, evictedEntry);
            this.normalizedKeyIndex.set(evictedEntry.normalizedKey, lruKey);
            demoted = true;
          }
        }
        // Only release the vector when the entry actually leaves the cache. A
        // demoted entry is still matchable, and a dangling index key would
        // otherwise leak `semanticVectorCount` and shrink the usable index.
        if (!demoted) this.dropFromSemanticIndex(evictedEntry);
      } else {
        break;
      }
    }
  }

  async get(prompt: string, namespace?: string): Promise<CacheLookupResult> {
    const startTime = Date.now();
    const { userTurn, lookupKey } = this.keyPartsFor(prompt, namespace);

    const existingKey = this.normalizedKeyIndex.get(lookupKey);
    if (existingKey) {
      const tiers: CacheTier[] = ['hot', 'warm', 'cold'];
      for (const tier of tiers) {
        const cache = this.getTierCache(tier);
        const entry = cache.get(existingKey);
        if (entry) {
          const now = Date.now();
          if (this.isExpired(entry, now)) {
            cache.delete(existingKey);
            this.normalizedKeyIndex.delete(lookupKey);
            this.dropFromSemanticIndex(entry);
            // Metered here too, not just in the sweeper: the sweeper runs once
            // a minute, so most stale entries are actually discovered by a
            // reader, and an unmetered drop would make `staleEvictions` read as
            // zero while stale answers were being refused all day.
            this.stats.evictionCount++;
            if (now - entry.lastAccessedAt <= entry.ttlMs) this.stats.staleEvictions++;
            break;
          }
          entry.lastAccessedAt = now;
          entry.accessCount++;
          this.recordHit(tier, entry);

          const latencyMs = Date.now() - startTime;
          logger.info(`[LMCache] Cache hit on ${tier} tier for key ${fingerprintKey(lookupKey)}, access count: ${entry.accessCount}`);
          this.emit('cache:hit', { tier, key: existingKey, latencyMs });

          return {
            hit: true,
            tier,
            entry: { ...entry },
            latencyMs,
            semanticMatch: false,
          };
        }
      }
    }

    /* NV-LMCACHE-SEMANTIC-TENANT-001: fuzzy matching deliberately serves an
     * answer produced for a DIFFERENT prompt, so it is only permitted inside a
     * scope that proves which tenant owns the entry. An unattributable scope
     * (`tenant:global`, `specialist:anon:…`, or a namespace with no tenant
     * dimension at all) falls straight through to the live LLM rather than
     * risking one customer's answer being served to another. */
    if (namespace && this.semanticAllowed(namespace)) {
      const match = await this.findSemanticMatch(userTurn, escapeNamespace(namespace));
      if (match?.served) {
        const entry = this.findEntryByKey(match.key);
        if (entry) {
          const now = Date.now();
          entry.lastAccessedAt = now;
          entry.accessCount++;
          this.recordHit(entry.tier, entry);
          this.stats.semanticHits++;

          const latencyMs = Date.now() - startTime;
          logger.info(`[LMCache] Semantic match on ${entry.tier} tier, similarity: ${match.score.toFixed(4)}`);
          this.emit('cache:hit', { tier: entry.tier, key: match.key, latencyMs, semantic: true, score: match.score });

          return {
            hit: true,
            tier: entry.tier,
            entry: { ...entry },
            latencyMs,
            semanticMatch: true,
            similarityScore: match.score,
          };
        }
      }
    }

    /* Task #67: in-process tiers missed → consult the shared backend.
     * A hit here means the entry was written by either an earlier
     * incarnation of this process (survives restart) or by another pod
     * (survives across the fleet). Hydrate it back into the hot tier so
     * subsequent same-process hits stay on the fast path. Backend faults
     * degrade silently into a normal miss — the live LLM path is the
     * existing fallback. */
    if (this.backend) {
      try {
        const remote = await this.backend.get(lookupKey);
        if (remote) {
          const hydrated = this.hydrateFromBackend(remote, lookupKey);
          // A remote entry can be older than our max-age ceiling (a pod with a
          // longer TTL wrote it), so re-apply the local staleness contract
          // before serving it as an answer.
          if (this.isExpired(hydrated, Date.now())) {
            await this.removeEntry(hydrated, lookupKey);
          } else {
            this.recordHit('hot', hydrated);
            this.stats.backendHits++;
            const latencyMs = Date.now() - startTime;
            logger.info(
              `[LMCache] Shared backend hit for namespace=${namespace ?? 'default'} (hydrated to hot tier)`,
            );
            this.emit('cache:hit', {
              tier: 'hot',
              key: hydrated.key,
              latencyMs,
              sharedBackend: true,
            });
            return {
              hit: true,
              tier: 'hot',
              entry: { ...hydrated },
              latencyMs,
              semanticMatch: false,
            };
          }
        }
      } catch (e) {
        logger.warn('[LMCache] shared backend get failed; treating as miss', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    this.stats.totalMisses++;
    const latencyMs = Date.now() - startTime;
    this.emit('cache:miss', { latencyMs });

    return {
      hit: false,
      tier: 'miss',
      latencyMs,
      semanticMatch: false,
    };
  }

  /** Remove an entry from every index it participates in. */
  private async removeEntry(entry: CacheEntry, lookupKey: string): Promise<void> {
    this.getTierCache(entry.tier).delete(entry.key);
    this.normalizedKeyIndex.delete(lookupKey);
    this.dropFromSemanticIndex(entry);
    if (this.backend) {
      try {
        await this.backend.del(lookupKey);
      } catch {
        /* best-effort: the local copy is already gone, which is what protects
         * this pod from serving it. */
      }
    }
  }

  /**
   * Record a hit plus the work it avoided.
   *
   * Replaces `estimatedCostSaved = hits * 0.002`: we price the model that would
   * actually have run, using the same `model-catalog` the router prices from,
   * and flag the row as estimated whenever we had to fall back to character
   * counts (no caller currently passes token counts into `set()`).
   */
  private recordHit(tier: CacheTier, entry: CacheEntry): void {
    this.stats.totalHits++;
    if (tier === 'hot') this.stats.hotHits++;
    else if (tier === 'warm') this.stats.warmHits++;
    else this.stats.coldHits++;
    this.stats.estimatedLatencySavedMs += entry.metadata.originalLatencyMs || 200;

    const promptTokens = entry.metadata.promptTokens
      ?? Math.ceil((entry.metadata.userTurn ?? entry.normalizedKey).length / 4);
    const completionTokens = entry.metadata.completionTokens
      ?? Math.ceil(entry.value.length / 4);
    if (entry.metadata.promptTokens === undefined || entry.metadata.completionTokens === undefined) {
      this.stats.savingsEstimated = true;
    }

    this.stats.avoidedPromptTokens += promptTokens;
    this.stats.avoidedCompletionTokens += completionTokens;

    const model = entry.metadata.model;
    const price = model ? getModelPricePer1M(model) : null;
    const costUsd = price
      ? (promptTokens / 1e6) * price.inPer1M + (completionTokens / 1e6) * price.outPer1M
      : 0;
    if (!price) this.stats.unpricedHits++;
    this.stats.avoidedCostUsd += costUsd;

    const bucketKey = model ?? 'unknown';
    const bucket = this.stats.byModel[bucketKey] ??= { hits: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
    bucket.hits++;
    bucket.promptTokens += promptTokens;
    bucket.completionTokens += completionTokens;
    bucket.costUsd += costUsd;
  }

  /**
   * Take a serialized entry from the shared backend and place it into
   * the hot tier under a fresh in-process key. Used by both restart
   * recovery and cross-pod sharing (Task #67).
   */
  private hydrateFromBackend(remote: SerializedCacheEntry, lookupKey: string): CacheEntry {
    const key = randomUUID();
    const now = Date.now();
    const entry: CacheEntry = {
      key,
      normalizedKey: lookupKey,
      value: remote.value,
      metadata: remote.metadata || {},
      tier: 'hot',
      createdAt: remote.createdAt || now,
      lastAccessedAt: now,
      accessCount: (remote.accessCount || 0) + 1,
      ttlMs: this.config.hotTTLMs,
    };
    this.evictFromTier('hot');
    this.hotTier.set(key, entry);
    this.normalizedKeyIndex.set(lookupKey, key);
    return entry;
  }

  async set(prompt: string, response: string, metadata?: CacheMetadata): Promise<CacheEntry> {
    const namespace = metadata?.namespace;
    const { userTurn, lookupKey, corpusVersion } = this.keyPartsFor(prompt, namespace);

    /* NV-LMCACHE-NO-POISON-001: an error, an empty completion, a grounded
     * abstain, or a suite placeholder must never enter the cache. Caching one nv-allow-placeholder: REJECTION rule.
     * converts a transient failure into a persistent, fleet-wide wrong answer
     * that reports as a *hit* rather than as an error — so it is both wrong and
     * invisible. Refusals are metered, not swallowed. */
    const verdict = classifyCompletionForCache(response);
    if (!verdict.cacheable) {
      this.stats.rejectedWrites++;
      this.stats.rejectedWritesByReason[verdict.reason] =
        (this.stats.rejectedWritesByReason[verdict.reason] ?? 0) + 1;
      logger.info('[LMCache] refused to cache non-answer', {
        reason: verdict.reason,
        namespace: namespace ?? 'default',
        key: fingerprintKey(lookupKey),
      });
      this.emit('cache:rejected', { reason: verdict.reason, namespace });
      // Return an unstored entry so callers keep their existing (void-ish)
      // contract without having to branch. It is deliberately NOT in any tier.
      const now = Date.now();
      return {
        key: randomUUID(),
        normalizedKey: lookupKey,
        value: response,
        metadata: { ...(metadata ?? {}), corpusVersion, userTurn },
        tier: 'hot',
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        ttlMs: 0,
      };
    }

    const key = randomUUID();
    const now = Date.now();

    this.evictFromTier('hot');

    const originalBytes = Buffer.byteLength(response, 'utf-8');
    this.stats.totalOriginalBytes += originalBytes;

    const entry: CacheEntry = {
      key,
      normalizedKey: lookupKey,
      value: response,
      // Stamp the corpus version + the turn we keyed on so staleness and
      // embedding can both be decided from the entry alone (including after a
      // hydrate from another pod).
      metadata: { ...(metadata ?? {}), corpusVersion, userTurn },
      tier: 'hot',
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      ttlMs: this.config.hotTTLMs,
    };

    this.hotTier.set(key, entry);
    this.normalizedKeyIndex.set(lookupKey, key);

    logger.info(`[LMCache] Stored entry ${fingerprintKey(lookupKey)} in hot tier, size: ${originalBytes} bytes`);
    this.emit('cache:set', { key, tier: 'hot', size: originalBytes });

    /* Embed once, at write time, rather than lazily per lookup. The lazy path
     * embedded every candidate on every miss, so a cold cache spent more on
     * embeddings than the LLM call it was trying to avoid. Only tenant-pinned
     * namespaces get a vector, because only they are allowed to be matched
     * fuzzily. Failure to embed leaves the entry exact-matchable. */
    if (namespace && this.semanticAllowed(namespace)) {
      const vec = await this.embedText(userTurn);
      if (vec) {
        entry.embedding = vec;
        this.addToSemanticIndex(escapeNamespace(namespace), key);
      }
    }

    /* Task #67: write-through to the shared backend so the entry survives
     * restarts and is visible on other pods. We TTL the backend copy with
     * the cold-tier TTL because the in-process tier promotes/demotes
     * locally, but on the wire we want the longest reasonable lifetime
     * (still bounded so stale answers eventually fall out). Capped at
     * `maxAgeMs` so the shared copy cannot outlive the local staleness
     * contract and re-seed an amended answer across the fleet. */
    if (this.backend) {
      const serialized: SerializedCacheEntry = {
        key: entry.key,
        normalizedKey: entry.normalizedKey,
        value: entry.value,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
        lastAccessedAt: entry.lastAccessedAt,
        accessCount: entry.accessCount,
      };
      try {
        await this.backend.set(
          lookupKey,
          serialized,
          Math.min(this.config.coldTTLMs, this.config.maxAgeMs),
        );
      } catch (e) {
        logger.warn('[LMCache] shared backend set failed; in-process write retained', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { ...entry };
  }

  async invalidate(prompt: string, namespace?: string): Promise<boolean> {
    const lookupKey = this.lookupKeyFor(prompt, namespace);
    const existingKey = this.normalizedKeyIndex.get(lookupKey);

    /* Task #67: invalidations must reach the shared backend even when the
     * in-process cache has nothing to remove (e.g. fresh pod that hasn't
     * hydrated yet) — otherwise stale answers will keep surfacing across
     * the fleet. Run the backend delete unconditionally and let the
     * in-process branch decide what to return. */
    if (this.backend) {
      try {
        await this.backend.del(lookupKey);
      } catch (e) {
        logger.warn('[LMCache] shared backend del failed during invalidate', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    if (!existingKey) return false;

    const tiers: CacheTier[] = ['hot', 'warm', 'cold'];
    for (const tier of tiers) {
      const cache = this.getTierCache(tier);
      const entry = cache.get(existingKey);
      if (entry) {
        if (namespace && entry.metadata.namespace !== namespace) continue;
        cache.delete(existingKey);
        this.normalizedKeyIndex.delete(lookupKey);
        this.dropFromSemanticIndex(entry);
        logger.info(`[LMCache] Invalidated entry ${fingerprintKey(lookupKey)} from ${tier} tier`);
        this.emit('cache:invalidate', { key: existingKey, tier });
        return true;
      }
    }

    return false;
  }

  async invalidateNamespace(namespace: string): Promise<number> {
    let count = 0;

    const tiers: CacheTier[] = ['hot', 'warm', 'cold'];
    for (const tier of tiers) {
      const cache = this.getTierCache(tier);
      const keysToDelete: string[] = [];

      for (const [key, entry] of cache) {
        if (entry.metadata.namespace === namespace) {
          keysToDelete.push(key);
        }
      }

      for (const key of keysToDelete) {
        const entry = cache.get(key)!;
        this.normalizedKeyIndex.delete(entry.normalizedKey);
        this.dropFromSemanticIndex(entry);
        cache.delete(key);
        count++;
      }
    }

    /* Task #67: scrub matching keys from the shared backend so other
     * pods don't keep serving them. The backend matches on the literal
     * `${namespace}::` prefix, so it must see the same escaped form the
     * write path used. */
    if (this.backend) {
      try {
        const remoteCount = await this.backend.delByNamespace(escapeNamespace(namespace));
        if (remoteCount > 0) {
          logger.info(
            `[LMCache] Removed ${remoteCount} entries in namespace "${namespace}" from shared backend`,
          );
        }
      } catch (e) {
        logger.warn('[LMCache] shared backend invalidateNamespace failed', {
          namespace,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    logger.info(`[LMCache] Invalidated ${count} entries in namespace "${namespace}"`);
    this.emit('cache:invalidateNamespace', { namespace, count });

    return count;
  }

  /**
   * Bulk invalidation by predicate. Used by the admin "clear cache" flows
   * (Task #66) when content corrections need to flush all entries matching
   * a tenant / jurisdiction / agent filter — not just one exact namespace.
   *
   * Returns the count plus the distinct namespaces that were affected so
   * the caller can write a useful audit record (e.g. "cleared 47 entries
   * across namespaces [...] for jurisdiction=IN").
   */
  async invalidateMatching(
    predicate: (namespace: string | undefined, entry: CacheEntry) => boolean,
  ): Promise<{ count: number; namespaces: string[] }> {
    let count = 0;
    const namespaces = new Set<string>();

    const tiers: CacheTier[] = ['hot', 'warm', 'cold'];
    for (const tier of tiers) {
      const cache = this.getTierCache(tier);
      const keysToDelete: string[] = [];

      for (const [key, entry] of cache) {
        if (predicate(entry.metadata.namespace, entry)) {
          keysToDelete.push(key);
          if (entry.metadata.namespace) namespaces.add(entry.metadata.namespace);
        }
      }

      for (const key of keysToDelete) {
        const entry = cache.get(key)!;
        this.normalizedKeyIndex.delete(entry.normalizedKey);
        this.dropFromSemanticIndex(entry);
        cache.delete(key);
        count++;
      }
    }

    const namespaceList = Array.from(namespaces);
    logger.info(`[LMCache] Bulk-invalidated ${count} entries across ${namespaceList.length} namespaces`);
    this.emit('cache:invalidateMatching', { count, namespaces: namespaceList });

    return { count, namespaces: namespaceList };
  }

  warmCache(entries: Array<{ prompt: string; response: string; metadata?: CacheMetadata }>): number {
    let count = 0;

    for (const entry of entries) {
      const namespace = entry.metadata?.namespace;
      const { userTurn, lookupKey, corpusVersion } = this.keyPartsFor(entry.prompt, namespace);
      const key = randomUUID();
      const now = Date.now();
      const originalBytes = Buffer.byteLength(entry.response, 'utf-8');

      this.evictFromTier('warm');

      const cacheEntry: CacheEntry = {
        key,
        normalizedKey: lookupKey,
        value: entry.response,
        metadata: { ...(entry.metadata ?? {}), corpusVersion, userTurn },
        tier: 'warm',
        createdAt: now,
        lastAccessedAt: now,
        accessCount: 0,
        ttlMs: this.config.warmTTLMs,
      };

      this.warmTier.set(key, cacheEntry);
      this.normalizedKeyIndex.set(lookupKey, key);
      this.stats.totalOriginalBytes += originalBytes;
      count++;
    }

    logger.info(`[LMCache] Warmed cache with ${count} entries`);
    this.emit('cache:warm', { count });

    return count;
  }

  getStats(): CacheStats {
    const totalEntries = this.hotTier.size + this.warmTier.size + this.coldTier.size;
    const totalLookups = this.stats.totalHits + this.stats.totalMisses;
    const hitRate = totalLookups > 0 ? this.stats.totalHits / totalLookups : 0;

    const hotHitRate = totalLookups > 0 ? this.stats.hotHits / totalLookups : 0;
    const warmHitRate = totalLookups > 0 ? this.stats.warmHits / totalLookups : 0;
    const coldHitRate = totalLookups > 0 ? this.stats.coldHits / totalLookups : 0;

    const namespaces = new Set<string>();
    for (const cache of [this.hotTier, this.warmTier, this.coldTier]) {
      for (const [, entry] of cache) {
        if (entry.metadata.namespace) {
          namespaces.add(entry.metadata.namespace);
        }
      }
    }

    let totalCompressed = 0;
    let totalOriginalForCompressed = 0;
    for (const [, entry] of this.coldTier) {
      if (entry.compressedSize) {
        totalCompressed += entry.compressedSize;
        totalOriginalForCompressed += Buffer.byteLength(entry.value, 'utf-8');
      }
    }
    const compressionRatio = totalOriginalForCompressed > 0
      ? totalCompressed / totalOriginalForCompressed
      : 1.0;

    const savings: CacheSavings = {
      hits: this.stats.totalHits,
      avoidedPromptTokens: this.stats.avoidedPromptTokens,
      avoidedCompletionTokens: this.stats.avoidedCompletionTokens,
      estimated: this.stats.savingsEstimated,
      avoidedCostUsd: Math.round(this.stats.avoidedCostUsd * 1e6) / 1e6,
      byModel: Object.fromEntries(
        Object.entries(this.stats.byModel).map(([k, v]) => [k, {
          ...v,
          costUsd: Math.round(v.costUsd * 1e6) / 1e6,
        }]),
      ),
      unpricedHits: this.stats.unpricedHits,
    };

    return {
      totalEntries,
      hotEntries: this.hotTier.size,
      warmEntries: this.warmTier.size,
      coldEntries: this.coldTier.size,
      totalHits: this.stats.totalHits,
      totalMisses: this.stats.totalMisses,
      hitRate,
      hotHitRate,
      warmHitRate,
      coldHitRate,
      backendHits: this.stats.backendHits,
      semanticHits: this.stats.semanticHits,
      semanticNearMisses: this.stats.semanticNearMisses,
      rejectedWrites: this.stats.rejectedWrites,
      rejectedWritesByReason: { ...this.stats.rejectedWritesByReason },
      staleEvictions: this.stats.staleEvictions,
      sharedBackendEnabled: this.backend !== null,
      estimatedLatencySavedMs: this.stats.estimatedLatencySavedMs,
      // Kept as a field so `nv-health-full-routes.ts:630` keeps compiling, but
      // it now carries the *measured* avoided cost instead of `hits * 0.002`.
      estimatedCostSaved: savings.avoidedCostUsd,
      savings,
      evictionCount: this.stats.evictionCount,
      compressionRatio,
      namespaces: Array.from(namespaces),
      corpusVersion: this.corpusVersion,
    };
  }

  async promote(key: string): Promise<boolean> {
    const promotions: Array<{ from: CacheTier; to: CacheTier }> = [
      { from: 'cold', to: 'warm' },
      { from: 'warm', to: 'hot' },
    ];

    for (const { from, to } of promotions) {
      const fromCache = this.getTierCache(from);
      const entry = fromCache.get(key);
      if (entry) {
        fromCache.delete(key);
        this.evictFromTier(to);

        entry.tier = to;
        entry.ttlMs = this.getTierTTL(to);
        entry.lastAccessedAt = Date.now();

        if (to !== 'cold') {
          delete entry.compressedSize;
        }

        const toCache = this.getTierCache(to);
        toCache.set(key, entry);

        logger.info(`[LMCache] Promoted entry ${key.substring(0, 12)} from ${from} to ${to}`);
        this.emit('cache:promote', { key, from, to });

        return true;
      }
    }

    return false;
  }

  async flush(tier?: CacheTier): Promise<number> {
    let count = 0;

    if (tier) {
      const cache = this.getTierCache(tier);
      count = cache.size;
      for (const [, entry] of cache) {
        this.normalizedKeyIndex.delete(entry.normalizedKey);
        this.dropFromSemanticIndex(entry);
      }
      cache.clear();
      logger.info(`[LMCache] Flushed ${count} entries from ${tier} tier`);
    } else {
      count = this.hotTier.size + this.warmTier.size + this.coldTier.size;
      this.hotTier.clear();
      this.warmTier.clear();
      this.coldTier.clear();
      this.normalizedKeyIndex.clear();
      this.semanticIndex.clear();
      this.semanticVectorCount = 0;
      logger.info(`[LMCache] Flushed all ${count} entries from all tiers`);

      /* Task #67: a tier-less flush is a deliberate "wipe everything" —
       * extend it to the shared backend so other pods don't keep serving
       * the entries we just cleared. Per-tier flushes only touch local
       * state (the backend doesn't model tiers). */
      if (this.backend) {
        try {
          const remoteCount = await this.backend.flush();
          if (remoteCount > 0) {
            logger.info(
              `[LMCache] Flushed ${remoteCount} entries from shared backend`,
            );
          }
        } catch (e) {
          logger.warn('[LMCache] shared backend flush failed', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    this.emit('cache:flush', { tier: tier || 'all', count });

    return count;
  }

  /** Task #67: did the cache observe a hit hydrated from the shared backend? */
  hasSharedBackend(): boolean {
    return this.backend !== null;
  }

  /**
   * Liveness probe for the shared backend.
   * Returns:
   *   - `true`  → backend is configured AND reachable right now
   *   - `false` → backend is configured but unreachable (Redis down)
   *   - `null`  → no backend configured (in-process-only mode)
   *
   * Use this for health endpoints that need to distinguish "configured
   * but failing" from "intentionally disabled".
   */
  async pingBackend(): Promise<boolean | null> {
    if (!this.backend) return null;
    if (!this.backend.ping) return true;
    try {
      return await this.backend.ping();
    } catch {
      return false;
    }
  }

  getEntry(key: string): CacheEntry | null {
    const tiers: CacheTier[] = ['hot', 'warm', 'cold'];
    for (const tier of tiers) {
      const cache = this.getTierCache(tier);
      const entry = cache.get(key);
      if (entry) {
        return { ...entry };
      }
    }
    return null;
  }

  /**
   * Expose what a given prompt reduces to before it is keyed.
   *
   * Exists because the poisoned-key defect was invisible from the outside: the
   * cache reported misses and there was no way to see that the key had absorbed
   * a per-request memory-row id. Ops (and the regression tests) can now compare
   * two live prompts and see whether they key identically, rather than
   * inferring it from a hit-rate graph.
   */
  describeKey(prompt: string, namespace?: string): {
    userTurn: string;
    normalized: string;
    corpusVersion: string;
    lookupKey: string;
    fingerprint: string;
    fuzzyMatchAllowed: boolean;
  } {
    const parts = this.keyPartsFor(prompt, namespace);
    return {
      ...parts,
      fingerprint: fingerprintKey(parts.lookupKey),
      fuzzyMatchAllowed: this.semanticAllowed(namespace),
    };
  }

  /** Number of embedding vectors currently indexed (bounded by config). */
  getSemanticIndexSize(): number {
    return this.semanticVectorCount;
  }
}

export const lmCacheService = new LMCacheService();
