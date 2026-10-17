-- NV-DC-STATUS-DECODE-001 (2026-09-25) — District-court case-status decode master.
--
-- DC rows publish `case_status` / `disposal_nature` as a NUMERIC eCourts code
-- (e.g. '572'). The authoritative numeric→label master is the NJDG
-- `t_case_status` table, which is NOT in our corpus yet. We therefore do NOT
-- fabricate numeric mappings (would mislead lawyers about a case's status).
--
-- This table is the runtime SSoT. The P0 seed contains only the VERIFIABLE
-- text disposal/stage buckets (label-keyed, numeric_code NULL). Numeric rows are
-- added later from the NJDG master (ssot_source flips to 'njdg_master'). The
-- adapter (src/services/nv-dc-status-codes.ts) categorises text and, for an
-- undecoded numeric code, keeps the raw value + attaches an honest
-- "decode pending" note.
--
-- Kept in EXACT parity with the Drizzle declaration in shared/schema.ts
-- (nvDcCaseStatusCodes) for the NV-SCHEMA-DRIFT-001 guardrail. Idempotent.

CREATE TABLE IF NOT EXISTS public.nv_dc_case_status_codes (
  status_key   VARCHAR(48)  PRIMARY KEY,        -- normalized label token OR numeric code (text)
  numeric_code VARCHAR(12),                     -- eCourts numeric code when known (NULL until NJDG)
  label        VARCHAR(120) NOT NULL,           -- 'Disposed' / 'Withdrawn' / ...
  category     VARCHAR(24)  NOT NULL,           -- 'disposed' | 'pending' | 'unknown'
  ssot_source  VARCHAR(40)  NOT NULL DEFAULT 'manual_sme',
  updated_at   TIMESTAMP    NOT NULL DEFAULT NOW()
);

INSERT INTO public.nv_dc_case_status_codes (status_key, numeric_code, label, category) VALUES
  ('PENDING',      NULL, 'Pending',      'pending'),
  ('CONTESTED',    NULL, 'Contested',    'pending'),
  ('UNCONTESTED',  NULL, 'Uncontested',  'pending'),
  ('DISPOSED',     NULL, 'Disposed',     'disposed'),
  ('WITHDRAWN',    NULL, 'Withdrawn',    'disposed'),
  ('DISMISSED',    NULL, 'Dismissed',    'disposed'),
  ('ALLOWED',      NULL, 'Allowed',      'disposed'),
  ('ABATED',       NULL, 'Abated',       'disposed'),
  ('TRANSFERRED',  NULL, 'Transferred',  'disposed'),
  ('CONVICTED',    NULL, 'Convicted',    'disposed'),
  ('ACQUITTED',    NULL, 'Acquitted',    'disposed'),
  ('COMPROMISED',  NULL, 'Compromised',  'disposed'),
  ('DECREED',      NULL, 'Decreed',      'disposed')
ON CONFLICT (status_key) DO UPDATE
  SET numeric_code = EXCLUDED.numeric_code,
      label        = EXCLUDED.label,
      category     = EXCLUDED.category,
      updated_at   = NOW();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nv_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.nv_dc_case_status_codes TO nv_app';
  END IF;
END $$;
