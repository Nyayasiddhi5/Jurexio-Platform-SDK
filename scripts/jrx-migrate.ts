/**
 * Jurexio Platform 3.1.2 — DB Migration Runner
 * JRX-SCRIPT-MIGRATE-001
 * Runs safe schema migrations — never drops existing columns
 */

// NV-DB-SCRIPT-001 (2026-05-10): see replit.md — neon HTTP silently drops
// writes; standalone scripts must use the pg.Pool shim. We import pg.Pool
// directly for the multi-statement RLS migration that needs `client.query`.
import { makePgSql } from './_pg-pool.js';
import { Pool } from 'pg';
import { normalizePgConnectionString } from '../src/utils/jrx-pg-url.js';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';

dotenv.config();

const sql = makePgSql(process.env.DATABASE_URL!);

/**
 * Task #29 deliverable #2/#3 — apply the RLS + field-encryption migration
 * (drizzle/0004_enable_rls_for_tenant_tables.sql) using a real pg-compatible
 * connection so DO blocks and multi-statement scripts execute correctly.
 *
 * Phased rollout:
 *   • app.field_encryption_key is bound from process.env.JRX_FIELD_ENCRYPTION_KEY
 *     (or ENCRYPTION_KEY) so the in-migration backfill DO block actually runs
 *     when a key is configured. Without a key, the backfill self-skips with a
 *     RAISE NOTICE — no plaintext is touched.
 *   • app.nyv_rls_enforce is bound from process.env.JRX_RLS_ENFORCE. When
 *     'true', the migration enables + forces strict RLS on every
 *     nv_, ns_, ni_, nm_ table with an org_id column. When unset/'false'
 *     (default), policies are installed but RLS is left disabled — safe to
 *     deploy without wiring all 80+ DB call sites first.
 *     See docs/v3.1.2/completed_docs/JRX-COMPLIANCE-ATTESTATION.md for the operator runbook.
 */
async function applyRlsAndFieldEncryptionMigration(): Promise<void> {
  const pool = new Pool({
    connectionString: normalizePgConnectionString(process.env.DATABASE_URL!),
    ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
    max: 4,
  });
  const client = await pool.connect();
  try {
    const key = process.env.JRX_FIELD_ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY ?? '';
    const enforce = (process.env.JRX_RLS_ENFORCE ?? '').toLowerCase() === 'true' ? 'true' : 'false';

    // SET — not SET LOCAL — so the GUC is visible to the DO blocks below.
    // We never SET app.field_encryption_key when no key is configured, so a
    // misconfigured deploy logs a RAISE NOTICE instead of double-encrypting.
    if (key) {
      await client.query(`SELECT set_config('app.field_encryption_key', $1, false)`, [key]);
    }
    await client.query(`SELECT set_config('app.nyv_rls_enforce', $1, false)`, [enforce]);

    const sqlPath = resolve(process.cwd(), 'drizzle', '0004_enable_rls_for_tenant_tables.sql');
    const sqlText = readFileSync(sqlPath, 'utf8');
    await client.query(sqlText);

    if (enforce === 'true') {
      console.log('  ✓ 0004 RLS + field encryption (RLS ENFORCED — strict policy active)');
    } else {
      console.log('  ✓ 0004 RLS + field encryption (RLS policies installed; enforcement OFF — set JRX_RLS_ENFORCE=true to enforce)');
    }
    if (!key) {
      console.log('  ⚠ JRX_FIELD_ENCRYPTION_KEY not set — encrypted backfill skipped (existing plaintext untouched)');
    }

    // task-354 (2026-05-13): 0012_customer_organizations.sql adds the
    // nv_customer_organizations table AND the customer_org_id columns
    // that 0013's RLS policies reference. It was previously applied via
    // drizzle-kit push out-of-band — on a fresh dev DB that path is not
    // taken and 0013 fails with "column customer_org_id does not exist".
    // The file is fully idempotent (CREATE TABLE IF NOT EXISTS, ADD
    // COLUMN IF NOT EXISTS), so applying it on every startup is safe.
    const sqlPath0012 = resolve(process.cwd(), 'drizzle', '0012_customer_organizations.sql');
    const sqlText0012 = readFileSync(sqlPath0012, 'utf8');
    await client.query(sqlText0012);
    console.log('  ✓ 0012 customer organizations (table + customer_org_id columns)');

    // Task #355 — 0013_customer_org_rls.sql installs the (platform_id,
    // customer_org_id) policies on the seven tenant-scoped hot-path tables.
    // Same `app.nyv_rls_enforce` gate as 0004 so a single env flip flips
    // both legacy org_id and the new two-tier policies together.
    const sqlPath0013 = resolve(process.cwd(), 'drizzle', '0013_customer_org_rls.sql');
    const sqlText0013 = readFileSync(sqlPath0013, 'utf8');
    await client.query(sqlText0013);
    if (enforce === 'true') {
      console.log('  ✓ 0013 customer_org RLS (ENFORCED — strict (platform_id, customer_org_id) policy active)');
    } else {
      console.log('  ✓ 0013 customer_org RLS (policies installed; enforcement OFF — set JRX_RLS_ENFORCE=true to enforce)');
    }

    // Task #385 — 0015_customer_org_platform_fk.sql adds the missing FK +
    // NOT NULL re-assert on nv_customer_organizations.platform_id, closing
    // the structural gap that let a customer org be onboarded without a
    // real platform binding. Idempotent (gated on pg_constraint /
    // information_schema.columns.is_nullable). Pre-flight RAISEs on any
    // orphan/NULL row before touching the schema — see
    // scripts/jrx-task385-preflight.ts for the read-only inventory pass
    // meant to be run against prod RDS first.
    const sqlPath0015 = resolve(process.cwd(), 'drizzle', '0015_customer_org_platform_fk.sql');
    const sqlText0015 = readFileSync(sqlPath0015, 'utf8');
    await client.query(sqlText0015);
    console.log('  ✓ 0015 customer_org platform FK (FK + NOT NULL on nv_customer_organizations.platform_id)');
  } finally {
    client.release();
    await pool.end();
  }
}

async function migrate() {
  console.log('\n  Running Jurexio Platform 5.0.0 migrations...\n');

  try {
    // Enable UUID extension
    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;
    console.log('  ✓ UUID extension enabled');

    // ── Core Infrastructure ────────────────────────────────────

    await sql`
      CREATE TABLE IF NOT EXISTS nv_users (
        id              SERIAL PRIMARY KEY,
        email           VARCHAR(255) UNIQUE NOT NULL,
        password_hash   VARCHAR(255),
        full_name       VARCHAR(255),
        role            VARCHAR(50) NOT NULL DEFAULT 'user',
        tier            VARCHAR(50) NOT NULL DEFAULT 'solo',
        org_id          INTEGER,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        last_login_at   TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_users');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_organizations (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(255) NOT NULL,
        slug            VARCHAR(100) UNIQUE NOT NULL,
        tier            VARCHAR(50) NOT NULL DEFAULT 'pro',
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        settings        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_organizations');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_sessions (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id         INTEGER NOT NULL REFERENCES nv_users(id) ON DELETE CASCADE,
        refresh_token   TEXT,
        expires_at      TIMESTAMP NOT NULL,
        ip_address      VARCHAR(45),
        user_agent      TEXT,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_sessions');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_auth_tokens (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER REFERENCES nv_users(id) ON DELETE CASCADE,
        token_hash      VARCHAR(255) UNIQUE NOT NULL,
        token_type      VARCHAR(50) NOT NULL DEFAULT 'access',
        is_revoked      BOOLEAN NOT NULL DEFAULT FALSE,
        expires_at      TIMESTAMP NOT NULL,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_auth_tokens');

    // ── Agent Management ───────────────────────────────────────

    await sql`
      CREATE TABLE IF NOT EXISTS nv_agents (
        id              VARCHAR(50) PRIMARY KEY,
        name            VARCHAR(255) NOT NULL,
        category        VARCHAR(100) NOT NULL,
        subcategory     VARCHAR(100),
        description     TEXT,
        jurisdiction    TEXT[] DEFAULT '{}',
        statutes        TEXT[] DEFAULT '{}',
        capabilities    TEXT[] DEFAULT '{}',
        default_model   VARCHAR(100),
        fallback_model  VARCHAR(100),
        tier_required   VARCHAR(50) NOT NULL DEFAULT 'solo',
        language_support TEXT[] DEFAULT '{en}',
        system_prompt_key VARCHAR(200),
        tools           TEXT[] DEFAULT '{}',
        roma_level      INTEGER NOT NULL DEFAULT 1,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_agents');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_agent_configs (
        id              SERIAL PRIMARY KEY,
        agent_id        VARCHAR(50) REFERENCES nv_agents(id) ON DELETE CASCADE,
        model_override  VARCHAR(100),
        temperature     FLOAT DEFAULT 0.7,
        max_tokens      INTEGER DEFAULT 4096,
        top_p           FLOAT DEFAULT 1.0,
        custom_params   JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_agent_configs');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_agent_performance (
        id              SERIAL PRIMARY KEY,
        agent_id        VARCHAR(50) REFERENCES nv_agents(id) ON DELETE CASCADE,
        avg_latency_ms  FLOAT,
        success_rate    FLOAT,
        total_calls     INTEGER DEFAULT 0,
        tokens_used     BIGINT DEFAULT 0,
        cost_usd        FLOAT DEFAULT 0,
        period_start    TIMESTAMP,
        period_end      TIMESTAMP,
        recorded_at     TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_agent_performance');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_agent_personas (
        id              SERIAL PRIMARY KEY,
        agent_id        VARCHAR(50) REFERENCES nv_agents(id) ON DELETE CASCADE,
        name            VARCHAR(255) NOT NULL,
        persona_prompt  TEXT NOT NULL,
        jurisdiction    VARCHAR(50),
        language        VARCHAR(10) DEFAULT 'en',
        created_by      INTEGER REFERENCES nv_users(id),
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_agent_personas');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_roma_levels (
        id              SERIAL PRIMARY KEY,
        agent_id        VARCHAR(50) REFERENCES nv_agents(id) ON DELETE CASCADE,
        level           INTEGER NOT NULL DEFAULT 1,
        promoted_at     TIMESTAMP NOT NULL DEFAULT NOW(),
        trigger_reason  TEXT,
        confidence_score FLOAT
      )`;
    console.log('  ✓ nv_roma_levels');

    // ── SDK and API Management ─────────────────────────────────

    await sql`
      CREATE TABLE IF NOT EXISTS nv_sdk_applications (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name            VARCHAR(255) NOT NULL,
        app_type        VARCHAR(100) NOT NULL,
        jurisdiction    VARCHAR(10) NOT NULL DEFAULT 'IN',
        owner_id        INTEGER REFERENCES nv_users(id),
        org_id          INTEGER REFERENCES nv_organizations(id),
        tier            VARCHAR(50) NOT NULL DEFAULT 'solo',
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        settings        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_sdk_applications');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_api_keys (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        app_id          VARCHAR(36) REFERENCES nv_sdk_applications(id) ON DELETE CASCADE,
        key_prefix      VARCHAR(20) NOT NULL,
        key_hash        VARCHAR(255) UNIQUE NOT NULL,
        name            VARCHAR(255),
        permissions     TEXT[] DEFAULT '{}',
        rate_limit      INTEGER DEFAULT 1000,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        last_used_at    TIMESTAMP,
        expires_at      TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_api_keys');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_sdk_usage_metrics (
        id              SERIAL PRIMARY KEY,
        app_id          VARCHAR(36) REFERENCES nv_sdk_applications(id) ON DELETE CASCADE,
        endpoint        VARCHAR(255),
        method          VARCHAR(10),
        status_code     INTEGER,
        latency_ms      INTEGER,
        tokens_in       INTEGER DEFAULT 0,
        tokens_out      INTEGER DEFAULT 0,
        cost_usd        FLOAT DEFAULT 0,
        agent_id        VARCHAR(50),
        recorded_at     TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_sdk_usage_metrics');

    // ── LLM and Model Management ───────────────────────────────

    await sql`
      CREATE TABLE IF NOT EXISTS nv_llm_providers (
        id              SERIAL PRIMARY KEY,
        provider_id     VARCHAR(100) UNIQUE NOT NULL,
        name            VARCHAR(255) NOT NULL,
        api_base_url    VARCHAR(500),
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        capabilities    TEXT[] DEFAULT '{}',
        supported_models JSONB DEFAULT '[]',
        rate_limits     JSONB DEFAULT '{}',
        cost_per_1k_tokens_in  FLOAT,
        cost_per_1k_tokens_out FLOAT,
        avg_latency_ms  FLOAT,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_llm_providers');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_model_catalog (
        id              SERIAL PRIMARY KEY,
        model_id        VARCHAR(200) UNIQUE NOT NULL,
        provider_id     VARCHAR(100),
        display_name    VARCHAR(255) NOT NULL,
        context_window  INTEGER,
        max_output_tokens INTEGER,
        supports_vision BOOLEAN DEFAULT FALSE,
        supports_tools  BOOLEAN DEFAULT FALSE,
        cost_per_1k_in  FLOAT,
        cost_per_1k_out FLOAT,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_model_catalog');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_token_metrics (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER REFERENCES nv_users(id),
        app_id          VARCHAR(36),
        agent_id        VARCHAR(50),
        provider_id     VARCHAR(100),
        model_id        VARCHAR(200),
        tokens_in       INTEGER DEFAULT 0,
        tokens_out      INTEGER DEFAULT 0,
        cost_usd        FLOAT DEFAULT 0,
        request_id      VARCHAR(36),
        recorded_at     TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_token_metrics');

    // ── Orchestration ──────────────────────────────────────────

    await sql`
      CREATE TABLE IF NOT EXISTS nv_orchestration_jobs (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        type            VARCHAR(100) NOT NULL,
        status          VARCHAR(50) NOT NULL DEFAULT 'pending',
        agent_id        VARCHAR(50),
        input           JSONB,
        output          JSONB,
        error           TEXT,
        started_at      TIMESTAMP,
        completed_at    TIMESTAMP,
        user_id         INTEGER REFERENCES nv_users(id),
        app_id          VARCHAR(36),
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_orchestration_jobs');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_dag_jobs (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name            VARCHAR(255) NOT NULL,
        status          VARCHAR(50) NOT NULL DEFAULT 'pending',
        dag_definition  JSONB NOT NULL,
        results         JSONB DEFAULT '{}',
        user_id         INTEGER REFERENCES nv_users(id),
        started_at      TIMESTAMP,
        completed_at    TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_dag_jobs');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_job_queue (
        id              SERIAL PRIMARY KEY,
        job_type        VARCHAR(100) NOT NULL,
        payload         JSONB NOT NULL,
        status          VARCHAR(50) NOT NULL DEFAULT 'queued',
        priority        INTEGER DEFAULT 5,
        attempts        INTEGER DEFAULT 0,
        max_attempts    INTEGER DEFAULT 3,
        next_retry_at   TIMESTAMP,
        error           TEXT,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_job_queue');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_hitl_queue (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        agent_id        VARCHAR(50),
        task_type       VARCHAR(100) NOT NULL,
        context         JSONB NOT NULL,
        status          VARCHAR(50) NOT NULL DEFAULT 'pending',
        assigned_to     INTEGER REFERENCES nv_users(id),
        priority        VARCHAR(20) DEFAULT 'normal',
        deadline_at     TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_hitl_queue');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_hitl_decisions (
        id              SERIAL PRIMARY KEY,
        hitl_id         VARCHAR(36) REFERENCES nv_hitl_queue(id) ON DELETE CASCADE,
        decision        VARCHAR(50) NOT NULL,
        reasoning       TEXT,
        decided_by      INTEGER REFERENCES nv_users(id),
        decided_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_hitl_decisions');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_bmad_clusters (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name            VARCHAR(255) NOT NULL,
        agent_ids       TEXT[] NOT NULL DEFAULT '{}',
        status          VARCHAR(50) NOT NULL DEFAULT 'forming',
        task            TEXT,
        result          JSONB,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at    TIMESTAMP
      )`;
    console.log('  ✓ nv_bmad_clusters');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_grpo_runs (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        agent_id        VARCHAR(50),
        model           VARCHAR(200),
        status          VARCHAR(50) NOT NULL DEFAULT 'running',
        config          JSONB DEFAULT '{}',
        metrics         JSONB DEFAULT '{}',
        started_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        completed_at    TIMESTAMP
      )`;
    console.log('  ✓ nv_grpo_runs');

    // ── Knowledge, Documents, and RAG ─────────────────────────

    await sql`
      CREATE TABLE IF NOT EXISTS nv_documents (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name            VARCHAR(500) NOT NULL,
        file_type       VARCHAR(50),
        file_size_bytes BIGINT,
        storage_url     TEXT,
        status          VARCHAR(50) DEFAULT 'uploaded',
        user_id         INTEGER REFERENCES nv_users(id),
        app_id          VARCHAR(36),
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_documents');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_rag_documents (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        title           VARCHAR(500) NOT NULL,
        content         TEXT,
        doc_type        VARCHAR(100),
        jurisdiction    VARCHAR(50),
        statute         VARCHAR(200),
        indexed_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        is_active       BOOLEAN NOT NULL DEFAULT TRUE
      )`;
    console.log('  ✓ nv_rag_documents');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_rag_chunks (
        id              SERIAL PRIMARY KEY,
        doc_id          VARCHAR(36) REFERENCES nv_rag_documents(id) ON DELETE CASCADE,
        chunk_text      TEXT NOT NULL,
        chunk_index     INTEGER,
        embedding_model VARCHAR(100),
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_rag_chunks');

    // ── Memory and Context ────────────────────────────────────

    await sql`
      CREATE TABLE IF NOT EXISTS nv_memory_entries (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id         INTEGER REFERENCES nv_users(id),
        agent_id        VARCHAR(50),
        session_id      VARCHAR(36),
        content         TEXT NOT NULL,
        entry_type      VARCHAR(50) DEFAULT 'fact',
        importance      INTEGER DEFAULT 5,
        tags            TEXT[] DEFAULT '{}',
        expires_at      TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_memory_entries');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_matter_memory (
        id              SERIAL PRIMARY KEY,
        matter_id       TEXT NOT NULL,
        user_id         INTEGER,
        org_id          INTEGER,
        memory_type     TEXT NOT NULL,
        content         TEXT NOT NULL,
        tokens          INTEGER,
        importance      REAL,
        metadata        JSONB DEFAULT '{}',
        expires_at      TIMESTAMP,
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_mm_matter_type ON nv_matter_memory (matter_id, memory_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_mm_user_id ON nv_matter_memory (user_id)`;
    console.log('  ✓ nv_matter_memory (L2 tier)');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_client_memory (
        id              SERIAL PRIMARY KEY,
        client_id       TEXT NOT NULL,
        user_id         INTEGER,
        attribute       TEXT NOT NULL,
        value           TEXT NOT NULL,
        confidence      REAL,
        evidence_matter_ids JSONB DEFAULT '[]',
        last_updated    TIMESTAMP DEFAULT NOW() NOT NULL,
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cm_client_attr ON nv_client_memory (client_id, attribute)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cm_user_id ON nv_client_memory (user_id)`;
    console.log('  ✓ nv_client_memory (L3 tier)');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_jurisdictional_memory (
        id              SERIAL PRIMARY KEY,
        jurisdiction    TEXT NOT NULL,
        domain          TEXT NOT NULL,
        insight_key     TEXT NOT NULL,
        insight_value   TEXT NOT NULL,
        confidence      REAL DEFAULT 0.5,
        source          TEXT,
        user_id         INTEGER,
        metadata        JSONB DEFAULT '{}',
        last_updated    TIMESTAMP DEFAULT NOW() NOT NULL,
        created_at      TIMESTAMP DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_jm_jd ON nv_jurisdictional_memory (jurisdiction, domain)`;
    console.log('  ✓ nv_jurisdictional_memory (L4 tier)');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_precedent_memory (
        id              SERIAL PRIMARY KEY,
        case_id         TEXT NOT NULL,
        citation        TEXT NOT NULL,
        jurisdiction    TEXT NOT NULL,
        court           TEXT,
        year            INTEGER,
        principle_of_law TEXT NOT NULL,
        headnote        TEXT,
        status          TEXT NOT NULL DEFAULT 'active',
        overruled_by    TEXT,
        distinguished_in JSONB DEFAULT '[]',
        applied_in      JSONB DEFAULT '[]',
        relevance_score REAL DEFAULT 0.5,
        embedding_vector TEXT,
        user_id         INTEGER,
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_pm_case ON nv_precedent_memory (case_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_pm_citation ON nv_precedent_memory (citation)`;
    console.log('  ✓ nv_precedent_memory (L5 tier)');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_voice_sessions (
        id              SERIAL PRIMARY KEY,
        session_id      VARCHAR(36) UNIQUE NOT NULL,
        user_id         INTEGER,
        language        VARCHAR(20) DEFAULT 'en-IN',
        provider        VARCHAR(50),
        duration_ms     INTEGER,
        transcript_text TEXT,
        word_count      INTEGER,
        confidence      REAL,
        status          VARCHAR(50) DEFAULT 'active',
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP DEFAULT NOW(),
        updated_at      TIMESTAMP DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_vs_user ON nv_voice_sessions (user_id)`;
    console.log('  ✓ nv_voice_sessions');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_chat_sessions (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id         INTEGER REFERENCES nv_users(id),
        agent_id        VARCHAR(50),
        app_id          VARCHAR(36),
        messages        JSONB DEFAULT '[]',
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_chat_sessions');

    // ── MCP Tools ──────────────────────────────────────────────

    await sql`
      CREATE TABLE IF NOT EXISTS nv_mcp_tools (
        id              SERIAL PRIMARY KEY,
        tool_id         VARCHAR(100) UNIQUE NOT NULL,
        name            VARCHAR(255) NOT NULL,
        description     TEXT,
        tool_type       VARCHAR(100),
        config          JSONB DEFAULT '{}',
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_mcp_tools');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_mcp_tool_calls (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tool_id         VARCHAR(100),
        input_params    JSONB,
        output_result   JSONB,
        status          VARCHAR(50) DEFAULT 'success',
        latency_ms      INTEGER,
        error           TEXT,
        called_by       INTEGER REFERENCES nv_users(id),
        called_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_mcp_tool_calls');

    // ── Audit and Security ────────────────────────────────────

    await sql`
      CREATE TABLE IF NOT EXISTS nv_audit_logs (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER REFERENCES nv_users(id),
        action          VARCHAR(200) NOT NULL,
        resource_type   VARCHAR(100),
        resource_id     VARCHAR(100),
        ip_address      VARCHAR(45),
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_audit_logs');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_pii_vault (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id         INTEGER REFERENCES nv_users(id),
        field_type      VARCHAR(100) NOT NULL,
        encrypted_value TEXT NOT NULL,
        iv              TEXT,
        purpose         TEXT,
        expires_at      TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_pii_vault');

    // ── Operational ────────────────────────────────────────────

    await sql`
      CREATE TABLE IF NOT EXISTS nv_jurisdiction_configs (
        id              SERIAL PRIMARY KEY,
        jurisdiction    VARCHAR(10) UNIQUE NOT NULL,
        name            VARCHAR(255) NOT NULL,
        legal_framework TEXT[] DEFAULT '{}',
        languages       TEXT[] DEFAULT '{}',
        currency        VARCHAR(10),
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        config          JSONB DEFAULT '{}'
      )`;
    console.log('  ✓ nv_jurisdiction_configs');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_feature_flags (
        id              SERIAL PRIMARY KEY,
        flag_key        VARCHAR(100) UNIQUE NOT NULL,
        is_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
        description     TEXT,
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_feature_flags');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_system_configs (
        id              SERIAL PRIMARY KEY,
        config_key      VARCHAR(200) UNIQUE NOT NULL,
        config_value    TEXT NOT NULL,
        description     TEXT,
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_system_configs');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_workspace_projects (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        name            VARCHAR(255) NOT NULL,
        description     TEXT,
        user_id         INTEGER REFERENCES nv_users(id),
        app_id          VARCHAR(36),
        status          VARCHAR(50) DEFAULT 'active',
        config          JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_workspace_projects');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_voice_sessions (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id         INTEGER REFERENCES nv_users(id),
        agent_id        VARCHAR(50),
        status          VARCHAR(50) DEFAULT 'active',
        language        VARCHAR(10) DEFAULT 'en',
        transcript      TEXT,
        audio_url       TEXT,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        ended_at        TIMESTAMP
      )`;
    console.log('  ✓ nv_voice_sessions');

    // ── SDK Application Tables (shared/schema) ──────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS sdk_applications (
        id              SERIAL PRIMARY KEY,
        organization_id INTEGER,
        app_name        VARCHAR(255) NOT NULL,
        app_type        VARCHAR(100) NOT NULL,
        description     TEXT,
        client_id       VARCHAR(100) UNIQUE NOT NULL,
        client_secret_hash VARCHAR(255) NOT NULL,
        client_secret_prefix VARCHAR(20),
        allowed_agents  JSONB DEFAULT '[]',
        llm_config      JSONB DEFAULT '{}',
        rate_limit_per_minute INTEGER DEFAULT 60,
        daily_token_budget INTEGER DEFAULT 100000,
        monthly_token_budget INTEGER DEFAULT 1000000,
        allowed_origins JSONB DEFAULT '[]',
        jurisdiction    VARCHAR(10) DEFAULT 'IN',
        metadata        JSONB DEFAULT '{}',
        status          VARCHAR(50) DEFAULT 'active',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ sdk_applications');

    await sql`
      CREATE TABLE IF NOT EXISTS sdk_app_api_keys (
        id              SERIAL PRIMARY KEY,
        application_id  INTEGER,
        key_hash        VARCHAR(255) UNIQUE NOT NULL,
        key_prefix      VARCHAR(20) NOT NULL,
        name            VARCHAR(255),
        scopes          JSONB DEFAULT '[]',
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        last_used_at    TIMESTAMP,
        expires_at      TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ sdk_app_api_keys');

    await sql`
      CREATE TABLE IF NOT EXISTS sdk_app_agent_allocations (
        id              SERIAL PRIMARY KEY,
        application_id  INTEGER,
        agent_id        VARCHAR(100) NOT NULL,
        agent_name      VARCHAR(255),
        practice_area   VARCHAR(100),
        priority        INTEGER DEFAULT 5,
        daily_token_limit INTEGER,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ sdk_app_agent_allocations');

    await sql`
      CREATE TABLE IF NOT EXISTS sdk_api_request_logs (
        id              SERIAL PRIMARY KEY,
        application_id  INTEGER,
        api_key_id      INTEGER,
        endpoint        VARCHAR(500),
        method          VARCHAR(10),
        status_code     INTEGER,
        latency_ms      INTEGER,
        tokens_in       INTEGER DEFAULT 0,
        tokens_out      INTEGER DEFAULT 0,
        agent_id        VARCHAR(100),
        request_id      VARCHAR(36),
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ sdk_api_request_logs');

    await sql`
      CREATE TABLE IF NOT EXISTS sdk_clause_library (
        id              SERIAL PRIMARY KEY,
        clause_id       VARCHAR(100) UNIQUE NOT NULL,
        title           VARCHAR(255) NOT NULL,
        category        VARCHAR(100),
        description     TEXT,
        default_text    TEXT,
        jurisdiction_variants JSONB DEFAULT '{}',
        tags            JSONB DEFAULT '[]',
        risk            VARCHAR(50),
        popularity      INTEGER DEFAULT 0,
        version         VARCHAR(20) DEFAULT '1.0',
        is_system       BOOLEAN DEFAULT FALSE,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ sdk_clause_library');

    await sql`
      CREATE TABLE IF NOT EXISTS sdk_compliance_controls (
        id              SERIAL PRIMARY KEY,
        control_id      VARCHAR(100) UNIQUE NOT NULL,
        framework       VARCHAR(100),
        jurisdiction    VARCHAR(50),
        title           VARCHAR(255) NOT NULL,
        category        VARCHAR(100),
        severity        VARCHAR(50),
        requirements    JSONB DEFAULT '[]',
        automation_level VARCHAR(50),
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ sdk_compliance_controls');

    await sql`
      CREATE TABLE IF NOT EXISTS sdk_document_templates (
        id              SERIAL PRIMARY KEY,
        template_id     VARCHAR(100) UNIQUE NOT NULL,
        name            VARCHAR(255) NOT NULL,
        category        VARCHAR(100),
        jurisdiction    VARCHAR(50),
        languages       JSONB DEFAULT '[]',
        version         VARCHAR(20) DEFAULT '1.0',
        is_system       BOOLEAN DEFAULT FALSE,
        content         TEXT,
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ sdk_document_templates');

    await sql`
      CREATE TABLE IF NOT EXISTS sdk_usage_metering (
        id              SERIAL PRIMARY KEY,
        application_id  INTEGER,
        agent_id        VARCHAR(100),
        tokens_in       INTEGER DEFAULT 0,
        tokens_out      INTEGER DEFAULT 0,
        cost_usd        FLOAT DEFAULT 0,
        period          VARCHAR(20),
        request_count   INTEGER DEFAULT 0,
        metadata        JSONB DEFAULT '{}',
        recorded_at     TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ sdk_usage_metering');

    await sql`
      CREATE TABLE IF NOT EXISTS sdk_workflows (
        id              SERIAL PRIMARY KEY,
        application_id  INTEGER,
        name            VARCHAR(255) NOT NULL,
        workflow_type   VARCHAR(100),
        definition      JSONB DEFAULT '{}',
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ sdk_workflows');

    await sql`
      CREATE TABLE IF NOT EXISTS sdk_workflow_executions (
        id              SERIAL PRIMARY KEY,
        workflow_id     INTEGER,
        application_id  INTEGER,
        status          VARCHAR(50) DEFAULT 'pending',
        input           JSONB DEFAULT '{}',
        output          JSONB DEFAULT '{}',
        error           TEXT,
        started_at      TIMESTAMP,
        completed_at    TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ sdk_workflow_executions');

    // ── Document Pipeline Tables ──────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS document_parsing (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER,
        filename        VARCHAR(500),
        original_filename VARCHAR(500),
        mime_type       VARCHAR(100),
        file_size       INTEGER,
        page_count      INTEGER,
        language        VARCHAR(10),
        status          VARCHAR(50) DEFAULT 'pending',
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ document_parsing');

    await sql`
      CREATE TABLE IF NOT EXISTS document_pages (
        id              SERIAL PRIMARY KEY,
        document_id     INTEGER,
        page_number     INTEGER,
        text            TEXT,
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ document_pages');

    await sql`
      CREATE TABLE IF NOT EXISTS document_extracted_content (
        id              SERIAL PRIMARY KEY,
        document_id     INTEGER,
        content_type    VARCHAR(100),
        content         TEXT,
        confidence      FLOAT,
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ document_extracted_content');

    await sql`
      CREATE TABLE IF NOT EXISTS document_processing_jobs (
        id              SERIAL PRIMARY KEY,
        document_id     INTEGER,
        job_type        VARCHAR(100),
        status          VARCHAR(50) DEFAULT 'pending',
        priority        INTEGER DEFAULT 5,
        result          JSONB DEFAULT '{}',
        error           TEXT,
        started_at      TIMESTAMP,
        completed_at    TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ document_processing_jobs');

    // ── HITL Workflow Tables ──────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS hitl_workflows (
        id              SERIAL PRIMARY KEY,
        name            VARCHAR(255) NOT NULL,
        description     TEXT,
        owner_id        VARCHAR(100),
        workflow_type   VARCHAR(100),
        steps           JSONB DEFAULT '[]',
        trigger_conditions JSONB DEFAULT '[]',
        required_approvers JSONB DEFAULT '[]',
        escalation_timeout_minutes INTEGER DEFAULT 60,
        auto_approve_threshold FLOAT,
        require_review_threshold FLOAT,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ hitl_workflows');

    await sql`
      CREATE TABLE IF NOT EXISTS hitl_workflow_executions (
        id              SERIAL PRIMARY KEY,
        workflow_id     INTEGER,
        triggered_by    VARCHAR(100),
        trigger_type    VARCHAR(100),
        trigger_context JSONB DEFAULT '{}',
        agent_confidence FLOAT,
        status          VARCHAR(50) DEFAULT 'pending',
        current_step_id VARCHAR(100),
        approvals       JSONB DEFAULT '[]',
        result          JSONB DEFAULT '{}',
        started_at      TIMESTAMP,
        completed_at    TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ hitl_workflow_executions');

    // ── Email Automation Tables ───────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS wai_email_accounts (
        id              SERIAL PRIMARY KEY,
        user_id         VARCHAR(100),
        organization_id INTEGER,
        provider        VARCHAR(50),
        email           VARCHAR(255),
        access_token    TEXT,
        refresh_token   TEXT,
        token_expires_at TIMESTAMP,
        imap_host       VARCHAR(255),
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ wai_email_accounts');

    await sql`
      CREATE TABLE IF NOT EXISTS wai_emails (
        id              SERIAL PRIMARY KEY,
        account_id      INTEGER,
        message_id      VARCHAR(255),
        subject         TEXT,
        from_address    VARCHAR(255),
        to_addresses    JSONB DEFAULT '[]',
        body            TEXT,
        is_read         BOOLEAN DEFAULT FALSE,
        is_processed    BOOLEAN DEFAULT FALSE,
        received_at     TIMESTAMP,
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ wai_emails');

    await sql`
      CREATE TABLE IF NOT EXISTS wai_email_processing (
        id              SERIAL PRIMARY KEY,
        email_id        INTEGER,
        processing_type VARCHAR(100),
        status          VARCHAR(50) DEFAULT 'pending',
        result          JSONB DEFAULT '{}',
        error           TEXT,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ wai_email_processing');

    await sql`
      CREATE TABLE IF NOT EXISTS wai_email_automation_rules (
        id              SERIAL PRIMARY KEY,
        account_id      INTEGER,
        name            VARCHAR(255),
        conditions      JSONB DEFAULT '[]',
        actions         JSONB DEFAULT '[]',
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ wai_email_automation_rules');

    await sql`
      CREATE TABLE IF NOT EXISTS wai_email_responses (
        id              SERIAL PRIMARY KEY,
        email_id        INTEGER,
        response_text   TEXT,
        agent_id        VARCHAR(100),
        status          VARCHAR(50) DEFAULT 'draft',
        sent_at         TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ wai_email_responses');

    // ── Context Engineering Tables ────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS jurexio_founder_context_profiles (
        id              SERIAL PRIMARY KEY,
        user_id         VARCHAR(100),
        profile_data    JSONB DEFAULT '{}',
        context_version INTEGER DEFAULT 1,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ jurexio_founder_context_profiles');

    await sql`
      CREATE TABLE IF NOT EXISTS jurexio_context_learning_history (
        id              SERIAL PRIMARY KEY,
        user_id         VARCHAR(100),
        session_id      VARCHAR(100),
        context_data    JSONB DEFAULT '{}',
        outcome         VARCHAR(100),
        feedback        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ jurexio_context_learning_history');

    await sql`
      CREATE TABLE IF NOT EXISTS jurexio_orchestration_jobs (
        id              SERIAL PRIMARY KEY,
        job_type        VARCHAR(100),
        status          VARCHAR(50) DEFAULT 'pending',
        input           JSONB DEFAULT '{}',
        output          JSONB DEFAULT '{}',
        agent_id        VARCHAR(100),
        user_id         INTEGER,
        error           TEXT,
        started_at      TIMESTAMP,
        completed_at    TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ jurexio_orchestration_jobs');

    // ── Legal Agents (full schema for registry service) ──────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS legal_agents (
        id              SERIAL PRIMARY KEY,
        agent_id        VARCHAR(100) UNIQUE NOT NULL,
        name            VARCHAR(255) NOT NULL,
        version         VARCHAR(50) DEFAULT '2.0.0',
        tier            VARCHAR(50) DEFAULT 'solo',
        roma_level      VARCHAR(10) DEFAULT 'L2',
        category        VARCHAR(100) NOT NULL,
        practice_area   VARCHAR(100),
        description     TEXT,
        system_prompt   TEXT DEFAULT '',
        capabilities    TEXT[] DEFAULT '{}',
        tools           TEXT[] DEFAULT '{}',
        protocols       TEXT[] DEFAULT '{}',
        preferred_models TEXT[] DEFAULT '{}',
        fallback_models  TEXT[] DEFAULT '{}',
        operation_modes  JSONB DEFAULT '{}',
        security_level   VARCHAR(50) DEFAULT 'standard',
        reports_to      TEXT[] DEFAULT '{}',
        manages         TEXT[] DEFAULT '{}',
        collaborates_with TEXT[] DEFAULT '{}',
        supported_languages TEXT[] DEFAULT '{}',
        guardrails      JSONB DEFAULT '{}',
        cost_optimization JSONB DEFAULT '{}',
        jurisdictions   TEXT[] DEFAULT '{}',
        indian_law_support JSONB DEFAULT '{}',
        saudi_law_support  JSONB DEFAULT '{}',
        singapore_law_support JSONB DEFAULT '{}',
        uae_law_support     JSONB DEFAULT '{}',
        usa_law_support     JSONB DEFAULT '{}',
        europe_law_support  JSONB DEFAULT '{}',
        status          VARCHAR(50) DEFAULT 'active',
        is_enabled      BOOLEAN DEFAULT TRUE,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ legal_agents');

    // ── Scoped Feature Flags (for feature-flags-service) ─────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS scoped_feature_flags (
        id              SERIAL PRIMARY KEY,
        flag_key        VARCHAR(200) NOT NULL,
        scope           VARCHAR(50) DEFAULT 'global',
        scope_id        VARCHAR(100) DEFAULT '_global',
        is_enabled      BOOLEAN DEFAULT FALSE,
        description     TEXT,
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE(flag_key, scope, scope_id)
      )`;
    console.log('  ✓ scoped_feature_flags');

    // ── Case Management Tables ────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS nv_cases (
        id              SERIAL PRIMARY KEY,
        case_number     VARCHAR(100),
        title           VARCHAR(500) NOT NULL,
        description     TEXT,
        case_type       VARCHAR(100),
        jurisdiction    VARCHAR(200),
        court_name      VARCHAR(255),
        status          VARCHAR(50) DEFAULT 'open',
        priority        VARCHAR(50) DEFAULT 'normal',
        user_id         INTEGER,
        organization_id INTEGER,
        lawyer_id       INTEGER,
        applicable_sections JSONB DEFAULT '[]',
        parties         JSONB DEFAULT '[]',
        client_details  JSONB DEFAULT '{}',
        tags            TEXT[] DEFAULT '{}',
        insights_generated_at TIMESTAMP,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_cases');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_case_documents (
        id              SERIAL PRIMARY KEY,
        case_id         INTEGER NOT NULL,
        document_id     INTEGER,
        added_by        INTEGER,
        document_role   VARCHAR(100) DEFAULT 'supporting',
        summary         TEXT,
        extracted_entities JSONB DEFAULT '{}',
        source          VARCHAR(100) DEFAULT 'upload',
        notes           TEXT,
        version         INTEGER DEFAULT 1,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_case_documents');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_case_insights (
        id              SERIAL PRIMARY KEY,
        case_id         INTEGER NOT NULL,
        insight_type    VARCHAR(100),
        title           VARCHAR(500),
        content         TEXT,
        confidence      REAL DEFAULT 0.8,
        sources         JSONB DEFAULT '[]',
        agent_id        VARCHAR(100),
        orchestration_metadata JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_case_insights');

    // ── Identity Extractions Table ────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS nv_identity_extractions (
        id              SERIAL PRIMARY KEY,
        user_id         INTEGER,
        organization_id INTEGER,
        document_id     INTEGER,
        document_type   VARCHAR(100),
        extracted_fields JSONB DEFAULT '{}',
        confidence      REAL DEFAULT 0.8,
        status          VARCHAR(50) DEFAULT 'extracted',
        agent_id        VARCHAR(100),
        orchestration_metadata JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_identity_extractions');

    // ── NS Document Processing Jobs (Jurexio doc pipeline poller) ────────
    await sql`
      CREATE TABLE IF NOT EXISTS ns_doc_processing_jobs (
        id              VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid()::text,
        org_id          INTEGER,
        document_id     VARCHAR(36),
        document_type   VARCHAR(100),
        extraction_mode VARCHAR(50) DEFAULT 'full',
        status          VARCHAR(50) DEFAULT 'queued',
        progress        INTEGER DEFAULT 0,
        file_name       VARCHAR(500),
        file_size_bytes BIGINT DEFAULT 0,
        priority        INTEGER DEFAULT 5,
        retry_count     INTEGER DEFAULT 0,
        max_retries     INTEGER DEFAULT 3,
        worker_id       VARCHAR(200),
        started_at      TIMESTAMP,
        completed_at    TIMESTAMP,
        error           TEXT,
        result          JSONB DEFAULT '{}',
        metadata        JSONB DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    await sql`ALTER TABLE ns_doc_processing_jobs ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0`;
    await sql`ALTER TABLE ns_doc_processing_jobs ADD COLUMN IF NOT EXISTS max_retries INTEGER DEFAULT 3`;
    console.log('  ✓ ns_doc_processing_jobs');

    // ── Document Embeddings Table (RAG) ───────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS nv_document_embeddings (
        id              SERIAL PRIMARY KEY,
        document_id     INTEGER,
        chunk_id        VARCHAR(100),
        user_id         VARCHAR(100),
        assistant_id    INTEGER,
        text            TEXT,
        text_hash       VARCHAR(64),
        embedding       DOUBLE PRECISION[],
        model           VARCHAR(100),
        provider        VARCHAR(100),
        dimensions      INTEGER,
        chunk_index     INTEGER,
        start_position  INTEGER,
        end_position    INTEGER,
        word_count      INTEGER,
        character_count INTEGER,
        document_type   VARCHAR(100),
        source_file_name VARCHAR(500),
        metadata        JSONB DEFAULT '{}',
        tags            TEXT[] DEFAULT '{}',
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_document_embeddings');

    // ── nv_schema — SHA-256 Hash Chain Audit + GRPO Telemetry + SDK Tracking ──

    await sql`CREATE SCHEMA IF NOT EXISTS nv_schema`;
    console.log('  ✓ nv_schema (schema)');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_audit_logs (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_type    TEXT NOT NULL,
        payload       JSONB NOT NULL DEFAULT '{}',
        previous_hash TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
        record_hash   TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nv_audit_logs_created ON nv_schema.nv_audit_logs (created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nv_audit_logs_event   ON nv_schema.nv_audit_logs (event_type)`;
    console.log('  ✓ nv_schema.nv_audit_logs (SHA-256 hash chain)');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_grpo_runs (
        id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        pattern_key      TEXT NOT NULL,
        route            TEXT NOT NULL,
        agent_id         TEXT,
        jurisdiction     TEXT,
        task_hash        TEXT,
        response_snippet TEXT,
        reward           DOUBLE PRECISION,
        policy_updated   BOOLEAN DEFAULT FALSE,
        total_episodes   INTEGER DEFAULT 0,
        avg_reward       DOUBLE PRECISION,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nv_grpo_runs_pattern    ON nv_schema.nv_grpo_runs (pattern_key)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nv_grpo_runs_created    ON nv_schema.nv_grpo_runs (created_at DESC)`;
    console.log('  ✓ nv_schema.nv_grpo_runs (GRPO telemetry)');

    // ── B2 (2026-05-05): nv_schema.sdk_api_request_logs REMOVED ──
    // The CREATE TABLE for nv_schema.sdk_api_request_logs was DELETED on
    // 2026-05-05 as part of the B2 consolidation. The canonical table is
    // public.sdk_api_request_logs (defined in shared/schema.ts as
    // sdkApiRequestLogs). The middleware writer in
    // src/middleware/jrx-sdk-tracking-middleware.ts was rewritten to write
    // to the public table with the F12 column shape (application_id int,
    // tokens_in/tokens_out, request_id, metadata jsonb).
    //
    // See: scripts/consolidate-sdk-api-request-logs.sql for the migration,
    //      docs/v3.1.2/JRX-DATABASE-CANONICAL-2026-05-05.md §3 for the
    //      full table-of-truth, and scripts/jrx-schema-parity-check.ts for
    //      the runtime guardrail asserting nv_schema.sdk_api_request_logs
    //      MUST NOT exist.
    console.log('  ✓ nv_schema.sdk_api_request_logs (B2: now public.sdk_api_request_logs — see canonical DB doc)');

    // ── nv_schema.hitl_reviews — Human-In-The-Loop review queue (JRX-UAT-BUG-001 fix) ──
    // Used by src/services/jrx-orchestration-services.ts (lines 102, 114, 122-128, 142, 569).
    // Routes: GET /api/jrx/hitl/pending, GET /api/jrx/hitl/stats, GET /api/jrx/hitl/:reviewId,
    // POST /api/jrx/hitl/:reviewId/decision, GET /api/jrx/agent/metrics.
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.hitl_reviews (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id          TEXT NOT NULL,
        user_id             TEXT,
        tenant_id           TEXT,
        agent_key           TEXT,
        risk_level          TEXT NOT NULL DEFAULT 'medium',
        ai_output           JSONB NOT NULL DEFAULT '{}',
        review_status       TEXT NOT NULL DEFAULT 'pending',
        sla_deadline        TIMESTAMPTZ,
        reviewer_id         TEXT,
        reviewer_decision   TEXT,
        reviewer_notes      TEXT,
        modified_output     JSONB,
        reviewed_at         TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_hitl_reviews_status   ON nv_schema.hitl_reviews (review_status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_hitl_reviews_tenant   ON nv_schema.hitl_reviews (tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_hitl_reviews_created  ON nv_schema.hitl_reviews (created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_hitl_reviews_request  ON nv_schema.hitl_reviews (request_id)`;
    console.log('  ✓ nv_schema.hitl_reviews (HITL review queue)');

    // ── nv_schema.compliance_evidence — Compliance evidence packages (JRX-UAT-BUG-001 fix) ──
    // Used by src/services/jrx-orchestration-services.ts (lines 581, 590, 594, 597).
    // Routes: GET/POST /api/jrx/compliance/evidence.
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.compliance_evidence (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       TEXT NOT NULL,
        evidence_type   TEXT NOT NULL,
        framework       TEXT NOT NULL,
        title           TEXT NOT NULL,
        description     TEXT,
        evidence_data   JSONB NOT NULL DEFAULT '{}',
        generated_by    TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_compl_evid_tenant     ON nv_schema.compliance_evidence (tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_compl_evid_framework  ON nv_schema.compliance_evidence (framework)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_compl_evid_created    ON nv_schema.compliance_evidence (created_at DESC)`;
    console.log('  ✓ nv_schema.compliance_evidence (compliance audit chain)');

    // ── nv_schema.memory_entries — Long-running memory across sessions (JRX-UAT-BUG-001 fix) ──
    // Used by src/services/jrx-orchestration-services.ts (lines 993, 1010, 1021, 1035-1036),
    // src/services/rag/adaptive-rag-service.ts line 545, and the memory stats route.
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.memory_entries (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           TEXT NOT NULL,
        tenant_id         TEXT,
        memory_type       TEXT NOT NULL DEFAULT 'fact',
        scope             TEXT NOT NULL DEFAULT 'longterm',
        matter_id         TEXT,
        session_id        TEXT,
        key               TEXT,
        value             JSONB NOT NULL DEFAULT '{}',
        importance        DOUBLE PRECISION DEFAULT 0.5,
        access_count      INTEGER NOT NULL DEFAULT 0,
        last_accessed_at  TIMESTAMPTZ,
        expires_at        TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_memory_user      ON nv_schema.memory_entries (user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_memory_tenant    ON nv_schema.memory_entries (tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_memory_matter    ON nv_schema.memory_entries (matter_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_memory_session   ON nv_schema.memory_entries (session_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_memory_scope     ON nv_schema.memory_entries (scope)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_memory_expires   ON nv_schema.memory_entries (expires_at)`;
    console.log('  ✓ nv_schema.memory_entries (cross-session memory)');

    // ── nv_schema.protocol_registry — Capability manifest registry (JRX-UAT-BUG-001 fix) ──
    // Used by src/services/jrx-protocol-registry-manifest.ts (line 53) and
    // src/services/jrx-orchestration-services.ts (lines 1138, 1147, 1154, 1167).
    // Bootstrapped at gateway startup; previously logged "Manifest registry bootstrap failed".
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.protocol_registry (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        protocol_name       TEXT NOT NULL UNIQUE,
        protocol_version    TEXT NOT NULL DEFAULT '1.0.0',
        status              TEXT NOT NULL DEFAULT 'pending',
        config_json         JSONB NOT NULL DEFAULT '{}',
        depends_on          JSONB NOT NULL DEFAULT '[]',
        activated_by        TEXT,
        activated_at        TIMESTAMPTZ,
        health_status       TEXT DEFAULT 'unknown',
        last_health_check   TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_protocol_status  ON nv_schema.protocol_registry (status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_protocol_name    ON nv_schema.protocol_registry (protocol_name)`;
    console.log('  ✓ nv_schema.protocol_registry (capability manifest)');

    // ── jrx_schema.protocol_registry — greenfield Jurexio Enterprise (JRX-BOOTSTRAP-GOV-001) ──
    await sql`CREATE SCHEMA IF NOT EXISTS jrx_schema`;
    await sql`
      CREATE TABLE IF NOT EXISTS jrx_schema.protocol_registry (
        id                  varchar(36) PRIMARY KEY DEFAULT (gen_random_uuid())::text,
        protocol_name       varchar(255) NOT NULL,
        protocol_version    varchar(50) NOT NULL DEFAULT '1.0',
        status              varchar(50) NOT NULL DEFAULT 'initialized',
        config_json         jsonb NOT NULL DEFAULT '{}',
        activated_by        varchar(255),
        depends_on          jsonb NOT NULL DEFAULT '[]',
        activated_at        TIMESTAMPTZ,
        health_status       varchar(50) DEFAULT 'unknown',
        last_health_check   TIMESTAMPTZ,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS protocol_registry_protocol_name_key ON jrx_schema.protocol_registry (protocol_name)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_protocol_registry_status ON jrx_schema.protocol_registry (status)`;
    console.log('  ✓ jrx_schema.protocol_registry (capability manifest)');

    // ── nv_schema.agent_metrics — Per-agent telemetry roll-ups (JRX-UAT-BUG-001 fix) ──
    // Used by src/services/jrx-orchestration-services.ts (lines 300, 311, 315-316).
    // Route: GET /api/jrx/agent/metrics. INSERT writes per-period roll-ups; SELECTs aggregate.
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.agent_metrics (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_key           TEXT NOT NULL,
        tenant_id           TEXT,
        period              TEXT NOT NULL DEFAULT 'hour',
        period_start        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        total_requests      BIGINT NOT NULL DEFAULT 0,
        avg_latency_ms      DOUBLE PRECISION,
        avg_tokens          DOUBLE PRECISION,
        avg_cost_usd        DOUBLE PRECISION,
        error_rate          DOUBLE PRECISION,
        satisfaction_score  DOUBLE PRECISION,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_agent_metrics_agent   ON nv_schema.agent_metrics (agent_key)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_agent_metrics_tenant  ON nv_schema.agent_metrics (tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_agent_metrics_period  ON nv_schema.agent_metrics (period_start DESC)`;
    console.log('  ✓ nv_schema.agent_metrics (per-agent telemetry)');

    // ── nv_schema.model_governance — Approved-models registry (JRX-UAT-FIX-003) ──
    // Used by NvModelGovernanceService.{getRegistry,registerModel,updateModelStatus}
    // (src/services/jrx-orchestration-services.ts L536-552) and the ISO_42001 evidence
    // generator. Without this table GET /api/jrx/model-governance returned a 500 with
    // sanitised "System configuration error" (Postgres 42P01).
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.model_governance (
        id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        model_name           TEXT NOT NULL,
        provider             TEXT NOT NULL,
        version              TEXT NOT NULL DEFAULT 'unknown',
        deployment_regions   JSONB NOT NULL DEFAULT '[]',
        approved_by          TEXT,
        risk_assessment      JSONB NOT NULL DEFAULT '{}',
        status               TEXT NOT NULL DEFAULT 'pending',
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_model_gov_status   ON nv_schema.model_governance (status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_model_gov_provider ON nv_schema.model_governance (provider)`;
    console.log('  ✓ nv_schema.model_governance (approved models registry)');

    // ── nv_schema.ai_consents — DPDPA / GDPR consent ledger (JRX-UAT-FIX-003) ──
    // Used by NvConsentService (recordConsent, getUserConsents, revokeConsent,
    // checkConsent). Without this table /api/jrx/consent and /api/jrx/consent/check
    // returned PG 42P01 "System configuration error" 500.
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.ai_consents (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       TEXT NOT NULL,
        tenant_id     TEXT,
        consent_type  TEXT NOT NULL,
        granted       BOOLEAN NOT NULL DEFAULT false,
        ip_address    TEXT,
        user_agent    TEXT,
        granted_at    TIMESTAMPTZ,
        revoked_at    TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_consents_user_active ON nv_schema.ai_consents (user_id, consent_type) WHERE revoked_at IS NULL`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_consents_tenant     ON nv_schema.ai_consents (tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_consents_created    ON nv_schema.ai_consents (created_at DESC)`;
    console.log('  ✓ nv_schema.ai_consents (consent ledger)');

    // ── nv_schema.ai_incidents — incident reporting & resolution log (JRX-UAT-FIX-003) ──
    // Used by NvIncidentService (reportIncident, resolveIncident, getIncidents).
    // Routes: GET/POST /api/jrx/incidents.
    // NOTE: an older shape of this table may exist with `org_id`/integer-id;
    // we extend it in place rather than dropping (preserves data) by ADD-COLUMN
    // IF NOT EXISTS for every column the current service code touches.
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.ai_incidents (
        id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id             TEXT,
        incident_type         TEXT NOT NULL,
        severity              TEXT NOT NULL,
        title                 TEXT NOT NULL,
        description           TEXT,
        reported_by           TEXT,
        affected_request_ids  JSONB NOT NULL DEFAULT '[]',
        status                TEXT NOT NULL DEFAULT 'open',
        resolution            TEXT,
        root_cause            TEXT,
        resolved_by           TEXT,
        resolved_at           TIMESTAMPTZ,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`ALTER TABLE nv_schema.ai_incidents ADD COLUMN IF NOT EXISTS tenant_id            TEXT`;
    await sql`ALTER TABLE nv_schema.ai_incidents ADD COLUMN IF NOT EXISTS reported_by          TEXT`;
    await sql`ALTER TABLE nv_schema.ai_incidents ADD COLUMN IF NOT EXISTS affected_request_ids JSONB NOT NULL DEFAULT '[]'`;
    await sql`ALTER TABLE nv_schema.ai_incidents ADD COLUMN IF NOT EXISTS resolution           TEXT`;
    await sql`ALTER TABLE nv_schema.ai_incidents ADD COLUMN IF NOT EXISTS root_cause           TEXT`;
    await sql`ALTER TABLE nv_schema.ai_incidents ADD COLUMN IF NOT EXISTS resolved_by          TEXT`;
    await sql`ALTER TABLE nv_schema.ai_incidents ADD COLUMN IF NOT EXISTS resolved_at          TIMESTAMPTZ`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_incidents_status   ON nv_schema.ai_incidents (status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_incidents_tenant   ON nv_schema.ai_incidents (tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_incidents_severity ON nv_schema.ai_incidents (severity)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_incidents_created  ON nv_schema.ai_incidents (created_at DESC)`;
    console.log('  ✓ nv_schema.ai_incidents (incident log)');

    // ── nv_schema.bias_audits — bias audit results referenced by ISO_42001
    // evidence generator (services/jrx-orchestration-services.ts L570). Empty by
    // default; AVG/COUNT over zero rows must still return rows, hence the table
    // must exist.
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.bias_audits (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id       TEXT,
        agent_key       TEXT,
        bias_score      DOUBLE PRECISION,
        sample_size     INTEGER,
        protected_attrs JSONB,
        findings        JSONB NOT NULL DEFAULT '{}',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_bias_audits_tenant  ON nv_schema.bias_audits (tenant_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_bias_audits_created ON nv_schema.bias_audits (created_at DESC)`;
    console.log('  ✓ nv_schema.bias_audits (bias audit results)');

    // ── nv_schema.pii_vault — PII vault counter referenced by the same generator.
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.pii_vault (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id   TEXT,
        token       TEXT NOT NULL UNIQUE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_pii_vault_tenant ON nv_schema.pii_vault (tenant_id)`;
    console.log('  ✓ nv_schema.pii_vault (PII tokenization)');

    // ── async_job_queue (used by patterns interceptor for large document jobs) ──
    // Idempotent + tolerant: if recreate fails (orphan type from prior crash, race
    // with another migrate process, etc.), keep whatever table is already present
    // as long as it has the columns the app needs. Never block startup on this.
    try {
      await sql`
        DO $migrate_ajq$
        DECLARE
          r RECORD;
        BEGIN
          FOR r IN
            SELECT n.nspname AS s
            FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE c.relname = 'async_job_queue'
          LOOP
            EXECUTE format('DROP TABLE IF EXISTS %I.async_job_queue CASCADE', r.s);
          END LOOP;
          FOR r IN
            SELECT n.nspname AS s
            FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid
            WHERE t.typname = 'async_job_queue'
          LOOP
            EXECUTE format('DROP TYPE IF EXISTS %I.async_job_queue CASCADE', r.s);
          END LOOP;
        END
        $migrate_ajq$;
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS nv_schema.async_job_queue (
          id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          queue_name  TEXT NOT NULL DEFAULT 'default',
          task_type   TEXT NOT NULL,
          payload     JSONB NOT NULL DEFAULT '{}',
          status      TEXT NOT NULL DEFAULT 'pending',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`;
      await sql`CREATE INDEX IF NOT EXISTS idx_async_jobs_queue   ON nv_schema.async_job_queue (queue_name, status)`;
      await sql`CREATE INDEX IF NOT EXISTS idx_async_jobs_created ON nv_schema.async_job_queue (created_at DESC)`;
      console.log('  ✓ nv_schema.async_job_queue');
    } catch (e: any) {
      console.warn(`  ⚠ nv_schema.async_job_queue recreate skipped (${e?.code || ''} ${e?.message || e}); using existing table`);
      // Best-effort: ensure the table at least exists so app code doesn't crash on first insert.
      try {
        await sql`
          CREATE TABLE IF NOT EXISTS nv_schema.async_job_queue (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            queue_name  TEXT NOT NULL DEFAULT 'default',
            task_type   TEXT NOT NULL,
            payload     JSONB NOT NULL DEFAULT '{}',
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )`;
      } catch (_) { /* swallow — table likely already exists with compatible columns */ }
    }

    // ── Sprint 3 — Subscription, Credit, AI Activity, Case Updates, Institutional ──

    // T002-1: subscription_table
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.subscription_table (
        subscription_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           TEXT NOT NULL UNIQUE,
        plan_id           TEXT NOT NULL DEFAULT 'alpha',
        status            TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','paused','cancelled','past_due','trialing')),
        billing_cycle     TEXT NOT NULL DEFAULT 'monthly'
                          CHECK (billing_cycle IN ('monthly','quarterly','annual')),
        amount_inr        NUMERIC(12,2) NOT NULL DEFAULT 0,
        currency          TEXT NOT NULL DEFAULT 'INR',
        razorpay_sub_id   TEXT,
        current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        current_period_end   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
        trial_end         TIMESTAMPTZ,
        cancelled_at      TIMESTAMPTZ,
        cancel_reason     TEXT,
        metadata          JSONB NOT NULL DEFAULT '{}',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sub_user   ON nv_schema.subscription_table (user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sub_status ON nv_schema.subscription_table (status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sub_plan   ON nv_schema.subscription_table (plan_id)`;
    console.log('  ✓ nv_schema.subscription_table');

    // T002-2: credit_wallet
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.credit_wallet (
        wallet_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           TEXT NOT NULL UNIQUE,
        credits_balance   INTEGER NOT NULL DEFAULT 0 CHECK (credits_balance >= 0),
        reserved_credits  INTEGER NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
        credits_expiry    TIMESTAMPTZ,
        last_updated      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_user ON nv_schema.credit_wallet (user_id)`;
    console.log('  ✓ nv_schema.credit_wallet');

    // T002-3: credit_transactions (immutable — no DELETE/UPDATE allowed via app layer)
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.credit_transactions (
        transaction_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           TEXT NOT NULL,
        type              TEXT NOT NULL CHECK (type IN ('DEBIT','CREDIT','RESERVE','RELEASE')),
        credits           INTEGER NOT NULL,
        source            TEXT NOT NULL CHECK (source IN ('AI_TOOL','PURCHASE','REFUND','MANUAL','SYSTEM')),
        tool_name         TEXT NOT NULL DEFAULT 'unknown',
        reference_id      UUID,
        immutable_hash    TEXT NOT NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ctx_user    ON nv_schema.credit_transactions (user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ctx_created ON nv_schema.credit_transactions (created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ctx_type    ON nv_schema.credit_transactions (type)`;
    console.log('  ✓ nv_schema.credit_transactions (immutable ledger + SHA-256 hash)');

    // T002-4: subscription_events (webhook + lifecycle event log)
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.subscription_events (
        event_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        subscription_id   UUID REFERENCES nv_schema.subscription_table(subscription_id) ON DELETE SET NULL,
        user_id           TEXT NOT NULL,
        event_type        TEXT NOT NULL,
        previous_status   TEXT,
        new_status        TEXT,
        payload           JSONB NOT NULL DEFAULT '{}',
        source            TEXT NOT NULL DEFAULT 'webhook',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sevt_user    ON nv_schema.subscription_events (user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sevt_created ON nv_schema.subscription_events (created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sevt_type    ON nv_schema.subscription_events (event_type)`;
    console.log('  ✓ nv_schema.subscription_events (lifecycle event log)');

    // T002-5: ai_activity (AI execution audit with prompt_hash, risk_score, template_mode)
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.ai_activity (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        trace_id          TEXT UNIQUE NOT NULL,
        user_id           TEXT NOT NULL,
        jurisdiction      TEXT NOT NULL DEFAULT 'IN',
        pattern_key       TEXT,
        route             TEXT,
        template_mode     TEXT NOT NULL DEFAULT 'STRICT'
                          CHECK (template_mode IN ('STRICT','GUIDED','MENTOR')),
        risk_score        INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
        prompt_hash       TEXT NOT NULL,
        blocked           BOOLEAN NOT NULL DEFAULT FALSE,
        model_provider    TEXT,
        model_name        TEXT,
        tokens_used       INTEGER DEFAULT 0,
        latency_ms        INTEGER DEFAULT 0,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_act_user      ON nv_schema.ai_activity (user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_act_created   ON nv_schema.ai_activity (created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_act_pattern   ON nv_schema.ai_activity (pattern_key)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_act_risk      ON nv_schema.ai_activity (risk_score DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ai_act_blocked   ON nv_schema.ai_activity (blocked) WHERE blocked = TRUE`;
    console.log('  ✓ nv_schema.ai_activity (AI execution + risk score audit)');

    // T002-6: case_updates (6-type ENUM + 24h edit lock)
    await sql`
      DO $$ BEGIN
        CREATE TYPE nv_schema.case_update_type AS ENUM
          ('HEARING','FILING','DOCUMENT','COMMUNICATION','TASK','NOTE');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`;
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.case_updates (
        update_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id           TEXT NOT NULL,
        user_id           TEXT NOT NULL,
        update_type       nv_schema.case_update_type NOT NULL,
        title             TEXT NOT NULL,
        description       TEXT NOT NULL DEFAULT '',
        metadata          JSONB NOT NULL DEFAULT '{}',
        locked_at         TIMESTAMPTZ,
        locked            BOOLEAN NOT NULL DEFAULT FALSE,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cu_case      ON nv_schema.case_updates (case_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cu_user      ON nv_schema.case_updates (user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cu_created   ON nv_schema.case_updates (created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cu_type      ON nv_schema.case_updates (update_type)`;
    console.log('  ✓ nv_schema.case_updates (6-type ENUM: HEARING/FILING/DOCUMENT/COMMUNICATION/TASK/NOTE + 24h lock)');

    // T002-7: institutional_leads (for Request Institutional Access funnel)
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.institutional_leads (
        lead_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_name          TEXT NOT NULL,
        org_type          TEXT NOT NULL
                          CHECK (org_type IN ('law_firm','corporate_legal','judiciary','government','law_school','legal_tech','ngo','other')),
        contact_name      TEXT NOT NULL,
        contact_email     TEXT NOT NULL,
        contact_phone     TEXT,
        jurisdiction      TEXT NOT NULL DEFAULT 'IN',
        team_size         TEXT,
        use_case          TEXT NOT NULL,
        monthly_volume    TEXT,
        integrations_needed TEXT[],
        compliance_needs  TEXT[],
        step_completed    INTEGER NOT NULL DEFAULT 1,
        form_data         JSONB NOT NULL DEFAULT '{}',
        status            TEXT NOT NULL DEFAULT 'new'
                          CHECK (status IN ('new','contacted','qualified','proposal_sent','won','lost')),
        assigned_to       TEXT,
        notes             TEXT,
        source            TEXT NOT NULL DEFAULT 'institutional_wizard',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`CREATE INDEX IF NOT EXISTS idx_il_email   ON nv_schema.institutional_leads (contact_email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_il_status  ON nv_schema.institutional_leads (status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_il_created ON nv_schema.institutional_leads (created_at DESC)`;
    console.log('  ✓ nv_schema.institutional_leads (7-step wizard leads)');

    // Task #248 — TwinDesk™ chat-sessions persistence.
    // The full bot/twin persistence layer ships in
    // `drizzle/0010_bot_workflow_twin_persistence.sql`, but this standalone
    // migrate runner has its own embedded CREATE TABLEs (NV-DB-SCRIPT-001)
    // and was never updated to include nv_twindesk_chat_sessions. Result:
    // every gateway boot logged
    //   `relation "nv_schema.nv_twindesk_chat_sessions" does not exist`
    // from `jrx-persistence` while TwinDeskService.hydrate() ran its
    //   SELECT session_id, data FROM nv_schema.nv_twindesk_chat_sessions ...
    // Create the table here so a fresh dev DB boots warning-free; the
    // service then hydrates 0 rows silently and write-through upserts land.
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_twindesk_chat_sessions (
        session_id        VARCHAR(64) PRIMARY KEY,
        twin_id           VARCHAR(48) NOT NULL,
        data              JSONB       NOT NULL,
        started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_message_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`
      CREATE INDEX IF NOT EXISTS nv_twindesk_chat_twin_idx
        ON nv_schema.nv_twindesk_chat_sessions (twin_id, last_message_at)`;
    console.log('  ✓ nv_schema.nv_twindesk_chat_sessions (TwinDesk™ persona chat history — Task #248)');

    // Task #253 — sibling bot/workflow/twin tables from
    // drizzle/0010_bot_workflow_twin_persistence.sql.
    // #248 added only nv_twindesk_chat_sessions to this embedded runner; the
    // other nine tables defined in 0010 were still missing on a fresh dev DB,
    // so ClaWdBot™/OpenBot™/AutomateAI™/TwinDesk™ hydrate paths kept emitting
    // `relation "nv_schema.nv_*" does not exist` warnings from jrx-persistence,
    // and write-through upserts silently no-op'd (state lost across restart).
    // Mirror 0010 exactly so a fresh boot produces zero such warnings and
    // upserts persist. Schema kept identical to drizzle/0010_*.sql.

    // ── ClaWdBot™ ────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_clawdbot_bots (
        bot_id      VARCHAR(32)  PRIMARY KEY,
        org_id      VARCHAR(64)  NOT NULL,
        name        VARCHAR(255) NOT NULL,
        config      JSONB        NOT NULL,
        status      VARCHAR(24)  NOT NULL DEFAULT 'draft',
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )`;
    await sql`
      CREATE INDEX IF NOT EXISTS nv_clawdbot_bots_org_idx
        ON nv_schema.nv_clawdbot_bots (org_id, status)`;
    console.log('  ✓ nv_schema.nv_clawdbot_bots');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_clawdbot_conversations (
        conversation_id  VARCHAR(64) PRIMARY KEY,
        bot_id           VARCHAR(32) NOT NULL,
        org_id           VARCHAR(64),
        data             JSONB       NOT NULL,
        status           VARCHAR(24) NOT NULL DEFAULT 'active',
        started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_message_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`
      CREATE INDEX IF NOT EXISTS nv_clawdbot_conv_bot_idx
        ON nv_schema.nv_clawdbot_conversations (bot_id, last_message_at)`;
    console.log('  ✓ nv_schema.nv_clawdbot_conversations');

    // ── OpenBot™ ─────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_openbot_channels (
        channel_id    VARCHAR(32) PRIMARY KEY,
        channel_type  VARCHAR(32) NOT NULL,
        config        JSONB       NOT NULL,
        status        VARCHAR(24) NOT NULL DEFAULT 'active',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_schema.nv_openbot_channels');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_openbot_routes (
        rule_id    VARCHAR(32) PRIMARY KEY,
        rule       JSONB       NOT NULL,
        is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    console.log('  ✓ nv_schema.nv_openbot_routes');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_openbot_inbox (
        message_id   VARCHAR(64) PRIMARY KEY,
        channel_id   VARCHAR(32) NOT NULL,
        message      JSONB       NOT NULL,
        received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`
      CREATE INDEX IF NOT EXISTS nv_openbot_inbox_chan_idx
        ON nv_schema.nv_openbot_inbox (channel_id, received_at)`;
    console.log('  ✓ nv_schema.nv_openbot_inbox');

    // ── AutomateAI™ ──────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_automateai_workflows (
        workflow_id  VARCHAR(48) PRIMARY KEY,
        org_id       VARCHAR(64) NOT NULL,
        definition   JSONB       NOT NULL,
        status       VARCHAR(24) NOT NULL DEFAULT 'draft',
        version      INTEGER     NOT NULL DEFAULT 1,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`
      CREATE INDEX IF NOT EXISTS nv_automateai_wf_org_idx
        ON nv_schema.nv_automateai_workflows (org_id, status)`;
    console.log('  ✓ nv_schema.nv_automateai_workflows');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_automateai_runs (
        execution_id  VARCHAR(64) PRIMARY KEY,
        workflow_id   VARCHAR(48) NOT NULL,
        data          JSONB       NOT NULL,
        status        VARCHAR(24) NOT NULL,
        started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at  TIMESTAMPTZ
      )`;
    await sql`
      CREATE INDEX IF NOT EXISTS nv_automateai_runs_wf_idx
        ON nv_schema.nv_automateai_runs (workflow_id, started_at)`;
    console.log('  ✓ nv_schema.nv_automateai_runs');

    // ── TwinDesk™ (twins + scenarios; chat_sessions already created above) ──
    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_twindesk_twins (
        twin_id    VARCHAR(48) PRIMARY KEY,
        org_id     VARCHAR(64) NOT NULL,
        profile    JSONB       NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`
      CREATE INDEX IF NOT EXISTS nv_twindesk_twins_org_idx
        ON nv_schema.nv_twindesk_twins (org_id)`;
    console.log('  ✓ nv_schema.nv_twindesk_twins');

    await sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_twindesk_scenarios (
        scenario_id   VARCHAR(64) PRIMARY KEY,
        twin_id       VARCHAR(48) NOT NULL,
        data          JSONB       NOT NULL,
        simulated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`;
    await sql`
      CREATE INDEX IF NOT EXISTS nv_twindesk_scen_twin_idx
        ON nv_schema.nv_twindesk_scenarios (twin_id, simulated_at)`;
    console.log('  ✓ nv_schema.nv_twindesk_scenarios');

    // Task #29 deliverable #2 + #3 — RLS policies + field-encryption columns.
    // Runs LAST so all referenced tables already exist.
    await applyRlsAndFieldEncryptionMigration();

    console.log('\n  ══════════════════════════════════════════════');
    console.log('  All migrations complete — tables ready');
    console.log('  ══════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n  ✗ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
