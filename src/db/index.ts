// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
import 'dotenv/config';
/* ────────────────────────────────────────────────────────────────────────
 * Driver-aware DB init — DEF-003/007 fix (2026-04-23)
 *
 * Replit / cloud Neon  → @neondatabase/serverless (WebSocket over HTTPS)
 * Self-hosted Postgres → standard `pg` driver (TCP on 5432)
 *
 * Detection: hostname `.neon.tech` OR explicit env `NV_USE_NEON=true`.
 *            Override with `NV_DB_DRIVER=pg|neon`.
 * ──────────────────────────────────────────────────────────────────────── */
import { drizzle as drizzleNeon, NeonDatabase } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzlePg, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool as NeonPool, neonConfig } from '@neondatabase/serverless';
import { Pool as PgPool } from 'pg';
import ws from 'ws';
import * as schema from '../../shared/schema.js';
import * as jrxCitizenSchema from '../../shared/jurexio-citizen-schema.js';
import * as institutionalSchema from '../../shared/jrx-institutional-schema.js';
import * as ministrySchema from '../../shared/jrx-ministry-schema.js';
import * as academySchema from '../../shared/jrx-academy-schema.js';
import { createLogger } from '../utils/logger.js';
import { nvDbPoolManager } from '../services/jrx-db-pool-manager.js';
import { normalizePgConnectionString, upgradePgConnectionStringToVerifyFull } from '../utils/jrx-pg-url.js';
import { getPgSslConfig } from '../utils/jrx-pg-ssl.js';


const logger = createLogger('index');

neonConfig.webSocketConstructor = ws;

function pickDriver(connectionString?: string): 'neon' | 'pg' {
  const forced = (process.env.NV_DB_DRIVER || '').toLowerCase();
  if (forced === 'pg' || forced === 'neon') return forced;
  if (process.env.NV_USE_NEON === 'true') return 'neon';
  if (connectionString && /\.neon\.tech/i.test(connectionString)) return 'neon';
  return 'pg';
}

/**
 * Structural pool surface used by every consumer of this module. Both
 * `pg.Pool` and `@neondatabase/serverless.Pool` satisfy this shape at
 * runtime — they expose `query`, `connect`, `end`, an `on('error', ...)`
 * event channel, and the standard `totalCount`/`idleCount`/`waitingCount`
 * counters.
 *
 * Exposing the structural type instead of `pg.Pool` lets us pass either
 * driver to drizzle without scattering `as any` casts at every call site.
 */
/** A standard pg-shaped query result row keyed string→unknown. */
export type DbRow = Record<string, unknown>;

export interface PoolQueryResult {
  rows?: DbRow[];
  rowCount?: number | null;
}

export interface AnyPool {
  query: (text: string, values?: ReadonlyArray<unknown>) => Promise<PoolQueryResult>;
  connect: () => Promise<{
    query: (text: string, values?: ReadonlyArray<unknown>) => Promise<PoolQueryResult>;
    release: () => void;
  }>;
  end: () => Promise<void>;
  on: (event: 'error', listener: (err: Error) => void) => unknown;
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}

type SchemaRecord = Record<string, unknown>;
type AnyDrizzle =
  | NodePgDatabase<SchemaRecord>
  | NeonDatabase<SchemaRecord>;

/**
 * Construct a paired pool + drizzle handle for a given product.
 *
 * We deliberately keep the concrete driver type inside the branch so the
 * drizzle constructor receives the exact pool class it expects. The
 * outward-facing `pool` variable is then narrowed structurally to
 * `AnyPool` via the `satisfies` operator, with no `as any`/double-cast
 * scatter at downstream call sites.
 */
function makeDb(
  connectionString: string,
  product: string,
  schemas: SchemaRecord,
): { pool: AnyPool; drizzle: AnyDrizzle } {
  const cfg = createPoolConfig(connectionString, product);
  const driver = pickDriver(connectionString);
  if (driver === 'neon') {
    logger.info(`[db:${product}] driver=neon-serverless`);
    const neonPool = new NeonPool(cfg);
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    attachTenantContextDefault(neonPool, product);
    const drz = drizzleNeon(neonPool, { schema: schemas });
    return { pool: neonPool satisfies AnyPool, drizzle: drz };
  }
  logger.info(`[db:${product}] driver=pg (node-postgres)`);
  const pgPool = new PgPool(cfg);
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  attachTenantContextDefault(pgPool, product);
  const drz = drizzlePg(pgPool, { schema: schemas });
  return { pool: pgPool satisfies AnyPool, drizzle: drz };
}

/**
 * Defence-in-depth: every fresh pooled connection is initialised with
 * `app.current_org_id = ''` plus the two-tier `nv.platform_id = ''` and
 * `nv.customer_org_id = ''` GUCs introduced by task #355 / migration
 * 0013_customer_org_rls.sql. The strict RLS policies installed by 0004 +
 * 0013 evaluate `<int>::text = ''` to false, so an un-bound connection
 * sees zero rows from any tenant table — fail-closed by default.
 *
 * Per-request work overrides this via:
 *   • withTenantTx(orgId, fn)                                  (legacy org_id)
 *   • withSdkTenantTx(platformId, customerOrgId, fn)           (two-tier)
 * Both use `SET LOCAL` inside an explicit transaction, which reverts on
 * COMMIT/ROLLBACK and therefore never leaks back to the pool.
 */
function attachTenantContextDefault(p: { on: (ev: string, cb: (...args: unknown[]) => void) => unknown }, product: string): void {
  try {
    p.on('connect', (...args: unknown[]) => {
      const client = args[0] as { query?: (text: string) => Promise<unknown> } | undefined;
      if (!client?.query) return;
      // Single round-trip — three SETs in one statement so a fresh
      // connection becomes fail-closed for both the legacy and two-tier
      // RLS policies before any business query can run.
      client.query(
        "SET app.current_org_id = ''; " +
        "SET nv.platform_id = ''; " +
        "SET nv.customer_org_id = ''",
      ).catch((err: unknown) => {
        logger.warn(`[db:${product}] failed to set tenant default on new connection`, {
          err: err instanceof Error ? err.message : String(err),
        });
      });
    });
  } catch (err) {
    logger.warn(`[db:${product}] could not attach 'connect' listener for tenant default`, {
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

const allSchemas: SchemaRecord = {
  ...schema,
  ...jrxCitizenSchema,
  ...institutionalSchema,
  ...ministrySchema,
  ...academySchema,
};

interface ProductDatabase {
  pool: AnyPool;
  db: AnyDrizzle;
  product: string;
}

const databases: Map<string, ProductDatabase> = new Map();

const isSingleDbMode = !process.env.NV_DATABASE_URL && !process.env.NS_DATABASE_URL && !process.env.NM_DATABASE_URL;

function createPoolConfig(connectionString: string, product: string) {
  const envMax = process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : undefined;
  const poolSizes: Record<string, { max: number; min: number }> = {
    nv: { max: envMax ?? 20, min: 3 },
    ns: { max: envMax ?? 20, min: 2 },
    nm: { max: envMax ?? 20, min: 2 },
    default: { max: envMax ?? 20, min: 5 },
  };

  const sizes = poolSizes[product] || poolSizes.default;

  // NV-PG-SSL-VERIFY-2026-05-11 (task-142): upgrade sslmode=require/
  // prefer/verify-ca → sslmode=verify-full and pass the bundled AWS RDS
  // CA via `ssl: { ca, rejectUnauthorized:true }` (see jrx-pg-ssl.ts).
  // The Neon driver ignores the `ssl` option (uses its own websocket
  // TLS); the pg driver enforces full server-cert verification.
  // Opt out of verification with JRX_PG_SSL_VERIFY=false or
  // PGSSLMODE=disable.
  const base = normalizePgConnectionString(connectionString);
  const normalized = process.env.JRX_PG_SSL_VERIFY === 'false'
    ? base
    : upgradePgConnectionStringToVerifyFull(base);
  return {
    connectionString: normalized,
    ssl: getPgSslConfig(normalized),
    max: sizes.max,
    min: sizes.min,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    // NV-TIMEOUT-POLICY-001: align with master config (60s); override via JRX_PG_STATEMENT_TIMEOUT_MS
    statement_timeout: (() => {
      const n = Number(process.env.JRX_PG_STATEMENT_TIMEOUT_MS);
      return Number.isFinite(n) && n >= 10_000 ? Math.min(120_000, Math.floor(n)) : 60_000;
    })(),
    maxUses: 7500,
    allowExitOnIdle: false,
  };
}

let db: AnyDrizzle | null = null;
let pool: AnyPool | null = null;

let dbNv: AnyDrizzle | null = null;
let dbNs: AnyDrizzle | null = null;
let dbNm: AnyDrizzle | null = null;

const fallbackUrl = process.env.DATABASE_URL;

if (isSingleDbMode) {
  if (fallbackUrl) {
    const built = makeDb(fallbackUrl, 'default', allSchemas);
    pool = built.pool;
    db = built.drizzle;

    pool.on('error', (err: Error) => {
      logger.error('Database pool error:', err.message);
    });

    dbNv = db;
    dbNs = db;
    dbNm = db;

    databases.set('default', { pool, db, product: 'unified' });
    nvDbPoolManager.register('default', pool, createPoolConfig(fallbackUrl, 'default').max);

    logger.info('✅ Single database mode: All products sharing one database pool');
  }
} else {
  const nvUrl = process.env.NV_DATABASE_URL;
  if (nvUrl) {
    const built = makeDb(nvUrl, 'nv', schema as SchemaRecord);
    const nvPool = built.pool;
    dbNv = built.drizzle;
    nvPool.on('error', (err: Error) => {
      logger.error('[NV] Database pool error:', err.message);
    });
    databases.set('nv', { pool: nvPool, db: dbNv, product: 'nv' });
    nvDbPoolManager.register('nv', nvPool, createPoolConfig(nvUrl, 'nv').max);
    pool = nvPool;
    logger.info('✅ Jurexio Core database pool initialized');
  }

  const nsUrl = process.env.NS_DATABASE_URL || fallbackUrl;
  if (nsUrl) {
    const built = makeDb(nsUrl, 'ns', allSchemas);
    const nsPool = built.pool;
    dbNs = built.drizzle;
    nsPool.on('error', (err: Error) => {
      logger.error('[NS] Database pool error:', err.message);
    });
    databases.set('ns', { pool: nsPool, db: dbNs, product: 'ns' });
    nvDbPoolManager.register('ns', nsPool, createPoolConfig(nsUrl, 'ns').max);
    logger.info('✅ Jurexio Professional™ database pool initialized');
  }

  const nmUrl = process.env.NM_DATABASE_URL || fallbackUrl;
  if (nmUrl) {
    const built = makeDb(nmUrl, 'nm', { ...schema, ...jrxCitizenSchema } as SchemaRecord);
    const nmPool = built.pool;
    dbNm = built.drizzle;
    nmPool.on('error', (err: Error) => {
      logger.error('[NM] Database pool error:', err.message);
    });
    databases.set('nm', { pool: nmPool, db: dbNm, product: 'nm' });
    nvDbPoolManager.register('nm', nmPool, createPoolConfig(nmUrl, 'nm').max);
    logger.info('✅ Jurexio Citizen database pool initialized');
  }

  db = dbNv || dbNs || dbNm;

  if (!dbNv) logger.warn('⚠️ NV_DATABASE_URL not set: Jurexio Core DB will use fallback');
  if (!dbNs) logger.warn('⚠️ NS_DATABASE_URL not set: Jurexio Professional™ DB will use fallback');
  if (!dbNm) logger.warn('⚠️ NM_DATABASE_URL not set: Jurexio Citizen DB will use fallback');

  logger.info(`✅ Multi-database mode: ${databases.size} product databases initialized`);
}

type ProductKey = 'nv' | 'ns' | 'nm' | 'ni' | 'nacad' | 'nmin';

function getDbForProduct(product: ProductKey): AnyDrizzle | null {
  if (isSingleDbMode) return db;

  const productDbMap: Record<ProductKey, AnyDrizzle | null> = {
    nv: dbNv,
    ns: dbNs,
    nm: dbNm,
    ni: dbNs,
    nacad: dbNs,
    nmin: dbNs,
  };

  return productDbMap[product] || db;
}

function getDatabaseMode(): {
  mode: 'single' | 'multi';
  products: string[];
  poolCount: number;
} {
  return {
    mode: isSingleDbMode ? 'single' : 'multi',
    products: Array.from(databases.keys()),
    poolCount: databases.size,
  };
}

async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  latencyMs: number;
  mode: 'single' | 'multi';
  poolStats: {
    total: number;
    idle: number;
    waiting: number;
  };
  products?: Record<string, { healthy: boolean; latencyMs: number }>;
}> {
  const mode = isSingleDbMode ? 'single' : 'multi';

  if (databases.size === 0) {
    return { healthy: false, latencyMs: -1, mode, poolStats: { total: 0, idle: 0, waiting: 0 } };
  }

  const productHealth: Record<string, { healthy: boolean; latencyMs: number }> = {};
  let overallHealthy = true;
  let totalLatency = 0;
  let totalStats = { total: 0, idle: 0, waiting: 0 };

  for (const [name, entry] of databases) {
    const start = Date.now();
    try {
      const client = await entry.pool.connect();
      await client.query('SELECT 1');
      client.release();
      const latency = Date.now() - start;
      productHealth[name] = { healthy: true, latencyMs: latency };
      totalLatency = Math.max(totalLatency, latency);
      totalStats.total += entry.pool.totalCount;
      totalStats.idle += entry.pool.idleCount;
      totalStats.waiting += entry.pool.waitingCount;
    } catch {
      productHealth[name] = { healthy: false, latencyMs: Date.now() - start };
      overallHealthy = false;
    }
  }

  return {
    healthy: overallHealthy,
    latencyMs: totalLatency,
    mode,
    poolStats: totalStats,
    ...(mode === 'multi' ? { products: productHealth } : {}),
  };
}

async function closeDatabasePool(): Promise<void> {
  for (const [name, entry] of databases) {
    await entry.pool.end();
    logger.info(`[${name.toUpperCase()}] Database pool closed`);
  }
  databases.clear();
  logger.info('All database pools closed gracefully');
}

function getPoolStats(): Record<string, { total: number; idle: number; waiting: number }> {
  const stats: Record<string, { total: number; idle: number; waiting: number }> = {};
  for (const [name, entry] of databases) {
    stats[name] = {
      total: entry.pool.totalCount,
      idle: entry.pool.idleCount,
      waiting: entry.pool.waitingCount,
    };
  }
  return stats;
}

// task-251 (2026-05-12): re-export the nullable singletons directly, undoing
// the permissive `as AnyDrizzle` / `as AnyPool` casts added in task-230. Those
// casts hid ~423 strict-null violations at consumer call sites and turned a
// missing-DB boot into a confusing `Cannot read properties of undefined`
// instead of an explicit `Database not available` failure. Consumers now
// either:
//   (a) early-return `res.status(500).json({ error: 'Database not available' })`
//       like `jrx-enterprise-admin-routes.ts`, or
//   (b) rebind locally via `requireDb(...)` (see `utils/jrx-type-helpers.ts`)
//       — typically inside a lazy Proxy so module init never throws.
export { db, pool, dbNv, dbNs, dbNm, getDbForProduct, getDatabaseMode, checkDatabaseHealth, closeDatabasePool, getPoolStats, nvDbPoolManager };
export * from '../../shared/schema.js';
export * from '../../shared/jurexio-citizen-schema.js';
