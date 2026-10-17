-- NV-COURT-MASTER-P0-001 (2026-09-25) — district-court complex master (Appendix F.5)
--
-- The all-India district-court complex hierarchy that backs the partner
-- jurisdiction lookup cascade (court type → state → district → complex).
-- Seeded from the open `vanga/indian-district-court-judgments` courts.csv
-- (~3,566 complexes / ~714 districts / 36 states/UTs) by
-- scripts/nv-seed-court-master-p0.ts (idempotent upsert). This DDL file is
-- schema-only; the row data is loaded by the seed script so a fresh
-- `createdb + psql -f` (drift check) stays fast and self-contained.
--
-- Keyed by the eCourts NUMERIC (state_code, district_code, complex_code)
-- triple. Complementary to nv_district_master (keyed by CNR establishment
-- LETTERS like 'WL' for the resolve-path prefill) — this table is the numeric
-- eCourts cascade hierarchy. Static reference joins only — NEVER sets
-- claimEcourts: true.
--
-- Kept in EXACT column parity with the Drizzle declaration in shared/schema.ts
-- (nvCourtComplexes) for the NV-SCHEMA-DRIFT-001 guardrail. Idempotent.
-- Applies after 2026-09-24-nv-jurisdiction-master.sql.

CREATE TABLE IF NOT EXISTS public.nv_court_complexes (
  state_code     VARCHAR(4)   NOT NULL,             -- '2'  (eCourts numeric state code)
  district_code  VARCHAR(8)   NOT NULL,             -- '2'
  complex_code   VARCHAR(16)  NOT NULL,             -- '1020002'
  state_name     VARCHAR(120) NOT NULL,             -- 'Andhra Pradesh'
  district_name  VARCHAR(120) NOT NULL,             -- 'Ananthapur'
  complex_name   VARCHAR(300) NOT NULL,             -- 'District Court Complex, …'
  court_type     VARCHAR(2)   NOT NULL DEFAULT 'DC',
  court_numbers  VARCHAR(200),                       -- '11,12' (comma-separated court numbers)
  flag           VARCHAR(8),                         -- 'N' / 'Y'
  ssot_source    VARCHAR(40)  NOT NULL DEFAULT 'ecourts_open_data',
  updated_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
  PRIMARY KEY (state_code, district_code, complex_code)
);

-- Cascade lookup indexes (court type → state → district → complex).
CREATE INDEX IF NOT EXISTS idx_nv_court_complexes_state
  ON public.nv_court_complexes (court_type, state_code);
CREATE INDEX IF NOT EXISTS idx_nv_court_complexes_district
  ON public.nv_court_complexes (court_type, state_code, district_code);
CREATE INDEX IF NOT EXISTS idx_nv_court_complexes_state_name
  ON public.nv_court_complexes (LOWER(state_name));

-- Grant runtime role (nv_app) read/write access. Guarded on the role existing
-- so a fresh `createdb + psql -f` (drift check) stays self-contained.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nv_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.nv_court_complexes TO nv_app';
  END IF;
END $$;
