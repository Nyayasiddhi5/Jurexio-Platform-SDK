import { getRdsPool } from "./lib/rdsPool";
import { logger } from "./lib/logger";

const DDL = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS judgments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  court_type TEXT NOT NULL CHECK (court_type IN ('sc', 'hc', 'dc', 'us-fed', 'us-ny')),
  court_code TEXT,
  court TEXT NOT NULL,
  bench TEXT,
  bench_name TEXT,
  year INT NOT NULL,
  title TEXT NOT NULL,
  petitioner TEXT,
  respondent TEXT,
  judges TEXT,
  author_judge TEXT,
  citation TEXT,
  cnr TEXT,
  case_type TEXT,
  case_no TEXT,
  judicial_section TEXT,
  decision_date DATE,
  date_of_registration DATE,
  disposal_nature TEXT,
  pet_advocate TEXT,
  res_advocate TEXT,
  fir_no TEXT,
  lower_court TEXT,
  purpose_name TEXT,
  order_number TEXT,
  is_final BOOLEAN,
  languages TEXT,
  description TEXT,
  pdf_link TEXT,
  source TEXT NOT NULL,
  dedupe_hash TEXT NOT NULL,
  full_text TEXT,
  embedding vector(1024),
  search_tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(petitioner, '') || ' ' || coalesce(respondent, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(citation, '') || ' ' || coalesce(cnr, '') || ' ' || coalesce(case_no, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(judges, '') || ' ' || coalesce(description, '')), 'C')
  ) STORED,
  body_search_tsv tsvector,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS judgments_dedupe_idx ON judgments (dedupe_hash);
CREATE INDEX IF NOT EXISTS judgments_search_tsv_idx ON judgments USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS judgments_sc_body_search_tsv_idx
  ON judgments USING GIN (body_search_tsv)
  WHERE court_type = 'sc';
CREATE INDEX IF NOT EXISTS judgments_court_year_idx ON judgments (court_type, year);
CREATE INDEX IF NOT EXISTS judgments_court_code_idx ON judgments (court_code);
CREATE INDEX IF NOT EXISTS judgments_cnr_idx ON judgments (cnr);
-- Expression index for exact CNR resolve (NOT unique — one CNR can have many orders)
CREATE INDEX IF NOT EXISTS judgments_cnr_upper_idx
  ON judgments (upper(btrim(cnr)))
  WHERE cnr IS NOT NULL AND btrim(cnr) <> '';
CREATE INDEX IF NOT EXISTS judgments_case_type_idx ON judgments (case_type);
CREATE INDEX IF NOT EXISTS judgments_decision_date_idx ON judgments (decision_date);
CREATE INDEX IF NOT EXISTS judgments_title_trgm_idx ON judgments USING GIN (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS judgments_embedding_hnsw
  ON judgments USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS judgments_sc_embedding_partial
  ON judgments (id) WHERE embedding IS NOT NULL AND court_type = 'sc';

CREATE TABLE IF NOT EXISTS pdf_text_cache (
  judgment_id BIGINT PRIMARY KEY REFERENCES judgments(id) ON DELETE CASCADE,
  s3_bucket TEXT NOT NULL,
  s3_key TEXT NOT NULL,
  extracted_text TEXT,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingest_progress (
  partition_key TEXT PRIMARY KEY,
  row_count INT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HC Open Data parquet_case_details dimension (CNR-keyed; CC-BY-4.0 / vanga)
CREATE TABLE IF NOT EXISTS cnr_case_details (
  cnr TEXT PRIMARY KEY,
  court_code TEXT,
  bench TEXT,
  case_type TEXT,
  case_no TEXT,
  petitioner TEXT,
  respondent TEXT,
  pet_advocate TEXT,
  res_advocate TEXT,
  judges TEXT,
  filing_date DATE,
  decision_date DATE,
  disposal_nature TEXT,
  case_status TEXT,
  acts_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  hearings JSONB NOT NULL DEFAULT '[]'::jsonb,
  linked_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
  raw JSONB,
  source TEXT NOT NULL DEFAULT 'opendata_hc_case_details',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cnr_case_details_court_idx ON cnr_case_details (court_code);
CREATE INDEX IF NOT EXISTS cnr_case_details_case_no_idx ON cnr_case_details (case_no);
CREATE INDEX IF NOT EXISTS cnr_case_details_cnr_idx ON cnr_case_details (cnr);

CREATE TABLE IF NOT EXISTS cnr_resolve_metrics (
  day DATE NOT NULL DEFAULT (CURRENT_DATE),
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  hit_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (day, status, source)
);
`;

async function main() {
  const pool = await getRdsPool();
  await pool.query(DDL);
  const ext = await pool.query(
    "SELECT extname FROM pg_extension WHERE extname IN ('vector','pg_trgm')",
  );
  logger.info(
    { extensions: ext.rows.map((r: { extname: string }) => r.extname) },
    "RDS DDL applied",
  );
  await pool.end();
}

main().catch((err) => {
  logger.error({ err: String(err) }, "RDS DDL failed");
  process.exit(1);
});
