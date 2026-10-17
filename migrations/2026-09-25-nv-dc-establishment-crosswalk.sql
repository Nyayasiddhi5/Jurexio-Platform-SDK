-- NV-DC-ESTAB-CROSSWALK-001 (2026-09-25) — DC CNR letters ↔ eCourts numeric.
--
-- The resolve-path prefill (nv-jurisdiction-prefill.ts) keys off CNR letters
-- (positions 1–2 = state, 3–4 = district/establishment). The eCourts dropdown
-- cascade (nv_court_complexes, §18) is keyed by NUMERIC (state, district,
-- complex) codes from the open vanga `courts.csv`. This table is the missing
-- crosswalk so a pasted DC CNR (e.g. TSWL…) can prefill courtCode / complexCode
-- and district/complex NAMES onto the resolve envelope.
--
-- Numeric codes are sourced from courts.csv (via nv_court_complexes) — NOT
-- invented. The P0 seed carries the letter→name rows; the backfill INSERT…SELECT
-- fills the numeric codes by joining nv_court_complexes on (state_name,
-- district_name) when that master has been seeded (no-op on an empty drift-check
-- DB). Prefilled values are tagged source='nyv_master' at runtime and NEVER set
-- claimEcourts. Kept in EXACT parity with shared/schema.ts (nvDcEstablishmentCrosswalk)
-- for NV-SCHEMA-DRIFT-001. Idempotent.

CREATE TABLE IF NOT EXISTS public.nv_dc_establishment_crosswalk (
  state_letters VARCHAR(2)  NOT NULL,          -- CNR pos 1–2 'TS'
  estab_letters VARCHAR(2)  NOT NULL,          -- CNR pos 3–4 district/establishment 'WL'
  state_code    VARCHAR(4),                    -- eCourts numeric state (courts.csv)
  district_code VARCHAR(8),                    -- eCourts numeric district
  complex_code  VARCHAR(16),                   -- eCourts numeric complex
  court_code    VARCHAR(16),                   -- eCourts numeric court/establishment
  state_name    VARCHAR(120),
  district_name VARCHAR(120),
  complex_name  VARCHAR(300),
  ssot_source   VARCHAR(40) NOT NULL DEFAULT 'ecourts_open_data',
  updated_at    TIMESTAMP   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (state_letters, estab_letters)
);

-- P0 letter→name seed (mirrors nv_district_master; numeric codes backfilled below).
INSERT INTO public.nv_dc_establishment_crosswalk
  (state_letters, estab_letters, state_name, district_name, complex_name) VALUES
  ('TS', 'WL', 'Telangana',       'Warangal',  'District & Sessions Court, Warangal'),
  ('TS', 'HY', 'Telangana',       'Hyderabad', 'District & Sessions Court, Hyderabad'),
  ('AP', 'PK', 'Andhra Pradesh',  'Prakasam',  'District & Sessions Court, Prakasam'),
  ('AP', 'GN', 'Andhra Pradesh',  'Guntur',    'District & Sessions Court, Guntur')
ON CONFLICT (state_letters, estab_letters) DO UPDATE
  SET state_name    = EXCLUDED.state_name,
      district_name = EXCLUDED.district_name,
      complex_name  = EXCLUDED.complex_name,
      updated_at    = NOW();

-- Backfill numeric codes from the courts.csv-seeded complex master by name match.
-- No-op when nv_court_complexes is empty (fresh drift-check DB); real values are
-- filled after `npm run seed:court-master`. Never invents codes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'nv_court_complexes'
  ) THEN
    UPDATE public.nv_dc_establishment_crosswalk x
       SET state_code    = c.state_code,
           district_code = c.district_code,
           complex_code  = c.complex_code,
           court_code    = c.complex_code,
           updated_at    = NOW()
      FROM (
        SELECT DISTINCT ON (state_name, district_name)
               state_code, district_code, complex_code, state_name, district_name
          FROM public.nv_court_complexes
         ORDER BY state_name, district_name, complex_code
      ) c
     WHERE lower(x.state_name)    = lower(c.state_name)
       AND lower(x.district_name) = lower(c.district_name)
       AND x.complex_code IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nv_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.nv_dc_establishment_crosswalk TO nv_app';
  END IF;
END $$;
