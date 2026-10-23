-- NV-CASE-API-P1-001 — party PII + diary_no columns on cases_search_staging
-- Database: case_api_search on jrx-caselaw-pg
-- Non-destructive: ADD COLUMN IF NOT EXISTS only; no data rewrite.

BEGIN;

ALTER TABLE cases_search_staging
  ADD COLUMN IF NOT EXISTS diary_no text,
  ADD COLUMN IF NOT EXISTS petitioner_address text,
  ADD COLUMN IF NOT EXISTS respondent_address text,
  ADD COLUMN IF NOT EXISTS petitioner_phone text,
  ADD COLUMN IF NOT EXISTS respondent_phone text,
  ADD COLUMN IF NOT EXISTS petitioner_email text,
  ADD COLUMN IF NOT EXISTS respondent_email text,
  ADD COLUMN IF NOT EXISTS petitioner_father_name text,
  ADD COLUMN IF NOT EXISTS respondent_father_name text;

-- SC diary search index (partial — SC rows only in practice)
CREATE INDEX IF NOT EXISTS idx_css_diary_no
  ON cases_search_staging (diary_no)
  WHERE diary_no IS NOT NULL AND btrim(diary_no) <> '';

COMMIT;
