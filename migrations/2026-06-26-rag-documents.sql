-- NV-RAG-SECONDARY-001 (2026-06-26) — provision the secondary RAG vector store.
-- The runtime role (nv_app) cannot CREATE on the hardened prod RDS, so the
-- statute backfill's best-effort ensureRagDocumentsTable() always failed and
-- rag_documents never existed (ragDocumentsInserted=0). Create it here as the
-- admin role and grant nv_app read/write. pgvector is already installed on RDS.
--
-- Self-contained: on a fresh DB without the pgvector extension available (e.g.
-- the schema-drift harness running vanilla postgres) the whole block is skipped
-- cleanly; the table is only required on RDS where pgvector exists.
BEGIN;

DO $$
BEGIN
  -- Try to enable pgvector; if unavailable, skip the vector table entirely.
  BEGIN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS vector';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'pgvector unavailable on this DB — skipping rag_documents (created on RDS where pgvector exists): %', SQLERRM;
    RETURN;
  END;

  EXECUTE 'CREATE TABLE IF NOT EXISTS public.rag_documents (
     id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     content      text NOT NULL,
     embedding    vector(1536),
     metadata     jsonb DEFAULT ''{}''::jsonb,
     namespace    varchar,
     jurisdiction varchar,
     created_at   timestamptz DEFAULT now()
   )';
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rag_docs_ns  ON public.rag_documents(namespace)';
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rag_docs_jur ON public.rag_documents(jurisdiction)';

  -- Approximate-NN cosine index (ivfflat). Safe on an empty table.
  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_rag_docs_embedding ON public.rag_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)';
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'ivfflat index skipped: %', SQLERRM;
  END;

  -- Grant the runtime role read/write (guarded on the role existing).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nv_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.rag_documents TO nv_app';
  END IF;

  RAISE NOTICE 'rag_documents secondary vector store ensured';
END $$;

COMMIT;
