/**
 * NV-SCHEMA-ENSURE-001 — idempotent credit + maker-checker table readiness.
 *
 * Prod runtime role `nv_app` has USAGE/DML on `nv_schema` but NOT CREATE.
 * `CREATE TABLE IF NOT EXISTS` still requires CREATE privilege even when the
 * table already exists — that was the noisy `credit_tables_ensure_failed`.
 *
 * Strategy:
 *  1. If required tables exist → mark ready (no DDL).
 *  2. Else try DDL (works on local/dev with CREATE).
 *  3. Else log once at warn and continue (response path must never block).
 * DDL for missing prod tables is applied via DATABASE_URL_ADMIN migrations.
 */
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-ensure-schema');

let ensured = false;
let ensuring: Promise<boolean> | null = null;
let warnedMissing = false;

const REQUIRED = [
  'ai_credit_usage',
  'ai_credit_overrides',
  'nv_maker_checker_sessions',
] as const;

async function existingTables(db: { execute: (q: unknown) => Promise<any> }): Promise<Set<string>> {
  const result = await db.execute(sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'nv_schema'
      AND table_name IN ('ai_credit_usage', 'ai_credit_overrides', 'nv_maker_checker_sessions')
  `);
  const rows = (result as any)?.rows ?? (Array.isArray(result) ? result : []);
  return new Set((rows as Array<{ table_name: string }>).map((r) => String(r.table_name)));
}

async function tryDdl(db: { execute: (q: unknown) => Promise<unknown> }): Promise<void> {
  // Do NOT CREATE SCHEMA — nv_app lacks DB CREATE; schema already exists in prod.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS nv_schema.ai_credit_usage (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL,
      org_id TEXT,
      tier TEXT NOT NULL DEFAULT 'solo',
      tokens_used INT NOT NULL DEFAULT 0,
      agent_key TEXT,
      jurisdiction TEXT,
      model TEXT,
      request_id TEXT,
      cost_usd NUMERIC(10,6) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_ai_credit_user_date
      ON nv_schema.ai_credit_usage(user_id, created_at DESC)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_ai_credit_org_date
      ON nv_schema.ai_credit_usage(org_id, created_at DESC)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS nv_schema.ai_credit_overrides (
      org_id TEXT PRIMARY KEY,
      daily_token_budget BIGINT NOT NULL,
      hourly_request_limit INT NOT NULL DEFAULT 500,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS nv_schema.nv_maker_checker_sessions (
      session_id        uuid PRIMARY KEY NOT NULL,
      original_prompt   text        NOT NULL,
      final_output      jsonb       NOT NULL DEFAULT '{}'::jsonb,
      iterations        jsonb       NOT NULL DEFAULT '[]'::jsonb,
      total_iterations  integer     NOT NULL DEFAULT 0,
      approved          boolean     NOT NULL DEFAULT false,
      human_escalated   boolean     NOT NULL DEFAULT false,
      human_decision    text,
      quality_score     numeric,
      total_latency_ms  integer,
      metadata          jsonb       NOT NULL DEFAULT '{}'::jsonb,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_nv_mc_sessions_approved
      ON nv_schema.nv_maker_checker_sessions (approved)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_nv_mc_sessions_escalated
      ON nv_schema.nv_maker_checker_sessions (human_escalated)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_nv_mc_sessions_created
      ON nv_schema.nv_maker_checker_sessions (created_at)
  `);
}

/**
 * @returns true when all required tables are present (ready for DML).
 */
export async function ensureNvSchemaTables(db: {
  execute: (q: unknown) => Promise<unknown>;
}): Promise<boolean> {
  if (ensured) return true;
  if (ensuring) return ensuring;
  ensuring = (async () => {
    try {
      const have = await existingTables(db as any);
      const missing = REQUIRED.filter((t) => !have.has(t));
      if (missing.length === 0) {
        ensured = true;
        logger.info('nv_schema_tables_ready', { tables: [...REQUIRED] });
        return true;
      }

      try {
        await tryDdl(db);
        const after = await existingTables(db as any);
        const stillMissing = REQUIRED.filter((t) => !after.has(t));
        if (stillMissing.length === 0) {
          ensured = true;
          logger.info('nv_schema_tables_ensured');
          return true;
        }
        if (!warnedMissing) {
          warnedMissing = true;
          logger.warn('nv_schema_tables_missing_need_admin_migration', {
            missing: stillMissing,
            hint: 'Apply migrations/2026-06-29-jrx-maker-checker-sessions.sql via DATABASE_URL_ADMIN',
          });
        }
        return false;
      } catch (ddlErr: any) {
        // Expected on prod nv_app (no CREATE). Credit tables may already exist.
        const after = await existingTables(db as any).catch(() => new Set<string>());
        const stillMissing = REQUIRED.filter((t) => !after.has(t));
        if (stillMissing.length === 0) {
          ensured = true;
          logger.info('nv_schema_tables_ready', { note: 'ddl_skipped_already_present' });
          return true;
        }
        if (!warnedMissing) {
          warnedMissing = true;
          logger.warn('nv_schema_tables_ensure_skipped', {
            error: ddlErr?.message || String(ddlErr),
            missing: stillMissing,
            hint: 'nv_app lacks CREATE on nv_schema — apply admin migration',
          });
        }
        return false;
      }
    } finally {
      ensuring = null;
    }
  })();
  return ensuring;
}
