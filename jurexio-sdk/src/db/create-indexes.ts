// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * JRX Platform 3.1.2 — Production Index Creation Script
 * Creates all performance-critical database indexes for 120M user scale
 * Run with: npm run db:indexes
 *
 * Indexes follow these principles:
 * - All FK columns indexed for JOIN performance
 * - All filter columns indexed (status, userId, createdAt, jurisdiction)
 * - Composite indexes for common query patterns
 * - Partial indexes for enum filter hot-paths
 * - GIN indexes for JSONB columns used in filtering
 *
 * Table location:
 * - Drizzle-managed tables (public schema): bare table names
 * - Raw SQL tables (nv_schema): nv_schema.* prefix
 */

import { db as _raw_db } from './index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('db-indexes');

const INDEX_DEFINITIONS: Array<{ name: string; ddl: string }> = [
  // ── Users & Auth (public schema — Drizzle-managed) ─────────────────────────
  { name: 'idx_users_email', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON nv_users (email)` },
  { name: 'idx_users_org_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_org_id ON nv_users (org_id)` },
  { name: 'idx_nv_sdk_apps_org_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nv_sdk_apps_org_id ON nv_sdk_applications (org_id)` },
  { name: 'idx_nv_sdk_apps_status', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nv_sdk_apps_status ON nv_sdk_applications (status)` },
  { name: 'idx_sdk_keys_app_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sdk_keys_app_id ON sdk_app_api_keys (application_id)` },
  { name: 'idx_sdk_keys_hashed', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sdk_keys_hashed ON sdk_app_api_keys (key_hash)` },
  { name: 'idx_sdk_keys_hashed_active', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sdk_keys_hashed_active ON sdk_app_api_keys (key_hash) WHERE is_active = true AND revoked_at IS NULL` },

  // ── Orchestration + legal chat hot paths (NV-PERF-HOTPATH-INDEX-001) ───────
  { name: 'idx_orch_jobs_status_created', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orch_jobs_status_created ON jurexio_orchestration_jobs (status, created_at DESC)` },
  { name: 'idx_legal_chat_session_created', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_chat_session_created ON legal_chat_messages (session_id, created_at DESC)` },

  // ── GRPO Runs (public schema — Drizzle-managed) ────────────────────────────
  { name: 'idx_grpo_runs_pattern', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grpo_runs_pattern ON nv_grpo_runs (pattern_key)` },
  { name: 'idx_grpo_runs_agent', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grpo_runs_agent ON nv_grpo_runs (agent_id)` },
  { name: 'idx_grpo_runs_created', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grpo_runs_created ON nv_grpo_runs (created_at DESC)` },
  { name: 'idx_grpo_runs_jurisdiction', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grpo_runs_jurisdiction ON nv_grpo_runs (jurisdiction)` },
  { name: 'idx_grpo_policy_snapshots_created', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_grpo_policy_snapshots_created ON nv_grpo_policy_snapshots (created_at DESC)` },

  // ── Audit Logs (public schema — Drizzle-managed, hash chain) ───────────────
  { name: 'idx_audit_logs_event_type', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_event_type ON nv_audit_logs (event_type)` },
  { name: 'idx_audit_logs_created', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_created ON nv_audit_logs (created_at DESC)` },
  { name: 'idx_audit_logs_user_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_user_id ON nv_audit_logs (user_id)` },
  { name: 'idx_audit_logs_trace_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_trace_id ON nv_audit_logs (trace_id)` },
  { name: 'idx_audit_logs_composite', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_composite ON nv_audit_logs (event_type, created_at DESC)` },
  { name: 'idx_audit_logs_trace_created', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_trace_created ON nv_audit_logs (trace_id, created_at DESC)` },
  { name: 'idx_sdk_req_logs_app_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sdk_req_logs_app_id ON sdk_api_request_logs (application_id)` },
  { name: 'idx_sdk_req_logs_created', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sdk_req_logs_created ON sdk_api_request_logs (created_at DESC)` },
  { name: 'idx_sdk_req_logs_app_created', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sdk_req_logs_app_created ON sdk_api_request_logs (application_id, created_at DESC)` },
  { name: 'idx_sdk_req_logs_status', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sdk_req_logs_status ON sdk_api_request_logs (status_code)` },

  // ── Billing & Subscriptions (public schema — Drizzle-managed) ──────────────
  { name: 'idx_subscriptions_user_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_user_id ON nv_subscriptions (user_id)` },
  { name: 'idx_subscriptions_status', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_status ON nv_subscriptions (status)` },
  { name: 'idx_subscriptions_plan', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_plan ON nv_subscriptions (plan)` },
  { name: 'idx_credit_wallet_user_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_wallet_user_id ON nv_credit_wallet (user_id)` },
  { name: 'idx_credit_txns_wallet_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_txns_wallet_id ON nv_credit_transactions (wallet_id)` },
  { name: 'idx_credit_txns_user_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_txns_user_id ON nv_credit_transactions (user_id)` },
  { name: 'idx_credit_txns_type', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_txns_type ON nv_credit_transactions (type)` },
  { name: 'idx_credit_txns_created', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_credit_txns_created ON nv_credit_transactions (created_at DESC)` },
  { name: 'idx_invoices_user_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_user_id ON nv_invoices (user_id)` },
  { name: 'idx_invoices_status', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_status ON nv_invoices (status)` },
  { name: 'idx_payments_user_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_user_id ON nv_payments (user_id)` },
  { name: 'idx_payments_status', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_status ON nv_payments (status)` },
  { name: 'idx_payments_gateway_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payments_gateway_id ON nv_payments (gateway_payment_id)` },

  // ── AI Activity (public schema — Drizzle-managed) ──────────────────────────
  { name: 'idx_ai_activity_user_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_activity_user_id ON nv_ai_activity (user_id)` },
  { name: 'idx_ai_activity_type', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_activity_type ON nv_ai_activity (activity_type)` },
  { name: 'idx_ai_activity_pattern', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_activity_pattern ON nv_ai_activity (pattern_key)` },
  { name: 'idx_ai_activity_created', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_activity_created ON nv_ai_activity (created_at DESC)` },
  { name: 'idx_ai_activity_jurisdiction', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_activity_jurisdiction ON nv_ai_activity (jurisdiction)` },
  { name: 'idx_ai_activity_trace', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_activity_trace ON nv_ai_activity (trace_id)` },
  { name: 'idx_ai_activity_composite_usage', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_activity_composite_usage ON nv_ai_activity (model_provider, created_at DESC)` },
  { name: 'idx_ai_activity_composite_billing', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_ai_activity_composite_billing ON nv_ai_activity (user_id, created_at DESC)` },

  // ── Case Updates & Hearings (public schema — Drizzle-managed) ──────────────
  { name: 'idx_case_updates_user_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_case_updates_user_id ON nv_case_updates (user_id)` },
  { name: 'idx_case_updates_case_num', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_case_updates_case_num ON nv_case_updates (case_number)` },
  { name: 'idx_case_updates_created', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_case_updates_created ON nv_case_updates (created_at DESC)` },
  { name: 'idx_hearing_metadata_case', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hearing_metadata_case ON nv_hearing_metadata (case_number)` },
  { name: 'idx_hearing_metadata_date', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_hearing_metadata_date ON nv_hearing_metadata (hearing_date)` },
  { name: 'idx_filing_metadata_user', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_filing_metadata_user ON nv_filing_metadata (user_id)` },
  { name: 'idx_filing_metadata_status', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_filing_metadata_status ON nv_filing_metadata (status)` },

  // ── Documents & Embeddings ─────────────────────────────────────────────────
  { name: 'idx_documents_user_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_user_id ON nv_schema.documents (user_id)` },
  { name: 'idx_documents_org_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_org_id ON nv_schema.documents (org_id)` },
  { name: 'idx_documents_created', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_documents_created ON nv_schema.documents (created_at DESC)` },
  { name: 'idx_doc_embeddings_doc_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_doc_embeddings_doc_id ON nv_document_embeddings (document_id)` },
  { name: 'idx_doc_embeddings_user_id', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_doc_embeddings_user_id ON nv_document_embeddings (user_id)` },

  // ── Legal Agents (public schema — Drizzle-managed) ─────────────────────────
  { name: 'idx_legal_agents_category', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_agents_category ON legal_agents (category)` },
  { name: 'idx_legal_agents_jurisdiction', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_agents_jurisdiction ON legal_agents (jurisdiction)` },
  { name: 'idx_legal_agents_enabled', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_legal_agents_enabled ON legal_agents (is_enabled)` },

  // ── Pattern Audit Log (public schema — Drizzle-managed) ────────────────────
  { name: 'idx_pattern_audit_pattern', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pattern_audit_pattern ON nv_pattern_audit_log (pattern_key)` },
  { name: 'idx_pattern_audit_created', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pattern_audit_created ON nv_pattern_audit_log (created_at DESC)` },

  // ── Institutional Leads (public schema — Drizzle-managed) ──────────────────
  { name: 'idx_institutional_leads_stage', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_institutional_leads_stage ON nv_institutional_leads (stage)` },
  { name: 'idx_institutional_leads_created', ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_institutional_leads_created ON nv_institutional_leads (created_at DESC)` },
];

async function createAllIndexes(): Promise<void> {
  logger.info(`[DB-Indexes] Creating ${INDEX_DEFINITIONS.length} production indexes...`);
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const { name, ddl } of INDEX_DEFINITIONS) {
    try {
      await db.execute(sql.raw(ddl));
      logger.info(`[DB-Indexes] ✅ ${name}`);
      succeeded++;
    } catch (err: any) {
      if (err?.message?.includes('already exists') || err?.message?.includes('IF NOT EXISTS')) {
        logger.debug(`[DB-Indexes] ⏭ ${name} (already exists)`);
        skipped++;
      } else if (err?.message?.includes('does not exist') || err?.message?.includes('relation')) {
        logger.warn(`[DB-Indexes] ⚠️ ${name} — table not found (run db:migrate first)`);
        skipped++;
      } else {
        logger.error(`[DB-Indexes] ❌ ${name}`, { err: err.message });
        failed++;
      }
    }
  }

  logger.info(`[DB-Indexes] Complete: ${succeeded} created, ${skipped} skipped, ${failed} failed out of ${INDEX_DEFINITIONS.length} total`);

  if (failed > 0) {
    logger.warn('[DB-Indexes] Some indexes failed to create. Check the schema and table existence.');
    process.exit(1);
  }
}

createAllIndexes().catch((err) => {
  logger.error('[DB-Indexes] Fatal error', { err: String(err) });
  process.exit(1);
});
