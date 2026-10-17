-- v5.0.1 Phase F — DB hygiene pass (2026-05-06)
-- Add 26 missing indexes on FK columns identified by FK-without-index audit.
-- Each is CREATE INDEX IF NOT EXISTS so the script is fully idempotent.
-- Schema layout note: most nv_* tables (including nv_agent_personas and
-- nv_audit_logs) live in `public.`, NOT `nv_schema.`. Only experiment/drift/
-- subscription tables live in nv_schema. Verified via information_schema
-- before this migration.

BEGIN;

-- public schema (23 missing FK indexes)
CREATE INDEX IF NOT EXISTS idx_nv_sessions_user_id              ON public.nv_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_nv_auth_tokens_user_id           ON public.nv_auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_nv_agent_configs_agent_id        ON public.nv_agent_configs(agent_id);
CREATE INDEX IF NOT EXISTS idx_nv_agent_performance_agent_id    ON public.nv_agent_performance(agent_id);
CREATE INDEX IF NOT EXISTS idx_nv_agent_personas_agent_id       ON public.nv_agent_personas(agent_id);
CREATE INDEX IF NOT EXISTS idx_nv_agent_personas_created_by     ON public.nv_agent_personas(created_by);
CREATE INDEX IF NOT EXISTS idx_nv_audit_logs_user_id            ON public.nv_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_nv_roma_levels_agent_id          ON public.nv_roma_levels(agent_id);
CREATE INDEX IF NOT EXISTS idx_nv_sdk_applications_owner_id     ON public.nv_sdk_applications(owner_id);
CREATE INDEX IF NOT EXISTS idx_nv_sdk_usage_metrics_app_id      ON public.nv_sdk_usage_metrics(app_id);
CREATE INDEX IF NOT EXISTS idx_nv_token_metrics_user_id         ON public.nv_token_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_nv_orchestration_jobs_user_id    ON public.nv_orchestration_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_nv_dag_jobs_user_id              ON public.nv_dag_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_nv_hitl_queue_assigned_to        ON public.nv_hitl_queue(assigned_to);
CREATE INDEX IF NOT EXISTS idx_nv_hitl_decisions_hitl_id        ON public.nv_hitl_decisions(hitl_id);
CREATE INDEX IF NOT EXISTS idx_nv_hitl_decisions_decided_by     ON public.nv_hitl_decisions(decided_by);
CREATE INDEX IF NOT EXISTS idx_nv_documents_user_id             ON public.nv_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_nv_rag_chunks_doc_id             ON public.nv_rag_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_nv_memory_entries_user_id        ON public.nv_memory_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_nv_chat_sessions_user_id         ON public.nv_chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_nv_mcp_tool_calls_called_by      ON public.nv_mcp_tool_calls(called_by);
CREATE INDEX IF NOT EXISTS idx_nv_pii_vault_user_id             ON public.nv_pii_vault(user_id);
CREATE INDEX IF NOT EXISTS idx_nv_workspace_projects_user_id    ON public.nv_workspace_projects(user_id);

-- nv_schema (3 missing FK indexes)
CREATE INDEX IF NOT EXISTS idx_experiment_outcomes_experiment_id      ON nv_schema.experiment_outcomes(experiment_id);
CREATE INDEX IF NOT EXISTS idx_model_drift_checks_baseline_id         ON nv_schema.model_drift_checks(baseline_id);
CREATE INDEX IF NOT EXISTS idx_subscription_events_subscription_id    ON nv_schema.subscription_events(subscription_id);

COMMIT;

-- Verification:
-- SELECT count(*) FROM pg_indexes WHERE indexname LIKE 'idx_nv_%' OR indexname LIKE 'idx_experiment%' OR indexname LIKE 'idx_model_drift%' OR indexname LIKE 'idx_subscription%';
