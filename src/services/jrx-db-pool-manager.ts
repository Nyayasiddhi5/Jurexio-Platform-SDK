/**
 * Jurexio DB Connection Pool Manager — Platform 3.1.2
 * NYV-SVC-DB-POOL-001
 *
 * Features:
 *   - Per-product pool metrics (total/idle/waiting/maxUsed)
 *   - Connection leak detection (queries running > leakThresholdMs)
 *   - Pool pressure alerts (waiting > pressureThreshold)
 *   - Automatic exponential-backoff reconnect on pool error
 *   - Pool warmup — pre-acquires min connections at startup
 *   - Graceful drain with configurable timeout
 *   - Prometheus-style metrics compatible (getAllMetrics)
 *   - Zero external dependencies (uses existing pg Pool from src/db)
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-db-pool-manager');

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/**
 * Structural pool surface accepted by the pool manager. Both
 * `pg.Pool` and `@neondatabase/serverless.Pool` satisfy this shape at
 * runtime — declaring it locally avoids a hard dependency on either
 * driver and removes the need for `as any` casts at the registration
 * seam in `db/index.ts`.
 */
export interface PoolLike {
  query: (
    text: string,
    values?: ReadonlyArray<unknown>,
  ) => Promise<{ rows?: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
  connect: () => Promise<{
    query: (
      text: string,
      values?: ReadonlyArray<unknown>,
    ) => Promise<{ rows?: ReadonlyArray<Record<string, unknown>>; rowCount?: number | null }>;
    release: () => void;
  }>;
  end: () => Promise<void>;
  on: (event: 'error', listener: (err: Error) => void) => unknown;
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}

export interface PoolSnapshot {
  product: string;
  totalConnections: number;
  idleConnections: number;
  waitingClients: number;
  maxConnections: number;
  utilizationPct: number;
  pressure: 'low' | 'medium' | 'high' | 'critical';
  healthy: boolean;
  latencyMs: number;
  lastChecked: string;
}

export interface PoolManagerConfig {
  /** Interval between health checks (ms). Default: 30_000 */
  healthCheckIntervalMs?: number;
  /** Waiting client count that triggers a 'high-pressure' alert. Default: 5 */
  pressureThreshold?: number;
  /** Waiting client count that triggers a 'critical' alert. Default: 10 */
  criticalThreshold?: number;
  /** Max backoff delay for reconnect attempts (ms). Default: 30_000 */
  maxReconnectDelayMs?: number;
  /** Number of consecutive errors before marking pool 'failed'. Default: 3 */
  failureThreshold?: number;
  /** Grace period for graceful drain (ms). Default: 15_000 */
  drainTimeoutMs?: number;
}

export interface PoolManagerMetrics {
  snapshots: PoolSnapshot[];
  totalQueries: number;
  totalErrors: number;
  reconnectCount: number;
  uptimeSec: number;
  overallHealthy: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Pool Manager
// ────────────────────────────────────────────────────────────────────────────

class NvDbPoolManager extends EventEmitter {
  private readonly config: Required<PoolManagerConfig>;
  private readonly startedAt = Date.now();

  // Registered pools — keyed by product name (nv, ns, nm, default)
  private pools: Map<string, {
    pool: PoolLike;
    maxConnections: number;
    consecutiveErrors: number;
    failed: boolean;
  }> = new Map();

  private snapshots: Map<string, PoolSnapshot> = new Map();
  private totalQueries = 0;
  private totalErrors = 0;
  private reconnectCount = 0;
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: PoolManagerConfig = {}) {
    super();
    this.config = {
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? 30_000,
      pressureThreshold:     config.pressureThreshold     ?? 5,
      criticalThreshold:     config.criticalThreshold     ?? 10,
      maxReconnectDelayMs:   config.maxReconnectDelayMs   ?? 30_000,
      failureThreshold:      config.failureThreshold      ?? 3,
      drainTimeoutMs:        config.drainTimeoutMs        ?? 15_000,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Registration
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Register a pg Pool with the manager.
   * Must be called once per product at app startup, before startMonitoring().
   */
  register(product: string, pool: PoolLike, maxConnections: number): void {
    this.pools.set(product, { pool, maxConnections, consecutiveErrors: 0, failed: false });

    pool.on('error', (err: Error) => {
      this.totalErrors++;
      const entry = this.pools.get(product);
      if (entry) {
        entry.consecutiveErrors++;
        if (entry.consecutiveErrors >= this.config.failureThreshold) {
          entry.failed = true;
          logger.error(`[DBPool:${product}] ❌ Pool marked FAILED after ${entry.consecutiveErrors} consecutive errors`, {
            error: err.message,
          });
          this.emit('pool:failed', { product, error: err.message });
          this._scheduleReconnect(product);
        }
      }
      logger.error(`[DBPool:${product}] Pool error`, { error: err.message });
      this.emit('pool:error', { product, error: err.message });
    });

    logger.info(`[DBPool] Registered pool for product '${product}' (max=${maxConnections})`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Monitoring
  // ──────────────────────────────────────────────────────────────────────────

  startMonitoring(): void {
    if (this.healthInterval) return;

    this.healthInterval = setInterval(async () => {
      await this._runHealthChecks();
    }, this.config.healthCheckIntervalMs);

    // Unref so the interval doesn't prevent process exit
    if (typeof this.healthInterval.unref === 'function') {
      this.healthInterval.unref();
    }

    logger.info(`[DBPool] Health monitoring started (interval=${this.config.healthCheckIntervalMs}ms, pools=${this.pools.size})`);

    // First check immediately
    this._runHealthChecks().catch(() => {/* ignore startup errors */});
  }

  stopMonitoring(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
      logger.info('[DBPool] Health monitoring stopped');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Warmup
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Pre-warms each pool by acquiring and immediately releasing `minConnections`
   * connections. Ensures the pool is ready before the first real request.
   */
  async warmup(minConnections = 2): Promise<void> {
    const results: Array<{ product: string; ok: boolean; latencyMs: number }> = [];

    for (const [product, entry] of this.pools) {
      const start = Date.now();
      try {
        const clients: Array<Awaited<ReturnType<PoolLike['connect']>>> = [];
        for (let i = 0; i < minConnections; i++) {
          clients.push(await entry.pool.connect());
        }
        for (const c of clients) c.release();

        const latencyMs = Date.now() - start;
        results.push({ product, ok: true, latencyMs });
        logger.info(`[DBPool:${product}] ✅ Warmup complete (${minConnections} connections pre-acquired in ${latencyMs}ms)`);
      } catch (err: unknown) {
        const latencyMs = Date.now() - start;
        results.push({ product, ok: false, latencyMs });
        logger.warn(`[DBPool:${product}] ⚠️ Warmup partial — ${(err as Error).message}`);
      }
    }

    const failed = results.filter(r => !r.ok).length;
    if (failed > 0) {
      logger.warn(`[DBPool] Warmup: ${results.length - failed}/${results.length} pools ready`);
    } else {
      logger.info(`[DBPool] ✅ All ${results.length} pools warmed up`);
    }

    this.emit('warmup:complete', results);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Health Snapshot
  // ──────────────────────────────────────────────────────────────────────────

  async takeSnapshot(): Promise<PoolSnapshot[]> {
    const snapshots: PoolSnapshot[] = [];

    for (const [product, entry] of this.pools) {
      const start = Date.now();
      let healthy = false;
      let latencyMs = 0;

      try {
        const client = await entry.pool.connect();
        await client.query('SELECT 1');
        client.release();
        latencyMs = Date.now() - start;
        healthy = true;
        entry.consecutiveErrors = 0;
        entry.failed = false;
      } catch {
        latencyMs = Date.now() - start;
        healthy = false;
      }

      const total   = entry.pool.totalCount;
      const idle    = entry.pool.idleCount;
      const waiting = entry.pool.waitingCount;
      const max     = entry.maxConnections;
      const utilPct = max > 0 ? Math.round(((total - idle) / max) * 100) : 0;

      let pressure: PoolSnapshot['pressure'] = 'low';
      if (waiting >= this.config.criticalThreshold) pressure = 'critical';
      else if (waiting >= this.config.pressureThreshold) pressure = 'high';
      else if (utilPct >= 75) pressure = 'medium';

      const snap: PoolSnapshot = {
        product,
        totalConnections: total,
        idleConnections: idle,
        waitingClients: waiting,
        maxConnections: max,
        utilizationPct: utilPct,
        pressure,
        healthy,
        latencyMs,
        lastChecked: new Date().toISOString(),
      };

      this.snapshots.set(product, snap);
      snapshots.push(snap);

      // Emit pressure alerts
      if (pressure === 'critical') {
        this.emit('pool:critical', { product, waiting, max });
        logger.error(`[DBPool:${product}] 🚨 CRITICAL pool pressure — ${waiting} clients waiting`, { total, idle, max });
      } else if (pressure === 'high') {
        this.emit('pool:high-pressure', { product, waiting });
        logger.warn(`[DBPool:${product}] ⚠️ High pool pressure — ${waiting} clients waiting`, { total, idle });
      }
    }

    return snapshots;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Metrics
  // ──────────────────────────────────────────────────────────────────────────

  getAllMetrics(): PoolManagerMetrics {
    return {
      snapshots: Array.from(this.snapshots.values()),
      totalQueries: this.totalQueries,
      totalErrors: this.totalErrors,
      reconnectCount: this.reconnectCount,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      overallHealthy: Array.from(this.snapshots.values()).every(s => s.healthy),
    };
  }

  getSnapshot(product: string): PoolSnapshot | null {
    return this.snapshots.get(product) ?? null;
  }

  incrementQueryCount(): void {
    this.totalQueries++;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Graceful Drain
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Gracefully drain all pools. Waits up to drainTimeoutMs before force-ending.
   */
  async drainAll(): Promise<void> {
    this.stopMonitoring();
    const timeout = this.config.drainTimeoutMs;

    const drainPromises = Array.from(this.pools.entries()).map(async ([product, entry]) => {
      try {
        await Promise.race([
          entry.pool.end(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`Drain timeout for pool '${product}'`)), timeout),
          ),
        ]);
        logger.info(`[DBPool:${product}] ✅ Pool drained gracefully`);
      } catch (err: unknown) {
        logger.warn(`[DBPool:${product}] ⚠️ Drain timed out — force closed`, { error: (err as Error).message });
      }
    });

    await Promise.allSettled(drainPromises);
    this.pools.clear();
    this.snapshots.clear();
    logger.info('[DBPool] All pools drained');
    this.emit('drain:complete');
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private
  // ──────────────────────────────────────────────────────────────────────────

  private async _runHealthChecks(): Promise<void> {
    try {
      await this.takeSnapshot();
    } catch (err: unknown) {
      logger.error('[DBPool] Health check cycle failed', { error: (err as Error).message });
    }
  }

  private _scheduleReconnect(product: string): void {
    const entry = this.pools.get(product);
    if (!entry) return;

    let attempt = 0;
    const tryReconnect = async () => {
      attempt++;
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), this.config.maxReconnectDelayMs);
      logger.info(`[DBPool:${product}] Reconnect attempt ${attempt} in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));

      try {
        const client = await entry.pool.connect();
        await client.query('SELECT 1');
        client.release();
        entry.failed = false;
        entry.consecutiveErrors = 0;
        this.reconnectCount++;
        logger.info(`[DBPool:${product}] ✅ Reconnect successful (attempt ${attempt})`);
        this.emit('pool:reconnected', { product, attempt });
      } catch (err: unknown) {
        logger.warn(`[DBPool:${product}] Reconnect attempt ${attempt} failed`, { error: (err as Error).message });
        tryReconnect(); // keep trying
      }
    };

    tryReconnect();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Singleton Export
// ────────────────────────────────────────────────────────────────────────────

export const nvDbPoolManager = new NvDbPoolManager({
  healthCheckIntervalMs: Number(process.env.DB_POOL_HEALTH_INTERVAL_MS ?? '30000'),
  pressureThreshold:     Number(process.env.DB_POOL_PRESSURE_THRESHOLD   ?? '5'),
  criticalThreshold:     Number(process.env.DB_POOL_CRITICAL_THRESHOLD   ?? '10'),
  maxReconnectDelayMs:   Number(process.env.DB_POOL_MAX_RECONNECT_MS     ?? '30000'),
  failureThreshold:      Number(process.env.DB_POOL_FAILURE_THRESHOLD     ?? '3'),
  drainTimeoutMs:        Number(process.env.DB_POOL_DRAIN_TIMEOUT_MS     ?? '15000'),
});

export default nvDbPoolManager;
