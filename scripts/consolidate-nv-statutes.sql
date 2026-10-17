-- B1 (2026-05-05): nv_statutes consolidation
-- Decision: canonical = public.nv_statutes (305 rows, live writer in
-- nv-statute-seeding-service.ts). nv_schema.nv_statutes (83 rows) is a
-- proper SUBSET (in_nv_only=0, intersect=83) and has no writer. Drop.
BEGIN;
DROP TABLE IF EXISTS nv_schema.nv_statutes CASCADE;
COMMIT;
