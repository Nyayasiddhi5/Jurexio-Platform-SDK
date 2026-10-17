-- NV-HC-ORDER-PRESIGN-001 (2026-09-25) — HC/SC order-PDF → owned-S3 mapping.
--
-- Boundary A (user GO): HC `finalOrders[]` / `interimOrders[]` records carry a
-- `filename` that is a raw eCourts-portal relative path (e.g. `/orders/2023/…_12.pdf`).
-- The public judgment buckets (indian-*-court-judgments) hold ONLY judgment PDFs
-- under `data/pdf|tar/…` — a live `aws s3 ls --no-sign-request` (Session-79) showed
-- NO `orders/` prefix — so those relative paths have NO matching S3 object today.
--
-- This table is the deterministic mapping SSoT: an ORDER-MIRROR job (caselaw-worker,
-- ops GO) copies each order PDF into an OWNED bucket under a deterministic key
-- (see deriveHcOrderS3Key in nv-hc-order-presign.ts) and records the row here.
-- The NYV adapter (nv-hc-order-presign.ts) then presigns finalOrders/interimOrders
-- ONLY when a row exists AND the bucket is in the owned allowlist — it NEVER
-- presigns a non-existent key (NV-HC-ORDER-PRESIGN-001 / NV-SECRETS-001). The map
-- is EMPTY until the mirror job runs, so live behaviour is unchanged (no fake URLs).
--
-- Kept in EXACT parity with the Drizzle declaration in shared/schema.ts
-- (nvHcOrderS3Map) for the NV-SCHEMA-DRIFT-001 guardrail. Idempotent.

CREATE TABLE IF NOT EXISTS public.nv_hc_order_s3_map (
  cnr          VARCHAR(24)  NOT NULL,           -- CNR the order belongs to
  order_path   VARCHAR(512) NOT NULL,           -- raw eCourts order filename/relative path
  s3_bucket    VARCHAR(120) NOT NULL,           -- OWNED bucket (must be in adapter allowlist)
  s3_key       VARCHAR(1024) NOT NULL,          -- deterministic mirrored key (verified to exist)
  order_kind   VARCHAR(12)  NOT NULL DEFAULT 'final',   -- 'final' | 'interim'
  order_id     VARCHAR(24),                     -- eCourts order_id when known
  order_date   DATE,
  ssot_source  VARCHAR(40)  NOT NULL DEFAULT 'nv_hc_order_mirror',
  updated_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cnr, order_path)
);

CREATE INDEX IF NOT EXISTS idx_nv_hc_order_s3_map_cnr ON public.nv_hc_order_s3_map (cnr);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nv_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.nv_hc_order_s3_map TO nv_app';
  END IF;
END $$;
