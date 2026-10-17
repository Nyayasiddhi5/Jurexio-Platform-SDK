/**
 * Jurexio Redis Cache Service
 * @version 3.1.2
 *
 * Multi-purpose Redis integration:
 *   1. Semantic LLM response cache (TTL: 5 min hot, 1 h warm, 24 h cold)
 *   2. Distributed rate-limit counters (cross-pod)
 *   3. Session store for WebSocket connections
 *   4. Job queue result caching
 *   5. Statute DB query cache
 *   6. MCP tool invocation cache (idempotent tools only)
 *
 * Falls back gracefully to in-memory LRU cache if Redis is unavailable.
 * In-memory fallback is per-pod only (not shared across replicas).
 */

import { createLogger } from '../utils/logger.js';
import { resolveRedisTcpUrl, logRedisDisabledOnce } from '../utils/redis-tcp-url.js';

const logger = createLogger('redis-cache');

// ─────────────────────────────────────────────────────────────────────────────
// IN-MEMORY LRU FALLBACK (when Redis is unavailable)
// ─────────────────────────────────────────────────────────────────────────────

interface LRUEntry<T> {
  value: T;
  expiresAt: number;
  hits: number;
  createdAt: number;
}

class InMemoryLRU<T = any> {
  private store = new Map<string, LRUEntry<T>>();
  private readonly maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
    // GC every 5 minutes
    setInterval(() => this.gc(), 5 * 60 * 1000);
  }

  set(key: string, value: T, ttlMs: number): void {
    if (this.store.size >= this.maxSize) {
      // Evict oldest entry
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs, hits: 0, createdAt: Date.now() });
  }

  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.store.delete(key); return null; }
    entry.hits++;
    return entry.value;
  }

  del(key: string): void { this.store.delete(key); }

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiresAt) { this.store.delete(key); return false; }
    return true;
  }

  size(): number { return this.store.size; }

  private gc(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  stats(): { size: number; maxSize: number; hitRate: string } {
    const entries = [...this.store.values()];
    const totalHits = entries.reduce((s, e) => s + e.hits, 0);
    const totalRequests = entries.length + totalHits;
    return { size: this.store.size, maxSize: this.maxSize, hitRate: totalRequests > 0 ? `${((totalHits / totalRequests) * 100).toFixed(1)}%` : '0%' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REDIS CLIENT WRAPPER
// ─────────────────────────────────────────────────────────────────────────────

type RedisClient = any; // Typed as any for optional redis package

class NvRedisCacheService {
  private client: RedisClient | null = null;
  private connected = false;
  private fallback = new InMemoryLRU(5000);
  private stats = { hits: 0, misses: 0, sets: 0, errors: 0, fallbackHits: 0 };

  // TTL Tiers
  static readonly TTL = {
    HOT:   5  * 60 * 1000,   // 5 minutes  — LLM completion results
    WARM:  60 * 60 * 1000,   // 1 hour     — statute lookups, compliance checks
    COLD:  24 * 60 * 60 * 1000, // 24 hours — case law, template library
    SESSION: 8 * 60 * 60 * 1000, // 8 hours — WebSocket sessions
    RATELIMIT: 60 * 1000,    // 1 minute  — rate limit counters
  };

  async connect(redisUrl?: string): Promise<void> {
    // NV-SECRETS-001 (2026-05-07): single resolver source of truth.
    // Argument override (used by tests) wins; otherwise resolveRedisTcpUrl()
    // walks NYV_REDIS_TCP_URL → legacy aliases and one-shot warns on any
    // legacy alias hit. Disabled (https://, malformed, missing) → in-memory.
    let url: string | null = null;
    if (redisUrl && /^rediss?:\/\//i.test(redisUrl)) {
      url = redisUrl;
    } else {
      const r = resolveRedisTcpUrl();
      if (!r.enabled) {
        logRedisDisabledOnce('redis-cache', r.reason ?? 'no Redis TCP URL');
        logger.info('Cache running in in-memory LRU fallback (per-pod only)');
        return;
      }
      url = r.url;
    }

    try {
      const { createClient } = await import('redis').catch(() => ({ createClient: null }));
      if (!createClient) {
        logger.warn('redis package not installed — using in-memory LRU fallback');
        return;
      }

      // NV-SECRETS-001 hardening: stop reconnecting forever on WRONGPASS/NOAUTH.
      // node-redis's reconnectStrategy can return Error to permanently disable
      // retries — much better than spamming the log for hours when creds are bad.
      this.client = createClient({
        url: url ?? undefined,
        socket: {
          connectTimeout: 5000,
          reconnectStrategy: (retries: number, cause?: Error) => {
            const msg = (cause?.message || '').toUpperCase();
            if (msg.includes('WRONGPASS') || msg.includes('NOAUTH')) {
              return new Error('redis-cache: AUTH failed (WRONGPASS/NOAUTH) — stopping reconnect; falling back to in-memory LRU');
            }
            return Math.min(retries * 50, 2000);
          },
        },
      });

      let _firstError = true;
      this.client.on('error', (err: Error) => {
        if (this.connected || _firstError) {
          _firstError = false;
          logger.error(`Redis cache error: ${err.message}`);
        }
        this.connected = false;
      });
      this.client.on('connect', () => { this.connected = true; logger.info('Redis cache connected'); });
      this.client.on('reconnecting', () => logger.debug('Redis cache reconnecting...'));
      this.client.on('end', () => { this.connected = false; });

      // Hard timeout race so a hung TLS handshake or AUTH-loop never blocks startup.
      await Promise.race([
        this.client.connect(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('redis-cache connect timeout 6s')), 6000)),
      ]);
      logger.info('Redis cache service initialized');
    } catch (err: any) {
      logger.warn(`Redis cache connection failed (${err.message}) — using in-memory LRU fallback`);
      try { await this.client?.disconnect?.(); } catch { /* ignore */ }
      this.client = null;
      this.connected = false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CORE CACHE OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────

  async get<T = any>(key: string): Promise<T | null> {
    const prefixedKey = `nv:${key}`;
    try {
      if (this.connected && this.client) {
        const raw = await this.client.get(prefixedKey);
        if (raw) {
          this.stats.hits++;
          return JSON.parse(raw) as T;
        }
        this.stats.misses++;
        return null;
      }
    } catch (err: any) {
      this.stats.errors++;
      logger.debug(`Redis get error for ${key}:`, err.message);
    }

    // Fallback to in-memory
    const val = this.fallback.get(prefixedKey);
    if (val !== null) { this.stats.fallbackHits++; return val as T; }
    this.stats.misses++;
    return null;
  }

  async set(key: string, value: any, ttlMs: number = NvRedisCacheService.TTL.HOT): Promise<void> {
    const prefixedKey = `nv:${key}`;
    this.stats.sets++;
    try {
      if (this.connected && this.client) {
        await this.client.setEx(prefixedKey, Math.ceil(ttlMs / 1000), JSON.stringify(value));
        return;
      }
    } catch (err: any) {
      this.stats.errors++;
      logger.debug(`Redis set error for ${key}:`, err.message);
    }
    this.fallback.set(prefixedKey, value, ttlMs);
  }

  async del(key: string): Promise<void> {
    const prefixedKey = `nv:${key}`;
    try {
      if (this.connected && this.client) { await this.client.del(prefixedKey); return; }
    } catch { /* noop */ }
    this.fallback.del(prefixedKey);
  }

  async has(key: string): Promise<boolean> {
    const prefixedKey = `nv:${key}`;
    try {
      if (this.connected && this.client) { return (await this.client.exists(prefixedKey)) === 1; }
    } catch { /* noop */ }
    return this.fallback.has(prefixedKey);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RATE LIMITING (atomic increment)
  // ─────────────────────────────────────────────────────────────────────────

  async incrementRateLimit(userId: string, endpoint: string, windowMs = 60000): Promise<{ count: number; limit: number; remaining: number; resetAt: number }> {
    const key = `nv:rate:${userId}:${endpoint}`;
    const limit = 60;
    let count = 1;

    try {
      if (this.connected && this.client) {
        count = await this.client.incr(key);
        if (count === 1) await this.client.pExpire(key, windowMs);
        const ttl = await this.client.pTTL(key);
        return { count, limit, remaining: Math.max(0, limit - count), resetAt: Date.now() + ttl };
      }
    } catch { /* noop */ }

    // Fallback in-memory rate limit
    const existing = this.fallback.get(key) ?? 0;
    count = (existing as number) + 1;
    this.fallback.set(key, count, windowMs);
    return { count, limit, remaining: Math.max(0, limit - count), resetAt: Date.now() + windowMs };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SEMANTIC LLM CACHE
  // ─────────────────────────────────────────────────────────────────────────

  buildLlmCacheKey(prompt: string, model: string, jurisdiction: string): string {
    // Create a stable cache key from prompt hash
    const normalized = prompt.toLowerCase().trim().replace(/\s+/g, ' ');
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) { hash = ((hash << 5) - hash) + normalized.charCodeAt(i); hash |= 0; }
    return `llm:${model}:${jurisdiction}:${Math.abs(hash).toString(36)}`;
  }

  async getLlmCache(prompt: string, model: string, jurisdiction: string): Promise<any | null> {
    return this.get(this.buildLlmCacheKey(prompt, model, jurisdiction));
  }

  async setLlmCache(prompt: string, model: string, jurisdiction: string, response: any, ttlMs = NvRedisCacheService.TTL.HOT): Promise<void> {
    return this.set(this.buildLlmCacheKey(prompt, model, jurisdiction), response, ttlMs);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SESSION STORE (WebSocket)
  // ─────────────────────────────────────────────────────────────────────────

  async setSession(sessionId: string, data: any, ttlMs = NvRedisCacheService.TTL.SESSION): Promise<void> {
    return this.set(`session:${sessionId}`, data, ttlMs);
  }

  async getSession(sessionId: string): Promise<any | null> {
    return this.get(`session:${sessionId}`);
  }

  async touchSession(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session) await this.setSession(sessionId, session, NvRedisCacheService.TTL.SESSION);
  }

  async deleteSession(sessionId: string): Promise<void> {
    return this.del(`session:${sessionId}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATUTE CACHE
  // ─────────────────────────────────────────────────────────────────────────

  async cacheStatuteLookup(actTitle: string, section: string, jurisdiction: string, result: any): Promise<void> {
    const key = `statute:${jurisdiction}:${actTitle.slice(0,50)}:${section}`.toLowerCase().replace(/\s+/g, '-');
    return this.set(key, result, NvRedisCacheService.TTL.COLD);
  }

  async getCachedStatuteLookup(actTitle: string, section: string, jurisdiction: string): Promise<any | null> {
    const key = `statute:${jurisdiction}:${actTitle.slice(0,50)}:${section}`.toLowerCase().replace(/\s+/g, '-');
    return this.get(key);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HEALTH + STATS
  // ─────────────────────────────────────────────────────────────────────────

  async ping(): Promise<boolean> {
    try {
      if (this.connected && this.client) {
        const r = await this.client.ping();
        return r === 'PONG';
      }
    } catch { /* noop */ }
    return false;
  }

  isConnected(): boolean { return this.connected; }

  getStats(): typeof this.stats & { mode: string; fallbackSize: number; hitRate: string } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      mode: this.connected ? 'redis' : 'in-memory-lru',
      fallbackSize: this.fallback.size(),
      hitRate: total > 0 ? `${((this.stats.hits + this.stats.fallbackHits) / total * 100).toFixed(1)}%` : '0%',
    };
  }

  async disconnect(): Promise<void> {
    if (this.client && this.connected) {
      try { await this.client.disconnect(); } catch { /* noop */ }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export const nvRedisCache = new NvRedisCacheService();

export default nvRedisCache;
