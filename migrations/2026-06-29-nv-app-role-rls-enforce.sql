-- ─────────────────────────────────────────────────────────────────────────────
-- NV-RLS-NVAPP-001 (2026-06-29) — non-superuser app role for real RLS enforcement
--
-- WHY: drizzle/0004_enable_rls_for_tenant_tables.sql installs tenant_isolation
-- policies and (when app.nyv_rls_enforce='true') ENABLE/FORCE ROW LEVEL SECURITY
-- on every nv_/ns_/ni_/nm_ table that carries org_id. But PostgreSQL EXEMPTS a
-- SUPERUSER (and any role with BYPASSRLS) from RLS — so if the application pool
-- connects as a superuser, FORCE RLS is silently defeated. This migration
-- provisions a dedicated least-privilege role `nv_app` that:
--   • is NOT a superuser and does NOT have BYPASSRLS (so policies actually apply)
--   • can connect + DML the runtime schemas (public, nv_schema) but cannot DDL
--   • inherits default privileges for future tables/sequences
--
-- STAGING POSTURE (per owner directive): staging deliberately runs on the
-- superuser pool while feature/logic work completes. This migration is the
-- PROD ACTIVATION artifact — it is idempotent and SAFE to run anywhere (it only
-- creates a role + grants; it does NOT flip RLS enforcement), but the actual
-- cutover is a separate, deliberate ops step:
--
--   ACTIVATION (production only):
--     1. Run this migration as a privileged (admin/superuser) connection:
--          psql "$DATABASE_URL_ADMIN" \
--            -v nv_app_password="$(cat .local/secrets/nv_app_pw)" \
--            -f migrations/2026-06-29-nv-app-role-rls-enforce.sql
--        (The password is supplied via the psql variable below — NEVER commit it.)
--     2. Point the application pool DSN (DATABASE_URL) at the nv_app role; keep
--        the migrator/admin DSN as DATABASE_URL_ADMIN.
--     3. Re-run drizzle/0004 with NYV_RLS_ENFORCE=1 so ENABLE/FORCE RLS flips on.
--     4. Verify with tests/unit/security/rls.test.ts against the nv_app DSN.
--
-- Idempotent: re-running only re-asserts attributes + re-grants (no-ops if set).
-- ─────────────────────────────────────────────────────────────────────────────

\set ON_ERROR_STOP on

-- 1. Role: create if missing, then HARD-assert the security attributes every
--    run so an accidentally-elevated role is brought back to least privilege.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nv_app') THEN
    CREATE ROLE nv_app LOGIN;
    RAISE NOTICE 'created role nv_app';
  ELSE
    RAISE NOTICE 'role nv_app already exists — re-asserting attributes';
  END IF;
END
$$;

-- Security attributes (idempotent): never superuser, never BYPASSRLS.
ALTER ROLE nv_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS INHERIT;

-- 2. Optional password rotation — only when the operator passes -v nv_app_password=...
--    Skipped silently when the variable is not provided (keeps the migration
--    safe to run in CI/dev without secret material).
\if :{?nv_app_password}
  ALTER ROLE nv_app PASSWORD :'nv_app_password';
  \echo 'nv_app password set from psql variable'
\else
  \echo 'nv_app_password not provided — leaving existing password unchanged'
\endif

-- 3. Least-privilege grants on the runtime schemas (DML only, no DDL).
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO nv_app', current_database());
END
$$;

DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['public','nv_schema'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = s) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO nv_app', s);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO nv_app', s);
      EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO nv_app', s);
      -- Future objects created by the migrator role inherit the same grants.
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nv_app', s);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO nv_app', s);
      RAISE NOTICE 'granted DML + usage on schema % to nv_app', s;
    END IF;
  END LOOP;
END
$$;

-- 4. Self-check: confirm nv_app is genuinely non-bypassing (the whole point).
DO $$
DECLARE is_super boolean; is_bypass boolean;
BEGIN
  SELECT rolsuper, rolbypassrls INTO is_super, is_bypass FROM pg_roles WHERE rolname = 'nv_app';
  IF is_super OR is_bypass THEN
    RAISE EXCEPTION 'nv_app must be NOSUPERUSER + NOBYPASSRLS for RLS to apply (super=%, bypass=%)', is_super, is_bypass;
  END IF;
  RAISE NOTICE 'nv_app verified: NOSUPERUSER + NOBYPASSRLS — RLS will apply to this role';
END
$$;
