/**
 * Shared DDL for the statutes table, mirroring lib/db/src/schema/statutes.ts.
 * Used by seeders and the India Code ingest so they stay self-provisioning on
 * the external RDS app DB (no Drizzle migrations infra there). ALTERs keep an
 * existing table in sync with the extended act-metadata columns.
 */
export const STATUTES_DDL = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS statutes (
  id serial PRIMARY KEY,
  code text NOT NULL,
  jurisdiction text NOT NULL,
  section text NOT NULL,
  usc_title text,
  heading text NOT NULL,
  chapter text,
  text text NOT NULL,
  mapped_code text,
  mapped_sections jsonb NOT NULL DEFAULT '[]',
  change_notes text,
  act_name text,
  act_year text,
  act_no text,
  ministry text,
  department text,
  practice_area text,
  provision_type text NOT NULL DEFAULT 'section',
  enactment_date text,
  source_act_id text,
  created_at timestamp NOT NULL DEFAULT now()
);
ALTER TABLE statutes ADD COLUMN IF NOT EXISTS act_name text;
ALTER TABLE statutes ADD COLUMN IF NOT EXISTS act_year text;
ALTER TABLE statutes ADD COLUMN IF NOT EXISTS act_no text;
ALTER TABLE statutes ADD COLUMN IF NOT EXISTS ministry text;
ALTER TABLE statutes ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE statutes ADD COLUMN IF NOT EXISTS practice_area text;
ALTER TABLE statutes ADD COLUMN IF NOT EXISTS provision_type text NOT NULL DEFAULT 'section';
ALTER TABLE statutes ADD COLUMN IF NOT EXISTS enactment_date text;
ALTER TABLE statutes ADD COLUMN IF NOT EXISTS source_act_id text;
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE statutes ADD COLUMN IF NOT EXISTS embedding vector(1024);
ALTER TABLE statutes ADD COLUMN IF NOT EXISTS updated_at timestamp NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS statutes_code_section_idx ON statutes (code, section);
CREATE INDEX IF NOT EXISTS statutes_updated_at_idx ON statutes (updated_at);
CREATE INDEX IF NOT EXISTS statutes_code_idx ON statutes (code);
CREATE INDEX IF NOT EXISTS statutes_jurisdiction_idx ON statutes (jurisdiction);
CREATE INDEX IF NOT EXISTS statutes_practice_area_idx ON statutes (practice_area);
CREATE INDEX IF NOT EXISTS statutes_act_name_idx ON statutes (act_name);
`;

/** FTS GIN index used by /statutes/search — recreate after bulk loads. */
export const STATUTES_FTS_DDL = `
CREATE INDEX IF NOT EXISTS statutes_fts_idx ON statutes USING gin (
  to_tsvector('english',
    coalesce(code,'') || ' ' || coalesce(section,'') || ' ' ||
    coalesce(heading,'') || ' ' || coalesce(text,''))
)`;

/** HNSW index for semantic (vector) search — create after embeddings exist. */
export const STATUTES_HNSW_DDL = `
CREATE INDEX IF NOT EXISTS statutes_embedding_hnsw ON statutes USING hnsw (embedding vector_cosine_ops)`;

/** Progress tracking for the resumable India Code ingest. */
export const INGEST_PROGRESS_DDL = `
CREATE TABLE IF NOT EXISTS statute_ingest_progress (
  handle text PRIMARY KEY,
  act_title text NOT NULL,
  code text,
  status text NOT NULL DEFAULT 'pending',
  sections_loaded int NOT NULL DEFAULT 0,
  detail text,
  updated_at timestamp NOT NULL DEFAULT now()
)`;
