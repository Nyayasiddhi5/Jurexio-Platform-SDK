-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: enable_rls_for_tenant_tables
--
-- Adds defence-in-depth multi-tenant Row Level Security to every nv_* table
-- that carries an `org_id` column. Tenant isolation is currently enforced at
-- the application middleware layer; this migration makes the database itself
-- the second line of defence so a future cron job, admin script, or BI query
-- that bypasses middleware still cannot read across tenants.
--
-- Policy (strict — no empty-setting bypass):
--   tenant_isolation USING (org_id::text = current_setting('app.current_org_id', true))
--                    WITH CHECK (org_id::text = current_setting('app.current_org_id', true))
--
-- When `app.current_org_id` is NULL or empty, `org_id::text = NULL` evaluates
-- to NULL, which fails the policy → zero rows are visible. This is the
-- intentional safe-by-default behaviour: a session that forgets to set the
-- tenant cannot accidentally read across tenants.
--
-- Maintenance jobs (cron, migrations, BI exports) MUST connect as a
-- dedicated Postgres role with the `BYPASSRLS` attribute, OR explicitly
-- enumerate tenants and call `withTenantTx(orgId, fn)`. There is no
-- empty-setting bypass.
--
-- FORCE ROW LEVEL SECURITY ensures the policy applies even to the table owner
-- role, so simply being the migrator does not bypass isolation.
-- ─────────────────────────────────────────────────────────────────────────────

-- Required for pgp_sym_encrypt / pgp_sym_decrypt used by field-encryption-service.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- Field-level encryption — bytea companion columns for sensitive fields.
-- Reads/writes go through src/services/field-encryption-service.ts which calls
-- pgp_sym_encrypt / pgp_sym_decrypt. These columns are added BEFORE RLS is
-- enabled below so the backfill UPDATE statements are not subject to the
-- newly-installed tenant_isolation policy.
--
-- Existing plain-text columns are left in place during the transition window
-- so service code can run dual-write while the backfill below populates the
-- encrypted columns. Once cutover is complete, the legacy columns can be
-- dropped in a follow-up migration.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nv_voice_sessions') THEN
    EXECUTE 'ALTER TABLE nv_voice_sessions ADD COLUMN IF NOT EXISTS transcript_text_enc bytea';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nv_identity_extractions') THEN
    EXECUTE 'ALTER TABLE nv_identity_extractions ADD COLUMN IF NOT EXISTS extracted_fields_enc bytea';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_extracted_content') THEN
    EXECUTE 'ALTER TABLE document_extracted_content ADD COLUMN IF NOT EXISTS content_enc bytea';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nv_clawd_conversations') THEN
    EXECUTE 'ALTER TABLE nv_clawd_conversations ADD COLUMN IF NOT EXISTS messages_enc bytea';
  END IF;

  -- mem0 long-term memory entries (matter-scoped)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'nv_matter_memory') THEN
    EXECUTE 'ALTER TABLE nv_matter_memory ADD COLUMN IF NOT EXISTS content_enc bytea';
  END IF;

  -- Citation / RAG full text (used by the citation verifier and Phase 4 search)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'document_embeddings') THEN
    EXECUTE 'ALTER TABLE document_embeddings ADD COLUMN IF NOT EXISTS text_enc bytea';
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- One-shot backfill — only runs when the migration runner deliberately sets
-- `app.field_encryption_key` to the live encryption key. Idempotent: each
-- UPDATE filters on `*_enc IS NULL`. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE k text;
BEGIN
  k := coalesce(current_setting('app.field_encryption_key', true), '');
  IF k = '' THEN
    RAISE NOTICE 'app.field_encryption_key not set — skipping encrypted backfill (run scripts/encrypted-backfill.sql separately)';
    RETURN;
  END IF;

  -- Gate each UPDATE on column-existence (not just table-existence) — the *_enc
  -- columns are added unconditionally above, but the source plaintext columns
  -- may not exist on every deploy (e.g. fresh DBs that never had the legacy
  -- column shape). Without this guard the DO block raises 42703 and rolls
  -- everything back, blocking the rest of the migration. Idempotent: safe to
  -- re-run because each UPDATE filters on `*_enc IS NULL`.
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'nv_voice_sessions' AND column_name = 'transcript_text') THEN
    UPDATE nv_voice_sessions
    SET transcript_text_enc = pgp_sym_encrypt(transcript_text, k)
    WHERE transcript_text IS NOT NULL AND transcript_text_enc IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'nv_identity_extractions' AND column_name = 'extracted_fields') THEN
    UPDATE nv_identity_extractions
    SET extracted_fields_enc = pgp_sym_encrypt(extracted_fields::text, k)
    WHERE extracted_fields IS NOT NULL AND extracted_fields_enc IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'document_extracted_content' AND column_name = 'content') THEN
    UPDATE document_extracted_content
    SET content_enc = pgp_sym_encrypt(content, k)
    WHERE content IS NOT NULL AND content_enc IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'nv_clawd_conversations' AND column_name = 'messages') THEN
    UPDATE nv_clawd_conversations
    SET messages_enc = pgp_sym_encrypt(messages::text, k)
    WHERE messages IS NOT NULL AND messages_enc IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'nv_matter_memory' AND column_name = 'content') THEN
    UPDATE nv_matter_memory
    SET content_enc = pgp_sym_encrypt(content, k)
    WHERE content IS NOT NULL AND content_enc IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'document_embeddings' AND column_name = 'text') THEN
    UPDATE document_embeddings
    SET text_enc = pgp_sym_encrypt(text, k)
    WHERE text IS NOT NULL AND text_enc IS NULL;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Audit log: real-time hash-chain enforcement support
--
-- Adds a unique constraint on (previous_hash) so the database itself rejects
-- any concurrent insert that tries to chain off an already-used previous_hash.
-- This is the second half of the in-process mutex enforcement: even if two
-- pods race past the application-level head fetch, only one will win the
-- INSERT — the other gets a unique-violation and must retry with the new head.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'nv_schema' AND table_name = 'nv_audit_logs'
  ) THEN
    BEGIN
      EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS nv_audit_logs_prev_hash_uniq
               ON nv_schema.nv_audit_logs (previous_hash)';
    EXCEPTION WHEN unique_violation THEN
      -- Pre-existing duplicate previous_hash rows from the legacy advisory-only
      -- chain — leave the index uncreated and rely on the application mutex.
      RAISE NOTICE 'Skipping unique index on previous_hash: legacy duplicates present';
    END;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS DO loop — runs LAST so the encrypted backfill above is not subject to
-- the new policy. Strict policy: no empty-setting bypass.
--
-- Phased rollout (Task #29 review feedback):
--   • Policies are ALWAYS installed (idempotent). Once installed they sit
--     dormant on tables that do not have RLS enabled.
--   • ENABLE / FORCE ROW LEVEL SECURITY is gated on the session GUC
--     `app.nyv_rls_enforce = 'true'`. The migration runner
--     (`scripts/jrx-migrate.ts`) sets this GUC from `process.env.JRX_RLS_ENFORCE`
--     so operators flip enforcement ON only after every DB call site has
--     been wired through `req.withTenant(fn)` / `withTenantTx(orgId, fn)`.
--   • Default (flag unset / 'false'): policies installed, RLS NOT enabled,
--     existing app behaviour unchanged. Safe to deploy.
--   • Enforce ('true'): strict RLS kicks in; un-bound sessions see zero rows.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  rec RECORD;
  enforce boolean := coalesce(current_setting('app.nyv_rls_enforce', true), 'false') = 'true';
BEGIN
  FOR rec IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables  t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.column_name = 'org_id'
      AND t.table_type = 'BASE TABLE'
      AND (
            c.table_name LIKE 'nv\_%' ESCAPE '\'
         OR c.table_name LIKE 'ns\_%' ESCAPE '\'
         OR c.table_name LIKE 'ni\_%' ESCAPE '\'
         OR c.table_name LIKE 'nm\_%' ESCAPE '\'
      )
      AND c.table_schema NOT IN ('pg_catalog', 'information_schema')
  LOOP
    -- Policy is always installed (dormant unless RLS is enabled below).
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I',
                   rec.table_schema, rec.table_name);
    EXECUTE format($q$
      CREATE POLICY tenant_isolation ON %I.%I
        USING      (org_id::text = current_setting('app.current_org_id', true))
        WITH CHECK (org_id::text = current_setting('app.current_org_id', true))
    $q$, rec.table_schema, rec.table_name);

    IF enforce THEN
      EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
                     rec.table_schema, rec.table_name);
      EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',
                     rec.table_schema, rec.table_name);
      RAISE NOTICE 'RLS ENFORCED on %.%', rec.table_schema, rec.table_name;
    ELSE
      RAISE NOTICE 'RLS policy installed (dormant — set app.nyv_rls_enforce=true to enforce) on %.%',
                   rec.table_schema, rec.table_name;
    END IF;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sentinel table — used by the integration tests in
-- tests/unit/security/rls.test.ts to verify cross-tenant isolation against a
-- real Postgres instance. Safe to leave in place in production: it has no
-- foreign keys and contains test fixtures only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS nv_rls_sentinel (
  id      SERIAL PRIMARY KEY,
  org_id  TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP POLICY IF EXISTS tenant_isolation ON nv_rls_sentinel;
CREATE POLICY tenant_isolation ON nv_rls_sentinel
  USING      (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
DO $$
BEGIN
  IF coalesce(current_setting('app.nyv_rls_enforce', true), 'false') = 'true' THEN
    ALTER TABLE nv_rls_sentinel ENABLE ROW LEVEL SECURITY;
    ALTER TABLE nv_rls_sentinel FORCE  ROW LEVEL SECURITY;
  END IF;
END;
$$;
