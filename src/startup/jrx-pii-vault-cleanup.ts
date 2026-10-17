/**
 * PII Vault — Distributed (Redis) Storage with In-Memory Fallback
 *
 * Backed by Redis (NYV_REDIS_TCP_URL / REDIS_URL) so that tokens issued by
 * pod A can be detokenized by pod B in a horizontally-scaled deployment.
 * Falls back to a per-process in-memory Map only when Redis is unavailable;
 * a loud warning is logged so the degraded state is visible.
 *
 * Public API (all async):
 *   - initPiiVaultCleanup(intervalMinutes?)   schedule periodic janitor
 *   - addPiiVaultEntry(token, value, jurisdiction, expiryMs?)
 *   - getPiiVaultEntry(token)
 *   - runPiiVaultCleanup()                    one-shot janitor pass
 *   - clearPiiVault()                         remove all entries
 *   - getPiiVaultStats()                      runtime statistics
 *   - stopPiiVaultCleanup()                   stop the scheduler
 *   - isRedisBackend()                        true when Redis is healthy
 *
 * Compliance: SOC 2 CC6.7, ISO 27001 A.10.1, EU AI Act Art. 10, DPDPA §8.
 */
import { createLogger } from '../utils/logger.js';
import { resolveRedisTcpUrl, logRedisDisabledOnce, CANONICAL_REDIS_VAR } from '../utils/redis-tcp-url.js';

const logger = createLogger('pii-vault-cleanup');

export interface PiiVaultEntry {
  token: string;
  originalValue: string;
  createdAt: Date;
  expiresAt: Date;
  jurisdiction: string;
}

export interface PiiVaultStats {
  totalEntries: number;
  expiredEntries: number;
  activeEntries: number;
  oldestEntry?: Date;
  newestEntry?: Date;
  cleanupRunCount: number;
  lastCleanupTime?: Date;
  totalEntriesRemoved: number;
  backend: 'redis' | 'memory';
  redisAvailable: boolean;
}

// In-memory fallback vault (only consulted when Redis is unreachable)
export const piiVault = new Map<string, PiiVaultEntry>();

const REDIS_KEY_PREFIX = 'nyv:pii:';
// Task #29 deliverable: 5-minute default TTL for PII tokens. Cluster-safe
// because the vault is now Redis-backed (NYV_REDIS_TCP_URL); the in-memory
// fallback uses the same TTL but warns loudly that tokens are pod-local.
const DEFAULT_EXPIRY_MS = 5 * 60 * 1000;

let cleanupIntervalHandle: NodeJS.Timeout | null = null;

let vaultStats: PiiVaultStats = {
  totalEntries: 0,
  expiredEntries: 0,
  activeEntries: 0,
  cleanupRunCount: 0,
  totalEntriesRemoved: 0,
  backend: 'memory',
  redisAvailable: false,
};

// ── Redis client (lazy, singleton) ───────────────────────────────────────────

type RedisLike = {
  set: (key: string, value: string, mode: 'PX', ttlMs: number) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  del: (...keys: string[]) => Promise<number>;
  scan: (
    cursor: string,
    matchKeyword: 'MATCH',
    pattern: string,
    countKeyword: 'COUNT',
    count: number,
  ) => Promise<[string, string[]]>;
  ping: () => Promise<string>;
  quit?: () => Promise<unknown>;
};

let _redisClient: RedisLike | null = null;
let _redisInitAttempted = false;
let _redisHealthy = false;
let _lastRedisFailureAt = 0;
// NYV-PIIVAULT-RACE-FIX (2026-05-07): cold-start TLS handshake to
// ElastiCache can intermittently fail (5s connectTimeout vs ~6-8s warm-up).
// Previous logic latched _redisInitAttempted=true after the first failure,
// permanently degrading the vault to in-memory until process restart. The
// retry window below allows a re-probe every PII_VAULT_REDIS_RETRY_MS
// (default 30s) so the next eligible call recovers automatically.
const PII_VAULT_REDIS_RETRY_MS = Number(process.env.NYV_PII_VAULT_REDIS_RETRY_MS ?? 30_000);

async function getRedisClient(): Promise<RedisLike | null> {
  if (_redisClient && _redisHealthy) return _redisClient;
  if (_redisInitAttempted && !_redisHealthy) {
    // Honour a cool-down window before re-probing so we don't hammer
    // ElastiCache when it's genuinely down.
    if (Date.now() - _lastRedisFailureAt < PII_VAULT_REDIS_RETRY_MS) return null;
    // Window elapsed: clear the latch and try again.
    logger.info(`🔁 [PiiVault] Redis retry window elapsed (${PII_VAULT_REDIS_RETRY_MS}ms) — re-probing`);
    _redisInitAttempted = false;
  }
  _redisInitAttempted = true;

  // NV-SECRETS-001 (2026-05-07): single resolver source of truth (canonical
  // NYV_REDIS_TCP_URL with one-shot deprecation warn for legacy aliases).
  const r = resolveRedisTcpUrl();
  if (!r.enabled || !r.url) {
    logRedisDisabledOnce('pii-vault', r.reason ?? 'no Redis TCP URL');
    logger.warn(
      `⚠️ [PiiVault] DEGRADED — falling back to in-memory PII vault. ` +
      `Tokens issued on this pod CANNOT be detokenized on other pods. ` +
      `Set ${CANONICAL_REDIS_VAR}=rediss://... to restore cluster safety.`,
    );
    return null;
  }
  const url = r.url;

  try {
    const mod = await import('ioredis');
    const RedisCtor: any = (mod as any).Redis ?? (mod as any).default;
    // NYV-NS-028 (2026-05-05): ioredis options aligned with audit-chain-lock
    // (which connects successfully to the same Upstash endpoint). Key changes:
    //   • lazyConnect: true       — defer TCP+TLS until first command (.ping())
    //   • explicit tls: {}         — Upstash rediss:// requires TLS; ioredis
    //                                normally auto-detects but explicit is safer
    //   • enableReadyCheck: false  — Upstash doesn't respond to INFO/CONFIG
    //   • enableOfflineQueue: true — buffer commands during connect (avoids
    //                                "Stream isn't writeable" race)
    //   • connectTimeout: 5000     — Upstash cold-start TLS handshake can be slow
    //   • ping timeout: 5000       — must exceed connectTimeout
    const client = new RedisCtor(url, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
      enableOfflineQueue: true,
      enableReadyCheck: false,
      connectTimeout: 5000,
      tls: url.startsWith('rediss://') ? {} : undefined,
      keyPrefix: '',
    });
    // Probe connectivity once before declaring healthy.
    const pong = await Promise.race([
      client.ping(),
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error('redis ping timeout')), 5000),
      ),
    ]);
    if (pong !== 'PONG') throw new Error(`unexpected ping reply: ${pong}`);
    _redisClient = client as RedisLike;
    _redisHealthy = true;
    vaultStats.backend = 'redis';
    vaultStats.redisAvailable = true;
    logger.info('🔐 [PiiVault] Redis backend ACTIVE — cluster-safe tokenization enabled');
    return _redisClient;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      `⚠️ [PiiVault] Redis init failed (${msg}) — DEGRADED: falling back to in-memory PII vault. ` +
      `Will re-probe in ${PII_VAULT_REDIS_RETRY_MS}ms. ` +
      `Tokens issued on this pod CANNOT be detokenized on other pods until then.`,
    );
    _redisClient = null;
    _redisHealthy = false;
    _lastRedisFailureAt = Date.now();
    vaultStats.backend = 'memory';
    vaultStats.redisAvailable = false;
    return null;
  }
}

export function isRedisBackend(): boolean {
  return _redisHealthy;
}

// ── Serialization helpers ────────────────────────────────────────────────────

function serializeEntry(entry: PiiVaultEntry): string {
  return JSON.stringify({
    token: entry.token,
    originalValue: entry.originalValue,
    createdAt: entry.createdAt.toISOString(),
    expiresAt: entry.expiresAt.toISOString(),
    jurisdiction: entry.jurisdiction,
  });
}

function deserializeEntry(raw: string): PiiVaultEntry | null {
  try {
    const o = JSON.parse(raw);
    return {
      token: o.token,
      originalValue: o.originalValue,
      createdAt: new Date(o.createdAt),
      expiresAt: new Date(o.expiresAt),
      jurisdiction: o.jurisdiction,
    };
  } catch {
    return null;
  }
}

function redisKey(token: string): string {
  return `${REDIS_KEY_PREFIX}${token}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the PII vault cleanup scheduler. Idempotent.
 * Probes Redis on startup so the chosen backend is logged immediately.
 */
export async function initPiiVaultCleanup(intervalMinutes: number = 5): Promise<void> {
  if (cleanupIntervalHandle !== null) {
    logger.warn('⚠️ PII vault cleanup already initialized');
    return;
  }

  await getRedisClient(); // probe & log backend choice

  const intervalMs = intervalMinutes * 60 * 1000;
  logger.info(
    `🔐 PII Vault Cleanup initialized (interval=${intervalMinutes}m, backend=${vaultStats.backend})`,
  );

  await runPiiVaultCleanup();

  cleanupIntervalHandle = setInterval(() => {
    void runPiiVaultCleanup();
  }, intervalMs);
  if (cleanupIntervalHandle.unref) cleanupIntervalHandle.unref();
}

/**
 * Add a PII entry to the vault. Stored in Redis with native PX TTL when
 * available; otherwise stored in the in-memory fallback Map.
 */
export async function addPiiVaultEntry(
  token: string,
  originalValue: string,
  jurisdiction: string,
  expiryMs: number = DEFAULT_EXPIRY_MS,
): Promise<PiiVaultEntry> {
  const now = new Date();
  const entry: PiiVaultEntry = {
    token,
    originalValue,
    createdAt: now,
    expiresAt: new Date(now.getTime() + expiryMs),
    jurisdiction,
  };

  const client = await getRedisClient();
  if (client) {
    try {
      await client.set(redisKey(token), serializeEntry(entry), 'PX', expiryMs);
      return entry;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[PiiVault] Redis SET failed (${msg}) — using in-memory fallback for token ${token.slice(0, 6)}…`);
      _redisHealthy = false;
      vaultStats.backend = 'memory';
      vaultStats.redisAvailable = false;
    }
  }
  piiVault.set(token, entry);
  return entry;
}

/**
 * Retrieve a PII entry. Returns null when missing or expired.
 */
export async function getPiiVaultEntry(token: string): Promise<PiiVaultEntry | null> {
  const client = await getRedisClient();
  if (client) {
    try {
      const raw = await client.get(redisKey(token));
      if (!raw) return null;
      const entry = deserializeEntry(raw);
      if (!entry) return null;
      if (new Date() > entry.expiresAt) {
        await client.del(redisKey(token)).catch(() => undefined);
        return null;
      }
      return entry;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[PiiVault] Redis GET failed (${msg}) — falling back to in-memory lookup`);
      _redisHealthy = false;
      vaultStats.backend = 'memory';
      vaultStats.redisAvailable = false;
    }
  }

  const entry = piiVault.get(token);
  if (!entry) return null;
  if (new Date() > entry.expiresAt) {
    piiVault.delete(token);
    return null;
  }
  return entry;
}

/**
 * Remove expired entries. Redis already drops keys via PX TTL — this pass
 * still walks the keyspace to refresh stats and prune any orphaned in-memory
 * fallback entries from a previous Redis outage.
 */
export async function runPiiVaultCleanup(): Promise<void> {
  const beforeMemorySize = piiVault.size;
  const now = new Date();
  let removedCount = 0;

  for (const [token, entry] of piiVault.entries()) {
    if (now > entry.expiresAt) {
      piiVault.delete(token);
      removedCount++;
    }
  }

  let redisActiveCount = 0;
  let oldestEntry: Date | undefined;
  let newestEntry: Date | undefined;

  const client = await getRedisClient();
  if (client) {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await client.scan(
          cursor,
          'MATCH',
          `${REDIS_KEY_PREFIX}*`,
          'COUNT',
          200,
        );
        cursor = next;
        for (const key of keys) {
          const raw = await client.get(key);
          if (!raw) continue;
          const entry = deserializeEntry(raw);
          if (!entry) continue;
          if (now > entry.expiresAt) continue;
          redisActiveCount++;
          if (!oldestEntry || entry.createdAt < oldestEntry) oldestEntry = entry.createdAt;
          if (!newestEntry || entry.createdAt > newestEntry) newestEntry = entry.createdAt;
        }
      } while (cursor !== '0');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[PiiVault] Redis SCAN failed during cleanup (${msg})`);
    }
  }

  const memoryActiveCount = piiVault.size;
  for (const entry of piiVault.values()) {
    if (!oldestEntry || entry.createdAt < oldestEntry) oldestEntry = entry.createdAt;
    if (!newestEntry || entry.createdAt > newestEntry) newestEntry = entry.createdAt;
  }

  vaultStats.cleanupRunCount++;
  vaultStats.totalEntriesRemoved += removedCount;
  vaultStats.lastCleanupTime = now;
  vaultStats.activeEntries = redisActiveCount + memoryActiveCount;
  vaultStats.totalEntries = vaultStats.activeEntries;
  vaultStats.expiredEntries = 0;
  vaultStats.oldestEntry = oldestEntry;
  vaultStats.newestEntry = newestEntry;

  logCleanupStats(beforeMemorySize, removedCount, redisActiveCount);
}

/**
 * Refresh + return runtime statistics (synchronous quick-look snapshot).
 * For an authoritative count, call `runPiiVaultCleanup()` first.
 */
export function getPiiVaultStats(): PiiVaultStats {
  const now = new Date();
  let activeCount = 0;
  let expiredCount = 0;
  for (const entry of piiVault.values()) {
    if (now > entry.expiresAt) expiredCount++;
    else activeCount++;
  }
  // The Redis side is reflected from the last runPiiVaultCleanup() pass.
  return {
    ...vaultStats,
    expiredEntries: expiredCount,
    activeEntries: vaultStats.backend === 'redis' ? vaultStats.activeEntries : activeCount,
  };
}

export function stopPiiVaultCleanup(): void {
  if (cleanupIntervalHandle !== null) {
    clearInterval(cleanupIntervalHandle);
    cleanupIntervalHandle = null;
    logger.info('🔐 PII Vault Cleanup stopped');
  }
}

/**
 * Remove every entry from the vault — both Redis and the in-memory fallback.
 * Use with caution.
 */
export async function clearPiiVault(): Promise<void> {
  const memSize = piiVault.size;
  piiVault.clear();

  const client = await getRedisClient();
  let redisRemoved = 0;
  if (client) {
    try {
      let cursor = '0';
      const toDelete: string[] = [];
      do {
        const [next, keys] = await client.scan(
          cursor,
          'MATCH',
          `${REDIS_KEY_PREFIX}*`,
          'COUNT',
          500,
        );
        cursor = next;
        toDelete.push(...keys);
      } while (cursor !== '0');
      if (toDelete.length > 0) {
        redisRemoved = await client.del(...toDelete);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[PiiVault] Redis clear failed (${msg})`);
    }
  }
  vaultStats.totalEntriesRemoved += memSize + redisRemoved;
  logger.info(`🔐 PII Vault cleared: ${memSize} memory + ${redisRemoved} redis entries removed`);
}

function logCleanupStats(beforeMemorySize: number, removedCount: number, redisActive: number): void {
  const afterMemorySize = piiVault.size;
  logger.info('[PiiVault] cleanup pass', {
    cleanupRun: vaultStats.cleanupRunCount,
    backend: vaultStats.backend,
    redisHealthy: vaultStats.redisAvailable,
    memoryBefore: beforeMemorySize,
    memoryRemoved: removedCount,
    memoryAfter: afterMemorySize,
    redisActive,
    activeTotal: vaultStats.activeEntries,
    lifetimeRemoved: vaultStats.totalEntriesRemoved,
  });
}
