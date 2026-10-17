/**
 * Jurexio Platform 3.1.2 — SDK Intelligence Migration
 * JRX-MIGRATE-SDK-INTEL-001
 *
 * Creates 5 new tables required by jrx-sdk-intelligence-routes.ts:
 *   nv_document_requests       — client → firm document requests
 *   nv_document_ai_metadata    — AI classification results per document
 *   nv_client_health_scores    — cached health score + sentiment per client
 *   nv_user_2fa                — TOTP secrets + backup codes per user
 *   nv_user_sessions           — JWT session tracking for revocation
 *
 * Run: npx tsx scripts/jrx-sdk-intelligence-migrate.ts
 * NEVER run db:push for these tables.
 */

// NV-DB-SCRIPT-001 (2026-05-10): see replit.md — neon HTTP silently drops
// writes; standalone scripts must use the pg.Pool shim.
import { makePgSql } from './_pg-pool.js';
import * as dotenv from 'dotenv';

dotenv.config();

const sql = makePgSql(process.env.DATABASE_URL!);

async function migrate() {
  console.log('\n  JRX SDK Intelligence Migration — v3.1.2\n');

  if (!process.env.DATABASE_URL) {
    console.error('  ✗ DATABASE_URL not set');
    process.exit(1);
  }

  try {
    // ── 1. Document Requests ────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS nv_document_requests (
        id               SERIAL PRIMARY KEY,
        org_id           VARCHAR(255) NOT NULL,
        client_id        VARCHAR(255) NOT NULL,
        case_id          VARCHAR(255),
        document_name    VARCHAR(500) NOT NULL,
        description      TEXT,
        status           VARCHAR(50)  NOT NULL DEFAULT 'pending',
        due_date         DATE,
        upload_url       TEXT,
        upload_token     VARCHAR(255),
        uploaded_at      TIMESTAMP,
        fulfilled_by     VARCHAR(255),
        reminder_sent_at TIMESTAMP,
        created_by       VARCHAR(255),
        created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP    NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_doc_req_status CHECK (status IN ('pending','uploaded','overdue','cancelled','fulfilled'))
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_nv_doc_req_client   ON nv_document_requests (client_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nv_doc_req_org      ON nv_document_requests (org_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nv_doc_req_status   ON nv_document_requests (status)`;
    console.log('  ✓ nv_document_requests');

    // ── 2. Document AI Metadata ─────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS nv_document_ai_metadata (
        id                         SERIAL PRIMARY KEY,
        document_id                VARCHAR(255) NOT NULL UNIQUE,
        org_id                     VARCHAR(255),
        document_type              VARCHAR(100),
        document_subtype           VARCHAR(100),
        parties                    JSONB        NOT NULL DEFAULT '[]',
        key_dates                  JSONB        NOT NULL DEFAULT '[]',
        key_amounts                JSONB        NOT NULL DEFAULT '[]',
        risk_flags                 JSONB        NOT NULL DEFAULT '[]',
        legal_acts_cited           JSONB        NOT NULL DEFAULT '[]',
        key_clauses                JSONB        NOT NULL DEFAULT '[]',
        court                      VARCHAR(255),
        jurisdiction               VARCHAR(10),
        case_number                VARCHAR(255),
        classification_confidence  NUMERIC(4,3),
        classified_at              TIMESTAMP    NOT NULL DEFAULT NOW(),
        model_version              VARCHAR(50)  DEFAULT '3.1.2'
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_nv_doc_ai_meta_type ON nv_document_ai_metadata (document_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nv_doc_ai_meta_org  ON nv_document_ai_metadata (org_id)`;
    console.log('  ✓ nv_document_ai_metadata');

    // ── 3. Client Health Scores ─────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS nv_client_health_scores (
        id                SERIAL PRIMARY KEY,
        client_id         VARCHAR(255) NOT NULL,
        org_id            VARCHAR(255) NOT NULL,
        score             SMALLINT     DEFAULT 50,
        sentiment_overall VARCHAR(50)  DEFAULT 'neutral',
        sentiment_score   NUMERIC(4,3) DEFAULT 0,
        risk_level        VARCHAR(20)  DEFAULT 'LOW',
        factors           JSONB        NOT NULL DEFAULT '[]',
        payment_score     SMALLINT     DEFAULT 50,
        communication_score SMALLINT   DEFAULT 50,
        last_calculated   TIMESTAMP    NOT NULL DEFAULT NOW(),
        UNIQUE(client_id, org_id),
        CONSTRAINT chk_health_score   CHECK (score BETWEEN 0 AND 100),
        CONSTRAINT chk_payment_score  CHECK (payment_score BETWEEN 0 AND 100),
        CONSTRAINT chk_comms_score    CHECK (communication_score BETWEEN 0 AND 100),
        CONSTRAINT chk_risk_level     CHECK (risk_level IN ('HIGH','MEDIUM','LOW'))
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_nv_client_health_org     ON nv_client_health_scores (org_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nv_client_health_risk     ON nv_client_health_scores (risk_level)`;
    console.log('  ✓ nv_client_health_scores');

    // ── 4. User 2FA Settings ────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS nv_user_2fa (
        id           SERIAL PRIMARY KEY,
        user_id      VARCHAR(255) NOT NULL UNIQUE,
        totp_secret  TEXT,
        backup_codes JSONB        NOT NULL DEFAULT '[]',
        enabled      BOOLEAN      NOT NULL DEFAULT FALSE,
        enabled_at   TIMESTAMP,
        disabled_at  TIMESTAMP,
        created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMP    NOT NULL DEFAULT NOW()
      )
    `;
    console.log('  ✓ nv_user_2fa');

    // ── 5. User Sessions (JWT revocation) ───────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS nv_user_sessions (
        id           SERIAL PRIMARY KEY,
        user_id      VARCHAR(255) NOT NULL,
        jti          VARCHAR(255) NOT NULL UNIQUE,
        device       VARCHAR(500),
        ip_address   VARCHAR(45),
        user_agent   TEXT,
        last_active  TIMESTAMP    NOT NULL DEFAULT NOW(),
        created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
        revoked      BOOLEAN      NOT NULL DEFAULT FALSE,
        revoked_at   TIMESTAMP,
        expires_at   TIMESTAMP
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_nv_user_sessions_user    ON nv_user_sessions (user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nv_user_sessions_jti     ON nv_user_sessions (jti)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nv_user_sessions_active  ON nv_user_sessions (user_id, revoked) WHERE revoked = false`;
    console.log('  ✓ nv_user_sessions');

    console.log('\n  ✅ SDK Intelligence Migration complete.\n');
  } catch (err: any) {
    console.error('\n  ✗ Migration failed:', err.message, '\n');
    process.exit(1);
  }
}

migrate();
