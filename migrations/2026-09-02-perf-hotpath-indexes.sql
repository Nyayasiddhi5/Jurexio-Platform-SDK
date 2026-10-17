-- NV-PERF-HOTPATH-INDEX-001 — audit-driven indexes (2026-09-02).
-- CONCURRENTLY + IF NOT EXISTS; no transaction wrapper. Does NOT touch RLS pilot tables.

-- SDK auth hot path — active keys only
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sdk_keys_hashed_active
  ON sdk_app_api_keys (key_hash)
  WHERE is_active = true AND revoked_at IS NULL;

-- Orchestration job polling (status + recency)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orch_jobs_status_created
  ON nyayavigya_orchestration_jobs (status, created_at DESC);

-- Legal chat thread fetch
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_chat_session_created
  ON legal_chat_messages (session_id, created_at DESC);

-- Partner SDK request logs — billing / dashboards
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sdk_req_logs_app_created
  ON sdk_api_request_logs (application_id, created_at DESC);

-- W3C traceparent correlation
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_trace_created
  ON nv_audit_logs (trace_id, created_at DESC);

ANALYZE sdk_app_api_keys;
ANALYZE nyayavigya_orchestration_jobs;
ANALYZE legal_chat_messages;
ANALYZE sdk_api_request_logs;
ANALYZE nv_audit_logs;
