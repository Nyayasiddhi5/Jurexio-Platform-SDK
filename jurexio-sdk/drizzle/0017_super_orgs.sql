-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0017_super_orgs (renamed from 0015 — collision resolved 2026-05-14T11:43Z) — Task #384 (2026-05-14)
--
-- Enterprise multi-product grouping. Today the schema cleanly handles
-- "ACME Law buys NSP" (one row in nv_customer_organizations bound to one
-- platform_id). It does NOT model "ACME Enterprise buys NSP + NSI + NSM
-- and wants ONE login, ONE bill, ONE admin console across all three". This
-- migration adds the missing parent grouping — the "id=0 super-organization"
-- concept asked for in task #379.
--
-- Two new tables + one nullable convenience column on the existing
-- nv_customer_organizations row:
--
--   nv_super_orgs                          — the parent enterprise account
--   nv_super_org_platform_memberships      — which (platform, customer_org)
--                                            tuples belong to which super-org
--   nv_customer_organizations.super_org_id — convenience back-pointer (nullable)
--
-- This migration is ADDITIVE only (NV-API-CONTRACT-001):
--   • No columns dropped, no policies altered
--   • RLS policy `customer_org_isolation` (drizzle/0013_customer_org_rls.sql)
--     is intentionally LEFT UNCHANGED. Super-org is a grouping / UI / billing
--     layer, NOT a security boundary. Per-platform rate limits and access
--     scopes continue to be enforced at (platform_id, customer_org_id) — no
--     rollup. A super-org admin selecting a member tenant in the Console
--     simply switches the bound (platform_id, customer_org_id) pair; the
--     existing RLS policy then takes over.
--   • super_org_id on nv_customer_organizations stays NULLABLE; the legacy
--     "one tenant, one platform" world keeps working untouched.
--   • Idempotent — every step gates on pg_class / information_schema so
--     re-running the migration is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. The parent enterprise account. One row per enterprise customer.
CREATE TABLE IF NOT EXISTS nv_super_orgs (
  id              BIGSERIAL    PRIMARY KEY,
  name            VARCHAR(255) NOT NULL,
  slug            VARCHAR(128) NOT NULL,
  billing_email   VARCHAR(320),
  status          VARCHAR(20)  NOT NULL DEFAULT 'active',
  metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT nv_super_orgs_slug_uniq UNIQUE (slug)
);

CREATE INDEX IF NOT EXISTS idx_nv_super_orgs_status
  ON nv_super_orgs (status);

-- 2. Membership of (platform_id, customer_org_id) → super_org. The composite
--    PK is (super_org_id, platform_id, customer_org_id) as called for in the
--    task brief. A single (platform, customer_org) pair can belong to AT
--    MOST one super-org — enforced by the partial unique index below.
CREATE TABLE IF NOT EXISTS nv_super_org_platform_memberships (
  super_org_id    BIGINT       NOT NULL REFERENCES nv_super_orgs (id) ON DELETE CASCADE,
  platform_id     INTEGER      NOT NULL,        -- → sdk_applications.id
  customer_org_id BIGINT       NOT NULL,        -- → nv_customer_organizations.id
  role            VARCHAR(50)  NOT NULL DEFAULT 'member',
  joined_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT nv_super_org_memberships_pk
    PRIMARY KEY (super_org_id, platform_id, customer_org_id)
);

-- A given (platform, customer_org) tuple can only belong to ONE super-org.
-- Composite PK above does NOT enforce this on its own (the same tuple could
-- be paired with two different super_org_ids); this unique index does.
CREATE UNIQUE INDEX IF NOT EXISTS nv_super_org_memberships_tenant_uniq
  ON nv_super_org_platform_memberships (platform_id, customer_org_id);

CREATE INDEX IF NOT EXISTS idx_nv_super_org_memberships_super_org
  ON nv_super_org_platform_memberships (super_org_id);

-- 3. Convenience back-pointer on nv_customer_organizations. NULLABLE so the
--    "one customer org, one platform" legacy world keeps working untouched.
--    Kept in sync by the route layer when a membership row is upserted /
--    deleted (best-effort denormalisation; the membership table is the
--    source of truth).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'nv_customer_organizations'
       AND column_name  = 'super_org_id'
  ) THEN
    ALTER TABLE public.nv_customer_organizations
      ADD COLUMN super_org_id BIGINT NULL
        REFERENCES nv_super_orgs (id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_nv_customer_orgs_super_org
  ON public.nv_customer_organizations (super_org_id)
  WHERE super_org_id IS NOT NULL;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reversal (manual, NOT run by drizzle):
--
--   BEGIN;
--   ALTER TABLE public.nv_customer_organizations
--     DROP COLUMN IF EXISTS super_org_id;
--   DROP TABLE IF EXISTS nv_super_org_platform_memberships;
--   DROP TABLE IF EXISTS nv_super_orgs;
--   COMMIT;
-- ─────────────────────────────────────────────────────────────────────────────
