#!/usr/bin/env tsx
/**
 * Task #156 — SME Legal Chat E2E bootstrap.
 *
 * Idempotent. Run via:
 *   DATABASE_URL=$JRX_DATABASE_URL npx tsx scripts/jrx-sme-bootstrap.ts
 *
 * Uses NV-DB-SCRIPT-001-compliant `makePgSql()` from scripts/_pg-pool.ts.
 */

import type { Pool } from 'pg';
import { makePgSql } from './_pg-pool.js';

async function main(): Promise<void> {
  const sql = makePgSql();
  const pool: Pool = sql.pool;

  await sql`
    CREATE TABLE IF NOT EXISTS sme_allocations (
      id BIGSERIAL PRIMARY KEY,
      sme_user_id BIGINT NOT NULL,
      allocated_by_user_id BIGINT NOT NULL,
      scope JSONB NOT NULL DEFAULT '{}'::jsonb,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      revoked_at TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS nv_grpo_preference_pairs (
      id BIGSERIAL PRIMARY KEY,
      orchestration_id TEXT NOT NULL,
      sme_user_id BIGINT NOT NULL,
      jurisdiction TEXT NOT NULL,
      task_kind TEXT NOT NULL,
      model TEXT NOT NULL,
      ratings JSONB NOT NULL,
      avg_score REAL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      enqueued_redis BOOLEAN NOT NULL DEFAULT FALSE
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ix_grpo_pairs_jur_task_model
            ON nv_grpo_preference_pairs(jurisdiction, task_kind, model)`;

  await sql`
    CREATE TABLE IF NOT EXISTS legal_chat_sessions (
      id varchar(36) PRIMARY KEY,
      owner_user_id integer NOT NULL,
      org_id integer,
      title varchar(255) NOT NULL DEFAULT 'Untitled session',
      jurisdictions jsonb NOT NULL DEFAULT '[]'::jsonb,
      tier varchar(32) NOT NULL DEFAULT 'pro',
      mode varchar(64) NOT NULL DEFAULT 'chat',
      preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
      last_used_at timestamptz NOT NULL DEFAULT NOW(),
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS legal_chat_sessions_owner_idx ON legal_chat_sessions(owner_user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS legal_chat_sessions_last_used_idx ON legal_chat_sessions(last_used_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS legal_chat_messages (
      id varchar(36) PRIMARY KEY,
      session_id varchar(36) NOT NULL,
      orchestration_id varchar(64),
      role varchar(16) NOT NULL,
      content text NOT NULL,
      citations jsonb NOT NULL DEFAULT '[]'::jsonb,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS legal_chat_messages_session_idx ON legal_chat_messages(session_id)`;
  await sql`CREATE INDEX IF NOT EXISTS legal_chat_messages_orchestration_idx ON legal_chat_messages(orchestration_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS sme_feedback (
      id serial PRIMARY KEY,
      orchestration_id varchar(64) NOT NULL,
      session_id varchar(36),
      sme_user_id integer NOT NULL,
      ratings jsonb NOT NULL DEFAULT '{}'::jsonb,
      comment text,
      preferred_over varchar(64),
      judge_verdict jsonb,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS sme_feedback_orchestration_idx ON sme_feedback(orchestration_id)`;
  await sql`CREATE INDEX IF NOT EXISTS sme_feedback_sme_idx ON sme_feedback(sme_user_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS nv_sme_setup_tokens (
      id BIGSERIAL PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      sme_user_id BIGINT NOT NULL,
      issued_by_user_id BIGINT NOT NULL,
      scope JSONB NOT NULL DEFAULT '{}'::jsonb,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS ix_sme_setup_tokens_user
            ON nv_sme_setup_tokens(sme_user_id)`;

  type ConRow = { conname: string };
  type DefRow = { def: string };
  const rows = await sql`
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'nv_users'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%role%'
  ` as ConRow[];
  for (const r of rows) {
    const defRows = await sql`
      SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint WHERE conname = ${r.conname}
    ` as DefRow[];
    const text = String(defRows[0]?.def ?? '');
    if (text.toLowerCase().includes("'sme'")) continue;
    console.log(`[sme-bootstrap] adjusting role check ${r.conname}: ${text}`);
    await pool.query(`ALTER TABLE nv_users DROP CONSTRAINT ${r.conname}`);
    const newDef = text
      .replace(/CHECK\s*\(/i, '')
      .replace(/\)\s*$/, '')
      .replace(/IN\s*\(([^)]+)\)/i, (_m, list) => `IN (${list.trim()}, 'sme')`);
    await pool.query(`ALTER TABLE nv_users ADD CONSTRAINT ${r.conname} CHECK (${newDef})`);
  }

  // Backfill: any nv_users row that owns an sme_allocations entry MUST
  // have role='sme' so RBAC gates (isSmeRun, /sme shell) resolve correctly
  // on legacy users created before the SME role existed. Idempotent.
  try {
    type BackfillRow = { user_id: string; prev_role: string };
    const updated = await sql`
      UPDATE nv_users u
         SET role = 'sme'
        FROM sme_allocations a
       WHERE a.sme_user_id = u.id
         AND COALESCE(u.role, '') <> 'sme'
       RETURNING u.id AS user_id, COALESCE(u.role, '') AS prev_role
    ` as BackfillRow[];
    if (updated.length > 0) {
      console.log(`[sme-bootstrap] backfilled role='sme' on ${updated.length} legacy allocation users`);
    } else {
      console.log('[sme-bootstrap] backfill: no legacy allocation users needed role=sme');
    }
  } catch (e) {
    console.warn('[sme-bootstrap] backfill skipped:', (e as Error).message);
  }

  await sql.end();
  console.log('[sme-bootstrap] OK — tables ready, sme role permitted, legacy allocations backfilled.');
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('[sme-bootstrap] FAILED:', msg);
  process.exit(1);
});
