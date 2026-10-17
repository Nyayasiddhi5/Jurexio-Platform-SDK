-- B2 (2026-05-05): sdk_api_request_logs consolidation
-- Decision: canonical = public.sdk_api_request_logs (live writer:
-- middleware/jrx-sdk-gateway.ts:566 + analytics reader F12).
-- nv_schema.sdk_api_request_logs (71 rows) was written by a separate
-- pattern-detector path (app_id='pattern:REACT', org_id='0',
-- status_code=401) — these are NOT real SDK calls and cannot be FK-mapped
-- to sdk_applications.id. They have been archived to
-- .local/backups/nv_schema_sdk_api_request_logs_pre_drop_2026-05-05.csv.
-- The writer at middleware/jrx-sdk-tracking-middleware.ts:468 is being
-- updated in the same commit to write to public schema with the public
-- column shape.
BEGIN;
DROP TABLE IF EXISTS nv_schema.sdk_api_request_logs CASCADE;
COMMIT;
