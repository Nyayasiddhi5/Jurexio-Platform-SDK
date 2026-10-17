-- NV-CASE-MASTER-DATA-001 (2026-09-24) — jurisdiction master data (Appendix F)
--
-- Static reference tables the CNR resolve path joins against to PREFILL
-- courtType / courtName / stateName / districtName / complexName when the
-- corpus row does not publish them. Deterministic reference joins only —
-- they NEVER set claimEcourts:true. Prefilled values are tagged
-- source='nyv_master' at runtime so NSP can distinguish reference-derived
-- from corpus-published (see src/services/nv-jurisdiction-prefill.ts).
--
-- Kept in EXACT column parity with the Drizzle declarations in
-- shared/schema.ts (nvCnrPrefixRules / nvCourtJurisdictions / nvCaseTypeCodes
-- / nvDistrictMaster) for the NV-SCHEMA-DRIFT-001 guardrail. Idempotent.
-- Applies after 2026-06-25-nv-llm-providers-courts.sql (creates nv_courts).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. nv_cnr_prefix_rules — CNR prefix (state+tier[+estab]) → tier / state
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nv_cnr_prefix_rules (
  cnr_prefix    VARCHAR(6)  PRIMARY KEY,
  state_code    VARCHAR(2)  NOT NULL,
  court_tier    VARCHAR(2)  NOT NULL,
  court_type    VARCHAR(2)  NOT NULL,
  bench_code    VARCHAR(16),
  establishment VARCHAR(200),
  ssot_source   VARCHAR(40) NOT NULL DEFAULT 'ecourts_open_data',
  updated_at    TIMESTAMP   NOT NULL DEFAULT NOW()
);

INSERT INTO public.nv_cnr_prefix_rules (cnr_prefix, state_code, court_tier, court_type, bench_code, establishment) VALUES
  ('SCIN', 'SC', 'IN', 'SC', 'scin', 'Supreme Court of India'),
  ('APHC', 'AP', 'HC', 'HC', 'aphc', 'High Court of Andhra Pradesh'),
  ('TSHC', 'TS', 'HC', 'HC', 'tshc', 'High Court for the State of Telangana'),
  ('DLHC', 'DL', 'HC', 'HC', 'dlhc', 'High Court of Delhi'),
  ('MHHC', 'MH', 'HC', 'HC', 'mhhc', 'High Court of Bombay'),
  ('KAHC', 'KA', 'HC', 'HC', 'kahc', 'High Court of Karnataka'),
  ('TNHC', 'TN', 'HC', 'HC', 'tnhc', 'High Court of Madras'),
  ('KLHC', 'KL', 'HC', 'HC', 'klhc', 'High Court of Kerala'),
  ('UPHC', 'UP', 'HC', 'HC', 'uphc', 'High Court of Judicature at Allahabad'),
  ('GJHC', 'GJ', 'HC', 'HC', 'gjhc', 'High Court of Gujarat'),
  ('WBHC', 'WB', 'HC', 'HC', 'wbhc', 'High Court at Calcutta'),
  ('MPHC', 'MP', 'HC', 'HC', 'mphc', 'High Court of Madhya Pradesh'),
  ('RJHC', 'RJ', 'HC', 'HC', 'rjhc', 'High Court of Rajasthan'),
  ('PBHC', 'PB', 'HC', 'HC', 'pbhc', 'High Court of Punjab & Haryana'),
  ('BRHC', 'BR', 'HC', 'HC', 'brhc', 'High Court of Patna'),
  ('ODHC', 'OD', 'HC', 'HC', 'odhc', 'High Court of Orissa'),
  ('CGHC', 'CG', 'HC', 'HC', 'cghc', 'High Court of Chhattisgarh'),
  ('ASHC', 'AS', 'HC', 'HC', 'ashc', 'Gauhati High Court'),
  ('HPHC', 'HP', 'HC', 'HC', 'hphc', 'High Court of Himachal Pradesh'),
  ('JKHC', 'JK', 'HC', 'HC', 'jkhc', 'High Court of Jammu & Kashmir and Ladakh'),
  ('JHHC', 'JH', 'HC', 'HC', 'jhhc', 'High Court of Jharkhand'),
  ('MNHC', 'MN', 'HC', 'HC', 'mnhc', 'High Court of Manipur'),
  ('MLHC', 'ML', 'HC', 'HC', 'mlhc', 'High Court of Meghalaya'),
  ('SKHC', 'SK', 'HC', 'HC', 'skhc', 'High Court of Sikkim'),
  ('TRHC', 'TR', 'HC', 'HC', 'trhc', 'High Court of Tripura'),
  ('UKHC', 'UK', 'HC', 'HC', 'ukhc', 'High Court of Uttarakhand'),
  -- District courts: court_tier holds the eCourts district/establishment code
  -- (CNR positions 3–4); joined against nv_district_master by resolvePrefill.
  ('TSWL', 'TS', 'WL', 'DC', NULL, NULL),
  ('TSHY', 'TS', 'HY', 'DC', NULL, NULL),
  ('APPK', 'AP', 'PK', 'DC', NULL, NULL),
  ('APGN', 'AP', 'GN', 'DC', NULL, NULL)
ON CONFLICT (cnr_prefix) DO UPDATE
  SET state_code    = EXCLUDED.state_code,
      court_tier    = EXCLUDED.court_tier,
      court_type    = EXCLUDED.court_type,
      bench_code    = EXCLUDED.bench_code,
      establishment = EXCLUDED.establishment,
      updated_at    = NOW();

-- ────────────────────────────────────────────────────────────────────────────
-- 2. nv_court_jurisdictions — bench/court_code → canonical court + state
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nv_court_jurisdictions (
  bench_code  VARCHAR(16) PRIMARY KEY,
  court_code  VARCHAR(16),
  court_id    VARCHAR(80) REFERENCES public.nv_courts(court_id),
  court_name  VARCHAR(300) NOT NULL,
  court_type  VARCHAR(2)  NOT NULL,
  state_name  VARCHAR(120),
  ssot_source VARCHAR(40) NOT NULL DEFAULT 'ecourts_open_data',
  updated_at  TIMESTAMP   NOT NULL DEFAULT NOW()
);

INSERT INTO public.nv_court_jurisdictions (bench_code, court_id, court_name, court_type, state_name) VALUES
  ('scin', 'IN-SC',     'Supreme Court of India',                    'SC', 'National'),
  ('aphc', 'IN-HC-AP',  'High Court of Andhra Pradesh',              'HC', 'Andhra Pradesh'),
  ('tshc', 'IN-HC-TEL', 'High Court for the State of Telangana',     'HC', 'Telangana'),
  ('dlhc', 'IN-HC-DEL', 'High Court of Delhi',                       'HC', 'Delhi'),
  ('mhhc', 'IN-HC-BOM', 'High Court of Bombay',                      'HC', 'Maharashtra'),
  ('kahc', 'IN-HC-KAR', 'High Court of Karnataka',                   'HC', 'Karnataka'),
  ('tnhc', 'IN-HC-MAD', 'High Court of Madras',                      'HC', 'Tamil Nadu'),
  ('klhc', 'IN-HC-KER', 'High Court of Kerala',                      'HC', 'Kerala'),
  ('uphc', 'IN-HC-ALD', 'High Court of Judicature at Allahabad',     'HC', 'Uttar Pradesh'),
  ('gjhc', 'IN-HC-GUJ', 'High Court of Gujarat',                     'HC', 'Gujarat'),
  ('wbhc', 'IN-HC-CAL', 'High Court at Calcutta',                    'HC', 'West Bengal'),
  ('mphc', 'IN-HC-MP',  'High Court of Madhya Pradesh',              'HC', 'Madhya Pradesh'),
  ('rjhc', 'IN-HC-RAJ', 'High Court of Rajasthan',                   'HC', 'Rajasthan'),
  ('pbhc', 'IN-HC-PH',  'High Court of Punjab & Haryana',            'HC', 'Punjab & Haryana'),
  ('brhc', 'IN-HC-PAT', 'High Court of Patna',                       'HC', 'Bihar'),
  ('odhc', 'IN-HC-ORI', 'High Court of Orissa',                      'HC', 'Odisha'),
  ('cghc', 'IN-HC-CHH', 'High Court of Chhattisgarh',                'HC', 'Chhattisgarh'),
  ('ashc', 'IN-HC-GAU', 'Gauhati High Court',                        'HC', 'Assam'),
  ('hphc', 'IN-HC-HP',  'High Court of Himachal Pradesh',            'HC', 'Himachal Pradesh'),
  ('jkhc', 'IN-HC-JK',  'High Court of Jammu & Kashmir and Ladakh',  'HC', 'Jammu & Kashmir'),
  ('jhhc', 'IN-HC-JHK', 'High Court of Jharkhand',                   'HC', 'Jharkhand'),
  ('mnhc', 'IN-HC-MAN', 'High Court of Manipur',                     'HC', 'Manipur'),
  ('mlhc', 'IN-HC-MEG', 'High Court of Meghalaya',                   'HC', 'Meghalaya'),
  ('skhc', 'IN-HC-SIK', 'High Court of Sikkim',                      'HC', 'Sikkim'),
  ('trhc', 'IN-HC-TRI', 'High Court of Tripura',                     'HC', 'Tripura'),
  ('ukhc', 'IN-HC-UTT', 'High Court of Uttarakhand',                 'HC', 'Uttarakhand')
ON CONFLICT (bench_code) DO UPDATE
  SET court_id   = EXCLUDED.court_id,
      court_name = EXCLUDED.court_name,
      court_type = EXCLUDED.court_type,
      state_name = EXCLUDED.state_name,
      updated_at = NOW();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. nv_case_type_codes — short code → display name (per tier / optional state)
--    P1 seed: small SME-curated representative set (state_code '' = any state).
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nv_case_type_codes (
  code         VARCHAR(24) NOT NULL,
  court_type   VARCHAR(2)  NOT NULL,
  state_code   VARCHAR(2)  NOT NULL DEFAULT '',
  display_name VARCHAR(200) NOT NULL,
  ssot_source  VARCHAR(40) NOT NULL DEFAULT 'manual_sme',
  updated_at   TIMESTAMP   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (code, court_type, state_code)
);

INSERT INTO public.nv_case_type_codes (code, court_type, state_code, display_name) VALUES
  ('CRLP',     'HC', '', 'Criminal Petition'),
  ('CRMA',     'HC', '', 'Criminal Miscellaneous Application'),
  ('WP',       'HC', '', 'Writ Petition'),
  ('WP(C)',    'HC', '', 'Writ Petition (Civil)'),
  ('WP(Crl)',  'HC', '', 'Writ Petition (Criminal)'),
  ('CA',       'HC', '', 'Civil Application'),
  ('CRLA',     'HC', '', 'Criminal Appeal'),
  ('SLP(C)',   'SC', '', 'Special Leave Petition (Civil)'),
  ('SLP(Crl)', 'SC', '', 'Special Leave Petition (Criminal)'),
  ('WP(Crl)',  'SC', '', 'Writ Petition (Criminal)'),
  ('CA',       'SC', '', 'Civil Appeal'),
  ('CS',       'DC', '', 'Civil Suit'),
  ('CC',       'DC', '', 'Calendar Case'),
  ('SC',       'DC', '', 'Sessions Case')
ON CONFLICT (code, court_type, state_code) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      updated_at   = NOW();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. nv_district_master — state + establishment code → district + complex
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nv_district_master (
  state_code      VARCHAR(2)  NOT NULL,
  district_code   VARCHAR(4)  NOT NULL,
  district_name   VARCHAR(120) NOT NULL,
  default_complex VARCHAR(200),
  ssot_source     VARCHAR(40) NOT NULL DEFAULT 'ecourts_open_data',
  updated_at      TIMESTAMP   NOT NULL DEFAULT NOW(),
  PRIMARY KEY (state_code, district_code)
);

INSERT INTO public.nv_district_master (state_code, district_code, district_name, default_complex) VALUES
  ('TS', 'WL', 'Warangal',   'District & Sessions Court, Warangal'),
  ('TS', 'HY', 'Hyderabad',  'District & Sessions Court, Hyderabad'),
  ('AP', 'PK', 'Prakasam',   'District & Sessions Court, Prakasam'),
  ('AP', 'GN', 'Guntur',     'District & Sessions Court, Guntur')
ON CONFLICT (state_code, district_code) DO UPDATE
  SET district_name   = EXCLUDED.district_name,
      default_complex = EXCLUDED.default_complex,
      updated_at      = NOW();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Grant runtime role (nv_app) read access. Guarded on the role existing so a
--    fresh `createdb + psql -f` (drift check) stays self-contained.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nv_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.nv_cnr_prefix_rules TO nv_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.nv_court_jurisdictions TO nv_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.nv_case_type_codes TO nv_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.nv_district_master TO nv_app';
  END IF;
END $$;
